/**
 * 可复现随机源。
 *
 * 房间布局（障碍物 / 刷怪点）必须可复现：否则无头回归每次跑出来的局面都不一样，
 * 断言只能退化成「大概是这些怪」，真正的位置相关 bug（卡墙、刷在障碍里、开局被围）
 * 永远测不出来。表现层（粒子 / 抖动 / 受击特效）继续直接用 Math.random，不需要复现。
 *
 * 种子来源：URL 的 ?seed=<int>。缺省用时间戳，保证正常游玩时每局布局都不一样。
 */
const DEFAULT_SEED = 0x2f6e2b1;

let state = DEFAULT_SEED >>> 0;

export const setSeed = (seed: number): void => {
  state = (seed >>> 0) || DEFAULT_SEED;
};

/** mulberry32：小、快、分布够用，且纯整数运算，跨浏览器结果一致。 */
export const rand = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 从 location.search 解析种子；没有或非法就回落到时间戳。 */
export const seedFromSearch = (search: string): number => {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('seed');
  } catch {
    raw = null;
  }
  if (raw === null) {
    return Date.now() >>> 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n >>> 0 : Date.now() >>> 0;
};