/**
 * Contract check for Invisible Pipeline Changes' backend (ADR-0007; PLAN 5.1–5.2):
 *   pnpm --filter launcher-api check:pipeline-changes
 *
 * Runs the REAL modules — `githubApp.ts` (the App JWT and the installation token), `zip.ts`,
 * `pipelineReport.ts`, `pipelineChanges.ts`, `pipelineAccess.ts` and the four routes under
 * `/api/pipeline/changes` — against a fake GitHub behind `globalThis.fetch` that verifies every
 * App JWT with the public half of a key made here, hands out numbered installation tokens,
 * records every status it is asked to post and serves artifact downloads by byte range. Replaced
 * at their boundaries: the approvals table (in memory) and the role / user override reads.
 *
 * Pinned:
 *  - the token is minted once and shared, minted again shortly before it expires and once more
 *    after a 401; an unset variable is named and nothing is fetched; nothing printed, thrown or
 *    answered ever carries the private key, a JWT or a token;
 *  - the list is every open PR into `main` minus Director games, with Dependabot's apart;
 *  - Testing / Blocked (with the failing row's reason) / Ready, from the checks on the head;
 *  - the detail: files, the diff link, the "why", Check 1 grouped by workflow with pass counts,
 *    Check 2 from the report artifact — and an expired artifact reads as a state, not an error;
 *  - approving needs `pipelineMerge` (403 without it, overrides honoured); an id from an older
 *    head is void (409) and a new head starts with no approvals;
 *  - `success` is posted to `current-games` on the exact SHA only when every changed screen on it
 *    is approved, exactly once per head, never for an unfinished run, a run with nothing to
 *    approve, or a failure an approval cannot clear;
 *  - a changed screen's image is served only by a path the report itself lists, read out of the
 *    full artifact by byte range (the tail, the central directory when it is past the tail, then
 *    the entry alone) and never whole; the images artifact a re-run replaced is a 409.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { isHttpError } from '@sveltejs/kit';
import type { PipelineApproval } from '../src/lib/server/db/schema.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

function exportNames(rel: string): string[] {
	const text = readFileSync(fileURLToPath(src(rel)), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── Everything printed or thrown, to prove no secret is in it ─────────────────
const printed: string[] = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
	const original = console[level].bind(console);
	console[level] = (...args: unknown[]) => {
		printed.push(args.map(String).join(' '));
		if (level === 'error' && String(args[0]).startsWith('FAIL')) original(...args);
	};
}
const thrown: string[] = [];
const answered: string[] = [];

// ── The App's key: GitHub hands out PKCS#1; Railway may hold it as one line ───
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const APP_ID = '12345';
const INSTALLATION_ID = '678';
const REPO = 'iw/engine';
/** A line of the key's body: the needle no output may contain. */
const KEY_NEEDLE = privateKey.split('\n')[2];

// ── A fake GitHub ─────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
interface Pull extends Json {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	state: string;
	draft: boolean;
	created_at: string;
	updated_at: string;
	head: { sha: string; ref: string; repo: { full_name: string } | null };
	base: { ref: string };
	user: { login: string; type: string } | null;
	labels: { name: string }[];
	mergeable_state: string;
	files: Json[];
}
interface Head {
	checkRuns: Json[];
	workflowRuns: Json[];
	statuses: Json[];
}
interface Artifact extends Json {
	id: number;
	name: string;
	expired: boolean;
	expires_at: string | null;
	size_in_bytes: number;
}
/** The clock the fake GitHub and the client under test share. */
let fakeNow = Date.now();
const gh = {
	pulls: new Map<number, Pull>(),
	heads: new Map<string, Head>(),
	artifacts: new Map<number, Artifact[]>(),
	jobs: new Map<number, Json[]>(),
	zips: new Map<number, Buffer>(),
	posts: [] as { sha: string; body: Json }[],
	mints: 0,
	jwts: [] as string[],
	tokens: [] as string[],
	revoked: new Set<string>(),
	requests: [] as string[],
	/** Every blob download, with the byte range it asked for ('' when none). */
	ranges: [] as { id: number; range: string }[],
	/** Whether the blob honours a byte range; off, it answers 200 with the whole archive. */
	blobRanges: true,
};

const jsonResponse = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function verifyJwt(jwt: string): Json {
	const [h, p, s] = jwt.split('.');
	const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, s, 'base64url');
	if (!ok) throw new Error('fixture: the App JWT does not verify');
	const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as Json;
	check('JWT header', header, { alg: 'RS256', typ: 'JWT' });
	return JSON.parse(Buffer.from(p, 'base64url').toString()) as Json;
}

const fakeFetch: typeof fetch = async (input, init) => {
	const url = new URL(String(input));
	const method = init?.method ?? 'GET';
	gh.requests.push(`${method} ${url.pathname}${url.search}`);
	const headers = (init?.headers ?? {}) as Record<string, string>;
	const auth = headers.Authorization ?? '';
	if (url.origin === 'https://blob.example') {
		// The signed URL is the authorization: a bearer header beside it is refused, as the real
		// blob store refuses it.
		if (auth) return jsonResponse(401, { message: 'blob: a bearer header beside a signed URL' });
		const id = Number(url.pathname.split('/').pop());
		const zip = gh.zips.get(id);
		if (!zip) return jsonResponse(404, { message: 'blob: no such artifact' });
		const range = headers.Range ?? headers.range ?? '';
		gh.ranges.push({ id, range });
		if (range && gh.blobRanges) {
			const m = /^bytes=(\d+)-(\d+)$/.exec(range);
			if (!m) return jsonResponse(400, { message: `blob: unsupported range ${range}` });
			const start = Number(m[1]);
			const end = Math.min(Number(m[2]), zip.length - 1);
			if (start >= zip.length || start > end) {
				return new Response(null, {
					status: 416,
					headers: { 'content-range': `bytes */${zip.length}` },
				});
			}
			return new Response(new Uint8Array(zip.subarray(start, end + 1)), {
				status: 206,
				headers: { 'content-range': `bytes ${start}-${end}/${zip.length}` },
			});
		}
		return new Response(new Uint8Array(zip), { status: 200 });
	}
	if (url.origin !== 'https://api.github.com') return jsonResponse(500, { message: 'wrong host' });
	check(`${url.pathname}: API version header`, headers['X-GitHub-Api-Version'], '2022-11-28');
	const path = url.pathname;

	if (path === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
		if (method !== 'POST') return jsonResponse(405, { message: 'Method Not Allowed' });
		const jwt = auth.replace(/^Bearer /, '');
		gh.jwts.push(jwt);
		const claims = verifyJwt(jwt);
		check('JWT iss is the App id', claims.iss, APP_ID);
		check('JWT lives 10 minutes', Number(claims.exp) - Number(claims.iat), 600);
		gh.mints++;
		const token = `ghs_token_${gh.mints}`;
		gh.tokens.push(token);
		return jsonResponse(201, {
			token,
			expires_at: new Date(fakeNow + 60 * 60_000).toISOString(),
		});
	}

	const token = auth.replace(/^Bearer /, '');
	if (!gh.tokens.includes(token) || gh.revoked.has(token)) {
		return jsonResponse(401, { message: 'Bad credentials' });
	}
	const seg = path.split('/').filter(Boolean);
	if (seg[0] !== 'repos' || `${seg[1]}/${seg[2]}` !== REPO) {
		return jsonResponse(404, { message: 'Not Found' });
	}
	const rest = seg.slice(3);
	if (rest[0] === 'pulls' && rest.length === 1) {
		check('pulls are asked for open PRs', url.searchParams.get('state'), 'open');
		const base = url.searchParams.get('base');
		if (url.searchParams.get('page') !== '1') return jsonResponse(200, []);
		const list = [...gh.pulls.values()]
			.filter((p) => p.state === 'open' && p.base.ref === base)
			.sort((a, b) => b.number - a.number)
			.map(({ files: _files, mergeable_state: _m, ...p }) => p);
		return jsonResponse(200, list);
	}
	if (rest[0] === 'pulls' && rest.length === 2) {
		const pull = gh.pulls.get(Number(rest[1]));
		if (!pull) return jsonResponse(404, { message: 'Not Found' });
		const { files: _files, ...rest2 } = pull;
		return jsonResponse(200, rest2);
	}
	if (rest[0] === 'pulls' && rest[2] === 'files') {
		const pull = gh.pulls.get(Number(rest[1]));
		if (!pull) return jsonResponse(404, { message: 'Not Found' });
		const perPage = Number(url.searchParams.get('per_page') ?? 30);
		const page = Number(url.searchParams.get('page') ?? 1);
		return jsonResponse(200, pull.files.slice((page - 1) * perPage, page * perPage));
	}
	if (rest[0] === 'commits' && rest[2] === 'check-runs') {
		const head = gh.heads.get(rest[1]);
		return jsonResponse(200, { check_runs: head?.checkRuns ?? [] });
	}
	if (rest[0] === 'commits' && rest[2] === 'status') {
		const head = gh.heads.get(rest[1]);
		return jsonResponse(200, { state: 'pending', statuses: head?.statuses ?? [] });
	}
	if (rest[0] === 'actions' && rest[1] === 'runs' && rest.length === 2) {
		const head = gh.heads.get(url.searchParams.get('head_sha') ?? '');
		return jsonResponse(200, { workflow_runs: head?.workflowRuns ?? [] });
	}
	if (rest[0] === 'actions' && rest[1] === 'runs' && rest[3] === 'artifacts') {
		return jsonResponse(200, { artifacts: gh.artifacts.get(Number(rest[2])) ?? [] });
	}
	if (rest[0] === 'actions' && rest[1] === 'runs' && rest[3] === 'attempts' && rest[5] === 'jobs') {
		if (rest[4] !== '1') return jsonResponse(404, { message: 'no such attempt' });
		const perPage = Number(url.searchParams.get('per_page') ?? 30);
		const page = Number(url.searchParams.get('page') ?? 1);
		const jobs = gh.jobs.get(Number(rest[2])) ?? [];
		return jsonResponse(200, { jobs: jobs.slice((page - 1) * perPage, page * perPage) });
	}
	if (rest[0] === 'actions' && rest[1] === 'artifacts' && rest[3] === 'zip') {
		if (!gh.zips.has(Number(rest[2]))) return jsonResponse(410, { message: 'Gone' });
		check('the download is asked for with redirects left to the caller', init?.redirect, 'manual');
		return new Response(null, {
			status: 302,
			headers: { location: `https://blob.example/artifacts/${rest[2]}` },
		});
	}
	if (rest[0] === 'statuses' && method === 'POST') {
		const body = JSON.parse(String(init?.body)) as Json;
		gh.posts.push({ sha: rest[1], body });
		const head = gh.heads.get(rest[1]);
		if (head) {
			head.statuses = [
				...head.statuses.filter((s) => s.context !== body.context),
				{ ...body, target_url: body.target_url, updated_at: new Date().toISOString() },
			];
		}
		return jsonResponse(201, { id: gh.posts.length, ...body });
	}
	return jsonResponse(404, { message: `fixture: no route for ${method} ${path}` });
};
globalThis.fetch = fakeFetch;

// ── A stored / deflated ZIP, as an artifact download is ───────────────────────
function zipOf(files: Record<string, Buffer | string>, deflate: string[] = []): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const data = Buffer.from(content);
		const method = deflate.includes(name) ? 8 : 0;
		const stored = method === 8 ? deflateRawSync(data) : data;
		const nameBuf = Buffer.from(name);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(stored.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(stored.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, stored);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + stored.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(centrals.length / 2, 8);
	eocd.writeUInt16LE(centrals.length / 2, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, eocd]);
}

// ── The world ─────────────────────────────────────────────────────────────────
const sha = (n: number): string => n.toString(16).padStart(40, 'a');
const AT = '2026-10-06T10:00:00Z';
let suite = 0;
let runId = 0;
let checkId = 0;

interface JobSpec {
	name: string;
	status?: string;
	conclusion?: string | null;
	summary?: string;
}
/** One workflow's run on a head, with its jobs as check runs under its check suite. */
function workflow(head: Head, name: string, jobs: JobSpec[], extra: Json = {}): { id: number } {
	const id = ++runId;
	const check_suite_id = ++suite;
	const statuses = jobs.map((j) => j.status ?? 'completed');
	const conclusions = jobs.map((j) => (j.conclusion === undefined ? 'success' : j.conclusion));
	gh.jobs.set(
		id,
		jobs.map((j, i) => ({
			id: id * 100 + i,
			name: j.name,
			status: statuses[i],
			conclusion: statuses[i] === 'completed' ? conclusions[i] : null,
		})),
	);
	head.workflowRuns.push({
		id,
		name,
		run_attempt: 1,
		path: `.github/workflows/${name === 'Current games' ? 'current-games' : name.toLowerCase()}.yml`,
		repository: { full_name: REPO },
		head_repository: { full_name: REPO },
		event: 'pull_request',
		status: statuses.every((s) => s === 'completed') ? 'completed' : 'in_progress',
		conclusion: statuses.every((s) => s === 'completed')
			? conclusions.every((c) => c === 'success' || c === 'skipped')
				? 'success'
				: 'failure'
			: null,
		head_sha: extra.head_sha ?? '',
		check_suite_id,
		html_url: `https://github.com/${REPO}/actions/runs/${id}`,
		created_at: AT,
		...extra,
	});
	jobs.forEach((j, i) => {
		head.checkRuns.push({
			id: ++checkId,
			name: j.name,
			status: statuses[i],
			conclusion: statuses[i] === 'completed' ? conclusions[i] : null,
			html_url: `https://github.com/${REPO}/actions/runs/${id}/job/${checkId}`,
			check_suite: { id: check_suite_id },
			app: { slug: 'github-actions', name: 'GitHub Actions' },
			output: { title: j.name, summary: j.summary ?? null },
		});
	});
	return { id };
}

const GREEN: [string, JobSpec[]][] = [
	['Lint', [{ name: 'lint', summary: '118 of 118 passed' }]],
	['Checks', [{ name: 'checks (1/3)' }, { name: 'checks (2/3)' }, { name: 'checks (3/3)' }]],
	['svelte-check', [{ name: 'svelte-check' }]],
	['Python', [{ name: 'python', summary: '8 of 8' }]],
	['Secrets', [{ name: 'scan' }]],
];

function head(
	shaValue: string,
	workflows: [string, JobSpec[]][] = GREEN,
	harness?: { state: string; description: string; run?: 'completed' | 'in_progress' | 'none' },
): Head {
	const h: Head = { checkRuns: [], workflowRuns: [], statuses: [] };
	for (const [name, jobs] of workflows) workflow(h, name, jobs, { head_sha: shaValue });
	if (harness) {
		h.statuses.push({
			context: 'current-games',
			state: harness.state,
			description: harness.description,
			target_url: `https://github.com/${REPO}/actions/runs/0`,
			updated_at: AT,
		});
		if (harness.run !== 'none') {
			// The harness's jobs are check runs on the head too, and its `report` job exits
			// non-zero on a failed verdict: Check 1 must leave them out.
			const running = harness.run === 'in_progress';
			const failed = harness.state !== 'success';
			workflow(
				h,
				'Current games',
				[
					{ name: 'prepare' },
					{ name: 'build', status: running ? 'in_progress' : 'completed' },
					{ name: 'gates', status: running ? 'in_progress' : 'completed' },
					{ name: 'render (1/20)', status: running ? 'queued' : 'completed' },
					{
						name: 'report',
						status: running ? 'queued' : 'completed',
						conclusion: failed ? 'failure' : 'success',
					},
				],
				{ head_sha: shaValue },
			);
		}
	}
	gh.heads.set(shaValue, h);
	return h;
}

/** The harness run of a head (the newest "Current games" run on it). */
const harnessRun = (shaValue: string): Json =>
	[...(gh.heads.get(shaValue)?.workflowRuns ?? [])]
		.reverse()
		.find((r) => r.name === 'Current games') as Json;

function pull(
	number: number,
	title: string,
	over: Partial<Pull> & { sha: string; labels?: string[] },
): Pull {
	const { sha: headSha, labels = [], ...rest } = over;
	const p: Pull = {
		number,
		title,
		body: null,
		html_url: `https://github.com/${REPO}/pull/${number}`,
		state: 'open',
		draft: false,
		created_at: AT,
		updated_at: AT,
		head: { sha: headSha, ref: `feat/${number}`, repo: { full_name: REPO } },
		base: { ref: 'main' },
		user: { login: 'dev', type: 'User' },
		labels: labels.map((name) => ({ name })),
		mergeable_state: 'clean',
		files: [],
		...rest,
	};
	gh.pulls.set(number, p);
	return p;
}

interface RowSpec {
	key: string;
	name: string;
	variant?: 'republished';
	build?: string;
	tests?: string;
	looks: string;
	changed?: string[];
	of?: number;
	detail?: string;
}
function report(headSha: string, rows: RowSpec[]): Json {
	const games = rows.map((r) => {
		const changed = r.changed ?? [];
		const rowKey = r.variant === 'republished' ? `${r.key}@republished` : r.key;
		const screens = [
			{ screen: 'base', scenario: 'base', pass: true, identical: true },
			...changed.map((screen, i) => ({
				screen,
				scenario: 'wins',
				pass: false,
				id: `${headSha}:${rowKey}:${screen}:${'0123456789abcdef'.slice(i, i + 8)}deadbeef`,
				reason: 'differing pixels over the tolerance',
				images: {
					before: `screens/${rowKey}--${screen}.before.png`,
					after: `screens/${rowKey}--${screen}.after.png`,
					diff: `screens/${rowKey}--${screen}.diff.png`,
				},
			})),
		];
		return {
			key: r.key,
			variant: r.variant ?? 'published',
			name: r.name,
			gameType: 'lines',
			build: { status: r.build ?? 'pass' },
			tests: { status: r.tests ?? 'pass', gates: [] },
			looks:
				r.looks === 'changed'
					? { status: 'changed', changed: changed.length, of: r.of ?? 12 }
					: r.looks === 'same'
						? { status: 'same', of: r.of ?? 12 }
						: { status: r.looks, detail: r.detail },
			screens: r.looks === 'changed' || r.looks === 'same' ? screens : [],
			notes: [],
		};
	});
	const verdicts = games.map((g) =>
		g.build.status === 'fail' || g.tests.status === 'fail'
			? 'fail'
			: g.looks.status === 'changed' || g.looks.status === 'error'
				? 'fail'
				: g.looks.status === 'same'
					? 'pass'
					: null,
	);
	const changedScreens = games.flatMap((g) => g.screens.filter((s) => !s.pass).map((s) => s.id));
	return {
		version: 3,
		head: { sha: headSha },
		base: { sha: sha(1) },
		seed: 'fixture',
		viewport: '1280x720',
		games,
		summary: {
			verdict: verdicts.includes('fail') ? 'fail' : 'pass',
			pass: verdicts.filter((v) => v === 'pass').length,
			fail: verdicts.filter((v) => v === 'fail').length,
			notRendered: verdicts.filter((v) => v === null).length,
			rendered: verdicts.filter((v) => v !== null).length,
			changedScreens,
			line:
				`${verdicts.filter((v) => v === 'pass').length} pass · ${verdicts.filter((v) => v === 'fail').length} fail · ` +
				`${verdicts.filter((v) => v === null).length} not rendered · ${changedScreens.length} changed screen(s)`,
		},
	};
}

let artifactId = 9000;
/**
 * The report job's artifacts on a head's harness run: `current-games-report` (the report with the
 * images) and, unless `fullOnly` (a run older than that upload), `current-games-report-json`.
 * Returns the ids `[json, full]`.
 */
function artifact(
	headSha: string,
	reportJson: Json | null,
	over: Partial<Artifact> & { fullOnly?: boolean } = {},
): [number, number] {
	const { fullOnly, ...rest } = over;
	const run = harnessRun(headSha);
	const text = reportJson ? JSON.stringify(reportJson) : '';
	// The images the report names, as the harness writes them beside it: `before` stored, the
	// others deflated, so both ways out of the archive are read.
	const images: Record<string, string> = {};
	for (const game of (reportJson?.games as { screens: { images?: Record<string, string> }[] }[]) ??
		[]) {
		for (const screen of game.screens) {
			for (const [kind, path] of Object.entries(screen.images ?? {}))
				images[path] = `PNG ${kind} ${path}`;
		}
	}
	const full = reportJson
		? zipOf({ 'report.json': text, 'index.html': '<html>', 'screens/x.png': 'PNG', ...images }, [
				'report.json',
				...Object.keys(images).filter((path) => !path.endsWith('.before.png')),
			])
		: Buffer.alloc(0);
	const small = reportJson ? zipOf({ 'report.json': text }, ['report.json']) : Buffer.alloc(0);
	const fullId = ++artifactId;
	const smallId = ++artifactId;
	const list: Artifact[] = [
		{ id: 9, name: 'current-games-plan', expired: true, expires_at: AT, size_in_bytes: 1 },
		{
			id: fullId,
			name: 'current-games-report',
			expired: false,
			expires_at: '2026-10-09T10:00:00Z',
			size_in_bytes: full.length,
			...rest,
		},
	];
	gh.zips.set(fullId, full);
	if (!fullOnly) {
		list.push({
			id: smallId,
			name: 'current-games-report-json',
			expired: false,
			expires_at: '2026-10-09T10:00:00Z',
			size_in_bytes: small.length,
			...rest,
		});
		gh.zips.set(smallId, small);
	}
	gh.artifacts.set(Number(run.id), list);
	return [smallId, fullId];
}

// #10 — still testing: one Checks shard running, the harness rendering.
head(
	sha(10),
	[
		['Lint', [{ name: 'lint', summary: '118 of 118 passed' }]],
		['Checks', [{ name: 'checks (1/3)' }, { name: 'checks (2/3)', status: 'in_progress' }]],
		['svelte-check', [{ name: 'svelte-check' }]],
	],
	{ state: 'pending', description: 'Rendering every live game…', run: 'in_progress' },
);
pull(10, 'engine: faster reel spin', { sha: sha(10), draft: true });

// #11 — Dependabot, green: listed apart.
head(sha(11), GREEN, { state: 'success', description: 'nothing to render' });
pull(11, 'chore(deps): bump vite', {
	sha: sha(11),
	user: { login: 'dependabot[bot]', type: 'Bot' },
});

// #12 — a Director game: never a change.
head(sha(12), GREEN, { state: 'success', description: 'ok' });
pull(12, 'game: sunken temple', { sha: sha(12), labels: ['director-game'] });

// #13 — into another base: not asked for.
head(sha(13), GREEN, { state: 'success', description: 'ok' });
pull(13, 'release: hotfix', { sha: sha(13), base: { ref: 'release' } });

// #14 — green gates, two changed screens on Book of Borut: the approval case.
const REPORT_14 = report(sha(14), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
	{ key: 'hotfruits', name: 'HotFruits', looks: 'same' },
	{ key: 'globalgame', name: 'Global', looks: 'no-snapshot' },
]);
const LINE_14 = (REPORT_14.summary as { line: string }).line;
const h14 = head(sha(14), GREEN, { state: 'failure', description: LINE_14 });
// A push run that stood down for the PR, newer than the PR run: never the one read.
h14.workflowRuns.push({
	id: ++runId,
	name: 'Current games',
	path: '.github/workflows/current-games.yml',
	repository: { full_name: REPO },
	head_repository: { full_name: REPO },
	event: 'push',
	status: 'completed',
	conclusion: 'success',
	head_sha: sha(14),
	check_suite_id: ++suite,
	html_url: `https://github.com/${REPO}/actions/runs/${runId}`,
	created_at: AT,
});
const PR_RUN_14 = Number(
	(gh.heads.get(sha(14))?.workflowRuns ?? []).find(
		(r) => r.name === 'Current games' && r.event === 'pull_request',
	)?.id,
);
// `artifact()` writes to the newest harness run, here the push run that stood down; the report
// job uploaded on the PR run, so its artifacts move there.
const [JSON_14, FULL_14] = artifact(sha(14), REPORT_14);
gh.artifacts.set(PR_RUN_14, gh.artifacts.get(Number(harnessRun(sha(14)).id)) as Artifact[]);
gh.artifacts.delete(Number(harnessRun(sha(14)).id));
const DIFF_14 = (REPORT_14.summary as { changedScreens: string[] }).changedScreens;
pull(14, 'launcher(pipeline): 1 px colour bleed at region edges', {
	sha: sha(14),
	body: 'Raises sheet padding from 1 px to 2 px and extrudes edge pixels.\r\n\r\n**Why:** QA in Director spotted a 1 px bleed on H2 and L3.\r\n\r\n## HISTORY entry\n- Did: padding.',
	files: [
		{ filename: 'services/atlas-tool/pack.py', status: 'modified', additions: 30, deletions: 5 },
		{
			filename: 'services/atlas-tool/tests/test_padding.py',
			status: 'added',
			additions: 10,
			deletions: 0,
		},
	],
});

// #15 — a merge conflict beats green checks.
head(sha(15), GREEN, { state: 'success', description: 'ok' });
pull(15, 'rigger: spine export scale', { sha: sha(15), mergeable_state: 'dirty' });

// #16 — green, docs only: ready, no report.
head(sha(16), GREEN, { state: 'success', description: 'docs only: nothing to render' });
pull(16, 'docs(director): record #1066', { sha: sha(16) });

// #17 — an agent definition whose lint failed.
head(
	sha(17),
	[
		['Lint', [{ name: 'lint', conclusion: 'failure' }]],
		['Checks', [{ name: 'checks (1/3)' }]],
	],
	{ state: 'pending', description: 'Rendering…', run: 'in_progress' },
);
pull(17, 'agents(director): sharper art director brief', {
	sha: sha(17),
	labels: ['agent-definition'],
});

// #18 — a changed screen beside a build failure: approvals cannot clear it. A run from before
// the report-only artifact: the full one is read.
const REPORT_18 = report(sha(18), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
	{
		key: 'hotfruits',
		name: 'HotFruits',
		build: 'fail',
		looks: 'error',
		detail: 'the branch runtime did not build',
	},
]);
head(sha(18), GREEN, {
	state: 'failure',
	description: (REPORT_18.summary as { line: string }).line,
});
artifact(sha(18), REPORT_18, { fullOnly: true });
pull(18, 'engine: new reel strip', { sha: sha(18) });

// #19 — the report expired.
head(sha(19), GREEN, { state: 'failure', description: '12 pass · 1 fail · 3 changed screen(s)' });
artifact(sha(19), null, { expired: true, expires_at: '2026-10-03T10:00:00Z' });
pull(19, 'fx: particle fade', { sha: sha(19) });

// #20 — the harness never reported: testing, however green the rest.
head(sha(20), GREEN);
pull(20, 'launcher: a tweak', { sha: sha(20) });

// #21 — a report for another commit.
const REPORT_21 = report(sha(99), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(21), GREEN, {
	state: 'failure',
	description: (REPORT_21.summary as { line: string }).line,
});
artifact(sha(21), REPORT_21);
pull(21, 'engine: stale report', { sha: sha(21) });

// #22 — a re-run posted a new verdict but left the previous attempt's report.
const REPORT_22 = report(sha(22), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
	{ key: 'hotfruits', name: 'HotFruits', looks: 'same' },
]);
head(sha(22), GREEN, {
	state: 'failure',
	description: '1 pass · 1 fail · 0 not rendered · 3 changed screen(s)',
});
artifact(sha(22), REPORT_22);
pull(22, 'engine: re-run report', { sha: sha(22) });

// #23 — two changed screens approved at the same moment.
const REPORT_23 = report(sha(23), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
]);
head(sha(23), GREEN, {
	state: 'failure',
	description: (REPORT_23.summary as { line: string }).line,
});
artifact(sha(23), REPORT_23);
pull(23, 'engine: two at once', { sha: sha(23) });

// #24 — from a fork: never a change.
head(sha(24), GREEN, { state: 'success', description: 'ok' });
pull(24, 'fork: drive-by', {
	sha: sha(24),
	head: { sha: sha(24), ref: 'patch-1', repo: { full_name: 'someone/engine' } },
});

// #25 — edits the harness: its own report proves nothing.
const REPORT_25 = report(sha(25), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(25), GREEN, {
	state: 'failure',
	description: (REPORT_25.summary as { line: string }).line,
});
artifact(sha(25), REPORT_25);
pull(25, 'ci(director): loosen the tolerance', {
	sha: sha(25),
	files: [
		{
			filename: 'scripts/current-games/tolerance.json',
			status: 'modified',
			additions: 1,
			deletions: 1,
		},
		{ filename: 'apps/lines/src/game/config.ts', status: 'modified', additions: 1, deletions: 1 },
	],
});

// #26 — a report that names no head commit.
const REPORT_26 = report(sha(26), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
delete REPORT_26.head;
head(sha(26), GREEN, {
	state: 'failure',
	description: (REPORT_26.summary as { line: string }).line,
});
artifact(sha(26), REPORT_26);
pull(26, 'engine: headless report', { sha: sha(26) });

// #27 — a workflow of the PR's own that calls itself "Current games" and posts the status.
const h27 = head(sha(27), GREEN);
workflow(
	h27,
	'Current games',
	[
		{ name: 'prepare' },
		{ name: 'build' },
		{ name: 'gates' },
		{ name: 'render (1/20)' },
		{ name: 'report', conclusion: 'failure' },
	],
	{ head_sha: sha(27), path: '.github/workflows/evil.yml' },
);
h27.statuses.push({
	context: 'current-games',
	state: 'failure',
	description: '1 pass · 1 fail · 0 not rendered · 1 changed screen(s)',
	target_url: `https://github.com/${REPO}/actions/runs/0`,
	updated_at: AT,
});
const REPORT_27 = report(sha(27), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
artifact(sha(27), REPORT_27);
pull(27, 'engine: masquerade', { sha: sha(27) });

// #28 — the report says "changed screens only" but a render job failed.
const REPORT_28 = report(sha(28), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(28), GREEN, {
	state: 'failure',
	description: (REPORT_28.summary as { line: string }).line,
});
artifact(sha(28), REPORT_28);
for (const job of gh.jobs.get(Number(harnessRun(sha(28)).id)) ?? []) {
	if (job.name === 'render (1/20)') job.conclusion = 'failure';
}
pull(28, 'engine: a shard died', { sha: sha(28) });

// #29 — an approver who loses the capability before the set completes.
const REPORT_29 = report(sha(29), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
]);
head(sha(29), GREEN, {
	state: 'failure',
	description: (REPORT_29.summary as { line: string }).line,
});
artifact(sha(29), REPORT_29);
pull(29, 'engine: a revoked approver', { sha: sha(29) });

// #30 — the harness edit hides on the second page of files.
const REPORT_30 = report(sha(30), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(30), GREEN, {
	state: 'failure',
	description: (REPORT_30.summary as { line: string }).line,
});
artifact(sha(30), REPORT_30);
pull(30, 'engine: many files', {
	sha: sha(30),
	files: [
		...Array.from({ length: 140 }, (_, i) => ({
			filename: `apps/lines/src/${i}.ts`,
			status: 'modified',
			additions: 1,
			deletions: 0,
		})),
		{
			filename: 'scripts/current-games/lib/compare.mjs',
			status: 'modified',
			additions: 1,
			deletions: 1,
		},
	],
});

// #31 — a harness file renamed away.
const REPORT_31 = report(sha(31), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(31), GREEN, {
	state: 'failure',
	description: (REPORT_31.summary as { line: string }).line,
});
artifact(sha(31), REPORT_31);
pull(31, 'engine: a rename', {
	sha: sha(31),
	files: [
		{
			filename: 'docs/old-report.mjs',
			previous_filename: 'scripts/current-games/lib/report.mjs',
			status: 'renamed',
			additions: 0,
			deletions: 0,
		},
	],
});

// #32 — more files than GitHub lists.
const REPORT_32 = report(sha(32), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(32), GREEN, {
	state: 'failure',
	description: (REPORT_32.summary as { line: string }).line,
});
artifact(sha(32), REPORT_32);
pull(32, 'engine: a huge change', {
	sha: sha(32),
	files: Array.from({ length: 3000 }, (_, i) => ({
		filename: `apps/lines/src/${i}.ts`,
		status: 'modified',
		additions: 1,
		deletions: 0,
	})),
});

// #33 — an approver whose account is disabled before the set completes.
const REPORT_33 = report(sha(33), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
]);
head(sha(33), GREEN, {
	state: 'failure',
	description: (REPORT_33.summary as { line: string }).line,
});
artifact(sha(33), REPORT_33);
pull(33, 'engine: a disabled approver', { sha: sha(33) });

// #34 — the report alone still reads; the full artifact, with the images, expired.
const REPORT_34 = report(sha(34), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(34), GREEN, {
	state: 'failure',
	description: (REPORT_34.summary as { line: string }).line,
});
const [, FULL_34] = artifact(sha(34), REPORT_34);
{
	const expired = (gh.artifacts.get(Number(harnessRun(sha(34)).id)) ?? []).find(
		(a) => a.id === FULL_34,
	) as Artifact;
	expired.expired = true;
	gh.zips.delete(FULL_34);
}
pull(34, 'engine: images expired', { sha: sha(34) });

// ── Replaced boundaries ───────────────────────────────────────────────────────
const approvals: PipelineApproval[] = [];
fake('lib/server/pipelineApprovals.ts', {
	listApprovals: async (headSha: string) =>
		approvals.filter((a) => a.headSha === headSha).sort((a, b) => +b.at - +a.at),
	recordApproval: async (input: Omit<PipelineApproval, 'id' | 'at'>) => {
		const existing = approvals.find(
			(a) => a.diffId === input.diffId && a.approverId === input.approverId,
		);
		if (existing) return existing;
		const row: PipelineApproval = {
			id: `ap-${approvals.length + 1}`,
			at: new Date(Date.now() + approvals.length),
			...input,
		};
		approvals.push(row);
		return row;
	},
	getApprovers: async (userIds: string[]) =>
		new Map(userIds.flatMap((id) => (accounts.has(id) ? [[id, accounts.get(id)]] : []))),
});
const accounts = new Map<string, { role: string; active: boolean; expiresAt: Date | null }>([
	['u-admin', { role: 'admin', active: true, expiresAt: null }],
	['u-tester', { role: 'pipelineTester', active: true, expiresAt: null }],
	['u-artist', { role: 'artist', active: true, expiresAt: null }],
]);
const userOverrides = new Map<string, Record<string, boolean>>();
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', {
	getToolOverrides: async (userId: string) => userOverrides.get(userId) ?? {},
});

// ── The modules under test ────────────────────────────────────────────────────
process.env.GITHUB_ENGINE_REPO = REPO;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_INSTALLATION_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;

const { createGithubApp, GithubAppError, githubApp, mintAppJwt } = await import(
	src('lib/server/githubApp.ts')
);
const changes = await import(src('lib/server/pipelineChanges.ts'));
const { openReportEntry } = await import(src('lib/server/pipelineReport.ts'));
const { locateCentralDirectory, readZipEntry } = await import(src('lib/server/zip.ts'));
const listRoute = await import(src('routes/api/pipeline/changes/+server.ts'));
const detailRoute = await import(src('routes/api/pipeline/changes/[number]/+server.ts'));
const approveRoute = await import(src('routes/api/pipeline/changes/[number]/approvals/+server.ts'));
const reportRoute = await import(
	src('routes/api/pipeline/changes/[number]/report/[...path]/+server.ts')
);
const view = await import(src('routes/(app)/pipeline/view.ts'));

type Locals = { user: App.Locals['user'] };
const ADMIN: Locals = {
	user: { id: 'u-admin', email: 'owner@example.com', name: 'Gualtiero', role: 'admin' },
};
const TESTER: Locals = {
	user: { id: 'u-tester', email: 'tester@example.com', name: null, role: 'pipelineTester' },
};
const ARTIST: Locals = {
	user: { id: 'u-artist', email: 'artist@example.com', name: 'Ann', role: 'artist' },
};
const ANON: Locals = { user: null };

type Answer = { status: number; body: Json };
async function call(
	handler: (event: unknown) => Promise<Response>,
	locals: Locals,
	params: Record<string, string> = {},
	body?: unknown,
): Promise<Answer> {
	const request = new Request('https://app.example/api/pipeline/changes', {
		method: body === undefined ? 'GET' : 'POST',
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
	});
	try {
		const res = await handler({ locals, params, request });
		const text = await res.text();
		answered.push(text);
		return { status: res.status, body: JSON.parse(text) as Json };
	} catch (err) {
		if (isHttpError(err)) {
			thrown.push(err.body.message);
			return { status: err.status, body: { error: err.body.message } };
		}
		throw err;
	}
}
const list = (locals: Locals) => call(listRoute.GET, locals);
const detail = (locals: Locals, number: string) => call(detailRoute.GET, locals, { number });
const approve = (locals: Locals, number: string, body: unknown) =>
	call(approveRoute.POST, locals, { number }, body);

type ByteAnswer = { status: number; bytes: Buffer; headers: Headers; body: Json };
/** The image route: a binary answer, or the JSON of a refusal. */
async function image(
	locals: Locals,
	number: string,
	path: string,
	query = '',
): Promise<ByteAnswer> {
	const url = new URL(`https://app.example/api/pipeline/changes/${number}/report/${path}${query}`);
	try {
		const res = await (reportRoute.GET as unknown as (event: unknown) => Promise<Response>)({
			locals,
			params: { number, path },
			url,
			request: new Request(url),
		});
		const bytes = Buffer.from(await res.arrayBuffer());
		const isJson = res.headers.get('content-type')?.startsWith('application/json') ?? false;
		const text = isJson ? bytes.toString('utf8') : '';
		answered.push(text || bytes.toString('latin1'));
		return { status: res.status, bytes, headers: res.headers, body: text ? JSON.parse(text) : {} };
	} catch (err) {
		if (isHttpError(err)) {
			thrown.push(err.body.message);
			return {
				status: err.status,
				bytes: Buffer.alloc(0),
				headers: new Headers(),
				body: { error: err.body.message },
			};
		}
		throw err;
	}
}

// ── Unconfigured: named, and nothing fetched ──────────────────────────────────
{
	const res = await list(ADMIN);
	check('unset App vars are a 503', res.status, 503);
	check(
		'…naming all three variables',
		['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'].every((v) =>
			String(res.body.error).includes(v),
		),
		true,
	);
	check('…and nothing was fetched', gh.requests.length, 0);
}
process.env.GITHUB_APP_ID = APP_ID;
process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
const beforeFirstList = gh.requests.length;
check('with all three set the list answers', (await list(ADMIN)).status, 200);
delete process.env.GITHUB_APP_PRIVATE_KEY;
{
	const res = await list(ADMIN);
	check('a missing key alone is a 503', res.status, 503);
	check(
		'…naming just the key',
		res.body.error,
		'GITHUB_APP_PRIVATE_KEY is not set on the launcher, so Invisible Pipeline Changes cannot reach GitHub.',
	);
}
// Railway may hold the key as one line with its newlines written out.
process.env.GITHUB_APP_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');

// ── The token: minted once, shared, renewed before expiry and after a 401 ─────
{
	const app = createGithubApp({
		config: () => ({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey }),
		transport: fakeFetch,
		now: () => fakeNow,
	});
	const before = gh.mints;
	const path = `/repos/${REPO}/pulls/14`;
	const [r1, r2] = await Promise.all([app.fetch(path), app.fetch(path)]);
	check(
		'two concurrent callers share one mint',
		[r1.status, r2.status, gh.mints - before],
		[200, 200, 1],
	);
	await app.fetch(path);
	check('a later call is served from the cache', gh.mints - before, 1);
	fakeNow += 50 * 60_000;
	await app.fetch(path);
	check('50 minutes in, the token is still used', gh.mints - before, 1);
	fakeNow += 6 * 60_000;
	await app.fetch(path);
	check('56 minutes in (5 before expiry), it is minted again', gh.mints - before, 2);
	gh.revoked.add(gh.tokens[gh.tokens.length - 1]);
	const res = await app.fetch(path);
	check('a 401 on a cached token mints once more and retries', res.status, 200);
	check('…one extra mint', gh.mints - before, 3);
	const again = await app.fetch(path);
	check('…and the new token is then cached', [again.status, gh.mints - before], [200, 3]);
	const requestsBefore = gh.requests.length;
	const elsewhere = await app.fetch('https://evil.example/collect').catch((e: unknown) => e);
	check(
		'the token never goes to a URL outside api.github.com',
		[elsewhere instanceof GithubAppError, gh.requests.length - requestsBefore],
		[true, 0],
	);
	thrown.push(String((elsewhere as Error).message));
	check(
		"a full URL of GitHub's own passes",
		(await app.fetch(`https://api.github.com${path}`)).status,
		200,
	);

	const bad = createGithubApp({
		config: () => ({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: 'not a pem' }),
		transport: fakeFetch,
	});
	const requests = gh.requests.length;
	const err = await bad.fetch(path).catch((e: unknown) => e);
	check('a bad key is a GithubAppError', err instanceof GithubAppError, true);
	check(
		'…naming the variable, not the value',
		String((err as Error).message),
		'GITHUB_APP_PRIVATE_KEY is not a PEM private key GitHub can verify.',
	);
	check('…and nothing was fetched', gh.requests.length, requests);
	thrown.push(String((err as Error).message));

	const unset = createGithubApp({
		config: () => ({ appId: '', installationId: '', privateKey: '' }),
		transport: fakeFetch,
	});
	const err2 = await unset.fetch(path).catch((e: unknown) => e);
	check('an unset config throws a 503 GithubAppError', (err2 as { status?: number }).status, 503);
	check('…and nothing was fetched', gh.requests.length, requests);
	thrown.push(String((err2 as Error).message));

	const jwtA = mintAppJwt(APP_ID, privateKey, 1_700_000_000_000);
	const jwtB = mintAppJwt(APP_ID, privateKey, 1_700_000_000_000);
	check('mintAppJwt is pure', jwtA, jwtB);
	gh.jwts.push(jwtA);
	const claims = verifyJwt(jwtA);
	check(
		'mintAppJwt verifies, with iat a minute back for skew',
		[claims.iss, claims.iat, claims.exp],
		[APP_ID, 1_700_000_000 - 60, 1_700_000_000 + 540],
	);
}

// ── The zip reader ────────────────────────────────────────────────────────────
{
	const zip = zipOf({ 'a.txt': 'stored', 'dir/b.json': '{"deflated":true}' }, ['dir/b.json']);
	check('a stored entry', readZipEntry(zip, 'a.txt', 1024)?.toString(), 'stored');
	check('a deflated entry', readZipEntry(zip, 'dir/b.json', 1024)?.toString(), '{"deflated":true}');
	check('a missing entry is null', readZipEntry(zip, 'nope', 1024), null);
	const threw = (fn: () => unknown): string => {
		try {
			fn();
			return '';
		} catch (e) {
			return (e as Error).message;
		}
	};
	check(
		'not a zip throws',
		threw(() => readZipEntry(Buffer.from('not a zip at all, not even close'), 'x', 1024)).includes(
			'not a ZIP',
		),
		true,
	);
	check(
		'a deflated entry over the bound throws',
		threw(() => readZipEntry(zip, 'dir/b.json', 4)) !== '',
		true,
	);
}

// ── Pure parts ────────────────────────────────────────────────────────────────
check(
	'isDependabot',
	[
		changes.isDependabot({ login: 'dependabot[bot]', type: 'Bot' }),
		changes.isDependabot({ login: 'dependabot-preview[bot]', type: 'Bot' }),
		changes.isDependabot({ login: 'dependabot', type: 'User' }),
		changes.isDependabot(null),
	],
	[true, true, false, false],
);
check(
	'checkState',
	[
		changes.checkState('in_progress', null),
		changes.checkState('completed', 'success'),
		changes.checkState('completed', 'skipped'),
		changes.checkState('completed', 'neutral'),
		changes.checkState('completed', 'failure'),
		changes.checkState('completed', 'cancelled'),
	],
	['pending', 'pass', 'skipped', 'skipped', 'fail', 'fail'],
);
check(
	'headOfDiffId',
	[
		changes.headOfDiffId(`${sha(14)}:bookofborut:win:abcd`),
		changes.headOfDiffId('abc:bookofborut:win:abcd'),
		changes.headOfDiffId(''),
	],
	[sha(14), null, null],
);
check(
	'whyFromBody: a Why heading',
	changes.whyFromBody('Intro.\n\n## Why\nBecause QA asked.\n\n## HISTORY entry\n- Did'),
	'Because QA asked.',
);
check(
	'whyFromBody: a bold lead-in',
	changes.whyFromBody('Intro.\r\n\r\n**Why:** QA spotted it\non two lines.\r\n\r\nMore.'),
	'QA spotted it\non two lines.',
);
check(
	'whyFromBody: the first paragraph',
	changes.whyFromBody('<!-- template -->\n# Title\n\nFirst paragraph.\n\nSecond.'),
	'First paragraph.',
);
check(
	'whyFromBody: nothing',
	[changes.whyFromBody(null), changes.whyFromBody('   ')],
	[null, null],
);
check(
	'whyFromBody: "Why not" is not a lead-in',
	changes.whyFromBody('Why not try it.\n\nSecond.'),
	'Why not try it.',
);
check(
	'approverName: the name, else the local part of the email',
	[
		changes.approverName({ name: ' Gualtiero ', email: 'g@example.com' }),
		changes.approverName({ name: null, email: 'tester@example.com' }),
	],
	['Gualtiero', 'tester'],
);
{
	const group = (jobs: { state: string; name: string; conclusion?: string | null }[]) => ({
		workflow: 'Lint',
		url: null,
		state: 'pass',
		jobs: jobs.map((j) => ({ url: null, conclusion: null, ...j })),
		passed: 0,
		total: 0,
	});
	const pass = group([{ name: 'lint', state: 'pass' }]);
	const ok = { state: 'success', description: 'ok' };
	check(
		'deriveStatus: ready',
		changes.deriveStatus({ mergeableState: 'clean', checks: [pass], harness: ok }),
		{ kind: 'ready' },
	);
	check(
		'deriveStatus: a conflict blocks',
		changes.deriveStatus({ mergeableState: 'dirty', checks: [pass], harness: ok }),
		{ kind: 'blocked', reason: 'Merge conflict with main' },
	);
	check(
		'deriveStatus: a failed job blocks with its row',
		changes.deriveStatus({
			mergeableState: 'clean',
			checks: [group([{ name: 'lint', state: 'fail', conclusion: 'timed_out' }])],
			harness: ok,
		}),
		{ kind: 'blocked', reason: 'Lint: lint timed out' },
	);
	check(
		'deriveStatus: a failed harness blocks with its description',
		changes.deriveStatus({
			mergeableState: 'clean',
			checks: [pass],
			harness: { state: 'failure', description: '2 changed screen(s)' },
		}),
		{ kind: 'blocked', reason: 'current-games: 2 changed screen(s)' },
	);
	check(
		'deriveStatus: blocked beats testing',
		changes.deriveStatus({
			mergeableState: 'clean',
			checks: [
				group([
					{ name: 'a', state: 'fail' },
					{ name: 'b', state: 'pending' },
				]),
			],
			harness: null,
		}),
		{ kind: 'blocked', reason: 'Lint: a failed' },
	);
	check(
		'deriveStatus: a pending job is testing',
		changes.deriveStatus({
			mergeableState: 'clean',
			checks: [
				group([
					{ name: 'a', state: 'pass' },
					{ name: 'b', state: 'pending' },
				]),
			],
			harness: ok,
		}),
		{ kind: 'testing', done: 2, total: 3 },
	);
	check(
		'deriveStatus: no harness report yet is testing',
		changes.deriveStatus({ mergeableState: 'clean', checks: [pass], harness: null }),
		{ kind: 'testing', done: 1, total: 2 },
	);
	check(
		'deriveStatus: a pending harness is testing',
		changes.deriveStatus({
			mergeableState: 'clean',
			checks: [pass],
			harness: { state: 'pending', description: null },
		}),
		{ kind: 'testing', done: 1, total: 2 },
	);
	check(
		'deriveStatus: skipped jobs do not count',
		changes.deriveStatus({
			mergeableState: 'unknown',
			checks: [
				group([
					{ name: 'a', state: 'pass' },
					{ name: 'b', state: 'skipped' },
				]),
			],
			harness: ok,
		}),
		{ kind: 'ready' },
	);
}

// ── The list ──────────────────────────────────────────────────────────────────
check('no session is a 401', (await list(ANON)).status, 401);
check('a role without the tool is a 403', (await list(ARTIST)).status, 403);
{
	const res = await list(TESTER);
	check('a Pipeline Tester sees the list', res.status, 200);
	const body = res.body as { changes: Json[]; dependabot: Json[]; forksSkipped: number };
	check(
		'every open PR into main, newest first, bar Director games and Dependabot',
		body.changes.map((c) => c.number),
		[34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 10],
	);
	check(
		'Dependabot apart',
		body.dependabot.map((c) => c.number),
		[11],
	);
	check(
		'the fork is skipped and counted',
		[(body as Json).forksSkipped, gh.requests.some((r) => r.includes('/pulls/24'))],
		[1, false],
	);
	check(
		'the other base was never asked for',
		gh.requests.some((r) => r.includes('/pulls/13')),
		false,
	);
	check(
		'the Director game was never read',
		gh.requests.some((r) => r.includes('/pulls/12')),
		false,
	);
	const by = (n: number) => body.changes.find((c) => c.number === n) as Json;
	check('#10 testing: one shard running, the harness rendering', by(10).status, {
		kind: 'testing',
		done: 3,
		total: 5,
	});
	check('#10 is a draft', by(10).draft, true);
	check(
		'#14 blocked by the harness, with its description, not by its failed report job',
		by(14).status,
		{
			kind: 'blocked',
			reason: `current-games: ${LINE_14}`,
		},
	);
	check('#15 blocked by a conflict despite green checks', by(15).status, {
		kind: 'blocked',
		reason: 'Merge conflict with main',
	});
	check('#16 ready', by(16).status, { kind: 'ready' });
	check(
		'#17 blocked by lint, and flagged as an agent definition',
		[by(17).status, by(17).agentDefinition],
		[{ kind: 'blocked', reason: 'Lint: lint failed' }, true],
	);
	check('#20 testing: the required harness has not reported', by(20).status, {
		kind: 'testing',
		done: 7,
		total: 8,
	});
	check('#11 (Dependabot) is ready', body.dependabot[0].status, { kind: 'ready' });
	check(
		'a change carries its branch, diff link and head',
		[by(14).branch, by(14).diffUrl, by(14).headSha],
		['feat/14', `https://github.com/${REPO}/pull/14/files`, sha(14)],
	);
	check('the list read GitHub', gh.requests.length > beforeFirstList, true);
	const afterFirst = gh.requests.length;
	const second = await list(ADMIN);
	check('a second list within 15 s is served from the cache', gh.requests.length, afterFirst);
	check('…and answers the same', second.body, res.body);
}

// ── The detail ────────────────────────────────────────────────────────────────
check('a Director game is not a change', (await detail(ADMIN, '12')).status, 404);
check('an unknown number is a 404', (await detail(ADMIN, '999')).status, 404);
check('a bad number is a 400', (await detail(ADMIN, 'x')).status, 400);
{
	const res = await detail(TESTER, '14');
	check('#14 detail', res.status, 200);
	const d = res.body as Json & { harness: Json; checks: Json[]; files: Json[] };
	check('files', d.files, [
		{
			path: 'services/atlas-tool/pack.py',
			previousPath: null,
			status: 'modified',
			additions: 30,
			deletions: 5,
			url: null,
		},
		{
			path: 'services/atlas-tool/tests/test_padding.py',
			previousPath: null,
			status: 'added',
			additions: 10,
			deletions: 0,
			url: null,
		},
	]);
	check('why', d.why, 'QA in Director spotted a 1 px bleed on H2 and L3.');
	check('the body comes along', String(d.body).startsWith('Raises sheet padding'), true);
	check(
		'Check 1: grouped by workflow with job counts, the harness left out',
		d.checks.map((g) => [g.workflow, g.state, g.passed, g.total]),
		[
			['Lint', 'pass', 1, 1],
			['Checks', 'pass', 3, 3],
			['svelte-check', 'pass', 1, 1],
			['Python', 'pass', 1, 1],
			['Secrets', 'pass', 1, 1],
		],
	);
	check(
		'…though its jobs are check runs on the head',
		h14.checkRuns.some((r) => r.name === 'report' && r.conclusion === 'failure'),
		true,
	);
	check(
		'Check 2: the PR run, not the push run that stood down',
		(d.harness.run as Json).id,
		PR_RUN_14,
	);
	check(
		'Check 2: the report is read from the report-only artifact',
		[(d.harness.report as Json).state, (d.harness.report as Json).artifactId],
		['ready', JSON_14],
	);
	check(
		'…and the full artifact is never downloaded',
		gh.requests.some((r) => r.includes(`/artifacts/${FULL_14}/zip`)),
		false,
	);
	check('Check 2: the status', (d.harness.status as Json).state, 'failure');
	check(
		'Check 2: the changed screens, none approved',
		(d.harness.diffs as Json[]).map((x) => [x.id, x.game, x.screen, x.approval]),
		DIFF_14.map((id, i) => [id, 'Book of Borut', ['win', 'bigwin'][i], null]),
	);
	check('Check 2: approvable', d.harness.unapprovable, null);
	check(
		'the report summary rides along',
		((d.harness.report as Json).report as Json).summary,
		(REPORT_14 as Json).summary,
	);
}
{
	const d = (await detail(ADMIN, '16')).body as { harness: Json };
	check(
		'#16: no report, because nothing was rendered',
		(d.harness.report as Json).state,
		'skipped',
	);
	check(
		'#16: nothing to approve',
		d.harness.unapprovable,
		'No report: this change cannot reach a game, so current-games passed without rendering one.',
	);
}
{
	const d = (await detail(ADMIN, '19')).body as { harness: Json; status: Json };
	check(
		'#19: an expired report is a state, not an error',
		(d.harness.report as Json).state,
		'expired',
	);
	check('#19: …that says so', String((d.harness.report as Json).detail).includes('expired'), true);
	check('#19: …with no diffs to show', d.harness.diffs, []);
	check('#19: the change is still blocked by the status', d.status, {
		kind: 'blocked',
		reason: 'current-games: 12 pass · 1 fail · 3 changed screen(s)',
	});
}
{
	const d = (await detail(ADMIN, '20')).body as { harness: Json };
	check('#20: no harness run yet', (d.harness.report as Json).state, 'none');
}
{
	const d = (await detail(ADMIN, '10')).body as { harness: Json };
	check('#10: the harness is still running', (d.harness.report as Json).state, 'running');
}
{
	const d = (await detail(ADMIN, '21')).body as { harness: Json };
	check("#21: a report for another commit is 'stale'", (d.harness.report as Json).state, 'stale');
}
{
	const d = (await detail(ADMIN, '18')).body as { harness: Json };
	check(
		'#18: a build failure cannot be approved away',
		d.harness.unapprovable,
		'Not a difference an approval can clear — HotFruits: the build failed; HotFruits: the branch runtime did not build',
	);
	check(
		'#18: an older run is read from its full artifact',
		(d.harness.report as Json).state,
		'ready',
	);
}
check('a fork is not a change', (await detail(ADMIN, '24')).status, 404);
{
	const d = (await detail(ADMIN, '25')).body as { harness: Json; status: Json };
	check(
		'#25: a change that edits the harness cannot be approved',
		String(d.harness.unapprovable),
		'This change edits the harness (scripts/current-games/tolerance.json), so its report proves nothing about it: harness changes need a manual merge after review.',
	);
	check('#25: …though its report reads', (d.harness.report as Json).state, 'ready');
}
{
	const d = (await detail(ADMIN, '26')).body as { harness: Json };
	check(
		'#26: a report naming no head is stale',
		[(d.harness.report as Json).state, (d.harness.report as Json).detail],
		['stale', 'The report names no head commit.'],
	);
}
{
	const d = (await detail(ADMIN, '27')).body as { harness: Json; checks: Json[] };
	check('#27: a PR\'s own workflow called "Current games" is not the harness', d.harness.run, null);
	check('#27: …so there is no report', (d.harness.report as Json).state, 'none');
	check(
		'#27: …and its jobs show in Check 1 like any workflow',
		d.checks.some((g) => g.workflow === 'Current games'),
		true,
	);
}
{
	const d = (await detail(ADMIN, '22')).body as { harness: Json };
	check("#22: a report from another attempt is 'stale'", (d.harness.report as Json).state, 'stale');
	check(
		'#22: …saying what the two say',
		String((d.harness.report as Json).detail).includes('another attempt'),
		true,
	);
	check('#22: …with no diffs to approve', d.harness.diffs, []);
}

// ── A changed screen's images, out of the full artifact by byte range ─────────
{
	const d = (await detail(ADMIN, '14')).body as { harness: Json; headSha: string };
	const zipSize = (gh.zips.get(FULL_14) as Buffer).length;
	check('#14: the detail names the images artifact', (d.harness.report as Json).images, {
		artifactId: FULL_14,
		sizeInBytes: zipSize,
		expiresAt: '2026-10-09T10:00:00Z',
	});
	const diffs = d.harness.diffs as (Json & { images: Record<string, string> })[];
	const before = diffs[0].images.before;
	const after = diffs[0].images.after;
	check('the report names the three images', Object.keys(diffs[0].images), [
		'before',
		'after',
		'diff',
	]);
	check('no session is a 401', (await image(ANON, '14', before)).status, 401);
	check('a role without the tool is a 403', (await image(ARTIST, '14', before)).status, 403);
	const from = gh.ranges.length;
	const res = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
	check('a reader of the tool gets the image', res.status, 200);
	check('…as a PNG', res.headers.get('content-type'), 'image/png');
	check(
		'…cacheable, since that artifact never changes',
		res.headers.get('cache-control'),
		'private, max-age=259200',
	);
	check('…the stored bytes', res.bytes.toString(), `PNG before ${before}`);
	const ranges = gh.ranges.slice(from);
	check(
		'…read in two ranges of the full artifact: its tail, then the entry',
		ranges.map((r) => r.id),
		[FULL_14, FULL_14],
	);
	check('…the tail first', ranges[0].range, `bytes=${Math.max(0, zipSize - 65536)}-${zipSize - 1}`);
	check('…then the entry alone', /^bytes=\d+-\d+$/.test(ranges[1].range), true);
	check(
		'…never the whole archive',
		gh.ranges.some((r) => r.id === FULL_14 && r.range === ''),
		false,
	);
	const deflated = await image(TESTER, '14', after, `?artifact=${FULL_14}`);
	check('a deflated entry inflates as it streams', deflated.bytes.toString(), `PNG after ${after}`);
	check(
		'without ?artifact the answer is not cached',
		(await image(TESTER, '14', before)).headers.get('cache-control'),
		'private, no-store',
	);
	check(
		'an artifact a re-run replaced is a 409',
		(await image(ADMIN, '14', before, `?artifact=${FULL_14 + 1}`)).status,
		409,
	);
	check('a bad artifact is a 400', (await image(ADMIN, '14', before, '?artifact=x')).status, 400);
	for (const path of [
		'report.json',
		'index.html',
		'screens/x.png',
		'../report.json',
		`screens/../${before}`,
		`/${before}`,
		'screens/bookofborut--nope.before.png',
		'',
	]) {
		check(
			`"${path}" is not an image the report lists`,
			(await image(ADMIN, '14', path)).status,
			404,
		);
	}
	check('an unknown change serves no image', (await image(ADMIN, '999', before)).status, 404);
	check('a Director game serves no image', (await image(ADMIN, '12', before)).status, 404);
	check('a fork serves no image', (await image(ADMIN, '24', before)).status, 404);
	check(
		'the report itself was still read from the report-only artifact',
		gh.ranges.some((r) => r.id === JSON_14 && r.range === ''),
		true,
	);
}
{
	const res = await image(ADMIN, '19', 'screens/bookofborut--win.before.png');
	check('an expired report serves no image', res.status, 404);
	check('…saying so', String(res.body.error).includes('expired'), true);
	check(
		'a running harness serves no image',
		(await image(ADMIN, '10', 'screens/bookofborut--win.before.png')).status,
		404,
	);
}
{
	const d = (await detail(ADMIN, '34')).body as { harness: Json };
	const report = d.harness.report as Json;
	check(
		'#34: the report reads with its images gone',
		[report.state, report.images],
		['ready', null],
	);
	const diffs = d.harness.diffs as (Json & { images: Record<string, string> })[];
	const res = await image(ADMIN, '34', diffs[0].images.before);
	check('#34: …so an image is a 404', res.status, 404);
	check('#34: …that says the images expired', String(res.body.error).includes('gone'), true);
}
{
	// A blob store that ignores the byte range: a small archive is read whole, a large one refused.
	const d = (await detail(ADMIN, '14')).body as { harness: Json };
	const before = (d.harness.diffs as (Json & { images: Record<string, string> })[])[0].images
		.before;
	const listed = (gh.artifacts.get(PR_RUN_14) ?? []).find((a) => a.id === FULL_14) as Artifact;
	const realSize = listed.size_in_bytes;
	gh.blobRanges = false;
	const whole = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
	check(
		'a blob store that ignores the range still serves a small archive',
		[whole.status, whole.bytes.toString()],
		[200, `PNG before ${before}`],
	);
	listed.size_in_bytes = 65 * 1024 * 1024;
	const big = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
	check(
		'…but a large one is refused rather than read whole',
		[big.status, String(big.body.error).includes('too large')],
		[502, true],
	);
	gh.blobRanges = true;
	// A listed size the blob disagrees with is corrected from the blob's own total, once.
	for (const wrong of [10, realSize + 1000, realSize + 1_000_000]) {
		listed.size_in_bytes = wrong;
		const from = gh.ranges.length;
		const fixed = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
		check(
			`a listed size of ${wrong} for an archive of ${realSize} is corrected from the blob's total`,
			[fixed.status, fixed.bytes.toString()],
			[200, `PNG before ${before}`],
		);
		check(
			'…with one extra range for the correction',
			gh.ranges.slice(from).filter((r) => r.id === FULL_14).length,
			3,
		);
	}
	listed.size_in_bytes = realSize;
}
{
	// A central directory bigger than the tail is fetched by its own range.
	const files: Record<string, string> = {};
	for (let i = 0; i < 1500; i++) {
		files[`screens/game-${String(i).padStart(4, '0')}--screen.before.png`] = `p${i}`;
	}
	files['screens/last.after.png'] = 'the last one';
	const zip = zipOf(files, ['screens/last.after.png']);
	const cd = locateCentralDirectory(zip, 0);
	check(
		"the fixture archive's directory is past a 64 KB tail",
		zip.length - cd.offset > 65536,
		true,
	);
	const id = 8000;
	gh.zips.set(id, zip);
	const from = gh.ranges.length;
	const images = { artifactId: id, sizeInBytes: zip.length, expiresAt: null };
	const stream = await openReportEntry(githubApp, REPO, images, 'screens/last.after.png');
	const text = stream ? Buffer.from(await new Response(stream).arrayBuffer()).toString() : null;
	check('the entry is read', text, 'the last one');
	check(
		'…in three ranges: the tail, the central directory, the entry',
		gh.ranges.slice(from).map((r) => r.range),
		[
			`bytes=${zip.length - 65536}-${zip.length - 1}`,
			`bytes=${cd.offset}-${cd.offset + cd.size - 1}`,
			gh.ranges[from + 2]?.range,
		],
	);
	check(
		'a file the archive lacks is null',
		await openReportEntry(githubApp, REPO, images, 'screens/nope.png'),
		null,
	);
}

// ── Approvals ─────────────────────────────────────────────────────────────────
check(
	'approving without a session is a 401',
	(await approve(ANON, '14', { diffId: DIFF_14[0] })).status,
	401,
);
check(
	'approving without the tool is a 403',
	(await approve(ARTIST, '14', { diffId: DIFF_14[0] })).status,
	403,
);
{
	const res = await approve(TESTER, '14', { diffId: DIFF_14[0] });
	check('approving with the tool but without pipelineMerge is a 403', res.status, 403);
	check('…naming the capability', String(res.body.error).includes('Merge pipeline changes'), true);
	check('…and nothing was recorded', approvals.length, 0);
}
check('a non-JSON body is a 400', (await approve(ADMIN, '14', 'nope')).status, 400);
check('a missing diffId is a 400', (await approve(ADMIN, '14', {})).status, 400);
check('a malformed diffId is a 400', (await approve(ADMIN, '14', { diffId: 'win' })).status, 400);
check(
	'a diff of another head is a 409',
	(await approve(ADMIN, '14', { diffId: `${sha(15)}:bookofborut:win:abcd` })).status,
	409,
);
check(
	'an unknown diff on this head is a 404',
	(await approve(ADMIN, '14', { diffId: `${sha(14)}:bookofborut:nope:abcd` })).status,
	404,
);
check('nothing posted so far', gh.posts, []);
{
	const res = await approve(ADMIN, '14', {
		diffId: DIFF_14[0],
		note: '  Intended: the new padding.  ',
	});
	check('the first approval is recorded', res.status, 200);
	check(
		'…one of two, nothing posted',
		[res.body.approved, res.body.of, res.body.statusPosted],
		[1, 2, false],
	);
	check(
		'…with the approver snapshot and the trimmed note',
		[(res.body.approval as Json).approver, (res.body.approval as Json).note],
		['Gualtiero', 'Intended: the new padding.'],
	);
	check('no status posted while a diff is unapproved', gh.posts.length, 0);
	const d = (await detail(ADMIN, '14')).body as { harness: Json; status: Json };
	check(
		'the detail shows it',
		(d.harness.diffs as Json[]).map((x) => (x.approval as Json | null)?.approver ?? null),
		['Gualtiero', null],
	);
	check('…and the change is still blocked', d.status.kind, 'blocked');
}
{
	const res = await approve(ADMIN, '14', { diffId: DIFF_14[1] });
	check(
		'the last approval completes the set',
		[res.body.approved, res.body.of, res.body.statusPosted],
		[2, 2, true],
	);
	check(
		'exactly one success posted, on the head SHA, to current-games, naming the approver',
		gh.posts,
		[
			{
				sha: sha(14),
				body: {
					state: 'success',
					context: 'current-games',
					description: 'All 2 changed screens approved by Gualtiero',
					target_url: `https://github.com/${REPO}/pull/14`,
				},
			},
		],
	);
	const d = (await detail(ADMIN, '14')).body as { harness: Json; status: Json };
	check('the change is now ready', d.status, { kind: 'ready' });
	check('…its harness status green', (d.harness.status as Json).state, 'success');
	check(
		'…every diff approved',
		(d.harness.diffs as Json[]).every((x) => x.approval),
		true,
	);
	// `unapprovable` reads the report, which still says what it said; the status is what changed.
	check('…and the report is still the approvable kind', d.harness.unapprovable, null);
}
{
	const res = await approve(ADMIN, '14', { diffId: DIFF_14[0] });
	check(
		'approving an approved diff again is idempotent',
		[res.status, res.body.approved, res.body.statusPosted],
		[200, 2, false],
	);
	check('…the first approval kept', (res.body.approval as Json).id, 'ap-1');
	check('…and no second post', gh.posts.length, 1);
	check('…nor a second row', approvals.length, 2);
}
{
	const listed = (await list(ADMIN)).body as { changes: Json[] };
	check(
		'the list sees the approval (its cache was dropped)',
		(listed.changes.find((c) => c.number === 14) as Json).status,
		{ kind: 'ready' },
	);
}

// ── A new push: the old approvals are void ────────────────────────────────────
userOverrides.set('u-tester', { pipelineMerge: true });
{
	const p14 = gh.pulls.get(14) as Pull;
	p14.head = { ...p14.head, sha: sha(140) };
	const report140 = report(sha(140), [
		{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
		{ key: 'hotfruits', name: 'HotFruits', looks: 'same' },
	]);
	head(sha(140), GREEN, {
		state: 'failure',
		description: (report140.summary as { line: string }).line,
	});
	artifact(sha(140), report140);
	const diffs140 = (report140.summary as { changedScreens: string[] }).changedScreens;
	const d = (await detail(ADMIN, '14')).body as { harness: Json; status: Json; headSha: string };
	check('the new head', d.headSha, sha(140));
	check('…is blocked again', d.status.kind, 'blocked');
	check(
		'…with new ids and no approvals',
		(d.harness.diffs as Json[]).map((x) => [x.id, x.approval]),
		diffs140.map((id) => [id, null]),
	);
	check('…and no approvals listed for it', d.harness.approvals, []);
	const stale = await approve(ADMIN, '14', { diffId: DIFF_14[0] });
	check('an approval of the old head is void', stale.status, 409);
	check('…saying so', String(stale.body.error).includes('new head'), true);
	check('…and posts nothing', gh.posts.length, 1);
	const first = await approve(TESTER, '14', { diffId: diffs140[0] });
	check('a user override grants the approval', first.status, 200);
	check('one of the new diffs posts nothing', gh.posts.length, 1);
	const done = await approve(ADMIN, '14', { diffId: diffs140[1] });
	check(
		'both new diffs approved posts on the NEW sha, once',
		[done.body.statusPosted, gh.posts.length, gh.posts[1].sha],
		[true, 2, sha(140)],
	);
	check(
		'…naming every approver in diff order, a nameless one by the local part of the email',
		gh.posts[1].body.description,
		'All 2 changed screens approved by tester, Gualtiero',
	);
}

// ── Never for an unfinished run, nothing to approve, or an unclearable failure ─
check(
	'an unfinished run refuses an approval',
	(await approve(ADMIN, '10', { diffId: `${sha(10)}:bookofborut:win:abcd` })).status,
	409,
);
check(
	'a run with no report refuses an approval',
	(await approve(ADMIN, '16', { diffId: `${sha(16)}:bookofborut:win:abcd` })).status,
	409,
);
{
	const res = await approve(ADMIN, '19', { diffId: `${sha(19)}:bookofborut:win:abcd` });
	check('an expired report refuses an approval', res.status, 409);
	check('…saying it expired', String(res.body.error).includes('expired'), true);
}
{
	const diff18 = (REPORT_18.summary as { changedScreens: string[] }).changedScreens[0];
	const res = await approve(ADMIN, '18', { diffId: diff18 });
	check(
		'a diff beside a build failure is recorded',
		[res.status, res.body.approved, res.body.of],
		[200, 1, 1],
	);
	check('…but never posts success', [res.body.statusPosted, gh.posts.length], [false, 2]);
}

{
	const res = await approve(TESTER, '18', {
		diffId: (REPORT_18.summary as { changedScreens: string[] }).changedScreens[0],
	});
	check(
		'a second approver of an approved diff adds an approval of their own',
		[res.status, (res.body.approval as Json).approver, res.body.approved],
		[200, 'tester', 1],
	);
}
check(
	'a report from another attempt refuses an approval',
	(
		await approve(ADMIN, '22', {
			diffId: (REPORT_22.summary as { changedScreens: string[] }).changedScreens[0],
		})
	).status,
	409,
);

// ── Two approvals at once complete the set exactly once ───────────────────────
{
	const [a, b] = (REPORT_23.summary as { changedScreens: string[] }).changedScreens;
	const posts = gh.posts.length;
	const [ra, rb] = await Promise.all([
		approve(ADMIN, '23', { diffId: a }),
		approve(TESTER, '23', { diffId: b }),
	]);
	check('both approvals land', [ra.status, rb.status], [200, 200]);
	check(
		'exactly one of them posts',
		[ra.body.statusPosted, rb.body.statusPosted].filter(Boolean).length,
		1,
	);
	check(
		"…one post, on #23's head, naming both",
		[gh.posts.length - posts, gh.posts[posts].sha, gh.posts[posts].body.description],
		[1, sha(23), 'All 2 changed screens approved by Gualtiero, tester'],
	);
}
// ── What an approval must refuse, whatever the report says ───────────────────
check(
	'a fork refuses an approval',
	(await approve(ADMIN, '24', { diffId: `${sha(24)}:bookofborut:win:abcd` })).status,
	404,
);
{
	const res = await approve(ADMIN, '25', {
		diffId: (REPORT_25.summary as { changedScreens: string[] }).changedScreens[0],
	});
	check('a change that edits the harness refuses an approval', res.status, 409);
	check('…saying why', String(res.body.error).includes('manual merge'), true);
	check(
		'…and records nothing',
		approvals.some((a) => a.headSha === sha(25)),
		false,
	);
}
{
	const d = (await detail(ADMIN, '30')).body as { harness: Json; files: Json[] };
	check('#30: every page of files is read', d.files.length, 141);
	check(
		'#30: a harness edit on the second page is seen',
		String(d.harness.unapprovable).includes('scripts/current-games/lib/compare.mjs'),
		true,
	);
	check(
		'#30: …and refuses an approval',
		(
			await approve(ADMIN, '30', {
				diffId: (REPORT_30.summary as { changedScreens: string[] }).changedScreens[0],
			})
		).status,
		409,
	);
}
{
	const d = (await detail(ADMIN, '31')).body as { harness: Json; files: Json[] };
	check(
		'#31: a file renamed out of the harness is seen where it was',
		[
			(d.files[0] as Json).previousPath,
			String(d.harness.unapprovable).includes('scripts/current-games/lib/report.mjs'),
		],
		['scripts/current-games/lib/report.mjs', true],
	);
	check(
		'#31: …and refuses an approval',
		(
			await approve(ADMIN, '31', {
				diffId: (REPORT_31.summary as { changedScreens: string[] }).changedScreens[0],
			})
		).status,
		409,
	);
}
{
	const d = (await detail(ADMIN, '32')).body as { harness: Json; filesTruncated: boolean };
	check(
		'#32: more files than GitHub lists is truncated and unapprovable',
		[d.filesTruncated, String(d.harness.unapprovable).includes('more files than GitHub lists')],
		[true, true],
	);
	const res = await approve(ADMIN, '32', {
		diffId: (REPORT_32.summary as { changedScreens: string[] }).changedScreens[0],
	});
	check(
		'#32: …and refuses an approval',
		[res.status, String(res.body.error).includes('manual merge')],
		[409, true],
	);
}
{
	const [a, b] = (REPORT_33.summary as { changedScreens: string[] }).changedScreens;
	const posts = gh.posts.length;
	check(
		'#33: the tester approves the first diff',
		(await approve(TESTER, '33', { diffId: a })).status,
		200,
	);
	accounts.set('u-tester', { role: 'pipelineTester', active: false, expiresAt: null });
	const second = await approve(ADMIN, '33', { diffId: b });
	check(
		'#33: a disabled approver no longer counts',
		[
			second.body.approved,
			second.body.statusPosted,
			String(second.body.withheld).includes('tester'),
		],
		[1, false, true],
	);
	accounts.set('u-tester', { role: 'pipelineTester', active: true, expiresAt: null });
	const again = await approve(ADMIN, '33', { diffId: b });
	check(
		'#33: …and counts again once the account is back',
		[again.body.approved, again.body.statusPosted, gh.posts.length - posts],
		[2, true, 1],
	);
}
check(
	'a report naming no head refuses an approval',
	(
		await approve(ADMIN, '26', {
			diffId: (REPORT_26.summary as { changedScreens: string[] }).changedScreens[0],
		})
	).status,
	409,
);
check(
	"a masquerading workflow's report refuses an approval",
	(
		await approve(ADMIN, '27', {
			diffId: (REPORT_27.summary as { changedScreens: string[] }).changedScreens[0],
		})
	).status,
	409,
);
{
	const posts = gh.posts.length;
	const res = await approve(ADMIN, '28', {
		diffId: (REPORT_28.summary as { changedScreens: string[] }).changedScreens[0],
	});
	check(
		'a report the jobs API contradicts is approved but never posted',
		[res.status, res.body.approved, res.body.of, res.body.statusPosted, gh.posts.length - posts],
		[200, 1, 1, false, 0],
	);
	check('…saying which job', String(res.body.withheld).includes('render (1/20) (failure)'), true);
}
{
	const [a, b] = (REPORT_29.summary as { changedScreens: string[] }).changedScreens;
	const posts = gh.posts.length;
	check(
		'the tester approves the first diff',
		(await approve(TESTER, '29', { diffId: a })).status,
		200,
	);
	userOverrides.delete('u-tester');
	const second = await approve(ADMIN, '29', { diffId: b });
	check(
		'an approval by someone who lost pipelineMerge no longer counts',
		[second.body.approved, second.body.of, second.body.statusPosted, gh.posts.length - posts],
		[1, 2, false, 0],
	);
	check(
		'…and the answer says whose',
		String(second.body.withheld),
		'The approval of win by tester no longer counts: tester no longer holds "Merge pipeline changes". Someone who does must approve it again.',
	);
	const d = (await detail(ADMIN, '29')).body as { harness: Json };
	check(
		'the detail counts the same way: that diff shows no approval, the row shows it lapsed',
		[
			(d.harness.diffs as Json[]).map((x) => (x.approval as Json | null)?.approver ?? null),
			(d.harness.approvals as Json[]).map((x) => [x.approver, x.standing]),
		],
		[
			[null, 'Gualtiero'],
			[
				['Gualtiero', true],
				['tester', false],
			],
		],
	);
	const replaced = await approve(ADMIN, '29', { diffId: a });
	check(
		'someone in standing approves it again beside the lapsed one, and the set completes',
		[
			replaced.body.approved,
			replaced.body.statusPosted,
			gh.posts.length - posts,
			gh.posts[posts]?.body.description,
		],
		[2, true, 1, 'All 2 changed screens approved by Gualtiero'],
	);
	userOverrides.set('u-tester', { pipelineMerge: true });
}

check(
	'no email address was ever posted to GitHub',
	gh.posts.some((p) => String(p.body.description).includes('@')),
	false,
);

// ── The page's pure wording (view.ts), over the same answers ──────────────────
{
	type Detail = Parameters<typeof view.blockedSentence>[0];
	const detailOf = async (number: string): Promise<Detail> =>
		(await detail(ADMIN, number)).body as unknown as Detail;
	check(
		'a merge conflict, in words',
		view.blockedSentence(await detailOf('15')),
		'Merge conflict with main: bring main in and resolve it.',
	);
	check(
		'a failed Check 1 job names the workflow and the job',
		view.blockedSentence(await detailOf('17')),
		'Lint: lint failed',
	);
	const d18 = view.blockedSentence(await detailOf('18'));
	check(
		'a failing report says what breaks, per game, in mockup 05 words',
		d18.startsWith(
			'Breaks Book of Borut: 1 of 12 screens look different (win); Breaks HotFruits: the build failed',
		) && d18.endsWith('.'),
		true,
	);
	check(
		'…without the approve hint when an approval cannot clear it',
		d18.includes('Approve each'),
		false,
	);
	check(
		'a difference an approval can clear says so',
		view.blockedSentence(await detailOf('34')),
		'Breaks Book of Borut: 1 of 12 screens look different (win). Approve each changed screen below, or push a fix.',
	);
	check(
		'a harness failure with no readable report falls back to the status line',
		view.blockedSentence(await detailOf('19')),
		'current-games: 12 pass · 1 fail · 3 changed screen(s)',
	);
	const d14 = await detailOf('14');
	check('a ready change has no blocked sentence', view.blockedSentence(d14), '');
	check('…and its approvals are complete', view.approvalState(d14.harness), 'complete');
	check('…and Check 2 counts its changed screens', view.check2Summary(d14.harness), {
		tone: 'red',
		label: '2 changed screens',
	});
	check('Check 1 sums the workflows', view.check1Summary(d14.checks), {
		kind: 'pass',
		passed: 7,
		total: 7,
		label: '7 of 7 passed',
	});
	const d10 = await detailOf('10');
	check('a running Check 1', view.check1Summary(d10.checks).label, 'running · 3 of 4');
	check('a running Check 2', view.check2Summary(d10.harness), { tone: 'blue', label: 'running' });
	check('a skipped Check 2', view.check2Summary((await detailOf('16')).harness), {
		tone: 'green',
		label: 'nothing to render',
	});
	check('an expired Check 2', view.check2Summary((await detailOf('19')).harness), {
		tone: 'amber',
		label: 'expired',
	});
	check('no approvals yet', view.approvalState((await detailOf('34')).harness), 'none');
	const rows = d14.harness.report.state === 'ready' ? d14.harness.report.report.games : [];
	check(
		'the games table cells',
		rows.map((r) => {
			const c = view.rowCells(r);
			return [c.build.text, c.tests.text, c.looks.text];
		}),
		[
			['Passed', 'Passed', '2 of 12 changed'],
			['Passed', 'Passed', 'Same on 12 screens'],
		],
	);
	check(
		'an image URL encodes each segment and names the artifact',
		view.reportImageUrl(14, 9001, 'screens/a b--win.before.png'),
		'/api/pipeline/changes/14/report/screens/a%20b--win.before.png?artifact=9001',
	);
	const t = Date.parse('2026-10-06T12:00:00Z');
	check(
		'time ago',
		[
			view.timeAgo('2026-10-06T11:59:40Z', t),
			view.timeAgo('2026-10-06T11:30:00Z', t),
			view.timeAgo('2026-10-06T09:00:00Z', t),
			view.timeAgo('2026-10-05T09:00:00Z', t),
			view.timeAgo('2026-10-03T09:00:00Z', t),
			view.timeAgo('2026-09-01T09:00:00Z', t),
		],
		['just now', '30 min ago', '3 h ago', 'yesterday', '3 days ago', '2026-09-01'],
	);
	check(
		'an error answer reads its sentence',
		[
			view.apiErrorText(503, { error: 'unset' }),
			view.apiErrorText(401, { message: 'no' }),
			view.apiErrorText(500, null),
		],
		['unset', 'no', 'The request failed (500).'],
	);
}

// ── No secret anywhere ────────────────────────────────────────────────────────
{
	const everything = [...printed, ...thrown, ...answered];
	check('something was printed or answered', everything.length > 0, true);
	const needles = [KEY_NEEDLE, ...gh.tokens, ...gh.jwts];
	check('the tokens were minted', gh.tokens.length >= 3, true);
	for (const needle of needles) {
		check(
			`nothing printed, thrown or answered carries ${needle.startsWith('ghs_') ? needle : needle === KEY_NEEDLE ? 'the private key' : 'an App JWT'}`,
			everything.some((s) => s.includes(needle)),
			false,
		);
	}
	check(
		'the fake saw only bearer tokens or JWTs, never the key',
		gh.requests.some((r) => r.includes(KEY_NEEDLE)),
		false,
	);
}

console.log = (...args: unknown[]) => process.stdout.write(`${args.join(' ')}\n`);
console.log();
if (failures) {
	process.stderr.write(`${failures} of ${checks} pipeline-changes checks FAILED\n`);
	process.exit(1);
}
console.log(`all ${checks} pipeline-changes checks pass`);
