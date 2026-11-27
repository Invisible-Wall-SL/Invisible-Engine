import { randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { FIX_RUN_AGENT, monthStartUtc, refusedChange } from '$lib/bugFixRuns';
import {
	MERGE_RUN_AGENT,
	MERGE_RUN_AUDIENCE,
	MERGE_RUN_ENVIRONMENT,
	MERGE_RUN_ID,
	MERGE_RUN_REASONS,
	MERGE_RUN_WORKFLOW_PATH,
	MERGE_CAPS,
	UNSAFE_BRANCH_TEXT,
	OUTCOME_REASONS,
	capMergeReason,
	dispatchBudget,
	isLiveMergeRun,
	isMergeRunTitle,
	isWorkingMergeRun,
	mergeRunView,
	refusalMessage,
	startRefusal,
	type MergeRunExplanation,
	type MergeRunFile,
	type MergeRunRefusal,
	type MergeRunStatus,
	type MergeRunView,
	type MergeRunsAnswer,
} from '$lib/mergeMainRuns';
import {
	parseUsage,
	priceOf,
	readResultBody,
	verifiedJobClaims,
	wrongJobClaim,
	type JobTokenSpec,
} from './bugFixRuns';
import { fixSpendSince } from './bugFixRunsStore';
import { cancelActionsRun, messageOf, readActionsRun } from './bugFixRunsActions';
import { cleanLine } from './bugFixRunsChange';
import { getPipelineFixMonthlyCap, getPipelineMergeMainBudget } from './appSettings';
import { createKeyedMutex, mapWithConcurrency } from './concurrency';
import { getDirectorPricing } from './costs/pricingConfig';
import { ENV } from './env';
import { GithubAppError, githubApp, type GithubApp } from './githubApp';
import { isPlainBranchName, refReadPath, refWritePath } from './githubPaths';
import { githubOidc, type GithubOidc } from './githubOidc';
import { approverName, forgetChanges, isOnHold, readPull, type GhPull } from './pipelineChanges';
import {
	MERGE_ACCEPT_LEASE_MS,
	cancelListedMergeRun,
	dispatchMergeRun,
	mergeWorkflowReady,
} from './pipelineMergeRunsActions';
import {
	contentProblem,
	mergeMessage,
	planMerge,
	type Files,
	type Plan,
	type Sides,
} from './pipelineMergeRunsBuild';
import {
	ResultProblem,
	cleanExplanation,
	explanationLines,
	explanationSize,
	explanationTexts,
	filesProblem,
	isExplainedMerge,
	needsMainsTree,
	parseMergeResult,
	resultProblem,
	textsProblem,
	type ParsedMergeResult,
} from './pipelineMergeRunsResult';
import {
	bindMergeRun,
	claimAccept,
	getMergeRun,
	getMergeRunByRequest,
	insertMergeRun,
	mergeRunsOfPr,
	recordAcceptSha,
	recordMergeRunSpend,
	releaseAccept,
	settleMergeRun,
	type MergeMainRun,
	type MergeRunEnd,
} from './pipelineMergeRunsStore';

/**
 * Resolve conflict (ADR-0015), the launcher's side: Start, the job's result, Accept and Discard.
 *
 *  - start: `pipelineMerge` (the route), on an open change that conflicts with `main`, not on hold,
 *    with no live merge run, while GitHub has an active `merge-main.yml`. The monthly ceiling does not
 *    refuse a start: a spent month still gets the mechanical part (the result says so).
 *  - the result: only the job of THAT run, proved by a GitHub OIDC token for {@link MERGE_RUN_AUDIENCE}
 *    from `merge-main.yml` on `main`, dispatched by the App's bot, first attempt, in the `bug-fix`
 *    environment, whose Actions run is the one bound to the merge run. It is untrusted: parsed
 *    strictly, cleaned, scanned, and stored as a proposal. Nothing is written to GitHub.
 *  - accept: `pipelineMerge`. The launcher builds the merge itself from three trees and moves the
 *    branch with a fast-forward or nothing; a proposal for a head or a `main` that has since moved is
 *    `stale`.
 *  - discard: drops a proposal, or stops a run still working.
 */

const repo = (): string => ENV.GITHUB_ENGINE_REPO;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const BASE_BRANCH = 'main';
/**
 * The files a compare lists: page 1 only, up to this many. A list this long may be cut short, so
 * it says nothing about the files it left out.
 */
const COMPARE_FILES_CAP = 300;

export const newMergeRunId = (): string => randomBytes(5).toString('hex');

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const viewOf = (run: MergeMainRun): MergeRunView => mergeRunView(run, repo());

function refuse(code: MergeRunRefusal, number: number, liveRun: string | null = null): never {
	throw error(409, { message: refusalMessage(code, number, liveRun), code });
}

/** The person a run records: the account's id and the name the pull request would carry. */
export interface MergePerson {
	id: string;
	name: string;
}

export const personOf = (user: {
	id: string;
	name: string | null;
	email: string;
}): MergePerson => ({
	id: user.id,
	name: approverName(user),
});

// ── Start ─────────────────────────────────────────────────────────────────────

function requestIdOf(body: unknown): string {
	const requestId = isRecord(body) ? body.requestId : undefined;
	if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
		throw error(400, 'requestId is 8–64 URL-safe characters.');
	}
	return requestId;
}

async function mainSha(app: GithubApp): Promise<string> {
	try {
		const ref = await app.json<{ object: { sha: string } }>(refReadPath(repo(), BASE_BRANCH));
		return ref.object.sha;
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
}

/**
 * Start a merge run (`POST /api/pipeline/changes/<n>/resolve`, body `{ requestId }`). In order: a
 * known `requestId` (its run; 409 `request_id_reused` for another change's or another person's), the
 * App (503), the refusals of ADR-0015 §4 that the launcher checks (409 with their code: no active
 * workflow, closed, not in conflict, on hold, a live run), then the run is stored `dispatched` and
 * dispatched. A fork, or what is not a change, is a 404. A dispatch GitHub refuses ends the run
 * `failed` with GitHub's reason, and is still answered as the run.
 */
export async function startMergeRun(
	input: { number: number; body: unknown; person: MergePerson },
	app: GithubApp = githubApp,
): Promise<{ run: MergeRunView; created: boolean }> {
	const { number, person } = input;
	const requestId = requestIdOf(input.body);
	const replayed = (run: MergeMainRun) => {
		if (run.prNumber !== number || run.startedById !== person.id) {
			throw error(409, {
				message: refusalMessage('request_id_reused', number, null),
				code: 'request_id_reused',
			});
		}
		return { run: viewOf(run), created: false };
	};
	const known = await getMergeRunByRequest(requestId);
	if (known) return replayed(known);
	const missing = app.missing();
	if (missing) throw error(503, missing);
	const workflowLive = await mergeWorkflowReady(app);
	const pull = await readPull(number, app);
	const live = (await mergeRunsOfPr(number, 5)).find((r) => isLiveMergeRun(r.status));
	const facts = (liveRun: string | null) => ({
		open: pull.state === 'open' && !(pull.merged ?? false),
		onHold: isOnHold(pull),
		conflicted: pull.mergeable_state === 'dirty',
		liveRun,
		workflowLive,
		plainBranch: isPlainBranchName(pull.head.ref),
	});
	const early = startRefusal(facts(live?.id ?? null));
	if (early) refuse(early, number, live?.id ?? null);
	const sha = await mainSha(app);
	const outcome = await insertMergeRun(
		{
			id: newMergeRunId(),
			prNumber: number,
			branch: pull.head.ref,
			headSha: pull.head.sha,
			mainSha: sha,
			requestId,
			startedById: person.id,
			startedBy: person.name,
		},
		(liveRun) => startRefusal(facts(liveRun)),
	);
	if (outcome.kind === 'refused') refuse(outcome.code, number, live?.id ?? null);
	if (outcome.kind === 'exists') return replayed(outcome.run);
	return { run: viewOf(await dispatch(app, outcome.run)), created: true };
}

/**
 * Dispatch a run just stored. A definitive refusal ends it `failed` with GitHub's reason; a dispatch
 * whose answer never came may have started a run, so it stays `dispatched` for the backstop to find
 * (or give up on at 15 minutes).
 */
async function dispatch(app: GithubApp, run: MergeMainRun): Promise<MergeMainRun> {
	const [cap, monthly, spent] = await Promise.all([
		getPipelineMergeMainBudget(),
		getPipelineFixMonthlyCap(),
		monthSpendBefore(0),
	]);
	const sent = await dispatchMergeRun(app, run, dispatchBudget(cap, monthly, spent));
	if (sent.kind === 'refused') {
		const ended = await settleMergeRun(run.id, ['dispatched'], {
			status: 'failed',
			reason: capMergeReason(sent.reason),
		});
		return ended ?? (await getMergeRun(run.id)) ?? run;
	}
	if (sent.kind === 'sent' && sent.ghRunId !== null) await bindMergeRun(run.id, sent.ghRunId);
	return (await getMergeRun(run.id)) ?? run;
}

// ── The job's result: who is calling ──────────────────────────────────────────

export interface MergeJobDeps {
	app?: GithubApp;
	oidc?: GithubOidc;
}

const MERGE_TOKEN: JobTokenSpec = {
	audience: MERGE_RUN_AUDIENCE,
	workflowPath: MERGE_RUN_WORKFLOW_PATH,
	environment: MERGE_RUN_ENVIRONMENT,
	whose: "a merge run's",
	missing: 'A merge run calls with its GitHub OIDC token (Authorization: Bearer).',
};

const isWorkflowPath = (path: unknown): boolean =>
	path === MERGE_RUN_WORKFLOW_PATH ||
	(typeof path === 'string' && path.startsWith(`${MERGE_RUN_WORKFLOW_PATH}@`));

/**
 * The merge run a job's call is for, once its token proves it is that run's job: 401 for a token
 * that does not verify, 403 for a claim that is not a merge run's (named), 404 for an unknown run.
 * The token's `run_id` must be the run's bound Actions run; an unbound run still `dispatched` is
 * bound to it here, after GitHub confirms that Actions run is this merge run's (`run-name` and
 * workflow file), and only once.
 */
async function jobRun(request: Request, id: string, deps: MergeJobDeps): Promise<MergeMainRun> {
	const app = deps.app ?? githubApp;
	const claims = await verifiedJobClaims(request, app, deps.oidc ?? githubOidc, MERGE_TOKEN);
	const ghRunId = Number(claims.run_id);
	const run = MERGE_RUN_ID.test(id) ? await getMergeRun(id) : null;
	if (!run) throw error(404, `There is no merge run ${id}.`);
	if (run.ghRunId !== null) {
		if (run.ghRunId !== ghRunId) throw wrongJobClaim(MERGE_TOKEN, 'run_id');
		return run;
	}
	if (run.status !== 'dispatched') throw wrongJobClaim(MERGE_TOKEN, 'run_id');
	let gh: Awaited<ReturnType<typeof readActionsRun>>;
	try {
		gh = await readActionsRun(app, ghRunId);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
	if (!gh || !isMergeRunTitle(gh.display_title, run.id) || !isWorkflowPath(gh.path)) {
		throw wrongJobClaim(MERGE_TOKEN, 'run_id');
	}
	if ((await bindMergeRun(run.id, ghRunId)) === 'taken') throw wrongJobClaim(MERGE_TOKEN, 'run_id');
	const bound = await getMergeRun(run.id);
	if (!bound || bound.ghRunId !== ghRunId) throw wrongJobClaim(MERGE_TOKEN, 'run_id');
	return bound;
}

// ── The job's result: what is kept ────────────────────────────────────────────

/** What `POST …/result` answers the job: no reason, no explanation — its log is public. */
export interface MergeResultAnswer {
	mergeRun: string;
	status: MergeRunStatus;
	spendUsd: number | null;
}

const WORKING: MergeRunStatus[] = ['dispatched', 'running'];

/**
 * Accept the job's result (JSON or gzipped JSON, ADR-0015 §10). In order: the token (above); the
 * spend, once per model however often it is sent, for any authenticated result of the run's Actions
 * run (a cancelled job may still have spent); the body parsed strictly (400, never echoing what it
 * said) and bound to this run; then the run settled in one conditional write from `dispatched` or
 * `running`, so a second result finds it already moved (409). A `failure` ends the run `failed`;
 * any other outcome but `proposed` ends it `needs_person` or `no_proposal` with the job's sentence,
 * cleaned; a proposal is checked (explained, its files within §5's rules that need no GitHub) and
 * kept for a person to accept.
 */
export async function acceptMergeRunResult(
	request: Request,
	id: string,
	deps: MergeJobDeps = {},
): Promise<MergeResultAnswer> {
	const run = await jobRun(request, id, deps);
	const body = await readResultBody(request, MERGE_CAPS.body);
	const spendUsd = await recordSpend(run.id, parseUsage(body.usage));
	let result: ParsedMergeResult;
	try {
		result = parseMergeResult(body);
	} catch (err) {
		if (err instanceof ResultProblem) throw error(400, err.message);
		throw err;
	}
	if (result.mergeRun !== run.id) throw error(400, "The result's mergeRun is not this run's.");
	if (!isWorkingMergeRun(run.status)) throw error(409, 'This merge run has ended.');
	const end = await decide(run, result, spendUsd, deps.app ?? githubApp);
	const ended = await settleMergeRun(run.id, WORKING, end, { result: true });
	if (!ended)
		throw error(409, 'A result was already accepted for this merge run, or it has ended.');
	return { mergeRun: ended.id, status: ended.status, spendUsd };
}

async function recordSpend(id: string, usage: ReturnType<typeof parseUsage>): Promise<number> {
	const { pricing } = await getDirectorPricing();
	const usd = await recordMergeRunSpend(
		id,
		MERGE_RUN_AGENT,
		usage.map((u) => ({ ...u, usd: priceOf(u, pricing) })),
	);
	if (usd === null) throw error(400, "The result's usage names more than 10 models over the run.");
	return usd;
}

/**
 * `main`'s tree at the run's SHA, read only when a file rests on `filesProblem`'s one exemption (a
 * protected path or a lockfile listed as `main`'s). Null when none does, or when the tree is too
 * large to list whole (the exemption is then not given). A GitHub error is a 502, so the job sends
 * the result again: a blip is not turned into a refusal with the wrong reason.
 */
async function mainTreeFor(
	app: GithubApp,
	run: MergeMainRun,
	files: MergeRunFile[],
): Promise<Files | null> {
	if (!files.some(needsMainsTree)) return null;
	try {
		return (await readFiles(app, run.mainSha))?.files ?? null;
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
}

/** This calendar month's fix-run and merge-run spend, bar `own`: the run's own spend is not "before". */
async function monthSpendBefore(own: number, nowMs = Date.now()): Promise<number> {
	const since = monthStartUtc(nowMs);
	const [fix, merge] = await Promise.all([
		fixSpendSince(since, FIX_RUN_AGENT),
		fixSpendSince(since, MERGE_RUN_AGENT),
	]);
	return fix + merge - own;
}

const refused = (rule: string): MergeRunEnd => ({
	status: 'needs_person',
	reason: refusedChange(rule),
});

/** What the result comes to: the end it settles the run with. */
async function decide(
	run: MergeMainRun,
	r: ParsedMergeResult,
	spendUsd: number,
	app: GithubApp,
): Promise<MergeRunEnd> {
	const outcome = r.outcome;
	if (r.failure !== null || outcome === null) {
		return {
			status: 'failed',
			reason: capMergeReason(`The job failed: ${cleanLine(r.failure ?? '', 200)}`),
		};
	}
	const explanation = r.explanation && cleanExplanation(r.explanation);
	const reason = cleanLine(r.reason, MERGE_CAPS.reason);
	const leak = textsProblem(
		[r.reason, ...(r.explanation ? explanationTexts(r.explanation) : [])],
		[reason, ...(explanation ? explanationTexts(explanation) : [])],
	);
	if (leak) return refused(leak);
	if (outcome !== 'proposed') {
		return {
			status: outcome === 'no_proposal' ? 'no_proposal' : 'needs_person',
			reason: capMergeReason(reason || OUTCOME_REASONS[outcome]),
			explanation,
		};
	}
	if (r.headSha !== run.headSha || r.mainSha !== run.mainSha) {
		return { status: 'failed', reason: 'The result is for another head or another main.' };
	}
	if (
		!isExplainedMerge(explanation) ||
		!r.files.length ||
		explanationSize(explanation) > MERGE_CAPS.explanation
	) {
		return { status: 'no_proposal', reason: MERGE_RUN_REASONS.notExplained, explanation };
	}
	const hunkPaths = new Set(explanation.hunks.map((h) => h.path));
	const problem =
		filesProblem(r.files, hunkPaths, await mainTreeFor(app, run, r.files)) ??
		resultProblem(explanation, r.files);
	if (problem) return { ...refused(problem), explanation };
	if (explanationLines(explanation) > MERGE_CAPS.linesTotal) {
		return { status: 'no_proposal', reason: MERGE_RUN_REASONS.linesTooLong, explanation };
	}
	const byModel = r.files.some((f) => f.rule === null && hunkPaths.has(f.path));
	if (byModel && (await monthSpendBefore(spendUsd)) >= (await getPipelineFixMonthlyCap())) {
		return { status: 'needs_person', reason: MERGE_RUN_REASONS.budgetSpent, explanation };
	}
	return { status: 'proposed', files: r.files, explanation, baseSha: r.baseSha ?? undefined };
}

// ── Accept ────────────────────────────────────────────────────────────────────

const accepting = createKeyedMutex();

interface GhCommit {
	sha: string;
	parents: { sha: string }[];
	tree: { sha: string };
	commit?: { committer?: { date?: string } | null };
}

interface GhCompare {
	status?: string;
	ahead_by?: number;
	behind_by?: number;
	merge_base_commit?: { sha: string };
	files?: { filename: string; previous_filename?: string }[];
}

/** A person-facing 409 for a proposal that can no longer be accepted, with a code. */
function conflict(code: string, message: string): never {
	throw error(409, { message, code });
}

async function stale(run: MergeMainRun, reason: string): Promise<never> {
	await settleMergeRun(run.id, ['accepting'], { status: 'stale', reason });
	return conflict('stale', reason);
}

/**
 * `main`'s changes since `from`, by path, or `null` ("unknown", which is stale) when `main` is no
 * longer ahead of it or the compare may have listed only some of its files.
 */
async function mainChangedSince(app: GithubApp, from: string): Promise<Set<string> | null> {
	const cmp = await app.json<GhCompare>(`/repos/${repo()}/compare/${from}...${BASE_BRANCH}`);
	if (cmp.status !== 'ahead' && cmp.status !== 'identical') return null;
	if (cmp.files === undefined && (cmp.ahead_by ?? 0) > 0) return null;
	const files = cmp.files ?? [];
	if (files.length >= COMPARE_FILES_CAP) return null;
	const paths = new Set<string>();
	for (const f of files) {
		paths.add(f.filename);
		if (f.previous_filename) paths.add(f.previous_filename);
	}
	return paths;
}

async function readFiles(
	app: GithubApp,
	commit: string,
): Promise<{ tree: string; files: Files } | null> {
	const r = repo();
	const c = await app.json<GhCommit>(`/repos/${r}/git/commits/${commit}`);
	const tree = await app.json<{
		truncated?: boolean;
		tree: { path: string; mode: string; type: string; sha: string }[];
	}>(`/repos/${r}/git/trees/${c.tree.sha}?recursive=1`);
	if (tree.truncated) return null;
	return {
		tree: c.tree.sha,
		files: new Map(
			tree.tree
				.filter((e) => e.type !== 'tree')
				.map((e) => [e.path, { mode: e.mode, type: e.type, sha: e.sha }] as const),
		),
	};
}

/** A blob's text, or null when it is binary. */
async function readText(app: GithubApp, sha: string): Promise<string | null> {
	const blob = await app.json<{ content: string; encoding: string }>(
		`/repos/${repo()}/git/blobs/${sha}`,
	);
	const bytes = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8');
	return bytes.includes(0) ? null : bytes.toString('utf8');
}

const WORKFLOW_MENTION = /\bworkflows?\b/i;

/** What GitHub says to a push the App may not make over a workflow file, in the launcher's words. */
const workflowRefusal = (githubMessage: string): string =>
	capMergeReason(
		`GitHub refused the push over a workflow file: ${githubMessage}. Use GitHub's own Update branch on the pull request, or copy the merge brief to a session.`,
	);

const RENAMED_BRANCH_TEXT =
	'The pull request is no longer on the branch this run was made for; resolve again.';

export interface AcceptResult {
	run: MergeRunView;
	/** The merge commit now at the branch's head. */
	mergeSha: string;
	/** A resend after the branch already moved to this run's merge. */
	already: boolean;
}

/**
 * Accept a proposal (`POST /api/pipeline/changes/<n>/merge-runs/<id>/accept`, body `{ headSha }`, the
 * head the card showed). First the CLAIM, in the database and before any GitHub write: `proposed →
 * accepting` with a lease ({@link MERGE_ACCEPT_LEASE_MS}); a Discard acts only from `proposed`, and a
 * second Accept finds the claim taken (409 `accepting`), on any replica. Under the claim the change
 * is re-read: a branch that is not the run's, or whose head is not the run's — or `main` having
 * changed a conflicted file since the run's SHA (the compare API) — makes the proposal `stale`
 * (409 `stale`) and nothing is written; a name the pipeline will not push to, a change not open or on
 * hold, give the claim back. Otherwise the launcher builds the merge from the merge base, the head and
 * `main` at the run's SHA (`planMerge`): a path only one side changed takes that side, and only the
 * paths both sides changed and a rule's regenerated files take the run's content. The commit's
 * parents are `[head, main SHA]`; its SHA is stored BEFORE `PATCH git/refs` with `force: false`
 * moves the branch, so a lost answer is recognised by an exact compare with the branch's tip (never
 * by its parents or a token anyone can copy). GitHub refusing a push over a workflow file ends the
 * run `needs_person` with the reason.
 */
export async function acceptMergeRun(
	input: { number: number; id: string; headSha: string; person: MergePerson },
	app: GithubApp = githubApp,
): Promise<AcceptResult> {
	const { number, id, person } = input;
	return accepting(String(number), async () => {
		const run = MERGE_RUN_ID.test(id) ? await getMergeRun(id) : null;
		if (!run || run.prNumber !== number)
			throw error(404, `There is no merge run ${id} on #${number}.`);
		if (run.status === 'accepted' && run.mergeSha) {
			return { run: viewOf(run), mergeSha: run.mergeSha, already: true };
		}
		if (
			run.status === 'accepting' &&
			Date.now() - (run.acceptingAt?.getTime() ?? 0) < MERGE_ACCEPT_LEASE_MS
		) {
			conflict('accepting', `Merge run ${id} is being accepted: wait a moment.`);
		}
		if (
			(run.status !== 'proposed' && run.status !== 'accepting') ||
			!run.files ||
			!run.explanation
		) {
			conflict('not_proposed', `Merge run ${id} has no proposal waiting.`);
		}
		const claimed = await claimAccept(id, person, MERGE_ACCEPT_LEASE_MS);
		if (!claimed) {
			const now = await getMergeRun(id);
			if (now?.status === 'accepted' && now.mergeSha) {
				return { run: viewOf(now), mergeSha: now.mergeSha, already: true };
			}
			if (now?.status === 'accepting') conflict('accepting', `Merge run ${id} is being accepted.`);
			conflict('not_proposed', `Merge run ${id} has no proposal waiting.`);
		}
		const pushed = { sent: false };
		try {
			return await acceptClaimed(
				app,
				{ ...claimed, files: run.files, explanation: run.explanation },
				input.headSha,
				person,
				pushed,
			);
		} catch (err) {
			// Nothing was pushed: the proposal is given back. A push whose answer is unknown keeps the
			// claim, and its lease lets the next Accept or the backstop find out from the branch's tip.
			if (!pushed.sent) await releaseAccept(id);
			throw err;
		}
	});
}

/** An Accept under the claim: the checks, then the build. */
async function acceptClaimed(
	app: GithubApp,
	run: MergeMainRun & { files: MergeRunFile[]; explanation: MergeRunExplanation },
	headSha: string,
	person: MergePerson,
	pushed: { sent: boolean },
): Promise<AcceptResult> {
	const pull = await readPull(run.prNumber, app);
	if (pull.state !== 'open') conflict('not_open', `#${run.prNumber} is not open.`);
	if (isOnHold(pull)) conflict('on_hold', `#${run.prNumber} is on hold: resume it first.`);
	if (pull.head.ref !== run.branch) return stale(run, RENAMED_BRANCH_TEXT);
	if (!isPlainBranchName(run.branch)) conflict('unsafe_branch', UNSAFE_BRANCH_TEXT);
	if (run.acceptSha && pull.head.sha === run.acceptSha) {
		const done = await settleMergeRun(run.id, ['accepting'], {
			status: 'accepted',
			mergeSha: run.acceptSha,
			acceptedBy: person,
		});
		forgetChanges();
		return {
			run: viewOf(done ?? (await getMergeRun(run.id)) ?? run),
			mergeSha: run.acceptSha,
			already: true,
		};
	}
	if (headSha !== run.headSha || pull.head.sha !== run.headSha) {
		return stale(run, MERGE_RUN_REASONS.headMoved);
	}
	const files = run.files;
	const touched = new Set([
		...files.map((f) => f.path),
		...run.explanation.conflicted.map((c) => c.path),
	]);
	const moved = await mainChangedSince(app, run.mainSha);
	if (moved === null || [...moved].some((p) => touched.has(p))) {
		return stale(run, MERGE_RUN_REASONS.mainMoved);
	}
	const end = await build(app, run, pull, files, person, pushed);
	if ('end' in end) {
		await settleMergeRun(run.id, ['accepting'], end.end);
		conflict('needs_person', end.end.reason ?? 'The resolution was refused.');
	}
	const done = await settleMergeRun(run.id, ['accepting'], {
		status: 'accepted',
		mergeSha: end.sha,
		acceptedBy: person,
	});
	forgetChanges();
	return {
		run: viewOf(done ?? (await getMergeRun(run.id)) ?? run),
		mergeSha: end.sha,
		already: false,
	};
}

/** The refusal that ends a run `needs_person`, or the merge commit now at the branch. */
async function build(
	app: GithubApp,
	run: MergeMainRun,
	pull: GhPull,
	files: MergeRunFile[],
	person: MergePerson,
	pushed: { sent: boolean },
): Promise<{ end: MergeRunEnd & { status: 'needs_person' } } | { sha: string }> {
	const r = repo();
	const needsPerson = (reason: string) => ({
		end: { status: 'needs_person' as const, reason: capMergeReason(reason) },
	});
	const base = await app.json<GhCompare>(
		`/repos/${r}/compare/${run.mainSha}...${run.headSha}?per_page=1`,
	);
	const baseSha = base.merge_base_commit?.sha;
	if (!baseSha) return needsPerson('GitHub reports no merge base for this change.');
	if (baseSha !== run.baseSha) {
		await settleMergeRun(run.id, ['accepting'], {
			status: 'stale',
			reason: MERGE_RUN_REASONS.otherBase,
		});
		return conflict('stale', MERGE_RUN_REASONS.otherBase);
	}
	const [baseTree, headTree, mainTree] = await Promise.all(
		[baseSha, run.headSha, run.mainSha].map((sha) => readFiles(app, sha)),
	);
	if (!baseTree || !headTree || !mainTree) {
		return needsPerson('The repository tree is too large for GitHub to list whole.');
	}
	const planned = planMerge(baseTree.files, headTree.files, mainTree.files, files);
	if ('problem' in planned) return needsPerson(refusedChange(planned.problem));
	const problem = await checkContent(app, planned.plan, headTree.files, mainTree.files);
	if (problem) return needsPerson(refusedChange(problem));
	try {
		const writes = planned.plan.writes;
		const written = writes.filter((w) => w.content !== null);
		const blobs = await mapWithConcurrency(written, 4, (w) =>
			app.json<{ sha: string }>(`/repos/${r}/git/blobs`, {
				method: 'POST',
				body: JSON.stringify({ content: w.content, encoding: 'utf-8' }),
			}),
		);
		const blobOf = new Map(written.map((w, i) => [w.path, blobs[i].sha]));
		const tree = await app.json<{ sha: string }>(`/repos/${r}/git/trees`, {
			method: 'POST',
			body: JSON.stringify({
				base_tree: mainTree.tree,
				tree: writes.map((w) => ({
					path: w.path,
					mode: w.mode,
					type: w.type,
					sha: w.content === null ? w.sha : (blobOf.get(w.path) ?? null),
				})),
			}),
		});
		const commit = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
			method: 'POST',
			body: JSON.stringify({
				message: mergeMessage({
					branch: pull.head.ref,
					runId: run.id,
					mainSha: run.mainSha,
					files,
					person: person.name,
				}),
				tree: tree.sha,
				parents: [run.headSha, run.mainSha],
			}),
		});
		await recordAcceptSha(run.id, commit.sha);
		pushed.sent = true;
		const moved = await app.fetch(refWritePath(r, run.branch), {
			method: 'PATCH',
			body: JSON.stringify({ sha: commit.sha, force: false }),
		});
		if (!moved.ok) {
			const message = await messageOf(moved);
			if (WORKFLOW_MENTION.test(message)) return needsPerson(workflowRefusal(message));
			if (moved.status === 422) {
				await settleMergeRun(run.id, ['accepting'], {
					status: 'stale',
					reason: MERGE_RUN_REASONS.headMoved,
				});
				return conflict('stale', MERGE_RUN_REASONS.headMoved);
			}
			throw new GithubAppError(
				`GitHub ${moved.status} moving the branch: ${message}`,
				moved.status,
			);
		}
		return { sha: commit.sha };
	} catch (err) {
		if (err instanceof GithubAppError && WORKFLOW_MENTION.test(err.message)) {
			return needsPerson(workflowRefusal(err.message));
		}
		throw err;
	}
}

/** The run's own text against what the sides hold: read once per file it wrote itself. */
async function checkContent(
	app: GithubApp,
	plan: Plan,
	head: Files,
	main: Files,
): Promise<string | null> {
	const found = await mapWithConcurrency(plan.resolved, 4, async (file) => {
		const read = async (side: Files): Promise<string | null | 'binary'> => {
			const entry = side.get(file.path);
			if (!entry || entry.type !== 'blob') return null;
			return (await readText(app, entry.sha)) ?? 'binary';
		};
		const [h, m] = await Promise.all([read(head), read(main)]);
		if (h === 'binary' || m === 'binary') return 'a file both sides changed is binary';
		const sides: Sides = { head: h, main: m };
		return contentProblem(file, sides);
	});
	return found.find((p): p is string => p !== null) ?? null;
}

// ── Discard ───────────────────────────────────────────────────────────────────

/**
 * Discard a proposal (`POST …/discard`): the run ends `discarded` and the branch is untouched. A run
 * still working is stopped instead: its Actions run is cancelled, and it ends `cancelled`, so a
 * result that arrives after cannot propose anything.
 */
export async function discardMergeRun(
	input: { number: number; id: string; person: MergePerson },
	app: GithubApp = githubApp,
): Promise<MergeRunView> {
	const { number, id, person } = input;
	return accepting(String(number), () => discard(number, id, person, app));
}

async function discard(
	number: number,
	id: string,
	person: MergePerson,
	app: GithubApp,
): Promise<MergeRunView> {
	const run = MERGE_RUN_ID.test(id) ? await getMergeRun(id) : null;
	if (!run || run.prNumber !== number)
		throw error(404, `There is no merge run ${id} on #${number}.`);
	if (run.status === 'proposed') {
		const done = await settleMergeRun(id, ['proposed'], {
			status: 'discarded',
			reason: `Discarded by ${person.name}.`,
		});
		if (!done) conflict('not_proposed', `Merge run ${id} has no proposal waiting.`);
		return viewOf(done);
	}
	if (run.status === 'accepting') conflict('accepting', `Merge run ${id} is being accepted.`);
	if (!isWorkingMergeRun(run.status)) conflict('ended', `Merge run ${id} has already ended.`);
	if (run.ghRunId !== null) {
		let asked: Awaited<ReturnType<typeof cancelActionsRun>>;
		try {
			asked = await cancelActionsRun(app, run.ghRunId);
		} catch (err) {
			throw error(502, err instanceof Error ? err.message : String(err));
		}
		if (asked.kind === 'refused') {
			throw error(502, `GitHub ${asked.status} cancelling the run: ${asked.message}`);
		}
	}
	const stopped = await settleMergeRun(id, WORKING, {
		status: 'cancelled',
		reason: `Stopped by ${person.name}.`,
	});
	if (!stopped) conflict('ended', `Merge run ${id} has already ended.`);
	if (run.ghRunId === null) await cancelListedMergeRun(app, id).catch(() => undefined);
	return viewOf(stopped);
}

// ── What the page reads ───────────────────────────────────────────────────────

/**
 * A change's merge runs as the detail shows them (`GET /api/pipeline/changes/<n>/merge-runs`): whether
 * Resolve is offered at all, the newest run, the newest accepted one, and — for a proposal waiting —
 * how far `main` has moved since it and when the branch was last pushed.
 */
export async function mergeRunsOfChange(
	number: number,
	app: GithubApp = githubApp,
): Promise<MergeRunsAnswer> {
	const [ready, runs] = await Promise.all([mergeWorkflowReady(app), mergeRunsOfPr(number, 10)]);
	const newest = runs[0] ?? null;
	const accepted = runs.find((r) => r.status === 'accepted') ?? null;
	let behindNow: number | null = null;
	let headCommittedAt: string | null = null;
	if (newest?.status === 'proposed' && !app.missing()) {
		try {
			const cmp = await app.json<GhCompare>(
				`/repos/${repo()}/compare/${newest.mainSha}...${BASE_BRANCH}?per_page=1`,
			);
			behindNow = typeof cmp.ahead_by === 'number' ? cmp.ahead_by : null;
			const pull = await readPull(number, app);
			const head = await app.json<GhCommit>(`/repos/${repo()}/commits/${pull.head.sha}`);
			// GitHub gives no time for a push to a branch, so the head commit's own time stands in: a
			// commit made earlier and pushed later is missed, which only withholds a warning.
			headCommittedAt = head.commit?.committer?.date ?? null;
		} catch (err) {
			if (!(err instanceof GithubAppError) && !(err instanceof Error)) throw err;
		}
	}
	return {
		ready,
		run: newest && viewOf(newest),
		accepted: accepted && viewOf(accepted),
		behindNow,
		headCommittedAt,
	};
}
