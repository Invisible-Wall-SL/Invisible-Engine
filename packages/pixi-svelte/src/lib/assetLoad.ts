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
	audio: ({ key, rawAsset, src }: { key: string; rawAsset: RawAudio; src: string }) => {
		// An audiosprite JSON names its own media (one entry per container) as paths written from the
		// DEPLOY ROOT — `./assets/audio/sounds.ogg` — and howler resolves those against the DOCUMENT.
		// That is the same folder only while we host the page ourselves. In a delivery the document
		// belongs to the operator and the bundle is served from a CDN, so every entry 404s and the
		// game just runs silently.
		//
		// Re-anchor them on the sprite JSON, which arrived by the same route as the media and is the
		// one url here that is certainly right. Only the FILENAME is taken, because the deploy-root
		// prefix is exactly what is wrong — and because it makes both spellings work, so a game repo
		// carrying its own older `sounds.json` needs no change. An audiosprite's media always sits
		// beside its JSON (`audiosprite` emits them together), so there is nothing else to preserve.
		// Absolute entries are somebody's deliberate url and pass through untouched.
		const beside = (entry: string) => {
			if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(entry)) return entry;
			return new URL(entry.split('/').pop() ?? entry, src).href;
		};
		const srcList = Array.isArray(rawAsset.src) ? rawAsset.src : [rawAsset.src];
		return { [key]: { ...rawAsset, src: srcList.map(beside) } };
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
