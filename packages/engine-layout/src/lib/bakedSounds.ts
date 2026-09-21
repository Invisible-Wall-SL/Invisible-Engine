import type { LoadedAudio } from 'pixi-svelte';
import type { SoundCatalog } from './soundLibrary';

/**
 * Shared baked-sound runtime — the engine-owned half of the sound publish pipeline
 * (`docs/design/invisible-sound.md` §5). A project's bake embeds its sound catalog in the bundle;
 * this turns that catalog into the extra audio BANKS `sound.load()` takes.
 *
 * Defined ONCE here, exactly like `bakedFonts.ts`, so every game (current and future) gets the same
 * behaviour by calling it — fixes travel through the engine submodule rather than per-game
 * copy-paste. A game's `editor-scenes.ts` extracts the catalog (it owns its own bundle import and
 * baked/un-baked gate) and passes it in; un-baked dev passes `undefined` and this is an inert no-op,
 * which is what keeps an unauthored project byte-identical.
 */

/**
 * A project's sounds as banks, one per file, appended AFTER the game's built-in audiosprite so a
 * project sound of the same name overrides the shipped one (`buildSoundBankIndex` is last-wins).
 *
 * One bank per file rather than one for the lot, because each uploaded sound is its own object in
 * `deploy/sounds/` — there is no sprite sheet to share until the optional pack step (design §10).
 * The cost is one decode per file on the client, which is why the tool shows the count.
 *
 * The sprite region is `[0, durationMs]`, plus `true` for a looping sound: that third element is
 * the ONLY place looping is expressed in this engine — the players carry no loop flag of their own,
 * which is why `createPlayer`'s did nothing and was removed.
 *
 * `format` is declared explicitly from the file's extension rather than left to howler's URL
 * sniffing. Howler strips the query string before looking for an extension
 * (`/\.([^.]+)$/.exec(str.split('?', 1)[0])`) and fails with "No codec support for selected audio
 * sources" — silently, as a `loaderror` nobody listens for — when it finds none. Today both asset
 * bases end in the filename so sniffing would work, but the catalog already KNOWS the container and
 * stating a known fact is cheaper than depending on the shape of a URL built three packages away.
 */
export function bakedSoundBanks(
	catalog: SoundCatalog | undefined,
	srcBase: string,
): LoadedAudio<string>[] {
	if (!catalog?.sounds?.length) return [];
	const out: LoadedAudio<string>[] = [];
	for (const entry of catalog.sounds) {
		if (!entry?.name || !entry.file || !(entry.durationMs > 0)) continue;
		const ext = entry.file.slice(entry.file.lastIndexOf('.') + 1).toLowerCase();
		out.push({
			src: `${srcBase}${catalog.prefix}/${entry.file}`,
			sprite: { [entry.name]: entry.loop ? [0, entry.durationMs, true] : [0, entry.durationMs] },
			config: { [entry.name]: { volume: entry.volume ?? 1 } },
			...(ext ? { format: [ext] } : {}),
		});
	}
	return out;
}
