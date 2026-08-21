<script lang="ts">
	import { Container, Sprite } from 'pixi-svelte';
	import type { ReelGridTileArt } from 'engine-layout';
	import { SYMBOL_DIM_TINT } from 'engine-game';

	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGame, winDimCellKey } from '../game/stateGame.svelte';

	type Props = {
		reelIndex: number;
		/** VISIBLE board row (0 = the back/top row). Not a strip index — see `PADDING_ROW`. */
		row: number;
		art: ReelGridTileArt;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * Row index of the padding row above the visible board. The reel STRIP carries `rows + 2` cells
	 * (`initialBoard`), so a strip index is one MORE than the visible row it draws — which is why
	 * `ReelSymbol` seats itself at `props.row + PADDING_ROW` while its `row` prop indexes the strip.
	 * A tile indexes the VISIBLE board (it only exists for cells that are on screen), so it goes the
	 * other way to reach the strip: `row - PADDING_ROW`. Same constant, same convention, one
	 * conversion, stated once — see the dim below, the only place a tile needs a strip index.
	 */
	const PADDING_ROW = -1;

	/**
	 * ONE cell's ground tile, stamped AT THE SEAT and scaled by the row.
	 *
	 * The seat is read, never recomputed — that is the entire point of the phase. A tile that derived
	 * its own x/y from the cell size and the row pitch would agree with the symbols today and drift
	 * from them the moment anything touched the lattice (a gap, an off-centre lead, a per-ratio
	 * override, the perspective contraction toward the vanishing point), which is exactly the failure
	 * mode of painting the tile grid into the ground art. Reading `getSymbolSeat` makes a desync
	 * unrepresentable rather than unlikely.
	 *
	 * A consequence worth naming: the seat folds the per-cell art ALIGNMENT (`symbolAlignX/Y`), so a
	 * board that seats its symbols off-centre in their cells moves the tiles with them. That is the
	 * guarantee working as intended — the tile stays under its symbol. Pinning the tile to the cell
	 * BOX while the art rides the alignment would be a second, independent knob, and it is not one
	 * this phase invents behind the author's back.
	 */
	const seat = $derived(getSymbolSeat(props.reelIndex, props.row));
	const geometry = $derived(context.stateGameDerived.boardGeometry());
	/**
	 * Win-celebration dim: the tile asks the cell EXACTLY the question its symbol asks
	 * (`ReelSymbol`) — same `stateGame.winDim.active`, same membership set, same key function, on the
	 * same cell — so the ground under a paying cell can never stay bright while the symbol on it
	 * darkens, or vice versa. No new state. `SYMBOL_DIM_TINT` rather than a tile-specific grey for
	 * the same reason: two constants for one darkening is two things to keep equal.
	 *
	 * The dim set is keyed by STRIP row (a book `position.row` indexes the padded strip — see
	 * `winLinePointsFor`), hence the `- PADDING_ROW`. Off / no wins ⇒ `active` is false ⇒ the tile
	 * renders untinted, byte-parity with a board that has no dim at all.
	 */
	const dimmed = $derived(
		stateGame.winDim.active &&
			!stateGame.winDim.cells[winDimCellKey(props.reelIndex, props.row - PADDING_ROW)],
	);
	/**
	 * A FLAT seat passes `undefined`, NOT 1 — the same trap `SymbolWrap` documents. Assigning
	 * `container.scale = 1` in Pixi v8 is not a no-op: it swaps the shared `defaultScale` singleton
	 * for an owned `ObservablePoint` and dirties the transform. `pixi-svelte`'s `propsSyncEffect`
	 * skips undefined props, so a flat board's tiles leave their containers exactly as they were
	 * instead of re-dirtying one transform per tile.
	 */
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
</script>

<Container x={seat.x} y={seat.y} {scale} tint={dimmed ? SYMBOL_DIM_TINT : 0xffffff}>
	<!-- The cell BOX, in board-local units — the same box a symbol's art fits into. The row scale is
		 applied ONCE, by the container above, exactly as `SymbolWrap` applies it, so a tile and the
		 symbol standing on it shrink together and neither double-applies it. -->
	<Sprite
		key={props.art.key}
		fallbackKey={props.art.fallbackKey}
		anchor={0.5}
		width={geometry.cellWidthLocal}
		height={geometry.cellHeightLocal}
	/>
</Container>
