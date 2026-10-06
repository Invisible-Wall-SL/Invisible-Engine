import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import pricingFile from '../../../../../services/director-worker/pricing.json';
import { RUNNABLE_MODELS } from '../../../../../services/director-worker/src/models';
import { KNOWN_TOOLS } from '../../../../../services/director-worker/src/tools';
import {
	AGENT_NAME,
	agentPath,
	validateAgentEdit,
	whyProblem,
	type AgentEditRules,
} from '$lib/agentEdit';
import type { Effort } from '../../../../../services/director-worker/src/agentDefinition';
import { createKeyedMutex, createSingleFlight, mapWithConcurrency } from './concurrency';
import { ADAPTER_OPS, opId } from './director/registry';
import { ENV } from './env';
import { githubApp, type GithubApp } from './githubApp';
import { AGENT_FILE } from './pipelineAgentEval';
import {
	AGENT_DEFINITION_LABEL,
	approverName,
	dropListCache,
	listAgentDefinitionChanges,
	type ChangeStatus,
} from './pipelineChanges';

/**
 * The Agents tab of Invisible Pipeline Changes (ADR-0007 "Agents tab"; PLAN 5.4): the runtime-agent
 * definitions as `main` holds them (`services/director-worker/agents/<name>.md`), read through the
 * GitHub App, and an edit of one submitted as a pipeline change — a branch `agents/<name>-<short>`
 * off main's current commit, ONE commit that changes that one file (the Git Data API: blob → tree →
 * commit → ref), and a PR labelled `agent-definition` whose `agent-eval` check (`agent-eval.yml`)
 * scores the edit before it merges. The App is the author; the launcher user is named in the body.
 *
 * What is refused before anything is written: a definition the worker's own loader or
 * `check:director-adapters` would refuse (`$lib/agentEdit.ts`, the same verdict the editor shows);
 * a base that is not main's current file (the editor is stale); an unchanged file; a `requestId`
 * resent with other content. What is never done: a push to `main`, a second commit on the branch,
 * a change to any other file. No agent can reach this: the adapter gate refuses the area outright
 * (`director/refusals.ts`), and this module is called only by a launcher session that holds
 * `pipelineMerge`.
 */

export const AGENTS_DIR = 'services/director-worker/agents';
const BASE_BRANCH = 'main';
const BRANCH_PREFIX = 'agents/';
/** A definition is a few KB; past this it is not one. */
const MAX_DEFINITION_BYTES = 256 * 1024;
const LIST_TTL_MS = 15_000;
const PER_AGENT_CONCURRENCY = 4;
/** The GitHub label the eval workflow and the Changes tab key on; made if the repo lacks it. */
const LABEL_COLOR = 'a99bff';
const LABEL_DESCRIPTION =
	'A runtime-agent definition change opened from Invisible Pipeline Changes';

/** A client-supplied id per submit, replayed to the same change. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ── What the tab shows ─────────────────────────────────────────────────────────

export interface AgentLastChange {
	sha: string;
	date: string;
	author: string;
	message: string;
	url: string;
}

export interface AgentOpenChange {
	number: number;
	title: string;
	url: string;
	branch: string;
	headSha: string;
	status: ChangeStatus;
	draft: boolean;
}

export interface AgentSummary {
	name: string;
	path: string;
	/** Parsed from main's file; null fields when it fails to parse (`valid` false). */
	model: string | null;
	effort: Effort | null;
	tools: string[];
	role: string | null;
	valid: boolean;
	errors: string[];
	lastChange: AgentLastChange | null;
	/** Open agent-definition changes that edit this file. */
	openChanges: AgentOpenChange[];
}

export interface AgentList {
	agents: AgentSummary[];
	mainSha: string;
	fetchedAt: string;
}

export interface AgentDetail extends AgentSummary {
	text: string;
	/** The file's blob on main: what a submit names as its base. */
	blobSha: string;
	mainSha: string;
	rules: AgentEditRules;
}

export interface AgentChangeRequest {
	requestId: string;
	baseSha: string;
	text: string;
	why: string;
}

export interface AgentChangeResult {
	number: number;
	url: string;
	branch: string;
	headSha: string;
	/** False on an idempotent resend that found the change already open. */
	created: boolean;
}

// ── GitHub's shapes, the fields read ───────────────────────────────────────────

interface GhContentFile {
	type: string;
	name: string;
	path: string;
	sha: string;
	size: number;
	content?: string;
	encoding?: string;
}

interface GhCommitListed {
	sha: string;
	html_url: string;
	commit: { message: string; author: { name: string; date: string } | null };
	author: { login: string } | null;
}

interface GhPullListed {
	number: number;
	html_url: string;
	state: string;
	head: { sha: string; ref: string };
	labels?: { name: string }[];
}

// ── Pure parts ─────────────────────────────────────────────────────────────────

/** The blob id git gives `text`: `sha1("blob <bytes>\0" + bytes)`. Equal content, equal id. */
export function blobSha(text: string): string {
	const bytes = Buffer.from(text, 'utf8');
	return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** The branch a request opens: the same request, the same branch — that is the idempotency. */
export function branchFor(name: string, requestId: string): string {
	const short = createHash('sha256').update(requestId).digest('hex').slice(0, 8);
	return `${BRANCH_PREFIX}${name}-${short}`;
}

/** The PR title ADR-0007 names; the squash merge makes it the commit on `main`. */
export const changeTitle = (name: string, why: string): string => `agents: ${name} — ${why}`;

/** `@name` and `#123` in a PR body page people and link issues; a word joiner after the mark
 *  keeps the text as written without either. */
const unlinked = (text: string): string => text.replace(/([@#])(?=\w)/g, '$1\u2060');

export function changeBody(name: string, why: string, user: string): string {
	return [
		`**Why:** ${unlinked(why)}`,
		'',
		`Edits \`${agentPath(name)}\` and nothing else. Opened from Invisible Pipeline Changes by \`${unlinked(user)}\`, as the launcher's GitHub App; the \`agent-eval\` check runs the edited definition and main's on the reference set before this merges (ADR-0007).`,
	].join('\n');
}

/**
 * The rules an edit of `name` must meet (`$lib/agentEdit.ts`): the models the worker runs, every
 * tool it knows, and the adapter ops its registry serves to this agent and to others. Read from
 * the same sources the worker boots from and `check:director-adapters` pins.
 */
export function agentEditRules(name: string): AgentEditRules {
	const priced = new Set(Object.keys(pricingFile.perMTok));
	const fixed: string[] = [];
	const other: string[] = [];
	for (const op of ADAPTER_OPS.values()) {
		((op.agents as readonly string[]).includes(name) ? fixed : other).push(opId(op));
	}
	return {
		models: RUNNABLE_MODELS.filter((m) => priced.has(m)),
		tools: [...KNOWN_TOOLS],
		fixedAdapterTools: fixed.sort(),
		otherAdapterTools: other.sort(),
	};
}

/** The name in a URL, or a 400. */
export function parseAgentName(param: string): string {
	if (!AGENT_NAME.test(param)) throw error(400, 'The agent name is lower-case-kebab.');
	return param;
}

// ── GitHub reads ───────────────────────────────────────────────────────────────

const repo = (): string => ENV.GITHUB_ENGINE_REPO;
const owner = (): string => repo().split('/')[0];

async function mainSha(app: GithubApp): Promise<string> {
	const ref = await app.json<{ object: { sha: string } }>(
		`/repos/${repo()}/git/ref/heads/${BASE_BRANCH}`,
	);
	return ref.object.sha;
}

/** A file at a ref, decoded; `null` when there is no such file there. */
async function readFile(
	app: GithubApp,
	path: string,
	ref: string,
): Promise<{ text: string; sha: string } | null> {
	const res = await app.fetch(
		`/repos/${repo()}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
	);
	if (res.status === 404) return null;
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		throw error(502, `GitHub ${res.status}: ${body?.message ?? res.statusText}`);
	}
	const file = (await res.json()) as GhContentFile;
	if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
		throw error(502, `GitHub answered ${path} with something that is not a file.`);
	}
	if (file.size > MAX_DEFINITION_BYTES) {
		throw error(502, `${path} is larger than an agent definition (${file.size} bytes).`);
	}
	return { text: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha };
}

async function lastChangeOf(
	app: GithubApp,
	path: string,
	ref: string,
): Promise<AgentLastChange | null> {
	const commits = await app.json<GhCommitListed[]>(
		`/repos/${repo()}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=1`,
	);
	const c = commits[0];
	if (!c) return null;
	return {
		sha: c.sha,
		date: c.commit.author?.date ?? '',
		author: c.author?.login ?? c.commit.author?.name ?? '',
		message: c.commit.message.split('\n')[0],
		url: c.html_url,
	};
}

/** Open agent-definition changes by the agent each edits (a change editing no single one is skipped). */
async function openChangesByAgent(app: GithubApp): Promise<Map<string, AgentOpenChange[]>> {
	const byAgent = new Map<string, AgentOpenChange[]>();
	for (const { change, files } of await listAgentDefinitionChanges(app)) {
		for (const file of files) {
			const name = AGENT_FILE.exec(file.path)?.[1];
			if (!name) continue;
			const list = byAgent.get(name) ?? [];
			list.push({
				number: change.number,
				title: change.title,
				url: change.url,
				branch: change.branch,
				headSha: change.headSha,
				status: change.status,
				draft: change.draft,
			});
			byAgent.set(name, list);
		}
	}
	return byAgent;
}

function summarize(
	name: string,
	text: string,
	lastChange: AgentLastChange | null,
	openChanges: AgentOpenChange[],
): AgentSummary {
	const verdict = validateAgentEdit(name, text, agentEditRules(name));
	return {
		name,
		path: agentPath(name),
		model: verdict.agent?.model ?? null,
		effort: verdict.agent?.effort ?? null,
		tools: verdict.agent?.tools ?? [],
		role: verdict.agent?.role ?? null,
		valid: verdict.ok,
		errors: verdict.errors,
		lastChange,
		openChanges,
	};
}

let listCache: { at: number; list: AgentList } | null = null;
const listFlight = createSingleFlight();

/** Every definition on `main`, as the tab lists them. */
export function listAgents(app: GithubApp = githubApp): Promise<AgentList> {
	if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return Promise.resolve(listCache.list);
	return listFlight('agents', () => readAgents(app));
}

async function readAgents(app: GithubApp): Promise<AgentList> {
	const sha = await mainSha(app);
	const [entries, open] = await Promise.all([
		app.json<GhContentFile[]>(`/repos/${repo()}/contents/${AGENTS_DIR}?ref=${sha}`),
		openChangesByAgent(app),
	]);
	const names = entries
		.filter((e) => e.type === 'file' && AGENT_FILE.test(`${AGENTS_DIR}/${e.name}`))
		.map((e) => e.name.replace(/\.md$/, ''))
		.sort();
	const agents = await mapWithConcurrency(names, PER_AGENT_CONCURRENCY, async (name) => {
		const path = agentPath(name);
		const [file, lastChange] = await Promise.all([
			readFile(app, path, sha),
			lastChangeOf(app, path, sha),
		]);
		return summarize(name, file?.text ?? '', lastChange, open.get(name) ?? []);
	});
	const list = { agents, mainSha: sha, fetchedAt: new Date().toISOString() };
	listCache = { at: Date.now(), list };
	return list;
}

/** One definition in full, with the rules an edit must meet. Always fresh: its blob is the base. */
export async function getAgent(name: string, app: GithubApp = githubApp): Promise<AgentDetail> {
	const sha = await mainSha(app);
	const path = agentPath(name);
	const [file, lastChange, open] = await Promise.all([
		readFile(app, path, sha),
		lastChangeOf(app, path, sha),
		openChangesByAgent(app),
	]);
	if (!file) throw error(404, `There is no agent definition ${name} on ${BASE_BRANCH}.`);
	return {
		...summarize(name, file.text, lastChange, open.get(name) ?? []),
		text: file.text,
		blobSha: file.sha,
		mainSha: sha,
		rules: agentEditRules(name),
	};
}

// ── The change ─────────────────────────────────────────────────────────────────

/** One submit per agent at a time: two clicks of one button must not race the same branch. */
const opening = createKeyedMutex();

/**
 * Open the pipeline change for an edit of `name` (the caller has passed `pipelineMerge`). The
 * same `requestId` opens the same branch, so a resend finds the change it already made —
 * including one whose PR never got opened or labelled — and finishes it rather than making a
 * second. The commit is based on main's commit as read at the start; if main moves while the
 * commit is being made it is made once more from the new commit, and refused if it moved again
 * (409), so a change starts at main's tip as closely as a read-then-write allows.
 */
export async function openAgentChange(
	input: AgentChangeRequest & { name: string; user: NonNullable<App.Locals['user']> },
	app: GithubApp = githubApp,
): Promise<AgentChangeResult> {
	const { name } = input;
	if (!REQUEST_ID.test(input.requestId)) throw error(400, 'requestId is 8–64 URL-safe characters.');
	const text = input.text.replace(/\r\n/g, '\n');
	if (Buffer.byteLength(text, 'utf8') > MAX_DEFINITION_BYTES) {
		throw error(400, 'The definition is larger than an agent definition.');
	}
	const why = input.why.trim();
	const whyError = whyProblem(why);
	if (whyError) throw error(400, whyError);
	const verdict = validateAgentEdit(name, text, agentEditRules(name));
	if (!verdict.ok) {
		throw error(400, {
			message: `The definition cannot be submitted: ${verdict.errors[0]}`,
			errors: verdict.errors,
		});
	}
	const path = agentPath(name);
	const branch = branchFor(name, input.requestId);
	const proposed = blobSha(text);
	// One line, no backticks: the name goes into a commit message and, quoted, into the PR body,
	// where a bare `@name` would page someone.
	const author =
		approverName(input.user)
			.replace(/[`\s]+/g, ' ')
			.trim() || 'a launcher user';

	const result = await opening(name, async () => {
		const existing = await findExisting(app, branch, path, proposed);
		if (existing.kind === 'pull') {
			await ensureLabel(app, existing.number);
			return {
				number: existing.number,
				url: existing.url,
				branch,
				headSha: existing.headSha,
				created: false,
			};
		}
		let headSha: string;
		if (existing.kind === 'branch') {
			headSha = existing.headSha;
		} else {
			headSha = await commitOnFreshBase(app, {
				path,
				text,
				baseSha: input.baseSha,
				proposed,
				message: `${changeTitle(name, why)}\n\nOpened from Invisible Pipeline Changes by ${author}.`,
			});
			const ref = await app.fetch(`/repos/${repo()}/git/refs`, {
				method: 'POST',
				body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: headSha }),
			});
			if (ref.status === 422) {
				// The same request landed twice at once and the other one made the branch: use it.
				const again = await findExisting(app, branch, path, proposed);
				if (again.kind === 'pull') {
					await ensureLabel(app, again.number);
					return {
						number: again.number,
						url: again.url,
						branch,
						headSha: again.headSha,
						created: false,
					};
				}
				if (again.kind !== 'branch') throw error(502, 'GitHub refused the branch and has none.');
				headSha = again.headSha;
			} else if (!ref.ok) {
				throw await failure(ref, 'creating the branch');
			}
		}
		const pull = await app.fetch(`/repos/${repo()}/pulls`, {
			method: 'POST',
			body: JSON.stringify({
				title: changeTitle(name, why),
				head: branch,
				base: BASE_BRANCH,
				body: changeBody(name, why, author),
				draft: false,
			}),
		});
		if (pull.status === 422) {
			// Another launcher instance sent the same request and opened the PR between this one's
			// look and its own open: GitHub refuses a second PR for the branch, so that one is it.
			const raced = await findExisting(app, branch, path, proposed);
			if (raced.kind === 'pull') {
				await ensureLabel(app, raced.number);
				return {
					number: raced.number,
					url: raced.url,
					branch,
					headSha: raced.headSha,
					created: false,
				};
			}
		}
		if (!pull.ok) throw await failure(pull, 'opening the pull request');
		const opened = (await pull.json()) as { number: number; html_url: string };
		await ensureLabel(app, opened.number);
		return { number: opened.number, url: opened.html_url, branch, headSha, created: true };
	});
	// The change exists now, found or made: the next list and detail must show it.
	listCache = null;
	dropListCache();
	return result;
}

type Existing =
	| { kind: 'none' }
	| { kind: 'branch'; headSha: string }
	| { kind: 'pull'; number: number; url: string; headSha: string };

/**
 * What an earlier send of the same request left: nothing, the branch alone (it died before the
 * PR), or the PR. Either must hold the content being sent now — a request id is one edit. The
 * reason is not matched: it names the change (the title) and is not in the branch; the editor
 * makes a new request id when the reason changes, so the same id with another reason is a resend
 * that keeps the first title.
 */
async function findExisting(
	app: GithubApp,
	branch: string,
	path: string,
	proposed: string,
): Promise<Existing> {
	const ref = await app.fetch(`/repos/${repo()}/git/ref/heads/${branch}`);
	if (ref.status === 404) return { kind: 'none' };
	if (!ref.ok) throw await failure(ref, 'reading the branch');
	const headSha = ((await ref.json()) as { object: { sha: string } }).object.sha;
	const file = await readFile(app, path, headSha);
	if (file?.sha !== proposed) {
		throw error(
			409,
			'This requestId already opened a change with other content; submit again with a new one.',
		);
	}
	const pulls = await app.json<GhPullListed[]>(
		`/repos/${repo()}/pulls?head=${encodeURIComponent(`${owner()}:${branch}`)}&state=all&per_page=1`,
	);
	const pull = pulls[0];
	if (!pull) return { kind: 'branch', headSha };
	if (pull.state !== 'open') {
		throw error(409, `This requestId's change #${pull.number} is already ${pull.state}.`);
	}
	return { kind: 'pull', number: pull.number, url: pull.html_url, headSha: pull.head.sha };
}

/**
 * One commit changing `path` to `text`, on main's current commit. Refuses a base that is not
 * main's file (the editor is stale: it would silently undo what landed since), and an unchanged
 * file. Done once more if main moved while the commit was made; refused if it moved again. Main
 * can still move between this read and the branch's creation; a PR one commit behind main is
 * what that costs.
 */
async function commitOnFreshBase(
	app: GithubApp,
	input: { path: string; text: string; baseSha: string; proposed: string; message: string },
): Promise<string> {
	const r = repo();
	for (let attempt = 0; attempt < 2; attempt++) {
		const parent = await mainSha(app);
		const current = await readFile(app, input.path, parent);
		if (!current)
			throw error(404, `There is no agent definition at ${input.path} on ${BASE_BRANCH}.`);
		if (current.sha !== input.baseSha) {
			throw error(
				409,
				`The definition changed on ${BASE_BRANCH} since it was opened (now ${current.sha.slice(0, 7)}); reload it and make the edit again.`,
			);
		}
		if (current.sha === input.proposed) {
			throw error(409, `The definition is unchanged from ${BASE_BRANCH}; nothing to submit.`);
		}
		const commit = await app.json<{ tree: { sha: string } }>(`/repos/${r}/git/commits/${parent}`);
		const blob = await app.json<{ sha: string }>(`/repos/${r}/git/blobs`, {
			method: 'POST',
			body: JSON.stringify({ content: input.text, encoding: 'utf-8' }),
		});
		if (blob.sha !== input.proposed) {
			throw error(502, 'GitHub stored the definition with another id than it was sent.');
		}
		const tree = await app.json<{ sha: string }>(`/repos/${r}/git/trees`, {
			method: 'POST',
			body: JSON.stringify({
				base_tree: commit.tree.sha,
				tree: [{ path: input.path, mode: '100644', type: 'blob', sha: blob.sha }],
			}),
		});
		const made = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
			method: 'POST',
			body: JSON.stringify({ message: input.message, tree: tree.sha, parents: [parent] }),
		});
		// A commit whose parent is no longer main's tip is left unreferenced (GitHub drops it) and
		// made again on the new tip, once.
		if ((await mainSha(app)) === parent) return made.sha;
	}
	throw error(409, `${BASE_BRANCH} moved twice while the change was being made; try again.`);
}

/** The PR carries the label, made in the repository the first time it is needed. */
async function ensureLabel(app: GithubApp, number: number): Promise<void> {
	const r = repo();
	const current = await app.json<{ labels?: { name: string }[] }>(`/repos/${r}/issues/${number}`);
	if ((current.labels ?? []).some((l) => l.name === AGENT_DEFINITION_LABEL)) return;
	const add = () =>
		app.fetch(`/repos/${r}/issues/${number}/labels`, {
			method: 'POST',
			body: JSON.stringify({ labels: [AGENT_DEFINITION_LABEL] }),
		});
	let res = await add();
	if (res.status === 404 || res.status === 422) {
		const made = await app.fetch(`/repos/${r}/labels`, {
			method: 'POST',
			body: JSON.stringify({
				name: AGENT_DEFINITION_LABEL,
				color: LABEL_COLOR,
				description: LABEL_DESCRIPTION,
			}),
		});
		// 422 here is "already exists": the add failed for another reason, which the retry says.
		if (!made.ok && made.status !== 422) throw await failure(made, 'making the label');
		res = await add();
	}
	if (!res.ok) throw await failure(res, 'labelling the pull request');
}

/** GitHub's own sentence for a refused write, as a 502; never a credential. */
async function failure(res: Response, doing: string): Promise<never> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	throw error(502, `GitHub ${res.status} ${doing}: ${body?.message ?? res.statusText}`);
}
