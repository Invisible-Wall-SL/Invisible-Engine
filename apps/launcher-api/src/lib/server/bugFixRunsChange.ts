import { PATTERNS } from '../../../../../scripts/check-secrets.mjs';
import { SCOPES, squashSubjectHasScope } from '../../../../../scripts/commit-scope.mjs';
import {
	capText,
	fixRunTitle,
	type FixRunFile,
	type FixRunOutcome,
	type FixRunSecondBug,
} from '$lib/bugFixRuns';
import { bugRef, bugRefsIn, isBugArea, unlinkBugRefs } from '$lib/bugReports';
import { mapWithConcurrency } from './concurrency';
import { CI_SKIP } from './pipelineMerge';

/**
 * What a fix run's result may publish (ADR-0013 §5), apart from the GitHub calls that read its base
 * and write its change (`bugFixRuns.ts`). The result is untrusted — a model wrote it, steered by
 * text people wrote — so its words are cleaned before anything public carries them, and its change
 * is held to the rules a person would otherwise check by eye. A refusal names the rule in the
 * launcher's own words, never a path, mode or value the result chose: the reason is shown on the
 * bug, and the result is not to write there.
 */

/** A result as read (`FixRunResultBody`), before its words are cleaned or its change judged. */
export interface ParsedResult {
	baseSha: string | null;
	outcome: FixRunOutcome | null;
	failure: string | null;
	title: string;
	scope: string;
	summary: string;
	lesson: string;
	gates: { command: string; ok: boolean }[];
	secondBug: FixRunSecondBug | null;
	files: FixRunFile[];
}

export const MAX_TITLE = 120;
export const MAX_SUMMARY = 2_000;
const MAX_LESSON = 4_000;
const MAX_COMMAND = 300;
const MAX_AREA = 40;
const MAX_FILES = 40;
const MAX_CHANGE_BYTES = 400 * 1024;
const MAX_PATH = 300;
const MODES = ['100644', '100755'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

// ── The run's words ───────────────────────────────────────────────────────────

const FORMAT = /\p{Cf}/gu;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g;
const CI_SKIPS = new RegExp(CI_SKIP.source, 'gi');
const URL_TOKEN = /^https?:\/\/\S+$/i;

/** `text` with every CI-skip directive taken out, again until none is left (one taken out can
 *  join the pieces of another: `[skip [skip ci]ci]`). Newlines are kept. */
function withoutDirectives(text: string): string {
	let out = text;
	while (CI_SKIP.test(out)) out = out.replace(CI_SKIPS, '');
	return out;
}

/** No format characters (zero-width, bidi, tags), HTML comments or tags, or CI-skip directives —
 *  taken out until none is left, as taking one out can join another. */
function plain(text: string): string {
	let out = text;
	for (let before = ''; before !== out;) {
		before = out;
		out = withoutDirectives(
			out.replace(FORMAT, '').replace(HTML_COMMENT, '').replace(HTML_TAG, ''),
		);
	}
	return out;
}

/**
 * `@name` pages someone, and `#12` / `GH-12` link an issue, in a public pull request: a word
 * joiner after the mark keeps the text as written without either (as the Agents tab does). Only a
 * whole http(s) URL is left whole — not any token with `://` in it.
 */
export const quiet = (text: string): string =>
	text.replace(/\S+/g, (token) =>
		URL_TOKEN.test(token)
			? token
			: token.replace(/([@#])(?=\w)/g, '$1\u2060').replace(/\b(GH-)(?=\d)/gi, '$1\u2060'),
	);

/**
 * Run text as stored and published: plain, capped by code points, then unlinked (`BUG-7` →
 * `bug #7` — after the cut, so a cut cannot make a reference out of a longer number) and quiet.
 */
export function cleanText(text: string, max: number): string {
	return quiet(unlinkBugRefs(capText(plain(text.replace(/\r\n?/g, '\n')).trim(), max))).trim();
}

/** One line of run text: whitespace runs made one space, before the cut and after the strip. */
export const cleanLine = (text: string, max: number): string =>
	cleanText(text.replace(/\s+/g, ' '), max).replace(/\s+/g, ' ');

/** A result's words, cleaned: what the bug page stores and the pull request carries. */
export interface FixRunText {
	title: string;
	summary: string;
	lesson: string;
	gates: { command: string; ok: boolean }[];
	secondBug: FixRunSecondBug | null;
}

export function cleanResult(r: ParsedResult): FixRunText {
	return {
		title: cleanLine(r.title, MAX_TITLE),
		summary: cleanText(r.summary, MAX_SUMMARY),
		lesson: cleanText(r.lesson, MAX_LESSON),
		gates: r.gates.map((g) => ({
			command: cleanLine(g.command, MAX_COMMAND).replace(/`/g, "'"),
			ok: g.ok,
		})),
		secondBug: r.secondBug && {
			area:
				isBugArea('pipeline', r.secondBug.area) && r.secondBug.area.length <= MAX_AREA
					? r.secondBug.area
					: 'other',
			title: cleanLine(r.secondBug.title, MAX_TITLE),
			evidence: cleanText(r.secondBug.evidence, MAX_SUMMARY),
		},
	};
}

/** Who started the run, as the PR names them: the account's own name, never its email. */
export const cleanPerson = (name: string | null): string =>
	quiet(
		plain(name ?? '')
			.replace(/[`\s]+/g, ' ')
			.trim(),
	) || 'a launcher user';

/** A name as the privacy rule compares it: NFKC, lower case, letters and digits only. */
export const fold = (text: string): string =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');

/** The names the public text must not carry, folded; one under 4 characters is too common to refuse. */
export const privateNames = (names: (string | null)[]): string[] => [
	...new Set(
		names
			.filter((n): n is string => !!n)
			.map(fold)
			.filter((n) => n.length >= 4),
	),
];

// ── The rules that need no GitHub ─────────────────────────────────────────────

/**
 * Paths a run never changes, from the repo root, in lower case — anything at or under one: hooks,
 * the secret scanner, the fix-run harness, the current-games harness, runtime agents and families,
 * knowledge, ADRs, the commit-scope rule, the ratchet machinery and the launcher's own fix-run code.
 */
const PROTECTED_PATHS = [
	'scripts/git-hooks',
	'scripts/check-secrets.mjs',
	'scripts/check-secrets.d.mts',
	'scripts/bug-fix',
	'scripts/current-games',
	'services/director-worker/agents',
	'services/director-worker/families',
	'docs/knowledge',
	'docs/director/decisions',
	'scripts/commit-scope.mjs',
	'scripts/commit-scope.d.mts',
	'scripts/check-commit-scope.mjs',
	'scripts/svelte-check-ratchet.mjs',
	'scripts/svelte-check-ratchet.test.mjs',
	'scripts/check-all.mjs',
	'scripts/agents-knowledge-baseline.json',
	'scripts/check-agents-knowledge.mjs',
	'apps/launcher-api/src/lib/bugfixruns.ts',
	'apps/launcher-api/src/lib/server/githuboidc.ts',
	'apps/launcher-api/scripts/check-bug-fix-runs.ts',
];
/** Names protected wherever they appear as a path segment: CI, agents and editor config, git and
 *  npm settings, deploy manifests. */
const PROTECTED_NAMES = [
	'.github',
	'.claude',
	'.vscode',
	'.mcp.json',
	'.gitattributes',
	'.gitmodules',
	'.npmrc',
	'.pnpmfile.cjs',
	'claude.md',
	'codeowners',
	'railway.json',
	'railway.toml',
	'nixpacks.toml',
	'procfile',
	'pyproject.toml',
	'poetry.lock',
	'uv.lock',
];
const PROTECTED_NAME_RULES: [RegExp, string][] = [
	[/^dockerfile(?:\..+)?$|\.dockerfile$/, 'a Dockerfile'],
	[/^requirements.*\.txt$/, 'a Python requirements file'],
	[/^pipfile(?:\..+)?$/, 'a Pipfile'],
	[/^eslint\.config\./, 'the ESLint config'],
];
const PROTECTED_PATH_RULES: [RegExp, string][] = [
	[/^apps\/launcher-api\/src\/lib\/server\/bugfixruns[^/]*\.ts$/, "the launcher's fix-run modules"],
];
/** A new dependency is a person's call: no lockfile, no workspace file, anywhere. */
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'pnpm-workspace.yaml'];
/** Unicode tag characters and bidi controls: text that reads one way and runs another. */
const HIDDEN = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069]/u;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase();

/** The protected entry `path` is or is under — named by the rule, never by the path — or null. */
export function protectedEntry(path: string): string | null {
	const segments = path.toLowerCase().split('/');
	for (let i = 1; i <= segments.length; i++) {
		const prefix = segments.slice(0, i).join('/');
		const name = segments[i - 1];
		if (PROTECTED_PATHS.includes(prefix)) return prefix;
		if (PROTECTED_NAMES.includes(name)) return name;
		for (const [re, label] of PROTECTED_NAME_RULES) if (re.test(name)) return label;
		for (const [re, label] of PROTECTED_PATH_RULES) if (re.test(prefix)) return label;
	}
	return null;
}

function pathProblem(path: string): string | null {
	if (!path || Array.from(path).length > MAX_PATH) {
		return 'a path is empty or longer than 300 characters';
	}
	const control = [...path].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
	if (path.startsWith('/') || path.includes('\\') || control) {
		return 'a path is not a relative POSIX path';
	}
	if (new RegExp(FORMAT.source, 'u').test(path)) return 'a path holds a Unicode format character';
	const segments = path.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) {
		return 'a path has an empty, . or .. segment';
	}
	if (segments.some((s) => s.toLowerCase() === '.git')) return 'a path is inside .git';
	return null;
}

/** `check-secrets.mjs`'s patterns on every line — not its skip list, nor its allowlist pragma or
 *  placeholder pass, which a run could write — and any `sk-ant-` at all. Names the pattern. */
function secretIn(text: string): string | null {
	if (/sk-ant-/i.test(text)) return 'an sk-ant- string';
	for (const line of text.split('\n')) {
		for (const [label, re] of PATTERNS) if (re.test(line)) return label;
	}
	return null;
}

export interface LocalCheck {
	/** The run's base and its bug. */
	baseSha: string;
	number: number;
	branch: string;
	result: ParsedResult;
	text: FixRunText;
	/** The scope as it would be published (trimmed, lower case). */
	scope: string;
	/** {@link privateNames} of the bug's project and client. */
	names: string[];
}

/**
 * The first rule (ADR-0013 §5) a change breaks that needs no GitHub: its base, its proof (a file,
 * a gate that passed), the paths and modes it asks for, its size, its text, the commit scope, a
 * title naming this bug alone, secrets in what is public and in the paths, and the bug's project or
 * client in what is public. Null when none.
 */
export function localProblem(c: LocalCheck): string | null {
	const r = c.result;
	if (r.baseSha !== c.baseSha) return 'it is not based on the commit the run was given';
	if (!r.files.length || !r.gates.some((g) => g.ok)) {
		return 'a fix needs a changed file and a gate that passed';
	}
	if (r.files.length > MAX_FILES) return `it changes more than ${MAX_FILES} files`;
	const seen = new Set<string>();
	let bytes = 0;
	for (const f of r.files) {
		const problem = pathProblem(f.path);
		if (problem) return problem;
		const key = f.path.toLowerCase();
		if (seen.has(key)) return 'it lists one path twice';
		seen.add(key);
		const guarded = protectedEntry(f.path);
		if (guarded) return `it touches a protected path (${guarded})`;
		const lock = LOCK_NAMES.find((n) => n === baseName(f.path));
		if (lock) return `it changes ${lock}: dependencies are a person's call`;
		if (f.mode !== undefined && !MODES.includes(f.mode)) {
			return 'it sets a mode other than 100644 or 100755';
		}
		if (f.content !== null) {
			if (!f.content.isWellFormed() || f.content.includes('\u0000')) {
				return 'a file is not UTF-8 text';
			}
			if (HIDDEN.test(f.content)) return 'a file holds Unicode tag or bidi control characters';
			bytes += Buffer.byteLength(f.content, 'utf8');
		}
	}
	if (bytes > MAX_CHANGE_BYTES) return 'it adds more than 400 KB';
	const title = fixRunTitle(c.scope, c.number, c.text.title);
	if (!SCOPES.includes(c.scope) || !squashSubjectHasScope(title)) {
		return 'the scope is not one commit subjects take';
	}
	if (!c.text.title) return 'it has no title';
	if (bugRefsIn(`${title}\n${c.branch}`).join() !== String(c.number)) {
		return 'its title would name another bug';
	}
	const said: [string, string, string][] = [
		['the title', r.title, c.text.title],
		['the summary', r.summary, c.text.summary],
		['the lesson', r.lesson, c.text.lesson],
		...r.gates.map((g, i): [string, string, string] => [
			'a gate command',
			g.command,
			c.text.gates[i].command,
		]),
	];
	for (const [where, raw] of said) {
		const found = secretIn(raw);
		if (found) return `secret scan: ${found} in ${where}`;
	}
	for (const f of r.files) {
		const found = secretIn(f.path);
		if (found) return `secret scan: ${found} in a path`;
	}
	for (const [where, raw, clean] of said) {
		const folded = [fold(raw), fold(clean)];
		if (c.names.some((n) => folded.some((t) => t.includes(n)))) {
			return `privacy: ${where} names the bug's project or client`;
		}
	}
	return null;
}

// ── The rules against the base ────────────────────────────────────────────────

/** One entry of the base commit's tree (`GET …/git/trees/<sha>?recursive=1`). */
export interface BaseEntry {
	mode: string;
	type: string;
	sha: string;
}

/** The run's base as the checks read it: its whole tree, and a file's text by its path. */
export interface BaseTree {
	treeSha: string;
	entries: Map<string, BaseEntry>;
	read(path: string): Promise<string>;
}

/** A `package.json` must keep these as they are: what installs, and how it installs. */
const PACKAGE_KEYS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'pnpm',
	'overrides',
	'resolutions',
	'packageManager',
	'engines',
	'dependenciesMeta',
	'peerDependenciesMeta',
	'bundleDependencies',
	'bundledDependencies',
];
/** The scripts npm and pnpm run by themselves; any other script may change. */
const LIFECYCLE_SCRIPTS = [
	'preinstall',
	'install',
	'postinstall',
	'prepare',
	'preprepare',
	'postprepare',
	'prepublish',
	'prepublishOnly',
	'prepack',
	'postpack',
];
/** The ratchets: they may only shrink. */
const RATCHET_NAMES = ['svelte-check-baseline.json', 'eslint-suppressions.json'];
/** Comments that switch a check off: a new one is a person's call. */
const SUPPRESSIONS = [
	'eslint-disable',
	'@ts-ignore',
	'@ts-nocheck',
	'@ts-expect-error',
	'svelte-ignore',
];

function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
	if (isRecord(v)) {
		return `{${Object.keys(v)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
			.join(',')}}`;
	}
	return v === undefined ? 'undefined' : JSON.stringify(v);
}

function jsonObject(text: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(text);
		return isRecord(v) ? v : null;
	} catch {
		return null;
	}
}

/** Every numeric leaf of a JSON tree by its path: a ratchet's entries and counts. */
function counts(v: unknown, path = '', out = new Map<string, number>()): Map<string, number> {
	if (typeof v === 'number') out.set(path, v);
	else if (isRecord(v)) {
		for (const [k, child] of Object.entries(v)) counts(child, `${path}/${k}`, out);
	} else if (Array.isArray(v)) v.forEach((child, i) => counts(child, `${path}/${i}`, out));
	return out;
}

function packageProblem(before: string | null, after: string | null): string | null {
	const was = before === null ? {} : jsonObject(before);
	const now = after === null ? {} : jsonObject(after);
	if (!was || !now) return 'a package.json is not a JSON object';
	const key = PACKAGE_KEYS.find((k) => canonical(was[k]) !== canonical(now[k]));
	if (key) return `a package.json changes ${key}`;
	const scripts = (o: Record<string, unknown>) => (isRecord(o.scripts) ? o.scripts : {});
	const script = LIFECYCLE_SCRIPTS.find(
		(s) => canonical(scripts(was)[s]) !== canonical(scripts(now)[s]),
	);
	return script ? `a package.json changes its ${script} script` : null;
}

function ratchetProblem(name: string, before: string | null, after: string | null): string | null {
	if (after === null) return `${name} is deleted`;
	if (before === null) return `${name} is new`;
	const was = jsonObject(before);
	const now = jsonObject(after);
	if (!was || !now) return `${name} is not a JSON object`;
	const prior = counts(was);
	return [...counts(now)].some(([path, n]) => n > (prior.get(path) ?? 0)) ? `${name} grows` : null;
}

/** The lines of `after` that `before` does not have: what the change adds. */
const addedLines = (before: string | null, after: string): string[] => {
	const had = new Set(before === null ? [] : before.split('\n'));
	return after.split('\n').filter((line) => !had.has(line));
};

/**
 * The first rule the change breaks against its base, read once as a whole tree: a protected path
 * under a directory it changes; a file written over a directory or under a file; a deletion of
 * anything but a file; an entry whose mode is not a plain or executable file (a link, a
 * submodule); a new path that differs from another only by case; then, from the base copies of the
 * files it changes, a `package.json` that changes what installs or how, a ratchet that grows, and
 * in the lines it ADDS a secret or a comment that switches a check off.
 */
export async function baseProblem(files: FixRunFile[], base: BaseTree): Promise<string | null> {
	const paths = [...base.entries.keys()];
	const byCase = new Set(paths.map((p) => p.toLowerCase()));
	for (const f of files) {
		const under = paths.find((p) => p.startsWith(`${f.path}/`) && protectedEntry(p));
		if (under) return `it changes a directory holding a protected path (${protectedEntry(under)})`;
		const segments = f.path.split('/');
		for (let i = 1; i < segments.length; i++) {
			const above = base.entries.get(segments.slice(0, i).join('/'));
			if (above && above.type !== 'tree')
				return 'it writes under a path that is a file in the base';
		}
		const entry = base.entries.get(f.path);
		if (entry?.type === 'tree') {
			return f.content === null
				? 'it deletes a directory'
				: 'it writes a file where the base has a directory';
		}
		if (entry && !(entry.type === 'blob' && MODES.includes(entry.mode))) {
			return 'it changes an entry whose mode is not 100644 or 100755 (a link or a submodule)';
		}
		if (!entry && f.content === null) return 'it deletes something that is not a file in the base';
		if (!entry && byCase.has(f.path.toLowerCase())) {
			return 'it adds a path that differs from another only by case';
		}
	}
	const needed = files.filter(
		(f) => base.entries.has(f.path) && (f.content !== null || baseName(f.path) === 'package.json'),
	);
	const before = new Map(
		await mapWithConcurrency(needed, 4, async (f) => [f.path, await base.read(f.path)] as const),
	);
	for (const f of files) {
		const was = before.get(f.path) ?? null;
		const name = baseName(f.path);
		if (name === 'package.json') {
			const problem = packageProblem(was, f.content);
			if (problem) return problem;
		}
		const ratchet = RATCHET_NAMES.find((n) => n === name);
		if (ratchet) {
			const problem = ratchetProblem(ratchet, was, f.content);
			if (problem) return problem;
		}
		if (f.content === null) continue;
		for (const line of addedLines(was, f.content)) {
			const found = secretIn(line);
			if (found) return `secret scan: ${found} in a file`;
			const off = SUPPRESSIONS.find((s) => line.includes(s));
			if (off) return `it adds a suppression comment (${off})`;
		}
	}
	return null;
}

/** Each file with the mode it is written with: as asked, else its base mode (the exec bit kept),
 *  else a plain file. */
export const withModes = (files: FixRunFile[], base: BaseTree) =>
	files.map((f) => ({
		path: f.path,
		content: f.content,
		mode: (f.mode ?? base.entries.get(f.path)?.mode ?? '100644') as '100644' | '100755',
	}));

// ── What is published ─────────────────────────────────────────────────────────

function lessonBlock(lesson: string): string {
	if (/^##\s*Lesson\b/m.test(lesson)) return lesson;
	return `## Lesson\n${lesson || '- (The run gave none.)'}`;
}

/**
 * The pull request's title and body, and the commit's message: the run's cleaned words, who
 * started it from which bug, and the Actions run — never the bug's description, screenshots,
 * project or client. No CI-skip directive survives into any of them.
 */
export function publication(p: {
	number: number;
	runId: string;
	scope: string;
	text: FixRunText;
	person: string;
	actionsUrl: string | null;
}): { title: string; message: string; body: string } {
	const title = withoutDirectives(fixRunTitle(p.scope, p.number, p.text.title));
	const started = `from ${bugRef(p.number)}`;
	const body = [
		p.text.summary || '(The run gave no summary.)',
		'',
		'**Gates run**',
		...p.text.gates.map((g) => `- \`${g.command}\` — ${g.ok ? 'passed' : 'failed'}`),
		'',
		lessonBlock(p.text.lesson),
		'',
		`Started by \`${p.person}\` ${started} (fix run ${p.runId}).`,
		...(p.actionsUrl === null ? [] : ['', p.actionsUrl]),
	].join('\n');
	return {
		title,
		message: withoutDirectives(
			`${title}\n\nFix run ${p.runId}, started by ${p.person} ${started}.`,
		),
		body: withoutDirectives(body),
	};
}
