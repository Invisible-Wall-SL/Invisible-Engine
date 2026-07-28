import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
import { BitmapFont, Cache } from 'pixi.js';
import type { RawType, RawAsset, RawSpine, RawSprites, SpineSrc, RawAudio } from './types';
import { setSpineLoadScale } from './spineLoadScale';

const PROCESS_METHOD_MAP = {
	spine: ({ key, rawAsset, src }: { key: string; rawAsset: RawSpine; src: SpineSrc }) => {
		const atlasAsset = rawAsset[src.atlas] as SPINE_PIXI.TextureAtlas;
		const skeletonAsset = rawAsset[src.skeleton] as Uint8Array;
		const attachmentLoader = new SPINE_PIXI.AtlasAttachmentLoader(atlasAsset);
		const parser =
			skeletonAsset instanceof Uint8Array
				? new SPINE_PIXI.SkeletonBinary(attachmentLoader)
				: new SPINE_PIXI.SkeletonJson(attachmentLoader);
		const scale = src?.scale ?? 1;
		parser.scale = scale;
		// Remember it: the skeleton's `data.width/height` come through UNSCALED, so nothing
		// downstream can infer the load scale from the loaded data (see `spineLoadScale.ts`).
		setSpineLoadScale(key, scale);
		const skeletonData = parser.readSkeletonData(skeletonAsset);

		return { [key]: skeletonData };
	},
	sprite: ({ key, rawAsset }: { key: string; rawAsset: RawSprites }) => ({ [key]: rawAsset }),
	// A `namespace` registers each frame BOTH bare and under `<namespace><frame>`,
	// so a sheet scoped by its manifest can't collide with another sheet that reuses
	// a frame name, while the bare key preserves back-compat for un-scoped lookups.
	sprites: ({ rawAsset, namespace }: { rawAsset: RawSprites; namespace?: string }) => {
		if (!namespace) return rawAsset.textures;
		const out: RawSprites['textures'] = {};
		for (const [name, texture] of Object.entries(rawAsset.textures)) {
			out[name] = texture;
			out[`${namespace}${name}`] = texture;
		}
		return out;
	},
	spriteSheet: ({ key, rawAsset }: { key: string; rawAsset: RawSprites }) => ({
		[key]: Object.values(rawAsset.textures),
	}),
	audio: ({ key, rawAsset }: { key: string; rawAsset: RawAudio }) => {
		return { [key]: rawAsset };
	},
} as const;

export const getProcessed = ({
	key,
	type,
	rawAsset,
	src,
	namespace,
	family,
}: {
	key: string;
	type: RawType;
	rawAsset: RawAsset;
	src: string | SpineSrc;
	namespace?: string;
	family?: string;
}) => {
	if (type === 'font') {
		// pixi's font loader already cached the `BitmapFont` under its `<info face>`, but
		// several fonts can share one face (gradient variants). When the asset declares an
		// explicit `family` (its unique id), ALSO register it under `${family}-bitmap` so
		// each variant resolves independently — the key `<BitmapText fontFamily={id}>` uses.
		if (family && rawAsset instanceof BitmapFont) Cache.set(`${family}-bitmap`, rawAsset);
		return; // No processed asset to add to the loaded-assets map.
	}
	const processMethod = PROCESS_METHOD_MAP[type];
	if (!processMethod)
		throw Error('No asset process method found, please check the type of the asset.');
	// @ts-expect-error
	return processMethod({ key, rawAsset, src, namespace });
};
