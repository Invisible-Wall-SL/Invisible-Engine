<script lang="ts" module>
	import type { RawSymbol, Position } from '../game/types';

	export type EmitterEventBoard =
		| { type: 'boardSettle'; board: RawSymbol[][] }
		| { type: 'boardShow' }
		| { type: 'boardHide' }
		| {
				type: 'boardWithAnimateSymbols';
				symbolPositions: Position[];
				/** The paying line's authored colour for this win (`#rrggbb`), stamped onto each lit cell
				 *  so a `winLine`-tinted highlight frame glows in that line's colour. Optional — absent ⇒
				 *  the cells carry no colour and the frame renders untinted. */
				winLineColor?: string;
		  }
		// Flow v2 `stopReel(index)` command / `reelStop` cue — settle one reel by index. Declared so
		// the per-reel stagger (the `StaggerStop` function) fires a real, typed signal a reel binds to.
		| { type: 'reelStop'; index: number };
</script>

<script lang="ts">
	import { waitForTimeout } from 'utils-shared/wait';
	import { BoardContext } from 'components-shared';

	import { getContext } from '../game/context';
	import { awaitSymbolBeat, WIN_BEAT_CAP_MS } from '../game/symbolBeat';
	import { winLineColorForPositions } from '../game/winSymbolCycle';
	import { stackedCoverage, stackedWinHoldMs, winDimCellKey } from '../game/stateGame.svelte';
	import { BoardContainer } from 'engine-game';
	import BoardMask from './BoardMask.svelte';
	import BoardBase from './BoardBase.svelte';
	import BoardTiles from './BoardTiles.svelte';
	import BookVfx from './BookVfx.svelte';
	import StackedPictures from './StackedPictures.svelte';

	const context = getContext();

	/** Authored ground-tile art — `undefined` for every board that has none. See the layer below. */
	const tileArt = $derived(context.stateGameDerived.boardTileArt());

	/** The win beat a stacked-picture cell holds in place of a per-icon win spine (its `<Symbol>` is
	 *  never mounted, so there is no `oncomplete` to await). A readable minimum so the win still lands
	 *  even when a paying line is entirely covered by stacked runs. The Symbols tool's `winHoldMs`
	 *  overrides it — this beat is also how long an authored WIN picture plays, so a project with a
	 *  longer win animation says so there rather than living with this default. */
	const STACKED_WIN_HOLD_MS = 650;

	let show = $state(true);

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => context.stateGameDerived.enhancedBoard.stop(),
		boardSettle: ({ board }) => context.stateGameDerived.enhancedBoard.settle(board),
		boardShow: () => (show = true),
		boardHide: () => (show = false),
		boardWithAnimateSymbols: async ({ symbolPositions, winLineColor }) => {
			// The tint colour normally rides the broadcast; when a raw FlowDoc node omits it (the first
			// presentation on a flow-driven game wires only `symbolPositions`), fall back to the recorded
			// win that owns these cells so a `winLine`-tinted frame still resolves. See the coded resting
			// cycle — same `win.meta.lineIndex` source — for the reliable path this mirrors.
			const color = winLineColor ?? winLineColorForPositions(symbolPositions);
			// A cell hidden under a stacked picture mounts no `<Symbol>` (`ReelSymbol` skips it so the tall
			// picture doesn't double with the icons it replaces), so its `oncomplete` would NEVER fire and
			// awaiting it hangs the whole win presentation — the round's per-win narration stalls on the
			// first paying line that crosses a stacked run, and the resting win-cycle (no skip token) sticks
			// on it forever. The stacked-picture mode's win beat is the tall picture itself, not a per-icon
			// win spine, so a covered cell holds a fixed beat instead of awaiting an animation that can't
			// complete. Off / non-stacked games have an empty coverage set ⇒ every cell awaits as before.
			//
			// Stacked coverage is only the case we can name UP FRONT, though. Every OTHER cell awaits an
			// `oncomplete` that a symbol only reports when its `win` state actually plays something, and
			// several ordinary authorings never do (no art bound for `win`, a seat out of frame, a spine
			// whose bound animation isn't in the skeleton or loops) — see `awaitSymbolBeat`. Unbounded, one
			// such cell hangs `Promise.all`, and with it `winInfo` and the whole round: the spin button
			// stays disabled and the game reads as frozen until the player slams. So the wait is RACED
			// against `WIN_BEAT_CAP_MS` — a runaway guard sized well above any authored win
			// animation, so authored art still sets the pace and only a cell that can never report pays
			// it. The `postWinStatic` revert below runs on BOTH paths, which is what makes this the fix
			// rather than a mitigation: the cap ends the lit state too, so nothing is left glowing.
			const covered = stackedCoverage();
			const getPromises = () =>
				symbolPositions.map(async (position) => {
					const reelSymbol = context.stateGame.board[position.reel].reelState.symbols[position.row];
					reelSymbol.winLineColor = color;
					reelSymbol.symbolState = 'win';
					if (covered.has(winDimCellKey(position.reel, position.row))) {
						await waitForTimeout(stackedWinHoldMs() ?? STACKED_WIN_HOLD_MS);
					} else {
						await awaitSymbolBeat((resolve) => (reelSymbol.oncomplete = resolve), WIN_BEAT_CAP_MS);
					}
					reelSymbol.symbolState = 'postWinStatic';
					reelSymbol.winLineColor = undefined;
				});

			await Promise.all(getPromises());
		},
	});

	context.stateGameDerived.enhancedBoard.readyToSpinEffect();
</script>

{#if show}
	<BoardContext animate={false}>
		<BoardContainer>
			<BoardMask />
			<!--
				GROUND TILES (docs/design/perspective-board-mode.md §"The tiles") — the FIRST painted
				child, so the whole layer sits behind every symbol. Two reasons it is one flat layer
				rather than interleaved row-by-row with the symbols: a tile has no vertical extent, so
				it must NEVER occlude a character standing anywhere on the board; and animating symbols
				live on a SEPARATE board container above this one, so interleaving could not cover them
				anyway. It sits inside the same `BoardContainer` as the symbols (so it shares their
				coordinate space) and after `BoardMask` (so the board window clips it identically).

				The `{#if}` is the parity guarantee: with no authored tile art the component is never
				constructed, so an un-tiled board's scene graph is byte-identical to before this
				existed.
			-->
			{#if tileArt}
				<BoardTiles art={tileArt} />
			{/if}
			<BoardBase />
			<!-- Free-spin book VFX shares the resting board's coordinate space + mask; its bg/fg
				 layers interleave with the symbols by zIndex. Inert unless a bookVfx is baked. -->
			<BookVfx />
			<!-- Stacked-picture reel mode overlay — shares the resting board's coordinate space +
				 mask. Renders nothing unless the mode is on (docs/design/stacked-picture-mode.md). -->
			<StackedPictures />
		</BoardContainer>
	</BoardContext>

	<BoardContext animate={true}>
		<BoardContainer>
			<BoardBase />
		</BoardContainer>
	</BoardContext>
{/if}
