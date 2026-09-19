import { GAME_HEIGHT, GAME_WIDTH, gameUnits } from '../rendering';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UiLayout {
  hud: { top: number; left: number; right: number; bottom: number };
  hpBar: Rect;
  levelText: { x: number; y: number };
  coins: { x: number; y: number; radius: number };
  skillRow: { y: number; fontSize: number };
  joystick: { x: number; y: number; radius: number };
  center: { x: number; y: number };
  panel: Rect;
}

/**
 * 集中式 UI 布局：所有固定屏幕 UI 的坐标都从这里推导，
 * 场景代码只消费本函数返回的矩形，不复制第二套绝对坐标。
 */
export const createUiLayout = (): UiLayout => {
  const margin = gameUnits(60);
  const top = margin;
  const left = margin;
  const right = GAME_WIDTH - margin;
  const bottom = GAME_HEIGHT - margin;
  const center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };

  const hpBar: Rect = {
    x: left,
    y: top,
    w: gameUnits(620),
    h: gameUnits(72),
  };

  return {
    hud: { top, left, right, bottom },
    hpBar,
    levelText: { x: GAME_WIDTH / 2, y: top + gameUnits(40) },
    coins: {
      x: right - gameUnits(60),
      y: top + gameUnits(44),
      radius: gameUnits(44),
    },
    skillRow: { y: bottom - gameUnits(100), fontSize: gameUnits(60) },
    joystick: {
      x: left + gameUnits(220),
      y: GAME_HEIGHT - gameUnits(220),
      radius: gameUnits(150),
    },
    center,
    panel: {
      x: center.x - gameUnits(980),
      y: center.y - gameUnits(460),
      w: gameUnits(1960),
      h: gameUnits(920),
    },
  };
};
