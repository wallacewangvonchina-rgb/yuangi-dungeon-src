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
  counter:    { from: 120, by: ["dash"] },
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
  // windowMs 必须长到整段测试都盖得住：headless 一帧能到 250ms，400ms 的窗口会在
  // 按键被处理到之前就过期，动作走完变空闲态 → 什么招都放行，负例就会因为
  // 「已经不是窗口了」而假红。窗口给足，测的才是「窗口开着、但这条边被拒」。
  // pendingAction 一并清掉：上一节的输入缓冲不许漏进这一节。
  const setup = (action, elapsed, windowMs = 5000) => page.evaluate(({ action, elapsed, windowMs }) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    sc.thrustReadyAt = 0;
    sc.pendingAction = null;
    sc.recoveryUntil = sc.time.now + windowMs;
    sc.currentAction = action;
    sc.actionStartedAt = sc.time.now - elapsed;
    sc.actionUntil = sc.recoveryUntil;
    sc.charging = false;
    window.__THRUSTS__ = 0;
    return sc.currentAction;
  }, { action, elapsed, windowMs });

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
    // 反击斩不是 (from → to) 的取消边：它的触发源是敌人的收招，玩家只是挨打，
    // 所以判定走 tryStartCounter（解锁没 + 冷却好没），不查取消表。
    parryCounter: null,
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
    // 先清空解锁状态：保证「选卡前被拒」测的是锁，而不是上一节留下的残留。
    sc.run.unlockedCombos = [];
    const probe = () => {
      if (!pair) {
        // 反击斩：选卡前 phase 是 levelup、选卡后是 playing，两边都钉成 playing，
        // 否则这条断言会退化成「被 phase 挡住」——那就测不到锁了。
        sc.phase = "playing";
        sc.counterReadyAt = 0;
        return sc.tryStartCounter();
      }
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
  check(picked.allowedAfter === true, "选卡后该招当场可接（applySkill → 判定 全链路通）");

  // 九、霸体分档：三档的语义差异必须真的成立，而不是只有一张表。
  // 表只能证明"配了"，这里证明"命中时真的按它分支了"。
  console.log("=== 霸体分档（none / windup / full）===");
  const POISE_PUSH = 260; // 抄自 config.ts 的 POISE_WINDUP_PUSH_MS
  const poise = await page.evaluate((push) => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    // 直接按层生成：L3 拿 Boss、L2 拿蝙蝠。走的是真实 spawnEnemies 链路，
    // 所以它同时验证了"ENEMY_KINDS 里的档位真的被抄进敌人实例"。
    const n0 = sc.enemies.length;
    sc.spawnEnemies(3);
    const l3 = sc.enemies.slice(n0);
    sc.spawnEnemies(2);
    const l2 = sc.enemies.slice(n0 + l3.length);
    const boss = l3.filter((e) => e.isBoss)[0];
    const bat = l2.filter((e) => e.kind === "bat")[0];
    const slime = l2.filter((e) => e.kind === "slime")[0];

    const arm = (e) => {
      e.hp = 99999; e.maxHp = 99999;
      e.telegraphing = true;
      e.windupEnd = sc.time.now + 1000;
      e.poiseResets = 0;
      return e.windupEnd;
    };
    const snap = (e, base, poiseBreak) => {
      sc.damageEnemy(e, 1, 0, false, 0, { poiseBreak });
      return {
        telegraphing: e.telegraphing,
        pushed: Math.round(e.windupEnd - base),
        windupCleared: e.windupEnd === 0,
        cooling: e.nextAttackAt > sc.time.now,
        resets: e.poiseResets,
      };
    };
    const out = { kinds: { boss: boss.poise, bat: bat.poise, slime: slime.poise } };
    out.bat = snap(bat, arm(bat), false);
    const t = arm(slime);
    out.slime1 = snap(slime, t, false);
    out.slime2 = snap(slime, t, false);
    out.slime3 = snap(slime, t, false);
    out.bossPlain = snap(boss, arm(boss), false);
    out.bossBreak = snap(boss, arm(boss), true);
    return out;
  }, POISE_PUSH);

  check(poise.kinds.bat === "none" && poise.kinds.slime === "windup" && poise.kinds.boss === "full",
    "三档配到位：蝙蝠 none / 史莱姆 windup / Boss full（got=" + JSON.stringify(poise.kinds) + "）");
  check(poise.bat.telegraphing === false && poise.bat.windupCleared && poise.bat.cooling,
    "none：任何命中都真打断（起手作废 + 进冷却）");
  check(poise.slime1.telegraphing === true && poise.slime1.pushed === POISE_PUSH,
    "windup：第 1 次被打只推迟 " + POISE_PUSH + "ms，不打断");
  // pushed 是「相对同一个 base 的累计量」：arm() 只调了一次，三次命中都拿它当基准，
  // 所以各推 260 两次之后，第 2 次读到的是 520（不是 260）。
  check(poise.slime2.pushed === POISE_PUSH * 2 && poise.slime2.resets === 2,
    "windup：第 2 次仍推迟，累计 " + poise.slime2.pushed + "ms");
  check(poise.slime3.pushed === poise.slime2.pushed && poise.slime3.resets === 2,
    "windup：第 3 次到上限不再推（这就是「推不断」与「被锁死」的区别）");
  check(poise.bossPlain.telegraphing === true && poise.bossPlain.pushed === 0,
    "full：普攻既不断也不推（Boss 的起手不能靠挥剑解决）");
  check(poise.bossBreak.telegraphing === false && poise.bossBreak.windupCleared,
    "full：带 poiseBreak 的招能打断（反击斩的立足点）");

  // 十、反击斩：窗、卡、冷却，以及"真能打断霸体"的端到端
  // 反击窗 = 无敌帧内的「敌人收招」那一记（见 damagePlayer 的无敌帧分支）：
  // 不在无敌帧里、或不是收招，都不成立。
  console.log("=== 反击斩（无敌帧内被收招命中）===");
  const counter = await page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    const out = {};
    // 无敌帧内被"收招"命中一次。返回 { 掉血, 有没有起反击动作 }。
    // 掉血不能当信号：damagePlayer 的无敌帧分支把伤害整个吃掉，有没有卡都是 0 掉血。
    // 反击斩真正多出来的东西是「多打一记」，所以看 currentAction 有没有变成 counter。
    const punch = (counterable) => {
      sc.run.hp = 5000; sc.run.maxHp = 5000;
      sc.invulnUntil = sc.time.now + 5000;
      sc.currentAction = "swing"; sc.actionUntil = 0; // 先摆成「没在反击」，好看出这记有没有起反击
      const before = sc.run.hp;
      sc.damagePlayer(30, sc.playerX + 200, sc.playerY, counterable ? { counterable: true } : undefined);
      return { hp: sc.run.hp - before, countered: sc.currentAction === "counter" };
    };
    sc.run.unlockedCombos = []; sc.counterReadyAt = 0;
    out.noCard = punch(true);

    sc.run.unlockedCombos = ["parryCounter"]; sc.counterReadyAt = 0;
    out.withCard = punch(true);
    out.actionMs = Math.round(sc.actionUntil - sc.time.now);
    out.cdMs = Math.round(sc.counterReadyAt - sc.time.now);

    out.onCooldown = punch(true); // 冷却没走完：不该再起反击

    sc.run.unlockedCombos = ["parryCounter"]; sc.counterReadyAt = 0;
    out.plainHurt = punch(false); // 卡在、冷却好、无敌帧也在，只是没带 counterable

    // 端到端：把 Boss 摆到身前，起手状态拉好，真的放一记反击斩
    const boss = sc.enemies.filter((e) => e.isBoss)[0];
    boss.hp = 99999; boss.maxHp = 99999;
    boss.telegraphing = true; boss.windupEnd = sc.time.now + 5000; boss.poiseResets = 0;
    sc.playerX = boss.sprite.x - 120; sc.playerY = boss.groundY;
    sc.run.unlockedCombos = ["parryCounter"]; sc.counterReadyAt = 0;
    const bhp = boss.hp;
    sc.startCounter(boss.sprite.x, boss.groundY);
    out.bossTelegraphing = boss.telegraphing;
    out.bossDamage = bhp - boss.hp;
    return out;
  });
  check(counter.noCard.hp === 0 && counter.noCard.countered === false,
    "没拿卡：无敌帧自己吃掉这记伤害（0 掉血），也不会起反击");
  check(counter.withCard.hp === 0 && counter.withCard.countered === true,
    "拿到卡：同一记收招被改判成反击（起了反击动作）");
  check(counter.actionMs > 0 && counter.actionMs <= 300,
    "反击作为动作进状态机（currentAction=counter，" + counter.actionMs + "ms）");
  check(counter.cdMs > 2500, "反击进冷却（剩余 " + counter.cdMs + "ms）");
  check(counter.onCooldown.countered === false, "冷却中再被收招命中不再起反击（冷却真的在拦）");
  check(counter.plainHurt.countered === false, "没带 counterable 的伤害起不了反击（反击窗只认敌人收招）");
  check(counter.bossTelegraphing === false && counter.bossDamage > 0,
    "端到端：反击斩打断 Boss 起手并造成 " + counter.bossDamage + " 伤害");

  // 十一、Boss 阶段：换档阈值是双向的，且恰好 50% 就该进狂暴（<= 语义）
  console.log("=== Boss 阶段（50% 换档）===");
  const ph = await page.evaluate(() => {
    const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
    const boss = sc.enemies.filter((e) => e.isBoss)[0];
    sc.run.unlockedCombos = [];
    sc.invulnUntil = sc.time.now + 60000;
    boss.maxHp = 1000; boss.telegraphing = false;
    const at = (hp) => { boss.hp = hp; sc.updateEnemies(16); return boss.phaseIndex; };
    return { full: at(1000), above: at(510), exact: at(500), low: at(400), back: at(900) };
  });
  check(ph.full === 1 && ph.above === 1, "满血与 51% 都是常规档（" + ph.full + "/" + ph.above + "）");
  check(ph.exact === 0, "恰好 50% 已进狂暴档（阈值是 hpRatio <= 0.5）");
  check(ph.low === 0, "残血保持狂暴档");
  check(ph.back === 1, "血量回到 50% 以上会换回常规档（换档双向，不是单次触发）");

  check(errs.length === 0, "无页面错误" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(fails.length ? "COMBO REGRESS RESULT: FAIL (" + fails.length + ")" : "COMBO REGRESS RESULT: PASS");
  if (fails.length) { process.exit(1); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
