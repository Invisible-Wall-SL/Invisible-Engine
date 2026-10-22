<script lang="ts">
	/**
	 * A screen the game mounts itself because the driven flow never shows it: the add-on's Pots
	 * screen (`enginePotsScreen`). While mounted it counts as up for screen timelines
	 * (`engineScreenUp`), so a timeline playing on it moves THIS mount, remounted with the timeline's
	 * driver as `<FlowV2Mount>` remounts a shown screen, instead of `<Cinematic>` drawing a copy of
	 * the screen beside it (the flow's `onStage` counts it even while it is down, when the timeline
	 * draws nothing). Without a flow handle it is a plain mount at `z`.
	 */
	import { elementFxScreenTarget } from 'constants-shared/elementFx';
	import { Container } from 'pixi-svelte';
	import type { Scene } from 'engine-layout';
	import { LayoutScene, type ScreenNodeDrive } from 'engine-layout/svelte';

	type Props = {
		scene: Scene;
		z: number;
		flow?: {
			engineScreenUp: (sceneId: string, up: boolean) => void;
			screenDrive: (sceneId: string) => ScreenNodeDrive | undefined;
		};
	};
	const { scene, z, flow }: Props = $props();

	// Keyed on the id alone: a new scene object for the same screen is the same mount, so it must
	// not report the screen down and up, which would drop a held drive.
	const sceneId = $derived(scene.id);
	$effect(() => {
		const id = sceneId;
		const handle = flow;
		handle?.engineScreenUp(id, true);
		return () => handle?.engineScreenUp(id, false);
	});

	const drive = $derived(flow?.screenDrive(sceneId));
</script>

<Container zIndex={z}>
	{#key drive?.key}
		<LayoutScene {scene} nodeDriver={drive?.driver} parentTarget={elementFxScreenTarget(sceneId)} />
	{/key}
</Container>
