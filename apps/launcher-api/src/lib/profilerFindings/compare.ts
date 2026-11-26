/**
 * Compare: two readings side by side — per phase fps / p95 / >33 ms hitches / frames (every phase
 * either reading's set has), then the per-frame counts each phase holds (draws, passes, uploads, GL
 * calls, JS ms; an arcade phase also its sim steps, sim ms, bodies, room ms, patches and patch
 * bytes) and texture MB, with `B − A`. `better` says which way is good, so the page colours a
 * delta, never judges it: a delta between a phone and a lab run is still only a difference.
 */

import { PERF_PHASES, type PerfReportListItem } from '../profiler';
import {
	ARCADE_COUNT_KEYS,
	ARCADE_COUNT_LABELS,
	LAB_COUNT_KEYS,
	LAB_COUNT_LABELS,
	LAB_PHASES,
	type ArcadeCountKey,
} from '../profilerLab';

export interface CompareRow {
	group: string;
	label: string;
	a: number | null;
	b: number | null;
	/** `b − a` (to 0.1), null when either is missing. */
	delta: number | null;
	/** Which way is good; `none` for a count that is neither (frames). */
	better: 'higher' | 'lower' | 'none';
}

/** Bodies and patches follow what the field did: a difference, neither better nor worse. */
const ARCADE_BETTER: Record<ArcadeCountKey, CompareRow['better']> = {
	simSteps: 'lower',
	simMs: 'lower',
	bodies: 'none',
	netMs: 'lower',
	patches: 'none',
	patchBytes: 'lower',
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function compareReadings(a: PerfReportListItem, b: PerfReportListItem): CompareRow[] {
	const rows: CompareRow[] = [];
	const row = (
		group: string,
		label: string,
		x: number | null,
		y: number | null,
		better: CompareRow['better'],
	) =>
		rows.push({
			group,
			label,
			a: x,
			b: y,
			delta: x !== null && y !== null ? round1(y - x) : null,
			better,
		});
	for (const phase of PERF_PHASES) {
		const pa = a[phase];
		const pb = b[phase];
		if (!pa && !pb) continue;
		row(phase, 'fps', pa?.fps ?? null, pb?.fps ?? null, 'higher');
		row(phase, 'p95 ms', pa?.p95 ?? null, pb?.p95 ?? null, 'lower');
		row(phase, '> 33 ms', pa?.hitches ?? null, pb?.hitches ?? null, 'lower');
		row(phase, 'frames', pa?.frames ?? null, pb?.frames ?? null, 'none');
	}
	for (const phase of LAB_PHASES) {
		const ca = a.counts?.[phase] ?? null;
		const cb = b.counts?.[phase] ?? null;
		if (!ca && !cb) continue;
		for (const key of LAB_COUNT_KEYS) {
			row(
				`${phase} per frame`,
				LAB_COUNT_LABELS[key],
				ca?.[key] ?? null,
				cb?.[key] ?? null,
				'lower',
			);
		}
	}
	// After the lab counts, in the same "<phase> per frame" group (the page groups by first use).
	for (const phase of ['menu', 'play'] as const) {
		const ca = a.counts?.[phase] ?? null;
		const cb = b.counts?.[phase] ?? null;
		if (!ca && !cb) continue;
		for (const key of ARCADE_COUNT_KEYS) {
			row(
				`${phase} per frame`,
				ARCADE_COUNT_LABELS[key],
				ca?.[key] ?? null,
				cb?.[key] ?? null,
				ARCADE_BETTER[key],
			);
		}
	}
	row('memory', 'texture MB', a.textureMb, b.textureMb, 'lower');
	return rows;
}
