/**
 * "Release pending" signal (C2) for the engine deploy pill on the launcher home.
 *
 * Compares the commit stamped in the LIVE runtime bundle's `release.json` (the deployed engine)
 * against the engine repo's current `main` HEAD, and flags when `main` carries un-released ENGINE
 * changes (`apps/lines/` or `packages/`) ahead of the deployed bundle. A merge to `main` already
 * auto-releases, so this pill just surfaces the gap while that release is in flight / owed.
 *
 * Graceful degradation is the hard requirement: with no token (or ANY fetch error / non-2xx /
 * timeout), `enginePending` returns `null`, which the UI must treat as indistinguishable from
 * "all good" (the pill stays green) — it must NEVER surface a scary state on our own outage.
 */
import { ENV } from './env';

export interface EnginePending {
	pending: boolean;
	/** Commits on `main` past the base that touch engine paths — not every commit (docs, launcher). */
	aheadBy: number;
	mainCommit: string;
}

// GitHub compare payload — only the fields we read.
interface GitHubCompare {
	status?: 'identical' | 'ahead' | 'behind' | 'diverged';
	ahead_by?: number;
	files?: { filename?: string }[];
	commits?: { sha?: string }[];
}

/** Prefer the dedicated read token; fall back to the game-repo clone token as a convenience. */
function readToken(): string {
	return ENV.GITHUB_ENGINE_READ_TOKEN || ENV.GIT_CLONE_TOKEN || '';
}

// Paths whose changes mean the runtime bundle may be behind (vs a docs/launcher-only merge).
const ENGINE_PATHS = ['apps/lines', 'packages'];

function touchesEngine(files: { filename?: string }[]): boolean {
	return files.some(
		(f) => !!f.filename && ENGINE_PATHS.some((p) => f.filename!.startsWith(`${p}/`)),
	);
}

// Small in-memory cache so the per-navigation `(app)` layout load doesn't hammer GitHub's
// 5000/hr authed limit. Nulls are cached too (shorter TTL) so an outage doesn't retry every request.
const CACHE = new Map<string, { value: EnginePending | null; expires: number }>();
const OK_TTL_MS = 60_000;
const NULL_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 4_000;

/**
 * `deployedCommit` is the newest commit proven to build the live bytes: the release's own commit,
 * or a later one whose release run found the bundle unchanged (`checkedCommit` on `release.json`).
 * Comparing from the release commit alone flagged every merge since as pending, even ones the
 * release job had already proven never reach this runtime.
 *
 * Returns `null` (feature unavailable — pill stays green) when: no token, `deployedCommit` is
 * falsy or `'unknown'`, or any fetch error / non-2xx / timeout. Otherwise reports whether `main`
 * has engine-touching commits ahead of it.
 */
export async function enginePending(deployedCommit: string): Promise<EnginePending | null> {
	if (!deployedCommit || deployedCommit === 'unknown') return null;
	const token = readToken();
	if (!token) return null;

	const cached = CACHE.get(deployedCommit);
	if (cached && cached.expires > Date.now()) return cached.value;

	const value = await compare(deployedCommit, token);
	CACHE.set(deployedCommit, {
		value,
		expires: Date.now() + (value ? OK_TTL_MS : NULL_TTL_MS),
	});
	return value;
}

async function compare(deployedCommit: string, token: string): Promise<EnginePending | null> {
	const repo = ENV.GITHUB_ENGINE_REPO;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	const get = (path: string) =>
		fetch(`https://api.github.com/repos/${repo}/${path}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'invisible-launcher',
			},
			signal: controller.signal,
		});
	try {
		const res = await get(`compare/${deployedCommit}...main`);
		if (!res.ok) return null;
		const data = (await res.json()) as GitHubCompare;

		if (data.status === 'identical') {
			return { pending: false, aheadBy: 0, mainCommit: deployedCommit };
		}

		const files = data.files ?? [];
		const commits = data.commits ?? [];
		const mainCommit = commits.at(-1)?.sha ?? deployedCommit;
		const pending = touchesEngine(files);
		return { pending, aheadBy: pending ? await engineCommits(get, commits) : 0, mainCommit };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * How many of the compared commits touch an engine path. The compare payload has no per-commit
 * files, so this lists `main`'s recent commits per path and keeps those inside the compare range.
 * A failed listing gives 0 — the pill then shows "Release pending" with no count, never a wrong one.
 */
async function engineCommits(
	get: (path: string) => Promise<Response>,
	commits: { sha?: string }[],
): Promise<number> {
	const inRange = new Set(commits.map((c) => c.sha).filter((sha): sha is string => !!sha));
	const hits = new Set<string>();
	for (const path of ENGINE_PATHS) {
		const res = await get(`commits?sha=main&path=${path}&per_page=100`);
		if (!res.ok) return 0;
		for (const c of (await res.json()) as { sha?: string }[])
			if (c.sha && inRange.has(c.sha)) hits.add(c.sha);
	}
	return hits.size;
}
