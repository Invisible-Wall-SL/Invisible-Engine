<script lang="ts" module>
	import type { ComponentInstanceNode, Scene, SpawnLayerNode } from './types';

	export type Props = {
		node: SpawnLayerNode;
		space?: Scene['space'];
	};
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Container, Flipbook, Graphics, getContextApp, getContextParent } from 'pixi-svelte';
	import type { SpawnedInstance } from 'engine-flow-v2';
	import { ColorMatrixFilter, type Graphics as PixiGraphics } from 'pixi.js';

	import ComponentInstance from './ComponentInstance.svelte';
	import { getSceneIdContext } from './sceneIdContext';
	import { spawnLayerSpec } from './spawnLayerFields';
	import { registerSpawnLayerSpace, spawnStore } from './spawnLayers';
	import { liftOf, liftsOn } from './arcadeLifts.svelte';
	import { clipOf, clipsOn } from './arcadeClips.svelte';
	import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
	import {
		foldFlipbookPlayback,
		resolveFlipbook,
		type FlipbookClipEntry,
	} from './registerFlipbooks';
	import { linksOf, markOf, marksOn, type InstanceLink } from './arcadeMarks.svelte';
	import { codeLookOf } from './arcadeArt.svelte';
	import MountedArt from './MountedArt.svelte';
	import { hidingOn, inWorldCamera, isCulled, worldProjection } from './worldCameraView.svelte';

	const { node, space }: Props = $props();

	// The layer declares itself (idempotent: the game declares every layer of its screens at boot,
	// so a spawn into one not yet on screen is kept), then draws whatever the live set holds for it —
	// one <ComponentInstance> per live instance at its spawned place, keyed by its handle id, so a
	// despawn unmounts exactly that one. Each instance's synthetic node id IS its handle id: the
	// instance registers its Flow handle under it (`flowInstances.ts`), which is how an Instance ref
	// reaches it and how its raised events find their `instanceRef` chain.
	const live = spawnStore();
	live.declare(spawnLayerSpec(node, getSceneIdContext()));
	let instances = $state<SpawnedInstance[]>([]);
	$effect(() =>
		live.subscribe(node.id, (next) => {
			instances = next;
		}),
	);
	// Where a moved instance is now (an arcade game's loop moves them, P10.8): only the place of the
	// instances that moved changes, so a frame of motion re-draws no instance that did not.
	const places: Record<string, { x: number; y: number }> = $state({});
	$effect(() =>
		live.subscribePlaces(node.id, (moved) => {
			for (const { id, x, y } of moved) {
				const place = places[id];
				if (place) {
					place.x = x;
					place.y = y;
				} else places[id] = { x, y };
			}
		}),
	);
	$effect(() => {
		const alive = new Set(instances.map((i) => i.id));
		untrack(() => {
			for (const id of Object.keys(places)) if (!alive.has(id)) delete places[id];
		});
	});

	// The layer's space for a pointer (P10.11): the container the node's transform places it in.
	// A projected screen's top-level layer (P11.4) un-projects the point back to the world: its
	// instances are drawn at their projected places in this space.
	const parent = getContextParent();
	const scope = worldProjection();
	const projection = scope?.layers.has(node.id) ? scope : undefined;
	$effect(() =>
		registerSpawnLayerSpace(node.id, (x, y) => {
			const local = parent.parent.toLocal({ x, y });
			return projection ? projection.unproject(local.x, local.y) : { x: local.x, y: local.y };
		}),
	);

	// On a world-camera screen (P10.12) an instance the arcade loop finds out of view is not drawn;
	// it stays mounted, so its state machine runs on. Elsewhere nothing is culled (parity), unless
	// the game hides characters its abilities put out (P11.5, `setHiding`).
	// `hidingOn` is read reactively: the arcade runtime may turn it on after this layer mounted.
	const inWorld = inWorldCamera();
	const culling = $derived(inWorld || hidingOn());

	// A hopping character (P10.13) is drawn raised by its height over a shadow on the ground. Only a
	// game whose loop publishes lifts takes this branch; elsewhere the markup is as before.
	const shadowOf = (width: number) => (g: PixiGraphics) => {
		if (width > 0) g.ellipse(0, 0, width / 2, width / 6).fill({ color: 0x000000, alpha: 0.28 });
	};

	// An online room's marked players and lines (`arcadeMarks.svelte.ts`). A marked look is drawn
	// gold (its brightness on a gold ramp) over a gold glow on the ground at its place. While marks
	// are on, every instance is wrapped, so a mark coming or going never remounts a look; the online
	// runtime turns marks on at its join, before anything is spawned, so the wrapping is there from
	// each instance's first mount (turning them on or off later would remount the live ones).
	const GOLD = 0xffd447;
	const LINE = { width: 3, color: 0xffffff, alpha: 0.95 };
	const glowOf = (width: number) => (g: PixiGraphics) => {
		if (width > 0) g.ellipse(0, 0, width * 0.7, width * 0.24).fill({ color: GOLD, alpha: 0.6 });
	};
	let gold: [ColorMatrixFilter] | undefined;
	const goldFilters = () => {
		if (gold) return gold;
		// Each colour channel from the brightness (0.3 r + 0.59 g + 0.11 b), on a ramp to gold.
		const filter = new ColorMatrixFilter();
		filter.matrix = [
			0.435, 0.856, 0.16, 0, 0, 0.36, 0.708, 0.132, 0, 0, 0.114, 0.224, 0.042, 0, 0, 0, 0, 0, 1, 0,
		];
		return (gold = [filter]);
	};
	onDestroy(() => gold?.[0].destroy());
	const placeOf = (id: string) => places[id] ?? instances.find((i) => i.id === id);
	const ends = (link: InstanceLink) => {
		const from = placeOf(link.from);
		const to = placeOf(link.to);
		if (!from || !to) return undefined;
		const a = projection ? projection.project(from.x, from.y) : from;
		const b = projection ? projection.project(to.x, to.y) : to;
		return {
			a: { x: a.x + (link.style?.fromDx ?? 0), y: a.y - (projection ? link.fromLift : 0) },
			b: { x: b.x, y: b.y - (projection ? link.toLift : 0) },
		};
	};
	// A styled line (Salmons' fishing line, `InstanceLink.style`): its own stroke, a sine wiggle
	// fading along it after the cast (zero at both ends), and a dot at the far end.
	const WIGGLE = { segments: 24, waves: 3 };
	const drawLinks = (g: PixiGraphics) => {
		const styled: InstanceLink[] = [];
		for (const link of linksOf(node.id)) {
			if (link.style) {
				styled.push(link);
				continue;
			}
			const at = ends(link);
			if (!at) continue;
			g.moveTo(at.a.x, at.a.y);
			g.lineTo(at.b.x, at.b.y);
		}
		g.stroke(LINE);
		for (const link of styled) {
			const at = ends(link);
			const style = link.style;
			if (!at || !style) continue;
			const { a, b } = at;
			g.moveTo(a.x, a.y);
			if (style.wiggle && style.wiggle.amp >= 0.5) {
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const len = Math.hypot(dx, dy) || 1;
				for (let i = 1; i <= WIGGLE.segments; i++) {
					const u = i / WIGGLE.segments;
					const wave =
						Math.sin(u * Math.PI * 2 * WIGGLE.waves + style.wiggle.phase) *
						style.wiggle.amp *
						Math.sin(u * Math.PI);
					g.lineTo(a.x + dx * u - (dy / len) * wave, a.y + dy * u + (dx / len) * wave);
				}
			} else g.lineTo(b.x, b.y);
			g.stroke({ width: style.width, color: style.color, alpha: style.alpha });
			if (style.dot) g.circle(b.x, b.y, style.dot.r).fill(style.dot.color);
		}
	};

	// A character's clip (`arcadeClips.svelte.ts`), drawn with the bottom centre of its box (its
	// feet, `anchorY`) at the instance's place, `width` wide. Drawn only once its first frame is
	// loaded; until then, and with no clip, the instance's own tree shows. Each instance keeps its
	// folded clip by key, so a frame that publishes the same clip hands `<Flipbook>` the same object.
	const app = getContextApp();
	type Played = {
		clip: FlipbookClipEntry;
		key: string;
		scale: number;
		anchorY: number;
		own: boolean;
	};
	const folded: Record<string, { key: string; clip: FlipbookClipEntry }> = {};
	$effect(() => {
		const alive = new Set(instances.map((i) => i.id));
		for (const id of Object.keys(folded)) if (!alive.has(id)) delete folded[id];
	});
	const firstFrameWidth = (clip: FlipbookClipEntry) => {
		const first = clip.frames[0];
		if (!first) return undefined;
		const { assetKey, region } = parseScopedFrameRef(first);
		const sheet = assetKey ?? clip.assetKey;
		const assets = app.stateApp.loadedAssets as Record<string, unknown> | undefined;
		const scoped = isManifestAssetKey(sheet)
			? assets?.[editorArtTextureKey(sheet, region)]
			: undefined;
		return ((scoped ?? assets?.[region]) as { width?: number } | undefined)?.width;
	};
	const played = (id: string): Played | undefined => {
		const look = clipsOn() ? clipOf(id) : undefined;
		const clip = look && resolveFlipbook(look.clipId);
		const width = clip && firstFrameWidth(clip);
		if (!look || !clip || !width) return undefined;
		const natural = clip.bounds && clip.bounds.w > 0 ? clip.bounds.w : width;
		const key = `${look.clipId}|${look.flipX}|${look.loop}|${look.play}`;
		let entry = folded[id];
		if (entry?.key !== key) {
			const flipX = (clip.flipX === true) !== look.flipX;
			entry = { key, clip: foldFlipbookPlayback(clip, { loop: look.loop, flipX }) };
			folded[id] = entry;
		}
		return {
			clip: entry.clip,
			key,
			scale: look.width / natural,
			anchorY: look.anchorY,
			own: look.own,
		};
	};

	const instanceNode = (instance: SpawnedInstance): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: instance.id,
		componentId: instance.componentId,
		x: 0,
		y: 0,
	});
</script>

{#snippet look(instance: SpawnedInstance)}
	{#if marksOn()}
		{@const mark = markOf(instance.id)}
		{@const clip = played(instance.id)}
		{@const code = clip ? undefined : codeLookOf(instance.id)}
		{#if mark}
			<!-- On the ground: a hop's lifted container is raised by `z`, the glow is not. -->
			<Graphics y={liftsOn() ? (liftOf(instance.id)?.z ?? 0) : 0} draw={glowOf(mark.width)} />
		{/if}
		{#if clip}
			<!-- A marked player's own clip is drawn as made; the base one gold. -->
			<Container filters={mark && !clip.own ? goldFilters() : []}>
				{#key clip.key}
					<Flipbook
						clip={clip.clip}
						anchor={{ x: 0.5, y: clip.anchorY }}
						scale={{ x: clip.scale, y: clip.scale }}
					/>
				{/key}
			</Container>
		{/if}
		{#if code}
			<!-- Drawn in code (`arcadeArt.svelte.ts`): its own gold, if any, is its art's. -->
			{#key code}
				<MountedArt mount={code} />
			{/key}
		{/if}
		<Container filters={mark ? goldFilters() : []} visible={!clip && !code}>
			<ComponentInstance node={instanceNode(instance)} {space} />
		</Container>
	{:else}
		<ComponentInstance node={instanceNode(instance)} {space} />
	{/if}
{/snippet}

{#each instances as instance, seq (instance.id)}
	{#if projection}
		<!-- A projected screen (P11.4): drawn upright at the projected place, in ground-depth order
		     (the zIndex; spawn order breaks a tie), culled by the loop's projected view. -->
		{@const place = places[instance.id] ?? instance}
		{@const at = projection.project(place.x, place.y)}
		{@const lift = liftsOn() ? liftOf(instance.id) : undefined}
		<Container
			x={at.x}
			y={at.y}
			zIndex={projection.depth(place.x, place.y, seq)}
			visible={!culling || !isCulled(instance.id)}
		>
			{#if lift}
				<Graphics y={lift.foot} draw={shadowOf(lift.shadow)} />
			{/if}
			<Container y={-(lift?.z ?? 0)}>
				{@render look(instance)}
			</Container>
		</Container>
	{:else if liftsOn()}
		{@const lift = liftOf(instance.id)}
		<Container
			x={places[instance.id]?.x ?? instance.x}
			y={places[instance.id]?.y ?? instance.y}
			visible={!culling || !isCulled(instance.id)}
		>
			{#if lift}
				<Graphics y={lift.foot} draw={shadowOf(lift.shadow)} />
			{/if}
			<Container y={-(lift?.z ?? 0)}>
				{@render look(instance)}
			</Container>
		</Container>
	{:else if culling}
		<Container
			x={places[instance.id]?.x ?? instance.x}
			y={places[instance.id]?.y ?? instance.y}
			visible={!isCulled(instance.id)}
		>
			{@render look(instance)}
		</Container>
	{:else}
		<Container x={places[instance.id]?.x ?? instance.x} y={places[instance.id]?.y ?? instance.y}>
			{@render look(instance)}
		</Container>
	{/if}
{/each}
{#if marksOn() && linksOf(node.id).length}
	<!-- Above every instance: a projected layer's instances are ordered by depth (zIndex). -->
	<Graphics zIndex={Number.MAX_SAFE_INTEGER} draw={drawLinks} />
{/if}
