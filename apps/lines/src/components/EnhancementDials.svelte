<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { ENHANCEMENT_DIAL_COMPONENT } from 'engine-layout';
	import { isComponentMounted } from 'engine-layout/svelte';

	import EnhancementDialArt from './EnhancementDialArt.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import {
		createDialPulse,
		ENHANCEMENT_DIALS,
		enhancementsVisible,
		type EnhancementDial,
	} from '../game/holdAndWinEnhancements.svelte';
	import { respinTopSeatRow } from '../game/respinSeat';
	import { cellWindow, getSymbolX } from '../game/stateGame.svelte';

	/**
	 * THE CODED ENHANCEMENT DIALS (Phase 14b) — Expand, Boost, Multiply and Respin in a row above the
	 * respin board, over the coded counter's line, while a feature that drew enhancements is up. The
	 * default for a project that placed none: it steps aside while an authored `enhancementDial` is
	 * mounted. A feature with no enhancements never shows it.
	 */
	const PULSE_SCALE = 1.25;
	const SPACING = SYMBOL_SIZE * 0.78;

	const x = $derived((getSymbolX(0) + getSymbolX(boardDimensions().x - 1)) / 2);
	const y = $derived(cellWindow(0, respinTopSeatRow()).top - SYMBOL_SIZE * 0.95);
	const pulses = Object.fromEntries(
		ENHANCEMENT_DIALS.map((kind) => [
			kind,
			createDialPulse(
				() => kind,
				() => PULSE_SCALE,
			),
		]),
	) as Record<EnhancementDial, ReturnType<typeof createDialPulse>>;
</script>

{#if enhancementsVisible() && !isComponentMounted(ENHANCEMENT_DIAL_COMPONENT)}
	<Container {x} {y}>
		{#each ENHANCEMENT_DIALS as kind, i (kind)}
			<Container x={(i - (ENHANCEMENT_DIALS.length - 1) / 2) * SPACING}>
				<EnhancementDialArt {kind} scale={pulses[kind].current} />
			</Container>
		{/each}
	</Container>
{/if}
