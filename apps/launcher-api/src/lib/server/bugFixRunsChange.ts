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

/** How much of each field is kept, in code points. */
export const TEXT_CAPS = {
	title: 120,
	summary: 2_000,
	lesson: 4_000,
	command: 300,
	area: 40,
	scope: 40,
} as const;
/** A field over this many times its cap is refused as unread: the cleaning is not handed megabytes. */
export const TEXT_SLACK = 4;
export const MAX_TITLE = TEXT_CAPS.title;
export const MAX_SUMMARY = TEXT_CAPS.summary;
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
/** A `<` that could open a tag, a comment or a declaration in any HTML parser, however lenient. */
const TAG_OPEN = /<(?=[A-Za-z/!?])/g;
const CI_SKIPS = new RegExp(CI_SKIP.source, 'gi');
const URL_TOKEN = /^https?:\/\/\S+$/i;
/** A link to an issue or pull request, which GitHub cross-references — and closes, after "Fixes". */
const GITHUB_REF_URL = /^(https?:\/\/)(github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d)/i;
/**
 * Taking a tag or a directive out can join the pieces of another (`<<b>b>`, `[skip [skip ci]ci]`),
 * so it is done again — this many times at most, each pass linear. Text still changing after that
 * was built to make the passes quadratic: it loses every bracket, so nothing can form again.
 */
const STRIP_PASSES = 8;

/** `strip` until the text stops changing, at most {@link STRIP_PASSES} times; then every `<`, `>`,
 *  `[` and `]` goes, which no tag, comment or directive survives. */
function stable(text: string, strip: (t: string) => string): string {
	let out = text;
	for (let pass = 0; pass < STRIP_PASSES; pass++) {
		const next = strip(out);
		if (next === out) return out;
		out = next;
	}
	return strip(out.replace(/[<>[\]]/g, ''));
}

/** `text` with no CI-skip directive left. Newlines are kept. */
const withoutDirectives = (text: string): string => stable(text, (t) => t.replace(CI_SKIPS, ''));

/** A tag as text, never markup: a placeholder such as `<Month>` keeps its word, as `‹Month›`. */
const showTag = (tag: string): string => `‹${tag.slice(1, -1)}›`;

/** One pass: format characters, HTML comments and CI-skip directives out; tags through `tag`, and
 *  any other `<` that opens a tag replaced by `open`. */
const scrub = (t: string, tag: (found: string) => string, open: string): string =>
	t
		.replace(FORMAT, '')
		.replace(HTML_COMMENT, '')
		.replace(HTML_TAG, tag)
		.replace(TAG_OPEN, open)
		.replace(CI_SKIPS, '');

/** No format characters (zero-width, bidi, tags), HTML comments or CI-skip directives, and no `<`
 *  that opens a tag: a tag is shown as text (`showTag`), any other such `<` as `‹`. */
const plain = (text: string): string => stable(text, (t) => scrub(t, showTag, '‹'));

/** `plain` with every tag taken out instead: a key split by an empty tag (`sk-<b></b>ant-…`)
 *  reads whole here, which is how the secret scan and the privacy rule still find it. */
const unmarked = (text: string): string => stable(text, (t) => scrub(t, () => '', ''));

/**
 * `@name` pages someone, and `#12` / `GH-12` link an issue, in a public pull request: a word
 * joiner after the mark keeps the text as written without either (as the Agents tab does). A whole
 * http(s) URL is left whole — not any token with `://` in it — except a link to an issue or pull
 * request on GitHub, whose scheme a joiner breaks, so it is neither cross-referenced nor closed.
 */
export const quiet = (text: string): string =>
	text.replace(/\S+/g, (token) =>
		URL_TOKEN.test(token)
			? token.replace(GITHUB_REF_URL, '$1\u2060$2')
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
		title: cleanLine(r.title, TEXT_CAPS.title),
		summary: cleanText(r.summary, TEXT_CAPS.summary),
		lesson: cleanText(r.lesson, TEXT_CAPS.lesson),
		gates: r.gates.map((g) => ({
			command: cleanLine(g.command, TEXT_CAPS.command).replace(/`/g, "'"),
			ok: g.ok,
		})),
		secondBug: r.secondBug && {
			area:
				isBugArea('pipeline', r.secondBug.area) && r.secondBug.area.length <= TEXT_CAPS.area
					? r.secondBug.area
					: 'other',
			title: cleanLine(r.secondBug.title, TEXT_CAPS.title),
			evidence: cleanText(r.secondBug.evidence, TEXT_CAPS.summary),
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
 * the worker's untrusted-text wrapper, knowledge, ADRs, the commit-scope rule, the ratchet
 * machinery, the launcher's own fix-run code, routes and fixtures, what they lean on (the bug
 * vocabulary, the concurrency helpers, the GitHub App every commit and merge goes through), the
 * Pipeline Changes API that gates, merges and reverts a run's PR and its fixtures, the configs that
 * decide what an import loads — and the launcher's migrations and their runner, which run against
 * production at boot, so a schema change is a person's call.
 */
const PROTECTED_PATHS = [
	'scripts/git-hooks',
	'scripts/check-secrets.mjs',
	'scripts/check-secrets.d.mts',
	'scripts/bug-fix',
	'scripts/current-games',
	'services/director-worker/agents',
	'services/director-worker/families',
	'services/director-worker/src/untrusted.ts',
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
	'apps/launcher-api/src/lib/bugreports.ts',
	'apps/launcher-api/src/lib/server/concurrency.ts',
	'apps/launcher-api/src/lib/server/db/migrate.ts',
	'apps/launcher-api/src/lib/server/githubapp.ts',
	'apps/launcher-api/src/lib/server/githuboidc.ts',
	'apps/launcher-api/src/routes/api/pipeline',
	'apps/launcher-api/src/routes/api/bugs/[number]/fix-runs',
	'apps/launcher-api/scripts/check-bug-fix-runs.ts',
	'apps/launcher-api/scripts/check-bug-reports.ts',
	'apps/launcher-api/scripts/check-pipeline-changes.ts',
	'apps/launcher-api/scripts/check-pipeline-games.ts',
	'apps/launcher-api/vite.config.js',
	'apps/launcher-api/svelte.config.js',
	'apps/launcher-api/drizzle',
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
const PIPELINE_MODULES = "Invisible Pipeline Changes' server modules";
/** Modules directly in the launcher's `server/`, by name (a folder named alike is not one): the
 *  fix-run ones, and Pipeline Changes' — the console that gates, merges and reverts a run's PR is
 *  not changed by the run it judges. */
const PROTECTED_PATH_RULES: [RegExp, string][] = [
	[/^apps\/launcher-api\/src\/lib\/server\/bugfix[^/]*\.ts$/, "the launcher's fix-run modules"],
	[/^apps\/launcher-api\/src\/lib\/server\/pipeline[^/]*\.ts$/, PIPELINE_MODULES],
];
/** An extensionless import loads a file of that exact name, then `.mjs`, then `.js`, before the
 *  `.ts` beside it (Vite); the other source extensions are refused alike. */
const SIBLING_SOURCE = /\.(?:js|mjs|cjs|mts|cts|jsx|tsx)$/i;
/** A new dependency is a person's call: no lockfile, no workspace file, anywhere. */
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'pnpm-workspace.yaml'];
/** Unicode tag characters and bidi controls: text that reads one way and runs another. */
const HIDDEN = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069]/u;
/** Printable ASCII: every path in the repository is, and a path that is not can hide what it is. */
const PATH_CHARS = /^[\x20-\x7e]+$/;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase();

/** The protected entry `path` is or is under — named by the rule, never by the path — or null. A
 *  source file, or one with no extension, beside a protected `.ts` counts as that file. */
export function protectedEntry(path: string): string | null {
	const asTs = SIBLING_SOURCE.test(path) ? path.replace(SIBLING_SOURCE, '.ts') : `${path}.ts`;
	return entryOf(path) ?? entryOf(asTs);
}

function entryOf(path: string): string | null {
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
	if (!path || path.length > MAX_PATH) return 'a path is empty or longer than 300 characters';
	if (!PATH_CHARS.test(path)) return 'a path holds a character outside printable ASCII';
	if (path.startsWith('/') || path.includes('\\')) return 'a path is not a relative POSIX path';
	const segments = path.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) {
		return 'a path has an empty, . or .. segment';
	}
	if (segments.some((s) => s.toLowerCase() === '.git')) return 'a path is inside .git';
	// Windows drops a trailing dot or space: the checkout would hold another path than the PR.
	if (segments.some((s) => s.endsWith('.') || s.endsWith(' '))) {
		return 'a path has a segment ending in a dot or a space';
	}
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
 * client in what is public. The public text is read as written, as cleaned and with its tags taken
 * out: taking characters out can join a key or a name back together. Null when none.
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
	for (const [where, raw, clean] of said) {
		const found = secretIn(raw) ?? secretIn(clean) ?? secretIn(unmarked(raw));
		if (found) return `secret scan: ${found} in ${where}`;
	}
	for (const f of r.files) {
		const found = secretIn(f.path);
		if (found) return `secret scan: ${found} in a path`;
	}
	for (const [where, raw, clean] of said) {
		const folded = [fold(raw), fold(clean), fold(unmarked(raw))];
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
/** The scripts npm and pnpm run by themselves: a new one is never added. */
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
	'pnpm:devPreinstall',
];
/** A script name a package manager may run before or after another, or by itself. */
const isHookScript = (name: string): boolean =>
	LIFECYCLE_SCRIPTS.includes(name) || /^(?:pre|post|pnpm:)/.test(name);
/** The ratchets: they may only shrink. */
const RATCHET_NAMES = ['svelte-check-baseline.json', 'eslint-suppressions.json'];
/** Comments that switch a check off, in lower case: a new one is a person's call. */
const SUPPRESSIONS = [
	'eslint-disable',
	'@ts-ignore',
	'@ts-nocheck',
	'@ts-expect-error',
	'svelte-ignore',
];
/** ESLint configured from inside a file: rules, globals and environments the config never set. */
const ESLINT_INLINE = [
	/\/\*\s*(?:eslint|globals?|exported)\s/i,
	/\/\/\s*eslint-/i,
	/<!--\s*eslint/i,
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

/**
 * Every leaf of a ratchet by its path, the path a JSON array of its keys (so no two paths read
 * alike, as `a/b` and `a` + `b` would joined by a slash); null when any leaf is not a number — a
 * count written as `"99"` is not one, and is not compared.
 */
function counts(
	v: unknown,
	path: (string | number)[] = [],
	out = new Map<string, number>(),
): Map<string, number> | null {
	if (typeof v === 'number') {
		out.set(JSON.stringify(path), v);
		return out;
	}
	if (!isRecord(v) && !Array.isArray(v)) return null;
	const children: [string | number, unknown][] = Array.isArray(v)
		? v.map((child, i) => [i, child])
		: Object.entries(v);
	for (const [key, child] of children) if (!counts(child, [...path, key], out)) return null;
	return out;
}

/**
 * A `package.json` may change its name, description and the like, and add a script — but not what
 * installs or how, not a script it already has (CI runs them: `pnpm lint`, each fixture through its
 * own script), and not a new script a package manager runs by itself.
 */
function packageProblem(before: string | null, after: string | null): string | null {
	const was = before === null ? {} : jsonObject(before);
	const now = after === null ? {} : jsonObject(after);
	if (!was || !now) return 'a package.json is not a JSON object';
	const key = PACKAGE_KEYS.find((k) => canonical(was[k]) !== canonical(now[k]));
	if (key) return `a package.json changes ${key}`;
	const scripts = (o: Record<string, unknown>) => (isRecord(o.scripts) ? o.scripts : {});
	const had = scripts(was);
	const has = scripts(now);
	if (Object.keys(had).some((s) => canonical(had[s]) !== canonical(has[s]))) {
		return 'a package.json changes or removes a script it has';
	}
	if (Object.keys(has).some((s) => !Object.hasOwn(had, s) && isHookScript(s))) {
		return 'a package.json adds a script a package manager runs by itself';
	}
	return null;
}

function ratchetProblem(name: string, before: string | null, after: string | null): string | null {
	if (after === null) return `${name} is deleted`;
	if (before === null) return `${name} is new`;
	const was = jsonObject(before);
	const now = jsonObject(after);
	if (!was || !now) return `${name} is not a JSON object`;
	const prior = counts(was);
	const next = counts(now);
	if (!prior || !next) return `${name} holds a count that is not a number`;
	return [...next].some(([path, n]) => n > (prior.get(path) ?? 0)) ? `${name} grows` : null;
}

/** The lines of `after` that `before` does not have, counted: a line the base holds once and the
 *  change twice is added once. */
function addedLines(before: string | null, after: string): string[] {
	const left = new Map<string, number>();
	for (const line of before?.split('\n') ?? []) left.set(line, (left.get(line) ?? 0) + 1);
	return after.split('\n').filter((line) => {
		const n = left.get(line) ?? 0;
		if (n) left.set(line, n - 1);
		return !n;
	});
}

/** A comment the line adds that switches a check off or configures ESLint, or null. */
function switchedOff(line: string): string | null {
	const lower = line.toLowerCase();
	const off = SUPPRESSIONS.find((s) => lower.includes(s));
	if (off) return `it adds a suppression comment (${off})`;
	return ESLINT_INLINE.some((re) => re.test(line))
		? 'it adds an ESLint configuration comment'
		: null;
}

/**
 * The first rule the change breaks against its base, read once as a whole tree: a protected path
 * under a directory it changes; a file written over a directory or under a file; a deletion of
 * anything but a file; an entry whose mode is not a plain or executable file (a link, a
 * submodule); a new path that differs from another only by case; then, from the base copies of the
 * files it changes, a `package.json` that changes what installs or how, or what CI runs, a ratchet
 * that grows, and in the lines it ADDS a secret or a comment that switches a check off.
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
			const off = switchedOff(line);
			if (off) return off;
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

/** The pull request's title and body and the commit's message, as `publication` makes them. */
export interface Publication {
	title: string;
	message: string;
	body: string;
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
}): Publication {
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

/** The last look before anything is written: a secret in what will be public, exactly as it goes. */
export function publicationProblem(pub: Publication): string | null {
	for (const [where, text] of [
		['the pull request title', pub.title],
		['the commit message', pub.message],
		['the pull request body', pub.body],
	] as const) {
		const found = secretIn(text);
		if (found) return `secret scan: ${found} in ${where}`;
	}
	return null;
}
