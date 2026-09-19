import type Phaser from 'phaser';

export interface MarkEditableOptions {
  label?: string;
  assetTarget?: Phaser.GameObjects.GameObject;
}

export const markEditable = <T extends Phaser.GameObjects.GameObject>(
  locator: string,
  gameObject: T,
  options?: MarkEditableOptions,
): T =>
  window.PhaserBridge?.markEditable?.(locator, gameObject, options) ??
  gameObject;
