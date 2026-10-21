<script lang="ts">
	/**
	 * A screen the game mounts itself because the driven flow never shows it: the add-on's Pots
	 * screen (`enginePotsScreen`). While mounted it counts as up for screen timelines
	 * (`engineScreenUp`), so a timeline playing on it moves THIS mount, remounted with the timeline's
	 * driver as `<FlowV2Mount>` remounts a shown screen, instead of `<Cinematic>` drawing a copy of
	 * the screen beside it. Without a flow handle it is a plain mount at `z`.
	 */
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

	$effect(() => {
		const sceneId = scene.id;
		const handle = flow;
		handle?.engineScreenUp(sceneId, true);
		return () => handle?.engineScreenUp(sceneId, false);
	});

	const drive = $derived(flow?.screenDrive(scene.id));
</script>

<Container zIndex={z}>
	{#key drive?.key}
		<LayoutScene {scene} nodeDriver={drive?.driver} />
	{/key}
</Container>
