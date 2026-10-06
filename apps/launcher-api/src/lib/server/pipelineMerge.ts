import { error } from '@sveltejs/kit';
import { createKeyedMutex } from './concurrency';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import {
	approverName,
	forgetChanges,
	getChange,
	harnessFilesOf,
	listChanges,
	repo,
	type ChangeDetail,
} from './pipelineChanges';
import {
	findMerge,
	findMergeByRequest,
	listMerges,
	recordMerge,
	revertsOf,
	type MergeApproval,
	type NewMerge,
	type PipelineMerge,
} from './pipelineMerges';

/**
 * Merge and roll back in Invisible Pipeline Changes (ADR-0007 "Merge", "Rollback"). GitHub stays
 * the record: a merge is GitHub's own squash merge of the pull request with the head pinned, so
 * branch protection is the real gate and a head that moved after the checks ran is refused by
 * GitHub itself; a rollback is a revert PULL REQUEST, a pipeline change like any other that merges
 * the same way. Nothing here pushes to `main` or bypasses protection, and every call is a person's:
 * the routes gate it on a session holding `pipelineMerge`.
 *
 * A merge is two writes in two systems — GitHub's merge, then the `pipeline_merges` row — and the
 * launcher can die between them. So the merge reads the pull request FIRST: one GitHub already
 * shows merged by the App's own bot with no row is that crash, and the row is written from GitHub's
 * answer (`merge_commit_sha`) instead of merging again. A row whose write fails answers 500; the
 * client resends the same `requestId` (it keeps one per click), and that resend records it. A resend
 * of a merge that was recorded is answered from its row without asking GitHub at all.
 */

type User = NonNullable<App.Locals['user']>;

export interface MergeResult {
	merge: PipelineMerge;
	/** The PR had already been merged when this call looked (a resend, a parallel click, or a crash
	 *  after GitHub merged and before the row was written): this call merged nothing. */
	already: boolean;
}

export interface MergeHistoryEntry extends PipelineMerge {
	/** `https://github.com/<repo>/pull/<prNumber>` */
	url: string;
	/** `https://github.com/<repo>/commit/<mergeSha>` */
	commitUrl: string;
	/** When revertOf is set: the change this one undid (its title from our record when we have it). */
	reverts: { number: number; title: string | null; url: string } | null;
	/** A merged revert of this change, if any. */
	revertedBy: { number: number; mergeSha: string; at: Date; url: string } | null;
	/** A revert PR of this change still open, if the changes list knows one (best effort: null when
	 *  GitHub cannot be read — History must render without GitHub). */
	revertOpen: { number: number; url: string; branch: string } | null;
}

export interface MergeHistory {
	merges: MergeHistoryEntry[];
	fetchedAt: string;
}

export interface RevertResult {
	/** The revert pull request. */
	number: number;
	url: string;
	branch: string;
	/** It was open already (a resend, or a second click): this call made nothing. */
	existing: boolean;
}

const BASE_BRANCH = 'main';
const REQUEST_ID_MAX = 100;
/** How the launcher names a revert's branch: the merge it undoes, by number and short SHA. */
const REVERT_BRANCH = /^revert\/(\d+)-[0-9a-f]{7,40}$/;

const short = (sha: string): string => sha.slice(0, 7);
const pullUrl = (number: number): string => `https://github.com/${repo()}/pull/${number}`;

/** The change a launcher-made revert branch undoes, or `null` for any other branch. */
export function revertTargetOf(branch: string): number | null {
	const m = REVERT_BRANCH.exec(branch);
	return m ? Number(m[1]) : null;
}

/** A merge request's own id, which makes its resend idempotent, or a 400. */
export function parseRequestId(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > REQUEST_ID_MAX) {
		throw error(
			400,
			`requestId must be a non-empty string of at most ${REQUEST_ID_MAX} characters.`,
		);
	}
	return value;
}

/** GitHub's own sentence for a refusal (its error body never carries the credential). */
async function githubMessage(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return `GitHub ${res.status}: ${body?.message ?? res.statusText}`;
}

/**
 * The approvals that counted when the change merged: per changed screen, the one `getChange`
 * counts — the newest by an approver who holds `pipelineMerge` today.
 */
const approvalsOf = (change: ChangeDetail): MergeApproval[] =>
	change.harness.diffs.flatMap((d) =>
		d.approval
			? [
					{
						diffId: d.id,
						game: d.game,
						screen: d.screen,
						approverId: d.approval.approverId,
						approver: d.approval.approver,
						note: d.approval.note,
						at: d.approval.at.toISOString(),
					},
				]
			: [],
	);

const mergeRow = (
	change: ChangeDetail,
	input: { requestId: string; user: User },
	mergeSha: string,
): NewMerge => ({
	requestId: input.requestId,
	prNumber: change.number,
	title: change.title,
	headSha: change.headSha,
	mergeSha,
	mergedById: input.user.id,
	mergedBy: approverName(input.user),
	approvals: approvalsOf(change),
	revertOf: revertTargetOf(change.branch),
});

/** Merges of one pull request run one at a time: two clicks make one merge, and both answer it. */
const merging = createKeyedMutex();

/**
 * Squash-merge a Ready change into `main` (ADR-0007 "Merge"). The caller has passed the
 * `pipelineMerge` gate; `headSha` is the head the user confirmed. Everything is re-read here, and
 * anything short of Ready on that very head is a 409 before GitHub is asked. GitHub's own refusal
 * (405 protection, 409 the head moved under the pinned SHA, 422) comes back with its status and its
 * sentence; any other failure is a `GithubAppError`.
 */
export async function mergeChange(
	input: { number: number; headSha: string; requestId: string; user: User },
	app: GithubApp = githubApp,
): Promise<MergeResult> {
	const { number, headSha, requestId, user } = input;
	return merging(String(number), async () => {
		const resent = await findMergeByRequest(requestId);
		if (resent) {
			if (resent.prNumber !== number) {
				throw error(
					409,
					`This request already merged #${resent.prNumber}; send a new one to merge #${number}.`,
				);
			}
			return { merge: resent, already: true };
		}
		const change = await getChange(number, app);
		if (change.merged) return { merge: await mergedOnGithub(change, input), already: true };
		if (change.state !== 'open') throw error(409, `#${number} is closed.`);
		if (headSha !== change.headSha) {
			throw error(
				409,
				`The head moved: you looked at ${short(headSha)} and the branch is now at ${short(change.headSha)}. Reload the change.`,
			);
		}
		if (change.draft) {
			throw error(409, 'This change is a draft: mark it ready for review on GitHub first.');
		}
		if (change.filesTruncated || harnessFilesOf(change.files).length) {
			throw error(409, change.harness.unapprovable ?? 'This change edits the harness.');
		}
		const { status } = change;
		if (status.kind === 'blocked') throw error(409, status.reason);
		if (status.kind === 'testing') {
			throw error(409, `Still testing: ${status.done} of ${status.total} checks have passed.`);
		}
		if (change.mergeable === null) {
			throw error(
				409,
				'GitHub is still working out whether this change merges cleanly; try again in a moment.',
			);
		}
		if (!change.mergeable) throw error(409, 'Merge conflict with main.');

		const approved = approvalsOf(change).length;
		// The message is the launcher's own, never the PR body: a body is anyone's text, and a
		// `[skip ci]` in it would ride into main's history and skip the push checks.
		const message = [
			`Merged from Invisible Pipeline Changes by ${approverName(user)}.`,
			'',
			`Head: ${change.headSha}`,
			...(approved ? [`Approved screens: ${approved}`] : []),
		].join('\n');
		const res = await app.fetch(`/repos/${repo()}/pulls/${number}/merge`, {
			method: 'PUT',
			body: JSON.stringify({
				merge_method: 'squash',
				sha: change.headSha,
				commit_title: `${change.title} (#${number})`,
				commit_message: message,
			}),
		});
		if (res.status === 405 || res.status === 409 || res.status === 422) {
			throw error(res.status, await githubMessage(res));
		}
		if (!res.ok) throw new GithubAppError(await githubMessage(res), res.status);
		const { sha: mergeSha } = (await res.json()) as { sha: string };
		forgetChanges();
		return { merge: await recordMerge(mergeRow(change, input, mergeSha)), already: false };
	});
}

/**
 * A change GitHub shows merged. Recorded: that row. Merged by the App's own bot on the head this
 * click confirmed, with no row: the launcher merged it and the row never landed, so this resend
 * writes it from GitHub's answer. Anyone else merged it on GitHub, and there is nothing of the
 * launcher's to record.
 */
async function mergedOnGithub(
	change: ChangeDetail,
	input: { headSha: string; requestId: string; user: User },
): Promise<PipelineMerge> {
	const row = await findMerge(change.number);
	if (row) return row;
	const by = change.mergedBy ?? 'someone';
	if (by.endsWith('[bot]') && change.mergeCommitSha && change.headSha === input.headSha) {
		return recordMerge(mergeRow(change, input, change.mergeCommitSha));
	}
	throw error(
		409,
		`#${change.number} was merged on GitHub by ${by}, not from here; there is nothing to record.`,
	);
}

/**
 * The History tab: every merge made from here, newest first, each linked to the revert that undid
 * it or is open to undo it. Read from the launcher's own table, so it answers without GitHub: an
 * unconfigured App, or GitHub failing, leaves only the open reverts unknown.
 */
export async function listHistory(app: GithubApp = githubApp): Promise<MergeHistory> {
	const merges = await listMerges();
	const revertedBy = await revertsOf(merges.map((m) => m.prNumber));
	const titles = new Map(merges.map((m) => [m.prNumber, m.title]));
	const open = await openReverts(app);
	return {
		merges: merges.map((m) => {
			const by = revertedBy.get(m.prNumber);
			return {
				...m,
				url: pullUrl(m.prNumber),
				commitUrl: `https://github.com/${repo()}/commit/${m.mergeSha}`,
				reverts:
					m.revertOf === null
						? null
						: {
								number: m.revertOf,
								title: titles.get(m.revertOf) ?? null,
								url: pullUrl(m.revertOf),
							},
				revertedBy: by
					? { number: by.prNumber, mergeSha: by.mergeSha, at: by.at, url: pullUrl(by.prNumber) }
					: null,
				revertOpen: open.get(m.prNumber) ?? null,
			};
		}),
		fetchedAt: new Date().toISOString(),
	};
}

type OpenRevert = NonNullable<MergeHistoryEntry['revertOpen']>;

/** The open revert pull requests, by the change each undoes, off the cached changes list. */
async function openReverts(app: GithubApp): Promise<Map<number, OpenRevert>> {
	const open = new Map<number, OpenRevert>();
	if (app.missing()) return open;
	try {
		for (const c of (await listChanges(app)).changes) {
			const target = revertTargetOf(c.branch);
			if (target !== null && !open.has(target)) {
				open.set(target, { number: c.number, url: c.url, branch: c.branch });
			}
		}
	} catch (err) {
		// Best effort, by design: History stands on the table alone.
		if (!(err instanceof GithubAppError)) throw err;
	}
	return open;
}

interface GhPullRef {
	number: number;
	html_url: string;
	state: string;
	merged_at: string | null;
}

interface GhCommit {
	tree: { sha: string };
	parents: { sha: string }[];
}

interface GhTreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
}

/** A path as a URL: each segment encoded, the slashes kept. */
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/**
 * What GitHub already holds of this revert. No branch: nothing yet. A branch with an open pull
 * request: the answer to a resend. A branch whose pull request was merged or closed: refused, not
 * opened again — someone decided, and the branch has to go before the launcher tries once more. A
 * branch with no pull request (the launcher died after making it): `'branch'`, to open one on it.
 */
async function revertOnGithub(
	app: GithubApp,
	number: number,
	branch: string,
): Promise<RevertResult | 'none' | 'branch'> {
	const r = repo();
	const ref = await app.fetch(`/repos/${r}/git/ref/heads/${encodePath(branch)}`);
	if (ref.status === 404) return 'none';
	if (!ref.ok) throw new GithubAppError(await githubMessage(ref), ref.status);
	const query = new URLSearchParams({
		state: 'all',
		head: `${r.split('/')[0]}:${branch}`,
		per_page: '1',
	});
	const [pull] = await app.json<GhPullRef[]>(`/repos/${r}/pulls?${query}`);
	if (!pull) return 'branch';
	if (pull.state === 'open') {
		return { number: pull.number, url: pull.html_url, branch, existing: true };
	}
	throw error(
		409,
		`A revert of #${number} (#${pull.number}) was already ${pull.merged_at ? 'merged' : 'closed'}; delete branch ${branch} on GitHub to try again.`,
	);
}

/** Every file of a recursive tree by path (blobs and submodule commits; directories are implied). */
function filesOf(entries: GhTreeEntry[]): Map<string, GhTreeEntry> {
	return new Map(entries.filter((e) => e.type !== 'tree').map((e) => [e.path, e]));
}

const sameEntry = (a: GhTreeEntry | undefined, b: GhTreeEntry | undefined): boolean =>
	a === undefined || b === undefined ? a === b : a.sha === b.sha && a.mode === b.mode;

/**
 * The revert of a squash merge as one commit on `main`'s tip, built from three trees through the
 * Git Data API — no clone, no checkout, no merge machinery on the server. Every file the merge
 * changed goes back to how the merge's parent had it, where `main` still holds what the merge left;
 * a file already back is left alone. A file changed again since is a conflict, and a conflict is
 * never resolved here: the whole revert is refused before anything is written to GitHub. Returns
 * the new commit, on no branch yet.
 */
async function revertCommit(app: GithubApp, merge: PipelineMerge, user: User): Promise<string> {
	const r = repo();
	const number = merge.prNumber;
	const squash = await app.json<GhCommit>(`/repos/${r}/git/commits/${merge.mergeSha}`);
	if (squash.parents.length !== 1) {
		throw error(
			409,
			`Merge ${short(merge.mergeSha)} is not a squash commit (it has ${squash.parents.length} parents); revert it by hand.`,
		);
	}
	const tip = (
		await app.json<{ object: { sha: string } }>(`/repos/${r}/git/ref/heads/${BASE_BRANCH}`)
	).object.sha;
	const [parent, tipCommit] = await Promise.all([
		app.json<GhCommit>(`/repos/${r}/git/commits/${squash.parents[0].sha}`),
		app.json<GhCommit>(`/repos/${r}/git/commits/${tip}`),
	]);
	const trees = await Promise.all(
		[parent.tree.sha, squash.tree.sha, tipCommit.tree.sha].map((sha) =>
			app.json<{ tree: GhTreeEntry[]; truncated: boolean }>(
				`/repos/${r}/git/trees/${sha}?recursive=1`,
			),
		),
	);
	if (trees.some((t) => t.truncated)) {
		throw error(
			409,
			`The repository tree is too large for GitHub to list whole; revert #${number} by hand.`,
		);
	}
	const [before, after, now] = trees.map((t) => filesOf(t.tree));
	const entries: (Omit<GhTreeEntry, 'sha'> & { sha: string | null })[] = [];
	const conflicts: string[] = [];
	for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
		const was = before.get(path);
		const merged = after.get(path);
		if (sameEntry(was, merged)) continue;
		const current = now.get(path);
		if (sameEntry(current, merged)) {
			// Each entry keeps its own mode and type: a script stays executable, a submodule a commit.
			if (was) entries.push({ path, mode: was.mode, type: was.type, sha: was.sha });
			else if (merged) entries.push({ path, mode: merged.mode, type: merged.type, sha: null });
		} else if (!sameEntry(current, was)) {
			conflicts.push(path);
		}
	}
	if (conflicts.length) {
		const k = conflicts.length;
		throw error(
			409,
			`The revert does not apply cleanly: ${k} file${k === 1 ? '' : 's'} changed on main since the merge (${conflicts.slice(0, 3).join(', ')}${k > 3 ? ', …' : ''}). Revert #${number} by hand.`,
		);
	}
	if (!entries.length) {
		throw error(
			409,
			`main already holds none of #${number}'s changes; there is nothing to revert.`,
		);
	}
	const tree = await app.json<{ sha: string }>(`/repos/${r}/git/trees`, {
		method: 'POST',
		body: JSON.stringify({ base_tree: tipCommit.tree.sha, tree: entries }),
	});
	// The reason the user typed goes in the pull request, never in a commit message on its way to
	// main.
	const message = [
		`revert: ${merge.title}`,
		'',
		`This reverts commit ${merge.mergeSha} (#${number}), merged from Invisible Pipeline Changes by ${merge.mergedBy}.`,
		`Rolled back by ${approverName(user)}.`,
	].join('\n');
	const commit = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
		method: 'POST',
		body: JSON.stringify({ message, tree: tree.sha, parents: [tip] }),
	});
	return commit.sha;
}

/** Rollbacks of one merge run one at a time: two clicks open one revert. */
const reverting = createKeyedMutex();

/**
 * Roll back a change merged from here (ADR-0007 "Rollback"): open a revert pull request of its
 * squash commit, on a branch named after the merge. It is a pipeline change like any other —
 * the same checks, the same approvals, the same merge — and nothing changes on `main` until it
 * merges; its row's `revertOf` is written then, never here. A resend finds the branch and answers
 * the pull request already open on it.
 */
export async function revertMerge(
	input: { number: number; reason: string | null; user: User },
	app: GithubApp = githubApp,
): Promise<RevertResult> {
	const { number, reason, user } = input;
	return reverting(`revert:${number}`, async () => {
		const merge = await findMerge(number);
		if (!merge) throw error(404, `#${number} was not merged from here; roll it back by hand.`);
		const undone = (await revertsOf([number])).get(number);
		if (undone) throw error(409, `#${number} was already rolled back by #${undone.prNumber}.`);
		const r = repo();
		const branch = `revert/${number}-${short(merge.mergeSha)}`;
		let found = await revertOnGithub(app, number, branch);
		if (found === 'none') {
			const sha = await revertCommit(app, merge, user);
			const ref = await app.fetch(`/repos/${r}/git/refs`, {
				method: 'POST',
				body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
			});
			if (ref.status === 422) {
				// "Reference already exists": another request made the branch first. Answer what it
				// made; the commit built here is left unreferenced, for GitHub to collect.
				found = await revertOnGithub(app, number, branch);
				if (found === 'none') throw new GithubAppError(await githubMessage(ref), ref.status);
			} else if (!ref.ok) {
				throw new GithubAppError(await githubMessage(ref), ref.status);
			}
		}
		if (typeof found === 'object') return found;
		const body = [
			`Reverts #${number} "${merge.title}" — merge ${short(merge.mergeSha)}, merged by ${merge.mergedBy} on ${merge.at.toISOString().slice(0, 10)} from Invisible Pipeline Changes.`,
			...(reason ? [`**Why:** ${reason}`] : []),
			`Rolled back from Invisible Pipeline Changes by ${approverName(user)}.`,
			'This is a pipeline change like any other: it merges from Invisible Pipeline Changes once its checks pass.',
		].join('\n\n');
		const pull = await app.json<GhPullRef>(`/repos/${r}/pulls`, {
			method: 'POST',
			body: JSON.stringify({
				title: `revert: ${merge.title}`,
				head: branch,
				base: BASE_BRANCH,
				body,
			}),
		});
		forgetChanges();
		return { number: pull.number, url: pull.html_url, branch, existing: false };
	});
}
