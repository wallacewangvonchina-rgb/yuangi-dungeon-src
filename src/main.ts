import Phaser from 'phaser';

import { BootScene } from './scene/BootScene';
import { DungeonScene } from './scene/DungeonScene';
import { GAME_HEIGHT, GAME_WIDTH } from './rendering';
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
