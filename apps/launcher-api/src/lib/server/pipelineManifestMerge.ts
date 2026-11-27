import { isHttpError } from '@sveltejs/kit';
import { RUNTIMES } from 'constants-shared/runtimes';
import { ENV } from './env';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import { forgetChanges, isOnHold, openPulls, repo } from './pipelineChanges';
import { filesOf, sameEntry, type GhTreeEntry } from './pipelineMerge';
import {
	MANIFEST_NAME,
	rerecordMessage,
	rerecordRuntimeBytes,
	runtimeBytesRunOf,
} from './pipelineRuntimeBytes';

/**
 * Main merged in over a runtime-bytes conflict (ADR-0015 §3, its first mechanical rule, done in the
 * launcher). Every engine change re-records `scripts/runtime-bytes/<id>.json`, so two engine changes
 * always conflict there, and only there more often than not. Those manifests are never hand-merged:
 * they are re-recorded. So when the ONLY paths both sides changed since the merge base are manifests,
 * the launcher builds the merge itself from three trees (as `revertCommit` does): a path one side
 * changed takes that side's entry, a manifest both changed takes `main`'s. The commit's parents are
 * `[head, main]`, and the branch moves by fast-forward only. Any other path both sides changed is
 * refused with its name: a text merge is never attempted here, so two edits git would combine in
 * one file are refused too. One merge base is used, the one `compare` names; with criss-cross
 * history git would merge against a virtual base instead, which squash-merged `main` does not make.
 *
 * Main's manifests are then wrong for the merged code, which is the point: CI's `runtime-bytes`
 * fails on the new head and uploads the manifests it built, and the watch below commits them
 * (`rerecordRuntimeBytes`) without anyone clicking. That is a re-record nobody approved, so it is
 * bounded to the merge a person asked for: only while the head IS the App's own merge commit, only
 * the runtimes that merge took from `main`, and only when the branch was green on runtime-bytes
 * before it. A later push, a label put on by hand, or a runtime already red goes to a person. The
 * label `rerecord-runtime-bytes` is the record on GitHub that the launcher owes the change that
 * re-record; it comes off when the check passes, or when the launcher gives the case back.
 *
 * Unproven: a merge that brings in `main`'s change to `.github/workflows/` is a ref move by an App
 * without the `workflows` permission. `update-branch` was accepted there (ADR-0015 15A spike); this
 * Git Data path was not tried live, and its refusal is named `workflow_refused` like the other's.
 */

const MANIFEST_DIR = 'scripts/runtime-bytes/';
const RUNTIME_IDS: readonly string[] = RUNTIMES.map((r) => r.id);
/** The runtime id of a manifest path, or null: the very names the re-record accepts, a listed
 *  runtime's only. Any other file there is an ordinary file, so a conflict. */
export function manifestIdOf(path: string): string | null {
	if (!path.startsWith(MANIFEST_DIR)) return null;
	const id = MANIFEST_NAME.exec(path.slice(MANIFEST_DIR.length))?.[1];
	return id && RUNTIME_IDS.includes(id) ? id : null;
}
export const RERECORD_LABEL = 'rerecord-runtime-bytes';
const LABEL_COLOR = '5319e7';
const LABEL_DESCRIPTION =
	'Main was merged in over the runtime-bytes manifests; the launcher re-records them from CI.';

/** The paths both sides changed, in a sentence, at most this many named. */
const NAMED_PATHS = 5;

const mergePrefix = (number: number): string =>
	`ci: merge main into #${number}, taking main's runtime-bytes manifests (`;
export const manifestMergeMessage = (number: number, ids: string[]): string =>
	`${mergePrefix(number)}${ids.join(', ')})`;

/** The runtimes a launcher merge on change `number` took from main, read off its subject; null when
 *  the message is not one. */
export function mergedIdsOf(message: string, number: number): string[] | null {
	const subject = message.split('\n')[0];
	const prefix = mergePrefix(number);
	if (!subject.startsWith(prefix) || !subject.endsWith(')')) return null;
	const ids = subject.slice(prefix.length, -1).split(', ');
	return ids.every((id) => RUNTIME_IDS.includes(id)) ? ids : null;
}

type TreeWrite = Omit<GhTreeEntry, 'sha'> & { sha: string | null };

/** Every folder that holds a file of `files`. */
const foldersOf = (files: Map<string, GhTreeEntry>): Set<string> => {
	const folders = new Set<string>();
	for (const path of files.keys()) {
		const parts = path.split('/').slice(0, -1);
		parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
	}
	return folders;
};

export const namedPaths = (paths: string[]): string =>
	paths.length > NAMED_PATHS
		? `${paths.slice(0, NAMED_PATHS).join(', ')} and ${paths.length - NAMED_PATHS} more`
		: paths.join(', ');

export interface ThreeWay {
	/** What the merge writes on top of `main`'s tree: the head's side of every path only it changed. */
	writes: TreeWrite[];
	/** The manifests both sides changed, which take `main`'s; their runtime ids. */
	manifests: string[];
	/** Every other path both sides changed, differently, and every file the head added in a folder
	 *  `main` emptied (git calls that a file-location conflict): what this cannot resolve. */
	conflicts: string[];
}

/**
 * The path-level three-way merge of `head` and `main` from their merge base `base`. A path both
 * changed the same way is not a conflict. A file that would sit where the other side has a folder is
 * one, and so is a file the head added in a folder `main` removed or renamed. Pure, so the fixture
 * runs it on plain maps.
 */
export function threeWay(
	base: Map<string, GhTreeEntry>,
	head: Map<string, GhTreeEntry>,
	main: Map<string, GhTreeEntry>,
): ThreeWay {
	const writes: TreeWrite[] = [];
	const manifests: string[] = [];
	const conflicts: string[] = [];
	const merged = new Map(main);
	const baseFolders = foldersOf(base);
	const mainFolders = foldersOf(main);
	const emptiedByMain = (path: string): boolean => {
		const parts = path.split('/').slice(0, -1);
		return parts.some((_, i) => {
			const folder = parts.slice(0, i + 1).join('/');
			return baseFolders.has(folder) && !mainFolders.has(folder);
		});
	};
	for (const path of [...new Set([...base.keys(), ...head.keys(), ...main.keys()])].sort()) {
		const was = base.get(path);
		const ours = head.get(path);
		const theirs = main.get(path);
		if (sameEntry(ours, was) || sameEntry(ours, theirs)) continue;
		if (sameEntry(theirs, was)) {
			if (ours) {
				if (!was && emptiedByMain(path)) {
					conflicts.push(path);
					continue;
				}
				merged.set(path, ours);
				writes.push({ path, mode: ours.mode, type: ours.type, sha: ours.sha });
			} else if (was) {
				merged.delete(path);
				writes.push({ path, mode: was.mode, type: was.type, sha: null });
			}
			continue;
		}
		const id = manifestIdOf(path);
		if (id) manifests.push(id);
		else conflicts.push(path);
	}
	for (const path of merged.keys()) {
		const folders = path.split('/').slice(0, -1);
		if (folders.some((_, i) => merged.has(folders.slice(0, i + 1).join('/')))) {
			conflicts.push(path);
		}
	}
	return { writes, manifests, conflicts: [...new Set(conflicts)].sort() };
}

export interface ManifestMerge {
	commit: string;
	mainSha: string;
	runtimes: string[];
	/** Whether the label went on: without it the watch never re-records, and a person must. */
	labelled: boolean;
}

type Runs = Parameters<typeof runtimeBytesRunOf>[0];
const runtimeBytesRun = async (app: GithubApp, sha: string) =>
	runtimeBytesRunOf(
		(
			await app.json<{ workflow_runs: Runs }>(
				`/repos/${repo()}/actions/runs?head_sha=${sha}&per_page=100`,
			)
		).workflow_runs,
		sha,
	);

/** Why the merge cannot be built here; the update refuses with it as a `conflict`. */
export class ManifestMergeRefusal extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ManifestMergeRefusal';
	}
}

/**
 * Merge `main` into a conflicted change whose only overlap is the runtime-bytes manifests, as one
 * commit on its branch, then label it for the re-record. `headSha` is the head the caller checked.
 * A refused ref move comes back as GitHub's answer for `refusalOfUpdate` to name.
 */
export async function mergeOverManifests(
	input: { number: number; headSha: string; branch: string },
	app: GithubApp = githubApp,
): Promise<ManifestMerge | { refused: Response }> {
	const r = repo();
	const { number, headSha, branch } = input;
	const before = await runtimeBytesRun(app, headSha);
	if (before?.status === 'completed' && before.conclusion !== 'success') {
		throw new ManifestMergeRefusal(
			'runtime-bytes already fails on this branch: re-record or fix it before main is merged in.',
		);
	}
	const mainSha = (await app.json<{ object: { sha: string } }>(`/repos/${r}/git/ref/heads/main`))
		.object.sha;
	const compared = await app.json<{ merge_base_commit?: { sha?: unknown } }>(
		`/repos/${r}/compare/${mainSha}...${headSha}?per_page=1`,
	);
	const baseSha = compared.merge_base_commit?.sha;
	if (typeof baseSha !== 'string') {
		throw new ManifestMergeRefusal('GitHub did not name the merge base with main.');
	}
	const commits = await Promise.all(
		[baseSha, headSha, mainSha].map((sha) =>
			app.json<{ tree: { sha: string } }>(`/repos/${r}/git/commits/${sha}`),
		),
	);
	const trees = await Promise.all(
		commits.map((c) =>
			app.json<{ tree: GhTreeEntry[]; truncated: boolean }>(
				`/repos/${r}/git/trees/${c.tree.sha}?recursive=1`,
			),
		),
	);
	if (trees.some((t) => t.truncated)) {
		throw new ManifestMergeRefusal(
			'The repository tree is too large for GitHub to list whole; merge main in by hand.',
		);
	}
	const [base, head, main] = trees.map((t) => filesOf(t.tree));
	const { writes, manifests, conflicts } = threeWay(base, head, main);
	if (conflicts.length) {
		const k = conflicts.length;
		throw new ManifestMergeRefusal(
			`Besides the runtime-bytes manifests, both sides changed ${k} file${k === 1 ? '' : 's'} (${namedPaths(conflicts)}), which the pipeline does not combine: merge main in by hand.`,
		);
	}
	if (!manifests.length) {
		throw new ManifestMergeRefusal(
			'GitHub says this branch conflicts with main, but no file differs on both sides; try again in a moment.',
		);
	}
	const tree = writes.length
		? (
				await app.json<{ sha: string }>(`/repos/${r}/git/trees`, {
					method: 'POST',
					body: JSON.stringify({ base_tree: commits[2].tree.sha, tree: writes }),
				})
			).sha
		: commits[2].tree.sha;
	const made = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
		method: 'POST',
		body: JSON.stringify({
			message: `${manifestMergeMessage(number, manifests)}\n\nBoth sides re-recorded ${manifests.join(', ')}; main's are kept and re-recorded from CI's Linux build on this head.`,
			tree,
			parents: [headSha, mainSha],
		}),
	});
	const moved = await app.fetch(
		`/repos/${r}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
		{ method: 'PATCH', body: JSON.stringify({ sha: made.sha, force: false }) },
	);
	if (!moved.ok) return { refused: moved };
	forgetChanges();
	const labelled = await labelForRerecord(app, number);
	return { commit: made.sha, mainSha, runtimes: manifests, labelled };
}

/** The PR carries `rerecord-runtime-bytes`, the label made the first time it is needed. A label the
 *  App may not make is not a failure of the merge: the watch then never sees the change, and the
 *  Re-record button stays a person's. */
async function labelForRerecord(app: GithubApp, number: number): Promise<boolean> {
	const r = repo();
	const add = () =>
		app.fetch(`/repos/${r}/issues/${number}/labels`, {
			method: 'POST',
			body: JSON.stringify({ labels: [RERECORD_LABEL] }),
		});
	try {
		let res = await add();
		if (res.status === 404 || res.status === 422) {
			await app.fetch(`/repos/${r}/labels`, {
				method: 'POST',
				body: JSON.stringify({
					name: RERECORD_LABEL,
					color: LABEL_COLOR,
					description: LABEL_DESCRIPTION,
				}),
			});
			res = await add();
		}
		if (res.ok) return true;
		console.warn(`[pipeline] #${number}: GitHub ${res.status} labelling ${RERECORD_LABEL}.`);
	} catch (err) {
		console.warn(
			`[pipeline] #${number}: labelling ${RERECORD_LABEL} failed:`,
			err instanceof Error ? err.message : err,
		);
	}
	return false;
}

async function unlabel(app: GithubApp, number: number): Promise<void> {
	const res = await app.fetch(
		`/repos/${repo()}/issues/${number}/labels/${encodeURIComponent(RERECORD_LABEL)}`,
		{ method: 'DELETE' },
	);
	if (!res.ok && res.status !== 404) {
		console.warn(`[pipeline] #${number}: GitHub ${res.status} removing ${RERECORD_LABEL}.`);
	}
	forgetChanges();
}

/** How long a labelled head may go without a `runtime-bytes` run before it is given back. */
export const NO_RUN_GIVE_UP_MS = 6 * 60 * 60_000;

/** The launcher as the one who re-records: the commit message names it, never a person. */
export const WATCH_ACTOR = { name: 'Pipeline Changes (automatic)', email: 'pipeline@launcher' };

export type WatchOutcome = 'waiting' | 'passed' | 'rerecorded' | 'gave_up' | 'on_hold';

interface RestCommit {
	author?: { login?: string } | null;
	commit: { message: string; committer?: { date?: string } | null };
	parents: { sha: string }[];
}

/**
 * One look at one labelled change. A pass on its head takes the label off. Otherwise it acts only
 * on the App's own commits: its merge (two parents, the merge subject for this change) or its
 * re-record of that merge. On the merge it waits for the branch's run before the merge and the run
 * on the merge; when the first passed and the second failed, it re-records the runtimes the merge
 * took from main, and those only. A failed re-record, a head that is not the App's (a later push, a
 * label put on by hand), a branch already red before the merge, a refused re-record (but for "no
 * run yet", "head moved" or GitHub failing) or six hours without a run give the change back: the
 * label comes off and the Re-record button stays a person's.
 */
export async function watchOne(
	app: GithubApp,
	pull: { number: number; head: { sha: string }; labels?: { name: string }[] },
	nowMs = Date.now(),
): Promise<WatchOutcome> {
	const { number } = pull;
	const headSha = pull.head.sha;
	if (isOnHold(pull)) return 'on_hold';
	const giveUp = async (): Promise<WatchOutcome> => {
		await unlabel(app, number);
		return 'gave_up';
	};
	const run = await runtimeBytesRun(app, headSha);
	if (run?.status === 'completed' && run.conclusion === 'success') {
		await unlabel(app, number);
		return 'passed';
	}
	const head = await app.json<RestCommit>(`/repos/${repo()}/commits/${headSha}`);
	if (head.author?.login !== `${await app.slug()}[bot]`) return giveUp();
	const pending = async (): Promise<WatchOutcome | null> => {
		if (run?.status === 'completed') return null;
		if (run) return 'waiting';
		const made = Date.parse(head.commit.committer?.date ?? '');
		return Number.isNaN(made) || nowMs - made < NO_RUN_GIVE_UP_MS ? 'waiting' : giveUp();
	};
	if (head.commit.message.startsWith(rerecordMessage(number))) return (await pending()) ?? giveUp();
	const ids = mergedIdsOf(head.commit.message, number);
	if (!ids || head.parents.length !== 2) return giveUp();
	const before = await runtimeBytesRun(app, head.parents[0].sha);
	if (!before) return giveUp();
	if (before.status !== 'completed') return 'waiting';
	if (before.conclusion !== 'success') return giveUp();
	const waiting = await pending();
	if (waiting) return waiting;
	try {
		await rerecordRuntimeBytes({ number, headSha, user: WATCH_ACTOR, only: ids }, app);
		return 'rerecorded';
	} catch (err) {
		if (!isHttpError(err)) throw err;
		const code = (err.body as { code?: unknown }).code;
		if (code === 'no_run' || code === 'head_moved' || err.status >= 500) return 'waiting';
		return giveUp();
	}
}

/** Every open change labelled `rerecord-runtime-bytes`, one at a time; one failure skips only its own. */
export async function watchRuntimeBytes(
	app: GithubApp = githubApp,
): Promise<Map<number, WatchOutcome | 'error'>> {
	const outcomes = new Map<number, WatchOutcome | 'error'>();
	if (app.missing()) return outcomes;
	const labelled = (await openPulls(app)).filter(
		(p) =>
			p.head.repo?.full_name === repo() && (p.labels ?? []).some((l) => l.name === RERECORD_LABEL),
	);
	for (const pull of labelled) {
		try {
			outcomes.set(pull.number, await watchOne(app, pull));
		} catch (err) {
			outcomes.set(pull.number, 'error');
			const why = err instanceof GithubAppError || err instanceof Error ? err.message : err;
			console.warn(`[pipeline] runtime-bytes watch on #${pull.number}:`, why);
		}
	}
	return outcomes;
}

const WATCH_EVERY_MS = 2 * 60_000;
let watching = false;
let busy = false;

/** Started once at boot where `PIPELINE_RERECORD_WATCH` allows it (production by default, never a
 *  dev box on older code): a look every two minutes, never two at once, never a thrown error. */
export function startRuntimeBytesWatch(): void {
	if (watching || !ENV.PIPELINE_RERECORD_WATCH) return;
	watching = true;
	const timer = setInterval(() => {
		if (busy) return;
		busy = true;
		watchRuntimeBytes()
			.catch((err) =>
				console.warn('[pipeline] runtime-bytes watch:', err instanceof Error ? err.message : err),
			)
			.finally(() => {
				busy = false;
			});
	}, WATCH_EVERY_MS);
	if (typeof timer.unref === 'function') timer.unref();
}
