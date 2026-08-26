<script lang="ts">
	import { onMount } from 'svelte';

	import { bakedSoundBanks } from 'engine-layout';
	import type { LoadedAudio } from 'pixi-svelte';

	import { bakedSoundCatalog, bakedSoundSrcBase } from '../editor-scenes';
	import { getContext } from '../game/context';
	import { sound, type SoundName } from '../game/sound';

	const context = getContext();

	onMount(() => {
		const loadedAudio = $state.snapshot(
			context.stateApp.loadedAssets['sound'],
		) as LoadedAudio<SoundName>;
		// The shipped audiosprite FIRST, then the project's own uploaded sounds — `load()` resolves a
		// name to the LAST bank declaring it, so a project sound named after a built-in replaces it
		// rather than colliding with it. An un-baked or sound-less project contributes no banks, which
		// makes this byte-identical to the single-bank call it replaces (parity).
		const { destroy } = sound.load([
			loadedAudio,
			...(bakedSoundBanks(bakedSoundCatalog(), bakedSoundSrcBase()) as LoadedAudio<SoundName>[]),
		]);

		return () => {
			// Equivalent to onDestroy(); Leave this comment for searching.
			destroy();
		};
	});

	sound.enableEffect();
	sound.volumeEffect();
</script>
