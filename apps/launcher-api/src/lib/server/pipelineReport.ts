import { readZipEntry } from './zip';
import type { GithubApp } from './githubApp';

/**
 * Check 2 of a pipeline change (ADR-0007): the current-games harness report, read from the
 * `current-games-report` artifact of the "Current games" run on the change's head
 * (`scripts/current-games/lib/report.mjs` writes it; `docs/playtest/current-games.md` reads it).
 *
 * The artifact is kept for 3 days (`.github/workflows/current-games.yml`). An expired or deleted one
 * is a STATE here, never an error: the change still lists, and the detail says the report is gone
 * and a new push brings a new one.
 */

/** The artifacts `current-games.yml` uploads from the report job: the report alone, and the full
 *  one with every changed screen's images. */
export const REPORT_JSON_ARTIFACT = 'current-games-report-json';
export const REPORT_ARTIFACT = 'current-games-report';
/** `report.json` is a few hundred KB for the live games; past this it is not the harness's. */
const MAX_REPORT_JSON_BYTES = 32 * 1024 * 1024;
/** The full artifact is read only for a run older than `current-games-report-json`, and only
 *  when it is small: it holds every changed screen's images and the launcher is memory-tight. */
const MAX_FULL_ARTIFACT_BYTES = 64 * 1024 * 1024;
/** A download of the full artifact may take a while; the body counts. */
const ARTIFACT_TIMEOUT_MS = 120_000;
/** Parsed reports kept in memory, by artifact id: a report never changes once uploaded. */
const REPORT_CACHE_SIZE = 32;

export interface HarnessScreen {
	screen: string;
	scenario: string;
	draw?: string;
	pass: boolean;
	/** `<head sha>:<game key>[@republished]:<screen>:<diff hash>`; set on a changed screen. */
	id?: string;
	reason?: string;
	identical?: boolean;
	measured?: { diffPixels: number; diffRatio: number; maxBlockRatio: number };
	images?: { before?: string; after?: string; diff?: string };
	tolerance?: unknown;
}

export interface HarnessRow {
	key: string;
	variant?: 'published' | 'republished';
	name: string;
	gameType?: string | null;
	projectKey?: string | null;
	hasOwnBuiltBundle?: boolean;
	build: { status: string; detail?: string };
	tests: { status: string; gates?: { gate: string; pass: boolean }[] };
	looks: { status: string; changed?: number; of?: number; detail?: string };
	screens: HarnessScreen[];
	notes?: string[];
}

export interface HarnessReport {
	head?: { sha?: string };
	base?: { sha?: string };
	seed?: string | number;
	viewport?: string;
	aborted?: string;
	games: HarnessRow[];
	summary: {
		verdict: 'pass' | 'fail';
		pass: number;
		fail: number;
		notRendered: number;
		rendered: number;
		changedScreens: string[];
		line: string;
	};
}

export type HarnessReportState =
	| {
			state: 'none' | 'running' | 'skipped' | 'missing' | 'expired' | 'stale' | 'unreadable';
			detail: string;
			expiresAt?: string;
	  }
	| { state: 'ready'; report: HarnessReport; artifactId: number; expiresAt: string | null };

/** One changed screen of the report, as an approval names it. */
export interface HarnessDiff {
	id: string;
	game: string;
	key: string;
	variant: 'published' | 'republished';
	screen: string;
	scenario: string;
	reason: string | null;
	images: HarnessScreen['images'] | null;
}

interface WorkflowRunLike {
	id: number;
	status: string | null;
	conclusion: string | null;
}

/** Jobs per page of the jobs API; a run has a few dozen. */
const JOBS_PAGE = 100;
const JOBS_MAX_PAGES = 10;

interface GhArtifact {
	id: number;
	name: string;
	expired: boolean;
	expires_at: string | null;
	size_in_bytes: number;
}

/** A row's key as the report writes it in every id: `<key>` or `<key>@republished`. */
export const rowKey = (row: HarnessRow): string =>
	row.variant === 'republished' ? `${row.key}@republished` : row.key;

/** pass / fail / `null` (not rendered — never a pass, never a failure), as `report.mjs` decides. */
export function rowVerdict(row: HarnessRow): 'pass' | 'fail' | null {
	if (row.build?.status === 'fail' || row.tests?.status === 'fail') return 'fail';
	if (row.looks.status === 'changed' || row.looks.status === 'error') return 'fail';
	if (row.looks.status === 'same') return 'pass';
	return null;
}

const reports = new Map<number, HarnessReport>();

/** The parsed `report.json` of an artifact, cached; throws when it cannot be read. */
async function readReport(
	app: GithubApp,
	repo: string,
	artifact: GhArtifact,
): Promise<HarnessReport> {
	const hit = reports.get(artifact.id);
	if (hit) return hit;
	// GitHub answers with a redirect to a signed blob-store URL, which `download` follows without
	// the token: the blob store refuses a bearer header beside its signed URL.
	const res = await app.download(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
		timeoutMs: ARTIFACT_TIMEOUT_MS,
	});
	if (!res.ok) throw new Error(`GitHub ${res.status} downloading the report artifact`);
	const zip = Buffer.from(await res.arrayBuffer());
	const json = readZipEntry(zip, 'report.json', MAX_REPORT_JSON_BYTES);
	if (!json) throw new Error('the artifact holds no report.json');
	const report = JSON.parse(json.toString('utf8')) as HarnessReport;
	if (!Array.isArray(report.games) || !report.summary?.line) {
		throw new Error('the report is not in the shape the harness writes');
	}
	if (reports.size >= REPORT_CACHE_SIZE) reports.delete(reports.keys().next().value as number);
	reports.set(artifact.id, report);
	return report;
}

/** The harness's own summary line, as `current-games.yml` posts it (140 characters at most). */
const HARNESS_LINE = /^\d+ pass · \d+ fail · /;

/**
 * The report of `run` for `headSha`, or why there is none. `run` is the "Current games" workflow
 * run on the head, `null` when none has started; `status` the `current-games` context on it.
 */
export async function loadHarnessReport(
	app: GithubApp,
	repo: string,
	run: WorkflowRunLike | null,
	headSha: string,
	status: { state: string; description: string | null } | null,
): Promise<HarnessReportState> {
	if (!run) return { state: 'none', detail: 'current-games has not started on this head.' };
	if (run.status !== 'completed') {
		return { state: 'running', detail: 'current-games is still running on this head.' };
	}
	const { artifacts } = await app.json<{ artifacts: GhArtifact[] }>(
		`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`,
	);
	const small = artifacts.find((a) => a.name === REPORT_JSON_ARTIFACT);
	const full = artifacts.find((a) => a.name === REPORT_ARTIFACT);
	const artifact = small ?? full;
	if (!artifact) {
		return run.conclusion === 'success'
			? {
					state: 'skipped',
					detail:
						'No report: this change cannot reach a game, so current-games passed without rendering one.',
				}
			: { state: 'missing', detail: 'The run made no report; see its log.' };
	}
	if (artifact.expired) {
		return {
			state: 'expired',
			detail: 'The report expired: GitHub keeps it for 3 days. A new push makes a new one.',
			expiresAt: artifact.expires_at ?? undefined,
		};
	}
	if (!small && artifact.size_in_bytes > MAX_FULL_ARTIFACT_BYTES) {
		return {
			state: 'unreadable',
			detail: `The run is older than the report-only artifact and its full report (${Math.round(artifact.size_in_bytes / 1_048_576)} MB of images) is too large to read. A new push makes a readable one.`,
		};
	}
	let report: HarnessReport;
	try {
		report = await readReport(app, repo, artifact);
	} catch (err) {
		return {
			state: 'unreadable',
			detail: `The report could not be read: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (report.head?.sha !== headSha) {
		return {
			state: 'stale',
			detail: report.head?.sha
				? `The report is for ${report.head.sha.slice(0, 7)}, not this head.`
				: 'The report names no head commit.',
		};
	}
	// A re-run whose upload failed leaves the previous attempt's report beside the new attempt's
	// status. The status description is the harness's summary line, so the two must agree when
	// the harness posted it (an approval's `success` reads differently and is left alone).
	if (
		status &&
		status.state !== 'success' &&
		HARNESS_LINE.test(status.description ?? '') &&
		status.description !== report.summary.line.slice(0, 139)
	) {
		return {
			state: 'stale',
			detail: `The report is from another attempt of this run: the status reads "${status.description}" but the report says "${report.summary.line}".`,
		};
	}
	return { state: 'ready', report, artifactId: artifact.id, expiresAt: artifact.expires_at };
}

interface GhJob {
	name: string;
	status: string;
	conclusion: string | null;
}

/**
 * A second witness before `success` is posted, read from the jobs API rather than the report, for
 * the run's attempt the report came from: every job of that attempt but `report` must have
 * succeeded — `report` alone fails on changed screens, and it is the report that an approval
 * answers. `null` when so; else why not.
 */
export async function harnessJobsBlocker(
	app: GithubApp,
	repo: string,
	runId: number,
	attempt: number,
): Promise<string | null> {
	const jobs: GhJob[] = [];
	for (let page = 1; page <= JOBS_MAX_PAGES; page++) {
		const batch = await app.json<{ jobs: GhJob[] }>(
			`/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${JOBS_PAGE}&page=${page}`,
		);
		jobs.push(...batch.jobs);
		if (batch.jobs.length < JOBS_PAGE) break;
	}
	const bad = jobs.filter(
		(j) => j.name !== 'report' && (j.status !== 'completed' || j.conclusion !== 'success'),
	);
	if (bad.length) {
		return `The run's ${bad.map((j) => `${j.name} (${j.conclusion ?? j.status})`).join(', ')} did not succeed, so its report cannot be approved.`;
	}
	if (!jobs.some((j) => /^render\b/.test(j.name))) return 'The run rendered nothing.';
	return null;
}

/** Every changed screen with an id — what an owner can approve. */
export function visibleDiffs(state: HarnessReportState): HarnessDiff[] {
	if (state.state !== 'ready') return [];
	return state.report.games.flatMap((row) =>
		row.screens
			.filter((s) => !s.pass && s.id)
			.map((s) => ({
				id: s.id as string,
				game: row.name,
				key: rowKey(row),
				variant: row.variant ?? 'published',
				screen: s.screen,
				scenario: s.scenario,
				reason: s.reason ?? null,
				images: s.images ?? null,
			})),
	);
}

/**
 * Whether approving every changed screen can make this run pass — `null` — or why it cannot: a
 * build or test failure, an error row or an aborted run is not a difference and cannot be approved
 * away (ADR-0004). The launcher posts `success` to `current-games` only when this is `null`.
 */
export function unapprovableReason(state: HarnessReportState, diffs: HarnessDiff[]): string | null {
	if (state.state !== 'ready') return state.detail;
	const { report } = state;
	if (report.aborted) return `The harness aborted: ${report.aborted}`;
	if (report.summary.verdict === 'pass')
		return 'current-games passed; there is nothing to approve.';
	if (!diffs.length) return 'No changed screen to approve.';
	const blockers = report.games
		.filter((row) => rowVerdict(row) === 'fail')
		.flatMap((row) => {
			const name = row.variant === 'republished' ? `${row.name} (as republished)` : row.name;
			const out: string[] = [];
			if (row.build?.status === 'fail') out.push(`${name}: the build failed`);
			if (row.tests?.status === 'fail') out.push(`${name}: its tests failed`);
			if (row.looks.status === 'error') out.push(`${name}: ${row.looks.detail ?? 'error'}`);
			return out;
		});
	return blockers.length ? `Not a difference an approval can clear — ${blockers.join('; ')}` : null;
}
