/**
 * Network monitoring (`perf: 9`), run by `pnpm --filter launcher-api check:profiler` (imported by
 * `check-profiler.ts`), over the REAL probe core (`apps/lines/src/game/perfNetwork.ts`) and the
 * launcher's modules:
 *
 * 19. The probe's network block: a file is named by its path only — the query (`perfsession`,
 *     `sid`, `k`) and the hash never reach the report, a token path segment reads `…`, by position
 *     under every token-bearing launcher route whatever the token's format — its class,
 *     a cache hit, and a cross-origin file without `Timing-Allow-Origin` as "size unknown", never
 *     0 bytes; totals by class and load stage; the caps (the file list, the short form).
 * 20. The launcher reads it: a `perf: 9` report's summary (transfer MB, first frame) and facts, a
 *     `perf: 7` / `8` reading unchanged (no network), a path that arrives with a query keeps none,
 *     and no route token reaches the stored report or its facts even from a probe that sent one,
 *     and the one-off scrub cleans the readings kept before that (`tokenScrub.ts`);
 *     the transfer budgets per device class, judged only where a reading measured them; the
 *     transfer of the readings on a build; Compare's network rows.
 * 21. The network rules — heavy downloads, uncompressed text, downloaded again, before the first
 *     frame, slow or heavy messages — each against its fixture AND a planted mutant the fixture must
 *     fail; owners from the real `owners.json` areas.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	classOf,
	createNetworkMonitor,
	FILES_KEPT,
	safeUrl,
	TOKEN_ROUTES as PROBE_TOKEN_ROUTES,
	type NetworkBlock,
	type ResourceLike,
	type SocketTally,
} from '../../lines/src/game/perfNetwork.ts';
import {
	PERF_INLINE_MAX_BYTES,
	summarizePerfReport,
	type PerfPhaseSummary,
	type PerfReportListItem,
} from '../src/lib/profiler.ts';
import { effectiveBudgets, evaluateReadings, STUDIO_BUDGETS } from '../src/lib/profilerBudgets.ts';
import { buildTransferMb, type PerfBuildListItem } from '../src/lib/profilerBuilds.ts';
import {
	knownTransferMb,
	networkSummary,
	readNetwork,
	redactReportText,
	redactTokens,
	TOKEN_ROUTES,
	type NetworkFacts,
} from '../src/lib/profilerNetwork.ts';
import { reportFacts, type ReportFacts } from '../src/lib/profilerFindings/facts.ts';
import {
	scrubStoredReadings,
	type ScrubRow,
	type TokenScrubStore,
} from '../src/lib/server/profiler/tokenScrub.ts';
import {
	compareReadings,
	RULES,
	type FindingContext,
	type OwnerMap,
	type Rule,
} from '../src/lib/profilerFindings/index.ts';

const OWNERS: OwnerMap = JSON.parse(
	readFileSync(new URL('../../../docs/knowledge/owners.json', import.meta.url), 'utf8'),
);

const PAGE = 'https://games.invisiblewall.org';
const LAUNCHER = 'https://app.invisiblewall.org';
const TOKEN = 'eyJ2IjoxLCJ0eXAiOiJwZXJmIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
const MB = 1048576;

const entry = (name: string, over: Partial<ResourceLike> = {}): ResourceLike => ({
	name,
	initiatorType: 'fetch',
	startTime: 100,
	duration: 40,
	transferSize: 10_300,
	encodedBodySize: 10_000,
	decodedBodySize: 10_000,
	...over,
});

/** A page load as the probe would see it: the shell, the bundle, the runtime, art, the RGS. */
function pageLoad(opts: { loadId?: number; cached?: boolean; rgsMs?: number } = {}): NetworkBlock {
	const m = createNetworkMonitor(PAGE, opts.loadId ?? 1_764_158_400_000);
	const net = (bytes: number) =>
		opts.cached
			? { transferSize: 0, encodedBodySize: bytes, decodedBodySize: bytes }
			: { transferSize: bytes + 300, encodedBodySize: bytes, decodedBodySize: bytes };
	m.navigation({
		...entry(`${PAGE}/borut/?perf=1&perfsession=${TOKEN}&rgs_url=x&sid=player-sid`, {
			startTime: 0,
			duration: 200,
			...net(4000),
		}),
		type: 'navigate',
	});
	m.add(
		entry(`${PAGE}/_app/immutable/bundle.Bx1.js`, {
			initiatorType: 'script',
			startTime: 150,
			...net(700_000),
			decodedBodySize: 2_400_000,
		}),
	);
	m.add(
		entry(`${LAUNCHER}/api/editor/runtime?project=borut&k=read-secret`, {
			startTime: 400,
			duration: 900,
			...net(1_800_000),
		}),
	);
	m.add(
		entry(`${LAUNCHER}/api/deploy/f/${TOKEN}/iw/borut/editor-art/bg.webp`, {
			initiatorType: 'img',
			startTime: 1600,
			...net(7 * MB),
		}),
	);
	m.add(
		entry(`${LAUNCHER}/api/deploy/f/${TOKEN}/iw/borut/editor-art/sym.webp`, {
			initiatorType: 'img',
			startTime: 1700,
			...net(Math.round(3.5 * MB)),
		}),
	);
	m.add(
		entry('https://cdn.partner.example/promo.png', {
			initiatorType: 'img',
			startTime: 1800,
			transferSize: 0,
			encodedBodySize: 0,
			decodedBodySize: 0,
		}),
	);
	for (let i = 1; i <= 8; i++) {
		m.add(
			entry(`${PAGE}/api/borut/rgs/engine?sid=player-sid&seq=${i}&gid=g`, {
				startTime: 5000 + i * 1000,
				duration: opts.rgsMs ?? 120,
			}),
		);
	}
	m.firstFrame(1200, 'tick');
	m.booted(4000);
	return m.block();
}

const bucket = (frames: number, fps: number) => ({
	frames,
	fps,
	p50: 16.7,
	p95: 19,
	max: 30,
	over33: 0,
	over50: 0,
	over100: 0,
});

const report = (network: unknown, over: Record<string, unknown> = {}) => ({
	perf: 9,
	kind: 'slot',
	ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
	device: { class: 'phone', reason: 'coarse pointer' },
	gpu: { gpu: 'Mali-G52 MC2' },
	idle: bucket(600, 60),
	spinning: bucket(300, 58),
	round: bucket(0, 0),
	work: { idle: { perFrame: {} }, spinning: { perFrame: {} }, round: { perFrame: {} } },
	build: { version: '12', sha: 'abcdef1' },
	network,
	...over,
});

// ── 19. The probe's block ──

test('19. a file is named by its path: no query, no hash, no token reaches the report', () => {
	assert.deepEqual(safeUrl(`${PAGE}/g/?perf=1&perfsession=${TOKEN}#top`, PAGE), {
		path: '/g/',
		rgsQuery: false,
	});
	const block = JSON.stringify(pageLoad());
	for (const secret of [TOKEN, 'perfsession', 'player-sid', 'read-secret', 'rgs_url', '?', '#']) {
		assert.ok(!block.includes(secret), `the block carries no ${secret}`);
	}
	assert.ok(
		block.includes('/api/deploy/f/…/iw/borut/editor-art/bg.webp'),
		'the token segment reads …',
	);
	// Mutant: the URL kept as given (the query too) — the same check must catch it.
	const kept = JSON.stringify({ path: new URL(`${PAGE}/g/?perfsession=${TOKEN}`).href });
	assert.throws(() => assert.ok(!kept.includes(TOKEN)), assert.AssertionError);
});

/** 32 characters with no digit (~0.8% of `mintReadToken` tokens) and an operator's free-form secret. */
const DIGITLESS = 'kQwErTyUiOpAsDfGhJkLzXcVbNmQwErT';
const SECRET = 'correct horse battery staple';

/**
 * Every launcher route whose path carries a token, read off `src/routes`: for each `[token]` folder,
 * the static path before the first dynamic segment, and how many segments from there to the token.
 */
function tokenRoutesOnDisk(): Record<string, number> {
	const found: Record<string, number> = {};
	const walk = (dir: URL, parts: string[]) => {
		for (const d of readdirSync(dir, { withFileTypes: true })) {
			if (!d.isDirectory()) continue;
			const here = [...parts, d.name].filter((p) => !/^\(.*\)$/.test(p));
			if (d.name === '[token]') {
				const first = here.findIndex((p) => p.startsWith('['));
				found[`/${here.slice(0, first).join('/')}`] = here.length - first;
			}
			walk(new URL(`${d.name}/`, dir), [...parts, d.name]);
		}
	};
	walk(new URL('../src/routes/', import.meta.url), []);
	return found;
}

test('19. a token-bearing route is redacted by position, whatever the token looks like', () => {
	assert.deepEqual(
		PROBE_TOKEN_ROUTES,
		TOKEN_ROUTES,
		'the probe and the launcher redact the same routes',
	);
	assert.deepEqual(
		tokenRoutesOnDisk(),
		TOKEN_ROUTES,
		'every [token] route under src/routes is listed (a new one must join TOKEN_ROUTES)',
	);
	const urls = [
		`${LAUNCHER}/api/published/f/${DIGITLESS}/borut/s7/editor-art/bg.webp`,
		`${LAUNCHER}/api/published/f/${encodeURIComponent(SECRET)}/borut/s7/a.json`,
		`${LAUNCHER}/api/deploy/f/${DIGITLESS}/iw/borut/editor-art/bg.webp`,
		`${LAUNCHER}/api/deploy/f/${SECRET}/iw/borut/editor-art/bg.webp`,
		`${LAUNCHER}/play/${DIGITLESS}`,
		`${LAUNCHER}/profiler/go/${DIGITLESS}/${DIGITLESS}`,
	];
	const leaks = (text: string) =>
		[DIGITLESS, SECRET, encodeURIComponent(SECRET), 'horse'].filter((t) => text.includes(t));
	for (const u of urls) assert.deepEqual(leaks(safeUrl(u, PAGE).path), [], u);
	assert.equal(
		safeUrl(urls[0], PAGE).path,
		'/api/published/f/…/borut/s7/editor-art/bg.webp',
		'the rest of the path stays readable',
	);
	// Mutant: the probe before this gate (only the deploy tree by position) leaks the published token.
	const guessOnly = (u: string) => new URL(u).pathname.replace(/^(\/api\/deploy\/f\/)[^/]+/, '$1…');
	assert.throws(
		() => assert.deepEqual(leaks(guessOnly(urls[0])), []),
		assert.AssertionError,
		'the check catches a probe that drops /api/published/f',
	);
});

test('20. the launcher never stores a route token, even from a probe that sent one', () => {
	// An old or untrusted device: the full URLs, every list, and the token elsewhere in the report.
	const sent = JSON.stringify({
		perf: 9,
		note: `loaded ${LAUNCHER}/api/published/f/${SECRET}/borut/s7/x.webp`,
		network: {
			totals: { files: 3 },
			files: [{ path: `/api/published/f/${DIGITLESS}/borut/s7/a.webp`, encoded: 9000 }],
			heaviest: [{ path: `/api/deploy/f/${SECRET}/iw/borut/b.webp`, encoded: 8000 }],
			repeats: [{ path: `/api/published/f/${DIGITLESS}/borut/s7/a.webp`, count: 2, bytes: 1 }],
			rgs: { slowest: [{ path: `/profiler/go/${DIGITLESS}/${DIGITLESS}`, ms: 900 }] },
		},
	});
	const kept = redactReportText(sent);
	const leaked = (text: string) => [DIGITLESS, SECRET, 'horse'].filter((t) => text.includes(t));
	assert.deepEqual(leaked(kept), [], 'the text kept in R2');
	const facts = JSON.stringify(readNetwork(JSON.parse(sent), 50));
	assert.deepEqual(leaked(facts), [], 'the facts and summary, read off the raw report');
	assert.equal(
		readNetwork(JSON.parse(sent), 50)?.heaviest[0]?.path,
		'/api/published/f/…/borut/s7/a.webp',
	);
	assert.equal(
		redactReportText('{"perf":9}'),
		'{"perf":9}',
		'a clean report is kept byte for byte',
	);
	assert.equal(redactTokens('/assets/play/button.png'), '/assets/play/button.png');
	// The code review's forms (2026-11-26): a key, any separator before a route, doubled slashes,
	// slashes escaped or percent-encoded.
	const forms = [
		`url:/play/${DIGITLESS}`,
		`[/play/${DIGITLESS}]`,
		`<a>/play/${DIGITLESS}`,
		`;/api/deploy/f/${DIGITLESS}/x`,
		`../api/deploy/f/${DIGITLESS}/x`,
		`//api/deploy/f/${DIGITLESS}`,
		`/api/deploy/f//${SECRET}/x`,
		`https://h//api/published/f/${SECRET}/x`,
		`\\/play\\/${DIGITLESS}`,
		`redirect=%2Fplay%2F${DIGITLESS}`,
		`%2Fapi%2Fpublished%2Ff%2F${encodeURIComponent(SECRET)}%2Fx`,
	];
	for (const f of forms) assert.deepEqual(leaked(redactTokens(f)), [], f);
	const keyed = redactReportText(JSON.stringify({ perf: 9, map: { [`/play/${DIGITLESS}`]: 1 } }));
	assert.deepEqual(leaked(keyed), [], 'an object key');
	// Mutant: a launcher that redacts only the deploy tree keeps the published token.
	const deployOnly = (t: string) => t.replace(/(\/api\/deploy\/f\/)[^/"]+/g, '$1…');
	assert.throws(() => assert.deepEqual(leaked(deployOnly(sent)), []), assert.AssertionError);
});

test('20. the one-off scrub cleans readings kept before the launcher redacted on receipt', async () => {
	const leakyReport = (id: string) =>
		JSON.stringify(
			report({
				totals: { files: 1 },
				heaviest: [{ path: `/api/published/f/${DIGITLESS}/borut/s7/${id}.webp`, encoded: 9000 }],
			}),
		);
	const files = new Map<string, { text: string; etag: string }>();
	const rows: ScrubRow[] = [];
	// As an old row kept them: the facts were read before `pathOnly` redacted a route.
	const leakyFacts = (id: string) => ({
		heaviest: [{ path: `/api/published/f/${DIGITLESS}/borut/s7/${id}.webp`, bytes: 9000 }],
	});
	// Past one page: 250 leaky readings, one clean, one whose file changes while read, one gone.
	for (let i = 0; i < 250; i++) {
		const id = `r${String(i).padStart(4, '0')}`;
		files.set(`k/${id}`, { text: leakyReport(id), etag: 'e1' });
		rows.push({
			id,
			r2Key: `k/${id}`,
			network: { largest: { path: `/api/published/f/${DIGITLESS}/x.webp` } },
			facts: { network: leakyFacts(id) },
		});
	}
	const cleanText = JSON.stringify(report(pageLoad()));
	files.set('k/clean', { text: cleanText, etag: 'e1' });
	rows.push({ id: 'r9000', r2Key: 'k/clean', network: { files: 3 }, facts: { network: null } });
	files.set('k/raced', { text: leakyReport('raced'), etag: 'e1' });
	rows.push({ id: 'r9001', r2Key: 'k/raced', network: null, facts: null });
	rows.push({ id: 'r9002', r2Key: 'k/gone', network: null, facts: null });
	const writes: string[] = [];
	const updates: string[] = [];
	const store = (opts: { skipFacts?: boolean } = {}): TokenScrubStore => ({
		async rows(afterId, limit) {
			return rows.filter((r) => afterId === null || r.id > afterId).slice(0, limit);
		},
		async read(key) {
			return files.get(key) ?? null;
		},
		async write(key, text, etag) {
			if (key === 'k/raced') return false;
			const f = files.get(key);
			if (!f || f.etag !== etag) return false;
			files.set(key, { text, etag: 'e2' });
			writes.push(key);
			return true;
		},
		async updateRow(id, set) {
			const row = rows.find((r) => r.id === id);
			if (!row) return;
			if ('network' in set) row.network = set.network;
			if ('facts' in set && !opts.skipFacts) row.facts = set.facts;
			updates.push(id);
		},
	});
	const stored = () =>
		JSON.stringify([...files].filter(([k]) => k !== 'k/raced')) + JSON.stringify(rows);
	const leaked = (text: string) => [DIGITLESS].filter((t) => text.includes(t));
	// Mutant first, on a copy: a scrub that drops the facts' rewrite leaves the token in the rows.
	const saved = JSON.stringify(rows);
	await scrubStoredReadings(store({ skipFacts: true }));
	assert.notDeepEqual(
		leaked(JSON.stringify(rows)),
		[],
		'the check catches a scrub that skips facts',
	);
	rows.splice(0, rows.length, ...(JSON.parse(saved) as ScrubRow[]));
	for (let i = 0; i < 250; i++) {
		const id = `r${String(i).padStart(4, '0')}`;
		files.set(`k/${id}`, { text: leakyReport(id), etag: 'e1' });
	}
	writes.length = 0;
	updates.length = 0;
	const r = await scrubStoredReadings(store());
	assert.deepEqual(
		[r.scanned, r.files, r.rows, r.skipped],
		[253, 250, 250, 1],
		'every page read; the raced file left for the next pass',
	);
	assert.deepEqual(leaked(stored()), [], 'no token left in a file or a row');
	assert.equal(files.get('k/clean')?.text, cleanText, 'a clean reading is untouched');
	assert.ok(!writes.includes('k/clean') && !updates.includes('r9000'));
	assert.equal(
		(
			JSON.parse(files.get('k/r0007')?.text ?? '{}') as {
				network: { heaviest: { path: string }[] };
			}
		).network.heaviest[0].path,
		'/api/published/f/…/borut/s7/r0007.webp',
		'the rest of the reading is kept',
	);
	const again = await scrubStoredReadings(store());
	assert.deepEqual([again.files, again.rows], [0, 0], 'a second pass changes nothing');
});

test('19. a browser entry is read through its getters; a long folder name is not a token', () => {
	// Measured on a booted runtime (2026-11-26): spreading the navigation entry copied no field (its
	// fields are prototype getters), and a 24-letter folder name read as a token.
	class Entry {
		get name() {
			return `${PAGE}/borut/?perfsession=${TOKEN}`;
		}
		get initiatorType() {
			return 'navigation';
		}
		get type() {
			return 'navigate';
		}
		get startTime() {
			return 0;
		}
		get duration() {
			return 250;
		}
		get transferSize() {
			return 4300;
		}
		get encodedBodySize() {
			return 4000;
		}
		get decodedBodySize() {
			return 9000;
		}
	}
	const m = createNetworkMonitor(PAGE, 1);
	m.navigation(new Entry());
	const page = m.block().heaviest[0];
	assert.deepEqual([page.path, page.class, page.encoded], ['/borut/', 'document', 4000]);
	assert.equal(
		safeUrl(`${PAGE}/assets/spines/foregroundFeatureAnimation/mm_bg_feature.json`, PAGE).path,
		'/assets/spines/foregroundFeatureAnimation/mm_bg_feature.json',
	);
	assert.equal(safeUrl(`${PAGE}/x/4f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d/y`, PAGE).path, '/x/…/y');
	// Measured the same day: a font service's file (`/af/…/l`, asked by a stylesheet) read as CSS text
	// and was called uncompressed.
	assert.deepEqual(
		[classOf('/af/2555e1/x/30/l', 'css'), classOf('/x/site.css', 'link')],
		['other', 'css'],
	);
});

test('19. sizes: a cross-origin file that hides them is unknown, never 0; a cache hit has weight', () => {
	const n = pageLoad();
	const promo = n.heaviest.find((f) => f.path === '/promo.png');
	assert.deepEqual(
		[promo?.cache, promo?.encoded, promo?.host],
		['unknown', null, 'cdn.partner.example'],
	);
	assert.equal(n.totals.unknown, 1);
	assert.equal(n.totals.files, 14, 'page + 5 files + 8 RGS requests');
	const cached = pageLoad({ cached: true });
	assert.equal(cached.totals.bytes, n.totals.bytes, 'a cached load weighs what a first visit does');
	assert.equal(cached.totals.cachedBytes > 0 && cached.totals.transfer < n.totals.transfer, true);
	assert.deepEqual(
		[n.byStage.beforeFirstFrame.files, n.byStage.boot.files, n.byStage.play.files],
		[3, 3, 8],
		'the page, the bundle and the runtime before the first frame; the art in the boot load',
	);
	assert.equal(n.rgs.requests, 8);
	assert.equal(
		n.files?.some((f) => f.class === 'api'),
		false,
		'RGS requests are summed, not listed',
	);
});

test('19. the block stays small: the file list is capped and the short form keeps the heaviest', () => {
	const m = createNetworkMonitor(PAGE, 1);
	for (let i = 0; i < 600; i++) {
		m.add(
			entry(`${PAGE}/assets/page-${i}.webp`, { initiatorType: 'img', encodedBodySize: 2000 + i }),
		);
	}
	const full = m.block();
	assert.equal(full.files?.length, FILES_KEPT);
	assert.equal(full.filesDropped, 600 - FILES_KEPT);
	const short = m.block({ short: true });
	assert.equal('files' in short, false);
	const bytes = new Blob([JSON.stringify(report(full))]).size;
	assert.ok(bytes < 80 * 1024, `a 600-file reading is ${bytes} bytes, far under the inline limit`);
	assert.ok(bytes < PERF_INLINE_MAX_BYTES);
	assert.ok(new Blob([JSON.stringify(short)]).size < 8 * 1024, 'the short form fits a keepalive');
});

// ── 20. The launcher reads it ──

test('20. a perf: 9 reading: transfer MB and the first frame on its row; older readings unchanged', () => {
	const s = summarizePerfReport(report(pageLoad()));
	assert.ok(s.ok, s.ok ? '' : s.error);
	const n = s.summary.network;
	assert.ok(n);
	assert.equal(
		n.transferMb,
		Math.round(((4000 + 700_000 + 1_800_000 + 10.5 * MB + 80_000) / MB) * 100) / 100,
	);
	assert.deepEqual([n.firstFrameMs, n.unknownFiles, n.files, n.rgsRequests], [1200, 1, 14, 8]);
	assert.deepEqual(n.largest, {
		path: '/api/deploy/f/…/iw/borut/editor-art/bg.webp',
		host: 'app.invisiblewall.org',
		class: 'image',
		mb: 7,
	});
	assert.equal(n.beforeFirstFrameMb, Math.round(((4000 + 700_000 + 1_800_000) / MB) * 100) / 100);
	for (const perf of [7, 8]) {
		const old = summarizePerfReport(report(pageLoad(), { perf }));
		assert.ok(old.ok);
		assert.equal(old.summary.network, null, `perf: ${perf} never reads a network block`);
	}
	assert.equal(reportFacts(report(pageLoad(), { perf: 8 })).network, undefined);
	assert.ok(reportFacts(report(pageLoad())).network);
});

test('20. a path that arrives with a query keeps none; lists are bounded', () => {
	const n = readNetwork({
		network: {
			heaviest: [{ path: '/a/x.json?k=secret#h', encoded: 20_000, decoded: 20_000, class: 'json' }],
			repeats: [{ path: '/r?sid=1', count: 2, bytes: 10 }],
			rgs: { slowest: [{ path: '/rgs/engine?sid=abc', ms: 900 }] },
			totals: { files: 1 },
		},
	});
	assert.ok(n);
	const text = JSON.stringify(n);
	assert.ok(!/secret|sid=|\?/.test(text), text);
	assert.deepEqual(
		n.uncompressed.map((f) => f.path),
		['/a/x.json'],
	);
	assert.equal(n.trimmed, true, 'no file list: the short form');
	assert.equal(readNetwork({}), null);
});

test('20. transfer budgets per device class, judged only where a reading measured them', () => {
	for (const c of ['phone', 'tablet', 'desktop'] as const) {
		const lines = STUDIO_BUDGETS.filter((b) => b.deviceClass === c);
		assert.deepEqual(
			lines.filter((b) => b.metric === 'transferMb').map((b) => [b.warn, b.fail]),
			[[20, 25]],
			`${c}: transfer takes the shipped-size line`,
		);
		assert.deepEqual(
			lines.filter((b) => b.metric === 'fileMb').map((b) => [b.warn, b.fail]),
			[[3, 6]],
		);
	}
	const budgets = effectiveBudgets([]);
	const s = summarizePerfReport(report(pageLoad()));
	assert.ok(s.ok);
	const measured = item('m', { network: s.summary.network });
	const verdicts = evaluateReadings('phone', [measured], budgets);
	const v = (m: string) => verdicts.find((x) => x.metric === m)?.verdict;
	assert.deepEqual(
		[v('transferMb'), v('fileMb')],
		['pass', 'fail'],
		'12.4 MB passes; a 7 MB file fails',
	);
	const old = evaluateReadings('phone', [item('o')], budgets);
	assert.equal(
		old.some((x) => x.metric === 'transferMb' || x.metric === 'fileMb'),
		false,
	);
	const hidden = item('h', {
		network: { ...s.summary.network!, files: 3, unknownFiles: 3, transferMb: 0 },
	});
	assert.equal(knownTransferMb(hidden.network), null, 'every size hidden: no number, never 0 MB');
	assert.equal(
		evaluateReadings('phone', [hidden], budgets).find((x) => x.metric === 'transferMb')?.verdict,
		'nodata',
	);
});

test('20. a build: what its as-shipped readings downloaded; Compare puts transfer side by side', () => {
	const s = summarizePerfReport(report(pageLoad()));
	assert.ok(s.ok);
	const net = s.summary.network!;
	const rs = [
		item('a', { network: { ...net, transferMb: 10 } }),
		item('b', { network: { ...net, transferMb: 14 } }),
		item('c', { network: { ...net, transferMb: 40 }, flags: { particles: 'off' } }),
	];
	assert.equal(buildTransferMb(build(), rs), 12, 'the median of the as-shipped two');
	assert.equal(buildTransferMb({ ...build(), build: '13' }, rs), null);
	const rows = compareReadings(rs[0], rs[1]).filter((r) => r.group === 'network');
	const transfer = rows.find((r) => r.label === 'transfer MB');
	assert.deepEqual(
		[transfer?.a, transfer?.b, transfer?.delta, transfer?.better],
		[10, 14, 4, 'lower'],
	);
	assert.ok(rows.some((r) => r.label === 'first frame s' && r.a === 1.2));
	assert.equal(
		compareReadings(item('x'), item('y')).some((r) => r.group === 'network'),
		false,
	);
});

// ── 21. The rules ──

const phase = (frames: number, fps: number): PerfPhaseSummary => ({
	frames,
	fps,
	p50: 1000 / fps,
	p95: 19,
	hitches: 0,
});

const at = (h: number) => new Date(Date.UTC(2026, 10, 26, h)).toISOString();

function item(id: string, over: Partial<PerfReportListItem> = {}): PerfReportListItem {
	return {
		id,
		capturedAt: at(10),
		source: 'capture',
		label: null,
		gameKey: 'borut',
		deviceClass: 'phone',
		gpu: 'Mali-G52 MC2',
		uaFamily: 'Chrome 131 · Android',
		dpr: 2,
		canvas: null,
		buildVersion: '12',
		buildSha: 'abcdef1',
		runtimeRelease: null,
		flags: {},
		kind: 'slot',
		phaseSet: 'slot',
		idle: phase(600, 60),
		spinning: phase(300, 58),
		round: null,
		menu: null,
		play: null,
		capped30: false,
		drawsMean: 40,
		textureMb: 90,
		counts: null,
		network: null,
		keep: false,
		expiresAt: null,
		...over,
	};
}

function build(): PerfBuildListItem {
	return {
		id: 'b12',
		build: '12',
		kind: 'publish',
		profile: null,
		debug: false,
		optimize: true,
		builtAt: null,
		engineSha: 'abcdef1234',
		gameSha: null,
		launcherVersion: null,
		breakdownVersion: 3,
		files: 10,
		shippedBytes: 18 * MB,
		codeBytes: 2 * MB,
		gpuBytes: 100 * MB,
		removedBytes: 0,
		unreferencedBytes: 0,
		duplicateBytes: 0,
		categories: [],
		issues: { error: 0, warn: 0, info: 0 },
		gameKey: 'borut',
		registeredAt: at(9),
		keep: false,
		expiresAt: null,
	};
}

/** A reading from a block: its list item (with the summary) and its facts, as receipt makes them. */
function measured(
	id: string,
	block: NetworkBlock,
	over: Partial<PerfReportListItem> = {},
): { r: PerfReportListItem; facts: ReportFacts } {
	const json = report(block);
	const s = summarizePerfReport(json);
	assert.ok(s.ok);
	return { r: item(id, { network: s.summary.network, ...over }), facts: reportFacts(json) };
}

function ctxOf(rs: { r: PerfReportListItem; facts: ReportFacts }[]): FindingContext {
	return {
		readings: rs.map((x) => x.r),
		builds: [],
		readingFacts: new Map(rs.map((x) => [x.r.id, x.facts])),
		buildFacts: new Map(),
		budgets: effectiveBudgets([]),
		gameKind: 'lines',
		owners: OWNERS,
	};
}

/** Each reading's network facts rewritten (a mutant's view of them). */
const withNetwork = (
	ctx: FindingContext,
	map: (n: NetworkFacts) => NetworkFacts,
): FindingContext => ({
	...ctx,
	readingFacts: new Map(
		[...ctx.readingFacts].map(([id, f]) => [id, f.network ? { ...f, network: map(f.network) } : f]),
	),
});

function holds(name: string, check: (rule: Rule) => void, rule: Rule, mutant: Rule): void {
	check(rule);
	assert.throws(
		() => check(mutant),
		assert.AssertionError,
		`${name}: the fixture must catch its mutant`,
	);
}

test('21. heavy downloads: the total and each file over the line, weight not this load’s transfer', () => {
	const big = (cached: boolean) => {
		const m = createNetworkMonitor(PAGE, 1);
		const sizes = cached
			? (b: number) => ({ transferSize: 0, encodedBodySize: b, decodedBodySize: b })
			: (b: number) => ({ transferSize: b + 300, encodedBodySize: b, decodedBodySize: b });
		for (let i = 0; i < 6; i++) {
			m.add(entry(`${PAGE}/assets/page-${i}.png`, { initiatorType: 'img', ...sizes(4.5 * MB) }));
		}
		m.add(entry(`${PAGE}/assets/music.mp3`, { ...sizes(2 * MB) }));
		return m.block();
	};
	const check = (rule: Rule) => {
		// A phone that had the game cached downloads the same game: its weight is judged.
		const fs = rule(ctxOf([measured('cached', big(true))]));
		const total = fs.find((f) => f.id.startsWith('heavyTransfer:total:'));
		assert.ok(total, 'the total');
		assert.equal(total.severity, 'high', '29 MB is past the 25 MB fail line');
		assert.match(total.title, /^29 MB downloaded on phone$/);
		const files = fs.find((f) => f.id.startsWith('heavyTransfer:files:'));
		assert.ok(files);
		assert.equal(files.severity, 'medium', '4.5 MB files: past warn 3, under fail 6');
		assert.ok(
			files.detail.some(
				(d) => d.includes('page-0.png') && d.includes('🗜 Optimize ships it as WebP'),
			),
		);
		assert.ok(!files.detail.some((d) => d.includes('music.mp3')), '2 MB is under the file line');
		assert.deepEqual([files.estimate?.value, files.owner.id], [27, 'atlas-python-tools']);
		assert.deepEqual(rule(ctxOf([measured('flagged', big(false), { flags: { aa: '0' } })])), []);
	};
	const thisLoadOnly: Rule = (ctx) =>
		RULES.heavyTransfer({
			...ctx,
			readings: ctx.readings.map((r) =>
				r.network
					? {
							...r,
							network: { ...r.network, transferMb: r.network.transferMb - r.network.cachedMb },
						}
					: r,
			),
		});
	holds('heavyTransfer', check, RULES.heavyTransfer, thisLoadOnly);
});

test('21. uncompressed text: names the server, never a gzipped file', () => {
	const m = createNetworkMonitor(PAGE, 1);
	m.add(
		entry(`${LAUNCHER}/api/editor/runtime?k=x`, {
			encodedBodySize: 900_000,
			decodedBodySize: 905_000,
		}),
	);
	m.add(
		entry(`${PAGE}/_app/bundle.js`, {
			initiatorType: 'script',
			encodedBodySize: 700_000,
			decodedBodySize: 2_400_000,
		}),
	);
	m.add(
		entry(`${PAGE}/assets/bg.webp`, {
			initiatorType: 'img',
			encodedBodySize: 800_000,
			decodedBodySize: 800_000,
		}),
	);
	const block = m.block();
	const check = (rule: Rule) => {
		const fs = rule(ctxOf([measured('u', block)]));
		assert.equal(fs.length, 1);
		const f = fs[0];
		assert.equal(f.severity, 'medium', '879 KB of uncompressed JSON');
		assert.ok(f.detail[0].includes('app.invisiblewall.org'), 'the server is named');
		assert.ok(
			f.detail.some((d) => d.startsWith('app.invisiblewall.org/api/editor/runtime — 879 KB')),
		);
		assert.ok(!f.detail.some((d) => d.includes('bundle.js')), 'a gzipped bundle is compressed');
		assert.ok(!f.detail.some((d) => d.includes('bg.webp')), 'an image is not text');
		assert.deepEqual([f.estimate, f.owner.id], [null, 'infra-railway']);
	};
	const everyText: Rule = (ctx) =>
		RULES.uncompressedText(
			withNetwork(ctx, (n) => ({
				...n,
				uncompressed: n.heaviest.filter((f) => ['document', 'js', 'css', 'json'].includes(f.class)),
			})),
		);
	holds('uncompressedText', check, RULES.uncompressedText, everyText);
});

test('21. downloaded again: the next load on one device, twice in one load, never a lab run', () => {
	const check = (rule: Rule) => {
		const first = measured('first', pageLoad({ loadId: 1_000_000 }), { capturedAt: at(9) });
		const second = measured('second', pageLoad({ loadId: 1_000_000 + 20 * 60_000 }), {
			capturedAt: at(10),
		});
		const fs = rule(ctxOf([first, second]));
		const f = fs.find((x) => x.id.startsWith('notCached:loads:'));
		assert.ok(f, 'the second load fetched it all again');
		assert.equal(f.severity, 'medium');
		assert.ok(f.detail[0].includes('20 min earlier'));
		assert.ok(f.detail.some((d) => d.includes('editor-art/bg.webp')));
		assert.deepEqual(
			f.evidence.map((e) => e.id),
			['first', 'second'],
		);
		assert.equal(f.owner.id, 'infra-railway');
		const cachedNext = measured(
			'cachedNext',
			pageLoad({ loadId: 1_000_000 + 60_000, cached: true }),
			{
				capturedAt: at(10),
			},
		);
		assert.deepEqual(rule(ctxOf([first, cachedNext])), [], 'served from the cache: nothing to say');
		const lab = measured('lab', pageLoad({ loadId: 1_000_000 + 60_000 }), {
			capturedAt: at(10),
			source: 'lab',
		});
		assert.deepEqual(rule(ctxOf([first, lab])), [], 'a lab run starts with an empty cache');
		const twice = createNetworkMonitor(PAGE, 5);
		twice.add(entry(`${PAGE}/a/x.webp`, { transferSize: 600_300, encodedBodySize: 600_000 }));
		twice.add(entry(`${PAGE}/a/x.webp`, { transferSize: 600_300, encodedBodySize: 600_000 }));
		const r = rule(ctxOf([measured('twice', twice.block())]));
		assert.deepEqual(
			r.map((x) => [x.id.split(':')[1], x.estimate?.value]),
			[['repeat', 0.6]],
		);
	};
	const labToo: Rule = (ctx) =>
		RULES.notCached({ ...ctx, readings: ctx.readings.map((r) => ({ ...r, source: 'capture' })) });
	holds('notCached', check, RULES.notCached, labToo);
});

test('21. before the first frame: the bytes the blank page waits on', () => {
	const check = (rule: Rule) => {
		const fs = rule(ctxOf([measured('f', pageLoad())]));
		assert.equal(fs.length, 1);
		const f = fs[0];
		assert.match(f.title, /^2\.39 MB before the first frame on phone$/);
		assert.equal(f.severity, 'low', 'under 3 MB');
		assert.ok(f.detail[0].includes('the first frame came 1.2 s'));
		assert.ok(f.detail.some((d) => d.startsWith('app.invisiblewall.org/api/editor/runtime')));
		assert.equal(f.estimate?.value, 2.4);
		const light = createNetworkMonitor(PAGE, 1);
		light.add(entry(`${PAGE}/a/x.webp`, { startTime: 5000, encodedBodySize: 9 * MB }));
		light.firstFrame(1000, 'tick');
		assert.deepEqual(
			rule(ctxOf([measured('l', light.block())])),
			[],
			'heavy, but after the first frame',
		);
	};
	const wholeLoad: Rule = (ctx) =>
		RULES.firstFrame(
			withNetwork(ctx, (n) => ({ ...n, byStage: { ...n.byStage, beforeFirstFrame: n.totals } })),
		);
	holds('firstFrame', check, RULES.firstFrame, wholeLoad);
});

test('21. slow or heavy messages: RGS latency off devices only; the room’s bytes a second', () => {
	const socket = (inBytes: number): SocketTally => ({
		since: 0,
		last: 10_000,
		inMessages: 400,
		inBytes,
		inLargest: 2048,
		states: 390,
		stateBytes: inBytes - 1000,
		outMessages: 300,
		outBytes: 3000,
		outLargest: 20,
	});
	const roomLoad = (inBytes: number) => {
		const m = createNetworkMonitor(PAGE, 1);
		m.add(entry(`${PAGE}/a.js`, { initiatorType: 'script' }));
		return m.block({ socket: socket(inBytes) });
	};
	const check = (rule: Rule) => {
		const slow = measured('slow', pageLoad({ rgsMs: 1400 }));
		const labSlow = measured('labSlow', pageLoad({ rgsMs: 5000 }), {
			source: 'lab',
			gpu: 'SwiftShader',
		});
		const fs = rule(ctxOf([slow, labSlow]));
		assert.deepEqual(
			fs.map((f) => f.id.split(':')[1]),
			['rgs'],
			'a lab run’s latency is the runner’s',
		);
		assert.equal(fs[0].severity, 'medium', 'p95 1.4 s');
		assert.equal(fs[0].title, 'RGS answers in 1400 ms (p95) on phone · Mali-G52 MC2');
		assert.ok(fs[0].detail[1].includes('the game’s own host'));
		assert.equal(fs[0].owner.id, 'engine-pixi-svelte');
		assert.deepEqual(rule(ctxOf([measured('fast', pageLoad())])), [], '120 ms answers');
		const room = rule(ctxOf([measured('room', roomLoad(600_000), { kind: 'arcade' })]));
		assert.equal(room.length, 1);
		assert.match(room[0].title, /^The room sends 58\.6 KB a second on phone · Mali-G52 MC2$/);
		assert.deepEqual([room[0].severity, room[0].owner.id], ['low', 'arcade-games']);
		assert.deepEqual(rule(ctxOf([measured('quiet', roomLoad(40_000))])), [], '3.9 KB a second');
	};
	const labLatency: Rule = (ctx) =>
		RULES.netTraffic({
			...ctx,
			readings: ctx.readings.map((r) => ({ ...r, source: 'capture', gpu: 'Mali-G52 MC2' })),
		});
	holds('netTraffic', check, RULES.netTraffic, labLatency);
});

test('21. every network finding’s owner is an agent owners.json names in its areas', () => {
	const agents = new Set(Object.values(OWNERS.areas ?? {}).flat());
	assert.deepEqual(Object.keys(OWNERS.areas ?? {}).sort(), [
		'assets',
		'delivery',
		'gameServer',
		'rgs',
	]);
	const fs = [
		...RULES.heavyTransfer(ctxOf([measured('a', pageLoad())])),
		...RULES.uncompressedText(ctxOf([measured('b', pageLoad())])),
	];
	assert.ok(fs.length >= 2);
	for (const f of fs) assert.ok(f.owner.kind !== 'agent' || agents.has(f.owner.id), f.owner.id);
	const summary = networkSummary(readNetwork(report(pageLoad()))!);
	assert.equal(summary.trimmed, false);
});

// The probe's own fixture (`perfNetwork.fixture.ts`) throws on a failed check.
await import('../../lines/src/game/perfNetwork.fixture.ts');
