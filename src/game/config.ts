import { gameUnits } from '../rendering';

// ========== 房间与地牢世界 ==========
export const ROOM_WIDTH = gameUnits(3400);
export const ROOM_HEIGHT = gameUnits(2300);
export const WALL_THICKNESS = gameUnits(56);
export const TOTAL_LEVELS = 3;

// ========== 玩家基础配置（设计基准数值，运行时经 GAME_SCALE 换算） ==========
export const BASE_PLAYER = {
  radius: gameUnits(46),
  maxHp: 100,
  attack: 12,
  speed: 360, // 设计基准速度（px/s 基准），运行时 * GAME_SCALE
  fireRateMs: 460,
  bulletSpeed: gameUnits(920),
  bulletRadius: gameUnits(16),
  attackRange: gameUnits(600),
};

export const PLAYER_CONFIG = BASE_PLAYER;

// ========== 手感：受击保护 / 击退 / 打击感 ==========

/** 受击后的无敌时长。没有它时，多只敌人会在同一帧各自结算一次伤害，被围即刻暴毙。 */
export const PLAYER_INVULN_MS = 550;

/**
 * 过层回血比例（占最大生命的比例）。
 * 实测：L1 掉 40 / L2 掉 51 / L3 开场 3.5s 即死，全程承伤 118 > 最大生命 100。
 * 而全游戏只有「嗜血斩」和「生命之心」卡两个回血来源，过层完全不回血 —— 数学上必死。
 * 三层各回 30% 才能把总承伤压回可完成的区间。
 */
export const LEVEL_CLEAR_HEAL_RATIO = 0.3;

/** 受击击退速度（设计基准单位/秒），按指数衰减，衰减系数见 DungeonScene 的 KNOCK_DAMP。 */
export const KNOCKBACK_SPEED = 780;

/** 命中 / 击杀的顿帧时长（毫秒）：短暂冻结逻辑层，让打击"有重量"。 */
export const HITSTOP_HIT_MS = 16;
export const HITSTOP_KILL_MS = 42;

/**
 * 解冻时补回给位移招式的顿帧时长上限（毫秒）。
 * 正常一帧顿帧最多 HITSTOP_KILL_MS + 一帧，这里留足余量；
 * 设上限是为了防"切后台 / 严重卡顿"——那种情况下 time.now 会跳一大截，
 * 不封顶会把 dashUntil / thrustUntil 推到几分钟之后，招式永远收不住。
 */
export const HITSTOP_COMP_MAX_MS = 120;

/** 命中 / 击杀 / 受伤的相机震动强度。 */
export const SHAKE_HIT = 0.0022;
export const SHAKE_KILL = 0.0042;
export const SHAKE_HURT = 0.0062;

/** 敌人之间的最小间距系数：1 = 刚好不重叠，>1 会留出间隙。 */
export const ENEMY_SEPARATION = 1.02;

// ========== 主动技：冲刺 / 蓄力重击 ==========

/** 冲刺（翻滚）：位移速度、持续时长、冷却，以及冲刺期间的无敌时长。 */
export const DASH_SPEED = 1250;
export const DASH_DURATION_MS = 180;
export const DASH_COOLDOWN_MS = 1500;

// ========== 近战招式：判定 / 数值 / 冷却 ==========
// 设计口径：普攻自动挥剑；4 个主动技靠"冷却分层"排优先级——冲刺短、嗜血斩中、
// 突刺长，贴脸时玩家只能选一招应对，招式变多但决策没有被稀释。

/** 普攻·挥剑：扇形判定距离、总张角、出手间隔、击退。 */
export const SWING_RANGE = gameUnits(150);
export const SWING_ARC_DEG = 110;
export const SWING_KNOCKBACK = 150;

/** 冲刺·冲撞斩：突进路径上的敌人各结算一次。 */
export const DASH_STRIKE_DAMAGE_MULT = 1.5;
export const DASH_STRIKE_KNOCKBACK = 300;
export const DASH_STRIKE_REACH = gameUnits(70);

/** 蓄力三级门槛：快斩 / 横扫 / 跳劈。 */
export const CHARGE_L1_MS = 150;
export const CHARGE_L2_MS = 400;
export const CHARGE_L3_MS = 700;
/** 蓄力期间移速倍率——"越猛越危险"的代价来源。 */
export const CHARGE_MOVE_SLOW = 0.4;
/** 三级通用收招后摇。 */
export const CHARGE_RECOVERY_MS = 420;

/** Lv1 快斩：短、快、低倍率。 */
export const CHARGE_L1_RANGE = gameUnits(170);
export const CHARGE_L1_ARC_DEG = 130;
export const CHARGE_L1_MULT = 1.6;
export const CHARGE_L1_KNOCKBACK = 220;

/** Lv2 横扫：大扇形 + 强击退，用来把贴脸的怪扫开。 */
export const CHARGE_L2_RANGE = gameUnits(210);
export const CHARGE_L2_ARC_DEG = 200;
export const CHARGE_L2_MULT = 2.4;
export const CHARGE_L2_KNOCKBACK = 500;

/** Lv3 跳劈：前跃 + 落点圆形 AoE + 震屏。 */
export const CHARGE_L3_MULT = 3.4;
export const CHARGE_L3_RADIUS = gameUnits(180);
export const CHARGE_LEAP_MS = 260;
export const CHARGE_LEAP_DISTANCE = gameUnits(170);

/** 嗜血斩：命中回血（单次有上限）、冷却。 */
export const BLOOD_CD_MS = 4000;
export const BLOOD_RANGE = gameUnits(185);
export const BLOOD_ARC_DEG = 150;
export const BLOOD_MULT = 1.4;
export const BLOOD_HEAL_PER_HIT = 5;
export const BLOOD_HEAL_MAX = 10;

/** 突刺：长距突进 + 单体高伤，用来点掉精英 / Boss。 */
export const THRUST_CD_MS = 7000;
export const THRUST_DISTANCE = gameUnits(520);
export const THRUST_MS = 180;
export const THRUST_MULT = 3;
export const THRUST_REACH = gameUnits(80);
export const THRUST_INVULN_MS = 220;

// ========== 敌人种类 ==========
export type EnemyKindId = 'slime' | 'bat' | 'skeleton' | 'boss';

export interface EnemyKindConfig {
  id: EnemyKindId;
  name: string;
  color: number;
  hp: number;
  speed: number; // 设计基准速度
  damage: number;
  radius: number;
  coins: number;
  attackCooldownMs: number;
}

export const ENEMY_KINDS: Record<EnemyKindId, EnemyKindConfig> = {
  slime: {
    id: 'slime',
    name: '史莱姆',
    color: 0x6fce5b,
    hp: 52,
    speed: 140,
    damage: 8,
    radius: gameUnits(48),
    coins: 5,
    attackCooldownMs: 900,
  },
  bat: {
    id: 'bat',
    name: '蝙蝠',
    color: 0x9b6fd0,
    hp: 34,
    speed: 200,
    damage: 6,
    radius: gameUnits(34),
    coins: 4,
    attackCooldownMs: 700,
  },
  skeleton: {
    id: 'skeleton',
    name: '骷髅',
    color: 0xd9d9d9,
    // 原 88/125/14 是从未生效的死配置（spawnPlanForLevel 里没有它）。
    // 真正放进 L2/L3 后必须按近战口径重设：伤害 14 经层数缩放后，
    // L2=17 / L3=20 —— 比削过之后的 Boss(14) 还高，作为普通怪不合理。
    // 定位改为「慢速高耐久、可以风筝」的中间层：血厚、伤害与史莱姆同档、速度全场最慢。
    hp: 80,
    speed: 125,
    damage: 9,
    radius: gameUnits(50),
    coins: 9,
    attackCooldownMs: 1000,
  },
  boss: {
    id: 'boss',
    name: '史莱姆王',
    color: 0xe2533e,
    // 实测(attack=12, 全套招式)：620 经 L3 缩放(1.44) = 893，TTK 20.0s；
    // 这 20s 里 boss 会打出约 18 次接触 = 396 伤害，而玩家最大生命只有 100。
    // 近战化后玩家必须贴脸站桩输出，远程时代的 620/22 变成了数学上的不可胜。
    hp: 420,
    speed: 100,
    damage: 14,
    radius: gameUnits(120),
    coins: 80,
    attackCooldownMs: 1100,
  },
};

export interface EnemySpawnSpec {
  kind: EnemyKindId;
  count: number;
}

export const spawnPlanForLevel = (level: number): EnemySpawnSpec[] => {
  if (level >= TOTAL_LEVELS) {
    // 终局配置。原为 1 Boss + 4 小怪：近战化后玩家必须同时贴身 5 个敌人，
    // 实测 L3 承伤稳定在 140~150，而玩家最大生命只有 130 —— 过于拥挤。
    // 改为 1 Boss + 2 史莱姆 + 1 骷髅（总数 5 -> 4），并把骷髅作为中间层引进来。
    return [
      { kind: 'boss', count: 1 },
      { kind: 'slime', count: 2 },
      { kind: 'skeleton', count: 1 },
    ];
  }
  if (level === 2) {
    // 总数维持 8 只不变（不改变 L2 的承伤压力），只是把一半换成不同种类，
    // 让骷髅第一次真正出现：史莱姆(近) / 蝙蝠(快) / 骷髅(慢而厚)。
    return [
      { kind: 'slime', count: 3 },
      { kind: 'bat', count: 3 },
      { kind: 'skeleton', count: 2 },
    ];
  }
  return [{ kind: 'slime', count: 6 }];
};

export const enemyStatScale = (level: number): number =>
  1 + (level - 1) * 0.22;

// ========== 技能池（三选一构筑） ==========
export type SkillId =
  | 'flame'
  | 'haste'
  | 'vitality'
  | 'rapid'
  | 'multi'
  | 'vampire'
  | 'pierce'
  | 'luck';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  desc: string;
  color: number;
}

export const SKILL_POOL: SkillDef[] = [
  {
    id: 'flame',
    name: '烈焰剑',
    icon: '🔥',
    desc: '攻击力 +25%',
    color: 0xff8f5c,
  },
  {
    id: 'haste',
    name: '疾风鞋',
    icon: '👟',
    desc: '移动速度 +18%',
    color: 0x8fd0ff,
  },
  {
    id: 'vitality',
    name: '生命之心',
    icon: '❤️',
    desc: '最大生命 +30，回复30',
    color: 0xff6b81,
  },
  {
    id: 'rapid',
    name: '疾风剑',
    icon: '⚡',
    desc: '攻速 +20%',
    color: 0xffd166,
  },
  {
    id: 'multi',
    name: '三连斩',
    icon: '🎯',
    desc: '挥剑额外多斩 1 刀（最多 3）',
    color: 0x9b8cff,
  },
  {
    id: 'vampire',
    name: '吸血之刃',
    icon: '🩸',
    desc: '击杀回复 3 生命',
    color: 0xd4566e,
  },
  {
    id: 'pierce',
    name: '剑气',
    icon: '💫',
    desc: '每刀额外甩出一道剑气',
    color: 0x7ee0c0,
  },
  {
    id: 'luck',
    name: '幸运金币',
    icon: '🍀',
    desc: '金币收益 +25%',
    color: 0x7fd46e,
  },
];
