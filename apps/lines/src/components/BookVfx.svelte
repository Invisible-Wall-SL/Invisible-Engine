<script lang="ts">
	/**
	 * Free-spin BOOK VFX renderer (Invisible Symbols State Machine output — {@link bakedBookVfx}).
	 * Draws two authored layers on the book/special symbol during free spins: a `background` BEHIND
	 * the symbol art and a `foreground` IN FRONT of it, at every board cell whose symbol matches
	 * `stateGame.specialSymbol`. Each layer draws through `SymbolLayer` — the one kind switch this
	 * and the explosion → intro transition share — looping here.
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
	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGame } from '../game/stateGame.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import { bakedBookVfx } from '../editor-scenes';
	import SymbolLayer from './SymbolLayer.svelte';

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

	/** Row index of the padding row above the visible board — the board strip is padded top+bottom,
	 *  so a strip index is one MORE than the lattice row `getSymbolSeat` seats. */
	const PADDING_ROW = -1;

	// Every resting-board cell holding the special symbol, at its board-local centre (the SAME
	// `getSymbolSeat(reel, row).x` / `reelSymbol.symbolY()` the symbols themselves use). A full-column
	// expanded special symbol yields one entry per row, so mounting per cell covers the whole column.
	const cells = $derived.by(() => {
		if (!active) return [] as { key: string; x: number; y: number }[];
		const special = stateGame.specialSymbol;
		const out: { key: string; x: number; y: number }[] = [];
		stateGame.board.forEach((reel, reelIndex) => {
			reel.reelState.symbols.forEach((reelSymbol, row) => {
				if (reelSymbol.rawSymbol.name !== special) return;
				const y = reelSymbol.symbolY();
				if (y < 0 || y > frameBottom) return;
				const seat = getSymbolSeat(reelIndex, row + PADDING_ROW);
				out.push({ key: `${reelIndex}:${row}`, x: seat.x, y });
			});
		});
		return out;
	});
</script>

{#if vfx && active}
	{#each cells as cell (cell.key)}
		{#if vfx.background}
			<SymbolLayer layer={vfx.background} x={cell.x} y={cell.y} zIndex={BG_Z_INDEX} />
		{/if}
		{#if vfx.foreground}
			<SymbolLayer layer={vfx.foreground} x={cell.x} y={cell.y} zIndex={FG_Z_INDEX} />
		{/if}
	{/each}
{/if}
