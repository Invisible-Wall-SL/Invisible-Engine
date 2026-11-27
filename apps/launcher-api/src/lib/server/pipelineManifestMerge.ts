import { isHttpError } from '@sveltejs/kit';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import { forgetChanges, isOnHold, openPulls, repo } from './pipelineChanges';
import { rerecordMessage, rerecordRuntimeBytes, runtimeBytesRunOf } from './pipelineRuntimeBytes';

/**
 * Main merged in over a runtime-bytes conflict (ADR-0015 §3, its first mechanical rule, done in the
 * launcher). Every engine change re-records `scripts/runtime-bytes/<id>.json`, so two engine changes
 * always conflict there, and only there more often than not. Those manifests are never hand-merged:
 * they are re-recorded. So when the ONLY paths both sides changed since the merge base are manifests,
 * the launcher builds the merge itself from three trees (as `revertCommit` does): a path one side
 * changed takes that side's entry, a manifest both changed takes `main`'s. The commit's parents are
 * `[head, main]`, and the branch moves by fast-forward only. Any other path both sides changed is a
 * real conflict, refused with its name: a text merge is never attempted here.
 *
 * Main's manifests are then wrong for the merged code, which is the point: CI's `runtime-bytes`
 * fails on the new head and uploads the manifests it built, and the watch below commits them
 * (`rerecordRuntimeBytes`) without anyone clicking. The label `rerecord-runtime-bytes` is the
 * record on GitHub that the launcher owes the change that re-record; it comes off when the check
 * passes, or when the launcher gives the case back to a person.
 */

export const MANIFEST_PATH = /^scripts\/runtime-bytes\/[a-z0-9-]+\.json$/;
export const RERECORD_LABEL = 'rerecord-runtime-bytes';
const LABEL_COLOR = '5319e7';
const LABEL_DESCRIPTION =
	'Main was merged in over the runtime-bytes manifests; the launcher re-records them from CI.';

/** The paths both sides changed, in a sentence, at most this many named. */
const NAMED_PATHS = 5;

export const manifestMergeMessage = (number: number, ids: string[]): string =>
	`ci: merge main into #${number}, taking main's runtime-bytes manifests (${ids.join(', ')})`;

interface GhTreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
}
type TreeWrite = Omit<GhTreeEntry, 'sha'> & { sha: string | null };

const filesOf = (entries: GhTreeEntry[]): Map<string, GhTreeEntry> =>
	new Map(entries.filter((e) => e.type !== 'tree').map((e) => [e.path, e]));

const sameEntry = (a: GhTreeEntry | undefined, b: GhTreeEntry | undefined): boolean =>
	a === undefined || b === undefined ? a === b : a.sha === b.sha && a.mode === b.mode;

export const namedPaths = (paths: string[]): string =>
	paths.length > NAMED_PATHS
		? `${paths.slice(0, NAMED_PATHS).join(', ')} and ${paths.length - NAMED_PATHS} more`
		: paths.join(', ');

export interface ThreeWay {
	/** What the merge writes on top of `main`'s tree: the head's side of every path only it changed. */
	writes: TreeWrite[];
	/** The manifests both sides changed, which take `main`'s; their runtime ids. */
	manifests: string[];
	/** Every other path both sides changed, differently: a conflict this cannot resolve. */
	conflicts: string[];
}

/**
 * The path-level three-way merge of `head` and `main` from their merge base `base`. A path both
 * changed the same way is not a conflict. A file that would sit where the other side has a folder is
 * one. Pure, so the fixture runs it on plain maps.
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
	for (const path of [...new Set([...base.keys(), ...head.keys(), ...main.keys()])].sort()) {
		const was = base.get(path);
		const ours = head.get(path);
		const theirs = main.get(path);
		if (sameEntry(ours, was) || sameEntry(ours, theirs)) continue;
		if (sameEntry(theirs, was)) {
			if (ours) {
				merged.set(path, ours);
				writes.push(ours);
			} else {
				merged.delete(path);
				writes.push({ path, mode: was!.mode, type: was!.type, sha: null });
			}
			continue;
		}
		if (MANIFEST_PATH.test(path))
			manifests.push(
				path
					.split('/')
					.pop()!
					.replace(/\.json$/, ''),
			);
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
}

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
			`This branch conflicts with main in ${k} file${k === 1 ? '' : 's'} besides the runtime-bytes manifests (${namedPaths(conflicts)}): merge main in by hand.`,
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
	await labelForRerecord(app, number);
	forgetChanges();
	return { commit: made.sha, mainSha, runtimes: manifests };
}

/** The PR carries `rerecord-runtime-bytes`, the label made the first time it is needed. A label the
 *  App may not make is not a failure of the merge: the watch then never sees the change, and the
 *  Re-record button stays a person's. */
async function labelForRerecord(app: GithubApp, number: number): Promise<void> {
	const r = repo();
	const add = () =>
		app.fetch(`/repos/${r}/issues/${number}/labels`, {
			method: 'POST',
			body: JSON.stringify({ labels: [RERECORD_LABEL] }),
		});
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
	if (!res.ok) {
		console.warn(`[pipeline] #${number}: GitHub ${res.status} labelling ${RERECORD_LABEL}.`);
	}
}

async function unlabel(app: GithubApp, number: number): Promise<void> {
	await app.fetch(
		`/repos/${repo()}/issues/${number}/labels/${encodeURIComponent(RERECORD_LABEL)}`,
		{ method: 'DELETE' },
	);
	forgetChanges();
}

/** The launcher as the one who re-records: the commit message names it, never a person. */
export const WATCH_ACTOR = { name: 'Pipeline Changes (automatic)', email: 'pipeline@launcher' };

export type WatchOutcome = 'waiting' | 'passed' | 'rerecorded' | 'gave_up' | 'on_hold';

/**
 * One look at one labelled change. Waits while its head has no finished `runtime-bytes` run. A pass
 * takes the label off. A failure re-records once from that run's artifact. A failure on a head that
 * is already a re-record, or a re-record refused for any reason but "no run yet" or "head moved",
 * gives the change back to a person: the label comes off and the Re-record button stays.
 */
export async function watchOne(
	app: GithubApp,
	pull: { number: number; head: { sha: string }; labels?: { name: string }[] },
): Promise<WatchOutcome> {
	const { number } = pull;
	const headSha = pull.head.sha;
	if (isOnHold(pull)) return 'on_hold';
	const { workflow_runs } = await app.json<{
		workflow_runs: Parameters<typeof runtimeBytesRunOf>[0];
	}>(`/repos/${repo()}/actions/runs?head_sha=${headSha}&per_page=100`);
	const run = runtimeBytesRunOf(workflow_runs, headSha);
	if (!run || run.status !== 'completed') return 'waiting';
	if (run.conclusion === 'success') {
		await unlabel(app, number);
		return 'passed';
	}
	const head = await app.json<{ message: string }>(`/repos/${repo()}/git/commits/${headSha}`);
	if (head.message.startsWith(rerecordMessage(number))) {
		await unlabel(app, number);
		return 'gave_up';
	}
	try {
		await rerecordRuntimeBytes({ number, headSha, user: WATCH_ACTOR }, app);
		return 'rerecorded';
	} catch (err) {
		if (!isHttpError(err)) throw err;
		const code = (err.body as { code?: unknown }).code;
		if (code === 'no_run' || code === 'head_moved') return 'waiting';
		await unlabel(app, number);
		return 'gave_up';
	}
}

/** Every open change labelled `rerecord-runtime-bytes`, one at a time; one failure skips only its own. */
export async function watchRuntimeBytes(
	app: GithubApp = githubApp,
): Promise<Map<number, WatchOutcome | 'error'>> {
	const outcomes = new Map<number, WatchOutcome | 'error'>();
	if (app.missing()) return outcomes;
	const labelled = (await openPulls(app)).filter((p) =>
		(p.labels ?? []).some((l) => l.name === RERECORD_LABEL),
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

/** Started once at boot: a look every two minutes, never two at once, never a thrown error. */
export function startRuntimeBytesWatch(): void {
	if (watching) return;
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
