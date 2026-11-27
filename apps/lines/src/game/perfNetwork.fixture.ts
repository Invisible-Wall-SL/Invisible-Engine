/**
 * Offline fixture for the `?perf=1` probe's network block (`perfNetwork.ts`). Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/perfNetwork.fixture.ts
 * (`check:profiler` gate 19 runs the same module in CI.)
 *
 * Pins, over hand-built Resource Timing entries:
 *   1. a file is named by its path: the query and the hash never reach the block (`perfsession`,
 *      `sid`, `k`), a token path segment reads `…`, and the host is named only off the page's origin;
 *   2. each file's class, from its extension or what asked for it, and the RGS's requests;
 *   3. a cache hit, a revalidation, a body over the network, and a cross-origin file that hides its
 *      sizes: "size unknown" (null), counted apart and never as 0 bytes;
 *   4. totals by class and by load stage (before the first frame, the boot load, after it);
 *   5. the RGS's latency percentiles, a path fetched twice, the room's traffic a second;
 *   6. the caps: the file list keeps the heaviest {@link FILES_KEPT}, the short form keeps only the
 *      heaviest, and a 400-file page's block stays a few tens of KB.
 */

import {
	CODES_KEPT,
	FILES_KEPT,
	HEAVIEST_KEPT,
	OTHER_CODE,
	classOf,
	createNetworkMonitor,
	messageLabel,
	networkLines,
	safeUrl,
	socketStats,
	tallyCode,
	type CodeTally,
	type ResourceLike,
} from './perfNetwork';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}: got ${a}, expected ${e}`);
	}
};

const PAGE = 'https://games.invisiblewall.org';
const entry = (name: string, over: Partial<ResourceLike> = {}): ResourceLike => ({
	name,
	initiatorType: 'fetch',
	startTime: 100,
	duration: 50,
	transferSize: 10_300,
	encodedBodySize: 10_000,
	decodedBodySize: 10_000,
	...over,
});

console.log('1. paths only');
const token = 'eyJ2IjoxLCJ0eXAiOiJwZXJmIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
check(
	'the capture token and the read token in the query are dropped',
	safeUrl(`${PAGE}/bookofborut/?perf=1&perfsession=${token}&k=secret#x`, PAGE),
	{ path: '/bookofborut/', rgsQuery: false },
);
check(
	'the RGS session id is read as a key, never kept',
	safeUrl(`${PAGE}/api/borut/rgs/engine?sid=abc123&seq=4&gid=g1`, PAGE),
	{ path: '/api/borut/rgs/engine', rgsQuery: true },
);
check(
	'the deploy tree token segment is redacted, the host named',
	safeUrl(
		'https://app.invisiblewall.org/api/deploy/f/short-token/iw/borut/editor-art/bg.webp?v=3',
		PAGE,
	),
	{
		path: '/api/deploy/f/…/iw/borut/editor-art/bg.webp',
		host: 'app.invisiblewall.org',
		rgsQuery: false,
	},
);
check(
	'a JWT-like or hex segment is redacted; a hashed file name or a long folder name is not',
	[
		safeUrl(`${PAGE}/x/plain/${token}`, PAGE).path,
		safeUrl(`${PAGE}/x/4f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d/y`, PAGE).path,
		safeUrl(`${PAGE}/_app/immutable/chunks/Dk3jA9_x.js`, PAGE).path,
		safeUrl(`${PAGE}/assets/spines/foregroundFeatureAnimation/mm_bg_feature.json`, PAGE).path,
	],
	[
		'/x/plain/…',
		'/x/…/y',
		'/_app/immutable/chunks/Dk3jA9_x.js',
		'/assets/spines/foregroundFeatureAnimation/mm_bg_feature.json',
	],
);
/** 32 characters, no digit: the ~0.8% of `mintReadToken` tokens the shape guess cannot see. */
const digitless = 'kQwErTyUiOpAsDfGhJkLzXcVbNmQwErT';
/** The shared deploy token: an operator's `EDITOR_DOC_SECRET`, any format. */
const secret = 'correct horse battery staple';
check(
	'a token-bearing route redacts by position, whatever the token looks like',
	[
		safeUrl(`https://app.invisiblewall.org/api/published/f/${digitless}/borut/s7/a.webp`, PAGE)
			.path,
		safeUrl(`https://app.invisiblewall.org/api/deploy/f/${encodeURIComponent(secret)}/iw/b`, PAGE)
			.path,
		safeUrl(`https://app.invisiblewall.org/api/published/f/${secret}/borut/s7/a.webp`, PAGE).path,
		safeUrl(`https://app.invisiblewall.org/play/${digitless}`, PAGE).path,
		safeUrl(`https://app.invisiblewall.org/profiler/go/link-1/${digitless}`, PAGE).path,
		safeUrl(`https://app.invisiblewall.org/api/deploy/f//${digitless}/x`, PAGE).path,
		safeUrl(`https://app.invisiblewall.org//api/published/f/${digitless}/x`, PAGE).path,
	],
	[
		'/api/published/f/…/borut/s7/a.webp',
		'/api/deploy/f/…/iw/b',
		'/api/published/f/…/borut/s7/a.webp',
		'/play/…',
		'/profiler/go/…/…',
		'/api/deploy/f/…/x',
		'/api/published/f/…/x',
	],
);
/** A browser's timing entry: its fields are prototype getters, so a spread of it copies nothing. */
class NavigationEntry {
	get name() {
		return `${PAGE}/borut/?perf=1&perfsession=${token}&sessionID=lab-1`;
	}
	get initiatorType() {
		return 'navigation';
	}
	get type() {
		return 'reload';
	}
	get startTime() {
		return 0;
	}
	get duration() {
		return 300;
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
const monitor = createNetworkMonitor(PAGE, 1764158400123.4);
monitor.navigation(new NavigationEntry());
check(
	'the navigation entry is read through its getters',
	(({ navigation, totals, heaviest }) => [
		navigation,
		totals.bytes,
		heaviest[0].path,
		heaviest[0].class,
	])(monitor.block()),
	['reload', 4000, '/borut/', 'document'],
);
monitor.add(
	entry(`${PAGE}/api/borut/rgs/engine?sid=player-sid&seq=1`, { startTime: 2000, duration: 120 }),
);
const leaked = JSON.stringify(monitor.block());
check(
	'no token, sid or query in the whole block',
	['perfsession', token, 'player-sid', 'sid=', 'sessionID', '?'].filter((s) => leaked.includes(s)),
	[],
);

console.log('2. classes');
check(
	'by extension, rig folders, the data API, what asked',
	[
		classOf('/a/x.webp', 'img'),
		classOf('/a/x.KTX2', 'fetch'),
		classOf('/a/sheet.json', 'fetch'),
		classOf('/a/spines/hero.json', 'fetch'),
		classOf('/a/hero.skel', 'fetch'),
		classOf('/a/x.atlas', 'fetch'),
		classOf('/a/music.mp3', 'fetch'),
		classOf('/a/f.woff2', 'css'),
		classOf('/_app/bundle.js', 'script'),
		classOf('/_app/x.css', 'link'),
		classOf('/api/editor/runtime', 'fetch'),
		classOf('/api/borut/rgs/engine', 'fetch'),
		classOf('/matchmake/joinOrCreate/race', 'xmlhttprequest'),
		classOf('/borut/', 'navigation'),
		classOf('/thing', 'other'),
		classOf('/af/2555e1/abc/30/l', 'css'),
	],
	[
		'image',
		'ktx2',
		'json',
		'rig',
		'rig',
		'json',
		'audio',
		'font',
		'js',
		'css',
		'json',
		'api',
		'api',
		'document',
		'other',
		'other',
	],
);

console.log('3. cache and unknown sizes');
const m = createNetworkMonitor(PAGE, 1);
m.add(
	entry(`${PAGE}/a/hit.webp`, { transferSize: 0, encodedBodySize: 5000, decodedBodySize: 5000 }),
);
m.add(
	entry(`${PAGE}/a/304.json`, {
		transferSize: 320,
		encodedBodySize: 8000,
		decodedBodySize: 40_000,
	}),
);
m.add(entry(`${PAGE}/a/net.webp`, { transferSize: 2_000_400, encodedBodySize: 2_000_000 }));
m.add(
	entry('https://cdn.partner.example/hidden.png', {
		transferSize: 0,
		encodedBodySize: 0,
		decodedBodySize: 0,
		duration: 900,
	}),
);
const b = m.block();
const byPath = (p: string) => b.files?.find((f) => f.path.endsWith(p));
check(
	'hit, revalidated, network, unknown',
	['hit.webp', '304.json', 'net.webp', 'hidden.png'].map((p) => byPath(p)?.cache),
	['hit', 'revalidated', 'network', 'unknown'],
);
check(
	'a hidden file is null-sized, not 0',
	[byPath('hidden.png')?.transfer, byPath('hidden.png')?.encoded],
	[null, null],
);
check(
	'totals: weight counts the cache hit, transfer does not, the hidden file is apart',
	b.totals,
	{
		files: 4,
		bytes: 5000 + 8000 + 2_000_000,
		transfer: 320 + 2_000_400,
		cachedBytes: 5000,
		cached: 1,
		revalidated: 1,
		unknown: 1,
	},
);
check(
	'heaviest first, the unknown last',
	b.heaviest.map((f) => f.path),
	['/a/net.webp', '/a/304.json', '/a/hit.webp', '/hidden.png'],
);
const empty = createNetworkMonitor(PAGE, 1);
empty.add(entry(`${PAGE}/api/ping`, { transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }));
check(
	'a same-origin empty answer is 0 bytes, known',
	[empty.block().totals.unknown, empty.block().totals.files],
	[0, 1],
);

console.log('4. stages');
const s = createNetworkMonitor(PAGE, 1);
s.add(
	entry(`${PAGE}/_app/bundle.js`, {
		initiatorType: 'script',
		startTime: 50,
		encodedBodySize: 700_000,
	}),
);
s.add(entry(`${PAGE}/api/editor/runtime`, { startTime: 400, encodedBodySize: 1_200_000 }));
s.add(
	entry(`${PAGE}/a/bg.webp`, { initiatorType: 'img', startTime: 1500, encodedBodySize: 900_000 }),
);
s.add(
	entry(`${PAGE}/a/fs.webp`, { initiatorType: 'img', startTime: 9000, encodedBodySize: 300_000 }),
);
check('before the first frame is known, all is boot', s.block().byStage.boot.files, 4);
s.firstFrame(1200, 'tick');
s.firstFrame(5000, 'paint');
s.booted(6000);
const staged = s.block();
check(
	'stage bytes',
	[staged.byStage.beforeFirstFrame.bytes, staged.byStage.boot.bytes, staged.byStage.play.bytes],
	[1_900_000, 900_000, 300_000],
);
check(
	'the first frame is the first noted',
	[staged.firstFrameMs, staged.firstFrameSource, staged.bootMs],
	[1200, 'tick', 6000],
);
check('by class', Object.keys(staged.byClass).sort(), ['image', 'js', 'json']);

console.log('5. RGS, repeats, the room');
const r = createNetworkMonitor(PAGE, 1);
for (let i = 1; i <= 20; i++) {
	r.add(
		entry(`${PAGE}/api/g/rgs/engine?sid=s&seq=${i}`, { duration: i * 10, startTime: 1000 * i }),
	);
}
r.add(entry(`${PAGE}/a/again.webp`, { startTime: 10 }));
r.add(entry(`${PAGE}/a/again.webp`, { startTime: 20 }));
r.add(entry(`${PAGE}/a/again.webp`, { startTime: 30, transferSize: 0 }));
const rb = r.block({
	socket: {
		since: 1000,
		last: 11_000,
		inMessages: 200,
		inBytes: 40_000,
		inLargest: 4096,
		states: 190,
		stateBytes: 38_000,
		outMessages: 300,
		outBytes: 3000,
		outLargest: 12,
	},
});
check(
	'RGS count, latency, bytes',
	[rb.rgs.requests, rb.rgs.ms, rb.rgs.bytes, rb.rgs.slowest[0].ms],
	[20, { count: 20, p50: 110, p95: 200, max: 200 }, 200_000, 200],
);
check('RGS requests stay out of the file list', rb.files?.filter((f) => f.rgs).length, 0);
check('a path downloaded twice (the cache hit is not a download)', rb.repeats, [
	{ path: '/a/again.webp', count: 2, bytes: 20_000 },
]);
check(
	'the room a second',
	[rb.socket?.seconds, rb.socket?.perSecond, rb.socket?.in.largest],
	[10, { inMessages: 20, inBytes: 4000, outMessages: 30, outBytes: 300 }, 4096],
);
check('no room traffic, no socket', 'socket' in createNetworkMonitor(PAGE, 1).block(), false);
check(
	'a tally with no per-kind data gives none (the perf: 9 shape)',
	[rb.socket?.byCode, rb.socket?.stateShare, rb.socket?.perStep],
	[undefined, undefined, undefined],
);

console.log('5b. room messages by kind, and sends per step (perf: 10)');
const text = (type: string, body = 3) => {
	const bytes = new Uint8Array(2 + type.length + body);
	bytes[0] = 13;
	bytes[1] = 0xa0 | type.length;
	for (let i = 0; i < type.length; i++) bytes[2 + i] = type.charCodeAt(i);
	return bytes;
};
check(
	'a state, a patch',
	[messageLabel(Uint8Array.of(14, 1)), messageLabel(Uint8Array.of(15, 1))],
	['state', 'patch'],
);
check('a room message by its type name', messageLabel(text('input')), 'input');
check('a room message by a number type', messageLabel(Uint8Array.of(13, 7, 1)), 'message 7');
check('another protocol code', messageLabel(Uint8Array.of(10, 1)), 'code 10');
check('a modifier bit does not change the code', messageLabel(Uint8Array.of(14 | 32, 1)), 'state');
const into: Record<string, CodeTally> = {};
for (let i = 0; i < 40; i++) tallyCode(into, `kind${i}`, 10);
tallyCode(into, 'kind0', 90);
check(
	'at most CODES_KEPT kinds, the rest one other, an old kind still counted',
	[Object.keys(into).length, into[OTHER_CODE].messages, into.kind0],
	[CODES_KEPT + 1, 40 - CODES_KEPT, { messages: 2, bytes: 100, largest: 90 }],
);
const inByCode: Record<string, CodeTally> = {};
const outByCode: Record<string, CodeTally> = {};
tallyCode(inByCode, 'patch', 600);
tallyCode(inByCode, 'patch', 400);
tallyCode(inByCode, 'events', 50);
for (let i = 0; i < 30; i++) tallyCode(outByCode, 'input', 10);
const kinds = socketStats({
	since: 0,
	last: 1000,
	inMessages: 3,
	inBytes: 1050,
	inLargest: 600,
	states: 2,
	stateBytes: 1000,
	outMessages: 30,
	outBytes: 300,
	outLargest: 10,
	inByCode,
	outByCode,
	steps: 15,
});
check(
	'bytes by kind, heaviest first, the state bytes against the rest, and sends per step',
	[kinds.byCode?.in.map((c) => c.code), kinds.byCode?.out[0], kinds.stateShare, kinds.perStep],
	[
		['patch', 'events'],
		{ code: 'input', messages: 30, bytes: 300, largest: 10 },
		{ stateBytes: 1000, otherBytes: 50 },
		{ steps: 15, outMessages: 2, outBytes: 20, inMessages: 0.2 },
	],
);

console.log('6. caps');
const big = createNetworkMonitor(PAGE, 1);
for (let i = 0; i < 400; i++) {
	big.add(
		entry(`${PAGE}/api/deploy/f/tok/iw/project-key/editor-art/sheets/page-${i}.webp`, {
			initiatorType: 'img',
			startTime: i * 5,
			encodedBodySize: 1000 + i,
		}),
	);
}
const full = big.block();
check(
	'the file list keeps the heaviest',
	[full.files?.length, full.filesDropped, full.files?.[0].encoded],
	[FILES_KEPT, 400 - FILES_KEPT, 1399],
);
const short = big.block({ short: true });
check(
	'the short form has no file list, its heaviest stay',
	['files' in short, short.heaviest.length],
	[false, HEAVIEST_KEPT],
);
const kb = (o: unknown) => Math.round(new Blob([JSON.stringify(o)]).size / 1024);
check(
	'a 400-file block is under 48 KB, its short form under 8 KB',
	[kb(full) < 48, kb(short) < 8],
	[true, true],
);
console.log(`     (full ${kb(full)} KB, short ${kb(short)} KB)`);
check('the readout lines', networkLines(staged), [
	'3.0 MB in 4 files · first frame 1.2 s after 1.8 MB · largest runtime 1.1 MB',
]);

console.log('7. a long soak stays bounded, and folding does not change the block');
/** One page's files and a soak of RGS polls, with the first frame and boot noted at `settleAt`. */
const soak = (settleAt: 'first' | 'afterFiles' | 'never') => {
	const m = createNetworkMonitor(PAGE, 1);
	const settle = () => {
		m.firstFrame(900, 'tick');
		m.booted(3000);
	};
	if (settleAt === 'first') settle();
	for (let i = 0; i < 1800; i++) {
		m.add(
			entry(`${PAGE}/assets/f-${i % 600}.webp`, {
				initiatorType: 'img',
				startTime: i * 2,
				encodedBodySize: 500 + i,
			}),
		);
	}
	if (settleAt === 'afterFiles') settle();
	for (let i = 0; i < 20_000; i++) {
		m.add(
			entry(`${PAGE}/api/borut/rgs/engine?sid=s&seq=${i}`, {
				startTime: 10_000 + i,
				duration: 20 + (i % 97),
			}),
		);
	}
	return m.block();
};
const early = soak('first');
check(
	'a block is the same whether the stages settled before the files or after them',
	early,
	soak('afterFiles'),
);
const never = soak('never');
check(
	'a game that never boots still counts every file, past the unsettled cap too',
	[never.totals.files, never.rgs.requests, never.files?.length],
	[21_800, 20_000, FILES_KEPT],
);
check(
	'every request counted; the percentiles say how many they cover; the list capped',
	[early.rgs.requests, early.rgs.ms.count, early.files?.length, early.filesDropped],
	[20_000, 4000, FILES_KEPT, 1800 - FILES_KEPT],
);
check(
	'totals count every file, and a path fetched twice is a repeat',
	[early.totals.files, early.byStage.play.files, early.repeats[0]?.count],
	[21_800, 20_000 + 300, 3],
);

if (failures) throw new Error(`perfNetwork.fixture: ${failures} check(s) failed`);
console.log('\nall perfNetwork checks passed');
