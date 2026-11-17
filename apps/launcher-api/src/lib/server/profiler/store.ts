import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
	PERF_REPORT_MAX_BYTES,
	PERF_RETENTION_MS,
	summarizePerfReport,
	type PerfPhaseSummary,
	type PerfReportListItem,
	type PerfReportSummary,
} from '$lib/profiler';
import { getDb } from '../db';
import { perfReports, type PerfReport } from '../db/schema';
import { perfReportKey, perfUploadKey, perfUploadsPrefix } from '../projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectText,
	getObjectTextBounded,
	headObject,
	listObjects,
	presignPut,
	putObjectText,
} from '../r2';

/**
 * Invisible Profiler readings: the full report JSON in R2 under the project
 * (`perfReportKey`), its summary in `perf_reports`. Every write path lands here, so the order is
 * one: the R2 file first, then the row — a row never points at a file that was never written, and a
 * failed insert removes the file it just wrote unless the row turns out to exist.
 */

/** Where a reading came from and who stands behind it — from the token or the session. */
export interface ReportOrigin {
	clientKey: string;
	projectKey: string;
	source: 'capture' | 'paste';
	session: string | null;
	label: string | null;
	createdBy: string | null;
}

/** The project a staged upload is for, and the capture session it counts against (none for a build). */
export type UploadScope = Pick<ReportOrigin, 'clientKey' | 'projectKey' | 'session'>;

export class ReportRefused extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Readings one capture session may leave. The probe sends on every Reset and every time the page is
 * hidden, so a tester flicking between apps sends often; this only stops a runaway sender.
 */
export const SESSION_READINGS_MAX = 200;

async function refuseFullSession(origin: UploadScope): Promise<void> {
	if (!origin.session) return;
	const [row] = await getDb()
		.select({ n: count() })
		.from(perfReports)
		.where(eq(perfReports.session, origin.session));
	if ((row?.n ?? 0) >= SESSION_READINGS_MAX) {
		throw new ReportRefused(429, 'This capture session is full — open a new one.');
	}
}

/**
 * Staged uploads a project may have waiting at once. A presigned PUT cannot carry a size limit on
 * R2 (no POST policy), so the number of open URLs is what bounds what a leaked capture link can
 * park in `perf/uploads/` before the sweep.
 */
export const PENDING_UPLOADS_MAX = 20;

export const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UPLOAD_TTL_SECONDS = 10 * 60;

function parseReport(text: string): PerfReportSummary {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new ReportRefused(400, 'Not JSON — paste the text ?perf=1 Copy gives.');
	}
	const result = summarizePerfReport(json);
	if (!result.ok) throw new ReportRefused(422, result.error);
	return result.summary;
}

const phaseCols = (p: PerfPhaseSummary | null) =>
	p
		? { fps: p.fps, p50: p.p50, p95: p.p95, hitches: p.hitches, frames: p.frames }
		: { fps: null, p50: null, p95: null, hitches: null, frames: 0 };

async function insertRow(
	id: string,
	origin: ReportOrigin,
	key: string,
	bytes: number,
	s: PerfReportSummary,
): Promise<boolean> {
	const idle = phaseCols(s.phases.idle);
	const spin = phaseCols(s.phases.spinning);
	const round = phaseCols(s.phases.round);
	const rows = await getDb()
		.insert(perfReports)
		.values({
			id,
			projectKey: origin.projectKey,
			clientKey: origin.clientKey,
			r2Key: key,
			bytes,
			source: origin.source,
			session: origin.session,
			label: origin.label,
			createdBy: origin.createdBy,
			perfVersion: s.perfVersion,
			buildVersion: s.buildVersion,
			buildSha: s.buildSha,
			deviceClass: s.deviceClass,
			deviceReason: s.deviceReason,
			gpu: s.gpu,
			uaFamily: s.uaFamily,
			dpr: s.dpr,
			canvas: s.canvas,
			flags: s.flags,
			idleFps: idle.fps,
			idleP50: idle.p50,
			idleP95: idle.p95,
			idleHitches: idle.hitches,
			idleFrames: idle.frames,
			spinFps: spin.fps,
			spinP50: spin.p50,
			spinP95: spin.p95,
			spinHitches: spin.hitches,
			spinFrames: spin.frames,
			roundFps: round.fps,
			roundP50: round.p50,
			roundP95: round.p95,
			roundHitches: round.hitches,
			roundFrames: round.frames,
			drawsMean: s.drawsMean,
			jsMs: s.jsMs,
			textureMb: s.textureMb,
		})
		.onConflictDoNothing({ target: perfReports.id })
		.returning({ id: perfReports.id });
	return rows.length > 0;
}

/** Whether a row holds this id (in this project, when named). */
async function rowExists(id: string, projectKey?: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ id: perfReports.id })
		.from(perfReports)
		.where(
			projectKey
				? and(eq(perfReports.id, id), eq(perfReports.projectKey, projectKey))
				: eq(perfReports.id, id),
		);
	return !!row;
}

/**
 * Removes a file whose row insert failed — unless the insert committed after all (the reply was
 * lost), when the file is the reading's. Unsure counts as committed: an orphan file is swept
 * nowhere, but a row without its file is a reading lost.
 */
async function dropUnregistered(id: string, key: string): Promise<void> {
	if (await rowExists(id).catch(() => true)) return;
	await deleteObject(key).catch(() => undefined);
}

/** Keeps a report sent in the request body. Returns its id. */
export async function saveReport(origin: ReportOrigin, text: string): Promise<string> {
	const bytes = Buffer.byteLength(text);
	if (bytes > PERF_REPORT_MAX_BYTES) throw new ReportRefused(413, 'The report is too large.');
	const summary = parseReport(text);
	await refuseFullSession(origin);
	const id = randomUUID();
	const key = perfReportKey(origin.clientKey, origin.projectKey, id);
	await putObjectText(key, text, 'application/json', { ifNoneMatch: '*' });
	try {
		await insertRow(id, origin, key, bytes, summary);
	} catch (e) {
		await dropUnregistered(id, key);
		throw e;
	}
	return id;
}

/**
 * A presigned PUT for a report too large for a request body, or a build breakdown (always sent
 * this way, `builds.ts`). The id is minted here and the key is
 * the caller's own project's STAGING key (`perfUploadKey`), never a reading's: registering copies
 * it out, so a URL still valid after registration can only rewrite a file nothing points at.
 */
export async function presignUpload(
	origin: UploadScope,
	/**
	 * False for a build breakdown: its sender is a signed-in publisher, and a capture link filling the
	 * project's slots must not cost a publish its build record (the launcher does not retry).
	 */
	capped = true,
): Promise<{ id: string; url: string; contentType: string }> {
	await refuseFullSession(origin);
	const pending = await listObjects(
		perfUploadsPrefix(origin.clientKey, origin.projectKey),
		PENDING_UPLOADS_MAX,
	);
	if (capped && pending.keys.length >= PENDING_UPLOADS_MAX) {
		throw new ReportRefused(429, 'Too many uploads are waiting — try again tomorrow.');
	}
	const id = randomUUID();
	const contentType = 'application/json';
	const url = await presignPut(
		perfUploadKey(origin.clientKey, origin.projectKey, id),
		contentType,
		UPLOAD_TTL_SECONDS,
	);
	return { id, url, contentType };
}

/**
 * Registers a report uploaded by {@link presignUpload}: reads the staged file (bounded, and
 * only while it is the file the HEAD saw), keeps it under the reading's own key, inserts the row,
 * then drops the staged copy (left behind, the purge sweeps it). Registering an id twice answers
 * the first registration's id, so a resend after a lost reply is not an error.
 */
export async function registerUpload(origin: ReportOrigin, id: string): Promise<string> {
	if (!UPLOAD_ID_RE.test(id)) throw new ReportRefused(400, 'Unknown upload.');
	if (await rowExists(id, origin.projectKey)) return id;
	await refuseFullSession(origin);
	const staged = perfUploadKey(origin.clientKey, origin.projectKey, id);
	const head = await headObject(staged);
	if (!head?.size) throw new ReportRefused(404, 'Nothing was uploaded under this id.');
	const tooLarge = async () => {
		await deleteObject(staged).catch(() => undefined);
		return new ReportRefused(413, 'The report is too large.');
	};
	if (head.size > PERF_REPORT_MAX_BYTES) throw await tooLarge();
	const text = await getObjectTextBounded(staged, PERF_REPORT_MAX_BYTES, head.etag ?? undefined);
	if (text === null) throw new ReportRefused(404, 'Nothing was uploaded under this id.');
	if (text === 'large') throw await tooLarge();
	if (text === 'changed') {
		throw new ReportRefused(409, 'The upload changed while it was read — send it again.');
	}
	let summary: PerfReportSummary;
	try {
		summary = parseReport(text);
	} catch (e) {
		await deleteObject(staged).catch(() => undefined);
		throw e;
	}
	const key = perfReportKey(origin.clientKey, origin.projectKey, id);
	try {
		await putObjectText(key, text, 'application/json', { ifNoneMatch: '*' });
	} catch (e) {
		// A register racing this one wrote it first: same id, same staged file.
		if (!(e instanceof ConflictError)) throw e;
	}
	try {
		await insertRow(id, origin, key, Buffer.byteLength(text), summary);
	} catch (e) {
		await dropUnregistered(id, key);
		throw e;
	}
	await deleteObject(staged).catch(() => undefined);
	return id;
}

const phaseOf = (
	frames: number,
	fps: number | null,
	p50: number | null,
	p95: number | null,
	hitches: number | null,
): PerfPhaseSummary | null =>
	frames ? { frames, fps: fps ?? 0, p50: p50 ?? 0, p95: p95 ?? 0, hitches: hitches ?? 0 } : null;

export function toListItem(r: PerfReport): PerfReportListItem {
	return {
		id: r.id,
		capturedAt: r.capturedAt.toISOString(),
		source: r.source === 'paste' ? 'paste' : 'capture',
		label: r.label,
		deviceClass: r.deviceClass,
		gpu: r.gpu,
		uaFamily: r.uaFamily,
		dpr: r.dpr,
		canvas: r.canvas,
		buildVersion: r.buildVersion,
		buildSha: r.buildSha,
		flags: r.flags,
		idle: phaseOf(r.idleFrames, r.idleFps, r.idleP50, r.idleP95, r.idleHitches),
		spinning: phaseOf(r.spinFrames, r.spinFps, r.spinP50, r.spinP95, r.spinHitches),
		round: phaseOf(r.roundFrames, r.roundFps, r.roundP50, r.roundP95, r.roundHitches),
		drawsMean: r.drawsMean,
		textureMb: r.textureMb,
		keep: r.keep,
		expiresAt: r.keep ? null : new Date(r.capturedAt.getTime() + PERF_RETENTION_MS).toISOString(),
	};
}

/** A project's readings, newest first; rows the purge has claimed are already gone to the page. */
export async function listReports(projectKey: string, limit = 500): Promise<PerfReportListItem[]> {
	const rows = await getDb()
		.select()
		.from(perfReports)
		.where(and(eq(perfReports.projectKey, projectKey), isNull(perfReports.purgingAt)))
		.orderBy(desc(perfReports.capturedAt))
		.limit(limit);
	return rows.map(toListItem);
}

/**
 * Pins or unpins one reading. False when there is no such reading in this project, or the purge
 * has already claimed it — the `purging_at IS NULL` guard is what keeps a Keep from landing on a
 * row whose file is being deleted.
 */
export async function setKeep(projectKey: string, id: string, keep: boolean): Promise<boolean> {
	const rows = await getDb()
		.update(perfReports)
		.set({ keep })
		.where(
			and(
				eq(perfReports.id, id),
				eq(perfReports.projectKey, projectKey),
				isNull(perfReports.purgingAt),
			),
		)
		.returning({ id: perfReports.id });
	return rows.length > 0;
}

/** The project a reading belongs to, for the access check of a route that names it by id. */
export async function reportProject(id: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ projectKey: perfReports.projectKey })
		.from(perfReports)
		.where(eq(perfReports.id, id));
	return row?.projectKey ?? null;
}

/** A listed reading's full JSON, or null when it is gone or claimed by the purge. */
export async function reportFile(id: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ r2Key: perfReports.r2Key })
		.from(perfReports)
		.where(and(eq(perfReports.id, id), isNull(perfReports.purgingAt)));
	return row ? getObjectText(row.r2Key) : null;
}
