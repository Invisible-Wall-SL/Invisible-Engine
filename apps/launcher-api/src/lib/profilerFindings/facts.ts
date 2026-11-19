/**
 * The facts the Findings rules read that a reading's or a build's summary row does not hold: a
 * reading's per-phase frame timing, spike causes, largest textures and KTX2 fallbacks
 * (`apps/lines/src/components/PerfHud.svelte` `report()`, `perfStats.ts`, `perfSpikes.ts`,
 * `pixi-svelte` `glCounters.ts` `textureList`), and a build's oversize pages, never-loaded files,
 * duplicates and Optimize twins (`scripts/lib/build-breakdown.mjs`). Reduced from the full JSON at
 * receipt into the rows' `facts` column, so the rules never read R2. Bounded: a few KB each.
 */

import { PERF_PHASES, type PerfPhase } from '../profiler';

export const FACTS_VERSION = 1;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The per-frame means (ms) a phase's frames took, from `work.<phase>.perFrame`. */
export interface PhaseTiming {
	frames: number;
	/** Inside `renderer.render`: building and submitting the frame (CPU). */
	renderMs: number | null;
	/** The Pixi tick, its render included. */
	tickMs: number | null;
	/** Every animation-frame callback's JS with its microtasks. */
	jsMs: number | null;
	/** `?perfgpu=1` only: the GPU's work after the submit. */
	gpuWaitMs: number | null;
}

export interface SpikeFact {
	at: number;
	ms: number;
	phase: PerfPhase;
	cause: string;
	why: string;
}

export interface TextureFact {
	src: string;
	kind: string;
	width: number;
	height: number;
	format: string;
	mb: number;
}

export interface ReportFacts {
	v: number;
	/** The full reading could not be read when the facts were filled: every fact rule is unmeasured. */
	missing?: true;
	refreshHz: number | null;
	timing: Record<PerfPhase, PhaseTiming | null>;
	/** Spikes per phase and cause (`spikeCauses`); null when the reading has none recorded. */
	spikeCauses: Record<PerfPhase, Record<string, number>> | null;
	/** The longest spike records, longest first. */
	spikes: SpikeFact[];
	/** The largest textures held, largest first, plus every one over the side limit; null: no list. */
	textures: TextureFact[] | null;
	/** KTX2 pages that fell back to their WebP/PNG twin, with why. */
	ktx2Fallbacks: { key: string; reason: string }[];
}

/** A page larger than this on a side fails to load on many phones (`build-breakdown.mjs`). */
export const MAX_TEXTURE_SIDE = 4096;
const KEEP_TEXTURES = 12;
const KEEP_SPIKES = 8;
const KEEP_FALLBACKS = 20;

function timing(report: Obj, phase: PerfPhase): PhaseTiming | null {
	const work = isObj(report.work) ? report.work[phase] : undefined;
	if (!isObj(work)) return null;
	const perFrame = isObj(work.perFrame) ? work.perFrame : {};
	const mean = (key: string) => {
		const e = perFrame[key];
		return isObj(e) ? num(e.mean) : null;
	};
	const bucket = report[phase];
	const frames = num(work.frames) ?? (isObj(bucket) ? num(bucket.frames) : null) ?? 0;
	if (!frames) return null;
	return {
		frames,
		renderMs: mean('renderMs'),
		tickMs: mean('tickMs'),
		jsMs: mean('jsMs'),
		gpuWaitMs: mean('gpuWaitMs'),
	};
}

function spikeCauses(v: unknown): ReportFacts['spikeCauses'] {
	if (!isObj(v)) return null;
	const out = {} as Record<PerfPhase, Record<string, number>>;
	for (const phase of PERF_PHASES) {
		const counts = isObj(v[phase]) ? v[phase] : {};
		out[phase] = Object.fromEntries(
			Object.entries(counts)
				.map(([cause, n]) => [cause.slice(0, 40), num(n) ?? 0] as const)
				.filter(([, n]) => n > 0)
				.slice(0, 20),
		);
	}
	return out;
}

function spikes(v: unknown): SpikeFact[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter(isObj)
		.map((s) => ({
			at: num(s.at) ?? 0,
			ms: num(s.ms) ?? 0,
			phase: (s.spin === true ? 'spinning' : s.round === true ? 'round' : 'idle') as PerfPhase,
			cause: str(s.cause, 40) ?? 'unknown',
			why: str(s.why, 160) ?? '',
		}))
		.sort((a, b) => b.ms - a.ms)
		.slice(0, KEEP_SPIKES);
}

function textures(v: unknown): TextureFact[] | null {
	if (!Array.isArray(v)) return null;
	const all = v.filter(isObj).map((t) => ({
		src: str(t.src, 160) ?? '?',
		kind: str(t.kind, 20) ?? '?',
		width: num(t.width) ?? 0,
		height: num(t.height) ?? 0,
		format: str(t.format, 30) ?? '?',
		mb: num(t.mb) ?? 0,
	}));
	all.sort((a, b) => b.mb - a.mb);
	const oversize = (t: TextureFact) => t.width > MAX_TEXTURE_SIDE || t.height > MAX_TEXTURE_SIDE;
	return [...all.slice(0, KEEP_TEXTURES), ...all.slice(KEEP_TEXTURES).filter(oversize)].slice(
		0,
		KEEP_TEXTURES * 2,
	);
}

/** A probe report's facts (the parsed Copy JSON, `perf: 7`). Never throws. */
export function reportFacts(report: unknown): ReportFacts {
	const r = isObj(report) ? report : {};
	const list = Array.isArray(r.textureList) ? r.textureList : null;
	return {
		v: FACTS_VERSION,
		refreshHz: num(r.refreshHz),
		timing: Object.fromEntries(PERF_PHASES.map((p) => [p, timing(r, p)])) as Record<
			PerfPhase,
			PhaseTiming | null
		>,
		spikeCauses: spikeCauses(r.spikeCauses),
		spikes: spikes(r.spikes),
		textures: textures(list),
		ktx2Fallbacks: (Array.isArray(r.ktx2Fallbacks) ? r.ktx2Fallbacks : [])
			.filter(isObj)
			.map((f) => ({ key: str(f.key, 200) ?? '?', reason: str(f.reason, 160) ?? '' }))
			.slice(0, KEEP_FALLBACKS),
	};
}

export interface FileFact {
	rel: string;
	bytes: number;
}

export interface BuildFacts {
	v: number;
	missing?: true;
	/** Pages over {@link MAX_TEXTURE_SIDE} on a side. */
	oversized: (FileFact & { w: number; h: number })[];
	/** Asset files nothing loads ("Shipped but never loaded"), largest first. */
	unreferenced: FileFact[];
	/** Files with the same bytes as another shipped file ("Same bytes shipped twice"). */
	duplicates: (FileFact & { of: string })[];
	/**
	 * What 🗜 Optimize drops that players load: a PNG beside its WebP twin (the one nothing loads,
	 * else the PNG) and audio in another format beside its mp3 — only files the game loads, since a
	 * twin nothing loads is already in `unreferenced`. Empty when Optimize was on.
	 */
	optimizeTwins: (FileFact & { twin: string })[];
	optimizeTwinBytes: number;
}

const KEEP_FILES = 20;
const IMAGE_TWIN = /\.(png|webp)$/i;
const AUDIO_EXTRA = /\.(ogg|m4a|aac|wav|webm|opus)$/i;
const stem = (rel: string) => rel.replace(/\.[^./]+$/, '');

interface BreakdownRow {
	rel: string;
	bytes: number;
	kind: string;
	loaded: boolean;
	w: number | null;
	h: number | null;
}

function rowsOf(json: Obj): BreakdownRow[] {
	return (Array.isArray(json.files) ? json.files : []).filter(isObj).map((f) => {
		const dims = isObj(f.dims) ? f.dims : null;
		return {
			rel: str(f.rel, 300) ?? '?',
			bytes: num(f.bytes) ?? 0,
			kind: str(f.kind, 30) ?? '',
			loaded: f.loaded !== false,
			w: dims ? num(dims.w) : null,
			h: dims ? num(dims.h) : null,
		};
	});
}

/** The items of the breakdown's issue with this title, as written (`rel (size)`, `rel = of (size)`). */
function issueItems(json: Obj, title: string): string[] {
	const issue = (Array.isArray(json.issues) ? json.issues : [])
		.filter(isObj)
		.find((i) => i.title === title);
	return issue && Array.isArray(issue.items)
		? issue.items.filter((x) => typeof x === 'string')
		: [];
}

function optimizeTwins(rows: BreakdownRow[]): BuildFacts['optimizeTwins'] {
	const loadedRel = new Set(rows.filter((r) => r.loaded).map((r) => r.rel));
	const byStem = new Map<string, BreakdownRow[]>();
	for (const r of rows) {
		if (!IMAGE_TWIN.test(r.rel) && !AUDIO_EXTRA.test(r.rel) && !/\.mp3$/i.test(r.rel)) continue;
		const list = byStem.get(stem(r.rel)) ?? [];
		list.push(r);
		byStem.set(stem(r.rel), list);
	}
	const out: BuildFacts['optimizeTwins'] = [];
	for (const list of byStem.values()) {
		const png = list.find((r) => /\.png$/i.test(r.rel));
		const webp = list.find((r) => /\.webp$/i.test(r.rel));
		if (png && webp) {
			const drop = !webp.loaded && png.loaded ? webp : png;
			out.push({ rel: drop.rel, bytes: drop.bytes, twin: drop === png ? webp.rel : png.rel });
		}
		const mp3 = list.find((r) => /\.mp3$/i.test(r.rel));
		if (mp3) {
			for (const extra of list.filter((r) => AUDIO_EXTRA.test(r.rel))) {
				out.push({ rel: extra.rel, bytes: extra.bytes, twin: mp3.rel });
			}
		}
	}
	return out.filter((t) => loadedRel.has(t.rel)).sort((a, b) => b.bytes - a.bytes);
}

/** A `build-breakdown.json`'s facts. Never throws. */
export function buildFacts(breakdown: unknown): BuildFacts {
	const json = isObj(breakdown) ? breakdown : {};
	const rows = rowsOf(json);
	const byRel = new Map(rows.map((r) => [r.rel, r]));
	const sized = rows.filter(
		(r): r is BreakdownRow & { w: number; h: number } => r.w !== null && r.h !== null,
	);
	const unreferenced = issueItems(json, 'Shipped but never loaded')
		.map((item) => item.replace(/ \([^)]*\)$/, ''))
		.map((rel) => ({ rel, bytes: byRel.get(rel)?.bytes ?? 0 }));
	const duplicates = issueItems(json, 'Same bytes shipped twice')
		.map((item) => /^(.*) = (.*) \([^)]*\)$/.exec(item))
		.filter((m): m is RegExpExecArray => !!m)
		.map(([, rel, of]) => ({ rel, of, bytes: byRel.get(rel)?.bytes ?? 0 }));
	const build = isObj(json.build) ? json.build : {};
	const twins = build.optimize === true ? [] : optimizeTwins(rows);
	const top = <T extends FileFact>(list: T[]) =>
		[...list].sort((a, b) => b.bytes - a.bytes).slice(0, KEEP_FILES);
	return {
		v: FACTS_VERSION,
		oversized: sized
			.filter((r) => r.w > MAX_TEXTURE_SIDE || r.h > MAX_TEXTURE_SIDE)
			.map((r) => ({ rel: r.rel, bytes: r.bytes, w: r.w, h: r.h }))
			.slice(0, KEEP_FILES),
		unreferenced: top(unreferenced),
		duplicates: top(duplicates),
		optimizeTwins: twins.slice(0, KEEP_FILES),
		optimizeTwinBytes: twins.reduce((n, t) => n + t.bytes, 0),
	};
}

/** A file that could not be read when the facts were filled: say so, so it is not re-tried. */
export const MISSING_REPORT_FACTS: ReportFacts = {
	...reportFacts(null),
	missing: true,
};
export const MISSING_BUILD_FACTS: BuildFacts = { ...buildFacts(null), missing: true };

export const mbOf = (bytes: number) => round1(bytes / 1048576);
