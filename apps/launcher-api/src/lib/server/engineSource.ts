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

// Paths whose changes mean the runtime bundle is actually behind (vs a docs/launcher-only merge).
function touchesEngine(files: { filename?: string }[]): boolean {
	return files.some(
		(f) =>
			!!f.filename && (f.filename.startsWith('apps/lines/') || f.filename.startsWith('packages/')),
	);
}

// Small in-memory cache so the per-navigation `(app)` layout load doesn't hammer GitHub's
// 5000/hr authed limit. Nulls are cached too (shorter TTL) so an outage doesn't retry every request.
const CACHE = new Map<string, { value: EnginePending | null; expires: number }>();
const OK_TTL_MS = 60_000;
const NULL_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Returns `null` (feature unavailable — pill stays green) when: no token, `deployedCommit` is
 * falsy or `'unknown'`, or any fetch error / non-2xx / timeout. Otherwise reports whether `main`
 * has engine-touching commits ahead of the deployed commit.
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
	const url = `https://api.github.com/repos/${repo}/compare/${deployedCommit}...main`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'invisible-launcher',
			},
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const data = (await res.json()) as GitHubCompare;

		if (data.status === 'identical') {
			return { pending: false, aheadBy: 0, mainCommit: deployedCommit };
		}

		const files = data.files ?? [];
		const commits = data.commits ?? [];
		const mainCommit = commits.at(-1)?.sha ?? deployedCommit;
		return {
			pending: touchesEngine(files),
			aheadBy: typeof data.ahead_by === 'number' ? data.ahead_by : 0,
			mainCommit,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
