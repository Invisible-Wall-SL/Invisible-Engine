import { type CinematicDoc, listCinematics, loadCinematic } from './cinematicStorage';
import { SUB } from './projectPaths';
import { deleteObjects, getObjectText, listAllObjects, putObjectText } from './r2';
import { resolveProjectCinematic } from './sharedCinematics';

/**
 * Export a project's cinematics into the game-loadable `deploy/` subtree — the rule-8 step that
 * turns "it plays in /rigger" into "it ships". Mirrors `flowV2Export.ts` (a pure-JSON export with
 * no binary assets of its own).
 *
 *   <client>/<project>/cinematics/<id>.json        ← authored (saved by /api/cinematics/save)
 *   _shared/cinematics/<id>.v<N>.json              ← what a linked one plays (resolved on load)
 *   <client>/<project>/deploy/cinematics/<id>.json ← exported (this writes it)
 *
 * `buildRuntimeBundle` calls this via `ensureDeployExports` and embeds the returned docs in the
 * bundle as `cinematics`; the game reads them via `bakedCinematics()`. A project with no
 * cinematics embeds nothing, so the runtime stays inert (parity). Idempotent — re-running
 * converges, and cinematics deleted since the last export are pruned from `deploy/`.
 *
 * A cinematic carries NO art of its own, but it DOES reference rigs. Those rigs are not in the
 * scene doc, so the editor-art export's static walk cannot see them — see {@link cinematicRigNames},
 * which seeds that walk. Without it a cinematic would ship as a document referencing rig bundles
 * the game never loaded: the classic "renders in the tool, blank in the game" trap rule 8 exists
 * to prevent.
 */

export interface CinematicExportIndex {
	/** Exported cinematics, or undefined when the project authored none (parity). */
	cinematics?: CinematicDoc[];
}

/** The authored cinematics; `partial` when one could not be read (the export then prunes nothing). */
export type AuthoredCinematics = CinematicDoc[] & { partial?: true };

/** A cinematic is worth shipping once it has at least one actor — an empty shell drives nothing. */
const isAuthored = (doc: CinematicDoc): boolean =>
	Array.isArray(doc.stage?.cast) && doc.stage.cast.length > 0;

/**
 * The rig BUNDLE NAMES a set of cinematics reference, for seeding `exportEditorArt`.
 *
 * Reads `cast[].rigFolder` — the rig's folder under `<project>/spines/`, which IS the bundle name
 * the game registers. Deliberately NOT `cast[].rigId`: that is a contiguous array position
 * reassigned on every skeleton scan (`rigIndex.ts`), so it identifies nothing stable.
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

/**
 * Load every authored cinematic in the project (used by both the export and the art seed). A link
 * to a SHARED timeline (`_shared/cinematics/`, Rive plan Phase 9d) is resolved here against the
 * version it pins, so the bundle carries the shared content under the project's id — a normal
 * timeline the game plays like any other — and the art seed sees its rigs. A link whose shared
 * version is gone ships nothing (its own stub has no actors), never a half-built doc.
 */
export async function loadAuthoredCinematics(
	clientKey: string,
	projectKey: string,
): Promise<AuthoredCinematics> {
	const out: AuthoredCinematics = [];
	let rows: Awaited<ReturnType<typeof listCinematics>>;
	try {
		rows = await listCinematics(clientKey, projectKey);
	} catch (e) {
		// Cinematics are additive — a listing failure must never break the whole publish.
		console.error('[cinematicExport] could not list the cinematics:', e);
		out.partial = true;
		return out;
	}
	for (const row of rows) {
		try {
			const { doc: stored } = await loadCinematic(clientKey, projectKey, row.id);
			let doc: CinematicDoc | null;
			try {
				doc = stored && (await resolveProjectCinematic(stored));
			} catch (e) {
				// The shared copy could not be READ (not "is gone", which resolves to null): ship what
				// shipped last rather than let the export prune it from `deploy/`.
				console.error(`[cinematicExport] could not resolve shared link "${row.id}":`, e);
				doc = await lastShipped(clientKey, projectKey, row.id);
			}
			if (doc && isAuthored(doc)) out.push(doc);
		} catch (e) {
			console.error(`[cinematicExport] could not load "${row.id}":`, e);
			out.partial = true;
		}
	}
	return out;
}

/** The copy of `id` the last export shipped, or null. A read failure throws. */
async function lastShipped(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<CinematicDoc | null> {
	const text = await getObjectText(`${SUB.deploy(clientKey, projectKey)}/cinematics/${id}.json`);
	if (!text) return null;
	try {
		return JSON.parse(text) as CinematicDoc;
	} catch {
		return null;
	}
}

/**
 * `docs` is passed in rather than re-loaded because the caller must load them FIRST anyway — the
 * editor-art export needs `cinematicRigNames(docs)` as a seed, and it runs in the same batch.
 */
export async function exportCinematics(
	clientKey: string,
	projectKey: string,
	docs: AuthoredCinematics,
): Promise<CinematicExportIndex> {
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/cinematics/`;

	// Prune anything previously deployed that is no longer authored, so deleting a cinematic in the
	// tool actually removes it from the shipped set instead of leaving a stale copy behind. Never
	// after a PARTIAL load: a timeline that failed to read is not a deleted one.
	if (!docs.partial) {
		const keep = new Set(docs.map((d) => `${deployPrefix}${d.id}.json`));
		const stale = (await listAllObjects(deployPrefix))
			.map((o) => o.key)
			.filter((k) => !keep.has(k));
		if (stale.length) await deleteObjects(stale);
	}

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
