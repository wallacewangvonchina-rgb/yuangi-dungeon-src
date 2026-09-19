// 线上站点体检：node scripts\check-site.cjs <url> [<url> ...]
// 输出：首屏 / 可玩时间 / 实际下行字节（按 URL 去重）/ 重复请求 / 错误，并截图到 .game-review\v
const { chromium } = require("playwright");
const OUT = "E:\\ai agent\\agent\\APP\\.game-review\\v\\";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const urls = process.argv.slice(2);
  if (!urls.length) { console.error("usage: node scripts\\check-site.cjs <url> [<url> ...]"); process.exit(2); }
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] });
  for (const target of urls) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const rows = new Map(); const bad = []; const errs = [];
    page.on("response", r => {
      const u = r.url();
      if (!u.startsWith(target)) return;
      const k = u.split("?")[0];
      const e = rows.get(k) || { n: 0, len: Number(r.headers()["content-length"] || 0) };
      e.n++; rows.set(k, e);
      if (r.status() >= 400 && !u.includes("favicon")) bad.push(r.status() + " " + u);
    });
    page.on("pageerror", e => errs.push(String(e).slice(0, 140)));
    const t0 = Date.now();
    try { await page.goto(target, { waitUntil: "load", timeout: 180000 }); }
    catch (e) { console.log(target + "\n  GOTO FAIL " + e.message.slice(0, 90)); await page.close(); continue; }
    const tLoad = Date.now() - t0;
    let tCanvas = null;
    try { await page.waitForSelector("canvas", { timeout: 180000 }); tCanvas = Date.now() - t0; } catch {}
    let bytes = 0, reqs = 0, last = -1, quiet = 0;
    const tq = Date.now();
    while (Date.now() - tq < 120000) {
      bytes = 0; reqs = 0; for (const v of rows.values()) { bytes += v.len; reqs += v.n; }
      if (bytes === last) { quiet++; if (quiet >= 4) break; } else { quiet = 0; }
      last = bytes; await sleep(1000);
    }
    const tAll = Date.now() - t0;
    const dups = [...rows.entries()].filter(e => e[1].n > 1).map(e => e[0].split("/").pop() + " x" + e[1].n);
    console.log("=== " + target);
    console.log("  html=" + tLoad + "ms  playable(canvas)=" + (tCanvas === null ? "n/a" : tCanvas + "ms") + "  all-quiet=" + tAll + "ms");
    console.log("  uniqURL=" + rows.size + " reqs=" + reqs + " down=" + (bytes / 1024).toFixed(0) + " KB avg=" + (bytes / 1024 / (tAll / 1000)).toFixed(0) + " KB/s");
    console.log("  duplicates=" + (dups.slice(0, 8).join(" | ") || "none"));
    console.log("  BAD=" + (bad.slice(0, 4).join(" | ") || "none") + "  PAGEERR=" + (errs.slice(0, 3).join(" | ") || "none"));
    try { await page.screenshot({ path: OUT + "site-" + target.replace(/[^a-z0-9]/gi, "_").slice(-40) + ".png" }); } catch {}
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });