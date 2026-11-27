import { createHash } from 'node:crypto';
import type { MergeChoice, MergeRule, MergeRunFile } from '$lib/mergeMainRuns';
import {
	addedLines,
	baseName,
	cleanPerson,
	isRatchet,
	packageProblem,
	ratchetProblem,
	secretIn,
	switchedOff,
	withoutDirectives,
} from './bugFixRunsChange';
import { isRegenerated } from './pipelineMergeRunsResult';

/**
 * What an accepted resolution writes (ADR-0015 §5), decided from three trees as `revertCommit` does
 * (`pipelineMerge.ts`): the merge base, the head and `main` at the run's SHA. A path only one side
 * changed takes that side's entry, as git would; only the paths both sides changed, and the files
 * a §3 rule regenerates, take the run's content. So a run cannot change anything else: a path
 * neither side changed is untouchable, and a path outside both lists is refused. Pure: the GitHub
 * calls that read the trees and write the commit are `pipelineMergeRuns.ts`'s.
 */

/** One file of a recursive tree: a blob, or a submodule's commit. */
export interface TreeFile {
	mode: string;
	type: string;
	sha: string;
}
export type Files = Map<string, TreeFile>;

export interface Write {
	path: string;
	mode: string;
	type: string;
	/** Null deletes the path. */
	sha: string | null;
	/** The run's text for the path, when it is the run's to write. */
	content: string | null;
	/** How the path got here: a side's entry, or the run's. */
	from: 'head' | 'run';
}

export interface Plan {
	/** The tree entries to put on `main`'s tree: the head's own changes, then the run's files. */
	writes: Write[];
	/** The run's files that differ from both sides, whose lines the content check reads. */
	resolved: MergeRunFile[];
}

const same = (a: TreeFile | undefined, b: TreeFile | undefined): boolean =>
	a === undefined || b === undefined ? a === b : a.sha === b.sha && a.mode === b.mode;

/** The Git blob id of `text`, as GitHub stores it. */
export const blobSha = (text: string): string =>
	createHash('sha1')
		.update(`blob ${Buffer.byteLength(text, 'utf8')}\0`)
		.update(text, 'utf8')
		.digest('hex');

const isPlainFile = (e: TreeFile | undefined): boolean =>
	e === undefined || (e.type === 'blob' && (e.mode === '100644' || e.mode === '100755'));

/** Whether writing `path` would meet a folder in `files`: a file where a folder is, or under a file. */
function meetsFolder(path: string, files: Files): boolean {
	const folders = path.split('/').slice(0, -1);
	if (folders.some((_, i) => files.has(folders.slice(0, i + 1).join('/')))) return true;
	for (const other of files.keys()) if (other.startsWith(`${path}/`)) return true;
	return false;
}

/**
 * The writes an accepted run makes on top of `main`'s tree, or the first rule the run breaks. Every
 * path both sides changed (to different entries) must be in the run's files, and every run file
 * must be such a path or a regenerated file of a rule; a choice of `main` or `change` must carry
 * that side's own content, so the message's account of it is true.
 */
export function planMerge(
	base: Files,
	head: Files,
	main: Files,
	files: MergeRunFile[],
): { problem: string } | { plan: Plan } {
	const byPath = new Map(files.map((f) => [f.path, f]));
	const writes: Write[] = [];
	const resolved: MergeRunFile[] = [];
	const used = new Set<string>();
	const identical = new Set<string>();
	const final: Files = new Map(main);
	for (const path of new Set([...base.keys(), ...head.keys(), ...main.keys()])) {
		const h = !same(base.get(path), head.get(path));
		const m = !same(base.get(path), main.get(path));
		if (h && m) {
			if (same(head.get(path), main.get(path))) {
				identical.add(path);
				continue;
			}
			const file = byPath.get(path);
			if (!file) return { problem: 'a path both sides changed has no resolution' };
			used.add(path);
			if (!isPlainFile(head.get(path)) || !isPlainFile(main.get(path))) {
				return { problem: 'a path both sides changed is a link or a submodule' };
			}
			const side = file.choice === 'main' ? main : file.choice === 'change' ? head : null;
			if (side) {
				const entry = side.get(path);
				const matches =
					file.content === null
						? entry === undefined
						: entry !== undefined &&
							entry.sha === blobSha(file.content) &&
							entry.mode === file.mode;
				if (!matches) return { problem: "a file's choice does not match its content" };
			}
			resolved.push(file);
		} else if (h) {
			const entry = head.get(path);
			writes.push({
				path,
				mode: entry?.mode ?? '100644',
				type: entry?.type ?? 'blob',
				sha: entry?.sha ?? null,
				content: null,
				from: 'head',
			});
			if (entry) final.set(path, entry);
			else final.delete(path);
		}
	}
	for (const file of files) {
		if (identical.has(file.path)) continue;
		if (!used.has(file.path) && !isRegenerated(file)) {
			return { problem: 'it writes a path that neither side both changed nor a rule regenerates' };
		}
		if (!isPlainFile(main.get(file.path)) || !isPlainFile(head.get(file.path))) {
			return { problem: 'it writes over a link or a submodule' };
		}
		writes.push({
			path: file.path,
			mode: file.mode,
			type: 'blob',
			sha: null,
			content: file.content,
			from: 'run',
		});
		if (file.content === null) final.delete(file.path);
		else final.set(file.path, { mode: file.mode, type: 'blob', sha: '' });
	}
	for (const w of writes) {
		if (w.sha === null && w.content === null) continue;
		const rest = new Map(final);
		rest.delete(w.path);
		if (meetsFolder(w.path, rest)) {
			return { problem: 'a path would be a file where main or the branch has a folder' };
		}
	}
	return { plan: { writes: dedupe(writes), resolved } };
}

/** A regenerated file that is also both-changed is one write: the run's, which comes last. */
function dedupe(writes: Write[]): Write[] {
	const last = new Map(writes.map((w) => [w.path, w]));
	return [...last.values()];
}

/** The text sides of a resolved file, read by the caller: null for a file a side lacks. */
export interface Sides {
	main: string | null;
	head: string | null;
}

/**
 * The first rule the run's own text breaks, against what the sides hold: in a line neither side
 * has, a secret or a comment that switches a check off; a `package.json` that changes what installs
 * or what runs by itself; a ratchet that grows. Regenerated files of the build rules are proved by
 * CI (runtime-bytes, vendored bundles), as §3 says, so their lines are not read.
 */
export function contentProblem(file: MergeRunFile, sides: Sides): string | null {
	if (file.content === null) return null;
	const name = baseName(file.path);
	if (isRatchet(file.path)) {
		const problem = ratchetProblem(name, sides.main, file.content);
		if (problem) return problem;
	}
	if (name === 'package.json') {
		const problem = packageProblem(sides.main, file.content);
		if (problem) return problem;
	}
	if (file.rule === 'runtime-bytes' || file.rule === 'vendored-bundle') return null;
	const held = `${sides.main ?? ''}\n${sides.head ?? ''}`;
	for (const line of addedLines(held, file.content)) {
		if (secretIn(line)) return 'secret scan: a secret in a line neither side had';
		const off = switchedOff(line);
		if (off) return off;
	}
	return null;
}

// ── The commit's words ────────────────────────────────────────────────────────

const CHOICE_WORDS: Record<MergeChoice, string> = {
	main: "took main's",
	change: "kept this change's",
	both: 'kept both',
	combined: 'combined both',
	regenerated: 'regenerated',
};
const RULE_WORDS: Record<MergeRule, string> = {
	'runtime-bytes': 'runtime bytes re-recorded',
	'vendored-bundle': 'bundle rebuilt',
	'docs-append': 'docs lines kept from both',
	ratchet: 'ratchet lowered',
};
const LISTED = 50;

/**
 * The merge commit's message: each file's choice, then who accepted it. Every CI-skip directive is
 * taken out of it — a path or a name could spell one — so the push runs the checks.
 */
export function mergeMessage(input: {
	branch: string;
	runId: string;
	mainSha: string;
	files: Pick<MergeRunFile, 'path' | 'choice' | 'rule'>[];
	person: string | null;
}): string {
	const lines = input.files
		.slice(0, LISTED)
		.map(
			(f) => `- ${f.path}: ${CHOICE_WORDS[f.choice]}${f.rule ? ` (${RULE_WORDS[f.rule]})` : ''}`,
		);
	const more = input.files.length - LISTED;
	return withoutDirectives(
		[
			`Merge main into ${input.branch}`,
			'',
			`Resolved against main at ${input.mainSha.slice(0, 7)}.`,
			...(lines.length ? ['', ...lines, ...(more > 0 ? [`- …and ${more} more`] : [])] : []),
			'',
			`Accepted by ${cleanPerson(input.person)} in Pipeline Changes (merge run ${input.runId})`,
		].join('\n'),
	);
}
