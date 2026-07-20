<script lang="ts" module>
	import type { RawSymbol, Position } from '../game/types';

	export type EmitterEventBoard =
		| { type: 'boardSettle'; board: RawSymbol[][] }
		| { type: 'boardShow' }
		| { type: 'boardHide' }
		| {
				type: 'boardWithAnimateSymbols';
				symbolPositions: Position[];
		  }
		| { type: 'boardWithMovingMultiplierTexts' };
</script>

<script lang="ts">
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { BoardContext } from 'components-shared';

	import { getContext } from '../game/context';
	import BoardContainer from './BoardContainer.svelte';
	import BoardMask from './BoardMask.svelte';
	import BoardBase from './BoardBase.svelte';

	const context = getContext();

	let show = $state(true);

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => context.stateGameDerived.enhancedBoard.stop(),
		boardSettle: ({ board }) => context.stateGameDerived.enhancedBoard.settle(board),
		boardShow: () => (show = true),
		boardHide: () => (show = false),
		boardWithAnimateSymbols: async ({ symbolPositions }) => {
			const getPromises = () =>
				symbolPositions.map(async (position) => {
					const reelSymbol = context.stateGame.board[position.reel].reelState.symbols[position.row];
					reelSymbol.symbolState = 'win';
					// Raced against the slam token: the caller of this broadcast is itself raced, so on a
					// slam it walks on while this body is still parked on `oncomplete` — a resolver only the
					// (now cut short) win animation calls. Without the race the symbol never leaves `win`
					// and stays lit through the rest of the round. `postWinStatic` is the FINAL value either
					// way, so skipping only removes the time spent getting there.
					await roundSkip.race(waitForResolve((resolve) => (reelSymbol.oncomplete = resolve)));
					reelSymbol.symbolState = 'postWinStatic';
				});

			await Promise.all(getPromises());
		},
		boardWithMovingMultiplierTexts: () => {
			context.stateGame.board.forEach((reel) => {
				reel.reelState.symbols.forEach((reelSymbol) => {
					if (reelSymbol.rawSymbol.name === 'M') {
						reelSymbol.rawSymbol = {
							...reelSymbol.rawSymbol,
							name: 'M_TAKEN', // TODO fix type error
						};
					}
				});
			});
		},
	});

	context.stateGameDerived.enhancedBoard.readyToSpinEffect();
</script>

{#if show}
	<BoardContext animate={false}>
		<BoardContainer>
			<BoardMask />
			<BoardBase />
		</BoardContainer>
	</BoardContext>

	<BoardContext animate={true}>
		<BoardContainer>
			<BoardBase />
		</BoardContainer>
	</BoardContext>
{/if}
