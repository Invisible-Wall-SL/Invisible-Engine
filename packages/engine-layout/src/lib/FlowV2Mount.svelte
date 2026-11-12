<script lang="ts" module>
	import type { ScreenNodeDrive, ScreenSlot } from './cinematicNodeContext';
	import type { Scene } from './types';

	export type { ScreenNodeDrive, ScreenSlot };

	/** A container the v2 flow currently has mounted — its backing scene + stack position.
	 *  Structural (mirrors engine-flow-v2's `MountedContainer`) so engine-layout stays free of an
	 *  engine-flow-v2 dependency at this boundary — the game passes its real objects through. */
	export type MountedContainerRef = {
		id: string;
		sceneId: string;
		z: number;
	};

	export type Props = {
		/** The mounted containers, ALREADY z-sorted ASC (base first, overlays on top). The game
		 *  mirrors the mount model's `ordered()` into a rune and passes it here; this list drives
		 *  what is on screen — showing/hiding a container is just this array growing/shrinking. */
		containers: MountedContainerRef[];
		/** Resolve a container's `sceneId` → its backing LayoutDoc `Scene` (from the live editor
		 *  doc). A container whose scene doesn't resolve is skipped (parity-safe, never throws). */
		resolveScene: (sceneId: string) => Scene | undefined;
		/** The screen timeline moving a shown screen, by scene id (reactive). Absent ⇒ none. */
		screenDrive?: (sceneId: string) => ScreenNodeDrive | undefined;
		/** A screen its timelines drive WITHOUT remounting it, by scene id: its nodes sample whichever
		 *  timeline drives it now, and its content restarts on each new play. Absent ⇒ remounted. */
		screenSlot?: (sceneId: string) => ScreenSlot | undefined;
		/** Containers to mount AHEAD of their first show (the game's start-up screens, behind its start
		 *  screen): hidden and dormant until `containers` lists them, when they start in place as a
		 *  mount at that moment would (`<LayoutScene dormant>`). Only a screen no timeline drives, or
		 *  one driven in place (`screenSlot`), may be listed: a remounted screen is mounted at its
		 *  show. Once shown, a container is any other; hidden again, it is unmounted. */
		ahead?: MountedContainerRef[];
	};
</script>

<script lang="ts">
	import { elementFxScreenTarget } from 'constants-shared/elementFx';
	import { Container } from 'pixi-svelte';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { createAheadMounts } from './aheadMounts';
	import LayoutScene from './LayoutScene.svelte';

	const { containers, resolveScene, screenDrive, screenSlot, ahead = [] }: Props = $props();

	const shownIds = $derived(new Set(containers.map((c) => c.id)));
	/** The same set, read per id: a screen mounted ahead hears its own show and no other. */
	const shownEach = new SvelteSet<string>();
	$effect.pre(() => {
		const now = shownIds;
		untrack(() => {
			for (const id of shownEach) if (!now.has(id)) shownEach.delete(id);
			for (const id of now) shownEach.add(id);
		});
	});
	const aheadMounts = createAheadMounts();
	const mounted = $derived(aheadMounts.plan(containers, ahead));
	/** A screen mounted ahead: its first show changes this, which restarts it, and so does each new
	 *  play of a timeline driving it in place. */
	const aheadRestart = (id: string, slot: ScreenSlot | undefined) => (): string =>
		`${shownEach.has(id) ? 'shown' : 'ahead'}:${String(slot?.restart() ?? '')}`;
</script>

<!--
	Invisible Flow v2 — the generic z-ordered container MOUNTER (Phase 4b; replaces v1's
	active-set render loop). It renders each mounted container's scene via the SAME
	`<LayoutScene>` the coded/v1 path uses (so MainContainer scaling + `visibleSource` are
	honoured unchanged). Stacking is by render order: the `containers` list is z-sorted ASC, so
	an earlier entry paints under a later one — `zIndex` is also set so a `sortableChildren`
	parent stacks identically. Keyed by container id so a container keeps its instance (and any
	in-flight component animation) across reorders. No entrance fade here: v2 timing is authored
	explicitly with `delay` nodes, so a `show` is a hard cut (design doc §4). A screen a playing
	screen timeline animates mounts with that timeline's driver (`screenDrive`).
-->
{#each mounted as container (container.id)}
	{@const scene = resolveScene(container.sceneId)}
	{@const drive = screenDrive?.(container.sceneId)}
	{@const slot = screenSlot?.(container.sceneId)}
	{#if scene}
		<Container zIndex={container.z}>
			{#if aheadMounts.mountedAhead(container.id)}
				<LayoutScene
					{scene}
					nodeDriver={slot?.driver}
					restart={aheadRestart(container.id, slot)}
					dormant={() => !shownEach.has(container.id)}
					parentTarget={elementFxScreenTarget(container.sceneId)}
				/>
			{:else if slot}
				<LayoutScene
					{scene}
					nodeDriver={slot.driver}
					restart={slot.restart}
					parentTarget={elementFxScreenTarget(container.sceneId)}
				/>
			{:else}
				{#key drive?.key}
					<!-- The container is this screen's own: a Flow `elementEffect` aims at it by name. -->
					<LayoutScene
						{scene}
						nodeDriver={drive?.driver}
						parentTarget={elementFxScreenTarget(container.sceneId)}
					/>
				{/key}
			{/if}
		</Container>
	{/if}
{/each}
