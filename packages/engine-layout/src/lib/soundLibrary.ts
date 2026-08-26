/**
 * Invisible Sound — the shared contract for a project's SOUND LIBRARY: which sounds it owns, where
 * their files live, who made them, and whether they are approved to ship.
 *
 * Lives here, on the bare (Svelte-free) `engine-layout` entry, because BOTH sides import it — the
 * launcher's `/sound` tool authors it and the game loads it as a bank — exactly as `fontCatalog.ts`
 * serves the Font Maker and the runtime font registration. The Zod validator lives launcher-side
 * (`lib/server/soundsStorage.ts`) so this package stays dependency-free.
 *
 * ## This is the LIBRARY, not the bindings
 *
 * Do not confuse it with `game-config/sounds.ts`, which is the SLOT map — the named presentation
 * moments the engine fires and the cue bound to each. That answers "what plays when"; this answers
 * "what sounds does this project have at all". The slot map stores a NAME; this is the thing that
 * gives the name something to play. See `docs/design/invisible-sound.md` §2.3 — the bindings stay in
 * the tool that owns the moment, and a sound page that re-authored them would give one fact two
 * homes.
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
	updatedAt?: string;
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
