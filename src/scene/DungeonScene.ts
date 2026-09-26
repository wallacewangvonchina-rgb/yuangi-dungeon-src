import Phaser from 'phaser';

import {
  BASE_PLAYER,
  BLOOD_ARC_DEG,
  BLOOD_CD_MS,
  BLOOD_HEAL_MAX,
  BLOOD_HEAL_PER_HIT,
  BLOOD_MULT,
  BLOOD_RANGE,
  CANCEL_TABLE,
  CHARGE_L1_ARC_DEG,
  CHARGE_L1_KNOCKBACK,
  CHARGE_L1_MS,
  CHARGE_L1_MULT,
  CHARGE_L1_RANGE,
  CHARGE_L2_ARC_DEG,
  CHARGE_L2_KNOCKBACK,
  CHARGE_L2_MS,
  CHARGE_L2_MULT,
  CHARGE_L2_RANGE,
  CHARGE_L3_MS,
  CHARGE_L3_MULT,
  CHARGE_L3_RADIUS,
  CHARGE_LEAP_DISTANCE,
  CHARGE_LEAP_MS,
  CHARGE_MOVE_SLOW,
  CHARGE_RECOVERY_MS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_SPEED,
  DASH_STRIKE_DAMAGE_MULT,
  DASH_STRIKE_KNOCKBACK,
  DASH_STRIKE_REACH,
  ENEMY_KINDS,
  ENEMY_SEPARATION,
  HITSTOP_COMP_MAX_MS,
  HITSTOP_HIT_MS,
  HITSTOP_KILL_MS,
  INPUT_BUFFER_MS,
  KNOCKBACK_SPEED,
  LEVEL_CLEAR_HEAL_RATIO,
  PLAYER_INVULN_MS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SHAKE_HIT,
  SHAKE_HURT,
  SHAKE_KILL,
  SKILL_POOL,
  SWING_ARC_DEG,
  SWING_KNOCKBACK,
  SWING_RANGE,
  THRUST_CD_MS,
  THRUST_DISTANCE,
  THRUST_INVULN_MS,
  THRUST_MS,
  THRUST_MULT,
  THRUST_REACH,
  TOTAL_LEVELS,
  WALL_THICKNESS,
  enemyStatScale,
  lockedEdge,
  spawnPlanForLevel,
  type ActionId,
  type EnemyKindId,
  type SkillDef,
} from '@/game/config';
import { sfx } from '@/game/audio';
import { rand } from '@/game/rng';
import {
  applySkill,
  buyUpgrade,
  createRunState,
  loadMeta,
  pickSkillOptions,
  saveMeta,
  settleDeath,
  settleVictory,
  upgradePrice,
  type MetaState,
  type RunState,
  type UpgradeKey,
} from '@/game/state';
import { createUiLayout } from '@/game/ui-layout';
import {
  GAME_HEIGHT,
  GAME_SCALE,
  GAME_WIDTH,
  addGameText,
  gamePixels,
  gameUnits,
} from '@/rendering';

// ========== 视觉与资源常量 ==========
const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif';

const PLAYER_TEX_KEY = 'player-knight';

const ENEMY_TEX_KEYS: Record<EnemyKindId, string> = {
  slime: 'enemy-demon',
  bat: 'enemy-demon',
  skeleton: 'enemy-demon',
  boss: 'boss-godzilla',
};

/**
 * 三种小怪共用同一张 enemy-demon 贴图，光看剪影分不出谁是谁。
 * Phaser 的 setTint 是"乘法着色"：拿暗色去乘会把整张图压黑压闷，
 * 所以这里用接近白的高亮色，只把色相推过去、尽量保住原来的明度。
 * 小怪在屏幕上约 100px，主色相就是玩家唯一来得及读的信息。
 */
const ENEMY_TINTS: Record<EnemyKindId, number> = {
  slime: 0xa8ff96, // 史莱姆 → 亮绿
  bat: 0xd7b4ff, // 蝙蝠 → 亮紫（且体积本就最小）
  skeleton: 0xe8f4ff, // 骷髅 → 冷白
  boss: 0xffffff, // 王是专属贴图，保持原色
};

const ENEMY_ANIM_RATES: Record<EnemyKindId, number> = {
  slime: 6,
  bat: 10,
  skeleton: 5,
  boss: 2.5,
};

const ENEMY_WINDUP_MS = 520;

/** 击退速度的指数衰减系数（1/秒）。 */
const KNOCK_DAMP = 9;
/** 敌人击退衰减更快，避免被推成保龄球。 */
const ENEMY_KNOCK_DAMP = 12;
/** 冲刺残影的生成间隔（毫秒）。 */
const DASH_GHOST_INTERVAL_MS = 34;
/** 摇杆死区：小于这个位移量视为没有输入。 */
const JOYSTICK_DEADZONE = 0.18;
/** 蓄力重击的子弹体积与速度系数（相对普通子弹）。 */
const HEAVY_BULLET_RADIUS_SCALE = 2.2;
const HEAVY_BULLET_SPEED_SCALE = 0.78;
/** 受伤蒙版的峰值不透明度：够醒目，但不会把战场和 HUD 一起盖掉。 */
const HURT_VEIL_ALPHA = 0.16;

/** 纹理显示尺寸：角色贴图约为碰撞半径的 6 倍（较原 3 倍放大一倍），
 *  让角色在 3400x2300 的地牢石室中更贴合场景比例。 */
const charTexSize = (radius: number): number => Math.round(radius * 6);

/** 角色贴图脚底距图片底边的留白比例（按实际贴图估算：骑士 5%、魔武将/哥斯拉 10%）。 */
const FOOT_MARGIN: Record<'player' | 'enemy' | 'boss', number> = {
  player: 0.05,
  enemy: 0.1,
  boss: 0.1,
};

/** 脚底贴地抬升量：贴图默认以中心对齐地面会让角色下半身陷入地板，
 *  按留白比例上移显示位置，使脚底正好站在 groundY 上。 */
const charFootLift = (
  radius: number,
  kind: 'player' | 'enemy' | 'boss',
): number => Math.round(charTexSize(radius) * (0.5 - FOOT_MARGIN[kind]));

// ========== 平台（背景中可走上去的台阶 / 柜子，设计单位坐标） ==========
const PLATFORMS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 44, y: 1551, w: 707, h: 453 },
  { x: 2693, y: 1384, w: 707, h: 456 },
];

const isOnPlatform = (x: number, y: number): boolean =>
  PLATFORMS.some(
    (p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h,
  );

// ========== 类型 ==========
/**
 * 所有弹窗（暂停 / 升级 / 死亡 / 通关）的统一层级。
 * 必须高于 HUD：技能钮、摇杆、按键提示都在 300+，
 * 低于它们时弹窗的黑色蒙版盖不住 HUD，技能钮会浮在弹窗上方，
 * 玩家会误以为弹窗打开时还能继续按技能。
 */
const MODAL_DEPTH = 400;

type Phase = 'menu' | 'playing' | 'paused' | 'levelup' | 'dead' | 'victory';

interface Vec2 {
  x: number;
  y: number;
}

interface Enemy {
  kind: EnemyKindId;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  baseScale: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  radius: number;
  coins: number;
  attackCooldownMs: number;
  nextAttackAt: number;
  telegraphing: boolean;
  windupEnd: number;
  animPhase: number;
  isBoss: boolean;
  /** 显示层浮动偏移（弹跳/悬浮等个性动画），投影与碰撞不受影响。 */
  hoverY: number;
  /** 角色贴图落点（地面/平台）Y 坐标，用于个性动画浮动与投影定位。 */
  groundY: number;
  /** 受击击退速度（设计基准单位/秒），指数衰减。 */
  kbX: number;
  kbY: number;
}

interface Bullet {
  sprite: Phaser.GameObjects.Arc;
  trail: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  pierce: number;
  life: number;
  /** 子弹碰撞半径（普通弹 / 蓄力重击弹不同）。 */
  radius: number;
  /** 是否为蓄力重击弹：命中反馈、击退与震屏都会加强。 */
  heavy: boolean;
  /** 已经命中过的敌人，避免穿透弹在同一只敌人身上逐帧重复结算伤害。 */
  hitSet: Set<Enemy>;
}

interface CoinPickup {
  sprite: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  alive: boolean;
  /** 随机相位，用于金币自身的旋转 / 脉动。 */
  phase: number;
}

interface Obstacle {
  x: number;
  y: number;
  r: number;
  sprite: Phaser.GameObjects.Graphics;
}

// ========== 工具函数 ==========
const clampInsideWalls = (
  v: number,
  radius: number,
  bound: number,
): number =>
  Phaser.Math.Clamp(
    v,
    WALL_THICKNESS + radius,
    bound - WALL_THICKNESS - radius,
  );

const pushOutOfObstacles = (
  x: number,
  y: number,
  radius: number,
  obstacles: Obstacle[],
): Vec2 => {
  for (const ob of obstacles) {
    const dx = x - ob.x;
    const dy = y - ob.y;
    const dist = Math.hypot(dx, dy);
    const minDist = radius + ob.r;
    if (dist < minDist) {
      if (dist < 0.001) {
        x = ob.x + minDist;
      } else {
        x = ob.x + (dx / dist) * minDist;
        y = ob.y + (dy / dist) * minDist;
      }
    }
  }
  return { x, y };
};

type ObstacleVariant = 'crate' | 'pillar';

/**
 * 障碍物原本是纯色圆角方块（fillStyle 0xb0906a），铺在石室地砖上看着像"贴图丢了"。
 * 这里按房间已有的石/木配色，程序化画成两种道具：木箱 / 石柱。
 * 碰撞体仍是半径 r 的圆，所以横向轮廓控制在 +/-r 以内；纵向略高一点，
 * 因为俯视 2.5D 下"比底面高"正是立在地上的物件该有的样子。
 */
const drawObstacleProp = (
  g: Phaser.GameObjects.Graphics,
  r: number,
  variant: ObstacleVariant,
): void => {
  g.clear();
  const u = (n: number): number => gameUnits(n);
  // 接地投影：没有它道具会像浮在地砖上的贴纸
  g.fillStyle(0x1a1208, 0.26);
  g.fillEllipse(0, r * 0.8, r * 1.86, r * 0.6);

  if (variant === 'crate') {
    const w = r;
    const top = -r * 1.02;
    const seam = -r * 0.46;
    const bot = r * 0.8;
    // 顶面受光更亮
    g.fillStyle(0xbb8c56, 1);
    g.fillRoundedRect(-w, top, w * 2, seam - top, u(14));
    g.lineStyle(u(5), 0x5a3a1f, 1);
    g.strokeRoundedRect(-w, top, w * 2, seam - top, u(14));
    // 正面背光更暗
    g.fillStyle(0x8b5f36, 1);
    g.fillRoundedRect(-w, seam, w * 2, bot - seam, u(12));
    g.lineStyle(u(5), 0x4a2e18, 1);
    g.strokeRoundedRect(-w, seam, w * 2, bot - seam, u(12));
    // 正面木板缝
    g.lineStyle(u(4), 0x6b4526, 0.9);
    for (let i = 1; i <= 2; i += 1) {
      const x = -w + (w * 2 * i) / 3;
      g.lineBetween(x, seam + u(7), x, bot - u(7));
    }
    // 斜撑：木箱最强的识别特征
    g.lineStyle(u(9), 0xa9784a, 1);
    g.lineBetween(-w + u(11), bot - u(9), w - u(11), seam + u(9));
    // 四角铁包角
    const b = u(12);
    g.fillStyle(0x6f6a63, 1);
    g.fillRoundedRect(-w, top, b, b, u(4));
    g.fillRoundedRect(w - b, top, b, b, u(4));
    g.fillRoundedRect(-w, bot - b, b, b, u(4));
    g.fillRoundedRect(w - b, bot - b, b, b, u(4));
    return;
  }

  // 石柱：柱础 + 柱身 + 柱头。
  // 用暖石色而不是中性灰：房间地砖/墙体是暖米色，中性灰放进去像"没上色的占位块"。
  const capW = r * 0.84;
  const shaftW = r * 0.68;
  const capTop = -r * 1.14;
  const capBot = -r * 0.84;
  const baseTop = r * 0.6;
  const baseBot = r * 0.9;
  // 柱身：受光面在左上（和房间里的火把光源一致），右侧压暗
  g.fillStyle(0xc6b39b, 1);
  g.fillRect(-shaftW, capBot, shaftW * 2, baseTop - capBot);
  g.fillStyle(0xd9c9b3, 1);
  g.fillRect(-shaftW, capBot, shaftW * 0.72, baseTop - capBot);
  g.fillStyle(0x9d8a73, 1);
  g.fillRect(shaftW * 0.56, capBot, shaftW * 0.44, baseTop - capBot);
  g.lineStyle(u(5), 0x6b5a45, 1);
  g.strokeRect(-shaftW, capBot, shaftW * 2, baseTop - capBot);
  // 柱头
  g.fillStyle(0xd2c0a8, 1);
  g.fillRoundedRect(-capW, capTop, capW * 2, capBot - capTop, u(9));
  g.lineStyle(u(5), 0x6b5a45, 1);
  g.strokeRoundedRect(-capW, capTop, capW * 2, capBot - capTop, u(9));
  // 柱础
  g.fillStyle(0xb8a68e, 1);
  g.fillRoundedRect(-capW, baseTop, capW * 2, baseBot - baseTop, u(9));
  g.lineStyle(u(5), 0x6b5a45, 1);
  g.strokeRoundedRect(-capW, baseTop, capW * 2, baseBot - baseTop, u(9));
};

const drawPortal = (g: Phaser.GameObjects.Graphics): void => {
  g.clear();
  const r = gameUnits(88);
  g.fillStyle(0x7e5bef, 0.92);
  g.fillCircle(0, 0, r);
  g.lineStyle(gameUnits(12), 0xb9a8ff, 1);
  g.strokeCircle(0, 0, r + gameUnits(16));
  g.lineStyle(gameUnits(6), 0xffffff, 0.8);
  g.strokeCircle(0, 0, r * 0.6);
  g.lineBetween(-r * 0.6, 0, r * 0.6, 0);
  g.lineBetween(0, -r * 0.6, 0, r * 0.6);
};

export class DungeonScene extends Phaser.Scene {
  private phase: Phase = 'menu';

  /** 本层真实刷出的怪种（生成时刻记录，不受后续死亡影响），供自动化回归断言。 */
  spawnedKinds: EnemyKindId[] = [];
  /** 本层承伤累计，供数值调参与回归取样。 */
  levelStats = { level: 0, damageTaken: 0 };
  private run!: RunState;
  private meta!: MetaState;

  private player?: Phaser.GameObjects.Container;
  private playerSprite?: Phaser.GameObjects.Image;
  private playerBaseScale = 1;
  private playerShadow?: Phaser.GameObjects.Ellipse;
  private playerX = ROOM_WIDTH / 2;
  private playerY = ROOM_HEIGHT / 2;
  private bobPhase = 0;
  private playerEmote?: Phaser.GameObjects.Graphics;
  private emoteState: 'normal' | 'attack' | 'hurt' | 'happy' = 'normal';
  private emoteUntil = 0;

  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private coins: CoinPickup[] = [];
  private obstacles: Obstacle[] = [];
  private overlays: Phaser.GameObjects.GameObject[] = [];

  private roomGfx?: Phaser.GameObjects.Image;
  private portal?: Phaser.GameObjects.Graphics;
  private portalActive = false;
  private portalTween?: Phaser.Tweens.Tween;

  private bossEnemy?: Enemy;
  private bossBarGfx?: Phaser.GameObjects.Graphics;
  private bossNameText?: Phaser.GameObjects.Text;

  private hpBarGfx?: Phaser.GameObjects.Graphics;
  /** 受伤蒙版：铺满屏幕的红色矩形，压在世界之上、HUD 之下。 */
  private hurtVeil?: Phaser.GameObjects.Rectangle;
  private hpText?: Phaser.GameObjects.Text;
  private levelText?: Phaser.GameObjects.Text;
  private coinsText?: Phaser.GameObjects.Text;
  private skillRowText?: Phaser.GameObjects.Text;
  private lastHp = -1;
  private lastCoins = -1;
  private lastLevelStr = '';
  private lastSkillKey = '';

  private fireTimer = 0;

  // ---- 手感：速度平滑 / 受击保护 / 击退 ----
  /** 当前速度向量（设计基准单位/秒），用于加速与减速插值。 */
  private velX = 0;
  private velY = 0;
  /** 面朝方向（1 右 / -1 左），冲刺兜底方向与贴图翻转用。 */
  private facing = 1;
  /** 无敌截止时间（this.time.now 基准）。 */
  private invulnUntil = 0;
  /** 受击击退速度（设计基准单位/秒），指数衰减。 */
  private knockVx = 0;
  private knockVy = 0;

  // ---- 主动技：冲刺 ----
  private dashUntil = 0;
  private dashReadyAt = 0;
  private dashVx = 0;
  private dashVy = 0;
  private nextDashGhostAt = 0;

  // ---- 主动技：蓄力重击（三级：快斩 / 横扫 / 跳劈）----
  private charging = false;
  private chargeStartAt = 0;
  private chargeReadyAt = 0;
  /** 当前蓄力档位（0 = 未达 Lv1），供 HUD 显示三格进度。 */
  private chargeLevel = 0;
  /** 收招后摇截止时间：后摇期间不能出手，是"三级越猛越有代价"的一部分。 */
  private recoveryUntil = 0;

  // ---- 连段内核：当前动作 + 输入缓冲 ----
  /** 当前动作（取消表的查询键）。空闲态是 'swing'：自动普攻不做承诺。 */
  private currentAction: ActionId = 'swing';
  /** 当前动作的起始时刻，取消窗口从这里算起。 */
  private actionStartedAt = 0;
  /** 当前动作自己的结束时刻。走完就回到空闲态，于是"什么都能接"。 */
  private actionUntil = 0;
  /** 缓冲住的输入：窗口没开 / 还在冷却时按键先记在这里，由 flushPendingAction 放出去。 */
  private pendingAction: ActionId | null = null;
  private pendingAt = 0;

  // ---- 跳劈：前跃 + 落点 AoE ----
  private leapUntil = 0;
  private leapVx = 0;
  private leapVy = 0;
  private leapSlam?: { mult: number; radius: number };

  // ---- 主动技：嗜血斩 / 突刺 ----
  private bloodReadyAt = 0;
  private thrustReadyAt = 0;
  private dashHitSet: Set<Enemy> = new Set();
  private thrustHitCount = 0;
  /** 突刺突进截止时间：与冲刺共用位移，但走自己的高倍率结算。 */
  private thrustUntil = 0;

  // ---- 招式表现：挥剑弧 ----
  private swingAngle = 0;
  private swingUntil = 0;

  // ---- 打击感：顿帧 ----
  private hitStopUntil = 0;
  /** 顿帧起始时刻（取"上一帧真正跑过逻辑"的时间）；-1 表示当前没有在冻。 */
  private hitStopFrozenAt = -1;
  /** 上一次真正执行完一帧逻辑的时刻，用来精确计算被冻掉的时长。 */
  private lastLogicAt = 0;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW?: Phaser.Input.Keyboard.Key;
  private keyA?: Phaser.Input.Keyboard.Key;
  private keyS?: Phaser.Input.Keyboard.Key;
  private keyD?: Phaser.Input.Keyboard.Key;
  private keySpace?: Phaser.Input.Keyboard.Key;
  private keyShift?: Phaser.Input.Keyboard.Key;
  private keyJ?: Phaser.Input.Keyboard.Key;
  private keyK?: Phaser.Input.Keyboard.Key;
  private keyL?: Phaser.Input.Keyboard.Key;
  /** 右下角主动技按钮：移动端触屏入口，同时也是冷却 / 蓄力指示器。 */
  private dashButton?: Phaser.GameObjects.Arc;
  private chargeButton?: Phaser.GameObjects.Arc;
  private bloodButton?: Phaser.GameObjects.Arc;
  private thrustButton?: Phaser.GameObjects.Arc;
  private abilityGfx?: Phaser.GameObjects.Graphics;
  private abilityLabels: Phaser.GameObjects.Text[] = [];

  private joystickBase?: Phaser.GameObjects.Arc;
  private joystickThumb?: Phaser.GameObjects.Arc;
  private joystickPointerId = -1;
  private joystickDx = 0;
  private joystickDy = 0;

  constructor() {
    super('dungeon');
  }

  create(): void {
    this.meta = loadMeta();
    this.run = createRunState(this.meta);
    this.phase = 'menu';
    this.enemies = [];
    this.bullets = [];
    this.coins = [];
    this.obstacles = [];
    this.overlays = [];
    this.fireTimer = 0;
    this.playerX = ROOM_WIDTH / 2;
    this.playerY = ROOM_HEIGHT / 2;
    this.playerBaseScale = 1;
    this.bobPhase = 0;
    this.emoteState = 'normal';
    this.emoteUntil = 0;
    this.portalActive = false;
    this.joystickPointerId = -1;
    this.joystickDx = 0;
    this.joystickDy = 0;
    this.resetCombatState();

    this.createHud();
    this.setupJoystick();
    this.setupAbilityButtons();
    this.setupKeyboard();
    this.showMenu();
  }

  update(_time: number, delta: number): void {
    if (this.phase !== 'playing') {
      return;
    }
    // 顿帧：命中 / 击杀后极短暂地冻结逻辑层，让打击"有重量"。
    // 渲染、补间与粒子继续播放，所以画面不会卡住，只是伤害结算被"咬住"了一瞬。
    if (this.time.now < this.hitStopUntil) {
      if (this.hitStopFrozenAt < 0) {
        // 从"上一帧真正跑过逻辑的时间"起算，而不是当前帧：
        // 顿帧是在上一帧的伤害结算里埋下的，当前帧整帧都没跑逻辑。
        // 从当前帧起算会稳定少补一帧（约 17ms / 48 单位）。
        this.hitStopFrozenAt =
          this.lastLogicAt > 0 ? this.lastLogicAt : this.time.now;
      }
      return;
    }
    // 顿帧冻结的是逻辑层，但下面这些时间戳全部走绝对时间。不把冻住的这段补回去，
    // 就会"命中越准、突进越短"：突刺打中目标反而少走约 100 单位，够不到原本够得到的第二只怪。
    if (this.hitStopFrozenAt >= 0) {
      const frozen = Phaser.Math.Clamp(
        this.time.now - this.hitStopFrozenAt,
        0,
        HITSTOP_COMP_MAX_MS,
      );
      this.hitStopFrozenAt = -1;
      this.shiftActionTimers(frozen);
    }
    const d = Math.min(delta, 50);
    // 缓冲输入先放：它可能立刻开一个位移招，必须赶在本帧的位移结算之前。
    this.flushPendingAction();
    // 跳劈落地结算必须在位移之前：否则落地那一帧会先被输入带走。
    this.updateLeapSlam();
    this.updateMovement(d);
    this.updateDashStrike();
    this.updateAttack(d);
    this.updateBullets(d);
    this.updateEnemies(d);
    this.updateCoins(d);
    this.checkPortal();
    this.refreshHud();
    this.lastLogicAt = this.time.now;
  }

  /** 重置一局的战斗瞬时状态（速度、无敌、击退、冲刺、蓄力、顿帧）。 */
  private resetCombatState(): void {
    this.velX = 0;
    this.velY = 0;
    this.facing = 1;
    this.invulnUntil = 0;
    this.knockVx = 0;
    this.knockVy = 0;
    this.dashUntil = 0;
    this.dashReadyAt = 0;
    this.dashVx = 0;
    this.dashVy = 0;
    this.nextDashGhostAt = 0;
    this.charging = false;
    this.chargeStartAt = 0;
    this.chargeReadyAt = 0;
    this.chargeLevel = 0;
    this.recoveryUntil = 0;
    this.leapUntil = 0;
    this.leapVx = 0;
    this.leapVy = 0;
    this.leapSlam = undefined;
    this.bloodReadyAt = 0;
    this.thrustReadyAt = 0;
    this.thrustHitCount = 0;
    this.thrustUntil = 0;
    this.dashHitSet = new Set();
    this.swingUntil = 0;
    this.hitStopUntil = 0;
    this.hitStopFrozenAt = -1;
    this.lastLogicAt = 0;
    this.currentAction = 'swing';
    this.actionStartedAt = 0;
    this.actionUntil = 0;
    this.pendingAction = null;
    this.pendingAt = 0;
  }

  // ========== 连段内核：取消窗口 + 输入缓冲 ==========

  /**
   * 顿帧解冻后，把所有"绝对时间戳"一起往前推 frozen。
   *
   * 之前只补了位移四个（dash / leap / thrust / swing），漏掉 recoveryUntil 和四个冷却：
   * 每命中一次就悄悄吃掉一点后摇和冷却，一层几十次命中累计上百毫秒，
   * 表现成"连段窗口忽长忽短"。逐行列举就是漏项的来源，所以这里改成一处统一推。
   */
  private shiftActionTimers(frozen: number): void {
    this.invulnUntil += frozen;
    this.recoveryUntil += frozen;
    this.actionUntil += frozen;
    this.actionStartedAt += frozen;
    this.pendingAt += frozen;
    this.chargeStartAt += frozen;
    this.nextDashGhostAt += frozen;
    this.dashUntil += frozen;
    this.leapUntil += frozen;
    this.thrustUntil += frozen;
    this.swingUntil += frozen;
    this.dashReadyAt += frozen;
    this.bloodReadyAt += frozen;
    this.thrustReadyAt += frozen;
    this.chargeReadyAt += frozen;
  }

  /** 记下当前动作与它的起止：取消窗口的唯一时间基准。 */
  private beginAction(id: ActionId, until: number): void {
    this.currentAction = id;
    this.actionStartedAt = this.time.now;
    this.actionUntil = until;
  }

  /**
   * 现在能不能出 to 这一招？
   * - 空闲（动作已经走完）→ 能；
   * - 蓄力按住中 → 一直算"忙"（它的 actionUntil 不推进），只能被表里允许的招打断；
   * - 动作进行中 → 必须"够早了"（cancelFromMs）且取消表允许（canceledBy）。
   */
  private canCancel(to: ActionId): boolean {
    const now = this.time.now;
    if (!this.charging && now >= this.actionUntil) {
      return true;
    }
    if (to === this.currentAction) {
      return false;
    }
    const rule = CANCEL_TABLE[this.currentAction];
    if (now - this.actionStartedAt < rule.cancelFromMs) {
      return false;
    }
    if (!rule.canceledBy.includes(to)) {
      return false;
    }
    // 解锁型边：表里有，但这一局没拿到对应升级卡就不许接。
    const gate = lockedEdge(this.currentAction, to);
    return gate === undefined || this.run.unlockedCombos.includes(gate);
  }

  /**
   * 脉冲招（冲刺 / 嗜血斩 / 突刺）的统一入口：能出就出，出不了就先缓冲。
   * 之前 keydown 直接调 tryXxx，冷却没好或后摇未过的按键被静默吞掉——
   * "按早了没反应"就是这么来的，而且三招各吞一次。
   */
  private requestAction(id: ActionId): void {
    if (this.tryStartAction(id)) {
      this.pendingAction = null;
      return;
    }
    this.pendingAction = id;
    this.pendingAt = this.time.now;
  }

  /** 缓冲槽每帧试放一次；超过 INPUT_BUFFER_MS 还没放出去就丢掉（按太早，不作数）。 */
  private flushPendingAction(): void {
    const id = this.pendingAction;
    if (!id) {
      return;
    }
    if (this.time.now - this.pendingAt > INPUT_BUFFER_MS) {
      this.pendingAction = null;
      return;
    }
    if (this.tryStartAction(id)) {
      this.pendingAction = null;
    }
  }

  /** 真正出招：取消窗口 + 自身冷却都过了才成立，返回是否出招成功。 */
  private tryStartAction(id: ActionId): boolean {
    if (this.phase !== 'playing' || !this.canCancel(id)) {
      return false;
    }
    if (id === 'dash') {
      return this.startDash();
    }
    if (id === 'blood') {
      return this.startBloodSlash();
    }
    if (id === 'thrust') {
      return this.startThrust();
    }
    return false;
  }

  private setupKeyboard(): void {
    if (!this.input.keyboard) {
      return;
    }
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());
    this.keySpace = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );
    this.keyShift = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SHIFT,
    );
    this.keyJ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.keyK = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K);
    this.keyL = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
    // 三个脉冲招走 requestAction（带 150ms 缓冲）；蓄力是按住型输入，不走缓冲。
    this.keySpace.on('down', () => this.requestAction('dash'));
    this.keyShift.on('down', () => this.requestAction('dash'));
    this.keyJ.on('down', () => this.beginCharge());
    this.keyJ.on('up', () => this.releaseCharge());
    this.keyK.on('down', () => this.requestAction('blood'));
    this.keyL.on('down', () => this.requestAction('thrust'));
    // 浏览器要求音频必须由用户手势解锁：第一次按键 / 触屏时才创建 AudioContext。
    this.input.keyboard.once('keydown', () => sfx.unlock());
    this.input.once('pointerdown', () => sfx.unlock());
    this.input.keyboard.on('keydown-M', () => {
      const m = sfx.toggleMute();
      this.spawnMuteToast(m);
    });
  }

  /** 静音开关的即时反馈：不然按 M 没有任何可见结果，玩家会以为按键没生效。 */
  private spawnMuteToast(muted: boolean): void {
    const t = addGameText(
      this,
      GAME_WIDTH / 2,
      gameUnits(220),
      muted ? '音效已关闭 (M)' : '音效已开启 (M)',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(52),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(340);
    t.setStroke('#223344', gameUnits(6));
    this.tweens.add({
      targets: t,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  private setupJoystick(): void {
    if (this.joystickBase) {
      return;
    }
    const layout = createUiLayout();
    const { x, y, radius } = layout.joystick;
    this.joystickBase = this.add
      .circle(x, y, radius, 0xffffff, 0.16)
      .setDepth(300)
      .setScrollFactor(0);
    this.joystickBase.setStrokeStyle(gameUnits(8), 0xffffff, 0.5);
    this.joystickThumb = this.add
      .circle(x, y, radius * 0.4, 0xffffff, 0.6)
      .setDepth(301)
      .setScrollFactor(0);

    const grabRadius = radius * 1.4;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (
        this.joystickBase &&
        Phaser.Math.Distance.Between(
          pointer.x,
          pointer.y,
          this.joystickBase.x,
          this.joystickBase.y,
        ) <= grabRadius
      ) {
        this.joystickPointerId = pointer.id;
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId || !this.joystickBase) {
        return;
      }
      let dx = pointer.x - this.joystickBase.x;
      let dy = pointer.y - this.joystickBase.y;
      const dist = Math.hypot(dx, dy);
      const max = radius * 0.8;
      if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
      }
      this.joystickDx = max > 0 ? dx / max : 0;
      this.joystickDy = max > 0 ? dy / max : 0;
      this.joystickThumb?.setPosition(
        this.joystickBase.x + dx,
        this.joystickBase.y + dy,
      );
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId) {
        return;
      }
      this.joystickPointerId = -1;
      this.joystickDx = 0;
      this.joystickDy = 0;
      if (this.joystickBase && this.joystickThumb) {
        this.joystickThumb.setPosition(
          this.joystickBase.x,
          this.joystickBase.y,
        );
      }
    });
  }

  /**
   * 右下角两个主动技按钮，同时承担三个角色：
   * 1) 移动端触屏入口；2) 冷却 / 蓄力进度指示；3) 桌面端的功能提示。
   */
  private setupAbilityButtons(): void {
    const radius = gameUnits(104);
    const y = GAME_HEIGHT - gameUnits(330);
    // 四个技能钮按"冷却从短到长"从左到右排：冲刺 → 蓄力 → 嗜血斩 → 突刺。
    const spacing = gameUnits(296);
    const rightMost = GAME_WIDTH - gameUnits(268);
    const xs = [0, 1, 2, 3].map((i) => rightMost - spacing * (3 - i));

    const makeButton = (
      x: number,
      color: number,
    ): Phaser.GameObjects.Arc => {
      const btn = this.add
        .circle(x, y, radius, color, 0.3)
        .setDepth(300)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      btn.setStrokeStyle(gameUnits(8), 0xffffff, 0.55);
      return btn;
    };

    this.dashButton = makeButton(xs[0], 0x4c8bf5);
    this.dashButton.on('pointerdown', () => this.requestAction('dash'));

    this.chargeButton = makeButton(xs[1], 0xff8f5c);
    this.chargeButton.on('pointerdown', () => this.beginCharge());
    this.chargeButton.on('pointerup', () => this.releaseCharge());
    this.chargeButton.on('pointerout', () => this.releaseCharge());

    this.bloodButton = makeButton(xs[2], 0xff5f7a);
    this.bloodButton.on('pointerdown', () => this.requestAction('blood'));

    this.thrustButton = makeButton(xs[3], 0xff5f2e);
    this.thrustButton.on('pointerdown', () => this.requestAction('thrust'));

    this.abilityGfx = this.add.graphics().setDepth(302).setScrollFactor(0);

    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(88),
      fontStyle: 'bold',
    };
    const icons = ['⚡', '💥', '🩸', '🗡'];
    xs.forEach((x, index) => {
      const t = addGameText(this, x, y, icons[index] ?? '?', labelStyle)
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(303);
      t.setStroke('#223344', gameUnits(6));
      this.abilityLabels.push(t);
    });

    // 每个按钮下方挂两行小字：招式名（玩家真正要记的）+ 键位/操作。
    // 早先是"一行键位 + 底部一条横贯全屏的说明"，两行只差 52 个设计单位，
    // 字互相压边，而且"冲刺 = 冲撞斩"等于把同一个招式说两遍。
    const moveNames = ['冲撞斩', '蓄力斩', '嗜血斩', '突刺'];
    const keyHints = ['空格', 'J 长按 · 三级', 'K', 'L'];
    xs.forEach((x, index) => {
      const name = addGameText(
        this,
        x,
        y + gameUnits(150),
        moveNames[index] ?? '',
        {
          color: '#ffffff',
          fontFamily: FONT_FAMILY,
          fontSize: gamePixels(42),
          fontStyle: 'bold',
        },
      )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(303);
      name.setStroke('#223344', gameUnits(6));
      this.abilityLabels.push(name);

      const key = addGameText(
        this,
        x,
        y + gameUnits(208),
        keyHints[index] ?? '',
        {
          color: '#dbe3ef',
          fontFamily: FONT_FAMILY,
          fontSize: gamePixels(32),
        },
      )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(303);
      key.setStroke('#223344', gameUnits(5));
      this.abilityLabels.push(key);
    });
  }

  /** 绘制主动技按钮的冷却 / 蓄力扇形填充。 */
  /**
   * 四个技能钮的冷却 / 蓄力指示。
   * 蓄力钮额外画两道刻度线，把"三级"这件事变成看得见的进度，
   * 而不是让玩家靠数秒去猜。
   */
  private renderAbilityGfx(): void {
    const g = this.abilityGfx;
    if (!g || !this.dashButton || !this.chargeButton) {
      return;
    }
    const now = this.time.now;
    g.clear();

    /** 从 12 点方向顺时针填充，amount = 0..1。 */
    const fillRing = (
      btn: Phaser.GameObjects.Arc,
      amount: number,
      color: number,
      alpha: number,
    ): void => {
      if (amount <= 0) {
        return;
      }
      g.fillStyle(color, alpha);
      g.slice(
        btn.x,
        btn.y,
        btn.radius,
        Phaser.Math.DegToRad(-90),
        Phaser.Math.DegToRad(-90 + 360 * Phaser.Math.Clamp(amount, 0, 1)),
        false,
      );
      g.fillPath();
    };

    fillRing(
      this.dashButton,
      1 - (this.dashReadyAt - now) / DASH_COOLDOWN_MS,
      0x9fd8ff,
      0.42,
    );
    if (this.bloodButton) {
      fillRing(
        this.bloodButton,
        1 - (this.bloodReadyAt - now) / BLOOD_CD_MS,
        0xff8fa3,
        0.42,
      );
    }
    if (this.thrustButton) {
      fillRing(
        this.thrustButton,
        1 - (this.thrustReadyAt - now) / THRUST_CD_MS,
        0xffa06b,
        0.42,
      );
    }

    // 蓄力钮：进度以 Lv3 为满格，两道刻度标出 Lv1 / Lv2 的门槛。
    if (this.charging) {
      const held = now - this.chargeStartAt;
      const progress = Phaser.Math.Clamp(held / CHARGE_L3_MS, 0, 1);
      const level = held >= CHARGE_L3_MS ? 3 : held >= CHARGE_L2_MS ? 2 : held >= CHARGE_L1_MS ? 1 : 0;
      // 跨过一档就"叮"一声：闭着眼也能数出自己蓄到了第几级。
      if (level > this.chargeLevel) {
        sfx.chargeStep(level);
      }
      this.chargeLevel = level;
      const color = level >= 3 ? 0xff5f2e : level === 2 ? 0xffd166 : 0xffffff;
      fillRing(this.chargeButton, progress, color, 0.6);

      const r = this.chargeButton.radius;
      for (const threshold of [CHARGE_L1_MS / CHARGE_L3_MS, CHARGE_L2_MS / CHARGE_L3_MS]) {
        const a = Phaser.Math.DegToRad(-90 + 360 * threshold);
        g.lineStyle(gameUnits(7), 0x223344, 0.85);
        g.beginPath();
        g.moveTo(
          this.chargeButton.x + Math.cos(a) * r * 0.72,
          this.chargeButton.y + Math.sin(a) * r * 0.72,
        );
        g.lineTo(
          this.chargeButton.x + Math.cos(a) * r,
          this.chargeButton.y + Math.sin(a) * r,
        );
        g.strokePath();
      }
    } else {
      this.chargeLevel = 0;
    }
  }

  /**
   * 冲刺 / 翻滚：短距离位移 + 冲刺无敌 + 冷却。
   *
   * 它同时是连段里的"通用取消"：能打断蓄力（按住时唯一出路）和跳劈，
   * 也顺手掐掉正在飞的突刺。取消蓄力要付冷却代价，否则就成了没有成本的循环。
   */
  private startDash(): boolean {
    const now = this.time.now;
    if (now < this.dashReadyAt) {
      return false;
    }
    const input = this.readMoveInput();
    let dx = input.dx;
    let dy = input.dy;
    let len = Math.hypot(dx, dy);
    if (len < 0.001) {
      dx = this.facing;
      dy = 0;
      len = 1;
    }
    const speed = DASH_SPEED * GAME_SCALE;
    this.dashVx = (dx / len) * speed;
    this.dashVy = (dy / len) * speed;
    this.dashUntil = now + DASH_DURATION_MS;
    this.dashReadyAt = now + DASH_COOLDOWN_MS;
    // 冲刺全程无敌，收招后再多给一点容错。
    this.invulnUntil = Math.max(this.invulnUntil, now + DASH_DURATION_MS + 90);
    // 保留惯性：冲刺结束会自然减速，而不是"啪"一下停住。
    this.velX = this.dashVx;
    this.velY = this.dashVy;
    this.nextDashGhostAt = 0;
    // 每次冲刺重新开一张命中表：一次冲刺里每只怪只吃一记冲撞斩。
    this.dashHitSet = new Set();
    // 取消蓄力：清掉按压状态，冷却照收（等于"自己松手打空"），不给无成本取消。
    if (this.charging) {
      this.charging = false;
      this.chargeLevel = 0;
      this.chargeReadyAt = Math.max(this.chargeReadyAt, now + CHARGE_RECOVERY_MS);
    }
    // 掐掉飞行中的突刺 / 跳劈：冲刺一旦成立，旧动作就不该再结算。
    this.thrustUntil = 0;
    this.leapUntil = 0;
    this.leapSlam = undefined;
    this.beginAction('dash', this.dashUntil);
    sfx.dash();
    this.cameras.main.shake(90, 0.0016);
    return true;
  }

  /**
   * 开始蓄力重击。
   * 按住型输入不走缓冲（"提前 150ms 记住一次按住"没有意义），所以后摇里按蓄力
   * 直接忽略而不是排队——这一档由取消表决定，与脉冲招的缓冲是两条路。
   */
  private beginCharge(): void {
    if (this.phase !== 'playing' || this.charging) {
      return;
    }
    if (this.time.now < this.chargeReadyAt) {
      return;
    }
    if (!this.canCancel('chargeHold')) {
      return;
    }
    this.charging = true;
    this.chargeStartAt = this.time.now;
    this.beginAction('chargeHold', 0);
  }

  /**
   * 松开蓄力：按住时长决定落在三级中的哪一档。
   * Lv1 快斩（快而轻）/ Lv2 横扫（大扇形 + 强击退）/ Lv3 跳劈（前跃 + 落点 AoE）。
   * 三级共用同一个后摇，所以"蓄得越久"的收益是伤害与范围，代价是蓄力期间移速腰斩。
   * 取消窗口从"松手这一帧"重算，所以三级窗口长度一致，区别只在 CANCEL_TABLE 放谁进来：
   * Lv1 能接突刺（"蓄力接突刺"），Lv2 / Lv3 只能接冲刺（蓄得越猛承诺越硬）。
   */
  private releaseCharge(): void {
    if (!this.charging) {
      return;
    }
    this.charging = false;
    this.chargeLevel = 0;
    const now = this.time.now;
    const held = now - this.chargeStartAt;
    // 误触保护：太短的一按不出招，只给一个很短的冷却，避免连点刷伤害。
    if (held < CHARGE_L1_MS) {
      sfx.chargeRelease(0);
      this.chargeReadyAt = now + 150;
      return;
    }
    sfx.chargeRelease(
      held < CHARGE_L2_MS ? 1 : held < CHARGE_L3_MS ? 2 : 3,
    );
    const angle = this.aimAngle();
    this.chargeReadyAt = now + CHARGE_RECOVERY_MS;
    this.recoveryUntil = now + CHARGE_RECOVERY_MS;

    if (held < CHARGE_L2_MS) {
      // Lv1 快斩：短、快、低倍率。canceledBy 带 thrust → "蓄力接突刺"。
      this.beginAction('charge1', this.recoveryUntil);
      this.doMeleeSwing(angle, {
        range: CHARGE_L1_RANGE,
        arcDeg: CHARGE_L1_ARC_DEG,
        mult: CHARGE_L1_MULT,
        knockback: CHARGE_L1_KNOCKBACK,
        heavy: false,
        color: 0xffffff,
      });
      return;
    }

    if (held < CHARGE_L3_MS) {
      // Lv2 横扫：200° 大扇形 + 强击退，专门把贴脸的怪扫开。
      this.beginAction('charge2', this.recoveryUntil);
      this.doMeleeSwing(angle, {
        range: CHARGE_L2_RANGE,
        arcDeg: CHARGE_L2_ARC_DEG,
        mult: CHARGE_L2_MULT,
        knockback: CHARGE_L2_KNOCKBACK,
        heavy: true,
        color: 0x9fd8ff,
      });
      return;
    }

    // Lv3 跳劈：先跃起，落地那一帧交给 updateLeapSlam() 结算落点 AoE。
    // 结束时间先按"后摇"铺，落地那一刻会被 updateLeapSlam 再往后扽一次。
    this.beginAction('charge3', this.recoveryUntil);
    const leapSpeed = CHARGE_LEAP_DISTANCE / (CHARGE_LEAP_MS / 1000);
    this.leapVx = Math.cos(angle) * leapSpeed;
    this.leapVy = Math.sin(angle) * leapSpeed;
    this.leapUntil = now + CHARGE_LEAP_MS;
    this.leapSlam = { mult: CHARGE_L3_MULT, radius: CHARGE_L3_RADIUS };
    this.dashHitSet = new Set();
    this.nextDashGhostAt = 0;
    // 起跳阶段无敌：跳到空中就不该被地面上那圈怪摸到。
    this.invulnUntil = Math.max(this.invulnUntil, now + CHARGE_LEAP_MS);
    this.fireTimer = 0;
  }

  /**
   * 读取当前移动输入：键盘为 8 向数字量，摇杆为带死区与能量曲线的模拟量。
   * 摇杆以前是 `(dx/len)` 归一化，推杆 30% 也是满速；现在死区外重新映射到 0..1 并加曲线。
   */
  private readMoveInput(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (this.cursors) {
      if (this.cursors.left.isDown || this.keyA?.isDown) {
        dx -= 1;
      }
      if (this.cursors.right.isDown || this.keyD?.isDown) {
        dx += 1;
      }
      if (this.cursors.up.isDown || this.keyW?.isDown) {
        dy -= 1;
      }
      if (this.cursors.down.isDown || this.keyS?.isDown) {
        dy += 1;
      }
    }
    if (this.joystickPointerId >= 0) {
      const raw = Math.hypot(this.joystickDx, this.joystickDy);
      if (raw > JOYSTICK_DEADZONE) {
        const mag = Math.min(
          1,
          (raw - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE),
        );
        const curved = mag ** 1.35;
        dx += (this.joystickDx / raw) * curved;
        dy += (this.joystickDy / raw) * curved;
      }
    }
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      return { dx: dx / len, dy: dy / len };
    }
    return { dx, dy };
  }

  /** 冲刺残影：一张渐隐、略微缩小的骑士贴图。 */
  private spawnDashGhost(): void {
    const size = charTexSize(BASE_PLAYER.radius);
    const ghost = this.add
      .image(
        this.playerX,
        this.playerY - charFootLift(BASE_PLAYER.radius, 'player'),
        PLAYER_TEX_KEY,
      )
      .setDisplaySize(size, size)
      .setFlipX(this.facing < 0)
      .setTint(0x8fd0ff)
      .setAlpha(0.5)
      .setDepth(18);
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      scaleX: ghost.scaleX * 0.86,
      scaleY: ghost.scaleY * 0.86,
      duration: 240,
      ease: 'Cubic.out',
      onComplete: () => ghost.destroy(),
    });
  }

  private updateMovement(delta: number): void {
    const step = delta / 1000;
    const now = this.time.now;
    const input = this.readMoveInput();
    const inputLen = Math.hypot(input.dx, input.dy);
    // 跳劈前跃期间接管位移：空中不响应摇杆，落地才交还控制权。
    const leaping = now < this.leapUntil;
    const dashing = !leaping && now < this.dashUntil;

    let moveX = 0;
    let moveY = 0;

    if (leaping) {
      moveX = this.leapVx * step;
      moveY = this.leapVy * step;
      if (now >= this.nextDashGhostAt) {
        this.nextDashGhostAt = now + DASH_GHOST_INTERVAL_MS;
        this.spawnDashGhost();
      }
    } else if (dashing) {
      // 冲刺期间忽略常规移动，按固定冲量位移。
      moveX = this.dashVx * step;
      moveY = this.dashVy * step;
      if (now >= this.nextDashGhostAt) {
        this.nextDashGhostAt = now + DASH_GHOST_INTERVAL_MS;
        this.spawnDashGhost();
      }
    } else {
      // 把"按下即满速"改成速度插值：起步有加速、松手有短暂滑行，走位才不会一顿一顿。
      // 蓄力期间移速打折：这是"三级越猛越危险"的代价来源。
      const chargeSlow = this.charging ? CHARGE_MOVE_SLOW : 1;
      const baseSpeed = this.run.speed * GAME_SCALE * chargeSlow;
      const rate = inputLen > 0.001 ? 20 : 15;
      const blend = 1 - Math.exp(-rate * step);
      this.velX += (input.dx * baseSpeed - this.velX) * blend;
      this.velY += (input.dy * baseSpeed - this.velY) * blend;
      if (Math.abs(this.velX) < 1) {
        this.velX = 0;
      }
      if (Math.abs(this.velY) < 1) {
        this.velY = 0;
      }
      moveX = this.velX * step;
      moveY = this.velY * step;
    }

    // 受击击退叠加在位移之上，并随时间指数衰减。
    moveX += this.knockVx * step;
    moveY += this.knockVy * step;
    const knockDamp = Math.exp(-KNOCK_DAMP * step);
    this.knockVx *= knockDamp;
    this.knockVy *= knockDamp;

    const prevX = this.playerX;
    const prevY = this.playerY;
    const moved = pushOutOfObstacles(
      clampInsideWalls(prevX + moveX, BASE_PLAYER.radius, ROOM_WIDTH),
      clampInsideWalls(prevY + moveY, BASE_PLAYER.radius, ROOM_HEIGHT),
      BASE_PLAYER.radius,
      this.obstacles,
    );
    // 撞墙 / 撞箱子后立刻吃掉该轴速度，避免贴墙时速度继续累积成"弹射"。
    if (moveX !== 0 && Math.abs(moved.x - (prevX + moveX)) > 0.5) {
      this.velX = 0;
      this.knockVx = 0;
    }
    if (moveY !== 0 && Math.abs(moved.y - (prevY + moveY)) > 0.5) {
      this.velY = 0;
      this.knockVy = 0;
    }
    this.playerX = moved.x;
    this.playerY = moved.y;

    const speed = leaping
      ? Math.hypot(this.leapVx, this.leapVy)
      : dashing
        ? Math.hypot(this.dashVx, this.dashVy)
        : Math.hypot(this.velX, this.velY);
    const moving = speed > 6;
    if (leaping) {
      if (Math.abs(this.leapVx) > 12) {
        this.facing = this.leapVx < 0 ? -1 : 1;
      }
    } else if (Math.abs(this.velX) > 12) {
      this.facing = this.velX < 0 ? -1 : 1;
    } else if (dashing && Math.abs(this.dashVx) > 12) {
      this.facing = this.dashVx < 0 ? -1 : 1;
    }
    this.playerSprite?.setFlipX(this.facing < 0);

    // 走路弹跳 + 身体 squash & stretch（相对基准 scale）
    this.bobPhase += delta * (moving ? 0.014 : 0.004);
    const squash = Math.abs(Math.sin(this.bobPhase));
    const bob = squash * gameUnits(14);
    const onPlatform = isOnPlatform(this.playerX, this.playerY);
    const lift = onPlatform ? gameUnits(44) : 0;
    // 跳劈的前跃走一条抛物线：起跳到落地先升后降，落地瞬间最矮。
    let leapLift = 0;
    if (leaping) {
      const t = Phaser.Math.Clamp(
        1 - (this.leapUntil - now) / CHARGE_LEAP_MS,
        0,
        1,
      );
      leapLift = Math.sin(Math.PI * t) * gameUnits(200);
    }
    this.playerSprite?.setY(-bob - lift - leapLift);
    if (moving) {
      const base = this.playerBaseScale;
      this.playerSprite?.setScale(
        base * (1 + squash * 0.08),
        base * (1 - squash * 0.1),
      );
    } else {
      this.playerSprite?.setScale(this.playerBaseScale);
    }

    // 无敌闪烁：受击后与冲刺期间半透明闪烁，"现在打不到我"一眼可见。
    if (this.playerSprite?.active) {
      const invuln = now < this.invulnUntil;
      const blink = invuln && Math.floor(now / 70) % 2 === 0;
      this.playerSprite.setAlpha(blink ? 0.35 : 1);
    }

    // 投影跟随 + 平台反馈（站上台阶/柜子时投影变淡变大）
    if (this.playerShadow) {
      // 投影画在"脚底"（判定圆心）上，而不是再往下偏移：
      // 影子是玩家判断自己站在哪的唯一线索，它必须落在碰撞点上。
      this.playerShadow.setPosition(this.playerX, this.playerY);
      this.playerShadow.setAlpha(onPlatform ? 0.5 : 0.28);
      this.playerShadow.setScale(onPlatform ? 1.25 : 1);
    }

    // 角色表情：站上平台开心，临时表情过期后恢复
    if (onPlatform && this.emoteState === 'normal') {
      this.emoteState = 'happy';
    } else if (!onPlatform && this.emoteState === 'happy') {
      this.emoteState = 'normal';
    }
    if (
      this.time.now >= this.emoteUntil &&
      (this.emoteState === 'attack' || this.emoteState === 'hurt')
    ) {
      this.emoteState = onPlatform ? 'happy' : 'normal';
    }
    this.drawPlayerEmote();
    this.player?.setPosition(
      this.playerX,
      this.playerY - charFootLift(BASE_PLAYER.radius, 'player'),
    );
  }

  // ========== 角色表情 ==========
  private drawPlayerEmote(): void {
    const g = this.playerEmote;
    if (!g || !this.playerSprite) {
      return;
    }
    g.clear();
    // 角色贴图放大 2 倍，表情按同一系数等比放大
    const k = 2;
    const eyeY = -gameUnits(14) * k;
    const eyeDx = gameUnits(30) * k;
    const eyeR = gameUnits(11) * k;
    const stroke = gameUnits(6) * k;
    if (this.emoteState === 'hurt') {
      // 受伤：× 眼睛 + 撇嘴
      g.lineStyle(stroke, 0xffffff, 1);
      g.lineBetween(-eyeDx - eyeR, eyeY - eyeR, -eyeDx + eyeR, eyeY + eyeR);
      g.lineBetween(-eyeDx - eyeR, eyeY + eyeR, -eyeDx + eyeR, eyeY - eyeR);
      g.lineBetween(eyeDx - eyeR, eyeY - eyeR, eyeDx + eyeR, eyeY + eyeR);
      g.lineBetween(eyeDx - eyeR, eyeY + eyeR, eyeDx + eyeR, eyeY - eyeR);
      g.lineStyle(stroke, 0xffffff, 0.9);
      g.beginPath();
      g.arc(0, gameUnits(40) * k, gameUnits(12) * k, Math.PI * 0.25, Math.PI * 0.75);
      g.strokePath();
    } else if (this.emoteState === 'attack') {
      // 攻击：瞪眼 + 皱眉 + 张嘴
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-eyeDx, eyeY, eyeR);
      g.fillCircle(eyeDx, eyeY, eyeR);
      g.lineStyle(stroke, 0x2f3a4a, 1);
      g.lineBetween(
        -eyeDx - eyeR * 1.4,
        eyeY - eyeR * 1.6,
        -eyeDx + eyeR * 1.4,
        eyeY - eyeR * 0.6,
      );
      g.lineBetween(
        eyeDx - eyeR * 1.4,
        eyeY - eyeR * 0.6,
        eyeDx + eyeR * 1.4,
        eyeY - eyeR * 1.6,
      );
      g.fillStyle(0xffd166, 1);
      g.fillCircle(0, gameUnits(26) * k, gameUnits(12) * k);
    } else if (this.emoteState === 'happy') {
      // 开心：弯弯笑眼 + 微笑
      g.lineStyle(stroke, 0xffffff, 1);
      g.beginPath();
      g.arc(-eyeDx, eyeY + eyeR * 0.6, eyeR, Math.PI * 1.1, Math.PI * 1.9);
      g.strokePath();
      g.beginPath();
      g.arc(eyeDx, eyeY + eyeR * 0.6, eyeR, Math.PI * 1.1, Math.PI * 1.9);
      g.strokePath();
      g.beginPath();
      g.arc(0, gameUnits(30) * k, gameUnits(12) * k, Math.PI * 1.25, Math.PI * 1.75);
      g.strokePath();
    } else {
      // 平静：圆点眼睛 + 微笑
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-eyeDx, eyeY, eyeR);
      g.fillCircle(eyeDx, eyeY, eyeR);
      g.lineStyle(stroke, 0xffffff, 0.9);
      g.beginPath();
      g.arc(0, gameUnits(30) * k, gameUnits(12) * k, Math.PI * 1.25, Math.PI * 1.75);
      g.strokePath();
    }
  }

  /** 选射程内、且没有被障碍物挡住的最近敌人。 */
  private pickTarget(reach = BASE_PLAYER.attackRange): Enemy | undefined {
    let target: Enemy | undefined;
    let best = reach;
    for (const e of this.enemies) {
      // 算"到体积边缘"的距离，而不是到中心：Boss 半径 120，
      // 按中心算会白白少算一个身位，贴脸时反而选不中它。
      const d =
        Math.hypot(this.playerX - e.sprite.x, this.playerY - e.groundY) -
        e.radius;
      if (d > best) {
        continue;
      }
      if (
        !this.hasLineOfSight(this.playerX, this.playerY, e.sprite.x, e.groundY)
      ) {
        continue;
      }
      best = d;
      target = e;
    }
    return target;
  }

  /** 两点之间是否没有障碍物遮挡（自动索敌不该隔着箱子倾泻火力）。 */
  private hasLineOfSight(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) {
      return true;
    }
    for (const ob of this.obstacles) {
      const t = Phaser.Math.Clamp(
        ((ob.x - x1) * dx + (ob.y - y1) * dy) / len2,
        0,
        1,
      );
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      if (Math.hypot(ob.x - px, ob.y - py) < ob.r + BASE_PLAYER.bulletRadius) {
        return false;
      }
    }
    return true;
  }

  /**
   * 普攻·挥剑：自动朝最近敌人出一刀（扇形判定）。
   * 近战化之后不再有弹道，判定范围只有 SWING_RANGE，所以"站得远就安全"
   * 这条老规则失效了——想输出就必须进怪堆，这正是吸血与冲刺存在的理由。
   */
  private updateAttack(delta: number): void {
    if (this.charging) {
      // 蓄力期间收剑：让"蓄力"这个承诺有明确的代价。
      return;
    }
    if (this.time.now < this.recoveryUntil) {
      // 收招后摇：跳劈 / 大招落地后的硬直。
      return;
    }
    this.fireTimer += delta;
    if (this.fireTimer < this.run.fireRateMs) {
      return;
    }
    // 判定只有 SWING_RANGE，却按 600 的索敌距离出刀，就会朝远处的怪空挥一刀，
    // 玩家只会觉得"我这刀怎么没伤害"。fireTimer 不停表，怪一进刀围立刻出刀，
    // 所以不会因为"没挥空"而变慢。
    const target = this.pickTarget(SWING_RANGE);
    if (!target) {
      return;
    }
    this.fireTimer = 0;
    const angle = Math.atan2(
      target.groundY - this.playerY,
      target.sprite.x - this.playerX,
    );
    this.doMeleeSwing(angle, {
      range: SWING_RANGE,
      arcDeg: SWING_ARC_DEG,
      // "三连斩"强化：一刀之后再追加两刀（错开 90ms）。
      extraSwings: Math.min(2, this.run.extraShots),
      mult: 1,
      knockback: SWING_KNOCKBACK,
      heavy: false,
      color: 0xffffff,
    });
  }

  // ============================================================
  // 近战判定层（P1）：扇形 / 圆形 AoE / 突进路径 三种判定，
  // 全部走 damageEnemy() 统一结算伤害、击退、顿帧、震屏与飘字。
  // ============================================================

  /** 面向角：有锁定目标就朝目标，否则朝面朝方向。 */
  private aimAngle(): number {
    const target = this.pickTarget();
    if (target) {
      return Math.atan2(
        target.groundY - this.playerY,
        target.sprite.x - this.playerX,
      );
    }
    return this.facing > 0 ? 0 : Math.PI;
  }

  /**
   * 统一伤害结算：命中判定之外的"手感"全部集中在这里。
   * 普攻、冲刺斩、三级蓄力、嗜血斩、突刺、剑气弹道都复用它，
   * 避免每加一个招式就复制一份顿帧 / 震屏 / 飘字逻辑。
   */
  private damageEnemy(
    e: Enemy,
    damage: number,
    knockback: number,
    heavy: boolean,
    dirAngle: number,
  ): void {
    if (!e.sprite.active) {
      return;
    }
    e.hp -= damage;
    if (knockback > 0) {
      e.kbX += Math.cos(dirAngle) * knockback * GAME_SCALE;
      e.kbY += Math.sin(dirAngle) * knockback * GAME_SCALE;
    }
    const now = this.time.now;
    if (e.hp <= 0) {
      sfx.kill();
      this.run.kills += 1;
      this.killEnemy(e);
      this.hitStopUntil = Math.max(this.hitStopUntil, now + HITSTOP_KILL_MS);
      this.cameras.main.shake(120, heavy ? SHAKE_KILL * 2 : SHAKE_KILL);
      return;
    }
    sfx.hit(heavy);
    const hx = e.sprite.x;
    const hy = e.groundY;
    this.spawnHitSpark(hx, hy, heavy);
    this.spawnDamageText(hx, hy, damage, heavy);
    this.hitStopUntil = Math.max(
      this.hitStopUntil,
      now + (heavy ? HITSTOP_KILL_MS : HITSTOP_HIT_MS),
    );
    this.cameras.main.shake(70, heavy ? SHAKE_HIT * 2 : SHAKE_HIT);
    e.sprite.setTint(0xffffff);
    const flashMs = heavy ? 130 : 80;
    this.time.delayedCall(flashMs, () => {
      if (e.sprite.active && !e.telegraphing) {
        e.sprite.setTint(ENEMY_TINTS[e.kind]);
      }
    });
  }

  /**
   * 扇形判定：以玩家为圆心、angle 为中轴、arcDeg 为张角。
   * 半径判定用 "range + 敌人半径"，避免体积大的怪明明贴脸却打不到。
   */
  private damageSector(
    angle: number,
    arcDeg: number,
    range: number,
    damage: number,
    knockback: number,
    heavy: boolean,
  ): number {
    const half = Phaser.Math.DegToRad(arcDeg / 2);
    let hits = 0;
    for (const e of [...this.enemies]) {
      const dx = e.sprite.x - this.playerX;
      const dy = e.groundY - this.playerY;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.radius) {
        continue;
      }
      const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - angle));
      if (diff > half) {
        continue;
      }
      this.damageEnemy(e, damage, knockback, heavy, Math.atan2(dy, dx));
      hits += 1;
    }
    return hits;
  }

  /**
   * 普攻 / 蓄力共用的"挥一刀"：走判定 + 出刀光 + 连斩追加 + 剑气。
   * 每次挥砍都会推进 swingUntil，供表现层做角色前倾。
   */
  private doMeleeSwing(
    angle: number,
    opts: {
      range: number;
      arcDeg: number;
      mult: number;
      knockback: number;
      heavy: boolean;
      color: number;
      /** 连斩追加次数（三连斩技能）。 */
      extraSwings?: number;
    },
  ): number {
    const now = this.time.now;
    this.swingAngle = angle;
    this.swingUntil = now + 170;
    this.emoteState = 'attack';
    this.emoteUntil = now + 260;

    const damage = Math.round(this.run.attack * opts.mult);
    sfx.swing(opts.heavy);
    this.spawnSlashArc(angle, opts.arcDeg, opts.range, opts.color, opts.heavy);
    const hits = this.damageSector(
      angle,
      opts.arcDeg,
      opts.range,
      damage,
      opts.knockback,
      opts.heavy,
    );

    // 剑气：拿到"剑气"强化后，每一刀都会额外甩出一道短距弹道补刀。
    if (this.run.pierce > 0) {
      this.spawnBullet(angle);
    }

    // 三连斩：追加的斩击错开 ~90ms，读起来是"连斩"而不是同一帧的多段伤害。
    const extra = opts.extraSwings ?? 0;
    for (let i = 1; i <= extra; i += 1) {
      this.time.delayedCall(90 * i, () => {
        if (this.phase !== 'playing') {
          return;
        }
        sfx.swing(false);
        this.spawnSlashArc(
          this.swingAngle,
          opts.arcDeg,
          opts.range,
          opts.color,
          false,
        );
        this.damageSector(
          this.swingAngle,
          opts.arcDeg,
          opts.range,
          Math.round(damage * 0.7),
          opts.knockback * 0.6,
          false,
        );
      });
    }
    return hits;
  }

  /**
   * 刀光弧：四层描边的圆弧（暗底 / 外发光 / 亮芯 / 刀锋），替"逐帧挥剑"表达动作。
   *
   * 两个刻意的取舍，都是为了让刀光"真的看得见"：
   * 1) 暗底描边：普攻是白色、横扫是冰蓝，都是浅色，压在同样浅的暖色石地板上
   *    几乎没有明度差，只靠色相是读不出来的，所以先用一层暗色把刀光抠出来。
   * 2) alpha 走 ease-in（先亮住、后段才快速收掉）：原来用的是 ease-out，
   *    刀光在 100ms 内就掉到 0.3 以下，远短于一次挥砍的动作时长，
   *    结果玩家只能靠飘字知道"我砍到了"，刀光本身反而看不见。
   */
  private spawnSlashArc(
    angle: number,
    arcDeg: number,
    range: number,
    color: number,
    heavy: boolean,
  ): void {
    // 刀光半径必须就是"判定半径"本身。命中条件是"敌人的躯体（半径 e.radius）
    // 碰到这个圆"，所以弧线画在 range 上，玩家看到刀刃扫到谁、就是打到了谁。
    const r = range;
    const half = Phaser.Math.DegToRad(arcDeg / 2);
    const core = gameUnits(heavy ? 26 : 16);
    const x = this.playerX;
    const y = this.playerY - charFootLift(BASE_PLAYER.radius, 'player');
    const life = heavy ? 300 : 220;
    const arc = (
      g: Phaser.GameObjects.Graphics,
      width: number,
      tint: number,
      alpha: number,
    ): void => {
      g.lineStyle(width, tint, alpha);
      g.beginPath();
      g.arc(0, 0, r, angle - half, angle + half, false);
      g.strokePath();
    };

    // 1) 暗底走普通混合：压在浅色石地板上要有对比，刀锋才看得出边界。
    //    暗色不能放进加色混合——ADD 下黑色等于没画。
    const base = this.add.graphics().setDepth(16);
    arc(base, core + gameUnits(heavy ? 30 : 18), 0x14202c, heavy ? 0.45 : 0.32);
    base.setPosition(x, y);

    // 2) 辉光走加色混合：由外到内 6 层递减，叠出渐变衰减，
    //    而不是一圈等宽的实心描边。这是"刀光"和"画了个弧"的区别。
    const glow = this.add.graphics().setDepth(17);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    const layers = 6;
    for (let i = layers; i >= 1; i -= 1) {
      const t = i / layers;
      arc(glow, core * (1 + t * (heavy ? 2.6 : 1.8)), color, 0.08 + (1 - t) * 0.2);
    }
    arc(glow, core, color, 1);
    arc(glow, gameUnits(heavy ? 10 : 7), 0xffffff, heavy ? 0.95 : 0.8);
    glow.setPosition(x, y);

    for (const g of [base, glow]) {
      this.tweens.add({
        targets: g,
        scaleX: 1.07,
        scaleY: 1.07,
        duration: life,
        ease: 'Cubic.out',
      });
    }
    this.tweens.add({
      targets: glow,
      alpha: 0,
      duration: life,
      ease: 'Cubic.in',
      onComplete: () => glow.destroy(),
    });
    // 暗底先退：它的作用是给出边界，边界建立之后就该让位给辉光。
    this.tweens.add({
      targets: base,
      alpha: 0,
      duration: life * 0.7,
      ease: 'Cubic.in',
      onComplete: () => base.destroy(),
    });
  }

  /** 落地冲击环：跳劈落点的圆形 AoE 读点。 */
  private spawnShockwave(
    x: number,
    y: number,
    radius: number,
    color: number,
  ): void {
    // 暗底走普通混合，保证压在暖色地板上还有轮廓。
    const base = this.add.graphics().setDepth(17);
    base.lineStyle(gameUnits(30), 0x14202c, 0.4);
    base.strokeCircle(0, 0, radius);
    base.setPosition(x, y);
    base.setScale(0.25);
    this.tweens.add({
      targets: base,
      scale: 1,
      duration: 260,
      ease: 'Cubic.out',
    });
    this.tweens.add({
      targets: base,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.in',
      onComplete: () => base.destroy(),
    });

    // 双环：细的领先、冲得快、先消失；粗的拖后、走得慢、留得久。
    // 两环速度错开，"冲击"才有先后层次，而不是整张贴图一起放大。
    const lead = this.add.graphics().setDepth(18);
    lead.setBlendMode(Phaser.BlendModes.ADD);
    lead.lineStyle(gameUnits(16), color, 0.55);
    lead.strokeCircle(0, 0, radius);
    lead.lineStyle(gameUnits(9), 0xffffff, 0.95);
    lead.strokeCircle(0, 0, radius);
    lead.setPosition(x, y);
    lead.setScale(0.2);
    this.tweens.add({
      targets: lead,
      scale: 1.14,
      duration: 200,
      ease: 'Cubic.out',
    });
    this.tweens.add({
      targets: lead,
      alpha: 0,
      duration: 230,
      ease: 'Cubic.in',
      onComplete: () => lead.destroy(),
    });

    const tail = this.add.graphics().setDepth(18);
    tail.setBlendMode(Phaser.BlendModes.ADD);
    tail.lineStyle(gameUnits(36), color, 0.6);
    tail.strokeCircle(0, 0, radius);
    tail.setPosition(x, y);
    tail.setScale(0.15);
    this.tweens.add({
      targets: tail,
      scale: 1,
      duration: 360,
      ease: 'Quad.out',
    });
    this.tweens.add({
      targets: tail,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.in',
      onComplete: () => tail.destroy(),
    });

    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const p = this.add.circle(x, y, gameUnits(12), color).setDepth(17);
      p.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * radius * 1.1,
        y: y + Math.sin(a) * radius * 0.5,
        alpha: 0,
        duration: 320,
        ease: 'Cubic.out',
        onComplete: () => p.destroy(),
      });
    }
  }

  /** 冲刺·冲撞斩：突进过程中贴身撞到的敌人各结算一次（每次冲刺每人只吃一下）。 */
  private updateDashStrike(): void {
    if (this.phase !== 'playing' || this.time.now >= this.dashUntil) {
      return;
    }
    if (this.thrustHitCount >= 0 && this.time.now < this.thrustUntil) {
      // 突刺有自己的高倍率结算，不叠加冲刺斩。
      this.updateThrustStrike();
      return;
    }
    const reach = BASE_PLAYER.radius + DASH_STRIKE_REACH;
    for (const e of [...this.enemies]) {
      if (this.dashHitSet.has(e)) {
        continue;
      }
      const d = Math.hypot(e.sprite.x - this.playerX, e.groundY - this.playerY);
      if (d > reach + e.radius) {
        continue;
      }
      this.dashHitSet.add(e);
      const ang = Math.atan2(
        e.groundY - this.playerY,
        e.sprite.x - this.playerX,
      );
      this.damageEnemy(
        e,
        Math.round(this.run.attack * DASH_STRIKE_DAMAGE_MULT),
        DASH_STRIKE_KNOCKBACK,
        true,
        ang,
      );
    }
  }

  /** 跳劈落地：前跃结束的那一帧在落点结算圆形 AoE。 */
  private updateLeapSlam(): void {
    const slam = this.leapSlam;
    if (!slam || this.time.now < this.leapUntil) {
      return;
    }
    this.leapSlam = undefined;
    const now = this.time.now;
    const r = slam.radius;
    this.spawnShockwave(
      this.playerX,
      this.playerY - charFootLift(BASE_PLAYER.radius, 'player'),
      r,
      0xffd166,
    );
    const damage = Math.round(this.run.attack * slam.mult);
    let hits = 0;
    for (const e of [...this.enemies]) {
      const dx = e.sprite.x - this.playerX;
      const dy = e.groundY - this.playerY;
      if (Math.hypot(dx, dy) > r + e.radius) {
        continue;
      }
      this.damageEnemy(e, damage, 620, true, Math.atan2(dy, dx));
      hits += 1;
    }
    this.hitStopUntil = Math.max(
      this.hitStopUntil,
      now + (hits > 0 ? HITSTOP_KILL_MS : HITSTOP_HIT_MS),
    );
    this.cameras.main.shake(220, SHAKE_KILL * 1.7);
    this.chargeReadyAt = now + CHARGE_RECOVERY_MS;
    this.recoveryUntil = now + CHARGE_RECOVERY_MS;
    // 落地这一下把"跳劈"的承诺再往后扽：起跳时铺的结束时间已经不作数了。
    this.actionUntil = this.recoveryUntil;
  }

  /** K · 嗜血斩：扇形伤害并把命中数换成回血（单次有上限）。 */
  private startBloodSlash(): boolean {
    const now = this.time.now;
    if (now < this.bloodReadyAt) {
      return false;
    }
    this.bloodReadyAt = now + BLOOD_CD_MS;
    sfx.blood();
    const hits = this.doMeleeSwing(this.aimAngle(), {
      range: BLOOD_RANGE,
      arcDeg: BLOOD_ARC_DEG,
      mult: BLOOD_MULT,
      knockback: 320,
      heavy: true,
      color: 0xff5f7a,
    });
    // 承诺长度跟随刀光：doMeleeSwing 已经把 swingUntil 推到 now + 170。
    this.beginAction('blood', this.swingUntil);
    if (hits > 0) {
      const heal = Math.min(BLOOD_HEAL_MAX, hits * BLOOD_HEAL_PER_HIT);
      this.run.hp = Math.min(this.run.maxHp, this.run.hp + heal);
      sfx.heal();
      this.spawnHealText(heal);
    }
    return true;
  }

  /** 嗜血斩回血飘字：绿色 + 向上飘，和伤害飘字区分开。 */
  private spawnHealText(value: number): void {
    const t = addGameText(
      this,
      this.playerX,
      this.playerY -
        charFootLift(BASE_PLAYER.radius, 'player') -
        gameUnits(120),
      '+' + String(value),
      {
        color: '#6fce5b',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(58),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(19);
    t.setStroke('#1d3320', gameUnits(6));
    this.tweens.add({
      targets: t,
      y: t.y - gameUnits(90),
      alpha: 0,
      duration: 620,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  /**
   * L · 突刺：朝锁定目标长距突进，路径上最多命中 2 个敌人（穿透 1），
   * 单体高倍率，专门用来点掉精英 / Boss。突进期间短暂无敌。
   */
  private startThrust(): boolean {
    const now = this.time.now;
    if (now < this.thrustReadyAt) {
      return false;
    }
    this.thrustReadyAt = now + THRUST_CD_MS;
    const angle = this.aimAngle();
    const speed = THRUST_DISTANCE / (THRUST_MS / 1000);
    this.dashVx = Math.cos(angle) * speed;
    this.dashVy = Math.sin(angle) * speed;
    this.dashUntil = now + THRUST_MS;
    this.thrustUntil = now + THRUST_MS;
    this.nextDashGhostAt = 0;
    this.dashHitSet = new Set();
    this.thrustHitCount = 0;
    // 突进中无敌：突刺是"穿过怪堆去点杀"，不是去送死。
    this.invulnUntil = Math.max(
      this.invulnUntil,
      now + THRUST_MS + THRUST_INVULN_MS,
    );
    this.facing = Math.cos(angle) < 0 ? -1 : 1;
    sfx.thrust();
    // 复用刀光表现，但换成细长的红色剑气。
    this.swingAngle = angle;
    this.swingUntil = now + THRUST_MS;
    this.spawnSlashArc(angle, 40, THRUST_DISTANCE, 0xff5f2e, true);
    this.cameras.main.shake(120, SHAKE_KILL);
    this.beginAction('thrust', this.thrustUntil);
    return true;
  }

  /** 突刺命中：沿路径结算高倍率单体伤害，最多打 2 个。 */
  private updateThrustStrike(): void {
    if (this.thrustHitCount >= 2) {
      return;
    }
    for (const e of [...this.enemies]) {
      if (this.dashHitSet.has(e) || this.thrustHitCount >= 2) {
        continue;
      }
      const d = Math.hypot(e.sprite.x - this.playerX, e.groundY - this.playerY);
      if (d > BASE_PLAYER.radius + THRUST_REACH + e.radius) {
        continue;
      }
      this.dashHitSet.add(e);
      this.thrustHitCount += 1;
      const ang = Math.atan2(
        e.groundY - this.playerY,
        e.sprite.x - this.playerX,
      );
      this.damageEnemy(
        e,
        Math.round(this.run.attack * THRUST_MULT),
        480,
        true,
        ang,
      );
    }
  }

  private spawnBullet(
    angle: number,
    options: { heavy?: boolean; damageMult?: number } = {},
  ): void {
    const heavy = options.heavy === true;
    const r = BASE_PLAYER.bulletRadius * (heavy ? HEAVY_BULLET_RADIUS_SCALE : 1);
    const speed =
      BASE_PLAYER.bulletSpeed * (heavy ? HEAVY_BULLET_SPEED_SCALE : 1);
    const spawnDist = BASE_PLAYER.radius + r + gameUnits(8);
    const x = this.playerX + Math.cos(angle) * spawnDist;
    const y = this.playerY + Math.sin(angle) * spawnDist;
    const sprite = this.add
      .circle(x, y, r, heavy ? 0xffb03a : 0xffd166)
      .setDepth(16);
    sprite.setStrokeStyle(
      gameUnits(heavy ? 10 : 4),
      heavy ? 0xff5f2e : 0xff9f43,
      1,
    );
    const trail = this.add.graphics().setDepth(15);
    this.bullets.push({
      sprite,
      trail,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: Math.round(this.run.attack * (options.damageMult ?? 1)),
      // 重击弹自带额外穿透，连续贯穿更能体现"重"。
      pierce: this.run.pierce + (heavy ? 2 : 0),
      life: heavy ? 1.9 : 1.6,
      radius: r,
      heavy,
      hitSet: new Set<Enemy>(),
    });
  }

  private updateBullets(delta: number): void {
    const step = delta / 1000;
    for (const b of this.bullets) {
      b.life -= step;
      if (b.life <= 0) {
        continue;
      }
      b.x += b.vx * step;
      b.y += b.vy * step;
      b.sprite.setPosition(b.x, b.y);
      b.trail.clear();
      b.trail.lineStyle(
        gameUnits(b.heavy ? 16 : 8),
        b.heavy ? 0xff8f5c : 0xffd166,
        b.heavy ? 0.7 : 0.55,
      );
      b.trail.lineBetween(b.x, b.y, b.x - b.vx * 0.045, b.y - b.vy * 0.045);
      if (
        b.x < WALL_THICKNESS ||
        b.x > ROOM_WIDTH - WALL_THICKNESS ||
        b.y < WALL_THICKNESS ||
        b.y > ROOM_HEIGHT - WALL_THICKNESS
      ) {
        b.life = 0;
        continue;
      }
      let hit = false;
      for (const e of [...this.enemies]) {
        if (b.hitSet.has(e)) {
          continue;
        }
        const d = Math.hypot(b.x - e.sprite.x, b.y - e.groundY);
        if (d < e.radius + b.radius) {
          b.hitSet.add(e);
          hit = true;
          // 弹道与近战共用同一套结算，飘字落在敌人身上而不是子弹坐标上。
          const ang = Math.atan2(b.vy, b.vx);
          this.damageEnemy(e, b.damage, b.heavy ? 540 : 150, b.heavy, ang);
          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            b.life = 0;
          }
          break;
        }
      }
      if (hit) {
        continue;
      }
      for (const ob of this.obstacles) {
        const d = Math.hypot(b.x - ob.x, b.y - ob.y);
        if (d < ob.r + b.radius) {
          b.life = 0;
          break;
        }
      }
    }
    const dead = this.bullets.filter((b) => b.life <= 0);
    for (const b of dead) {
      b.sprite.destroy();
      b.trail.destroy();
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  /** 命中火花：让"打到了"不需要靠血条变化去确认。 */
  private spawnHitSpark(x: number, y: number, heavy: boolean): void {
    // 命中那一帧的"闪"：短促的高亮圆，卖的是撞击瞬间的能量释放。
    // 只有火星没有闪光，命中会显得"飘"——火花是碎屑，闪光才是力量。
    const flash = this.add
      .circle(x, y, gameUnits(heavy ? 46 : 30), heavy ? 0xffd08a : 0xfff4c8)
      .setDepth(18);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: flash,
      scale: heavy ? 1.5 : 1.25,
      alpha: 0,
      duration: heavy ? 150 : 110,
      ease: 'Cubic.out',
      onComplete: () => flash.destroy(),
    });

    const count = heavy ? 7 : 3;
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = gameUnits(90) + Math.random() * gameUnits(heavy ? 260 : 150);
      const p = this.add
        .circle(x, y, gameUnits(heavy ? 11 : 7), heavy ? 0xffb03a : 0xffe9a8)
        .setDepth(17);
      p.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp,
        alpha: 0,
        scale: 0.3,
        duration: 180 + Math.random() * 120,
        ease: 'Cubic.out',
        onComplete: () => p.destroy(),
      });
    }
  }

  /** 命中飘字：普通弹白色、重击弹橙色加粗。 */
  private spawnDamageText(
    x: number,
    y: number,
    value: number,
    heavy: boolean,
  ): void {
    const t = addGameText(
      this,
      x + (Math.random() - 0.5) * gameUnits(40),
      y - gameUnits(30),
      String(value),
      {
        color: heavy ? '#ff7a3d' : '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(heavy ? 60 : 44),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(19);
    t.setStroke('#223344', gameUnits(heavy ? 7 : 5));
    this.tweens.add({
      targets: t,
      y: t.y - gameUnits(heavy ? 96 : 66),
      alpha: 0,
      scale: { from: heavy ? 1.3 : 1.1, to: 1 },
      duration: heavy ? 520 : 420,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  private killEnemy(e: Enemy): void {
    const ex = e.sprite.x;
    const ey = e.sprite.y;
    e.sprite.destroy();
    e.shadow.destroy();
    const idx = this.enemies.indexOf(e);
    if (idx >= 0) {
      this.enemies.splice(idx, 1);
    }
    const value = Math.max(1, Math.round(e.coins * this.run.luck));
    this.spawnCoinBurst(ex, ey, value);
    this.spawnKillFeedback(ex, ey, value);
    if (this.bossEnemy === e) {
      this.bossEnemy = undefined;
      this.bossBarGfx?.setVisible(false);
      this.bossNameText?.setVisible(false);
    }
    if (this.enemies.length === 0) {
      this.activatePortal();
    }
  }

  /** 击杀反馈：金色冲击环 + 碎片粒子 + 击杀飘字。 */
  private spawnKillFeedback(x: number, y: number, value: number): void {
    const ring = this.add.graphics().setDepth(17);
    ring.lineStyle(gameUnits(10), 0xffd166, 0.9);
    ring.strokeCircle(0, 0, gameUnits(30));
    ring.setPosition(x, y);
    this.tweens.add({
      targets: ring,
      scale: 3.2,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.out',
      onComplete: () => ring.destroy(),
    });

    for (let i = 0; i < 6; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = gameUnits(240) + Math.random() * gameUnits(360);
      const p = this.add
        .circle(x, y, gameUnits(14), 0xffd94a)
        .setDepth(17)
        .setStrokeStyle(gameUnits(4), 0xe8a33d, 1);
      const tx = x + Math.cos(a) * sp;
      const ty = y + Math.sin(a) * sp;
      this.tweens.add({
        targets: p,
        x: tx,
        y: ty,
        alpha: 0,
        scale: 0.3,
        duration: 320 + Math.random() * 180,
        ease: 'Cubic.out',
        onComplete: () => p.destroy(),
      });
    }

    const t = addGameText(this, x, y - gameUnits(50), `+${value}`, {
      color: '#ffd166',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(64),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(19);
    t.setStroke('#223344', gameUnits(6));
    this.tweens.add({
      targets: t,
      y: t.y - gameUnits(96),
      alpha: 0,
      scale: { from: 1.35, to: 1 },
      duration: 620,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  private updateEnemies(delta: number): void {
    const step = delta / 1000;
    const now = this.time.now;
    for (const e of this.enemies) {
      const dx = this.playerX - e.sprite.x;
      const dy = this.playerY - e.groundY;
      const dist = Math.hypot(dx, dy);
      const stopDist = e.radius + BASE_PLAYER.radius;
      if (dist > 0.001) {
        // 走到"贴身圈"就停，不再往玩家身上叠。多只敌人因此会围成一圈，而不是叠成一个点。
        const travel = Math.max(
          0,
          Math.min(e.speed * GAME_SCALE * step, dist - stopDist),
        );
        const nx = e.sprite.x + (dx / dist) * travel + e.kbX * step;
        const ny = e.groundY + (dy / dist) * travel + e.kbY * step;
        const moved = pushOutOfObstacles(
          clampInsideWalls(nx, e.radius, ROOM_WIDTH),
          clampInsideWalls(ny, e.radius, ROOM_HEIGHT),
          e.radius,
          this.obstacles,
        );
        e.groundY = moved.y;
        e.sprite.x = moved.x;
      }
      const kbDamp = Math.exp(-ENEMY_KNOCK_DAMP * step);
      e.kbX *= kbDamp;
      e.kbY *= kbDamp;
      e.sprite.setFlipX(dx < 0);

      // 个性动画：史莱姆弹跳 / 蝙蝠悬浮扑翼 / 骷髅蹒跚 / Boss 威压呼吸
      e.animPhase += delta * ENEMY_ANIM_RATES[e.kind];
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let hoverY = 0;
      if (e.kind === 'slime') {
        // 弹跳：落地压扁、腾空拉伸，并整体离地弹跳
        const bounce = Math.abs(Math.sin(e.animPhase));
        sx = 1 + bounce * 0.22;
        sy = 1 - bounce * 0.3;
        hoverY = -bounce * gameUnits(52);
      } else if (e.kind === 'bat') {
        // 悬浮：上下漂浮 + 扑翼收展 + 轻微侧倾
        const flap = Math.sin(e.animPhase);
        sx = 1 - Math.abs(flap) * 0.3;
        rot = flap * 0.07;
        hoverY = Math.sin(e.animPhase * 0.9) * gameUnits(116);
      } else if (e.kind === 'skeleton') {
        // 蹒跚：摇晃幅度大、频率快，带一点耸肩抖动
        rot = Math.sin(e.animPhase) * 0.14;
        const jitter = Math.sin(e.animPhase * 3.1) * 0.04;
        sy = 1 + jitter;
      } else {
        // Boss：威压呼吸 + 缓慢摆尾
        const breath = Math.sin(e.animPhase);
        sx = 1 + breath * 0.05;
        sy = 1 - breath * 0.05;
        rot = breath * 0.06;
      }
      if (e.telegraphing) {
        sx *= 1.18;
        sy *= 1.18;
      }
      const base = e.baseScale;
      e.sprite.setScale(base * sx, base * sy);
      e.sprite.setRotation(rot);
      e.hoverY = hoverY;
      e.sprite.setY(
        e.groundY + hoverY - charFootLift(e.radius, e.isBoss ? 'boss' : 'enemy'),
      );

      // 投影贴地（角色弹跳/悬浮时影子留在地面）+ 平台反馈（站上台阶/柜子时投影变淡变大）
      // 同上：投影贴住 groundY（判定圆心）。原来按 radius * 0.55 下移，
    // 史莱姆偏 26、Boss 偏 66 单位，越大的怪"站得越飘"。
    e.shadow.setPosition(e.sprite.x, e.groundY);
      const enemyOnPlatform = isOnPlatform(e.sprite.x, e.groundY);
      e.shadow.setAlpha(enemyOnPlatform ? 0.13 : 0.24);
      e.shadow.setScale(enemyOnPlatform ? 0.78 : 1);

      // 留一点余量：敌人停在 stopDist 上，判定必须比它略大，否则会永远打不到玩家。
      const touching = dist < stopDist + gameUnits(24);
      if (touching && !e.telegraphing && now >= e.nextAttackAt) {
        e.telegraphing = true;
        e.windupEnd = now + ENEMY_WINDUP_MS;
        e.sprite.setTint(0xff7777);
      }
      if (e.telegraphing && now >= e.windupEnd) {
        e.telegraphing = false;
        e.sprite.setTint(ENEMY_TINTS[e.kind]);
        e.nextAttackAt = now + e.attackCooldownMs;
        if (touching) {
          this.damagePlayer(e.damage, e.sprite.x, e.groundY);
        }
      }
    }
    this.separateEnemies();
  }

  /**
   * 敌人之间的体积分离。原实现里每只敌人只对障碍物做一次推出、彼此完全不互推，
   * 多只怪会占同一个坐标叠成一坨把玩家盖住；这里补上互相推开。
   * Boss 质量大、几乎推不动，避免被小怪顶飞。
   */
  private separateEnemies(): void {
    const list = this.enemies;
    if (list.length < 2) {
      return;
    }
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j];
        let dx = b.sprite.x - a.sprite.x;
        let dy = b.groundY - a.groundY;
        let d = Math.hypot(dx, dy);
        const min = (a.radius + b.radius) * ENEMY_SEPARATION;
        if (d >= min) {
          continue;
        }
        if (d < 0.001) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const overlap = min - d;
        const nx = dx / d;
        const ny = dy / d;
        const aShare = a.isBoss ? 0.1 : b.isBoss ? 0.9 : 0.5;
        const bShare = 1 - aShare;
        a.sprite.x -= nx * overlap * aShare;
        a.groundY -= ny * overlap * aShare;
        b.sprite.x += nx * overlap * bShare;
        b.groundY += ny * overlap * bShare;
      }
    }
    // 推开之后重新贴回墙体与障碍物，并同步贴图 / 投影位置。
    for (const e of list) {
      const moved = pushOutOfObstacles(
        clampInsideWalls(e.sprite.x, e.radius, ROOM_WIDTH),
        clampInsideWalls(e.groundY, e.radius, ROOM_HEIGHT),
        e.radius,
        this.obstacles,
      );
      e.sprite.x = moved.x;
      e.groundY = moved.y;
      e.sprite.setY(
        e.groundY +
          e.hoverY -
          charFootLift(e.radius, e.isBoss ? 'boss' : 'enemy'),
      );
      // 同上：投影贴住 groundY（判定圆心）。原来按 radius * 0.55 下移，
    // 史莱姆偏 26、Boss 偏 66 单位，越大的怪"站得越飘"。
    e.shadow.setPosition(e.sprite.x, e.groundY);
    }
  }

  private damagePlayer(amount: number, fromX?: number, fromY?: number): void {
    if (this.phase !== 'playing') {
      return;
    }
    const now = this.time.now;
    // 无敌帧：没有它时，多只敌人会在同一帧各自结算一次伤害，被围住就是瞬秒。
    if (now < this.invulnUntil) {
      return;
    }
    this.invulnUntil = now + PLAYER_INVULN_MS;
    this.run.hp -= amount;
    this.levelStats.damageTaken += amount;
    // 击退：受伤后被推开，给玩家脱离包围的余地。
    if (fromX !== undefined && fromY !== undefined) {
      const dx = this.playerX - fromX;
      const dy = this.playerY - fromY;
      const len = Math.hypot(dx, dy) || 1;
      const power = KNOCKBACK_SPEED * GAME_SCALE;
      this.knockVx += (dx / len) * power;
      this.knockVy += (dy / len) * power;
    }
    sfx.hurt();
    this.flashHurtVeil();
    this.cameras.main.shake(150, SHAKE_HURT);
    if (this.playerSprite && this.playerSprite.active) {
      this.playerSprite.setTint(0xff7777);
      this.emoteState = 'hurt';
      this.emoteUntil = now + 420;
      this.drawPlayerEmote();
      // 闪烁由 updateMovement 里的无敌状态统一驱动，这里只负责恢复染色。
      this.time.delayedCall(260, () => {
        if (this.playerSprite && this.playerSprite.active) {
          this.playerSprite.clearTint();
        }
      });
    }
    if (this.run.hp <= 0) {
      this.run.hp = 0;
      this.player?.destroy();
      this.player = undefined;
      this.playerSprite = undefined;
      this.playerShadow?.destroy();
      this.playerShadow = undefined;
      this.showDeath();
    }
  }

  /**
   * 受伤反馈：一层压低透明度的红色蒙版，而不是 Phaser 的 camera.flash。
   *
   * camera.flash 会把整个 camera 的渲染结果整片染红，连 setScrollFactor(0)
   * 的血条、技能钮一起糊掉——而被围殴、正在挨打的那一瞬间，恰恰是最需要
   * 看清战场和血量的时刻。所以这里改成：
   * - 用普通矩形做蒙版，深度 50：压在世界之上、HUD（100+）之下；
   * - 峰值 alpha 只有 0.16，是一层"泛红"而不是"红屏"。
   */
  private flashHurtVeil(): void {
    if (!this.hurtVeil) {
      this.hurtVeil = this.add
        .rectangle(
          GAME_WIDTH / 2,
          GAME_HEIGHT / 2,
          GAME_WIDTH,
          GAME_HEIGHT,
          0xff3b3b,
          1,
        )
        .setScrollFactor(0)
        .setDepth(50)
        .setAlpha(0);
    }
    // 连续挨打时重新计时，而不是叠加出越来越红的屏幕。
    this.tweens.killTweensOf(this.hurtVeil);
    this.hurtVeil.setAlpha(HURT_VEIL_ALPHA);
    this.tweens.add({
      targets: this.hurtVeil,
      alpha: 0,
      duration: 220,
      ease: 'Cubic.out',
    });
  }

  private updateCoins(delta: number): void {
    const step = delta / 1000;
    const magnetR = BASE_PLAYER.radius + gameUnits(280);
    const pickupR = BASE_PLAYER.radius + gameUnits(90);
    for (const c of this.coins) {
      if (!c.alive) {
        continue;
      }
      const damp = Math.exp(-4 * step);
      c.vx *= damp;
      c.vy *= damp;
      const dx = this.playerX - c.x;
      const dy = this.playerY - c.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < magnetR) {
        const pull =
          (gameUnits(2600) * (1 - d / magnetR) + gameUnits(700)) * step;
        c.vx += (dx / d) * pull;
        c.vy += (dy / d) * pull;
      }
      c.x += c.vx * step;
      c.y += c.vy * step;
      c.sprite.setPosition(c.x, c.y);
      // 金币自身旋转 / 脉动，落地后更有质感
      const spin = this.time.now * 0.006 + c.phase;
      c.sprite.setRotation(Math.sin(spin) * 0.22);
      c.sprite.setScale(1 + Math.sin(spin) * 0.1, 1 - Math.sin(spin) * 0.06);
      if (d < pickupR) {
        c.alive = false;
        sfx.coin();
        this.run.coins += c.value;
        this.spawnCoinPickupText(c.x, c.y, c.value);
        this.tweens.add({
          targets: c.sprite,
          scale: 0.2,
          alpha: 0,
          duration: 130,
          onComplete: () => c.sprite.destroy(),
        });
      }
    }
    this.coins = this.coins.filter((c) => c.alive);
  }

  private spawnCoinBurst(x: number, y: number, totalValue: number): void {
    const pieces = Phaser.Math.Clamp(Math.ceil(totalValue / 2), 1, 8);
    let remaining = totalValue;
    for (let i = 0; i < pieces; i += 1) {
      const value =
        i === pieces - 1
          ? remaining
          : Math.min(1 + Math.floor(Math.random() * 2), remaining);
      remaining -= value;
      const a = Math.random() * Math.PI * 2;
      const sp = gameUnits(140) + Math.random() * gameUnits(260);
      this.spawnCoin(x, y, value, Math.cos(a) * sp, Math.sin(a) * sp);
    }
  }

  private spawnCoin(
    x: number,
    y: number,
    value: number,
    vx = 0,
    vy = 0,
  ): void {
    const c = this.add.circle(x, y, gameUnits(26), 0xffd94a).setDepth(6);
    c.setStrokeStyle(gameUnits(6), 0xe8a33d, 1);
    this.coins.push({
      sprite: c,
      x,
      y,
      vx,
      vy,
      value,
      alive: true,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private spawnCoinPickupText(x: number, y: number, value: number): void {
    const t = addGameText(this, x, y - gameUnits(30), `+${value}`, {
      color: '#ffd166',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(40),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(19);
    t.setStroke('#223344', gameUnits(6));
    this.tweens.add({
      targets: t,
      y: t.y - gameUnits(56),
      alpha: 0,
      duration: 460,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  // ========== 传送门 ==========
  private checkPortal(): void {
    if (!this.portalActive || !this.portal) {
      return;
    }
    const d = Math.hypot(
      this.playerX - this.portal.x,
      this.playerY - this.portal.y,
    );
    if (d < gameUnits(210)) {
      this.onPortalEntered();
    }
  }

  private onPortalEntered(): void {
    sfx.levelUp();
    if (this.run.level < TOTAL_LEVELS) {
      this.showLevelUp();
    } else {
      this.showVictory();
    }
  }

  private activatePortal(): void {
    if (!this.portal) {
      return;
    }
    this.portalActive = true;
    sfx.portal();
    this.portal.setVisible(true);
    this.portalTween = this.tweens.add({
      targets: this.portal,
      scale: { from: 0.9, to: 1.1 },
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  // ========== 房间与实体生成 ==========
  private drawRoom(level: number): void {
    // 房间背景：正式素材 room-bg（完整不透明单图，3400x2300 设计单位）
    const bg = this.add
      .image(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 'room-bg')
      .setDisplaySize(ROOM_WIDTH, ROOM_HEIGHT)
      .setDepth(0);
    this.roomGfx = bg;

    this.obstacles = [];
    const obstacleCount = level >= TOTAL_LEVELS ? 3 : 5;
    for (let i = 0; i < obstacleCount; i += 1) {
      const ox =
        WALL_THICKNESS +
        gameUnits(200) +
        rand() * (ROOM_WIDTH - 2 * WALL_THICKNESS - gameUnits(400));
      const oy =
        WALL_THICKNESS +
        gameUnits(200) +
        rand() * (ROOM_HEIGHT - 2 * WALL_THICKNESS - gameUnits(400));
      if (
        Math.abs(ox - ROOM_WIDTH / 2) < gameUnits(300) &&
        Math.abs(oy - ROOM_HEIGHT / 2) < gameUnits(300)
      ) {
        continue;
      }
      // 障碍物避开平台（台阶 / 柜子）区域
      if (isOnPlatform(ox, oy)) {
        continue;
      }
      const r = gameUnits(56) + rand() * gameUnits(56);
      const og = this.add.graphics().setDepth(2);
      const variant: ObstacleVariant = rand() < 0.5 ? 'crate' : 'pillar';
      drawObstacleProp(og, r, variant);
      og.setPosition(ox, oy);
      this.obstacles.push({ x: ox, y: oy, r, sprite: og });
    }

    this.portal = this.add.graphics().setDepth(8);
    drawPortal(this.portal);
    this.portal.setPosition(ROOM_WIDTH / 2, ROOM_HEIGHT / 2);
    this.portal.setVisible(false);
    this.portalActive = false;
  }

  private spawnEnemies(level: number): void {
    const plan = spawnPlanForLevel(level);
    // 生成时刻就记录怪种：之后有怪被打死也不会影响「这层应该有什么」的断言。
    this.spawnedKinds = plan.flatMap((spec) => Array.from({ length: spec.count }, () => spec.kind));
    this.levelStats = { level, damageTaken: 0 };
    const scale = enemyStatScale(level);
    const centerSafe = gameUnits(260);
    for (const spec of plan) {
      const kind = ENEMY_KINDS[spec.kind];
      for (let i = 0; i < spec.count; i += 1) {
        let x = WALL_THICKNESS + gameUnits(160);
        let y = WALL_THICKNESS + gameUnits(160);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const tx =
            WALL_THICKNESS +
            gameUnits(120) +
            rand() * (ROOM_WIDTH - 2 * WALL_THICKNESS - gameUnits(240));
          const ty =
            WALL_THICKNESS +
            gameUnits(120) +
            rand() * (ROOM_HEIGHT - 2 * WALL_THICKNESS - gameUnits(240));
          const awayFromCenter =
            Math.hypot(tx - ROOM_WIDTH / 2, ty - ROOM_HEIGHT / 2) >
            centerSafe + kind.radius;
          if (awayFromCenter) {
            x = tx;
            y = ty;
            break;
          }
        }
        const size = charTexSize(kind.radius);
        const img = this.add
          .image(x, y, ENEMY_TEX_KEYS[kind.id])
          .setDisplaySize(size, size)
          .setTint(ENEMY_TINTS[kind.id])
          .setDepth(10);
        const shadow = this.add
          .ellipse(x, y, size * 0.72, size * 0.2, 0x1a1420, 0.24)
          .setDepth(9);
        const e: Enemy = {
          kind: kind.id,
          sprite: img,
          shadow,
          baseScale: img.scaleX,
          hp: Math.round(kind.hp * scale),
          maxHp: Math.round(kind.hp * scale),
          damage: Math.round(kind.damage * scale),
          speed: kind.speed,
          radius: kind.radius,
          coins: kind.coins,
          attackCooldownMs: kind.attackCooldownMs,
          nextAttackAt: 0,
          telegraphing: false,
          windupEnd: 0,
          animPhase: Math.random() * Math.PI * 2,
          isBoss: kind.id === 'boss',
          hoverY: 0,
          groundY: y,
          kbX: 0,
          kbY: 0,
        };
        this.enemies.push(e);
        if (e.isBoss) {
          this.showBossBar(e);
        }
      }
    }
  }

  private spawnPlayer(): void {
    const size = charTexSize(BASE_PLAYER.radius);
    const container = this.add.container(0, 0).setDepth(20);
    const img = this.add
      .image(0, 0, PLAYER_TEX_KEY)
      .setDisplaySize(size, size);
    container.add(img);
    const emote = this.add.graphics();
    container.add(emote);
    this.playerEmote = emote;
    this.emoteState = 'normal';
    this.emoteUntil = 0;
    this.player = container;
    this.playerSprite = img;
    this.playerBaseScale = img.scaleX;
    this.bobPhase = 0;
    this.playerShadow = this.add
      .ellipse(0, 0, size * 0.72, size * 0.22, 0x1a1420, 0.28)
      .setDepth(19);
    this.resetPlayerPosition();
  }

  private resetPlayerPosition(): void {
    this.playerX = ROOM_WIDTH / 2;
    this.playerY = ROOM_HEIGHT / 2;
    this.player?.setPosition(
      this.playerX,
      this.playerY - charFootLift(BASE_PLAYER.radius, 'player'),
    );
    this.cameras.main.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    if (this.player) {
      this.cameras.main.startFollow(this.player);
      this.cameras.main.centerOn(this.playerX, this.playerY);
    }
  }

  private resetRoomObjects(): void {
    for (const e of this.enemies) {
      e.sprite.destroy();
      e.shadow.destroy();
    }
    this.enemies = [];
    for (const b of this.bullets) {
      b.sprite.destroy();
      b.trail.destroy();
    }
    this.bullets = [];
    for (const c of this.coins) {
      c.sprite.destroy();
    }
    this.coins = [];
    for (const ob of this.obstacles) {
      ob.sprite.destroy();
    }
    this.obstacles = [];
    this.roomGfx?.destroy();
    this.roomGfx = undefined;
    this.portal?.destroy();
    this.portal = undefined;
    this.portalTween?.stop();
    this.portalTween = undefined;
    this.player?.destroy();
    this.player = undefined;
    this.playerSprite = undefined;
    this.playerEmote = undefined;
    this.playerShadow?.destroy();
    this.playerShadow = undefined;
    this.portalActive = false;
    this.bossEnemy = undefined;
    this.bossBarGfx?.setVisible(false);
    this.bossNameText?.setVisible(false);
    this.fireTimer = 0;
  }

  // ========== HUD ==========
  private createHud(): void {
    const layout = createUiLayout();
    this.hpBarGfx = this.add.graphics().setDepth(100).setScrollFactor(0);
    this.hpText = addGameText(
      this,
      layout.hpBar.x + layout.hpBar.w / 2,
      layout.hpBar.y + layout.hpBar.h / 2,
      '',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(40),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);
    this.levelText = addGameText(
      this,
      layout.levelText.x,
      layout.levelText.y,
      '',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(48),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);
    this.coinsText = addGameText(
      this,
      layout.coins.x,
      layout.coins.y,
      '',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(48),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);
    this.skillRowText = addGameText(
      this,
      GAME_WIDTH / 2,
      layout.skillRow.y,
      '',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(layout.skillRow.fontSize),
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);
    this.bossBarGfx = this.add.graphics().setDepth(102).setScrollFactor(0);
    this.bossNameText = addGameText(
      this,
      GAME_WIDTH / 2,
      gameUnits(52),
      '',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(44),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(103);
    this.bossBarGfx.setVisible(false);
    this.bossNameText.setVisible(false);
    this.showHud(false);
  }

  private showHud(visible: boolean): void {
    this.hpBarGfx?.setVisible(visible);
    this.hpText?.setVisible(visible);
    this.levelText?.setVisible(visible);
    this.coinsText?.setVisible(visible);
    this.skillRowText?.setVisible(visible);
    this.dashButton?.setVisible(visible);
    this.chargeButton?.setVisible(visible);
    this.bloodButton?.setVisible(visible);
    this.thrustButton?.setVisible(visible);
    this.abilityGfx?.setVisible(visible);
    this.abilityLabels.forEach((t) => t.setVisible(visible));
    if (!visible) {
      this.bossBarGfx?.setVisible(false);
      this.bossNameText?.setVisible(false);
      this.bossEnemy = undefined;
    }
  }

  private resetHudCache(): void {
    this.lastHp = -1;
    this.lastCoins = -1;
    this.lastLevelStr = '';
    this.lastSkillKey = '';
  }

  private refreshHud(): void {
    const run = this.run;
    if (Math.round(run.hp) !== this.lastHp) {
      this.lastHp = Math.round(run.hp);
      this.renderHpBar();
    }
    if (run.coins !== this.lastCoins) {
      this.lastCoins = run.coins;
      this.coinsText?.setText(`💰 ${run.coins}`);
    }
    const levelStr = `第 ${run.level} 层 / ${TOTAL_LEVELS}`;
    if (levelStr !== this.lastLevelStr) {
      this.lastLevelStr = levelStr;
      this.levelText?.setText(levelStr);
    }
    const skillKey = run.skills.join(',');
    if (skillKey !== this.lastSkillKey) {
      this.lastSkillKey = skillKey;
      this.skillRowText?.setText(
        run.skills
          .map((id) => SKILL_POOL.find((s) => s.id === id)?.icon ?? '?')
          .join('  '),
      );
    }
    if (this.bossEnemy) {
      this.renderBossBar();
    }
    this.renderAbilityGfx();
  }

  private renderHpBar(): void {
    const g = this.hpBarGfx;
    if (!g) {
      return;
    }
    const layout = createUiLayout();
    const { x, y, w, h } = layout.hpBar;
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(x, y, w, h, h / 2);
    const ratio = Phaser.Math.Clamp(this.run.hp / this.run.maxHp, 0, 1);
    const innerW = (w - gameUnits(12)) * ratio;
    if (innerW > 0) {
      const color =
        ratio > 0.5 ? 0x6fce5b : ratio > 0.25 ? 0xffd166 : 0xff6b6b;
      g.fillStyle(color, 1);
      g.fillRoundedRect(
        x + gameUnits(6),
        y + gameUnits(6),
        innerW,
        h - gameUnits(12),
        (h - gameUnits(12)) / 2,
      );
    }
    this.hpText?.setText(
      `${Math.max(0, Math.round(this.run.hp))}/${this.run.maxHp}`,
    );
  }

  private renderBossBar(): void {
    const g = this.bossBarGfx;
    const e = this.bossEnemy;
    if (!g || !e) {
      return;
    }
    const w = gameUnits(1000);
    const h = gameUnits(56);
    const x = GAME_WIDTH / 2 - w / 2;
    const y = gameUnits(112);
    g.clear();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x, y, w, h, h / 2);
    const ratio = Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1);
    const innerW = (w - gameUnits(12)) * ratio;
    if (innerW > 0) {
      g.fillStyle(0xe2533e, 1);
      g.fillRoundedRect(
        x + gameUnits(6),
        y + gameUnits(6),
        innerW,
        h - gameUnits(12),
        (h - gameUnits(12)) / 2,
      );
    }
  }

  private showBossBar(e: Enemy): void {
    this.bossEnemy = e;
    this.bossNameText?.setText(ENEMY_KINDS[e.kind].name).setVisible(true);
    this.bossBarGfx?.setVisible(true);
    this.renderBossBar();
  }

  // ========== 流程控制 ==========
  private togglePause(): void {
    if (this.phase === 'playing') {
      this.pauseGame();
    } else if (this.phase === 'paused') {
      this.resumeGame();
    }
  }

  private pauseGame(): void {
    this.phase = 'paused';
    const layout = createUiLayout();
    const dim = this.add
      .rectangle(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        GAME_WIDTH,
        GAME_HEIGHT,
        0x000000,
        0.5,
      )
      .setDepth(MODAL_DEPTH)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.add.graphics().setDepth(MODAL_DEPTH + 1).setScrollFactor(0);
    panel.fillStyle(0xffffff, 1);
    panel.fillRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    panel.lineStyle(gameUnits(10), 0x8a93a3, 1);
    panel.strokeRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    const title = addGameText(
      this,
      layout.center.x,
      layout.panel.y + gameUnits(130),
      '已暂停',
      {
        color: '#2f3a4a',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(96),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    const controls = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(40),
      [
        'WASD / 方向键  移动 · 自动挥剑（近战扇形）',
        '空格  冲刺斩（突进 + 伤害 + 无敌）',
        'J  长按蓄力三级 · 快斩 / 横扫 / 跳劈',
        'K  嗜血斩（命中回血）   L  突刺（单体高伤）',
        'P / ESC  暂停 · 继续',
        '触屏  左摇杆移动 · 右下四个技能钮',
      ],
      {
        color: '#8a93a3',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(46),
        align: 'center',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    this.overlays.push(dim, panel, title, controls);
    this.createButton(
      layout.center.x - gameUnits(280),
      layout.center.y + gameUnits(230),
      gameUnits(500),
      gameUnits(140),
      '继续',
      () => this.resumeGame(),
      0x6fce5b,
    );
    this.createButton(
      layout.center.x + gameUnits(280),
      layout.center.y + gameUnits(230),
      gameUnits(500),
      gameUnits(140),
      '返回主菜单',
      () => this.showMenu(),
      0x8a93a3,
    );
  }

  private resumeGame(): void {
    if (this.phase !== 'paused') {
      return;
    }
    this.clearOverlays();
    this.phase = 'playing';
  }

  private clearOverlays(): void {
    for (const o of this.overlays) {
      o.destroy();
    }
    this.overlays = [];
  }

  private createButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    color = 0x4c8bf5,
  ): void {
    const depth = MODAL_DEPTH + 10;
    const g = this.add.graphics().setDepth(depth).setScrollFactor(0);
    const paint = (alpha: number): void => {
      g.clear();
      g.fillStyle(color, alpha);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
      g.lineStyle(gameUnits(6), 0xffffff, 0.4);
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
    };
    paint(1);
    const t = addGameText(this, x, y, label, {
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(56),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(depth + 1)
      .setScrollFactor(0);
    const zone = this.add
      .zone(x, y, w, h)
      .setInteractive({ useHandCursor: true })
      .setDepth(depth + 2)
      .setScrollFactor(0);
    zone.on('pointerdown', () => paint(0.72));
    zone.on('pointerup', () => {
      paint(1);
      onClick();
    });
    zone.on('pointerout', () => paint(1));
    this.overlays.push(g, t, zone);
  }

  private createSkillCard(
    cx: number,
    cy: number,
    w: number,
    h: number,
    skill: SkillDef,
  ): void {
    const depth = MODAL_DEPTH + 5;
    const g = this.add.graphics().setDepth(depth).setScrollFactor(0);
    const paint = (bright: number): void => {
      g.clear();
      g.fillStyle(skill.color, bright);
      g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, gameUnits(36));
      g.lineStyle(gameUnits(8), 0xffffff, 0.85);
      g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, gameUnits(36));
    };
    paint(1);
    const icon = addGameText(this, cx, cy - h * 0.2, skill.icon, {
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(150),
    })
      .setOrigin(0.5)
      .setDepth(depth + 1)
      .setScrollFactor(0);
    const name = addGameText(this, cx, cy + h * 0.02, skill.name, {
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(58),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(depth + 1)
      .setScrollFactor(0);
    const desc = addGameText(this, cx, cy + h * 0.3, skill.desc, {
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(42),
      align: 'center',
      wordWrap: { width: w - gameUnits(60) },
    })
      .setOrigin(0.5)
      .setDepth(depth + 1)
      .setScrollFactor(0);
    const zone = this.add
      .zone(cx, cy, w, h)
      .setInteractive({ useHandCursor: true })
      .setDepth(depth + 2)
      .setScrollFactor(0);
    zone.on('pointerdown', () => paint(0.72));
    zone.on('pointerup', () => {
      paint(1);
      this.chooseSkill(skill);
    });
    zone.on('pointerout', () => paint(1));
    this.overlays.push(g, icon, name, desc, zone);
  }

  private startRun(): void {
    this.run = createRunState(this.meta);
    this.clearOverlays();
    this.resetRoomObjects();
    this.drawRoom(this.run.level);
    this.spawnEnemies(this.run.level);
    this.spawnPlayer();
    this.showHud(true);
    this.resetHudCache();
    this.refreshHud();
    this.phase = 'playing';
    this.showControlToast();
  }

  /** 开局操作提示 toast（约 3 秒后淡出）。 */
  private showControlToast(): void {
    const t = addGameText(
      this,
      GAME_WIDTH / 2,
      gameUnits(240),
      'WASD 移动 · 自动挥剑 · 空格 冲刺斩 · J 蓄力三级 · K 嗜血斩 · L 突刺 · P 暂停',
      {
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(42),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(150);
    t.setStroke('#223344', gameUnits(6));
    this.tweens.add({
      targets: t,
      y: t.y - gameUnits(40),
      alpha: 0,
      delay: 2400,
      duration: 520,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  private showLevelUp(): void {
    this.phase = 'levelup';
    const layout = createUiLayout();
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setDepth(MODAL_DEPTH)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.add.graphics().setDepth(MODAL_DEPTH + 1).setScrollFactor(0);
    panel.fillStyle(0xffffff, 1);
    panel.fillRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    panel.lineStyle(gameUnits(10), 0x4c8bf5, 1);
    panel.strokeRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    const title = addGameText(
      this,
      layout.center.x,
      layout.panel.y + gameUnits(110),
      '选择你的强化',
      {
        color: '#2f3a4a',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(84),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    this.overlays.push(dim, panel, title);

    const options = pickSkillOptions(this.run);
    const cardW = gameUnits(500);
    const cardH = gameUnits(600);
    const gap = gameUnits(70);
    const totalW = options.length * cardW + (options.length - 1) * gap;
    options.forEach((skill, i) => {
      const cx =
        layout.center.x - totalW / 2 + cardW / 2 + i * (cardW + gap);
      const cy = layout.panel.y + layout.panel.h / 2 + gameUnits(20);
      this.createSkillCard(cx, cy, cardW, cardH, skill);
    });
    const hint = addGameText(
      this,
      layout.center.x,
      layout.panel.y + layout.panel.h - gameUnits(70),
      '点击卡片获得强化，然后进入下一层',
      {
        color: '#8a93a3',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(38),
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    this.overlays.push(hint);
  }

  private chooseSkill(skill: SkillDef): void {
    applySkill(this.run, skill);
    this.clearOverlays();
    this.nextLevel();
  }

  private nextLevel(): void {
    this.run.level += 1;
    this.resetRoomObjects();
    this.drawRoom(this.run.level);
    this.spawnEnemies(this.run.level);
    this.spawnPlayer();
    // 过层回血：实测三层总承伤 > 最大生命，不回血则必死（见 config 的 LEVEL_CLEAR_HEAL_RATIO）
    if (this.run.hp < this.run.maxHp) {
      const clearHeal = Math.round(this.run.maxHp * LEVEL_CLEAR_HEAL_RATIO);
      this.run.hp = Math.min(this.run.maxHp, this.run.hp + clearHeal);
      sfx.heal();
      this.spawnHealText(clearHeal);
    }
    this.resetHudCache();
    this.refreshHud();
    this.phase = 'playing';
  }

  private showDeath(): void {
    this.phase = 'dead';
    const { banked } = settleDeath(this.run, this.meta);
    saveMeta(this.meta);
    this.showHud(false);
    const layout = createUiLayout();
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setDepth(MODAL_DEPTH)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.add.graphics().setDepth(MODAL_DEPTH + 1).setScrollFactor(0);
    panel.fillStyle(0xffffff, 1);
    panel.fillRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    panel.lineStyle(gameUnits(10), 0xff6b6b, 1);
    panel.strokeRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    const title = addGameText(
      this,
      layout.center.x,
      layout.panel.y + gameUnits(130),
      '你倒下了…',
      {
        color: '#d94343',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(96),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    const info = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(40),
      [
        `到达第 ${this.run.level} 层 · 击杀 ${this.run.kills}`,
        `本局拾取 💰 ${this.run.coins}`,
        `存入钱包 💰 ${banked}`,
      ],
      {
        color: '#4a5568',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(54),
        align: 'center',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    this.overlays.push(dim, panel, title, info);
    this.createButton(
      layout.center.x - gameUnits(300),
      layout.center.y + gameUnits(220),
      gameUnits(520),
      gameUnits(140),
      '再来一局',
      () => this.startRun(),
      0x6fce5b,
    );
    this.createButton(
      layout.center.x + gameUnits(300),
      layout.center.y + gameUnits(220),
      gameUnits(520),
      gameUnits(140),
      '返回主菜单',
      () => this.showMenu(),
      0x8a93a3,
    );
  }

  private showVictory(): void {
    this.phase = 'victory';
    const { banked } = settleVictory(this.run, this.meta);
    saveMeta(this.meta);
    this.showHud(false);
    const layout = createUiLayout();
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setDepth(MODAL_DEPTH)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.add.graphics().setDepth(MODAL_DEPTH + 1).setScrollFactor(0);
    panel.fillStyle(0xffffff, 1);
    panel.fillRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    panel.lineStyle(gameUnits(10), 0x6fce5b, 1);
    panel.strokeRoundedRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      gameUnits(48),
    );
    const title = addGameText(
      this,
      layout.center.x,
      layout.panel.y + gameUnits(130),
      '🎉 恭喜通关！',
      {
        color: '#3a9e4a',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(96),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    const info = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(30),
      [`到达第 ${this.run.level} 层 · 击杀 ${this.run.kills}`, `通关获得 💰 ${banked}`, '已全部存入钱包'],
      {
        color: '#4a5568',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(54),
        align: 'center',
      },
    )
      .setOrigin(0.5)
      .setDepth(MODAL_DEPTH + 2)
      .setScrollFactor(0);
    this.overlays.push(dim, panel, title, info);
    this.createButton(
      layout.center.x,
      layout.center.y + gameUnits(230),
      gameUnits(560),
      gameUnits(140),
      '返回主菜单',
      () => this.showMenu(),
      0x4c8bf5,
    );
  }

  private showMenu(): void {
    this.phase = 'menu';
    this.clearOverlays();
    this.resetRoomObjects();
    this.showHud(false);
    this.cameras.main.stopFollow();
    this.cameras.main.setScroll(0, 0);

    const layout = createUiLayout();
    const bg = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xf6f1e7)
      .setDepth(0)
      .setScrollFactor(0);
    const title = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(560),
      '元气地牢',
      {
        color: '#4c8bf5',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(220),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(5)
      .setScrollFactor(0);
    const sub = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(400),
      '清新卡通 Roguelike 冒险',
      {
        color: '#8a93a3',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(56),
      },
    )
      .setOrigin(0.5)
      .setDepth(5)
      .setScrollFactor(0);
    const wallet = addGameText(
      this,
      layout.center.x,
      layout.center.y - gameUnits(200),
      `💰 钱包金币 ${this.meta.bankCoins}`,
      {
        color: '#e8a33d',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(64),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(5)
      .setScrollFactor(0);
    this.overlays.push(bg, title, sub, wallet);

    const upgrades: Array<{
      key: UpgradeKey;
      label: string;
      desc: string;
    }> = [
      { key: 'attack', label: '⚔️ 攻击力', desc: '永久 +5 攻击' },
      { key: 'hp', label: '❤️ 生命上限', desc: '永久 +10 生命' },
      { key: 'speed', label: '👟 移速', desc: '永久 +24 速度' },
    ];
    const cardW = gameUnits(560);
    const cardH = gameUnits(280);
    const gap = gameUnits(80);
    const totalW = upgrades.length * cardW + (upgrades.length - 1) * gap;
    upgrades.forEach((u, i) => {
      const cx = layout.center.x - totalW / 2 + cardW / 2 + i * (cardW + gap);
      const cy = layout.center.y + gameUnits(120);
      this.createUpgradeCard(cx, cy, cardW, cardH, u.key, u.label, u.desc);
    });

    this.createButton(
      layout.center.x,
      layout.center.y + gameUnits(560),
      gameUnits(760),
      gameUnits(170),
      '开始冒险',
      () => this.startRun(),
      0x4c8bf5,
    );
    const tip = addGameText(
      this,
      layout.center.x,
      layout.center.y + gameUnits(760),
      'WASD 移动 · 自动挥剑 · 空格 冲刺斩 · J 蓄力三级 · K 嗜血斩 · L 突刺 · 触屏可拖动摇杆',
      {
        color: '#a0a8b5',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(38),
      },
    )
      .setOrigin(0.5)
      .setDepth(5)
      .setScrollFactor(0);
    this.overlays.push(tip);
  }

  private createUpgradeCard(
    cx: number,
    cy: number,
    w: number,
    h: number,
    key: UpgradeKey,
    label: string,
    desc: string,
  ): void {
    const g = this.add.graphics().setDepth(6).setScrollFactor(0);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, gameUnits(28));
    g.lineStyle(gameUnits(6), 0xe3d5b8, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, gameUnits(28));
    const price = upgradePrice(this.meta, key);
    const lv = this.meta.upgradeLevels[key];
    const t1 = addGameText(this, cx, cy - h * 0.22, `${label}  Lv.${lv}`, {
      color: '#2f3a4a',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(52),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(7)
      .setScrollFactor(0);
    const t2 = addGameText(this, cx, cy + h * 0.04, desc, {
      color: '#8a93a3',
      fontFamily: FONT_FAMILY,
      fontSize: gamePixels(42),
    })
      .setOrigin(0.5)
      .setDepth(7)
      .setScrollFactor(0);
    const t3 = addGameText(
      this,
      cx,
      cy + h * 0.3,
      price === null ? '已满级' : `💰 ${price}`,
      {
        color: price === null ? '#c0c6d0' : '#e8a33d',
        fontFamily: FONT_FAMILY,
        fontSize: gamePixels(48),
        fontStyle: 'bold',
      },
    )
      .setOrigin(0.5)
      .setDepth(7)
      .setScrollFactor(0);
    const zone = this.add
      .zone(cx, cy, w, h)
      .setInteractive({ useHandCursor: true })
      .setDepth(8)
      .setScrollFactor(0);
    zone.on('pointerdown', () => g.setAlpha(0.7));
    zone.on('pointerout', () => g.setAlpha(1));
    zone.on('pointerup', () => {
      g.setAlpha(1);
      this.buyMenuUpgrade(key);
    });
    this.overlays.push(g, t1, t2, t3, zone);
  }

  private buyMenuUpgrade(key: UpgradeKey): void {
    if (!buyUpgrade(this.meta, key)) {
      return;
    }
    saveMeta(this.meta);
    this.showMenu();
  }
}
