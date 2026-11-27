/**
 * NETWORK for the `?perf=1` probe (`PerfHud.svelte`): what the page downloaded since it loaded, how
 * heavy each file was, which came from the cache, what reached the page before its first frame,
 * and how the game's API traffic went — the RGS's requests and, online, the game server's room
 * messages (`arcadePerf.ts` `socket`, metered where the room's state patches already are). Read off
 * Resource Timing (`PerformanceObserver({ type: 'resource', buffered: true })`) and the navigation
 * entry; Reset does not clear it (it is the page's load, not a slice of frames).
 *
 * A file is named by its PATH only: the query and the hash are dropped, since tokens travel there
 * (`perfsession`, `sid`, `k`), and a path segment that is a token (by position under one of
 * {@link TOKEN_ROUTES}, or any long base64url/JWT-like segment) is replaced by `…`. Its host is
 * kept only when it is not the page's. A cross-origin response with no `Timing-Allow-Origin` reports
 * every size as 0: it is "size unknown" (`null`), never counted as 0 bytes.
 *
 * No import of the game, so `perfNetwork.fixture.ts` and the launcher's `check:profiler` run it in
 * Node on hand-built entries.
 */

export const NET_CLASSES = [
	'document',
	'js',
	'css',
	'image',
	'ktx2',
	'json',
	'rig',
	'audio',
	'font',
	'api',
	'other',
] as const;
export type NetClass = (typeof NET_CLASSES)[number];

/** Before the game's first frame; after it, while the game loads (`stateApp.loaded`); after that. */
export const NET_STAGES = ['beforeFirstFrame', 'boot', 'play'] as const;
export type NetStage = (typeof NET_STAGES)[number];

/**
 * `hit`: from the cache, nothing transferred. `revalidated`: only headers crossed (a 304).
 * `network`: the body crossed. `unknown`: a cross-origin response that hides its sizes.
 */
export type NetCache = 'hit' | 'revalidated' | 'network' | 'unknown';

/** The part of a `PerformanceResourceTiming` read here; a fixture builds these by hand. */
export interface ResourceLike {
	name: string;
	initiatorType: string;
	startTime: number;
	duration: number;
	transferSize?: number;
	encodedBodySize?: number;
	decodedBodySize?: number;
	/** Chrome 115+: `cache` for a response the cache served. */
	deliveryType?: string;
}

export interface NetFile {
	path: string;
	/** Only when it is not the page's host. */
	host?: string;
	/** `initiatorType`: what asked for it (`script`, `img`, `fetch`, `navigation`, …). */
	type: string;
	class: NetClass;
	stage: NetStage;
	/** ms since the page's navigation started. */
	start: number;
	ms: number;
	/** Bytes that crossed the network, headers included; null = size unknown. */
	transfer: number | null;
	/** The body as served (compressed); null = size unknown. */
	encoded: number | null;
	/** The body once decompressed; null = size unknown. */
	decoded: number | null;
	cache: NetCache;
	/** An RGS request (Play4Fun `/rgs/engine`, the Stake `/wallet/…` and `/bet/event` routes). */
	rgs?: true;
}

export interface NetTotals {
	files: number;
	/** The download weight: each known file's body as served, whether or not the cache served it. */
	bytes: number;
	/** What crossed the network this load (cache hits transfer nothing). */
	transfer: number;
	/** The weight of the files the cache served. */
	cachedBytes: number;
	/** Files served from the cache, and files only revalidated (a 304). */
	cached: number;
	revalidated: number;
	/** Files whose size the browser hides (cross-origin, no `Timing-Allow-Origin`): not counted. */
	unknown: number;
}

export interface MsStats {
	count: number;
	p50: number;
	p95: number;
	max: number;
}

export interface RgsStats {
	/** Every RGS request of the load; `ms` covers the first {@link RGS_SAMPLES_KEPT} (`ms.count`). */
	requests: number;
	/** Response bytes of the requests whose size is known. */
	bytes: number;
	unknown: number;
	largest: number;
	ms: MsStats;
	/** The slowest requests, slowest first. */
	slowest: { path: string; host?: string; start: number; ms: number }[];
}

/** The game server's room messages while the probe read (online arcade, `arcadePerf.ts`). */
export interface SocketTally {
	/** ms (page clock) the first message was metered, and the last. */
	since: number;
	last: number;
	inMessages: number;
	inBytes: number;
	inLargest: number;
	/** Of the messages in, the room's states (full states and patches): `work.*.patches` counts these. */
	states: number;
	stateBytes: number;
	outMessages: number;
	outBytes: number;
	outLargest: number;
	/** Per kind of message (`messageLabel`), in and out. */
	inByCode?: Record<string, CodeTally>;
	outByCode?: Record<string, CodeTally>;
	/** Fixed sim steps run since the first message. */
	steps?: number;
}

/** One kind of room message: how many, their bytes, the largest. */
export interface CodeTally {
	messages: number;
	bytes: number;
	largest: number;
}

export { CODES_KEPT, OTHER_CODE, messageLabel, tallyCode } from './arcadePerf';

export interface SocketStats {
	seconds: number;
	in: { messages: number; bytes: number; largest: number; states: number; stateBytes: number };
	out: { messages: number; bytes: number; largest: number };
	perSecond: { inMessages: number; inBytes: number; outMessages: number; outBytes: number };
	/** Bytes by kind of message in and out, heaviest first (`perf: 10`). */
	byCode?: {
		in: ({ code: string } & CodeTally)[];
		out: ({ code: string } & CodeTally)[];
	};
	/** The room's state bytes against every other message's, in (`perf: 10`). */
	stateShare?: { stateBytes: number; otherBytes: number };
	/** Fixed sim steps run while metered, and what went out and came in per step (`perf: 10`). */
	perStep?: { steps: number; outMessages: number; outBytes: number; inMessages: number };
}

export interface NetworkBlock {
	v: 1;
	/** The page load the files belong to (`performance.timeOrigin`, ms): readings sent from one load share it. */
	loadId: number;
	/** `navigate`, `reload`, `back_forward`, `prerender`; null when the browser has no navigation entry. */
	navigation: string | null;
	/** ms from navigation start to the game's first frame, null when unknown. */
	firstFrameMs: number | null;
	/** `tick`: the probe saw the first Pixi tick. `paint`: it came later, so First Contentful Paint. */
	firstFrameSource: 'tick' | 'paint' | null;
	/** ms from navigation start to the game's boot load finishing (`stateApp.loaded`), null until then. */
	bootMs: number | null;
	totals: NetTotals;
	byClass: Partial<Record<NetClass, NetTotals>>;
	byStage: Record<NetStage, NetTotals>;
	/** The heaviest files by weight (size-unknown ones last), heaviest first. */
	heaviest: NetFile[];
	/**
	 * Paths whose body crossed the network more than once in this load. Only the first
	 * {@link CROSSED_KEPT} distinct paths are watched: a later one's second download is not seen.
	 */
	repeats: { path: string; host?: string; count: number; bytes: number }[];
	rgs: RgsStats;
	socket?: SocketStats;
	/** Every file (but the RGS requests, which `rgs` sums), heaviest first, up to {@link FILES_KEPT}. */
	files?: NetFile[];
	/** Files left out of `files` by the cap. */
	filesDropped: number;
	/** The browser's resource buffer was full before the probe observed: early files may be missing. */
	bufferFull?: true;
}

/** The full report's file list; the short form (sent as the page hides) keeps `heaviest` only. */
export const FILES_KEPT = 150;
export const HEAVIEST_KEPT = 20;
const REPEATS_KEPT = 10;
const SLOWEST_KEPT = 3;
/** RGS durations kept for the percentiles (a long session polls the balance). */
const RGS_SAMPLES_KEPT = 4000;

const EXT_CLASS: Record<string, NetClass> = {
	js: 'js',
	mjs: 'js',
	css: 'css',
	png: 'image',
	webp: 'image',
	jpg: 'image',
	jpeg: 'image',
	gif: 'image',
	avif: 'image',
	svg: 'image',
	bmp: 'image',
	ktx2: 'ktx2',
	ktx: 'ktx2',
	basis: 'ktx2',
	json: 'json',
	atlas: 'json',
	fnt: 'json',
	xml: 'json',
	skel: 'rig',
	irig: 'rig',
	mp3: 'audio',
	ogg: 'audio',
	m4a: 'audio',
	aac: 'audio',
	wav: 'audio',
	webm: 'audio',
	opus: 'audio',
	flac: 'audio',
	woff: 'font',
	woff2: 'font',
	ttf: 'font',
	otf: 'font',
	html: 'document',
	htm: 'document',
};

const RGS_PATH = /\/rgs\/engine$|\/wallet\/(?:authenticate|play|end-round|balance)$|\/bet\/event$/;
const RIG_DIR = /(?:^|\/)(?:spines?|rigs?|skeletons?)\//i;
const DATA_API = /\/api\/editor\/(?:runtime|doc)$/;
/**
 * A path segment that is a credential: JWT-like dotted base64url parts, or a long run of base64url
 * or hex that mixes letters and digits. A long folder or file name made of words is not one.
 */
const isToken = (segment: string): boolean =>
	/^[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){1,2}$/.test(segment) ||
	(/^[A-Za-z0-9_-]{24,}$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment));
/**
 * The launcher routes whose path carries a credential, and how many segments after the prefix are
 * one: the deploy tree, the published tree, a partner share link and a capture GO link. A token is
 * redacted here by position whatever its format (a digit-less read token, an operator's secret).
 * The launcher's `pathOnly` (`profilerNetwork.ts`) redacts the same list again on receipt.
 */
export const TOKEN_ROUTES: Readonly<Record<string, number>> = {
	'/api/deploy/f': 1,
	'/api/published/f': 1,
	'/play': 1,
	'/profiler/go': 2,
};

export interface SafeUrl {
	path: string;
	host?: string;
	/** Read off the query before it is dropped: the request carries the RGS's `sid` and `seq`. */
	rgsQuery: boolean;
}

/**
 * A URL as the report may name it: the path with any token segment replaced by `…`, and the host
 * when it is not the page's. The query and the hash never leave this function.
 */
export function safeUrl(raw: string, pageOrigin: string): SafeUrl {
	let url: URL;
	try {
		url = new URL(raw, pageOrigin);
	} catch {
		return { path: '?', rgsQuery: false };
	}
	if (url.protocol === 'data:' || url.protocol === 'blob:') {
		return { path: `${url.protocol}…`, rgsQuery: false };
	}
	let prefix = '';
	let tokens = 0;
	const path = url.pathname
		.replace(/\/{2,}/g, '/')
		.split('/')
		.map((segment, i) => {
			tokens = Math.max(tokens - 1, TOKEN_ROUTES[prefix] ?? 0);
			if (i > 0) prefix += `/${segment}`;
			return tokens > 0 || isToken(segment) ? '…' : segment;
		})
		.join('/');
	const params = url.searchParams;
	let pageHost = '';
	try {
		pageHost = new URL(pageOrigin).host;
	} catch {
		// A page with no origin of its own (a fixture's `about:`): every host is named.
	}
	return {
		path: path.slice(0, 200) || '/',
		...(url.host && url.host !== pageHost ? { host: url.host.slice(0, 80) } : {}),
		rgsQuery: params.has('sid') && params.has('seq'),
	};
}

/**
 * What a file is, from its path's extension, else from what asked for it. A file a stylesheet asks for
 * with no extension (a font service's `/l`) is `other`: a font or an image, never CSS text.
 */
export function classOf(path: string, initiatorType: string): NetClass {
	if (initiatorType === 'navigation') return 'document';
	const last = path.slice(path.lastIndexOf('/') + 1);
	const dot = last.lastIndexOf('.');
	const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
	const byExt = EXT_CLASS[ext];
	if (byExt === 'json' && ext === 'json' && RIG_DIR.test(path)) return 'rig';
	if (byExt) return byExt;
	if (DATA_API.test(path)) return 'json';
	if (initiatorType === 'script') return 'js';
	if (['fetch', 'xmlhttprequest', 'beacon'].includes(initiatorType)) return 'api';
	return 'other';
}

const size = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

interface RawFile extends Omit<NetFile, 'stage'> {
	/** The page clock time the file started, unrounded, for the stage. */
	at: number;
}

/** One resource entry as a file, its stage still open (the first frame may not have happened). */
export function readEntry(
	entry: ResourceLike,
	pageOrigin: string,
	initiatorType = entry.initiatorType,
): RawFile {
	const url = safeUrl(entry.name, pageOrigin);
	const cls = classOf(url.path, initiatorType);
	let transfer = size(entry.transferSize);
	let encoded = size(entry.encodedBodySize);
	let decoded = size(entry.decodedBodySize);
	const hidden = !!url.host && !transfer && !encoded && !decoded;
	let cache: NetCache;
	if (hidden) {
		transfer = encoded = decoded = null;
		cache = 'unknown';
	} else if (entry.deliveryType === 'cache' || (transfer === 0 && (encoded || decoded))) {
		cache = 'hit';
	} else if (transfer !== null && encoded !== null && transfer > 0 && transfer < encoded) {
		cache = 'revalidated';
	} else {
		cache = 'network';
	}
	const rgs = cls === 'api' && (RGS_PATH.test(url.path) || url.rgsQuery);
	return {
		path: url.path,
		...(url.host ? { host: url.host } : {}),
		type: initiatorType.slice(0, 20),
		class: cls,
		at: entry.startTime,
		start: Math.round(entry.startTime),
		ms: Math.round(entry.duration),
		transfer,
		encoded,
		decoded,
		cache,
		...(rgs ? { rgs: true as const } : {}),
	};
}

/** A file's download weight: its body as served, else what crossed (a body-less answer). */
export const weightOf = (f: Pick<NetFile, 'encoded' | 'transfer'>): number | null =>
	f.encoded || f.transfer === null ? f.encoded : f.transfer;

const zeroTotals = (): NetTotals => ({
	files: 0,
	bytes: 0,
	transfer: 0,
	cachedBytes: 0,
	cached: 0,
	revalidated: 0,
	unknown: 0,
});

function addTo(t: NetTotals, f: Pick<NetFile, 'encoded' | 'transfer' | 'cache'>): void {
	t.files += 1;
	const weight = weightOf(f);
	if (weight === null) {
		t.unknown += 1;
		return;
	}
	t.bytes += weight;
	t.transfer += f.transfer ?? 0;
	if (f.cache === 'hit') {
		t.cached += 1;
		t.cachedBytes += weight;
	} else if (f.cache === 'revalidated') t.revalidated += 1;
}

const pct = (sorted: readonly number[], p: number) =>
	sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;

export function msStats(values: readonly number[]): MsStats {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: Math.round(pct(sorted, 0.5)),
		p95: Math.round(pct(sorted, 0.95)),
		max: Math.round(sorted.at(-1) ?? 0),
	};
}

/** Heaviest first; a size-unknown file after every known one, the slowest of them first. */
const heavier = (a: NetFile, b: NetFile) =>
	(weightOf(b) ?? -1) - (weightOf(a) ?? -1) || b.ms - a.ms || a.start - b.start;

const codesOf = (by: Record<string, CodeTally> | undefined) =>
	Object.entries(by ?? {})
		.map(([code, t]) => ({ code, ...t }))
		.sort((a, b) => b.bytes - a.bytes);

export function socketStats(t: SocketTally): SocketStats {
	const seconds = Math.max(0.001, (t.last - t.since) / 1000);
	const per = (n: number) => Math.round((n / seconds) * 10) / 10;
	const steps = t.steps ?? 0;
	const perStep = (n: number) => Math.round((n / steps) * 100) / 100;
	return {
		seconds: Math.round(seconds * 10) / 10,
		in: {
			messages: t.inMessages,
			bytes: t.inBytes,
			largest: t.inLargest,
			states: t.states,
			stateBytes: t.stateBytes,
		},
		out: { messages: t.outMessages, bytes: t.outBytes, largest: t.outLargest },
		perSecond: {
			inMessages: per(t.inMessages),
			inBytes: per(t.inBytes),
			outMessages: per(t.outMessages),
			outBytes: per(t.outBytes),
		},
		...(t.inByCode || t.outByCode
			? { byCode: { in: codesOf(t.inByCode), out: codesOf(t.outByCode) } }
			: {}),
		...(t.inByCode
			? { stateShare: { stateBytes: t.stateBytes, otherBytes: t.inBytes - t.stateBytes } }
			: {}),
		...(steps > 0
			? {
					perStep: {
						steps,
						outMessages: perStep(t.outMessages),
						outBytes: perStep(t.outBytes),
						inMessages: perStep(t.inMessages),
					},
				}
			: {}),
	};
}

export interface NetworkMonitor {
	/** A resource entry (or the navigation entry, which is a resource too). */
	add(entry: ResourceLike): void;
	navigation(entry: (ResourceLike & { type?: string }) | undefined): void;
	firstFrame(ms: number, source: 'tick' | 'paint'): void;
	booted(ms: number): void;
	bufferFull(): void;
	/** The block as the report carries it; `short` keeps the heaviest files only. */
	block(opts?: { short?: boolean; socket?: SocketTally }): NetworkBlock;
}

/**
 * Files held unsettled, before the first frame and the boot load are both known (their stage can
 * still move). Past this many (a game that never boots) a file is folded at the stage it reads now.
 */
const PENDING_MAX = 2000;
/** Distinct paths watched for a second download. */
const CROSSED_KEPT = 2000;

/**
 * Bounded over a long soak: a file is folded into running totals once its stage is settled, the
 * list keeps only the heaviest {@link FILES_KEPT}, and an RGS request is summed as it arrives.
 */
export function createNetworkMonitor(pageOrigin: string, loadId: number): NetworkMonitor {
	let pending: RawFile[] = [];
	const totals = zeroTotals();
	const byClass: Partial<Record<NetClass, NetTotals>> = {};
	const byStage = Object.fromEntries(NET_STAGES.map((s) => [s, zeroTotals()])) as Record<
		NetStage,
		NetTotals
	>;
	const crossed = new Map<string, { path: string; host?: string; count: number; bytes: number }>();
	let listed = 0;
	const rgs: Omit<RgsStats, 'ms'> = {
		requests: 0,
		bytes: 0,
		unknown: 0,
		largest: 0,
		slowest: [],
	};
	const rgsMs: number[] = [];
	let navType: string | null = null;
	let firstFrameMs: number | null = null;
	let firstFrameSource: NetworkBlock['firstFrameSource'] = null;
	let bootMs: number | null = null;
	let full = false;

	const settled = () => firstFrameMs !== null && bootMs !== null;
	const stageOf = (at: number): NetStage =>
		firstFrameMs !== null && at < firstFrameMs
			? 'beforeFirstFrame'
			: bootMs === null || at < bootMs
				? 'boot'
				: 'play';
	const staged = ({ at, ...f }: RawFile): NetFile => ({ ...f, stage: stageOf(at) });

	/** Adds a file to the given totals, repeats and list: the running ones, or a copy for a block. */
	function tally(
		f: NetFile,
		into: {
			totals: NetTotals;
			byClass: Partial<Record<NetClass, NetTotals>>;
			byStage: Record<NetStage, NetTotals>;
			crossed: Map<string, { path: string; host?: string; count: number; bytes: number }>;
			list: NetFile[];
		},
	): void {
		addTo(into.totals, f);
		addTo((into.byClass[f.class] ??= zeroTotals()), f);
		addTo(into.byStage[f.stage], f);
		if (f.rgs) return;
		into.list.push(f);
		if (f.cache !== 'network' || f.class === 'api') return;
		const key = `${f.host ?? ''}${f.path}`;
		const seen = into.crossed.get(key);
		if (!seen && into.crossed.size >= CROSSED_KEPT) return;
		const entry = seen ?? { path: f.path, ...(f.host ? { host: f.host } : {}), count: 0, bytes: 0 };
		entry.count += 1;
		entry.bytes += weightOf(f) ?? 0;
		into.crossed.set(key, entry);
	}
	const running = { totals, byClass, byStage, crossed, list: [] as NetFile[] };
	const fold = (f: RawFile) => {
		if (!f.rgs) listed += 1;
		tally(staged(f), running);
		if (running.list.length > 2 * FILES_KEPT) {
			running.list = running.list.sort(heavier).slice(0, FILES_KEPT);
		}
	};
	const flush = () => {
		if (!settled()) return;
		for (const f of pending) fold(f);
		pending = [];
	};
	const take = (f: RawFile) => {
		if (settled() || pending.length >= PENDING_MAX) fold(f);
		else pending.push(f);
	};
	const sumRgs = (f: RawFile) => {
		rgs.requests += 1;
		const weight = weightOf(f);
		if (weight === null) rgs.unknown += 1;
		else {
			rgs.bytes += weight;
			rgs.largest = Math.max(rgs.largest, weight);
		}
		if (rgsMs.length < RGS_SAMPLES_KEPT) rgsMs.push(f.ms);
		rgs.slowest.push({
			path: f.path,
			...(f.host ? { host: f.host } : {}),
			start: f.start,
			ms: f.ms,
		});
		rgs.slowest = rgs.slowest.sort((x, y) => y.ms - x.ms).slice(0, SLOWEST_KEPT);
	};

	return {
		add(entry) {
			const f = readEntry(entry, pageOrigin);
			if (f.rgs) sumRgs(f);
			take(f);
		},
		navigation(entry) {
			if (!entry) return;
			navType = typeof entry.type === 'string' ? entry.type.slice(0, 20) : null;
			// Read through the entry itself: a browser's timing entry keeps its fields on its prototype,
			// so a spread copies none of them.
			take(readEntry(entry, pageOrigin, 'navigation'));
		},
		firstFrame(ms, source) {
			if (firstFrameMs !== null) return;
			firstFrameMs = ms;
			firstFrameSource = source;
			flush();
		},
		booted(ms) {
			if (bootMs !== null) return;
			bootMs = ms;
			flush();
		},
		bufferFull() {
			full = true;
		},
		block(opts) {
			const copy = (t: NetTotals): NetTotals => ({ ...t });
			const view = {
				totals: copy(totals),
				byClass: Object.fromEntries(
					Object.entries(byClass).map(([c, t]) => [c, copy(t)]),
				) as Partial<Record<NetClass, NetTotals>>,
				byStage: Object.fromEntries(NET_STAGES.map((s) => [s, copy(byStage[s])])) as Record<
					NetStage,
					NetTotals
				>,
				crossed: new Map([...crossed].map(([k, r]) => [k, { ...r }])),
				list: [...running.list],
			};
			let files = listed;
			for (const f of pending) {
				if (!f.rgs) files += 1;
				tally(staged(f), view);
			}
			const rest = view.list.sort(heavier);
			const list = opts?.short ? [] : rest.slice(0, FILES_KEPT);
			return {
				v: 1,
				loadId: Math.round(loadId),
				navigation: navType,
				firstFrameMs: firstFrameMs === null ? null : Math.round(firstFrameMs),
				firstFrameSource,
				bootMs: bootMs === null ? null : Math.round(bootMs),
				totals: view.totals,
				byClass: view.byClass,
				byStage: view.byStage,
				heaviest: rest.slice(0, HEAVIEST_KEPT),
				repeats: [...view.crossed.values()]
					.filter((r) => r.count > 1)
					.sort((a, b) => b.bytes - a.bytes)
					.slice(0, REPEATS_KEPT),
				rgs: {
					requests: rgs.requests,
					bytes: rgs.bytes,
					unknown: rgs.unknown,
					largest: rgs.largest,
					ms: msStats(rgsMs),
					slowest: [...rgs.slowest],
				},
				...(opts?.socket && opts.socket.inMessages + opts.socket.outMessages > 0
					? { socket: socketStats(opts.socket) }
					: {}),
				...(opts?.short ? {} : { files: list }),
				filesDropped: files - list.length,
				...(full ? { bufferFull: true as const } : {}),
			};
		},
	};
}

const MB = 1048576;
const mb = (bytes: number) =>
	bytes >= 0.1 * MB
		? `${(bytes / MB).toFixed(1)} MB`
		: bytes >= 1024
			? `${Math.round(bytes / 1024)} KB`
			: `${Math.round(bytes)} B`;
const fileName = (f: Pick<NetFile, 'path'>) => f.path.slice(f.path.lastIndexOf('/') + 1) || f.path;

/** The readout's network lines: the download, the first frame, the heaviest file; the API traffic. */
export function networkLines(n: NetworkBlock): string[] {
	const t = n.totals;
	const top = n.heaviest.find((f) => weightOf(f) !== null);
	const lines = [
		[
			`${mb(t.bytes)} in ${t.files} files`,
			...(t.cachedBytes ? [`${mb(t.cachedBytes)} cached`] : []),
			...(t.unknown ? [`${t.unknown} size unknown`] : []),
			n.firstFrameMs === null
				? 'first frame ?'
				: `first frame ${(n.firstFrameMs / 1000).toFixed(1)} s after ${mb(n.byStage.beforeFirstFrame.bytes)}`,
			...(top ? [`largest ${fileName(top)} ${mb(weightOf(top) ?? 0)}`] : []),
		].join(' · '),
	];
	const api = [
		...(n.rgs.requests
			? [`RGS ${n.rgs.requests} req · p50 ${n.rgs.ms.p50} · p95 ${n.rgs.ms.p95} ms`]
			: []),
		...(n.socket
			? [
					`room in ${mb(n.socket.perSecond.inBytes)}/s (${n.socket.perSecond.inMessages}/s, max ${mb(n.socket.in.largest)}) · out ${mb(n.socket.perSecond.outBytes)}/s`,
					...(n.socket.perStep ? [`${n.socket.perStep.outMessages} sends per step`] : []),
				]
			: []),
	];
	if (api.length) lines.push(api.join(' · '));
	return lines;
}
