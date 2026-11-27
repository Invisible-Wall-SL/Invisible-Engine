import { error } from '@sveltejs/kit';
import { createKeyedMutex } from './concurrency';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import { behindMain, forgetChanges, isOnHold, readPull, repo } from './pipelineChanges';
import { ManifestMergeRefusal, mergeOverManifests } from './pipelineManifestMerge';

/**
 * Update from main (ADR-0015 §1): `PUT /pulls/{n}/update-branch` as the App, pinned to the head the
 * page showed with `expected_head_sha`. GitHub makes the merge commit; there is nothing to choose.
 * A conflict is resolved here only when the runtime-bytes manifests are the only files both sides
 * changed (`mergeOverManifests`): the launcher builds that merge itself, keeps main's manifests and
 * re-records them from CI. Any other conflict is a refusal naming the files, not something to
 * resolve (that is ADR-0015's Resolve conflict). The App has no `workflows` permission, so a merge
 * that brings in `main`'s own workflow change may be refused by GitHub: that refusal is named, with
 * the way out (GitHub's own Update branch button, which acts as the person).
 */

export type UpdateCode =
	'head_moved' | 'conflict' | 'workflow_refused' | 'on_hold' | 'up_to_date' | 'not_clean';

/** GitHub's own words are kept in the answer, this long at most. */
export const GITHUB_MESSAGE_CAP = 300;

export const HEAD_MOVED_TEXT = 'The branch moved; reload';
export const CONFLICT_TEXT = 'GitHub could not merge main in: this branch conflicts with main.';
export const MANIFESTS_MERGED_TEXT = (runtimes: string[]): string =>
	`Main merged in. Only the runtime-bytes manifests conflicted (${runtimes.join(', ')}): main's are kept, and the pipeline re-records them from CI's build when its runtime-bytes check fails.`;
export const WORKFLOW_REFUSED_TEXT =
	"GitHub won't let the pipeline's App push a merge that brings in main's workflow change. Open the pull request on GitHub and click its own Update branch, which acts as you.";

/** A refusal: always a 409, with a code to tell the cases apart and, for the workflow case, the
 *  pull request to go to. `githubMessage` is GitHub's sentence as it came, capped. */
export class UpdateRefusal extends Error {
	readonly status = 409;
	constructor(
		message: string,
		readonly code: UpdateCode,
		readonly githubMessage: string | null = null,
		readonly url: string | null = null,
	) {
		super(message);
		this.name = 'UpdateRefusal';
	}
}

export const capGithubMessage = (message: string): string =>
	message.length > GITHUB_MESSAGE_CAP ? `${message.slice(0, GITHUB_MESSAGE_CAP - 1)}…` : message;

/**
 * What GitHub's refusal of `update-branch` means, or `null` for an answer that is not one of the
 * three the page knows. A mention of a workflow file or the `workflows` permission wins over any
 * status; the moved head and the conflict are 422s.
 */
export function refusalOfUpdate(
	status: number,
	githubMessage: string,
	prUrl: string,
): UpdateRefusal | null {
	if (status < 400) return null;
	const capped = capGithubMessage(githubMessage);
	if (/\bworkflows?\b/i.test(githubMessage)) {
		return new UpdateRefusal(WORKFLOW_REFUSED_TEXT, 'workflow_refused', capped, prUrl);
	}
	if (status === 422 && /expected head sha|head sha|head ref|head branch/i.test(githubMessage)) {
		return new UpdateRefusal(HEAD_MOVED_TEXT, 'head_moved', capped);
	}
	if (status === 422 && /conflict/i.test(githubMessage)) {
		return new UpdateRefusal(CONFLICT_TEXT, 'conflict', capped);
	}
	return null;
}

export interface UpdateResult {
	number: number;
	headSha: string;
	/** `github`: GitHub's `update-branch`. `manifests`: the launcher's merge over a runtime-bytes
	 *  conflict, which CI then re-records. */
	how: 'github' | 'manifests';
	/** What GitHub answered (it merges in the background: 202); the launcher's own sentence for
	 *  `manifests`. */
	githubMessage: string;
	/** The merge commit, for `manifests`. */
	commit?: string;
	/** The runtimes whose manifests were taken from main, for `manifests`. */
	runtimes?: string[];
}

/** Two clicks on one change at once would ask GitHub twice from the same head. */
const updating = createKeyedMutex();

/**
 * Ask GitHub to merge `main` into the change's branch. `headSha` is the head the page showed. The
 * caller has passed the `pipelineMerge` gate. Everything the launcher can know before asking is a
 * 409 here (closed, on hold, head moved, conflict, still computing, not behind); GitHub's own
 * refusal goes through `refusalOfUpdate`, and anything else it says is a `GithubAppError`.
 */
export async function updateFromMain(
	input: { number: number; headSha: string },
	app: GithubApp = githubApp,
): Promise<UpdateResult> {
	const { number, headSha } = input;
	return updating(String(number), async () => {
		const pull = await readPull(number, app);
		if (pull.state !== 'open') throw error(409, `#${number} is not open.`);
		if (isOnHold(pull)) {
			throw new UpdateRefusal(`#${number} is on hold: resume it first.`, 'on_hold');
		}
		if (pull.head.sha !== headSha) throw new UpdateRefusal(HEAD_MOVED_TEXT, 'head_moved');
		if (pull.mergeable_state === 'dirty') return overManifests(number, headSha, pull, app);
		if (pull.mergeable !== true) {
			throw new UpdateRefusal(
				'GitHub is still working out whether this change merges cleanly; try again in a moment.',
				'not_clean',
			);
		}
		if ((await behindMain(app, headSha)) === 0) {
			throw new UpdateRefusal(`#${number} is not behind main.`, 'up_to_date');
		}
		const res = await app.fetch(`/repos/${repo()}/pulls/${number}/update-branch`, {
			method: 'PUT',
			body: JSON.stringify({ expected_head_sha: headSha }),
		});
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		const message = body?.message ?? res.statusText;
		if (!res.ok) {
			throw (
				refusalOfUpdate(res.status, message, pull.html_url) ??
				new GithubAppError(`GitHub ${res.status}: ${capGithubMessage(message)}`, res.status)
			);
		}
		forgetChanges();
		return { number, headSha, how: 'github', githubMessage: capGithubMessage(message) };
	});
}

async function overManifests(
	number: number,
	headSha: string,
	pull: { head: { ref: string }; html_url: string },
	app: GithubApp,
): Promise<UpdateResult> {
	let merged: Awaited<ReturnType<typeof mergeOverManifests>>;
	try {
		merged = await mergeOverManifests({ number, headSha, branch: pull.head.ref }, app);
	} catch (err) {
		if (err instanceof ManifestMergeRefusal) {
			throw new UpdateRefusal(`${CONFLICT_TEXT} ${err.message}`, 'conflict');
		}
		throw err;
	}
	if ('refused' in merged) {
		const res = merged.refused;
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		const message = body?.message ?? res.statusText;
		if (res.status === 422 && /fast.forward/i.test(message)) {
			throw new UpdateRefusal(HEAD_MOVED_TEXT, 'head_moved', capGithubMessage(message));
		}
		throw (
			refusalOfUpdate(res.status, message, pull.html_url) ??
			new GithubAppError(`GitHub ${res.status}: ${capGithubMessage(message)}`, res.status)
		);
	}
	return {
		number,
		headSha,
		how: 'manifests',
		githubMessage: MANIFESTS_MERGED_TEXT(merged.runtimes),
		commit: merged.commit,
		runtimes: merged.runtimes,
	};
}
