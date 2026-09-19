export interface AssetSources {
  [assetKey: string]: string;
}

export interface AssetCollections {
  images?: AssetSources;
  imageSequences?: AssetSources;
  videos?: AssetSources;
  audios?: AssetSources;
}

export interface ImageSequenceManifest {
  schema_version: string;
  id: string;
  type: 'image_sequence';
  name: string;
  properties: {
    fps: number;
    frame_count: number;
    /** 帧文件扩展名（缺省 png，可指向 webp 等压缩格式）。 */
    extension?: string;
  };
  sources: string[];
}

export type LoadedAsset =
  | { kind: 'image'; key: string }
  | { kind: 'video'; key: string }
  | { kind: 'audio'; key: string }
  | { kind: 'image-sequence'; key: string; texture: string; animation: string };
