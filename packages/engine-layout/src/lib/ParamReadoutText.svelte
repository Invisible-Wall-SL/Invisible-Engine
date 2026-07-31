<script lang="ts" module>
	import type { TextStyle } from './types';

	export type Props = {
		/** The live numeric value to display (the resolved `value` param). */
		target: number;
		style?: TextStyle;
		x: number;
		y: number;
		anchor?: { x: number; y: number };
		scale?: { x: number; y: number };
		rotation?: number;
		alpha?: number;
		zIndex?: number;
		/** When true, tween the displayed number to a new `target` instead of snapping. */
		countUp?: boolean;
		/** Format a number → string (thousands-grouped integer by default). */
		format: (value: number) => string;
		/** Text-box layout (§text-box model): when `boxWidth` > 0 the formatted number lays
		 * out inside a box (H via `style.align` across `boxWidth`, V via `style.verticalAlign`
		 * across `boxHeight`, `autoFit` shrinks the font). Unset ⇒ the plain readout (parity). */
		boxWidth?: number;
		boxHeight?: number;
		autoFit?: boolean;
	};
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';

	import CatalogText from './CatalogText.svelte';
	import TextBox from './TextBox.svelte';

	const props: Props = $props();
	const boxed = $derived(typeof props.boxWidth === 'number' && props.boxWidth > 0);

	// Contained count-up (§13.2 / §8.5 "one count-up data binding"): a single
	// `svelte/motion` Tween — the SAME primitive `apps/lines`/scatter/cluster
	// count-ups already use (no GSAP dep added; runes-native). It owns ONLY this
	// readout's displayed number, so the normal text path stays untouched. With
	// `countUp` off we snap (`duration: 0`) — the tween then behaves as a plain
	// reactive number, so a non-count-up readout still renders the live value with
	// no animation. ~0.5s ease on count-up.
	const displayed = new Tween(props.target, { duration: 0 });
	$effect(() => {
		displayed.set(props.target, { duration: props.countUp ? 500 : 0 });
	});

	const text = $derived(props.format(displayed.current));
</script>

{#if boxed}
	<TextBox
		{text}
		style={props.style}
		boxWidth={props.boxWidth ?? 0}
		boxHeight={props.boxHeight}
		autoFit={props.autoFit ?? false}
		x={props.x}
		y={props.y}
		anchor={props.anchor}
		scale={props.scale}
		rotation={props.rotation}
		alpha={props.alpha}
		zIndex={props.zIndex}
	/>
{:else}
	<CatalogText
		{text}
		x={props.x}
		y={props.y}
		anchor={props.anchor}
		scale={props.scale}
		rotation={props.rotation}
		alpha={props.alpha}
		zIndex={props.zIndex}
		style={props.style}
	/>
{/if}
