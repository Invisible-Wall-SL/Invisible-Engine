<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = { scene: Scene };
</script>

<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { Container } from 'pixi-svelte';

	import LayoutNodeView from './LayoutNodeView.svelte';
	import type { EffectNode } from './types';
	import { getComponentVisibility, type BoolSource } from './registerComponentVisibility';
	import { setSceneVisibleContext } from './sceneVisibilityContext';

	const { scene }: Props = $props();

	const space = $derived(scene.space ?? 'game');

	// Per-rig bone hosting: an `effect` node with a `hostSpineId` that names a placed spine in THIS
	// scene is mounted INSIDE that rig's `<SpineProvider>` (so a bone layer rides the rig's bone + the
	// rig's timeline events time it), NOT at top level. We map each host spine id → its attached
	// effects, and skip those effects in the top-level walk. A dangling `hostSpineId` (no matching
	// spine) falls back to a normal top-level render. Only top-level scene nodes participate.
	const spineIds = $derived(
		new Set(scene.nodes.filter((n) => n.kind === 'spine').map((n) => n.id)),
	);
	const attachedBySpine = $derived.by(() => {
		const map = new Map<string, EffectNode[]>();
		for (const n of scene.nodes) {
			if (n.kind === 'effect' && n.hostSpineId && spineIds.has(n.hostSpineId)) {
				const list = map.get(n.hostSpineId);
				if (list) list.push(n);
				else map.set(n.hostSpineId, [n]);
			}
		}
		return map;
	});
	const isHosted = (n: (typeof scene.nodes)[number]): boolean =>
		n.kind === 'effect' && !!n.hostSpineId && spineIds.has(n.hostSpineId);

	// Screen lifecycle gate (§ screen `visibleSource`): when the scene names a registered
	// visibility feed, show the WHOLE screen only while that state is active — so authored
	// overlay content (e.g. a "Free-spin intro" screen bound to `freeSpinIntroShow`) follows
	// the round flow instead of rendering always. The registry is populated once at boot, so
	// this is a plain read (mirrors `ComponentInstance`). No source / unregistered ⇒ NO
	// wrapper is added below — byte-identical to an ungated screen (parity).
	const visibilitySource: BoolSource | undefined = scene.visibleSource
		? getComponentVisibility(scene.visibleSource)
		: undefined;
	let liveVisible = $state(true);
	$effect(() => {
		if (!visibilitySource) return;
		return visibilitySource.subscribe((value) => {
			liveVisible = value;
		});
	});

	// Publish this screen's live gate-visibility to the components rendered inside it,
	// so a `ComponentInstance` fires its `enter` cue when THIS SCREEN appears (a gated
	// "Free-spin intro" opening), not just when the instance first mounts. Ungated
	// screen ⇒ `liveVisible` stays `true` ⇒ a child reads "always visible" = parity.
	setSceneVisibleContext(() => liveVisible);
</script>

{#snippet nodes()}
	{#each scene.nodes as node (node.id)}
		{#if isHosted(node)}
			<!-- rendered inside its host rig's <SpineProvider> (per-rig bone hosting) — skip here -->
		{:else}
			<LayoutNodeView
				{node}
				{space}
				attachedEffects={node.kind === 'spine' ? attachedBySpine.get(node.id) : undefined}
			/>
		{/if}
	{/each}
{/snippet}

{#snippet framed()}
	{#if space === 'game'}
		<MainContainer>
			{@render nodes()}
		</MainContainer>
	{:else if space === 'standard'}
		<MainContainer
			standard
			alignVertical={scene.align?.vertical}
			alignHorizontal={scene.align?.horizontal}
		>
			{@render nodes()}
		</MainContainer>
	{:else}
		{@render nodes()}
	{/if}
{/snippet}

{#if visibilitySource}
	<Container visible={liveVisible}>
		{@render framed()}
	</Container>
{:else}
	{@render framed()}
{/if}
