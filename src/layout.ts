import Phaser from 'phaser';

import { GAME_SCALE } from './rendering';

type TextureGameObject =
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Sprite;

const assertPositiveSize = (width: number, height: number): void => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Display bounds must be positive: ${width}x${height}`);
  }
};

const fitImage = <T extends TextureGameObject>(
  gameObject: T,
  boundsWidth: number,
  boundsHeight: number,
  mode: 'contain' | 'cover',
): T => {
  assertPositiveSize(boundsWidth, boundsHeight);

  const sourceWidth = gameObject.width;
  const sourceHeight = gameObject.height;
  assertPositiveSize(sourceWidth, sourceHeight);

  const widthScale = boundsWidth / sourceWidth;
  const heightScale = boundsHeight / sourceHeight;
  const scale = mode === 'contain'
    ? Math.min(widthScale, heightScale)
    : Math.max(widthScale, heightScale);

  gameObject.setDisplaySize(
    sourceWidth * scale,
    sourceHeight * scale,
  );
  return gameObject;
};

/** Preserve aspect ratio while fitting the complete texture inside the bounds. */
export const containImage = <T extends TextureGameObject>(
  gameObject: T,
  boundsWidth: number,
  boundsHeight: number,
): T => fitImage(gameObject, boundsWidth, boundsHeight, 'contain');

/** Preserve aspect ratio while filling the bounds; overflow may be cropped. */
export const coverImage = <T extends TextureGameObject>(
  gameObject: T,
  boundsWidth: number,
  boundsHeight: number,
): T => fitImage(gameObject, boundsWidth, boundsHeight, 'cover');

/**
 * Explicit exception for textures whose native dimensions are gameplay intent
 * at the desktop design baseline. Mobile still applies GAME_SCALE so the
 * object's relative gameplay size does not change between render profiles.
 * The justification is required so validation exceptions remain reviewable.
 */
export const useNativeImageSize = <T extends TextureGameObject>(
  gameObject: T,
  justification: string,
): T => {
  if (justification.trim().length === 0) {
    throw new Error('Native image size requires a justification.');
  }
  assertPositiveSize(gameObject.width, gameObject.height);
  if (GAME_SCALE !== 1) {
    gameObject.setDisplaySize(
      gameObject.width * GAME_SCALE,
      gameObject.height * GAME_SCALE,
    );
  }
  return gameObject;
};
