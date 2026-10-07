<script lang="ts">
	import type { EffectDoc } from 'engine-fx';
	import { BaseSprite, Container, EffectPlayer, ParticleEmitter } from 'pixi-svelte';

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
		/** Draw the glow head. */
		headShown: boolean;
		/** The glow head's tint (default the coin gold). */
		headTint?: number;
		/** Multiplies the glow head's size (default 1 = {@link HEAD_CELLS} of a cell). */
		headScale?: number;
		/**
		 * An authored Invisible FX trail, in BOARD units (the effect is drawn at the board's scale),
		 * or `null` for no trail. Absent ⇒ the coded gold glow trail.
		 */
		trailDoc?: EffectDoc | null;
	};

	/**
	 * ONE FLIGHT'S HEAD GLOW AND TRAIL (design §4.4): the coded glow head and the trail it leaves.
	 * The trail's container never moves — the emitter's OWNER does (`ownerPos`), which is what makes
	 * particles stay where they were born. The container's scale is fixed for the flight, so the owner
	 * position is the head's divided by it. An authored trail goes through the same mechanism, via
	 * `<EffectPlayer ownerPos>` (free layers only); it emits from mount until the head lands, then
	 * `emitFor = 0` stops it and its particles live out their lives.
	 */
	const props: Props = $props();

	/** Head and trail sizes, as fractions of a board cell. */
	const HEAD_CELLS = 0.45;
	const TRAIL_CELLS = 0.3;

	const texture = flightGlowTexture();
	const textures = [texture];
	const trailScale = $derived((props.scale * TRAIL_CELLS * SYMBOL_SIZE) / FLIGHT_GLOW_SIZE);
	const headScale = $derived(
		(props.scale * HEAD_CELLS * SYMBOL_SIZE * (props.headScale ?? 1)) / FLIGHT_GLOW_SIZE,
	);
	const head = $derived(props.position());
	const ownerPos = () => {
		const { x, y } = props.position();
		return { x: x / trailScale, y: y / trailScale };
	};
	/**
	 * A trail has no rig to ride: a bone-placed layer would mount `RigBoneAttach` with no
	 * `RigProvider` and sit at the container's origin. Every trail layer is mounted FREE instead
	 * (offset kept), so `ownerPos` drives it — what the `/symbols` preview shows.
	 */
	const freeTrailDoc = $derived(
		props.trailDoc
			? {
					...props.trailDoc,
					layers: props.trailDoc.layers.map((layer) =>
						layer.placement.space === 'bone'
							? { ...layer, placement: { space: 'free' as const, offset: layer.placement.offset } }
							: layer,
					),
				}
			: props.trailDoc,
	);
	const effectOwnerPos = () => {
		const { x, y } = props.position();
		return { x: x / props.scale, y: y / props.scale };
	};
</script>

{#if props.trailDoc === undefined}
	<Container scale={trailScale}>
		<ParticleEmitter
			key="flightGlow"
			config={FLIGHT_TRAIL_CONFIG}
			{textures}
			emit={props.emit}
			{ownerPos}
		/>
	</Container>
{:else if freeTrailDoc}
	<Container scale={props.scale}>
		<EffectPlayer
			doc={freeTrailDoc}
			forceEmit
			emitFor={props.emit ? undefined : 0}
			ownerPos={effectOwnerPos}
		/>
	</Container>
{/if}
{#if props.headShown}
	<BaseSprite
		{texture}
		anchor={0.5}
		x={head.x}
		y={head.y}
		scale={headScale}
		tint={props.headTint ?? FLIGHT_HEAD_TINT}
		blendMode="add"
	/>
{/if}
