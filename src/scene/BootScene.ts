import Phaser from 'phaser';

import {
  getAssetLabelFromFileKey,
  getImageSequenceRuntimeKeys,
  loadAssets,
  loadImageSequenceManifests,
  markEditable,
  registerImageSequenceAnimations,
} from '@/utils';
import {
  addGameText,
  gamePixels,
  gameUnits,
  GAME_CENTER_X,
  GAME_CENTER_Y,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/rendering';
import { containImage } from '@/layout';

import { AUDIOS, IMAGES, IMAGE_SEQUENCES, VIDEOS } from '../assets';

interface LoaderFileLike {
  readonly key: string;
  readonly src?: string;
  readonly type?: string;
}

const LOADING_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  color: '#71717a',
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: gamePixels(72),
};

const DEV_LOADING_ASSET_KEY = 'coze-game-loading';
const devLoadingSource = IMAGE_SEQUENCES[DEV_LOADING_ASSET_KEY];

if (!devLoadingSource) {
  throw new Error(`Image sequence asset not found: ${DEV_LOADING_ASSET_KEY}`);
}

const BOOT_IMAGE_SEQUENCES = {
  [DEV_LOADING_ASSET_KEY]: devLoadingSource,
};

const BOOT_ASSETS = {
  imageSequences: BOOT_IMAGE_SEQUENCES,
};

const GAME_IMAGE_SEQUENCES = Object.fromEntries(
  Object.entries(IMAGE_SEQUENCES).filter(
    ([assetKey]) => assetKey !== DEV_LOADING_ASSET_KEY,
  ),
);

const GAME_ASSETS = {
  images: IMAGES,
  imageSequences: GAME_IMAGE_SEQUENCES,
  videos: VIDEOS,
  audios: AUDIOS,
};

export const DEV_LOADING_RUNTIME_KEYS =
  getImageSequenceRuntimeKeys(DEV_LOADING_ASSET_KEY);

export class BootScene extends Phaser.Scene {
  private loadingText?: Phaser.GameObjects.Text;
  private progressBar?: Phaser.GameObjects.Graphics;
  private progressText?: Phaser.GameObjects.Text;
  private loadFailed = false;

  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.on(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      this.onLoadError,
      this,
    );
    loadAssets(this, BOOT_ASSETS);
  }

  create(): void {
    registerImageSequenceAnimations(this, BOOT_IMAGE_SEQUENCES);
    this.createLoadingView();

    // Resolve frame counts before progress starts so its denominator stays fixed.
    if (loadImageSequenceManifests(this, GAME_IMAGE_SEQUENCES) > 0) {
      this.load.once(
        Phaser.Loader.Events.COMPLETE,
        this.startGameLoading,
        this,
      );
      this.load.start();
      return;
    }

    this.startGameLoading();
  }

  private readonly startGameLoading = (): void => {
    if (this.loadFailed) {
      this.finishLoading();
      return;
    }

    const queuedFileCount = loadAssets(this, GAME_ASSETS);
    if (queuedFileCount === 0) {
      this.finishLoading();
      return;
    }

    this.load.on(Phaser.Loader.Events.FILE_PROGRESS, this.onGameFile, this);
    this.load.on(Phaser.Loader.Events.PROGRESS, this.onProgress, this);
    this.load.once(Phaser.Loader.Events.COMPLETE, this.finishLoading, this);
    this.load.start();
  };

  private createLoadingView(): void {
    const centerX = GAME_CENTER_X;
    const centerY = GAME_CENTER_Y;

    markEditable(
      'boot.loading-mascot',
      containImage(
        this.add.sprite(
          centerX,
          centerY - gameUnits(232),
          DEV_LOADING_RUNTIME_KEYS.texture,
        ),
        GAME_WIDTH * 0.9,
        GAME_HEIGHT * 0.32,
      )
        .play(DEV_LOADING_RUNTIME_KEYS.animation),
      { label: '加载吉祥物' },
    );

    this.loadingText = markEditable(
      'boot.loading-text',
      addGameText(
        this,
        centerX,
        centerY + gameUnits(480),
        '正在加载游戏资源…',
        LOADING_TEXT_STYLE,
      ).setOrigin(0.5),
      { label: '加载状态文案' },
    );

    this.progressBar = markEditable(
      'boot.loading-progress-bar',
      this.add.graphics(),
      { label: '加载进度条' },
    );
    this.renderProgressBar(0);

    this.progressText = markEditable(
      'boot.loading-progress',
      addGameText(
        this,
        centerX,
        centerY + gameUnits(760),
        '0%',
        LOADING_TEXT_STYLE,
      ).setOrigin(0.5),
      { label: '加载进度文本' },
    );
  }

  private readonly onGameFile = (file: LoaderFileLike): void => {
    const assetLabel = getAssetLabelFromFileKey(file.key, GAME_ASSETS);
    this.loadingText?.setText(`正在加载${assetLabel}`);
  };

  private readonly onProgress = (progress: number): void => {
    this.renderProgressBar(progress);
    this.progressText?.setText(`${Math.round(progress * 100)}%`);
  };

  private readonly onLoadError = (file: LoaderFileLike): void => {
    this.loadFailed = true;
    const assetLabel = getAssetLabelFromFileKey(file.key, GAME_ASSETS);
    const details = [
      `key: ${file.key}`,
      file.type ? `type: ${file.type}` : undefined,
      file.src ? `url: ${file.src}` : undefined,
    ]
      .filter((detail): detail is string => Boolean(detail))
      .join(', ');
    console.error(`Phaser 资源加载失败：${assetLabel}（${details}）`);
    this.loadingText?.setText(`${assetLabel}加载失败`);
  };

  private renderProgressBar(progress: number): void {
    if (!this.progressBar) {
      return;
    }

    const centerX = GAME_CENTER_X;
    const centerY = GAME_CENTER_Y;
    const width = gameUnits(1200);
    const height = gameUnits(56);
    const x = centerX - width / 2;
    const y = centerY + gameUnits(616);
    const padding = gameUnits(12);
    const innerWidth = width - padding * 2;
    const filledWidth = Phaser.Math.Clamp(progress, 0, 1) * innerWidth;

    this.progressBar.clear();
    this.progressBar.fillStyle(0x102536, 0.12);
    this.progressBar.fillRoundedRect(x, y, width, height, height / 2);
    this.progressBar.lineStyle(gameUnits(8), 0x102536, 0.28);
    this.progressBar.strokeRoundedRect(x, y, width, height, height / 2);

    if (filledWidth <= 0) {
      return;
    }

    this.progressBar.fillStyle(0xef648d, 1);
    this.progressBar.fillRoundedRect(
      x + padding,
      y + padding,
      filledWidth,
      height - padding * 2,
      (height - padding * 2) / 2,
    );

    this.progressBar.fillStyle(0x165ca8, 1);
    this.progressBar.fillCircle(
      Phaser.Math.Clamp(
        x + padding + filledWidth,
        x + padding + gameUnits(20),
        x + width - padding - gameUnits(20),
      ),
      y + height / 2,
      gameUnits(20),
    );
  }

  private readonly finishLoading = (): void => {
    this.removeLoaderListeners();

    if (this.loadFailed) {
      this.progressText?.setText('请刷新页面重试');
      return;
    }

    registerImageSequenceAnimations(this, GAME_IMAGE_SEQUENCES);
    this.scene.start('dungeon');
  };

  private removeLoaderListeners(): void {
    this.load.off(Phaser.Loader.Events.FILE_PROGRESS, this.onGameFile, this);
    this.load.off(Phaser.Loader.Events.PROGRESS, this.onProgress, this);
    this.load.off(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      this.onLoadError,
      this,
    );
    this.load.off(Phaser.Loader.Events.COMPLETE, this.finishLoading, this);
  }
}
