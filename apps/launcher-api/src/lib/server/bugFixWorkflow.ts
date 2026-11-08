import { FIX_RUN_WORKFLOW } from '$lib/bugFixRuns';
import { ENV } from './env';
import { githubApp, type GithubApp } from './githubApp';

/**
 * Whether fix runs can run at all (ADR-0013 §11, card 13C landing before 13B): GitHub knows
 * `bug-fix.yml` as an active workflow on the default branch, which is what a dispatch needs. Until
 * it does, the pages hide Start fix: a button that can only fail is not offered. Read from GitHub
 * (Actions read, which the App has) and kept for a minute, so a bug list does not ask on every
 * refresh; an unreachable GitHub or an unset App reads as "not yet" and is kept for 10 seconds.
 */
const READY_MS = 60_000;
const UNKNOWN_MS = 10_000;

let cached: { ready: boolean; until: number } | null = null;

/** Forget the answer (a fixture's, or after the workflow lands). */
export function forgetFixWorkflow(): void {
	cached = null;
}

export async function fixWorkflowReady(
	app: GithubApp = githubApp,
	nowMs = Date.now(),
): Promise<boolean> {
	if (cached && nowMs < cached.until) return cached.ready;
	let ready = false;
	let known = false;
	if (!app.missing()) {
		try {
			const res = await app.fetch(
				`/repos/${ENV.GITHUB_ENGINE_REPO}/actions/workflows/${FIX_RUN_WORKFLOW}`,
			);
			known = res.ok || res.status === 404;
			if (res.ok) {
				const body = (await res.json().catch(() => null)) as { state?: unknown } | null;
				ready = body?.state === 'active';
			}
		} catch {
			known = false;
		}
	}
	cached = { ready, until: nowMs + (known ? READY_MS : UNKNOWN_MS) };
	return ready;
}
