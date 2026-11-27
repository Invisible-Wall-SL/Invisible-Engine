/**
 * Invisible Profiler network (`perf: 9`, `docs/design/invisible-profiler.md` §8): the `network`
 * block a reading carries (`apps/lines/src/game/perfNetwork.ts`) — what the page downloaded since it
 * loaded, each file's path and sizes, by class and by load stage, the first frame, the RGS's
 * requests and, online, the game server's room messages — read from untrusted JSON into bounded
 * facts, and the summary a `perf_reports` row keeps. Pure: the page, the receipt and
 * `scripts/check-profiler-network.ts` run the same functions.
 *
 * A file's size is null when the browser hid it (a cross-origin response without
 * `Timing-Allow-Origin`): such a file is counted apart, never as 0 bytes. A file's "bytes" is its
 * download weight — its body as served, whether this load took it from the cache or not — so a
 * phone that had the game cached reads the same weight as one that did not.
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

export const NET_CLASS_LABELS: Record<NetClass, string> = {
	document: 'Page',
	js: 'JS',
	css: 'CSS',
	image: 'Images',
	ktx2: 'KTX2 textures',
	json: 'Atlas / JSON',
	rig: 'Rigs',
	audio: 'Audio',
	font: 'Fonts',
	api: 'API / RGS',
	other: 'Other',
};

export const NET_STAGES = ['beforeFirstFrame', 'boot', 'play'] as const;
export type NetStage = (typeof NET_STAGES)[number];

export const NET_STAGE_LABELS: Record<NetStage, string> = {
	beforeFirstFrame: 'Before the first frame',
	boot: 'Boot load',
	play: 'After boot',
};

export type NetCache = 'hit' | 'revalidated' | 'network' | 'unknown';
const NET_CACHES: readonly NetCache[] = ['hit', 'revalidated', 'network', 'unknown'];

export interface NetFileFact {
	path: string;
	/** Null when it is the page's own host. */
	host: string | null;
	class: NetClass;
	stage: NetStage;
	start: number;
	ms: number;
	/** The download weight (body as served); null = size unknown. */
	bytes: number | null;
	/** What crossed the network this load; null = size unknown. */
	transfer: number | null;
	/** The body once decompressed; null = size unknown. */
	decoded: number | null;
	cache: NetCache;
}

export interface NetTotals {
	files: number;
	bytes: number;
	transfer: number;
	cachedBytes: number;
	cached: number;
	revalidated: number;
	unknown: number;
}

export interface MsStats {
	count: number;
	p50: number;
	p95: number;
	max: number;
}

/** One kind of room message (`perf: 10`): how many, their bytes, the largest. */
export interface SocketKindFact {
	code: string;
	messages: number;
	bytes: number;
	largest: number;
}

export interface SocketFacts {
	seconds: number;
	inMessages: number;
	inBytes: number;
	inLargest: number;
	states: number;
	stateBytes: number;
	outMessages: number;
	outBytes: number;
	outLargest: number;
	inBytesPerSecond: number;
	inMessagesPerSecond: number;
	outBytesPerSecond: number;
	/** `perf: 10`: bytes by kind of message, heaviest first, in and out (empty before it). */
	inByKind: SocketKindFact[];
	outByKind: SocketKindFact[];
	/** `perf: 10`: fixed sim steps run while metered, and what went out and came in per step. */
	perStep: { steps: number; outMessages: number; outBytes: number; inMessages: number } | null;
}

export interface RepeatFact {
	path: string;
	host: string | null;
	count: number;
	bytes: number;
}

export interface NetworkFacts {
	/** The page load (`performance.timeOrigin`): readings of one load share it. */
	loadId: number | null;
	/** `navigate`, `reload`, `back_forward`, … */
	navigation: string | null;
	firstFrameMs: number | null;
	firstFrameSource: 'tick' | 'paint' | null;
	bootMs: number | null;
	totals: NetTotals;
	byClass: Partial<Record<NetClass, NetTotals>>;
	byStage: Record<NetStage, NetTotals>;
	/** Heaviest first (size-unknown files after every known one). */
	heaviest: NetFileFact[];
	/** Text served uncompressed (body as served ≥ 90% of the decoded body), largest first. */
	uncompressed: NetFileFact[];
	/** Files whose body crossed the network this load, largest first: what a next load should not re-fetch. */
	crossed: NetFileFact[];
	/** Paths whose body crossed the network more than once in this load. */
	repeats: RepeatFact[];
	rgs: {
		requests: number;
		bytes: number;
		unknown: number;
		largest: number;
		ms: MsStats;
		slowest: { path: string; host: string | null; start: number; ms: number }[];
	};
	socket: SocketFacts | null;
	/** The reading came without its file list (the short form sent as the page hid). */
	trimmed: boolean;
	filesDropped: number;
	bufferFull: boolean;
}

/** What the facts keep of each list. */
export const NET_KEEP = { heaviest: 20, uncompressed: 10, crossed: 30, repeats: 10 } as const;
/** Text this small is not worth compressing. */
export const UNCOMPRESSED_MIN_BYTES = 8 * 1024;
/** A body as served at least this share of its decoded size was not compressed. */
export const UNCOMPRESSED_RATIO = 0.9;
/** A file this small re-fetched on a later load is noise (a manifest, a pointer). */
export const CROSSED_MIN_BYTES = 50 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown): number => Math.max(0, Math.round(num(v) ?? 0));
const str = (v: unknown, max = 200): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
	list.includes(v as T) ? (v as T) : fallback;
const size = (v: unknown): number | null => {
	const n = num(v);
	return n === null || n < 0 ? null : Math.round(n);
};

/** What can be decompressed: page, code, styles, atlas / JSON text and SVG. */
export const isText = (f: Pick<NetFileFact, 'class' | 'path'>): boolean =>
	['document', 'js', 'css', 'json'].includes(f.class) || /\.svg$/i.test(f.path);

/**
 * The launcher routes whose path carries a credential, and how many segments after the prefix are
 * one (the probe's `TOKEN_ROUTES` in `apps/lines/src/game/perfNetwork.ts`; `check:profiler` holds the
 * two equal). Redacted again here, so no token is stored even from an old or untrusted device.
 */
export const TOKEN_ROUTES: Readonly<Record<string, number>> = {
	'/api/deploy/f': 1,
	'/api/published/f': 1,
	'/play': 1,
	'/profiler/go': 2,
};

/** Each route where it starts a path: the string's start, a host, or the start of a word. */
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Each route where it starts a path: the string's start, after a host, or after any character a
 * path name cannot hold (prose, `url:`, `[`, `../`). Single slashes: {@link redactTokens} collapses
 * doubled ones first, so no part of the pattern can backtrack over a run of slashes.
 */
const TOKEN_ROUTE_RES = Object.entries(TOKEN_ROUTES).map(
	([route, n]) =>
		new RegExp(`(^|//[^/\\s?#]+|[^A-Za-z0-9_~/-])(${escapeRe(route)})((?:/[^/?#]*){1,${n}})`, 'g'),
);

/**
 * A string with every token a {@link TOKEN_ROUTES} route carries read `…`. It is matched with its
 * slashes decoded (`%2F`, `\/`) and doubled ones collapsed (never a scheme's `://`); a token's segment
 * runs to the next `/`, `?` or `#`, spaces included, since a secret can hold any of them. A string
 * with no token is returned exactly as it came; one with a token comes back in its decoded form.
 */
export function redactTokens(text: string): string {
	const decoded = text
		.replace(/%2F/gi, '/')
		.replace(/\\\//g, '/')
		.replace(/(?<!:)\/{2,}/g, '/');
	let out = decoded;
	for (const re of TOKEN_ROUTE_RES) {
		out = out.replace(re, (_, lead: string, route: string, rest: string) => {
			const segments = rest.split('/').length - 1;
			return `${lead}${route}${'/…'.repeat(segments)}`;
		});
	}
	return out === decoded ? text : out;
}

/** A path as kept: never a query or a hash, even from a probe that sent one, and never a token. */
const pathOnly = (v: unknown): string =>
	redactTokens((str(v, 400) ?? '?').split(/[?#]/)[0]).slice(0, 200) || '/';

const scrub = (v: unknown): unknown =>
	typeof v === 'string'
		? redactTokens(v)
		: Array.isArray(v)
			? v.map(scrub)
			: isObj(v)
				? Object.fromEntries(Object.entries(v).map(([k, x]) => [redactTokens(k), scrub(x)]))
				: v;

/**
 * A report's text as the launcher keeps it in R2: every string in it, keys included, with its route
 * tokens read `…` ({@link redactTokens}), whichever field and whichever probe sent it. Text that is not JSON is
 * returned as it came (the summary refuses it).
 */
export function redactReportText(text: string): string {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return text;
	}
	const kept = JSON.stringify(scrub(json));
	return kept === JSON.stringify(json) ? text : kept;
}

function file(v: Obj): NetFileFact {
	const transfer = size(v.transfer);
	const encoded = size(v.encoded);
	return {
		path: pathOnly(v.path),
		host: str(v.host, 80),
		class: oneOf(v.class, NET_CLASSES, 'other'),
		stage: oneOf(v.stage, NET_STAGES, 'boot'),
		start: count(v.start),
		ms: count(v.ms),
		bytes: encoded || transfer === null ? encoded : transfer,
		transfer,
		decoded: size(v.decoded),
		cache: oneOf(v.cache, NET_CACHES, 'network'),
	};
}

function totals(v: unknown): NetTotals {
	const t = isObj(v) ? v : {};
	return {
		files: count(t.files),
		bytes: count(t.bytes),
		transfer: count(t.transfer),
		cachedBytes: count(t.cachedBytes),
		cached: count(t.cached),
		revalidated: count(t.revalidated),
		unknown: count(t.unknown),
	};
}

function msStats(v: unknown): MsStats {
	const m = isObj(v) ? v : {};
	return { count: count(m.count), p50: count(m.p50), p95: count(m.p95), max: count(m.max) };
}

const KEEP_KINDS = 12;

function kinds(v: unknown): SocketKindFact[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter(isObj)
		.map((k) => ({
			code: typeof k.code === 'string' ? k.code.slice(0, 40) : '?',
			messages: count(k.messages),
			bytes: count(k.bytes),
			largest: count(k.largest),
		}))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, KEEP_KINDS);
}

function socket(v: unknown): SocketFacts | null {
	if (!isObj(v)) return null;
	const inn = isObj(v.in) ? v.in : {};
	const out = isObj(v.out) ? v.out : {};
	const per = isObj(v.perSecond) ? v.perSecond : {};
	const rate = (r: unknown) => Math.max(0, num(r) ?? 0);
	return {
		seconds: rate(v.seconds),
		inMessages: count(inn.messages),
		inBytes: count(inn.bytes),
		inLargest: count(inn.largest),
		states: count(inn.states),
		stateBytes: count(inn.stateBytes),
		outMessages: count(out.messages),
		outBytes: count(out.bytes),
		outLargest: count(out.largest),
		inBytesPerSecond: rate(per.inBytes),
		inMessagesPerSecond: rate(per.inMessages),
		outBytesPerSecond: rate(per.outBytes),
		inByKind: kinds(isObj(v.byCode) ? v.byCode.in : undefined),
		outByKind: kinds(isObj(v.byCode) ? v.byCode.out : undefined),
		perStep: isObj(v.perStep)
			? {
					steps: count(v.perStep.steps),
					outMessages: rate(v.perStep.outMessages),
					outBytes: rate(v.perStep.outBytes),
					inMessages: rate(v.perStep.inMessages),
				}
			: null,
	};
}

const heavier = (a: NetFileFact, b: NetFileFact) =>
	(b.bytes ?? -1) - (a.bytes ?? -1) || b.ms - a.ms || a.start - b.start;

/** One file, whatever host it came from: the same path on two hosts is two files. */
export const fileKey = (f: Pick<NetFileFact, 'host' | 'path'>) => `${f.host ?? ''}${f.path}`;

/**
 * A report's network block as bounded facts; null when it has none (`perf: 7` / `8`, or a probe
 * that could not observe resources). `keepFiles` keeps that many of the file list (the reading
 * detail on the page); the facts a row stores keep none beyond their lists. Never throws.
 */
export function readNetwork(
	report: unknown,
	keepFiles = 0,
): (NetworkFacts & { files?: NetFileFact[] }) | null {
	const n = isObj(report) && isObj(report.network) ? report.network : null;
	if (!n) return null;
	const listed = Array.isArray(n.files) ? n.files.filter(isObj).slice(0, 2000).map(file) : null;
	const heaviest = (Array.isArray(n.heaviest) ? n.heaviest : [])
		.filter(isObj)
		.slice(0, 200)
		.map(file);
	// The full list when it came (it holds every heaviest file too), else the heaviest alone.
	const all = (listed ?? heaviest).sort(heavier);
	const byClass: Partial<Record<NetClass, NetTotals>> = {};
	if (isObj(n.byClass)) {
		for (const c of NET_CLASSES) if (isObj(n.byClass[c])) byClass[c] = totals(n.byClass[c]);
	}
	const byStage = Object.fromEntries(
		NET_STAGES.map((s) => [s, totals(isObj(n.byStage) ? n.byStage[s] : undefined)]),
	) as Record<NetStage, NetTotals>;
	const rgs = isObj(n.rgs) ? n.rgs : {};
	const source = n.firstFrameSource;
	return {
		loadId: num(n.loadId),
		navigation: str(n.navigation, 20),
		firstFrameMs: size(n.firstFrameMs),
		firstFrameSource: source === 'tick' || source === 'paint' ? source : null,
		bootMs: size(n.bootMs),
		totals: totals(n.totals),
		byClass,
		byStage,
		heaviest: all.slice(0, NET_KEEP.heaviest),
		uncompressed: all
			.filter(
				(f) =>
					isText(f) &&
					f.bytes !== null &&
					f.decoded !== null &&
					f.decoded >= UNCOMPRESSED_MIN_BYTES &&
					f.bytes >= UNCOMPRESSED_RATIO * f.decoded,
			)
			.slice(0, NET_KEEP.uncompressed),
		crossed: all
			.filter((f) => f.cache === 'network' && (f.bytes ?? 0) >= CROSSED_MIN_BYTES)
			.slice(0, NET_KEEP.crossed),
		repeats: (Array.isArray(n.repeats) ? n.repeats : [])
			.filter(isObj)
			.map((r) => ({
				path: pathOnly(r.path),
				host: str(r.host, 80),
				count: count(r.count),
				bytes: count(r.bytes),
			}))
			.filter((r) => r.count > 1)
			.slice(0, NET_KEEP.repeats),
		rgs: {
			requests: count(rgs.requests),
			bytes: count(rgs.bytes),
			unknown: count(rgs.unknown),
			largest: count(rgs.largest),
			ms: msStats(rgs.ms),
			slowest: (Array.isArray(rgs.slowest) ? rgs.slowest : [])
				.filter(isObj)
				.slice(0, 3)
				.map((s) => ({
					path: pathOnly(s.path),
					host: str(s.host, 80),
					start: count(s.start),
					ms: count(s.ms),
				})),
		},
		socket: socket(n.socket),
		trimmed: listed === null,
		filesDropped: count(n.filesDropped),
		bufferFull: n.bufferFull === true,
		...(keepFiles > 0 && listed ? { files: all.slice(0, keepFiles) } : {}),
	};
}

const MB = 1048576;
export const toMb = (bytes: number) => Math.round((bytes / MB) * 100) / 100;

/** What a reading's `perf_reports` row keeps of its network (`network` jsonb, plus two columns). */
export interface NetworkSummary {
	/** The download weight: what the game fetched, cache hits counted at their size. */
	transferMb: number;
	/** Of it, what this load took from the cache. */
	cachedMb: number;
	files: number;
	/** Files whose size the browser hid (cross-origin, no `Timing-Allow-Origin`). */
	unknownFiles: number;
	firstFrameMs: number | null;
	beforeFirstFrameMb: number;
	largest: { path: string; host: string | null; class: NetClass; mb: number } | null;
	rgsRequests: number;
	rgsP95Ms: number | null;
	/** Online arcade: the room's bytes in, a second. */
	socketInKbps: number | null;
	trimmed: boolean;
}

/**
 * A reading's transfer MB when any of its files' sizes is known; a reading whose every file hid its
 * size has no number, never a 0 MB pass. Null before `perf: 9`.
 */
export const knownTransferMb = (n: NetworkSummary | null | undefined): number | null =>
	n && n.files > n.unknownFiles ? n.transferMb : null;

export function networkSummary(n: NetworkFacts): NetworkSummary {
	const top = n.heaviest.find((f) => f.bytes !== null);
	return {
		transferMb: toMb(n.totals.bytes),
		cachedMb: toMb(n.totals.cachedBytes),
		files: n.totals.files,
		unknownFiles: n.totals.unknown,
		firstFrameMs: n.firstFrameMs,
		beforeFirstFrameMb: toMb(n.byStage.beforeFirstFrame.bytes),
		largest: top
			? { path: top.path, host: top.host, class: top.class, mb: toMb(top.bytes ?? 0) }
			: null,
		rgsRequests: n.rgs.requests,
		rgsP95Ms: n.rgs.ms.count ? n.rgs.ms.p95 : null,
		socketInKbps: n.socket ? Math.round((n.socket.inBytesPerSecond / 1024) * 10) / 10 : null,
		trimmed: n.trimmed,
	};
}

/** A file as the page names it: its host (when not the game's), then its path. */
export const fileLabel = (f: Pick<NetFileFact, 'host' | 'path'>): string =>
	f.host ? `${f.host}${f.path}` : f.path;

/** The short name of a file: the last path segment. */
export const fileName = (f: Pick<NetFileFact, 'path'>): string =>
	f.path.slice(f.path.lastIndexOf('/') + 1) || f.path;
