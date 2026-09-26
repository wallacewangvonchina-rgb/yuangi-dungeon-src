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
 * 实测（scripts/measure.cjs，固定 seed=12345，机器人打法）：
 *   L1 承伤 40~48 / L2 承伤 58~59 / L3 承伤 60~72（每次都在 L3 阵亡）。
 *   三层合计 166~171，而 30% 回复给到的总资源池只有 100+30+30=160 —— 差 4~7%，
 *   连会冲刺躲的机器人也过不去，等于几乎没有容错。
 * 提到 45% 把资源池做到 190，留出约 15% 余量。
 * 调参口径：只改这一个数就能整段缩放难度，敌人数值可以不动。
 */
export const LEVEL_CLEAR_HEAL_RATIO = 0.45;

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

// ========== 连段内核：取消窗口 + 输入缓冲 ==========
/**
 * 招式标识。取消表按"动作"记而不是按"按键"记：同一次按键在蓄力档位不同时
 * 会落到不同动作上（charge1/2/3），能接上的后续招也不同。
 */
export type ActionId =
  | 'swing'
  | 'chargeHold'
  | 'charge1'
  | 'charge2'
  | 'charge3'
  | 'dash'
  | 'blood'
  | 'thrust';

export interface CancelRule {
  /** 从本动作起算，多久之后才允许被取消（ms）。窗口越早开，"承诺"越轻。 */
  cancelFromMs: number;
  /** 可以被哪些动作取消。不在这张表里的招，只能等本动作自己走完。 */
  canceledBy: ActionId[];
}

/**
 * 取消表 = 连段的唯一真源。
 *
 * 在这之前"谁能接谁"是散在状态机里的副作用（比如冲刺顺手把 thrustUntil 清 0），
 * 所以"挥剑接冲刺"能做出来纯属巧合，而"蓄力接突刺"是被自己的后摇挡死的。
 * 表化之后，第三第四条派生只改这张表，不动状态机。
 *
 * 设计意图：
 * - swing 是空闲态（自动普攻不做承诺），cancelFromMs 0：任何招都能立刻接；
 * - dash 进每一行：冲刺是通用逃生，任何动作都得能在"够早之后"被打断；
 * - chargeHold 只允许 dash 打断：蓄力按住的唯一出路是跑；
 * - charge2 / charge3 也只允许 dash：蓄得越猛承诺越硬，这是"越猛越有代价"的落点；
 * - charge1 额外允许 thrust：这就是"蓄力接突刺"那条基础连段。
 *   注：charge2 → thrust / charge3 → blood / dash → thrust 三条边确实写在表里，
 *   但默认锁死，靠升级卡解锁（见 COMBO_DEFS 与 lockedEdge）。
 */
export const CANCEL_TABLE: Record<ActionId, CancelRule> = {
  swing: { cancelFromMs: 0, canceledBy: ['chargeHold', 'dash', 'blood', 'thrust'] },
  chargeHold: { cancelFromMs: 140, canceledBy: ['dash'] },
  charge1: { cancelFromMs: 140, canceledBy: ['dash', 'thrust'] },
  charge2: { cancelFromMs: 220, canceledBy: ['dash', 'thrust'] },
  charge3: { cancelFromMs: 300, canceledBy: ['dash', 'blood'] },
  dash: { cancelFromMs: 120, canceledBy: ['chargeHold', 'blood', 'thrust'] },
  blood: { cancelFromMs: 200, canceledBy: ['dash', 'thrust'] },
  thrust: { cancelFromMs: 100, canceledBy: ['dash'] },
};

/**
 * 解锁型派生：这些取消边**写在表里**（表仍是唯一真源），但默认锁死，
 * 要靠升级卡解锁后才生效。
 *
 * 为什么不把锁住的边从表里删掉：表要能一眼看全「这游戏里存在哪些连段」，
 * 锁的只是「这一局你有没有拿到」；否则每加一张卡都要同时改表和改判定。
 */
export type ComboId = 'dashThrust' | 'charge2Thrust' | 'charge3Blood';

export interface ComboDef {
  id: ComboId;
  from: ActionId;
  to: ActionId;
  name: string;
  icon: string;
  desc: string;
  color: number;
}

export const COMBO_DEFS: ComboDef[] = [
  {
    id: 'dashThrust',
    from: 'dash',
    to: 'thrust',
    name: '冲刺突刺',
    icon: '💠',
    desc: '解锁连段：冲刺途中可直接接出突刺',
    color: 0x6fb3ff,
  },
  {
    id: 'charge2Thrust',
    from: 'charge2',
    to: 'thrust',
    name: '二段突刺',
    icon: '🌀',
    desc: '解锁连段：二级蓄力斩后摇中可接突刺',
    color: 0x9b8cff,
  },
  {
    id: 'charge3Blood',
    from: 'charge3',
    to: 'blood',
    name: '满蓄嗜血',
    icon: '🩸',
    desc: '解锁连段：满级蓄力斩后摇中可接嗜血斩',
    color: 0xd4566e,
  },
];

/** (from → to) 这条边是不是解锁型的？是就返回它需要的 ComboId。 */
export const lockedEdge = (from: ActionId, to: ActionId): ComboId | undefined =>
  COMBO_DEFS.find((c) => c.from === from && c.to === to)?.id;

/**
 * 输入缓冲：窗口还没开、或招式还在冷却时按下的键，最多先记这么久。
 * 窗口一开就自动放出去，所以"按早了"不丢招，只是晚一点生效——
 * 这是"丝滑"的一半来源（另一半是取消窗口本身）。
 */
export const INPUT_BUFFER_MS = 150;

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
    // 8 -> 7：L1 是 6 只史莱姆的群战，实测单层承伤 40~48（近半管血），是三层里最贵的一层。
    speed: 140,
    damage: 7,
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
    // 伤害 14 -> 12：L3 缩放后 20/次，等于每次接触削掉 20% 生命，贴脸打不可接受。
    hp: 420,
    speed: 100,
    damage: 12,
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
  | 'luck'
  /** 解锁型卡：id 由 ComboId 派生，和 COMBO_DEFS 一一对应，不会两处对不上。 */
  | `combo-${ComboId}`;

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  desc: string;
  color: number;
  /**
   * 解锁型卡的载荷：拿到哪张卡就解锁哪条取消边。
   * 数值卡不填这个字段——所以「是不是解锁卡」只有这一个判据，
   * 不需要额外的 kind 枚举（两个判据就会有不一致的那天）。
   */
  unlock?: ComboId;
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
  // 解锁型卡：不加数值，给的是「一条新连段」。名字/图标/配色从 COMBO_DEFS 派生，改连段只改一处。
  ...COMBO_DEFS.map((c) => ({
    id: `combo-${c.id}` as SkillId,
    name: c.name,
    icon: c.icon,
    desc: c.desc,
    color: c.color,
    unlock: c.id,
  })),
];
