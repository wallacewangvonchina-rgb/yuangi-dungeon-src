import type { AssetSources } from './types';

const IMAGE_DIR = 'assets/image';
const SEQUENCE_DIR = 'assets/image_sequence';

const image = (key: string, version: string, file: string): string =>
  `${IMAGE_DIR}/${key}-${version}/${file}`;

/** 单图素材（立绘 / 背景）。 */
export const IMAGES: AssetSources = {
  'player-knight': image('player-knight', 'v1', 'player-knight.webp'),
  'enemy-demon': image('enemy-demon', 'v1', 'enemy-demon.webp'),
  'boss-godzilla': image('boss-godzilla', 'v1', 'boss-godzilla.webp'),
  'room-bg': image('room-bg', 'v2', 'room-bg.webp'),
};

/** 帧动画素材目录（frame_0001.png ... + manifest.json）。 */
export const IMAGE_SEQUENCES: AssetSources = {
  'coze-game-loading': `${SEQUENCE_DIR}/coze-game-loading`,
};

export const VIDEOS: AssetSources = {};

export const AUDIOS: AssetSources = {};
