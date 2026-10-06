import {
	EVAL_REPORT_ARTIFACT,
	EVAL_STATUS_CONTEXT,
	evalPasses,
	parseEvalReport,
	type EvalReport,
} from '../../../../../services/director-worker/src/eval/report';
import { GithubAppError, type GithubApp } from './githubApp';
import { readBounded } from './pipelineReport';
import { readZipEntry } from './zip';

/**
 * The extra check of an agent-definition change (ADR-0007 "Agents tab"; PLAN 5.4): the
 * `agent-eval` commit status `.github/workflows/agent-eval.yml` posts on the PR head, and the
 * report it uploads as the `agent-eval-report` artifact (`report.json`, the shape
 * `services/director-worker/src/eval/report.ts` defines and the workflow writes from MAIN's code).
 *
 * The workflow runs on `pull_request_target`, whose run GitHub attributes to the base branch's
 * commit rather than the PR head, so the head's own workflow-run listing is not where to look:
 * the run is found through the status's own `target_url` (the run the workflow posted), and then
 * checked to be the eval workflow's, from this repository, with a report naming this head —
 * a status anyone with `statuses: write` could post points at nothing the launcher trusts
 * unless the run and the report agree with it.
 */

export const EVAL_WORKFLOW_PATH = '.github/workflows/agent-eval.yml';
/** The event the workflow runs on; its workflow file and code come from `main`. */
const EVAL_RUN_EVENT = 'pull_request_target';
/** A `pull_request_target` run's `head_branch` is the PR's BASE: only `main`'s workflow counts. */
const EVAL_RUN_BRANCH = 'main';
/** A report is a few KB; past this it is not the workflow's. */
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const ARTIFACT_TIMEOUT_MS = 30_000;
const REPORT_CACHE_SIZE = 64;
/** The one file an agent-definition change edits. */
export const AGENT_FILE = /^services\/director-worker\/agents\/([a-z][a-z-]*)\.md$/;

export type { EvalReport };

export interface EvalStatus {
	state: string;
	description: string | null;
	url: string | null;
	updatedAt: string;
}

export type AgentEvalReportState =
	| {
			state: 'none' | 'running' | 'missing' | 'expired' | 'stale' | 'unreadable';
			detail: string;
			expiresAt?: string;
	  }
	| { state: 'ready'; report: EvalReport; artifactId: number; expiresAt: string | null };

export interface AgentEvalCheck {
	status: EvalStatus | null;
	run: { id: number; url: string; status: string | null; conclusion: string | null } | null;
	report: AgentEvalReportState;
	/** The agent the change edits (exactly one definition file, not removed), else null. */
	agent: string | null;
	/** Why the eval blocks the merge (failed, capped, invalid, not one definition), else null. */
	blocking: string | null;
}

interface GhArtifact {
	id: number;
	name: string;
	expired: boolean;
	expires_at: string | null;
	size_in_bytes: number;
}

interface GhRun {
	id: number;
	path: string;
	event: string;
	head_branch: string | null;
	status: string | null;
	conclusion: string | null;
	html_url: string;
	repository: { full_name: string } | null;
}

/**
 * The agent a change edits: exactly one file, an agent definition, not a removal — the same rule
 * the workflow applies before it spends anything. Anything else is `null`.
 */
export function agentOfFiles(
	files: { path: string; previousPath: string | null; status: string }[],
): string | null {
	if (files.length !== 1) return null;
	const [file] = files;
	if (file.status === 'removed' || file.previousPath) return null;
	return AGENT_FILE.exec(file.path)?.[1] ?? null;
}

/** The run id a status's `target_url` names, when it is a run page of this repository. */
export function runIdOfStatusUrl(url: string | null, repo: string): number | null {
	if (!url) return null;
	const m = new RegExp(
		`^https://github\\.com/${repo.replace(/[.]/g, '\\.')}/actions/runs/(\\d+)`,
	).exec(url);
	return m ? Number(m[1]) : null;
}

const reports = new Map<number, EvalReport>();

async function readReport(app: GithubApp, repo: string, artifact: GhArtifact): Promise<EvalReport> {
	const hit = reports.get(artifact.id);
	if (hit) return hit;
	if (artifact.size_in_bytes > MAX_REPORT_BYTES) {
		throw new Error('the artifact is larger than a report');
	}
	const res = await app.download(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
		timeoutMs: ARTIFACT_TIMEOUT_MS,
	});
	if (!res.ok) throw new Error(`GitHub ${res.status} downloading the report artifact`);
	const zip = await readBounded(res, MAX_REPORT_BYTES);
	const json = readZipEntry(zip, 'report.json', MAX_REPORT_BYTES);
	if (!json) throw new Error('the artifact holds no report.json');
	const report = parseEvalReport(JSON.parse(json.toString('utf8')));
	if (reports.size >= REPORT_CACHE_SIZE) reports.delete(reports.keys().next().value as number);
	reports.set(artifact.id, report);
	return report;
}

/**
 * The check when GitHub could not be asked about the eval at all (the change's files, the run's
 * artifacts): the report is unreadable, so the verdict fails closed, and the rest of the Changes
 * list is not held up by one change's bad answer.
 */
export function unreadableAgentEval(
	statuses: {
		context: string;
		state: string;
		description: string | null;
		target_url: string | null;
		updated_at: string;
	}[],
	detail: string,
): AgentEvalCheck {
	const s = statuses.find((x) => x.context === EVAL_STATUS_CONTEXT) ?? null;
	const status: EvalStatus | null = s && {
		state: s.state,
		description: s.description,
		url: s.target_url,
		updatedAt: s.updated_at,
	};
	const report: AgentEvalReportState = { state: 'unreadable', detail };
	return { status, run: null, report, agent: null, blocking: unreadableReason(report) };
}

/** A GitHub error's sentence, or the error's; never a credential (`GithubAppError` carries none). */
export const githubErrorText = (err: unknown): string =>
	err instanceof GithubAppError || err instanceof Error ? err.message : String(err);

/**
 * The eval of an agent-definition change on `headSha`. `statuses` are the head's commit statuses,
 * `files` the change's files (what decides the agent). Never throws for a state of the eval: an
 * absent, running, expired or foreign report is a state the page shows, and a GitHub answer that
 * fails on the way is the `unreadable` state rather than an error.
 */
export async function loadAgentEval(
	app: GithubApp,
	repo: string,
	headSha: string,
	statuses: {
		context: string;
		state: string;
		description: string | null;
		target_url: string | null;
		updated_at: string;
	}[],
	files: { path: string; previousPath: string | null; status: string }[],
): Promise<AgentEvalCheck> {
	const agent = agentOfFiles(files);
	const s = statuses.find((x) => x.context === EVAL_STATUS_CONTEXT) ?? null;
	const status: EvalStatus | null = s && {
		state: s.state,
		description: s.description,
		url: s.target_url,
		updatedAt: s.updated_at,
	};
	const check = (run: AgentEvalCheck['run'], report: AgentEvalReportState): AgentEvalCheck => ({
		status,
		run,
		report,
		agent,
		blocking: blockingOf(agent, files, status, report),
	});

	if (!status)
		return check(null, { state: 'none', detail: 'agent-eval has not reported on this head.' });
	const runId = runIdOfStatusUrl(status.url, repo);
	if (runId === null) {
		return check(null, {
			state: 'unreadable',
			detail:
				'The agent-eval status names no run of this repository, so its report cannot be read.',
		});
	}
	const res = await app.fetch(`/repos/${repo}/actions/runs/${runId}`);
	if (res.status === 404) {
		return check(null, {
			state: 'missing',
			detail: 'The run the agent-eval status names is gone.',
		});
	}
	if (!res.ok) {
		return check(null, {
			state: 'unreadable',
			detail: `GitHub ${res.status} reading the eval run.`,
		});
	}
	const ghRun = (await res.json()) as GhRun;
	const run: AgentEvalCheck['run'] = {
		id: ghRun.id,
		url: ghRun.html_url,
		status: ghRun.status,
		conclusion: ghRun.conclusion,
	};
	if (
		ghRun.path !== EVAL_WORKFLOW_PATH ||
		ghRun.event !== EVAL_RUN_EVENT ||
		ghRun.head_branch !== EVAL_RUN_BRANCH ||
		ghRun.repository?.full_name !== repo
	) {
		return check(run, {
			state: 'unreadable',
			detail: `The run the agent-eval status names is not the eval workflow of this repository on ${EVAL_RUN_BRANCH}.`,
		});
	}
	if (ghRun.status !== 'completed') {
		return check(run, { state: 'running', detail: 'agent-eval is still running on this head.' });
	}
	let artifacts: GhArtifact[];
	try {
		artifacts = (
			await app.json<{ artifacts: GhArtifact[] }>(
				`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
			)
		).artifacts;
	} catch (err) {
		return check(run, {
			state: 'unreadable',
			detail: `The run's artifacts could not be listed: ${githubErrorText(err)}`,
		});
	}
	const artifact = artifacts.find((a) => a.name === EVAL_REPORT_ARTIFACT);
	if (!artifact)
		return check(run, { state: 'missing', detail: 'The run made no report; see its log.' });
	if (artifact.expired) {
		return check(run, {
			state: 'expired',
			detail: 'The report expired. A new push makes a new one.',
			expiresAt: artifact.expires_at ?? undefined,
		});
	}
	let report: EvalReport;
	try {
		report = await readReport(app, repo, artifact);
	} catch (err) {
		return check(run, {
			state: 'unreadable',
			detail: `The report could not be read: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	if (report.head.sha !== headSha) {
		return check(run, {
			state: 'stale',
			detail: `The report is for ${report.head.sha.slice(0, 7)}, not this head.`,
		});
	}
	if (agent !== null && report.agent !== agent) {
		return check(run, {
			state: 'stale',
			detail: `The report is for ${report.agent}, not ${agent}.`,
		});
	}
	return check(run, {
		state: 'ready',
		report,
		artifactId: artifact.id,
		expiresAt: artifact.expires_at,
	});
}

/**
 * Why the eval blocks the merge (ADR-0007: a failed or capped eval blocks an agent-definition
 * change). Fail closed: the status is anyone's to post, so only a report the launcher read and
 * verified clears a change — a report that is missing, expired, for another head or unreadable
 * blocks it, whatever the status says. Not yet reported, or still running, is pending, not
 * blocked (`evalVerdict`).
 */
function blockingOf(
	agent: string | null,
	files: { path: string }[],
	status: EvalStatus | null,
	report: AgentEvalReportState,
): string | null {
	if (agent === null) {
		return `This change carries the agent-definition label but does not edit exactly one agent definition (${files.length} file${files.length === 1 ? '' : 's'}): remove the label or split the change.`;
	}
	if (report.state === 'ready') {
		return evalPasses(report.report.result) ? null : report.report.line;
	}
	if (status && (status.state === 'failure' || status.state === 'error')) {
		return status.description ?? 'agent-eval failed';
	}
	if (report.state === 'none' || report.state === 'running') return null;
	return unreadableReason(report);
}

const unreadableReason = (report: { detail: string }): string =>
	`No report the launcher can read backs the agent-eval status: ${report.detail}`;

export type EvalVerdict = 'pass' | 'pending' | 'fail';

/** What the eval says about merging: passed on a verified report, blocked, or not in yet. */
export function evalVerdict(check: AgentEvalCheck): EvalVerdict {
	if (check.blocking !== null) return 'fail';
	if (check.report.state === 'ready') return 'pass';
	return 'pending';
}
