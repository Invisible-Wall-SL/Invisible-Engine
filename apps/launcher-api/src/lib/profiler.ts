/**
 * Invisible Profiler (`/profiler`, `docs/design/invisible-profiler.md`): what the browser and the
 * server both need — the readings' retention, the capture links' test switches, and the summary a
 * `?perf=1` report (`perf: 7`, `apps/lines/src/components/PerfHud.svelte`) is reduced to for its
 * `perf_reports` row. Pure: the fixture gate (`scripts/check-profiler.ts`) runs it on plain JSON.
 */

/** Owner decision 2026-11-16: a reading is deleted this long after capture unless it is kept. */
export const PERF_RETENTION_DAYS = 15;
export const PERF_RETENTION_MS = PERF_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** A capture session's link stays usable this long. */
export const CAPTURE_SESSION_TTL_SECONDS = 24 * 60 * 60;

/** The `depends` key of `/profiler`'s readings, so a refresh re-reads them and nothing else. */
export const PROFILER_READINGS = 'profiler:readings';

/** The URL parameter that carries a capture session's token to the game. */
export const PERF_SESSION_PARAM = 'perfsession';

/** The report versions this summary reads. A newer probe is accepted only once it is read here. */
export const PERF_REPORT_VERSIONS: readonly number[] = [7];

/** A report sent straight in a request body; anything larger goes by presigned upload. */
export const PERF_INLINE_MAX_BYTES = 480 * 1024;
/** The largest report kept at all — a long `textureList` is ~100 KB, so this is generous. */
export const PERF_REPORT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * One-tap capture variants: each test switch removes one cost (`docs/status/engine.md`), so a
 * reading with it beside one without says what that feature costs on that device.
 */
export const CAPTURE_SWITCHES: readonly { id: string; label: string; params: string }[] = [
	{ id: 'plain', label: 'As shipped', params: '' },
	{ id: 'particles', label: 'Particles off', params: 'particles=off' },
	{ id: 'fx', label: 'Element FX off', params: 'fx=0' },
	{ id: 'aa', label: 'Antialias off', params: 'aa=0' },
];

export const PERF_PHASES = ['idle', 'spinning', 'round'] as const;
export type PerfPhase = (typeof PERF_PHASES)[number];

export interface PerfPhaseSummary {
	frames: number;
	fps: number;
	p50: number;
	p95: number;
	/** Frames over 33 ms — the probe's first hitch bucket. */
	hitches: number;
}

/** What a report's `perf_reports` row holds; the full JSON stays in R2. */
export interface PerfReportSummary {
	perfVersion: number;
	deviceClass: string | null;
	deviceReason: string | null;
	gpu: string | null;
	uaFamily: string | null;
	dpr: number | null;
	canvas: string | null;
	buildVersion: string | null;
	buildSha: string | null;
	/** Test switches the reading ran with (`particles=off`, `fx=0`, …), as given. */
	flags: Record<string, string>;
	phases: Record<PerfPhase, PerfPhaseSummary | null>;
	/** Spinning frames: mean draw calls and frame JS ms (idle when the reading never spun). */
	drawsMean: number | null;
	jsMs: number | null;
	textureMb: number | null;
}

export type SummaryResult = { ok: true; summary: PerfReportSummary } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** A browser family and major version from a user agent — enough to group, not to fingerprint. */
export function uaFamily(ua: string | null): string | null {
	if (!ua) return null;
	const os = /iPhone|iPad|iPod/.test(ua)
		? 'iOS'
		: /Android/.test(ua)
			? 'Android'
			: /Mac OS X/.test(ua)
				? 'macOS'
				: /Windows/.test(ua)
					? 'Windows'
					: /Linux|CrOS/.test(ua)
						? 'Linux'
						: null;
	const browsers: [string, RegExp][] = [
		['Edge', /Edg(?:A|iOS)?\/(\d+)/],
		['Samsung', /SamsungBrowser\/(\d+)/],
		['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
		['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
		['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/],
	];
	const hit = browsers
		.map(([name, re]) => [name, re.exec(ua)?.[1]] as const)
		.find(([, major]) => major);
	const browser = hit ? `${hit[0]} ${hit[1]}` : null;
	return [browser, os].filter(Boolean).join(' · ') || null;
}

function phase(v: unknown): PerfPhaseSummary | null {
	if (!isObj(v)) return null;
	const frames = num(v.frames);
	if (!frames) return null;
	return {
		frames,
		fps: num(v.fps) ?? 0,
		p50: num(v.p50) ?? 0,
		p95: num(v.p95) ?? 0,
		hitches: num(v.over33) ?? 0,
	};
}

/** `work.<phase>.perFrame.<key>.mean` from the report, or null. */
function workMean(report: Obj, phaseName: PerfPhase, key: string): number | null {
	const work = isObj(report.work) ? report.work[phaseName] : undefined;
	const perFrame = isObj(work) ? work.perFrame : undefined;
	const entry = isObj(perFrame) ? perFrame[key] : undefined;
	return isObj(entry) ? num(entry.mean) : null;
}

/**
 * Reads a probe report (the parsed Copy JSON) into its summary, or says why it is not one. Never
 * throws: a report from a newer or broken probe is refused with a reason the sender can show.
 */
export function summarizePerfReport(report: unknown): SummaryResult {
	if (!isObj(report)) return { ok: false, error: 'Not a ?perf=1 report (expected a JSON object).' };
	const version = num(report.perf);
	if (version === null) return { ok: false, error: 'Not a ?perf=1 report (no "perf" version).' };
	if (!PERF_REPORT_VERSIONS.includes(version)) {
		return {
			ok: false,
			error: `Report version perf: ${version} is not read yet (reads ${PERF_REPORT_VERSIONS.join(', ')}).`,
		};
	}
	const phases = Object.fromEntries(
		PERF_PHASES.map((name) => [name, phase(report[name])]),
	) as Record<PerfPhase, PerfPhaseSummary | null>;
	if (PERF_PHASES.every((name) => !phases[name])) {
		return { ok: false, error: 'The report holds no frames yet — play a little, then send it.' };
	}
	const device = isObj(report.device) ? report.device : {};
	const gpu = isObj(report.gpu) ? report.gpu : {};
	const build = isObj(report.build) ? report.build : {};
	const flags = isObj(report.flags)
		? Object.fromEntries(
				Object.entries(report.flags)
					.filter((e): e is [string, string] => typeof e[1] === 'string')
					.slice(0, 20)
					.map(([k, v]) => [k.slice(0, 40), v.slice(0, 40)]),
			)
		: {};
	const busy: PerfPhase = phases.spinning ? 'spinning' : 'idle';
	const textureMb = Array.isArray(report.textures)
		? report.textures.reduce((sum: number, t) => sum + (isObj(t) ? (num(t.mb) ?? 0) : 0), 0)
		: null;
	return {
		ok: true,
		summary: {
			perfVersion: version,
			deviceClass: str(device.class, 20),
			deviceReason: str(device.reason, 120),
			gpu: str(gpu.gpu),
			uaFamily: uaFamily(str(report.ua, 600)),
			dpr: num(report.dpr),
			canvas: str(report.canvas, 20),
			buildVersion: str(build.version, 60),
			buildSha: str(build.sha, 60),
			flags,
			phases,
			drawsMean: workMean(report, busy, 'draws'),
			jsMs: workMean(report, busy, 'jsMs'),
			textureMb: textureMb === null ? null : Math.round(textureMb * 10) / 10,
		},
	};
}

/** The row a page lists: the summary plus where it came from and whether it is kept. */
export interface PerfReportListItem {
	id: string;
	capturedAt: string;
	source: 'capture' | 'paste';
	label: string | null;
	deviceClass: string | null;
	gpu: string | null;
	uaFamily: string | null;
	dpr: number | null;
	canvas: string | null;
	buildVersion: string | null;
	flags: Record<string, string>;
	idle: PerfPhaseSummary | null;
	spinning: PerfPhaseSummary | null;
	round: PerfPhaseSummary | null;
	drawsMean: number | null;
	textureMb: number | null;
	keep: boolean;
	/** When the purge removes it (ISO), null while kept. */
	expiresAt: string | null;
}

/** A launch URL a phone can open; a blank or relative game-card URL has no capture. */
export function isCapturableGameUrl(url: string): boolean {
	try {
		return ['https:', 'http:'].includes(new URL(url).protocol);
	} catch {
		return false;
	}
}

export interface CaptureLink {
	id: string;
	label: string;
	url: string;
}

/**
 * The capture links for one published game: its launch URL with the probe on (`perf=1`) and the
 * session's token, once as shipped and once per test switch. Parameters are SET, never appended —
 * the game reads the first occurrence of a parameter, so an appended duplicate would be ignored.
 */
export function captureLinks(gameUrl: string, token: string): CaptureLink[] {
	return CAPTURE_SWITCHES.map((s) => {
		const url = new URL(gameUrl);
		url.searchParams.set('perf', '1');
		url.searchParams.set(PERF_SESSION_PARAM, token);
		for (const [key, value] of new URLSearchParams(s.params)) url.searchParams.set(key, value);
		return { id: s.id, label: s.label, url: url.toString() };
	});
}
