<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = { scene: Scene };
</script>

<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { Container } from 'pixi-svelte';

	import type { Snippet } from 'svelte';

	import LayoutNodeView from './LayoutNodeView.svelte';
	import type { EffectNode } from './types';
	import { getComponentVisibility, type BoolSource } from './registerComponentVisibility';
	import { setSceneVisibleContext } from './sceneVisibilityContext';
	import { setTapPortal } from './tapPortalContext';

	const { scene }: Props = $props();

	const space = $derived(scene.space ?? 'game');

	// Canvas-frame tap PORTAL (tapPortalContext): an overlay instance's full-screen tap
	// surface (dim + hit area + prompt) must cover the real window, NOT the design box —
	// so it can't render inside this scene's `MainContainer` (which re-centres + scales
	// its children for `game`/`standard` space). Descendant `ComponentInstance`s register
	// their tap surface here; we render each one at the scene's OWN top level, OUTSIDE the
	// `MainContainer` wrapper, so it sits in true canvas space exactly like the engine-owned
	// free-spin gate. Keyed by instance id (replace, not duplicate). Empty ⇒ nothing extra
	// renders (parity — a scene with no tap-enabled overlay is byte-identical to before).
	let tapSurfaces = $state<{ id: string; snippet: Snippet }[]>([]);
	setTapPortal({
		register: (id, snippet) => {
			const next = tapSurfaces.filter((t) => t.id !== id);
			next.push({ id, snippet });
			tapSurfaces = next;
		},
		unregister: (id) => {
			tapSurfaces = tapSurfaces.filter((t) => t.id !== id);
		},
	});

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

{#snippet body()}
	{@render framed()}
	<!--
		Hoisted tap-to-continue surfaces (tapPortalContext): rendered at the SCENE's top
		level — a sibling of `framed()`, OUTSIDE its `MainContainer` — so a full-screen
		dim/hit surface authored on a `game`/`standard`-space screen covers the true canvas
		instead of the scaled design box (the "dim doesn't fit / darkens the logo" bug).
		Drawn AFTER the scene content so the gate paints on top, and inside the same
		visibility gate so it follows the screen's own `visibleSource`. Empty ⇒ parity.
	-->
	{#each tapSurfaces as tap (tap.id)}
		{@render tap.snippet()}
	{/each}
{/snippet}

{#if visibilitySource}
	<Container visible={liveVisible}>
		{@render body()}
	</Container>
{:else}
	{@render body()}
{/if}
