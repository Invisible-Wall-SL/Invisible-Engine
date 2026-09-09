/**
 * Permanently destroying a project's R2 data — the second, explicit half of the
 * two-step delete (soft-delete hides it; this erases it).
 *
 * Deliberately NOT reachable from the "Delete" button. An accidental click on that
 * button once stranded 2,488 objects / 2.3 GB, and the project was only recoverable
 * because delete had never touched R2. Purge is an action you take on an
 * already-deleted project, having read a count of exactly what it will destroy.
 */

import { eq, ne } from 'drizzle-orm';
import { getDb } from './db';
import { projects } from './db/schema';
import { collidingProjectKeys, projectR2Roots, projectSlug } from './projectRoots';
import { deleteObjects, listAllKeys, listAllObjects, listObjects } from './r2';

export { projectR2Roots } from './projectRoots';

/** The owning client of ANY row, tombstoned or live — a deleted project still has one. */
async function clientKeyFor(projectKey: string): Promise<string | null | undefined> {
	const [row] = await getDb()
		.select({ clientKey: projects.clientKey })
		.from(projects)
		.where(eq(projects.key, projectKey));
	return row ? row.clientKey : undefined;
}

export interface PurgeFootprint {
	roots: string[];
	objects: number;
	bytes: number;
	/** Other project keys sharing one of these roots. NON-EMPTY MEANS DO NOT PURGE. */
	collidesWith: string[];
	/**
	 * Prefixes holding this project's data that the roots DON'T cover — data a purge
	 * would orphan rather than delete. NON-EMPTY MEANS DO NOT PURGE.
	 */
	strayPrefixes: string[];
}

/** Raised when purging would destroy, or orphan, data the roots don't account for. */
export class PurgeUnsafeError extends Error {
	constructor(readonly projectKey: string, readonly reason: string) {
		super(reason);
		this.name = 'PurgeUnsafeError';
	}
}

/** {@link collidingProjectKeys} against every OTHER row, tombstones included. */
export async function findPrefixCollisions(
	projectKey: string,
	clientKey: string | null,
): Promise<string[]> {
	const others = await getDb()
		.select({ key: projects.key, clientKey: projects.clientKey })
		.from(projects)
		.where(ne(projects.key, projectKey));
	return collidingProjectKeys({ key: projectKey, clientKey }, others);
}

/**
 * Prefixes shaped `<anyClient>/<projectSlug>/` that hold objects but are NOT among the
 * roots we are about to delete.
 *
 * The case this exists for: `assignProjectToClient` only updates a DB column — it never
 * moves R2 objects — and `projects.client_key` is `ON DELETE SET NULL`, which fires on
 * tombstoned rows too. So a project created under client `a` and later re-assigned to
 * `b` (or whose client row was deleted) has its data at `a/<slug>/` while its roots now
 * say `b/<slug>/`. Purging would delete an empty prefix, hard-delete the row, and strand
 * the real data forever with no row left to purge it from — precisely the failure this
 * whole feature was built to stop. So we refuse instead.
 */
export async function findStrayProjectPrefixes(
	projectKey: string,
	roots: readonly string[],
): Promise<string[]> {
	const slug = projectSlug(projectKey);
	const known = new Set(roots);
	// One delimited listing at bucket root gives every top-level client prefix.
	const { prefixes: clientPrefixes } = await listObjects('', 1000);

	const stray: string[] = [];
	for (const clientPrefix of clientPrefixes) {
		const candidate = `${clientPrefix}${slug}/`;
		if (known.has(candidate)) continue;
		// MaxKeys 1 — we only need to know whether anything lives there.
		const { keys, prefixes } = await listObjects(candidate, 1);
		if (keys.length > 0 || prefixes.length > 0) stray.push(candidate);
	}
	return stray;
}

/**
 * What a purge would destroy — object count, byte total, and both refusal conditions.
 * Reads the owning client itself so the footprint the dialog shows is derived from the
 * same single source as the delete.
 */
export async function purgeFootprint(projectKey: string): Promise<PurgeFootprint> {
	const clientKey = await clientKeyFor(projectKey);
	if (clientKey === undefined) throw new PurgeUnsafeError(projectKey, 'Unknown project.');

	const roots = projectR2Roots(clientKey, projectKey);
	let objects = 0;
	let bytes = 0;
	for (const root of roots) {
		for (const o of await listAllObjects(root)) {
			objects++;
			bytes += o.size;
		}
	}
	return {
		roots,
		objects,
		bytes,
		collidesWith: await findPrefixCollisions(projectKey, clientKey),
		strayPrefixes: await findStrayProjectPrefixes(projectKey, roots),
	};
}

export interface PurgeResult {
	roots: string[];
	deleted: number;
}

/**
 * Delete every object under the project's roots.
 *
 * Both refusal conditions are re-checked HERE, at the moment of deletion, rather than
 * trusted from the preflight the dialog rendered — the two are separated by however long
 * the dialog sat open, and a re-assignment in between would silently change the answer.
 * The roots are derived once, from the row, and the same array is both guarded and
 * deleted, so the guard cannot check one set of keys while the delete removes another.
 *
 * `deleteObjects` already batches at R2's 1000-key limit and `listAllKeys` paginates, so
 * ~2,500 objects is 3 delete requests. Listing completes for BOTH roots before anything
 * is deleted, so a listing failure cannot leave a half-purged project.
 */
export async function purgeProjectR2(projectKey: string): Promise<PurgeResult> {
	const clientKey = await clientKeyFor(projectKey);
	if (clientKey === undefined) throw new PurgeUnsafeError(projectKey, 'Unknown project.');

	const roots = projectR2Roots(clientKey, projectKey);

	const collisions = await findPrefixCollisions(projectKey, clientKey);
	if (collisions.length > 0) {
		throw new PurgeUnsafeError(
			projectKey,
			`Refusing to purge "${projectKey}": ${collisions.join(', ')} ` +
				`${collisions.length === 1 ? 'shares' : 'share'} its R2 folder, so deleting these ` +
				'files would destroy that project too. Rename one of them first.',
		);
	}

	const stray = await findStrayProjectPrefixes(projectKey, roots);
	if (stray.length > 0) {
		throw new PurgeUnsafeError(
			projectKey,
			`Refusing to purge "${projectKey}": it also has data at ${stray.join(', ')}, which is ` +
				'outside the folders this purge would delete (the project was most likely moved to ' +
				'another client after those files were written). Purging now would strand them with ' +
				'no project left to delete them from. Move or delete them with the FTP Browser first.',
		);
	}

	const keys: string[] = [];
	for (const root of roots) keys.push(...(await listAllKeys(root)));

	await deleteObjects(keys);
	return { roots, deleted: keys.length };
}
