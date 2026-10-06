/**
 * Contract check for Invisible Pipeline Changes' backend (ADR-0007; PLAN 5.1–5.3):
 *   pnpm --filter launcher-api check:pipeline-changes
 *
 * Runs the REAL modules — `githubApp.ts` (the App JWT and the installation token), `zip.ts`,
 * `pipelineReport.ts`, `pipelineChanges.ts`, `pipelineMerge.ts`, `pipelineAccess.ts` and the routes
 * under `/api/pipeline/changes` and `/api/pipeline/merges` — against a fake GitHub behind
 * `globalThis.fetch` that verifies every App JWT with the public half of a key made here, hands out
 * numbered installation tokens, records every status it is asked to post, serves artifact
 * downloads by byte range, merges pull requests onto a `main` of its own and keeps the trees,
 * commits and refs of the Git Data API. Replaced at their boundaries: the approvals and merges
 * tables (in memory) and the role / user override reads.
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
 *    the entry alone) and never whole; the images artifact a re-run replaced is a 409; an id the
 *    cached walk does not hold walks again at once when it is newer, and after 5 s when older;
 *  - a merge needs `pipelineMerge`, is GitHub's squash merge of a Ready change pinned to the head the
 *    user confirmed, titled `<title> (#n)` with the launcher's own message (never the PR body), and
 *    records who merged and the approvals that counted; anything short of Ready is refused before
 *    GitHub is asked, and GitHub's own refusal keeps its status and its sentence; a resend, two
 *    clicks at once and a crash between GitHub's merge and the row each come out as one merge;
 *  - History reads the launcher's table alone, and GitHub only for the rollbacks still open;
 *  - a rollback opens a revert PR built from three trees (the merge's parent, the merge, main):
 *    every file the merge changed goes back unless main changed it again, which refuses the whole
 *    revert with nothing written to GitHub; a resend answers the PR already open; the revert merges
 *    like any change and records what it undid.
 */
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { isHttpError } from '@sveltejs/kit';
import type { PipelineApproval, PipelineMerge } from '../src/lib/server/db/schema.ts';

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
	mergeable: boolean | null;
	merged: boolean;
	merged_by: { login: string; type: string } | null;
	merge_commit_sha: string | null;
	files: Json[];
}
/** A file of a tree as the Git Data API lists it: a blob, or a submodule's commit. */
interface GitEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
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
	/** A `content-length` the blob claims on a whole answer instead of the archive's real size. */
	blobClaimLength: null as number | null,
	/** Every merge asked for, with what it was asked with. */
	merges: [] as { number: number; body: Json }[],
	/** Every POST under `/git/` (`trees`, `commits`, `refs`), with its body. */
	gitWrites: [] as { path: string; body: Json }[],
	/** Every pull request opened. */
	pullPosts: [] as Json[],
	trees: new Map<string, { entries: GitEntry[]; truncated: boolean }>(),
	commits: new Map<string, { tree: string; parents: string[]; message: string }>(),
	/** `heads/<branch>` → the commit it points at. */
	refs: new Map<string, string>(),
	/** The tree a PR's squash merge leaves on main; else its head commit's, else main's own. */
	squashTrees: new Map<number, string>(),
	/** PRs branch protection refuses to merge. */
	protectedPulls: new Set<number>(),
	/** Runs once as a merge lands: a push to the branch landing first. */
	beforeMerge: null as ((p: Pull) => void) | null,
	/** Runs once as a branch is made: a parallel request making it first. */
	beforeRef: null as (() => void) | null,
	/** Whether the open-PR list fails, as when GitHub is down. */
	listFails: false,
};

// ── Git objects: blobs by content, trees and commits by what they hold ────────
const hash = (value: unknown): string =>
	createHash('sha1').update(JSON.stringify(value)).digest('hex');
type GitFile = Omit<GitEntry, 'path'>;
const file = (content: string, mode = '100644'): GitFile => ({
	mode,
	type: 'blob',
	sha: hash(['blob', content]),
});
function storeTree(entries: GitEntry[], truncated = false): string {
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));
	const id = hash(['tree', sorted, truncated]);
	gh.trees.set(id, { entries: sorted, truncated });
	return id;
}
const tree = (files: Record<string, GitFile>, truncated = false): string =>
	storeTree(
		Object.entries(files).map(([path, f]) => ({ path, ...f })),
		truncated,
	);
function commit(treeSha: string, parents: string[], message = 'fixture'): string {
	const id = hash(['commit', treeSha, parents, message, gh.commits.size]);
	gh.commits.set(id, { tree: treeSha, parents, message });
	return id;
}
const treeOf = (commitSha: string): string => (gh.commits.get(commitSha) as { tree: string }).tree;
const filesAt = (commitSha: string): Record<string, GitFile> =>
	Object.fromEntries(
		(gh.trees.get(treeOf(commitSha)) as { entries: GitEntry[] }).entries.map(({ path, ...f }) => [
			path,
			f,
		]),
	);
const mainTip = (): string => gh.refs.get('heads/main') as string;
/** Someone's push to main, outside the launcher. */
const pushMain = (files: Record<string, GitFile>): void => {
	gh.refs.set('heads/main', commit(tree(files), [mainTip()], 'a push'));
};
/** The App's own bot, as GitHub names it on what the App did. */
const BOT = { login: 'invisible-pipeline[bot]', type: 'Bot' };
let nextPull = 60;

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
		return new Response(new Uint8Array(zip), {
			status: 200,
			headers: { 'content-length': String(gh.blobClaimLength ?? zip.length) },
		});
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
	if (rest[0] === 'git') return gitData(method, rest.slice(1), url, init);
	if (rest[0] === 'pulls' && rest[2] === 'merge' && method === 'PUT') {
		return mergePull(Number(rest[1]), init);
	}
	if (rest[0] === 'pulls' && rest.length === 1 && method === 'POST') return openPull(init);
	if (rest[0] === 'pulls' && rest.length === 1 && url.searchParams.has('head')) {
		return pullsOfBranch(url);
	}
	if (rest[0] === 'pulls' && rest.length === 1) {
		check('pulls are asked for open PRs', url.searchParams.get('state'), 'open');
		if (gh.listFails) return jsonResponse(500, { message: 'Server Error' });
		const base = url.searchParams.get('base');
		if (url.searchParams.get('page') !== '1') return jsonResponse(200, []);
		const list = [...gh.pulls.values()]
			.filter((p) => p.state === 'open' && p.base.ref === base)
			.sort((a, b) => b.number - a.number)
			.map(listed);
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

/** A PR as GitHub's list answers it: no mergeability, no merger, `merged_at` for `merged`. */
const listed = ({
	files: _files,
	mergeable_state: _state,
	mergeable: _mergeable,
	merged,
	merged_by: _by,
	...p
}: Pull): Json => ({ ...p, merged_at: merged ? AT : null });

/** `PUT /pulls/{n}/merge`: GitHub's refusals, else a squash commit on main's tip. */
function mergePull(number: number, init: RequestInit | undefined): Response {
	const p = gh.pulls.get(number);
	if (!p) return jsonResponse(404, { message: 'Not Found' });
	const hook = gh.beforeMerge;
	gh.beforeMerge = null;
	hook?.(p);
	const body = JSON.parse(String(init?.body)) as Json;
	gh.merges.push({ number, body });
	check(`#${number}: the merge is a squash`, body.merge_method, 'squash');
	check(
		`#${number}: …titled as GitHub's own squash default`,
		body.commit_title,
		`${p.title} (#${number})`,
	);
	check(
		`#${number}: …with a message of the launcher's own, never the PR body`,
		typeof body.commit_message === 'string' &&
			!(p.body && String(body.commit_message).includes(p.body)),
		true,
	);
	if (body.sha !== p.head.sha) {
		return jsonResponse(409, {
			message: 'Head branch was modified. Review and try the merge again.',
		});
	}
	if (gh.protectedPulls.has(number)) {
		return jsonResponse(405, { message: 'Required status check "current-games" is expected.' });
	}
	if (p.draft || p.state !== 'open') {
		return jsonResponse(405, { message: 'Pull Request is not mergeable' });
	}
	const tip = mainTip();
	const squash = gh.squashTrees.get(number) ?? gh.commits.get(p.head.sha)?.tree ?? treeOf(tip);
	const mergeSha = commit(squash, [tip], `${body.commit_title}\n\n${body.commit_message}`);
	gh.refs.set('heads/main', mergeSha);
	Object.assign(p, { state: 'closed', merged: true, merged_by: BOT, merge_commit_sha: mergeSha });
	return jsonResponse(200, {
		sha: mergeSha,
		merged: true,
		message: 'Pull Request successfully merged',
	});
}

/** `POST /pulls`: a PR on a branch that exists. */
function openPull(init: RequestInit | undefined): Response {
	const body = JSON.parse(String(init?.body)) as Json;
	gh.pullPosts.push(body);
	const branch = String(body.head);
	const headSha = gh.refs.get(`heads/${branch}`);
	if (!headSha) return jsonResponse(422, { message: 'Validation Failed' });
	const { files: _files, ...opened } = pull(nextPull++, String(body.title), {
		sha: headSha,
		body: String(body.body),
		base: { ref: String(body.base) },
		head: { sha: headSha, ref: branch, repo: { full_name: REPO } },
		user: BOT,
	});
	return jsonResponse(201, opened);
}

/** `GET /pulls?state=all&head=<owner>:<branch>`: a branch's PRs, newest first. */
function pullsOfBranch(url: URL): Response {
	check("a branch's PRs are asked for in every state", url.searchParams.get('state'), 'all');
	const head = String(url.searchParams.get('head'));
	const owner = head.slice(0, head.indexOf(':'));
	const branch = head.slice(head.indexOf(':') + 1);
	const found = [...gh.pulls.values()]
		.filter((p) => owner === REPO.split('/')[0] && p.head.ref === branch)
		.sort((a, b) => b.number - a.number)
		.slice(0, Number(url.searchParams.get('per_page') ?? 30));
	return jsonResponse(200, found.map(listed));
}

/** The Git Data API: refs, commits and recursive trees read; trees, commits and refs written. */
function gitData(
	method: string,
	rest: string[],
	url: URL,
	init: RequestInit | undefined,
): Response {
	if (method === 'GET' && rest[0] === 'ref') {
		const name = rest.slice(1).map(decodeURIComponent).join('/');
		const target = gh.refs.get(name);
		if (!target) return jsonResponse(404, { message: 'Not Found' });
		return jsonResponse(200, { ref: `refs/${name}`, object: { sha: target, type: 'commit' } });
	}
	if (method === 'GET' && rest[0] === 'commits' && rest.length === 2) {
		const c = gh.commits.get(rest[1]);
		if (!c) return jsonResponse(404, { message: 'Not Found' });
		return jsonResponse(200, {
			sha: rest[1],
			message: c.message,
			tree: { sha: c.tree },
			parents: c.parents.map((sha) => ({ sha })),
		});
	}
	if (method === 'GET' && rest[0] === 'trees' && rest.length === 2) {
		check('a tree is listed recursively', url.searchParams.get('recursive'), '1');
		const t = gh.trees.get(rest[1]);
		if (!t) return jsonResponse(404, { message: 'Not Found' });
		// GitHub lists every directory as an entry of its own.
		const dirs = new Set(
			t.entries.flatMap((e) =>
				e.path
					.split('/')
					.slice(0, -1)
					.map((_, i, parts) => parts.slice(0, i + 1).join('/')),
			),
		);
		return jsonResponse(200, {
			sha: rest[1],
			tree: [
				...[...dirs].map((path) => ({
					path,
					mode: '040000',
					type: 'tree',
					sha: hash(['dir', rest[1], path]),
				})),
				...t.entries,
			],
			truncated: t.truncated,
		});
	}
	if (method !== 'POST' || rest.length !== 1) {
		return jsonResponse(404, { message: `fixture: no git route for ${method} ${rest.join('/')}` });
	}
	const body = JSON.parse(String(init?.body)) as Json;
	gh.gitWrites.push({ path: rest[0], body });
	if (rest[0] === 'trees') {
		const base = gh.trees.get(String(body.base_tree));
		if (!base) return jsonResponse(422, { message: 'Invalid tree info' });
		const files = new Map(base.entries.map((e) => [e.path, e]));
		for (const e of body.tree as (Omit<GitEntry, 'sha'> & { sha: string | null })[]) {
			if (e.sha === null) files.delete(e.path);
			else files.set(e.path, { path: e.path, mode: e.mode, type: e.type, sha: e.sha });
		}
		return jsonResponse(201, { sha: storeTree([...files.values()]), truncated: false });
	}
	if (rest[0] === 'commits') {
		const sha = commit(String(body.tree), body.parents as string[], String(body.message));
		return jsonResponse(201, { sha, tree: { sha: body.tree } });
	}
	if (rest[0] === 'refs') {
		const hook = gh.beforeRef;
		gh.beforeRef = null;
		hook?.();
		const name = String(body.ref).replace(/^refs\//, '');
		if (gh.refs.has(name)) return jsonResponse(422, { message: 'Reference already exists' });
		gh.refs.set(name, String(body.sha));
		return jsonResponse(201, { ref: body.ref, object: { sha: body.sha, type: 'commit' } });
	}
	return jsonResponse(404, { message: `fixture: no git route for POST ${rest[0]}` });
}

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
		mergeable: over.mergeable_state !== 'dirty',
		merged: false,
		merged_by: null,
		merge_commit_sha: null,
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

// #35 — a listed artifact size far below the blob's, and a diff image of an unknown type.
const REPORT_35 = report(sha(35), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
(REPORT_35.games as { screens: { images?: Record<string, string> }[] }[])[0].screens[1].images = {
	before: 'screens/bookofborut--win.before.png',
	after: 'screens/bookofborut--win.after.png',
	diff: 'screens/bookofborut--win.diff.dat',
};
head(sha(35), GREEN, {
	state: 'failure',
	description: (REPORT_35.summary as { line: string }).line,
});
const [, FULL_35] = artifact(sha(35), REPORT_35, { size_in_bytes: 10 });
pull(35, 'engine: odd sizes', { sha: sha(35) });

// #36 — a listed artifact size far above the blob's.
const REPORT_36 = report(sha(36), [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
]);
head(sha(36), GREEN, {
	state: 'failure',
	description: (REPORT_36.summary as { line: string }).line,
});
const [, FULL_36] = artifact(sha(36), REPORT_36);
{
	const listed = (gh.artifacts.get(Number(harnessRun(sha(36)).id)) ?? []).find(
		(a) => a.id === FULL_36,
	) as Artifact;
	listed.size_in_bytes = (gh.zips.get(FULL_36) as Buffer).length + 1_000_000;
}
pull(36, 'engine: a size too large', { sha: sha(36) });

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
const mergeRows: PipelineMerge[] = [];
/** Throws on the next record, once: the database failing after GitHub merged. */
let failNextRecord = false;
const newestFirst = (rows: PipelineMerge[]) => [...rows].sort((a, b) => +b.at - +a.at);
fake('lib/server/pipelineMerges.ts', {
	listMerges: async () => newestFirst(mergeRows),
	findMerge: async (prNumber: number) => mergeRows.find((m) => m.prNumber === prNumber) ?? null,
	findMergeByRequest: async (requestId: string) =>
		mergeRows.find((m) => m.requestId === requestId) ?? null,
	revertsOf: async (prNumbers: number[]) => {
		const byTarget = new Map<number, PipelineMerge>();
		for (const row of newestFirst(mergeRows)) {
			if (
				row.revertOf !== null &&
				prNumbers.includes(row.revertOf) &&
				!byTarget.has(row.revertOf)
			) {
				byTarget.set(row.revertOf, row);
			}
		}
		return byTarget;
	},
	recordMerge: async (input: Omit<PipelineMerge, 'id' | 'at'>) => {
		if (failNextRecord) {
			failNextRecord = false;
			throw new Error('fixture: the database went away');
		}
		const existing = mergeRows.find((m) => m.prNumber === input.prNumber);
		if (existing) return existing;
		const row: PipelineMerge = {
			id: `mg-${mergeRows.length + 1}`,
			at: new Date(Date.now() + mergeRows.length),
			...input,
		};
		mergeRows.push(row);
		return row;
	},
});
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
const { MAX_IMAGE_BYTES, openReportEntry, readBounded } = await import(
	src('lib/server/pipelineReport.ts')
);
const { locateCentralDirectory, readZipEntry } = await import(src('lib/server/zip.ts'));
const listRoute = await import(src('routes/api/pipeline/changes/+server.ts'));
const detailRoute = await import(src('routes/api/pipeline/changes/[number]/+server.ts'));
const approveRoute = await import(src('routes/api/pipeline/changes/[number]/approvals/+server.ts'));
const reportRoute = await import(
	src('routes/api/pipeline/changes/[number]/report/[...path]/+server.ts')
);
const { revertTargetOf } = await import(src('lib/server/pipelineMerge.ts'));
const mergeRoute = await import(src('routes/api/pipeline/changes/[number]/merge/+server.ts'));
const historyRoute = await import(src('routes/api/pipeline/merges/+server.ts'));
const revertRoute = await import(src('routes/api/pipeline/merges/[number]/revert/+server.ts'));
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
const mergeIt = (locals: Locals, number: string, body: unknown) =>
	call(mergeRoute.POST, locals, { number }, body);
const history = (locals: Locals) => call(historyRoute.GET, locals);
const rollBack = (locals: Locals, number: string, body: unknown) =>
	call(revertRoute.POST, locals, { number }, body);

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
		[36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 10],
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
		'private, max-age=259200, immutable',
	);
	check('…the stored bytes', res.bytes.toString(), `PNG before ${before}`);
	check(
		'…never a document or a script, whatever the bytes claim',
		[res.headers.get('x-content-type-options'), res.headers.get('content-security-policy')],
		['nosniff', "default-src 'none'; sandbox"],
	);
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
	const beforeSecond = gh.requests.length;
	const deflated = await image(TESTER, '14', after, `?artifact=${FULL_14}`);
	check('a deflated entry inflates as it streams', deflated.bytes.toString(), `PNG after ${after}`);
	check(
		'…and a second image of the same change costs one download: the PR, its head, the artifacts and the directory are remembered',
		gh.requests.slice(beforeSecond),
		[`GET /repos/${REPO}/actions/artifacts/${FULL_14}/zip`, `GET /artifacts/${FULL_14}`],
	);
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
	gh.blobRanges = false;
	const whole = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
	check(
		'a blob store that ignores the range still serves a small archive',
		[whole.status, whole.bytes.toString()],
		[200, `PNG before ${before}`],
	);
	gh.blobClaimLength = 65 * 1024 * 1024;
	const big = await image(TESTER, '14', before, `?artifact=${FULL_14}`);
	check(
		'…but a large one is refused by its content-length before a byte is read',
		[big.status, String(big.body.error).includes('too large')],
		[502, true],
	);
	gh.blobClaimLength = null;
	gh.blobRanges = true;
	const threw = async (fn: () => Promise<unknown>): Promise<string> => {
		try {
			await fn();
			return '';
		} catch (e) {
			return (e as Error).message;
		}
	};
	const body = new Uint8Array(1000);
	check(
		'a whole answer is refused by its bytes too, when the header lies',
		(await threw(() => readBounded(new Response(body), 100))).includes('too large'),
		true,
	);
	check('…and read when it fits', (await readBounded(new Response(body), 1000)).length, 1000);
}
{
	// A listed artifact size the blob disagrees with is corrected from the blob's own total, once,
	// on the first read of that artifact; the directory is then remembered.
	const d35 = (await detail(ADMIN, '35')).body as { harness: Json };
	const diffs35 = d35.harness.diffs as (Json & { images: Record<string, string> })[];
	let from = gh.ranges.length;
	const first = await image(TESTER, '35', diffs35[0].images.before, `?artifact=${FULL_35}`);
	check(
		'#35: a size listed far too small is corrected from the total',
		[first.status, first.bytes.toString()],
		[200, `PNG before ${diffs35[0].images.before}`],
	);
	check(
		'#35: …with one extra range for the correction',
		gh.ranges.slice(from).filter((r) => r.id === FULL_35).length,
		3,
	);
	from = gh.ranges.length;
	const dat = await image(TESTER, '35', diffs35[0].images.diff, `?artifact=${FULL_35}`);
	check(
		'#35: an image of no known type is served as bytes',
		[dat.status, dat.headers.get('content-type'), dat.bytes.toString()],
		[200, 'application/octet-stream', `PNG diff ${diffs35[0].images.diff}`],
	);
	check('#35: …in one range, the directory remembered', gh.ranges.slice(from).length, 1);
	const d36 = (await detail(ADMIN, '36')).body as { harness: Json };
	const diffs36 = d36.harness.diffs as (Json & { images: Record<string, string> })[];
	from = gh.ranges.length;
	const big = await image(TESTER, '36', diffs36[0].images.before, `?artifact=${FULL_36}`);
	check(
		'#36: a size listed far too large is corrected from the 416',
		[
			big.status,
			big.bytes.toString(),
			gh.ranges.slice(from).filter((r) => r.id === FULL_36).length,
		],
		[200, `PNG before ${diffs36[0].images.before}`, 3],
	);
}
{
	// A re-run replaces #35's artifacts under the same head: the detail names the new one at once,
	// and an image asked for by the new id is served without waiting the cache out.
	const [, NEW_35] = artifact(sha(35), REPORT_35);
	const d = (await detail(ADMIN, '35')).body as { harness: Json };
	const report = d.harness.report as Json & { images: Json };
	check('#35: the detail names the re-run’s artifact', report.images.artifactId, NEW_35);
	const diffs = d.harness.diffs as (Json & { images: Record<string, string> })[];
	const fresh = await image(TESTER, '35', diffs[0].images.before, `?artifact=${NEW_35}`);
	check(
		'#35: the new id is served at once — the cached walk is dropped and redone',
		[fresh.status, fresh.bytes.toString()],
		[200, `PNG before ${diffs[0].images.before}`],
	);
	const stale = await image(TESTER, '35', diffs[0].images.before, `?artifact=${FULL_35}`);
	check('#35: …and the old id is now the replaced one', stale.status, 409);
}
{
	// A cold detail opens every image at once: the artifact's directory is read once for all.
	const shared = zipOf({ 'screens/a.png': 'A', 'screens/b.png': 'B', 'screens/c.png': 'C' }, [
		'screens/b.png',
	]);
	gh.zips.set(8004, shared);
	const images = { artifactId: 8004, sizeInBytes: shared.length, expiresAt: null };
	const from = gh.ranges.length;
	const bodies = await Promise.all(
		['screens/a.png', 'screens/b.png', 'screens/c.png'].map(async (name) =>
			Buffer.from(
				await new Response(await openReportEntry(githubApp, REPO, images, name)).arrayBuffer(),
			).toString(),
		),
	);
	check('three images at once all read', bodies, ['A', 'B', 'C']);
	check(
		'…with one tail read between them, then one range each',
		gh.ranges.slice(from).filter((r) => r.id === 8004).length,
		4,
	);
}
{
	// What a branch could put in its artifact: an entry that inflates past what it declares, one
	// that declares more than any screen, a ZIP64 archive, an empty one.
	const threw = async (fn: () => Promise<unknown>): Promise<string> => {
		try {
			await fn();
			return '';
		} catch (e) {
			return (e as Error).message;
		}
	};
	const readAll = (stream: ReadableStream<Uint8Array> | null) =>
		stream ? new Response(stream).arrayBuffer() : Promise.resolve(new ArrayBuffer(0));
	const bomb = zipOf({ 'screens/bomb.png': Buffer.alloc(MAX_IMAGE_BYTES + 1024) }, [
		'screens/bomb.png',
	]);
	check('the bomb is small on the wire', bomb.length < 1024 * 1024, true);
	gh.zips.set(8001, bomb);
	const bombImages = { artifactId: 8001, sizeInBytes: bomb.length, expiresAt: null };
	check(
		'an entry that would inflate past the cap is cut off and the download torn down',
		(
			await threw(async () =>
				readAll(await openReportEntry(githubApp, REPO, bombImages, 'screens/bomb.png')),
			)
		).includes('larger than it declares'),
		true,
	);
	const liar = zipOf({ 'screens/liar.png': Buffer.alloc(1024 * 1024) }, ['screens/liar.png']);
	// The directory says 1,000 bytes; the data inflates to a megabyte.
	liar.writeUInt32LE(1000, locateCentralDirectory(liar, 0).offset + 24);
	gh.zips.set(8002, liar);
	check(
		'an entry that inflates past what it declares is cut off at the declaration',
		(
			await threw(async () =>
				readAll(
					await openReportEntry(
						githubApp,
						REPO,
						{ artifactId: 8002, sizeInBytes: liar.length, expiresAt: null },
						'screens/liar.png',
					),
				),
			)
		).includes('larger than it declares'),
		true,
	);
	const zip64 = zipOf({ 'a.txt': 'x' });
	zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
	check(
		'a ZIP64 archive is refused, not misread',
		(await threw(async () => readZipEntry(zip64, 'a.txt', 10))).includes('ZIP64'),
		true,
	);
	const zip64entry = zipOf({ 'a.txt': 'x' });
	zip64entry.writeUInt32LE(0xffffffff, locateCentralDirectory(zip64entry, 0).offset + 24);
	check(
		'…and so is a ZIP64 entry',
		(await threw(async () => readZipEntry(zip64entry, 'a.txt', 10))).includes('ZIP64'),
		true,
	);
	const empty = zipOf({});
	gh.zips.set(8003, empty);
	const from = gh.ranges.length;
	check(
		'an empty archive has no entry and asks for no directory range',
		[
			await openReportEntry(
				githubApp,
				REPO,
				{ artifactId: 8003, sizeInBytes: empty.length, expiresAt: null },
				'screens/x.png',
			),
			gh.ranges.slice(from).length,
		],
		[null, 1],
	);
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
		'only a GitHub page is a link; anything else renders as text',
		[
			view.safeHref('https://github.com/iw/engine/pull/14'),
			view.safeHref('https://github.com/iw/engine/actions/runs/1/job/2'),
			view.safeHref('javascript:alert(1)'),
			view.safeHref('http://github.com/iw/engine'),
			view.safeHref('https://github.com.evil.example/x'),
			view.safeHref('https://raw.githubusercontent.com/x'),
			view.safeHref(null),
			view.safeHref(undefined),
		],
		[
			'https://github.com/iw/engine/pull/14',
			'https://github.com/iw/engine/actions/runs/1/job/2',
			null,
			null,
			null,
			null,
			null,
			null,
		],
	);
	check(
		'a blocked reason never links off GitHub',
		view.blockedReason({
			...(await detailOf('19')),
			harness: {
				...(await detailOf('19')).harness,
				status: { state: 'failure', description: 'x', url: 'javascript:alert(1)', updatedAt: AT },
				run: null,
			},
		})?.url,
		null,
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

// ── An image asked for by an artifact id the cached walk does not hold ────────
{
	const h51 = hash('head 51');
	const report51 = report(h51, [
		{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win'] },
	]);
	head(h51, GREEN, { state: 'failure', description: (report51.summary as { line: string }).line });
	const [, first] = artifact(h51, report51);
	pull(51, 'engine: re-run twice', { sha: h51 });
	const d = (await detail(ADMIN, '51')).body as { harness: Json };
	const before = (d.harness.diffs as (Json & { images: Record<string, string> })[])[0].images
		.before;
	const walks = () => gh.requests.filter((r) => r === `GET /repos/${REPO}/pulls/51`).length;
	check(
		'#51: the image is served',
		(await image(TESTER, '51', before, `?artifact=${first}`)).status,
		200,
	);
	let from = walks();
	const older = await image(TESTER, '51', before, `?artifact=${first - 100}`);
	check(
		'#51: an OLDER id within 5 s of the walk is the replaced one, and nothing is walked again',
		[older.status, walks() - from],
		[409, 0],
	);
	const [, second] = artifact(h51, report51);
	from = walks();
	const newer = await image(TESTER, '51', before, `?artifact=${second}`);
	check(
		'#51: a NEWER id is walked again at once, and served',
		[newer.status, walks() - from],
		[200, 1],
	);
	from = walks();
	const realNow = Date.now;
	Date.now = () => realNow() + 6_000;
	try {
		const late = await image(TESTER, '51', before, `?artifact=${first}`);
		check(
			'#51: past 5 s an older id is walked again too — and is still the replaced one',
			[late.status, walks() - from],
			[409, 1],
		);
	} finally {
		Date.now = realNow;
	}
}

// ── Merging: the main it merges into, and the changes ─────────────────────────
const BASE_FILES: Record<string, GitFile> = {
	'apps/lines/src/other.ts': file('other v1'),
	'docs/readme.md': file('readme v1'),
	'scripts/build.sh': file('#!/bin/sh build'),
	'scripts/pack.sh': file('#!/bin/sh v1', '100755'),
	'services/atlas-tool/old.py': file('old helper'),
	'services/atlas-tool/pack.py': file('pack v1'),
	'vendor/engine': { mode: '160000', type: 'commit', sha: hash('engine v1') },
};
gh.refs.set('heads/main', commit(tree(BASE_FILES), []));
const short = (s: string): string => s.slice(0, 7);
const puts = (): string[] => gh.requests.filter((r) => r.startsWith('PUT '));
/** A green change that reaches no game: Ready as soon as it is read. */
function readyPull(
	number: number,
	title: string,
	over: Omit<Partial<Pull>, 'labels'> = {},
): string {
	const headSha = hash(`head ${number}`);
	head(headSha, GREEN, { state: 'success', description: 'docs only: nothing to render' });
	pull(number, title, { sha: headSha, ...over });
	return headSha;
}
const APP_VARS = ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'] as const;
async function unconfigured<T>(run: () => Promise<T>): Promise<T> {
	const saved = APP_VARS.map((name) => process.env[name]);
	for (const name of APP_VARS) delete process.env[name];
	try {
		return await run();
	} finally {
		APP_VARS.forEach((name, i) => {
			if (saved[i] !== undefined) process.env[name] = saved[i];
		});
	}
}

// #40 — two changed screens, both approved: the merge.
const H40 = hash('head 40');
const REPORT_40 = report(H40, [
	{ key: 'bookofborut', name: 'Book of Borut', looks: 'changed', changed: ['win', 'bigwin'] },
]);
head(H40, GREEN, { state: 'failure', description: (REPORT_40.summary as { line: string }).line });
artifact(H40, REPORT_40);
const DIFF_40 = (REPORT_40.summary as { changedScreens: string[] }).changedScreens;
const TITLE_40 = 'atlas-tool: 2 px padding';
pull(40, TITLE_40, {
	sha: H40,
	body: 'Raises padding to 2 px.\n\n[skip ci]',
	files: [
		{ filename: 'scripts/build.sh', status: 'modified', additions: 0, deletions: 0 },
		{ filename: 'scripts/pack.sh', status: 'modified', additions: 1, deletions: 1 },
		{ filename: 'services/atlas-tool/old.py', status: 'removed', additions: 0, deletions: 1 },
		{ filename: 'services/atlas-tool/pack.py', status: 'modified', additions: 3, deletions: 1 },
		{
			filename: 'services/atlas-tool/tests/test_padding.py',
			status: 'added',
			additions: 1,
			deletions: 0,
		},
		{ filename: 'vendor/engine', status: 'modified', additions: 1, deletions: 1 },
	],
});
// What #40's squash leaves on main: one file changed, one added, one deleted, a script changed,
// another made executable, and a submodule moved on.
gh.squashTrees.set(
	40,
	tree({
		...Object.fromEntries(
			Object.entries(BASE_FILES).filter(([path]) => path !== 'services/atlas-tool/old.py'),
		),
		'scripts/build.sh': file('#!/bin/sh build', '100755'),
		'scripts/pack.sh': file('#!/bin/sh v2', '100755'),
		'services/atlas-tool/pack.py': file('pack v2'),
		'services/atlas-tool/tests/test_padding.py': file('test'),
		'vendor/engine': { mode: '160000', type: 'commit', sha: hash('engine v2') },
	}),
);
// #41 — closed without merging.
const H41 = readyPull(41, 'engine: abandoned', { state: 'closed' });
// #42–#44, #46 — ready, nothing to render.
const H42 = readyPull(42, 'docs: a typo');
const H43 = readyPull(43, 'docs: protected');
const H44 = readyPull(44, 'docs: the crash');
// #45 — merged by a person on GitHub, never from here.
const H45 = readyPull(45, 'docs: merged by hand', {
	state: 'closed',
	merged: true,
	merged_by: { login: 'someone', type: 'User' },
	merge_commit_sha: hash('merged by hand'),
});
const H46 = readyPull(46, 'docs: two clicks');
// #53 — merged by another App's bot, on a head no one here confirmed.
readyPull(53, 'docs: merged by another bot', {
	state: 'closed',
	merged: true,
	merged_by: { login: 'other-app[bot]', type: 'Bot' },
	merge_commit_sha: hash('merged by another bot'),
});
// #54 — GitHub has not worked out whether it merges; #55 — it says it does not.
const H54 = readyPull(54, 'docs: mergeability unknown', { mergeable: null });
const H55 = readyPull(55, 'docs: mergeability false', { mergeable: false });

// ── Merging: who may ──────────────────────────────────────────────────────────
check(
	'merging without a session is a 401',
	(await mergeIt(ANON, '40', { headSha: H40, requestId: 'm' })).status,
	401,
);
check(
	'merging without the tool is a 403',
	(await mergeIt(ARTIST, '40', { headSha: H40, requestId: 'm' })).status,
	403,
);
userOverrides.delete('u-tester');
{
	const res = await mergeIt(TESTER, '40', { headSha: H40, requestId: 'm' });
	check(
		'merging with the tool but without pipelineMerge is a 403 naming the capability',
		[res.status, res.body.error],
		[403, 'This needs the "Merge pipeline changes" capability.'],
	);
}
userOverrides.set('u-tester', { pipelineMerge: true });
check('a non-JSON merge body is a 400', (await mergeIt(ADMIN, '40', 'nope')).status, 400);
check(
	'a merge without headSha is a 400',
	(await mergeIt(ADMIN, '40', { requestId: 'm' })).status,
	400,
);
check(
	'a merge with a short headSha is a 400',
	(await mergeIt(ADMIN, '40', { headSha: short(H40), requestId: 'm' })).status,
	400,
);
check(
	'a merge without requestId is a 400',
	(await mergeIt(ADMIN, '40', { headSha: H40 })).status,
	400,
);
check(
	'a merge with an overlong requestId is a 400',
	(await mergeIt(ADMIN, '40', { headSha: H40, requestId: 'x'.repeat(101) })).status,
	400,
);
check(
	'a merge of a bad number is a 400',
	(await mergeIt(ADMIN, 'x', { headSha: H40, requestId: 'm' })).status,
	400,
);
check(
	'a merge with the App unconfigured is a 503',
	(await unconfigured(() => mergeIt(ADMIN, '40', { headSha: H40, requestId: 'm' }))).status,
	503,
);
check('no merge reached GitHub', puts(), []);

// ── Merging: anything short of Ready, refused before GitHub is asked ──────────
{
	const h25 = gh.heads.get(sha(25)) as Head;
	const status25 = h25.statuses.find((s) => s.context === 'current-games') as Json;
	status25.state = 'success';
	const refusals: [string, string, string, number, string][] = [
		[
			'#10 is a draft (and still testing)',
			'10',
			sha(10),
			409,
			'This change is a draft: mark it ready for review on GitHub first.',
		],
		['#20 is still testing', '20', sha(20), 409, 'Still testing: 7 of 8 checks have passed.'],
		['#15 is blocked by a conflict', '15', sha(15), 409, 'Merge conflict with main'],
		[
			'#25 edits the harness: refused even with current-games green',
			'25',
			sha(25),
			409,
			'This change edits the harness (scripts/current-games/tolerance.json), so its report proves nothing about it: harness changes need a manual merge after review.',
		],
		[
			'#32 has more files than GitHub lists',
			'32',
			sha(32),
			409,
			'This change has more files than GitHub lists (3000), so what it edits cannot be checked: it needs a manual merge after review.',
		],
		['#41 is closed', '41', H41, 409, '#41 is closed.'],
		[
			'#54: GitHub is still working out mergeability',
			'54',
			H54,
			409,
			'GitHub is still working out whether this change merges cleanly; try again in a moment.',
		],
		['#55: GitHub says it does not merge', '55', H55, 409, 'Merge conflict with main.'],
		[
			'#24 is from a fork',
			'24',
			sha(24),
			404,
			"#24 is from a fork; pipeline changes come from this repository's branches.",
		],
		['#12 is a Director game', '12', sha(12), 404, '#12 is not a pipeline change.'],
		['#999 does not exist', '999', sha(999), 404, 'There is no change #999.'],
	];
	for (const [label, number, headSha, status, sentence] of refusals) {
		const res = await mergeIt(ADMIN, number, { headSha, requestId: `refused-${number}` });
		check(`merge refused: ${label}`, [res.status, res.body.error], [status, sentence]);
	}
	status25.state = 'failure';
	check('no refusal reached GitHub', puts(), []);
	check('…and none was recorded', mergeRows.length, 0);
}

// ── Merging: a Ready change ───────────────────────────────────────────────────
let row40: Json = {};
{
	const a = await approve(ADMIN, '40', { diffId: DIFF_40[0], note: 'Intended: wider padding.' });
	const b = await approve(TESTER, '40', { diffId: DIFF_40[1] });
	check(
		'#40: both changed screens approved, and current-games posted',
		[a.status, b.status, b.body.statusPosted],
		[200, 200, true],
	);
	changes.forgetChanges();
	const listedBefore = (await list(ADMIN)).body as { changes: Json[] };
	check('#40 is listed Ready', listedBefore.changes.find((c) => c.number === 40)?.status, {
		kind: 'ready',
	});
	const tip = mainTip();
	const res = await mergeIt(ADMIN, '40', { headSha: H40, requestId: 'merge-40' });
	check('#40 merges', [res.status, res.body.already], [200, false]);
	check('…in one PUT', puts(), [`PUT /repos/${REPO}/pulls/40/merge`]);
	check(
		"…a squash pinned to the head the checks ran on, under GitHub's own title, with the launcher's message",
		gh.merges[0].body,
		{
			merge_method: 'squash',
			sha: H40,
			commit_title: 'atlas-tool: 2 px padding (#40)',
			commit_message: `Merged from Invisible Pipeline Changes by Gualtiero.\n\nHead: ${H40}\nApproved screens: 2`,
		},
	);
	row40 = res.body.merge as Json;
	check(
		'…recorded: the change, its head, the merge, who merged',
		[
			row40.prNumber,
			row40.title,
			row40.headSha,
			row40.mergeSha,
			row40.mergedById,
			row40.mergedBy,
			row40.revertOf,
			row40.requestId,
		],
		[40, TITLE_40, H40, mainTip(), 'u-admin', 'Gualtiero', null, 'merge-40'],
	);
	check("…the merge is main's new tip, on the old one", gh.commits.get(mainTip())?.parents, [tip]);
	check(
		'…and the approvals that counted, snapshotted',
		(row40.approvals as Json[]).map((x) => [
			x.diffId,
			x.game,
			x.screen,
			x.approverId,
			x.approver,
			x.note,
		]),
		[
			[DIFF_40[0], 'Book of Borut', 'win', 'u-admin', 'Gualtiero', 'Intended: wider padding.'],
			[DIFF_40[1], 'Book of Borut', 'bigwin', 'u-tester', 'tester', null],
		],
	);
	check(
		'…each with its time',
		(row40.approvals as Json[]).every((x) => !Number.isNaN(Date.parse(String(x.at)))),
		true,
	);
	const listedAfter = (await list(ADMIN)).body as { changes: Json[] };
	check(
		'the list is read again at once: the merged change is gone from it',
		listedAfter.changes.some((c) => c.number === 40),
		false,
	);
	const d = (await detail(ADMIN, '40')).body;
	check(
		'the detail shows it merged, by the App',
		[d.state, d.merged, d.mergedBy, d.mergeCommitSha],
		['closed', true, 'invisible-pipeline[bot]', mainTip()],
	);
}
{
	const before = gh.requests.length;
	const again = await mergeIt(ADMIN, '40', { headSha: H40, requestId: 'merge-40' });
	check(
		'the same request again answers the same merge',
		[again.status, again.body.already, (again.body.merge as Json).id],
		[200, true, row40.id],
	);
	check('…without asking GitHub anything', gh.requests.length, before);
	const other = await mergeIt(ADMIN, '40', { headSha: H40, requestId: 'merge-40-again' });
	check(
		'another request on the merged change answers the same merge too',
		[other.status, other.body.already, (other.body.merge as Json).id],
		[200, true, row40.id],
	);
	check('…still one PUT', puts().length, 1);
	const reused = await mergeIt(ADMIN, '46', { headSha: H46, requestId: 'merge-40' });
	check(
		'a request that merged one change is refused for another',
		[reused.status, reused.body.error],
		[409, 'This request already merged #40; send a new one to merge #46.'],
	);
}

// ── Merging: the head moved, GitHub refused, the launcher died ────────────────
{
	const older = hash('an older head of 42');
	const res = await mergeIt(ADMIN, '42', { headSha: older, requestId: 'merge-42' });
	check(
		'a head that moved since the confirmation is a 409, never a merge',
		[res.status, res.body.error],
		[
			409,
			`The head moved: you looked at ${short(older)} and the branch is now at ${short(H42)}. Reload the change.`,
		],
	);
	check('…and no merge reached GitHub', puts().length, 1);
}
{
	gh.beforeMerge = (p) => {
		p.head = { ...p.head, sha: hash('a push during the merge') };
	};
	const res = await mergeIt(ADMIN, '42', { headSha: H42, requestId: 'merge-42-b' });
	check(
		"a push landing as GitHub merges: GitHub's own 409 and sentence",
		[res.status, res.body.error],
		[409, 'GitHub 409: Head branch was modified. Review and try the merge again.'],
	);
	check('…the merge went pinned to the head the launcher read', gh.merges.at(-1)?.body.sha, H42);
	check(
		'…and nothing was merged or recorded',
		[gh.pulls.get(42)?.merged, mergeRows.some((m) => m.prNumber === 42)],
		[false, false],
	);
}
{
	gh.protectedPulls.add(43);
	const res = await mergeIt(ADMIN, '43', { headSha: H43, requestId: 'merge-43' });
	check(
		"branch protection's refusal: GitHub's own 405 and sentence",
		[res.status, res.body.error],
		[405, 'GitHub 405: Required status check "current-games" is expected.'],
	);
	check(
		'…and nothing was merged or recorded',
		[gh.pulls.get(43)?.merged, mergeRows.some((m) => m.prNumber === 43)],
		[false, false],
	);
}
{
	failNextRecord = true;
	const crashed = await mergeIt(ADMIN, '44', { headSha: H44, requestId: 'merge-44' }).catch(
		(err: unknown) => err,
	);
	check(
		'the row failing after GitHub merged is an unexpected error (a 500)',
		crashed instanceof Error ? crashed.message : crashed,
		'fixture: the database went away',
	);
	thrown.push(String((crashed as Error).message));
	const p44 = gh.pulls.get(44) as Pull;
	check(
		'…though GitHub merged it, as the App',
		[p44.merged, p44.merged_by?.login, mergeRows.some((m) => m.prNumber === 44)],
		[true, 'invisible-pipeline[bot]', false],
	);
	const resent = await mergeIt(ADMIN, '44', { headSha: H44, requestId: 'merge-44' });
	const row = resent.body.merge as Json;
	check(
		"the click resent records it from GitHub's own answer, merging nothing",
		[resent.status, resent.body.already, row.prNumber, row.mergeSha, row.mergedBy, row.requestId],
		[200, true, 44, p44.merge_commit_sha, 'Gualtiero', 'merge-44'],
	);
	check(
		'…one PUT in all',
		puts().filter((r) => r.includes('/pulls/44/')),
		[`PUT /repos/${REPO}/pulls/44/merge`],
	);
}
{
	const res = await mergeIt(ADMIN, '45', { headSha: H45, requestId: 'merge-45' });
	check(
		"a change a person merged on GitHub is not the launcher's to record",
		[res.status, res.body.error],
		[409, '#45 was merged on GitHub by someone, not from here; there is nothing to record.'],
	);
	const other = await mergeIt(ADMIN, '53', {
		headSha: hash('a head no one confirmed'),
		requestId: 'merge-53',
	});
	check(
		'nor is one another bot merged on a head this click never saw',
		[other.status, other.body.error],
		[409, '#53 was merged on GitHub by other-app[bot], not from here; there is nothing to record.'],
	);
	check(
		'…and neither was recorded',
		mergeRows.some((m) => m.prNumber === 45 || m.prNumber === 53),
		false,
	);
}
{
	const before = puts().length;
	const [x, y] = await Promise.all([
		mergeIt(ADMIN, '46', { headSha: H46, requestId: 'merge-46-a' }),
		mergeIt(ADMIN, '46', { headSha: H46, requestId: 'merge-46-b' }),
	]);
	check('two clicks on one change at once both answer', [x.status, y.status], [200, 200]);
	check('…with one PUT between them', puts().length - before, 1);
	check('…and the same row', (x.body.merge as Json).id, (y.body.merge as Json).id);
	check(
		'…which exactly one of them made',
		[x.body.already, y.body.already].filter((already) => already === false).length,
		1,
	);
	check(
		'no changed screens, no "Approved screens" line',
		gh.merges.at(-1)?.body.commit_message,
		`Merged from Invisible Pipeline Changes by Gualtiero.\n\nHead: ${H46}`,
	);
}

// ── History ───────────────────────────────────────────────────────────────────
check('History without a session is a 401', (await history(ANON)).status, 401);
check('History without the tool is a 403', (await history(ARTIST)).status, 403);
{
	const res = await history(TESTER);
	const merges = res.body.merges as Json[];
	check(
		'History: every merge, newest first',
		merges.map((m) => m.prNumber),
		[46, 44, 40],
	);
	const h40 = merges.find((m) => m.prNumber === 40) as Json;
	check(
		'…each linked to its PR and its merge commit on GitHub',
		[h40.url, h40.commitUrl],
		[`https://github.com/${REPO}/pull/40`, `https://github.com/${REPO}/commit/${row40.mergeSha}`],
	);
	check(
		'…with who merged and the approvals that counted',
		[h40.mergedBy, (h40.approvals as Json[]).length],
		['Gualtiero', 2],
	);
	check('…nothing reverted yet', [h40.reverts, h40.revertedBy, h40.revertOpen], [null, null, null]);
}

// ── Rolling back ──────────────────────────────────────────────────────────────
const BRANCH_40 = `revert/40-${short(String(row40.mergeSha))}`;
check('a revert branch names the change it undoes', revertTargetOf(BRANCH_40), 40);
check(
	'…and no other branch does',
	[
		revertTargetOf('revert/40'),
		revertTargetOf('revert/40-xyz1234'),
		revertTargetOf('feat/revert/40-abcdef1'),
		revertTargetOf('feat/40'),
	],
	[null, null, null, null],
);
check('rolling back without a session is a 401', (await rollBack(ANON, '40', {})).status, 401);
check('rolling back without the tool is a 403', (await rollBack(ARTIST, '40', {})).status, 403);
userOverrides.delete('u-tester');
{
	const res = await rollBack(TESTER, '40', {});
	check(
		'rolling back without pipelineMerge is a 403 naming the capability',
		[res.status, res.body.error],
		[403, 'This needs the "Merge pipeline changes" capability.'],
	);
}
userOverrides.set('u-tester', { pipelineMerge: true });
check('a non-JSON rollback body is a 400', (await rollBack(ADMIN, '40', 'nope')).status, 400);
check(
	'a reason that is not text is a 400',
	(await rollBack(ADMIN, '40', { reason: 7 })).status,
	400,
);
check(
	'rolling back with the App unconfigured is a 503',
	(await unconfigured(() => rollBack(ADMIN, '40', {}))).status,
	503,
);
{
	const res = await rollBack(ADMIN, '45', {});
	check(
		'a change not merged from here is rolled back by hand',
		[res.status, res.body.error],
		[404, '#45 was not merged from here; roll it back by hand.'],
	);
}
check('nothing was written to GitHub', [gh.gitWrites, gh.pullPosts], [[], []]);
let revert40 = 0;
let revertSha40 = '';
{
	// main moves on in other files after #40 merged.
	pushMain({
		...filesAt(mainTip()),
		'apps/lines/src/other.ts': file('other v2'),
		'docs/new.md': file('new'),
	});
	const tip = mainTip();
	const res = await rollBack(ADMIN, '40', {
		requestId: 'rollback-40',
		reason: '  The padding broke HotFruits.  ',
	});
	check('a rollback opens a revert PR', [res.status, res.body.existing], [201, false]);
	check('…on a branch named after the merge', res.body.branch, BRANCH_40);
	const w = gh.gitWrites;
	check(
		'…written as one tree, one commit, one branch',
		w.map((x) => x.path),
		['trees', 'commits', 'refs'],
	);
	check("…the tree: main's, with every file #40 changed put back as its parent had it", w[0].body, {
		base_tree: treeOf(tip),
		tree: [
			{
				path: 'scripts/build.sh',
				mode: '100644',
				type: 'blob',
				sha: file('#!/bin/sh build').sha,
			},
			{ path: 'scripts/pack.sh', mode: '100755', type: 'blob', sha: file('#!/bin/sh v1').sha },
			{
				path: 'services/atlas-tool/old.py',
				mode: '100644',
				type: 'blob',
				sha: file('old helper').sha,
			},
			{
				path: 'services/atlas-tool/pack.py',
				mode: '100644',
				type: 'blob',
				sha: file('pack v1').sha,
			},
			{
				path: 'services/atlas-tool/tests/test_padding.py',
				mode: '100644',
				type: 'blob',
				sha: null,
			},
			{ path: 'vendor/engine', mode: '160000', type: 'commit', sha: hash('engine v1') },
		],
	});
	revertSha40 = String(w[2].body.sha);
	check(
		"…leaving main's later work alone",
		treeOf(revertSha40),
		tree({
			...BASE_FILES,
			'apps/lines/src/other.ts': file('other v2'),
			'docs/new.md': file('new'),
		}),
	);
	check(
		"…one commit on main's tip, in the launcher's words",
		[w[1].body.message, w[1].body.parents],
		[
			`revert: ${TITLE_40}\n\nThis reverts commit ${row40.mergeSha} (#40), merged from Invisible Pipeline Changes by Gualtiero.\nRolled back by Gualtiero.`,
			[tip],
		],
	);
	check('…one branch, on it', w[2].body, { ref: `refs/heads/${BRANCH_40}`, sha: revertSha40 });
	check('…and main itself untouched', mainTip(), tip);
	check('…one PR', gh.pullPosts.length, 1);
	const opened = gh.pullPosts[0];
	check(
		'…titled as a revert, from the branch into main',
		[opened.title, opened.head, opened.base],
		[`revert: ${TITLE_40}`, BRANCH_40, 'main'],
	);
	check(
		'…its body naming #40, the merge, who merged and the reason',
		opened.body,
		`Reverts #40 "${TITLE_40}" — merge ${short(String(row40.mergeSha))}, merged by Gualtiero on ${String(row40.at).slice(0, 10)} from Invisible Pipeline Changes.\n\n**Why:** The padding broke HotFruits.\n\nRolled back from Invisible Pipeline Changes by Gualtiero.\n\nThis is a pipeline change like any other: it merges from Invisible Pipeline Changes once its checks pass.`,
	);
	revert40 = Number(res.body.number);
	check('the answer names the PR', [res.body.url], [`https://github.com/${REPO}/pull/${revert40}`]);
	const d = (await detail(ADMIN, String(revert40))).body;
	check(
		'the revert is a change like any other, its why the reason',
		[d.branch, d.why, d.status],
		[BRANCH_40, 'The padding broke HotFruits.', { kind: 'testing', done: 0, total: 1 }],
	);
	const h40 = ((await history(ADMIN)).body.merges as Json[]).find((m) => m.prNumber === 40);
	check('History shows the rollback open on #40', h40?.revertOpen, {
		number: revert40,
		url: `https://github.com/${REPO}/pull/${revert40}`,
		branch: BRANCH_40,
	});
}
{
	const res = await rollBack(ADMIN, '40', { reason: 'again' });
	check(
		'rolling back again answers the revert already open',
		[res.status, res.body.existing, res.body.number, res.body.branch],
		[200, true, revert40, BRANCH_40],
	);
	check('…making nothing', [gh.gitWrites.length, gh.pullPosts.length], [3, 1]);
}
{
	const before = gh.requests.length;
	const res = await unconfigured(() => history(ADMIN));
	const h40 = (res.body.merges as Json[]).find((m) => m.prNumber === 40);
	check(
		'History answers with the App unconfigured, from the table alone',
		[res.status, (res.body.merges as Json[]).length, h40?.revertOpen, gh.requests.length - before],
		[200, 3, null, 0],
	);
	changes.forgetChanges();
	gh.listFails = true;
	const down = await history(ADMIN);
	gh.listFails = false;
	changes.forgetChanges();
	check(
		'…and with GitHub failing, the open rollback unknown',
		[down.status, (down.body.merges as Json[]).find((m) => m.prNumber === 40)?.revertOpen],
		[200, null],
	);
}
{
	head(revertSha40, GREEN, { state: 'success', description: 'docs only: nothing to render' });
	const res = await mergeIt(ADMIN, String(revert40), {
		headSha: revertSha40,
		requestId: `merge-${revert40}`,
	});
	const row = res.body.merge as Json;
	check('the revert merges like any change', [res.status, res.body.already], [200, false]);
	check('…recorded as undoing #40', row.revertOf, 40);
	check(
		"…and main holds #40's parent in every file #40 touched, with the later work kept",
		treeOf(mainTip()),
		tree({
			...BASE_FILES,
			'apps/lines/src/other.ts': file('other v2'),
			'docs/new.md': file('new'),
		}),
	);
	const merges = (await history(ADMIN)).body.merges as Json[];
	const h40 = merges.find((m) => m.prNumber === 40) as Json;
	const hRevert = merges.find((m) => m.prNumber === revert40) as Json;
	check(
		'History: #40 rolled back by the revert, nothing open',
		[h40.revertedBy, h40.revertOpen],
		[
			{
				number: revert40,
				mergeSha: row.mergeSha,
				at: row.at,
				url: `https://github.com/${REPO}/pull/${revert40}`,
			},
			null,
		],
	);
	check('…the revert names what it undid', hRevert.reverts, {
		number: 40,
		title: TITLE_40,
		url: `https://github.com/${REPO}/pull/40`,
	});
	const third = await rollBack(ADMIN, '40', {});
	check(
		'#40 cannot be rolled back a second time',
		[third.status, third.body.error],
		[409, `#40 was already rolled back by #${revert40}.`],
	);
}

// ── Rolling back: what is done by hand, with nothing written ──────────────────
{
	// #47 changes four files; main changes all four again after it merges.
	const H47 = readyPull(47, 'docs: four pages');
	const was = filesAt(mainTip());
	gh.squashTrees.set(
		47,
		tree({
			...was,
			'docs/a.md': file('a v1'),
			'docs/b.md': file('b v1'),
			'docs/c.md': file('c v1'),
			'docs/e.md': file('e v1'),
			'docs/readme.md': file('readme v2'),
		}),
	);
	check(
		'#47 merges',
		(await mergeIt(ADMIN, '47', { headSha: H47, requestId: 'merge-47' })).status,
		200,
	);
	pushMain({
		...filesAt(mainTip()),
		'docs/a.md': file('a v2'),
		'docs/b.md': file('b v2'),
		'docs/c.md': file('c v2'),
		'docs/readme.md': file('readme v3'),
	});
	const writes = gh.gitWrites.length;
	const opened = gh.pullPosts.length;
	const res = await rollBack(ADMIN, '47', {});
	check(
		'a revert that does not apply cleanly is refused, naming the files',
		[res.status, res.body.error],
		[
			409,
			'The revert does not apply cleanly: 4 files changed on main since the merge (docs/a.md, docs/b.md, docs/c.md, …). Revert #47 by hand.',
		],
	);
	check(
		'…with nothing written to GitHub: no tree, no commit, no branch, no PR',
		[gh.gitWrites.length - writes, gh.pullPosts.length - opened],
		[0, 0],
	);
}
{
	const writes = gh.gitWrites.length;
	const opened = gh.pullPosts.length;
	const tip = mainTip();
	const row = (prNumber: number, mergeSha: string): PipelineMerge => ({
		id: `mg-${prNumber}`,
		requestId: `merge-${prNumber}`,
		prNumber,
		title: `docs: #${prNumber}`,
		headSha: hash(`head ${prNumber}`),
		mergeSha,
		mergedById: 'u-admin',
		mergedBy: 'Gualtiero',
		at: new Date(),
		approvals: [],
		revertOf: null,
	});
	const twoParents = commit(treeOf(tip), [tip, hash('another line')]);
	mergeRows.push(row(48, twoParents));
	const truncated = commit(tree({ ...filesAt(tip), 'docs/big.md': file('big') }, true), [tip]);
	mergeRows.push(row(49, truncated));
	// #50 added a page that someone has since deleted on main by hand.
	const backByHand = commit(tree({ ...filesAt(tip), 'docs/gone.md': file('gone') }), [tip]);
	mergeRows.push(row(50, backByHand));
	const cases: [string, string, string][] = [
		[
			'a merge with two parents is not a squash',
			'48',
			`Merge ${short(twoParents)} is not a squash commit (it has 2 parents); revert it by hand.`,
		],
		[
			'a tree GitHub cannot list whole',
			'49',
			'The repository tree is too large for GitHub to list whole; revert #49 by hand.',
		],
		[
			'a merge that changed no file',
			'46',
			"main already holds none of #46's changes; there is nothing to revert.",
		],
		[
			'a merge main has already undone by hand',
			'50',
			"main already holds none of #50's changes; there is nothing to revert.",
		],
	];
	for (const [label, number, sentence] of cases) {
		const res = await rollBack(ADMIN, number, {});
		check(`rollback refused: ${label}`, [res.status, res.body.error], [409, sentence]);
	}
	check(
		'…each with nothing written to GitHub',
		[gh.gitWrites.length - writes, gh.pullPosts.length - opened],
		[0, 0],
	);
}

// ── Rolling back: a branch GitHub already has ─────────────────────────────────
{
	// A revert of #44 that someone closed.
	const branch = `revert/44-${short(String(mergeRows.find((m) => m.prNumber === 44)?.mergeSha))}`;
	gh.refs.set(`heads/${branch}`, mainTip());
	const closed = pull(70, 'revert: docs: the crash', {
		sha: mainTip(),
		head: { sha: mainTip(), ref: branch, repo: { full_name: REPO } },
		state: 'closed',
	});
	const res = await rollBack(ADMIN, '44', {});
	check(
		'a revert someone closed is not opened again',
		[res.status, res.body.error],
		[
			409,
			`A revert of #44 (#${closed.number}) was already closed; delete branch ${branch} on GitHub to try again.`,
		],
	);
}
{
	// The launcher made #46's branch and died before its PR.
	const branch = `revert/46-${short(String(mergeRows.find((m) => m.prNumber === 46)?.mergeSha))}`;
	gh.refs.set(`heads/${branch}`, mainTip());
	const writes = gh.gitWrites.length;
	const res = await rollBack(ADMIN, '46', {});
	check(
		'a branch with no PR gets its PR, and nothing else is made',
		[res.status, res.body.existing, res.body.branch, gh.gitWrites.length - writes],
		[201, false, branch, 0],
	);
	check('…from that branch', gh.pullPosts.at(-1)?.head, branch);
}
{
	// #52's revert races another request, which makes the branch and its PR first.
	const H52 = readyPull(52, 'docs: page 52');
	gh.squashTrees.set(52, tree({ ...filesAt(mainTip()), 'docs/52.md': file('52') }));
	const merged = await mergeIt(ADMIN, '52', { headSha: H52, requestId: 'merge-52' });
	const branch = `revert/52-${short(String((merged.body.merge as Json).mergeSha))}`;
	let winner = 0;
	gh.beforeRef = () => {
		gh.refs.set(`heads/${branch}`, mainTip());
		winner = pull(nextPull++, 'revert: docs: page 52', {
			sha: mainTip(),
			head: { sha: mainTip(), ref: branch, repo: { full_name: REPO } },
		}).number;
	};
	const writes = gh.gitWrites.length;
	const opened = gh.pullPosts.length;
	const res = await rollBack(ADMIN, '52', {});
	check(
		'a branch another request made first is answered, not made twice',
		[res.status, res.body.existing, res.body.number],
		[200, true, winner],
	);
	check(
		'…its own tree and commit made, its branch refused, and no PR opened',
		[gh.gitWrites.slice(writes).map((x) => x.path), gh.pullPosts.length - opened],
		[['trees', 'commits', 'refs'], 0],
	);
}

// ── The page's wording for merging and History (view.ts) ──────────────────────
{
	const detail40 = {
		number: 40,
		title: TITLE_40,
		headSha: H40,
		draft: false,
		filesTruncated: false,
	};
	check(
		'the merge confirmation names the head, short and whole, and the squash subject',
		view.mergeConfirmMessage(detail40),
		`${TITLE_40}\n\nSquash-merges head ${short(H40)} (${H40}) into main as "${TITLE_40} (#40)". Branch protection still applies.`,
	);
	const readOnly =
		'Merging needs the “Merge pipeline changes” permission. You can roll back from History.';
	check(
		'the bar under a Ready change: merge, draft, read-only, by hand — by hand said to everyone',
		[
			view.mergeBar(detail40, true, false),
			view.mergeBar({ ...detail40, draft: true }, true, false),
			view.mergeBar(detail40, false, false),
			view.mergeBar({ ...detail40, draft: true }, false, false),
			view.mergeBar(detail40, true, true),
			view.mergeBar({ ...detail40, filesTruncated: true }, false, true),
		],
		[
			{
				action: 'merge',
				text: `Squash-merges head ${short(H40)} into main. You can roll back from History.`,
			},
			{ action: 'draft', text: 'Mark the pull request ready for review on GitHub first.' },
			{ action: null, text: readOnly },
			{ action: null, text: readOnly },
			{
				action: null,
				text: 'Merge by hand on GitHub after review: this change edits the harness.',
			},
			{
				action: null,
				text: 'Merge by hand on GitHub after review: this change is too large to check.',
			},
		],
	);
	const merge40 = row40 as unknown as PipelineMerge;
	const later = Date.parse(String(merge40.at)) + 30_000;
	check(
		'the bar after the merge names the commit, who merged, and when',
		[
			view.mergedText({ merge: merge40, already: false }, later),
			view.mergedText({ merge: merge40, already: true }, later),
		],
		[
			`Merged into main as ${short(String(row40.mergeSha))} by Gualtiero · just now`,
			`Already merged into main as ${short(String(row40.mergeSha))} by Gualtiero · just now`,
		],
	);
	check(
		'the page names the revert branch as the server does',
		view.revertBranchOf(merge40),
		BRANCH_40,
	);
	check(
		'the rollback confirmation names the merge and its branch',
		view.rollbackConfirmMessage(merge40),
		`${TITLE_40}\n\nOpens a revert pull request of merge ${short(String(row40.mergeSha))} on branch ${BRANCH_40}. It goes through the same checks and approvals; nothing changes on main until it merges.`,
	);
	check(
		'the approvals of a merge, summed up',
		[
			view.approvalsSummary(merge40),
			view.approvalsSummary({ approvals: merge40.approvals.slice(0, 1) }),
			view.approvalsSummary({ approvals: [] }),
		],
		[
			'2 approved screens · by Gualtiero, tester',
			'1 approved screen · by Gualtiero',
			'No changed screens',
		],
	);
	const merges = (await history(TESTER)).body.merges as Json[];
	const stateOf = (n: number) =>
		view.historyRowState(
			merges.find((m) => m.prNumber === n) as unknown as Parameters<typeof view.historyRowState>[0],
		);
	check(
		'a History row rolls back once: not after its revert merged, nor while one is open',
		[stateOf(40), stateOf(46), stateOf(44)],
		['reverted', 'revert-open', 'rollbackable'],
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
