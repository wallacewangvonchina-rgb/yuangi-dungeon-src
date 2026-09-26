/**
 * headless 帧率定性：那 4fps 是 headless 固有，还是游戏本身退化？
 *
 * 同一份代码、同一个 URL，只换渲染条件跑三组对照：
 *   A headed  1280x820  有真实 GPU + 合成器
 *   B headless 1280x820
 *   C headless  320x200 只降分辨率——若帧率跟着涨，就是软件光栅的填充率瓶颈，与游戏逻辑无关
 * 并打印 WebGL UNMASKED_RENDERER：headless 常见 SwiftShader（纯 CPU 软件渲染）。
 *
 * 用法：GAME_URL=http://localhost:4173/ node scripts/fps-ab.cjs
 * 退出码恒为 0（这是取样，不是断言）。
 */
const { chromium } = require("playwright");

const BASE = process.env.GAME_URL || "http://localhost:5199/";
const SEED = process.env.SEED || "12345";
const URL = BASE + "?debug=1&seed=" + SEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { name: "A headed   1280x820", headless: false, viewport: { width: 1280, height: 820 } },
  { name: "B headless 1280x820", headless: true, viewport: { width: 1280, height: 820 } },
  { name: "C headless  320x200", headless: true, viewport: { width: 320, height: 200 } },
];

async function sample(c) {
  const browser = await chromium.launch({
    headless: c.headless,
    args: ["--no-sandbox", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  });
  try {
    const page = await browser.newPage({ viewport: c.viewport });
    await page.goto(URL, { waitUntil: "load", timeout: 180000 });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.__YUANGI_DEBUG__ === "object", null, { timeout: 120000 });
    // 点进游戏：真正要测的是战斗中的渲染负载，不是标题画面。
    for (let i = 0; i < 30; i++) {
      const ph = await page.evaluate(() => window.__YUANGI_DEBUG__.scene.getScene("dungeon").phase).catch(() => "");
      if (ph === "playing") { break; }
      await page.bringToFront();
      await page.mouse.move(c.viewport.width / 2, c.viewport.height * 0.75);
      await sleep(200);
      await page.mouse.down();
      await sleep(150);
      await page.mouse.up();
      await sleep(3000);
    }
    await sleep(1500); // 让帧率统计稳下来再取样
    return await page.evaluate(async () => {
      const sc = window.__YUANGI_DEBUG__.scene.getScene("dungeon");
      // 独立数 rAF：不信 Phaser 自己的计数，避免「它以为在跑」。
      let frames = 0;
      const t0 = performance.now();
      await new Promise((res) => {
        const step = () => {
          frames++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
      });
      const ms = performance.now() - t0;
      const canvas = sc.game.canvas;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("2d");
      let renderer = "n/a";
      try {
        const ext = gl && gl.getExtension ? gl.getExtension("WEBGL_debug_renderer_info") : null;
        renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl && gl.getParameter ? gl.getParameter(gl.RENDERER) : "n/a");
      } catch (e) {
        renderer = "err";
      }
      return {
        rafFps: Math.round((frames / (ms / 1000)) * 10) / 10,
        phaserFps: Math.round((sc.game.loop.actualFps || 0) * 10) / 10,
        canvas: canvas.width + "x" + canvas.height,
        dpr: window.devicePixelRatio,
        renderer: String(renderer).slice(0, 72),
        phase: sc.phase,
        enemies: (sc.enemies || []).length,
      };
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  const rows = [];
  for (const c of CASES) {
    let r;
    try {
      r = await sample(c);
    } catch (e) {
      r = { rafFps: -1, phaserFps: -1, error: String(e).slice(0, 120) };
    }
    rows.push({ case: c.name, ...r });
    console.log(c.name + " -> " + JSON.stringify(r));
  }
  console.log("");
  console.log("case                 rafFps  phaserFps  canvas      renderer");
  for (const r of rows) {
    console.log(
      r.case.padEnd(20) + String(r.rafFps).padStart(6) + "  " + String(r.phaserFps).padStart(9) + "  " +
      String(r.canvas || "-").padEnd(10) + "  " + String(r.renderer || "-"),
    );
  }
  const a = rows[0].rafFps, b = rows[1].rafFps, cc = rows[2].rafFps;
  console.log("");
  if (b < 0 || a < 0) {
    console.log("VERDICT: 取样失败，无法定性");
  } else if (/swiftshader|llvmpipe|software|basic render/i.test(String(rows[1].renderer))) {
    console.log("VERDICT: headless 走软件光栅（" + rows[1].renderer + "）-> headless 固有，游戏没退化");
  } else if (cc > b * 2) {
    console.log("VERDICT: 降分辨率后帧率 " + b + " -> " + cc + "，是填充率瓶颈 -> headless 固有，游戏没退化");
  } else if (a > b * 2) {
    console.log("VERDICT: headed " + a + " vs headless " + b + "，同一份代码 -> headless 固有；游戏在真实 GPU 上没有退化");
  } else {
    console.log("VERDICT: headed " + a + " 与 headless " + b + " 接近 -> 不是渲染环境问题，要查游戏自身（CPU 逻辑/每帧分配）");
  }
})();
