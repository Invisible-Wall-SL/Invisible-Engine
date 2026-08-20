<script lang="ts" module>
	import type { Position, RawSymbol } from 'engine-game';

	type AddingBoard = RawSymbol[][];
	type ExplodingPositions = Position[];

	export type EmitterEventTumbleBoard =
		| { type: 'tumbleBoardShow' }
		| { type: 'tumbleBoardHide' }
		| { type: 'tumbleBoardInit'; addingBoard: AddingBoard }
		| { type: 'tumbleBoardReset' }
		| { type: 'tumbleBoardExplode'; explodingPositions: ExplodingPositions }
		| { type: 'tumbleBoardRemoveExploded' }
		| { type: 'tumbleBoardSlideDown' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';

	import { BoardContext } from 'components-shared';
	import { waitForResolve } from 'utils-shared/wait';

	import { BoardContainer } from 'engine-game';

	import TumbleBoardBase from './TumbleBoardBase.svelte';
	import BoardMask from './BoardMask.svelte';
	import { getContext } from '../game/context';
	import { getSymbolY, stateGameDerived } from '../game/stateGame.svelte';
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
	 * Seats come from the shared `getSymbolY`, NOT from a fixed `SYMBOL_SIZE` step. The reference
	 * cluster game could assume `(index + 0.5) * SYMBOL_SIZE` because its board had one geometry; this
	 * runtime's board has an authorable reel grid (row pitch, lead, per-cell alignment, nudge), so a
	 * symbol dropped by the cascade must land on the SAME seat a settled reel would have given it.
	 * `getSymbolY` is the exact resting-seat expression `createReelForSpinning` uses, which is what
	 * makes the two agree by construction rather than by a matching constant.
	 */

	const context = getContext();

	let show = $state(false);

	/** Row index of the padding row above the visible board — where a falling symbol starts. */
	const PADDING_ROW = -1;

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
					initY: getSymbolY(symbolIndex + PADDING_ROW - addingReel.length),
					rawSymbol,
				}),
			);
		});

	/** The board as it stands right now, seated exactly where the reels left it. */
	const initTumbleBoardBase = () =>
		stateGameDerived
			.boardRaw()
			.map((rawSymbolReel) =>
				rawSymbolReel.map((rawSymbol, symbolIndex) =>
					createTumbleSymbol({ initY: getSymbolY(symbolIndex + PADDING_ROW), rawSymbol }),
				),
			);

	context.eventEmitter.subscribeOnMount({
		tumbleBoardShow: () => (show = true),
		tumbleBoardHide: () => (show = false),
		tumbleBoardInit: ({ addingBoard }) => {
			stateTumble.adding = initTumbleBoardAdding({ addingBoard });
			stateTumble.base = initTumbleBoardBase();
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
					await waitForResolve((resolve) => (tumbleSymbol.oncomplete = resolve));
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
				tumbleBoardCombined().flatMap((tumbleReel) =>
					tumbleReel.map(async (tumbleSymbol, symbolIndex) => {
						const targetY = getSymbolY(symbolIndex + PADDING_ROW);
						if (targetY === tumbleSymbol.symbolY.current) return;

						await tumbleSymbol.symbolY.set(targetY, { duration: 200, easing: backOut });

						// Only the VISIBLE rows play their land state — the padding rows top and bottom are
						// off-screen buffer, and landing them would fire land sounds for symbols nobody sees.
						if (symbolIndex > 0 && symbolIndex < tumbleReel.length - 1) {
							tumbleSymbol.symbolState = 'land';
							stateGameDerived.onSymbolLand({ rawSymbol: tumbleSymbol.rawSymbol });
							await waitForResolve((resolve) => {
								tumbleSymbol.oncomplete = () => {
									tumbleSymbol.symbolState = 'static';
									resolve();
								};
							});
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
