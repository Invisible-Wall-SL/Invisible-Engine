import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { error } from '@sveltejs/kit';
import { costOfUsage, type DirectorPricing } from 'director-costs';
import { UNTRUSTED_LINE } from '../../../../../services/director-worker/src/untrusted';
import {
	FIX_RUN_AGENT,
	FIX_RUN_AUDIENCE,
	FIX_RUN_ENVIRONMENT,
	FIX_RUN_ID,
	FIX_RUN_REASONS,
	FIX_RUN_WORKFLOW_PATH,
	actionsRefusal,
	capReason,
	fixRunBranch,
	fixRunName,
	fixRunView,
	isFixRunOutcome,
	isLiveFixRun,
	refusalMessage,
	refusedChange,
	startRefusal,
	stoppedBy,
	type FixRunFile,
	type FixRunOutcome,
	type FixRunRefusal,
	type FixRunSecondBug,
	type FixRunStatus,
	type FixRunUsage,
	type FixRunView,
	type StartFacts,
} from '$lib/bugFixRuns';
import { bugBrief } from '$lib/bugReports';
import {
	CAPABILITIES,
	PIPELINE_BUG_FIX_CAPABILITY,
	PIPELINE_BUG_TRIAGE_CAPABILITY,
} from '$lib/roles';
import { getPipelineFixBudget } from './appSettings';
import {
	actionsRunUrl,
	cancelActionsRun,
	cancelListedRun,
	dispatchFixRun,
	fixRunActor,
	fixRunBot,
	messageOf,
	pullForBranch,
	readActionsRun,
} from './bugFixRunsActions';
import {
	MAX_SUMMARY,
	TEXT_CAPS,
	TEXT_SLACK,
	baseProblem,
	cleanPerson,
	cleanResult,
	cleanText,
	localProblem,
	privateNames,
	publication,
	publicationProblem,
	withModes,
	type BaseEntry,
	type BaseTree,
	type FixRunText,
	type ParsedResult,
} from './bugFixRunsChange';
import {
	accountName,
	bindFixRun,
	claimFixRunResult,
	fixRunsOfBug,
	getFixRun,
	getFixRunByRequest,
	insertFixRun,
	markFixRunRunning,
	privateNamesOf,
	recordFixRunSpend,
	renewFixRunClaim,
	settleFixRun,
	type BugFixRun,
} from './bugFixRunsStore';
import {
	canRunFixes,
	fixStartFacts,
	forgetBugSync,
	readVisible,
	screenshotBytes,
	type BugAccess,
} from './bugReports';
import { getBugFull, type BugFull } from './bugReportsStore';
import { mapWithConcurrency } from './concurrency';
import { getDirectorPricing } from './costs/pricingConfig';
import { downscaleForModel } from './director/mockupPixels';
import { ENV } from './env';
import { GithubAppError, githubApp, type GithubApp } from './githubApp';
import { OidcError, githubOidc, type GithubOidc, type GithubOidcClaims } from './githubOidc';
import { forgetChanges } from './pipelineChanges';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { DEFAULT_PROJECT_KEY } from './projects';

/**
 * Fix runs on pipeline bugs (ADR-0013): Start and Stop from a bug page, the three endpoints the
 * Actions job calls, and turning its result into a draft pull request.
 *
 * Who may do what:
 *  - start and stop: whoever sees the pipeline bug and holds BOTH "Start fix runs on pipeline
 *    bugs" and "Triage pipeline bugs" (the run's pull request moves the status). Start sends an
 *    unsent bug in the same transaction (`sent`, then `fix_run`).
 *  - the brief, a screenshot, the result: only the job of THAT run, proved by a GitHub OIDC token
 *    for {@link FIX_RUN_AUDIENCE} from `bug-fix.yml` on `main`, dispatched by the App's bot, first
 *    attempt, in the `bug-fix` environment, whose Actions run is the one bound to the fix run. No
 *    shared secret exists to leak: the token names one run and expires in minutes.
 *
 * The job's result is untrusted: the launcher re-checks the change against its base
 * (`bugFixRunsChange.ts`) and only then commits it as the App on the run's base, on
 * `bug-<n>-fix-<id>`, and opens a DRAFT pull request. A refused change is `no_fix`, never a PR.
 * The run never changes the bug's status, priority or text: the link sync moves the status when
 * the pull request opens and merges, as for any fix. The bug's text and screenshots go only to the
 * job, never into anything public.
 */

const repo = (): string => ENV.GITHUB_ENGINE_REPO;

/** A client-supplied id per Start, replayed to the same run (as the Agents tab's submit). */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const capabilityName = (key: string): string =>
	CAPABILITIES.find((c) => c.key === key)?.name ?? key;

function requireFixRights(access: BugAccess): void {
	if (!canRunFixes(access)) {
		throw error(
			403,
			`A fix run needs both the “${capabilityName(PIPELINE_BUG_FIX_CAPABILITY)}” and the “${capabilityName(PIPELINE_BUG_TRIAGE_CAPABILITY)}” permissions.`,
		);
	}
}

function refuse(code: FixRunRefusal, number: number, facts: StartFacts): never {
	throw error(409, { message: refusalMessage(code, number, facts), code });
}

/** A pipeline bug the viewer may see, or the same 404 as a bug that does not exist. */
async function visiblePipelineBug(access: BugAccess, number: number): Promise<BugFull> {
	const full = await readVisible(access, number);
	if (full.bug.kind !== 'pipeline') throw error(404, `There is no BUG-${number}.`);
	return full;
}

const viewOf = (access: BugAccess, run: BugFixRun): FixRunView =>
	fixRunView(run, repo(), canRunFixes(access));

// ── Start and Stop ────────────────────────────────────────────────────────────

/**
 * A new run's id, `FIX_RUN_ID`'s shape. current-games.yml ignores a push to `fixRunBranch` of it
 * by that exact shape, so a different id would run model-written code beside the harness's
 * secrets: `check:bug-fix-runs` matches this against the workflow's own pattern.
 */
export const newFixRunId = (): string => randomBytes(5).toString('hex');

/**
 * Start a fix run on a pipeline bug (`POST /api/bugs/<n>/fix-runs`, body `{ requestId }`). In
 * order: the bug (404), both capabilities (403), a known `requestId` (its run; 409 when it is
 * another bug's or another person's), the App (503, before anything is written), and the refusals
 * of ADR-0013 §1 (409 with their code), read once to answer fast and again under the bug's lock —
 * but a `requestId` a racing twin of this request has just stored answers its run, not a refusal.
 * Main's commit is read before the transaction; the run is dispatched after it commits. A dispatch
 * GitHub refuses ends the run `failed` with GitHub's reason, and is still answered as the run.
 */
export async function startFixRun(
	access: BugAccess,
	number: number,
	body: unknown,
	app: GithubApp = githubApp,
): Promise<{ run: FixRunView; created: boolean }> {
	const requestId = isRecord(body) ? body.requestId : undefined;
	if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
		throw error(400, 'requestId is 8–64 URL-safe characters.');
	}
	const full = await visiblePipelineBug(access, number);
	requireFixRights(access);
	const replayed = (run: BugFixRun) => {
		if (run.bugNumber !== number || run.startedById !== access.user.id) {
			throw error(409, {
				message: `${requestId} already started another fix run.`,
				code: 'request_id_reused',
			});
		}
		return { run: viewOf(access, run), created: false };
	};
	const known = await getFixRunByRequest(requestId);
	if (known) return replayed(known);
	const missing = app.missing();
	if (missing) throw error(503, missing);
	const facts = await fixStartFacts(full.bug, full.links, await fixRunsOfBug(number));
	const early = startRefusal(facts);
	if (early) {
		const twin = await getFixRunByRequest(requestId);
		if (twin) return replayed(twin);
		refuse(early, number, facts);
	}

	const baseSha = await mainSha(app);
	const id = newFixRunId();
	let locked = facts;
	const outcome = await insertFixRun(
		{
			id,
			bugNumber: number,
			baseSha,
			requestId,
			startedById: access.user.id,
			startedBy: access.actor.name,
		},
		access.actor,
		(now) => {
			locked = {
				...facts,
				status: now.bug.status,
				openPr: now.openPr,
				liveRun: now.liveRun,
				liveTotal: now.liveTotal,
			};
			return startRefusal(locked);
		},
	);
	if (outcome.kind === 'missing') throw error(404, `There is no BUG-${number}.`);
	if (outcome.kind === 'refused') refuse(outcome.code, number, locked);
	if (outcome.kind === 'exists') return replayed(outcome.run);
	return { run: viewOf(access, await dispatch(app, outcome.run)), created: true };
}

async function mainSha(app: GithubApp): Promise<string> {
	try {
		const ref = await app.json<{ object: { sha: string } }>(`/repos/${repo()}/git/ref/heads/main`);
		return ref.object.sha;
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
}

/**
 * Dispatch a run just stored. A definitive refusal ends it `failed` with GitHub's reason and moves
 * nothing else; a dispatch whose answer never came may have started a run, so the run stays
 * `dispatched` for the backstop to find (or give up on at 15 minutes).
 */
async function dispatch(app: GithubApp, run: BugFixRun): Promise<BugFixRun> {
	const sent = await dispatchFixRun(app, run.id);
	if (sent.kind === 'refused') {
		const ended = await settleFixRun(
			run.id,
			{ status: 'failed', reason: sent.reason },
			fixRunActor(run.id),
		);
		return ended ?? (await getFixRun(run.id)) ?? run;
	}
	if (sent.kind === 'sent' && sent.ghRunId !== null) await bindFixRun(run.id, sent.ghRunId);
	return (await getFixRun(run.id)) ?? run;
}

/** Ask GitHub to cancel the Actions run, as Stop needs it: a refusal is a 502 that settles nothing. */
async function cancelForStop(app: GithubApp, ghRunId: number): Promise<void> {
	let asked: Awaited<ReturnType<typeof cancelActionsRun>>;
	try {
		asked = await cancelActionsRun(app, ghRunId);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
	if (asked.kind === 'refused') {
		throw error(502, actionsRefusal(asked.status, asked.message, 'cancelling the fix run'));
	}
}

/**
 * Stop a live run (`POST /api/bugs/<n>/fix-runs/<id>/stop`), same rights as Start. A bound run's
 * Actions run is cancelled first (GitHub's 409 says it already finished, its 404 that it has no such
 * run: both stop it), then the run settles `cancelled` at once — so no result can open a pull
 * request after a person pressed Stop. A run bound in between is cancelled on GitHub after, as best
 * it can be, and one never bound is looked for in the workflow's runs and cancelled when found. A
 * run whose result is already being opened is no longer stopped (409); a GitHub
 * refusal stops nothing (502).
 */
export async function stopFixRun(
	access: BugAccess,
	number: number,
	id: string,
	app: GithubApp = githubApp,
): Promise<FixRunView> {
	await visiblePipelineBug(access, number);
	requireFixRights(access);
	const run = FIX_RUN_ID.test(id) ? await getFixRun(id) : null;
	if (!run || run.bugNumber !== number) {
		throw error(404, `There is no fix run ${id} on BUG-${number}.`);
	}
	const finishing = () =>
		error(409, {
			message: `Fix run ${id} is opening its pull request and can no longer be stopped.`,
			code: 'fix_run_finishing',
		});
	const ended = () =>
		error(409, { message: `Fix run ${id} has already ended.`, code: 'fix_run_ended' });
	if (!isLiveFixRun(run.status)) throw ended();
	if (run.resultAt) throw finishing();
	if (run.ghRunId !== null) await cancelForStop(app, run.ghRunId);
	const stopped = await settleFixRun(
		id,
		{ status: 'cancelled', reason: stoppedBy(access.actor.name) },
		access.actor,
		{ withoutResult: true },
	);
	if (!stopped) throw (await getFixRun(id))?.resultAt ? finishing() : ended();
	if (run.ghRunId === null && stopped.ghRunId !== null) {
		await cancelActionsRun(app, stopped.ghRunId).catch(() => undefined);
	} else if (stopped.ghRunId === null) {
		// Never bound: its Actions run may still have started, under its run-name.
		await cancelListedRun(app, id).catch(() => undefined);
	}
	return viewOf(access, stopped);
}

// ── The job's endpoints: who is calling ───────────────────────────────────────

export interface FixRunJobDeps {
	app?: GithubApp;
	oidc?: GithubOidc;
	/** How a GitHub write waits before it is tried again; a fixture hands in one that does not. */
	sleep?: (ms: number) => Promise<void>;
}

const JOB_WORKFLOW_SUFFIX = `/${FIX_RUN_WORKFLOW_PATH}@refs/heads/main`;

const sameRepo = (v: unknown): boolean =>
	typeof v === 'string' && v.toLowerCase() === repo().toLowerCase();

/** `<repo>/.github/workflows/bug-fix.yml@refs/heads/main`, the repository's case aside. */
const isFixWorkflowRef = (v: unknown): boolean =>
	typeof v === 'string' &&
	sameRepo(v.slice(0, repo().length)) &&
	v.slice(repo().length) === JOB_WORKFLOW_SUFFIX;

/**
 * The claims a fix run's token must carry, beyond what `githubOidc` verifies. Each names the claim
 * it refuses: the log is public, but claim names are not secret. Both workflow refs are
 * `bug-fix.yml` on `main` (the caller's and the job's own); `actor` is the App's bot, so a run a
 * person dispatched by hand is refused; `run_attempt` is 1, as a person re-running the job keeps
 * the bot as `actor`; `environment` and `runner_environment` pin where the key lives.
 */
const FIX_RUN_CLAIMS: [string, (v: unknown) => boolean][] = [
	['repository', sameRepo],
	['workflow_ref', isFixWorkflowRef],
	['job_workflow_ref', isFixWorkflowRef],
	['ref', (v) => v === 'refs/heads/main'],
	['event_name', (v) => v === 'workflow_dispatch'],
	['environment', (v) => v === FIX_RUN_ENVIRONMENT],
	['run_attempt', (v) => v === '1'],
	['runner_environment', (v) => v === 'github-hosted'],
];

const wrongClaim = (claim: string) => error(403, `The token's ${claim} is not a fix run's.`);

async function verifiedClaims(
	request: Request,
	app: GithubApp,
	oidc: GithubOidc,
): Promise<GithubOidcClaims & { run_id: string }> {
	const auth = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
	if (!auth) {
		throw error(401, 'A fix run calls with its GitHub OIDC token (Authorization: Bearer).');
	}
	let claims: GithubOidcClaims;
	try {
		claims = await oidc.verify(auth[1], FIX_RUN_AUDIENCE);
	} catch (err) {
		if (err instanceof OidcError) throw error(err.status, err.message);
		throw err;
	}
	for (const [claim, ok] of FIX_RUN_CLAIMS) if (!ok(claims[claim])) throw wrongClaim(claim);
	let bot: string;
	try {
		bot = await fixRunBot(app);
	} catch (err) {
		throw error(503, err instanceof Error ? err.message : String(err));
	}
	if (claims.actor !== bot) throw wrongClaim('actor');
	if (typeof claims.run_id !== 'string' || !/^\d{1,15}$/.test(claims.run_id)) {
		throw wrongClaim('run_id');
	}
	return { ...claims, run_id: claims.run_id };
}

const isWorkflowPath = (path: unknown): boolean =>
	path === FIX_RUN_WORKFLOW_PATH ||
	(typeof path === 'string' && path.startsWith(`${FIX_RUN_WORKFLOW_PATH}@`));

/**
 * The fix run a job's call is for, once its token proves it is that run's job: 401 for a token
 * that does not verify, 403 for a claim that is not a fix run's (named), 404 for an unknown run.
 * The token's `run_id` must be the run's bound Actions run; an unbound run still `dispatched` is
 * bound to it here, after GitHub confirms that Actions run is this fix run's (`run-name` and
 * workflow file) — and only once: the unique index refuses an Actions run already bound to
 * another fix run. Answers the run whatever its status: each endpoint says what it needs.
 */
async function jobRun(request: Request, id: string, deps: FixRunJobDeps): Promise<BugFixRun> {
	const app = deps.app ?? githubApp;
	const claims = await verifiedClaims(request, app, deps.oidc ?? githubOidc);
	const ghRunId = Number(claims.run_id);
	const run = FIX_RUN_ID.test(id) ? await getFixRun(id) : null;
	if (!run) throw error(404, `There is no fix run ${id}.`);
	if (run.ghRunId !== null) {
		if (run.ghRunId !== ghRunId) throw wrongClaim('run_id');
		return run;
	}
	if (run.status !== 'dispatched') throw wrongClaim('run_id');
	let gh: Awaited<ReturnType<typeof readActionsRun>>;
	try {
		gh = await readActionsRun(app, ghRunId);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
	if (!gh || gh.display_title !== fixRunName(run.id) || !isWorkflowPath(gh.path)) {
		throw wrongClaim('run_id');
	}
	if ((await bindFixRun(run.id, ghRunId)) === 'taken') throw wrongClaim('run_id');
	const bound = await getFixRun(run.id);
	if (!bound || bound.ghRunId !== ghRunId) throw wrongClaim('run_id');
	return bound;
}

function requireLive(run: BugFixRun | null): asserts run is BugFixRun {
	if (!run || !isLiveFixRun(run.status)) {
		throw error(409, 'This fix run has ended.');
	}
}

// ── The brief and the screenshots ─────────────────────────────────────────────

/** What `GET /api/pipeline/fix-runs/<id>/brief` answers the job. */
export interface FixRunBrief {
	fixRun: string;
	bug: number;
	/** The commit the job checks out, and the change must sit on. */
	baseSha: string;
	/** The run's cap, for the CLI's budget flag (`PIPELINE_FIX_BUDGET_USD`). */
	budgetUsd: number;
	/** The untrusted-text line, then the bug's fix brief: no email, no user id. */
	brief: string;
	screenshots: { id: string; mediaType: string; bytes: number }[];
}

/**
 * The run's bug for its job: the brief people wrote, opened by the fixed line that says it is
 * evidence and not instructions (ADR-0012's, shared with the Director worker), and its screenshot
 * list. Reading it moves the run `dispatched → running`, and that move is the gate: a run a person
 * stopped in the meantime gets nothing.
 */
export async function fixRunBrief(
	request: Request,
	id: string,
	deps: FixRunJobDeps = {},
): Promise<FixRunBrief> {
	const run = await jobRun(request, id, deps);
	requireLive(run);
	const now = (await markFixRunRunning(run.id, fixRunActor(run.id))) ?? (await getFixRun(run.id));
	requireLive(now);
	const full = await getBugFull(now.bugNumber);
	if (!full || full.bug.kind !== 'pipeline') throw error(404, `There is no fix run ${id}.`);
	const { bug, screenshots } = full;
	const brief = bugBrief(
		{
			number: bug.number,
			kind: bug.kind,
			title: bug.title,
			description: bug.description,
			area: bug.area,
			projectKey: bug.projectKey,
			pageUrl: bug.pageUrl,
			priority: bug.priority,
			reporter: bug.reporter,
			createdAt: bug.createdAt,
			screenshots: screenshots.length,
		},
		ENV.ORIGIN,
	);
	return {
		fixRun: now.id,
		bug: bug.number,
		baseSha: now.baseSha,
		budgetUsd: await getPipelineFixBudget(),
		brief: `${UNTRUSTED_LINE}\n\n${brief}`,
		screenshots: screenshots.map((s) => ({ id: s.id, mediaType: s.mediaType, bytes: s.bytes })),
	};
}

/** One screenshot of the run's own bug, through its row, at most 1568 px on its long edge. */
export async function fixRunScreenshot(
	request: Request,
	id: string,
	screenshotId: string,
	deps: FixRunJobDeps = {},
): Promise<{ bytes: Uint8Array; mediaType: string }> {
	const run = await jobRun(request, id, deps);
	requireLive(run);
	const shot = await screenshotBytes(run.bugNumber, screenshotId);
	if (!shot) throw error(404, 'No such screenshot on this bug.');
	const type = shot.mediaType;
	if (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp') {
		throw error(422, 'That screenshot is not a readable image.');
	}
	try {
		const copy = await downscaleForModel(shot.bytes, type);
		return { bytes: copy.bytes, mediaType: copy.mediaType };
	} catch {
		throw error(422, 'That screenshot is not a readable image.');
	}
}

// ── The result: reading it ────────────────────────────────────────────────────

/** Past adapter-node's 512 KB body limit a change is sent gzipped; this is what it may unpack to. */
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 10;
/** `director_spend` counts tokens in a 32-bit integer. */
const MAX_TOKENS = 2_000_000_000;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/;
const MAX_GATES = 50;
/**
 * A claim not renewed for this long belonged to a request that died; another post of the result
 * takes it over (as Pipeline Changes' merge claims do). The holder renews before every GitHub write
 * and after its base reads, so the longest it goes without is the base files' reads — 40 at 4 at a
 * time, 10 rounds at GitHub's 15 s timeout: 150 s. One write with its retries is at most 3 × 15 s
 * plus 20 s of waiting; the branch's 422 reads add 30 s. Twice the longest, rounded up. The
 * backstop gives a claim up only after `MID_PR_MS` (10 minutes), well past this.
 */
const CLAIM_STALE_MS = 5 * 60_000;

/** What `POST …/result` answers the job: no reason, no summary — its log is public. */
export interface FixRunResultAnswer {
	fixRun: string;
	status: FixRunStatus;
	outcome: FixRunOutcome | null;
	prNumber: number | null;
	spendUsd: number | null;
}

/**
 * Accept the job's result (`FixRunResultBody`, JSON or gzipped JSON). In order:
 *  1. its spend, recorded for any authenticated result of the run's Actions run, live or not (a
 *     cancelled job may still have spent), once per model however often it is sent;
 *  2. the claim, a lease: a live run's result is taken by one request at a time, which renews it as
 *     it goes; one not renewed for {@link CLAIM_STALE_MS} is taken over, and its first holder —
 *     should it wake — writes nothing more (409); otherwise 409, nothing opened;
 *  3. a `failure` ends the run `failed`; a run that found no fix ends `no_fix` with its outcome; a
 *     bug closed meanwhile opens nothing;
 *  4. otherwise the change is checked (any refusal: `no_fix`, `needs_person`, the rule named), then
 *     committed as the App on the run's base and opened as a draft pull request: `pr_opened`.
 * Anything that goes wrong after the claim ends the run `failed` — unless GitHub has its pull
 * request after all, which is then how it ended. A body the launcher cannot read is 400 and
 * changes nothing but the spend already read from it.
 */
export async function acceptFixRunResult(
	request: Request,
	id: string,
	deps: FixRunJobDeps = {},
): Promise<FixRunResultAnswer> {
	const run = await jobRun(request, id, deps);
	const body = await readResultBody(request);
	const spendUsd = await recordSpend(run.id, parseUsage(body.usage));
	const result = parseResult(body);
	const claimed = await claimFixRunResult(run.id, new Date(Date.now() - CLAIM_STALE_MS));
	if (!claimed?.resultAt) {
		throw error(409, 'A result was already accepted for this fix run, or the run has ended.');
	}
	const io: Io = {
		app: deps.app ?? githubApp,
		sleep: deps.sleep ?? pause,
		hold: { runId: run.id, at: claimed.resultAt, renewing: Promise.resolve() },
		made: null,
	};
	let ended: BugFixRun;
	try {
		ended = (await settleResult(io, claimed, result)) ?? (await getFixRun(run.id)) ?? claimed;
	} catch (err) {
		if (err instanceof LeaseLost) throw error(409, err.message);
		throw err;
	}
	return {
		fixRun: ended.id,
		status: ended.status,
		outcome: ended.outcome,
		prNumber: ended.prNumber,
		spendUsd,
	};
}

async function readResultBody(request: Request): Promise<Record<string, unknown>> {
	const raw = Buffer.from(await request.arrayBuffer());
	if (raw.length > MAX_RESULT_BYTES) throw error(413, 'A result is at most 2 MB.');
	const encoding = (request.headers.get('content-encoding') ?? '').trim().toLowerCase();
	let bytes: Buffer;
	if (encoding === 'gzip') {
		try {
			bytes = gunzipSync(raw, { maxOutputLength: MAX_RESULT_BYTES });
		} catch (err) {
			if (err instanceof RangeError) throw error(413, 'A result unpacks to at most 2 MB.');
			throw error(400, 'The result is not gzip.');
		}
	} else if (encoding === '' || encoding === 'identity') {
		bytes = raw;
	} else {
		throw error(415, 'A result is JSON, plain or gzipped.');
	}
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw error(400, 'The result is not JSON.');
	}
	if (!isRecord(value)) throw error(400, 'The result is not a JSON object.');
	return value;
}

/** A 400 naming the field, in the launcher's words: never a value the result chose. */
function bad(what: string): never {
	throw error(400, `The result's ${what}.`);
}

/** The usage per model, one entry per model (repeats are summed), whole non-negative counts. */
function parseUsage(value: unknown): FixRunUsage[] {
	if (!Array.isArray(value)) bad('usage is not a list');
	if (value.length > MAX_MODELS) bad(`usage names more than ${MAX_MODELS} models`);
	const byModel = new Map<string, FixRunUsage>();
	for (const entry of value as unknown[]) {
		if (!isRecord(entry) || typeof entry.model !== 'string' || !MODEL_NAME.test(entry.model)) {
			return bad('usage has an entry with no model');
		}
		const model = entry.model;
		const count = (key: keyof Omit<FixRunUsage, 'model'>): number => {
			const n = entry[key];
			if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
				return bad('usage has a count that is not a whole number ≥ 0');
			}
			return n;
		};
		const prior = byModel.get(model);
		const next: FixRunUsage = {
			model,
			inputTokens: count('inputTokens') + (prior?.inputTokens ?? 0),
			outputTokens: count('outputTokens') + (prior?.outputTokens ?? 0),
			cacheReadTokens: count('cacheReadTokens') + (prior?.cacheReadTokens ?? 0),
			cacheWriteTokens: count('cacheWriteTokens') + (prior?.cacheWriteTokens ?? 0),
		};
		if (Object.values(next).some((n) => typeof n === 'number' && n > MAX_TOKENS)) {
			bad('usage has a count past what the ledger holds');
		}
		byModel.set(model, next);
	}
	return [...byModel.values()];
}

/**
 * USD of one model's usage at its `pricing.json` price. A model with no price is billed at the
 * dearest one priced, so the monthly ceiling errs high (money fails closed, ADR-0006) without
 * losing the result; its ledger row keeps the model's real name, which says it was unpriced.
 */
function priceOf(u: FixRunUsage, pricing: DirectorPricing): number {
	const usage = {
		input_tokens: u.inputTokens,
		output_tokens: u.outputTokens,
		cache_read_input_tokens: u.cacheReadTokens,
		cache_creation_input_tokens: u.cacheWriteTokens,
	};
	if (Object.hasOwn(pricing.perMTok, u.model)) return costOfUsage(u.model, usage, pricing);
	console.warn('[fix runs] a model with no price was billed at the dearest priced model.');
	const each = Object.keys(pricing.perMTok).map((m) => costOfUsage(m, usage, pricing));
	return each.length ? Math.max(...each) : 0;
}

async function recordSpend(id: string, usage: FixRunUsage[]): Promise<number> {
	const { pricing } = await getDirectorPricing();
	const usd = await recordFixRunSpend(
		id,
		FIX_RUN_AGENT,
		usage.map((u) => ({ ...u, usd: priceOf(u, pricing) })),
	);
	if (usd === null) bad(`usage names more than ${MAX_MODELS} models over the run`);
	return usd;
}

/** A text field, refused unread past {@link TEXT_SLACK} times what is kept of it. */
function textOf(v: unknown, field: string, cap: number): string {
	if (v === undefined || v === null) return '';
	if (typeof v !== 'string') return bad(`${field} is not text`);
	if (v.length > cap * TEXT_SLACK) bad(`${field} is far longer than the launcher keeps`);
	return v;
}

/** What is kept of each top-level text field. */
const FIELD_CAPS = {
	failure: TEXT_CAPS.summary,
	title: TEXT_CAPS.title,
	scope: TEXT_CAPS.scope,
	summary: TEXT_CAPS.summary,
	lesson: TEXT_CAPS.lesson,
} as const;

const optionalText = (body: Record<string, unknown>, key: keyof typeof FIELD_CAPS): string =>
	textOf(body[key], key, FIELD_CAPS[key]);

function parseResult(body: Record<string, unknown>): ParsedResult {
	const failure = optionalText(body, 'failure').trim() || null;
	const outcome = isFixRunOutcome(body.outcome) ? body.outcome : null;
	if (!outcome && body.outcome !== undefined) bad('outcome is not one the launcher knows');
	if (!outcome && !failure) bad('outcome is missing');
	const list = (key: string): unknown[] => {
		const v = body[key];
		if (v === undefined || v === null) return [];
		return Array.isArray(v) ? v : bad(`${key} is not a list`);
	};
	const gates = list('gates').map((g) => {
		if (!isRecord(g) || typeof g.command !== 'string' || typeof g.ok !== 'boolean') {
			return bad('gates has an entry that is not { command, ok }');
		}
		return { command: textOf(g.command, 'gate command', TEXT_CAPS.command), ok: g.ok };
	});
	if (gates.length > MAX_GATES) bad(`gates lists more than ${MAX_GATES}`);
	const files = list('files').map((f): FixRunFile => {
		if (!isRecord(f) || typeof f.path !== 'string') return bad('files has an entry with no path');
		if (f.content !== null && typeof f.content !== 'string') {
			return bad('files has an entry whose content is neither text nor null');
		}
		if (f.mode !== undefined && typeof f.mode !== 'string')
			bad('files has a mode that is not text');
		return { path: f.path, mode: f.mode as FixRunFile['mode'], content: f.content };
	});
	const second = body.secondBug;
	let secondBug: FixRunSecondBug | null = null;
	if (second !== undefined && second !== null) {
		if (
			!isRecord(second) ||
			typeof second.area !== 'string' ||
			typeof second.title !== 'string' ||
			typeof second.evidence !== 'string'
		) {
			bad('secondBug is not { area, title, evidence }');
		}
		const s = second as Record<string, string>;
		secondBug = {
			area: textOf(s.area, 'secondBug area', TEXT_CAPS.area),
			title: textOf(s.title, 'secondBug title', TEXT_CAPS.title),
			evidence: textOf(s.evidence, 'secondBug evidence', TEXT_CAPS.summary),
		};
	}
	const baseSha = body.baseSha;
	if (baseSha !== undefined && typeof baseSha !== 'string') bad('baseSha is not text');
	return {
		baseSha: typeof baseSha === 'string' ? baseSha : null,
		outcome,
		failure,
		title: optionalText(body, 'title'),
		scope: optionalText(body, 'scope'),
		summary: optionalText(body, 'summary'),
		lesson: optionalText(body, 'lesson'),
		gates,
		secondBug,
		files,
	};
}

// ── The result: GitHub ────────────────────────────────────────────────────────

/**
 * What one request works with on a claimed result: the GitHub App, how a write waits before it is
 * tried again, the claim it holds, and the commit it made (the one branch it may delete).
 */
interface Io {
	app: GithubApp;
	sleep: (ms: number) => Promise<void>;
	hold: Hold;
	made: string | null;
}

/** The claim a request holds on a run's result: its `result_at`, renewed one renewal at a time. */
interface Hold {
	runId: string;
	at: Date;
	renewing: Promise<void>;
}

/** Another request took the claim over (this one went quiet past the stale time) or the run
 *  ended: this request writes nothing more. */
class LeaseLost extends Error {
	constructor() {
		super("Another request took this fix run's result over, or the run has ended.");
		this.name = 'LeaseLost';
	}
}

/** Renew the claim, after any renewal still in flight; a claim lost stays lost. */
function renew(io: Io): Promise<void> {
	const { hold } = io;
	hold.renewing = hold.renewing.then(async () => {
		const at = await renewFixRunClaim(hold.runId, hold.at);
		if (!at) throw new LeaseLost();
		hold.at = at;
	});
	return hold.renewing;
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A write is tried again at most this often, on a 5xx, a network error, or a rate limit. */
const WRITE_RETRIES = 2;
/** A rate limit asking for a longer wait than this is not waited out. */
const RETRY_AFTER_MAX_S = 10;

/**
 * One GitHub write, tried up to {@link WRITE_RETRIES} more times when the answer may be passing: a
 * 5xx or a network error (after 1 s, then 2 s), or a 403 / 429 with a `retry-after` of at most
 * {@link RETRY_AFTER_MAX_S} seconds (after that wait). The Git Data writes are content-addressed and
 * a repeated ref or pull request is found again, so a write that did land before its answer was
 * lost costs nothing. The claim is renewed first: a request that lost it writes nothing.
 */
async function write(io: Io, path: string, init: RequestInit): Promise<Response> {
	await renew(io);
	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await io.app.fetch(path, init);
		} catch (err) {
			if (attempt >= WRITE_RETRIES) throw err;
			await io.sleep(1000 * 2 ** attempt);
			continue;
		}
		const after = Number(res.headers.get('retry-after') ?? NaN);
		const limited =
			(res.status === 403 || res.status === 429) &&
			Number.isFinite(after) &&
			after >= 0 &&
			after <= RETRY_AFTER_MAX_S;
		if (attempt >= WRITE_RETRIES || !(res.status >= 500 || limited)) return res;
		await io.sleep(limited ? after * 1000 : 1000 * 2 ** attempt);
	}
}

async function writeJson<T>(io: Io, path: string, body: unknown, doing: string): Promise<T> {
	const res = await write(io, path, { method: 'POST', body: JSON.stringify(body) });
	if (!res.ok) {
		throw new GithubAppError(`GitHub ${res.status} ${doing}: ${await messageOf(res)}`, res.status);
	}
	return (await res.json()) as T;
}

/** The run's base, read once as a whole tree; `truncated` when GitHub would not list it all. */
async function readBase(app: GithubApp, sha: string): Promise<BaseTree | 'truncated'> {
	const r = repo();
	const commit = await app.json<{ tree: { sha: string } }>(`/repos/${r}/git/commits/${sha}`);
	const tree = await app.json<{
		truncated?: boolean;
		tree: (BaseEntry & { path: string })[];
	}>(`/repos/${r}/git/trees/${commit.tree.sha}?recursive=1`);
	if (tree.truncated) return 'truncated';
	const entries = new Map(
		tree.tree.map((e) => [e.path, { mode: e.mode, type: e.type, sha: e.sha }] as const),
	);
	return {
		treeSha: commit.tree.sha,
		entries,
		async read(path: string): Promise<string> {
			const entry = entries.get(path);
			if (!entry) throw new GithubAppError('The base has no such file.');
			const blob = await app.json<{ content: string; encoding: string }>(
				`/repos/${r}/git/blobs/${entry.sha}`,
			);
			return Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8').toString(
				'utf8',
			);
		},
	};
}

/**
 * The branch, made on `sha`. A 422 may be an earlier try of this run's own (the same request
 * resent, or a claim taken over): that branch is reused when it holds this tree; a branch that
 * isn't there means the 422 was for something else, and GitHub's own sentence says what.
 */
async function makeBranch(io: Io, branch: string, sha: string, tree: string): Promise<void> {
	const r = repo();
	const made = await write(io, `/repos/${r}/git/refs`, {
		method: 'POST',
		body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
	});
	if (made.ok) return;
	const said = `GitHub ${made.status} creating the branch: ${await messageOf(made)}`;
	if (made.status !== 422) throw new GithubAppError(said, made.status);
	const ref = await io.app.fetch(`/repos/${r}/git/ref/heads/${branch}`);
	if (!ref.ok) throw new GithubAppError(said, 422);
	const head = ((await ref.json()) as { object: { sha: string } }).object.sha;
	const held = await io.app.json<{ tree: { sha: string } }>(`/repos/${r}/git/commits/${head}`);
	if (held.tree.sha !== tree) {
		throw new GithubAppError(`GitHub already has the branch ${branch} with another change.`);
	}
}

/** The draft pull request; one GitHub already has from the branch is that one. */
async function openPull(io: Io, branch: string, title: string, body: string): Promise<number> {
	const res = await write(io, `/repos/${repo()}/pulls`, {
		method: 'POST',
		body: JSON.stringify({ title, head: branch, base: 'main', body, draft: true }),
	});
	if (res.ok) return ((await res.json()) as { number: number }).number;
	const said = `GitHub ${res.status} opening the pull request: ${await messageOf(res)}`;
	if (res.status === 422) {
		const pr = await pullForBranch(io.app, branch);
		if (pr !== null) return pr;
	}
	throw new GithubAppError(said, res.status);
}

/**
 * Commit the change as the App on the run's base (a blob per written file → a tree on the base's
 * tree → a commit on `base_sha` → `bug-<n>-fix-<id>`) and open it as a draft into `main`: the
 * Agents tab's Git Data API path (ADR-0007), but on the commit the job checked out. Answers the PR.
 */
async function openFix(
	io: Io,
	run: BugFixRun,
	branch: string,
	base: BaseTree,
	files: { path: string; mode: '100644' | '100755'; content: string | null }[],
	pub: { title: string; message: string; body: string },
): Promise<number> {
	const r = repo();
	const written = files.filter((f): f is typeof f & { content: string } => f.content !== null);
	const blobs = await mapWithConcurrency(written, 4, (f) =>
		writeJson<{ sha: string }>(
			io,
			`/repos/${r}/git/blobs`,
			{ content: f.content, encoding: 'utf-8' },
			'storing a file',
		),
	);
	const blobOf = new Map(written.map((f, i) => [f.path, blobs[i].sha]));
	const tree = await writeJson<{ sha: string }>(
		io,
		`/repos/${r}/git/trees`,
		{
			base_tree: base.treeSha,
			tree: files.map((f) => ({
				path: f.path,
				mode: f.mode,
				type: 'blob',
				sha: f.content === null ? null : blobOf.get(f.path),
			})),
		},
		'making the tree',
	);
	const commit = await writeJson<{ sha: string }>(
		io,
		`/repos/${r}/git/commits`,
		{ message: pub.message, tree: tree.sha, parents: [run.baseSha] },
		'making the commit',
	);
	io.made = commit.sha;
	await makeBranch(io, branch, commit.sha, tree.sha);
	return openPull(io, branch, pub.title, pub.body);
}

// ── The result: how the run ends ──────────────────────────────────────────────

/** What a run that ends with its pull request says about itself. */
interface Done {
	outcome?: FixRunOutcome;
	summary?: string;
	secondBug?: FixRunSecondBug | null;
}

async function endOpened(
	io: Io,
	run: BugFixRun,
	pr: number,
	done: Done,
): Promise<BugFixRun | null> {
	const ended = await settleFixRun(
		run.id,
		{
			status: 'pr_opened',
			...done,
			prNumber: pr,
			branch: fixRunBranch(run.bugNumber, run.id),
		},
		fixRunActor(run.id),
		{ heldAt: io.hold.at },
	);
	// The pull request exists now: the next link sync and Changes list must read it.
	forgetBugSync();
	forgetChanges();
	return ended;
}

/**
 * Delete the branch this request made, when it is still as made: GitHub answered that no PR comes
 * from it, and it still points at this request's commit (an earlier try's branch, reused, or one
 * moved since, is not this request's to delete). Best-effort, but never past a lost claim.
 */
async function deleteStray(io: Io, branch: string, made: string): Promise<void> {
	const r = repo();
	try {
		const ref = await io.app.fetch(`/repos/${r}/git/ref/heads/${branch}`);
		if (!ref.ok) return;
		const head = ((await ref.json()) as { object?: { sha?: string } }).object?.sha;
		if (head !== made) return;
		await write(io, `/repos/${r}/git/refs/heads/${branch}`, { method: 'DELETE' });
	} catch (err) {
		if (err instanceof LeaseLost) throw err;
	}
}

/**
 * End a claimed run `failed` — unless GitHub has the run's pull request after all (this request,
 * or an earlier one whose claim it took over, opened it), which is then how it ended. When GitHub
 * answers that there is none, the branch this request made is deleted (it would only be a stray);
 * when GitHub can't say, nothing is.
 */
async function endFailed(
	io: Io,
	run: BugFixRun,
	reason: string,
	done: Done,
): Promise<BugFixRun | null> {
	const branch = fixRunBranch(run.bugNumber, run.id);
	const pr = await pullForBranch(io.app, branch).then(
		(n) => n,
		() => undefined,
	);
	if (typeof pr === 'number') return endOpened(io, run, pr, done);
	if (pr === null && io.made !== null) await deleteStray(io, branch, io.made);
	return settleFixRun(
		run.id,
		{ status: 'failed', reason: capReason(reason), summary: done.summary },
		fixRunActor(run.id),
		{ heldAt: io.hold.at, extra: done.summary ? { summary: done.summary } : {} },
	);
}

/** End a claimed run as its result says; see {@link acceptFixRunResult}. Never throws past here
 *  for what went wrong after the claim — that ends the run `failed` — but a claim lost: then the
 *  run is another request's to end. */
async function settleResult(io: Io, run: BugFixRun, r: ParsedResult): Promise<BugFixRun | null> {
	let text: FixRunText | null = null;
	try {
		if (r.failure !== null) {
			return await endFailed(io, run, FIX_RUN_REASONS.noResult, {
				summary: cleanText(r.failure, MAX_SUMMARY),
			});
		}
		text = cleanResult(r);
		return await settleChange(io, run, r, text);
	} catch (err) {
		if (err instanceof LeaseLost) throw err;
		console.error(
			`[fix runs] fix run ${run.id} failed after its result was claimed:`,
			capReason(err instanceof Error ? err.message : String(err)),
		);
		const reason = err instanceof GithubAppError ? err.message : FIX_RUN_REASONS.launcherFailed;
		return endFailed(io, run, reason, {
			outcome: r.outcome ?? undefined,
			summary: text?.summary,
			secondBug: text?.secondBug,
		});
	}
}

/** The names of the bug's project and client, folded; never the shared default ones. */
async function namesOf(projectKey: string | null): Promise<string[]> {
	if (!projectKey) return [];
	const found = await privateNamesOf(projectKey);
	const project = projectKey === DEFAULT_PROJECT_KEY ? [] : [projectKey, found.projectName];
	const client =
		found.clientKey === null || found.clientKey === UNASSIGNED_CLIENT
			? []
			: [found.clientKey, found.clientName];
	return privateNames([...project, ...client]);
}

async function settleChange(
	io: Io,
	run: BugFixRun,
	r: ParsedResult,
	text: FixRunText,
): Promise<BugFixRun | null> {
	const outcome = r.outcome as FixRunOutcome;
	const done: Done = { outcome, summary: text.summary, secondBug: text.secondBug };
	const noFix = (end: { outcome: FixRunOutcome; reason?: string }) =>
		settleFixRun(
			run.id,
			{ status: 'no_fix', ...end, summary: text.summary, secondBug: text.secondBug },
			fixRunActor(run.id),
			{ heldAt: io.hold.at, extra: text.summary ? { summary: text.summary } : {} },
		);
	if (outcome === 'not_reproduced' || outcome === 'needs_person') return noFix({ outcome });
	if (outcome === 'second_area' && !r.files.length) return noFix({ outcome });
	const full = await getBugFull(run.bugNumber);
	if (!full) return null;
	if (full.bug.status === 'resolved' || full.bug.status === 'wontFix') {
		return noFix({ outcome, reason: FIX_RUN_REASONS.bugClosed });
	}
	const number = full.bug.number;
	const branch = fixRunBranch(number, run.id);
	const scope = r.scope.trim().toLowerCase();
	const refused = (rule: string) => noFix({ outcome: 'needs_person', reason: refusedChange(rule) });
	const local = localProblem({
		baseSha: run.baseSha,
		number,
		branch,
		result: r,
		text,
		scope,
		names: await namesOf(full.bug.projectKey),
	});
	if (local) return refused(local);
	const base = await readBase(io.app, run.baseSha);
	await renew(io);
	if (base === 'truncated') return refused('the base tree is too large to check');
	const problem = await baseProblem(r.files, base);
	await renew(io);
	if (problem) return refused(problem);
	const pub = publication({
		number,
		runId: run.id,
		scope,
		text,
		person: cleanPerson(await accountName(run.startedById)),
		actionsUrl: run.ghRunId === null ? null : actionsRunUrl(run.ghRunId),
	});
	const leak = publicationProblem(pub);
	if (leak) return refused(leak);
	const pr = await openFix(io, run, branch, base, withModes(r.files, base), pub);
	return endOpened(io, run, pr, done);
}
