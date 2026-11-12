import { STOCK_SOUND_REACH_VERSION, type SoundCatalog } from 'engine-layout';
import { SOUND_SLOTS, resolveSounds, type GameSounds } from 'game-config';
import type { LoadedAudio } from 'pixi-svelte';

import { CODED_STOCK_SOUNDS } from './stockSoundRules';

/**
 * WHICH OF THE ENGINE'S STOCK SOUNDS A GAME LOADS.
 *
 * The stock audio used to be one 408 s audiosprite, and every game downloaded and decoded all of it
 * (≈ 144–157 MB of PCM) whatever it could play. It ships as BANKS now (`scripts/split-stock-audio.mjs`):
 * a region of the old sprite each, or a run of regions a game always loads together. A bank loads
 * when anything can play a sound in it:
 * - the game's DATA names it — `SoundCatalog.stock`, the export's walk over every document;
 * - the engine's own CODE plays it — {@link CODED_STOCK_SOUNDS}, held to the sources by
 *   `check-stock-sound-coverage.mjs`;
 * - a SLOT resolves to it, read here exactly as `activeSounds()` reads it.
 * The data half comes from the export and the other two from this runtime, because a published
 * snapshot keeps booting on every later release: a later engine that plays another stock sound from
 * code adds it here, and no export has to know.
 *
 * Every doubt loads every bank: no list (a bundle exported before lists existed, or one whose reach
 * the export could not tell), a list of another version, a flow other than the bundle's running
 * (the dev opt-ins), or a game repo whose own `static/` still carries the old single sprite.
 *
 * A stock sound a project uploads a sound of its own for is never played from the stock bank (the
 * project's bank comes later, and the last bank declaring a name wins), so a bank whose every sound
 * is shadowed that way is not loaded either.
 */

type Region = [number, number] | [number, number, boolean];

/**
 * One stock bank: per container a file and its `lead` (ms) — where the bank's time 0 is in it.
 * `files` is in preference order, as a sprite's `src` was for howler: the engine lists ogg, m4a,
 * mp3, ac3, and 🗜 Optimize rewrites a build's banks in its own order (`optimize-build-assets.mjs`).
 */
export type StockBank = {
	id: string;
	files: Partial<Record<string, { src: string; lead: number }>>;
	sprite: Record<string, Region>;
	config: Record<string, { volume: number }>;
};

/** `static/assets/audio/sounds.json`: banks, or (a game repo's older copy) the single sprite. */
export type StockAudio = LoadedAudio<string> & { version?: number; banks?: StockBank[] };

export type StockSoundInput = {
	/** The `sound` stock asset, as the asset loader handed it over. */
	stock: StockAudio;
	/** The URL the manifest was loaded from: bank files resolve beside it. */
	manifestUrl: string;
	/** The bundle's sound catalog; undefined when the game has no bundle. */
	catalog: SoundCatalog | undefined;
	/** A flow other than the bundle's is running (a dev opt-in): the list does not describe it. */
	flowOverridden: boolean;
	/** Whether this browser decodes a container (`canPlayAudioFormat`). */
	canPlay: (ext: string) => boolean;
};

export type StockSoundPlan = {
	banks: LoadedAudio<string>[];
	/** Set when every bank loads, and why. */
	loadedAllBecause?: string;
};

/** The stock sounds a slot can resolve to, read as `activeSounds()` reads them. */
export function slotStockSounds(catalog: SoundCatalog | undefined): string[] {
	const slots = catalog?.bindings?.slots;
	// No slots in the catalog: the game resolves them through its config, which a mode can swap,
	// so every slot's catalogue defaults stay in reach (an authored name is in the data list).
	if (!slots) return SOUND_SLOTS.flatMap((slot) => [...slot.defaults]);
	const resolved = resolveSounds({ sounds: slots as GameSounds });
	return SOUND_SLOTS.flatMap((slot) => {
		const { names, enabled } = resolved.slot(slot.id);
		return enabled ? names : [];
	});
}

/** The stock sounds this game can play, or the reason it must load every bank. */
export function stockSoundReach(
	input: Pick<StockSoundInput, 'catalog' | 'flowOverridden'>,
): { reach: Set<string> } | { loadAll: string } {
	const list = input.catalog?.stock;
	if (!list) return { loadAll: 'the bundle lists no stock sounds' };
	if (list.version !== STOCK_SOUND_REACH_VERSION || !Array.isArray(list.names))
		return { loadAll: `the bundle's stock list is version ${list.version}` };
	if (input.flowOverridden) return { loadAll: 'a flow other than the bundle’s is running' };
	return {
		reach: new Set([...list.names, ...CODED_STOCK_SOUNDS, ...slotStockSounds(input.catalog)]),
	};
}

/** `bank` as a `LoadedAudio` on the first container it lists that this browser plays, its lead
 *  applied. Never a later one where an earlier plays: the launcher's 🗜 Optimize ships only mp3. */
function bankAudio(bank: StockBank, input: StockSoundInput): LoadedAudio<string> | undefined {
	const listed = Object.keys(bank.files).filter((e) => bank.files[e]);
	const ext = listed.find((e) => input.canPlay(e)) ?? listed[0];
	const file = ext ? bank.files[ext] : undefined;
	if (!ext || !file) return undefined;
	const sprite: Record<string, Region> = {};
	for (const [name, [start, length, loop]] of Object.entries(bank.sprite)) {
		sprite[name] = loop ? [start + file.lead, length, true] : [start + file.lead, length];
	}
	return {
		src: [new URL(file.src, input.manifestUrl).href],
		sprite,
		config: bank.config,
		format: [ext],
	};
}

/** The banks of `banks` this game can play, in manifest order; all of them, and why, on a doubt.
 *  A standalone build ships exactly these (`stockSoundBuild.ts`). */
export function stockBanksInReach(
	banks: readonly StockBank[],
	input: Pick<StockSoundInput, 'catalog' | 'flowOverridden'>,
): { banks: StockBank[]; loadedAllBecause?: string } {
	const decided = stockSoundReach(input);
	if ('loadAll' in decided) return { banks: [...banks], loadedAllBecause: decided.loadAll };
	const shadowed = new Set((input.catalog?.sounds ?? []).map((sound) => sound.name));
	return {
		banks: banks.filter((bank) =>
			Object.keys(bank.sprite).some((name) => decided.reach.has(name) && !shadowed.has(name)),
		),
	};
}

/** The stock banks to load, in manifest order, ahead of the project's own banks. */
export function stockSoundBanks(input: StockSoundInput): StockSoundPlan {
	const { stock } = input;
	if (!Array.isArray(stock.banks))
		return { banks: [stock], loadedAllBecause: 'the stock audio is a single sprite' };
	const { banks, loadedAllBecause } = stockBanksInReach(stock.banks, input);
	return {
		banks: banks.map((bank) => bankAudio(bank, input)).filter((b) => b !== undefined),
		...(loadedAllBecause ? { loadedAllBecause } : {}),
	};
}
