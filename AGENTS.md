# AGENTS.md — 元气地牢 (yuangi-dungeon)

Phaser 3.90 + TypeScript + Vite。本仓库是**源码唯一真源**。

## 命令

- 装依赖：`npm ci`（首次，或 `package-lock.json` 变更后）
- 本地开发：`npm run dev -- --port 5199`（端口由命令行传入，`vite.config.ts` 未固定端口；不加参数是 Vite 默认 5173）
- 类型检查：`npm run typecheck`（改完 TS 必须过）
- 构建：`npm run build` → `dist/`
- 线上体检：`node scripts/check-site.cjs`
- 确定性回归：`node scripts/regress.cjs`（固定 seed，断言刷怪阵容/障碍边界/可通关，失败 exit 1）
- 平衡取样：`node scripts/measure.cjs`（真实数值；`GODMODE=1` 只验布局）
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

## 确定性回归（固定 seed）

布局随机（障碍坐标/半径/变体、刷怪坐标）全部走 `src/game/rng.ts` 的种子随机。URL 加 `?seed=<int>` 即可复现同一个房间；不传就用 `rng.ts` 里的 `DEFAULT_SEED`。注意 `setSeed` 里是 `(seed >>> 0) || DEFAULT_SEED`，所以 `?seed=0` 会回落到默认值。

- 当前 seed 从 `window.__YUANGI_DEBUG__.registry.get('seed')` 读出。
- 表现层随机（动画相位、粒子角度/速度/时长）仍用 `Math.random`，**故意不种子化** —— 它们不影响布局复现，种子化只会让画面变假。
- 刷怪阵容本来就确定（`spawnPlanForLevel` 无随机）。判断阵容要看 `scene.spawnedKinds`（生成时刻记录），**不要**读 `scene.enemies` —— 怪会被打死，读实时数组会得到「阵容漂移」的假象。

## 回归与 CI

- `node scripts/regress.cjs`：确定性回归。断言三层刷怪阵容、障碍数量与房间边界、能否通关；任一失败 `exit 1`。默认打 `http://localhost:5199/`，可用 `GAME_URL` / `SEED` / `HEADLESS=1` / `SHOT_DIR` 覆盖。
- `node scripts/measure.cjs`：平衡取样。默认按**真实数值**跑，报告每层承伤与通关耗时；`GODMODE=1` 才把玩家调强，只用于验布局，此时承伤数据无效。
- `.github/workflows/ci.yml`：typecheck → build → `vite preview --port 4173` → regress（seed=12345，headless）→ 失败时上传截图。
- **CI 只当确定性门禁，不当平衡门禁**：regress 用 `attack=500 / hp=99999` 的强化玩家，只验「确定性 + 可通关」，所以数值波动不会把 CI 弄红；平衡结论一律由 `measure.cjs` 出。

## 本机环境坑

- npm 装包必须先把 `HTTP_PROXY` / `HTTPS_PROXY` 清空：本机默认指向 `127.0.0.1:10809`，会让 `npm install` 静默挂死（不报错、不退出）。
- `playwright` 锁死 `1.62.1`（不用 `^`）：本机已缓存的 Chromium 是 `chromium-1234`，对应 1.62.x；装 1.63 会去找 `chromium-1243`，本地回归直接报 Executable doesn't exist。
