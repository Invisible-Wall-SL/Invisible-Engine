<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Anchor, Container } from 'pixi-svelte';
	import { enhancementDialAnchor, ENHANCEMENT_DIAL_COMPONENT } from 'engine-layout';
	import { getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import EnhancementDialArt from './EnhancementDialArt.svelte';
	import {
		createDialPulse,
		isEnhancementDial,
		type EnhancementDial,
	} from '../game/holdAndWinEnhancements.svelte';

	/**
	 * The `enhancementDial` component's coded part (Phase 14b). The instance's `kind` param names its
	 * enhancement (`extraRow`, `boost`, `multiply`, `extraRespins`). The author's own nodes inside it
	 * arrive as `skin` and draw at its origin, pulsed on each light, hit and miss (`pulseScale`; 1 keeps
	 * them still) — their art switches state by the `enhancement.<kind>.state` value and the scoped
	 * `enhancementOn` / `enhancementHit` / `enhancementMiss` signals. With nothing inside, it draws the
	 * coded dial. Either way it registers the dial's anchor (a hit's beam leaves from it) and counts the
	 * instance in, so the coded dials row steps aside.
	 */
	const { skin }: { skin?: Snippet } = $props();
	const params = getComponentParams();
	const kind = $derived.by((): EnhancementDial => {
		const value = params.kind;
		return typeof value === 'string' && isEnhancementDial(value) ? value : 'boost';
	});
	const pulseScale = $derived.by(() => {
		const value = params.pulseScale;
		return typeof value === 'number' && value > 0 ? value : 1;
	});

	// Untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => untrack(() => trackComponentMount(ENHANCEMENT_DIAL_COMPONENT)));

	const pulse = createDialPulse(
		() => kind,
		() => pulseScale,
	);
</script>

{#if skin}
	<Container scale={pulse.current}>
		<Anchor name={enhancementDialAnchor(kind)} />
		{@render skin()}
	</Container>
{:else}
	<EnhancementDialArt {kind} scale={pulse.current} />
{/if}
