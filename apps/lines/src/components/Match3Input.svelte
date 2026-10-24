<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { BoardContainer, SYMBOL_SIZE } from 'engine-game';
	import { PointerGesture, type PointerAt } from 'engine-layout';
	import type { Cell } from 'engine-mechanics';
	import { getContextApp, Rectangle, resolveAnchor } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { registerDeterminismBoard } from '../game/determinism';
	import { FLIGHT_BOARD_ANCHOR } from '../game/flights.svelte';
	import { getCellAt, getSymbolSeat } from '../game/stateGame.svelte';
	import {
		match3TakesInput,
		selectCell,
		startMatch3,
		stateMatch3,
		stopMatch3,
		swapCells,
	} from '../game/match3.svelte';

	/**
	 * THE MATCH-3 BOARD'S INPUT (`docs/design/game-families.md` §3.2, §6.4): an invisible surface over
	 * the board, in the board's own space, that turns the pointer into board moves.
	 *
	 * - A press picks the cell under it (`getCellAt`, the inverse of the resting seats).
	 * - A drag that travels {@link SWAP_REACH} of a cell along one axis swaps that cell with its
	 *   neighbour that way, as the drag goes rather than on release, so a swipe feels immediate.
	 * - A press released without dragging is a tap: it selects the cell, and a tap on a neighbour of
	 *   the selected cell swaps the two.
	 *
	 * The gesture is P10.4's `PointerGesture` (slop, global move tracking, a release off the surface).
	 * Mounted only for a mechanic that takes board input, so no slot game builds it; mounting it
	 * starts the board's session.
	 */

	/** How far along one axis a drag must travel, × a cell, to swap. */
	const SWAP_REACH = 0.35;

	const context = getContext();
	const app = getContextApp();
	const layout = $derived(context.stateGameDerived.boardLayout());

	let pressed: Cell | undefined;
	let swapped = false;

	const neighbour = (cell: Cell, at: PointerAt): Cell | undefined => {
		const reach = SWAP_REACH * SYMBOL_SIZE;
		if (Math.max(Math.abs(at.dx), Math.abs(at.dy)) < reach) return undefined;
		return Math.abs(at.dx) >= Math.abs(at.dy)
			? { reel: cell.reel + Math.sign(at.dx), row: cell.row }
			: { reel: cell.reel, row: cell.row + Math.sign(at.dy) };
	};

	const gesture = new PointerGesture((event, at) => {
		if (event === 'down') {
			pressed = match3TakesInput() ? getCellAt(at.x, at.y) : undefined;
			swapped = false;
			return;
		}
		if (!pressed) return;
		if (event === 'drag' && !swapped) {
			const target = neighbour(pressed, at);
			if (!target || !match3TakesInput()) return;
			swapped = true;
			void swapCells(pressed, target);
			return;
		}
		// Every release ends in `swipe`; one that never dragged far enough to swap is a tap.
		if (event === 'swipe') {
			if (!swapped && Math.hypot(at.dx, at.dy) < SWAP_REACH * SYMBOL_SIZE && match3TakesInput())
				void selectCell(pressed);
			pressed = undefined;
		}
	});

	/** A cell's centre on the page, CSS px — the determinism probe's `cellPoint`. */
	const cellPoint = (reel: number, row: number) => {
		const board = resolveAnchor(FLIGHT_BOARD_ANCHOR);
		const canvas = app.stateApp.pixiApplication?.canvas;
		const screen = app.stateApp.pixiApplication?.renderer.screen;
		if (!board || !canvas || !screen) return undefined;
		const seat = getSymbolSeat(reel, row);
		const point = board.toGlobal({ x: seat.x, y: seat.y });
		const rect = canvas.getBoundingClientRect();
		return {
			x: rect.left + (point.x * rect.width) / screen.width,
			y: rect.top + (point.y * rect.height) / screen.height,
		};
	};

	const unregisterProbe = registerDeterminismBoard({
		read: () => ({
			busy: stateMatch3.busy,
			moves: stateMatch3.moves,
			seed: stateMatch3.seed,
			cells: context.stateGame.board.map((reel) =>
				reel.reelState.symbols.slice(1, -1).map((cell) => cell.rawSymbol.name),
			),
		}),
		cellPoint,
	});

	onMount(() => void startMatch3());
	onDestroy(() => {
		unregisterProbe();
		stopMatch3();
	});
</script>

<BoardContainer>
	<Rectangle
		width={layout.width}
		height={layout.height}
		backgroundAlpha={0}
		borderWidth={0}
		eventMode="static"
		cursor="pointer"
		onpointerdown={(e) => gesture.down(e.pointerId, e.getLocalPosition(e.currentTarget), e.global)}
		onglobalpointermove={(e) =>
			gesture.move(e.pointerId, e.getLocalPosition(e.currentTarget), e.global)}
		onpointerup={(e) =>
			gesture.release(e.pointerId, e.getLocalPosition(e.currentTarget), e.global, true)}
		onpointerupoutside={(e) =>
			gesture.release(e.pointerId, e.getLocalPosition(e.currentTarget), e.global, false)}
	/>
</BoardContainer>
