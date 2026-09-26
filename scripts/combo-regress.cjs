/**
 * 连段断言：取消表 + 输入缓冲 + 蓄力接突刺 + 解锁型边 + 抽卡确定性。
 *
 * 为什么不靠"按键计时"来测：实测 headless Chromium 只跑到 4~11 fps，而
 * 蓄力档位读的是 this.time.now（真实时钟）。300ms 的墙钟按住会被记成 600ms 游戏时长，
 * 于是"想测 L1，落到了 L2"，测试自己抖动。所以这里改成**先把动作状态摆好、再断言**：
 * 直接注入 currentAction / actionStartedAt / actionUntil，完全不吃帧率。
 *
 * 用法：
 *   node scripts/combo-regress.cjs                      # 默认 http://localhost:5199/
 *   GAME_URL=http://localhost:4173/ HEADLESS=1 node scripts/combo-regress.cjs
 * 退出码：0 = 全过；1 = 有断言失败。
 */
const { chromium } = require("playwright");

const BASE = process.env.GAME_URL || "http://localhost:5199/";
const SEED = process.env.SEED || "12345";
const HEADLESS = process.env.HEADLESS === "1";
const URL = BASE + "?debug=1&seed=" + SEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 期望值抄自 config.ts 的 CANCEL_TABLE。改表必须同步改这里，否则断言就失去意义。
const TABLE = {
  swing:      { from: 0,   by: ["chargeHold", "dash", "blood", "thrust"] },
  chargeHold: { from: 140, by: ["dash"] },
  charge1:    { from: 140, by: ["dash", "thrust"] },
  charge2:    { from: 220, by: ["dash", "thrust"] },
  charge3:    { from: 300, by: ["dash", "blood"] },
  dash:       { from: 120, by: ["chargeHold", "blood", "thrust"] },
  blood:      { from: 200, by: ["dash", "thrust"] },
  thrust:     { from: 100, by: ["dash"] },
};
// 能被玩家"按出来"的三个脉冲招（charge 是按住型输入，不走缓冲）
const PULSE = ["dash", "blood", "thrust"];

// 解锁型边：抄自 config.ts 的 COMBO_DEFS。表里有、但默认锁死，拿到对应升级卡才放行。
const GATES = [
  { id: "dashThrust", from: "dash", to: "thrust" },
  { id: "charge2Thrust", from: "charge2", to: "thrust" },
  { id: "charge3Blood", from: "charge3", to: "blood" },
];
const ALL_GATES = GATES.map((g) => g.id);

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

  await page.goto(URL, { waitUntil: "load", timeout: 180000 });
  await page.bringToFront();
  await page.waitForFunction(() => typeof window.__YUANGI_DEBUG__ === "object", null, { timeout: 120000 });

  let started = false;
  for (let i = 0; i < 30; i++) {
    const ph = await page.evaluate(() => window.__YUANGI_DEBUG__.scene.getScene("dungeon").phase).catch(() => "");
    if (ph === "playing") { started = true; break; }
    await page.bringToFront();
    await page.mouse.move(640, 600); await sleep(200); await page.mouse.down(); await sleep(150); await page.mouse.up();
    await sleep(3000);
  }
  check(started, "进入游戏（phase === playing）");
  if (!started) { await browser.close(); process.exit(1); }

  // 无敌 + 高攻：连段断言不该被怪打断，也不该等它清场
  await page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    sc.run.maxHp = 99999; sc.run.hp = 99999;
    window.__THRUSTS__ = 0;
    const oT = sc.startThrust.bind(sc);
    sc.startThrust = () => { const r = oT(); if (r) window.__THRUSTS__ += 1; return r; };
  });

  /** 把某个动作摆成"进行中，已经过了 elapsed 毫秒"，再逐格问 canCancel。 */
  const probeRow = (id, elapsed, gates = ALL_GATES) => page.evaluate(({ id, elapsed, gates }) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    const now = sc.time.now;
    // 表一致性比的是"解锁后"的全量真值，所以这里默认全解锁；
    // 锁死/解锁的差别由下面第六节单独断言。
    sc.run.unlockedCombos = gates;
    sc.charging = (id === "chargeHold");
    sc.currentAction = id;
    sc.actionStartedAt = now - elapsed;
    sc.actionUntil = now + 5000;
    const got = {};
    for (const to of ["dash", "blood", "thrust"]) got[to] = sc.canCancel(to);
    sc.charging = false;
    return got;
  }, { id, elapsed, gates });

  // 一、窗口刚开（elapsed=1ms）：除了 cancelFromMs=0 的 swing，全部都该拒绝
  console.log("=== 取消窗口未开（elapsed = 1ms）===");
  for (const id of Object.keys(TABLE)) {
    if (TABLE[id].from === 0) { continue; }
    const got = await probeRow(id, 1);
    check(PULSE.every((to) => got[to] === false), id + " 窗口未开时拒绝所有跟进招");
  }

  // 二、窗口已开（elapsed=500ms）：逐格与 CANCEL_TABLE 一致
  console.log("=== 取消窗口已开（elapsed = 500ms）===");
  for (const id of Object.keys(TABLE)) {
    const got = await probeRow(id, 500);
    const exp = {};
    for (const to of PULSE) exp[to] = TABLE[id].by.includes(to) && id !== to;
    check(JSON.stringify(got) === JSON.stringify(exp), id + " 与取消表逐格一致（got=" + JSON.stringify(got) + "）");
  }

  // 三、端到端正例：蓄力(L1) 后摇中按 L，突刺必须真的出去
  console.log("=== 端到端：蓄力(L1) 后摇中按 L ===");
  const setup = (action, elapsed) => page.evaluate(({ action, elapsed }) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    sc.thrustReadyAt = 0;
    sc.recoveryUntil = sc.time.now + 400;
    sc.currentAction = action;
    sc.actionStartedAt = sc.time.now - elapsed;
    sc.actionUntil = sc.recoveryUntil;
    sc.charging = false;
    window.__THRUSTS__ = 0;
    return sc.currentAction;
  }, { action, elapsed });

  await setup("charge1", 200);
  await page.keyboard.press("l");
  await sleep(900);
  check((await page.evaluate(() => window.__THRUSTS__)) >= 1, "蓄力 L1 后摇中按 L 能接出突刺（蓄力接突刺）");

  // 四、端到端负例：蓄力(L3) 后摇中按 L，突刺必须被拒（蓄得越猛承诺越硬）
  console.log("=== 端到端负例：蓄力(L3) 后摇中按 L ===");
  await setup("charge3", 500);
  await page.keyboard.press("l");
  await sleep(900);
  check((await page.evaluate(() => window.__THRUSTS__)) === 0, "蓄力 L3 后摇中按 L 接不出突刺");

  // 五、空闲态：动作已经走完，任何招都该立刻能接
  console.log("=== 空闲态（动作已走完）===");
  const idle = await page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    sc.charging = false;
    sc.currentAction = "dash";
    sc.actionStartedAt = sc.time.now - 5000;
    sc.actionUntil = sc.time.now - 1000;
    return { dash: sc.canCancel("dash"), blood: sc.canCancel("blood"), thrust: sc.canCancel("thrust") };
  });
  check(idle.dash && idle.blood && idle.thrust, "动作走完后任何招都能立刻接（got=" + JSON.stringify(idle) + "）");

  // 六、解锁型边：锁着必须接不出，拿到卡才放行（"连段挂在升级卡上"的判定本体）
  console.log("=== 解锁型边（默认锁死 → 拿到卡才生效）===");
  const probeEdge = (from, to, gates) => page.evaluate(({ from, to, gates }) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    sc.charging = false;
    sc.run.unlockedCombos = gates;
    sc.currentAction = from;
    sc.actionStartedAt = sc.time.now - 5000;
    sc.actionUntil = sc.time.now + 5000;
    return sc.canCancel(to);
  }, { from, to, gates });

  for (const g of GATES) {
    check((await probeEdge(g.from, g.to, [])) === false,
      g.from + " → " + g.to + " 未解锁时被拒（" + g.id + "）");
    check((await probeEdge(g.from, g.to, [g.id])) === true,
      g.from + " → " + g.to + " 拿到卡后放行（" + g.id + "）");
  }
  // 开局自带的基础连段不能被卡池误伤
  check((await probeEdge("charge1", "thrust", [])) === true, "charge1 → thrust 开局自带，不需要解锁");
  check((await probeEdge("dash", "blood", [])) === true, "dash → blood 不是解锁边，未解锁也放行");
  check((await probeEdge("charge3", "dash", [])) === true, "冲刺是通用逃生，未解锁也放行");

  // 七、抽卡：同 seed 必须抽出同一手牌（P4 的 12 次基线全靠这条），且解锁卡有保底
  console.log("=== 抽卡确定性 + 解锁卡保底 ===");
  /** 把 createSkillCard 换成只记 id 不渲染，直接连抽 10 手。 */
  const drawPicks = (pg) => pg.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    const picks = [];
    const orig = sc.createSkillCard.bind(sc);
    sc.createSkillCard = (cx, cy, w, h, skill) => { picks.push(skill.id); return undefined; };
    for (let i = 0; i < 10; i++) { sc.run.skills = []; sc.showLevelUp(); }
    sc.createSkillCard = orig;
    return picks;
  });
  const chunk3 = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += 3) out.push(arr.slice(i, i + 3));
    return out;
  };
  /** 新开一页、进到 playing，再抽同 10 手——用来比"同 seed 是否同结果"。 */
  const openAndStart = async (seed) => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    pg.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
    await pg.goto(BASE + "?debug=1&seed=" + seed, { waitUntil: "load", timeout: 180000 });
    await pg.bringToFront();
    await pg.waitForFunction(() => typeof window.__YUANGI_DEBUG__ === "object", null, { timeout: 120000 });
    for (let i = 0; i < 20; i++) {
      const ph = await pg.evaluate(() => window.__YUANGI_DEBUG__.scene.getScene("dungeon").phase).catch(() => "");
      if (ph === "playing") { break; }
      await pg.bringToFront();
      await pg.mouse.move(640, 600); await sleep(200); await pg.mouse.down(); await sleep(150); await pg.mouse.up();
      await sleep(3000);
    }
    return pg;
  };
  const handsA = chunk3(await drawPicks(page));
  const pageB = await openAndStart(SEED);
  const handsB = chunk3(await drawPicks(pageB));
  const pageC = await openAndStart(String(Number(SEED) + 1));
  const handsC = chunk3(await drawPicks(pageC));
  await pageB.close();
  await pageC.close();
  check(handsA.length === 10 && handsA.every((h) => h.length === 3),
    "抽卡 10 次每次都给出 3 张（got " + handsA.length + " 手）");
  check(handsA.every((h) => h.some((id) => id.indexOf("combo-") === 0)),
    "每一手都保底 1 张解锁型卡（10/10）");
  check(JSON.stringify(handsA) === JSON.stringify(handsB),
    "同 seed 两次加载抽出同一手牌（可复现，P4 基线才有意义）");
  check(JSON.stringify(handsA) !== JSON.stringify(handsC),
    "换 seed 手牌不同（证明是种子驱动，不是写死的顺序）");
  check(new Set(handsA.flat()).size > 3,
    "10 手共覆盖 " + new Set(handsA.flat()).size + " 种卡（不是同 3 张反复出现）");

  // 八、端到端：真的"选"一张解锁卡，那条连段必须当场接得出
  // （第七节只证明了"发得出卡"，这一节证明 applySkill → run.unlockedCombos → canCancel 整条链是通的；
  //  两节之间正是最容易"检查器全绿、功能其实不跑"的缝。）
  console.log("=== 端到端：选卡 → 解锁边当场生效 ===");
  const EDGE_OF = {
    dashThrust: ["dash", "thrust"],
    charge2Thrust: ["charge2", "thrust"],
    charge3Blood: ["charge3", "blood"],
  };
  const picked = await page.evaluate((edgeOf) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    let unlockSkill = null;
    const orig = sc.createSkillCard.bind(sc);
    sc.createSkillCard = (cx, cy, w, h, skill) => {
      if (!unlockSkill && skill.unlock) { unlockSkill = skill; }
      return undefined;
    };
    sc.run.skills = [];
    sc.showLevelUp();
    sc.createSkillCard = orig;
    if (!unlockSkill) { return { id: null }; }
    const pair = edgeOf[unlockSkill.unlock];
    const probe = () => {
      sc.charging = false;
      sc.currentAction = pair[0];
      sc.actionStartedAt = sc.time.now - 5000;
      sc.actionUntil = sc.time.now + 5000;
      return sc.canCancel(pair[1]);
    };
    const blockedBefore = probe();
    sc.chooseSkill(unlockSkill);
    return {
      id: unlockSkill.id,
      gate: unlockSkill.unlock,
      blockedBefore,
      unlocked: sc.run.unlockedCombos.slice(),
      allowedAfter: probe(),
    };
  }, EDGE_OF);
  check(typeof picked.id === "string" && picked.id.indexOf("combo-") === 0,
    "抽到解锁卡：" + picked.id + "（保底生效）");
  check(picked.blockedBefore === false, "选卡前该连段被拒（" + picked.gate + "）");
  check(picked.unlocked && picked.unlocked.indexOf(picked.gate) >= 0,
    "选卡后 run.unlockedCombos 里出现 " + picked.gate);
  check(picked.allowedAfter === true, "选卡后该连段当场可接（applySkill → canCancel 全链路通）");

  check(errs.length === 0, "无页面错误" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(fails.length ? "COMBO REGRESS RESULT: FAIL (" + fails.length + ")" : "COMBO REGRESS RESULT: PASS");
  if (fails.length) { process.exit(1); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
