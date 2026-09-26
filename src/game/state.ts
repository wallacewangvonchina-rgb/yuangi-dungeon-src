import {
  BASE_PLAYER,
  SKILL_POOL,
  type ComboId,
  type SkillDef,
  type SkillId,
} from './config';
import { rand } from './rng';

// ========== 单局状态（RunState） ==========
export interface RunState {
  hp: number;
  maxHp: number;
  attack: number;
  speed: number; // 设计基准速度
  fireRateMs: number;
  extraShots: number;
  pierce: number;
  lifesteal: number;
  luck: number; // 金币收益倍率
  coins: number;
  level: number;
  /** 本局击杀数：结算面板上给"这局打得怎么样"一个具体数字。 */
  kills: number;
  skills: SkillId[];
  /** 本局已解锁的连段边（由升级卡写入）；canCancel 查这里决定窗口开不开。 */
  unlockedCombos: ComboId[];
}

// ========== 局外成长状态（MetaState，localStorage 持久化） ==========
export interface MetaUpgradeLevels {
  attack: number;
  hp: number;
  speed: number;
}

export interface MetaState {
  permAttack: number;
  permHp: number;
  permSpeed: number;
  bankCoins: number;
  upgradeLevels: MetaUpgradeLevels;
}

export const META_STORAGE_KEY = 'yuangi-dungeon-meta-v1';

export const UPGRADE_COSTS: Record<keyof MetaUpgradeLevels, number[]> = {
  attack: [30, 60, 120, 240],
  hp: [25, 50, 100, 200],
  speed: [40, 80, 160, 320],
};

export const defaultMeta = (): MetaState => ({
  permAttack: 0,
  permHp: 0,
  permSpeed: 0,
  bankCoins: 0,
  upgradeLevels: { attack: 0, hp: 0, speed: 0 },
});

export const loadMeta = (): MetaState => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaultMeta();
  }
  try {
    const raw = window.localStorage.getItem(META_STORAGE_KEY);
    if (!raw) {
      return defaultMeta();
    }
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    return {
      ...defaultMeta(),
      ...parsed,
      upgradeLevels: {
        ...defaultMeta().upgradeLevels,
        ...(parsed.upgradeLevels ?? {}),
      },
    };
  } catch {
    return defaultMeta();
  }
};

export const saveMeta = (meta: MetaState): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
};

// ========== 单局创建与技能应用 ==========
export const createRunState = (meta: MetaState): RunState => ({
  hp: BASE_PLAYER.maxHp + meta.permHp,
  maxHp: BASE_PLAYER.maxHp + meta.permHp,
  attack: BASE_PLAYER.attack + meta.permAttack,
  speed: BASE_PLAYER.speed + meta.permSpeed,
  fireRateMs: BASE_PLAYER.fireRateMs,
  extraShots: 0,
  pierce: 0,
  lifesteal: 0,
  luck: 1,
  coins: 0,
  level: 1,
  kills: 0,
  skills: [],
  unlockedCombos: [],
});

export const applySkill = (state: RunState, skill: SkillDef): void => {
  switch (skill.id) {
    case 'flame':
      state.attack = Math.round(state.attack * 1.25);
      break;
    case 'haste':
      state.speed = Math.round(state.speed * 1.18);
      break;
    case 'vitality':
      state.maxHp += 30;
      state.hp = Math.min(state.maxHp, state.hp + 30);
      break;
    case 'rapid':
      state.fireRateMs = Math.max(250, Math.round(state.fireRateMs * 0.8));
      break;
    case 'multi':
      state.extraShots = Math.min(3, state.extraShots + 1);
      break;
    case 'vampire':
      state.lifesteal += 2;
      break;
    case 'pierce':
      state.pierce += 1;
      break;
    case 'luck':
      state.luck += 0.25;
      break;
  }
  // 解锁型卡：把这条取消边记进本局状态，canCancel 会查它。
  const unlocked = skill.unlock;
  if (unlocked !== undefined) {
    state.unlockedCombos.push(unlocked);
  }
  state.skills.push(skill.id);
};

/** 从技能池抽取互不重复的若干候选项（含随机性）。 */
export const pickSkillOptions = (
  run: RunState,
  count = 3,
): SkillDef[] => {
  const available = SKILL_POOL.filter((s) => !run.skills.includes(s.id));
  // Fisher-Yates + 种子化随机源：抽卡必须可复现，否则 P4 拿机器人跑 12 次的基线
  // 是噪声（同一份代码两次跑出不同卡序，「这层变难了」就无从判断）。
  // 顺带修掉旧写法 sort(() => Math.random() - 0.5) 的分布偏斜：
  // 比较器不满足传递性，洗出来的顺序不是均匀分布。
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const picks = shuffled.slice(0, count);
  // 保底：卡池里还有解锁型卡、这次一张都没抽到，就拿它顶掉末位。
  // 连段是这层的核心产出，纯随机会让玩家整局拿不到新招。
  const fallback = shuffled.find((s) => s.unlock);
  if (fallback && picks.length > 0 && !picks.some((s) => s.unlock)) {
    picks[picks.length - 1] = fallback;
  }
  return picks;
};

// ========== 结算与局外成长 ==========
export const settleDeath = (
  run: RunState,
  meta: MetaState,
): { banked: number } => {
  const banked = Math.floor(run.coins * 0.5);
  meta.bankCoins += banked;
  return { banked };
};

export const settleVictory = (
  run: RunState,
  meta: MetaState,
): { banked: number } => {
  const banked = run.coins;
  meta.bankCoins += banked;
  return { banked };
};

export type UpgradeKey = keyof MetaUpgradeLevels;

export const upgradePrice = (
  meta: MetaState,
  key: UpgradeKey,
): number | null => {
  const costs = UPGRADE_COSTS[key];
  const level = meta.upgradeLevels[key];
  return level < costs.length ? costs[level] : null;
};

/** 用钱包金币购买永久成长；成功返回 true。 */
export const buyUpgrade = (meta: MetaState, key: UpgradeKey): boolean => {
  const price = upgradePrice(meta, key);
  if (price === null || meta.bankCoins < price) {
    return false;
  }
  meta.bankCoins -= price;
  meta.upgradeLevels[key] += 1;
  if (key === 'attack') {
    meta.permAttack += 5;
  } else if (key === 'hp') {
    meta.permHp += 10;
  } else {
    meta.permSpeed += 24;
  }
  return true;
};
