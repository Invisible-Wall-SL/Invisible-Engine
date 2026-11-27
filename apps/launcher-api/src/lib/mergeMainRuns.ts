/**
 * Resolve conflict (ADR-0015), the parts the page, the server and the fixtures share. A person who
 * holds `pipelineMerge` starts a merge run on a change that conflicts with `main`; the launcher
 * dispatches `merge-main.yml` with the run's id, the pull request and the two pinned SHAs (all
 * public), the job merges `main` into the head, applies the mechanical rules and, for what is left,
 * has Claude Code propose a resolution, and posts it with a GitHub OIDC token. Nothing reaches the
 * branch until a person accepts (§5). Here: the vocabularies, the names the launcher and the
 * workflow agree on (§10), the start refusals, the sentences a run ends with, the result's shape,
 * and what a page shows of a run. No Svelte, no server imports.
 */

export const MERGE_RUN_STATUSES = [
	'dispatched',
	'running',
	'proposed',
	'accepting',
	'accepted',
	'discarded',
	'stale',
	'needs_person',
	'no_proposal',
	'failed',
	'cancelled',
] as const;
export type MergeRunStatus = (typeof MERGE_RUN_STATUSES)[number];

/**
 * A run that holds its change: the job is working, a proposal waits for a person, or an Accept holds
 * the claim (`accepting`: taken in the database before any GitHub write, with a lease).
 */
export const LIVE_MERGE_RUN_STATUSES = [
	'dispatched',
	'running',
	'proposed',
	'accepting',
] as const satisfies readonly MergeRunStatus[];
/** A run whose job has not posted yet. */
export const WORKING_MERGE_RUN_STATUSES = [
	'dispatched',
	'running',
] as const satisfies readonly MergeRunStatus[];

export const isLiveMergeRun = (status: MergeRunStatus): boolean =>
	(LIVE_MERGE_RUN_STATUSES as readonly string[]).includes(status);
export const isWorkingMergeRun = (status: MergeRunStatus): boolean =>
	(WORKING_MERGE_RUN_STATUSES as readonly string[]).includes(status);

/**
 * An Accept holds its claim this long (the database's clock); after it a retry may take the run over,
 * the page offers Accept again and the backstop settles it from the branch's tip.
 */
export const MERGE_ACCEPT_LEASE_MS = 5 * 60_000;

export const MERGE_RUN_WORKFLOW = 'merge-main.yml';
export const MERGE_RUN_WORKFLOW_PATH = `.github/workflows/${MERGE_RUN_WORKFLOW}`;
/** The `bug-fix` environment holds the key; the job's token must come from it. */
export const MERGE_RUN_ENVIRONMENT = 'bug-fix';
export const MERGE_RUN_AUDIENCE = 'invisible-launcher-merge-main';
/** The `director_spend.agent` a merge run's spend is recorded under. */
export const MERGE_RUN_AGENT = 'merge-main';

/** A run's id: 10 lowercase hex characters (§10 `merge_run`). */
export const MERGE_RUN_ID = /^[0-9a-f]{10}$/;
export const SHA_40 = /^[0-9a-f]{40}$/;

/** The workflow's `run-name`, which binds an Actions run to its merge run. */
export const mergeRunName = (id: string): string => `Merge main ${id}`;
export const isMergeRunTitle = (title: string | undefined, id: string): boolean =>
	title === mergeRunName(id);
export const mergeRunSpendId = (id: string): string => `merge:${id}`;

// ── §10: what the job posts ───────────────────────────────────────────────────

export const MERGE_RUN_OUTCOMES = [
	'proposed',
	'needs_person',
	'harness_conflict',
	'protected_conflict',
	'too_large',
	'no_proposal',
] as const;
export type MergeRunOutcome = (typeof MERGE_RUN_OUTCOMES)[number];

export const isMergeRunOutcome = (v: unknown): v is MergeRunOutcome =>
	typeof v === 'string' && (MERGE_RUN_OUTCOMES as readonly string[]).includes(v);

export const MERGE_CHOICES = ['main', 'change', 'both', 'combined'] as const;
export type MergeChoice = (typeof MERGE_CHOICES)[number];
export const MERGE_RULES = ['runtime-bytes', 'vendored-bundle', 'docs-append', 'ratchet'] as const;
export type MergeRule = (typeof MERGE_RULES)[number];
export const MERGE_MODES = ['100644', '100755'] as const;
export type MergeMode = (typeof MERGE_MODES)[number];
export const MERGE_HUNK_KINDS = ['lines', 'description'] as const;
export const MERGE_TAKES = ['main', 'change', 'both', 'combined'] as const;
export type MergeTakes = (typeof MERGE_TAKES)[number];

export interface MergeRunFile {
	path: string;
	choice: MergeChoice;
	rule: MergeRule | null;
	/** UTF-8 text; null is a deletion. */
	content: string | null;
	mode: MergeMode;
}

export interface MergeRunHunk {
	path: string;
	index: number;
	main: string;
	change: string;
	takes: MergeTakes;
	why: string;
	nowDoes: string | null;
	otherwise: string | null;
	/**
	 * `lines`: `main` and `change` are real lines and `result` is where the job found them in the
	 * final file, or null when it could not. `description`: a rule's or a modify/delete hunk, whose
	 * `main` and `change` are words and whose result follows what it took.
	 */
	kind: 'lines' | 'description';
	/**
	 * What the resolved file holds where this hunk was: from git and the final file, never the
	 * model's. Null for a rule's or a modify/delete hunk, whose `main` and `change` are descriptions,
	 * and when the place could not be found.
	 */
	result: string | null;
	/**
	 * How many lines of the result (the one cut included) are not in `result`: it is capped, and
	 * Accept pushes the whole file. 0 when nothing was cut.
	 */
	resultCut: number;
}

export interface MergeRunExplanation {
	conflicted: { path: string; met: { pr: number | null; title: string }[] }[];
	hunks: MergeRunHunk[];
	outside: { path: string; what: string }[];
	checks: { command: string; ok: boolean }[];
	risks: string;
}

/** The caps of §10. */
export const MERGE_CAPS = {
	/** Files for the model, plus the regenerated ones (a rule's, counted apart). */
	modelFiles: 10,
	file: 2 * 1024 * 1024,
	total: 4 * 1024 * 1024,
	text: 3_000,
	explanation: 16_000,
	/** One hunk's `main`, `change` or `result` (the real lines, outside `explanation`'s prose cap). */
	lines: 10_000,
	/** Those lines over every hunk of a proposal. */
	linesTotal: 120_000,
	reason: 300,
	path: 300,
	hunks: 200,
	files: 200,
	/** What a result body may unpack to (the job gzips above 400 KB and sends at most this much). */
	body: 8 * 1024 * 1024,
} as const;

// ── Start ─────────────────────────────────────────────────────────────────────

export type MergeRunRefusal =
	| 'not_open'
	| 'not_conflicted'
	| 'on_hold'
	| 'merge_run_live'
	| 'workflow_not_live'
	| 'branch_unsafe'
	| 'request_id_reused';

export interface StartFacts {
	open: boolean;
	onHold: boolean;
	/** GitHub's `mergeable_state` is `dirty`. */
	conflicted: boolean;
	liveRun: string | null;
	workflowLive: boolean;
	/** The head branch is a name the pipeline pushes to (`isPlainBranchName`). */
	plainBranch: boolean;
}

/** The first refusal a start meets, in ADR-0015 §4's order; null lets it in. */
export function startRefusal(f: StartFacts): MergeRunRefusal | null {
	if (!f.workflowLive) return 'workflow_not_live';
	if (!f.open) return 'not_open';
	if (!f.conflicted) return 'not_conflicted';
	if (f.onHold) return 'on_hold';
	if (!f.plainBranch) return 'branch_unsafe';
	if (f.liveRun !== null) return 'merge_run_live';
	return null;
}

export const UNSAFE_BRANCH_TEXT =
	'This branch has a name the pipeline will not push to (only letters, digits, - _ . and / are allowed): update it on GitHub or by hand.';

export function refusalMessage(
	code: MergeRunRefusal,
	number: number,
	liveRun: string | null,
): string {
	switch (code) {
		case 'workflow_not_live':
			return 'Resolve conflict is not available yet: GitHub has no active merge-main.yml on main.';
		case 'not_open':
			return `#${number} is not open.`;
		case 'on_hold':
			return `#${number} is on hold: resume it first.`;
		case 'merge_run_live':
			return `A merge run${liveRun ? ` (${liveRun})` : ''} is already live on #${number}.`;
		case 'not_conflicted':
			return `#${number} does not conflict with main. Use Update from main instead.`;
		case 'branch_unsafe':
			return UNSAFE_BRANCH_TEXT;
		case 'request_id_reused':
			return 'That request already started another merge run.';
	}
}

// ── How a run ends ────────────────────────────────────────────────────────────

/** The launcher's own sentences for a run's end (`merge_main_runs.reason`). */
export const MERGE_RUN_REASONS = {
	actionsWrite: 'The GitHub App needs Actions: Read and write (docs/INFRA.md).',
	noWorkflow: 'GitHub has no .github/workflows/merge-main.yml on main for the App to run.',
	noResult: 'The run ended without a result.',
	didNotStart: 'The Actions run did not start.',
	endedWithoutResult: 'The Actions run ended without a result.',
	cancelledOnGithub: 'The Actions run was cancelled.',
	goneOnGithub: 'GitHub no longer has the Actions run.',
	timedOut: 'The run timed out.',
	notExplained: 'The run did not explain its resolution.',
	linesTooLong: 'The conflicting lines are too long to show for a person to read.',
	budgetSpent:
		"This month's fix-run budget is spent, so only the mechanical part could be kept; resolve the rest by hand.",
	headMoved: 'The branch moved; resolve again.',
	otherBase: 'main and this change were merged against another base; resolve again',
	mainMoved: 'main changed a conflicted file since this run; resolve again.',
} as const;

export const capMergeReason = (text: string): string => {
	const points = Array.from(text);
	return points.length > MERGE_CAPS.reason
		? `${points.slice(0, MERGE_CAPS.reason - 1).join('')}…`
		: text;
};

/** The most a merge run is dispatched with: the job refuses a `budget_usd` above it. */
export const MAX_DISPATCH_USD = 100;

/**
 * The `budget_usd` a run is dispatched with (ADR-0015 §10): the smaller of the run's cap, what is
 * left of the month's ceiling and $100, to two places, as a decimal string; "0" once the month is
 * spent.
 */
export function dispatchBudget(capUsd: number, monthlyUsd: number, spentUsd: number): string {
	const cents = Math.floor(Math.min(capUsd, monthlyUsd - spentUsd, MAX_DISPATCH_USD) * 100 + 1e-9);
	return cents > 0 ? (cents / 100).toFixed(2) : '0';
}

/** The sentence for a job-side refusal that carries only the outcome. */
export const OUTCOME_REASONS: Record<Exclude<MergeRunOutcome, 'proposed'>, string> = {
	needs_person: 'This conflict needs a person.',
	harness_conflict:
		"The conflict is in the harness (.github/workflows or scripts/current-games): it needs the owner's hand merge.",
	protected_conflict: 'The conflict is in a protected path, which a run never resolves.',
	too_large: 'Too many files or lines are left to resolve in one run.',
	no_proposal: 'The run did not explain its resolution.',
};

// ── What a page shows ─────────────────────────────────────────────────────────

/** The fields of a stored run a page's view is made from. */
export interface MergeRunRecord {
	id: string;
	prNumber: number;
	branch: string;
	headSha: string;
	mainSha: string;
	status: MergeRunStatus;
	reason: string | null;
	files: MergeRunFile[] | null;
	explanation: MergeRunExplanation | null;
	mergeSha: string | null;
	spendUsd: number | null;
	ghRunId: number | null;
	acceptingAt: Date | null;
	startedBy: string;
	acceptedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
	finishedAt: Date | null;
}

/**
 * What follows Accept for a file a build rule left as `main`'s, pending (ADR-0015 §3): the job never
 * builds branch code, so a person or CI does. Null for a file with no such follow-up.
 */
export function afterAcceptText(file: Pick<MergeRunFile, 'path' | 'rule'>): string | null {
	if (file.rule === 'runtime-bytes') {
		return "After Accept, CI's runtime-bytes check fails; click Re-record runtime bytes on the change.";
	}
	if (file.rule === 'vendored-bundle') {
		const name = file.path.split('/').at(-1)?.replace(/\.js$/, '') ?? '';
		return `After Accept, rebuild with pnpm --filter launcher-api build:${name} in the change's session.`;
	}
	if (file.rule === 'ratchet') {
		return "After Accept, lower the baseline in the change's session if check:svelte or lint fails.";
	}
	return null;
}

export interface MergeRunFileView {
	path: string;
	choice: MergeChoice;
	rule: MergeRule | null;
	deleted: boolean;
	bytes: number;
}

/** One merge run as the change's detail shows it. The run's words are text, never HTML. */
export interface MergeRunView {
	id: string;
	prNumber: number;
	branch: string;
	status: MergeRunStatus;
	reason: string | null;
	headSha: string;
	mainSha: string;
	files: MergeRunFileView[];
	explanation: MergeRunExplanation | null;
	mergeSha: string | null;
	spendUsd: number | null;
	/** When an Accept took its claim (`accepting`), by the database's clock; else null. */
	acceptingAt: string | null;
	/** The claim's lease has run out, by the DATABASE's clock (the server says so; the page's is not used). */
	acceptLapsed: boolean;
	actionsUrl: string | null;
	startedBy: string;
	acceptedBy: string | null;
	createdAt: string;
	updatedAt: string;
	finishedAt: string | null;
}

/**
 * The explanation as a page gets it. The real lines of a hunk (`main`, `change`, `result`) are only
 * for the proposal waiting for Accept or Discard: every other card needs the words, not the code.
 */
function proposalOnly(run: MergeRunRecord): MergeRunExplanation | null {
	const e = run.explanation;
	if (!e || run.status === 'proposed' || run.status === 'accepting') return e;
	return {
		...e,
		hunks: e.hunks.map((h) => ({ ...h, main: '', change: '', result: null, resultCut: 0 })),
	};
}

export function mergeRunView(
	run: MergeRunRecord,
	repo: string,
	acceptLapsed = false,
): MergeRunView {
	return {
		id: run.id,
		prNumber: run.prNumber,
		branch: run.branch,
		status: run.status,
		reason: run.reason,
		headSha: run.headSha,
		mainSha: run.mainSha,
		files: (run.files ?? []).map((f) => ({
			path: f.path,
			choice: f.choice,
			rule: f.rule,
			deleted: f.content === null,
			bytes: f.content === null ? 0 : new TextEncoder().encode(f.content).length,
		})),
		explanation: proposalOnly(run),
		mergeSha: run.mergeSha,
		spendUsd: run.spendUsd,
		acceptingAt: run.acceptingAt?.toISOString() ?? null,
		acceptLapsed,
		actionsUrl:
			run.ghRunId === null ? null : `https://github.com/${repo}/actions/runs/${run.ghRunId}`,
		startedBy: run.startedBy,
		acceptedBy: run.acceptedBy,
		createdAt: run.createdAt.toISOString(),
		updatedAt: run.updatedAt.toISOString(),
		finishedAt: run.finishedAt?.toISOString() ?? null,
	};
}

/** What `GET /api/pipeline/changes/<n>/merge-runs` answers the page. */
export interface MergeRunsAnswer {
	/** GitHub has an active `merge-main.yml`: until then the page shows no Resolve button. */
	ready: boolean;
	/** The newest run of the change, whatever its state; null when it has none. */
	run: MergeRunView | null;
	/** The newest accepted run, for the "Main merged in" card. */
	accepted: MergeRunView | null;
	/** How many commits `main` has beyond the run's `main_sha`; null when GitHub did not say. */
	behindNow: number | null;
	/** When the branch's head commit was made; the card warns on one pushed in the last hour. */
	headCommittedAt: string | null;
}
