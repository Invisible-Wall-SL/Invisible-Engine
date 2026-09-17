<script lang="ts">
	import type { SymbolState } from 'engine-game';

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
		/** This cell's row within its column — its index in the reel strip, or, while a cascade is
		 *  driving the board, its index in the combined column. Both count from the padding row
		 *  above the visible window, which is what {@link PADDING_ROW} takes back off. */
		row: number;
		reelSymbol: ReelSymbol;
	};

	const props: Props = $props();

	/** Row index of the padding row above the visible board — `props.row` indexes the PADDED strip. */
	const PADDING_ROW = -1;

	/**
	 * The states in which a SPINE symbol draws on the unmasked ANIMATING layer rather than the flat
	 * masked one, so art authored bigger than its cell is not cut off at the window edge.
	 *
	 * `clearReel` and `intro` are the cascade's own two, and they are here rather than in a branch of
	 * their own because WHICH LAYER draws a cell decides which component does — `SymbolWrap` mounts
	 * on exactly one of the two `BoardContext`s — so a predicate that changed when the cascade took
	 * the board would re-create every spine symbol on the spot, which is the whole bug this file's
	 * one-cell merge exists to remove (`docs/design/board-cell-continuity.md`).
	 *
	 * A game that never cascades never reaches either state, so its layer assignment is unchanged.
	 *
	 * The vote is the BASE cell's `type` alone — a cell's authored `layers` (Invisible Symbols State
	 * Machine → the cell editor's "Layers") never get one. The cell is ONE unit, mounted on exactly
	 * one of the two `BoardContext`s, so extra art rides whichever layer the base picked; letting a
	 * layer change the answer would re-create every symbol the moment a layer changed, which is the
	 * bug this file's one-cell merge exists to remove. The consequence to know while authoring: a
	 * spine LAYER on a sprite/flipbook-based cell draws on the MASKED layer and is clipped at the
	 * board window if it overflows its cell, where the same rig bound as the cell's own art would not
	 * be.
	 */
	const ANIMATING_SYMBOL_STATES: readonly SymbolState[] = [
		'land',
		'win',
		'explosion',
		'clearReel',
		'intro',
	];

	/** This cell's seat on the lattice — `x` and the row `scale` always come from here. */
	const seat = $derived(getSymbolSeat(props.reelIndex, props.row + PADDING_ROW));

	/**
	 * Is a CASCADE driving this cell right now (`stateTumble`)? While it is, the cascade owns the
	 * cell's y and the reel-board-only presentation below stands down — a cascading board has no win
	 * dim and no stacked run to hide under, and both are keyed by the RESTING board's rows, which a
	 * cascade is in the middle of rearranging.
	 *
	 * `null` on every cell of a game that never cascades, so every derived below reads exactly as it
	 * did before this existed.
	 */
	const cascade = $derived(props.reelSymbol.cascade);

	/**
	 * `y` is the one axis with more than one possible source, and which one is TRUE depends on what
	 * is driving the board.
	 *
	 * A CASCADE positions each symbol individually — the seat only says where a falling symbol is
	 * HEADED, which is exactly what the slide tweens it to — so while one is attached its Tween wins.
	 *
	 * Otherwise `createReelForSpinning` places a symbol at a UNIFORM pitch —
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
		cascade
			? cascade.y.current
			: stateGameDerived.boardPerspective() && !spinning
				? seat.y
				: props.reelSymbol.symbolY(),
	);

	const symbolInfo = $derived(
		getSymbolInfo({ rawSymbol: props.reelSymbol.rawSymbol, state: props.reelSymbol.symbolState }),
	);
	// Win-celebration dim: this symbol is darkened while the dim is active AND it is not one of the
	// round's paying cells. Off / no wins / mid-cascade ⇒ `active` is false ⇒ full-bright
	// (byte-parity).
	const dimmed = $derived(
		!cascade &&
			stateGame.winDim.active &&
			!stateGame.winDim.cells[winDimCellKey(props.reelIndex, props.row)],
	);
	// Stacked-picture mode: hide the single-cell art under a run, so the one tall picture drawn by
	// `StackedPictures` doesn't double with the icons it replaces. Empty set when the mode is off ⇒
	// every cell renders ⇒ byte-parity (docs/design/stacked-picture-mode.md).
	const covered = $derived(
		!cascade && stackedCoverage().has(winDimCellKey(props.reelIndex, props.row)),
	);
	// This cell is OFF the board and draws nothing, though it still holds its row. Two beats set it,
	// and they are the same picture: the win-explosion pop (Invisible Symbols → "Winning symbols
	// explode"), whose `explosion` beat WAS the removal; and the cascade's `clearReel`, which is
	// taken off the moment its own animation reports — the board-wide sweep that follows comes later,
	// by the length of an explosion pattern's spread, and drawing it through that wait made an early
	// column re-play its pop two or three times while the columns to its right were still going.
	//
	// Undrawn rather than spliced out — every consumer addresses a cell by its row, so shortening the
	// column would move all of them. `false` on every cell of a project that never turned the pop on
	// ⇒ byte-parity.
	const removed = $derived(props.reelSymbol.removed);
</script>

{#if !covered && !removed}
	<SymbolWrap
		x={seat.x}
		{y}
		reelIndex={props.reelIndex}
		scale={seat.scale}
		animating={symbolInfo.type === 'spine' &&
			ANIMATING_SYMBOL_STATES.includes(props.reelSymbol.symbolState)}
	>
		<Symbol
			state={props.reelSymbol.symbolState}
			rawSymbol={props.reelSymbol.rawSymbol}
			winLineColor={props.reelSymbol.winLineColor}
			tint={dimmed ? SYMBOL_DIM_TINT : 0xffffff}
			oncomplete={() => {
				const state = props.reelSymbol.symbolState;
				// EVERY STATE A BEAT DRIVES reports straight through, whoever armed it — and WITHOUT
				// asking whether a cascade is still holding the cell.
				//
				// It used to ask, and that was a bug. A cascade seat says where a cell IS, not who is
				// waiting on it, and the two come apart on exactly one path: with "let the next spin
				// start as soon as the symbols are back" turned on, `tumbleBoardAppear` does not await
				// the intro beat, so `boardSettle` adopts the cells — detaching every seat — while the
				// intros are still playing. Gated on the seat, those completions were swallowed, and
				// every arriving symbol sat frozen on its intro for the whole `INTRO_BEAT_CAP_MS`
				// before the cap settled it. The overlay never showed this because it DESTROYED the
				// cell at `tumbleBoardHide` and the reel board mounted a fresh, resting one in its
				// place — the restart this merge removed was hiding the freeze behind it.
				//
				// Keyed on the state instead, which is what a beat actually owns. `static`,
				// `postWinStatic` and `spin` are nobody's beat, so a looping clip in one of them
				// reports nothing — the guard that keeps a settled win beat from being re-fired by a
				// cell that has since moved on.
				if (
					state === 'win' ||
					state === 'explosion' ||
					state === 'clearReel' ||
					state === 'intro'
				) {
					props.reelSymbol.oncomplete();
					return;
				}
				// `land` is the one state BOTH owners arm. A cascade's own callback settles the cell
				// and resolves its beat; the reel board arms nothing, so its `oncomplete` is the cell's
				// default no-op and the settle below is the whole behaviour. Doing both is what lets
				// one cell answer for either owner.
				if (state === 'land') {
					props.reelSymbol.oncomplete();
					props.reelSymbol.symbolState = 'static';
				}
			}}
		/>
	</SymbolWrap>
{/if}
