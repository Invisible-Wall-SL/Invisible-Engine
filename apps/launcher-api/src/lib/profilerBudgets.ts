/**
 * Invisible Profiler budgets (`docs/design/invisible-profiler.md` §3, step P3): the studio default
 * thresholds (owner decision 2026-11-16), a project's overrides on top of them, and the verdict a
 * reading or a build gets against them. Pure: `scripts/check-profiler.ts` runs it on fixtures and
 * the page uses the same functions, so the colours on the page are the gate's verdicts.
 */

import { PERF_PHASES, type PerfPhase, type PerfReportListItem } from './profiler';
import { readingOnBuild, type PerfBuildListItem } from './profilerBuilds';

/** The `depends` key of `/profiler`'s budgets. */
export const PROFILER_BUDGETS = 'profiler:budgets';

/**
 * The classes a budget is set for. The probe reports `phone` or `desktop` today
 * (`packages/pixi-svelte/src/lib/deviceClass.ts`); `tablet` is budgeted so a project can set it
 * before the probe tells one apart. `all` is for what does not depend on the device (shipped size).
 */
export const BUDGET_DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export type BudgetDeviceClass = (typeof BUDGET_DEVICE_CLASSES)[number];
export type BudgetScope = BudgetDeviceClass | 'all';
export const BUDGET_SCOPES: readonly BudgetScope[] = [...BUDGET_DEVICE_CLASSES, 'all'];

export interface BudgetMetricDef {
	id: BudgetMetric;
	label: string;
	unit: string;
	/** `higher`: under the line is bad (fps). `lower`: over the line is bad (ms, MB, draws). */
	better: 'higher' | 'lower';
	/** Per phase (idle / spinning / round), or one number for the whole reading or build. */
	phased: boolean;
	/** `all` when it does not depend on the device. */
	perDevice: boolean;
	/** The range a threshold may take — a typo like 600 fps is refused, not saved. */
	min: number;
	max: number;
	/** Where it is read from. */
	from: string;
}

export const BUDGET_METRICS = ['fps', 'p95', 'draws', 'gpuMb', 'shippedMb'] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];

export const BUDGET_METRIC_DEFS: Record<BudgetMetric, BudgetMetricDef> = {
	fps: {
		id: 'fps',
		label: 'fps',
		unit: 'fps',
		better: 'higher',
		phased: true,
		perDevice: true,
		min: 1,
		max: 240,
		from: 'readings',
	},
	p95: {
		id: 'p95',
		label: 'p95 frame',
		unit: 'ms',
		better: 'lower',
		phased: true,
		perDevice: true,
		min: 1,
		max: 1000,
		from: 'readings',
	},
	draws: {
		id: 'draws',
		label: 'Draws a frame',
		unit: 'draws',
		better: 'lower',
		phased: false,
		perDevice: true,
		min: 1,
		max: 100000,
		from: 'readings',
	},
	gpuMb: {
		id: 'gpuMb',
		label: 'GPU memory',
		unit: 'MB',
		better: 'lower',
		phased: false,
		perDevice: true,
		min: 1,
		max: 100000,
		from: "readings' textures and the build's estimate",
	},
	shippedMb: {
		id: 'shippedMb',
		label: 'Shipped size',
		unit: 'MB',
		better: 'lower',
		phased: false,
		perDevice: false,
		min: 0.1,
		max: 100000,
		from: 'builds',
	},
};

/** `''` when the metric is not per phase — a key column, so never null. */
export type BudgetPhase = PerfPhase | '';

export interface BudgetKey {
	deviceClass: BudgetScope;
	metric: BudgetMetric;
	phase: BudgetPhase;
}

export interface BudgetThresholds {
	/** Past this line (below for `higher`, above for `lower`) is a warn. Null: no warn band. */
	warn: number | null;
	/** Past this line is a fail. Null: never fails, only warns. */
	fail: number | null;
}

export type BudgetLine = BudgetKey & BudgetThresholds;

/** A project's override as stored (`perf_budgets`); `rev` is the save path's compare token. */
export interface BudgetOverride extends BudgetLine {
	rev: number;
	updatedAt: string;
	updatedBy: string | null;
}

/**
 * Studio defaults — owner decision 2026-11-16: phone 60 fps idle and ≥ 50 spinning with p95 ≤
 * 25 ms, desktop 60 / 60, shipped ≤ 25 MB, GPU ≤ 150 MB on phones. The fail lines are those
 * numbers, except that "60 fps" means locked to a 60 Hz display, which measures 59.x: it fails
 * under 55 and warns under 58. The warn bands sit inside each fail line: ≥ 50 fps warns under 55,
 * p95 warns over 20 ms, shipped over 20 MB, GPU over 120 MB. A round is a spin plus its win
 * presentation, so it gets the spinning line. A tablet gets the phone's lines. Draws a frame has
 * no default (no owner number); a project may set one.
 */
export const STUDIO_BUDGETS: readonly BudgetLine[] = [
	...(['phone', 'tablet'] as const).flatMap((deviceClass): BudgetLine[] => [
		{ deviceClass, metric: 'fps', phase: 'idle', warn: 58, fail: 55 },
		{ deviceClass, metric: 'fps', phase: 'spinning', warn: 55, fail: 50 },
		{ deviceClass, metric: 'fps', phase: 'round', warn: 55, fail: 50 },
		...PERF_PHASES.map((phase): BudgetLine => ({
			deviceClass,
			metric: 'p95',
			phase,
			warn: 20,
			fail: 25,
		})),
		{ deviceClass, metric: 'gpuMb', phase: '', warn: 120, fail: 150 },
	]),
	...PERF_PHASES.flatMap((phase): BudgetLine[] => [
		{ deviceClass: 'desktop', metric: 'fps', phase, warn: 58, fail: 55 },
		{ deviceClass: 'desktop', metric: 'p95', phase, warn: 20, fail: 25 },
	]),
	{ deviceClass: 'all', metric: 'shippedMb', phase: '', warn: 20, fail: 25 },
];

export const budgetKeyId = (k: BudgetKey): string => `${k.deviceClass}:${k.metric}:${k.phase}`;

/** Every key a budget can be set for, in the order the Budgets tab lists them. */
export function budgetKeys(): BudgetKey[] {
	const keys: BudgetKey[] = [];
	for (const metric of BUDGET_METRICS) {
		const def = BUDGET_METRIC_DEFS[metric];
		const scopes: BudgetScope[] = def.perDevice ? [...BUDGET_DEVICE_CLASSES] : ['all'];
		const phases: BudgetPhase[] = def.phased ? [...PERF_PHASES] : [''];
		for (const deviceClass of scopes) {
			for (const phase of phases) keys.push({ deviceClass, metric, phase });
		}
	}
	return keys;
}

export function isBudgetKey(k: {
	deviceClass: unknown;
	metric: unknown;
	phase: unknown;
}): k is BudgetKey {
	return budgetKeys().some(
		(b) => b.deviceClass === k.deviceClass && b.metric === k.metric && b.phase === k.phase,
	);
}

/**
 * Why these thresholds cannot be saved for this metric, or null when they can: at least one line,
 * each inside the metric's range, and the warn line on the good side of the fail line.
 */
export function budgetRefusal(metric: BudgetMetric, t: BudgetThresholds): string | null {
	const def = BUDGET_METRIC_DEFS[metric];
	if (t.warn === null && t.fail === null) return 'Set a warn or a fail line (or reset to default).';
	for (const v of [t.warn, t.fail]) {
		if (v === null) continue;
		if (!Number.isFinite(v) || v < def.min || v > def.max) {
			return `${def.label} must be between ${def.min} and ${def.max} ${def.unit}.`;
		}
	}
	if (t.warn !== null && t.fail !== null) {
		const ordered = def.better === 'higher' ? t.warn >= t.fail : t.warn <= t.fail;
		if (!ordered) {
			return def.better === 'higher'
				? 'The warn line must be at or above the fail line (more fps is better).'
				: `The warn line must be at or below the fail line (fewer ${def.unit} is better).`;
		}
	}
	return null;
}

export interface EffectiveBudget extends BudgetLine {
	/** The studio default for this key, null when there is none. */
	studio: BudgetThresholds | null;
	/** The project's override, null when it uses the studio default. */
	override: BudgetOverride | null;
}

/** Every key's thresholds for one project: its override where it has one, else the studio line. */
export function effectiveBudgets(
	overrides: readonly BudgetOverride[],
	studio: readonly BudgetLine[] = STUDIO_BUDGETS,
): EffectiveBudget[] {
	const studioById = new Map(studio.map((s) => [budgetKeyId(s), s]));
	const overrideById = new Map(overrides.map((o) => [budgetKeyId(o), o]));
	return budgetKeys().map((key) => {
		const id = budgetKeyId(key);
		const s = studioById.get(id);
		const o = overrideById.get(id) ?? null;
		const line = o ?? s;
		return {
			...key,
			warn: line?.warn ?? null,
			fail: line?.fail ?? null,
			studio: s ? { warn: s.warn, fail: s.fail } : null,
			override: o,
		};
	});
}

/**
 * - `pass` / `warn` / `fail`: against the line.
 * - `nodata`: there is a budget, but too few frames (or no value) to judge — never a pass.
 * - `none`: no budget for it, so it is not judged.
 */
export type Verdict = 'pass' | 'warn' | 'fail' | 'nodata' | 'none';

const RANK: Record<Verdict, number> = { none: 0, pass: 1, nodata: 2, warn: 3, fail: 4 };

/** The worst of several verdicts: a fail anywhere is a fail; no data beats a pass. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
	return verdicts.reduce<Verdict>((w, v) => (RANK[v] > RANK[w] ? v : w), 'none');
}

/** One value against one line. */
export function judge(
	metric: BudgetMetric,
	value: number | null,
	t: BudgetThresholds | undefined,
): Verdict {
	if (!t || (t.warn === null && t.fail === null)) return 'none';
	if (value === null || !Number.isFinite(value)) return 'nodata';
	const past = (line: number | null) =>
		line !== null && (BUDGET_METRIC_DEFS[metric].better === 'higher' ? value < line : value > line);
	if (past(t.fail)) return 'fail';
	if (past(t.warn)) return 'warn';
	return 'pass';
}

/**
 * A phase with fewer frames than this says "not enough data": about two seconds at 60 fps — one
 * spin, or a short idle. A shorter run's p95 is one or two frames, and its fps is noise.
 */
export const MIN_PHASE_FRAMES = 120;

export interface MetricVerdict extends BudgetKey {
	value: number | null;
	/** Frames behind a per-phase value (summed over readings for a group). */
	frames: number | null;
	warn: number | null;
	fail: number | null;
	verdict: Verdict;
}

type ReadingForBudget = Pick<
	PerfReportListItem,
	'deviceClass' | 'idle' | 'spinning' | 'round' | 'drawsMean' | 'textureMb' | 'flags'
>;

/** The class a reading is judged as, or null when the probe named none this tool budgets. */
export function readingDeviceClass(
	r: Pick<PerfReportListItem, 'deviceClass'>,
): BudgetDeviceClass | null {
	return (BUDGET_DEVICE_CLASSES as readonly string[]).includes(r.deviceClass ?? '')
		? (r.deviceClass as BudgetDeviceClass)
		: null;
}

/**
 * Whether a reading counts toward a verdict: only as shipped. A reading with a test switch
 * (`particles=off`, `fx=0`, …) measures what a feature costs, not the build players get.
 */
export const asShipped = (r: Pick<PerfReportListItem, 'flags'>): boolean =>
	Object.keys(r.flags ?? {}).length === 0;

const lookup = (budgets: readonly EffectiveBudget[]) => {
	const byId = new Map(budgets.map((b) => [budgetKeyId(b), b]));
	return (k: BudgetKey) => byId.get(budgetKeyId(k));
};

const median = (values: readonly number[]): number | null => {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Readings of ONE device class judged together: each per-phase number is the median over the
 * readings with at least `MIN_PHASE_FRAMES` frames in that phase (so one unlucky reading does not
 * fail a device, and a reading that never spun does not count as spinning); the others are the
 * median over readings that have them. With no reading enough, a budgeted line is `nodata`.
 * One reading is a group of one.
 */
export function evaluateReadings(
	deviceClass: BudgetDeviceClass,
	readings: readonly ReadingForBudget[],
	budgets: readonly EffectiveBudget[],
): MetricVerdict[] {
	const line = lookup(budgets);
	const out: MetricVerdict[] = [];
	for (const metric of ['fps', 'p95'] as const) {
		for (const phase of PERF_PHASES) {
			const enough = readings
				.map((r) => r[phase])
				.filter((p): p is NonNullable<typeof p> => !!p && p.frames >= MIN_PHASE_FRAMES);
			const key = { deviceClass, metric, phase };
			const b = line(key);
			const value = median(enough.map((p) => p[metric]));
			out.push({
				...key,
				value,
				frames: readings.reduce((n, r) => n + (r[phase]?.frames ?? 0), 0),
				warn: b?.warn ?? null,
				fail: b?.fail ?? null,
				verdict: judge(metric, value, b),
			});
		}
	}
	const flat: [BudgetMetric, (r: ReadingForBudget) => number | null][] = [
		['draws', (r) => r.drawsMean],
		['gpuMb', (r) => r.textureMb],
	];
	for (const [metric, read] of flat) {
		const key = { deviceClass, metric, phase: '' as const };
		const b = line(key);
		const value = median(readings.map(read).filter((v): v is number => v !== null));
		out.push({
			...key,
			value,
			frames: null,
			warn: b?.warn ?? null,
			fail: b?.fail ?? null,
			verdict: judge(metric, value, b),
		});
	}
	return out;
}

/** What a build's own breakdown says against the budgets: shipped size, and its GPU estimate per class. */
export function evaluateBuildSize(
	build: Pick<PerfBuildListItem, 'shippedBytes' | 'gpuBytes'>,
	budgets: readonly EffectiveBudget[],
): MetricVerdict[] {
	const line = lookup(budgets);
	const MB = 1048576;
	const shipped = { deviceClass: 'all' as const, metric: 'shippedMb' as const, phase: '' as const };
	const out: MetricVerdict[] = [
		{
			...shipped,
			value: build.shippedBytes / MB,
			frames: null,
			warn: line(shipped)?.warn ?? null,
			fail: line(shipped)?.fail ?? null,
			verdict: judge('shippedMb', build.shippedBytes / MB, line(shipped)),
		},
	];
	for (const deviceClass of BUDGET_DEVICE_CLASSES) {
		const key = { deviceClass, metric: 'gpuMb' as const, phase: '' as const };
		const b = line(key);
		// No estimate (an old breakdown) is no data, not a 0 MB pass.
		const value = build.gpuBytes > 0 ? build.gpuBytes / MB : null;
		out.push({
			...key,
			value,
			frames: null,
			warn: b?.warn ?? null,
			fail: b?.fail ?? null,
			verdict: judge('gpuMb', value, b),
		});
	}
	return out;
}

export interface BuildVerdicts {
	/**
	 * Per device class, from the as-shipped readings taken on the build — the worst of its GPUs;
	 * null: no reading of it.
	 */
	devices: Record<BudgetDeviceClass, { verdict: Verdict; readings: number } | null>;
	shipped: Verdict;
	/** The GPU estimate against the strictest class that has a GPU budget. */
	gpu: Verdict;
	size: MetricVerdict[];
}

/** The Builds tab's verdict columns for one build. */
export function evaluateBuild(
	build: PerfBuildListItem,
	readings: readonly (PerfReportListItem & { gameKey?: string | null })[],
	budgets: readonly EffectiveBudget[],
): BuildVerdicts {
	// Judged per device (class and GPU), the class taking its worst: a weak phone failing is the
	// news, and a median across GPUs would let a strong one hide it.
	const groups = deviceGroups(
		readings.filter((r) => readingOnBuild(r, build)),
		budgets,
	);
	const devices = Object.fromEntries(
		BUDGET_DEVICE_CLASSES.map((c) => {
			const mine = groups.filter((g) => g.deviceClass === c);
			if (!mine.length) return [c, null];
			return [
				c,
				{
					verdict: worstVerdict(mine.map((g) => g.verdict)),
					readings: mine.reduce((n, g) => n + g.readings.length, 0),
				},
			];
		}),
	) as BuildVerdicts['devices'];
	const size = evaluateBuildSize(build, budgets);
	return {
		devices,
		shipped: size.find((m) => m.metric === 'shippedMb')?.verdict ?? 'none',
		gpu: worstVerdict(size.filter((m) => m.metric === 'gpuMb').map((m) => m.verdict)),
		size,
	};
}

export interface DeviceGroup {
	id: string;
	deviceClass: BudgetDeviceClass;
	gpu: string;
	readings: PerfReportListItem[];
	metrics: MetricVerdict[];
	verdict: Verdict;
}

/**
 * The Devices tab: as-shipped readings grouped by device class and GPU, each group judged by
 * `evaluateReadings`, the worst first. A reading whose class this tool does not budget is left out.
 */
export function deviceGroups(
	readings: readonly PerfReportListItem[],
	budgets: readonly EffectiveBudget[],
): DeviceGroup[] {
	const groups = new Map<
		string,
		{ deviceClass: BudgetDeviceClass; gpu: string; readings: PerfReportListItem[] }
	>();
	for (const r of readings) {
		const c = readingDeviceClass(r);
		if (!c || !asShipped(r)) continue;
		const gpu = r.gpu ?? 'Unknown GPU';
		const id = `${c}|${gpu}`;
		const g = groups.get(id) ?? { deviceClass: c, gpu, readings: [] };
		g.readings.push(r);
		groups.set(id, g);
	}
	return [...groups.entries()]
		.map(([id, g]) => {
			const metrics = evaluateReadings(g.deviceClass, g.readings, budgets);
			return { id, ...g, metrics, verdict: worstVerdict(metrics.map((m) => m.verdict)) };
		})
		.sort(
			(a, b) =>
				RANK[b.verdict] - RANK[a.verdict] ||
				BUDGET_DEVICE_CLASSES.indexOf(a.deviceClass) -
					BUDGET_DEVICE_CLASSES.indexOf(b.deviceClass) ||
				a.gpu.localeCompare(b.gpu),
		);
}

export const VERDICT_TEXT: Record<Verdict, string> = {
	pass: 'pass',
	warn: 'warn',
	fail: 'fail',
	nodata: 'not enough data',
	none: 'no budget',
};

/** A threshold line as the page writes it: `< 55 fps`, `> 25 ms`. */
export function lineText(metric: BudgetMetric, value: number | null): string {
	if (value === null) return '—';
	const def = BUDGET_METRIC_DEFS[metric];
	return `${def.better === 'higher' ? '<' : '>'} ${value} ${def.unit}`;
}

export interface BuildReadings {
	id: string;
	label: string;
	sub: string;
	/** The newest reading's capture time (ISO). */
	newest: string;
	readings: PerfReportListItem[];
	metrics: MetricVerdict[];
	verdict: Verdict;
}

/**
 * One device's readings build by build, newest first (the Devices tab's open row): grouped under
 * the build record they join (`readingOnBuild`), else under the build number they were stamped
 * with, else under "no build stamp"; each group judged like a device group.
 */
export function readingsByBuild(
	group: Pick<DeviceGroup, 'deviceClass' | 'readings'>,
	builds: readonly PerfBuildListItem[],
	budgets: readonly EffectiveBudget[],
): BuildReadings[] {
	const byBuild = new Map<string, Omit<BuildReadings, 'metrics' | 'verdict'>>();
	for (const r of group.readings) {
		const b = builds.find((x) => readingOnBuild(r, x));
		const id = b ? b.id : `stamp:${r.buildVersion ?? ''}:${r.buildSha ?? ''}`;
		const entry = byBuild.get(id) ?? {
			id,
			label: b ? `v${b.build}` : r.buildVersion ? `v${r.buildVersion}` : 'No build stamp',
			sub: b
				? `${b.gameKey} · ${b.kind}`
				: r.buildVersion
					? 'no build record'
					: 'the reading names no build',
			newest: r.capturedAt,
			readings: [],
		};
		entry.readings.push(r);
		if (r.capturedAt > entry.newest) entry.newest = r.capturedAt;
		byBuild.set(id, entry);
	}
	return [...byBuild.values()]
		.sort((a, b) => b.newest.localeCompare(a.newest))
		.map((e) => {
			const metrics = evaluateReadings(group.deviceClass, e.readings, budgets);
			return { ...e, metrics, verdict: worstVerdict(metrics.map((m) => m.verdict)) };
		});
}
