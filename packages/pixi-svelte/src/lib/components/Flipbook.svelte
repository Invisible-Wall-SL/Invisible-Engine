<script lang="ts" module>
	import type * as PIXI from 'pixi.js';

	import type { OverwriteCursor } from '../types';

	/** One authored clip — structurally `engine-flipbook`'s `FlipbookClip` / `engine-layout`'s
	 * `FlipbookClipEntry`. Declared structurally so `pixi-svelte` gains no dependency on either
	 * (the same reason `EffectLayer` inlines the editor-art key scheme). */
	export type FlipbookClip = {
		id: string;
		assetKey: string;
		frames: string[];
		fps?: number;
		loop?: boolean;
		/** How the authored frames are walked — `engine-flipbook`'s `FlipbookDirection`. */
		direction?: 'forward' | 'reverse' | 'pingpong';
		flipX?: boolean;
		flipY?: boolean;
		/** The clip's declared box — `engine-flipbook`'s `FlipbookBounds`. Art pixels, top-left
		 * relative to the clip origin. */
		bounds?: { x: number; y: number; w: number; h: number };
	};

	export type Props = Omit<OverwriteCursor<PIXI.AnimatedSpriteOptions>, 'textures'> & {
		/** The resolved clip. Callers look it up (`resolveFlipbook(clipId)`) and pass it in, so
		 * the registry stays in `engine-layout` — mirroring how `EffectLayer` takes a layer. */
		clip: FlipbookClip;
		/** Absent ⇒ playing. */
		play?: boolean;
	};
</script>

<script lang="ts">
	import { Rectangle, Texture } from 'pixi.js';
	import { applyClipBounds, resolveClipFrames } from 'engine-flipbook';

	import AnimatedSprite from './AnimatedSprite.svelte';
	import { getContextApp } from '../context.svelte';

	const props: Props = $props();
	const context = getContextApp();

	// `clip` must NOT reach <AnimatedSprite>: `propsSyncEffect` assigns every prop key straight
	// onto the PIXI object, so spreading it would stamp a stray `.clip` on the sprite.
	const { clip, play, ...spriteProps }: Props = $derived(props);

	// Mirroring is the clip's, and is deliberately NOT a per-placement prop here: a caller that
	// wants to override it folds its own value into the `clip` object it passes (which is exactly
	// what `LayoutNodeView` does for `fps`/`loop`), so there is one answer per rendered clip
	// rather than two that can disagree.
	const flipX = $derived(clip.flipX === true);
	const flipY = $derived(clip.flipY === true);

	/** PIXI advances `currentFrame` by `animationSpeed` per 60Hz-normalized tick, so a clip's
	 * frames-per-second is `fps / 60`. Absent fps ⇒ 24, matching `DEFAULT_FLIPBOOK_FPS`
	 * (duplicated as a literal rather than imported, to keep this package dependency-free). */
	const DEFAULT_FPS = 24;
	const animationSpeed = $derived((clip.fps ?? DEFAULT_FPS) / 60);

	// `resolveClipFrames` owns the editor-art scoped→bare key precedence, the
	// no-whole-sheet-fallback rule AND the `direction` walk — the texture array IS the playback
	// order, so `AnimatedSprite` needs no direction-aware clock of its own. It lives in
	// `engine-flipbook` (pure, texture-agnostic) so those contracts are covered by an offline
	// fixture rather than only in a browser.
	const resolved = $derived(
		resolveClipFrames(clip, context.stateApp.loadedAssets as Record<string, unknown> | undefined),
	);
	const resolvedTextures = $derived(resolved.textures as Texture[]);

	/**
	 * The clip's declared BOX, applied by RE-STATING each frame's texture: the box becomes the
	 * texture's `orig` and the art keeps its size at its position inside it.
	 *
	 * That is the whole implementation, and deliberately so. A box could have been applied as a
	 * scale-and-offset at the call site, but then every consumer would need its own copy of the
	 * maths and each would get anchoring, `contain`-fitting and cover-fitting subtly differently.
	 * `orig`/`trim` is the vocabulary PIXI already sizes and anchors every sprite in — a trimmed
	 * atlas frame is exactly this shape — so restating the frames means nothing downstream
	 * changes at all: `texture.width` reports the box, `width`/`height` size the box, and the
	 * anchor lands on the box's centre.
	 *
	 * New `Texture` objects, but NOT new GPU resources: each shares its frame's `source`, so this
	 * costs one small object per frame and no upload. Rebuilt only when the clip's frames or box
	 * change — `$derived` over the resolved array, which is itself memoised upstream.
	 */
	const textures = $derived.by(() => {
		const bounds = clip.bounds;
		const list = resolvedTextures;
		if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return list;
		return list.map((tex) => {
			const orig = tex?.orig;
			// `resolveClipFrames` is texture-type-agnostic (it resolves `unknown`), so a game that
			// registered something other than a PIXI texture under a frame key still reaches here.
			// Hand it back untouched rather than throwing on a box it cannot carry.
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
			return new Texture({
				source: tex.source,
				// `frame` is the rect ON THE PAGE and `rotate` how it is packed — both untouched: a
				// box says where the art sits in ITS OWN space, never which pixels it is.
				frame: tex.frame,
				rotate: tex.rotate,
				orig: new Rectangle(0, 0, box.origW, box.origH),
				trim: new Rectangle(box.offX, box.offY, box.artW, box.artH),
				label: tex.label,
			});
		});
	});

	// A dropped frame silently SHORTENS the animation — it still plays, so nothing looks broken,
	// which is why the loud gate is the bake's dangling-frame check. Report once here so a game
	// that shipped past that gate still says so, mirroring `warnMissingAssets`. Gated on
	// `stateApp.loaded` so it can't fire during the load window (the `Sprite` precedent).
	let reported = false;
	$effect(() => {
		if (reported || !context.stateApp.loaded) return;
		const { missing } = resolved;
		if (missing.length === 0) return;
		reported = true;
		console.error(
			`Flipbook "${clip.id}": ${missing.length} frame(s) missing from loadedAssets — the ` +
				`animation will play SHORT. Missing: ${missing.join(', ')}`,
		);
	});

	/**
	 * Deliberately NO whole-sheet fallback. `ParticleEmitter` binds the entire
	 * `loadedAssets[key]` sheet when a layer resolves no textures, which turns a broken FX
	 * reference into an emitter spraying arbitrary wrong art. For a flipbook that would render a
	 * scrambled animation of unrelated frames; rendering NOTHING is the honest failure.
	 */
</script>

<!-- `loop`: an explicit value from the caller WINS over the clip’s own default, so a per-STATE
     setting can make one clip repeat in one symbol state and hold in another. -->
{#if textures.length > 0}
	<AnimatedSprite
		{...spriteProps}
		{textures}
		{animationSpeed}
		{flipX}
		{flipY}
		loop={props.loop ?? clip.loop ?? true}
		play={play ?? true}
	/>
{/if}
