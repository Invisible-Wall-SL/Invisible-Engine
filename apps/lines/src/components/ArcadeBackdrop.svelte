<script lang="ts">
	import { BACKDROP_ART, MountedArt, fieldArtOf } from 'engine-layout/svelte';
	import { Container, Rectangle, getContextApp } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { playFieldPlaying } from '../game/playFieldPhase';

	/**
	 * THE BACKDROP OF A PLAY FIELD WHOSE ROOM HAS ART (Salmons; owner 2026-11-27: "give Salmons its
	 * own loading background"), mounted in place of the slot sample's `<Background>` (`Game.svelte`),
	 * so it also stands behind a published layout's coded `Background` anchor with no re-upload.
	 * Until the room's art is in, the deep water its backdrop darkens to; then the art's own
	 * (`BACKDROP_ART`). While the field is played the world covers the screen, so nothing of it is
	 * drawn then.
	 */
	const BASE = 0x06263d;

	const context = getContext();
	const app = getContextApp();
	const art = $derived(fieldArtOf(BACKDROP_ART));
	let playing = $state(false);
	$effect(() => {
		const ticker = app.stateApp.pixiApplication?.ticker;
		if (!ticker) return;
		const follow = () => {
			const now = playFieldPlaying();
			if (now !== playing) playing = now;
		};
		ticker.add(follow);
		return () => {
			ticker.remove(follow);
		};
	});
</script>

<Container visible={!playing}>
	<Rectangle {...context.stateLayoutDerived.canvasSizes()} backgroundColor={BASE} />
	{#if art}
		{#key art}
			<MountedArt mount={art} />
		{/key}
	{/if}
</Container>
