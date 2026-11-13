import type { SoundCatalog } from 'engine-layout';

import { stockBanksInReach, type StockAudio } from './stockSounds';

/**
 * THE STOCK SOUND BANKS A STANDALONE BUILD LEAVES OUT.
 *
 * A game repo's `static/assets/audio/` carries every stock bank (`pull:assets` refreshes it from the
 * engine), and the boot loads only the banks the game can reach (`stockSounds.ts`). A standalone
 * build bakes everything that decision reads, so it is taken here at build time, and `config-vite`
 * (`stockAssetPrune.js`) leaves the other banks' files out of the build and out of its manifest.
 *
 * The decision is the boot's own (`stockBanksInReach`) on the same inputs: the bundle's sound
 * catalog, read as `bakedSoundCatalog()` reads it (none without a baked layout), and the bundle's
 * own flow, which is what a player's boot runs. Every doubt keeps every bank, as at boot.
 */

export type StockSoundBuildPlan = {
	/** Set when nothing is left out, and why. */
	keptAllBecause?: string;
	/** The bank ids this build leaves out. */
	skipped: string[];
	/** Each bank's files, relative to the manifest's folder. */
	files: Record<string, string[]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The catalog a boot of this bundle reads: `bakedSoundCatalog()`, which needs a baked layout. */
function bakedCatalogOf(bundle: Record<string, unknown>): SoundCatalog | undefined {
	const doc = bundle.doc;
	if (!isRecord(doc) || !Array.isArray(doc.scenes) || doc.scenes.length === 0) return undefined;
	const sounds = bundle.sounds;
	return isRecord(sounds) ? (sounds.catalog as SoundCatalog | undefined) : undefined;
}

export function stockSoundBuildPlan(bundle: unknown, manifest: unknown): StockSoundBuildPlan {
	const keepAll = (
		keptAllBecause: string,
		files: Record<string, string[]> = {},
	): StockSoundBuildPlan => ({
		keptAllBecause,
		skipped: [],
		files,
	});
	if (!isRecord(manifest) || !Array.isArray(manifest.banks))
		return keepAll('the stock audio is a single sprite');
	const banks = (manifest as StockAudio).banks ?? [];
	const files = Object.fromEntries(
		banks.map((bank) => [
			bank.id,
			Object.values(bank.files).flatMap((file) => (file ? [file.src] : [])),
		]),
	);
	if (!isRecord(bundle)) return keepAll('no readable editor bundle', files);
	const { banks: kept, loadedAllBecause } = stockBanksInReach(banks, {
		catalog: bakedCatalogOf(bundle),
		flowOverridden: false,
	});
	if (loadedAllBecause) return keepAll(loadedAllBecause, files);
	const keep = new Set(kept.map((bank) => bank.id));
	return { skipped: banks.filter((bank) => !keep.has(bank.id)).map((bank) => bank.id), files };
}
