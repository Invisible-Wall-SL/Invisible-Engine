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
	import type { Texture } from 'pixi.js';
	import { resolveClipFrames } from 'engine-flipbook';

	import AnimatedSprite from './AnimatedSprite.svelte';
	import { getContextApp } from '../context.svelte';

	const props: Props = $props();
	const context = getContextApp();

	// `clip` must NOT reach <AnimatedSprite>: `propsSyncEffect` assigns every prop key straight
	// onto the PIXI object, so spreading it would stamp a stray `.clip` on the sprite.
	const { clip, play, ...spriteProps }: Props = $derived(props);

	/** PIXI advances `currentFrame` by `animationSpeed` per 60Hz-normalized tick, so a clip's
	 * frames-per-second is `fps / 60`. Absent fps ⇒ 24, matching `DEFAULT_FLIPBOOK_FPS`
	 * (duplicated as a literal rather than imported, to keep this package dependency-free). */
	const DEFAULT_FPS = 24;
	const animationSpeed = $derived((clip.fps ?? DEFAULT_FPS) / 60);

	// `resolveClipFrames` owns the editor-art scoped→bare key precedence AND the
	// no-whole-sheet-fallback rule. It lives in `engine-flipbook` (pure, texture-agnostic) so
	// that contract is covered by an offline fixture rather than only in a browser.
	const resolved = $derived(
		resolveClipFrames(clip, context.stateApp.loadedAssets as Record<string, unknown> | undefined),
	);
	const textures = $derived(resolved.textures as Texture[]);

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
		loop={props.loop ?? clip.loop ?? true}
		play={play ?? true}
	/>
{/if}
