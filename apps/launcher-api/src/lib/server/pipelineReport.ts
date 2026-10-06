import { Readable, Transform, pipeline } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import type { GithubApp } from './githubApp';
import {
	LOCAL_HEADER_BYTES,
	LOCAL_HEADER_MAX_EXTRA,
	locateCentralDirectory,
	localDataOffset,
	parseCentralDirectory,
	readZipEntry,
	type ZipEntry,
} from './zip';

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
/** The archive's tail read first for one image: the end-of-central-directory record and, for a
 *  report of a few hundred screens, the whole central directory with it. */
const TAIL_BYTES = 64 * 1024;
/** A central directory past this is not a report's (one entry is under 200 bytes). */
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
/** No screen image inflates past this, whatever the archive claims: a branch controls the
 *  artifact's bytes, so a deflate bomb is a possibility, not a corruption. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Parsed central directories kept in memory, by artifact id: an artifact never changes. */
const DIRECTORY_CACHE_SIZE = 32;

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

/** The full artifact, where a changed screen's images are; `null` when it is gone (expired or
 *  never uploaded) while the report alone still reads. */
export interface ReportImages {
	artifactId: number;
	sizeInBytes: number;
	expiresAt: string | null;
}

export type HarnessReportState =
	| {
			state: 'none' | 'running' | 'skipped' | 'missing' | 'expired' | 'stale' | 'unreadable';
			detail: string;
			expiresAt?: string;
	  }
	| {
			state: 'ready';
			report: HarnessReport;
			artifactId: number;
			expiresAt: string | null;
			images: ReportImages | null;
	  };

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
	return {
		state: 'ready',
		report,
		artifactId: artifact.id,
		expiresAt: artifact.expires_at,
		images:
			full && !full.expired
				? { artifactId: full.id, sizeInBytes: full.size_in_bytes, expiresAt: full.expires_at }
				: null,
	};
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

/**
 * The files of the full artifact a report shows: every changed screen's before / after / diff
 * image, by the path the report wrote. This is the whole set the launcher serves out of the
 * artifact — a path not in it, `report.json` included, is not served — so the set is the check
 * against traversal, and a path the harness could never write is dropped besides.
 */
export function reportImagePaths(report: HarnessReport): Set<string> {
	const paths = new Set<string>();
	for (const row of report.games) {
		for (const screen of row.screens) {
			for (const image of Object.values(screen.images ?? {})) {
				if (typeof image === 'string' && isArtifactPath(image)) paths.add(image);
			}
		}
	}
	return paths;
}

/** A relative path of plain segments: no leading slash, no `.`/`..` segment, no backslash. */
const isArtifactPath = (p: string): boolean =>
	/^(?:[^/\\\0]+\/)*[^/\\\0]+$/.test(p) && !p.split('/').some((s) => s === '.' || s === '..');

type RangeAnswer =
	| { kind: 'range'; bytes: Buffer; total: number | null }
	| { kind: 'whole'; res: Response }
	| { kind: 'unsatisfiable'; total: number | null };

const totalOf = (res: Response): number | null => {
	const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
	return m ? Number(m[1]) : null;
};

/** The artifact download answered for one byte range — or, when the blob store ignored the
 *  range, the whole archive, left unread. */
async function fetchRange(
	app: GithubApp,
	path: string,
	start: number,
	end: number,
): Promise<RangeAnswer> {
	const res = await app.download(path, {
		headers: { Range: `bytes=${start}-${end}` },
		timeoutMs: ARTIFACT_TIMEOUT_MS,
	});
	if (res.status === 206)
		return { kind: 'range', bytes: Buffer.from(await res.arrayBuffer()), total: totalOf(res) };
	if (res.status === 200) return { kind: 'whole', res };
	if (res.status === 416) {
		await res.body?.cancel().catch(() => undefined);
		return { kind: 'unsatisfiable', total: totalOf(res) };
	}
	throw new Error(`GitHub ${res.status} downloading the report artifact`);
}

/**
 * One file of the full report artifact (`current-games-report`), by byte range so the archive is
 * never held: its tail for the central directory, then the entry alone, inflated as it streams.
 * `null` when the archive has no such file. A blob store that ignores the range and answers with
 * the whole archive is read whole only while the archive is small; a large one is refused.
 */
interface Directory {
	/** The archive's size as the blob store reports it (the listed size can be wrong). */
	size: number;
	entries: ZipEntry[];
}

const directories = new Map<number, Directory>();

/** The whole archive, when the blob store ignored a byte range. */
type DirectoryAnswer = { kind: 'directory'; directory: Directory } | { kind: 'whole'; zip: Buffer };

/**
 * The archive's central directory, read once per artifact: the tail first, then the directory's
 * own range when it is past the tail. An artifact never changes, so the directory is cached by
 * its id and every later image costs one range read.
 */
async function readDirectory(
	app: GithubApp,
	path: string,
	images: ReportImages,
): Promise<DirectoryAnswer> {
	const cached = directories.get(images.artifactId);
	if (cached) return { kind: 'directory', directory: cached };
	let size = images.sizeInBytes;
	let tail = await fetchRange(app, path, Math.max(0, size - TAIL_BYTES), Math.max(0, size - 1));
	// The listed size can disagree with the blob (a re-upload, a rounding): the blob's own total,
	// from the range answer, settles it, once.
	if (tail.kind !== 'whole' && tail.total !== null && tail.total !== size) {
		size = tail.total;
		tail = await fetchRange(app, path, Math.max(0, size - TAIL_BYTES), Math.max(0, size - 1));
	}
	if (tail.kind === 'whole') return { kind: 'whole', zip: await readBounded(tail.res) };
	if (tail.kind !== 'range') throw new Error('the report artifact answers no byte range');
	const tailStart = size - tail.bytes.length;
	const cd = locateCentralDirectory(tail.bytes, tailStart);
	let entries: ZipEntry[] = [];
	if (cd.count === 0 || cd.size === 0) {
		entries = [];
	} else if (cd.offset >= tailStart) {
		entries = parseCentralDirectory(
			tail.bytes.subarray(cd.offset - tailStart, cd.offset - tailStart + cd.size),
			cd.count,
		);
	} else {
		if (cd.size > MAX_CENTRAL_DIRECTORY_BYTES) {
			throw new Error('the report artifact lists more files than a report holds');
		}
		const answer = await fetchRange(app, path, cd.offset, cd.offset + cd.size - 1);
		if (answer.kind !== 'range') throw new Error('the report artifact answers no byte range');
		entries = parseCentralDirectory(answer.bytes, cd.count);
	}
	const directory = { size, entries };
	if (directories.size >= DIRECTORY_CACHE_SIZE) {
		directories.delete(directories.keys().next().value as number);
	}
	directories.set(images.artifactId, directory);
	return { kind: 'directory', directory };
}

/**
 * One file of the full report artifact (`current-games-report`), by byte range so the archive is
 * never held: its central directory (cached per artifact), then the entry alone, inflated as it
 * streams and cut off past what it declares. `null` when the archive has no such file. A blob
 * store that ignores the range and answers with the whole archive is read whole only while the
 * archive is small; a large one is refused.
 */
export async function openReportEntry(
	app: GithubApp,
	repo: string,
	images: ReportImages,
	name: string,
): Promise<ReadableStream<Uint8Array> | null> {
	const path = `/repos/${repo}/actions/artifacts/${images.artifactId}/zip`;
	const answer = await readDirectory(app, path, images);
	if (answer.kind === 'whole') return wholeArchiveEntry(answer.zip, name);
	const { size, entries } = answer.directory;
	const entry = entries.find((e) => e.name === name);
	if (!entry) return null;
	if (entry.method !== 0 && entry.method !== 8) {
		throw new Error(`ZIP entry ${name} uses compression method ${entry.method}`);
	}
	// The local header's extra field can differ from the directory's, so the range covers the
	// largest header there can be; the stream stops at the entry's end and drops the rest.
	const end = Math.min(
		size - 1,
		entry.localOffset + LOCAL_HEADER_BYTES + LOCAL_HEADER_MAX_EXTRA + entry.compressedSize - 1,
	);
	const res = await app.download(path, {
		headers: { Range: `bytes=${entry.localOffset}-${end}` },
		timeoutMs: ARTIFACT_TIMEOUT_MS,
	});
	if (res.status === 200) return wholeArchiveEntry(await readBounded(res), name);
	if (res.status !== 206 || !res.body) {
		throw new Error(`GitHub ${res.status} downloading the report artifact`);
	}
	return streamEntry(res.body, entry);
}

/**
 * A whole answer's bytes, refused past `cap` — by its `content-length` before a byte is read,
 * and by the bytes themselves as they come, since a header is a claim.
 */
export async function readBounded(res: Response, cap = MAX_FULL_ARTIFACT_BYTES): Promise<Buffer> {
	const tooLarge = (bytes: number): Error =>
		new Error(
			`the report artifact (${Math.round(bytes / 1_048_576)} MB) answers no byte range and is too large to read whole`,
		);
	const claimed = Number(res.headers.get('content-length'));
	if (claimed > cap) {
		await res.body?.cancel().catch(() => undefined);
		throw tooLarge(claimed);
	}
	if (!res.body) return Buffer.alloc(0);
	const reader = res.body.getReader();
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > cap) throw tooLarge(total);
			chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return Buffer.concat(chunks);
}

/** The blob store sent the whole archive: the entry out of it, bounded like a streamed one. */
function wholeArchiveEntry(zip: Buffer, name: string): ReadableStream<Uint8Array> | null {
	const bytes = readZipEntry(zip, name, MAX_IMAGE_BYTES);
	return bytes ? new Blob([new Uint8Array(bytes)]).stream() : null;
}

/**
 * The entry's bytes out of a range answer that starts at its local header, inflated as they
 * stream and cut off — the whole pipeline torn down — past the smaller of what the directory
 * declares and `MAX_IMAGE_BYTES`.
 */
function streamEntry(
	body: ReadableStream<Uint8Array>,
	entry: ZipEntry,
): ReadableStream<Uint8Array> {
	const limit = Math.min(entry.size, MAX_IMAGE_BYTES);
	let seen = 0;
	const raw = Readable.from(compressedBytes(body, entry), { objectMode: false });
	const capped = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			seen += chunk.length;
			if (seen > limit) {
				callback(
					new Error(
						`ZIP entry ${entry.name} is larger than it declares (past ${limit} bytes); refused`,
					),
				);
				return;
			}
			callback(null, chunk);
		},
	});
	// `pipeline` destroys every stage on an error, so a refused entry stops the download too; the
	// web stream below carries the error to the response.
	if (entry.method === 8) pipeline(raw, createInflateRaw(), capped, () => undefined);
	else pipeline(raw, capped, () => undefined);
	return Readable.toWeb(capped) as ReadableStream<Uint8Array>;
}

async function* compressedBytes(
	body: ReadableStream<Uint8Array>,
	entry: ZipEntry,
): AsyncGenerator<Buffer> {
	const reader = body.getReader();
	let header = Buffer.alloc(0);
	let inData = false;
	let remaining = entry.compressedSize;
	try {
		while (remaining > 0) {
			const { value, done } = await reader.read();
			if (done) throw new Error(`the report artifact ends inside ${entry.name}`);
			let chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
			if (!inData) {
				header = Buffer.concat([header, chunk]);
				if (header.length < LOCAL_HEADER_BYTES) continue;
				const at = localDataOffset(header, entry.name);
				if (header.length < at) continue;
				chunk = header.subarray(at);
				inData = true;
			}
			const take = chunk.subarray(0, remaining);
			remaining -= take.length;
			if (take.length) yield take;
		}
	} finally {
		// The range ran past the entry (the header allowance): the rest is never read.
		await reader.cancel().catch(() => undefined);
	}
}
