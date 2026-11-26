<script lang="ts">
	/**
	 * A plain arcade game's RIG STAMP (zone art, `docs/design/zone-art.md`): the component its node
	 * binds (`engine-layout/zone-art` `ZONE_ART_RIG`), registered by `game/zoneArt.ts` only for a
	 * config whose zone art names a rig. It loads the rig drawing (`engine-layout/zone-art-rig`, a lazy
	 * chunk no other game fetches) and mounts the stamp's picture at the node's place: the rig
	 * fitted inside the stamp's box, its ratio kept, playing its animation from the seed's start.
	 */
	import { MountedArt, type ArtMount } from 'engine-layout/svelte';
	import type { ZoneRigStamp } from 'engine-layout/zone-art-rig';

	import { stateApp } from '../game/stateApp';

	// Optional as every bound component's props are; the node always gives all four
	// (`zoneArtNodes.ts` `zoneStampNode`).
	const { source, phase = 0, w = 0, h = 0 }: Partial<ZoneRigStamp> = $props();

	let mount = $state.raw<ArtMount>();
	$effect(() => {
		if (!source) return;
		const stamp = { source, phase, w, h };
		let live = true;
		import('engine-layout/zone-art-rig').then(
			(art) => {
				if (live)
					mount = art.zoneRigMount(
						stamp,
						() => stateApp.loadedAssets as Record<string, unknown> | undefined,
					);
			},
			(error: unknown) =>
				console.warn(`[zone art] a rig stamp is not drawn: its drawing did not load (${error})`),
		);
		return () => {
			live = false;
		};
	});
</script>

{#if mount}
	{#key mount}
		<MountedArt {mount} />
	{/key}
{/if}
