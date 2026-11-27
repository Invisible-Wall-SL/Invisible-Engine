<script lang="ts">
	import { BACKDROP_ART, MountedArt, fieldArtOf } from 'engine-layout/svelte';
	import { Container, Rectangle, getContextApp } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { playFieldPlaying } from '../game/playFieldPhase';

	/**
	 * THE BACKDROP OF A PLAY FIELD WHOSE ROOM HAS ART (Salmons), mounted in place of the slot
	 * sample's `<Background>` (`Game.svelte`), so it also stands behind a published layout's coded
	 * `Background` anchor with no re-upload. The deep water its art darkens to is always under it;
	 * the art itself (`BACKDROP_ART`) is left out while the field is played, when the world covers
	 * the screen.
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

<Rectangle {...context.stateLayoutDerived.canvasSizes()} backgroundColor={BASE} />
<Container visible={!playing}>
	{#if art}
		{#key art}
			<MountedArt mount={art} />
		{/key}
	{/if}
</Container>
