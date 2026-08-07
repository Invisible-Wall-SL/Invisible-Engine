<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = { scene: Scene };
</script>

<script lang="ts">
	import { MainContainer } from 'components-layout';
	import { Container } from 'pixi-svelte';

	import { untrack } from 'svelte';

	import LayoutNodeView from './LayoutNodeView.svelte';
	import type { EffectNode } from './types';
	import { getComponentVisibility, type BoolSource } from './registerComponentVisibility';
	import { getSceneCameraTransform } from './registerSceneCameraTransform';
	import { setSceneVisibleContext } from './sceneVisibilityContext';
	import { setTapPortal, type TapPortalEntry } from './tapPortalContext';
	import { tapDimBehind } from './tapToContinue';

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
	let tapSurfaces = $state<({ id: string } & TapPortalEntry)[]>([]);
	// register/unregister are imperative portal ops called from a descendant
	// `ComponentInstance`'s `$effect`. Reading `tapSurfaces` here would make that read a
	// dependency of the CALLER's effect, and the reassignment on the next line would then
	// re-invalidate it — a self-referential effect loop (`effect_update_depth_exceeded`).
	// `untrack` the reads so the mutation never leaks a dependency back into the caller.
	setTapPortal({
		register: (id, entry) => {
			const next = untrack(() => tapSurfaces).filter((t) => t.id !== id);
			next.push({ id, ...entry });
			tapSurfaces = next;
		},
		unregister: (id) => {
			tapSurfaces = untrack(() => tapSurfaces).filter((t) => t.id !== id);
		},
	});

	// A registered tap node's DIM sits BEHIND the scene content when the author placed any node
	// AFTER it in the outline (paint order) — i.e. it is not the topmost node. A `game`/`standard`
	// dim is canvas-space and can't interleave with the scaled `MainContainer` nodes, so it goes
	// wholly behind (celebration screen: dim under the content) or wholly in front (topmost tap:
	// byte-identical to before). Only TOP-LEVEL scene nodes carry an order here; a tap registered
	// from a nested instance isn't found ⇒ defaults to in-front (the safe legacy placement).
	//
	// Placement is by zIndex, NOT render order: pixi-svelte adds every child with `addChild`
	// (append) then `sortChildren()`, and the dim registers LATE (a descendant `$effect`, after the
	// content has mounted). At an equal zIndex it would therefore tie with the content and win on
	// mount order — landing ON TOP wherever it sits in the tree. So a behind-dim is drawn at a
	// NEGATIVE zIndex to sink below the default-`0` scene content; a front-dim keeps `0` (on top).
	const DIM_BEHIND_Z = -1;
	const orderedNodeIds = $derived(scene.nodes.map((n) => n.id));
	const dimsBehind = $derived(
		tapSurfaces.filter((t) => t.dim && tapDimBehind(orderedNodeIds, t.id)),
	);
	const dimsInFront = $derived(
		tapSurfaces.filter((t) => t.dim && !tapDimBehind(orderedNodeIds, t.id)),
	);

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

	// Reel-anticipation camera opt-in (`Scene.zoomWithAnticipation`): when this `game`-space screen
	// is ticked AND the game registered a world-space camera source, wrap its content INSIDE the
	// `MainContainer` (below) with the SAME scale + pan the reel camera applies — so a "base game
	// top / bottom" screen zooms toward the SAME reel centre as the board (one coherent move). Only
	// `game` space participates: it shares the board's `MainContainer` coordinate space, so the focal
	// point lines up; other spaces would zoom about a mismatched point. Absent tick / no source /
	// non-game space ⇒ `cameraTransform` stays undefined ⇒ NO wrapper is added (byte-identical). The
	// source returns identity while nothing is armed, so an opted-in screen still renders unchanged.
	const cameraTransform = $derived(
		scene.zoomWithAnticipation && space === 'game' ? getSceneCameraTransform() : undefined,
	);

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
			{#if cameraTransform}
				{@const t = cameraTransform()}
				<!-- Anticipation camera wrap (`Scene.zoomWithAnticipation`): a plain scale + pan on this
				     Container alone, so the screen zooms about the reel centre in lockstep with the board.
				     Identity while nothing is armed ⇒ opted-in screen renders unchanged. -->
				<Container scale={t.scale} x={t.x} y={t.y}>
					{@render nodes()}
				</Container>
			{:else}
				{@render nodes()}
			{/if}
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
	<!--
		Hoisted tap-to-continue surfaces (tapPortalContext): rendered at the SCENE's top level —
		siblings of `framed()`, OUTSIDE its `MainContainer` — so a full-screen dim/hit surface
		authored on a `game`/`standard`-space screen covers the true canvas instead of the scaled
		design box (the "dim doesn't fit / darkens the logo" bug). SPLIT so the authored layer order
		is honoured: a dim whose tap node has content painted ABOVE it draws BEHIND the scene content
		(a celebration screen shows over its dim); a topmost tap's dim stays in FRONT (byte-identical
		to before). The interactive hit area + prompt ALWAYS paint on top so a tap anywhere dismisses
		the screen and the prompt stays visible. All inside the same visibility gate. Empty ⇒ parity.
	-->
	{#each dimsBehind as t (t.id)}
		{@render t.dim?.(DIM_BEHIND_Z)}
	{/each}
	{@render framed()}
	{#each dimsInFront as t (t.id)}
		{@render t.dim?.(0)}
	{/each}
	{#each tapSurfaces as t (t.id)}
		{@render t.tap()}
	{/each}
{/snippet}

{#if visibilitySource}
	<Container visible={liveVisible}>
		{@render body()}
	</Container>
{:else}
	{@render body()}
{/if}
