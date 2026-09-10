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
				/** This is the RESTING replay re-lighting a spin's winners, not the round's own
				 *  narration. Set only by `winSymbolCycle`; the end-of-win pop (`winExplode`) is
				 *  skipped on a replay pass — see the handler below. */
				replay?: boolean;
		  }
		// Flow v2 `stopReel(index)` command / `reelStop` cue — settle one reel by index. Declared so
		// the per-reel stagger (the `StaggerStop` function) fires a real, typed signal a reel binds to.
		| { type: 'reelStop'; index: number };
</script>

<script lang="ts">
	import { waitForTimeout } from 'utils-shared/wait';
	import { BoardContext } from 'components-shared';

	import { getContext } from '../game/context';
	import { bakedWinExplodeEnabled } from '../editor-scenes';
	import { awaitSymbolBeat, WIN_BEAT_CAP_MS, WIN_BEAT_MIN_MS } from '../game/symbolBeat';
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
		boardWithAnimateSymbols: async ({ symbolPositions, winLineColor, replay }) => {
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
			//
			// THE END-OF-WIN POP (Invisible Symbols → "Winning symbols explode"). Off by default, and
			// off on a REPLAY pass even when on: the resting cycle re-lights the same winners every
			// few hundred ms until the next bet, so popping on each pass would have the board's
			// symbols blowing up on a loop — a glitch, not a narration — and would add a second
			// bounded beat to every pass of a cycle nothing races against a skip token. The pop
			// belongs to the round's own presentation, which is the only place the win actually
			// resolves.
			const popOnWin = !replay && bakedWinExplodeEnabled();
			const covered = stackedCoverage();
			const getPromises = () =>
				symbolPositions.map(async (position) => {
					const reelSymbol = context.stateGame.board[position.reel].reelState.symbols[position.row];
					const isCovered = covered.has(winDimCellKey(position.reel, position.row));
					reelSymbol.winLineColor = color;
					reelSymbol.symbolState = 'win';
					if (isCovered) {
						await waitForTimeout(stackedWinHoldMs() ?? STACKED_WIN_HOLD_MS);
					} else {
						// BOUNDED AT BOTH ENDS. The cap above is the runaway guard; `WIN_BEAT_MIN_MS` is the
						// floor, and it is the one that was missing. A `sprite` bound to `win` reports
						// `oncomplete` from an `$effect` the instant its art changes, so the beat resolved in
						// the same tick and took the whole win presentation down with it — including the win's
						// stamped AMOUNT TEXT, which is scoped to this beat. Measured on the live `test6`: a
						// win on a sprite-bound symbol lasted 2ms and drew no text; the one symbol with
						// flipbook win art lasted 961ms and drew "€0.05" at board centre. Eight of that
						// project's ten symbols were sprite-bound, so most wins flashed for one frame.
						//
						// CONCURRENT, not sequential: authored art longer than the floor still sets the pace
						// and is completely untouched (`Promise.all` settles on the slower of the two). Only a
						// beat that would have been shorter than a readable moment is stretched to one.
						await Promise.all([
							awaitSymbolBeat((resolve) => (reelSymbol.oncomplete = resolve), WIN_BEAT_CAP_MS),
							waitForTimeout(WIN_BEAT_MIN_MS),
						]);
					}
					// A STACKED-COVERED cell is deliberately excluded: it mounts no `<Symbol>` at all, so
					// there is nothing to draw the pop with and nothing that could ever report it — the
					// beat would be a second dead hold, and it would end the tall picture's win art early
					// for no picture. The stacked mode's win beat stays the tall picture itself.
					if (popOnWin && !isCovered) {
						reelSymbol.symbolState = 'explosion';
						// Capped like the win beat above and for the same reason — an `explosion` cell
						// bound to art that can never report `oncomplete` must not hang the round. NO
						// floor here, unlike the win beat: the readable minimum is already spent on the
						// win, and a second one would add it to every paying spin.
						await awaitSymbolBeat((resolve) => (reelSymbol.oncomplete = resolve), WIN_BEAT_CAP_MS); // prettier-ignore
						// EXPLODE AND BE GONE — the pop IS the removal, not a flourish before one.
						//
						// It used to end at `postWinStatic`, which left the blown-up symbol standing on the
						// board until the NEXT spin's board clear popped it a second time: a project that
						// clears its board before the new symbols fall in (`/config` → Reel behaviour) read
						// Win → Explosion → Clear reel, the third beat blowing up symbols the player had
						// already watched blow up. The cell goes here instead, so the round ends on the beat
						// the author meant and the next clear only pops what is still standing (see
						// `visibleColumnPositions`).
						//
						// On BOTH exits of the race above, exactly like the revert below it: a cell whose art
						// can never report `oncomplete` pays the cap and is then just as gone. It is the
						// SYMBOL that is marked, not its seat — the next board un-removes it by being new
						// cells (see `ReelSymbol.removed`).
						reelSymbol.removed = true;
					}
					// The cell ENDS at rest either way — a removed one included: it is no longer drawn, but
					// it must not be left parked on `explosion` for a state reader to find.
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
			<!-- `allowOverflow`: once no reel's strip is moving, the window may grow by the `reelGrid`
			     node's authored symbol overflow, so a landed symbol drawn bigger than its cell is not
			     cut off at the board edge. Nothing authored / any reel still rolling ⇒ the same window
			     as always (`boardOverflow`).

			     "Rolling", not `motion === 'stopped'`: the pre-spin slides a whole reel-length through
			     the window before `motion` ever says 'spinning'. The cascade overlay cannot use this
			     gate at all and passes its own — see `TumbleBoard`. -->
			<BoardMask allowOverflow />
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
