/**
 * What a project OWNS in R2, and which other projects would be caught by deleting it.
 *
 * Split out of `projectPurge.ts` so it reaches nothing but `projectPaths` — no DB, no
 * S3 client, no `$env`. That keeps it runnable in an offline fixture, which matters more
 * here than anywhere else in the app: `build` is a bare `vite build` that strips types
 * without checking them, so an executed assertion is the ONLY thing that proves which
 * keys a purge selects, and a purge is unrecoverable.
 */

import { UNASSIGNED_CLIENT, projectPrefix, r2Slug } from './projectPaths';

/**
 * The two R2 roots a project owns, mirroring `planDuplicate`'s source roots so the two
 * features can never disagree about what a project IS:
 *  - `<client>/<project>/` — the unified project repo (art, docs, deploy, …)
 *  - `editor/<project>/`   — components + component defaults, keyed by project alone
 */
export function projectR2Roots(clientKey: string | null, projectKey: string): string[] {
	return [
		`${projectPrefix(clientKey ?? UNASSIGNED_CLIENT, projectKey)}/`,
		`editor/${r2Slug(projectKey)}/`,
	];
}

/** The `<project>/` path segment, for finding this project's data under ANY client. */
export function projectSlug(projectKey: string): string {
	return r2Slug(projectKey);
}

/**
 * Projects other than `mine` that resolve to one of the SAME R2 roots.
 *
 * This is not paranoia. `r2Slug` maps every non-alphanumeric to `_` and truncates at 60
 * chars, while a project key may contain BOTH `-` and `_`
 * (`^[a-z0-9][a-z0-9_-]{0,63}$`), so `my-game` and `my_game` are two distinct projects
 * sharing ONE prefix — and `editor/<project>/` drops the client segment entirely, so they
 * collide across clients too. Purging either would silently delete the other's work.
 *
 * Tombstoned projects are deliberately included by callers: a deleted project still owns
 * its bytes until someone purges it.
 */
export function collidingProjectKeys(
	mine: { key: string; clientKey: string | null },
	others: readonly { key: string; clientKey: string | null }[],
): string[] {
	const roots = new Set(projectR2Roots(mine.clientKey, mine.key));
	const hits: string[] = [];
	for (const other of others) {
		if (other.key === mine.key) continue;
		if (projectR2Roots(other.clientKey, other.key).some((r) => roots.has(r))) {
			hits.push(other.key);
		}
	}
	return hits;
}
