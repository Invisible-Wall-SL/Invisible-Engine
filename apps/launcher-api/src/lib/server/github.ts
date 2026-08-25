import { ENV } from './env';

/**
 * One authenticated transport for the GitHub REST calls the ComfyUI panel makes —
 * dispatching the pod-image build (`podImage.ts`) and editing the baked node list
 * (`nodeList.ts`). Extracted when the second caller appeared, rather than letting each grow
 * its own copy of the auth, the timeout and the error wording.
 *
 * Deliberately NOT shared with `engineSource.ts`: that one is a read-only path with its own
 * token and its own "any failure just disables the feature" contract, and merging the two
 * would drag a write-capable credential into it.
 */

const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 8_000;

/**
 * The credential, preferring a dedicated one and falling back to the git clone token — the
 * same best-effort shape `engineSource.ts` already uses.
 *
 * Whether the fallback WORKS depends on what kind of token it is, and the distinction is
 * easy to get wrong: cloning and pushing is GitHub's `contents` permission, while
 * dispatching a workflow is `actions`. A CLASSIC PAT's broad `repo` scope covers both. A
 * FINE-GRAINED PAT needs each ticked separately on this repo, and one scoped to the game
 * repos will have neither.
 *
 * So it is tried rather than assumed: if it works, no new secret is needed; if it does not,
 * GitHub answers 403 and the panel shows that sentence verbatim, which is a better way to
 * learn a token's scopes than reasoning about them.
 *
 * Least privilege still prefers a dedicated fine-grained `GITHUB_ACTIONS_TOKEN` scoped to
 * this repo: the fallback runs these paths with a credential that can also push game-repo
 * code, which is wider than the job needs.
 */
export function githubToken(): string {
	return ENV.GITHUB_ACTIONS_TOKEN || ENV.GIT_CLONE_TOKEN;
}

/** Is there any credential at all? Callers render an explanation rather than an error. */
export function githubConfigured(): boolean {
	return !!githubToken();
}

/**
 * A GitHub API call. Returns the `Response`, or a STRING when the request could not be made
 * at all (no token, network, timeout) — so a caller can surface one message either way
 * without a try/catch of its own. Never throws.
 */
export async function githubFetch(path: string, init?: RequestInit): Promise<Response | string> {
	const token = githubToken();
	if (!token) return 'Neither GITHUB_ACTIONS_TOKEN nor GIT_CLONE_TOKEN is set on the launcher.';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetch(`${GITHUB_API}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'invisible-launcher',
				...(init?.body ? { 'content-type': 'application/json' } : {}),
			},
			signal: controller.signal,
		});
	} catch (err) {
		return err instanceof Error ? err.message : 'GitHub request failed.';
	} finally {
		clearTimeout(timer);
	}
}

/** GitHub's error body is usually the most useful sentence available — surface it. */
export async function githubError(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	const message = `GitHub ${res.status}: ${body?.message ?? res.statusText}`;
	// 403 is almost always one thing, and naming it saves a scope hunt: the token can reach
	// the repo but lacks the permission. A classic PAT gets both via `repo`; a fine-grained
	// one needs Actions (to build) and Contents: write (to edit the node list) ticked for
	// this repository specifically.
	if (res.status === 403 && !ENV.GITHUB_ACTIONS_TOKEN) {
		return `${message} — the fallback GIT_CLONE_TOKEN lacks that permission here. Set GITHUB_ACTIONS_TOKEN to a token with Actions and Contents write on this repo.`;
	}
	return message;
}
