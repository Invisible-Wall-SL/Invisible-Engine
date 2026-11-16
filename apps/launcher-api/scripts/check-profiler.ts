/**
 * Invisible Profiler P1 contracts, run over the REAL modules:
 *   pnpm --filter launcher-api check:profiler
 *
 * 1. A probe report (`perf: 7`, the shape `apps/lines/src/components/PerfHud.svelte` sends) is read
 *    into its `perf_reports` summary; a non-report, an unknown version or an empty reading is refused.
 * 2. The capture token verifies only as minted: one project, 24 hours, its own audience.
 * 3. Capture links SET the probe's parameters on the game's launch URL (never append a duplicate).
 * 4. Retention: the purge deletes an old unkept reading — file and row — and leaves a kept one, a
 *    young one, and a claimed one whose file would not delete (retried on the next run). Keep cannot
 *    land on a claimed row, and a Keep that wins the race is never purged. Presigned uploads never
 *    registered are swept after a day.
 * 5. CORS answers on exactly the probe's two routes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CAPTURE_SESSION_TTL_SECONDS,
	captureLinks,
	PERF_RETENTION_MS,
	summarizePerfReport,
	uaFamily,
} from '../src/lib/profiler.ts';
import { mintCaptureToken, verifyCaptureToken } from '../src/lib/server/profiler/captureToken.ts';
import { isProfilerCorsPath } from '../src/lib/server/profiler/cors.ts';
import {
	purgeExpiredPerfReports,
	STALE_UPLOAD_MS,
	sweepStaleUploads,
	type ClaimedReport,
	type PurgeStore,
} from '../src/lib/server/profiler/purge.ts';
import { mintToolLaunchToken } from '../src/lib/server/toolLaunch.ts';

const bucket = (frames: number, fps: number) => ({
	frames,
	fps,
	p50: 16.7,
	p95: 21.3,
	max: 48,
	over33: 2,
	over50: 0,
	over100: 0,
});

const REPORT = {
	perf: 7,
	ua: 'Mozilla/5.0 (Linux; Android 14; SM-A145R) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
	dpr: 2.625,
	device: { class: 'phone', reason: 'coarse pointer' },
	canvas: '1080x2340',
	flags: { particles: 'off' },
	gpu: { gpu: 'Mali-G52 MC2', webgl: 2 },
	textures: [
		{ format: 'rgba8unorm', count: 12, mb: 40.25 },
		{ format: 'astc-4x4', count: 3, mb: 6.5 },
	],
	idle: bucket(600, 60),
	spinning: bucket(300, 52),
	round: bucket(0, 0),
	work: {
		idle: { perFrame: { draws: { mean: 30, max: 40 }, jsMs: { mean: 2, max: 5 } } },
		spinning: { perFrame: { draws: { mean: 88, max: 120 }, jsMs: { mean: 6.1, max: 14 } } },
		round: { perFrame: {} },
	},
	build: { version: '1.4.2', sha: 'abc1234' },
};

test('1. a perf: 7 report is read into its summary', () => {
	const r = summarizePerfReport(REPORT);
	assert.ok(r.ok);
	const s = r.summary;
	assert.equal(s.perfVersion, 7);
	assert.equal(s.deviceClass, 'phone');
	assert.equal(s.gpu, 'Mali-G52 MC2');
	assert.equal(s.uaFamily, 'Chrome 131 · Android');
	assert.equal(s.buildVersion, '1.4.2');
	assert.deepEqual(s.flags, { particles: 'off' });
	assert.deepEqual(s.phases.spinning, { frames: 300, fps: 52, p50: 16.7, p95: 21.3, hitches: 2 });
	assert.equal(s.phases.round, null, 'a phase with no frames is "no frames", not 0 fps');
	assert.equal(s.drawsMean, 88, 'draws read from the spinning frames');
	assert.equal(s.jsMs, 6.1);
	assert.equal(s.textureMb, 46.8);
});

test('1. draws fall back to idle when the reading never spun', () => {
	const r = summarizePerfReport({ ...REPORT, spinning: bucket(0, 0) });
	assert.ok(r.ok);
	assert.equal(r.summary.drawsMean, 30);
});

test('1. not a report, an unknown version and an empty reading are refused', () => {
	for (const bad of [null, [], 'text', { foo: 1 }, { perf: 99, idle: bucket(10, 60) }]) {
		assert.equal(summarizePerfReport(bad).ok, false, JSON.stringify(bad));
	}
	const empty = summarizePerfReport({ ...REPORT, idle: bucket(0, 0), spinning: bucket(0, 0) });
	assert.equal(empty.ok, false);
});

test('1. browser families', () => {
	assert.equal(
		uaFamily(
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
		),
		'Safari 18 · iOS',
	);
	assert.equal(
		uaFamily(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
		),
		'Edge 131 · Windows',
	);
	assert.equal(uaFamily(null), null);
});

const SECRET = 'profiler-test-secret';
const NOW = 1_790_000_000_000;
const CLAIMS = { sid: 's-1', client: 'acme', project: 'slots', uid: 'u-1', label: 'Galaxy A14' };

test('2. a capture token verifies as minted, for its 24 hours only', () => {
	const token = mintCaptureToken(SECRET, CLAIMS, NOW);
	const claims = verifyCaptureToken(SECRET, token, NOW + 1000);
	assert.deepEqual(claims && { ...claims, exp: undefined }, { ...CLAIMS, exp: undefined });
	assert.equal(claims?.exp, NOW / 1000 + CAPTURE_SESSION_TTL_SECONDS);
	assert.equal(verifyCaptureToken(SECRET, token, NOW + CAPTURE_SESSION_TTL_SECONDS * 1000), null);
	assert.equal(verifyCaptureToken('other-secret', token, NOW), null, 'another key');
	assert.equal(verifyCaptureToken('', token, NOW), null, 'no key');
	const [v, payload, sig] = token.split('.');
	const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	forged.project = 'other';
	const tampered = `${v}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
	assert.equal(verifyCaptureToken(SECRET, tampered, NOW), null, 'a changed project');
	for (const junk of [null, '', 'v1.x', 'v2.a.b', `${token}x`]) {
		assert.equal(verifyCaptureToken(SECRET, junk, NOW), null, String(junk));
	}
});

test('2. a tool-launch token under the same key is not a capture token', () => {
	const launch = mintToolLaunchToken(
		SECRET,
		{
			aud: 'atlas',
			sub: 'u',
			uid: 'u-1',
			name: 'n',
			role: 'admin',
			client: 'acme',
			project: 'slots',
			caps: [],
		},
		NOW,
	);
	assert.equal(verifyCaptureToken(SECRET, launch, NOW), null);
});

test('3. capture links set the probe on the published URL, once each', () => {
	const game =
		'https://games.invisiblewall.org/borut/?runtime=1&project=borut&k=abc&perf=0&lang=en&particles=on';
	const links = captureLinks(game, 'TOKEN');
	assert.deepEqual(
		links.map((l) => l.id),
		['plain', 'particles', 'fx', 'aa'],
	);
	for (const link of links) {
		const url = new URL(link.url);
		assert.deepEqual(url.searchParams.getAll('perf'), ['1']);
		assert.deepEqual(url.searchParams.getAll('perfsession'), ['TOKEN']);
		assert.equal(url.searchParams.get('k'), 'abc', 'the game keeps its own parameters');
	}
	assert.deepEqual(new URL(links[0].url).searchParams.getAll('particles'), ['on']);
	assert.deepEqual(new URL(links[1].url).searchParams.getAll('particles'), ['off']);
	assert.equal(new URL(links[2].url).searchParams.get('fx'), '0');
	assert.equal(new URL(links[3].url).searchParams.get('aa'), '0');
});

interface Row {
	id: string;
	r2Key: string;
	capturedAt: Date;
	keep: boolean;
	purgingAt: Date | null;
}

/** `perf_reports` in memory, with the SQL store's conditions (`purgeJob.ts`). */
function memoryStore(rows: Row[]): PurgeStore & {
	rows: Row[];
	setKeep(id: string, keep: boolean): boolean;
	beforeClaim?: () => void;
} {
	const claimable = (r: Row, cutoff: Date) =>
		r.purgingAt !== null || (!r.keep && r.capturedAt < cutoff);
	const store = {
		rows,
		beforeClaim: undefined as (() => void) | undefined,
		async claim(cutoff: Date, now: Date, limit: number): Promise<ClaimedReport[]> {
			const candidates = rows
				.filter((r) => claimable(r, cutoff))
				.sort((a, b) => +a.capturedAt - +b.capturedAt)
				.slice(0, limit);
			store.beforeClaim?.();
			return candidates
				.filter((r) => claimable(r, cutoff))
				.map((r) => {
					r.purgingAt ??= now;
					return { id: r.id, r2Key: r.r2Key };
				});
		},
		async deleteClaimed(id: string) {
			const i = rows.findIndex((r) => r.id === id && r.purgingAt !== null);
			if (i >= 0) rows.splice(i, 1);
		},
		setKeep(id: string, keep: boolean) {
			const row = rows.find((r) => r.id === id && r.purgingAt === null);
			if (row) row.keep = keep;
			return !!row;
		},
	};
	return store;
}

const DAY = 24 * 60 * 60 * 1000;
const PURGE_NOW = new Date('2026-12-01T03:00:00Z');
const ago = (days: number) => new Date(PURGE_NOW.getTime() - days * DAY);
const row = (id: string, days: number, keep = false): Row => ({
	id,
	r2Key: `acme/slots/perf/reports/${id}.json`,
	capturedAt: ago(days),
	keep,
	purgingAt: null,
});

test('4. the purge deletes an old unkept reading and leaves a kept one', async () => {
	const files = new Set(['old', 'kept', 'young', 'edge'].map((id) => row(id, 0).r2Key));
	const store = memoryStore([
		row('old', 16),
		row('kept', 40, true),
		row('young', 3),
		row('edge', 14.9),
	]);
	const result = await purgeExpiredPerfReports({
		store,
		deleteObject: async (key) => void files.delete(key),
		now: PURGE_NOW,
	});
	assert.deepEqual(result, { deleted: 1, failed: 0 });
	assert.deepEqual(store.rows.map((r) => r.id).sort(), ['edge', 'kept', 'young']);
	assert.ok(!files.has(row('old', 0).r2Key), 'the old reading’s file is gone');
	assert.ok(files.has(row('kept', 0).r2Key), 'the kept reading’s file stays');
	assert.equal(PERF_RETENTION_MS, 15 * DAY);
});

test('4. a file that will not delete keeps its row claimed, and the next run finishes it', async () => {
	const store = memoryStore([row('stuck', 20), row('old', 18)]);
	let failing = true;
	const deleteObject = async (key: string) => {
		if (failing && key.includes('stuck')) throw new Error('R2 down');
	};
	const first = await purgeExpiredPerfReports({ store, deleteObject, now: PURGE_NOW });
	assert.deepEqual(first, { deleted: 1, failed: 1 });
	const stuck = store.rows.find((r) => r.id === 'stuck');
	assert.ok(stuck?.purgingAt, 'still claimed: hidden from the page, not keepable');
	assert.equal(store.setKeep('stuck', true), false, 'Keep cannot land on a claimed row');
	failing = false;
	const second = await purgeExpiredPerfReports({ store, deleteObject, now: PURGE_NOW });
	assert.deepEqual(second, { deleted: 1, failed: 0 });
	assert.equal(store.rows.length, 0);
});

test('4. a Keep that commits between pick and claim wins', async () => {
	const store = memoryStore([row('racy', 30)]);
	store.beforeClaim = () => store.setKeep('racy', true);
	const deleted: string[] = [];
	const result = await purgeExpiredPerfReports({
		store,
		deleteObject: async (key) => void deleted.push(key),
		now: PURGE_NOW,
	});
	assert.deepEqual(result, { deleted: 0, failed: 0 });
	assert.deepEqual(deleted, []);
	assert.equal(store.rows[0]?.keep, true);
});

test('4. a purge larger than one batch empties every expired reading', async () => {
	const rows = Array.from({ length: 450 }, (_, i) => row(`r${i}`, 16 + (i % 5)));
	const store = memoryStore(rows);
	const result = await purgeExpiredPerfReports({
		store,
		deleteObject: async () => undefined,
		now: PURGE_NOW,
	});
	assert.deepEqual(result, { deleted: 450, failed: 0 });
	assert.equal(store.rows.length, 0);
});

test('4. unregistered uploads older than a day or oversize are swept; the rest and readings stay', async () => {
	const prefix = 'acme/slots/perf/uploads/';
	const objects = [
		{
			key: `${prefix}stale.json`,
			size: 10,
			lastModified: PURGE_NOW.getTime() - STALE_UPLOAD_MS - 1,
		},
		{ key: `${prefix}fresh.json`, size: 10, lastModified: PURGE_NOW.getTime() - 60_000 },
		{ key: `${prefix}huge.json`, size: 9e9, lastModified: PURGE_NOW.getTime() - 60_000 },
		{ key: 'acme/slots/perf/reports/r.json', size: 10, lastModified: 0 },
	];
	const deleted: string[] = [];
	const swept = await sweepStaleUploads({
		prefixes: [prefix],
		listObjects: async () => objects,
		deleteObject: async (key) => void deleted.push(key),
		now: PURGE_NOW,
	});
	assert.equal(swept, 2);
	assert.deepEqual(deleted, [`${prefix}stale.json`, `${prefix}huge.json`]);
});

test('5. CORS on the probe’s two routes only', () => {
	assert.ok(isProfilerCorsPath('/api/profiler/reports'));
	assert.ok(isProfilerCorsPath('/api/profiler/uploads'));
	assert.ok(!isProfilerCorsPath('/api/profiler/sessions'));
	assert.ok(!isProfilerCorsPath('/api/profiler/reports/abc'));
});
