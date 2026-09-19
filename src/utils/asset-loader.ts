import type Phaser from 'phaser';

import { AUDIOS, IMAGES, IMAGE_SEQUENCES, VIDEOS } from '../assets';
import type {
  AssetCollections,
  AssetSources,
  ImageSequenceManifest,
  LoadedAsset,
} from '../types';

const FRAME_KEY_MARKER = ':frame:';
const MANIFEST_KEY_SUFFIX = ':manifest';

const getFrameKey = (assetKey: string, frameIndex: number): string =>
  `${assetKey}${FRAME_KEY_MARKER}${String(frameIndex + 1).padStart(4, '0')}`;

const getManifestKey = (assetKey: string): string =>
  `${assetKey}${MANIFEST_KEY_SUFFIX}`;

const DEFAULT_FRAME_EXTENSION = 'png';

const getFrameSource = (
  directory: string,
  frameIndex: number,
  extension: string,
): string =>
  `${directory}/frame_${String(frameIndex + 1).padStart(4, '0')}.${extension}`;

export const resolveAssetUrl = (source: string): string =>
  new URL(source, document.baseURI).href;

const isImageSequenceManifest = (
  value: unknown,
): value is ImageSequenceManifest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<ImageSequenceManifest>;
  return (
    manifest.type === 'image_sequence' &&
    typeof manifest.name === 'string' &&
    typeof manifest.properties?.fps === 'number' &&
    typeof manifest.properties.frame_count === 'number' &&
    manifest.properties.frame_count > 0
  );
};

const getImageSequenceManifest = (
  scene: Phaser.Scene,
  assetKey: string,
): ImageSequenceManifest => {
  const manifest: unknown = scene.cache.json.get(getManifestKey(assetKey));
  if (!isImageSequenceManifest(manifest)) {
    throw new Error(`Invalid image sequence manifest: ${assetKey}`);
  }

  return manifest;
};

const queueImageSequenceFrames = (
  scene: Phaser.Scene,
  assetKey: string,
  directory: string,
  manifest: ImageSequenceManifest,
): void => {
  const extension = manifest.properties.extension ?? DEFAULT_FRAME_EXTENSION;
  Array.from(
    { length: manifest.properties.frame_count },
    (_value, frameIndex) => {
      scene.load.image(
        getFrameKey(assetKey, frameIndex),
        resolveAssetUrl(getFrameSource(directory, frameIndex, extension)),
      );
    },
  );
};

const queueImageSequenceManifest = (
  scene: Phaser.Scene,
  assetKey: string,
  directory: string,
  onLoaded?: (manifest: ImageSequenceManifest) => void,
): void => {
  const manifestKey = getManifestKey(assetKey);
  scene.load.once(
    `filecomplete-json-${manifestKey}`,
    (_key: string, _type: string, data: unknown) => {
      if (!isImageSequenceManifest(data)) {
        throw new Error(`Invalid image sequence manifest: ${assetKey}`);
      }
      onLoaded?.(data);
    },
  );
  scene.load.json(
    manifestKey,
    resolveAssetUrl(`${directory}/manifest.json`),
  );
};

const queueImages = (scene: Phaser.Scene, images: AssetSources): number => {
  Object.entries(images).forEach(([assetKey, source]) => {
    scene.load.image(assetKey, resolveAssetUrl(source));
  });
  return Object.keys(images).length;
};

const queueVideos = (scene: Phaser.Scene, videos: AssetSources): number => {
  Object.entries(videos).forEach(([assetKey, source]) => {
    scene.load.video(assetKey, resolveAssetUrl(source));
  });
  return Object.keys(videos).length;
};

const queueAudios = (scene: Phaser.Scene, audios: AssetSources): number => {
  Object.entries(audios).forEach(([assetKey, source]) => {
    scene.load.audio(assetKey, resolveAssetUrl(source));
  });
  return Object.keys(audios).length;
};

const queueImageSequences = (
  scene: Phaser.Scene,
  imageSequences: AssetSources,
): number => {
  return Object.entries(imageSequences).reduce(
    (fileCount, [assetKey, directory]) => {
      const manifestKey = getManifestKey(assetKey);
      const cachedManifest: unknown = scene.cache.json.get(manifestKey);

      if (isImageSequenceManifest(cachedManifest)) {
        queueImageSequenceFrames(
          scene,
          assetKey,
          directory,
          cachedManifest,
        );
        return fileCount + cachedManifest.properties.frame_count;
      }

      queueImageSequenceManifest(scene, assetKey, directory, manifest => {
        queueImageSequenceFrames(scene, assetKey, directory, manifest);
      });
      return fileCount + 1;
    },
    0,
  );
};

export const loadImageSequenceManifests = (
  scene: Phaser.Scene,
  imageSequences: AssetSources,
): number =>
  Object.entries(imageSequences).reduce((fileCount, [assetKey, directory]) => {
    const cachedManifest = scene.cache.json.get(getManifestKey(assetKey));
    if (isImageSequenceManifest(cachedManifest)) {
      return fileCount;
    }

    queueImageSequenceManifest(scene, assetKey, directory);
    return fileCount + 1;
  }, 0);

export const loadAssets = (
  scene: Phaser.Scene,
  collections: AssetCollections,
): number =>
  queueImages(scene, collections.images ?? {}) +
  queueImageSequences(scene, collections.imageSequences ?? {}) +
  queueVideos(scene, collections.videos ?? {}) +
  queueAudios(scene, collections.audios ?? {});

export const getImageSequenceRuntimeKeys = (
  assetKey: string,
): { texture: string; animation: string } => ({
  texture: getFrameKey(assetKey, 0),
  animation: assetKey,
});

export const getAssetKeyFromFileKey = (fileKey: string): string =>
  fileKey.split(FRAME_KEY_MARKER)[0]?.replace(MANIFEST_KEY_SUFFIX, '') ??
  fileKey;

export const getAssetLabelFromFileKey = (
  fileKey: string,
  collections: AssetCollections,
): string => {
  const assetKey = getAssetKeyFromFileKey(fileKey);

  if (assetKey in (collections.images ?? {})) {
    return `图片 ${assetKey}`;
  }
  if (assetKey in (collections.imageSequences ?? {})) {
    return `帧动画 ${assetKey}`;
  }
  if (assetKey in (collections.videos ?? {})) {
    return `视频 ${assetKey}`;
  }
  if (assetKey in (collections.audios ?? {})) {
    return `音频 ${assetKey}`;
  }

  return assetKey;
};

export const registerImageSequenceAnimations = (
  scene: Phaser.Scene,
  imageSequences: AssetSources,
): void => {
  Object.keys(imageSequences).forEach(assetKey => {
    const manifest = getImageSequenceManifest(scene, assetKey);
    const animationKey = getImageSequenceRuntimeKeys(assetKey).animation;
    if (scene.anims.exists(animationKey)) {
      return;
    }

    scene.anims.create({
      key: animationKey,
      frames: Array.from(
        { length: manifest.properties.frame_count },
        (_value, frameIndex) => ({ key: getFrameKey(assetKey, frameIndex) }),
      ),
      frameRate: manifest.properties.fps,
      repeat: -1,
    });
  });
};

const findAsset = (
  assetKey: string,
): { collections: AssetCollections; loadedAsset: LoadedAsset } => {
  const matches: Array<{
    collections: AssetCollections;
    loadedAsset: LoadedAsset;
  }> = [];

  if (Object.hasOwn(IMAGES, assetKey)) {
    matches.push({
      collections: { images: { [assetKey]: IMAGES[assetKey] } },
      loadedAsset: { kind: 'image', key: assetKey },
    });
  }
  if (Object.hasOwn(IMAGE_SEQUENCES, assetKey)) {
    matches.push({
      collections: {
        imageSequences: { [assetKey]: IMAGE_SEQUENCES[assetKey] },
      },
      loadedAsset: {
        kind: 'image-sequence',
        key: assetKey,
        ...getImageSequenceRuntimeKeys(assetKey),
      },
    });
  }
  if (Object.hasOwn(VIDEOS, assetKey)) {
    matches.push({
      collections: { videos: { [assetKey]: VIDEOS[assetKey] } },
      loadedAsset: { kind: 'video', key: assetKey },
    });
  }
  if (Object.hasOwn(AUDIOS, assetKey)) {
    matches.push({
      collections: { audios: { [assetKey]: AUDIOS[assetKey] } },
      loadedAsset: { kind: 'audio', key: assetKey },
    });
  }

  if (matches.length === 0) {
    throw new Error(`Asset not found: ${assetKey}`);
  }
  if (matches.length > 1) {
    throw new Error(`Duplicate asset key: ${assetKey}`);
  }

  return matches[0];
};

const isAssetLoaded = (
  scene: Phaser.Scene,
  loadedAsset: LoadedAsset,
): boolean => {
  switch (loadedAsset.kind) {
    case 'image':
      return scene.textures.exists(loadedAsset.key);
    case 'image-sequence':
      return scene.anims.exists(loadedAsset.animation);
    case 'video':
      return scene.cache.video.exists(loadedAsset.key);
    case 'audio':
      return scene.cache.audio.exists(loadedAsset.key);
  }
};

interface LoaderFileLike {
  key: string;
}

export const loadAsset = async (
  scene: Phaser.Scene,
  assetKey: string,
): Promise<LoadedAsset> => {
  const { collections, loadedAsset } = findAsset(assetKey);
  if (isAssetLoaded(scene, loadedAsset)) {
    return loadedAsset;
  }

  return new Promise<LoadedAsset>((resolve, reject) => {
    const cleanup = (): void => {
      scene.load.off('complete', onComplete);
      scene.load.off('loaderror', onLoadError);
    };

    const onComplete = (): void => {
      cleanup();
      try {
        if (loadedAsset.kind === 'image-sequence') {
          registerImageSequenceAnimations(
            scene,
            collections.imageSequences ?? {},
          );
        }
        resolve(loadedAsset);
      } catch (error) {
        reject(error);
      }
    };

    const onLoadError = (file: LoaderFileLike): void => {
      if (getAssetKeyFromFileKey(file.key) !== assetKey) {
        return;
      }

      cleanup();
      reject(new Error(`Failed to load asset: ${assetKey}`));
    };

    scene.load.once('complete', onComplete);
    scene.load.on('loaderror', onLoadError);

    try {
      loadAssets(scene, collections);
      if (!scene.load.isLoading()) {
        scene.load.start();
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
};
