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
	claimMerge,
	completeMerge,
	dropClaim,
	findMerge,
	findMergeByRequest,
	listClaims,
	listMerges,
	revertsOf,
	type CompletedMerge,
	type MergeApproval,
	type NewClaim,
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
 * A merge is two writes in two systems, and the launcher can die, or lose GitHub's answer, between
 * them. So the row comes FIRST, as a claim with no merge commit, and GitHub is asked only under it:
 * one row per pull request, so two requests — two clicks, two processes — never both merge, and a
 * merge GitHub made always has a row to complete. GitHub's answer completes the claim; its refusal
 * drops it; an answer that never came (a timeout, a 5xx) KEEPS it, because GitHub may have merged.
 * A kept claim is settled from the pull request itself — by the click's retry (same `requestId`),
 * by the next merge of that pull request, and once `CLAIM_STALE_MS` old by History and by a
 * rollback: merged by the App's own bot on the claimed head is the claimed merge, recorded under
 * the claim's user; anything else never happened from here, and the claim goes.
 */

type User = NonNullable<App.Locals['user']>;

export interface MergeResult {
	merge: CompletedMerge;
	/** The PR had already been merged when this call looked (a resend, a parallel click, or a crash
	 *  after GitHub merged and before the row was completed): this call merged nothing. */
	already: boolean;
}

export interface MergeHistoryEntry extends CompletedMerge {
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
/** A merge is answered, or times out, in seconds: a claim this old outlived its request. */
const CLAIM_STALE_MS = 2 * 60_000;
/** How the launcher names a revert's branch: the merge it undoes, by number and short SHA. */
const REVERT_BRANCH = /^revert\/(\d+)-([0-9a-f]{7,40})$/;
/** What makes GitHub skip a push's workflows — Lint, Checks, Secrets, the runtime release — when
 *  it appears anywhere in the commit message, the subject included. */
const CI_SKIP = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;
const CI_SKIPS = new RegExp(CI_SKIP.source, 'gi');

const short = (sha: string): string => sha.slice(0, 7);
const pullUrl = (number: number): string => `https://github.com/${repo()}/pull/${number}`;
const isCompleted = (row: PipelineMerge): row is CompletedMerge => row.mergeSha !== null;
const isStale = (claim: PipelineMerge): boolean => Date.now() - claim.at.getTime() > CLAIM_STALE_MS;
/** Text bound for a commit message with every CI-skip directive taken out. */
const withoutCiSkip = (text: string): string =>
	text
		.replace(CI_SKIPS, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
/** The first three paths, and an ellipsis for the rest. */
const firstPaths = (paths: string[]): string =>
	`${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}`;

/** The change a launcher-made revert branch undoes, or `null` for any other branch. */
export function revertTargetOf(branch: string): number | null {
	const m = REVERT_BRANCH.exec(branch);
	return m ? Number(m[1]) : null;
}

/**
 * The change a merge of this branch reverts, for the record: only a revert branch whose short SHA
 * starts the merge commit of the change it names. A branch merely named like one undoes nothing.
 */
async function revertOfBranch(branch: string): Promise<number | null> {
	const m = REVERT_BRANCH.exec(branch);
	if (!m) return null;
	const target = await findMerge(Number(m[1]));
	return target?.mergeSha?.startsWith(m[2]) ? target.prNumber : null;
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

const claimOf = async (
	change: ChangeDetail,
	input: { requestId: string; user: User },
): Promise<NewClaim> => ({
	requestId: input.requestId,
	prNumber: change.number,
	title: change.title,
	headSha: change.headSha,
	mergedById: input.user.id,
	mergedBy: approverName(input.user),
	approvals: approvalsOf(change),
	revertOf: await revertOfBranch(change.branch),
});

/** What settles a claim: the pull request as GitHub shows it now. */
type MergeState = Pick<ChangeDetail, 'merged' | 'mergedBy' | 'mergeCommitSha' | 'headSha'>;

interface GhPullState {
	merged: boolean;
	merged_by: { login: string } | null;
	merge_commit_sha: string | null;
	head: { sha: string };
}

async function readMergeState(number: number, app: GithubApp): Promise<MergeState> {
	const pull = await app.json<GhPullState>(`/repos/${repo()}/pulls/${number}`);
	return {
		merged: pull.merged,
		mergedBy: pull.merged_by?.login ?? null,
		mergeCommitSha: pull.merge_commit_sha,
		headSha: pull.head.sha,
	};
}

/**
 * Settle a claim against its pull request. Merged by the App's own bot on the head the claim
 * pinned: that is the claimed merge, completed under the claim's user whoever settles it. Anything
 * else — not merged, merged by a person, merged on another head — was not merged from here, and the
 * claim goes (`null`).
 */
async function settleClaim(claim: PipelineMerge, pull: MergeState): Promise<CompletedMerge | null> {
	if (
		pull.merged &&
		pull.mergedBy?.endsWith('[bot]') &&
		pull.mergeCommitSha &&
		pull.headSha === claim.headSha
	) {
		return completeMerge(claim, pull.mergeCommitSha);
	}
	await dropClaim(claim.id);
	return null;
}

/** Every claim that outlived its request, settled; one GitHub cannot answer for waits. */
async function reconcileClaims(app: GithubApp): Promise<void> {
	for (const claim of await listClaims(CLAIM_STALE_MS)) {
		try {
			await settleClaim(claim, await readMergeState(claim.prNumber, app));
		} catch (err) {
			if (!(err instanceof GithubAppError)) throw err;
		}
	}
}

const busy = (number: number, claim: PipelineMerge | null) =>
	error(
		409,
		`${claim?.mergedBy ?? 'Someone'} is merging #${number} right now; reload in a moment.`,
	);

/**
 * The claim this merge goes ahead under — or the merge that beat it to the pull request, completed.
 * A claim younger than `CLAIM_STALE_MS` is a merge in flight elsewhere (409). An older one outlived
 * its request, and the pull request was just read unmerged, so the merge it stood for never
 * happened: it is dropped, and this request claims in its place.
 */
async function claimFor(number: number, input: NewClaim): Promise<PipelineMerge> {
	const claim = await claimMerge(input);
	if (claim) return claim;
	const other = await findMerge(number);
	if (other && isCompleted(other)) return other;
	if (other && !isStale(other)) throw busy(number, other);
	if (other) await dropClaim(other.id);
	const again = await claimMerge(input);
	if (!again) throw busy(number, await findMerge(number));
	return again;
}

/**
 * A change GitHub shows merged. Its row completed: that merge. A claim: settled from what GitHub
 * shows. No row at all: the launcher never asked GitHub to merge it — a merge it makes always has
 * a claim first — so there is nothing to record, whoever merged it.
 */
async function mergedOnGithub(change: ChangeDetail): Promise<CompletedMerge> {
	const row = await findMerge(change.number);
	if (row && isCompleted(row)) return row;
	const settled = row ? await settleClaim(row, change) : null;
	if (settled) return settled;
	throw error(
		409,
		`#${change.number} was merged on GitHub by ${change.mergedBy ?? 'someone'}, not from here; there is nothing to record.`,
	);
}

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
		const byRequest = await findMergeByRequest(requestId);
		if (byRequest && byRequest.prNumber !== number) {
			throw error(
				409,
				`This request already merged #${byRequest.prNumber}; send a new one to merge #${number}.`,
			);
		}
		if (byRequest && isCompleted(byRequest)) return { merge: byRequest, already: true };
		const change = await getChange(number, app);
		if (change.merged) return { merge: await mergedOnGithub(change), already: true };
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
		const merger = approverName(user);
		const skipInTitle = CI_SKIP.exec(change.title);
		if (skipInTitle) {
			throw error(
				409,
				`The title carries a CI-skip directive (${skipInTitle[0]}); remove it from the pull request title first.`,
			);
		}
		const skipInName = CI_SKIP.exec(merger);
		if (skipInName) {
			throw error(
				409,
				`Your name in the launcher carries a CI-skip directive (${skipInName[0]}); change it before merging.`,
			);
		}

		const claim = byRequest ?? (await claimFor(number, await claimOf(change, input)));
		if (isCompleted(claim)) return { merge: claim, already: true };
		// The message is the launcher's own, never the PR body: a body is anyone's text, and a
		// CI-skip directive in it would ride into main's history and skip the push workflows.
		const message = [
			`Merged from Invisible Pipeline Changes by ${merger}.`,
			'',
			`Head: ${change.headSha}`,
			...(claim.approvals.length ? [`Approved screens: ${claim.approvals.length}`] : []),
		].join('\n');
		// A GithubAppError thrown here (a timeout, the network) leaves the claim standing: GitHub
		// may have merged, and the retry or History settles it from the pull request.
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
			// A refusal — unless it refuses a merge this claim already made (an earlier attempt's
			// answer lost): the pull request says which.
			const refusal = await githubMessage(res);
			const settled = await settleClaim(claim, await readMergeState(number, app));
			if (settled) return { merge: settled, already: true };
			throw error(res.status, refusal);
		}
		if (!res.ok) {
			// A 4xx refused the merge; a 5xx may have followed one, so its claim stays to be settled.
			if (res.status < 500) await dropClaim(claim.id);
			throw new GithubAppError(await githubMessage(res), res.status);
		}
		const { sha: mergeSha } = (await res.json()) as { sha: string };
		forgetChanges();
		return { merge: await completeMerge(claim, mergeSha), already: false };
	});
}

/**
 * The History tab: every merge made from here, newest first, each linked to the revert that undid
 * it or is open to undo it. Read from the launcher's own table, so it answers without GitHub: an
 * unconfigured App, or GitHub failing, leaves only the open reverts unknown and the claims that
 * outlived their request unsettled.
 */
export async function listHistory(app: GithubApp = githubApp): Promise<MergeHistory> {
	if (!app.missing()) await reconcileClaims(app);
	const merges = await listMerges();
	const revertedBy = await revertsOf(merges.map((m) => m.prNumber));
	const titles = new Map(merges.map((m) => [m.prNumber, m.title]));
	const open = await openReverts(app, merges);
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
async function openReverts(
	app: GithubApp,
	merges: CompletedMerge[],
): Promise<Map<number, OpenRevert>> {
	const open = new Map<number, OpenRevert>();
	if (app.missing()) return open;
	const shaOf = new Map(merges.map((m) => [m.prNumber, m.mergeSha]));
	try {
		for (const c of (await listChanges(app)).changes) {
			// A branch counts only when its short SHA names the merge it claims to undo, as
			// `revertOf` is accepted: a branch merely named after a change hides nothing.
			const m = REVERT_BRANCH.exec(c.branch);
			if (!m) continue;
			const target = Number(m[1]);
			if (!open.has(target) && shaOf.get(target)?.startsWith(m[2])) {
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
	message: string;
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

/** What GitHub already holds of a revert: nothing, a branch alone, or its open pull request. */
type OnGithub =
	{ kind: 'none' } | { kind: 'branch'; tip: string } | { kind: 'open'; revert: RevertResult };

/**
 * What GitHub already holds of this revert. A branch with an open pull request is the answer to a
 * resend. A branch whose pull request was merged or closed is refused, not opened again — someone
 * decided, and the branch has to go before the launcher tries once more. A branch with no pull
 * request (the launcher died after making it, or another request is making it) comes back with
 * its tip, to be checked before a pull request is opened on it.
 */
async function revertOnGithub(app: GithubApp, number: number, branch: string): Promise<OnGithub> {
	const r = repo();
	const ref = await app.fetch(`/repos/${r}/git/ref/heads/${encodePath(branch)}`);
	if (ref.status === 404) return { kind: 'none' };
	if (!ref.ok) throw new GithubAppError(await githubMessage(ref), ref.status);
	const { object } = (await ref.json()) as { object: { sha: string } };
	const query = new URLSearchParams({
		state: 'all',
		head: `${r.split('/')[0]}:${branch}`,
		per_page: '1',
	});
	const [pull] = await app.json<GhPullRef[]>(`/repos/${r}/pulls?${query}`);
	if (!pull) return { kind: 'branch', tip: object.sha };
	if (pull.state === 'open') {
		return {
			kind: 'open',
			revert: { number: pull.number, url: pull.html_url, branch, existing: true },
		};
	}
	throw error(
		409,
		`A revert of #${number} (#${pull.number}) was already ${pull.merged_at ? 'merged' : 'closed'}; delete branch ${branch} on GitHub to try again.`,
	);
}

/** Whether a commit is the launcher's revert of this merge: one parent, and it names the merge. */
async function isRevertOf(app: GithubApp, merge: CompletedMerge, sha: string): Promise<boolean> {
	const commit = await app.json<GhCommit>(`/repos/${repo()}/git/commits/${sha}`);
	return (
		commit.parents.length === 1 && commit.message.includes(`This reverts commit ${merge.mergeSha}`)
	);
}

/** Every file of a recursive tree by path (blobs and submodule commits; directories are implied). */
function filesOf(entries: GhTreeEntry[]): Map<string, GhTreeEntry> {
	return new Map(entries.filter((e) => e.type !== 'tree').map((e) => [e.path, e]));
}

const sameEntry = (a: GhTreeEntry | undefined, b: GhTreeEntry | undefined): boolean =>
	a === undefined || b === undefined ? a === b : a.sha === b.sha && a.mode === b.mode;

/** Whether a file put back at `path` would meet a folder: one at `path`, or a file where one of
 *  its folders goes. */
function meetsFolder(path: string, files: Map<string, GhTreeEntry>): boolean {
	const folders = path.split('/').slice(0, -1);
	if (folders.some((_, i) => files.has(folders.slice(0, i + 1).join('/')))) return true;
	for (const other of files.keys()) if (other.startsWith(`${path}/`)) return true;
	return false;
}

/**
 * The revert of a squash merge as one commit on `main`'s tip as it was read, built from three trees
 * through the Git Data API — no clone, no checkout, no merge machinery on the server. Every file
 * the merge changed goes back to how the merge's parent had it, where that tip still holds what the
 * merge left; a file already back is left alone. A file changed again since, or one that would go
 * back where a folder now is (or under a file), is a conflict, and a conflict is never resolved
 * here: the whole revert is refused before anything is written to GitHub. A commit that lands on
 * `main` after the tip was read is not seen here; if it overlaps, it shows as a conflict on the
 * revert's pull request, as it would on any change. Returns the new commit, on no branch yet.
 */
async function revertCommit(app: GithubApp, merge: CompletedMerge, user: User): Promise<string> {
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
	const folders: string[] = [];
	for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
		const was = before.get(path);
		const merged = after.get(path);
		if (sameEntry(was, merged)) continue;
		const current = now.get(path);
		if (sameEntry(current, merged)) {
			// Each entry keeps its own mode and type: a script stays executable, a submodule a commit.
			if (was && meetsFolder(path, now)) folders.push(path);
			else if (was) entries.push({ path, mode: was.mode, type: was.type, sha: was.sha });
			else if (merged) entries.push({ path, mode: merged.mode, type: merged.type, sha: null });
		} else if (!sameEntry(current, was)) {
			conflicts.push(path);
		}
	}
	if (conflicts.length) {
		const k = conflicts.length;
		throw error(
			409,
			`The revert does not apply cleanly: ${k} file${k === 1 ? '' : 's'} changed on main since the merge (${firstPaths(conflicts)}). Revert #${number} by hand.`,
		);
	}
	if (folders.length) {
		throw error(
			409,
			`The revert does not apply cleanly: ${firstPaths(folders)} cannot go back as a file, because main has a folder there or a file where its folder goes. Revert #${number} by hand.`,
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
	// main; the names that do go in carry no CI-skip directive.
	const message = [
		`revert: ${withoutCiSkip(merge.title)}`,
		'',
		`This reverts commit ${merge.mergeSha} (#${number}), merged from Invisible Pipeline Changes by ${withoutCiSkip(merge.mergedBy)}.`,
		`Rolled back by ${withoutCiSkip(approverName(user))}.`,
	].join('\n');
	const commit = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
		method: 'POST',
		body: JSON.stringify({ message, tree: tree.sha, parents: [tip] }),
	});
	return commit.sha;
}

/**
 * The completed merge a rollback undoes, or `null`. A claim is a merge in flight (409) or, once
 * it outlived its request, settled from the pull request first — unmerged, it is no merge at all.
 */
async function mergeToRevert(number: number, app: GithubApp): Promise<CompletedMerge | null> {
	const row = await findMerge(number);
	if (!row || isCompleted(row)) return row;
	if (!isStale(row)) throw busy(number, row);
	return settleClaim(row, await readMergeState(number, app));
}

/** Rollbacks of one merge run one at a time: two clicks open one revert. */
const reverting = createKeyedMutex();

/**
 * Roll back a change merged from here (ADR-0007 "Rollback"): open a revert pull request of its
 * squash commit, on a branch named after the merge. It is a pipeline change like any other —
 * the same checks, the same approvals, the same merge — and nothing changes on `main` until it
 * merges; its row's `revertOf` is written then, never here. A resend finds the branch and answers
 * the pull request already open on it; a branch found without one is opened only when its tip is
 * the launcher's revert of this very merge.
 */
export async function revertMerge(
	input: { number: number; reason: string | null; user: User },
	app: GithubApp = githubApp,
): Promise<RevertResult> {
	const { number, reason, user } = input;
	return reverting(`revert:${number}`, async () => {
		const merge = await mergeToRevert(number, app);
		if (!merge) throw error(404, `#${number} was not merged from here; roll it back by hand.`);
		const undone = (await revertsOf([number])).get(number);
		if (undone) throw error(409, `#${number} was already rolled back by #${undone.prNumber}.`);
		const r = repo();
		const branch = `revert/${number}-${short(merge.mergeSha)}`;
		let found = await revertOnGithub(app, number, branch);
		if (found.kind === 'none') {
			const sha = await revertCommit(app, merge, user);
			const ref = await app.fetch(`/repos/${r}/git/refs`, {
				method: 'POST',
				body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
			});
			if (ref.status === 422) {
				// "Reference already exists": another request made the branch first. What it made is
				// checked like any branch found; the commit built here is left for GitHub to collect.
				found = await revertOnGithub(app, number, branch);
				if (found.kind === 'none') throw new GithubAppError(await githubMessage(ref), ref.status);
			} else if (!ref.ok) {
				throw new GithubAppError(await githubMessage(ref), ref.status);
			}
		}
		if (found.kind === 'open') return found.revert;
		if (found.kind === 'branch' && !(await isRevertOf(app, merge, found.tip))) {
			throw error(
				409,
				`Branch ${branch} is not the launcher's revert of #${number}; delete it on GitHub to roll back from here.`,
			);
		}
		const body = [
			`Reverts #${number} "${merge.title}" — merge ${short(merge.mergeSha)}, merged by ${merge.mergedBy} on ${merge.at.toISOString().slice(0, 10)} from Invisible Pipeline Changes.`,
			...(reason ? [`**Why:** ${reason}`] : []),
			`Rolled back from Invisible Pipeline Changes by ${approverName(user)}.`,
			'This is a pipeline change like any other: it merges from Invisible Pipeline Changes once its checks pass.',
		].join('\n\n');
		const res = await app.fetch(`/repos/${r}/pulls`, {
			method: 'POST',
			body: JSON.stringify({
				title: `revert: ${withoutCiSkip(merge.title)}`,
				head: branch,
				base: BASE_BRANCH,
				body,
			}),
		});
		if (res.status === 422) {
			// "A pull request already exists": another request opened it first.
			const raced = await revertOnGithub(app, number, branch);
			if (raced.kind === 'open') return raced.revert;
			throw new GithubAppError(await githubMessage(res), res.status);
		}
		if (!res.ok) throw new GithubAppError(await githubMessage(res), res.status);
		const pull = (await res.json()) as GhPullRef;
		forgetChanges();
		return { number: pull.number, url: pull.html_url, branch, existing: false };
	});
}
