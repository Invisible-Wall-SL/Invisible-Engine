<script lang="ts">
	import { Flipbook, Sprite } from 'pixi-svelte';
	import { resolveFlipbook } from 'engine-layout';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';

	/**
	 * A symbol state rendered as an Invisible Flipbook clip — the third binding kind beside
	 * `sprite` (one frozen frame) and `spine`. Before this, ANY moving Spin/Land/Win had to be a
	 * Spine skeleton; a frame animation off an atlas is far cheaper.
	 *
	 * Mirrors `SymbolSprite`: the same contain-fit against the reel's LIVE cell, so a flipbook
	 * symbol can never overflow the board mask any more than a sprite one can.
	 */
	type Props = {
		x?: number;
		y?: number;
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		oncomplete?: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	const geometry = $derived(context.stateGameDerived.boardGeometry());
	const clip = $derived(
		props.symbolInfo.clipId ? resolveFlipbook(props.symbolInfo.clipId) : undefined,
	);

	// A dangling clipId must not blank the symbol: an un-baked project, or a clip deleted after
	// the binding was authored, falls back to the cell's `assetKey` — which for a flipbook cell
	// is the clip's primary sheet frame — so the reel still shows art. `resolveFlipbook` never
	// throws, so this is the only failure mode to cover.
	const missing = $derived(!!props.symbolInfo.clipId && !clip);

	$effect(() => {
		if (missing) {
			console.error(
				`SymbolFlipbook: clip "${props.symbolInfo.clipId}" is not registered — falling back to ` +
					`the static frame "${props.symbolInfo.assetKey}". Re-bake the project to ship it.`,
			);
		}
	});

	/**
	 * A flipbook symbol state COMPLETES when its clip has played through ONCE — the frame-animation
	 * analogue of a spine symbol firing `complete` at the end of its win animation (`SymbolSpine`),
	 * NOT immediately on mount like `SymbolSprite` (a frozen frame with nothing to play).
	 *
	 * `Board.svelte`'s `boardWithAnimateSymbols` sets a winning cell to `win`, AWAITS `oncomplete`,
	 * then reverts it to `postWinStatic`. Firing `oncomplete` on mount advanced that revert in the
	 * SAME tick, so the win clip never got to play — the win animation "didn't show" (spine wins were
	 * unaffected, which is why Book of Borut worked). Completing after one CYCLE also means a
	 * `loop:true` win clip can never hang the presentation: the sprite's own looped playback never
	 * reports completion, so the beat is timed off the clip's length instead of waiting on an event
	 * that never fires.
	 *
	 * A MISSING clip (the Sprite fallback below) has nothing to play, but it must NOT complete in the
	 * same tick the way `SymbolSprite` does. `winInfo` shows the win line, awaits the symbols, then
	 * hides it — and the line is not animated by default — so a same-tick completion draws and clears
	 * the line inside one frame and the player never sees the payline at all. A broken binding then
	 * reads as "this symbol has no win line" rather than as a broken symbol. Holding {@link
	 * MISSING_CLIP_HOLD_MS} keeps the beat visible and the failure honest (the console error above
	 * says which clip). Only a dangling clip pays it — a real clip is timed off its own length.
	 */
	const DEFAULT_FPS = 24;
	const MISSING_CLIP_HOLD_MS = 700;
	const cycleMs = $derived(
		clip
			? Math.max(1, Math.round((clip.frames.length / (clip.fps ?? DEFAULT_FPS)) * 1000))
			: MISSING_CLIP_HOLD_MS,
	);

	$effect(() => {
		// Re-run whenever the bound state/clip changes — each new state is a fresh beat to complete.
		props.symbolInfo;
		const id = setTimeout(() => props.oncomplete?.(), cycleMs);
		return () => clearTimeout(id);
	});
</script>

{#if clip}
	<Flipbook
		{clip}
		x={props.x}
		y={props.y}
		anchor={0.5}
		width={geometry.cellWidthLocal}
		height={geometry.cellHeightLocal}
	/>
{:else}
	<Sprite
		x={props.x}
		y={props.y}
		anchor={0.5}
		key={props.symbolInfo.assetKey}
		width={geometry.cellWidthLocal}
		height={geometry.cellHeightLocal}
		contain
	/>
{/if}
