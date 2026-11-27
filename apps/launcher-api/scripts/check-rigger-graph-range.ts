/**
 * The Rigger's graph editor holds its value range still while a drag moves keys, and re-fits it
 * once on release:
 *   pnpm --filter launcher-api check:rigger-graph-range
 *
 * `renderGraphBody` (static/rigger/view.html) fits the value axis to the keys on every redraw,
 * padded 14%. A key drag (`graphDrag`) and a box scale (`graphBox`) both redraw on each mousemove
 * and map the cursor through that range, so it must stay frozen while either is live: a box scale
 * once re-fitted it, so the same cursor pixel read a new value on every redraw and the selection
 * drifted with the mouse still. This pulls the range fit, `refreshAnimCounts` and the mouseup's
 * box-release branch out of view.html and runs them in a VM:
 *  1. a redraw with no drag re-fits; with `graphDrag` or `graphBox` set it keeps `graphMap`'s range;
 *  2. the first redraw of a drag (no `graphMap` yet) still fits;
 *  3. releasing a box scale clears `graphBox` BEFORE it redraws, so that one redraw re-fits;
 *  4. `renderTimeline` draws the graph view through `renderGraphBody`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

function need<T>(found: T | undefined, what: string): T {
	if (found !== undefined) return found;
	console.error(`FAIL  view.html: ${what} not found — update this check alongside the change`);
	process.exit(1);
}

const html = readFileSync(
	fileURLToPath(new URL('../static/rigger/view.html', import.meta.url)),
	'utf8',
);
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.join('\n');

/** The balanced `{…}` block opening at the first `{` at or after `from`, with what precedes it. */
function block(from: number): string {
	let depth = 0;
	let j = src.indexOf('{', from);
	for (; j < src.length; j++) {
		if (src[j] === '{') depth++;
		else if (src[j] === '}' && --depth === 0) break;
	}
	return src.slice(from, j + 1);
}
function fn(name: string): string {
	const at = src.indexOf(`\nfunction ${name}(`);
	return block(need(at < 0 ? undefined : at + 1, `function ${name}`));
}

const graphBody = fn('renderGraphBody');
const fit = need(
	/\n(\s*let minV = Infinity[\s\S]*?\n\s*else \{[^\n]*\})\n/.exec(graphBody)?.[1],
	"renderGraphBody's value-range fit",
);
const releaseAt = /window\.addEventListener\("mouseup", \(\) => \{\s*(?=if \(graphBox\)\s*\{)/.exec(
	src,
);
const release = block(
	need(
		releaseAt ? releaseAt.index + releaseAt[0].length : undefined,
		'the mouseup listener that opens with the box-scale release',
	),
);

const box = vm.createContext({});
vm.runInContext(
	`let graphDrag = null, graphBox = null, graphMap = null, selBone = null, skeletonData = null, selected = null;
	let curves = [];
	const rendered = [];
	function fitRange(){ ${fit}; return { minV, maxV }; }
	function renderAnimSection(){}
	function renderBoneDetail(){}
	function renderTimeline(){ rendered.push({ graphBox, range: fitRange() }); }
	${fn('refreshAnimCounts')}
	function release(){ ${release} }
	globalThis.probe = {
		set(s){ graphDrag = s.graphDrag; graphBox = s.graphBox; graphMap = s.graphMap; curves = s.curves; rendered.length = 0; },
		fit: fitRange,
		release(){ release(); return { graphBox, rendered: rendered.slice() }; },
	};`,
	box,
	{ filename: 'view.html', timeout: 1000 },
);

interface Range {
	minV: number;
	maxV: number;
}
interface State {
	graphDrag: object | null;
	graphBox: object | null;
	graphMap: Range | null;
	curves: { field: string; keys: Record<string, number>[] }[];
}
interface Probe {
	set(s: State): void;
	fit(): Range;
	release(): { graphBox: object | null; rendered: { graphBox: object | null; range: Range }[] };
}
const probe = (box as { probe: Probe }).probe;
const round = (r: Range): Range => ({ minV: +r.minV.toFixed(6), maxV: +r.maxV.toFixed(6) });

const curves = [
	{
		field: 'y',
		keys: [
			{ time: 0, y: 0 },
			{ time: 1, y: 10 },
		],
	},
];
const frozen: Range = { minV: -100, maxV: 100 };
const refit: Range = { minV: -1.4, maxV: 11.4 };
const keyDrag = { keyObj: {}, field: 'y' };
const boxScale = { hasH: false, hasV: true, items: [] };
const fitWith = (s: Omit<State, 'curves'>): Range => {
	probe.set({ ...s, curves });
	return round(probe.fit());
};

// ── 1. Frozen while a drag is live ──────────────────────────────────────────
check(
	'a redraw with no drag re-fits the range to the keys',
	fitWith({ graphDrag: null, graphBox: null, graphMap: frozen }),
	refit,
);
check(
	'a redraw during a key drag keeps the range',
	fitWith({ graphDrag: keyDrag, graphBox: null, graphMap: frozen }),
	frozen,
);
check(
	'a redraw during a box scale keeps the range',
	fitWith({ graphDrag: null, graphBox: boxScale, graphMap: frozen }),
	frozen,
);

// ── 2. The first redraw has nothing to keep ─────────────────────────────────
check(
	'a box scale with no graph drawn yet fits',
	fitWith({ graphDrag: null, graphBox: boxScale, graphMap: null }),
	refit,
);
check(
	'a key drag with no graph drawn yet fits',
	fitWith({ graphDrag: keyDrag, graphBox: null, graphMap: null }),
	refit,
);

// ── 3. Release re-fits once ─────────────────────────────────────────────────
probe.set({ graphDrag: null, graphBox: boxScale, graphMap: frozen, curves });
const released = probe.release();
check('releasing a box scale clears graphBox', released.graphBox, null);
check('releasing a box scale redraws once', released.rendered.length, 1);
check(
	'that redraw runs with graphBox already cleared',
	released.rendered[0]?.graphBox ?? null,
	null,
);
check(
	'that redraw re-fits the range',
	released.rendered[0] && round(released.rendered[0].range),
	refit,
);

// ── 4. The graph view is drawn by renderGraphBody ───────────────────────────
check(
	'renderTimeline draws the graph view through renderGraphBody',
	/if \(tlView === "graph"\)\s*\{\s*renderGraphBody\(/.test(fn('renderTimeline')),
	true,
);

if (failures) {
	console.error(`\n${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`rigger graph range: ${checks} checks passed`);
