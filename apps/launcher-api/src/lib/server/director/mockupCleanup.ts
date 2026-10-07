import { listClients } from '../clients';
import { UNASSIGNED_CLIENT, r2Slug } from '../projectPaths';
import { withProjectKeyLock } from '../projectKeyLock';
import { listDeletedProjects, listProjects, projectInFolder } from '../projects';
import { deleteObject, deleteObjects, listAllObjects, listFolder, type ListedObject } from '../r2';
import {
	MockupError,
	directorPrefix,
	loadMockupsDoc,
	mockupImageKey,
	mockupsDocKey,
	sealMockupsDoc,
} from './mockups';
import { listRunProjectKeys, runInFolder } from './store';

/**
 * Clearing a PENDING key's mockups (ADR-0005 storage): the doc, every original and any crops of a
 * key that never became a project, which would otherwise sit in R2 forever. Two triggers:
 *
 *  - the uploader removes the last image of a pending key (`POST /api/director/mockups` remove);
 *  - Admin › Settings › Invisible Director sweeps every pending key with nothing written for the
 *    retention (the app setting `DIRECTOR_PENDING_MOCKUP_DAYS`, default 14). The worker has no R2
 *    access, so the sweep is the launcher's.
 *
 * Everything here is per R2 FOLDER, not per key: a project's folder is `r2Slug(key)` (`-` → `_`,
 * cut to 60 characters), so `my-game` and `my_game` share one. A folder is pending only when NO
 * project row (live or deleted) and NO Director run has a key that slugs to it.
 *
 * Never a real project's files: a folder is cleared only under `withProjectKeyLock` (keyed by the
 * slug), after re-checking both. Project creation and the run create take the same lock, so a
 * folder cannot become a project's or a run's between the check and the delete. Uploads do not
 * take the lock; they are kept by the doc's CAS instead — see {@link clearPendingMockups}.
 *
 * Only `director/mockups.json`, `director/mockups/` and `director/crops/` are touched; nothing else
 * under the key, and nothing outside `director/`.
 */

/**
 * An original the doc does not list is deleted only when it is older than this: an upload writes
 * its original first and records it in the doc a moment later, and that moment must not read as a
 * stray.
 */
export const STRAY_GRACE_MS = 10 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

export type KeptReason =
	/** A `projects` row (live or deleted) has a key in this folder. */
	| 'project_exists'
	/** A Director run names a key in this folder. */
	| 'run_exists'
	/** Something under the key is newer than the sweep's cutoff. */
	| 'fresh'
	/** The emptied doc lists an image again: an upload landed. */
	| 'in_use'
	/** The doc moved between the listing and the seal. */
	| 'changed'
	/** The doc is not valid JSON; left for a person to look at. */
	| 'bad_doc'
	/** Nothing to clear. */
	| 'empty';

/** How the Admin banner names each reason a folder was kept. */
export const KEPT_REASON_WORDS: Record<KeptReason, string> = {
	project_exists: 'a project uses it',
	run_exists: 'a Director run names it',
	fresh: 'uploaded too recently',
	in_use: 'it has mockups again',
	changed: 'it changed while clearing',
	bad_doc: 'its mockups.json is not valid JSON',
	empty: 'nothing to clear',
};

export type ClearOutcome =
	{ cleared: true; deleted: number } | { cleared: false; reason: KeptReason };

const mockupObjectPrefixes = (client: string, project: string) => [
	`${directorPrefix(client, project)}/mockups/`,
	`${directorPrefix(client, project)}/crops/`,
];

const stripQuotes = (etag: string) => etag.replace(/"/g, '');

/**
 * Written at or before `cutoff`. A listing that carries no `LastModified` (0) is NOT old: an
 * object of unknown age is kept.
 */
const writtenBy = (o: ListedObject, cutoff: number) =>
	o.lastModified > 0 && o.lastModified <= cutoff;

/** The doc, originals and crops under one folder, as listed now. */
async function listMockupObjects(client: string, project: string): Promise<ListedObject[]> {
	const docKey = mockupsDocKey(client, project);
	const prefixes = mockupObjectPrefixes(client, project);
	return (await listAllObjects(`${directorPrefix(client, project)}/`)).filter(
		(o) => o.key === docKey || prefixes.some((p) => o.key.startsWith(p)),
	);
}

/**
 * Clear one pending key's mockups (`project` is a key or its folder slug; both name the folder).
 * Without `olderThan` it is the emptied-doc path: the doc must list no images. With it (epoch ms)
 * it is the sweep: nothing under the key may be newer.
 *
 * Under the key's lock: re-check no project and no run — two targeted queries on the lock's own
 * `tx`, so a holder never needs a second pooled connection — list, then seal the doc with a CAS on the
 * ETag just read (`sealMockupsDoc`), delete it, and delete the listed originals and crops. An
 * upload racing this either landed before the seal — the seal's CAS fails and nothing is deleted —
 * or after it, when it re-reads, waits out the delete and creates a new doc; its original has a
 * new id and was written after the listing (the sweep refuses a key with anything newer than the
 * cutoff, and the emptied path keeps strays younger than {@link STRAY_GRACE_MS}), so it is never
 * among the deleted.
 */
export async function clearPendingMockups(
	client: string,
	project: string,
	opts: { olderThan?: number; now?: number } = {},
): Promise<ClearOutcome> {
	const kept = (reason: KeptReason): ClearOutcome => ({ cleared: false, reason });
	const slug = r2Slug(project);
	return withProjectKeyLock(slug, async (tx) => {
		if (await projectInFolder(slug, { db: tx })) return kept('project_exists');
		if (await runInFolder(slug, tx)) return kept('run_exists');

		const docKey = mockupsDocKey(client, project);
		const prefixes = mockupObjectPrefixes(client, project);
		const listed = await listMockupObjects(client, project);
		if (listed.length === 0) return kept('empty');
		const { olderThan } = opts;
		const sweep = olderThan !== undefined;
		if (sweep && !listed.every((o) => writtenBy(o, olderThan))) return kept('fresh');

		let loaded: Awaited<ReturnType<typeof loadMockupsDoc>>;
		try {
			loaded = await loadMockupsDoc(client, project);
		} catch (e) {
			if (e instanceof MockupError) return kept('bad_doc');
			throw e;
		}
		const { doc, etag } = loaded;
		const byKey = new Map<string, ListedObject>(listed.map((o) => [o.key, o]));
		if (!sweep && doc.images.length > 0) return kept('in_use');
		if (etag !== null) {
			// The doc the seal replaces must be the one the listing aged: listed, unchanged since, and
			// naming no original the listing did not see.
			const listedDoc = byKey.get(docKey);
			if (
				sweep &&
				(!listedDoc ||
					(listedDoc.etag && listedDoc.etag !== stripQuotes(etag)) ||
					doc.images.some((img) => !byKey.has(mockupImageKey(client, project, img.file))))
			) {
				return kept('changed');
			}
			if (!(await sealMockupsDoc(client, project, etag))) return kept('changed');
		}

		const now = opts.now ?? Date.now();
		const docFiles = new Set(doc.images.map((img) => mockupImageKey(client, project, img.file)));
		const doomed = listed
			.filter(
				(o) =>
					o.key !== docKey &&
					(o.key.startsWith(prefixes[1]) ||
						docFiles.has(o.key) ||
						writtenBy(o, now - STRAY_GRACE_MS)),
			)
			.map((o) => o.key);
		if (etag === null && doomed.length === 0) return kept('empty');
		if (etag !== null) await deleteObject(docKey);
		await deleteObjects(doomed);
		return { cleared: true, deleted: doomed.length + (etag !== null ? 1 : 0) };
	});
}

export interface SweepReport {
	cleared: { client: string; project: string; deleted: number }[];
	kept: { client: string; project: string; reason: KeptReason }[];
}

/** Every project folder directly under the client folder `client` (a slug). */
async function projectFolders(client: string): Promise<string[]> {
	const out: string[] = [];
	let token: string | undefined;
	do {
		const page = await listFolder(`${client}/`, token);
		for (const folder of page.folders) out.push(folder.slice(client.length + 1, -1));
		token = page.nextToken;
	} while (token);
	return out;
}

/**
 * The age sweep: every project folder under a known client's folder (and `unassigned`) that no
 * project row slugs to, cleared when nothing under its mockups was written for `days` days.
 *
 * The project and run keys are read ONCE, outside any lock, and each folder is pre-filtered there
 * too — a project's folder is skipped unlisted; one with no mockup objects is skipped; one a run
 * names, or with anything newer than the cutoff, is reported kept — so the lock and its narrow
 * re-check ({@link clearPendingMockups}) are taken only for real candidates. The pre-filter only
 * picks candidates: a project or run that appears after it is still caught under the lock.
 * Folders are reported by their slugs; ones with nothing to clear are not reported.
 */
export async function sweepPendingMockups(days: number, now = Date.now()): Promise<SweepReport> {
	const olderThan = now - days * DAY_MS;
	const taken = new Set(
		[...(await listProjects()), ...(await listDeletedProjects())].map((p) => r2Slug(p.key)),
	);
	const withRun = new Set((await listRunProjectKeys()).map(r2Slug));
	const clients = new Set(
		[UNASSIGNED_CLIENT, ...(await listClients()).map((c) => c.key)].map(r2Slug),
	);
	const report: SweepReport = { cleared: [], kept: [] };
	const keep = (client: string, project: string, reason: KeptReason) =>
		reason !== 'empty' && report.kept.push({ client, project, reason });
	for (const client of clients) {
		for (const project of await projectFolders(client)) {
			if (taken.has(project)) continue;
			const listed = await listMockupObjects(client, project);
			if (listed.length === 0) continue;
			if (withRun.has(project)) {
				keep(client, project, 'run_exists');
				continue;
			}
			if (!listed.every((o) => writtenBy(o, olderThan))) {
				keep(client, project, 'fresh');
				continue;
			}
			const outcome = await clearPendingMockups(client, project, { olderThan, now });
			if (outcome.cleared) report.cleared.push({ client, project, deleted: outcome.deleted });
			else keep(client, project, outcome.reason);
		}
	}
	return report;
}
