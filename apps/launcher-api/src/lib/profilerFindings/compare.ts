/**
 * Compare: two readings side by side — per phase fps / p95 / >33 ms hitches / frames (every phase
 * either reading's set has), then the per-frame counts each phase holds (draws, passes, uploads, GL
 * calls, JS ms; an arcade phase also its sim steps, sim ms, bodies, room ms, patches and patch
 * bytes), texture MB and, for `perf: 9` readings, what each downloaded (transfer, the largest file, before
 * the first frame, RGS latency, room traffic), with `B − A`. `better` says which way is good, so the page colours a
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
import { knownTransferMb, type NetworkSummary } from '../profilerNetwork';

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
	const na = a.network;
	const nb = b.network;
	if (na || nb) {
		const net = (
			label: string,
			read: (n: NetworkSummary) => number | null,
			better: CompareRow['better'],
		) => row('network', label, na ? read(na) : null, nb ? read(nb) : null, better);
		net('transfer MB', (n) => knownTransferMb(n), 'lower');
		net('from the cache MB', (n) => n.cachedMb, 'none');
		net('files', (n) => n.files, 'lower');
		net('size hidden (files)', (n) => n.unknownFiles, 'lower');
		net('largest file MB', (n) => n.largest?.mb ?? null, 'lower');
		net('before the first frame MB', (n) => n.beforeFirstFrameMb, 'lower');
		net('first frame s', (n) => (n.firstFrameMs === null ? null : n.firstFrameMs / 1000), 'lower');
		net('RGS p95 ms', (n) => n.rgsP95Ms, 'lower');
		net('room in KB/s', (n) => n.socketInKbps, 'lower');
	}
	return rows;
}
