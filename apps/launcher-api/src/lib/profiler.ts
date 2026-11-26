/**
 * Invisible Profiler (`/profiler`, `docs/design/invisible-profiler.md`): what the browser and the
 * server both need — the readings' retention, the capture links' test switches, and the summary a
 * `?perf=1` report (`perf: 7` / `8`, `apps/lines/src/components/PerfHud.svelte`) is reduced to for
 * its `perf_reports` row. Pure: the fixture gate (`scripts/check-profiler.ts`) runs it on plain JSON.
 */

import { perfCounts, type PerfCounts } from './profilerLab';

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
export const PERF_REPORT_VERSIONS: readonly number[] = [7, 8];

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

export const PERF_REPORT_SOURCES = ['capture', 'paste', 'lab'] as const;
export type PerfReportSource = (typeof PERF_REPORT_SOURCES)[number];

/**
 * The phases a reading's frames are bucketed in, by the game's family: a slot idles, spins and
 * presents a round; an arcade game (`perf: 8`, `kind: 'arcade'`) is in its menus (title, lobby,
 * countdown, win screen) or in play (the field ticking).
 */
export const PHASE_SETS = {
	slot: ['idle', 'spinning', 'round'],
	arcade: ['menu', 'play'],
} as const;
export type PhaseSet = keyof typeof PHASE_SETS;
export type PerfPhase = (typeof PHASE_SETS)[PhaseSet][number];

/** Every phase of every set, slot first: a reading holds null for each phase not in its set. */
export const PERF_PHASES: readonly PerfPhase[] = [...PHASE_SETS.slot, ...PHASE_SETS.arcade];

export const PHASE_LABELS: Record<PerfPhase, string> = {
	idle: 'Idle',
	spinning: 'Spinning',
	round: 'Round',
	menu: 'Menu',
	play: 'Play',
};

/** A report's (or a project's) kind to its phase set: `arcade` plays, anything else is a slot. */
export const phaseSetOf = (kind: string | null | undefined): PhaseSet =>
	kind === 'arcade' ? 'arcade' : 'slot';

/** One set's phases, typed as phases (each set is its own tuple type). */
export const setPhases = (set: PhaseSet): readonly PerfPhase[] => PHASE_SETS[set];

/** The phases of every set the readings use, in {@link PERF_PHASES} order. */
export function phasesOf(readings: readonly { phaseSet: PhaseSet }[]): PerfPhase[] {
	const sets = [...new Set(readings.map((r) => r.phaseSet))];
	return PERF_PHASES.filter((p) => sets.some((s) => setPhases(s).includes(p)));
}

export interface PerfPhaseSummary {
	frames: number;
	fps: number;
	p50: number;
	p95: number;
	/** Frames over 33 ms — the probe's first hitch bucket. */
	hitches: number;
}

/** An arcade reading's two phases, as `perf_reports.arcade_phases` keeps them. */
export interface ArcadePhaseSummaries {
	menu: PerfPhaseSummary | null;
	play: PerfPhaseSummary | null;
}

/**
 * A v7 reading's `capped30` (rAF never above ~30 fps) counts as a browser cap only when its frames'
 * main-thread work (`lateMs + tickMs + afterMs`) fits in 0.75 of a 60 Hz frame — the rule the v8
 * probe applies itself. Busier frames at a steady 30 fps are the game missing 60 (vsync halves it).
 */
export const CAP_BUSY_MAX_MS = (0.75 * 1000) / 60;

/** What a report's `perf_reports` row holds; the full JSON stays in R2. */
export interface PerfReportSummary {
	perfVersion: number;
	/** The game config's family the probe named (`perf: 8`); null for `perf: 7` (slot only). */
	kind: string | null;
	phaseSet: PhaseSet;
	/**
	 * The browser held rAF to 30 fps (iOS Low Power Mode, a battery saver) while the frames had
	 * room for 60: its fps is the browser's, not the game's, and is not judged against a budget.
	 */
	capped30: boolean;
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
	/** Every phase; null for one with no frames or outside the reading's set. */
	phases: Record<PerfPhase, PerfPhaseSummary | null>;
	/**
	 * Mean draw calls and frame JS ms of the busy phase: spinning (idle when the reading never
	 * spun), or for an arcade game play (menu when it never played).
	 */
	drawsMean: number | null;
	jsMs: number | null;
	textureMb: number | null;
	/** Per-phase per-frame counts — what lab readings are compared on (`profilerLab.ts`). */
	counts: PerfCounts;
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
 * Whether the reading's 30 fps was the browser's cap. `perf: 8` decides it itself; a `perf: 7`
 * flag is re-checked against the main-thread work of its busiest phase (most frames), since that
 * probe flagged a game missing 60 as capped too. Without those means nothing shows the frames had
 * room, so the reading is judged.
 */
function cappedBrowser(
	report: Obj,
	version: number,
	set: PhaseSet,
	phases: Record<PerfPhase, PerfPhaseSummary | null>,
): boolean {
	if (report.capped30 !== true) return false;
	if (version >= 8) return true;
	const busiest = setPhases(set).reduce((a, b) =>
		(phases[b]?.frames ?? 0) > (phases[a]?.frames ?? 0) ? b : a,
	);
	const parts = ['lateMs', 'tickMs', 'afterMs'].map((key) => workMean(report, busiest, key));
	if (parts.some((ms) => ms === null)) return false;
	return parts.reduce((sum: number, ms) => sum + (ms ?? 0), 0) < CAP_BUSY_MAX_MS;
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
	const kind = version >= 8 ? str(report.kind, 20) : null;
	const phaseSet = phaseSetOf(kind);
	const own = setPhases(phaseSet);
	const phases = Object.fromEntries(
		PERF_PHASES.map((name) => [name, own.includes(name) ? phase(report[name]) : null]),
	) as Record<PerfPhase, PerfPhaseSummary | null>;
	if (own.every((name) => !phases[name])) {
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
	const busy: PerfPhase =
		phaseSet === 'arcade' ? (phases.play ? 'play' : 'menu') : phases.spinning ? 'spinning' : 'idle';
	const textureMb = Array.isArray(report.textures)
		? report.textures.reduce((sum: number, t) => sum + (isObj(t) ? (num(t.mb) ?? 0) : 0), 0)
		: null;
	return {
		ok: true,
		summary: {
			perfVersion: version,
			kind,
			phaseSet,
			capped30: cappedBrowser(report, version, phaseSet, phases),
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
			counts: perfCounts(report, phaseSet),
		},
	};
}

/** The row a page lists: the summary plus where it came from and whether it is kept. */
export interface PerfReportListItem {
	id: string;
	capturedAt: string;
	/** `lab`: a scripted headless run (P6) — compare its counts, never its fps. */
	source: PerfReportSource;
	label: string | null;
	gameKey: string | null;
	deviceClass: string | null;
	gpu: string | null;
	uaFamily: string | null;
	dpr: number | null;
	canvas: string | null;
	buildVersion: string | null;
	buildSha: string | null;
	/** The online runtime release it ran on (stamped at receipt); null for a desktop build. */
	runtimeRelease: string | null;
	flags: Record<string, string>;
	/** The family the probe named (`perf: 8`); null for a `perf: 7` reading. */
	kind: string | null;
	/** Which of the phases below the reading can have; the others are null. */
	phaseSet: PhaseSet;
	idle: PerfPhaseSummary | null;
	spinning: PerfPhaseSummary | null;
	round: PerfPhaseSummary | null;
	menu: PerfPhaseSummary | null;
	play: PerfPhaseSummary | null;
	/** A browser's 30 fps cap: fps and p95 are not judged (`PerfReportSummary.capped30`). */
	capped30: boolean;
	drawsMean: number | null;
	textureMb: number | null;
	counts: PerfCounts | null;
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
 * The launch URL's `device=desktop` is dropped: the game reads no `device` parameter (its layout
 * follows the viewport, its device class the browser's own signals), and a capture link must not
 * claim a phone is a desktop to anything that ever does.
 */
export function captureLinks(gameUrl: string, token: string): CaptureLink[] {
	return CAPTURE_SWITCHES.map((s) => {
		const url = new URL(gameUrl);
		url.searchParams.delete('device');
		url.searchParams.set('perf', '1');
		url.searchParams.set(PERF_SESSION_PARAM, token);
		for (const [key, value] of new URLSearchParams(s.params)) url.searchParams.set(key, value);
		return { id: s.id, label: s.label, url: url.toString() };
	});
}

/** Where a capture GO link lives: `/profiler/go/<link id>/<capture token>`. */
export const CAPTURE_GO_PATH = '/profiler/go';

/**
 * A capture link's GO link: a launcher path that redirects to the capture link. It has no `?` or
 * `&` (a link id is a slug, a token is base64url and `.`), so a page that splits a pasted URL on
 * `&` — BrowserStack Live's dashboard hash — cannot cut `perfsession` off it.
 */
export function captureGoUrl(origin: string, linkId: string, token: string): string {
	return `${origin.replace(/\/+$/, '')}${CAPTURE_GO_PATH}/${linkId}/${token}`;
}

/** The capture link a GO link redirects to; null for a link id that is not a capture switch. */
export function captureGoTarget(gameUrl: string, linkId: string, token: string): string | null {
	return captureLinks(gameUrl, token).find((l) => l.id === linkId)?.url ?? null;
}
