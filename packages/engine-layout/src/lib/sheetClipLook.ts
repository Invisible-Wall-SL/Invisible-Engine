/**
 * A CHARACTER'S CLIP DRAWN AT A LEAN (`docs/design/character-pipeline.md` §13): the clip, or the
 * still image, of a sheet that turns smoothly (`view.turn`), drawn as `<SpawnLayer>` draws a
 * published clip (`arcadeClips.svelte.ts`) and turned by the frame's `lean` about its pivot: the
 * character's place (the sprite's anchor: the bottom centre of the clip's box at `anchorY`, the
 * sheet's `draw.feet`) or a point above it (the middle of the box). The lean is the sprite's
 * rotation, its anchor carried round the pivot; the mirror is in the sign of its scale, which is
 * applied before the rotation, so a mirrored clip leans the same way.
 *
 * A turn that BLENDS (`turn.blend`) hands a second clip, the one the facing has just left: it is
 * drawn under the first by a sprite of its own and the two are cross-faded, the clip taken
 * starting at the frame the one left had reached.
 *
 * It is mounted through the channel an online room's code looks use (`arcadeArt.svelte.ts`), as a
 * sheet's rig is (`sheetRigLook.ts`): `<SpawnLayer>` draws the mount in place of the instance's
 * own tree, and knows only that the instance has one. Its clip is therefore NOT published as a
 * clip, and `<SpawnLayer>`, which every runtime bundles, knows nothing of a lean.
 *
 * Imported only by an online room (`engine-layout/sheet-clip`), and never from the package's
 * index: only an arcade runtime carries it. This subpath alone reads `engine-flipbook` (a clip's
 * frames and its Bounds box, the two functions `<Flipbook>` draws by); the package's index still
 * does not, as `registerFlipbooks.ts` has it.
 */

import { applyClipBounds, resolveClipFrames } from 'engine-flipbook';
import { AnimatedSprite, ColorMatrixFilter, Container, Rectangle, Texture } from 'pixi.js';

import type { ArtMount } from './arcadeArt.svelte';
import type { InstanceClip } from './arcadeClips.svelte';
import { fadeAlphas, frameKept, leanedPoint } from './characterTurn';
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

/** How a clip is turned: its `lean`, radians clockwise, about the point `about` px above the
 *  character's place (absent ⇒ the place). */
/** `kept`: the clip carries on the cycle of the one drawn before (`SheetClipFrame.kept`). */
export type SheetClipTurn = { lean: number; about?: number; kept?: boolean };

export type SheetClipLook = {
	readonly mount: ArtMount;
	/**
	 * Draw `clip` (what the room would have published for the instance) turned by `turn`; `marked`
	 * is whether the room marks the player (its base clip is then drawn gold, its own as made).
	 * The clip starts again when it, its mirror, its loop or its `play` changes, and plays on the
	 * shared ticker as a published clip does. `blend` is the clip the character is turning FROM
	 * while two are mixed, and how much of `clip` is drawn (0 to 1): the two are cross-faded, and
	 * `clip` starts at the frame the other had reached.
	 */
	frame(
		clip: InstanceClip,
		turn: SheetClipTurn & {
			marked: boolean;
			blend?: { clip: InstanceClip; turn: SheetClipTurn; weight: number };
		},
	): void;
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
		/** The clip it is turning from while two are drawn, the opacity of each and the frame
		 *  each is on. */
		blend:
			| {
					from: string;
					alpha: { from: number; to: number };
					frame: { from: number; to: number };
			  }
			| undefined;
	};
	/** It is not drawn this frame: nothing shows, and the clip starts afresh when it next is, as a
	 *  published clip that went and came back does. */
	hide(): void;
	destroy(): void;
};

/** The app's state as `<Flipbook>` reads it (`pixi-svelte` `stateApp`). */
export type SheetClipApp = {
	/** Its loaded assets: a clip's frames are read off them. */
	assets(): Record<string, unknown> | undefined;
	/** Whether it has loaded: a frame missing before then is still on its way. */
	loaded(): boolean;
};

/** One clip of a look: a sprite and the clip it plays. */
function createLayer(app: SheetClipApp, reported: Set<string>) {
	// Shown with its first clip's frames: a sprite cannot be made of none.
	const sprite = new AnimatedSprite([Texture.EMPTY]);
	sprite.visible = false;
	let shown: InstanceClip | undefined;
	let entry: FlipbookClipEntry | undefined;
	let key: string | undefined;
	let frames: readonly unknown[] = [];
	let complete = false;
	// The clip's Bounds box re-stated on each frame, as `<Flipbook>` does: this look's own.
	let restated: Texture[] = [];
	let gold: ColorMatrixFilter | undefined;
	let golden = false;

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

	/** Nothing of it can be drawn yet: it is still the clip it was asked for. */
	const blank = () => {
		sprite.visible = false;
		sprite.stop();
		key = undefined;
	};
	const hide = () => {
		blank();
		shown = undefined;
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
		sprite,
		hide,
		/** The clip it shows, and whether it is the layer of `clip` as it is (its mirror, loop and
		 *  play), drawn yet or not. */
		get clip() {
			return sprite.visible ? shown : undefined;
		},
		shows(clip: InstanceClip): boolean {
			return (
				!!shown &&
				shown.clipId === clip.clipId &&
				shown.flipX === clip.flipX &&
				shown.loop === clip.loop &&
				shown.play === clip.play
			);
		},
		get golden() {
			return golden;
		},
		/**
		 * Draw `clip`. One that starts (it, its mirror, its loop or its `play` changed) starts at
		 * its first frame, or, carrying on `after`'s cycle, at the frame `after` has reached.
		 */
		draw(
			clip: InstanceClip,
			{ lean, about = 0 }: SheetClipTurn,
			marked: boolean,
			after?: { frame: number; frames: number },
		): void {
			shown = clip;
			const loaded = app.assets();
			const next = resolveFlipbook(clip.clipId);
			const frameWidth = next && firstFrameWidth(next, loaded);
			if (!next || !frameWidth) return blank();
			const drawing = sheetClipDrawing(clip, next, frameWidth);
			if (drawing.key !== key || next !== entry || !complete) {
				const resolved = resolveClipFrames(next, loaded);
				if (resolved.missing.length && !reported.has(next.id) && app.loaded()) {
					reported.add(next.id);
					console.error(
						`Flipbook "${next.id}": ${resolved.missing.length} frame(s) missing from loadedAssets — ` +
							`the animation will play SHORT. Missing: ${resolved.missing.join(', ')}`,
					);
				}
				if (!resolved.textures.length) return blank();
				// A clip that changed, or whose frames did (a sheet finished loading), starts again
				// from its first frame, playing.
				if (drawing.key !== key || next !== entry || !sameFrames(frames, resolved.textures)) {
					const old = restated;
					restated = [];
					sprite.textures = restate(resolved.textures as Texture[], next.bounds);
					for (const tex of old) tex.destroy(false);
					sprite.loop = clip.loop;
					sprite.animationSpeed = drawing.animationSpeed;
					sprite.gotoAndPlay(
						after && clip.loop ? frameKept(after.frame, after.frames, sprite.totalFrames) : 0,
					);
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
			const at = leanedPoint({ dx: 0, lift: 0 }, lean, about);
			sprite.position.set(at.dx, -at.lift);
			tint(marked && !clip.own);
		},
		destroy() {
			if (!sprite.destroyed) sprite.destroy();
			for (const tex of restated) tex.destroy(false);
			restated = [];
			gold?.destroy();
			gold = undefined;
		},
	};
}

/** A look for one character, reading its frames off `app`. */
export function createSheetClipLook(app: SheetClipApp): SheetClipLook {
	const root = new Container();
	/** The sprite of the frame's own clip, and the one a cross-fade leaves (made with the first:
	 *  a look that never fades has one sprite). */
	const reported = new Set<string>();
	let front = createLayer(app, reported);
	let back: ReturnType<typeof createLayer> | undefined;
	root.addChild(front.sprite);
	let parent: Container | undefined;
	let fading: { from: number; to: number } | undefined;

	const reached = (layer: ReturnType<typeof createLayer> | undefined) =>
		layer?.clip
			? { frame: layer.sprite.currentFrame, frames: layer.sprite.totalFrames }
			: undefined;
	const hide = () => {
		front.hide();
		back?.hide();
		fading = undefined;
	};

	return {
		mount: (into) => {
			parent = into;
			into.addChild(root);
			return () => {
				if (parent === into) parent = undefined;
				if (!root.destroyed) into.removeChild(root);
			};
		},
		frame(clip, { marked, blend, ...turn }) {
			if (!blend) {
				back?.hide();
				fading = undefined;
				front.sprite.alpha = 1;
				front.draw(clip, turn, marked, turn.kept ? reached(front) : undefined);
				return;
			}
			// The sprite that drew the clip left goes behind and plays on, and the other takes
			// the frame's at the frame it had reached. Turned back, the two change places and
			// neither starts again.
			if (!front.shows(clip)) {
				const left = front;
				front = back ?? createLayer(app, reported);
				back = left;
				root.addChild(front.sprite);
			}
			back ??= createLayer(app, reported);
			if (!back.sprite.parent) root.addChildAt(back.sprite, 0);
			front.draw(clip, turn, marked, reached(back));
			back.draw(blend.clip, blend.turn, marked, reached(front));
			// Until the clip taken can be drawn (its frames are loading), the one left is all there is.
			fading = front.clip ? fadeAlphas(blend.weight) : { from: 1, to: 0 };
			front.sprite.alpha = fading.to;
			back.sprite.alpha = fading.from;
		},
		drawn() {
			const { sprite } = front;
			const scale = Math.abs(sprite.scale.x);
			const { visible } = sprite;
			const left = fading && back?.clip;
			return {
				clipId: front.clip?.clipId,
				flipX: sprite.scale.x < 0,
				lean: sprite.rotation,
				loop: sprite.loop,
				gold: front.golden,
				mounted: parent !== undefined,
				visible,
				frames: visible ? sprite.totalFrames : 0,
				playing: sprite.playing,
				width: visible ? sprite.texture.orig.width * scale : 0,
				height: visible ? sprite.texture.orig.height * scale : 0,
				blend:
					fading && left && back
						? {
								from: left.clipId,
								alpha: fading,
								frame: { from: back.sprite.currentFrame, to: sprite.currentFrame },
							}
						: undefined,
			};
		},
		hide,
		destroy() {
			parent = undefined;
			front.destroy();
			back?.destroy();
			if (!root.destroyed) root.destroy();
		},
	};
}
