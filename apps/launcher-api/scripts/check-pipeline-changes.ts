/**
 * Contract check for Invisible Pipeline Changes' backend (ADR-0007; PLAN 5.1–5.2 and 5.4):
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
 *
 * The Agents tab (ADR-0007 "Agents tab"; PLAN 5.4) runs here too: `pipelineAgents.ts`,
 * `pipelineAgentEval.ts`, `agentEdit.ts` and the three routes under `/api/pipeline/agents`, against
 * the same fake GitHub grown a git (refs, commits, trees, blobs), contents, PR creation and labels,
 * seeded with the real definitions in `services/director-worker/agents/`. Pinned:
 *  - the list and one definition are `main`'s files, read from one commit: model, effort, tools,
 *    last change, and the open changes that edit each; a definition the loader or the adapter
 *    allow-lists would refuse is refused before anything is written;
 *  - a submit is ONE commit on a branch `agents/<name>-<hash of the request>` off main's tip,
 *    changing that one file, and a PR labelled `agent-definition` (the label made if it is
 *    missing), by the App with the user named, never their address; the same request finds its
 *    change (or finishes a half-made one) instead of making another, and other content under it
 *    is a 409; main moving mid-request is retried once, then refused; nothing ever writes to main;
 *  - the eval report is read only through the run its status names, which must be the eval
 *    workflow's own, and only when it is for this head and this agent; a state, never an error.
 */
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { isHttpError } from '@sveltejs/kit';
import type { PipelineApproval } from '../src/lib/server/db/schema.ts';
import {
	evalLine,
	parseEvalReport,
	type EvalReport,
} from '../../../services/director-worker/src/eval/report.ts';
import { KNOWN_TOOLS } from '../../../services/director-worker/src/tools.ts';

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
	/** A `content-length` the blob claims on a whole answer instead of the archive's real size. */
	blobClaimLength: null as number | null,
	/** The labels the repository has. The App makes `agent-definition` the first time it is needed. */
	labels: new Set<string>(),
	/** Workflow runs by id, as `GET actions/runs/<id>` answers (the eval workflow's). */
	runs: new Map<number, Json>(),
	/** The next label create is answered 422: another request made the label first. */
	labelRace: false,
};

const jsonResponse = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ── A fake git: commits, trees and blobs, and the refs that name them ─────────
const sha1 = (...parts: (string | Buffer)[]): string => {
	const hash = createHash('sha1');
	for (const part of parts) hash.update(part);
	return hash.digest('hex');
};
/** Git's own id for a file's bytes: what `POST git/blobs` answers and a contents read lists. */
const gitBlobId = (text: string): string => {
	const bytes = Buffer.from(text, 'utf8');
	return sha1(`blob ${bytes.length}\0`, bytes);
};
type Tree = Map<string, string>;
interface GitWrite {
	kind: 'blob' | 'tree' | 'commit' | 'ref' | 'pull' | 'label' | 'label-create';
}
const git = {
	blobs: new Map<string, string>(),
	trees: new Map<string, Tree>(),
	commits: new Map<string, { tree: string; parents: string[]; message: string }>(),
	/** `heads/main` → the commit it names. */
	refs: new Map<string, string>(),
	/** The last commit that touched a path, as `GET commits?path=` answers. */
	lastChange: new Map<string, Json>(),
	/** What the launcher wrote, in order. The fake's own doings are not here. */
	writes: [] as GitWrite[],
	/** Every `POST git/refs` asked for, made or refused. */
	refAttempts: [] as string[],
	/** The commits the FAKE moved `main` to (a push by someone else), oldest first. */
	mainMoves: [] as string[],
	/** Whether `main` moves, once or every time, while the launcher's commit is being made. */
	moveMain: 'never' as 'never' | 'once' | 'always',
	/** Runs once, just before the next branch is made: another request got there first. */
	beforeRef: null as (() => void) | null,
	/** Runs once, just before the next PR is opened: another instance opened it first. */
	beforePull: null as (() => void) | null,
};
let commitSeq = 0;
let pullSeq = 199;

function putBlob(text: string): string {
	const id = gitBlobId(text);
	git.blobs.set(id, text);
	return id;
}
function putTree(tree: Tree): string {
	const entries = [...tree].sort(([a], [b]) => (a < b ? -1 : 1));
	const id = sha1('tree', ...entries.map(([path, blob]) => `\0${path}\0${blob}`));
	git.trees.set(id, new Map(tree));
	return id;
}
function putCommit(tree: string, parents: string[], message: string): string {
	const id = sha1('commit', tree, parents.join(','), message, String(++commitSeq));
	git.commits.set(id, { tree, parents, message });
	return id;
}
const treeOf = (commit: string): Tree => git.trees.get(git.commits.get(commit)?.tree ?? '') as Tree;
/** A commit named by its id or by a branch. */
const resolveCommit = (ref: string): string | null =>
	git.commits.has(ref) ? ref : (git.refs.get(`heads/${ref}`) ?? null);
/** The paths whose blob differs between two trees. */
const changedPaths = (a: Tree, b: Tree): string[] =>
	[...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort();

/** Someone else's commit on `main`: by default a file that is no agent's, else `path` as `text`. */
function advanceMain(path = UNRELATED, text?: string): void {
	const main = git.refs.get('heads/main') as string;
	const tree = new Map(treeOf(main));
	const revision = git.mainMoves.length + 2;
	tree.set(path, putBlob(text ?? `not an agent, revision ${revision}\n`));
	const next = putCommit(putTree(tree), [main], `docs: revision ${revision}`);
	git.refs.set('heads/main', next);
	git.mainMoves.push(next);
}

const lines = (text: string): string[] => (text === '' ? [] : text.split('\n'));
function lineDiff(before: string, after: string): { additions: number; deletions: number } {
	const left = new Map<string, number>();
	for (const line of lines(before)) left.set(line, (left.get(line) ?? 0) + 1);
	let additions = 0;
	for (const line of lines(after)) {
		const n = left.get(line) ?? 0;
		if (n > 0) left.set(line, n - 1);
		else additions++;
	}
	return { additions, deletions: [...left.values()].reduce((a, b) => a + b, 0) };
}
/** The files a one-commit PR changes: that commit's tree against its first parent's. */
function filesOfCommit(commit: string): Json[] {
	const parent = git.commits.get(commit)?.parents[0];
	const before = parent ? treeOf(parent) : new Map<string, string>();
	const after = treeOf(commit);
	return changedPaths(before, after).map((filename) => {
		const was = before.get(filename);
		const now = after.get(filename);
		return {
			filename,
			status: was === undefined ? 'added' : now === undefined ? 'removed' : 'modified',
			...lineDiff(git.blobs.get(was ?? '') ?? '', git.blobs.get(now ?? '') ?? ''),
		};
	});
}

/** A branch, made behind the launcher's back: `text` at `path` on top of main's current commit. */
function fakeBranch(branch: string, path: string, text: string): string {
	const main = git.refs.get('heads/main') as string;
	const tree = new Map(treeOf(main));
	tree.set(path, putBlob(text));
	const commit = putCommit(putTree(tree), [main], 'someone else, earlier');
	git.refs.set(`heads/${branch}`, commit);
	return commit;
}

/** A PR into main for `branch`, as GitHub holds it: open, no labels, the App as author. */
function newPull(branch: string, headSha: string, title: string, body: string | null): Pull {
	return pull(++pullSeq, title, {
		sha: headSha,
		body,
		head: { sha: headSha, ref: branch, repo: { full_name: REPO } },
		user: { login: 'invisible-pipeline[bot]', type: 'Bot' },
		files: filesOfCommit(headSha),
	});
}

/**
 * The routes the Agents tab calls beyond the Changes tab's: refs, commits, trees and blobs (the
 * Git Data API), contents, PR creation and lookup by head, labels and a run by id. `null` for any
 * other route.
 */
function agentRoutes(
	method: string,
	rest: string[],
	url: URL,
	init?: RequestInit,
): Response | null {
	const body = (): Json => JSON.parse(String(init?.body)) as Json;
	const notFound = () => jsonResponse(404, { message: 'Not Found' });
	const invalid = (message: string) =>
		jsonResponse(422, { message: 'Validation Failed', errors: [{ message }] });
	const write = (kind: GitWrite['kind']): void => {
		git.writes.push({ kind });
	};
	const stripped = (p: Pull): Json => {
		const { files: _files, mergeable_state: _m, ...out } = p;
		return out;
	};

	if (rest[0] === 'git' && rest[1] === 'ref' && rest[2] === 'heads' && method === 'GET') {
		const name = rest.slice(3).join('/');
		const commit = git.refs.get(`heads/${name}`);
		if (!commit) return notFound();
		return jsonResponse(200, {
			ref: `refs/heads/${name}`,
			object: { type: 'commit', sha: commit },
		});
	}
	if (rest[0] === 'git' && rest[1] === 'commits' && rest.length === 3 && method === 'GET') {
		const commit = git.commits.get(rest[2]);
		if (!commit) return notFound();
		return jsonResponse(200, {
			sha: rest[2],
			tree: { sha: commit.tree },
			parents: commit.parents.map((sha) => ({ sha })),
			message: commit.message,
		});
	}
	if (rest[0] === 'git' && rest[1] === 'blobs' && method === 'POST') {
		const { content, encoding } = body() as { content?: unknown; encoding?: unknown };
		if (typeof content !== 'string' || (encoding !== 'utf-8' && encoding !== 'base64')) {
			return invalid('content and encoding are required');
		}
		const text = encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content;
		const id = putBlob(text);
		write('blob');
		return jsonResponse(201, { sha: id });
	}
	if (rest[0] === 'git' && rest[1] === 'trees' && method === 'POST') {
		const { base_tree, tree: entries } = body() as {
			base_tree: string;
			tree: { path: string; mode: string; type: string; sha: string }[];
		};
		const base = git.trees.get(base_tree);
		if (!base) return invalid('base_tree does not exist');
		const next = new Map(base);
		for (const e of entries) {
			if (e.mode !== '100644' || e.type !== 'blob' || !git.blobs.has(e.sha)) {
				return invalid(`${e.path} is not a blob that exists`);
			}
			next.set(e.path, e.sha);
		}
		const id = putTree(next);
		write('tree');
		return jsonResponse(201, { sha: id });
	}
	if (rest[0] === 'git' && rest[1] === 'commits' && rest.length === 2 && method === 'POST') {
		const { message, tree, parents } = body() as {
			message: string;
			tree: string;
			parents: string[];
		};
		if (!git.trees.has(tree) || !parents.every((p) => git.commits.has(p))) {
			return invalid('the tree or a parent does not exist');
		}
		const id = putCommit(tree, parents, message);
		write('commit');
		if (git.moveMain !== 'never') {
			advanceMain();
			if (git.moveMain === 'once') git.moveMain = 'never';
		}
		return jsonResponse(201, {
			sha: id,
			tree: { sha: tree },
			parents: parents.map((sha) => ({ sha })),
		});
	}
	if (rest[0] === 'git' && rest[1] === 'refs' && rest.length === 2 && method === 'POST') {
		const { ref, sha } = body() as { ref: string; sha: string };
		git.refAttempts.push(ref);
		const name = /^refs\/(heads\/.+)$/.exec(ref)?.[1];
		if (!name || !git.commits.has(sha)) return invalid('the ref or its sha is not valid');
		const hook = git.beforeRef;
		git.beforeRef = null;
		hook?.();
		if (git.refs.has(name)) return jsonResponse(422, { message: 'Reference already exists' });
		git.refs.set(name, sha);
		write('ref');
		return jsonResponse(201, { ref, object: { type: 'commit', sha } });
	}

	if (rest[0] === 'contents' && method === 'GET') {
		const path = rest.slice(1).map(decodeURIComponent).join('/');
		const commit = resolveCommit(url.searchParams.get('ref') ?? 'main');
		if (!commit) return jsonResponse(404, { message: 'No commit found for the specified ref' });
		const tree = treeOf(commit);
		const blob = tree.get(path);
		if (blob !== undefined) {
			const bytes = Buffer.from(git.blobs.get(blob) as string, 'utf8');
			return jsonResponse(200, {
				type: 'file',
				name: path.split('/').pop(),
				path,
				sha: blob,
				size: bytes.length,
				encoding: 'base64',
				// GitHub wraps the base64 at 60 columns, a newline after each line.
				content: `${(bytes.toString('base64').match(/.{1,60}/g) ?? []).join('\n')}\n`,
			});
		}
		const prefix = `${path}/`;
		const entries = new Map<string, Json>();
		for (const [p, id] of tree) {
			if (!p.startsWith(prefix)) continue;
			const [name, ...below] = p.slice(prefix.length).split('/');
			entries.set(
				name,
				below.length
					? { type: 'dir', name, path: prefix + name, sha: sha1('dir', prefix + name), size: 0 }
					: {
							type: 'file',
							name,
							path: p,
							sha: id,
							size: Buffer.byteLength(git.blobs.get(id) as string),
						},
			);
		}
		return entries.size ? jsonResponse(200, [...entries.values()]) : notFound();
	}
	if (rest[0] === 'commits' && rest.length === 1 && method === 'GET') {
		check('the last change is asked for as one commit', url.searchParams.get('per_page'), '1');
		if (!resolveCommit(url.searchParams.get('sha') ?? 'main')) {
			return jsonResponse(404, { message: 'No commit found for SHA' });
		}
		const last = git.lastChange.get(url.searchParams.get('path') ?? '');
		return jsonResponse(200, last ? [last] : []);
	}

	if (rest[0] === 'pulls' && rest.length === 1 && method === 'POST') {
		const {
			title,
			head,
			base,
			body: text,
			draft,
		} = body() as { title: string; head: string; base: string; body: string; draft?: boolean };
		const headSha = git.refs.get(`heads/${head}`);
		if (!headSha || base !== 'main') return invalid('the head or the base does not exist');
		const hook = git.beforePull;
		git.beforePull = null;
		hook?.();
		const open = [...gh.pulls.values()].some((p) => p.state === 'open' && p.head.ref === head);
		if (open) return invalid(`A pull request already exists for ${head}.`);
		const made = newPull(head, headSha, title, text);
		made.draft = draft === true;
		write('pull');
		return jsonResponse(201, stripped(made));
	}
	if (
		rest[0] === 'pulls' &&
		rest.length === 1 &&
		method === 'GET' &&
		url.searchParams.has('head')
	) {
		const [owner, ...branch] = String(url.searchParams.get('head')).split(':');
		check('a head is named owner:branch', owner, REPO.split('/')[0]);
		const state = url.searchParams.get('state') ?? 'open';
		return jsonResponse(
			200,
			[...gh.pulls.values()]
				.filter(
					(p) =>
						p.head.ref === branch.join(':') &&
						p.head.repo?.full_name === REPO &&
						(state === 'all' || p.state === state),
				)
				.sort((a, b) => b.number - a.number)
				.map(stripped),
		);
	}

	if (rest[0] === 'issues' && rest.length === 2 && method === 'GET') {
		const labelled = gh.pulls.get(Number(rest[1]));
		return labelled
			? jsonResponse(200, { number: labelled.number, labels: labelled.labels })
			: notFound();
	}
	if (rest[0] === 'issues' && rest[2] === 'labels' && method === 'POST') {
		const labelled = gh.pulls.get(Number(rest[1]));
		if (!labelled) return notFound();
		const { labels } = body() as { labels: string[] };
		// What GitHub says of a label the repository does not have, in this fake.
		if (labels.some((l) => !gh.labels.has(l))) {
			return jsonResponse(404, { message: 'Label does not exist' });
		}
		for (const name of labels) {
			if (labelled.labels.some((l) => l.name === name)) continue;
			labelled.labels.push({ name });
			write('label');
		}
		return jsonResponse(200, labelled.labels);
	}
	if (rest[0] === 'labels' && rest.length === 1 && method === 'POST') {
		const { name, color } = body() as { name: string; color: string };
		if (!/^[0-9a-f]{6}$/i.test(color)) return invalid('a label colour is six hex digits, no #');
		if (gh.labelRace) {
			// Someone else made it between the failed add and this create.
			gh.labelRace = false;
			gh.labels.add(name);
		}
		if (gh.labels.has(name)) {
			return jsonResponse(422, {
				message: 'Validation Failed',
				errors: [{ resource: 'Label', code: 'already_exists', field: 'name' }],
			});
		}
		gh.labels.add(name);
		write('label-create');
		return jsonResponse(201, { name, color });
	}

	if (rest[0] === 'actions' && rest[1] === 'runs' && rest.length === 3 && method === 'GET') {
		const run = gh.runs.get(Number(rest[2]));
		return run ? jsonResponse(200, run) : notFound();
	}
	return null;
}

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
	const agentAnswer = agentRoutes(method, rest, url, init);
	if (agentAnswer) return agentAnswer;
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

// ── The repository's git, as the Agents tab reads and writes it ───────────────
const AGENTS_DIR = 'services/director-worker/agents';
/** A file on main that is no agent's: the one a push by someone else changes. */
const UNRELATED = 'docs/unrelated.md';
const agentFile = (name: string): string => `${AGENTS_DIR}/${name}.md`;
/** The real definitions, read from disk: a real edit of one keeps the fixture honest. */
const AGENT_TEXTS = new Map<string, string>(
	readdirSync(new URL('../../../services/director-worker/agents/', import.meta.url))
		.filter((file) => file.endsWith('.md'))
		.map((file) => file.slice(0, -3))
		.sort()
		.map((name) => [
			name,
			readFileSync(
				new URL(`../../../services/director-worker/agents/${name}.md`, import.meta.url),
				'utf8',
			),
		]),
);
const SEED_MAIN = (() => {
	const tree: Tree = new Map([[UNRELATED, putBlob('not an agent\n')]]);
	for (const [name, text] of AGENT_TEXTS) tree.set(agentFile(name), putBlob(text));
	return putCommit(putTree(tree), [], 'seed');
})();
git.refs.set('heads/main', SEED_MAIN);
[...AGENT_TEXTS.keys()].forEach((name, i) => {
	const id = sha(500 + i);
	git.lastChange.set(agentFile(name), {
		sha: id,
		html_url: `https://github.com/${REPO}/commit/${id}`,
		commit: {
			message: `agents: ${name} — seeded as number ${i}\n\nThe longer message, never shown.`,
			author: { name: `Author ${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00Z` },
		},
		// One commit GitHub cannot tie to an account: the name on the commit is used.
		author: i === 2 ? null : { login: `author-${i}` },
	});
});

// ── The agent-eval workflow's side: a status, a run, a report artifact ────────
const evalRunUrl = (id: number): string => `https://github.com/${REPO}/actions/runs/${id}`;
let evalRunSeq = 5000;
/** A run of the eval workflow as the Actions API describes it; `over` makes it something else. */
function evalRun(over: Json = {}): number {
	const id = ++evalRunSeq;
	gh.runs.set(id, {
		id,
		path: '.github/workflows/agent-eval.yml',
		event: 'pull_request_target',
		status: 'completed',
		conclusion: 'success',
		html_url: evalRunUrl(id),
		repository: { full_name: REPO },
		...over,
	});
	return id;
}
/** The artifact the workflow uploads on a run: a ZIP holding `report.json`. */
function evalArtifact(run: number, files: Record<string, string>, over: Partial<Artifact> = {}) {
	const id = ++artifactId;
	const zip = zipOf(files, Object.keys(files));
	gh.zips.set(id, zip);
	gh.artifacts.set(run, [
		{
			id,
			name: 'agent-eval-report',
			expired: false,
			expires_at: '2026-12-31T00:00:00Z',
			size_in_bytes: zip.length,
			...over,
		},
	]);
	return id;
}
/** The `agent-eval` status on a head, as the workflow posts it. */
function setEvalStatus(h: Head, state: string, description: string, url: string | null): void {
	h.statuses = [
		...h.statuses.filter((s) => s.context !== 'agent-eval'),
		{ context: 'agent-eval', state, description, target_url: url, updated_at: AT },
	];
}
/** A valid report, built the way the workflow's CLI builds one: `parseEvalReport` accepts it. */
function evalReport(headSha: string, spec: { agent?: string; capped?: boolean } = {}): EvalReport {
	const side = (score: number, costUsd: number) => ({
		definition: { model: 'claude-opus-5-5', effort: 'high' },
		score,
		statusAgreement: score,
		regionAgreement: score,
		extraElements: 0,
		calls: 6,
		usage: {
			inputTokens: 12_000,
			outputTokens: 900,
			cacheReadInputTokens: 0,
			cacheCreationInputTokens: 0,
		},
		costUsd,
	});
	const view = { found: true, name: 'Spin', status: 'Matched', regions: ['ui.spin'] };
	const capped = spec.capped === true;
	const parts: Omit<EvalReport, 'version' | 'head' | 'base' | 'line'> = {
		agent: spec.agent ?? 'qa',
		result: capped ? 'capped' : 'scored',
		capUsd: 20,
		costUsd: capped ? 20.4 : 2.6,
		capped,
		set: { name: 'fixture-set', images: 2, elements: 4 },
		before: side(0.5, capped ? 20 : 1.2),
		after: capped ? null : side(0.75, 1.4),
		items: capped
			? []
			: [
					{
						image: 'a.png',
						n: 1,
						name: 'Spin',
						expected: { status: 'Matched', regions: ['ui.spin'] },
						before: { ...view, statusMatch: true, regionScore: 0.5 },
						after: { ...view, statusMatch: true, regionScore: 1 },
						changed: true,
					},
				],
		errors: capped ? ['stopped after 11 calls'] : [],
	};
	return parseEvalReport({
		version: 1,
		...parts,
		head: { sha: headSha },
		base: { sha: SEED_MAIN },
		line: evalLine(parts),
	});
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
const view = await import(src('routes/(app)/pipeline/view.ts'));
const agents = await import(src('lib/server/pipelineAgents.ts'));
const agentEval = await import(src('lib/server/pipelineAgentEval.ts'));
const agentEdit = await import(src('lib/agentEdit.ts'));
const { ADAPTER_OPS, opId } = await import(src('lib/server/director/registry.ts'));
const agentsListRoute = await import(src('routes/api/pipeline/agents/+server.ts'));
const agentRoute = await import(src('routes/api/pipeline/agents/[name]/+server.ts'));
const agentChangeRoute = await import(src('routes/api/pipeline/agents/[name]/changes/+server.ts'));

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
			// A refusal that lists its reasons (the Agents tab's validator) carries them beside the sentence.
			const errors = (err.body as { errors?: unknown }).errors;
			if (errors !== undefined) thrown.push(JSON.stringify(errors));
			return {
				status: err.status,
				body: { error: err.body.message, ...(errors === undefined ? {} : { errors }) },
			};
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

// ── Agent definitions: the pure parts ─────────────────────────────────────────
/** What a definition's frontmatter says, read the plain way, apart from the loader's parser. */
function frontOf(text: string): {
	model: string;
	effort: string | null;
	role: string;
	tools: string[];
} {
	const head = text.split('\n---\n')[0].split('\n');
	const scalar = (key: string): string | null =>
		head
			.find((l) => l.startsWith(`${key}: `))
			?.slice(key.length + 2)
			.trim() ?? null;
	const tools: string[] = [];
	for (let i = head.indexOf('tools:') + 1; head[i]?.startsWith('  - '); i++) {
		tools.push(head[i].slice(4).trim());
	}
	return {
		model: scalar('model') as string,
		effort: scalar('effort'),
		role: scalar('role') as string,
		tools,
	};
}
/** `text` with one line of its prompt (the first) extended by `suffix`. */
function editPrompt(text: string, suffix: string): string {
	const rows = text.split('\n');
	const close = rows.indexOf('---', 1);
	rows[rows.findIndex((l, i) => i > close && l.trim() !== '')] += suffix;
	return rows.join('\n');
}
const AGENT_NAMES = [...AGENT_TEXTS.keys()];
check(
	'the fixture is seeded with the real definitions',
	[
		'animator',
		'art-director',
		'atlas-artist',
		'builder',
		'coordinator',
		'mockup-analyst',
		'qa',
	].every((name) => AGENT_NAMES.includes(name)),
	true,
);
{
	check(
		"blobSha is git's own id",
		agents.blobSha('hello\n'),
		'ce013625030ba8dba906f756967f9e9ca394464a', // pragma: allowlist secret
	);
	check(
		'blobSha of nothing is the empty blob',
		agents.blobSha(''),
		'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', // pragma: allowlist secret
	);
	check(
		'blobSha counts bytes, not characters',
		agents.blobSha('é'),
		'4b04fff51468d8ab5201ab02b725dc477bc7cb45', // pragma: allowlist secret
	);
	check(
		"blobSha agrees with the fake git's id and the tree's",
		[
			agents.blobSha(AGENT_TEXTS.get('qa')),
			gitBlobId(AGENT_TEXTS.get('qa') as string),
			treeOf(SEED_MAIN).get(agentFile('qa')),
		].every((id, _i, all) => id === all[0]),
		true,
	);
	const branch = agents.branchFor('qa', 'request-0001');
	check('branchFor: agents/<name>-<8 hex>', /^agents\/qa-[0-9a-f]{8}$/.test(branch), true);
	check('branchFor is deterministic', agents.branchFor('qa', 'request-0001'), branch);
	check(
		'branchFor differs per request, and per agent',
		[
			agents.branchFor('qa', 'request-0002') !== branch,
			agents.branchFor('builder', 'request-0001') !== branch,
			agents.branchFor('builder', 'request-0001').startsWith('agents/builder-'),
		],
		[true, true, true],
	);
	check(
		'changeTitle',
		agents.changeTitle('qa', 'Tighten the sheet-budget wording'),
		'agents: qa — Tighten the sheet-budget wording',
	);
	const body = agents.changeBody('qa', 'Tighten the sheet-budget wording', 'Gualtiero');
	check(
		'changeBody leads with **Why:**, and the page reads the why back from it',
		[body.startsWith('**Why:** Tighten the sheet-budget wording'), changes.whyFromBody(body)],
		[true, 'Tighten the sheet-budget wording'],
	);
	check(
		'changeBody names the file and the user, and no address',
		[body.includes(agentFile('qa')), body.includes('Gualtiero'), body.includes('@')],
		[true, true, false],
	);
	check('the agents are where the worker loads them from', agents.AGENTS_DIR, AGENTS_DIR);
	check(
		'the eval workflow the launcher trusts is agent-eval.yml',
		agentEval.EVAL_WORKFLOW_PATH,
		'.github/workflows/agent-eval.yml',
	);
	check(
		'a request id is 8–64 URL-safe characters',
		['abcdefgh', 'a'.repeat(64), 'abcdefg', 'a'.repeat(65), 'with space1', 'ok_id-123'].map((id) =>
			agents.REQUEST_ID.test(id),
		),
		[true, true, false, false, false, true],
	);
}
{
	const ma = agents.agentEditRules('mockup-analyst');
	check('rules: the models the worker can run, not the ones only priced', ma.models, [
		'claude-opus-5-5',
		'claude-sonnet-5-5',
		'claude-haiku-4-5-20251001',
	]);
	check(
		'rules: the adapter ops served to mockup-analyst, which its definition must name',
		ma.fixedAdapterTools,
		[
			'atlas.list_regions',
			'fonts.list',
			'gamemaker.get_template',
			'mockups.get_image',
			'mockups.list',
		],
	);
	const registered = [...ADAPTER_OPS.values()].map((op: { tool: string; name: string }) =>
		opId(op),
	);
	check(
		'rules: every registered op is served to it or to another agent, never both',
		[
			[...ma.fixedAdapterTools, ...ma.otherAdapterTools].sort(),
			ma.fixedAdapterTools.some((id: string) => ma.otherAdapterTools.includes(id)),
		],
		[[...registered].sort(), false],
	);
	check(
		'rules: the tools an agent may name are the worker catalogue, every registered op among them',
		[ma.tools, registered.every((id: string) => ma.tools.includes(id))],
		[[...KNOWN_TOOLS], true],
	);
	const qaNames = frontOf(AGENT_TEXTS.get('qa') as string).tools;
	check(
		'rules: qa is served the ops it names, bar the build.* and run.* ones',
		agents.agentEditRules('qa').fixedAdapterTools,
		qaNames.filter((t) => !/^(build|run)\./.test(t)).sort(),
	);
	check(
		'rules: the real definitions meet their own, both ways',
		AGENT_NAMES.every((name) => {
			const r = agents.agentEditRules(name);
			const named = frontOf(AGENT_TEXTS.get(name) as string).tools;
			return (
				r.fixedAdapterTools.every((id: string) => named.includes(id)) &&
				r.otherAdapterTools.every((id: string) => !named.includes(id))
			);
		}),
		true,
	);

	const MA = AGENT_TEXTS.get('mockup-analyst') as string;
	const verdict = (text: string) => agentEdit.validateAgentEdit('mockup-analyst', text, ma);
	const edits: boolean[] = [];
	const changed = (text: string): string => {
		edits.push(text !== MA);
		return text;
	};
	const real = verdict(MA);
	check(
		'the real mockup-analyst.md can be submitted',
		[real.ok, real.agent?.name, real.errors],
		[true, 'mockup-analyst', []],
	);
	const model = verdict(changed(MA.replace(/^model: .*$/m, 'model: claude-opus-5')));
	check(
		'an unknown model is refused, naming the model (claude-opus-5 is priced but cannot run)',
		[model.ok, model.errors.length, model.errors[0]?.includes('claude-opus-5')],
		[false, 1, true],
	);
	const added = verdict(
		changed(MA.replace('  - fonts.list\n', '  - fonts.list\n  - atlas.choose_variant\n')),
	);
	check(
		'an adapter op it is not served is refused',
		[
			added.ok,
			added.errors.length,
			added.errors[0]?.includes('atlas.choose_variant is not served to mockup-analyst'),
		],
		[false, 1, true],
	);
	const dropped = verdict(changed(MA.replace('  - fonts.list\n', '')));
	check(
		'an adapter op it is served cannot be dropped',
		[
			dropped.ok,
			dropped.errors.length,
			dropped.errors[0]?.startsWith('tools: fonts.list is served to mockup-analyst'),
		],
		[false, 1, true],
	);
	const worker = verdict(
		changed(MA.replace('  - fonts.list\n', '  - fonts.list\n  - run.post_activity\n')),
	);
	check(
		'a worker tool is no adapter op: naming run.post_activity is allowed',
		[worker.ok, worker.agent?.tools.includes('run.post_activity')],
		[true, true],
	);
	const renamed = verdict(changed(MA.replace(/^name: .*$/m, 'name: other-agent')));
	check(
		'a renamed definition does not match its file',
		[renamed.ok, renamed.errors.some((e: string) => e.includes('does not match'))],
		[false, true],
	);
	const key = verdict(changed(MA.replace(/^role: /m, 'colour: red\nrole: ')));
	check(
		'an unknown key is refused',
		[key.ok, key.errors.some((e: string) => e.includes('colour: unknown key'))],
		[false, true],
	);
	const empty = verdict(changed(MA.slice(0, MA.indexOf('\n---\n', 4) + 5)));
	check(
		'an empty prompt is refused',
		[empty.ok, empty.errors.some((e: string) => e.includes('system prompt'))],
		[false, true],
	);
	check(
		'each edit above really changed the definition',
		[edits.length, edits.every(Boolean)],
		[7, true],
	);
	check(
		'a definition that is not a definition is refused, its errors listed',
		agentEdit.validateAgentEdit('qa', 'just words', agents.agentEditRules('qa')).errors.length > 0,
		true,
	);

	const why = agentEdit.whyProblem;
	check(
		'whyProblem: empty, blank, many lines and over 120 characters are refused',
		[why(''), why('   '), why('one\ntwo'), why('x'.repeat(121))].map((p) => typeof p === 'string'),
		[true, true, true, true],
	);
	check(
		'whyProblem: a fine one, and the 120-character limit itself, are null',
		[why('Tighten the sheet-budget wording'), why('x'.repeat(120)), why('  padded  ')],
		[null, null, null],
	);
	const f = (
		path: string,
		status = 'modified',
		previousPath: string | null = null,
	): { path: string; previousPath: string | null; status: string } => ({
		path,
		previousPath,
		status,
	});
	check(
		'agentOfFiles: exactly one agent definition, edited or added, names the agent',
		[
			agentEval.agentOfFiles([f(agentFile('qa'))]),
			agentEval.agentOfFiles([f(agentFile('new-agent'), 'added')]),
		],
		['qa', 'new-agent'],
	);
	check(
		'agentOfFiles: two files, a removed one, a renamed one, a file that is no definition, none: null',
		[
			agentEval.agentOfFiles([f(agentFile('qa')), f(agentFile('builder'))]),
			agentEval.agentOfFiles([f(agentFile('qa'), 'removed')]),
			agentEval.agentOfFiles([f(agentFile('qa'), 'renamed', agentFile('old'))]),
			agentEval.agentOfFiles([f('docs/qa.md')]),
			agentEval.agentOfFiles([f(`${AGENTS_DIR}/Qa.md`)]),
			agentEval.agentOfFiles([f(`${AGENTS_DIR}/nested/qa.md`)]),
			agentEval.agentOfFiles([f(`${AGENTS_DIR}/qa.txt`)]),
			agentEval.agentOfFiles([]),
		],
		[null, null, null, null, null, null, null, null],
	);
	const run = `https://github.com/${REPO}/actions/runs/123`;
	check(
		'runIdOfStatusUrl: a run page of this repository, with or without a job below it',
		[agentEval.runIdOfStatusUrl(run, REPO), agentEval.runIdOfStatusUrl(`${run}/job/456`, REPO)],
		[123, 123],
	);
	check(
		'runIdOfStatusUrl: another repository, http, a page that is no run, a lookalike host, nothing: null',
		[
			agentEval.runIdOfStatusUrl('https://github.com/other/engine/actions/runs/123', REPO),
			agentEval.runIdOfStatusUrl(`http://github.com/${REPO}/actions/runs/123`, REPO),
			agentEval.runIdOfStatusUrl(`https://github.com/${REPO}/pull/123`, REPO),
			agentEval.runIdOfStatusUrl(`https://github.com.evil.example/${REPO}/actions/runs/123`, REPO),
			agentEval.runIdOfStatusUrl(`https://github.com/${REPO}-fork/actions/runs/123`, REPO),
			agentEval.runIdOfStatusUrl(`https://github.com/${REPO}/actions/runs/abc`, REPO),
			agentEval.runIdOfStatusUrl('https://github.com/axb/c/actions/runs/1', 'a.b/c'),
			agentEval.runIdOfStatusUrl(null, REPO),
		],
		[null, null, null, null, null, null, null, null],
	);
}
{
	const group = (jobs: { name: string; state: string }[]) => ({
		workflow: 'Lint',
		url: null,
		state: 'pass',
		jobs: jobs.map((j) => ({ url: null, conclusion: null, ...j })),
		passed: 0,
		total: 0,
	});
	const pass = group([{ name: 'lint', state: 'pass' }]);
	const ok = { state: 'success', description: 'ok' };
	const input = (over: Json) => ({ mergeableState: 'clean', checks: [pass], harness: ok, ...over });
	const capped = { state: 'failure', description: 'qa: capped at $20.00' };
	check(
		'deriveStatus: a failing agent-eval blocks an agent definition, with its description',
		changes.deriveStatus(input({ agentDefinition: true, agentEval: capped })),
		{ kind: 'blocked', reason: 'agent-eval: qa: capped at $20.00' },
	);
	check(
		'deriveStatus: …an errored one too, and a description that is missing says "failed"',
		changes.deriveStatus(
			input({ agentDefinition: true, agentEval: { state: 'error', description: null } }),
		),
		{ kind: 'blocked', reason: 'agent-eval: failed' },
	);
	check(
		'deriveStatus: an agent definition whose eval has not reported is testing, one more than the rest',
		[
			changes.deriveStatus(input({ harness: null })),
			changes.deriveStatus(input({ harness: null, agentDefinition: true })),
			changes.deriveStatus(input({ agentDefinition: true })),
			changes.deriveStatus(input({ agentDefinition: true, agentEval: null })),
		],
		[
			{ kind: 'testing', done: 1, total: 2 },
			{ kind: 'testing', done: 1, total: 3 },
			{ kind: 'testing', done: 2, total: 3 },
			{ kind: 'testing', done: 2, total: 3 },
		],
	);
	check(
		'deriveStatus: a pending eval is still testing',
		changes.deriveStatus(
			input({ agentDefinition: true, agentEval: { state: 'pending', description: 'Evaluating…' } }),
		),
		{ kind: 'testing', done: 2, total: 3 },
	);
	check(
		'deriveStatus: a successful eval counts as done, and with the rest green the change is ready',
		[
			changes.deriveStatus(
				input({ agentDefinition: true, agentEval: { state: 'success', description: 'ok' } }),
			),
			changes.deriveStatus(
				input({
					harness: null,
					agentDefinition: true,
					agentEval: { state: 'success', description: 'ok' },
				}),
			),
		],
		[{ kind: 'ready' }, { kind: 'testing', done: 2, total: 3 }],
	);
	check(
		'deriveStatus: for a change that is no agent definition the eval status is ignored entirely',
		[
			changes.deriveStatus(input({ agentDefinition: false, agentEval: capped })),
			changes.deriveStatus(input({ agentEval: capped })),
			changes.deriveStatus(
				input({ harness: null, agentEval: { state: 'success', description: 'ok' } }),
			),
		],
		[{ kind: 'ready' }, { kind: 'ready' }, { kind: 'testing', done: 1, total: 2 }],
	);
	check(
		'deriveStatus: a conflict, a failed job and a failed harness are named before the eval',
		[
			changes.deriveStatus(
				input({ mergeableState: 'dirty', agentDefinition: true, agentEval: capped }),
			),
			changes.deriveStatus(
				input({
					checks: [group([{ name: 'lint', state: 'fail' }])],
					agentDefinition: true,
					agentEval: capped,
				}),
			),
			changes.deriveStatus(
				input({
					harness: { state: 'failure', description: '2 changed screen(s)' },
					agentDefinition: true,
					agentEval: capped,
				}),
			),
		],
		[
			{ kind: 'blocked', reason: 'Merge conflict with main' },
			{ kind: 'blocked', reason: 'Lint: lint failed' },
			{ kind: 'blocked', reason: 'current-games: 2 changed screen(s)' },
		],
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

// ── The Agents tab: the list, one definition, a submitted edit ────────────────
const agentList = (locals: Locals) => call(agentsListRoute.GET, locals);
const agentDetail = (locals: Locals, name: string) => call(agentRoute.GET, locals, { name });
const submit = (locals: Locals, name: string, body: unknown) =>
	call(agentChangeRoute.POST, locals, { name }, body);
/** What a run of requests wrote to the repository: everything that was not a read. */
const writesSince = (from: number): string[] =>
	gh.requests.slice(from).filter((r) => !r.startsWith('GET ') && r.includes('/repos/'));
const kindsSince = (from: number): string[] => git.writes.slice(from).map((w) => w.kind);
const api = (path: string): string => `/repos/${REPO}/${path}`;

// Both lists are cached for 15 s by the clock the modules read; the fixture moves that clock on.
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const lapse = (): void => {
	skew += 16_000;
};
// A Pipeline Tester sees the tool and holds no pipelineMerge unless an override grants it.
userOverrides.delete('u-tester');
const agentsStart = gh.requests.length;

{
	const savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
	delete process.env.GITHUB_APP_PRIVATE_KEY;
	const from = gh.requests.length;
	const answers = [
		await agentList(ADMIN),
		await agentDetail(ADMIN, 'qa'),
		await submit(ADMIN, 'qa', {}),
	];
	check(
		'the Agents routes without the App are a 503, naming the key, fetching nothing',
		[answers.map((a) => a.status), answers.map((a) => a.body.error), gh.requests.length - from],
		[
			[503, 503, 503],
			Array(3).fill(
				'GITHUB_APP_PRIVATE_KEY is not set on the launcher, so Invisible Pipeline Changes cannot reach GitHub.',
			),
			0,
		],
	);
	process.env.GITHUB_APP_PRIVATE_KEY = savedKey as string;
	check(
		'no session is a 401 on all three',
		(await Promise.all([agentList(ANON), agentDetail(ANON, 'qa'), submit(ANON, 'qa', {})])).map(
			(a) => a.status,
		),
		[401, 401, 401],
	);
	check(
		'a role without the tool is a 403 on all three',
		(
			await Promise.all([agentList(ARTIST), agentDetail(ARTIST, 'qa'), submit(ARTIST, 'qa', {})])
		).map((a) => a.status),
		[403, 403, 403],
	);
}

// ── The agents list ───────────────────────────────────────────────────────────
lapse();
const listFrom = gh.requests.length;
const listed = await agentList(TESTER);
check('a Pipeline Tester sees the agents', listed.status, 200);
{
	const body = listed.body as { agents: Json[]; mainSha: string; fetchedAt: string };
	check(
		'one agent per definition on main, sorted by name',
		body.agents.map((a) => a.name),
		[...AGENT_NAMES].sort(),
	);
	const reads = gh.requests.slice(listFrom).filter((r) => r.includes('/contents/'));
	check(
		'…every file read from the one commit the answer names',
		[
			body.mainSha,
			reads.length > AGENT_NAMES.length,
			reads.every((r) => r.endsWith(`?ref=${SEED_MAIN}`)),
		],
		[SEED_MAIN, true, true],
	);
	check('…stamped with when it was read', typeof body.fetchedAt, 'string');
	for (const a of body.agents) {
		const name = String(a.name);
		const fm = frontOf(AGENT_TEXTS.get(name) as string);
		const last = git.lastChange.get(agentFile(name)) as {
			sha: string;
			html_url: string;
			commit: { message: string; author: { name: string; date: string } };
			author: { login: string } | null;
		};
		check(
			`${name}: valid, with the model, effort, tools and role of its frontmatter`,
			[a.path, a.valid, a.errors, a.model, a.effort, a.tools, a.role],
			[agentFile(name), true, [], fm.model, fm.effort, fm.tools, fm.role],
		);
		check(
			`${name}: its last change, from the commits API (the commit's author when GitHub names no account)`,
			[a.lastChange as Json],
			[
				{
					sha: last.sha,
					date: last.commit.author.date,
					author: last.author?.login ?? last.commit.author.name,
					message: last.commit.message.split('\n')[0],
					url: last.html_url,
				},
			],
		);
		check(`${name}: no open change`, a.openChanges, []);
	}
	check(
		'qa names no effort: null, not a guess',
		body.agents.find((a) => a.name === 'qa')?.effort,
		null,
	);
	check(
		'a commit GitHub ties to no account falls back to the name on the commit',
		body.agents.filter((a) => (a.lastChange as Json).author === 'Author 2').length,
		1,
	);
	const afterFirst = gh.requests.length;
	const second = await agentList(ADMIN);
	check(
		'a second list within 15 s is served from the cache',
		[second.status, gh.requests.length],
		[200, afterFirst],
	);
	check('…and answers the same', JSON.stringify(second.body) === JSON.stringify(listed.body), true);
	lapse();
	const costFrom = gh.requests.length;
	await agentList(ADMIN);
	const costOfOne = gh.requests.length - costFrom;
	check('…and after 15 s it reads again', costOfOne > 0, true);
	lapse();
	const togetherFrom = gh.requests.length;
	await Promise.all([agentList(TESTER), agentList(ADMIN), agentList(TESTER)]);
	check('lists asked for together share one read', gh.requests.length - togetherFrom, costOfOne);
	check('reading the list wrote nothing', writesSince(agentsStart), []);
}

// ── One definition ────────────────────────────────────────────────────────────
{
	const from = gh.requests.length;
	check(
		'a bad name is a 400, before GitHub is asked',
		[(await agentDetail(ADMIN, 'Bad Name')).status, gh.requests.length - from],
		[400, 0],
	);
	check('an agent main does not have is a 404', (await agentDetail(ADMIN, 'nobody')).status, 404);
	for (const name of AGENT_NAMES) {
		const text = AGENT_TEXTS.get(name) as string;
		const res = await agentDetail(name === 'qa' ? ADMIN : TESTER, name);
		const d = res.body as Json & { rules: Json };
		check(
			`${name}: the file as main holds it, its blob id (the base of a submit), main, the rules`,
			[
				res.status,
				d.name,
				d.text === text,
				d.blobSha,
				d.mainSha,
				JSON.stringify(d.rules) === JSON.stringify(agents.agentEditRules(name)),
				d.valid,
			],
			[200, name, true, agents.blobSha(text), SEED_MAIN, true, true],
		);
		check(
			`${name}: …the blob id is the one git gives the file on main`,
			d.blobSha,
			treeOf(SEED_MAIN).get(agentFile(name)),
		);
	}
	const readsFrom = gh.requests.length;
	const d = (await agentDetail(ADMIN, 'qa')).body as Json & {
		rules: { fixedAdapterTools: string[] };
		openChanges: unknown[];
	};
	check(
		'a definition is read from GitHub every time: its blob id is the base of a submit, never a cached one',
		gh.requests.slice(readsFrom).filter((r) => r.includes(`/contents/${agentFile('qa')}`)).length,
		1,
	);
	check(
		'qa: its rules say which adapter ops its definition must keep',
		[d.rules.fixedAdapterTools, d.openChanges],
		[['atlas.get_variant_image', 'atlas.sheet_stats'], []],
	);
}

// ── A submitted edit: what is refused before anything is written ──────────────
const QA = AGENT_TEXTS.get('qa') as string;
const QA_BLOB = agents.blobSha(QA);
const QA_PATH = agentFile('qa');
const WHY = 'Tighten the sheet-budget wording';
const QA_EDIT = editPrompt(QA, ' Say how much of the sheet budget is left.');
const REQ = 'req-qa-0001';
const sendBody = (over: Json = {}): Json => ({
	requestId: REQ,
	baseSha: QA_BLOB,
	text: QA_EDIT,
	why: WHY,
	...over,
});
const NOBODY = [
	'---',
	'name: nobody',
	'model: claude-sonnet-5-5',
	'role: Nobody.',
	'tools:',
	'  - run.post_activity',
	'inputs: None.',
	'outputs: None.',
	'---',
	'',
	'Do nothing.',
	'',
].join('\n');
{
	const from = gh.requests.length;
	const w0 = git.writes.length;
	const refuse = async (
		label: string,
		locals: Locals,
		name: string,
		body: unknown,
		status: number,
		says?: string | null,
	) => {
		const res = await submit(locals, name, body);
		check(
			`${label} is a ${status}${says ? `, saying "${says}"` : ''}`,
			[res.status, says ? String(res.body.error).includes(says) : true],
			[status, true],
		);
		return res;
	};
	await refuse('no session', ANON, 'qa', sendBody(), 401);
	await refuse('a role without the tool', ARTIST, 'qa', sendBody(), 403);
	await refuse(
		'a Pipeline Tester, who sees the tool but holds no pipelineMerge,',
		TESTER,
		'qa',
		sendBody(),
		403,
		'Editing an agent definition needs',
	);
	await refuse('a bad agent name', ADMIN, 'Bad Name', sendBody(), 400);
	await refuse('a body that is not JSON', ADMIN, 'qa', 'nope', 400, 'JSON');
	for (const raw of ['null', '[]', '"text"']) {
		await refuse(`a JSON body of ${raw}`, ADMIN, 'qa', raw, 400, 'requestId');
	}
	await refuse('no requestId', ADMIN, 'qa', sendBody({ requestId: undefined }), 400, 'requestId');
	await refuse(
		'a requestId that is a number',
		ADMIN,
		'qa',
		sendBody({ requestId: 12345678 }),
		400,
		'requestId',
	);
	await refuse(
		'a requestId too short',
		ADMIN,
		'qa',
		sendBody({ requestId: 'short' }),
		400,
		'requestId',
	);
	await refuse(
		'a requestId with spaces',
		ADMIN,
		'qa',
		sendBody({ requestId: 'has some spaces' }),
		400,
		'requestId',
	);
	for (const baseSha of ['abc', 'A'.repeat(40), 'z'.repeat(40), 5, undefined]) {
		await refuse(
			`a baseSha of ${JSON.stringify(baseSha)}`,
			ADMIN,
			'qa',
			sendBody({ baseSha }),
			400,
			'baseSha',
		);
	}
	await refuse('no text', ADMIN, 'qa', sendBody({ text: undefined }), 400, 'text');
	await refuse('no why', ADMIN, 'qa', sendBody({ why: undefined }), 400, 'why');
	for (const why of ['', '   ', 'one\ntwo', 'x'.repeat(121)]) {
		await refuse(
			`a why of ${JSON.stringify(why.length > 20 ? `${why.length} characters` : why)}`,
			ADMIN,
			'qa',
			sendBody({ why }),
			400,
			agentEdit.whyProblem(why),
		);
	}
	await refuse(
		'a text larger than any definition',
		ADMIN,
		'qa',
		sendBody({ text: `${QA_EDIT}${'x'.repeat(256 * 1024)}` }),
		400,
		'larger',
	);
	const model = await submit(
		ADMIN,
		'qa',
		sendBody({ text: QA_EDIT.replace(/^model: .*$/m, 'model: claude-opus-5') }),
	);
	check(
		'a text the validator refuses is a 400 whose body lists every reason',
		[
			model.status,
			String(model.body.error).startsWith('The definition cannot be submitted:'),
			(model.body.errors as string[]).length,
			(model.body.errors as string[])[0].includes('claude-opus-5'),
		],
		[400, true, 1, true],
	);
	const dropped = await submit(
		ADMIN,
		'qa',
		sendBody({ text: QA_EDIT.replace('  - atlas.sheet_stats\n', '') }),
	);
	check(
		'…an adapter op qa is served cannot be dropped, nor one it is not served added',
		[
			dropped.status,
			(dropped.body.errors as string[])[0].startsWith('tools: atlas.sheet_stats is served to qa'),
		],
		[400, true],
	);
	const added = await submit(
		ADMIN,
		'qa',
		sendBody({
			text: QA_EDIT.replace(
				'  - run.post_activity\n',
				'  - run.post_activity\n  - atlas.choose_variant\n',
			),
		}),
	);
	check(
		'…an adapter op it is not served',
		[
			added.status,
			(added.body.errors as string[])[0].includes('atlas.choose_variant is not served to qa'),
		],
		[400, true],
	);
	await refuse('an unchanged text', ADMIN, 'qa', sendBody({ text: QA }), 409, 'unchanged');
	await refuse(
		'a baseSha that is not the file on main',
		ADMIN,
		'qa',
		sendBody({ baseSha: '0'.repeat(40) }),
		409,
		'changed on main',
	);
	await refuse(
		'a definition for an agent main does not have (the tab edits, it does not add)',
		ADMIN,
		'nobody',
		sendBody({ text: NOBODY }),
		404,
		'no agent definition',
	);
	check(
		'none of them wrote anything, or made a branch',
		[writesSince(from), git.writes.length - w0, [...git.refs.keys()]],
		[[], 0, ['heads/main']],
	);
}

// ── A submitted edit: the change ──────────────────────────────────────────────
const BRANCH = agents.branchFor('qa', REQ);
const SENT_FROM = gh.requests.length;
const SENT_WRITES = git.writes.length;
const first = await submit(ADMIN, 'qa', sendBody());
const FIRST = first.body as {
	number: number;
	url: string;
	branch: string;
	headSha: string;
	created: boolean;
};
const FIRST_PULL = gh.pulls.get(FIRST.number) as Pull;
{
	check('an admin submits an edit of qa', first.status, 200);
	check(
		'…the answer: the PR, its branch off the request, the head, and that it was made',
		[Object.keys(first.body).sort(), FIRST.url, FIRST.branch, FIRST.headSha, FIRST.created],
		[
			['branch', 'created', 'headSha', 'number', 'url'],
			`https://github.com/${REPO}/pull/${FIRST.number}`,
			BRANCH,
			git.refs.get(`heads/${BRANCH}`),
			true,
		],
	);
	const n = FIRST.number;
	check(
		'…written in git order, as the App: blob, tree, commit, branch, PR, then the label',
		writesSince(SENT_FROM),
		[
			`POST ${api('git/blobs')}`,
			`POST ${api('git/trees')}`,
			`POST ${api('git/commits')}`,
			`POST ${api('git/refs')}`,
			`POST ${api('pulls')}`,
			`POST ${api(`issues/${n}/labels`)}`,
			`POST ${api('labels')}`,
			`POST ${api(`issues/${n}/labels`)}`,
		],
	);
	check(
		'…the label the repository lacked is made once, and added again',
		[kindsSince(SENT_WRITES), [...gh.labels]],
		[['blob', 'tree', 'commit', 'ref', 'pull', 'label-create', 'label'], ['agent-definition']],
	);
	const commit = git.commits.get(FIRST.headSha) as {
		tree: string;
		parents: string[];
		message: string;
	};
	check(
		"…ONE commit on main's tip",
		[commit.parents, git.refs.get('heads/main')],
		[[SEED_MAIN], SEED_MAIN],
	);
	check(
		"…whose tree differs from main's in exactly the one definition",
		changedPaths(treeOf(FIRST.headSha), treeOf(SEED_MAIN)),
		[QA_PATH],
	);
	check(
		'…and that file is the text that was sent, byte for byte',
		git.blobs.get(treeOf(FIRST.headSha).get(QA_PATH) as string) === QA_EDIT,
		true,
	);
	check(
		'…the message is the PR title, then the user by name, never by address',
		[
			commit.message.startsWith(`${agents.changeTitle('qa', WHY)}\n`),
			commit.message.includes('Gualtiero'),
			commit.message.includes('owner@example.com'),
		],
		[true, true, false],
	);
	check(
		'…the PR: title, base, head, not a draft',
		[
			FIRST_PULL.title,
			FIRST_PULL.base.ref,
			FIRST_PULL.head.ref,
			FIRST_PULL.head.sha,
			FIRST_PULL.draft,
			FIRST_PULL.user?.login,
		],
		[
			agents.changeTitle('qa', WHY),
			'main',
			BRANCH,
			FIRST.headSha,
			false,
			'invisible-pipeline[bot]',
		],
	);
	check(
		'…its body leads with **Why:**, which the page reads back, and names the user, not the address',
		[
			String(FIRST_PULL.body).startsWith(`**Why:** ${WHY}`),
			changes.whyFromBody(FIRST_PULL.body),
			String(FIRST_PULL.body).includes('Gualtiero'),
			String(FIRST_PULL.body).includes('@'),
		],
		[true, WHY, true, false],
	);
	check(
		'…labelled agent-definition',
		FIRST_PULL.labels.map((l) => l.name),
		['agent-definition'],
	);
}
// The list after it, without waiting for a cache to lapse: the edited agent shows it, nobody else.
{
	const body = (await agentList(ADMIN)).body as { agents: Json[] };
	const row = (o: Json) => [o.number, o.title, o.url, o.branch, o.headSha, o.status, o.draft];
	check(
		'the edited agent lists the open change, with its status (the eval not yet reported: 0 of 2)',
		(body.agents.find((a) => a.name === 'qa')?.openChanges as Json[]).map(row),
		[
			[
				FIRST.number,
				agents.changeTitle('qa', WHY),
				FIRST.url,
				BRANCH,
				FIRST.headSha,
				{ kind: 'testing', done: 0, total: 2 },
				false,
			],
		],
	);
	check(
		'…and no other agent lists it',
		body.agents
			.filter((a) => a.name !== 'qa')
			.every((a) => (a.openChanges as unknown[]).length === 0),
		true,
	);
	const d = (await agentDetail(ADMIN, 'qa')).body as { openChanges: Json[] };
	check(
		'…the definition itself lists it too',
		d.openChanges.map((o) => o.number),
		[FIRST.number],
	);
	check(
		'…and a definition it does not edit does not',
		((await agentDetail(ADMIN, 'builder')).body.openChanges as unknown[]).length,
		0,
	);
}

// ── The same request again ────────────────────────────────────────────────────
{
	const from = gh.requests.length;
	const w0 = git.writes.length;
	const again = await submit(ADMIN, 'qa', sendBody());
	check(
		'the same request again finds its change',
		[
			again.status,
			again.body.number,
			again.body.url,
			again.body.branch,
			again.body.headSha,
			again.body.created,
		],
		[200, FIRST.number, FIRST.url, BRANCH, FIRST.headSha, false],
	);
	check(
		'…and writes nothing: no blob, tree, commit, branch, PR or label',
		[writesSince(from), git.writes.length - w0],
		[[], 0],
	);
	const other = await submit(ADMIN, 'qa', sendBody({ text: editPrompt(QA, ' Other words.') }));
	check(
		'the same request id with other content is a 409, and writes nothing',
		[
			other.status,
			String(other.body.error).includes('other content'),
			writesSince(from),
			git.writes.length - w0,
		],
		[409, true, [], 0],
	);
	const REQ2 = 'req-qa-0002';
	const w1 = git.writes.length;
	const second = await submit(ADMIN, 'qa', sendBody({ requestId: REQ2 }));
	const S = second.body as { number: number; branch: string; created: boolean; headSha: string };
	check(
		'a new request with the same text is a new change, on a branch of its own',
		[second.status, S.created, S.number !== FIRST.number, S.branch, S.branch !== BRANCH],
		[200, true, true, agents.branchFor('qa', REQ2), true],
	);
	check('…the label now exists, so it is only added', kindsSince(w1), [
		'blob',
		'tree',
		'commit',
		'ref',
		'pull',
		'label',
	]);
	(gh.pulls.get(S.number) as Pull).state = 'closed';
	const closed = await submit(ADMIN, 'qa', sendBody({ requestId: REQ2 }));
	check(
		'a request whose change was closed is a 409, not a second change',
		[closed.status, String(closed.body.error).includes('already closed')],
		[409, true],
	);
}
{
	// A text with Windows line ends is stored with Unix ones, and is the same request as its Unix twin.
	const REQ3 = 'req-qa-0003';
	const text = editPrompt(QA, ' Count sheets, not pages.');
	const crlf = await submit(
		ADMIN,
		'qa',
		sendBody({ requestId: REQ3, text: text.replace(/\n/g, '\r\n') }),
	);
	const branch = agents.branchFor('qa', REQ3);
	check(
		'a text with Windows line ends is stored with Unix ones',
		[
			crlf.status,
			git.blobs.get(treeOf(git.refs.get(`heads/${branch}`) as string).get(QA_PATH) as string) ===
				text,
		],
		[200, true],
	);
	const w0 = git.writes.length;
	const lf = await submit(ADMIN, 'qa', sendBody({ requestId: REQ3, text }));
	check(
		'…and its Unix twin is the same request',
		[lf.status, lf.body.created, lf.body.number === crlf.body.number, git.writes.length - w0],
		[200, false, true, 0],
	);
}
{
	// The capability, not the role: an override grants it, and the user is named without the address.
	userOverrides.set('u-tester', { pipelineMerge: true });
	const REQ4 = 'req-qa-0004';
	const text = editPrompt(QA, ' Name the sheet that is over.');
	const res = await submit(TESTER, 'qa', sendBody({ requestId: REQ4, text }));
	const pr = gh.pulls.get(Number(res.body.number)) as Pull;
	const commit = git.commits.get(String(res.body.headSha)) as { message: string };
	check(
		'a Pipeline Tester granted pipelineMerge may submit, named by the local part of the address',
		[
			res.status,
			String(pr.body).includes('by `tester`,'),
			String(pr.body).includes('tester@example.com'),
			commit.message.includes('by tester.'),
			commit.message.includes('tester@example.com'),
		],
		[200, true, false, true, false],
	);
	userOverrides.delete('u-tester');
}

// ── A branch or a PR an earlier send left half-made ───────────────────────────
{
	const REQ5 = 'req-qa-0005';
	const text = editPrompt(QA, ' Report the margin.');
	const branch = agents.branchFor('qa', REQ5);
	const orphan = fakeBranch(branch, QA_PATH, text);
	const w0 = git.writes.length;
	const refs0 = git.refAttempts.length;
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: REQ5, text }));
	check(
		'a branch with no PR (the earlier send died after it) gets its PR: created, on that very commit',
		[res.status, res.body.created, res.body.headSha, res.body.branch],
		[200, true, orphan, branch],
	);
	check(
		'…with no new blob, tree, commit or branch',
		[kindsSince(w0), git.refAttempts.length - refs0],
		[['pull', 'label'], 0],
	);
	check(
		'…the PR sits on the branch',
		(gh.pulls.get(Number(res.body.number)) as Pull).head.sha,
		orphan,
	);
}
{
	const REQ6 = 'req-qa-0006';
	const text = editPrompt(QA, ' Round the margin up.');
	const branch = agents.branchFor('qa', REQ6);
	const commit = fakeBranch(branch, QA_PATH, text);
	const made = newPull(
		branch,
		commit,
		agents.changeTitle('qa', WHY),
		agents.changeBody('qa', WHY, 'x'),
	);
	const w0 = git.writes.length;
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: REQ6, text }));
	check(
		'an open PR the earlier send never labelled is labelled, not duplicated',
		[res.status, res.body.created, res.body.number, kindsSince(w0), made.labels.map((l) => l.name)],
		[200, false, made.number, ['label'], ['agent-definition']],
	);
}
{
	// The same request landing twice at once: the other one made the branch between our check and our write.
	const REQ7 = 'req-qa-0007';
	const text = editPrompt(QA, ' Say when it is full.');
	const branch = agents.branchFor('qa', REQ7);
	let rival = '';
	git.beforeRef = () => {
		rival = fakeBranch(branch, QA_PATH, text);
	};
	const w0 = git.writes.length;
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: REQ7, text }));
	check(
		'a branch another request made first is used, not fought over: the PR opens on it',
		[res.status, res.body.created, res.body.headSha === rival, kindsSince(w0)],
		[200, true, true, ['blob', 'tree', 'commit', 'pull', 'label']],
	);
}
{
	// Another instance sent the same request and opened the PR between our look and our own open.
	const REQ12 = 'req-qa-0012';
	const text = editPrompt(QA, ' Say how much is free.');
	const branch = agents.branchFor('qa', REQ12);
	let rival = 0;
	git.beforePull = () => {
		const headSha = git.refs.get(`heads/${branch}`) as string;
		rival = newPull(
			branch,
			headSha,
			agents.changeTitle('qa', WHY),
			agents.changeBody('qa', WHY, 'x'),
		).number;
	};
	const w0 = git.writes.length;
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: REQ12, text }));
	check(
		'a PR another instance opened first (a 422 on open) is the change: found, labelled, no error',
		[res.status, res.body.created, res.body.number === rival, kindsSince(w0)],
		[200, false, true, ['blob', 'tree', 'commit', 'ref', 'label']],
	);
}
{
	const REQ8 = 'req-qa-0008';
	const body = sendBody({ requestId: REQ8, text: editPrompt(QA, ' Never guess a size.') });
	const w0 = git.writes.length;
	const both = await Promise.all([submit(ADMIN, 'qa', body), submit(ADMIN, 'qa', body)]);
	check(
		'two clicks at once make one change: one made it, the other found it',
		[
			both.map((r) => r.status),
			both.filter((r) => r.body.created === true).length,
			both[0].body.number === both[1].body.number,
			kindsSince(w0),
		],
		[[200, 200], 1, true, ['blob', 'tree', 'commit', 'ref', 'pull', 'label']],
	);
}

{
	// The label is gone from the repository, and another request makes it between our add and our create.
	gh.labels.delete('agent-definition');
	gh.labelRace = true;
	const text = editPrompt(QA, ' Report the margin in sheets.');
	const w0 = git.writes.length;
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: 'req-qa-0011', text }));
	check(
		'a label another request made first (a 422 on create) is just added again',
		[
			res.status,
			kindsSince(w0),
			(gh.pulls.get(Number(res.body.number)) as Pull).labels.map((l) => l.name),
			gh.labelRace,
		],
		[200, ['blob', 'tree', 'commit', 'ref', 'pull', 'label'], ['agent-definition'], false],
	);
}

// ── Main moves while the commit is made ───────────────────────────────────────
{
	const REQ9 = 'req-qa-0009';
	const text = editPrompt(QA, ' Keep the margin in view.');
	const start = git.refs.get('heads/main') as string;
	const moves0 = git.mainMoves.length;
	const w0 = git.writes.length;
	git.moveMain = 'once';
	const res = await submit(ADMIN, 'qa', sendBody({ requestId: REQ9, text }));
	const tip = git.mainMoves[moves0];
	const parents = (git.commits.get(String(res.body.headSha)) as { parents: string[] }).parents;
	check(
		'main moving while the commit is made: the change is made again on the new tip',
		[res.status, res.body.created, git.mainMoves.length - moves0, parents, parents[0] !== start],
		[200, true, 1, [tip], true],
	);
	check(
		'…which differs from that tip in the one definition, keeping the push that moved it',
		[
			changedPaths(treeOf(String(res.body.headSha)), treeOf(tip)),
			treeOf(String(res.body.headSha)).get(UNRELATED) === treeOf(tip).get(UNRELATED),
		],
		[[QA_PATH], true],
	);
	check('…two commits were made, one branch', kindsSince(w0), [
		'blob',
		'tree',
		'commit',
		'blob',
		'tree',
		'commit',
		'ref',
		'pull',
		'label',
	]);

	const REQ10 = 'req-qa-0010';
	const text10 = editPrompt(QA, ' Keep the margin in view, in numbers.');
	const moves1 = git.mainMoves.length;
	const w1 = git.writes.length;
	git.moveMain = 'always';
	const refused = await submit(ADMIN, 'qa', sendBody({ requestId: REQ10, text: text10 }));
	git.moveMain = 'never';
	check(
		'main moving again on the second try is a 409, "moved twice"',
		[
			refused.status,
			String(refused.body.error).includes('moved twice'),
			git.mainMoves.length - moves1,
		],
		[409, true, 2],
	);
	check(
		'…no branch and no PR was made, only the two unreferenced commits',
		[git.refs.has(`heads/${agents.branchFor('qa', REQ10)}`), kindsSince(w1)],
		[false, ['blob', 'tree', 'commit', 'blob', 'tree', 'commit']],
	);
	const retry = await submit(ADMIN, 'qa', sendBody({ requestId: REQ10, text: text10 }));
	check(
		'…and trying again, with main still, makes the change',
		[retry.status, retry.body.created],
		[200, true],
	);
}

// ── A definition on main that the loader refuses ──────────────────────────────
{
	const BROKEN = agentFile('broken');
	const text = 'just words, not a definition\n';
	advanceMain(BROKEN, text);
	lapse();
	const body = (await agentList(ADMIN)).body as { agents: Json[] };
	const row = body.agents.find((a) => a.name === 'broken') as Json;
	check(
		'a definition the loader refuses is listed, not hidden: invalid, with its errors, no model',
		[row.valid, (row.errors as string[]).length > 0, row.model, row.effort, row.tools, row.role],
		[false, true, null, null, [], null],
	);
	check(
		'…with no last change when GitHub knows none, and the other definitions still valid',
		[row.lastChange, row.path, body.agents.filter((a) => a.valid === true).length],
		[null, BROKEN, AGENT_NAMES.length],
	);
	const d = (await agentDetail(ADMIN, 'broken')).body as Json;
	check(
		'…its text and blob id are served, as the base of a repair, with the main commit that holds them',
		[d.text, d.blobSha, d.valid, d.mainSha],
		[text, agents.blobSha(text), false, git.refs.get('heads/main')],
	);
	const repaired = NOBODY.replace('name: nobody', 'name: broken');
	const res = await submit(ADMIN, 'broken', {
		requestId: 'req-fix-0001',
		baseSha: d.blobSha,
		text: repaired,
		why: 'Repair the definition',
	});
	const main = git.refs.get('heads/main') as string;
	check(
		'…and the tab repairs it: one commit on main, that one file',
		[
			res.status,
			res.body.branch,
			changedPaths(treeOf(String(res.body.headSha)), treeOf(main)),
			(git.commits.get(String(res.body.headSha)) as { parents: string[] }).parents,
		],
		[200, agents.branchFor('broken', 'req-fix-0001'), [BROKEN], [main]],
	);
}

// ── Never main ────────────────────────────────────────────────────────────────
{
	const requests = gh.requests.slice(agentsStart);
	const allowed = [
		/^POST \/git\/(blobs|trees|commits|refs)$/,
		/^POST \/pulls$/,
		/^POST \/issues\/\d+\/labels$/,
		/^POST \/labels$/,
	];
	const shape = (r: string): string => r.replace(`/repos/${REPO}`, '');
	check(
		'every write the Agents tab made is a Git Data, PR or label write: no PATCH, PUT or DELETE, no merge',
		requests.filter(
			(r) =>
				!r.startsWith('GET ') && r.includes('/repos/') && !allowed.some((re) => re.test(shape(r))),
		),
		[],
	);
	check(
		'no write named refs/heads/main, and every branch asked for is an agent branch',
		[
			requests.some((r) => !r.startsWith('GET ') && r.includes('heads/main')),
			git.refAttempts.length > 0 &&
				git.refAttempts.every((r) => /^refs\/heads\/agents\/[a-z][a-z-]*-[0-9a-f]{8}$/.test(r)),
		],
		[false, true],
	);
	const lineage: string[] = [];
	for (
		let c: string | undefined = git.refs.get('heads/main');
		c;
		c = git.commits.get(c)?.parents[0]
	) {
		lineage.push(c);
	}
	check(
		"main moved only when the fake moved it: its history is the seed and the fake's own commits",
		lineage,
		[...git.mainMoves].reverse().concat(SEED_MAIN),
	);
	const branches = [...git.refs].filter(([name]) => name.startsWith('heads/agents/'));
	check('the branches the requests made are all there', branches.length >= 12, true);
	check(
		'every agent branch is one commit on a main commit, changing one definition file alone',
		branches.every(([, head]) => {
			const commit = git.commits.get(head) as { parents: string[] };
			const parent = commit.parents[0];
			const touched = changedPaths(treeOf(head), treeOf(parent));
			return (
				commit.parents.length === 1 &&
				(parent === SEED_MAIN || git.mainMoves.includes(parent)) &&
				touched.length === 1 &&
				/^services\/director-worker\/agents\/[a-z][a-z-]*\.md$/.test(touched[0])
			);
		}),
		true,
	);
	const written = [
		...[...git.commits.values()].map((c) => c.message),
		...[...gh.pulls.values()].filter((p) => p.number >= 200).map((p) => `${p.title}\n${p.body}`),
	];
	check(
		'no email address was written to GitHub',
		written.some((text) => /@/.test(text)),
		false,
	);
}

// ── The eval report, read back through the change ─────────────────────────────
{
	const workflow = readFileSync(
		new URL('../../../.github/workflows/agent-eval.yml', import.meta.url),
		'utf8',
	);
	check(
		'agent-eval.yml says what the launcher reads: its trigger, status context, label, artifact and run link',
		[
			/^\s+pull_request_target:/m.test(workflow),
			/STATUS_CONTEXT:\s*agent-eval\s*$/m.test(workflow),
			workflow.includes("contains(github.event.pull_request.labels.*.name, 'agent-definition')"),
			/name:\s*agent-eval-report\s*$/m.test(workflow),
			/RUN_URL:\s*\$\{\{\s*github\.server_url\s*\}\}\/\$\{\{\s*github\.repository\s*\}\}\/actions\/runs\/\$\{\{\s*github\.run_id\s*\}\}/.test(
				workflow,
			),
		],
		[true, true, true, true, true],
	);
}
const EVAL_HEAD = FIRST.headSha;
const evalHead = head(EVAL_HEAD, GREEN, { state: 'success', description: 'ok' });
type EvalAnswer = {
	status: Json;
	agentDefinition: boolean;
	labels: string[];
	author: string;
	files: Json[];
	agentEval: {
		status: Json | null;
		run: Json | null;
		report: Json & { state: string; detail?: string; report?: Json; artifactId?: number };
		agent: string | null;
		blocking: string | null;
	} | null;
};
const evalOf = async (number: number): Promise<EvalAnswer> =>
	(await detail(ADMIN, String(number))).body as unknown as EvalAnswer;
const evalRequests = (from: number): string[] =>
	gh.requests
		.slice(from)
		.filter((r) => [...gh.runs.keys()].some((id) => r.includes(`/actions/runs/${id}`)));
{
	const d = await evalOf(FIRST.number);
	const ae = d.agentEval;
	check(
		'an agent-definition change carries the eval: no status yet, no report, the agent it edits, nothing blocking',
		[ae?.report.state, ae?.agent, ae?.blocking, ae?.status, ae?.run],
		['none', 'qa', null, null, null],
	);
	check(
		'…and it is testing, the eval counted in the total (the same change with no label would be 8)',
		d.status,
		{ kind: 'testing', done: 8, total: 9 },
	);
	check(
		'…flagged as an agent definition, opened by the App, editing one file by one line',
		[d.agentDefinition, d.labels, d.author, d.files],
		[
			true,
			['agent-definition'],
			'invisible-pipeline[bot]',
			[
				{
					path: QA_PATH,
					previousPath: null,
					status: 'modified',
					additions: 1,
					deletions: 1,
					url: null,
				},
			],
		],
	);
}
{
	const run = evalRun({ status: 'in_progress', conclusion: null });
	setEvalStatus(
		evalHead,
		'pending',
		'Evaluating the edited agent on its reference set…',
		evalRunUrl(run),
	);
	const from = gh.requests.length;
	const d = await evalOf(FIRST.number);
	const ae = d.agentEval;
	check(
		'a pending status: the run is running, nothing blocks, the change is still testing',
		[ae?.report.state, ae?.run, ae?.blocking, d.status],
		[
			'running',
			{ id: run, url: evalRunUrl(run), status: 'in_progress', conclusion: null },
			null,
			{ kind: 'testing', done: 8, total: 9 },
		],
	);
	check(
		'…and the report of a run still going is not looked for',
		evalRequests(from).some((r) => r.includes('/artifacts')),
		false,
	);
}
{
	const capped = evalReport(EVAL_HEAD, { capped: true });
	const run = evalRun({ conclusion: 'failure' });
	const artifact = evalArtifact(run, { 'report.json': JSON.stringify(capped) });
	setEvalStatus(evalHead, 'failure', capped.line, evalRunUrl(run));
	const d = await evalOf(FIRST.number);
	const ae = d.agentEval;
	check(
		'a capped eval: its report reads, naming its artifact, for this head and this agent',
		[
			ae?.report.state,
			ae?.report.artifactId,
			(ae?.report.report as Json | undefined)?.result,
			(ae?.report.report as Json | undefined)?.capped,
			(ae?.report.report as Json | undefined)?.line,
			((ae?.report.report as Json | undefined)?.head as Json | undefined)?.sha,
		],
		['ready', artifact, 'capped', true, capped.line, EVAL_HEAD],
	);
	check(
		'…the run and the status as GitHub holds them',
		[ae?.run, ae?.status],
		[
			{ id: run, url: evalRunUrl(run), status: 'completed', conclusion: 'failure' },
			{ state: 'failure', description: capped.line, url: evalRunUrl(run), updatedAt: AT },
		],
	);
	check("…it blocks, in the report's own line", ae?.blocking, capped.line);
	check(
		'…and the change is blocked, with the status description under the word agent-eval',
		d.status,
		{ kind: 'blocked', reason: `agent-eval: ${capped.line}` },
	);
}
{
	// A status is anyone's to post; the report the launcher verified is what the detail judges by.
	const capped = evalReport(EVAL_HEAD, { capped: true });
	const run = evalRun({ conclusion: 'failure' });
	evalArtifact(run, { 'report.json': JSON.stringify(capped) });
	setEvalStatus(evalHead, 'success', 'all good', evalRunUrl(run));
	const d = await evalOf(FIRST.number);
	check(
		'a success status beside a capped report: the detail is blocked by the report, not ready',
		[d.agentEval?.blocking, d.status],
		[capped.line, { kind: 'blocked', reason: `agent-eval: ${capped.line}` }],
	);
}
{
	const scored = evalReport(EVAL_HEAD);
	const run = evalRun();
	const artifact = evalArtifact(run, { 'report.json': JSON.stringify(scored) });
	setEvalStatus(evalHead, 'success', scored.line, evalRunUrl(run));
	const zips = () => gh.requests.filter((r) => r.includes(`/artifacts/${artifact}/zip`)).length;
	const d = await evalOf(FIRST.number);
	const ae = d.agentEval;
	check(
		'a scored eval with a success status: the report reads, nothing blocks',
		[
			ae?.report.state,
			ae?.report.artifactId,
			(ae?.report.report as Json | undefined)?.result,
			ae?.blocking,
		],
		['ready', artifact, 'scored', null],
	);
	check('…and with every other check green on that head the change is ready', d.status, {
		kind: 'ready',
	});
	await evalOf(FIRST.number);
	await evalOf(FIRST.number);
	check('a report read three times is downloaded once', zips(), 1);
}
{
	// A success status beside a capped report: the report is the fuller word on what blocks.
	const capped = evalReport(EVAL_HEAD, { capped: true });
	const run = evalRun();
	evalArtifact(run, { 'report.json': JSON.stringify(capped) });
	setEvalStatus(evalHead, 'success', 'ok', evalRunUrl(run));
	const ae = (await evalOf(FIRST.number)).agentEval;
	check(
		'a success status beside a capped report: the report still reads, and still says it blocks',
		[ae?.report.state, ae?.blocking],
		['ready', capped.line],
	);
}
{
	// What the report must be before it is shown, whatever the status says.
	const statusOk = (run: number, line = 'qa: 50% → 75% on 4 elements') =>
		setEvalStatus(evalHead, 'success', line, evalRunUrl(run));
	const read = async () => {
		const from = gh.requests.length;
		const d = await evalOf(FIRST.number);
		return { ae: d.agentEval, requests: evalRequests(from) };
	};

	let run = evalRun();
	evalArtifact(run, { 'report.json': JSON.stringify(evalReport('b'.repeat(40))) });
	statusOk(run);
	let got = await read();
	check(
		'a report for another commit is stale, and says which',
		[got.ae?.report.state, String(got.ae?.report.detail).includes('bbbbbbb'), got.ae?.blocking],
		['stale', true, null],
	);

	run = evalRun();
	evalArtifact(run, { 'report.json': JSON.stringify(evalReport(EVAL_HEAD, { agent: 'builder' })) });
	statusOk(run);
	got = await read();
	check(
		'a report for another agent is stale, and says which',
		[got.ae?.report.state, got.ae?.report.detail],
		['stale', 'The report is for builder, not qa.'],
	);

	run = evalRun();
	const expired = evalArtifact(
		run,
		{ 'report.json': JSON.stringify(evalReport(EVAL_HEAD)) },
		{ expired: true },
	);
	gh.zips.delete(expired);
	statusOk(run);
	got = await read();
	check(
		'an expired artifact is a state, with when it expired, and is never downloaded',
		[
			got.ae?.report.state,
			got.ae?.report.expiresAt,
			String(got.ae?.report.detail).includes('expired'),
			got.requests.some((r) => r.includes('/zip')),
		],
		['expired', '2026-12-31T00:00:00Z', true, false],
	);

	for (const [label, over] of [
		['another workflow', { path: '.github/workflows/evil.yml' }],
		['another event', { event: 'pull_request' }],
		['another repository', { repository: { full_name: 'other/engine' } }],
	] as [string, Json][]) {
		run = evalRun(over);
		evalArtifact(run, { 'report.json': JSON.stringify(evalReport(EVAL_HEAD)) });
		statusOk(run);
		got = await read();
		check(
			`a status naming a run of ${label} is unreadable, and that run's artifacts are not looked at`,
			[
				got.ae?.report.state,
				String(got.ae?.report.detail).includes('not the eval workflow'),
				got.requests.some((r) => r.includes('/artifacts')),
				got.ae?.blocking,
			],
			['unreadable', true, false, null],
		);
	}

	const real = evalRun();
	evalArtifact(real, { 'report.json': JSON.stringify(evalReport(EVAL_HEAD)) });
	for (const url of [
		null,
		`https://github.com/${REPO}/pull/${FIRST.number}`,
		`https://github.com/other/engine/actions/runs/${real}`,
		`http://github.com/${REPO}/actions/runs/${real}`,
	]) {
		setEvalStatus(evalHead, 'success', 'ok', url);
		got = await read();
		check(
			`a status linking ${url ?? 'nothing'} names no run of this repository: unreadable, no run fetched`,
			[got.ae?.report.state, got.ae?.run, got.requests],
			['unreadable', null, []],
		);
	}

	setEvalStatus(evalHead, 'success', 'ok', evalRunUrl(999_999));
	got = await read();
	check(
		'a status naming a run that is gone is missing',
		[got.ae?.report.state, got.ae?.run],
		['missing', null],
	);

	run = evalRun();
	statusOk(run);
	got = await read();
	check(
		'a finished run that made no report artifact is missing',
		[got.ae?.report.state, String(got.ae?.report.detail).includes('made no report')],
		['missing', true],
	);

	const parts = evalReport(EVAL_HEAD) as unknown as Json;
	const { items: _items, ...noItems } = parts;
	for (const [label, files, over, says] of [
		[
			'a report.json missing its items',
			{ 'report.json': JSON.stringify(noItems) },
			{},
			'the report has no items',
		],
		[
			'an artifact without a report.json',
			{ 'other.json': '{}' },
			{},
			'the artifact holds no report.json',
		],
		['a report.json that is not JSON', { 'report.json': 'not json' }, {}, null],
		[
			'an artifact larger than any report',
			{ 'report.json': JSON.stringify(parts) },
			{ size_in_bytes: 5 * 1024 * 1024 },
			'the artifact is larger than a report',
		],
	] as [string, Record<string, string>, Partial<Artifact>, string | null][]) {
		run = evalRun();
		const artifact = evalArtifact(run, files, over);
		statusOk(run);
		got = await read();
		check(
			`${label} is unreadable${says ? `, with the parser's words "${says}"` : ''}`,
			[
				got.ae?.report.state,
				says
					? got.ae?.report.detail === `The report could not be read: ${says}`
					: String(got.ae?.report.detail).startsWith('The report could not be read: '),
				got.ae?.blocking,
			],
			['unreadable', true, null],
		);
		if (over.size_in_bytes) {
			check(
				'…and is never downloaded',
				gh.requests.some((r) => r.includes(`/artifacts/${artifact}/zip`)),
				false,
			);
		}
	}
}
{
	// A change that carries the label but does not edit exactly one definition.
	const two = pull(++pullSeq, 'agents: two at once', {
		sha: sha(301),
		labels: ['agent-definition'],
		files: [QA_PATH, agentFile('builder')].map((filename) => ({
			filename,
			status: 'modified',
			additions: 1,
			deletions: 1,
		})),
	});
	const h = head(sha(301), GREEN, { state: 'success', description: 'ok' });
	let d = await evalOf(two.number);
	check(
		'a labelled change editing two files has no agent, and the eval says why it blocks',
		[
			d.agentEval?.agent,
			String(d.agentEval?.blocking).includes('exactly one agent definition'),
			String(d.agentEval?.blocking).includes('2 files'),
			d.agentEval?.report.state,
		],
		[null, true, true, 'none'],
	);
	const refusal = 'agent-eval: it edits exactly one agent definition; this one edits 2 files';
	setEvalStatus(h, 'failure', refusal, null);
	d = await evalOf(two.number);
	check('…and the failure the workflow posts for it blocks the change in its own words', d.status, {
		kind: 'blocked',
		reason: `agent-eval: ${refusal}`,
	});

	// The same edit without the label: the eval is not its word, whatever a status says.
	const plain = pull(++pullSeq, 'agents: qa, unlabelled', {
		sha: sha(302),
		files: [{ filename: QA_PATH, status: 'modified', additions: 1, deletions: 1 }],
	});
	setEvalStatus(
		head(sha(302), GREEN, { state: 'success', description: 'ok' }),
		'failure',
		'qa: capped',
		null,
	);
	const p = await evalOf(plain.number);
	check(
		'a change without the label has no agent evaluation, and an agent-eval status on it is ignored',
		[p.agentEval, p.agentDefinition, p.status],
		[null, false, { kind: 'ready' }],
	);

	// The list and the detail say the same of a change.
	setEvalStatus(evalHead, 'failure', 'qa: capped at $20.00', evalRunUrl(1));
	lapse();
	const listedNow = (await list(ADMIN)).body as { changes: Json[] };
	const by = (n: number) => listedNow.changes.find((c) => c.number === n) as Json;
	check(
		'the list flags the agent definitions, and gives them the status the detail gives',
		[
			[by(FIRST.number).agentDefinition, by(FIRST.number).status],
			[by(two.number).agentDefinition, by(two.number).status],
			[by(plain.number).agentDefinition, by(plain.number).status],
		],
		[
			[true, { kind: 'blocked', reason: 'agent-eval: qa: capped at $20.00' }],
			[true, d.status],
			[false, { kind: 'ready' }],
		],
	);
}
userOverrides.set('u-tester', { pipelineMerge: true });
Date.now = realNow;

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
