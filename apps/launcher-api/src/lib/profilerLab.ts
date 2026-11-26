/**
 * Invisible Profiler lab runs (P6, `docs/design/invisible-profiler.md` §6): the per-frame COUNTS a
 * reading is compared on, and the comparison of a lab reading with the previous lab reading of the
 * same game. Lab fps is not compared: a shared CI runner renders in software and swings about 2× run
 * to run, while what a frame does — draws, passes, uploads, GL calls — does not. Pure: the fixture
 * gate (`scripts/check-profiler.ts`) runs it on plain JSON.
 */

import type { PhaseSet } from './profiler';

/** The work keys a lab reading is compared on, as the probe names them (`work.<phase>.perFrame`). */
export const LAB_COUNT_KEYS = ['draws', 'passes', 'textureUploads', 'calls', 'jsMs'] as const;
export type LabCountKey = (typeof LAB_COUNT_KEYS)[number];

export const LAB_COUNT_LABELS: Record<LabCountKey | 'textureMb', string> = {
	draws: 'draws',
	passes: 'passes',
	textureUploads: 'uploads',
	calls: 'GL calls',
	jsMs: 'JS ms',
	textureMb: 'texture MB',
};

/**
 * An arcade phase's own per-frame means, kept beside the lab counts for Compare. Not lab-judged:
 * bodies and patches follow what the field did, not the build.
 */
export const ARCADE_COUNT_KEYS = [
	'simSteps',
	'simMs',
	'bodies',
	'netMs',
	'patches',
	'patchBytes',
] as const;
export type ArcadeCountKey = (typeof ARCADE_COUNT_KEYS)[number];

export const ARCADE_COUNT_LABELS: Record<ArcadeCountKey, string> = {
	simSteps: 'sim steps',
	simMs: 'sim ms',
	bodies: 'bodies',
	netMs: 'room ms',
	patches: 'patches',
	patchBytes: 'patch bytes',
};

/** The phases counts are kept for: a slot's idle and spinning, an arcade game's menu and play. */
export const LAB_PHASES = ['idle', 'spinning', 'menu', 'play'] as const;
export type LabPhase = (typeof LAB_PHASES)[number];
export const LAB_PHASE_SETS: Record<PhaseSet, readonly LabPhase[]> = {
	slot: ['idle', 'spinning'],
	arcade: ['menu', 'play'],
};

type Band = { rel: number; abs: number };

const IDLE_BAND: Record<LabCountKey, Band> = {
	draws: { rel: 0.35, abs: 2 },
	passes: { rel: 0.35, abs: 0.5 },
	textureUploads: { rel: 0.5, abs: 0.2 },
	calls: { rel: 0.2, abs: 20 },
	jsMs: { rel: 0.5, abs: 1 },
};

/**
 * How far a count may move between two lab runs of the same build before it reads as a change
 * (relative, plus an absolute floor so a near-zero count does not flag on noise). Measured on three
 * runs of one build (`docs/status/profiler.md`, "Lab runs"): spinning counts agreed within 2%, but
 * idle includes the win cycle of whatever the RNG dealt, and its draws spread 25%; on the CI runner
 * a run with two big-win holds had 27% more idle passes than one without. JS ms is wall
 * time on a shared runner and gets the widest band. Menu and play are not measured yet: they take
 * idle's band, the widest.
 */
export const LAB_TOLERANCE: Record<LabPhase, Record<LabCountKey, Band>> & { textureMb: Band } = {
	spinning: {
		draws: { rel: 0.05, abs: 1 },
		passes: { rel: 0.1, abs: 0.5 },
		textureUploads: { rel: 0.5, abs: 0.2 },
		calls: { rel: 0.05, abs: 10 },
		jsMs: { rel: 0.5, abs: 1 },
	},
	idle: IDLE_BAND,
	menu: IDLE_BAND,
	play: IDLE_BAND,
	textureMb: { rel: 0.02, abs: 1 },
};

export type PerfPhaseCounts = { frames: number } & Record<LabCountKey, number | null>;
export type ArcadePhaseCounts = PerfPhaseCounts & Record<ArcadeCountKey, number | null>;

/**
 * What a reading's `counts` column holds: the per-frame means of each phase of its set, and texture
 * MB. `menu` / `play` only on an arcade reading (a slot reading's row never had them).
 */
export interface PerfCounts {
	idle: PerfPhaseCounts | null;
	spinning: PerfPhaseCounts | null;
	menu?: ArcadePhaseCounts | null;
	play?: ArcadePhaseCounts | null;
	textureMb: number | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function phaseCounts<K extends string>(
	report: Obj,
	phase: LabPhase,
	keys: readonly K[],
): ({ frames: number } & Record<K, number | null>) | null {
	const work = isObj(report.work) ? report.work[phase] : undefined;
	if (!isObj(work)) return null;
	const frames = num(work.frames);
	if (!frames) return null;
	const perFrame = isObj(work.perFrame) ? work.perFrame : {};
	const counts = { frames } as { frames: number } & Record<K, number | null>;
	for (const key of keys) {
		const entry = perFrame[key];
		(counts as Record<K, number | null>)[key] = isObj(entry) ? num(entry.mean) : null;
	}
	return counts;
}

const ARCADE_KEYS = [...LAB_COUNT_KEYS, ...ARCADE_COUNT_KEYS] as const;

/** The counts of a probe report (the parsed Copy JSON) of a phase set; never throws. */
export function perfCounts(report: unknown, set: PhaseSet = 'slot'): PerfCounts {
	if (!isObj(report)) return { idle: null, spinning: null, textureMb: null };
	const mb = Array.isArray(report.textures)
		? report.textures.reduce((sum: number, t) => sum + (isObj(t) ? (num(t.mb) ?? 0) : 0), 0)
		: null;
	const textureMb = mb === null ? null : Math.round(mb * 10) / 10;
	if (set === 'arcade') {
		return {
			idle: null,
			spinning: null,
			menu: phaseCounts(report, 'menu', ARCADE_KEYS),
			play: phaseCounts(report, 'play', ARCADE_KEYS),
			textureMb,
		};
	}
	return {
		idle: phaseCounts(report, 'idle', LAB_COUNT_KEYS),
		spinning: phaseCounts(report, 'spinning', LAB_COUNT_KEYS),
		textureMb,
	};
}

/** The fields of a listed reading the lab comparison reads. */
export interface LabReadingLike {
	id: string;
	capturedAt: string;
	source: string;
	gameKey: string | null;
	flags: Record<string, string>;
	counts: PerfCounts | null;
}

const sameFlags = (a: Record<string, string>, b: Record<string, string>) => {
	const ka = Object.keys(a).sort();
	const kb = Object.keys(b).sort();
	return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * The lab reading taken just before `reading` on the same game with the same test switches; null
 * when there is none (or `reading` is not a lab reading).
 */
export function previousLabReading<T extends LabReadingLike>(items: T[], reading: T): T | null {
	if (reading.source !== 'lab' || !reading.gameKey) return null;
	let best: T | null = null;
	for (const r of items) {
		if (r.id === reading.id || r.source !== 'lab' || r.gameKey !== reading.gameKey) continue;
		if (r.capturedAt >= reading.capturedAt || !sameFlags(r.flags, reading.flags)) continue;
		if (!best || r.capturedAt > best.capturedAt) best = r;
	}
	return best;
}

export interface LabCountRow {
	phase: LabPhase | 'all';
	key: LabCountKey | 'textureMb';
	label: string;
	value: number | null;
	previous: number | null;
	/** `value − previous`; null when either is missing. */
	delta: number | null;
	/** Outside {@link LAB_TOLERANCE}: a real change, not run-to-run noise. */
	changed: boolean;
}

export function withinLabTolerance(
	phase: LabPhase | 'all',
	key: LabCountKey | 'textureMb',
	value: number,
	previous: number,
): boolean {
	const t =
		phase === 'all' || key === 'textureMb' ? LAB_TOLERANCE.textureMb : LAB_TOLERANCE[phase][key];
	return Math.abs(value - previous) <= Math.max(t.abs, t.rel * Math.abs(previous));
}

/** A lab reading's counts beside the previous one's, a row per phase and count. */
export function labComparison(current: PerfCounts, previous: PerfCounts | null): LabCountRow[] {
	const row = (
		phase: LabCountRow['phase'],
		key: LabCountRow['key'],
		value: number | null,
		before: number | null,
	): LabCountRow => {
		const both = value !== null && before !== null;
		return {
			phase,
			key,
			label: LAB_COUNT_LABELS[key],
			value,
			previous: before,
			delta: both ? Math.round((value - before) * 100) / 100 : null,
			changed: both && !withinLabTolerance(phase, key, value, before),
		};
	};
	const rows: LabCountRow[] = [];
	for (const phase of LAB_PHASES) {
		const now = current[phase];
		if (!now) continue;
		const then = previous?.[phase] ?? null;
		for (const key of LAB_COUNT_KEYS) rows.push(row(phase, key, now[key], then?.[key] ?? null));
	}
	rows.push(row('all', 'textureMb', current.textureMb, previous?.textureMb ?? null));
	return rows;
}
