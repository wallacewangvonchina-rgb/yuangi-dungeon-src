# AGENTS.md — 元气地牢 (yuangi-dungeon)

Phaser 3.90 + TypeScript + Vite。本仓库是**源码唯一真源**。

## 命令

- 装依赖：`npm ci`（首次，或 `package-lock.json` 变更后）
- 本地开发：`npm run dev -- --port 5199`（端口由命令行传入，`vite.config.ts` 未固定端口；不加参数是 Vite 默认 5173）
- 类型检查：`npm run typecheck`（改完 TS 必须过）
- 构建：`npm run build` → `dist/`
- 线上体检：`node scripts/check-site.cjs`
- 发布：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-pages.ps1 -Pull -Message "改了什么"`

## 硬约束

- 素材一律 `.webp`。`dist` 里出现任何 `.png`，发布脚本会直接失败退出。
- 角色贴图必须用**无损** webp：代码会对它们调 `setTint()`，有损压缩会产生彩色描边。
- `window.__YUANGI_DEBUG__` 只在 dev、或 URL 带 `?debug=1` 时暴露；生产默认不暴露 Game 实例。
- 判定"已进入游戏"必须看 `phase === 'playing'`，**不能**用 `scene.run` —— 主菜单阶段 `run` 就已存在（`src/scene/DungeonScene.ts` 里 `run` 与 `phase='menu'` 同时赋值），用 `run` 会得到假的"已开局"。

## 发布安全（重要）

`scripts/deploy-pages.ps1` 是 **fail-closed** 的：先校验 `dist` 完整性（入口 js/css 存在、4 张角色/背景 webp 存在、loading 帧 ≥24、无 png、总体积 ≥2.5MB），再镜像同步到发布仓库，再**逐文件比对**两边清单，任何不一致都会中止并把发布仓库回滚到上次成功状态，绝不推送。

- 不要绕过它手动 `robocopy /MIR` 到发布仓库 —— `/MIR` 会删除目标端多出的文件，历史上就这样误删过线上入口 js，导致整站 404。
- 只改文案/样式之类想先看效果，用演练模式：`-Stage <临时目录> -Dist <临时产物> -SkipBuild -NoPush`。

## 两个仓库，不要混

- `wallacewangvonchina-rgb/yuangi-dungeon-src`（本仓库）= 源码。`node_modules/`、`dist/` 已 gitignore。
- `wallacewangvonchina-rgb/yuangi-dungeon` = `dist` 产物 + GitHub Pages（线上试玩）。本机工作副本在 `..\yuangi-dungeon-web`。

## 同步约定

本机 Codex ↔ Coze Codex agent ↔ 其他机器，**只通过 git push / pull 同步源码**。

- 改完：`git push`
- 拿别人的改动：`git pull`（或 `deploy-pages.ps1 -Pull` 一条命令拉取+构建+发布）
- 不要用复制文件、临时隧道、手工覆盖目录的方式同步 —— 那正是之前"预览跑的是旧代码"的根源。