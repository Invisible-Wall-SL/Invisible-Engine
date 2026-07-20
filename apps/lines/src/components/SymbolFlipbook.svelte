<script lang="ts">
	import { Flipbook, Sprite } from 'pixi-svelte';
	import { resolveFlipbook } from 'engine-layout';
	import { onMount } from 'svelte';

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

	// A symbol state is a beat in a sequence: whatever is waiting on this state must be released
	// even when the clip is a one-shot the renderer never reports on. Mirrors `SymbolSprite`,
	// which completes immediately for exactly the same reason.
	onMount(() => {
		props.oncomplete?.();
	});
	$effect(() => {
		props.symbolInfo;
		props.oncomplete?.();
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
