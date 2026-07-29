<script lang="ts">
	/**
	 * Free-spin BOOK VFX renderer (Invisible Symbols State Machine output — {@link bakedBookVfx}).
	 * Draws two authored layers on the book/special symbol during free spins: a `background` BEHIND
	 * the symbol art and a `foreground` IN FRONT of it, at every board cell whose symbol matches
	 * `stateGame.specialSymbol`.
	 *
	 * Ordering: this mounts as a sibling of `<BoardBase>` inside the SAME `<BoardContainer>`, so it
	 * shares the reel-board coordinate space (and mask) with the symbols. The bg layer takes a
	 * negative `zIndex` and the fg a positive one; the symbol containers sit at the default z 0, so
	 * PixiJS v8's automatic sort-on-non-zero-zIndex interleaves them bg → symbol → fg (the same
	 * mechanism `<BoardFrame>`'s `zIndex:-1` glow relies on).
	 *
	 * Parity: `bakedBookVfx()` is undefined for an un-authored / un-baked game ⇒ nothing renders and
	 * no assets are added. Any unresolved asset / clip / effect id renders nothing, never crashes.
	 */
	import {
		Container,
		EffectPlayer,
		Flipbook,
		Sprite,
		SpineProvider,
		SpineTrack,
	} from 'pixi-svelte';
	import { resolveFlipbook } from 'engine-layout';

	import { getContext } from '../game/context';
	import { getSymbolX, stateGame } from '../game/stateGame.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import { bakedBookVfx, bakedEffects } from '../editor-scenes';
	import type { BookVfxLayer } from '../editor-scenes';

	const context = getContext();

	// Read once at module scope — the authored data is build-frozen, so it never changes at runtime.
	// Undefined ⇒ the whole component is inert (parity).
	const vfx = bakedBookVfx();

	// bg draws behind the symbol art, fg in front. Non-zero zIndex is what flips PixiJS's parent
	// sort on, so the symbol containers (default z 0) fall between the two.
	const BG_Z_INDEX = -1;
	const FG_Z_INDEX = 1;

	// The gate: free spins only (the explicit `gameType` check the rest of the game uses — e.g.
	// `Background.svelte`, `Game.svelte`'s `freeGameShow`) AND a chosen special symbol. In the base
	// game `specialSymbol` is null, so this is doubly closed there.
	const active = $derived(stateGame.gameType === 'freegame' && stateGame.specialSymbol != null);

	const geometry = $derived(context.stateGameDerived.boardGeometry());

	// The visible reel window in board-local space — mirrors `SymbolWrap`/`BoardMask`. A padding-row
	// symbol that happens to carry the special name must NOT sprout VFX above/below the board.
	const frameBottom = $derived(boardDimensions().y * geometry.rowPitchLocal);

	// Every resting-board cell holding the special symbol, at its board-local centre (the SAME
	// `getSymbolX(reel)` / `reelSymbol.symbolY()` the symbols themselves use). A full-column expanded
	// special symbol yields one entry per row, so mounting per cell naturally covers the whole column.
	const cells = $derived.by(() => {
		if (!active) return [] as { key: string; x: number; y: number }[];
		const special = stateGame.specialSymbol;
		const out: { key: string; x: number; y: number }[] = [];
		stateGame.board.forEach((reel, reelIndex) => {
			reel.reelState.symbols.forEach((reelSymbol, row) => {
				if (reelSymbol.rawSymbol.name !== special) return;
				const y = reelSymbol.symbolY();
				if (y < 0 || y > frameBottom) return;
				out.push({ key: `${reelIndex}:${row}`, x: getSymbolX(reelIndex), y });
			});
		});
		return out;
	});

	const effectById = (id: string) => bakedEffects().find((doc) => doc.id === id);
</script>

{#snippet layerView(layer: BookVfxLayer, x: number, y: number, zIndex: number)}
	{@const width = geometry.cellWidthLocal * (layer.sizeRatios?.width ?? 1)}
	{@const height = geometry.cellHeightLocal * (layer.sizeRatios?.height ?? 1)}
	{@const offsetX = (layer.offset?.x ?? 0) * geometry.cellWidthLocal}
	{@const offsetY = (layer.offset?.y ?? 0) * geometry.cellHeightLocal}
	<Container x={x + offsetX} y={y + offsetY} {zIndex}>
		{#if layer.kind === 'sprite' && layer.assetKey}
			<Sprite anchor={0.5} key={layer.assetKey} {width} {height} contain />
		{:else if layer.kind === 'spine' && layer.assetKey}
			<SpineProvider key={layer.assetKey} anchor={0.5} {width} {height}>
				<SpineTrack trackIndex={0} animationName={layer.animationName ?? ''} loop />
			</SpineProvider>
		{:else if layer.kind === 'flipbook'}
			{@const clip = layer.clipId ? resolveFlipbook(layer.clipId) : undefined}
			{#if clip}
				<Flipbook {clip} anchor={0.5} {width} {height} />
			{/if}
		{:else if layer.kind === 'fx' && layer.effectId}
			{@const doc = effectById(layer.effectId)}
			{#if doc}
				<!--
					A particle effect has no intrinsic width/height to fit to a cell (its layers are
					authored in absolute pixels), so — like the placed-effect path in
					`LayoutNodeView` — it scales via a wrapping <Container>. `sizeRatios` is that
					scale multiplier (default 1 = the effect's authored scale, so an un-sized layer
					renders exactly as authored / byte-parity). This is why the width/height above
					feed a SPRITE/SPINE/FLIPBOOK's pixel size but the FX layer's own `scale`.
				-->
				<Container scale={{ x: layer.sizeRatios?.width ?? 1, y: layer.sizeRatios?.height ?? 1 }}>
					<EffectPlayer {doc} />
				</Container>
			{/if}
		{/if}
	</Container>
{/snippet}

{#if vfx && active}
	{#each cells as cell (cell.key)}
		{#if vfx.background}
			{@render layerView(vfx.background, cell.x, cell.y, BG_Z_INDEX)}
		{/if}
		{#if vfx.foreground}
			{@render layerView(vfx.foreground, cell.x, cell.y, FG_Z_INDEX)}
		{/if}
	{/each}
{/if}
