// The fix-run job's own code (ADR-0013 §4–§5, `.github/workflows/bug-fix.yml`). Every command runs
// from main's code — the checkout before the model has touched anything, or the pristine copy at
// $RUNNER_TEMP/main after — never from the workspace the model wrote in. Built-ins only: nothing
// under node_modules runs here.
//
//   node collect.mjs brief     step 3: read the bug with an OIDC token into $RUNNER_TEMP/bug/
//   node collect.mjs prepare   render the settings, the agents and the prompt into $RUNNER_TEMP/claude/
//   node collect.mjs result    step 5: collect the change, the result and the usage; POST them
//
// THE LOG IS PUBLIC. Nothing here prints the bug, the brief, a screenshot, the model's words or the
// CLI's output: an error is a fixed sentence and an HTTP status, and the result step prints one
// line — `fix run <id>: <status>, $<spend>` — inside a stop-commands span.

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const AUDIENCE = 'invisible-launcher-bug-fix';
const FIX_RUN = /^[0-9a-f]{10}$/;
const SHA = /^[0-9a-f]{40}$/;
const OUTCOMES = ['fixed', 'not_reproduced', 'needs_person', 'second_area'];
const STATUSES = ['dispatched', 'running', 'pr_opened', 'no_fix', 'failed', 'cancelled'];
/** The tools the run gets; an agent's own list is cut to these. */
export const TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Agent'];
const MEDIA = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_SCREENSHOTS = 20;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
/** adapter-node refuses a body past 512 KB: a larger result goes gzipped. */
const GZIP_OVER = 400 * 1024;
/** What the launcher unpacks at most. */
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_JSON = 256 * 1024;
const HTTP_TIMEOUT_MS = 30_000;

class JobError extends Error {}

const fail = (message) => {
	throw new JobError(message);
};

function env(name) {
	const v = process.env[name];
	if (!v) fail(`${name} is not set.`);
	return v;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** `fetch` with a timeout, tried again on a network error or a 5xx (at most 3 tries). */
async function request(url, init, doing) {
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
		} catch {
			if (attempt >= 2) fail(`The launcher could not be reached ${doing}.`);
			await pause(2000 * 2 ** attempt);
			continue;
		}
		if (res.status >= 500 && attempt < 2) {
			await pause(2000 * 2 ** attempt);
			continue;
		}
		return res;
	}
}

/**
 * A GitHub OIDC token for the launcher. The request URL and token are the job's own, which
 * `id-token: write` gives every step — but step 4 starts the CLI without them.
 */
export async function oidcToken() {
	const url = new URL(env('ACTIONS_ID_TOKEN_REQUEST_URL'));
	url.searchParams.set('audience', AUDIENCE);
	const res = await request(
		url,
		{ headers: { authorization: `bearer ${env('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` } },
		'for an OIDC token',
	);
	if (!res.ok) fail(`GitHub answered ${res.status} for an OIDC token.`);
	const body = await res.json().catch(() => null);
	if (typeof body?.value !== 'string') fail('GitHub answered no OIDC token.');
	return body.value;
}

const launcher = (path) =>
	`${env('LAUNCHER_URL').replace(/\/+$/, '')}/api/pipeline/fix-runs/${path}`;

function fixRunId() {
	const id = env('FIX_RUN');
	if (!FIX_RUN.test(id)) fail('FIX_RUN is not a fix run id.');
	return id;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/**
 * Where everything lives, all outside the workspace but the workspace itself. POSIX paths: they
 * are rendered into the settings and the prompt, and the job runs on Linux.
 */
export function paths(runnerTemp, workspace) {
	const at = (name) => posix.join(runnerTemp, name);
	return {
		runnerTemp,
		workspace,
		main: at('main'),
		bug: at('bug'),
		key: at('key'),
		out: at('out'),
		claude: at('claude'),
		tsxShim: at('tsx-shim'),
	};
}

const jobPaths = () => paths(env('RUNNER_TEMP'), env('GITHUB_WORKSPACE'));

// ── Step 3: the brief ─────────────────────────────────────────────────────────

/** The brief's answer, checked: what the later steps rely on, never echoed. */
export function checkBrief(body, id) {
	if (!body || typeof body !== 'object') fail('The brief is not a JSON object.');
	if (body.fixRun !== id) fail('The brief is for another fix run.');
	if (typeof body.baseSha !== 'string' || !SHA.test(body.baseSha)) {
		fail('The brief has no base commit.');
	}
	if (!Number.isSafeInteger(body.bug) || body.bug < 1) fail('The brief names no bug.');
	if (typeof body.brief !== 'string' || !body.brief.trim()) fail('The brief has no text.');
	const budget = body.budgetUsd;
	if (typeof budget !== 'number' || !(budget > 0) || budget > 100) {
		fail('The brief has no budget between $0 and $100.');
	}
	const shots = Array.isArray(body.screenshots)
		? body.screenshots
		: fail('The brief lists no screenshots.');
	if (shots.length > MAX_SCREENSHOTS)
		fail(`The brief lists more than ${MAX_SCREENSHOTS} screenshots.`);
	for (const s of shots) {
		if (typeof s?.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id)) {
			fail('The brief lists a screenshot with no id.');
		}
	}
	return { bug: body.bug, baseSha: body.baseSha, budgetUsd: budget, brief: body.brief, shots };
}

async function brief() {
	const id = fixRunId();
	const p = jobPaths();
	const token = await oidcToken();
	const auth = { authorization: `Bearer ${token}`, accept: 'application/json' };
	const res = await request(launcher(`${id}/brief`), { headers: auth }, 'for the brief');
	if (!res.ok) fail(`The launcher answered ${res.status} for the brief.`);
	const got = checkBrief(await res.json().catch(() => null), id);
	mkdirSync(p.bug, { recursive: true });
	writeFileSync(join(p.bug, 'brief.md'), `${got.brief.replace(/\r\n?/g, '\n').trimEnd()}\n`);
	const screenshots = [];
	for (const [i, shot] of got.shots.entries()) {
		const r = await request(
			launcher(`${id}/screenshots/${shot.id}`),
			{ headers: { authorization: auth.authorization } },
			'for a screenshot',
		);
		if (!r.ok) fail(`The launcher answered ${r.status} for a screenshot.`);
		const ext = MEDIA[(r.headers.get('content-type') ?? '').split(';')[0].trim()];
		if (!ext) fail('A screenshot is not a PNG, JPEG or WebP image.');
		const bytes = Buffer.from(await r.arrayBuffer());
		if (bytes.length > MAX_SCREENSHOT_BYTES) fail('A screenshot is larger than 10 MB.');
		const name = `screenshot-${i + 1}.${ext}`;
		writeFileSync(join(p.bug, name), bytes);
		screenshots.push(name);
	}
	writeFileSync(
		join(p.bug, 'run.json'),
		JSON.stringify({
			fixRun: id,
			bug: got.bug,
			baseSha: got.baseSha,
			budgetUsd: got.budgetUsd,
			screenshots,
		}),
	);
	appendFileSync(env('GITHUB_OUTPUT'), `base_sha=${got.baseSha}\nbudget=${got.budgetUsd}\n`);
	console.log(`fix run ${id}: brief read, ${screenshots.length} screenshot(s).`);
}

// ── Preparing the run: settings, agents, prompt ───────────────────────────────

/** `{{NAME}}` replaced from `values`; a placeholder with no value is an error, never left in. */
export function render(template, values) {
	return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
		if (!Object.hasOwn(values, name)) fail(`The template names {{${name}}}, which has no value.`);
		return values[name];
	});
}

/** A frontmatter block's `key: value` lines (the shapes `.claude/agents/*.md` use). */
function frontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!m) return null;
	const fields = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (kv) fields[kv[1]] = kv[2].trim();
	}
	return { fields, body: m[2].replace(/\r\n/g, '\n').trim() };
}

/**
 * The build agents for `--agents`, from the pristine copy's `.claude/agents/*.md` (main's, at the
 * run's base): the workspace's are the model's to write in, and project settings are not loaded.
 * Each keeps its name, description, prompt and model; its tools are cut to the run's.
 */
export function agentsJson(agentsDir) {
	const out = {};
	for (const file of readdirSync(agentsDir)
		.filter((f) => f.endsWith('.md'))
		.sort()) {
		const parsed = frontmatter(readFileSync(join(agentsDir, file), 'utf8'));
		if (!parsed) continue;
		const { fields, body } = parsed;
		const name = fields.name || basename(file, '.md');
		if (!/^[a-z][a-z0-9-]*$/.test(name) || !fields.description || !body) continue;
		const listed = (fields.tools ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		const tools = listed.length
			? listed.filter((t) => TOOLS.includes(t))
			: TOOLS.filter((t) => t !== 'Agent');
		out[name] = {
			description: fields.description,
			prompt: body,
			tools,
			...(fields.model ? { model: fields.model } : {}),
		};
	}
	return out;
}

/** The values the templates are rendered with. */
export function templateValues(p, run) {
	return {
		WORKSPACE: p.workspace,
		RUNNER_TEMP: p.runnerTemp,
		MAIN: p.main,
		BUG: p.bug,
		KEY: p.key,
		OUT: p.out,
		CLAUDE: p.claude,
		BRIEF: posix.join(p.bug, 'brief.md'),
		RESULT: posix.join(p.out, 'result.json'),
		SCREENSHOTS: run.screenshots.length
			? run.screenshots.map((s) => `- ${posix.join(p.bug, s)}`).join('\n')
			: '- (none)',
	};
}

const shq = (s) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Every `node_modules/.bin/tsx` the workspace's packages run, swapped for a script that runs
 * tsx-shim.mjs from `shim` (see that file: tsx's CLI needs a Unix socket the sandbox refuses).
 * `node_modules` is ignored by git, so the swap is never part of the change. Answers the count.
 */
export function sandboxTsx(workspace, shim) {
	const groups = ['apps', 'packages', 'services', 'tools'].flatMap((g) => {
		try {
			return readdirSync(join(workspace, g)).map((d) => join(workspace, g, d));
		} catch {
			return [];
		}
	});
	let swapped = 0;
	for (const dir of [workspace, ...groups]) {
		const bin = join(dir, 'node_modules', '.bin', 'tsx');
		const pkg = join(dir, 'node_modules', 'tsx');
		if (!existsSync(bin) || !existsSync(pkg)) continue;
		const loader = join(realpathSync(pkg), 'dist', 'loader.mjs');
		if (!existsSync(loader)) fail('tsx has no dist/loader.mjs: the shim no longer fits it.');
		rmSync(bin, { force: true });
		writeFileSync(bin, `#!/bin/sh\nexec node ${shq(shim)} ${shq(loader)} "$@"\n`, { mode: 0o755 });
		swapped++;
	}
	return swapped;
}

function prepare() {
	const p = jobPaths();
	const run = JSON.parse(readFileSync(join(p.bug, 'run.json'), 'utf8'));
	const values = templateValues(p, run);
	const own = join(p.main, 'scripts', 'bug-fix');
	mkdirSync(join(p.claude, 'config'), { recursive: true });
	mkdirSync(p.out, { recursive: true });
	const settings = render(readFileSync(join(own, 'settings.json'), 'utf8'), values);
	JSON.parse(settings);
	writeFileSync(join(p.claude, 'settings.json'), settings);
	writeFileSync(
		join(p.claude, 'prompt.md'),
		render(readFileSync(join(own, 'coordinator.md'), 'utf8'), values),
	);
	const agents = agentsJson(join(p.main, '.claude', 'agents'));
	writeFileSync(join(p.claude, 'agents.json'), JSON.stringify(agents));
	// Outside the workspace and every denied folder: commands may read the shim, never change it.
	mkdirSync(p.tsxShim, { recursive: true });
	const shim = join(p.tsxShim, 'tsx.mjs');
	writeFileSync(shim, readFileSync(join(own, 'tsx-shim.mjs')));
	const swapped = sandboxTsx(p.workspace, shim);
	console.log(
		`fix run ${run.fixRun}: prepared ${Object.keys(agents).length} agents, ${swapped} tsx shims.`,
	);
}

// ── Step 5: the change ────────────────────────────────────────────────────────

const git = (args, opts = {}) => {
	const r = spawnSync('git', args, {
		encoding: 'buffer',
		maxBuffer: 256 * 1024 * 1024,
		env: {
			PATH: process.env.PATH ?? '',
			HOME: '/nonexistent',
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_GLOBAL: '/dev/null',
			LANG: 'C',
		},
		...opts,
	});
	if (r.status !== 0) fail('git could not list the files.');
	return r.stdout.toString('utf8').split('\0').filter(Boolean);
};

/** Strict UTF-8 that keeps a byte-order mark, so a file reads back byte for byte. */
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A plain file of the workspace, never through a link: refused when it is anything else. */
function plainFile(path) {
	const st = lstatSync(path);
	if (st.isSymbolicLink()) fail('The change holds a symbolic link.');
	if (!st.isFile()) fail('The change holds something that is not a file.');
	if (st.nlink > 1) fail('The change holds a file with a second hard link.');
	return st;
}

/** A changed file's text, which must be UTF-8 and at most 2 MB. */
function textOf(path, st) {
	if (st.size > MAX_RESULT_BYTES) fail('A changed file is larger than 2 MB.');
	try {
		return decoder.decode(readFileSync(path));
	} catch {
		return fail('A changed file is not UTF-8 text.');
	}
}

const modeOf = (st) => ((st.mode & 0o111) !== 0 ? '100755' : '100644');

/**
 * The files that differ between the pristine copy (main at the run's base, its own `.git`) and the
 * workspace: each tracked file changed, deleted or with its exec bit flipped, and each new file git
 * would not ignore. Git runs with the PRISTINE repository's directory and no global or system
 * config, so nothing the model wrote into the workspace's `.git` (a hook, an fsmonitor) is read.
 */
export function collectChange(main, workspace) {
	const files = [];
	const base = ['--git-dir', join(main, '.git'), '--work-tree', main];
	const tracked = git([...base, 'ls-files', '-z', '-s']).map((line) => {
		const [meta, path] = line.split('\t');
		return { path, mode: meta.split(' ')[0] };
	});
	for (const { path, mode } of tracked) {
		if (mode !== '100644' && mode !== '100755') continue;
		const now = join(workspace, path);
		let seen;
		try {
			seen = lstatSync(now);
		} catch {
			files.push({ path, content: null });
			continue;
		}
		if (seen.isDirectory()) {
			files.push({ path, content: null });
			continue;
		}
		const st = plainFile(now);
		const was = readFileSync(join(main, path));
		if (st.size === was.length && modeOf(st) === mode && readFileSync(now).equals(was)) continue;
		files.push({
			path,
			...(modeOf(st) !== mode ? { mode: modeOf(st) } : {}),
			content: textOf(now, st),
		});
	}
	const known = new Set(tracked.map((t) => t.path));
	const added = git([
		'--git-dir',
		join(main, '.git'),
		'--work-tree',
		workspace,
		'-c',
		'core.fsmonitor=',
		'-c',
		'core.untrackedCache=false',
		'ls-files',
		'-z',
		'--others',
		'--exclude-standard',
	]);
	for (const path of added) {
		if (path.endsWith('/') || known.has(path) || path === '.git' || path.startsWith('.git/'))
			continue;
		const now = join(workspace, path);
		const st = plainFile(now);
		files.push({
			path,
			...(modeOf(st) === '100755' ? { mode: '100755' } : {}),
			content: textOf(now, st),
		});
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// ── Step 5: the usage and how the CLI ended ───────────────────────────────────

const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

/**
 * The CLI's usage per model and how it ended, from its stream-json output. The final `result`
 * line's `modelUsage` covers the whole run, sub-agents included; when the CLI died before writing
 * one, the assistant messages it did stream are summed by model, each message once.
 */
export function readStream(text) {
	let result = null;
	const byMessage = new Map();
	for (const line of text.split('\n')) {
		if (!line.startsWith('{')) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		if (msg?.type === 'result') result = msg;
		const m = msg?.type === 'assistant' ? msg.message : null;
		if (m?.id && typeof m.model === 'string' && m.usage) byMessage.set(m.id, m);
	}
	const usage = new Map();
	const add = (model, u) => {
		const prior = usage.get(model) ?? {
			model,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
		prior.inputTokens += count(u.inputTokens);
		prior.outputTokens += count(u.outputTokens);
		prior.cacheReadTokens += count(u.cacheReadTokens);
		prior.cacheWriteTokens += count(u.cacheWriteTokens);
		usage.set(model, prior);
	};
	if (result?.modelUsage && typeof result.modelUsage === 'object') {
		for (const [model, u] of Object.entries(result.modelUsage)) {
			add(model, {
				inputTokens: u?.inputTokens,
				outputTokens: u?.outputTokens,
				cacheReadTokens: u?.cacheReadInputTokens,
				cacheWriteTokens: u?.cacheCreationInputTokens,
			});
		}
	} else {
		for (const m of byMessage.values()) {
			add(m.model, {
				inputTokens: m.usage.input_tokens,
				outputTokens: m.usage.output_tokens,
				cacheReadTokens: m.usage.cache_read_input_tokens,
				cacheWriteTokens: m.usage.cache_creation_input_tokens,
			});
		}
	}
	const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/;
	return {
		usage: [...usage.values()].filter((u) => MODEL.test(u.model)).slice(0, 10),
		ended: result ? String(result.subtype ?? 'unknown') : 'none',
	};
}

/** Why a run has no result of its own, in the job's words, from how the CLI ended. */
export function failureOf(ended) {
	switch (ended) {
		case 'success':
			return null;
		case 'error_max_budget_usd':
			return 'The run reached its budget cap before it finished.';
		case 'error_max_turns':
			return 'The run reached its turn cap before it finished.';
		case 'none':
			return 'The run stopped before Claude Code reported an end (a timeout or a crash).';
		default:
			return 'Claude Code ended the run with an error.';
	}
}

/** The model's `result.json`, read as data: the fields the launcher takes, nothing else. */
export function readResultJson(path) {
	if (!existsSync(path)) return null;
	const st = lstatSync(path);
	if (!st.isFile() || st.size > MAX_RESULT_JSON) return null;
	let v;
	try {
		v = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const text = (x) => (typeof x === 'string' ? x : '');
	const gates = Array.isArray(v.gates)
		? v.gates
				.filter((g) => g && typeof g.command === 'string' && typeof g.ok === 'boolean')
				.slice(0, 50)
				.map((g) => ({ command: g.command, ok: g.ok }))
		: [];
	const sb = v.secondBug ?? v.second_bug;
	return {
		outcome: OUTCOMES.includes(v.outcome) ? v.outcome : null,
		title: text(v.title),
		scope: text(v.scope),
		summary: text(v.summary),
		lesson: text(v.lesson),
		gates,
		...(sb && typeof sb === 'object' && typeof sb.area === 'string' && typeof sb.title === 'string'
			? { secondBug: { area: sb.area, title: sb.title, evidence: text(sb.evidence) } }
			: {}),
	};
}

/**
 * The body `POST …/result` takes (`FixRunResultBody`). A run whose CLI did not end in success, or
 * that wrote no usable result.json, is a `failure` with the job's own sentence and no change.
 */
export function resultBody({ baseSha, ended, result, files, usage, key, failure: given = null }) {
	const failure =
		given ??
		failureOf(ended) ??
		(result === null
			? 'The run wrote no readable result.json.'
			: result.outcome === null
				? 'The run wrote a result.json with no outcome the launcher knows.'
				: null);
	const failed = (why) => ({
		baseSha,
		outcome: 'needs_person',
		failure: why,
		title: '',
		scope: '',
		summary: '',
		lesson: '',
		gates: [],
		files: [],
		usage,
	});
	if (failure) return failed(failure);
	const body = { baseSha, ...result, files, usage };
	if (key && JSON.stringify(body).includes(JSON.stringify(key).slice(1, -1))) {
		return failed("The result held the run's API key.");
	}
	return body;
}

/** The body as sent: JSON, gzipped past {@link GZIP_OVER}; null when even gzipped it is too large. */
export function encodeBody(body) {
	const raw = Buffer.from(JSON.stringify(body), 'utf8');
	if (raw.length > MAX_RESULT_BYTES) return null;
	if (raw.length <= GZIP_OVER)
		return { bytes: raw, headers: { 'content-type': 'application/json' } };
	return {
		bytes: gzipSync(raw),
		headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
	};
}

/** The one line the log shows, from the launcher's answer — nothing of the run's own words. */
export function logLine(id, answer) {
	const status = STATUSES.includes(answer?.status) ? answer.status : 'unknown';
	const spend =
		typeof answer?.spendUsd === 'number' && Number.isFinite(answer.spendUsd)
			? `$${answer.spendUsd.toFixed(2)}`
			: 'spend unknown';
	return `fix run ${id}: ${status}, ${spend}`;
}

/** Print `line` where no workflow command can be read into it. */
function printFenced(line) {
	const token = randomBytes(12).toString('hex');
	console.log(`::stop-commands::${token}`);
	console.log(line);
	console.log(`::${token}::`);
}

async function result() {
	const id = fixRunId();
	const p = jobPaths();
	const run = JSON.parse(readFileSync(join(p.bug, 'run.json'), 'utf8'));
	if (run.fixRun !== id || !SHA.test(run.baseSha)) fail('run.json is not this fix run’s.');
	const streamFile = join(p.claude, 'stream.jsonl');
	const { usage, ended } = readStream(
		existsSync(streamFile) ? readFileSync(streamFile, 'utf8') : '',
	);
	const keyFile = join(p.key, 'anthropic');
	const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '';
	const given = { baseSha: run.baseSha, ended, usage, key };
	let body;
	try {
		const parsed = failureOf(ended) ? null : readResultJson(join(p.out, 'result.json'));
		const changes = parsed?.outcome === 'fixed' || parsed?.outcome === 'second_area';
		const files = changes ? collectChange(p.main, p.workspace) : [];
		body = resultBody({ ...given, result: parsed, files });
	} catch (err) {
		if (!(err instanceof JobError)) throw err;
		body = resultBody({ ...given, result: null, files: [], failure: err.message });
	}
	const sent =
		encodeBody(body) ??
		encodeBody(
			resultBody({
				...given,
				result: null,
				files: [],
				failure: 'The change is too large to send (over 2 MB).',
			}),
		);
	const token = await oidcToken();
	const res = await request(
		launcher(`${id}/result`),
		{
			method: 'POST',
			headers: { ...sent.headers, authorization: `Bearer ${token}` },
			body: sent.bytes,
		},
		'with the result',
	);
	const answer = await res.json().catch(() => null);
	if (!res.ok) {
		printFenced(`fix run ${id}: the launcher answered ${res.status}`);
		process.exitCode = 1;
		return;
	}
	printFenced(logLine(id, answer));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const COMMANDS = { brief, prepare, result };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const command = COMMANDS[process.argv[2]];
	if (!command) {
		console.error('usage: node collect.mjs brief | prepare | result');
		process.exit(2);
	}
	try {
		await command();
	} catch (err) {
		// A JobError is a sentence of this file's; anything else could carry a value, so it is not printed.
		console.log(
			`::error title=bug-fix::${err instanceof JobError ? err.message : 'The step failed (an unexpected error).'}`,
		);
		process.exit(1);
	}
}
