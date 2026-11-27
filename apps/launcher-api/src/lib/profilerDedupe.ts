/**
 * The same reading stored more than once (`docs/status/profiler.md` "Archive and duplicates").
 *
 * The probe's reading is CUMULATIVE: every send is the whole measuring window so far, so a tester
 * who taps Send, switches app (an automatic send), comes back and Resets leaves several readings
 * of one window, each a superset of the one before. The probe now names the window (`sendKey`,
 * `<loadId>.<resets>`), the store keeps the fullest send of a key, and this module is what the list
 * reads for what was stored before that, or lost a race: it names the readings a page should not
 * list because another one stands for them.
 *
 * Pure, so the page's server load and `scripts/check-profiler-archive.ts` run the same function.
 */

import { PERF_PHASES, type PerfPhaseSummary, type PerfReportListItem } from './profiler';

export type DedupeItem = Pick<
	PerfReportListItem,
	| 'id'
	| 'capturedAt'
	| 'source'
	| 'label'
	| 'gameKey'
	| 'deviceClass'
	| 'gpu'
	| 'uaFamily'
	| 'dpr'
	| 'canvas'
	| 'buildVersion'
	| 'buildSha'
	| 'flags'
	| 'perfVersion'
	| 'sendKey'
	| 'keep'
	| 'network'
> &
	Partial<Record<(typeof PERF_PHASES)[number], PerfPhaseSummary | null>>;

/** Frames over every phase the reading has. */
export const framesOf = (r: DedupeItem): number =>
	PERF_PHASES.reduce((n, phase) => n + (r[phase]?.frames ?? 0), 0);

/**
 * What two readings must share to be one measurement sent twice with no window named: the device,
 * the build, the switches, and every phase's numbers to the decimal. Two real measurements do not
 * agree on every fps, p50, p95 and hitch count.
 */
function sameNumbers(r: DedupeItem): string {
	return JSON.stringify([
		r.source,
		r.label,
		r.gameKey,
		r.deviceClass,
		r.gpu,
		r.uaFamily,
		r.dpr,
		r.canvas,
		r.buildVersion,
		r.buildSha,
		Object.entries(r.flags).sort(([a], [b]) => a.localeCompare(b)),
		r.perfVersion,
		PERF_PHASES.map((phase) => {
			const p = r[phase];
			return p ? [p.frames, p.fps, p.p50, p.p95, p.hitches] : null;
		}),
		r.network
			? [r.network.transferMb, r.network.files, r.network.firstFrameMs, r.network.rgsRequests]
			: null,
	]);
}

/** Fuller first; of two as full, the earlier receipt (a resend of it is the later one), then the id. */
const keeper = (a: DedupeItem, b: DedupeItem) =>
	framesOf(b) - framesOf(a) || a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id);

/**
 * The ids of readings another one stands for: of the sends of one window (`sendKey`) every one but
 * the fullest, and of readings with no key, every exact repeat but the first. A kept reading is
 * never named — it was pinned on purpose, and stays where the person left it.
 */
export function repeatedReadings(readings: readonly DedupeItem[]): Set<string> {
	const hidden = new Set<string>();
	const groups = new Map<string, DedupeItem[]>();
	for (const r of readings) {
		const key = r.sendKey ? `window:${r.sendKey}|${r.gameKey ?? ''}` : `same:${sameNumbers(r)}`;
		const group = groups.get(key);
		if (group) group.push(r);
		else groups.set(key, [r]);
	}
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const [, ...rest] = [...group].sort(keeper);
		for (const r of rest) if (!r.keep) hidden.add(r.id);
	}
	return hidden;
}

/** The readings a list shows: every one no other stands for, in the order given. */
export function withoutRepeats<T extends DedupeItem>(readings: readonly T[]): T[] {
	const hidden = repeatedReadings(readings);
	return hidden.size ? readings.filter((r) => !hidden.has(r.id)) : [...readings];
}
