import Phaser from 'phaser';

import { BootScene } from './scene/BootScene';
import { DungeonScene } from './scene/DungeonScene';
import { GAME_HEIGHT, GAME_WIDTH } from './rendering';
import { seedFromSearch, setSeed } from './game/rng';
import './style.css';

/** 调试钩子开关：dev 恒开；生产构建需显式带 ?debug=1（普通玩家不会暴露 Game 实例）。 */
const DEBUG_ENABLED = (() => {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
})();

/**
 * 布局种子：?seed=<int> 可复现同一张地图（障碍物与刷怪点位置）。
 * 不带 seed 时用时间戳，正常游玩每局布局不同；自动化回归固定 seed 才能断言布局。
 */
const SEED = seedFromSearch(typeof window === 'undefined' ? '' : window.location.search);
setSeed(SEED);

const createGame = (_launchSpec?: LaunchSpec): Phaser.Game => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    pixelArt: false,
    parent: 'game',
    // 运行时单坐标系：Canvas、Scene、Camera、Pointer 与碰撞完全一致。
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#ffffff',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, DungeonScene],
  });

  // 把种子挂到 registry，回归脚本可以直接读出来核对。
  game.registry.set('seed', SEED);

  if (import.meta.env.DEV || DEBUG_ENABLED) {
    window.__YUANGI_DEBUG__ = game;
  }

  return game;
};

// 注册游戏到 PhaserBridge，可以在扣子网页游戏开发中编辑评论
if (window.PhaserBridge) {
  window.PhaserBridge.bind({ launchGame: createGame });
} else {
  createGame();
}