import type Phaser from 'phaser';

export type GameRenderProfile = 'desktop' | 'mobile';

export interface GameRenderSignals {
  readonly mobileHint: boolean;
  readonly mobileUserAgent: boolean;
  readonly coarsePointer: boolean;
  readonly finePointer: boolean;
  readonly maxTouchPoints: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface GameRenderMetrics {
  readonly profile: GameRenderProfile;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

// 设计基准只用来换算尺寸；Scene 边界、Pointer 和碰撞一律使用下方的运行时 GAME_* 坐标。
// 本游戏为横屏地牢冒险：桌面设计基准 3400x2300，移动端自动取 1700x1150。
//
// 基准必须与地牢房间（ROOM_WIDTH/ROOM_HEIGHT）以及 room-bg 素材的宽高比（3400:2300 ≈ 1.478）
// 完全一致，否则相机会比房间更宽，clamp 之后屏幕右侧会露出一条空白背景带。
export const GAME_DESIGN_WIDTH = 3400;
export const GAME_DESIGN_HEIGHT = 2300;

const MOBILE_GAME_SCALE = 0.5;
const TABLET_VIEWPORT_MAX_SHORT_EDGE = 1024;
const MOBILE_FALLBACK_MAX_SHORT_EDGE = 600;
const MOBILE_USER_AGENT =
  /Android|iPhone|iPad|iPod|IEMobile|Mobile|Opera Mini/i;

const viewportShortEdge = (
  width: number,
  height: number,
): number | undefined => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return Math.min(width, height);
};

const firstPositiveDimension = (
  ...candidates: Array<number | undefined>
): number =>
  candidates.find(
    (candidate): candidate is number =>
      candidate !== undefined && Number.isFinite(candidate) && candidate > 0,
  ) ?? 0;

/**
 * Select once before Phaser starts. Resizing and orientation changes keep the
 * selected coordinate profile and are handled by Phaser.Scale.FIT.
 */
export const selectGameRenderProfile = (
  signals: GameRenderSignals,
): GameRenderProfile => {
  if (signals.mobileHint || signals.mobileUserAgent) {
    return 'mobile';
  }

  const shortEdge = viewportShortEdge(
    signals.viewportWidth,
    signals.viewportHeight,
  );
  if (
    signals.coarsePointer &&
    !signals.finePointer &&
    signals.maxTouchPoints > 0 &&
    shortEdge !== undefined &&
    shortEdge <= TABLET_VIEWPORT_MAX_SHORT_EDGE
  ) {
    return 'mobile';
  }

  // Very old or restricted WebViews may expose neither pointer capability.
  if (
    !signals.coarsePointer &&
    !signals.finePointer &&
    shortEdge !== undefined &&
    shortEdge <= MOBILE_FALLBACK_MAX_SHORT_EDGE
  ) {
    return 'mobile';
  }

  return 'desktop';
};

const readRenderSignals = (): GameRenderSignals => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      mobileHint: false,
      mobileUserAgent: false,
      coarsePointer: false,
      finePointer: true,
      maxTouchPoints: 0,
      viewportWidth: GAME_DESIGN_WIDTH,
      viewportHeight: GAME_DESIGN_HEIGHT,
    };
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: { readonly mobile?: boolean };
  };
  const viewport = window.visualViewport;

  return {
    mobileHint: navigatorWithUAData.userAgentData?.mobile === true,
    mobileUserAgent: MOBILE_USER_AGENT.test(navigator.userAgent),
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    finePointer: window.matchMedia?.('(pointer: fine)').matches ?? false,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    viewportWidth: firstPositiveDimension(
      viewport?.width,
      window.innerWidth,
      window.screen?.width,
    ),
    viewportHeight: firstPositiveDimension(
      viewport?.height,
      window.innerHeight,
      window.screen?.height,
    ),
  };
};

const readRenderProfileOverride = (): GameRenderProfile | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const profile = new URLSearchParams(
    window.location?.search ?? '',
  ).get('renderProfile');
  return profile === 'desktop' || profile === 'mobile'
    ? profile
    : undefined;
};

// 桌面端使用 3400x2300；移动端/平板使用 1700x1150，像素量是前者的 1/4。
// 该档位在启动时只选择一次，不随 resize/orientation 动态切换。
// 本地 QA 可用 ?renderProfile=mobile|desktop 覆盖自动判定。
export const GAME_RENDER_PROFILE = readRenderProfileOverride()
  ?? selectGameRenderProfile(readRenderSignals());

export const getGameRenderMetrics = (
  profile: GameRenderProfile,
): GameRenderMetrics => {
  const scale = profile === 'mobile' ? MOBILE_GAME_SCALE : 1;
  return {
    profile,
    scale,
    width: Math.round(GAME_DESIGN_WIDTH * scale),
    height: Math.round(GAME_DESIGN_HEIGHT * scale),
  };
};

const GAME_RENDER_METRICS = getGameRenderMetrics(GAME_RENDER_PROFILE);
export const GAME_SCALE = GAME_RENDER_METRICS.scale;
export const GAME_WIDTH = GAME_RENDER_METRICS.width;
export const GAME_HEIGHT = GAME_RENDER_METRICS.height;
export const GAME_CENTER_X = GAME_WIDTH / 2;
export const GAME_CENTER_Y = GAME_HEIGHT / 2;

/** Convert a literal authored against the design baseline into runtime game coordinates. */
export const gameUnits = (designValue: number): number =>
  designValue * GAME_SCALE;

/** Convert a design-baseline font size into a Phaser Text CSS pixel value. */
export const gamePixels = (designPixels: number): string =>
  `${gameUnits(designPixels)}px`;

export const addGameText = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string | string[],
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text =>
  scene.add.text(x, y, text, style);
