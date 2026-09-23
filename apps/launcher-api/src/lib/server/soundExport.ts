import type { SoundBindings, SoundCatalog, SoundCatalogEntry } from 'engine-layout';
import { effectiveSoundBindings, soundCatalogEntries } from 'engine-layout';
import { capAudioBitrate, isTranscodableAudio } from './audioTranscode';
import { ENV } from './env';
import { loadGameConfigDoc } from './gameConfigStorage';
import { SUB, soundFileKey } from './projectPaths';
import {
	copyObject,
	deleteObjects,
	getObjectBytes,
	getObjectText,
	headObject,
	listAllKeys,
	objectExists,
	putObjectBytes,
	putObjectText,
} from './r2';
import { loadSoundsDoc } from './soundsStorage';
import { loadSymbolsDoc } from './symbolsStorage';

/**
 * Export a project's sound library + the audio files it references into the game-loadable
 * `deploy/sounds/` subtree — the sound analogue of `fontExport.ts`. Closes the "uploaded a sound,
 * it auditions in the tool, but the shipped game has never heard of it" gap (CLAUDE.md rule 8).
 *
 * The tool streams audio straight from R2 (`/api/sounds/file`), but a game loads audio only from
 * files in its own `static/assets/`. This copies each library entry's file into:
 *
 *   <client>/<project>/deploy/sounds/<file>
 *   <client>/<project>/deploy/sounds/index.json   ← the exported catalog
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and embeds the
 * catalog in the baked bundle, `runtimeBundle.ts` does the same for the live Game Maker path,
 * `pull-project-assets.mjs` mirrors `deploy/` → `static/assets/`, and the game turns the catalog
 * into extra audio banks (`engine-layout/bakedSounds.ts`). Stale objects from a previous export are
 * pruned. Idempotent — re-running converges.
 *
 * File NAMES are preserved verbatim (they are minted ids, already unique) and the subtree is FLAT:
 * unlike a font, a sound has no sibling files to keep next to it.
 *
 * BYTES are not always verbatim: an over-encoded upload is re-encoded down to
 * `ENV.SOUND_MAX_KBPS` on the way out (`audioTranscode.ts`), because nothing else in this
 * pipeline has ever looked at how an upload was encoded and a 256 kbps music bed was reaching
 * every player. The uploaded source is never touched, the container never changes, and a
 * re-encode is kept only when it is actually smaller — so the export still converges and
 * `SOUND_TRANSCODE=0` restores the original bytes. What was done to each file is remembered in
 * `sounds/_transcode.json` so a re-export does not re-encode unchanged audio.
 *
 * ⚠️ **Draft sounds are exported.** The approval gate belongs at PUBLISH (design §6), not here — a
 * test build has to be able to hear what it is reviewing, and an exporter that silently dropped
 * unapproved audio would produce exactly the unexplained silence this tool exists to end. S8 adds
 * that gate to the publish path.
 *
 * The catalog also carries WHAT PLAYS WHEN. Authoring moved into this tool, but a project written
 * before that still holds its choices in the config and symbols docs — and only the export sees all
 * three at once. So the fallback is resolved HERE, once, and the bundle ships one settled answer
 * instead of asking every runtime read point to re-derive it from documents it may not have.
 */

export interface SoundExportIndex {
	/** The catalog of sounds actually exported — only entries whose file really copied. */
	catalog: SoundCatalog;
}

const EXPORT_SUBTREE = 'sounds';

export async function exportProjectSounds(
	clientKey: string,
	projectKey: string,
): Promise<SoundExportIndex> {
	const outPrefix = `${SUB.deploy(clientKey, projectKey)}/${EXPORT_SUBTREE}/`;

	/** Export nothing, but still prune leftovers so `deploy/sounds/` mirrors reality. */
	const pruneAndReturn = async (catalog: SoundCatalog): Promise<SoundExportIndex> => {
		await deleteObjects(await listAllKeys(outPrefix));
		return { catalog };
	};

	const empty: SoundCatalog = { prefix: EXPORT_SUBTREE, sounds: [] };

	let doc;
	try {
		doc = await loadSoundsDoc(clientKey, projectKey);
	} catch {
		// An unreadable doc must not take the project's other assets down with it: the bake treats a
		// failed export as fatal, so a transient R2 read is the one thing worth swallowing here.
		return pruneAndReturn(empty);
	}

	const bindings = await resolveBindings(clientKey, projectKey, doc);

	const written = new Set<string>();
	const exported: SoundCatalogEntry[] = [];
	const cache = await loadTranscodeCache(clientKey, projectKey);

	for (const entry of soundCatalogEntries(doc)) {
		const destKey = `${outPrefix}${entry.file}`;
		const srcKey = soundFileKey(clientKey, projectKey, entry.file);
		// A missing source is skipped rather than fatal: an ORPHANED ENTRY (a doc row whose upload
		// never landed, or whose file was deleted underneath it) must not break the whole export,
		// and advertising it would ship a name that plays nothing.
		if (!(await exportOneFile(srcKey, destKey, entry.file, cache))) continue;
		written.add(destKey);
		exported.push(entry);
	}
	await saveTranscodeCache(clientKey, projectKey, cache);

	const catalog: SoundCatalog = {
		prefix: EXPORT_SUBTREE,
		sounds: exported,
		...(bindings ? { bindings } : {}),
	};
	const indexKey = `${outPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(catalog, null, '\t'), 'application/json');
	written.add(indexKey);

	const existing = await listAllKeys(outPrefix);
	await deleteObjects(existing.filter((k) => !written.has(k)));

	return { catalog };
}

/**
 * What the last export did to each file, so a re-export does not re-encode audio that has not
 * changed. Essential rather than nice: this exporter runs on the per-boot `/api/editor/runtime`
 * assemble, which is already close to the client's 90 s budget
 * (`gotcha_runtime_assemble_outruns_client_timeout`) — re-encoding a music bed on every boot
 * would blow it outright.
 *
 * It lives beside the SOURCES (`sounds/_transcode.json`), deliberately not under `deploy/`: the
 * deploy subtree is mirrored verbatim into a game's `static/assets/` by `pull-project-assets`,
 * so a cache kept there would ship inside every build, and the deploy prune would delete it.
 *
 * An entry is recorded even when the file was copied VERBATIM (`capped: false`) — otherwise a
 * track that ffmpeg cannot beat would be re-encoded on every single export forever.
 */
interface TranscodeCacheEntry {
	/** Source ETag + size: the pair that says "this upload is unchanged". */
	etag: string | null;
	size: number;
	/** The cap in force when this ran — lower `SOUND_MAX_KBPS` and everything re-encodes. */
	kbps: number;
	/** False when the re-encode was not a win and the source shipped unchanged. */
	capped: boolean;
}

interface TranscodeCache {
	rev: number;
	files: Record<string, TranscodeCacheEntry>;
}

/** Bump to force every project to re-encode — the `KTX2_ENCODER_REVISION` lesson: a cache keyed
 *  only on the SOURCE says nothing about how the output was made, so without this a change to the
 *  encoder settings never reaches a library whose audio has not changed. */
const TRANSCODE_REVISION = 1;

const transcodeCacheKey = (clientKey: string, projectKey: string) =>
	`${SUB.sounds(clientKey, projectKey)}/_transcode.json`;

async function loadTranscodeCache(clientKey: string, projectKey: string): Promise<TranscodeCache> {
	const empty: TranscodeCache = { rev: TRANSCODE_REVISION, files: {} };
	try {
		const txt = await getObjectText(transcodeCacheKey(clientKey, projectKey));
		if (!txt) return empty;
		const parsed = JSON.parse(txt) as TranscodeCache;
		// A stale revision is dropped WHOLE rather than migrated — it only ever costs one re-encode.
		if (parsed?.rev !== TRANSCODE_REVISION || !parsed.files) return empty;
		return parsed;
	} catch {
		return empty;
	}
}

async function saveTranscodeCache(
	clientKey: string,
	projectKey: string,
	cache: TranscodeCache,
): Promise<void> {
	// Never fatal: the cache is an optimisation, and losing it costs one re-encode, not a build.
	await putObjectText(
		transcodeCacheKey(clientKey, projectKey),
		JSON.stringify(cache),
		'application/json',
	).catch(() => {});
}

/**
 * Put one library file into `deploy/sounds/`, capped to {@link ENV.SOUND_MAX_KBPS} when that is
 * a real win. False when the source is missing (an orphaned doc row).
 *
 * The verbatim path is a SERVER-SIDE copy — no bytes travel through this process, which is what
 * keeps peak memory flat whatever the library weighs. Only a file that is actually being
 * re-encoded is pulled in, one at a time.
 */
async function exportOneFile(
	srcKey: string,
	destKey: string,
	file: string,
	cache: TranscodeCache,
): Promise<boolean> {
	const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
	if (!ENV.SOUND_TRANSCODE || !isTranscodableAudio(ext)) return copyObject(srcKey, destKey);

	const head = await headObject(srcKey);
	if (!head) return false;

	const kbps = ENV.SOUND_MAX_KBPS;
	const seen = cache.files[file];
	if (
		seen &&
		seen.etag === head.etag &&
		seen.size === head.size &&
		seen.kbps === kbps &&
		(await objectExists(destKey))
	) {
		return true; // Unchanged upload, same cap, output still there — leave it alone.
	}

	const src = await getObjectBytes(srcKey);
	if (!src) return false;
	const capped = await capAudioBitrate(src.body, ext, kbps);
	const ok = capped
		? await putObjectBytes(destKey, capped, src.contentType).then(
				() => true,
				() => false,
			)
		: await copyObject(srcKey, destKey);
	if (!ok) return false;

	cache.files[file] = { etag: head.etag, size: head.size, kbps, capped: !!capped };
	return true;
}

/**
 * The project's effective choices, migrated on the fly from the OLD homes when this project has not
 * saved them here yet.
 *
 * Whole-doc, never per-field: if the sounds doc carries a `bindings` block it is the entire answer,
 * exactly as {@link effectiveSoundBindings} defines it. A per-field merge would make a deliberately
 * cleared cue reappear from the config doc that still holds it, which is the failure mode this
 * migration exists to end rather than reproduce.
 *
 * A failed read of either legacy doc is swallowed: it can only ever have made the fallback richer,
 * and the whole export must not die because a config doc is momentarily unreadable. Returns
 * `undefined` when nothing anywhere binds a sound, so an untouched project ships no block at all.
 */
async function resolveBindings(
	clientKey: string,
	projectKey: string,
	doc: Awaited<ReturnType<typeof loadSoundsDoc>>,
): Promise<SoundBindings | undefined> {
	if (doc?.bindings) return doc.bindings;

	const [config, symbols] = await Promise.all([
		loadGameConfigDoc(clientKey, projectKey).catch(() => null),
		loadSymbolsDoc(clientKey, projectKey).catch(() => null),
	]);

	const migrated = effectiveSoundBindings(doc, {
		configSounds: config?.sounds,
		symbolSounds: (symbols as { symbolSounds?: unknown } | null)?.symbolSounds,
		anticipation: (symbols as { anticipation?: unknown } | null)?.anticipation,
		winLevels: config?.winLevels,
	});
	return Object.keys(migrated).length ? migrated : undefined;
}
