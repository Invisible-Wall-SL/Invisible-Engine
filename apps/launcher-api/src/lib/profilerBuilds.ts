/**
 * Invisible Profiler build records (`docs/design/invisible-profiler.md` §2, step P2): the summary a
 * desktop build's `build-breakdown.json` (`scripts/build-breakdown.mjs`) is reduced to for its
 * `perf_builds` row, the diff with the build before it, and which readings were taken on it. Pure:
 * `scripts/check-profiler.ts` runs it on plain JSON, and the page uses the same functions.
 */

import { PERF_RETENTION_MS, type PerfReportListItem } from './profiler';

/** The `depends` key of `/profiler`'s build list. */
export const PROFILER_BUILDS = 'profiler:builds';

export type PerfBuildKind = 'publish' | 'delivery';

export interface PerfBuildCategory {
	id: string;
	label: string;
	files: number;
	bytes: number;
}

export interface PerfBuildIssues {
	error: number;
	warn: number;
	info: number;
}

/** What a breakdown says about its build — the `perf_builds` columns. */
export interface PerfBuildSummary {
	build: string;
	kind: PerfBuildKind;
	profile: string | null;
	debug: boolean;
	optimize: boolean;
	builtAt: string | null;
	engineSha: string | null;
	gameSha: string | null;
	launcherVersion: string | null;
	breakdownVersion: number;
	files: number;
	shippedBytes: number;
	codeBytes: number;
	gpuBytes: number;
	removedBytes: number;
	unreferencedBytes: number;
	duplicateBytes: number;
	categories: PerfBuildCategory[];
	issues: PerfBuildIssues;
}

export type BuildSummaryResult =
	{ ok: true; summary: PerfBuildSummary } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 120): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const bytes = (v: unknown): number =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;

/** A build number as the launcher writes it: digits, or a dated folder name for an unnumbered one. */
const BUILD_RE = /^[0-9A-Za-z._-]{1,40}$/;

/**
 * Reads a `build-breakdown.json` into its row. Refuses anything that is not a breakdown, or one
 * with no build number (`build-info.json` missing — the reading join needs it), with a sentence.
 * Any breakdown version is read: its fields are read one by one, so a newer one with more fields
 * still lands, and one that drops a field reads it as 0.
 */
export function summarizeBuildBreakdown(json: unknown): BuildSummaryResult {
	if (!isObj(json) || !isObj(json.totals) || !Array.isArray(json.categories)) {
		return { ok: false, error: 'Not a build breakdown (build-breakdown.json).' };
	}
	const version = json.version;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		return { ok: false, error: 'The breakdown has no version.' };
	}
	const build = isObj(json.build) ? json.build : {};
	const number = str(build.version, 40);
	if (!number || !BUILD_RE.test(number)) {
		return { ok: false, error: 'The breakdown names no build number (no build-info.json).' };
	}
	const t = json.totals;
	// Merged by id: the page keys its rows on it, so a repeated or missing id must be one row.
	const byId = new Map<string, PerfBuildCategory>();
	for (const c of json.categories.filter(isObj)) {
		const id = str(c.id, 40) ?? 'other';
		const prior = byId.get(id);
		byId.set(id, {
			id,
			label: prior?.label ?? str(c.label, 60) ?? id,
			files: (prior?.files ?? 0) + bytes(c.files),
			bytes: (prior?.bytes ?? 0) + bytes(c.bytes),
		});
	}
	const categories = [...byId.values()].slice(0, 30);
	const issues: PerfBuildIssues = { error: 0, warn: 0, info: 0 };
	for (const issue of Array.isArray(json.issues) ? json.issues : []) {
		const level = isObj(issue) ? issue.level : null;
		if (level === 'error' || level === 'warn' || level === 'info') issues[level]++;
	}
	return {
		ok: true,
		summary: {
			build: number,
			kind: build.kind === 'delivery' ? 'delivery' : 'publish',
			profile: str(build.profile, 60),
			debug: build.debug === true,
			optimize: build.optimize === true,
			builtAt: str(build.builtAt, 40),
			engineSha: str(build.engineSha, 60),
			gameSha: str(build.gameSha, 60),
			launcherVersion: str(build.launcherVersion, 20),
			breakdownVersion: version,
			files: bytes(t.files),
			shippedBytes: bytes(t.bytes),
			codeBytes: bytes(t.codeBytes),
			gpuBytes: bytes(t.gpuBytes),
			removedBytes: bytes(t.removedBytes),
			unreferencedBytes: bytes(t.unreferencedBytes),
			duplicateBytes: bytes(t.duplicateBytes),
			categories,
			issues,
		},
	};
}

/**
 * Why a build may not be recorded under this game key, or null when it may. A ☁ Publish registers
 * its game card in the project BEFORE it sends the record, so its key must be one of the project's
 * games. A 📦 Deliver registers no card, so its key may also be one no game holds yet (a game only
 * ever delivered) — never another project's. Without this, any key would open a new line whose
 * newest build the purge never takes.
 */
export function gameKeyRefusal(
	kind: PerfBuildKind,
	ownerProject: string | null | undefined,
	projectKey: string,
): string | null {
	if (ownerProject === projectKey) return null;
	if (ownerProject) return 'This game belongs to another project.';
	if (kind === 'delivery' && ownerProject === undefined) return null;
	return 'No game of this project has this key — publish registers it first.';
}

/** The row the Builds tab lists. */
export interface PerfBuildListItem extends PerfBuildSummary {
	id: string;
	gameKey: string;
	registeredAt: string;
	keep: boolean;
	/** Null while kept, or while it is the newest of its game and kind (never purged then). */
	expiresAt: string | null;
}

/** Where a build is in its line: the same game key and kind, newest first. */
const sameLine = (a: PerfBuildListItem, b: PerfBuildListItem) =>
	a.gameKey === b.gameKey && a.kind === b.kind;

const newerFirst = (a: PerfBuildListItem, b: PerfBuildListItem) =>
	b.registeredAt.localeCompare(a.registeredAt) || b.id.localeCompare(a.id);

/** The build registered just before `build` in its line, from a list holding both. */
export function previousBuild(
	build: PerfBuildListItem,
	all: readonly PerfBuildListItem[],
): PerfBuildListItem | null {
	return (
		[...all]
			.filter((b) => b.id !== build.id && sameLine(b, build) && newerFirst(build, b) < 0)
			.sort(newerFirst)[0] ?? null
	);
}

/**
 * Whether the retention may take this build: unkept, past the 15 days, and not the newest of its
 * line — so a new build always has one to compare with (owner decision 2026-11-16, kept per game
 * key and kind so a publish and a delivery each keep theirs). `profiler/purgeJob.ts` says the same
 * in SQL; the gate holds the two to this.
 */
export function buildPurgeable(
	build: Pick<PerfBuildListItem, 'id' | 'gameKey' | 'kind' | 'registeredAt' | 'keep'>,
	line: readonly Pick<PerfBuildListItem, 'id' | 'gameKey' | 'kind' | 'registeredAt'>[],
	now: Date,
): boolean {
	if (build.keep) return false;
	if (new Date(build.registeredAt).getTime() >= now.getTime() - PERF_RETENTION_MS) return false;
	return line.some(
		(b) =>
			b.id !== build.id &&
			b.gameKey === build.gameKey &&
			b.kind === build.kind &&
			(b.registeredAt > build.registeredAt ||
				(b.registeredAt === build.registeredAt && b.id > build.id)),
	);
}

export interface BuildDiffRow {
	id: string;
	label: string;
	bytes: number;
	before: number;
	delta: number;
}

export interface BuildDiff {
	against: string;
	shipped: number;
	gpu: number;
	files: number;
	issues: PerfBuildIssues;
	/** Every category in either build, the largest change first. */
	categories: BuildDiffRow[];
}

/** What changed from `before` to `after`: positive is growth. */
export function buildDiff(after: PerfBuildSummary, before: PerfBuildSummary): BuildDiff {
	const rows = new Map<string, BuildDiffRow>();
	for (const c of before.categories) {
		rows.set(c.id, { id: c.id, label: c.label, bytes: 0, before: c.bytes, delta: -c.bytes });
	}
	for (const c of after.categories) {
		const prior = rows.get(c.id)?.before ?? 0;
		rows.set(c.id, {
			id: c.id,
			label: c.label,
			bytes: c.bytes,
			before: prior,
			delta: c.bytes - prior,
		});
	}
	return {
		against: before.build,
		shipped: after.shippedBytes - before.shippedBytes,
		gpu: after.gpuBytes - before.gpuBytes,
		files: after.files - before.files,
		issues: {
			error: after.issues.error - before.issues.error,
			warn: after.issues.warn - before.issues.warn,
			info: after.issues.info - before.issues.info,
		},
		categories: [...rows.values()]
			.filter((r) => r.delta !== 0)
			.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
	};
}

/**
 * Whether a reading was taken on this build: the same game (the capture link's token names it, or
 * Paste's picker — a reading without one is matched on the stamp alone), the same build number from
 * the `__IE_BUILD__` stamp the probe reports, and — when both name one — the same commit (a desktop
 * build's stamp `sha` is its engine commit; a short sha matches its full form).
 */
export function readingOnBuild(
	reading: Pick<PerfReportListItem, 'buildVersion' | 'buildSha'> & { gameKey?: string | null },
	build: Pick<PerfBuildSummary, 'build' | 'engineSha'> & { gameKey?: string },
): boolean {
	if (!reading.buildVersion || reading.buildVersion !== build.build) return false;
	if (reading.gameKey && build.gameKey && reading.gameKey !== build.gameKey) return false;
	const a = reading.buildSha?.toLowerCase();
	const b = build.engineSha?.toLowerCase();
	if (!a || !b) return true;
	return a.startsWith(b) || b.startsWith(a);
}

export const mb = (n: number): string => (n / 1048576).toFixed(1);

/** `+1.2` / `−0.4` MB, or `±0` — the diff column's text. */
export const deltaMb = (n: number): string => {
	const v = n / 1048576;
	if (Math.abs(v) < 0.05) return '±0';
	return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
};
