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
		  }
		| { type: 'tumbleBoardReset' }
		| { type: 'tumbleBoardExplode'; explodingPositions: ExplodingPositions }
		| { type: 'tumbleBoardRemoveExploded' }
		| { type: 'tumbleBoardSlideDown' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';

	import { BoardContext } from 'components-shared';
	import { waitForResolve, waitForTimeout } from 'utils-shared/wait';

	import { BoardContainer } from 'engine-game';

	import TumbleBoardBase from './TumbleBoardBase.svelte';
	import BoardMask from './BoardMask.svelte';
	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';
	import {
		stateTumble,
		tumbleBoardCombined,
		resetTumbleBoard,
		type TumbleSymbol,
	} from '../game/stateTumble.svelte';

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

	/** Row index of the padding row above the visible board — where a falling symbol starts. */
	const PADDING_ROW = -1;

	/**
	 * Longest a cascade beat waits on a symbol's `oncomplete` before moving on.
	 *
	 * A symbol only reports completion when its state actually ANIMATES. `SymbolSprite` fires
	 * `oncomplete` from an `$effect` gated on `symbolInfo` CHANGING, so a symbol whose `explosion`
	 * (or `land`) state resolves to the same art it is already showing — the normal case for a
	 * project that has authored neither — never reports at all. Awaiting that unconditionally
	 * deadlocks the beat, and with it the round: the book event never finishes, so the spin button
	 * stays disabled and the game looks frozen.
	 *
	 * Observed on `test4` exactly that way — the cascade played, then the game would not accept
	 * another spin, intermittently, because whether it hung depended on WHICH symbol exploded.
	 *
	 * So every wait is RACED against this cap: an authored animation still drives the timing (it
	 * resolves first), and an unauthored one costs a bounded beat instead of hanging forever. Same
	 * reasoning as `Board.svelte`'s `STACKED_WIN_HOLD_MS`, which exists because a covered cell mounts
	 * no `<Symbol>` at all — a different cause, the identical failure.
	 */
	const CASCADE_BEAT_CAP_MS = 650;

	/** Await a symbol's completion, but never longer than {@link CASCADE_BEAT_CAP_MS}. */
	const awaitBeat = (arm: (resolve: () => void) => void) =>
		Promise.race([waitForResolve(arm), waitForTimeout(CASCADE_BEAT_CAP_MS)]);

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

	/** The replacements, stacked ABOVE the board in the order they will fall in. */
	const initTumbleBoardAdding = ({ addingBoard }: { addingBoard: AddingBoard }) =>
		stateGameDerived.boardRaw().map((_reel, reelIndex) => {
			const addingReel = addingBoard[reelIndex] ?? [];
			return addingReel.map((rawSymbol, symbolIndex) =>
				createTumbleSymbol({
					initY: getSymbolSeat(reelIndex, symbolIndex + PADDING_ROW - addingReel.length).y,
					rawSymbol,
				}),
			);
		});

	/**
	 * NO survivors — one EMPTY column per reel. The drop-in reveal replaces the whole board, so the
	 * base layer holds nothing; the columns themselves still have to exist because
	 * `tumbleBoardCombined` maps over `base` and would otherwise combine to nothing. Shaped from the
	 * live board so the reel COUNT is the real one, exactly like the two initialisers beside it.
	 */
	const initTumbleBoardNoBase = (): TumbleSymbol[][] => stateGameDerived.boardRaw().map(() => []);

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

	context.eventEmitter.subscribeOnMount({
		tumbleBoardShow: () => (show = true),
		tumbleBoardHide: () => (show = false),
		tumbleBoardInit: ({ addingBoard, keepBase }) => {
			stateTumble.adding = initTumbleBoardAdding({ addingBoard });
			// Absent ⇒ the cascade's survivor layer, byte-identical to before the flag existed.
			stateTumble.base = keepBase === false ? initTumbleBoardNoBase() : initTumbleBoardBase();
		},
		tumbleBoardReset: () => resetTumbleBoard(),
		tumbleBoardExplode: async ({ explodingPositions }) => {
			// Every winning cell plays its authored `explosion` state at once, and the step is not done
			// until the LAST one reports back — a cascade that removed symbols before their explosion
			// finished would eat the animation the Symbols tool exists to author.
			await Promise.all(
				explodingPositions.map(async (position) => {
					const tumbleSymbol = stateTumble.base[position.reel]?.[position.row];
					if (!tumbleSymbol) return;
					tumbleSymbol.symbolState = 'explosion';
					await awaitBeat((resolve) => (tumbleSymbol.oncomplete = resolve));
				}),
			);
		},
		tumbleBoardRemoveExploded: () => {
			stateTumble.base = stateTumble.base.map((tumbleReel) =>
				tumbleReel.filter((tumbleSymbol) => tumbleSymbol.symbolState !== 'explosion'),
			);
		},
		tumbleBoardSlideDown: async () => {
			await Promise.all(
				tumbleBoardCombined().flatMap((tumbleReel, reelIndex) =>
					tumbleReel.map(async (tumbleSymbol, symbolIndex) => {
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
	});
</script>

{#if show}
	<!-- Two layers for the same reason the reel board has them: sprite symbols draw masked and
	     flat, spine symbols draw on the animating layer so they can overflow their cell. -->
	<BoardContext animate={false}>
		<BoardContainer>
			<BoardMask />
			<TumbleBoardBase />
		</BoardContainer>
	</BoardContext>

	<BoardContext animate={true}>
		<BoardContainer>
			<TumbleBoardBase />
		</BoardContainer>
	</BoardContext>
{/if}
