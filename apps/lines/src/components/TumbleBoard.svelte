<script lang="ts" module>
	import type { Position, RawSymbol } from 'engine-game';

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
		| { type: 'tumbleBoardExplode'; explodingPositions: ExplodingPositions }
		| {
				type: 'tumbleBoardRemoveExploded';
				/**
				 * Remove only from THIS column. Absent ⇒ every column, which is the cascade's own step,
				 * byte-identical to before this field existed.
				 *
				 * Scoping is not tidiness here, it is CORRECTNESS for the per-column clear. A column
				 * cascade runs its columns concurrently on an absolute stagger, so column `i + 1` can be
				 * mid-explosion while column `i` reaches its removal. An unscoped filter removes every
				 * symbol currently in the `tumbleExplosion` state — including the neighbour's, whose
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
		 * plays an authored `tumbleExplosion` state — which is exactly what a drain is NOT (nothing
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
	import { Tween } from 'svelte/motion';
	import { backOut, cubicIn } from 'svelte/easing';

	import { BoardContext } from 'components-shared';

	import { BoardContainer } from 'engine-game';

	import TumbleBoardBase from './TumbleBoardBase.svelte';
	import BoardTiles from './BoardTiles.svelte';
	import BoardMask from './BoardMask.svelte';
	import { getContext } from '../game/context';
	import { awaitSymbolBeat, INTRO_BEAT_CAP_MS, TRANSIT_BEAT_CAP_MS } from '../game/symbolBeat';
	import { getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';
	import {
		stateTumble,
		tumbleBoardCombined,
		resetTumbleBoard,
		type TumbleSymbol,
	} from '../game/stateTumble.svelte';
	import { PAD_ROWS_ABOVE } from '../game/tumbleBoardLayout';
	import {
		playSymbolIntroSound,
		playSymbolTumbleExplosionSound,
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

	const createTumbleSymbol = ({
		initY,
		rawSymbol,
	}: {
		initY: number;
		rawSymbol: RawSymbol;
	}): TumbleSymbol => {
		const symbolY = new Tween(initY);
		const tumbleSymbol = $state({
			symbolY,
			rawSymbol,
			symbolState: 'static' as const,
			oncomplete: () => {},
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

	/** ONE column as it stands right now, seated exactly where the reels left it. */
	const initTumbleBoardBaseReel = (reelIndex: number) =>
		(stateGameDerived.boardRaw()[reelIndex] ?? []).map((rawSymbol, symbolIndex) =>
			createTumbleSymbol({
				initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y,
				rawSymbol,
			}),
		);

	/** The board as it stands right now, seated exactly where the reels left it. */
	const initTumbleBoardBase = () =>
		stateGameDerived.boardRaw().map((rawSymbolReel, reelIndex) =>
			rawSymbolReel.map((rawSymbol, symbolIndex) =>
				createTumbleSymbol({
					initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y,
					rawSymbol,
				}),
			),
		);

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
		tumbleBoardReset: () => resetTumbleBoard(),
		tumbleBoardExplode: async ({ explodingPositions }) => {
			// Every winning cell plays its authored `tumbleExplosion` state at once, and the step is not
			// done until the LAST one reports back — a cascade that removed symbols before their
			// explosion finished would eat the animation the Symbols tool exists to author.
			//
			// `tumbleExplosion`, NOT `explosion`: the cascade's pop and the on-reel morph's pop are
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
			await Promise.all(
				explodingPositions.map(async (position) => {
					const tumbleSymbol = stateTumble.base[position.reel]?.[position.row];
					if (!tumbleSymbol) return;
					// A symbol may also carry its OWN pop (Invisible Symbols → per-symbol sound), heard
					// alongside the step's cue rather than instead of it. Unbound — the normal case — this
					// broadcasts nothing at all.
					playSymbolTumbleExplosionSound(tumbleSymbol.rawSymbol.name);
					tumbleSymbol.symbolState = 'tumbleExplosion';
					await awaitBeat((resolve) => (tumbleSymbol.oncomplete = resolve));
				}),
			);
		},
		tumbleBoardRemoveExploded: ({ reelIndex }) => {
			// Absent ⇒ every column, reached by the same expression as before the field existed
			// (parity by early return, not by a generalised path that happens to include everything).
			if (reelIndex === undefined) {
				stateTumble.base = stateTumble.base.map((tumbleReel) =>
					tumbleReel.filter((tumbleSymbol) => tumbleSymbol.symbolState !== 'tumbleExplosion'),
				);
				return;
			}
			const tumbleReel = stateTumble.base[reelIndex];
			if (!tumbleReel) return;
			stateTumble.base[reelIndex] = tumbleReel.filter(
				(tumbleSymbol) => tumbleSymbol.symbolState !== 'tumbleExplosion',
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
			await Promise.all(
				draining.map((tumbleSymbol, symbolIndex) =>
					tumbleSymbol.symbolY.set(
						getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW + dropRows).y,
						{ duration: COLUMN_DRAIN_MS, easing: cubicIn },
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

								await tumbleSymbol.symbolY.set(targetY, { duration: 200, easing: backOut });

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
			await Promise.all(
				tumbleBoardCombined().flatMap((tumbleReel, reelIndex) => {
					if (onlyReel !== undefined && reelIndex !== onlyReel) return [];
					// WHICH LAYER a symbol came from is the whole rule here, and it has to be asked
					// before the loop: `tumbleBoardCombined` merges the two, and by identity is the only
					// honest way to ask afterwards (a survivor and a refill can hold equal `rawSymbol`s).
					const arriving = new Set(stateTumble.adding[reelIndex] ?? []);
					return tumbleReel.map(async (tumbleSymbol, symbolIndex) => {
						const visible = symbolIndex > 0 && symbolIndex < tumbleReel.length - 1;
						const seatY = getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW).y;

						// A SURVIVOR IS NOT ARRIVING — it is relocating, and it must actually travel.
						//
						// This is the half of the cascade the style cannot take away. `combineTumbleReel`
						// stacks the refills ABOVE the survivors, which is the engine's gravity model and
						// the board the SERVER scored the next step against; placing a survivor at its new
						// seat instantly would still land on the right board, but the player would see a
						// symbol that did not win teleport down the column. So it slides exactly as
						// `tumbleBoardSlideDown` moves it, and plays `land`, not `intro`: nothing has
						// arrived, something has settled.
						if (!arriving.has(tumbleSymbol)) {
							if (seatY === tumbleSymbol.symbolY.current) return;
							await tumbleSymbol.symbolY.set(seatY, { duration: 200, easing: backOut });
							if (!visible) return;
							tumbleSymbol.symbolState = 'land';
							stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
							await awaitBeat((resolve) => {
								tumbleSymbol.oncomplete = () => {
									tumbleSymbol.symbolState = 'static';
									resolve();
								};
							});
							tumbleSymbol.symbolState = 'static';
							return;
						}

						if (visible) tumbleSymbol.symbolState = 'intro';
						tumbleSymbol.symbolY.set(seatY, { duration: 0 });
						if (!visible) return;
						// The scatter counter and the class land cue — the SAME hook the cascade's
						// refill calls, because an emerge IS the arrival however little it moved, and a
						// board that arrived without ticking the counter is a bonus that never triggers.
						stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
						// …and the symbol's OWN emerge voice on top, when Invisible Symbols binds one.
						// Additive, like the cascade pop — see `playSymbolIntroSound` for why this one
						// layers where `land` replaces.
						playSymbolIntroSound(tumbleSymbol.rawSymbol.name);
						await awaitSymbolBeat((resolve) => {
							tumbleSymbol.oncomplete = () => {
								tumbleSymbol.symbolState = 'static';
								resolve();
							};
						}, INTRO_BEAT_CAP_MS);
						tumbleSymbol.symbolState = 'static';
					});
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
			<BoardMask />
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
		</BoardContainer>
	</BoardContext>
{/if}
