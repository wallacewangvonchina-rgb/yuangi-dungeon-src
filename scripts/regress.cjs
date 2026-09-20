/**
 * 确定性回归：固定 seed 跑完三层，断言刷怪计划、障碍数量与边界、能否通关。
 *
 * 为什么断言的是 spawnedKinds 而不是屏幕上活着的怪：
 * 原来读 sc.enemies 会随「怪已经被打死」而变，同一个 build 两次跑出不同结果，
 * 断言只能写成「大概是这些怪」。spawnedKinds 是生成时刻记录的，不受死亡影响。
 *
 * 用法：
 *   node scripts/regress.cjs                       # 默认 http://localhost:5199/
 *   GAME_URL=http://localhost:4173/ HEADLESS=1 node scripts/regress.cjs
 * 退出码：0 = 全过；1 = 有断言失败。
 */
const { chromium } = require("playwright");

const BASE = process.env.GAME_URL || "http://localhost:5199/";
const SEED = process.env.SEED || "12345";
const HEADLESS = process.env.HEADLESS === "1";
const URL = BASE + "?debug=1&seed=" + SEED;
const OUT = process.env.SHOT_DIR || "regress-shots/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOTAL_LEVELS = 3;
const ROOM_W = 3400;
const ROOM_H = 2300;
const WALL = 56;

// config.ts 的 spawnPlanForLevel 展开后的期望值
const EXPECTED_PLAN = {
  1: ["slime", "slime", "slime", "slime", "slime", "slime"],
  2: ["slime", "slime", "slime", "bat", "bat", "bat", "skeleton", "skeleton"],
  3: ["boss", "slime", "slime", "skeleton"],
};
// drawRoom 的 obstacleCount 是**名义上限**：落点在房间正中 300 内、或压在平台上的会被 continue 掉，
// 所以实际数量是 0..nominal，且随 seed 变化（实测 seed=12345 时 L1 只放下 2 个）。
const NOMINAL_OBSTACLES = { 1: 5, 2: 5, 3: 3 };

const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log("  FAIL " + msg); } else { console.log("  ok   " + msg); } };

(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "load", timeout: 180000 });
  await page.bringToFront();
  await page.waitForFunction(() => typeof window.__YUANGI_DEBUG__ === "object", null, { timeout: 120000 });
  console.log("hook ready +" + (Date.now() - t0) + "ms");
  console.log("seed = " + (await page.evaluate(() => window.__YUANGI_DEBUG__.registry.get("seed"))));

  const probe = () => page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    try {
      const list = sc.enemies || [];
      let b = null, bd = Infinity;
      for (const e of list) { const d = Math.hypot(sc.playerX - e.sprite.x, sc.playerY - e.groundY); if (d < bd) { bd = d; b = e; } }
      return { ok: true, phase: sc.phase, level: sc.run.level, n: list.length,
        spawned: sc.spawnedKinds, stats: sc.levelStats,
        obs: (sc.obstacles || []).map((o) => [Math.round(o.x), Math.round(o.y), Math.round(o.r)]),
        portalActive: !!sc.portalActive, px: sc.playerX, py: sc.playerY,
        dx: b ? b.sprite.x - sc.playerX : 0, dy: b ? b.groundY - sc.playerY : 0, d: bd,
        pX: sc.portal ? sc.portal.x : 0, pY: sc.portal ? sc.portal.y : 0 };
    } catch (err) { return { ok: false, err: String(err).slice(0, 160) }; }
  });

  let started = false;
  for (let i = 0; i < 30; i++) {
    const p = await probe().catch((e) => ({ ok: false, err: String(e).slice(0, 80) }));
    if (p.ok && p.phase === "playing") { started = true; break; }
    await page.bringToFront();
    await page.mouse.move(640, 600); await sleep(200); await page.mouse.down(); await sleep(150); await page.mouse.up();
    await sleep(3000);
  }
  console.log("in-game +" + (Date.now() - t0) + "ms started=" + started);
  check(started, "进入游戏（phase === playing）");
  if (!started) { await browser.close(); process.exit(1); }

  // 让机器人能稳定通关：只压低战斗时长，不改变刷怪/布局
  await page.evaluate(() => { const s = window.__YUANGI_DEBUG__.scene.getScene("dungeon"); s.run.attack = 500; s.run.maxHp = 99999; s.run.hp = 99999; });

  const held = [];
  const setKeys = async (w) => {
    for (const k of held) if (!w.includes(k)) await page.keyboard.up(k).catch(() => {});
    for (const k of w) if (!held.includes(k)) await page.keyboard.down(k).catch(() => {});
    held.length = 0; held.push(...w);
  };

  const checkedLevels = new Set();
  const layouts = {};
  const verifyLevel = (s) => {
    const lv = s.stats && s.stats.level ? s.stats.level : s.level;
    if (checkedLevels.has(lv)) return;
    checkedLevels.add(lv);
    console.log("L" + lv + " spawnedKinds = " + JSON.stringify(s.spawned));
    check(JSON.stringify(s.spawned) === JSON.stringify(EXPECTED_PLAN[lv]), "L" + lv + " 刷怪计划与 config 一致");
    check(s.obs.length > 0 && s.obs.length <= NOMINAL_OBSTACLES[lv], "L" + lv + " 障碍数量在 1.." + NOMINAL_OBSTACLES[lv] + " 内（实际 " + s.obs.length + "）");
    const outside = s.obs.filter(([x, y]) => x < WALL || y < WALL || x > ROOM_W - WALL || y > ROOM_H - WALL);
    check(outside.length === 0, "L" + lv + " 障碍都在房间内（越界 " + outside.length + " 个）");
    // 起点 / 传送门在房间正中，障碍不该压在上面
    const onCenter = s.obs.filter(([x, y, r]) => Math.hypot(x - ROOM_W / 2, y - ROOM_H / 2) < 300 + r);
    check(onCenter.length === 0, "L" + lv + " 障碍没有压在房间正中（" + onCenter.length + " 个）");
    layouts[lv] = s.obs;
  };

  let victory = false;
  let lastSig = "";
  const t1 = Date.now();
  while (Date.now() - t1 < 180000) {
    const s = await probe().catch((e) => ({ ok: false, err: String(e).slice(0, 80) }));
    if (!s.ok) { console.log("LOOP ABORT: " + s.err); break; }
    lastSig = s.phase + " L" + s.level + " n" + s.n;
    verifyLevel(s);

    if (s.phase === "levelup") {
      await setKeys([]);
      const cz = await page.evaluate(() => window.__YUANGI_DEBUG__.scene.getScene("dungeon").children.list.filter((o) => o.type === "Zone" && o.input && o.depth === 407).map((o) => ({ x: o.x, y: o.y })));
      if (cz.length) {
        const geo = await page.evaluate(() => { const g = window.__YUANGI_DEBUG__; const b = g.scale.canvasBounds; return { bx: b.x, by: b.y, sc: g.scale.displaySize.width / g.scale.width }; });
        await page.mouse.move(geo.bx + cz[0].x * geo.sc, geo.by + cz[0].y * geo.sc); await sleep(150);
        await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(700);
      }
      await sleep(400);
      continue;
    }
    if (s.phase === "victory") { victory = true; break; }

    const w = [];
    if (s.n) { if (s.d > 110) { if (s.dx > 40) w.push("ArrowRight"); else if (s.dx < -40) w.push("ArrowLeft"); if (s.dy > 40) w.push("ArrowDown"); else if (s.dy < -40) w.push("ArrowUp"); } }
    else if (s.portalActive) { const dx = s.pX - s.px, dy = s.pY - s.py; if (Math.hypot(dx, dy) > 40) { if (dx > 30) w.push("ArrowRight"); else if (dx < -30) w.push("ArrowLeft"); if (dy > 30) w.push("ArrowDown"); else if (dy < -30) w.push("ArrowUp"); } }
    await setKeys(w);
    await sleep(60);
  }
  await setKeys([]);

  check(victory, "打完全部 " + TOTAL_LEVELS + " 层（victory）");
  check(checkedLevels.size === TOTAL_LEVELS, "三层都观测到（实际 " + checkedLevels.size + "）");
  check(errs.length === 0, "无页面错误" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));
  if (process.env.DUMP_LAYOUT === "1") console.log("LAYOUT=" + JSON.stringify(layouts));

  await page.screenshot({ path: OUT + "regress-end.png" }).catch(() => {});
  await browser.close();
  console.log(victory ? "REGRESS RESULT: PASS" : "REGRESS RESULT: FAIL (last=" + lastSig + ")");
  if (fails.length || !victory) { console.log("FAILURES: " + fails.length); process.exit(1); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });