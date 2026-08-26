import type { SoundCatalog, SoundCatalogEntry } from 'engine-layout';
import { soundCatalogEntries } from 'engine-layout';
import { SUB, soundFileKey } from './projectPaths';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';
import { loadSoundsDoc } from './soundsStorage';

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

	const catalog: SoundCatalog = { prefix: EXPORT_SUBTREE, sounds: exported };
	const indexKey = `${outPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(catalog, null, '\t'), 'application/json');
	written.add(indexKey);

	const existing = await listAllKeys(outPrefix);
	await deleteObjects(existing.filter((k) => !written.has(k)));

	return { catalog };
}
