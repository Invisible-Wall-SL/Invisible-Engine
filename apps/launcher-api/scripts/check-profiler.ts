/**
 * Invisible Profiler contracts (P1 readings … P6 lab runs, P4 findings), run over the REAL modules:
 *   pnpm --filter launcher-api check:profiler
 *
 * 1. A probe report (`perf: 7` / `8`, the shape `apps/lines/src/components/PerfHud.svelte` sends) is
 *    read into its `perf_reports` summary; a non-report, an unknown version or an empty reading is
 *    refused. A `perf: 8` slot report reads as its `perf: 7` twin; an arcade one reads menu and play.
 *    A `perf: 7` 30 fps cap counts only when the frames' work fits 0.75 of a 60 Hz frame.
 * 2. The capture token verifies only as minted: one project, 24 hours, its own audience.
 * 3. Capture links SET the probe's parameters on the game's launch URL (never append a duplicate).
 *    A capture GO link has no `?` or `&`, so the BrowserStack Live URL's `url=` carries none either
 *    (Live splits its hash on `&`), and the GO route redirects — with no sign-in — to the capture
 *    link, `perfsession` and all; a bad, expired or other game's token is refused. Every listed
 *    phone's label names it back, and so does an "Other phone…" label.
 * 4. Retention: the purge deletes an old unkept reading — file and row — and leaves a kept one, a
 *    young one, and a claimed one whose file would not delete (retried on the next run). Keep cannot
 *    land on a claimed row, and a Keep that wins the race is never purged. Presigned uploads never
 *    registered are swept after a day.
 * 5. CORS answers on exactly the probe's two routes.
 * 6. A build breakdown made by the REAL engine analyser (`scripts/lib/build-breakdown.mjs`) is read
 *    into its `perf_builds` summary; a non-breakdown, or one with no build number, is refused.
 * 7. The Builds tab's diff is against the previous build of the same game key and kind.
 * 8. A reading joins its build by the stamp: same build number, and the same commit when both name one.
 * 9. Build retention: an old unkept build goes, but never the newest of its game key and kind — not
 *    even a lone build past 15 days — and once a newer one lands the old newest goes too.
 * 10. Budgets: the studio defaults are the owner's numbers (the arcade phases' by analogy); a
 *     project override replaces one line and a reset falls back; a line out of range or with its
 *     warn past its fail is refused; the Budgets tab lists the project's phase set.
 * 11. Evaluation: pass / warn / fail on both sides of a line; a phase with too few frames is "not
 *     enough data", never pass; a device group is judged on its median, as-shipped readings only,
 *     on its readings' own phase sets; a reading at a browser's 30 fps cap is never an fps failure.
 * 12. A build's verdicts: shipped size and the GPU estimate from its breakdown, each device class
 *     from the as-shipped readings taken on it.
 * 13. Lab runs (P6): a reading's per-phase counts; a lab token is minted only for the lab opener and
 *    verifies as lab; a lab reading is compared with the previous lab reading of the same game and
 *    switches, and a count moves only past its tolerance.
 * 14–16. Findings (P4): the facts, each rule against its fixture and a planted mutant, the ranking
 *    and Compare — `check-profiler-findings.ts`, imported at the end.
 * 17–18. File as bug (P5): a finding's list, area and text; once per finding, its evidence kept —
 *    `check-profiler-bugs.ts`, imported at the end.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
	CAP_BUSY_MAX_MS,
	CAPTURE_SESSION_TTL_SECONDS,
	captureGoUrl,
	captureLinks,
	PERF_SESSION_PARAM,
	PERF_RETENTION_MS,
	phaseSetOf,
	phasesOf,
	summarizePerfReport,
	uaFamily,
	type PerfReportListItem,
} from '../src/lib/profiler.ts';
import {
	LAB_OPENER,
	mintCaptureToken,
	verifyCaptureToken,
} from '../src/lib/server/profiler/captureToken.ts';
import {
	ARCADE_COUNT_KEYS,
	LAB_TOLERANCE,
	labComparison,
	perfCounts,
	previousLabReading,
	withinLabTolerance,
	type LabReadingLike,
} from '../src/lib/profilerLab.ts';
import {
	BROWSERSTACK_LIVE_DASHBOARD,
	browserStackLiveUrl,
	CLOUD_PHONE_GROUPS,
	CLOUD_PHONES,
	cloudPhoneLabel,
	cloudPhoneOfLabel,
	customCloudPhone,
} from '../src/lib/profilerCloudPhones.ts';
import { resolveCaptureGo } from '../src/lib/server/profiler/go.ts';
import { isProfilerCorsPath } from '../src/lib/server/profiler/cors.ts';
import {
	purgeExpired,
	STALE_UPLOAD_MS,
	sweepOrphanFiles,
	sweepStaleUploads,
	type ClaimedRow,
	type PurgeStore,
} from '../src/lib/server/profiler/purge.ts';
import { mintToolLaunchToken } from '../src/lib/server/toolLaunch.ts';
import {
	buildDiff,
	gameKeyRefusal,
	buildPurgeable,
	deltaMb,
	previousBuild,
	readingOnBuild,
	summarizeBuildBreakdown,
	type PerfBuildListItem,
} from '../src/lib/profilerBuilds.ts';
import {
	budgetKeyId,
	budgetLinesFor,
	budgetRefusal,
	deviceGroups,
	effectiveBudgets,
	evaluateBuild,
	evaluateReadings,
	isBudgetKey,
	judge,
	MIN_PHASE_FRAMES,
	readingsByBuild,
	STUDIO_BUDGETS,
	worstVerdict,
	type BudgetOverride,
	type MetricVerdict,
} from '../src/lib/profilerBudgets.ts';
import { analyzeDesktopBuild, BREAKDOWN_VERSION } from '../../../scripts/lib/build-breakdown.mjs';

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

// ── perf: 8: the phase set by kind, the browser cap ──

const late = (count: number, p95: number) => ({ count, p50: p95 / 2, p95, max: p95 * 2 });

const ARCADE_REPORT = {
	perf: 8,
	kind: 'arcade',
	ua: REPORT.ua,
	dpr: 2.625,
	device: { class: 'phone', reason: 'coarse pointer' },
	canvas: '1080x2340',
	flags: {},
	gpu: { gpu: 'Adreno 750', webgl: 2 },
	textures: [{ format: 'rgba8unorm', count: 4, mb: 12 }],
	refreshHz: 60,
	capped30: false,
	menu: bucket(400, 59.9),
	play: bucket(1800, 52),
	// A stray slot bucket: an arcade reading never reads it.
	idle: bucket(900, 60),
	work: {
		menu: {
			frames: 400,
			perFrame: { draws: { mean: 14, max: 20 }, jsMs: { mean: 2.1, max: 6 } },
		},
		play: {
			frames: 1800,
			perFrame: {
				draws: { mean: 40, max: 70 },
				passes: { mean: 1, max: 1 },
				calls: { mean: 120, max: 200 },
				jsMs: { mean: 7.5, max: 19 },
				simSteps: { mean: 1.1, max: 3 },
				simMs: { mean: 2.4, max: 9 },
				bodies: { mean: 22, max: 40 },
				netMs: { mean: 0, max: 0 },
				patches: { mean: 0, max: 0 },
				patchBytes: { mean: 0, max: 0 },
			},
		},
	},
	arcade: { online: false, fixedHz: 60, lateMs: { menu: late(0, 0), play: late(0, 0) } },
	spikeCauses: { menu: {}, play: { sim: 2 } },
	spikes: [],
	build: { version: '3', sha: 'def5678' },
};

test('1. a perf: 8 slot report reads exactly as its perf: 7 twin, but for its version and kind', () => {
	const v7 = summarizePerfReport(REPORT);
	const v8 = summarizePerfReport({ ...REPORT, perf: 8, kind: 'slot' });
	assert.ok(v7.ok && v8.ok);
	assert.deepEqual({ ...v8.summary, perfVersion: 7, kind: null }, v7.summary);
	assert.deepEqual(
		[v8.summary.perfVersion, v8.summary.kind, v8.summary.phaseSet],
		[8, 'slot', 'slot'],
	);
	assert.deepEqual([v7.summary.kind, v7.summary.phaseSet], [null, 'slot'], 'perf: 7 is a slot');
	for (const kind of ['match3', 'card', undefined]) {
		const r = summarizePerfReport({ ...REPORT, perf: 8, kind });
		assert.ok(r.ok);
		assert.equal(r.summary.phaseSet, 'slot', `${kind}: anything but arcade is the slot set`);
	}
});

const v7Slot = () => {
	const r = summarizePerfReport(REPORT);
	assert.ok(r.ok);
	return r.summary;
};

test('1. a perf: 8 arcade report reads menu and play, its kind and its own cap', () => {
	const r = summarizePerfReport(ARCADE_REPORT);
	assert.ok(r.ok);
	const s = r.summary;
	assert.deepEqual([s.perfVersion, s.kind, s.phaseSet, s.capped30], [8, 'arcade', 'arcade', false]);
	assert.deepEqual(s.phases.play, { frames: 1800, fps: 52, p50: 16.7, p95: 21.3, hitches: 2 });
	assert.equal(s.phases.menu?.frames, 400);
	assert.deepEqual(
		[s.phases.idle, s.phases.spinning, s.phases.round],
		[null, null, null],
		'a slot bucket is never read off an arcade report',
	);
	assert.deepEqual([s.drawsMean, s.jsMs], [40, 7.5], 'draws and JS from play');
	assert.deepEqual([s.counts.idle, s.counts.spinning], [null, null]);
	assert.deepEqual(
		[s.counts.play?.draws, s.counts.play?.simMs, s.counts.play?.bodies, s.counts.menu?.simMs],
		[40, 2.4, 22, null],
	);
	const menuOnly = summarizePerfReport({ ...ARCADE_REPORT, play: bucket(0, 0) });
	assert.ok(menuOnly.ok);
	assert.equal(menuOnly.summary.drawsMean, 14, 'menu when it never played');
	const capped = summarizePerfReport({ ...ARCADE_REPORT, capped30: true });
	assert.ok(capped.ok && capped.summary.capped30, 'a perf: 8 probe decides its cap itself');
	assert.deepEqual(phasesOf([s, v7Slot()]), ['idle', 'spinning', 'round', 'menu', 'play']);
	assert.deepEqual(phasesOf([s]), ['menu', 'play']);
});

test('1. "no frames yet" is judged on the reading’s own phase set', () => {
	const none = summarizePerfReport({ ...ARCADE_REPORT, menu: bucket(0, 0), play: bucket(0, 0) });
	assert.equal(none.ok, false, 'an idle bucket does not make an arcade reading');
	const slot = summarizePerfReport({
		...REPORT,
		perf: 8,
		kind: 'slot',
		idle: bucket(0, 0),
		spinning: bucket(0, 0),
		menu: bucket(500, 60),
	});
	assert.equal(slot.ok, false, 'a menu bucket does not make a slot reading');
});

/** The owner's Salmons reading (26 Nov 09:48, BS Live · Galaxy S24 Ultra, perf: 7). */
const SALMONS_V7 = {
	...REPORT,
	flags: {},
	gpu: { gpu: 'Adreno (TM) 750', webgl: 2 },
	refreshHz: 30,
	capped30: true,
	idle: {
		frames: 5153,
		fps: 29.8,
		p50: 33.3,
		p95: 33.4,
		max: 50,
		over33: 9,
		over50: 0,
		over100: 0,
	},
	spinning: bucket(0, 0),
	round: bucket(0, 0),
	work: {
		idle: {
			frames: 5153,
			perFrame: {
				jsMs: { mean: 19.4, max: 31 },
				tickMs: { mean: 18.5, max: 29 },
				renderMs: { mean: 14.9, max: 24 },
				lateMs: { mean: 3.8, max: 9 },
				afterMs: { mean: 3.1, max: 8 },
			},
		},
		spinning: { frames: 0, perFrame: {} },
		round: { frames: 0, perFrame: {} },
	},
};

/** iOS Low Power Mode on perf: 7: held to 30 fps with ~5 ms of work a frame. */
const LOW_POWER_V7 = {
	...SALMONS_V7,
	idle: { ...SALMONS_V7.idle, frames: 3000 },
	spinning: bucket(300, 30),
	work: {
		...SALMONS_V7.work,
		idle: {
			frames: 3000,
			perFrame: {
				jsMs: { mean: 5.2, max: 9 },
				tickMs: { mean: 4.4, max: 8 },
				renderMs: { mean: 3, max: 6 },
				lateMs: { mean: 0.5, max: 2 },
				afterMs: { mean: 0.6, max: 2 },
			},
		},
		// Fewer frames than idle, so not the phase the cap is read on.
		spinning: {
			frames: 300,
			perFrame: {
				tickMs: { mean: 20, max: 30 },
				lateMs: { mean: 2, max: 4 },
				afterMs: { mean: 2, max: 4 },
			},
		},
	},
};

test('1. a perf: 7 capped30 is a browser cap only when its frames had room for 60', () => {
	assert.equal(CAP_BUSY_MAX_MS, 12.5, '0.75 of a 60 Hz frame');
	const salmons = summarizePerfReport(SALMONS_V7);
	assert.ok(salmons.ok);
	assert.equal(
		salmons.summary.capped30,
		false,
		'3.8 + 18.5 + 3.1 ms a frame cannot fit 16.7 ms: the game missed 60, vsync halved it',
	);
	const lowPower = summarizePerfReport(LOW_POWER_V7);
	assert.ok(lowPower.ok && lowPower.summary.capped30, 'about 5.5 ms of work held to 30: a cap');
	const unflagged = summarizePerfReport({ ...LOW_POWER_V7, capped30: false });
	assert.ok(unflagged.ok && !unflagged.summary.capped30, 'never a cap the probe did not see');
	const blind = summarizePerfReport({
		...LOW_POWER_V7,
		work: {
			...LOW_POWER_V7.work,
			idle: { frames: 3000, perFrame: { tickMs: { mean: 4.4, max: 8 } } },
		},
	});
	assert.ok(
		blind.ok && !blind.summary.capped30,
		'without the work means nothing shows room: judged',
	);
});

const SECRET = 'profiler-test-secret';
const NOW = 1_790_000_000_000;
const CLAIMS = {
	sid: 's-1',
	client: 'acme',
	project: 'slots',
	game: 'slotsbuild',
	uid: 'u-1',
	label: 'Galaxy A14',
};

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

test('3. a BrowserStack Live link starts the picked phone on a GO link with no ? or &', () => {
	const game = 'https://games.invisiblewall.org/borut/?runtime=1&project=borut&k=a%2Bb&lang=en#x';
	const token = mintCaptureToken('k', {
		sid: 's',
		client: 'iw',
		project: 'borut',
		game: 'borut',
		uid: 'u',
		label: 'BS Live · Galaxy S25 · Android 15.0',
	});
	const phone = CLOUD_PHONES.find((p) => p.device === 'Samsung Galaxy S25');
	assert.ok(phone);
	for (const link of captureLinks(game, token)) {
		const go = captureGoUrl('https://app.invisiblewall.org/', link.id, token);
		assert.ok(go.startsWith('https://app.invisiblewall.org/profiler/go/'), go);
		assert.ok(!/[?&#]/.test(go), `the GO link has no query: ${go}`);
		const live = browserStackLiveUrl(phone, go);
		assert.ok(live.startsWith(`${BROWSERSTACK_LIVE_DASHBOARD}#`));
		const hash = live.slice(live.indexOf('#') + 1);
		const raw = hash.split('&').find((kv) => kv.startsWith('url='));
		assert.ok(raw, 'the hash carries url=');
		assert.ok(!/[?&#]/.test(decodeURIComponent(raw.slice(4))), 'url= carries no raw ? & or #');
		// Whatever Live does — split the hash first or decode it first — it reads the same link.
		assert.equal(new URLSearchParams(hash).get('url'), go, 'split first');
		const decodedFirst = Object.fromEntries(
			decodeURIComponent(hash.replace(/\+/g, ' '))
				.split('&')
				.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
		);
		assert.equal(decodedFirst.url, go, 'decoded first');
		assert.deepEqual(
			[decodedFirst.os, decodedFirst.os_version, decodedFirst.device, decodedFirst.start],
			['Android', '15.0', 'Samsung Galaxy S25', 'true'],
		);
	}
});

test('3. the Live URL carries exactly the documented parameters, os cased as Live writes it', () => {
	const go = 'https://app.invisiblewall.org/profiler/go/plain/T.k';
	const duo = CLOUD_PHONES.find((p) => p.device === 'iPhone Duo' && p.osVersion === '27.1');
	assert.ok(duo, 'iPhone Duo on iOS 27.1 is a Live phone');
	const live = browserStackLiveUrl(duo, go);
	assert.equal(
		live,
		`${BROWSERSTACK_LIVE_DASHBOARD}#os=iOS&os_version=27.1&device=iPhone+Duo&device_browser=safari` +
			`&scale_to_fit=true&speed=1&url=${encodeURIComponent(go)}&start=true`,
	);
	const documented = [
		'os',
		'os_version',
		'device',
		'device_browser',
		'scale_to_fit',
		'speed',
		'url',
		'start',
	];
	for (const phone of CLOUD_PHONES) {
		const hash = new URLSearchParams(browserStackLiveUrl(phone, go).split('#')[1]);
		assert.deepEqual([...hash.keys()], documented, phone.id);
		assert.equal(hash.get('os'), phone.os === 'ios' ? 'iOS' : 'Android', phone.id);
		assert.equal(hash.get('device'), phone.device, phone.id);
		assert.equal(hash.get('start'), 'true', phone.id);
		assert.equal(hash.get('url'), go, phone.id);
	}
});

test('3. a capture link forces no device: the game detects a phone itself', () => {
	const game =
		'https://games.invisiblewall.org/buffalo/?runtime=1&project=buffalo&k=abc' +
		'&sessionID=demo&lang=en&currency=USD&device=desktop';
	for (const link of captureLinks(game, 'TOKEN')) {
		const url = new URL(link.url);
		assert.equal(url.searchParams.has('device'), false, `${link.id}: ${link.url}`);
		assert.equal(url.searchParams.get('currency'), 'USD', 'the rest of the launch URL stays');
	}
});

test('3. the GO route redirects a signed-out phone to the capture link, perfsession and all', async () => {
	const key = 'k';
	const game = 'https://games.invisiblewall.org/borut/?runtime=1&project=borut&lang=en';
	const claims = { sid: 's', client: 'iw', project: 'borut', game: 'borut', uid: 'u', label: null };
	const token = mintCaptureToken(key, claims);
	const games = new Map([
		['borut', { projectKey: 'borut', url: game }],
		['other', { projectKey: 'other', url: game }],
	]);
	const deps = { key, gameOf: async (k: string) => games.get(k) };
	for (const link of captureLinks(game, token)) {
		const out = await resolveCaptureGo(link.id, token, deps);
		assert.ok(out.ok, `${link.id} redirects`);
		assert.equal(out.url, link.url, 'to exactly the capture link');
		const url = new URL(out.url);
		assert.equal(url.searchParams.get(PERF_SESSION_PARAM), token, 'it lands with perfsession');
		assert.equal(url.searchParams.get('perf'), '1');
	}
	const refused = async (linkId: string, t: string, d: Parameters<typeof resolveCaptureGo>[2]) => {
		const out = await resolveCaptureGo(linkId, t, d);
		assert.ok(!out.ok, `${linkId} refused`);
		return out.status;
	};
	assert.equal(await refused('plain', `${token}x`, deps), 410, 'a changed token');
	assert.equal(await refused('plain', token, { ...deps, key: 'other' }), 410, 'another key');
	const later = Date.now() + CAPTURE_SESSION_TTL_SECONDS * 1000 + 1;
	assert.equal(await refused('plain', token, { ...deps, now: later }), 410, 'an expired token');
	assert.equal(await refused('nope', token, deps), 404, 'a link id that is no capture switch');
	const otherProject = mintCaptureToken(key, { ...claims, game: 'other' });
	assert.equal(await refused('plain', otherProject, deps), 404, "another project's game");
	const unpublished = mintCaptureToken(key, { ...claims, game: 'gone' });
	assert.equal(await refused('plain', unpublished, deps), 404, 'a game no longer published');
});

test('3. every cloud phone is grouped, uniquely labelled and named back by its label', () => {
	assert.ok(CLOUD_PHONES.length >= 100, `a long list: ${CLOUD_PHONES.length}`);
	assert.equal(new Set(CLOUD_PHONES.map((p) => p.id)).size, CLOUD_PHONES.length, 'unique ids');
	assert.equal(new Set(CLOUD_PHONES.map((p) => cloudPhoneLabel(p))).size, CLOUD_PHONES.length);
	assert.equal(
		CLOUD_PHONE_GROUPS.reduce((n, g) => n + g.phones.length, 0),
		CLOUD_PHONES.length,
		'every phone in one group',
	);
	for (const brand of ['Samsung', 'Google', 'Apple iPhone', 'Xiaomi', 'OnePlus', 'Motorola']) {
		assert.ok(CLOUD_PHONE_GROUPS.find((g) => g.brand === brand)?.phones.length, brand);
	}
	for (const p of CLOUD_PHONES) {
		const label = cloudPhoneLabel(p);
		assert.ok(label.startsWith('BS Live · ') && label.length <= 80, label);
		assert.equal(cloudPhoneOfLabel(label), p, `${label} names its phone`);
		assert.ok(p.device.endsWith(p.model) && p.device.trim() === p.device, p.device);
	}
	const typed = customCloudPhone(' Samsung  Galaxy A14 ', 'android', '13.0');
	assert.ok(typed);
	assert.deepEqual(
		[typed.device, typed.os, typed.osVersion],
		['Samsung Galaxy A14', 'android', '13.0'],
	);
	assert.equal(cloudPhoneLabel(typed), 'BS Live · Samsung Galaxy A14 · Android 13.0');
	assert.deepEqual(cloudPhoneOfLabel(cloudPhoneLabel(typed)), typed, 'a typed label names it back');
	assert.equal(customCloudPhone('', 'ios', '18'), null);
	assert.equal(customCloudPhone('iPhone 16', 'ios', ''), null);
	assert.equal(customCloudPhone('x'.repeat(51), 'ios', '18'), null);
	const longest = customCloudPhone('x'.repeat(50), 'android', '16.0');
	assert.ok(longest && cloudPhoneLabel(longest).length <= 80, 'the longest typed name fits');
	assert.equal(cloudPhoneOfLabel('Galaxy A14'), null);
	assert.equal(cloudPhoneOfLabel(null), null);
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
		async claim(cutoff: Date, now: Date, limit: number): Promise<ClaimedRow[]> {
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
	const result = await purgeExpired({
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
	const first = await purgeExpired({ store, deleteObject, now: PURGE_NOW });
	assert.deepEqual(first, { deleted: 1, failed: 1 });
	const stuck = store.rows.find((r) => r.id === 'stuck');
	assert.ok(stuck?.purgingAt, 'still claimed: hidden from the page, not keepable');
	assert.equal(store.setKeep('stuck', true), false, 'Keep cannot land on a claimed row');
	failing = false;
	const second = await purgeExpired({ store, deleteObject, now: PURGE_NOW });
	assert.deepEqual(second, { deleted: 1, failed: 0 });
	assert.equal(store.rows.length, 0);
});

test('4. a Keep that commits between pick and claim wins', async () => {
	const store = memoryStore([row('racy', 30)]);
	store.beforeClaim = () => store.setKeep('racy', true);
	const deleted: string[] = [];
	const result = await purgeExpired({
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
	const result = await purgeExpired({
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

// ── P2: builds ──

const breakdownOf = (buildInfo: Record<string, unknown> | null, build: Record<string, unknown>) =>
	analyzeDesktopBuild({
		files: [
			{ rel: '_app/immutable/app.js', bytes: 2_000_000 },
			{ rel: 'assets/ui/frame.png', bytes: 3_000_000 },
			{ rel: 'assets/sounds/spin.mp3', bytes: 500_000 },
			{ rel: 'assets/ui/unused.png', bytes: 100_000 },
		],
		texts: new Map([['_app/immutable/app.js', '"assets/ui/frame.png" "assets/sounds/spin.mp3"']]),
		bundle: null,
		assetsPrefix: 'assets/',
		pull: null,
		images: null,
		buildInfo,
		build,
	});

const PROVENANCE = {
	version: '12',
	builtAt: '2026-11-16T10:00:00Z',
	engineSha: 'abcdef1234567890',
};

test('6. a breakdown from the real analyser is read into its build summary', () => {
	const json = JSON.parse(
		JSON.stringify(
			breakdownOf(PROVENANCE, { kind: 'delivery', profile: 'operator-embed', optimize: true }),
		),
	);
	const result = summarizeBuildBreakdown(json);
	assert.ok(result.ok, result.ok ? '' : result.error);
	const s = result.summary;
	assert.equal(s.build, '12');
	assert.equal(s.kind, 'delivery');
	assert.equal(s.profile, 'operator-embed');
	assert.equal(s.optimize, true);
	assert.equal(s.debug, false);
	assert.equal(s.engineSha, 'abcdef1234567890');
	assert.equal(s.builtAt, '2026-11-16T10:00:00Z');
	assert.equal(s.files, 4);
	assert.equal(s.shippedBytes, 5_600_000);
	assert.equal(s.codeBytes, 2_000_000);
	assert.equal(
		s.categories.reduce((n, c) => n + c.bytes, 0),
		s.shippedBytes,
		'categories add up to what shipped',
	);
	assert.ok(s.categories.every((c) => c.label && c.id));
	const issues = json.issues as { level: string }[];
	assert.equal(s.issues.warn, issues.filter((i) => i.level === 'warn').length);
	assert.equal(s.breakdownVersion, BREAKDOWN_VERSION);
});

test('6. a non-breakdown, or one with no build number, is refused with a sentence', () => {
	for (const bad of [null, [], { perf: 7 }, { version: 2, totals: {} }]) {
		const r = summarizeBuildBreakdown(bad);
		assert.equal(r.ok, false);
	}
	const noInfo = summarizeBuildBreakdown(JSON.parse(JSON.stringify(breakdownOf(null, {}))));
	assert.equal(noInfo.ok, false);
	assert.match(noInfo.ok ? '' : noInfo.error, /build number/);
	const hostile = JSON.parse(JSON.stringify(breakdownOf({ ...PROVENANCE, version: '../x' }, {})));
	assert.equal(summarizeBuildBreakdown(hostile).ok, false, 'a build number is a path segment');
});

test('6. repeated or missing category ids merge into one row (the page keys rows on them)', () => {
	const json = JSON.parse(JSON.stringify(breakdownOf(PROVENANCE, {})));
	json.categories = [
		{ id: 'code', label: 'Code', files: 1, bytes: 10 },
		{ id: 'code', label: 'Code', files: 2, bytes: 5 },
		{ label: 'No id', files: 1, bytes: 1 },
		{ id: '', files: 1, bytes: 2 },
	];
	const r = summarizeBuildBreakdown(json);
	assert.ok(r.ok);
	assert.deepEqual(
		r.summary.categories.map((c) => [c.id, c.files, c.bytes]),
		[
			['code', 3, 15],
			['other', 2, 3],
		],
	);
});

const item = (
	id: string,
	over: Partial<PerfBuildListItem> & { daysAgo?: number } = {},
): PerfBuildListItem => {
	const { daysAgo = 0, ...rest } = over;
	const base = summarizeBuildBreakdown(
		JSON.parse(JSON.stringify(breakdownOf(PROVENANCE, { kind: 'publish' }))),
	);
	assert.ok(base.ok);
	return {
		...base.summary,
		id,
		gameKey: 'slotsbuild',
		registeredAt: ago(daysAgo).toISOString(),
		keep: false,
		expiresAt: null,
		...rest,
	};
};

test('7. the diff is against the previous build of the same game key and kind', () => {
	const v10 = item('a', { build: '10', daysAgo: 3 });
	const d11 = item('b', { build: '11', daysAgo: 2, kind: 'delivery' });
	const other = item('c', { build: '11', daysAgo: 1.5, gameKey: 'slots' });
	const v12 = item('d', {
		build: '12',
		daysAgo: 1,
		shippedBytes: v10.shippedBytes + 2 * 1048576,
		categories: [
			...v10.categories.map((c) => (c.id === 'code' ? { ...c, bytes: c.bytes + 2 * 1048576 } : c)),
			{ id: 'fonts', label: 'Fonts', files: 1, bytes: 1000 },
		].filter((c) => c.id !== 'sounds'),
	});
	const all = [v12, other, d11, v10];
	assert.equal(previousBuild(v12, all)?.id, 'a', 'skips the delivery and the other game key');
	assert.equal(previousBuild(v10, all), null);
	assert.equal(previousBuild(d11, all), null);
	const diff = buildDiff(v12, v10);
	assert.equal(diff.against, '10');
	assert.equal(diff.shipped, 2 * 1048576);
	assert.equal(diff.categories[0]?.id, 'code', 'the largest change first');
	assert.equal(diff.categories.find((c) => c.id === 'fonts')?.delta, 1000, 'a new category');
	const sounds = diff.categories.find((c) => c.id === 'sounds');
	assert.ok(sounds && sounds.bytes === 0 && sounds.delta < 0, 'a category that went away');
	assert.equal(deltaMb(2 * 1048576), '+2.0');
	assert.equal(deltaMb(-0.5 * 1048576), '−0.5');
	assert.equal(deltaMb(1000), '±0');
});

test('8. a reading joins its build by the stamp', () => {
	const build = { build: '12', engineSha: 'abcdef1234567890' };
	assert.ok(readingOnBuild({ buildVersion: '12', buildSha: 'abcdef1' }, build), 'a short sha');
	assert.ok(readingOnBuild({ buildVersion: '12', buildSha: null }, build), 'no sha on the reading');
	assert.ok(
		readingOnBuild({ buildVersion: '12', buildSha: 'x' }, { build: '12', engineSha: null }),
	);
	assert.ok(!readingOnBuild({ buildVersion: '12', buildSha: '9999999' }, build), 'another engine');
	assert.ok(!readingOnBuild({ buildVersion: '13', buildSha: 'abcdef1' }, build));
	assert.ok(!readingOnBuild({ buildVersion: null, buildSha: null }, build));
});

interface BuildRow {
	id: string;
	gameKey: string;
	kind: 'publish' | 'delivery';
	registeredAt: string;
	keep: boolean;
	purgingAt: Date | null;
	r2Key: string;
}

/** `perf_builds` in memory, claiming exactly what `buildPurgeable` allows (`purgeJob.ts` in SQL). */
function memoryBuildStore(rows: BuildRow[]): PurgeStore & { rows: BuildRow[] } {
	return {
		rows,
		async claim(_cutoff: Date, now: Date, limit: number): Promise<ClaimedRow[]> {
			return rows
				.filter((r) => r.purgingAt !== null || buildPurgeable(r, rows, now))
				.slice(0, limit)
				.map((r) => {
					r.purgingAt ??= now;
					return { id: r.id, r2Key: r.r2Key };
				});
		},
		async deleteClaimed(id: string) {
			const i = rows.findIndex((r) => r.id === id && r.purgingAt !== null);
			if (i >= 0) rows.splice(i, 1);
		},
	};
}

const buildRow = (id: string, daysAgo: number, over: Partial<BuildRow> = {}): BuildRow => ({
	id,
	gameKey: 'slotsbuild',
	kind: 'publish',
	registeredAt: ago(daysAgo).toISOString(),
	keep: false,
	purgingAt: null,
	r2Key: `acme/slots/perf/builds/slotsbuild/v1-${id}.json`,
	...over,
});

test('9. the purge never takes the newest build of a game key and kind', async () => {
	const store = memoryBuildStore([
		buildRow('lone-old', 40, { gameKey: 'other' }),
		buildRow('old', 30),
		buildRow('old-kept', 29, { keep: true }),
		buildRow('newest-publish', 20),
		buildRow('newest-delivery', 25, { kind: 'delivery' }),
		buildRow('older-delivery', 26, { kind: 'delivery' }),
		buildRow('young', 3, { gameKey: 'third' }),
		buildRow('young-older', 4, { gameKey: 'third' }),
	]);
	const deleted: string[] = [];
	const result = await purgeExpired({
		store,
		deleteObject: async (key) => void deleted.push(key),
		now: PURGE_NOW,
		what: 'build',
	});
	assert.deepEqual(result, { deleted: 2, failed: 0 });
	assert.deepEqual(store.rows.map((r) => r.id).sort(), [
		'lone-old',
		'newest-delivery',
		'newest-publish',
		'old-kept',
		'young',
		'young-older',
	]);
	assert.equal(deleted.length, 2);

	store.rows.push(buildRow('next', 0));
	const later = await purgeExpired({ store, deleteObject: async () => undefined, now: PURGE_NOW });
	assert.deepEqual(later, { deleted: 1, failed: 0 }, 'a newer build frees the old newest');
	assert.ok(!store.rows.some((r) => r.id === 'newest-publish'));
	assert.ok(store.rows.some((r) => r.id === 'next'));
});

test('9. a tie on the time keeps the higher id, like the SQL', () => {
	const at = ago(30).toISOString();
	const a = { id: 'a', gameKey: 'g', kind: 'publish' as const, registeredAt: at, keep: false };
	const b = { ...a, id: 'b' };
	assert.equal(buildPurgeable(a, [a, b], PURGE_NOW), true);
	assert.equal(buildPurgeable(b, [a, b], PURGE_NOW), false);
});

test('2. a token names its game; a token from before games existed verifies with none', () => {
	const signed = (payload: Record<string, unknown>) => {
		const input = `v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
		return `${input}.${createHmac('sha256', SECRET).update(input).digest('base64url')}`;
	};
	const iat = NOW / 1000;
	const base = { v: 1, typ: 'perf', aud: 'profiler', sid: 's', client: 'acme', project: 'slots' };
	const old = { ...base, uid: 'u', label: null, iat, exp: iat + 60 };
	assert.equal(verifyCaptureToken(SECRET, signed(old), NOW)?.game, null, 'pre-P2 token');
	assert.equal(
		verifyCaptureToken(SECRET, signed({ ...old, game: 7 }), NOW),
		null,
		'a non-key game',
	);
	assert.equal(
		verifyCaptureToken(SECRET, signed({ ...old, game: '' }), NOW),
		null,
		'an empty game',
	);
	const minted = verifyCaptureToken(SECRET, mintCaptureToken(SECRET, CLAIMS, NOW), NOW);
	assert.equal(minted?.game, 'slotsbuild');
});

test("7. a build records under its own project's game, or a delivery under a key no game holds", () => {
	assert.equal(gameKeyRefusal('publish', 'slots', 'slots'), null);
	assert.equal(gameKeyRefusal('delivery', 'slots', 'slots'), null);
	assert.equal(gameKeyRefusal('delivery', undefined, 'slots'), null, 'a game only ever delivered');
	assert.match(gameKeyRefusal('publish', undefined, 'slots') ?? '', /publish registers it/);
	assert.match(gameKeyRefusal('publish', 'other', 'slots') ?? '', /another project/);
	assert.match(gameKeyRefusal('delivery', 'other', 'slots') ?? '', /another project/);
	assert.ok(gameKeyRefusal('delivery', null, 'slots'), "a global card is no project's line");
});

test("8. a reading that names its game joins only that game's builds", () => {
	const build = { build: '12', engineSha: 'abcdef1234567890', gameKey: 'slotsbuild' };
	const reading = { buildVersion: '12', buildSha: 'abcdef1' };
	assert.ok(readingOnBuild({ ...reading, gameKey: 'slotsbuild' }, build));
	assert.ok(
		!readingOnBuild({ ...reading, gameKey: 'otherbuild' }, build),
		'same stamp, other game',
	);
	assert.ok(readingOnBuild({ ...reading, gameKey: null }, build), 'no game: the stamp alone');
});

test('4. a reading or build file no row names is swept after a day; the rest stay', async () => {
	const reports = 'acme/slots/perf/reports/';
	const builds = 'acme/slots/perf/builds/';
	const old = PURGE_NOW.getTime() - STALE_UPLOAD_MS - 1;
	const objects: Record<string, { key: string; size: number; lastModified: number }[]> = {
		[reports]: [
			{ key: `${reports}orphan.json`, size: 10, lastModified: old },
			{ key: `${reports}kept.json`, size: 10, lastModified: old },
			{ key: `${reports}young.json`, size: 10, lastModified: PURGE_NOW.getTime() - 60_000 },
		],
		[builds]: [
			{ key: `${builds}g/v1-a.json`, size: 10, lastModified: old },
			{ key: 'acme/slots/perf/uploads/x.json', size: 10, lastModified: old },
		],
	};
	const asked: string[][] = [];
	const deleted: string[] = [];
	const swept = await sweepOrphanFiles({
		prefixes: [reports, builds],
		listObjects: async (prefix) => objects[prefix] ?? [],
		registered: async (keys) => {
			asked.push(keys);
			return new Set(keys.filter((k) => k.endsWith('kept.json')));
		},
		deleteObject: async (key) => void deleted.push(key),
		now: PURGE_NOW,
	});
	assert.equal(swept, 2);
	assert.deepEqual(deleted, [`${reports}orphan.json`, `${builds}g/v1-a.json`]);
	assert.ok(!asked.flat().some((k) => k.includes('young')), 'a young file is never looked up');
	assert.ok(!asked.flat().some((k) => k.includes('/uploads/')), 'only under its own prefix');
});

// ── P3: budgets ──

const phaseOf = (frames: number, fps: number, p95: number) => ({
	frames,
	fps,
	p50: 16.7,
	p95,
	hitches: 0,
});

/** A list item as the page holds it, as shipped, on build 12. */
const reading = (over: Partial<PerfReportListItem> = {}): PerfReportListItem => ({
	id: 'r',
	capturedAt: '2026-11-17T10:00:00.000Z',
	source: 'capture',
	label: null,
	gameKey: 'slots',
	deviceClass: 'phone',
	gpu: 'Mali-G52 MC2',
	uaFamily: null,
	dpr: 2,
	canvas: null,
	buildVersion: '12',
	buildSha: 'abcdef1',
	runtimeRelease: null,
	flags: {},
	kind: null,
	phaseSet: 'slot',
	idle: phaseOf(600, 59.8, 17.4),
	spinning: phaseOf(300, 56, 19),
	round: phaseOf(900, 57, 19.5),
	menu: null,
	play: null,
	capped30: false,
	drawsMean: 80,
	textureMb: 90,
	counts: null,
	keep: false,
	expiresAt: null,
	...over,
});

const verdictOf = (ms: MetricVerdict[], metric: string, phase = '') =>
	ms.find((m) => m.metric === metric && m.phase === phase)?.verdict;

test('10. the studio defaults are the owner’s numbers, each warn inside its fail line', () => {
	const eff = effectiveBudgets([]);
	const get = (deviceClass: string, metric: string, phase = '') =>
		eff.find((b) => b.deviceClass === deviceClass && b.metric === metric && b.phase === phase);
	assert.deepEqual(
		[get('phone', 'fps', 'idle')?.fail, get('phone', 'fps', 'spinning')?.fail],
		[55, 50],
		'phone: 60 fps idle (a 60 Hz display reads 59.x), ≥ 50 spinning',
	);
	assert.equal(get('phone', 'p95', 'spinning')?.fail, 25);
	assert.deepEqual(
		[get('desktop', 'fps', 'idle')?.fail, get('desktop', 'fps', 'spinning')?.fail],
		[55, 55],
		'desktop: 60 / 60',
	);
	assert.equal(get('all', 'shippedMb')?.fail, 25);
	assert.equal(get('phone', 'gpuMb')?.fail, 150);
	assert.equal(get('desktop', 'gpuMb')?.fail, null, 'no GPU line on desktop');
	assert.equal(get('phone', 'draws')?.fail, null, 'draws has no default');
	for (const s of STUDIO_BUDGETS) {
		assert.equal(budgetRefusal(s.metric, s), null, `${budgetKeyId(s)} is a valid line`);
		assert.ok(s.warn !== null && s.fail !== null && s.warn !== s.fail, 'a real warn band');
		assert.ok(isBudgetKey(s), `${budgetKeyId(s)} is a key the page lists`);
	}
	assert.ok(!isBudgetKey({ deviceClass: 'all', metric: 'fps', phase: 'idle' }));
	assert.ok(!isBudgetKey({ deviceClass: 'phone', metric: 'shippedMb', phase: '' }));
});

test('10. a project override replaces one line; reset (no row) falls back to the default', () => {
	const override: BudgetOverride = {
		deviceClass: 'phone',
		metric: 'fps',
		phase: 'spinning',
		warn: 45,
		fail: 40,
		rev: 7,
		updatedAt: '2026-11-17T10:00:00.000Z',
		updatedBy: null,
	};
	const eff = effectiveBudgets([override]);
	const line = eff.find((b) => budgetKeyId(b) === 'phone:fps:spinning');
	assert.deepEqual([line?.warn, line?.fail, line?.studio?.fail], [45, 40, 50]);
	assert.equal(line?.override?.rev, 7);
	const other = eff.find((b) => budgetKeyId(b) === 'tablet:fps:spinning');
	assert.equal(other?.fail, 50, 'another class keeps the default');
	const reset = effectiveBudgets([]).find((b) => budgetKeyId(b) === 'phone:fps:spinning');
	assert.deepEqual([reset?.fail, reset?.override], [50, null]);
});

test('10. a line is refused unless it is in range and its warn is on the good side', () => {
	assert.equal(budgetRefusal('fps', { warn: 58, fail: 55 }), null);
	assert.match(budgetRefusal('fps', { warn: 50, fail: 55 }) ?? '', /at or above/);
	assert.match(budgetRefusal('p95', { warn: 30, fail: 25 }) ?? '', /at or below/);
	assert.match(budgetRefusal('fps', { warn: null, fail: null }) ?? '', /warn or a fail/);
	assert.match(budgetRefusal('fps', { warn: null, fail: 600 }) ?? '', /between/);
	assert.match(budgetRefusal('shippedMb', { warn: Number.NaN, fail: 25 }) ?? '', /between/);
	assert.equal(budgetRefusal('shippedMb', { warn: null, fail: 25 }), null, 'a fail line alone');
});

test('11. pass, warn and fail on both sides of a line', () => {
	const fps = { warn: 58, fail: 55 };
	assert.equal(judge('fps', 59.8, fps), 'pass');
	assert.equal(judge('fps', 58, fps), 'pass', 'on the line passes');
	assert.equal(judge('fps', 56, fps), 'warn');
	assert.equal(judge('fps', 54.9, fps), 'fail');
	const ms = { warn: 20, fail: 25 };
	assert.equal(judge('p95', 19, ms), 'pass');
	assert.equal(judge('p95', 22, ms), 'warn');
	assert.equal(judge('p95', 25.1, ms), 'fail');
	assert.equal(judge('p95', 30, { warn: null, fail: 25 }), 'fail', 'no warn band');
	assert.equal(judge('p95', 22, { warn: 20, fail: null }), 'warn', 'never fails');
	assert.equal(judge('p95', null, ms), 'nodata');
	assert.equal(judge('draws', 999, undefined), 'none', 'no budget, not judged');
});

test('11. a phase with too few frames says "not enough data", never pass', () => {
	const eff = effectiveBudgets([]);
	const short = reading({
		spinning: phaseOf(MIN_PHASE_FRAMES - 1, 60, 16),
		round: null,
	});
	const ms = evaluateReadings('phone', [short], eff);
	assert.equal(verdictOf(ms, 'fps', 'spinning'), 'nodata');
	assert.equal(verdictOf(ms, 'p95', 'spinning'), 'nodata');
	assert.equal(verdictOf(ms, 'fps', 'round'), 'nodata', 'no round at all');
	assert.equal(verdictOf(ms, 'fps', 'idle'), 'pass');
	assert.equal(worstVerdict(ms.map((m) => m.verdict)), 'nodata', 'the reading is not a pass');
	const enough = evaluateReadings('phone', [reading()], eff);
	assert.equal(worstVerdict(enough.map((m) => m.verdict)), 'pass');
	assert.equal(verdictOf(enough, 'draws'), 'none', 'draws unbudgeted by default');
});

test('11. a device group is judged on the median of its readings, as shipped only', () => {
	const eff = effectiveBudgets([]);
	const group = [
		reading({ id: 'a', spinning: phaseOf(300, 30, 40) }),
		reading({ id: 'b', spinning: phaseOf(300, 56, 19) }),
		reading({ id: 'c', spinning: phaseOf(300, 57, 19) }),
	];
	const ms = evaluateReadings('phone', group, eff);
	assert.equal(
		verdictOf(ms, 'fps', 'spinning'),
		'pass',
		'one bad reading does not fail the device',
	);
	const twoBad = [...group, reading({ id: 'd', spinning: phaseOf(300, 31, 40) })];
	const ms2 = evaluateReadings('phone', twoBad, eff);
	assert.equal(verdictOf(ms2, 'fps', 'spinning'), 'fail', 'half bad is bad (median 43.5)');
	const groups = deviceGroups(
		[
			reading({ id: 'p1' }),
			reading({ id: 'p2', gpu: 'Adreno 610', spinning: phaseOf(300, 40, 30) }),
			reading({ id: 'x', flags: { particles: 'off' }, spinning: phaseOf(300, 10, 90) }),
			reading({
				id: 'd1',
				deviceClass: 'desktop',
				gpu: 'RTX 3060',
				spinning: phaseOf(300, 59.9, 17),
				round: phaseOf(900, 59.9, 17),
			}),
			reading({ id: 'u', deviceClass: 'watch' }),
		],
		eff,
	);
	assert.deepEqual(
		groups.map((g) => [g.deviceClass, g.gpu, g.verdict, g.readings.map((r) => r.id).join()]),
		[
			['phone', 'Adreno 610', 'fail', 'p2'],
			['phone', 'Mali-G52 MC2', 'pass', 'p1'],
			['desktop', 'RTX 3060', 'pass', 'd1'],
		],
		'the worst first; a test-switch reading and an unknown class are left out',
	);
});

test('12. a build: size and GPU from its breakdown, each device class from its readings', () => {
	const MB = 1048576;
	const build = {
		id: 'b12',
		gameKey: 'slots',
		build: '12',
		engineSha: 'abcdef1234567890',
		kind: 'publish',
		shippedBytes: 22 * MB,
		gpuBytes: 160 * MB,
	} as PerfBuildListItem;
	const eff = effectiveBudgets([]);
	const v = evaluateBuild(
		build,
		[
			reading({ id: 'p' }),
			reading({ id: 'd', deviceClass: 'desktop', spinning: phaseOf(300, 50, 30) }),
			reading({ id: 'other', buildVersion: '11', deviceClass: 'tablet' }),
			reading({ id: 'flag', deviceClass: 'tablet', flags: { fx: '0' } }),
		],
		eff,
	);
	assert.equal(v.shipped, 'warn', '22 MB: over the 20 MB warn, under the 25 MB fail');
	assert.equal(v.gpu, 'fail', '160 MB estimate over the phone line');
	assert.deepEqual(v.devices.phone, { verdict: 'pass', readings: 1 });
	assert.deepEqual(v.devices.desktop, { verdict: 'fail', readings: 1 });
	assert.equal(v.devices.tablet, null, 'another build and a test switch do not count');
	const mixed = evaluateBuild(
		build,
		[
			reading({ id: 'iphone', gpu: 'Apple GPU', spinning: phaseOf(300, 59.9, 17) }),
			reading({ id: 'mali', spinning: phaseOf(300, 53, 22) }),
		],
		eff,
	);
	assert.deepEqual(
		mixed.devices.phone,
		{ verdict: 'warn', readings: 2 },
		'a class takes its worst GPU — a strong phone does not average a weak one away',
	);
	const none = evaluateBuild({ ...build, gpuBytes: 0, shippedBytes: 3 * MB }, [], eff);
	assert.equal(none.gpu, 'nodata', 'no estimate is no data, not a 0 MB pass');
	assert.equal(none.shipped, 'pass');
	const unsized = evaluateBuild({ ...build, shippedBytes: 0 }, [], eff);
	assert.equal(unsized.shipped, 'nodata', 'a breakdown with no size is no data, not a 0 MB pass');
	const relaxed = effectiveBudgets([
		{
			deviceClass: 'all',
			metric: 'shippedMb',
			phase: '',
			warn: 30,
			fail: 40,
			rev: 1,
			updatedAt: '',
			updatedBy: null,
		},
	]);
	assert.equal(evaluateBuild(build, [], relaxed).shipped, 'pass', 'the override is used');
});

test('11. a device row opens into its readings build by build, newest first', () => {
	const eff = effectiveBudgets([]);
	const b12 = { id: 'b12', gameKey: 'slots', build: '12', engineSha: 'abcdef1', kind: 'publish' };
	const rows = readingsByBuild(
		{
			deviceClass: 'phone',
			readings: [
				reading({ id: 'a', capturedAt: '2026-11-17T09:00:00.000Z' }),
				reading({ id: 'b', capturedAt: '2026-11-17T11:00:00.000Z', buildVersion: '13' }),
				reading({ id: 'c', capturedAt: '2026-11-17T08:00:00.000Z', buildVersion: null }),
				reading({
					id: 'd',
					capturedAt: '2026-11-17T10:00:00.000Z',
					spinning: phaseOf(300, 40, 30),
				}),
			],
		},
		[b12 as PerfBuildListItem],
		eff,
	);
	assert.deepEqual(
		rows.map((r) => [r.label, r.readings.map((x) => x.id).join(), r.verdict]),
		[
			['v13', 'b', 'pass'],
			['v12', 'a,d', 'fail'],
			['No build stamp', 'c', 'pass'],
		],
		'v12: the median of 56 and 40 spinning fps is 48, under the 50 fail line',
	);
});

test('13. a reading carries its per-phase counts', () => {
	const report = {
		...REPORT,
		work: {
			idle: {
				frames: 600,
				perFrame: { draws: { mean: 30, max: 40 }, calls: { mean: 210, max: 300 } },
			},
			spinning: {
				frames: 300,
				perFrame: {
					draws: { mean: 88, max: 120 },
					passes: { mean: 2, max: 3 },
					textureUploads: { mean: 0.4, max: 6 },
					calls: { mean: 640, max: 900 },
					jsMs: { mean: 6.1, max: 14 },
				},
			},
			round: { frames: 0, perFrame: {} },
		},
	};
	const r = summarizePerfReport(report);
	assert.ok(r.ok);
	assert.deepEqual(r.summary.counts, {
		idle: { frames: 600, draws: 30, passes: null, textureUploads: null, calls: 210, jsMs: null },
		spinning: { frames: 300, draws: 88, passes: 2, textureUploads: 0.4, calls: 640, jsMs: 6.1 },
		textureMb: 46.8,
	});
	assert.deepEqual(perfCounts('junk'), { idle: null, spinning: null, textureMb: null });
});

test('13. a lab token is the lab opener’s only, and verifies as lab', () => {
	const lab = { ...CLAIMS, uid: LAB_OPENER, lab: 'ci-fingerprint' };
	const token = mintCaptureToken(SECRET, lab, NOW, 7200);
	const claims = verifyCaptureToken(SECRET, token, NOW + 1000);
	assert.equal(claims?.lab, 'ci-fingerprint');
	assert.equal(claims?.exp, NOW / 1000 + 7200);
	assert.equal(verifyCaptureToken(SECRET, token, NOW + 7200 * 1000), null, 'two hours only');
	assert.equal(
		verifyCaptureToken(SECRET, mintCaptureToken(SECRET, CLAIMS, NOW), NOW)?.lab,
		undefined,
	);
	// A person's id never verifies as lab, and the lab opener never verifies as a person.
	assert.equal(
		verifyCaptureToken(
			SECRET,
			mintCaptureToken(SECRET, { ...CLAIMS, lab: 'ci-fingerprint' }, NOW),
			NOW,
		),
		null,
	);
	assert.equal(
		verifyCaptureToken(SECRET, mintCaptureToken(SECRET, { ...CLAIMS, uid: LAB_OPENER }, NOW), NOW),
		null,
	);
	assert.equal(
		verifyCaptureToken(
			SECRET,
			mintCaptureToken(SECRET, lab, NOW, 10 * CAPTURE_SESSION_TTL_SECONDS),
			NOW,
		)?.exp,
		NOW / 1000 + CAPTURE_SESSION_TTL_SECONDS,
		'never longer than a capture',
	);
});

test('13. a lab reading compares with the previous lab reading of its game and switches', () => {
	const counts = (draws: number, jsMs = 5) => ({
		idle: null,
		spinning: { frames: 300, draws, passes: 2, textureUploads: 0.2, calls: 600, jsMs },
		textureMb: 40,
	});
	const at = (h: number) => new Date(Date.UTC(2026, 10, 17, h)).toISOString();
	const r = (id: string, h: number, extra: Partial<LabReadingLike> = {}): LabReadingLike => ({
		id,
		capturedAt: at(h),
		source: 'lab',
		gameKey: 'slots',
		flags: {},
		counts: counts(80),
		...extra,
	});
	const items = [
		r('now', 5),
		r('phone', 4, { source: 'capture' }),
		r('other-game', 4, { gameKey: 'other' }),
		r('switched', 4, { flags: { particles: 'off' } }),
		r('before', 3),
		r('older', 1),
	];
	assert.equal(previousLabReading(items, items[0])?.id, 'before');
	assert.equal(previousLabReading(items, items[5]), null, 'the first has none');
	assert.equal(previousLabReading(items, items[1]), null, 'a phone reading is not compared');
	const rows = labComparison(counts(95, 7), counts(80, 5));
	const draws = rows.find((x) => x.phase === 'spinning' && x.key === 'draws');
	assert.deepEqual([draws?.delta, draws?.changed], [15, true]);
	const js = rows.find((x) => x.key === 'jsMs');
	assert.equal(js?.changed, false, 'JS ms within its wide band');
	assert.ok(rows.some((x) => x.phase === 'all' && x.key === 'textureMb' && !x.changed));
	assert.ok(labComparison(counts(80), null).every((x) => x.delta === null && !x.changed));
	assert.ok(
		withinLabTolerance('spinning', 'draws', 0.5, 0),
		'a near-zero count has an absolute floor',
	);
	// Three runs of one build (status, "Lab runs"): within their phase's band, never flagged.
	assert.ok(withinLabTolerance('idle', 'draws', 46.5, 37.4), 'idle draws follow the deal');
	assert.ok(withinLabTolerance('spinning', 'calls', 193.6, 191.1));
	// Two CI runs of bookofborutremake (2026-11-18): the first hit two big-win holds.
	assert.ok(withinLabTolerance('idle', 'passes', 4.5, 6.2), 'idle passes follow the holds');
	assert.ok(withinLabTolerance('idle', 'calls', 153.2, 171.4));
	assert.ok(!withinLabTolerance('spinning', 'draws', 40, 36.4), 'a 10% spinning draw change shows');
});
// ── perf: 8: budgets per phase set, the browser cap ──

const arcadeReading = (over: Partial<PerfReportListItem> = {}): PerfReportListItem =>
	reading({
		kind: 'arcade',
		phaseSet: 'arcade',
		idle: null,
		spinning: null,
		round: null,
		menu: phaseOf(400, 59.9, 17),
		play: phaseOf(1800, 57, 19),
		...over,
	});

test('10. the arcade phases have studio lines by analogy: menu as idle, play as spinning', () => {
	const eff = effectiveBudgets([]);
	const get = (deviceClass: string, metric: string, phase: string) => {
		const b = eff.find(
			(x) => x.deviceClass === deviceClass && x.metric === metric && x.phase === phase,
		);
		return [b?.warn, b?.fail];
	};
	for (const c of ['phone', 'tablet']) {
		assert.deepEqual(get(c, 'fps', 'menu'), get(c, 'fps', 'idle'), `${c}: menu fps = idle's`);
		assert.deepEqual(get(c, 'fps', 'menu'), [58, 55]);
		assert.deepEqual(get(c, 'fps', 'play'), [55, 50], `${c}: play fps = spinning's`);
	}
	for (const c of ['phone', 'tablet', 'desktop']) {
		for (const phase of ['menu', 'play']) assert.deepEqual(get(c, 'p95', phase), [20, 25]);
	}
	assert.deepEqual(
		[get('desktop', 'fps', 'menu'), get('desktop', 'fps', 'play')],
		[
			[58, 55],
			[58, 55],
		],
	);
	assert.deepEqual(
		[phaseSetOf('arcade'), phaseSetOf('slot'), phaseSetOf('lines'), phaseSetOf(null)],
		['arcade', 'slot', 'slot', 'slot'],
	);
});

test('10. the Budgets tab lists its game kind’s phases, plus any phase overridden', () => {
	const play: BudgetOverride = {
		deviceClass: 'phone',
		metric: 'fps',
		phase: 'play',
		warn: 45,
		fail: 40,
		rev: 3,
		updatedAt: '',
		updatedBy: null,
	};
	const eff = effectiveBudgets([play]);
	const shown = (set: 'slot' | 'arcade', deviceClass = 'phone') => [
		...new Set(
			budgetLinesFor(eff, set)
				.filter((b) => b.deviceClass === deviceClass && b.metric === 'fps')
				.map((b) => b.phase),
		),
	];
	assert.deepEqual(shown('arcade'), ['menu', 'play']);
	assert.deepEqual(shown('slot'), ['idle', 'spinning', 'round', 'play'], 'an override still shows');
	assert.deepEqual(shown('slot', 'tablet'), ['idle', 'spinning', 'round']);
	assert.ok(
		budgetLinesFor(eff, 'arcade').some((b) => b.metric === 'shippedMb'),
		'not per phase',
	);
});

test('11. a reading is judged on its own phase set only', () => {
	const eff = effectiveBudgets([]);
	const ms = evaluateReadings('phone', [arcadeReading({ play: phaseOf(1800, 52, 21) })], eff);
	assert.deepEqual([...new Set(ms.filter((m) => m.phase).map((m) => m.phase))], ['menu', 'play']);
	assert.equal(verdictOf(ms, 'fps', 'play'), 'warn', '52 fps: under the 55 warn line');
	assert.equal(verdictOf(ms, 'fps', 'menu'), 'pass');
	const slot = evaluateReadings('phone', [reading()], eff);
	assert.ok(slot.every((m) => m.phase !== 'menu' && m.phase !== 'play'));
	assert.equal(
		worstVerdict(slot.map((m) => m.verdict)),
		'pass',
		'a slot device never reads "not enough data" off an arcade line',
	);
	assert.equal(
		worstVerdict(evaluateReadings('phone', [arcadeReading()], eff).map((m) => m.verdict)),
		'pass',
		'nor an arcade device off a slot line',
	);
	const groups = deviceGroups([arcadeReading({ id: 'a' }), reading({ id: 's' })], eff);
	assert.equal(groups.length, 1, 'one device');
	assert.deepEqual(
		[...new Set(groups[0].metrics.filter((m) => m.phase).map((m) => m.phase))],
		['idle', 'spinning', 'round', 'menu', 'play'],
		'a device with both kinds of reading is judged on both sets',
	);
});

test('11. a reading at a browser’s 30 fps cap is never an fps failure; its draws and MB count', () => {
	const eff = effectiveBudgets([]);
	const capped = reading({
		id: 'cap',
		capped30: true,
		idle: phaseOf(5000, 30, 33.4),
		spinning: phaseOf(300, 30, 33.4),
		round: phaseOf(900, 30, 33.4),
		drawsMean: 120,
		textureMb: 170,
	});
	const ms = evaluateReadings('phone', [capped], eff);
	for (const m of ms.filter((x) => x.metric === 'fps' || x.metric === 'p95')) {
		assert.equal(m.verdict, 'nodata', `${m.metric} ${m.phase}: the browser's rate, not judged`);
	}
	assert.equal(verdictOf(ms, 'gpuMb'), 'fail', 'its texture MB still counts');
	assert.equal(ms.find((m) => m.metric === 'draws')?.value, 120, 'its draws still count');
	const uncapped = evaluateReadings('phone', [{ ...capped, capped30: false }], eff);
	assert.equal(verdictOf(uncapped, 'fps', 'idle'), 'fail', 'the cap is what spares it');
	const mixed = evaluateReadings('phone', [capped, reading({ id: 'ok' })], eff);
	assert.equal(verdictOf(mixed, 'fps', 'idle'), 'pass', 'judged on the uncapped reading alone');
	assert.equal(mixed.find((m) => m.metric === 'fps' && m.phase === 'idle')?.frames, 600);
	const v = evaluateBuild(
		{
			id: 'b',
			gameKey: 'slots',
			build: '12',
			engineSha: 'abcdef1',
			kind: 'publish',
		} as PerfBuildListItem,
		[{ ...capped, textureMb: 90 }],
		eff,
	);
	assert.equal(v.devices.phone?.verdict, 'nodata', 'a capped reading never fails a build’s phones');
});

test('13. an arcade reading’s menu and play counts; their lab band is idle’s', () => {
	assert.deepEqual(LAB_TOLERANCE.menu, LAB_TOLERANCE.idle, 'not measured yet: the widest band');
	assert.deepEqual(LAB_TOLERANCE.play, LAB_TOLERANCE.idle);
	const s = summarizePerfReport(ARCADE_REPORT);
	assert.ok(s.ok);
	const now = s.summary.counts;
	const before = { ...now, play: now.play && { ...now.play, draws: 28, simMs: 9 } };
	const rows = labComparison(now, before);
	assert.deepEqual(
		[...new Set(rows.map((x) => x.phase))],
		['menu', 'play', 'all'],
		'compared on its own set',
	);
	const draws = rows.find((x) => x.phase === 'play' && x.key === 'draws');
	assert.deepEqual([draws?.delta, draws?.changed], [12, true], '28 → 40: past ±35%');
	assert.ok(
		rows.every((x) => !(ARCADE_COUNT_KEYS as readonly string[]).includes(x.key)),
		'sim and room counts are for Compare, never lab-judged',
	);
});
import './check-profiler-findings.ts';
import './check-profiler-bugs.ts';
