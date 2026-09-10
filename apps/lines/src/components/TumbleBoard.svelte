<script lang="ts" module>
	import type { Position, RawSymbol, SymbolState } from 'engine-game';

	type AddingBoard = RawSymbol[][];
	type ExplodingPositions = Position[];

	export type EmitterEventTumbleBoard =
		| { type: 'tumbleBoardShow' }
		| { type: 'tumbleBoardHide' }
		| {
				type: 'tumbleBoardInit';
				addingBoard: AddingBoard;
				/**
				 * Keep the CURRENT board as the survivor (`base`) layer? Absent ⇒ `true` = the cascade,
				 * exactly as it has always worked.
				 *
				 * `false` is the swap-in-place DROP-IN reveal (docs/design/perspective-board-mode.md
				 * §"The mode switch"), where `addingBoard` is the whole new board and there are no
				 * survivors. It has to be said explicitly, because "no survivors" is not something the
				 * cascade's own steps can express: the drop-in runs WITHOUT `tumbleBoardExplode` /
				 * `tumbleBoardRemoveExploded`, so nothing would ever filter the old board out of `base`.
				 * Left in, the combined column would be twice as tall — which would settle the reels on a
				 * double-height board and fire `land` on the off-screen half.
				 *
				 * "No survivors" is still ONE EMPTY COLUMN PER REEL, not an empty array:
				 * `tumbleBoardCombined` maps over `base`, so a `[]` base would combine to `[]` and the
				 * adding layer would never be drawn or settled at all.
				 */
				keepBase?: boolean;
				/**
				 * Scope the init to ONE column. Absent ⇒ every column, byte-identical to before this
				 * field existed (the handler early-returns the two original lines on that answer).
				 *
				 * It exists for the COLUMN CASCADE (docs/design/perspective-board-mode.md §"The mode
				 * switch"), which queues each column's replacements only once THAT column has drained.
				 * A full init cannot express that: `tumbleBoardCombined` stacks `adding` ABOVE `base`
				 * in the same column, so queueing every column up front would push the columns that
				 * have not drained yet down by a whole strip of combined indices — and since
				 * `TumbleBoardBase` reads a symbol's row (its x and its row SCALE) from that index, a
				 * still-resting board would snap to the wrong seats the moment the cascade began.
				 * Scoped, only the column being swapped moves, which is the whole point of the style.
				 *
				 * A scoped init REFINES a full one — it writes into the layers a full init built, so
				 * the column has to already exist. A column that does not is left alone rather than
				 * punched into the array as a hole, because `tumbleBoardCombined` maps over `base`.
				 */
				reelIndex?: number;
		  }
		| { type: 'tumbleBoardReset' }
		| {
				type: 'tumbleBoardExplode';
				explodingPositions: ExplodingPositions;
				/**
				 * Order these seats against the WHOLE BOARD rather than among themselves (Invisible
				 * Symbols State Machine → Explosion pattern).
				 *
				 * Set by the swap-in-place board CLEAR, and only by it. That beat is fanned out one
				 * COLUMN PER CALL (`clearOutgoingSymbols(reelIndex)`), so the default dense ranking —
				 * "where do these seats sit among themselves" — saw one column's worth of identical
				 * column keys and answered "all wave 0". Every column therefore popped in the same
				 * frame, which is exactly the board-explodes-at-once the pattern exists to break up,
				 * on the beat the player watches every single spin.
				 *
				 * Absent ⇒ dense ranking, which is right for the cascade: it passes the whole winning
				 * set in one call, and a win on reels 2-4 must not wait through two empty waves.
				 */
				patternScope?: 'board';
		  }
		| {
				type: 'tumbleBoardRemoveExploded';
				/**
				 * Remove only from THIS column. Absent ⇒ every column, which is the cascade's own step,
				 * byte-identical to before this field existed.
				 *
				 * Scoping is not tidiness here, it is CORRECTNESS for the per-column clear. A column
				 * cascade runs its columns concurrently on an absolute stagger, so column `i + 1` can be
				 * mid-explosion while column `i` reaches its removal. An unscoped filter removes every
				 * symbol currently in the `clearReel` state — including the neighbour's, whose
				 * animation is still playing — so the column ahead would lose its symbols early and silently.
				 */
				reelIndex?: number;
		  }
		| {
				type: 'tumbleBoardSlideDown';
				/** Slide ONE column into its seats. Absent ⇒ every column, byte-identical to before this
				 *  field existed — the cascade slides the whole board at once and always has. The column
				 *  cascade slides each column on its own beat, staggered left to right. */
				reelIndex?: number;
		  }
		/**
		 * DRAIN one column: its resting symbols fall DOWN out of the board window and are then
		 * removed from the survivor layer. The first half of a column cascade's per-column swap
		 * (docs/design/perspective-board-mode.md §"The mode switch").
		 *
		 * A cue of its own rather than a field on one of the four above, because it is a motion none
		 * of them performs: `tumbleBoardSlideDown` moves symbols INTO their seats and never removes
		 * anything, `tumbleBoardRemoveExploded` removes without animating, and `tumbleBoardExplode`
		 * plays an authored `clearReel` state — which is exactly what a drain is NOT (nothing
		 * has won, so nothing pops). Folding a delete into the slide would put a mutation inside the step every
		 * cascade already runs, which is the one step that must stay byte-identical.
		 *
		 * The removal is the cue's OWN completion, not a follow-up: a drain that left its symbols on
		 * the board would settle them back onto the reels, and the refill that follows relies on the
		 * column being empty so the new symbols take combined indices 0…n and therefore the seats they
		 * are aimed at.
		 *
		 * `reelIndex` is required. An "every column" drain has no caller — the cascade always names a
		 * column — and an optional one would be a code path nothing exercises.
		 */
		| { type: 'tumbleBoardDrain'; reelIndex: number }
		/**
		 * APPEAR in place — every symbol is seated INSTANTLY and plays its authored `intro` state
		 * there. The whole of the `emerge` swap style (docs/design/perspective-board-mode.md
		 * §"The mode switch", `swapStyle: 'emerge'`).
		 *
		 * A cue of its own rather than a flag on `tumbleBoardSlideDown`, because it is the ABSENCE of
		 * the motion that cue exists to perform. A slide with `duration: 0` would reach the same
		 * seats, but it would also keep the slide's contract — tween, then `land` — and the whole
		 * point of this style is that the arrival animation replaces the landing one rather than
		 * following it. Folding a "do not actually move" branch into the step every cascade runs is
		 * also the one change that could not be made without touching the shared `_runtime/lines`
		 * bundle's hot path.
		 *
		 * `reelIndex` scopes it to ONE column, exactly like the slide's: absent ⇒ every column, which
		 * is the un-swept surfacing (`columnStaggerMs: 0`, and the default for a board that authors
		 * no stagger is the sweep driven by the caller, not by this cue).
		 *
		 * TWO LAYERS, TWO ANSWERS. A REVEAL has no survivors (`keepBase: false`), so every symbol is
		 * arriving and the cue is exactly what its name says. A CASCADE has both: the refills arrive
		 * and appear in place, while the SURVIVORS relocate — the refills stack above them, so a
		 * symbol that did not win still changes seat and must be seen to travel there. It therefore
		 * slides and plays `land`, precisely as `tumbleBoardSlideDown` moves it. That is not a
		 * compromise on the style: an emerge is about how a symbol ARRIVES, and a survivor is not
		 * arriving.
		 */
		| { type: 'tumbleBoardAppear'; reelIndex?: number };
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut, cubicIn } from 'svelte/easing';

	import { BoardContext } from 'components-shared';

	import { BoardContainer } from 'engine-game';
	import { tumbleExplosionDelays } from 'engine-layout';
	import { waitForTimeout } from 'utils-shared/wait';

	import TumbleBoardBase from './TumbleBoardBase.svelte';
	import BoardTiles from './BoardTiles.svelte';
	import BoardMask from './BoardMask.svelte';
	import SymbolLayer from './SymbolLayer.svelte';
	import {
		bakedSymbolTransition,
		bakedTumblePattern,
		type SymbolTransition,
	} from '../editor-scenes';
	import { getContext } from '../game/context';
	import { awaitSymbolBeat, INTRO_BEAT_CAP_MS, TRANSIT_BEAT_CAP_MS } from '../game/symbolBeat';
	import { getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';
	import { hasAuthoredSymbolState } from '../game/utils';
	import {
		stateTumble,
		tumbleBoardCombined,
		resetTumbleBoard,
		type TumbleSymbol,
	} from '../game/stateTumble.svelte';
	import { PAD_ROWS_ABOVE } from '../game/tumbleBoardLayout';
	import {
		playSymbolIntroSound,
		playSymbolClearReelSound,
		playTumbleExplosionSound,
	} from '../game/soundBindings';

	/**
	 * The CASCADE board — mounted only while a tumble plays, then unmounted again.
	 *
	 * It is an OVERLAY, not a change to the reel board: the round hides the reels
	 * (`boardHide`), shows this, runs explode → remove → slide, broadcasts the settled result as an
	 * ordinary `boardSettle`, and gives the screen back (`boardShow`). That seam is what keeps the
	 * mechanic off every game that does not tumble — a lines or book-of game never mounts this and is
	 * byte-identical with it in the bundle.
	 *
	 * Seats come from the shared `getSymbolSeat`, NOT from a fixed `SYMBOL_SIZE` step. The reference
	 * cluster game could assume `(index + 0.5) * SYMBOL_SIZE` because its board had one geometry; this
	 * runtime's board has an authorable reel grid (row pitch, lead, per-cell alignment, nudge), so a
	 * symbol dropped by the cascade must land on the SAME seat a settled reel would have given it.
	 * `getSymbolSeat` composes the exact resting-seat expression `createReelForSpinning` uses, which
	 * is what makes the two agree by construction rather than by a matching constant.
	 */

	const context = getContext();

	let show = $state(false);

	/**
	 * How many symbol MOVEMENTS are in flight on this overlay — the overlay's own answer to the one
	 * question the board mask needs before it may let art spill past the reel window.
	 *
	 * It needs its own, because the reel board's answer is meaningless here: `reelState.motion` and
	 * `rolling` are written only by a reel's spin loop, and a swap-in-place board never spins, so
	 * every reel reads "settled" for this overlay's entire life — mid-fall included.
	 *
	 * A COUNTER, not a boolean, because the beats overlap by design: `columnCascade` runs one drain +
	 * slide per column on independent staggered timers, so two columns are routinely moving at once
	 * and a boolean would be cleared by whichever finished first.
	 *
	 * Only the three beats where a symbol actually TRAVELS are counted — drain, slide-down, and the
	 * appear's survivor-vacate phase. The beats the owner reported clipped are deliberately NOT
	 * counted, because nothing travels in them: `clearReel` is set on symbols already resting on
	 * their seats, and `intro` is set immediately before a `symbolY.set(…, { duration: 0 })` whose own
	 * comment is "Nothing travels; the arrival is the animation, not the movement."
	 */
	let transiting = $state(0);

	/** Run one movement, counted. `finally` so a thrown/interrupted beat cannot leave the overlay
	 *  permanently "in transit" and silently withhold the overflow for the rest of the session. */
	const inTransit = async (run: () => Promise<unknown>) => {
		transiting += 1;
		try {
			await run();
		} finally {
			transiting = Math.max(0, transiting - 1);
		}
	};

	/** Every symbol is resting on its seat, so authored `intro` / `explosion` art may spill exactly as
	 *  a landed reel symbol's does. Gated on `show` too, so a hidden overlay never widens anything. */
	const overlaySettled = $derived(show && transiting === 0);

	/**
	 * Is the REEL board on screen? Tracked here — off the same `boardShow`/`boardHide` cues
	 * `Board.svelte` binds, which the emitter delivers to every subscriber — purely so the ground
	 * tile layer below can never draw twice. Initialised `true` because that is what `Board.svelte`
	 * initialises its own `show` to, and the two components mount together.
	 *
	 * The alternative, "the cues are always broadcast in the same synchronous batch so Svelte flushes
	 * one mount and one unmount together", is an argument rather than a guarantee: `boardHide` /
	 * `tumbleBoardShow` are both authorable Broadcast cues in the flow-v2 standard vocabulary, so a
	 * doc CAN show this overlay without hiding the reels and hold both on screen for as long as it
	 * likes. Two coplanar tile layers with alpha in the art would then darken the ground.
	 */
	let reelBoardShown = $state(true);

	/** Row index of the padding row above the visible board — where a falling symbol starts. Derived
	 *  from `PAD_ROWS_ABOVE` so the seat offset and the layer stacking read the same fact. */
	const PADDING_ROW = -PAD_ROWS_ABOVE;

	/**
	 * Await a symbol's completion, but never longer than {@link TRANSIT_BEAT_CAP_MS}.
	 *
	 * Both the cap and the race live in `game/symbolBeat.ts` now — the win beat (`Board.svelte`) and
	 * the multiplier collect (`MultiplierBoard.svelte`) need exactly the same guard for exactly the
	 * same reason, and the win beat shipped for months without one. See that module for WHY a symbol
	 * can fail to report at all, and what a cap being a runaway guard rather than a pace costs.
	 */
	const awaitBeat = (arm: (resolve: () => void) => void) =>
		awaitSymbolBeat(arm, TRANSIT_BEAT_CAP_MS);

	/**
	 * ONE SEAT'S POP: await it, and take the symbol off the screen the moment its own animation
	 * reports — see {@link TumbleSymbol.exploded} for why undrawn and removed are two different
	 * things here.
	 *
	 * The flag is set INSIDE the armed callback rather than after the `await`, and that placement is
	 * the whole of the guard. `awaitSymbolBeat` races the report against {@link
	 * TRANSIT_BEAT_CAP_MS}, so settling after the await would fire on the CAP too — and the cap is
	 * 650 ms, shorter than an explosion a project is perfectly entitled to author. That would cut a
	 * long pop off mid-frame, which is the invisible failure this file's beat helper is at pains
	 * about: truncation looks like art, not like a bug.
	 *
	 * Armed here instead, the two cases separate on their own. A symbol that reports LATE still
	 * reports — the armed callback survives the lost race and fires into an already-settled promise
	 * (`symbolBeat.ts` says so) — so a long explosion plays out in full and then vanishes on its own
	 * last frame. A symbol that can never report at all (no art, a spine animation missing from the
	 * skeleton) never sets it, and simply stays until the board-wide removal, exactly as it did
	 * before this existed.
	 */
	const awaitExplosion = (tumbleSymbol: TumbleSymbol) =>
		awaitBeat(
			(resolve) =>
				(tumbleSymbol.oncomplete = () => {
					tumbleSymbol.exploded = true;
					resolve();
				}),
		);

	const createTumbleSymbol = ({
		initY,
		rawSymbol,
		removed = false,
	}: {
		initY: number;
		rawSymbol: RawSymbol;
		/**
		 * This seat's REEL cell was already taken off the board by the end-of-round pop (Invisible
		 * Symbols → "Winning symbols explode"). The overlay's survivor layer is built from the resting
		 * board, so without this the symbols that blew up at the end of the round would come BACK for
		 * the length of the next spin's clear — the one moment the reel board is hidden and this layer
		 * is the board.
		 *
		 * It is born UNDRAWN (`exploded`, which is what `TumbleSymbol.svelte` gates its cell on) but
		 * in the ORDINARY `static` state, and the difference between those two is load-bearing.
		 * `tumbleBoardRemoveExploded` filters `base` by `symbolState === 'clearReel'`, i.e. by what
		 * THIS step popped — so a seat born `clearReel` would be swept by a step that never named it,
		 * and a cascade (whose exploding set is the BOOK's, sized against `newSymbols`) would settle a
		 * column short and hand every later step of the chain the wrong rows. Born `static` it is
		 * swept only when the step's own exploding set covers it, which is exactly what the board
		 * CLEAR does (see the explode handler, which marks an already-gone seat and returns).
		 */
		removed?: boolean;
	}): TumbleSymbol => {
		const symbolY = new Tween(initY);
		const tumbleSymbol = $state({
			symbolY,
			rawSymbol,
			symbolState: 'static' as SymbolState,
			oncomplete: () => {},
			exploded: removed,
		});
		return tumbleSymbol;
	};

	/**
	 * How long a drained column takes to fall out of the window.
	 *
	 * `cubicIn` rather than the slide's `backOut`: a landing overshoots and settles, an EXIT
	 * accelerates away. The `backIn` mirror was the obvious choice and is wrong here — it winds UP
	 * before dropping, and the top row winding up pokes through the board window's top edge.
	 */
	const COLUMN_DRAIN_MS = 260;

	/** ONE column's replacements, stacked ABOVE the board in the order they will fall in. */
	const initTumbleBoardAddingReel = (reelIndex: number, addingReel: RawSymbol[]) =>
		addingReel.map((rawSymbol, symbolIndex) =>
			createTumbleSymbol({
				initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW - addingReel.length).y,
				rawSymbol,
			}),
		);

	/** The replacements, stacked ABOVE the board in the order they will fall in. */
	const initTumbleBoardAdding = ({ addingBoard }: { addingBoard: AddingBoard }) =>
		stateGameDerived
			.boardRaw()
			.map((_reel, reelIndex) =>
				initTumbleBoardAddingReel(reelIndex, addingBoard[reelIndex] ?? []),
			);

	/**
	 * NO survivors — one EMPTY column per reel. The drop-in reveal replaces the whole board, so the
	 * base layer holds nothing; the columns themselves still have to exist because
	 * `tumbleBoardCombined` maps over `base` and would otherwise combine to nothing. Shaped from the
	 * live board so the reel COUNT is the real one, exactly like the two initialisers beside it.
	 */
	const initTumbleBoardNoBase = (): TumbleSymbol[][] => stateGameDerived.boardRaw().map(() => []);

	/** ONE column as it stands right now, seated exactly where the reels left it — the seats the
	 *  end-of-round pop emptied included, born already UNDRAWN (see `createTumbleSymbol`). */
	const initTumbleBoardBaseReel = (reelIndex: number) => {
		const removed = stateGameDerived.boardRemoved()[reelIndex] ?? [];
		return (stateGameDerived.boardRaw()[reelIndex] ?? []).map((rawSymbol, symbolIndex) =>
			createTumbleSymbol({
				initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y,
				rawSymbol,
				removed: removed[symbolIndex],
			}),
		);
	};

	/** The board as it stands right now, seated exactly where the reels left it — the seats the
	 *  end-of-round pop emptied included, born already UNDRAWN (see `createTumbleSymbol`). */
	const initTumbleBoardBase = () => {
		const removed = stateGameDerived.boardRemoved();
		return stateGameDerived.boardRaw().map((rawSymbolReel, reelIndex) =>
			rawSymbolReel.map((rawSymbol, symbolIndex) =>
				createTumbleSymbol({
					initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y,
					rawSymbol,
					removed: removed[reelIndex]?.[symbolIndex],
				}),
			),
		);
	};

	/**
	 * The GROUND TILE art the OVERLAY should draw — or `undefined`, which is every board that has
	 * none and every moment the reel board is the one on screen.
	 *
	 * The tiles live on the reel board (`Board.svelte`), and a swap hides it for the duration
	 * (`boardHide` → overlay → `boardShow`), so without this the ground blinked out on every cascade.
	 * That was mild on a rolling game and unacceptable on a swap-in-place one, where EVERY round is a
	 * cascade. Tiles are static ground: they do not drain and they do not fall, they simply stay put
	 * while the symbols move over them, so the overlay draws the same layer from the same lattice.
	 *
	 * The `!reelBoardShown` term is the anti-double-draw guard — one tile layer on screen at a time,
	 * whichever board owns it. It cannot render two, and it cannot render none while a board is up.
	 *
	 * A board with NO authored `tileRegion` gets `undefined` from `boardTileArt()` and mounts nothing
	 * at all, exactly as on the reel board: byte-parity, which is not optional in the shared
	 * `_runtime/lines` bundle.
	 */
	const overlayTileArt = () =>
		show && !reelBoardShown ? stateGameDerived.boardTileArt() : undefined;
	const tileArt = $derived(overlayTileArt());

	/**
	 * The explosion → intro TRANSITIONS in flight — one per exploding seat (Invisible Symbols State
	 * Machine → Transition, {@link bakedSymbolTransition}), drawn on the animating layer above the
	 * symbols so the pop's end and the intro's start overlap at the same seat instead of cutting.
	 *
	 * The list lives HERE and not in the symbol cell, because the cell does not outlive the seam it
	 * bridges: `tumbleBoardRemoveExploded` filters the exploded symbol object out of `base` the moment
	 * the beat ends, and the transition has to survive that removal AND the appear that follows.
	 *
	 * FIRE-AND-FORGET, and that is the whole contract. Nothing awaits an entry: it never gates the
	 * explosion beat, never delays the intro, never extends the round — the intro still starts exactly
	 * when it did before this existed (see `symbolBeat.ts` for why an awaited beat is the one way this
	 * game freezes; a transition adds no beat at all). An entry leaves the list on its own completion,
	 * `tumbleBoardReset` sweeps whatever is left (a slam or a skipped round leaves no stragglers), and
	 * `tumbleBoardHide` unmounts the overlay it draws on — a transition longer than the step is CUT
	 * there, by design, rather than the round waiting for it.
	 */
	type SeatTransition = {
		key: string;
		x: number;
		y: number;
		scale: number;
		layer: SymbolTransition;
	};
	// `$state.raw`: an entry is only ever replaced whole, never mutated, and a deep proxy would wrap
	// the baked `layer` object every seat shares.
	let transitions = $state.raw<SeatTransition[]>([]);
	/** Per seat, the ONE timer that currently owns the entry: its delay before it mounts, then the
	 *  leak cap after. Sequential per key, so one slot is enough — and one map to sweep on reset. */
	// A plain Map, NOT a SvelteMap: nothing renders from it. It holds `setTimeout` handles so a
	// reset can clear them, and every read is inside a callback — making it reactive would only
	// buy a dependency no template or `$derived` has.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const transitionTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Above the symbols on the animating layer (default z 0) — the same non-zero-zIndex sort
	 *  `BookVfx.svelte`'s foreground and `<BoardFrame>`'s glow rely on. */
	const TRANSITION_Z_INDEX = 1;

	/**
	 * A RUNAWAY GUARD on an entry that never reports — a spine whose bound animation is not in the
	 * skeleton fires no `complete`, and an entry that stayed would draw its last frame over every
	 * later seat until the reset. Sized like `WIN_BEAT_CAP_MS` (double the longest reference
	 * animation) and for the same reason: a real authored transition always finishes first, so this
	 * never shapes one.
	 */
	const TRANSITION_LEAK_CAP_MS = 4_000;

	const clearTransitionTimer = (key: string) => {
		const timer = transitionTimers.get(key);
		if (timer !== undefined) clearTimeout(timer);
		transitionTimers.delete(key);
	};

	const removeTransition = (key: string) => {
		clearTransitionTimer(key);
		transitions = transitions.filter((entry) => entry.key !== key);
	};

	const mountTransition = (entry: SeatTransition) => {
		// Replace rather than duplicate: a keyed `{#each}` throws on a repeated key. A guard, not a
		// restart (Svelte reuses the instance), and unreachable in practice — the reset sweeps the
		// list at the end of every step and a seat explodes once per step.
		transitions = [...transitions.filter((t) => t.key !== entry.key), entry];
		transitionTimers.set(
			entry.key,
			setTimeout(() => removeTransition(entry.key), TRANSITION_LEAK_CAP_MS),
		);
	};

	/**
	 * Schedule the transition at ONE exploding seat, `delayMs` after THAT SEAT's pop fires.
	 *
	 * PER SEAT, and it has to stay per seat, because that is the contract the author is handed: the
	 * Symbols tool's own words under the Transition section are "Plays at the seat when a symbol
	 * explodes… Delay = ms after the explosion fires". A delay tuned against a seat's own pop is the
	 * only thing an author can watch themselves tuning.
	 *
	 * The explosion pattern briefly made this board-wide instead — every seat's bridge waited out the
	 * remaining waves so that all of them landed together, `delayMs` after the LAST one, reasoning
	 * that the intro they bridge into (`tumbleBoardAppear`) is one board-wide beat. It reads well as
	 * an argument and it was wrong on the board: a wave-0 seat's bridge arrived a whole spread late,
	 * over a symbol that had long finished popping, so the cover and the pop it covers came apart.
	 *
	 * The tell was that the board CLEAR looked right while a cascade did not, off the same authored
	 * transition. The clear is fanned out one column per call, so under a column pattern every seat
	 * in a call shares a wave and the catch-up was always zero there — it only ever fired on the
	 * cascade, which hands the whole winning set over in a single call. Per-seat everywhere is what
	 * makes those two agree again.
	 *
	 * The seam under a pattern is genuinely two things — a staggered pop and one board-wide intro —
	 * and a single layer cannot sit on both. It sits on the pop, which is the end it was authored
	 * against.
	 */
	const scheduleTransition = (
		layer: SymbolTransition,
		position: Position,
		tumbleSymbol: TumbleSymbol,
	) => {
		// The row the symbol is DRAWN at, not `position.row` (its index in `base`): `TumbleSymbol`
		// seats it by its COMBINED index, and the cascade splices the refills into the column before
		// the pop. Under perspective x and scale contract per row, so the base row would put the
		// cover beside the pop instead of over it. Looked up by identity so the two can never drift.
		const drawnRow = tumbleBoardCombined()[position.reel]?.indexOf(tumbleSymbol) ?? -1;
		const seat = getSymbolSeat(
			position.reel,
			(drawnRow >= 0 ? drawnRow : position.row) + PADDING_ROW,
		);
		const entry: SeatTransition = {
			key: `${position.reel}:${position.row}`,
			x: seat.x,
			y: tumbleSymbol.symbolY.current,
			scale: seat.scale,
			layer,
		};
		clearTransitionTimer(entry.key);
		const delayMs = layer.delayMs ?? 0;
		// No delay mounts NOW, in the same flush as the explosion state, so the transition's first
		// painted frame is the pop's first frame; a `setTimeout(…, 0)` would land a tick later.
		if (delayMs <= 0) {
			mountTransition(entry);
			return;
		}
		transitionTimers.set(
			entry.key,
			setTimeout(() => mountTransition(entry), delayMs),
		);
	};

	/** Every pending delay AND every mounted entry — the reset's sweep. */
	const clearTransitions = () => {
		for (const timer of transitionTimers.values()) clearTimeout(timer);
		transitionTimers.clear();
		transitions = [];
	};

	onDestroy(clearTransitions);

	context.eventEmitter.subscribeOnMount({
		tumbleBoardShow: () => (show = true),
		tumbleBoardHide: () => (show = false),
		// Read-only mirrors of the REEL board's own visibility, for the tile layer's double-draw
		// guard (see `overlayTileArt`). `Board.svelte` owns these cues; subscribing to them a second
		// time observes, it does not take them over — the emitter delivers to every subscriber.
		boardShow: () => (reelBoardShown = true),
		boardHide: () => (reelBoardShown = false),
		tumbleBoardInit: ({ addingBoard, keepBase, reelIndex }) => {
			if (reelIndex === undefined) {
				stateTumble.adding = initTumbleBoardAdding({ addingBoard });
				// Absent ⇒ the cascade's survivor layer, byte-identical to before the flag existed.
				stateTumble.base = keepBase === false ? initTumbleBoardNoBase() : initTumbleBoardBase();
				return;
			}
			// SCOPED to one column — a refinement of a full init, so the column must already exist
			// (`tumbleBoardCombined` maps over `base`; punching a hole into it would combine to
			// `undefined.map`). Nothing to refine ⇒ nothing happens, rather than a silently broken board.
			if (!stateTumble.base[reelIndex]) return;
			stateTumble.adding[reelIndex] = initTumbleBoardAddingReel(
				reelIndex,
				addingBoard[reelIndex] ?? [],
			);
			stateTumble.base[reelIndex] = keepBase === false ? [] : initTumbleBoardBaseReel(reelIndex);
		},
		tumbleBoardReset: () => {
			resetTumbleBoard();
			// Pending delays and mounted entries alike — a slam or a skipped round leaves nothing
			// behind to draw over the next step.
			clearTransitions();
		},
		tumbleBoardExplode: async ({ explodingPositions, patternScope }) => {
			// Every winning cell plays its authored `clearReel` state at once, and the step is not
			// done until the LAST one reports back — a cascade that removed symbols before their
			// explosion finished would eat the animation the Symbols tool exists to author.
			//
			// `clearReel`, NOT `explosion`: the board taking a symbol OFF and the on-reel morph are
			// separate bindings in /symbols (`engine-layout/symbolStates`), because they are separate
			// moments and the engine's Spine set ships a separate skeleton for each. A project that
			// binds only the one inherits it here (`resolveSymbolState`), so this reads identically to
			// before the split until someone actually authors the cascade's own.
			//
			// THE POP NOW MAKES A SOUND. It never has: the audiosprite has shipped a five-rung
			// `tumble_win_*` ladder since the fork with no code path playing a rung of it, so the board
			// blew up in silence while the names sat in the flow editor's sound library looking bound.
			// Broadcast ONCE for the whole step (a five-symbol win is one pop, not five), before the
			// animations rather than after, so the cue lands with the picture instead of trailing the
			// slowest cell. `playTumbleExplosionSound` stands down when this cue is the board CLEAR
			// rather than a cascade — see `soundBindings`.
			playTumbleExplosionSound();
			// THE TRANSITION rides along, gated exactly as `bookEventHandlerMap`'s refill is: only a
			// board that appears in place has an intro for it to bridge. Under a sliding refill the
			// seat is filled by a fall, and a bridge into a fall is an effect in the wrong place. Read
			// here rather than at mount — the live runtime bundle resolves after this component does.
			const transition =
				stateGameDerived.boardSwapsInPlace() && stateGameDerived.boardSwapStyle() === 'emerge'
					? bakedSymbolTransition()
					: undefined;
			// THE PATTERN — the order the seats pop in (Invisible Symbols State Machine → Explosion
			// pattern, `engine-layout/tumblePattern`). Un-authored it answers all-zero, which is the
			// single `Promise.all` frame this step has always been; a pattern spreads the same set of
			// seats over waves without changing WHICH of them explode or what the step means.
			//
			// Bounds come from the LIVE base board, not from the exploding set, because the three
			// centre-relative patterns measure from the middle of the BOARD — a win on reels 3-4 of a
			// 5-reel board is off-centre, and saying so is the whole point of `radial`. Measured only
			// when a pattern will read them: the un-authored path is the one every cascading spin runs
			// and it should stay a lookup, not a scan of every column.
			const tumblePattern = bakedTumblePattern();
			const delays = tumbleExplosionDelays(
				explodingPositions,
				tumblePattern,
				tumblePattern && {
					reels: stateTumble.base.length,
					rows: stateTumble.base.reduce((max, reel) => Math.max(max, reel.length), 0),
					// The board CLEAR arrives one column at a time and must be ordered against the board;
					// the cascade arrives whole and must be dense-ranked. See the cue's own doc above.
					rankAgainstBoard: patternScope === 'board',
				},
			);
			await Promise.all(
				explodingPositions.map(async (position, index) => {
					const tumbleSymbol = stateTumble.base[position.reel]?.[position.row];
					if (!tumbleSymbol) return;
					// ALREADY GONE — the end-of-round pop took this seat off the board before the step ever
					// started (Invisible Symbols → "Winning symbols explode"), so it is here only to hold its
					// index. It draws nothing, which means it could never report an `oncomplete`: awaiting it
					// would spend the whole beat cap on a cell with no animation, and popping it would be the
					// second explosion of the same symbol.
					//
					// It is still MARKED, because this step named the seat and the board-wide removal after
					// it sweeps what this step named. That is what lets the board CLEAR — which explodes
					// every visible seat — take the emptied ones away with the rest, while a CASCADE, whose
					// exploding set is the BOOK's, leaves a seat it never named exactly where it is.
					if (tumbleSymbol.exploded) {
						tumbleSymbol.symbolState = 'clearReel';
						return;
					}
					const delayMs = delays[index] ?? 0;
					if (delayMs > 0) {
						await waitForTimeout(delayMs);
						// The board can be swept out from under a wave that has not fired yet — a slam, a
						// skipped round, `tumbleBoardReset`. A symbol no longer on its column is no longer on
						// screen, so popping it would hang this beat on a completion nothing can report (it
						// would cost `TRANSIT_BEAT_CAP_MS`, not forever — but a bounded stall is still a stall
						// on the one step every cascading spin runs). Identity, not index: the column is
						// spliced by the refill.
						if (!stateTumble.base[position.reel]?.includes(tumbleSymbol)) return;
					}
					// A symbol may also carry its OWN pop (Invisible Symbols → per-symbol sound), heard
					// alongside the step's cue rather than instead of it. Unbound — the normal case — this
					// broadcasts nothing at all. Fired HERE rather than with the step's cue so that under a
					// pattern it lands with this seat's own explosion.
					playSymbolClearReelSound(tumbleSymbol.rawSymbol.name);
					tumbleSymbol.symbolState = 'clearReel';
					// Scheduled, never awaited — see `transitions`. `symbolY.current` is the seat the
					// symbol is resting on: `base` was seated where the reels left it. Scheduled HERE, in
					// this seat's own wave, so the bridge rides the pop it is covering rather than the
					// board's last one — see `scheduleTransition`.
					if (transition) {
						scheduleTransition(transition, position, tumbleSymbol);
					}
					await awaitExplosion(tumbleSymbol);
				}),
			);
		},
		tumbleBoardRemoveExploded: ({ reelIndex }) => {
			// Absent ⇒ every column, reached by the same expression as before the field existed
			// (parity by early return, not by a generalised path that happens to include everything).
			if (reelIndex === undefined) {
				stateTumble.base = stateTumble.base.map((tumbleReel) =>
					tumbleReel.filter((tumbleSymbol) => tumbleSymbol.symbolState !== 'clearReel'),
				);
				return;
			}
			const tumbleReel = stateTumble.base[reelIndex];
			if (!tumbleReel) return;
			stateTumble.base[reelIndex] = tumbleReel.filter(
				(tumbleSymbol) => tumbleSymbol.symbolState !== 'clearReel',
			);
		},
		/**
		 * DRAIN one column — the resting symbols fall out of the bottom of the window and are gone.
		 *
		 * They move as a RIGID BLOCK: every symbol drops by the column's own height in lattice rows,
		 * so their spacing is preserved and the topmost one clears the front row. Expressed in rows
		 * through `getSymbolSeat` rather than as a pixel distance, because under perspective the rows
		 * below the board are neither the same pitch nor the same size as the ones inside it — the
		 * seat function already answers that (it clamps the depth ramp past the front row), and a
		 * hand-rolled `+ boardHeight` would not.
		 *
		 * A symbol keeps its own row's `x` and `scale` while it falls: `TumbleBoardBase` derives those
		 * from the symbol's index in the COMBINED column, and a drain runs with this column's `adding`
		 * layer still empty, so the indices — and therefore the seats — are the resting ones. That is
		 * the same contract the fall-in has (its scale is its TARGET row's, held for the whole fall),
		 * pointed the other way.
		 *
		 * No `land`, no `oncomplete`, no sound: nothing is arriving. The symbols are removed the
		 * moment the fall finishes, which is what makes the column empty for the refill that follows.
		 */
		tumbleBoardDrain: async ({ reelIndex }) => {
			const draining = stateTumble.base[reelIndex] ?? [];
			const dropRows = draining.length;
			await inTransit(() =>
				Promise.all(
					draining.map((tumbleSymbol, symbolIndex) =>
						tumbleSymbol.symbolY.set(
							getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW + dropRows).y,
							{ duration: COLUMN_DRAIN_MS, easing: cubicIn },
						),
					),
				),
			);
			stateTumble.base[reelIndex] = [];
		},
		tumbleBoardSlideDown: async ({ reelIndex: onlyReel }) => {
			await Promise.all(
				tumbleBoardCombined().flatMap((tumbleReel, reelIndex) =>
					// Absent ⇒ every column, and the body below is then reached for exactly the symbols
					// it was reached for before this field existed (parity by early exclusion, not by a
					// generalised path that happens to include everything).
					onlyReel !== undefined && reelIndex !== onlyReel
						? []
						: tumbleReel.map(async (tumbleSymbol, symbolIndex) => {
								const targetY = getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y;
								if (targetY === tumbleSymbol.symbolY.current) return;

								// Counted: this is the fall itself. The land beat below stays OUTSIDE the count, so a
								// cascade symbol that has arrived spends the overflow for its landing animation
								// exactly as a landed reel symbol does.
								await inTransit(() =>
									tumbleSymbol.symbolY.set(targetY, { duration: 200, easing: backOut }),
								);

								// Only the VISIBLE rows play their land state — the padding rows top and bottom are
								// off-screen buffer, and landing them would fire land sounds for symbols nobody sees.
								if (symbolIndex > 0 && symbolIndex < tumbleReel.length - 1) {
									tumbleSymbol.symbolState = 'land';
									stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
									await awaitBeat((resolve) => {
										tumbleSymbol.oncomplete = () => {
											tumbleSymbol.symbolState = 'static';
											resolve();
										};
									});
									// The cap can win the race, which would leave the cell parked on `land` forever —
									// visible as a symbol stuck mid-animation once the cascade ends. Settling here is
									// idempotent: the completion path already set it.
									tumbleSymbol.symbolState = 'static';
								}
							}),
				),
			);
		},
		/**
		 * APPEAR — the `emerge` swap style. Every symbol takes its seat with NO travel and plays its
		 * authored `intro` state there.
		 *
		 * THE ORDER OF THE FIRST TWO LINES IS THE FEATURE. The state is set BEFORE the placement, so
		 * Svelte flushes both in one batch and the cell's very first painted frame is already the
		 * intro art. Reversed, a symbol's resting art paints for one frame, at full size, on its final
		 * seat — a hard pop of the whole board, which is precisely the picture this style exists to
		 * avoid. It is not a race that usually goes the right way: it is one flush, decided here.
		 *
		 * `duration: 0` rather than a short tween, and that IS the definition of the style. Nothing
		 * travels; the arrival is the animation, not the movement. The symbol is still placed rather
		 * than left where `tumbleBoardInit` stacked it (a strip above the window, where the board mask
		 * hides it) — that stacking is the drop-in's starting line, and an emerge simply never uses it.
		 *
		 * PADDING ROWS ARE SEATED BUT SILENT, the same rule the slide keeps: the top and bottom rows
		 * are off-screen buffer, so playing an intro there would fire land cues and scatter-counter
		 * ticks for symbols nobody sees.
		 *
		 * The beat is capped by {@link INTRO_BEAT_CAP_MS} rather than the transit cap — an emerge is
		 * an animation authored to be watched, not a step on the way to one, so the guard is sized off
		 * the art (see `symbolBeat.ts`). And `symbolState` is settled to `static` AFTER the await as
		 * well as inside the completion path, because the cap path never runs the callback and a cell
		 * left parked on `intro` is a symbol frozen mid-rise for the rest of the round.
		 */
		tumbleBoardAppear: async ({ reelIndex: onlyReel }) => {
			// ONE classification pass, so the two phases below cannot disagree about a single cell —
			// and so `moved` is captured BEFORE anything is placed, which is the only moment it is
			// still answerable (after phase 1 every survivor is already sitting on its seat).
			const cells = tumbleBoardCombined().flatMap((tumbleReel, reelIndex) => {
				if (onlyReel !== undefined && reelIndex !== onlyReel) return [];
				// WHICH LAYER a symbol came from, by object identity: `tumbleBoardCombined` merges the
				// two, and a survivor and a refill can hold equal `rawSymbol`s.
				const arriving = new Set(stateTumble.adding[reelIndex] ?? []);
				return tumbleReel.map((tumbleSymbol, symbolIndex) => {
					const seatY = getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y;
					return {
						tumbleSymbol,
						seatY,
						arriving: arriving.has(tumbleSymbol),
						// The padding rows top and bottom are off-screen buffer: seated, never sounded.
						visible: symbolIndex > 0 && symbolIndex < tumbleReel.length - 1,
						moved: !arriving.has(tumbleSymbol) && seatY !== tumbleSymbol.symbolY.current,
					};
				});
			});

			// PHASE 1 — THE SURVIVORS VACATE, and it is awaited before a single refill is placed.
			//
			// This ordering is not tidiness, it is the bug it fixes. A refill's seat is very often the
			// seat a survivor is still sitting in: the refills stack directly above the survivors, so
			// the topmost survivor's OLD seat is the bottom refill's NEW one. Placing instantly while
			// the slide is still running drops the new symbol on top of a symbol that has not left yet,
			// and it reads exactly as broken as it sounds. A reveal has no survivors, so this phase is
			// empty there and the arrival below is reached in the same tick as before.
			// Counted: the survivors are the only thing that travels in an emerge. Phase 2 below places
			// its arrivals with `duration: 0` and is deliberately NOT counted — that instant placement
			// IS the style, and its `intro` art is precisely what has to be allowed to spill.
			await inTransit(() =>
				Promise.all(
					cells
						.filter((cell) => cell.moved)
						.map((cell) =>
							cell.tumbleSymbol.symbolY.set(cell.seatY, { duration: 200, easing: backOut }),
						),
				),
			);

			// PHASE 2 — the seats are clear, so the new symbols surface. The survivors play their own
			// landing HERE, alongside the arrivals rather than ahead of them: a landing beat that gated
			// the arrival would add its whole cap to every cascade step for a picture nobody is waiting
			// on.
			await Promise.all(
				cells.map(async ({ tumbleSymbol, seatY, arriving, visible, moved }) => {
					if (!arriving) {
						// A survivor that never changed seat has nothing to report, exactly as the slide
						// leaves it alone.
						if (!moved || !visible) return;
						tumbleSymbol.symbolState = 'land';
						stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
						await awaitBeat((resolve) => {
							tumbleSymbol.oncomplete = () => {
								tumbleSymbol.symbolState = 'static';
								resolve();
							};
						});
						// The cap can win the race, which would leave the cell parked on `land` forever.
						tumbleSymbol.symbolState = 'static';
						return;
					}

					// THE ORDER OF THE NEXT TWO LINES IS THE FEATURE. The state is set BEFORE the
					// placement, so Svelte flushes both in one batch and the cell's very first painted
					// frame is already the intro art. Reversed, a symbol's resting art paints for one
					// frame, at full size, on its final seat — a hard pop of the whole board, which is
					// precisely the picture this style exists to avoid.
					if (visible) tumbleSymbol.symbolState = 'intro';
					// `duration: 0` rather than a short tween, and that IS the definition of the style.
					// Nothing travels; the arrival is the animation, not the movement.
					tumbleSymbol.symbolY.set(seatY, { duration: 0 });
					if (!visible) return;
					// The scatter counter and the class land cue — the SAME hook the cascade's refill
					// calls, because an emerge IS the arrival however little it moved, and a board that
					// arrived without ticking the counter is a bonus that never triggers.
					stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
					// …and the symbol's OWN emerge voice on top, when Invisible Symbols binds one.
					// Additive, like the cascade pop — see `playSymbolIntroSound` for why this one
					// layers where `land` replaces.
					playSymbolIntroSound(tumbleSymbol.rawSymbol.name);
					// THE LONG CAP IS SPENT ONLY ON ART SOMEONE MADE. An un-authored `intro` inherits
					// `land` (or the resting art), which often has nothing to report — so waiting the
					// intro cap on it does not wait for an animation, it just adds 2 s to every arrival.
					// See `hasAuthoredSymbolState`.
					await awaitSymbolBeat(
						(resolve) => {
							tumbleSymbol.oncomplete = () => {
								tumbleSymbol.symbolState = 'static';
								resolve();
							};
						},
						hasAuthoredSymbolState(tumbleSymbol.rawSymbol.name, 'intro')
							? INTRO_BEAT_CAP_MS
							: TRANSIT_BEAT_CAP_MS,
					);
					tumbleSymbol.symbolState = 'static';
				}),
			);
		},
	});
</script>

{#if show}
	<!-- Two layers for the same reason the reel board has them: sprite symbols draw masked and
	     flat, spine symbols draw on the animating layer so they can overflow their cell. -->
	<BoardContext animate={false}>
		<BoardContainer>
			<!-- `overlaySettled`, not `allowOverflow`: the reel-motion gate is blind to this overlay (a
			     swap-in-place board never spins, so every reel reads settled even mid-fall), so it
			     answers for itself with its own transit counter. Nothing authored ⇒ no spill either
			     way. -->
			<BoardMask {overlaySettled} />
			<!--
				GROUND TILES — the SAME layer, in the same place in the same container, as
				`Board.svelte` mounts: first painted child after the mask, so the whole ground sits
				behind every symbol and is clipped by the board window identically. The overlay draws
				it because the reel board is hidden for the length of a swap and the ground must not
				blink out with it (docs/design/perspective-board-mode.md §"The tiles").

				`tileArt` is `undefined` while the reel board is on screen, so exactly one of the two
				layers ever exists; and it is `undefined` for a board with no authored `tileRegion`, so
				such a board's scene graph is byte-identical to before this existed. See
				`overlayTileArt`.
			-->
			{#if tileArt}
				<BoardTiles art={tileArt} />
			{/if}
			<TumbleBoardBase />
		</BoardContainer>
	</BoardContext>

	<BoardContext animate={true}>
		<BoardContainer>
			<TumbleBoardBase />
			<!-- The explosion → intro transitions, above the symbols on the unmasked layer so a splash
			     can overflow its cell the way a spine symbol can. Empty — and byte-identical — unless a
			     transition is authored AND the board emerges; see `transitions`. -->
			{#each transitions as transition (transition.key)}
				<SymbolLayer
					layer={transition.layer}
					x={transition.x}
					y={transition.y}
					scale={transition.scale}
					zIndex={TRANSITION_Z_INDEX}
					once
					oncomplete={() => removeTransition(transition.key)}
				/>
			{/each}
		</BoardContainer>
	</BoardContext>
{/if}
