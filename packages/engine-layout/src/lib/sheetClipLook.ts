/**
 * A CHARACTER'S CLIP DRAWN AT A LEAN (`docs/design/character-pipeline.md` §13): the clip, or the
 * still image, of a sheet that turns smoothly (`view.turn`), drawn as `<SpawnLayer>` draws a
 * published clip (`arcadeClips.svelte.ts`) and turned by the frame's `lean` about the character's
 * place. That place is the sprite's anchor (the bottom centre of the clip's box at `anchorY`, the
 * sheet's `draw.feet`), so the lean is the sprite's rotation; the mirror is in the sign of its
 * scale, which is applied before the rotation, so a mirrored clip leans the same way.
 *
 * It is mounted through the channel an online room's code looks use (`arcadeArt.svelte.ts`), as a
 * sheet's rig is (`sheetRigLook.ts`): `<SpawnLayer>` draws the mount in place of the instance's
 * own tree, and knows only that the instance has one. Its clip is therefore NOT published as a
 * clip, and `<SpawnLayer>`, which every runtime bundles, knows nothing of a lean.
 *
 * Imported only by an online room (`engine-layout/sheet-clip`), and never from the package's
 * index: only an arcade runtime carries it.
 */

import { applyClipBounds, resolveClipFrames } from 'engine-flipbook';
import { AnimatedSprite, ColorMatrixFilter, Rectangle, Texture, type Container } from 'pixi.js';

import type { ArtMount } from './arcadeArt.svelte';
import type { InstanceClip } from './arcadeClips.svelte';
import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
import { resolveFlipbook, type FlipbookClipEntry } from './registerFlipbooks';

/** A clip's frames a second when it names none (`pixi-svelte` `Flipbook.svelte` `DEFAULT_FPS`). */
const DEFAULT_FPS = 24;

/**
 * A marked player's base clip, gold: each colour channel from the brightness
 * (0.3 r + 0.59 g + 0.11 b), on a ramp to gold. THE TWIN OF `SpawnLayer.svelte` `goldFilters`,
 * which this look stands in for; `scripts/check-character-turn.mjs` holds the two equal.
 */
export const SHEET_CLIP_GOLD = [
	0.435, 0.856, 0.16, 0, 0, 0.36, 0.708, 0.132, 0, 0, 0.114, 0.224, 0.042, 0, 0, 0, 0, 0, 1, 0,
] as const;

/** A clip as published and as its registered entry reads, in the terms the sprite is drawn in. */
export type SheetClipDrawing = {
	/** What starts the clip again when it changes (`<SpawnLayer>`'s `{#key}`). */
	key: string;
	/** Drawn mirrored: the published mirror over the clip's own. */
	flipX: boolean;
	flipY: boolean;
	/** The scale that draws the clip's box `width` wide, before any mirror. */
	scale: number;
	animationSpeed: number;
};

/**
 * How `<SpawnLayer>` and `<Flipbook>` draw `clip`, whose registered entry is `entry` and whose
 * first frame is `frameWidth` wide. Pure: the gate runs it beside the look.
 */
export function sheetClipDrawing(
	clip: InstanceClip,
	entry: Pick<FlipbookClipEntry, 'bounds' | 'flipX' | 'flipY' | 'fps'>,
	frameWidth: number,
): SheetClipDrawing {
	const natural = entry.bounds && entry.bounds.w > 0 ? entry.bounds.w : frameWidth;
	return {
		key: `${clip.clipId}|${clip.flipX}|${clip.loop}|${clip.play}`,
		flipX: (entry.flipX === true) !== clip.flipX,
		flipY: entry.flipY === true,
		scale: clip.width / natural,
		animationSpeed: (entry.fps ?? DEFAULT_FPS) / 60,
	};
}

/** How wide a clip's first frame is, or `undefined` until it is loaded: `<SpawnLayer>` draws a
 *  clip from then on (its `firstFrameWidth`). */
function firstFrameWidth(
	clip: FlipbookClipEntry,
	assets: Record<string, unknown> | undefined,
): number | undefined {
	const first = clip.frames[0];
	if (!first) return undefined;
	const { assetKey, region } = parseScopedFrameRef(first);
	const sheet = assetKey ?? clip.assetKey;
	const scoped = isManifestAssetKey(sheet)
		? assets?.[editorArtTextureKey(sheet, region)]
		: undefined;
	return ((scoped ?? assets?.[region]) as { width?: number } | undefined)?.width;
}

const sameFrames = (a: readonly unknown[], b: readonly unknown[]) =>
	a.length === b.length && a.every((frame, i) => frame === b[i]);

export type SheetClipLook = {
	readonly mount: ArtMount;
	/**
	 * Draw `clip` (what the room would have published for the instance) turned by `lean`, radians
	 * clockwise; `marked` is whether the room marks the player (its base clip is then drawn gold,
	 * its own as made). The clip starts again when it, its mirror, its loop or its `play` changes,
	 * and plays on the shared ticker as a published clip does.
	 */
	frame(clip: InstanceClip, turn: { lean: number; marked: boolean }): void;
	/** What it draws now (the probe's). */
	drawn(): {
		clipId: string | undefined;
		/** Mirrored as drawn: the sign of the sprite's x scale. */
		flipX: boolean;
		/** The rotation it is drawn at, radians; 0 upright. */
		lean: number;
		loop: boolean;
		gold: boolean;
		mounted: boolean;
		/** Whether its frames are loaded: until then it draws nothing. */
		visible: boolean;
		frames: number;
		playing: boolean;
		/** Its box as drawn, px. */
		width: number;
		height: number;
	};
	destroy(): void;
};

/**
 * A look for one character, reading its frames off `assets` (the app's loaded assets, as
 * `<Flipbook>` reads them).
 */
export function createSheetClipLook(
	assets: () => Record<string, unknown> | undefined,
): SheetClipLook {
	// Shown with its first clip's frames: a sprite cannot be made of none.
	const sprite = new AnimatedSprite([Texture.EMPTY]);
	sprite.visible = false;
	let parent: Container | undefined;
	let shown: InstanceClip | undefined;
	let entry: FlipbookClipEntry | undefined;
	let key: string | undefined;
	let frames: readonly unknown[] = [];
	let complete = false;
	// The clip's Bounds box re-stated on each frame, as `<Flipbook>` does: this look's own.
	let restated: Texture[] = [];
	let gold: ColorMatrixFilter | undefined;
	let golden = false;
	const reported = new Set<string>();

	const restate = (list: Texture[], bounds: FlipbookClipEntry['bounds']): Texture[] => {
		if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return list;
		return list.map((tex) => {
			const orig = tex?.orig;
			if (!orig) return tex;
			const trim = tex.trim ?? orig;
			const box = applyClipBounds(
				{
					origW: orig.width,
					origH: orig.height,
					offX: trim.x,
					offY: trim.y,
					artW: trim.width,
					artH: trim.height,
				},
				bounds,
			);
			const made = new Texture({
				source: tex.source,
				frame: tex.frame,
				rotate: tex.rotate,
				orig: new Rectangle(0, 0, box.origW, box.origH),
				trim: new Rectangle(box.offX, box.offY, box.artW, box.artH),
				label: tex.label,
			});
			restated.push(made);
			return made;
		});
	};

	const hide = () => {
		sprite.visible = false;
		sprite.stop();
		key = undefined;
	};

	const tint = (on: boolean) => {
		if (on === golden) return;
		golden = on;
		if (on && !gold) {
			gold = new ColorMatrixFilter();
			gold.matrix = [...SHEET_CLIP_GOLD];
		}
		sprite.filters = on && gold ? [gold] : [];
	};

	return {
		mount: (into) => {
			parent = into;
			into.addChild(sprite);
			return () => {
				if (parent === into) parent = undefined;
				if (!sprite.destroyed) into.removeChild(sprite);
			};
		},
		frame(clip, { lean, marked }) {
			shown = clip;
			const loaded = assets();
			const next = resolveFlipbook(clip.clipId);
			const frameWidth = next && firstFrameWidth(next, loaded);
			if (!next || !frameWidth) return hide();
			const drawing = sheetClipDrawing(clip, next, frameWidth);
			if (drawing.key !== key || next !== entry || !complete) {
				const resolved = resolveClipFrames(next, loaded);
				if (resolved.missing.length && !reported.has(next.id)) {
					reported.add(next.id);
					console.error(
						`Flipbook "${next.id}": ${resolved.missing.length} frame(s) missing from loadedAssets — ` +
							`the animation will play SHORT. Missing: ${resolved.missing.join(', ')}`,
					);
				}
				if (!resolved.textures.length) return hide();
				// A clip that changed, or whose frames did (a sheet finished loading), starts again
				// from its first frame, playing.
				if (drawing.key !== key || next !== entry || !sameFrames(frames, resolved.textures)) {
					const old = restated;
					restated = [];
					sprite.textures = restate(resolved.textures as Texture[], next.bounds);
					for (const tex of old) tex.destroy(false);
					sprite.loop = clip.loop;
					sprite.animationSpeed = drawing.animationSpeed;
					sprite.gotoAndPlay(0);
				}
				key = drawing.key;
				entry = next;
				frames = resolved.textures;
				complete = resolved.missing.length === 0;
			}
			sprite.visible = true;
			sprite.anchor.set(0.5, clip.anchorY);
			sprite.scale.set(
				drawing.flipX ? -drawing.scale : drawing.scale,
				drawing.flipY ? -drawing.scale : drawing.scale,
			);
			sprite.rotation = lean;
			tint(marked && !clip.own);
		},
		drawn() {
			const scale = Math.abs(sprite.scale.x);
			const { visible } = sprite;
			return {
				clipId: visible ? shown?.clipId : undefined,
				flipX: sprite.scale.x < 0,
				lean: sprite.rotation,
				loop: sprite.loop,
				gold: golden,
				mounted: parent !== undefined,
				visible,
				frames: visible ? sprite.totalFrames : 0,
				playing: sprite.playing,
				width: visible ? sprite.texture.orig.width * scale : 0,
				height: visible ? sprite.texture.orig.height * scale : 0,
			};
		},
		destroy() {
			parent = undefined;
			if (!sprite.destroyed) sprite.destroy();
			for (const tex of restated) tex.destroy(false);
			restated = [];
			gold?.destroy();
			gold = undefined;
		},
	};
}
