import { type CinematicDoc, listCinematics, loadCinematic } from './cinematicStorage';
import { SUB } from './projectPaths';
import { deleteObjects, listAllObjects, putObjectText } from './r2';

/**
 * Export a project's cinematics into the game-loadable `deploy/` subtree — the rule-8 step that
 * turns "it plays in /rigger" into "it ships". Mirrors `flowV2Export.ts` (a pure-JSON export with
 * no binary assets of its own).
 *
 *   <client>/<project>/cinematics/<id>.json        ← authored (saved by /api/cinematics/save)
 *   <client>/<project>/deploy/cinematics/<id>.json ← exported (this writes it)
 *
 * `buildRuntimeBundle` calls this via `ensureDeployExports` and embeds the returned docs in the
 * bundle as `cinematics`; the game reads them via `bakedCinematics()`. A project with no
 * cinematics embeds nothing, so the runtime stays inert (parity). Idempotent — re-running
 * converges, and cinematics deleted since the last export are pruned from `deploy/`.
 *
 * A cinematic carries NO art of its own, but it DOES reference rigs. Those rigs are not in the
 * scene doc, so the editor-art export's static walk cannot see them — see {@link cinematicRigNames},
 * which seeds that walk. Without it a cinematic would ship as a document referencing spine bundles
 * the game never loaded: the classic "renders in the tool, blank in the game" trap rule 8 exists
 * to prevent.
 */

export interface CinematicExportIndex {
	/** Exported cinematics, or undefined when the project authored none (parity). */
	cinematics?: CinematicDoc[];
}

/** A cinematic is worth shipping once it has at least one actor — an empty shell drives nothing. */
const isAuthored = (doc: CinematicDoc): boolean =>
	Array.isArray(doc.stage?.cast) && doc.stage.cast.length > 0;

/**
 * The spine BUNDLE NAMES a set of cinematics reference, for seeding `exportEditorArt`.
 *
 * Reads `cast[].rigFolder` — the rig's folder under `<project>/spines/`, which IS the bundle name
 * the game registers. Deliberately NOT `cast[].rigId`: that is a contiguous array position
 * reassigned on every skeleton scan (`spineIndex.ts`), so it identifies nothing stable.
 */
export function cinematicRigNames(docs: CinematicDoc[]): Set<string> {
	const out = new Set<string>();
	for (const doc of docs) {
		for (const cast of doc.stage?.cast ?? []) {
			const folder = (cast as { rigFolder?: unknown }).rigFolder;
			if (typeof folder === 'string' && folder) out.add(folder);
		}
	}
	return out;
}

/** Load every authored cinematic in the project (used by both the export and the art seed). */
export async function loadAuthoredCinematics(
	clientKey: string,
	projectKey: string,
): Promise<CinematicDoc[]> {
	const out: CinematicDoc[] = [];
	try {
		for (const row of await listCinematics(clientKey, projectKey)) {
			const { doc } = await loadCinematic(clientKey, projectKey, row.id);
			if (doc && isAuthored(doc)) out.push(doc);
		}
	} catch {
		// Cinematics are additive — a listing/parse failure must never break the whole publish.
	}
	return out;
}

/**
 * `docs` is passed in rather than re-loaded because the caller must load them FIRST anyway — the
 * editor-art export needs `cinematicRigNames(docs)` as a seed, and it runs in the same batch.
 */
export async function exportCinematics(
	clientKey: string,
	projectKey: string,
	docs: CinematicDoc[],
): Promise<CinematicExportIndex> {
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/cinematics/`;

	// Prune anything previously deployed that is no longer authored, so deleting a cinematic in the
	// tool actually removes it from the shipped set instead of leaving a stale copy behind.
	const keep = new Set(docs.map((d) => `${deployPrefix}${d.id}.json`));
	const stale = (await listAllObjects(deployPrefix)).map((o) => o.key).filter((k) => !keep.has(k));
	if (stale.length) await deleteObjects(stale);

	if (!docs.length) return {};

	for (const doc of docs) {
		await putObjectText(
			`${deployPrefix}${doc.id}.json`,
			JSON.stringify(doc, null, '\t'),
			'application/json',
		);
	}
	return { cinematics: docs };
}
