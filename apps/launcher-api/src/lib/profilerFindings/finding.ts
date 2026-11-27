/**
 * Invisible Profiler findings (P4, `docs/design/invisible-profiler.md` §4): what one rule says about
 * a reading, a build, or a pair — `{ rule, severity, evidence, estimate, owner }` — and what every
 * rule is handed. P5 files a finding as a bug from this shape, so its fields are the bug's.
 */

import type { PerfReportListItem } from '../profiler';
import { MIN_PHASE_FRAMES, type EffectiveBudget } from '../profilerBudgets';
import { readingOnBuild, type PerfBuildListItem } from '../profilerBuilds';
import type {
	ArcadeFacts,
	ArcadePhaseFact,
	ArcadeWorkKey,
	BuildFacts,
	MeanMax,
	ReportFacts,
} from './facts';
import type { NetworkFacts } from '../profilerNetwork';

export const FINDING_RULES = [
	'fpsBelowBudget',
	'gpuCpuBound',
	'featureCost',
	'spikes',
	'textures',
	'unusedBytes',
	'optimizeOff',
	'regression',
	'simCatchUp',
	'spawnChurn',
	'bodyCost',
	'patchStutter',
	'heavyTransfer',
	'uncompressedText',
	'notCached',
	'firstFrame',
	'netTraffic',
] as const;
export type FindingRule = (typeof FINDING_RULES)[number];

export const RULE_TITLES: Record<FindingRule, string> = {
	fpsBelowBudget: 'Fps below budget',
	gpuCpuBound: 'GPU- or CPU-bound',
	featureCost: 'Feature cost',
	spikes: 'Spikes by cause',
	textures: 'Textures',
	unusedBytes: 'Unused bytes',
	optimizeOff: 'Optimize off',
	regression: 'Regression',
	simCatchUp: 'Sim catch-up',
	spawnChurn: 'Spawn churn',
	bodyCost: 'Cost per body',
	patchStutter: 'Patch / jitter stutter',
	heavyTransfer: 'Heavy downloads',
	uncompressedText: 'Uncompressed text',
	notCached: 'Downloaded again',
	firstFrame: 'Before the first frame',
	netTraffic: 'Slow or heavy messages',
};

/** `high`: a budget fails; `medium`: a warn, or a cost worth cutting; `low`: worth knowing. */
export type Severity = 'high' | 'medium' | 'low';
export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** What the finding's numbers were read from — the page links each one. */
export type EvidenceRef =
	{ type: 'reading'; id: string; label: string } | { type: 'build'; id: string; label: string };

/**
 * What fixing it would buy, from a measurement only: a test switch's delta, a file's bytes, a
 * breakdown figure. Null = unmeasured (the page says so); never a modelled number.
 */
export interface Estimate {
	value: number;
	unit: 'fps' | 'draws' | 'MB' | 'GPU MB' | 'spikes';
	/** What the number is, in words ("fps a phone gains with particles off"). */
	basis: string;
}

/**
 * Who fixes it: an agent from `docs/knowledge/owners.json` (or the engine's agent named in the
 * design's table), or a person's role where the fix is content, not code.
 */
export interface FindingOwner {
	kind: 'agent' | 'person';
	id: string;
	label: string;
}

export interface Finding {
	/** Stable across reloads, so P5 can tell a finding already filed. */
	id: string;
	rule: FindingRule;
	severity: Severity;
	title: string;
	/** One line per fact, as the page shows it. */
	detail: string[];
	evidence: EvidenceRef[];
	estimate: Estimate | null;
	owner: FindingOwner;
	/** The device class it is about, null when it is about a build's files. */
	deviceClass: string | null;
	gameKey: string | null;
}

/**
 * `docs/knowledge/owners.json`'s maps, as the rules read them: tools, game kinds, and the areas no
 * tool owns (`assets`, `delivery` — caching and compression —, `rgs`, `gameServer`).
 */
export interface OwnerMap {
	tools: Record<string, string[]>;
	kinds: Record<string, string[]>;
	areas?: Record<string, string[]>;
}

export interface FindingContext {
	readings: readonly PerfReportListItem[];
	builds: readonly PerfBuildListItem[];
	/** By reading / build id; a row without facts (kept before P4, not yet filled) is absent. */
	readingFacts: ReadonlyMap<string, ReportFacts>;
	buildFacts: ReadonlyMap<string, BuildFacts>;
	budgets: readonly EffectiveBudget[];
	/** The project's game kind (`projects.game_type`), for the fps rule's owner. */
	gameKind: string | null;
	owners: OwnerMap;
}

export type Rule = (ctx: FindingContext) => Finding[];

export const agent = (id: string): FindingOwner => ({ kind: 'agent', id, label: id });

/** The first agent owners.json names for a tool, else the fallback agent. */
export function toolOwner(owners: OwnerMap, toolId: string, fallback: string): FindingOwner {
	return agent(owners.tools[toolId]?.[0] ?? fallback);
}

/** The first agent owners.json names for an area no tool owns, else the fallback agent. */
export function areaOwner(owners: OwnerMap, area: string, fallback: string): FindingOwner {
	return agent(owners.areas?.[area]?.[0] ?? fallback);
}

/** The game kind's build agent (owners.json `kinds`); the engine's agent for a kind it lacks. */
export function kindOwner(owners: OwnerMap, kind: string | null): FindingOwner {
	return agent((kind && owners.kinds[kind]?.[0]) || 'engine-pixi-svelte');
}

export const PROJECT_AUTHOR: FindingOwner = {
	kind: 'person',
	id: 'author',
	label: 'Project author (Invisible FTP Browser)',
};
export const PUBLISHER: FindingOwner = { kind: 'person', id: 'publisher', label: 'Publisher' };
export const BUILD_CHANGES: FindingOwner = {
	kind: 'person',
	id: 'changes',
	label: 'Whoever changed the build',
};

const shortTime = (iso: string) => iso.slice(5, 16).replace('T', ' ');

/** A reading as evidence: its build, device, label, switches and capture time (UTC). */
export const readingRef = (r: PerfReportListItem): EvidenceRef => ({
	type: 'reading',
	id: r.id,
	label: `${r.buildVersion ? `v${r.buildVersion} · ` : ''}${r.source === 'lab' ? 'lab · ' : ''}${r.deviceClass ?? '?'} · ${r.gpu ?? 'unknown GPU'}${r.label ? ` · ${r.label}` : ''}${
		Object.keys(r.flags).length
			? ` · ${Object.entries(r.flags)
					.map(([k, v]) => `${k}=${v}`)
					.join(' ')}`
			: ''
	} · ${shortTime(r.capturedAt)}`,
});

export const buildRef = (b: PerfBuildListItem): EvidenceRef => ({
	type: 'build',
	id: b.id,
	label: `v${b.build} · ${b.gameKey} (${b.kind})`,
});

/**
 * The scale a saving is ranked on: its share of a typical budget, so 5 fps and 3 MB compare.
 * The budgets' own fail lines where they exist (`profilerBudgets.ts` studio defaults), else a
 * frame's worth.
 */
const RANK_SCALE: Record<Estimate['unit'], number> = {
	fps: 60,
	'GPU MB': 150,
	MB: 25,
	draws: 100,
	spikes: 10,
};

export const rankValue = (e: Estimate | null): number =>
	e ? Math.abs(e.value) / RANK_SCALE[e.unit] : -1;

/** Severity first, then the estimated saving (unmeasured last), then the title for a stable order. */
export function rankFindings(findings: readonly Finding[]): Finding[] {
	return [...findings].sort(
		(a, b) =>
			SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
			rankValue(b.estimate) - rankValue(a.estimate) ||
			a.title.localeCompare(b.title) ||
			a.id.localeCompare(b.id),
	);
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Readings that may speak for fps: not a lab run (P6: a shared runner's fps swings ~2×). */
export const fpsReadings = (readings: readonly PerfReportListItem[]) =>
	readings.filter((r) => r.source !== 'lab');

/** The newest build of each game key and kind — what the build rules judge. */
export function newestBuilds(builds: readonly PerfBuildListItem[]): PerfBuildListItem[] {
	const newest = new Map<string, PerfBuildListItem>();
	for (const b of builds) {
		const key = `${b.gameKey}|${b.kind}`;
		const prior = newest.get(key);
		if (
			!prior ||
			b.registeredAt > prior.registeredAt ||
			(b.registeredAt === prior.registeredAt && b.id > prior.id)
		) {
			newest.set(key, b);
		}
	}
	return [...newest.values()];
}

/** A build stamp a reading carries, to group readings of one build without a build record. */
export const stampOf = (r: PerfReportListItem) => `${r.gameKey ?? ''}|${r.buildVersion ?? ''}`;

interface StampGroup {
	stamp: string;
	readings: PerfReportListItem[];
	/** The build record the stamp joins (`readingOnBuild`), when there is one. */
	registeredAt: string | null;
	newestCapture: string;
}

const numeric = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Newer build first: by the build records the two stamps join, else by build number when both are
 * numbers, else by the newest capture. Never by capture alone when the build is known — a tester
 * re-measuring an old build must not make it "current".
 */
function newerStamp(a: StampGroup, b: StampGroup): number {
	if (a.registeredAt && b.registeredAt && a.registeredAt !== b.registeredAt) {
		return b.registeredAt.localeCompare(a.registeredAt);
	}
	const na = numeric(a.readings[0].buildVersion);
	const nb = numeric(b.readings[0].buildVersion);
	if (na !== null && nb !== null && na !== nb) return nb - na;
	return b.newestCapture.localeCompare(a.newestCapture);
}

/**
 * One game's readings grouped by build stamp, the newest build first. Readings with no stamp are
 * left out: nothing says which build they ran.
 */
export function stampsNewestFirst(
	readings: readonly PerfReportListItem[],
	builds: readonly PerfBuildListItem[],
): StampGroup[] {
	return [
		...groupBy(
			readings.filter((r) => r.buildVersion),
			stampOf,
		).entries(),
	]
		.map(([stamp, rs]) => ({
			stamp,
			readings: rs,
			registeredAt: builds.find((b) => readingOnBuild(rs[0], b))?.registeredAt ?? null,
			newestCapture: rs.reduce((at, r) => (r.capturedAt > at ? r.capturedAt : at), ''),
		}))
		.sort(newerStamp);
}

/**
 * Per game, the readings of its newest build (`stampsNewestFirst`), so a finding speaks for the build
 * players have, not one a fix already replaced; a game whose readings carry no stamp keeps them all.
 */
export function currentReadings(
	readings: readonly PerfReportListItem[],
	builds: readonly PerfBuildListItem[],
): PerfReportListItem[] {
	return [...groupBy(readings, (r) => r.gameKey ?? '').values()].flatMap(
		(rs) => stampsNewestFirst(rs, builds)[0]?.readings ?? rs,
	);
}

export const median = (values: readonly number[]): number | null => {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** One device for a finding: its class and GPU (the Devices tab's group). */
export const deviceOf = (r: PerfReportListItem) =>
	`${r.deviceClass ?? '?'} · ${r.gpu ?? 'unknown GPU'}`;

/** Readings grouped by a key, insertion order kept. */
export function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = out.get(k) ?? [];
		list.push(item);
		out.set(k, list);
	}
	return out;
}

/** A reading's facts, when they were filled and the file was read. */
export function factsOf(ctx: FindingContext, r: PerfReportListItem): ReportFacts | null {
	const f = ctx.readingFacts.get(r.id);
	return f && !f.missing ? f : null;
}

export function buildFactsOf(ctx: FindingContext, b: PerfBuildListItem): BuildFacts | null {
	const f = ctx.buildFacts.get(b.id);
	return f && !f.missing ? f : null;
}

/** An arcade reading in play, with what its sim and room did. */
export interface ArcadePlay {
	r: PerfReportListItem;
	arcade: ArcadeFacts;
	play: ArcadePhaseFact;
}

/**
 * What the arcade rules judge: per game and device, the as-shipped arcade readings of the current
 * build with at least {@link MIN_PHASE_FRAMES} play frames and their arcade facts. Never a lab run.
 */
export function arcadePlayGroups(ctx: FindingContext): Map<string, ArcadePlay[]> {
	const plays = currentReadings(fpsReadings(ctx.readings), ctx.builds).flatMap(
		(r): ArcadePlay[] => {
			const arcade = factsOf(ctx, r)?.arcade;
			if (!arcade?.play || r.phaseSet !== 'arcade' || Object.keys(r.flags).length) return [];
			return (r.play?.frames ?? 0) >= MIN_PHASE_FRAMES ? [{ r, arcade, play: arcade.play }] : [];
		},
	);
	return groupBy(plays, (x) => `${x.r.gameKey ?? ''}|${deviceOf(x.r)}`);
}

/** The median over a group of one work key's per-frame mean; null when no reading reports it. */
export const workMean = (group: readonly ArcadePlay[], key: ArcadeWorkKey): number | null =>
	median(group.map((x) => x.play.work[key]?.mean).filter((v): v is number => v !== undefined));

/** The largest per-frame value of one work key over a group; null when no reading reports it. */
export function workMax(group: readonly ArcadePlay[], key: ArcadeWorkKey): number | null {
	const maxes = group
		.map((x) => x.play.work[key])
		.filter((v): v is MeanMax => !!v)
		.map((v) => v.max);
	return maxes.length ? Math.max(...maxes) : null;
}

/** A `perf: 9` reading's network facts, when they were filled. */
export const networkOf = (ctx: FindingContext, r: PerfReportListItem): NetworkFacts | null =>
	factsOf(ctx, r)?.network ?? null;

/**
 * What the network rules judge: per game, the readings of its current build (`currentReadings`)
 * that carry network facts, newest first. Sizes are not timing, so a lab run counts unless the rule
 * says otherwise (`lab: false`: a fresh headless browser has no cache and a runner's network).
 */
export function networkReadings(
	ctx: FindingContext,
	opts: { lab?: boolean } = {},
): { r: PerfReportListItem; net: NetworkFacts }[] {
	const pool = opts.lab === false ? fpsReadings(ctx.readings) : ctx.readings;
	return currentReadings(pool, ctx.builds)
		.flatMap((r) => {
			const net = networkOf(ctx, r);
			return net ? [{ r, net }] : [];
		})
		.sort((a, b) => b.r.capturedAt.localeCompare(a.r.capturedAt));
}
