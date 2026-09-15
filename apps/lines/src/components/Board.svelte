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
		/**
		 * THE POP (Invisible Symbols → "Winning symbols explode") — every cell ONE SPIN paid on,
		 * once, together, AFTER that spin's whole win presentation has narrated.
		 *
		 * A cue of its own rather than a tail on the win beat, because the two are not the same
		 * moment. Wins are presented one after another over the SAME board and overlapping paylines
		 * share cells, so a pop that ran at the end of each win would take a cell off the board that
		 * a later win of the same spin still has to light. The spin's accumulated winning set is
		 * `winSymbolCycle`'s, and `explodeSpinWinners` — which owns the `winExplode` gate and is the
		 * only thing that broadcasts this — is what fires it, immediately before the board change
		 * that ends the spin (and at the round seams, for the book's last one).
		 */
		| { type: 'boardExplodeWinSymbols'; symbolPositions: Position[] }
		// Flow v2 `stopReel(index)` command / `reelStop` cue — settle one reel by index. Declared so
		// the per-reel stagger (the `StaggerStop` function) fires a real, typed signal a reel binds to.
		| { type: 'reelStop'; index: number };
</script>

<script lang="ts">
	import { waitForTimeout } from 'utils-shared/wait';
	import { BoardContext } from 'components-shared';

	import { getContext } from '../game/context';
	import { awaitSymbolBeat, resolveWinBeatBudget } from '../game/symbolBeat';
	import { bakedWinBeatMaxMs } from '../editor-scenes';
	import { hasAuthoredSymbolState } from '../game/utils';
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
			// whose bound animation isn't in the skeleton) — see `awaitSymbolBeat`, which also says why a
			// LOOPING spine is not on that list despite reading like it should be. Unbounded, one
			// such cell hangs `Promise.all`, and with it `winInfo` and the whole round: the spin button
			// stays disabled and the game reads as frozen until the player slams. So the wait is RACED
			// against a cap — a runaway guard sized well above any authored win animation, so authored
			// art still sets the pace and only a cell that can never report pays it. The
			// `postWinStatic` revert below runs on BOTH paths, which is what makes this the fix rather
			// than a mitigation: the cap ends the lit state too, so nothing is left glowing.
			//
			// WHICH cap is the budget's job (`resolveWinBeatBudget`): the coded guard by default, the
			// project's authored ceiling when it set one, and the short unauthored beat for a cell that
			// bound nothing. Read at DISPATCH time, not module init — the live runtime bundle arrives
			// asynchronously after boot, so a budget captured earlier would be the coded default forever.
			const budget = resolveWinBeatBudget(bakedWinBeatMaxMs());
			const covered = stackedCoverage();
			const getPromises = () =>
				symbolPositions.map(async (position) => {
					const reelSymbol = context.stateGame.board[position.reel].reelState.symbols[position.row];
					// NEVER RE-LIGHT A CELL THAT IS OFF THE BOARD. A removed cell (the pop,
					// `boardExplodeWinSymbols` below) draws nothing, so it can never report an `oncomplete`
					// — lighting it would buy the whole `WIN_BEAT_CAP_MS` for an empty seat and freeze the
					// presentation for it. The pop is deliberately sequenced AFTER every win of the spin
					// has narrated, so nothing reaches this on a live path; it is here so a future caller
					// that animates a stale position cannot reintroduce that stall.
					if (reelSymbol.removed) return;
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
						//
						// A cell with NOTHING bound for `win` gets the short unauthored beat rather than the
						// runaway guard: `Symbol.svelte` mounts no renderer for it, so its `oncomplete` can
						// never fire and the guard would be its whole pace. Same question, same answer as
						// `TumbleBoard`'s emerge arrival. The budget's own ceiling applies either way.
						await Promise.all([
							awaitSymbolBeat(
								(resolve) => (reelSymbol.oncomplete = resolve),
								hasAuthoredSymbolState(reelSymbol.rawSymbol.name, 'win')
									? budget.capMs
									: budget.unauthoredMs,
							),
							waitForTimeout(budget.minMs),
						]);
					}
					// The cell ENDS at rest — BUT ONLY IF THIS BEAT IS STILL THE ONE ON IT. The pop is
					// presentation and it is NOT part of this beat: it runs once per spin, over that
					// spin's whole winning set, after every win has narrated (`boardExplodeWinSymbols`).
					//
					// THE BEAT CAN OUTLIVE THE PRESENTATION THAT STARTED IT. A slam drops the subscriber
					// promise (`awaitCue` → `slamHold`, `unskippablePresentation.ts`) and this handler
					// keeps running DETACHED, so the round moves on while the floor below is still
					// ticking. The pop then starts on a cell this beat still thinks it owns, and an
					// unconditional revert tore the `explosion` down ~50ms in: its art was replaced, so
					// its `oncomplete` never fired, the pop settled only on `WIN_BEAT_CAP_MS` and a
					// slammed paying spin froze for ~4s with the spin button locked. Structural, not a
					// knife-edge — the last win's floor lands at `(W-1)·H + WIN_BEAT_MIN_MS` while the pop
					// starts at `W·H`, and the per-win slam hold `H` (200ms, 600 with a message) is always
					// under the 650ms floor.
					//
					// So a beat only settles the state IT set. Anything else on the cell belongs to a
					// LATER beat, which settles its own ending (the pop does exactly this for `explosion`
					// below; the board clear owns `clearReel`). A cell still reading `win` is settled
					// exactly as before — including one a second win of the same round re-lit, which is
					// why this is a state check and not an ownership token: reverting there is what the
					// pop being OFF does too, and the two must stay identical.
					//
					// `winLineColor` rides the same guard because it is read ONLY in the `win` state
					// (`Symbol.svelte`'s `showWinFrame`): on a cell that has moved on there is no frame
					// left to tint, and the next win beat sets it fresh.
					if (reelSymbol.symbolState === 'win') {
						reelSymbol.symbolState = 'postWinStatic';
						reelSymbol.winLineColor = undefined;
					}
				});

			await Promise.all(getPromises());
		},
		/**
		 * EXPLODE AND BE GONE — the spin's winners pop together and leave the board.
		 *
		 * WHY IT IS NOT THE TAIL OF THE WIN BEAT, which is where it started. A spin presents its wins
		 * ONE AFTER ANOTHER over the same board, and overlapping paylines share cells — line 1
		 * (`[0,0,0,0,0]`), line 6 (`[0,0,1,2,2]`) and line 18 (`[0,0,2,0,0]`) all pay on reels 0-1 of
		 * row 0, and a quarter of the reference books' `winInfo` events have at least one cell paid by
		 * two wins. A pop at the end of each win therefore took a cell OFF the board that a later win
		 * of the same spin still had to light: the later win re-lit an unmounted cell, whose
		 * `oncomplete` can never fire, so the beat sat out `WIN_BEAT_CAP_MS`. Deferred to here the
		 * narration is untouched — byte-identical to the pop being off — and the explosion is one
		 * extra beat at the end of the spin.
		 *
		 * CONCURRENT, so the whole pop costs ONE bounded beat rather than one per cell. Each cell is
		 * removed on BOTH exits of the race, exactly like the `postWinStatic` revert above it: a cell
		 * whose art can never report `oncomplete` pays the cap and is then just as gone. It is the
		 * SYMBOL that is marked, not its seat — the next board un-removes it by being new cells (see
		 * `ReelSymbol.removed`).
		 *
		 * A STACKED-COVERED cell is deliberately excluded: it mounts no `<Symbol>` at all, so there is
		 * nothing to draw the pop with and nothing that could ever report it — the beat would be a
		 * dead hold, and it would end the tall picture's win art early for no picture. The stacked
		 * mode's win beat stays the tall picture itself.
		 */
		boardExplodeWinSymbols: async ({ symbolPositions }) => {
			const budget = resolveWinBeatBudget(bakedWinBeatMaxMs());
			const covered = stackedCoverage();
			await Promise.all(
				symbolPositions.map(async (position) => {
					const reelSymbol = context.stateGame.board[position.reel]?.reelState.symbols[position.row]; // prettier-ignore
					if (!reelSymbol || reelSymbol.removed) return;
					if (covered.has(winDimCellKey(position.reel, position.row))) return;
					// A SYMBOL WITH NO `explosion` BOUND IS SKIPPED, for exactly the reason the stacked
					// cell above it is — and this is the one that actually bites in the field.
					//
					// `explosion` resolves through `resolveSymbolState`, which falls back to `static` when
					// the state is unbound. On a cell that has just finished its win the resolved art is
					// then IDENTICAL to what is already on screen, so nothing re-mounts: `SymbolSprite`
					// fires `oncomplete` from an `$effect` on `symbolInfo` and `SymbolFlipbook` re-arms its
					// beat the same way, and neither effect re-runs when the value it watches has not
					// changed. The cell can therefore never report, and because this whole pop is ONE
					// concurrent `Promise.all`, a single such winner makes EVERY paying spin containing it
					// sit out the full budget with nothing on screen to show for it.
					//
					// Measured on the live `test6`: of the nine symbols actually IN PLAY (the in-play set is
					// `paddingReels`, not the dictionary — `game-config`'s `symbolsInPlay`), eight bind an
					// `explosion` and the SCATTER does not. So a scatter win cost 4s of dead hold while an
					// ordinary line win popped in 0.5s. The scatter is the likely shape of this bug in
					// general: it is the symbol a project is most apt to leave unbound, because it pays
					// "anywhere" rather than on a line and reads as not really a board symbol.
					//
					// It still LEAVES, though: "and be gone" is the pop's other half, and a winner left
					// standing is swept by the next board's clear playing `clearReel` — the double pop this
					// feature exists to prevent. So the cell is removed, just not waited on.
					if (!hasAuthoredSymbolState(reelSymbol.rawSymbol.name, 'explosion')) {
						reelSymbol.removed = true;
						return;
					}
					reelSymbol.symbolState = 'explosion';
					// Capped like the win beat above and for the same reason — an `explosion` cell bound to
					// art that can never report `oncomplete` must not hang the round. NO floor here, unlike
					// the win beat: the readable minimum is already spent on the win, and a second one
					// would add it to every paying spin.
					//
					// The authored budget covers this beat too, so "cap each win at N" bounds what a paying
					// cell costs in total rather than only its first half.
					await awaitSymbolBeat((resolve) => (reelSymbol.oncomplete = resolve), budget.capMs);
					// UNCONDITIONAL, unlike the state below: "explode and be gone" is the pop's whole
					// promise, and a cell it lit must not be left standing for the next board clear to
					// pop a second time — whichever exit of the race got here.
					reelSymbol.removed = true;
					// Not left parked on `explosion` for a state reader to find, exactly as the win beat
					// settles its own cells — and behind the same guard, for the same reason: a beat
					// settles only the state it set, so a cell some later beat has already moved on is
					// left to whoever owns it now.
					if (reelSymbol.symbolState === 'explosion') {
						reelSymbol.symbolState = 'postWinStatic';
						reelSymbol.winLineColor = undefined;
					}
				}),
			);
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
