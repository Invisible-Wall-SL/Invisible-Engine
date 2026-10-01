<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { BoardContainer, FlightView } from 'engine-game';
	import { Anchor, Container, getContextApp, getContextParent } from 'pixi-svelte';
	import { onDestroy } from 'svelte';

	import {
		attachFlightLayer,
		FLIGHT_BOARD_ANCHOR,
		stateFlights,
		tickFlights,
	} from '../game/flights.svelte';

	/**
	 * THE FLIGHT LAYER (design §4.4) — mounted once, unconditionally, inside `Game.svelte`'s
	 * `LAYER_BAND_FLIGHTS` container, so its seat is fixed at mount (pixi-svelte freezes child order
	 * then). Its container is the space every route is planned in (`flights.svelte.ts`).
	 *
	 * EMPTY UNTIL A FLIGHT RUNS. What it always holds is two transform-only containers — the board's
	 * own space, anchored so a cell resolves to a global point even while the reel board is hidden
	 * behind the respin board — which draw nothing. A game that never flies anything pays those and an
	 * idle ticker callback.
	 */

	const app = getContextApp();
	const detach = attachFlightLayer(getContextParent().parent);

	$effect(() => {
		const ticker = app.stateApp.pixiApplication?.ticker;
		if (!ticker) return;
		const tick = () => tickFlights(ticker.deltaMS);
		ticker.add(tick);
		return () => {
			ticker.remove(tick);
		};
	});

	onDestroy(detach);
</script>

<MainContainer>
	<BoardContainer>
		<Anchor name={FLIGHT_BOARD_ANCHOR} />
	</BoardContainer>
</MainContainer>
{#each stateFlights.list as flight (flight.id)}
	<Container>
		{#if flight.phase !== 'waiting'}
			<FlightView
				position={() => flight.head}
				scale={flight.scale}
				emit={flight.phase === 'flying'}
				headShown={flight.phase === 'flying'}
			/>
		{/if}
	</Container>
{/each}
