/**
 * Invisible Sound — the shared contract for a project's SOUND LIBRARY: which sounds it owns, where
 * their files live, who made them, and whether they are approved to ship.
 *
 * Lives here, on the bare (Svelte-free) `engine-layout` entry, because BOTH sides import it — the
 * launcher's `/sound` tool authors it and the game loads it as a bank — exactly as `fontCatalog.ts`
 * serves the Font Maker and the runtime font registration. The Zod validator lives launcher-side
 * (`lib/server/soundsStorage.ts`) so this package stays dependency-free.
 *
 * ## Two halves, one document
 *
 * {@link SoundEntry} is the LIBRARY — what audio this project owns. {@link SoundBindings} is the
 * CHOICES — what plays at each named moment. They are saved together because choosing a sound and
 * having one are the same job, and splitting them is what sent authors through three tools.
 *
 * `game-config/sounds.ts` still owns the CATALOGUE: which slots exist, when the engine fires each,
 * and what it falls back to. That is the engine's contract and does not belong to a tool. What moved
 * here is only the author's choice against it.
 *
 * ## Why a library needs to exist
 *
 * Before it, the playable names were a hardcoded TypeScript union (`apps/lines/src/game/sound.ts`)
 * and the audio was one audiosprite baked into each app's `static/`, identical for every project. A
 * project could not add a sound without an engine edit, which a game vendoring the engine as a
 * submodule cannot do.
 */

/** Which player a cue is meant for. Sectioning + validation only — the runtime still decides,
 *  because music/loop/once is a property of the CALL SITE, not of the audio. */
export const SOUND_KINDS = ['music', 'sfx'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/**
 * Review state. `draft` never blocks PLAYBACK — it blocks PUBLISH.
 *
 * That is inverted from Invisible Localization, which drops unreviewed text from the runtime
 * bundle, and the inversion is deliberate: an unreviewed string falls back to visible English,
 * while an unapproved sound falls back to SILENCE, which howler produces without an error and
 * nobody notices in QA. Gating the release instead of the playback makes the failure loud at the
 * one moment it matters. See `docs/design/invisible-sound.md` §6.
 */
export const SOUND_STATUSES = ['draft', 'approved'] as const;
export type SoundStatus = (typeof SOUND_STATUSES)[number];

/** Where a sound came from. Not decoration — a non-commercially-licensed cue sitting in a shipped
 *  slot is a worse problem than a wrong one, and nothing records this today. */
export const SOUND_ORIGINS = ['ai', 'commissioned', 'library', 'builtin'] as const;
export type SoundOrigin = (typeof SOUND_ORIGINS)[number];

/** Container formats the browser can decode and howler will accept. */
export const SOUND_FILE_EXTENSIONS = ['mp3', 'ogg', 'm4a', 'wav', 'webm'] as const;

/**
 * One sound in the project's library.
 *
 * `id` is the stable handle (the file is stored under it); `name` is what a BINDING stores and what
 * the game plays. They are separate so a sound can be renamed without orphaning its file — and so a
 * rename is a visible, checkable operation rather than a silent re-upload.
 */
export interface SoundEntry {
	/** Stable, tool-minted, never the display name. Unique within the doc. */
	id: string;
	/** THE PLAYABLE NAME — the join key every binding in the system stores. Unique within the doc. */
	name: string;
	kind: SoundKind;
	/** Browsing group in the tool ('Reels', 'Wins', 'UI', …). Presentation only. */
	section?: string;
	/** Filename under the project's `sounds/files/`, relative and bare — see {@link isValidSoundFile}. */
	file: string;
	/** Length in ms. Becomes the sprite region's duration when the file is loaded as a bank. */
	durationMs: number;
	/** Base volume 0..1. Absent ⇒ full — the same meaning `LoadedAudio.config` gives it. */
	volume?: number;
	/** Marks the sound as looping. Becomes the third element of the sprite tuple, which is the ONLY
	 *  place looping is expressed — the players do not carry a loop flag of their own. */
	loop?: boolean;

	status: SoundStatus;
	reviewedBy?: string;
	reviewedAt?: string;
	notes?: string;

	origin: SoundOrigin;
	/** When `origin === 'ai'`. */
	model?: string;
	/** Musician or studio. */
	author?: string;
	license?: string;
	licenseUrl?: string;
}

/** The authored doc at `<client>/<project>/sounds/sounds.json`. */
export interface SoundsDoc {
	version?: 1;
	entries?: SoundEntry[];
	/** What plays WHEN — see {@link SoundBindings}. Absent on a doc written before authoring moved
	 *  here, which is what {@link effectiveSoundBindings} exists to cover. */
	bindings?: SoundBindings;
	updatedAt?: string;
}

/**
 * One slot's choice — the cue (or ladder of cues) the engine plays at a named moment.
 *
 * Structurally identical to `game-config`'s `SoundSlotBinding`, and deliberately re-declared rather
 * than imported: the CATALOGUE (which slots exist, when each fires, what it falls back to) is the
 * engine's contract and stays in `game-config`; only the AUTHORED CHOICE moved here. Importing it
 * would make this package depend on the math schema for a shape that is three optional fields.
 */
export interface SoundSlotChoice {
	/** Ordered cue names — one for a single slot, the rungs for a ladder. Absent/empty ⇒ the
	 *  catalogue's own defaults, which is how a project that authors nothing still has a full set. */
	names?: string[];
	volume?: number;
	/** `false` silences the moment — the ONLY way to mean "play nothing here". */
	enabled?: boolean;
}

/**
 * WHAT PLAYS WHEN — every sound choice in the game, in one document.
 *
 * This is the half that used to live in three other tools: slot cues in `/config`, per-symbol and
 * anticipation cues in `/symbols`, win-tier cues in the Scene Editor. Each sat beside the thing it
 * described, which sounded right and read badly — choosing a game's audio meant opening three tools
 * and knowing which one owned which moment, and nothing could show you the set.
 *
 * They live here now, so Invisible Sound is the one place a sound is chosen: the library and the
 * choices in the same document, saved together. Flow cues are the deliberate exception — a cue node
 * has wires, conditions and a position, so it stays in its graph and this tool only lists it.
 *
 * SPARSE at every level. An absent section, moment or field means "the engine's own default", never
 * "silent"; `enabled: false` is the only silence.
 */
export interface SoundBindings {
	/** Slot id → its choice. Ids come from the engine's catalogue (`game-config/sounds`). */
	slots?: Record<string, SoundSlotChoice>;
	/** Symbol id → state → cue name. The per-symbol exception to the game-wide slot. */
	symbols?: Record<string, Record<string, string>>;
	/** The reel-anticipation pair: the one-shot as the tease starts, and the loop under it. */
	anticipation?: { activation?: string; loop?: string };
	/** Win-tier alias (`big`, `mega`, …) → its one-shot and the music bed under the presentation. */
	winTiers?: Record<string, { sfx?: string; bgm?: string }>;
}

/**
 * A playable name. Deliberately narrow: the name travels into a sprite key, a JSON object key, a
 * dropdown and (at S9) the authored replacement for the generated `SoundName` enum, so the set of
 * characters it may contain is the intersection of all of those, not the union.
 */
export const SOUND_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSoundName(name: unknown): name is string {
	return typeof name === 'string' && SOUND_NAME_PATTERN.test(name);
}

/**
 * A stored filename. BARE — no directory part at all, which is the traversal guard: the file is
 * always read from and written to the project's own `sounds/files/`, and a stored `../` would let a
 * doc field address any object in the bucket. Checked here rather than at the upload endpoint so
 * the doc cannot even hold such a value.
 */
export function isValidSoundFile(file: unknown): file is string {
	if (typeof file !== 'string' || !file || file.length > 200) return false;
	if (file.includes('/') || file.includes('\\') || file.includes('..')) return false;
	const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
	return file.includes('.') && (SOUND_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Find an entry by its playable name. **LAST wins**, which is not arbitrary: it is the same rule
 * `buildSoundBankIndex` (`utils-sound/banks.ts`) applies when two banks declare one name, and the
 * doc must not be able to answer differently from the player that loads it. `normalizeSoundsDoc`
 * removes duplicates on save, so this only matters for a doc read before that ran.
 */
export function findSoundByName(
	doc: SoundsDoc | null | undefined,
	name: string | null | undefined,
): SoundEntry | undefined {
	if (!doc?.entries || !name) return undefined;
	for (let i = doc.entries.length - 1; i >= 0; i -= 1) {
		if (doc.entries[i]?.name === name) return doc.entries[i];
	}
	return undefined;
}

/** Every playable name the library declares, in doc order. */
export function soundNames(doc: SoundsDoc | null | undefined): string[] {
	return (doc?.entries ?? []).map((entry) => entry.name);
}

/**
 * One sound as it SHIPS — the exported form, stripped to what a running game needs to play it.
 *
 * Everything authoring-only is left behind: `id`, `section`, `status`, `reviewedBy`/`reviewedAt`,
 * `notes`, and the whole provenance block. That mirrors how `fontExport` strips a font's `recipe`,
 * and it matters more here than there: `license`, `author` and `model` are internal records about
 * who we owe, and a shipped bundle is the one place they have no business being.
 */
export interface SoundCatalogEntry {
	/** The playable name — the key a binding stores and the sprite region the player addresses. */
	name: string;
	/** Filename within the exported subtree. */
	file: string;
	durationMs: number;
	volume?: number;
	loop?: boolean;
}

/** The `deploy/sounds/index.json` manifest — the sound sibling of `FontCatalog`. */
export interface SoundCatalog {
	/** The `static/assets/` subtree the files are mirrored into (`sounds`). */
	prefix: string;
	sounds: SoundCatalogEntry[];
	/**
	 * WHAT PLAYS WHEN, resolved at export time.
	 *
	 * The export is the one place that can see all three docs at once, so the migration fallback runs
	 * THERE ({@link effectiveSoundBindings}) and the bundle carries a single settled answer. A runtime
	 * that had to re-derive it would need the config and symbols docs in hand at every read point,
	 * and would answer differently depending on which of them a given game happened to have loaded.
	 *
	 * Absent means "this bundle predates the move, or the project has authored nothing" — every
	 * reader then falls back to the path it used before, which is what keeps an un-migrated game
	 * byte-identical.
	 */
	bindings?: SoundBindings;
}

/**
 * The shipping form of a library doc. Order preserved; nothing is re-validated here because the doc
 * was normalized on save — an entry that reached storage is already playable or was dropped.
 */
export function soundCatalogEntries(doc: SoundsDoc | null | undefined): SoundCatalogEntry[] {
	return (doc?.entries ?? []).map((entry) => {
		const out: SoundCatalogEntry = {
			name: entry.name,
			file: entry.file,
			durationMs: entry.durationMs,
		};
		if (entry.volume !== undefined) out.volume = entry.volume;
		if (entry.loop) out.loop = true;
		return out;
	});
}

// ── the move out of /config and /symbols ──────────────────────────────────────────────────────
//
// Sound choices used to live in three docs. They live in this one now, but a project written
// before the move still has them in the old places, and a game must not go quiet because its
// author has not opened the new tool yet. So every reader goes through `effectiveSoundBindings`,
// which answers with the new home when it exists and reads the old ones when it does not.
//
// ONE-WAY and WHOLE-DOC: the legacy read is a fallback for the entire `bindings` block, not a
// per-field merge. A half-migrated doc — some moments here, some still over there — would make
// "where does this sound come from" unanswerable, which is the exact problem the move set out to
// fix. `/sound` seeds the block from the legacy docs on load, so the author sees their existing
// choices and the first save migrates the lot.

const rec = (v: unknown): Record<string, unknown> | undefined =>
	typeof v === 'object' && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;

const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** The legacy homes, passed as loose shapes so this package needs no dependency on either schema. */
export interface LegacySoundBindings {
	/** `GameConfigDoc.sounds` — the `/config` Sounds panel. */
	configSounds?: unknown;
	/** `SymbolsDoc.symbolSounds` — the `/symbols` per-symbol cues. */
	symbolSounds?: unknown;
	/** `SymbolsDoc.anticipation` — its `activationSound` / `loopSound`. */
	anticipation?: unknown;
	/** `GameConfigDoc.winLevels` — each tier's `sound.sfx` / `sound.bgm`. */
	winLevels?: unknown;
}

/** The legacy docs read into the shape this tool now stores. Used as the fallback below, and by
 *  `/sound` to seed a project that has not migrated yet. */
export function legacySoundBindings(legacy: LegacySoundBindings | undefined): SoundBindings {
	const out: SoundBindings = {};

	const slotsIn = rec(legacy?.configSounds);
	if (slotsIn) {
		const slots: Record<string, SoundSlotChoice> = {};
		for (const [id, raw] of Object.entries(slotsIn)) {
			const entry = rec(raw);
			if (!entry) continue;
			const choice: SoundSlotChoice = {};
			const names = Array.isArray(entry.names)
				? entry.names.filter((n): n is string => typeof n === 'string' && n.length > 0)
				: [];
			if (names.length) choice.names = names;
			if (typeof entry.volume === 'number') choice.volume = entry.volume;
			if (entry.enabled === false) choice.enabled = false;
			if (Object.keys(choice).length) slots[id] = choice;
		}
		if (Object.keys(slots).length) out.slots = slots;
	}

	const symbolsIn = rec(legacy?.symbolSounds);
	if (symbolsIn) {
		const symbols: Record<string, Record<string, string>> = {};
		for (const [symbol, raw] of Object.entries(symbolsIn)) {
			const states = rec(raw);
			if (!states) continue;
			const kept: Record<string, string> = {};
			for (const [state, name] of Object.entries(states)) {
				const n = str(name);
				if (n) kept[state] = n;
			}
			if (Object.keys(kept).length) symbols[symbol] = kept;
		}
		if (Object.keys(symbols).length) out.symbols = symbols;
	}

	const antIn = rec(legacy?.anticipation);
	if (antIn) {
		const activation = str(antIn.activationSound);
		const loop = str(antIn.loopSound);
		if (activation || loop) {
			out.anticipation = { ...(activation ? { activation } : {}), ...(loop ? { loop } : {}) };
		}
	}

	if (Array.isArray(legacy?.winLevels)) {
		const winTiers: Record<string, { sfx?: string; bgm?: string }> = {};
		for (const raw of legacy.winLevels) {
			const tier = rec(raw);
			const alias = str(tier?.alias);
			const sound = rec(tier?.sound);
			if (!alias || !sound) continue;
			const sfx = str(sound.sfx);
			const bgm = str(sound.bgm);
			if (sfx || bgm) winTiers[alias] = { ...(sfx ? { sfx } : {}), ...(bgm ? { bgm } : {}) };
		}
		if (Object.keys(winTiers).length) out.winTiers = winTiers;
	}

	return out;
}

/**
 * The choices this project actually plays: the sounds doc's own block when it has one, the legacy
 * docs when it does not.
 *
 * EVERY reader must come through here — the export, the runtime and the tool — or a project that
 * has not migrated would resolve differently depending on who asked, which is the class of bug that
 * makes a sound play in the editor and not in the game.
 */
export function effectiveSoundBindings(
	doc: SoundsDoc | null | undefined,
	legacy?: LegacySoundBindings,
): SoundBindings {
	return doc?.bindings ?? legacySoundBindings(legacy);
}
