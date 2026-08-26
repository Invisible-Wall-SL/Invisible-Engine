import type * as PIXI from 'pixi.js';
import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

export type PixiPoint = PIXI.PointData | number | undefined;

export type Sizes = {
	width: number;
	height: number;
};

export type LoadedSpine = SPINE_PIXI.SkeletonData;
export type LoadedFont = PIXI.BitmapFont;
export type LoadedSprite = PIXI.Texture;
export type LoadedSpriteSheet = PIXI.Texture[];
export type LoadedAudio<TSoundName extends string> = {
	src: string | string[];
	sprite: {
		[name: string]: [number, number] | [number, number, boolean];
	};
	config: Record<TSoundName, { volume: number }>;
	/**
	 * Howler's explicit codec list, parallel to `src`. Absent ⇒ howler sniffs the extension itself,
	 * which is right for a plain path and is what the shipped audiosprite has always relied on.
	 * A bank whose URL carries its filename in a QUERY STRING must declare it — see
	 * `utils-sound/banks.ts` → `soundFormatsFor`.
	 */
	format?: string[];
};
export type LoadedAsset = LoadedSpine | LoadedSprite | LoadedSpriteSheet | LoadedAudio<string>;
export type LoadedAssets = PIXI.Dict<LoadedAsset>;

export type RawAudio = LoadedAudio<string>;
export type RawSpine = PIXI.Dict<SPINE_PIXI.TextureAtlas | Uint8Array>;
export type RawSprite = LoadedSprite;
export type RawSprites = { textures: PIXI.Dict<LoadedSprite> };
export type RawSpriteSheet = { textures: PIXI.Dict<LoadedSprite> };
export type RawAsset = RawSpine | RawSprite | RawSprites | RawSpriteSheet | RawAudio;
export type RawType = 'spine' | 'sprite' | 'sprites' | 'spriteSheet' | 'font' | 'audio';

export type SpineSrc = { skeleton: string; atlas: string; scale?: number };
export type Asset = {
	type: RawType;
	src: string | SpineSrc;
	preload?: boolean;
	/** `sprites` only: a key prefix prepended to every frame's `loadedAssets` entry
	 * (in addition to the bare frame name), so two sheets that reuse a frame name
	 * don't clobber each other in the flat map. Used by editor-art registration to
	 * scope each sheet by its manifest. See engine-layout `editorArtKey.ts`. */
	namespace?: string;
	/** `font` only: register the loaded `BitmapFont` under `` `${family}-bitmap` `` in
	 * addition to pixi's own `<info face>` key. Lets several fonts that share one face
	 * (gradient variants) each resolve by a UNIQUE family. See engine-layout
	 * `bakedFontAssets` (passes the font's `id`). */
	family?: string;
};
export type Assets = PIXI.Dict<Asset>;

export type ParticleSpawnOption =
	| { type: 'rect'; spawnRect: { x: number; y: number; w: number; h: number } }
	| { type: 'burst'; particlesPerWave: number; particleSpacing: number; angleStart: number }
	| { type: 'circle'; spawnCircle: { x: number; y: number; r: number } }
	| { type: 'point' }
	| { type: 'ring'; spawnCircle: { x: number; y: number; r: number; minR: number } };

export type ValueOption = { value: number; time: number };
export type ParticleSpeedOption = {
	list: ValueOption[];
};
export type ParticleScaleOption = {
	list: ValueOption[];
};

export type BlendModes = 'none' | 'add' | 'multiply' | 'screen';

export type Cursor =
	| 'auto'
	| 'default'
	| 'none'
	| 'context-menu'
	| 'help'
	| 'pointer'
	| 'progress'
	| 'wait'
	| 'cell'
	| 'crosshair'
	| 'text'
	| 'vertical-text'
	| 'alias'
	| 'copy'
	| 'move'
	| 'no-drop'
	| 'not-allowed'
	| 'grab'
	| 'grabbing'
	| 'e-resize'
	| 'n-resize'
	| 'ne-resize'
	| 'nw-resize'
	| 's-resize'
	| 'se-resize'
	| 'sw-resize'
	| 'w-resize'
	| 'ew-resize'
	| 'ns-resize'
	| 'nesw-resize'
	| 'nwse-resize'
	| 'col-resize'
	| 'row-resize'
	| 'all-scroll'
	| 'zoom-in'
	| 'zoom-ou';

export type EmitterEventBase = {
	type: string;
};

export type GetConstructorArgs<T> = T extends new (...args: infer U) => any ? U : never;

export type OverwriteCursor<T> = Partial<T> & { cursor?: Cursor };
