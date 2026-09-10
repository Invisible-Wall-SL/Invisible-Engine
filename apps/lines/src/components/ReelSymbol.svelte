<script lang="ts">
	import Symbol from './Symbol.svelte';
	import SymbolWrap from './SymbolWrap.svelte';
	import { getSymbolInfo } from '../game/utils';
	import {
		getSymbolSeat,
		stateGame,
		stateGameDerived,
		stackedCoverage,
		winDimCellKey,
		type ReelSymbol,
	} from '../game/stateGame.svelte';
	import { SYMBOL_DIM_TINT } from 'engine-game';

	type Props = {
		reelIndex: number;
		row: number;
		reelSymbol: ReelSymbol;
	};

	const props: Props = $props();

	/** Row index of the padding row above the visible board — `props.row` indexes the PADDED strip. */
	const PADDING_ROW = -1;

	/** This cell's seat on the lattice — `x` and the row `scale` always come from here. */
	const seat = $derived(getSymbolSeat(props.reelIndex, props.row + PADDING_ROW));

	/**
	 * `y` is the one axis with two possible sources, and which one is TRUE depends on the board.
	 *
	 * `createReelForSpinning` places a symbol at a UNIFORM pitch —
	 * `reelY + (symbolIndex + lead) * symbolHeight` — which IS the flat lattice. On a flat board the
	 * live y and the seat's y therefore agree by construction, and this reads exactly as it did
	 * before the branch existed.
	 *
	 * Under PERSPECTIVE they do NOT agree: the rows compress with depth, so the seat's y is a running
	 * SUM of shrinking pitches while the reel keeps stepping by a constant one. The gap accumulates
	 * downward — on an 8-row board at `farScale` 0.9 the last row lands 48 board-local units below its
	 * seat — and since `BoardMask` is sized from the SEATS (`boardWindowHeight`), the bottom row is
	 * clipped. That is the reported "the board gets cut at the bottom", and it shows up most sharply
	 * during a win: a winning symbol moves to the ANIMATE layer, which carries no mask and so draws in
	 * full, right beside a masked neighbour that does not.
	 *
	 * At REST the seat wins. It is what the mask, the ground tiles and the cascade's targets already
	 * use, and a resting symbol belongs on its seat by definition. Mid-ROLL the live y wins, because
	 * the seat only says where a symbol will come to rest and nothing about where it is on the way.
	 * A perspective board is not meant to roll at all — that is what `swapInPlace` is for, and
	 * perspective spinning reels are explicitly out of scope — but the two knobs are independent, so a
	 * doc MAY author a converging board that still rolls, and freezing its symbols mid-spin would be a
	 * worse bug than the one this fixes.
	 */
	const spinning = $derived(stateGame.board[props.reelIndex]?.reelState.motion === 'spinning');
	const y = $derived(
		stateGameDerived.boardPerspective() && !spinning ? seat.y : props.reelSymbol.symbolY(),
	);

	const symbolInfo = $derived(
		getSymbolInfo({ rawSymbol: props.reelSymbol.rawSymbol, state: props.reelSymbol.symbolState }),
	);
	// Win-celebration dim: this symbol is darkened while the dim is active AND it is not one of the
	// round's paying cells. Off / no wins ⇒ `active` is false ⇒ full-bright (byte-parity).
	const dimmed = $derived(
		stateGame.winDim.active && !stateGame.winDim.cells[winDimCellKey(props.reelIndex, props.row)],
	);
	// Stacked-picture mode: hide the single-cell art under a run, so the one tall picture drawn by
	// `StackedPictures` doesn't double with the icons it replaces. Empty set when the mode is off ⇒
	// every cell renders ⇒ byte-parity (docs/design/stacked-picture-mode.md).
	const covered = $derived(stackedCoverage().has(winDimCellKey(props.reelIndex, props.row)));
	// The end-of-round pop took this cell OFF the board (Invisible Symbols → "Winning symbols
	// explode"): its `explosion` beat was its removal, so the seat draws nothing until the next board
	// arrives. Undrawn rather than spliced out of the strip — every consumer addresses a cell by its
	// row, so shortening the column would move all of them. `false` on every cell of a project that
	// never turned the pop on ⇒ byte-parity.
	const removed = $derived(props.reelSymbol.removed);
</script>

{#if !covered && !removed}
	<SymbolWrap
		x={seat.x}
		{y}
		reelIndex={props.reelIndex}
		scale={seat.scale}
		tint={dimmed ? SYMBOL_DIM_TINT : 0xffffff}
		animating={symbolInfo.type === 'spine' &&
			(props.reelSymbol.symbolState === 'land' ||
				props.reelSymbol.symbolState === 'win' ||
				props.reelSymbol.symbolState === 'explosion')}
	>
		<Symbol
			state={props.reelSymbol.symbolState}
			rawSymbol={props.reelSymbol.rawSymbol}
			winLineColor={props.reelSymbol.winLineColor}
			oncomplete={() => {
				if (props.reelSymbol.symbolState === 'win') props.reelSymbol.oncomplete();
				if (props.reelSymbol.symbolState === 'explosion') props.reelSymbol.oncomplete();
				if (props.reelSymbol.symbolState === 'land') props.reelSymbol.symbolState = 'static';
			}}
		/>
	</SymbolWrap>
{/if}
