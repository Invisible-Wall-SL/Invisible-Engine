// What starts `current-games.yml`, and what its `prepare` job skips (ADR-0013 fix runs). The
// launcher's GitHub App commits model-written code to `bug-<n>-fix-<id>` and opens it as a DRAFT
// PR; the harness's later jobs hold repository secrets, so that code must not run beside them until
// a person marks the PR ready for review. Every other branch and PR must run exactly as before.
//
// This reads the workflow as text and pins the `push.branches-ignore` list, the `pull_request`
// types, the concurrency group and the `prepare` `if:`. It then EVALUATES that text (a small
// evaluator of GitHub's expression language and filter globs, below) over a matrix of events, and
// checks three things: the result is the table's; a hand-written twin of the rule agrees; and,
// row by row, today's workflow (pinned below as it was) gave the same answer for every ordinary
// branch and PR. The one ordinary event that changes — `ready_for_review` on a PR that is not a fix
// run, which now makes a run whose jobs are all skipped — is proved harmless: its own concurrency
// group, no status from the verdict. Editing the workflow without this file fails here.
//
//   node scripts/current-games/triggers.fixture.mjs

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	checkRun,
	decide,
	decideRequested,
	FIX_RUN_DRAFT,
	isFixRun,
	standsDown,
} from './lib/verdict.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const YML = readFileSync(join(ROOT, '.github/workflows/current-games.yml'), 'utf8').replace(
	/\r\n/g,
	'\n',
);
const REPO = 'Invisible-Wall-SL/Invisible-Engine';

const failures = [];
const check = (ok, message) => {
	if (!ok) failures.push(message);
};

// ---- the pins: what the workflow says, and what it said before the fix-run change ----

const FIX_TEXT =
	"github.event.pull_request.user.type == 'Bot' && " +
	"startsWith(github.event.pull_request.head.ref, 'bug-') && " +
	"contains(github.event.pull_request.head.ref, '-fix-')";
const NEW = {
	branches: ['main'],
	types: ['opened', 'synchronize', 'reopened', 'ready_for_review'],
	ignore: ['main', `bug-*-fix-${'[0-9a-f]'.repeat(10)}`],
	if:
		"github.event_name != 'pull_request' || " +
		'(github.event.pull_request.head.repo.full_name == github.repository && ' +
		"(github.event.action != 'ready_for_review' || " +
		`(${FIX_TEXT})) && ` +
		`!(github.event.pull_request.draft && ${FIX_TEXT}))`,
	group:
		'current-games-${{ github.event_name }}-${{ github.event.pull_request.number }}-' +
		'${{ github.event.pull_request.head.sha || github.sha }}-' +
		"${{ inputs.self_compare && 'self-compare' || inputs.base }}" +
		"${{ github.event.action == 'ready_for_review' && '-ready' || '' }}",
};
/** The workflow as it was before (13c5885ff): GitHub's default PR types, only `main` ignored. */
const OLD = {
	branches: ['main'],
	types: ['opened', 'synchronize', 'reopened'],
	ignore: ['main'],
	if: "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
	group:
		'current-games-${{ github.event_name }}-${{ github.event.pull_request.number }}-' +
		'${{ github.event.pull_request.head.sha || github.sha }}-' +
		"${{ inputs.self_compare && 'self-compare' || inputs.base }}",
};

// ---- reading the workflow (only the shapes it uses; anything else fails loudly) ----

/** The lines of a top-level key's block, or of a key nested under it at `indent`. */
function block(lines, key, indent) {
	const start = lines.findIndex((l) => l === `${' '.repeat(indent)}${key}:`);
	if (start < 0) throw new Error(`no "${key}:" at indent ${indent}`);
	const out = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() && !line.startsWith(' '.repeat(indent + 1))) break;
		out.push(line);
	}
	return out;
}
const flowList = (text) =>
	/^\[(.*)\]$/
		.exec(text.trim())[1]
		.split(',')
		.map((s) => s.trim());
const unquote = (s) => s.replace(/^'(.*)'$/, '$1');

function readWorkflow(yml) {
	const lines = yml.split('\n');
	const on = block(lines, 'on', 0);
	const pr = block(on, 'pull_request', 2).filter((l) => !/^\s*#/.test(l));
	const push = block(on, 'push', 2).filter((l) => !/^\s*#/.test(l));
	const value = (ls, key) => ls.find((l) => l.startsWith(`    ${key}:`))?.slice(key.length + 5);
	const ignoreAt = push.findIndex((l) => l === '    branches-ignore:');
	const ignore = [];
	for (const l of push.slice(ignoreAt + 1)) {
		const m = /^ {6}- (.+)$/.exec(l);
		if (!m) break;
		ignore.push(unquote(m[1]));
	}
	if (ignoreAt < 0 || !ignore.length) throw new Error('push.branches-ignore is not a block list');
	const group = /^ {2}group: (.+)$/m.exec(yml.slice(yml.indexOf('\nconcurrency:\n')))?.[1];
	return {
		branches: flowList(value(pr, 'branches')),
		types: flowList(value(pr, 'types') ?? '[opened, synchronize, reopened]'),
		ignore,
		if: jobs(yml).prepare.if,
		group,
	};
}

/** Each job's `needs` and `if:` (one line, or a `>-` block of lines at one indent, folded). */
function jobs(yml) {
	const lines = yml.slice(yml.indexOf('\njobs:\n') + 7).split('\n');
	const out = {};
	let current;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let m;
		if ((m = /^ {2}([\w-]+):\s*$/.exec(line))) out[(current = m[1])] = { needs: [], if: null };
		else if (current && (m = /^ {4}needs:\s*(.+?)\s*$/.exec(line)))
			out[current].needs = m[1].startsWith('[') ? flowList(m[1]) : [m[1]];
		else if (current && line === '    if: >-') {
			const folded = [];
			while (/^ {6}\S/.test(lines[i + 1] ?? '')) folded.push(lines[++i].slice(6));
			if (/^ {7}/.test(lines[i + 1] ?? ''))
				throw new Error(`${current}: a more-indented line would not fold`);
			out[current].if = folded.join(' ');
		} else if (current && (m = /^ {4}if:\s*(.+?)\s*$/.exec(line)))
			out[current].if = m[1].replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
	}
	return out;
}

// ---- GitHub's expression language, the part these expressions use ----
// Loose equality: strings compare case-insensitively; other mixed types compare as numbers (null
// is 0). `&&` / `||` return an operand, like JavaScript. `startsWith` / `contains` are
// case-insensitive and cast to strings. Precedence: `!`, then `==` `!=`, then `&&`, then `||`.

const truthy = (v) => !(v === false || v === 0 || v === '' || v === null || v === undefined);
const toNumber = (v) => {
	if (v === null || v === undefined) return 0;
	if (typeof v === 'boolean') return Number(v);
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const s = v.trim();
		return s === '' ? 0 : /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
	}
	return NaN;
};
const typeOf = (v) => (v === null || v === undefined ? 'null' : typeof v);
const looseEq = (a, b) => {
	if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
	if (typeOf(a) === typeOf(b)) return typeOf(a) === 'null' || a === b;
	return toNumber(a) === toNumber(b);
};
const asString = (v) => (v === null || v === undefined ? '' : String(v));
const BUILTINS = {
	startsWith: (a, b) => asString(a).toLowerCase().startsWith(asString(b).toLowerCase()),
	contains: (a, b) =>
		Array.isArray(a)
			? a.some((x) => looseEq(x, b))
			: asString(a).toLowerCase().includes(asString(b).toLowerCase()),
};

function tokenize(src) {
	const tokens = [];
	for (let i = 0; i < src.length;) {
		const c = src[i];
		if (/\s/.test(c)) i++;
		else if (c === "'") {
			let s = '';
			for (i++; ;) {
				if (i >= src.length) throw new Error(`unterminated string in ${src}`);
				if (src[i] === "'" && src[i + 1] === "'") ((s += "'"), (i += 2));
				else if (src[i] === "'") break;
				else s += src[i++];
			}
			i++;
			tokens.push({ kind: 'string', value: s });
		} else if (['==', '!=', '&&', '||'].includes(src.slice(i, i + 2)))
			tokens.push({ kind: 'op', value: src.slice(i, (i += 2)) });
		else if ('()!,.'.includes(c)) tokens.push({ kind: 'op', value: src[i++] });
		else {
			const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
			if (!m) throw new Error(`"${c}" is not part of the modelled language: ${src}`);
			tokens.push({ kind: 'name', value: m[0] });
			i += m[0].length;
		}
	}
	return tokens;
}

/** `ctx` → value. `functions` adds callables (the status functions of a job's `if:`). */
function compile(src, functions = {}) {
	const tokens = tokenize(src);
	let p = 0;
	const at = (value) => tokens[p]?.kind === 'op' && tokens[p].value === value;
	const expect = (value) => {
		if (!at(value)) throw new Error(`expected "${value}" at token ${p} of ${src}`);
		p++;
	};
	const binary = (next, op, combine) => () => {
		let left = next();
		while (at(op)) {
			p++;
			const [a, b] = [left, next()];
			left = (ctx) => combine(a, b, ctx);
		}
		return left;
	};
	const primary = () => {
		const t = tokens[p++];
		if (!t) throw new Error(`unexpected end of ${src}`);
		if (t.kind === 'op' && t.value === '(') {
			const inner = or();
			expect(')');
			return inner;
		}
		if (t.kind === 'string') return () => t.value;
		if (t.kind !== 'name') throw new Error(`unexpected "${t.value}" in ${src}`);
		if (t.value === 'true' || t.value === 'false') return () => t.value === 'true';
		if (t.value === 'null') return () => null;
		if (at('(')) {
			p++;
			const args = [];
			if (!at(')')) {
				args.push(or());
				while (at(',')) {
					p++;
					args.push(or());
				}
			}
			expect(')');
			const fn = functions[t.value] ?? BUILTINS[t.value];
			if (!fn) throw new Error(`function ${t.value}() is not modelled`);
			return (ctx) => fn(...args.map((a) => a(ctx)));
		}
		const path = [t.value];
		while (at('.')) {
			p++;
			const name = tokens[p++];
			if (name?.kind !== 'name') throw new Error(`expected a property name in ${src}`);
			path.push(name.value);
		}
		return (ctx) =>
			path.reduce((o, k) => (o === null || o === undefined ? null : (o[k] ?? null)), ctx);
	};
	const unary = () => {
		if (!at('!')) return primary();
		p++;
		const inner = unary();
		return (ctx) => !truthy(inner(ctx));
	};
	const comparison = () => {
		let left = unary();
		while (at('==') || at('!=')) {
			const negate = tokens[p++].value === '!=';
			const [a, b] = [left, unary()];
			left = (ctx) => looseEq(a(ctx), b(ctx)) !== negate;
		}
		return left;
	};
	const and = binary(comparison, '&&', (a, b, ctx) => {
		const x = a(ctx);
		return truthy(x) ? b(ctx) : x;
	});
	const or = binary(and, '||', (a, b, ctx) => {
		const x = a(ctx);
		return truthy(x) ? x : b(ctx);
	});
	const expr = or();
	if (p !== tokens.length) throw new Error(`unparsed "${tokens[p].value}" in ${src}`);
	return expr;
}
const evaluate = (src, ctx) => compile(src)(ctx);
/** A `${{ }}` template, as GitHub renders one: null as '', everything else as its string. */
const render = (src, ctx) =>
	src.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, inner) => asString(evaluate(inner, ctx)));

// ---- GitHub's branch filter patterns, the part the workflow uses ----
// `*` is any run of characters but `/`, `**` any run at all, `[0-9a-f]` one character of the class
// (ranges of a-z, A-Z, 0-9 only). Every other special character fails here rather than being read
// as a literal.
function globToRegExp(pattern) {
	let re = '';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '*') {
			if (pattern[i + 1] === '*') ((re += '.*'), i++);
			else re += '[^/]*';
		} else if (c === '[') {
			const end = pattern.indexOf(']', i);
			const body = pattern.slice(i + 1, end);
			if (end < 0 || !/^([a-zA-Z0-9]-[a-zA-Z0-9]|[a-zA-Z0-9])+$/.test(body))
				throw new Error(`"[${body}" is not a modelled character class: ${pattern}`);
			re += `[${body}]`;
			i = end;
		} else if ('?+!\\]'.includes(c)) throw new Error(`"${c}" is not modelled: ${pattern}`);
		else re += c.replace(/[.^$|(){}]/g, '\\$&');
	}
	return new RegExp(`^${re}$`);
}
const matches = (patterns, branch) => patterns.some((p) => globToRegExp(p).test(branch));

// ---- the events ----

const sha = (c) => c.repeat(40);
/** A pull request event's payload, the fields the workflow and the verdict read. */
const prEvent = ({ number, action, draft, type, branch, fork = false, head = 'a' }) => ({
	action,
	number,
	pull_request: {
		number,
		draft,
		state: 'open',
		user: { login: type === 'Bot' ? 'some-app[bot]' : 'someone', type },
		head: { ref: branch, sha: sha(head), repo: { full_name: fork ? 'someone/fork' : REPO } },
		base: { ref: 'main', sha: sha('0') },
	},
});
function contextOf(row) {
	const github = { event_name: row.event, repository: REPO, sha: sha('f') };
	if (row.event === 'push') github.event = { ref: `refs/heads/${row.branch}` };
	if (row.event === 'pull_request') github.event = prEvent(row);
	if (row.event === 'workflow_dispatch')
		github.event = { inputs: { self_compare: true, log_images: false, base: '' } };
	return {
		github,
		inputs: row.event === 'workflow_dispatch' ? github.event.inputs : null,
	};
}

/** 'runs' (prepare runs), 'skipped' (a run whose prepare, so every job, is skipped), 'no run'. */
function outcome(wf, row) {
	if (row.event === 'push' && matches(wf.ignore, row.branch)) return 'no run';
	if (
		row.event === 'pull_request' &&
		(!wf.types.includes(row.action) || !matches(wf.branches, 'main'))
	)
		return 'no run';
	return truthy(evaluate(wf.if, contextOf(row))) ? 'runs' : 'skipped';
}

/** The rule in plain JavaScript: what the `if:` must mean. */
function twin(row) {
	if (row.event !== 'pull_request') return true;
	const e = prEvent(row);
	const fix =
		e.pull_request.user.type.toLowerCase() === 'bot' &&
		e.pull_request.head.ref.toLowerCase().startsWith('bug-') &&
		e.pull_request.head.ref.toLowerCase().includes('-fix-');
	if (e.pull_request.head.repo.full_name.toLowerCase() !== REPO.toLowerCase()) return false;
	if (e.action === 'ready_for_review' && !fix) return false;
	return !(fix && e.pull_request.draft);
}

const FIX = 'bug-12-fix-0a1b2c3d4e';
const RFR = 'ready_for_review';
const DEPENDABOT = 'dependabot/npm_and_yarn/vite-6.4.1';

/** Pushes: [kind, branch, now, before]. */
const PUSHES = [
	['ordinary', 'claude/x', 'runs', 'runs'],
	['ordinary', 'feature/y', 'runs', 'runs'],
	['ordinary', 'bug-12-fix-login', 'runs', 'runs'],
	['ordinary', 'bug-12-fix-0A1B2C3D4E', 'runs', 'runs'],
	['ordinary', 'bug-12-fix-0a1b2c3d4ef', 'runs', 'runs'],
	['ordinary', 'bug-12-fix-0a1b2c3d4', 'runs', 'runs'],
	['ordinary', 'bug-gameserver-cors', 'runs', 'runs'],
	['ordinary', 'main', 'no run', 'no run'],
	['fix', FIX, 'no run', 'runs'],
	['fix', 'bug-7-fix-ffffffffff', 'no run', 'runs'],
];
/**
 * Pull requests: [kind, number, head branch, user type, action, draft, now, before, head commit].
 * PR 7's `ready_for_review` shares its head with its `synchronize`, so the two groups can differ.
 */
const PRS = [
	['ordinary', 7, 'claude/x', 'User', 'opened', true, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', 'opened', false, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', 'synchronize', true, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', 'synchronize', false, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', 'reopened', true, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', 'reopened', false, 'runs', 'runs'],
	['ordinary', 7, 'claude/x', 'User', RFR, false, 'skipped', 'no run'],
	['ordinary', 8, 'bug-12-fix-login', 'User', 'opened', true, 'runs', 'runs'],
	['ordinary', 8, 'bug-12-fix-login', 'User', RFR, false, 'skipped', 'no run'],
	// A person's PR is never a fix run, whatever its branch.
	['ordinary', 9, FIX, 'User', 'opened', true, 'runs', 'runs'],
	['ordinary', 9, FIX, 'User', 'synchronize', true, 'runs', 'runs'],
	['ordinary', 9, FIX, 'User', RFR, false, 'skipped', 'no run'],
	['ordinary', 10, DEPENDABOT, 'Bot', 'opened', false, 'runs', 'runs'],
	['ordinary', 10, DEPENDABOT, 'Bot', 'synchronize', false, 'runs', 'runs'],
	['ordinary', 11, 'railway/fix-deploy-8b46d1', 'Bot', 'opened', false, 'runs', 'runs'],
	['ordinary', 13, 'agents/game-doctor-1a2b3c', 'Bot', 'opened', true, 'runs', 'runs'],
	['ordinary', 13, 'agents/game-doctor-1a2b3c', 'Bot', RFR, false, 'skipped', 'no run'],
	['fork', 14, 'claude/x', 'User', 'opened', false, 'skipped', 'skipped'],
	['fork', 14, 'claude/x', 'User', RFR, false, 'skipped', 'no run'],
	['fork', 15, FIX, 'Bot', 'opened', true, 'skipped', 'skipped'],
	['fix', 12, FIX, 'Bot', 'opened', true, 'skipped', 'runs'],
	['fix', 12, FIX, 'Bot', 'synchronize', true, 'skipped', 'runs', 'b'],
	['fix', 12, FIX, 'Bot', 'reopened', true, 'skipped', 'runs', 'b'],
	['fix', 12, FIX, 'Bot', RFR, false, 'runs', 'no run', 'b'],
	['fix', 12, FIX, 'Bot', 'synchronize', false, 'runs', 'runs', 'c'],
	['fix', 16, 'BUG-16-FIX-0A1B2C3D4E', 'Bot', 'opened', true, 'skipped', 'runs'],
	['fix', 17, 'bug-17-fix-0a1b2c3d4e', 'Bot', 'opened', false, 'runs', 'runs'],
];

/** `expect`: the new workflow. `before`: the workflow as it was. */
const MATRIX = [
	...PUSHES.map(([kind, branch, expect, before]) => ({
		kind,
		event: 'push',
		branch,
		expect,
		before,
	})),
	...PRS.map(([kind, number, branch, type, action, draft, expect, before, head = 'a']) => ({
		kind,
		event: 'pull_request',
		number,
		branch,
		type,
		action,
		draft,
		expect,
		before,
		head,
		fork: kind === 'fork',
	})),
	{ kind: 'ordinary', event: 'workflow_dispatch', branch: 'main', expect: 'runs', before: 'runs' },
];

// ---- 1. the workflow says what is pinned ----
const WF = readWorkflow(YML);
for (const key of ['branches', 'types', 'ignore', 'if', 'group'])
	check(
		JSON.stringify(WF[key]) === JSON.stringify(NEW[key]),
		`current-games.yml's ${key} is ${JSON.stringify(WF[key])}, pinned ${JSON.stringify(NEW[key])}`,
	);
check(
	WF.if.split(FIX_TEXT).length === 3,
	"prepare's if: tests a fix run exactly twice, by FIX_TEXT",
);

// ---- 2. every row, evaluated from the workflow's own text ----
const label = (row) =>
	row.event === 'pull_request'
		? `PR #${row.number} ${row.type} ${row.branch} ${row.action}${row.draft ? ' (draft)' : ''}${row.fork ? ' (fork)' : ''}`
		: `${row.event} ${row.branch}`;
const jobsSkipped = ['prepare', 'build', 'gates', 'render (${{ matrix.shard }})', 'report'].map(
	(name) => ({ name, conclusion: 'skipped' }),
);
const runOf = (row) => ({
	id: 1,
	path: '.github/workflows/current-games.yml',
	event: row.event,
	status: 'completed',
	conclusion: 'skipped',
	run_attempt: 1,
	head_sha: sha(row.head ?? 'a'),
	html_url: `https://github.com/${REPO}/actions/runs/1`,
	repository: { full_name: REPO },
	head_repository: { full_name: row.fork ? 'someone/fork' : REPO },
	pull_requests: [{ number: row.number, base: { ref: 'main' } }],
});
const groupOf = (wf, row) => render(wf.group, contextOf(row));

for (const row of MATRIX) {
	const name = label(row);
	const now = outcome(WF, row);
	check(now === row.expect, `${name}: ${now}, expected ${row.expect}`);
	check(
		outcome(OLD, row) === row.before,
		`${name}: before, ${outcome(OLD, row)}, expected ${row.before}`,
	);
	if (now !== 'no run')
		check(
			twin(row) === (now === 'runs'),
			`${name}: the twin says ${twin(row) ? 'runs' : 'skipped'}`,
		);

	if (row.event === 'pull_request') {
		const payload = prEvent(row).pull_request;
		const fixByText = truthy(evaluate(FIX_TEXT, contextOf(row)));
		check(
			isFixRun(payload) === fixByText,
			`${name}: the verdict's isFixRun disagrees with the workflow`,
		);
		check(
			fixByText === (row.kind === 'fix' || (row.kind === 'fork' && row.type === 'Bot')),
			`${name}: kind`,
		);
	}

	// Ordinary branches and PRs: exactly as before. The one exception is a `ready_for_review` on a
	// PR that is not a fix run, which made no run and now makes one that renders nothing.
	if (row.kind === 'ordinary') {
		const same = row.expect === row.before;
		const readyNoop =
			row.action === 'ready_for_review' && row.before === 'no run' && row.expect === 'skipped';
		check(same || readyNoop, `${name}: an ordinary event changed (${row.before} → ${row.expect})`);
		if (row.action !== 'ready_for_review')
			check(groupOf(WF, row) === groupOf(OLD, row), `${name}: its concurrency group changed`);
		if (readyNoop) {
			const pull = prEvent(row).pull_request;
			const ran = { ...row, action: 'synchronize' };
			check(groupOf(WF, row) !== groupOf(WF, ran), `${name}: would cancel the run on its head`);
			check(
				typeof standsDown({ jobs: jobsSkipped, pr: pull }) === 'string',
				`${name}: the verdict posts`,
			);
			check(
				decideRequested({ run: { ...runOf(row), status: 'in_progress' }, jobs: jobsSkipped })
					.post === undefined,
				`${name}: the verdict posts pending`,
			);
		}
	}
	// A fork's PR is skipped, and the verdict refuses it before deciding anything.
	if (row.kind === 'fork') {
		check(row.expect === 'skipped' || row.expect === 'no run', `${name}: a fork's PR runs`);
		const pull = prEvent(row).pull_request;
		check(
			checkRun({ run: runOf(row), pr: pull, repository: REPO }).ok === false,
			`${name}: verdict`,
		);
	}
	// A fix run's draft: skipped, and its status is the draft's pending, never a pass or a failure.
	if (row.kind === 'fix' && row.event === 'pull_request' && row.expect === 'skipped') {
		const pull = prEvent(row).pull_request;
		check(standsDown({ jobs: jobsSkipped, pr: pull }) === null, `${name}: the verdict stands down`);
		const d = decide({
			run: runOf(row),
			jobs: jobsSkipped,
			reach: { render: true, files: ['packages/x/a.ts'] },
		});
		check(d.state === 'pending' && d.description === FIX_RUN_DRAFT, `${name}: ${d.state}`);
	}
}

// ---- 3. nothing that holds a secret runs once `prepare` is skipped ----
{
	const all = jobs(YML);
	const kinds = Object.keys(all).filter((k) => k !== 'prepare');
	const needsPrepare = (k, seen = new Set()) =>
		all[k].needs.some(
			(n) => n === 'prepare' || (!seen.has(n) && (seen.add(n), needsPrepare(n, seen))),
		);
	const skippedNeeds = Object.fromEntries(
		Object.keys(all).map((k) => [k, { result: 'skipped', outputs: {} }]),
	);
	const status = {
		success: () => false,
		failure: () => false,
		cancelled: () => false,
		always: () => {
			throw new Error('always() runs whatever prepare did');
		},
	};
	for (const k of kinds) {
		check(needsPrepare(k), `${k} does not need prepare, so skipping prepare does not skip it`);
		// With no `if:`, GitHub skips a job whose needs were skipped. With one, it must be false.
		if (all[k].if === null) continue;
		let runs;
		try {
			runs = truthy(compile(all[k].if, status)({ needs: skippedNeeds }));
		} catch (error) {
			runs = error.message;
		}
		check(runs === false, `${k} runs with prepare skipped (if: ${all[k].if}): ${runs}`);
	}
	check(kinds.length > 0, 'no job after prepare was read');
}

// ---- 4. the evaluator itself, on GitHub's documented semantics ----
{
	const ctx = { a: { b: 'Bot', n: null, t: true, z: 0 } };
	const ok = (src, want) =>
		check(Object.is(evaluate(src, ctx), want), `evaluate(${src}) is ${evaluate(src, ctx)}`);
	ok("a.b == 'bot'", true);
	ok("a.b != 'BOT'", false);
	ok("a.n == ''", true);
	ok("a.missing == 'x'", false);
	ok("a.n != 'ready_for_review'", true);
	ok("startsWith('BUG-1', 'bug-')", true);
	ok("contains('x-FIX-y', '-fix-')", true);
	ok("a.t && 'yes' || 'no'", 'yes');
	ok("a.z && 'yes' || 'no'", 'no');
	ok('!a.n && !(a.t && a.z)', true);
	ok("!a.t || a.b == 'Bot' && a.z", 0);
	check(matches(['bug-*-fix-[0-9a-f]'], 'bug-1-fix-a'), 'glob: one class character');
	check(!matches(['bug-*-fix-[0-9a-f]'], 'bug-1-fix-A'), 'glob: classes are case-sensitive');
	check(!matches(['bug-*-fix-[0-9a-f]'], 'bug-1/2-fix-a'), 'glob: * stops at /');
	check(matches(['releases/**'], 'releases/a/b'), 'glob: ** crosses /');
	for (const bad of ['v[12].[0-9]+', 'bug-?', '!main'])
		check(
			(() => {
				try {
					globToRegExp(bad);
					return false;
				} catch {
					return true;
				}
			})(),
			`glob: "${bad}" is refused, not misread`,
		);
}

if (failures.length) {
	console.error(`triggers.fixture: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
console.log(`triggers.fixture: ok (${MATRIX.length} events)`);
