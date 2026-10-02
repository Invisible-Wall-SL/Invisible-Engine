<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { BoardContainer, FlightView, SYMBOL_SIZE } from 'engine-game';
	import { Anchor, Container, getContextApp, getContextParent, Text } from 'pixi-svelte';
	import { onDestroy } from 'svelte';

	import { bakedEffects, type BookVfxLayer } from '../editor-scenes';
	import {
		arrivalPlayed,
		attachFlightLayer,
		FLIGHT_BOARD_ANCHOR,
		stateFlights,
		tickFlights,
		type ActiveFlight,
	} from '../game/flights.svelte';
	import SymbolLayer from './SymbolLayer.svelte';

	/**
	 * THE FLIGHT LAYER (design §4.4) — mounted once, unconditionally, inside `Game.svelte`'s
	 * `LAYER_BAND_FLIGHTS` container, so its seat is fixed at mount (pixi-svelte freezes child order
	 * then). Its container is the space every route is planned in (`flights.svelte.ts`).
	 *
	 * EMPTY UNTIL A FLIGHT RUNS. What it always holds is two transform-only containers — the board's
	 * own space, anchored so a cell resolves to a global point even while the reel board is hidden
	 * behind the respin board — which draw nothing. A game that never flies anything pays those and an
	 * idle ticker callback.
	 *
	 * AUTHORED LOOK (Invisible Symbols → Flights): a sprite / spine / flipbook head draws through
	 * `SymbolLayer` — the path a symbol layer takes — sized to a board cell × its `scale`, inside a
	 * container at the board's scale; a glow head is `FlightView`'s coded glow re-tinted; `none` draws
	 * no head. The trail is `FlightView`'s. The arrival effect plays ONCE at the target when the head
	 * lands, and the flight stays mounted until it has played out.
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

	/** A head's label (an add-respins "+2"), in board units — scaled by the flight like its head. */
	const LABEL_STYLE = {
		fontFamily: 'Arial',
		fontWeight: 'bold',
		fontSize: SYMBOL_SIZE * 0.3,
		fill: 0xffffff,
		stroke: { color: 0x000000, width: 6 },
	} as const;

	const hexTint = (hex: string | undefined): number | undefined =>
		hex ? parseInt(hex.slice(1), 16) : undefined;

	/** A sprite / spine / flipbook head as the symbol layer that draws it. */
	const artLayer = (flight: ActiveFlight): BookVfxLayer | undefined => {
		const head = flight.headStyle;
		if (head?.kind !== 'sprite' && head?.kind !== 'spine' && head?.kind !== 'flipbook')
			return undefined;
		return {
			kind: head.kind,
			assetKey: head.assetKey,
			animationName: head.animationName,
			clipId: head.clipId,
		};
	};

	const trailDoc = (flight: ActiveFlight) => {
		const trail = flight.trail;
		if (trail === 'coded') return undefined;
		return trail ? (bakedEffects().find((doc) => doc.id === trail.effectId) ?? null) : null;
	};
</script>

<MainContainer>
	<BoardContainer>
		<Anchor name={FLIGHT_BOARD_ANCHOR} />
	</BoardContainer>
</MainContainer>
{#each stateFlights.list as flight (flight.id)}
	{@const art = artLayer(flight)}
	<Container>
		{#if flight.phase !== 'waiting'}
			<FlightView
				position={() => flight.head}
				scale={flight.scale}
				emit={flight.phase === 'flying'}
				headShown={flight.phase === 'flying' &&
					(!flight.headStyle || flight.headStyle.kind === 'glow')}
				headTint={hexTint(flight.headStyle?.tint)}
				headScale={flight.headStyle?.scale}
				trailDoc={trailDoc(flight)}
			/>
		{/if}
		{#if flight.phase === 'flying' && art}
			<Container
				x={flight.head.x}
				y={flight.head.y}
				scale={flight.scale * (flight.headStyle?.scale ?? 1)}
			>
				<SymbolLayer layer={art} x={0} y={0} tint={hexTint(flight.headStyle?.tint)} />
			</Container>
		{/if}
		{#if flight.phase === 'flying' && flight.label}
			<Text
				x={flight.head.x}
				y={flight.head.y}
				anchor={0.5}
				scale={flight.scale}
				text={flight.label}
				style={LABEL_STYLE}
			/>
		{/if}
		{#if flight.phase === 'trailing' && flight.arrivalEffectId && !flight.arrivalDone}
			<Container x={flight.curve.p3.x} y={flight.curve.p3.y} scale={flight.scale}>
				<SymbolLayer
					layer={{ kind: 'fx', effectId: flight.arrivalEffectId }}
					x={0}
					y={0}
					once
					oncomplete={() => arrivalPlayed(flight.id)}
				/>
			</Container>
		{/if}
	</Container>
{/each}
