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

/** The artifact `current-games.yml` uploads from the report job. */
export const REPORT_ARTIFACT = 'current-games-report';
/** The report is a JSON file plus the changed screens' images; past this it is not an artifact
 *  of ours. */
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
/** Artifact zips kept in memory, by artifact id: a report never changes once uploaded. */
const ZIP_CACHE_SIZE = 8;

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

const zips = new Map<number, Buffer>();

/** The artifact's bytes, cached; `null` once it is gone from GitHub. */
async function artifactZip(app: GithubApp, repo: string, artifact: GhArtifact): Promise<Buffer> {
	const hit = zips.get(artifact.id);
	if (hit) return hit;
	const res = await app.fetch(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`);
	if (!res.ok) throw new Error(`GitHub ${res.status} downloading the report artifact`);
	const zip = Buffer.from(await res.arrayBuffer());
	if (zips.size >= ZIP_CACHE_SIZE) zips.delete(zips.keys().next().value as number);
	zips.set(artifact.id, zip);
	return zip;
}

/**
 * The report of `run` for `headSha`, or why there is none. `run` is the "Current games" workflow
 * run on the head, `null` when none has started.
 */
export async function loadHarnessReport(
	app: GithubApp,
	repo: string,
	run: WorkflowRunLike | null,
	headSha: string,
): Promise<HarnessReportState> {
	if (!run) return { state: 'none', detail: 'current-games has not started on this head.' };
	if (run.status !== 'completed') {
		return { state: 'running', detail: 'current-games is still running on this head.' };
	}
	const { artifacts } = await app.json<{ artifacts: GhArtifact[] }>(
		`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`,
	);
	const artifact = artifacts.find((a) => a.name === REPORT_ARTIFACT);
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
	if (artifact.size_in_bytes > MAX_ARTIFACT_BYTES) {
		return { state: 'unreadable', detail: 'The report artifact is too large to read.' };
	}
	let report: HarnessReport;
	try {
		const json = readZipEntry(await artifactZip(app, repo, artifact), 'report.json');
		if (!json) return { state: 'unreadable', detail: 'The artifact holds no report.json.' };
		report = JSON.parse(json.toString('utf8')) as HarnessReport;
	} catch (err) {
		return {
			state: 'unreadable',
			detail: `The report could not be read: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (!Array.isArray(report.games) || !report.summary) {
		return { state: 'unreadable', detail: 'The report is not in the shape the harness writes.' };
	}
	if (report.head?.sha && report.head.sha !== headSha) {
		return {
			state: 'stale',
			detail: `The report is for ${report.head.sha.slice(0, 7)}, not this head.`,
		};
	}
	return { state: 'ready', report, artifactId: artifact.id, expiresAt: artifact.expires_at };
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
