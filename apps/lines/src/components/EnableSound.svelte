<script lang="ts">
	import { onMount } from 'svelte';

	import { bakedSoundBanks } from 'engine-layout';
	import type { LoadedAudio } from 'pixi-svelte';
	import { canPlayAudioFormat } from 'utils-sound';

	import { bakedFlowV2Doc, bakedSoundCatalog, bakedSoundSrcBase } from '../editor-scenes';
	import stockTable from '../game/assets';
	import { getContext } from '../game/context';
	import { loadFlowV2Doc } from '../game/flowV2Runtime.svelte';
	import { sound, type SoundName } from '../game/sound';
	import { stockSoundBanks, type StockAudio } from '../game/stockSounds';

	const context = getContext();

	onMount(() => {
		const catalog = bakedSoundCatalog();
		// The engine's stock banks this game can play, FIRST, then the project's own uploaded sounds —
		// `load()` resolves a name to the LAST bank declaring it, so a project sound named after a
		// built-in replaces it rather than colliding with it. An un-baked or sound-less project
		// contributes no banks of its own.
		const stock = stockSoundBanks({
			stock: $state.snapshot(context.stateApp.loadedAssets['sound']) as StockAudio,
			manifestUrl: stockTable.sound.src,
			catalog,
			flowOverridden:
				loadFlowV2Doc() !== bakedFlowV2Doc() || globalThis.__IE_FLOW_V2_LIB__ !== undefined,
			canPlay: canPlayAudioFormat,
		});
		console.info(
			`[sound] stock: ${stock.banks.length} bank(s)` +
				(stock.loadedAllBecause ? ` — all, because ${stock.loadedAllBecause}` : ''),
		);
		const { destroy } = sound.load([
			...(stock.banks as LoadedAudio<SoundName>[]),
			...(bakedSoundBanks(catalog, bakedSoundSrcBase()) as LoadedAudio<SoundName>[]),
		]);

		return () => {
			// Equivalent to onDestroy(); Leave this comment for searching.
			destroy();
		};
	});

	sound.enableEffect();
	sound.volumeEffect();
</script>
