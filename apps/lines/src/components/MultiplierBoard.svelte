<script lang="ts" module>
	export type EmitterEventMultiplierBoard =
		| { type: 'multiplierBoardShow' }
		| { type: 'multiplierBoardHide' }
		| { type: 'multiplierBoardInit' }
		| { type: 'multiplierBoardReset' }
		| { type: 'multiplierBoardAnimate' }
		| { type: 'multiplierBoardMove' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { quartInOut } from 'svelte/easing';

	import { BoardContext } from 'components-shared';
	import { BoardContainer } from 'engine-game';
	import type { RawSymbol, SymbolState } from 'engine-game';

	import MultiplierBoardBase from './MultiplierBoardBase.svelte';
	import { getContext } from '../game/context';
	import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from '../game/symbolBeat';
	import { getSymbolSeat, stateGame, stateGameDerived } from '../game/stateGame.svelte';

	/**
	 * The MULTIPLIER-COLLECT overlay — the scatter family's second mechanic, on top of the cascade.
	 *
	 * When a step lands multiplier symbols, they play their win state in place, then FLY to the board
	 * centre where their values combine into one board multiplier. Like the cascade board this mounts
	 * only while that beat plays and unmounts after, so a game that never sends
	 * `boardMultiplierInfo` never mounts it.
	 *
	 * It reuses `stateGame.multiplierBoard`, which has been in the shared board state since the Phase
	 * A extraction with no consumer — it was scatter's model, lifted and then left waiting for these
	 * components. Nothing new had to be added to hold it.
	 */

	const context = getContext();

	let show = $state(false);

	/** Row index of the padding row above the visible board — the board array is padded top+bottom. */
	const PADDING_ROW = -1;

	/**
	 * A cell qualifies by CARRYING A MULTIPLIER, not by being named `M`.
	 *
	 * The reference implementation tested `rawSymbol.name === 'M'`, which is a hardcoded symbol id —
	 * it would silently collect nothing in any project that named its multiplier symbol anything else.
	 * `RawSymbol.multiplier` is the property the value actually rides on (it is what `getSymbolKey`
	 * reads to pick the per-value art), so testing for it is both generic and closer to the truth.
	 */
	const createMultiplierSymbol = ({
		rawSymbol,
		reelIndex,
		symbolIndex,
		reelLength,
	}: {
		rawSymbol: RawSymbol;
		reelIndex: number;
		symbolIndex: number;
		reelLength: number;
	}) => {
		const isVisibleRow = symbolIndex > 0 && symbolIndex < reelLength - 1;
		if (rawSymbol.multiplier === undefined || !isVisibleRow) return undefined;

		const seat = getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW);
		const initX = seat.x;
		const initY = seat.y;

		const multiplierSymbol = $state({
			initX,
			initY,
			symbolX: new Tween(initX),
			symbolY: new Tween(initY),
			rawSymbol,
			symbolState: 'win' as SymbolState,
			oncomplete: () => {},
		});

		return multiplierSymbol;
	};

	const initMultiplierBoard = () =>
		stateGameDerived.boardRaw().map((rawSymbols, reelIndex) =>
			rawSymbols.map((rawSymbol, symbolIndex) =>
				createMultiplierSymbol({
					rawSymbol,
					reelIndex,
					symbolIndex,
					reelLength: rawSymbols.length,
				}),
			),
		);

	/** Every multiplier currently on the board, flattened — the sparse cells dropped. */
	const collected = () => stateGame.multiplierBoard.flat().filter((symbol) => symbol !== undefined);

	context.eventEmitter.subscribeOnMount({
		multiplierBoardShow: () => (show = true),
		multiplierBoardHide: () => (show = false),
		multiplierBoardInit: () => {
			stateGame.multiplierBoard = initMultiplierBoard();
		},
		multiplierBoardReset: () => {
			stateGame.multiplierBoard = [];
		},
		// Each multiplier plays its authored `win` state where it sits; the beat ends when the LAST
		// one reports back, so none is still animating when the flight starts.
		//
		// RACED against the shared transit cap (`game/symbolBeat.ts`) for the same reason the
		// cascade's beats are: a symbol only reports `oncomplete` when its state actually animates,
		// so a project that authored no `win` art for its multiplier would hang here forever and
		// freeze the round. An authored animation still drives the timing; an unauthored one costs a
		// bounded beat.
		multiplierBoardAnimate: async () => {
			await Promise.all(
				collected().map((symbol) =>
					awaitSymbolBeat((resolve) => (symbol.oncomplete = resolve), TRANSIT_BEAT_CAP_MS),
				),
			);
		},
		// ...then they converge on the board centre, where the total is shown. Read off `boardLayout`
		// rather than a constant so a resized board still collects to its own middle.
		multiplierBoardMove: async () => {
			const target = {
				x: stateGameDerived.boardLayout().width * 0.5,
				y: stateGameDerived.boardLayout().height * 0.5,
			};
			const tweenOptions = { duration: 500, easing: quartInOut };
			await Promise.all(
				collected().flatMap((symbol) => [
					symbol.symbolX.set(target.x, tweenOptions),
					symbol.symbolY.set(target.y, tweenOptions),
				]),
			);
		},
	});
</script>

{#if show}
	<!--
		TWO layers, exactly as `Board.svelte` and `TumbleBoard.svelte` mount them — and the
		`BoardContext` is not decoration here, it is what makes a multiplier symbol render AT ALL.
		`MultiplierSymbol` draws through `SymbolWrap`, which reads `getContextBoard()` to decide
		whether it belongs on this layer; with no provider above it that read is `undefined`, and the
		first symbol of the collect beat throws "Cannot read properties of undefined (reading
		'animate')" — taking the round down with it. This overlay shipped without one, so the beat
		crashed on every project that landed a multiplier.

		BOTH layers rather than one, for the same reason the two boards have both: the split IS
		`animating` (a spine symbol overflows its cell, so it draws unmasked above the mask), and
		`SymbolWrap` renders a symbol on exactly one of them. A single layer would silently hide
		whichever half of a project's multiplier art it did not match — a quieter bug than the crash.
	-->
	<BoardContext animate={false}>
		<BoardContainer>
			<MultiplierBoardBase />
		</BoardContainer>
	</BoardContext>

	<BoardContext animate={true}>
		<BoardContainer>
			<MultiplierBoardBase />
		</BoardContainer>
	</BoardContext>
{/if}
