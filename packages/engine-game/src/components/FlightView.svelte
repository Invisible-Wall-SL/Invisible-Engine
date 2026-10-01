<script lang="ts">
	import { BaseSprite, Container, ParticleEmitter } from 'pixi-svelte';

	import { SYMBOL_SIZE } from '../game/constants';
	import {
		FLIGHT_GLOW_SIZE,
		FLIGHT_HEAD_TINT,
		FLIGHT_TRAIL_CONFIG,
		flightGlowTexture,
	} from '../game/flightGlow';

	type Props = {
		/** The head, in the PARENT's local space — read every tick. */
		position: () => { x: number; y: number };
		/** Parent-local units per board unit, so a flight is as big as the board's cells. */
		scale: number;
		/** Spawn trail particles (false once the head has landed: the trail dies out on its own). */
		emit: boolean;
		headShown: boolean;
	};

	/**
	 * ONE CODED FLIGHT (design §4.4): a glow head and the trail it leaves. The trail's container
	 * never moves — the emitter's OWNER does (`ownerPos`), which is what makes particles stay where
	 * they were born. The container's scale is fixed for the flight, so the owner position is the
	 * head's divided by it.
	 */
	const props: Props = $props();

	/** Head and trail sizes, as fractions of a board cell. */
	const HEAD_CELLS = 0.45;
	const TRAIL_CELLS = 0.3;

	const texture = flightGlowTexture();
	const textures = [texture];
	const trailScale = $derived((props.scale * TRAIL_CELLS * SYMBOL_SIZE) / FLIGHT_GLOW_SIZE);
	const headScale = $derived((props.scale * HEAD_CELLS * SYMBOL_SIZE) / FLIGHT_GLOW_SIZE);
	const head = $derived(props.position());
	const ownerPos = () => {
		const { x, y } = props.position();
		return { x: x / trailScale, y: y / trailScale };
	};
</script>

<Container scale={trailScale}>
	<ParticleEmitter
		key="flightGlow"
		config={FLIGHT_TRAIL_CONFIG}
		{textures}
		emit={props.emit}
		{ownerPos}
	/>
</Container>
{#if props.headShown}
	<BaseSprite
		{texture}
		anchor={0.5}
		x={head.x}
		y={head.y}
		scale={headScale}
		tint={FLIGHT_HEAD_TINT}
		blendMode="add"
	/>
{/if}
