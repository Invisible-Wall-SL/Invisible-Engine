import { and, desc, eq, isNull } from 'drizzle-orm';
import { PERF_REPORT_MAX_BYTES, PERF_RETENTION_MS } from '$lib/profiler';
import {
	gameKeyRefusal,
	summarizeBuildBreakdown,
	type PerfBuildListItem,
	type PerfBuildSummary,
} from '$lib/profilerBuilds';
import { getDb } from '../db';
import { getGame } from '../games';
import { perfBuilds, type PerfBuild } from '../db/schema';
import { perfBuildKey, perfUploadKey } from '../projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectText,
	getObjectTextBounded,
	headObject,
	putObjectText,
} from '../r2';
import { ReportRefused, UPLOAD_ID_RE } from './store';

/**
 * Invisible Profiler build records (`docs/design/invisible-profiler.md` §2): after ☁ Publish and
 * 📦 Deliver the desktop launcher PUTs its `build-breakdown.json` to a staged upload
 * (`presignUpload`, the same route a large reading uses) and registers it here. Registration reads
 * the staged file bounded and only while it is the file the HEAD saw, summarises it HERE (nothing
 * the launcher says about the build is taken on its word except which game key it is), writes the
 * build's own file, inserts the row under the upload's id, then drops the staged copy — the same
 * order as a reading: file before row, a row never points at a missing file.
 */

export interface BuildOrigin {
	clientKey: string;
	projectKey: string;
	createdBy: string;
}

function parseBreakdown(text: string): PerfBuildSummary {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new ReportRefused(422, 'The build breakdown is not JSON.');
	}
	const result = summarizeBuildBreakdown(json);
	if (!result.ok) throw new ReportRefused(422, result.error);
	return result.summary;
}

async function registeredRow(
	id: string,
	projectKey: string,
): Promise<{ build: string; r2Key: string } | null> {
	const [row] = await getDb()
		.select({ build: perfBuilds.build, r2Key: perfBuilds.r2Key })
		.from(perfBuilds)
		.where(and(eq(perfBuilds.id, id), eq(perfBuilds.projectKey, projectKey)));
	return row ?? null;
}

async function insertRow(
	id: string,
	origin: BuildOrigin,
	gameKey: string,
	key: string,
	bytes: number,
	s: PerfBuildSummary,
): Promise<boolean> {
	const rows = await getDb()
		.insert(perfBuilds)
		.values({
			id,
			projectKey: origin.projectKey,
			clientKey: origin.clientKey,
			gameKey,
			build: s.build,
			kind: s.kind,
			profile: s.profile,
			debug: s.debug,
			optimize: s.optimize,
			builtAt: s.builtAt,
			engineSha: s.engineSha,
			gameSha: s.gameSha,
			launcherVersion: s.launcherVersion,
			breakdownVersion: s.breakdownVersion,
			files: s.files,
			shippedBytes: s.shippedBytes,
			codeBytes: s.codeBytes,
			gpuBytes: s.gpuBytes,
			removedBytes: s.removedBytes,
			unreferencedBytes: s.unreferencedBytes,
			duplicateBytes: s.duplicateBytes,
			categories: s.categories,
			issuesError: s.issues.error,
			issuesWarn: s.issues.warn,
			issuesInfo: s.issues.info,
			r2Key: key,
			bytes,
			createdBy: origin.createdBy,
		})
		.onConflictDoNothing({ target: perfBuilds.id })
		.returning({ id: perfBuilds.id });
	return rows.length > 0;
}

/**
 * Registers a staged breakdown as one build of `gameKey`. Registering an id twice answers the first
 * registration, so a resend after a lost reply is not an error. 201-worthy result: the row's id and
 * its build number.
 */
export async function registerBuild(
	origin: BuildOrigin,
	gameKey: string,
	id: string,
): Promise<{ id: string; build: string }> {
	if (!UPLOAD_ID_RE.test(id)) throw new ReportRefused(400, 'Unknown upload.');
	const registered = await registeredRow(id, origin.projectKey);
	if (registered) return { id, build: registered.build };

	const staged = perfUploadKey(origin.clientKey, origin.projectKey, id);
	// A resend racing the first registration can find the staged copy already dropped: the row
	// that dropped it is the answer, not a 404.
	const missing = async () => {
		const row = await registeredRow(id, origin.projectKey);
		if (row) return row;
		throw new ReportRefused(404, 'Nothing was uploaded under this id.');
	};
	const head = await headObject(staged);
	if (!head?.size) return { id, build: (await missing()).build };
	const tooLarge = async () => {
		await deleteObject(staged).catch(() => undefined);
		return new ReportRefused(413, 'The build breakdown is too large.');
	};
	if (head.size > PERF_REPORT_MAX_BYTES) throw await tooLarge();
	const text = await getObjectTextBounded(staged, PERF_REPORT_MAX_BYTES, head.etag ?? undefined);
	if (text === null) return { id, build: (await missing()).build };
	if (text === 'large') throw await tooLarge();
	if (text === 'changed') {
		throw new ReportRefused(409, 'The upload changed while it was read — send it again.');
	}
	let summary: PerfBuildSummary;
	try {
		summary = parseBreakdown(text);
		const refusal = gameKeyRefusal(
			summary.kind,
			(await getGame(gameKey))?.projectKey,
			origin.projectKey,
		);
		if (refusal) throw new ReportRefused(403, refusal);
	} catch (e) {
		await deleteObject(staged).catch(() => undefined);
		throw e;
	}
	const key = perfBuildKey(origin.clientKey, origin.projectKey, gameKey, summary.build, id);
	// Only the request that wrote the file may remove it: a racing one that found it written must
	// never delete the file the winner's row is about to point at.
	let wroteIt = false;
	try {
		await putObjectText(key, text, 'application/json', { ifNoneMatch: '*' });
		wroteIt = true;
	} catch (e) {
		// A register racing this one wrote it first: same id, same staged file.
		if (!(e instanceof ConflictError)) throw e;
	}
	let inserted: boolean;
	try {
		inserted = await insertRow(id, origin, gameKey, key, Buffer.byteLength(text), summary);
	} catch (e) {
		// Unsure counts as committed: a row without its file is a build record lost.
		if (wroteIt && !(await registeredRow(id, origin.projectKey).catch(() => true))) {
			await deleteObject(key).catch(() => undefined);
		}
		throw e;
	}
	if (!inserted) {
		// Registered first by another request — possibly from a staged file re-PUT since, under
		// another build number and so another key. That row is the answer; a file only we wrote and
		// it does not point at is dropped.
		const row = await registeredRow(id, origin.projectKey);
		if (!row) throw new ReportRefused(409, 'This upload belongs to another project.');
		if (wroteIt && row.r2Key !== key) await deleteObject(key).catch(() => undefined);
		return { id, build: row.build };
	}
	await deleteObject(staged).catch(() => undefined);
	return { id, build: summary.build };
}

/** The newest build of each line (game key + kind) in a list sorted newest first. */
function newestOfLines(rows: PerfBuild[]): Set<string> {
	const seen = new Set<string>();
	const newest = new Set<string>();
	for (const r of rows) {
		const line = `${r.gameKey}\u0000${r.kind}`;
		if (seen.has(line)) continue;
		seen.add(line);
		newest.add(r.id);
	}
	return newest;
}

export function toBuildListItem(r: PerfBuild, newest: boolean): PerfBuildListItem {
	return {
		id: r.id,
		gameKey: r.gameKey,
		build: r.build,
		kind: r.kind === 'delivery' ? 'delivery' : 'publish',
		profile: r.profile,
		debug: r.debug,
		optimize: r.optimize,
		builtAt: r.builtAt,
		engineSha: r.engineSha,
		gameSha: r.gameSha,
		launcherVersion: r.launcherVersion,
		breakdownVersion: r.breakdownVersion,
		files: r.files,
		shippedBytes: r.shippedBytes,
		codeBytes: r.codeBytes,
		gpuBytes: r.gpuBytes,
		removedBytes: r.removedBytes,
		unreferencedBytes: r.unreferencedBytes,
		duplicateBytes: r.duplicateBytes,
		categories: r.categories,
		issues: { error: r.issuesError, warn: r.issuesWarn, info: r.issuesInfo },
		registeredAt: r.registeredAt.toISOString(),
		keep: r.keep,
		expiresAt:
			r.keep || newest
				? null
				: new Date(r.registeredAt.getTime() + PERF_RETENTION_MS).toISOString(),
	};
}

/** A project's builds, newest first; rows the purge has claimed are already gone to the page. */
export async function listBuilds(projectKey: string, limit = 200): Promise<PerfBuildListItem[]> {
	const rows = await getDb()
		.select()
		.from(perfBuilds)
		.where(and(eq(perfBuilds.projectKey, projectKey), isNull(perfBuilds.purgingAt)))
		.orderBy(desc(perfBuilds.registeredAt), desc(perfBuilds.id))
		.limit(limit);
	const newest = newestOfLines(rows);
	return rows.map((r) => toBuildListItem(r, newest.has(r.id)));
}

/** Pins or unpins one build; false when it is not in this project or the purge has claimed it. */
export async function setBuildKeep(
	projectKey: string,
	id: string,
	keep: boolean,
): Promise<boolean> {
	const rows = await getDb()
		.update(perfBuilds)
		.set({ keep })
		.where(
			and(
				eq(perfBuilds.id, id),
				eq(perfBuilds.projectKey, projectKey),
				isNull(perfBuilds.purgingAt),
			),
		)
		.returning({ id: perfBuilds.id });
	return rows.length > 0;
}

/** The project a build belongs to, for the access check of a route that names it by id. */
export async function buildProject(id: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ projectKey: perfBuilds.projectKey })
		.from(perfBuilds)
		.where(eq(perfBuilds.id, id));
	return row?.projectKey ?? null;
}

/** A listed build's breakdown JSON, or null when it is gone or claimed by the purge. */
export async function buildFile(id: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ r2Key: perfBuilds.r2Key })
		.from(perfBuilds)
		.where(and(eq(perfBuilds.id, id), isNull(perfBuilds.purgingAt)));
	return row ? getObjectText(row.r2Key) : null;
}
