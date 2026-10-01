<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { BoardContainer } from 'engine-game';
	import { isComponentMounted } from 'engine-layout/svelte';
	import { Container } from 'pixi-svelte';

	import HoldAndWinWheelArt from './HoldAndWinWheelArt.svelte';
	import { stateGameDerived } from '../game/stateGame.svelte';
	import { stateWheel } from '../game/holdAndWinWheel.svelte';

	/**
	 * THE CODED PRE-FEATURE WHEEL (`holdAndWinWheel.svelte.ts`) — the wheel's art
	 * (`HoldAndWinWheelArt`) centred on the board. Mounted in the flights band at a zIndex seat between
	 * the flight layer and the banner (the prize banner reads over it). It steps aside while an
	 * authored `wheel` component is mounted, which draws the same beat where the author put it.
	 *
	 * Nothing is mounted until a wheel is up, so a game that never receives `holdAndWinWheel` pays
	 * nothing for it.
	 */
	const layout = $derived(stateGameDerived.boardLayout());
	const radius = $derived(Math.min(layout.width, layout.height) * 0.46);
</script>

{#if stateWheel.current && !isComponentMounted('wheel')}
	<Container zIndex={1}>
		<MainContainer>
			<BoardContainer>
				<Container x={layout.width / 2} y={layout.height / 2}>
					<HoldAndWinWheelArt {radius} />
				</Container>
			</BoardContainer>
		</MainContainer>
	</Container>
{/if}
