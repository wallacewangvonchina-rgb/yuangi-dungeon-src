/**
 * 数值取样：固定 seed 跑完三层，报告每层「实际刷怪 / 障碍布局 / 承伤 / 清层耗时」。
 *
 * 用法（先起 dev server 或 preview）：
 *   node scripts/measure.cjs                          # 默认 http://localhost:5199/ seed=12345
 *   GAME_URL=http://localhost:4173/ SEED=777 node scripts/measure.cjs
 *
 * 取样时把玩家生命顶到很高：只测「承伤」和「清层耗时」，不让死亡打断统计。
 * 同一个 seed 跑两次，obstacles 与 spawnedKinds 必须完全一致，否则说明还有随机源没接上种子。
 */
const { chromium } = require("playwright");

const BASE = process.env.GAME_URL || "http://localhost:5199/";
const SEED = process.env.SEED || "12345";
const URL = BASE + "?debug=1&seed=" + SEED;
const OUT = process.env.SHOT_DIR || "regress-shots/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 默认按真实数值测量（承伤才有意义）；GODMODE=1 才把玩家调强，只用来验布局与可通关性。
const GODMODE = process.env.GODMODE === "1";

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "load", timeout: 180000 });
  await page.bringToFront();
  await page.waitForFunction(() => typeof window.__YUANGI_DEBUG__ === "object", null, { timeout: 120000 });
  const seed = await page.evaluate(() => window.__YUANGI_DEBUG__.registry.get("seed"));
  console.log("seed=" + seed + "  hook +" + (Date.now() - t0) + "ms");

  const probe = () => page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    try {
      const list = sc.enemies || [];
      let b = null, bd = Infinity;
      for (const e of list) { const d = Math.hypot(sc.playerX - e.sprite.x, sc.playerY - e.groundY); if (d < bd) { bd = d; b = e; } }
      return { ok: true, phase: sc.phase, level: sc.run.level, n: list.length,
        kinds: list.map((e) => e.kind),
        maxHps: list.map((e) => e.maxHp),
        dmg: list.map((e) => e.damage),
        spawned: sc.spawnedKinds, stats: sc.levelStats,
        hp: sc.run.hp, maxHp: sc.run.maxHp, attack: sc.run.attack,
        obs: (sc.obstacles || []).map((o) => [Math.round(o.x), Math.round(o.y), Math.round(o.r)]).sort((a, c) => a[0] - c[0] || a[1] - c[1]),
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
  if (!started) { console.log("FAILED to enter game"); await browser.close(); process.exit(1); }

  if (GODMODE) {
    await page.evaluate(() => { const s = window.__YUANGI_DEBUG__.scene.getScene("dungeon"); s.run.attack = 500; s.run.maxHp = 99999; s.run.hp = 99999; });
    console.log("GODMODE on: attack=500 / hp=99999 ---- 承伤数据无效，仅供布局与可通关性检查");
  }

  const held = [];
  const setKeys = async (w) => {
    for (const k of held) if (!w.includes(k)) await page.keyboard.up(k).catch(() => {});
    for (const k of w) if (!held.includes(k)) await page.keyboard.down(k).catch(() => {});
    held.length = 0; held.push(...w);
  };

  const report = [];
  const levelStart = {};
  let victory = false;
  let deathAt = null;
  let lastSig = "";
  const t1 = Date.now();
  while (Date.now() - t1 < 180000) {
    const s = await probe().catch((e) => ({ ok: false, err: String(e).slice(0, 80) }));
    if (!s.ok) { console.log("LOOP ABORT: " + s.err); break; }
    lastSig = s.phase + " L" + s.level + " n" + s.n;
    if (levelStart[s.level] === undefined) { levelStart[s.level] = Date.now(); }

    const record = () => report.push({
      level: s.stats.level ?? s.level,
      plan: s.spawned, live: s.kinds,
      enemyMaxHp: s.maxHps, enemyDamage: s.dmg,
      damageTaken: s.stats.damageTaken,
      clearMs: Date.now() - (levelStart[s.level] || Date.now()),
      obstacles: s.obs,
    });

    if (s.phase === "levelup") {
      await setKeys([]);
      record();
      const cz = await page.evaluate(() => window.__YUANGI_DEBUG__.scene.getScene("dungeon").children.list.filter((o) => o.type === "Zone" && o.input && o.depth === 407).map((o) => ({ x: o.x, y: o.y })));
      if (cz.length) {
        const geo = await page.evaluate(() => { const g = window.__YUANGI_DEBUG__; const b = g.scale.canvasBounds; return { bx: b.x, by: b.y, sc: g.scale.displaySize.width / g.scale.width }; });
        await page.mouse.move(geo.bx + cz[0].x * geo.sc, geo.by + cz[0].y * geo.sc); await sleep(150);
        await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(700);
      }
      await sleep(400);
      continue;
    }
    if (s.phase === "victory") { victory = true; record(); break; }
    if (s.phase === "dead") { deathAt = true; record(); break; }

    const w = [];
    if (s.n) { if (s.d > 110) { if (s.dx > 40) w.push("ArrowRight"); else if (s.dx < -40) w.push("ArrowLeft"); if (s.dy > 40) w.push("ArrowDown"); else if (s.dy < -40) w.push("ArrowUp"); } }
    else if (s.portalActive) { const dx = s.pX - s.px, dy = s.pY - s.py; if (Math.hypot(dx, dy) > 40) { if (dx > 30) w.push("ArrowRight"); else if (dx < -30) w.push("ArrowLeft"); if (dy > 30) w.push("ArrowDown"); else if (dy < -30) w.push("ArrowUp"); } }
    // 用冲刺躲伤害：冲刺自带无敌帧，玩家有这招。机器人不用它，测出来的承伤就是纯挨打的上限。
    if (s.n && s.d < 120) await page.keyboard.press("Space").catch(() => {});
    await setKeys(w);
    await sleep(60);
  }
  await setKeys([]);

  console.log("--- REPORT ---");
  for (const r of report) {
    console.log("L" + r.level + " plan=" + JSON.stringify(r.plan) + " live=" + JSON.stringify(r.live));
    console.log("   enemyMaxHp=" + JSON.stringify(r.enemyMaxHp) + " enemyDamage=" + JSON.stringify(r.enemyDamage));
    console.log("   damageTaken=" + r.damageTaken + "  clearMs=" + r.clearMs + "  obstacles=" + r.obstacles.length);
    console.log("   obstacleXY=" + JSON.stringify(r.obstacles));
  }
  console.log("victory=" + victory + "  died=" + !!deathAt + "  last=" + lastSig);
  console.log("ERRORS: " + (errs.length ? errs.slice(0, 3).join(" | ") : "none"));
  await page.screenshot({ path: OUT + "measure-end.png" }).catch(() => {});
  await browser.close();
  if (deathAt) { console.log("NOTE: 真实数值下阵亡（这本身就是 P4 要看的结论，不是脚本错误）"); }
  if (!victory && !deathAt) { console.log("TIMEOUT: 既没通关也没阵亡，last=" + lastSig); process.exit(1); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });