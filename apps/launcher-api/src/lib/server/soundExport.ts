import type { SoundBindings, SoundCatalog, SoundCatalogEntry } from 'engine-layout';
import { effectiveSoundBindings, soundCatalogEntries } from 'engine-layout';
import { loadGameConfigDoc } from './gameConfigStorage';
import { SUB, soundFileKey } from './projectPaths';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';
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

	for (const entry of soundCatalogEntries(doc)) {
		const destKey = `${outPrefix}${entry.file}`;
		// Server-side copy, verbatim — no bytes travel through this process, which keeps peak memory
		// flat whatever the library weighs. A missing source is skipped rather than fatal: an ORPHANED
		// ENTRY (a doc row whose upload never landed, or whose file was deleted underneath it) must
		// not break the whole export, and advertising it would ship a name that plays nothing.
		if (!(await copyObject(soundFileKey(clientKey, projectKey, entry.file), destKey))) continue;
		written.add(destKey);
		exported.push(entry);
	}

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
