# 一键重新发布到 GitHub Pages
# 用法（必须 -File 调用）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-pages.ps1 -Message "改了什么"
# 安全演练（不碰线上仓库、不 push）:
#   ... -File scripts\deploy-pages.ps1 -Stage <临时目录> -Dist <临时产物> -SkipBuild -NoPush
param(
  [string]$Message = "",
  [string]$Stage = "",
  [string]$Dist = "",
  [switch]$NoPush,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$self = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($self)) { throw '无法定位脚本自身路径，请用 -File 方式调用' }
$self = [IO.Path]::GetFullPath($self)
$proj = Split-Path -Parent (Split-Path -Parent $self)
if (-not (Test-Path (Join-Path $proj 'package.json'))) { throw "不是预期项目目录: $proj" }

$stage = if ($Stage) { [IO.Path]::GetFullPath($Stage) } else { Join-Path (Split-Path -Parent $proj) 'yuangi-dungeon-web' }
$dist  = if ($Dist)  { [IO.Path]::GetFullPath($Dist)  } else { Join-Path $proj 'dist' }
$site  = 'https://wallacewangvonchina-rgb.github.io/yuangi-dungeon/'

Write-Host "proj  = $proj"
Write-Host "dist  = $dist"
Write-Host "stage = $stage"
if (-not (Test-Path (Join-Path $stage '.git'))) { throw "发布仓库未初始化: $stage" }

# ---------- 1. 构建 ----------
if (-not $SkipBuild) {
  Push-Location $proj
  try { npm run build; if ($LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" } } finally { Pop-Location }
}

# ---------- 2. 产物自检（fail-closed：宁可不发布，也不把坏产物推上线） ----------
function Get-IndexRef([string]$html, [string]$pattern) {
  return [regex]::Match([IO.File]::ReadAllText($html), $pattern).Value
}

$distIndex = Join-Path $dist 'index.html'
if (-not (Test-Path -LiteralPath $distIndex)) { throw "构建产物异常，缺 index.html: $distIndex" }

$jsRel  = Get-IndexRef $distIndex 'assets/index-[A-Za-z0-9_-]+\.js'
$cssRel = Get-IndexRef $distIndex 'assets/index-[A-Za-z0-9_-]+\.css'
if (-not $jsRel)  { throw 'index.html 未引用 assets/index-*.js，产物不完整' }
if (-not $cssRel) { throw 'index.html 未引用 assets/index-*.css，产物不完整' }

$mustExist = @($jsRel, $cssRel,
  'assets/image/boss-godzilla-v1/boss-godzilla.webp',
  'assets/image/enemy-demon-v1/enemy-demon.webp',
  'assets/image/player-knight-v1/player-knight.webp',
  'assets/image/room-bg-v2/room-bg.webp')
$missing = @($mustExist | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dist $_)) })
if ($missing.Count -gt 0) { throw ('dist 缺关键文件，已中止发布: ' + ($missing -join ', ')) }

$frameDir = Join-Path $dist 'assets\image_sequence\coze-game-loading'
$frames = @(Get-ChildItem -LiteralPath $frameDir -Filter '*.webp' -File -ErrorAction SilentlyContinue)
if ($frames.Count -lt 24) { throw "loading 序列帧不足（$($frames.Count)/24），已中止发布" }

$pngs = @(Get-ChildItem -LiteralPath $dist -Recurse -File | Where-Object { $_.Extension -eq '.png' })
if ($pngs.Count -gt 0) { throw ('dist 仍含 .png: ' + (($pngs | Select-Object -First 10).Name -join ', ')) }

$distStat = Get-ChildItem -LiteralPath $dist -Recurse -File | Measure-Object -Property Length -Sum
if ($distStat.Sum -lt 2500000) { throw "dist 体积异常（$([math]::Round($distStat.Sum/1MB,2)) MB < 2.5 MB），已中止发布" }
Write-Host ("dist ok: files={0} bytes={1} js={2}" -f $distStat.Count, $distStat.Sum, $jsRel)

# ---------- 3. 同步（保留并打印 robocopy 输出，不再吞掉） ----------
$roboOut  = robocopy $dist $stage /MIR /XD .git /NFL /NDL /NJH /NJS /NP
$roboCode = $LASTEXITCODE

# ---------- 4. 同步后校验：dist 与 stage 全量清单必须逐文件一致 ----------
function Get-Inventory([string]$root) {
  $h = @{}
  Get-ChildItem -LiteralPath $root -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Name -ne '.nojekyll' } |
    ForEach-Object { $h[$_.FullName.Substring($root.Length + 1)] = $_.Length }
  return $h
}

$syncError = $null
if ($roboCode -ge 8) {
  $syncError = "robocopy failed: $roboCode"
} else {
  $invDist  = Get-Inventory $dist
  $invStage = Get-Inventory $stage
  $onlyDist = @($invDist.Keys  | Where-Object { -not $invStage.ContainsKey($_) })
  $onlyStg  = @($invStage.Keys | Where-Object { -not $invDist.ContainsKey($_) })
  $sizeDiff = @($invDist.Keys  | Where-Object { $invStage.ContainsKey($_) -and $invStage[$_] -ne $invDist[$_] })
  if ($onlyDist.Count -or $onlyStg.Count -or $sizeDiff.Count) {
    $lines = @()
    if ($onlyDist.Count) { $lines += ('dist 有但 stage 没有: ' + (($onlyDist | Select-Object -First 10) -join ', ')) }
    if ($onlyStg.Count)  { $lines += ('stage 多出的文件: '    + (($onlyStg  | Select-Object -First 10) -join ', ')) }
    if ($sizeDiff.Count) { $lines += ('大小不一致: '         + (($sizeDiff | Select-Object -First 10) -join ', ')) }
    $syncError = "sync 校验失败（robocopy exit=$roboCode）`n" + ($lines -join "`n")
  } elseif (@($mustExist | Where-Object { -not (Test-Path -LiteralPath (Join-Path $stage $_)) }).Count -gt 0) {
    $syncError = 'sync 后 stage 仍缺关键文件'
  } else {
    Write-Host "sync ok ($jsRel, files=$($invStage.Count))"
  }
}

if ($syncError) {
  Write-Host "robocopy exit=$roboCode"
  if ($roboOut) { $roboOut | Select-Object -Last 20 | ForEach-Object { Write-Host "  robo| $_" } }
  # 自愈：把 stage 拉回上次成功发布的状态，坏产物永远不会留在发布仓库里
  git -C $stage checkout -- .
  git -C $stage clean -fdq -e .nojekyll
  Write-Host '已把 stage 回滚到上次成功发布的状态（未推送任何改动）'
  throw $syncError
}

# ---------- 5. 发布 ----------
if (-not (Test-Path (Join-Path $stage '.git'))) { throw '.git 丢失，已中止' }
[IO.File]::WriteAllText((Join-Path $stage '.nojekyll'), '', (New-Object Text.UTF8Encoding($false)))

Push-Location $stage
try {
  git add -A
  git diff --cached --quiet
  $hasChanges = ($LASTEXITCODE -ne 0)
  if ($hasChanges -and -not $NoPush) {
    $m = if ($Message) { $Message } else { 'deploy ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    git commit -q -m $m
    git push -q origin main
    Write-Host "pushed: $m"
  } elseif ($hasChanges) {
    Write-Host 'DRY RUN: 有变更，未提交未推送'
    git diff --cached --stat | Select-Object -Last 8
  } else {
    Write-Host 'no changes to publish'
  }
} finally { Pop-Location }
Write-Host "site: $site"