// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Pin the Hold and Win Scene Editor template (Phase 6, docs/design/hold-and-win.md §6) and prove it
// left every other kind untouched.
//
//   node scripts/test-hold-and-win-template.mjs           # assert
//   node scripts/test-hold-and-win-template.mjs --print   # print the parity hashes (to re-pin)
//
// PARITY: the full scene set, the template and every builtin component def that existed before
// Phase 6 hash to the values pinned below, taken on `main` before the change. A diff here means an
// existing kind's screens or components changed — which the template must never do.
//
// Same esbuild-bundle trick as gen-scene-sets.mjs: the packages are raw TS, so bundle the pure-data
// graph into one ESM file Node can execute.
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: [
			`export { getFullSceneSet, holdAndWinReferenceLayout, HOLD_AND_WIN_BOARD, HOLD_AND_WIN_HOTFIRE_BOARD } from '../src/lib/referenceLayouts/index.ts';`,
			`export { getTemplate } from '../src/lib/templates/index.ts';`,
			`export { BUILTIN_COMPONENTS, componentOfferedForKind } from '../src/lib/builtinComponents.ts';`,
			`export { engineOwnedOnly } from '../src/lib/engineOwnedOnly.ts';`,
		].join('\n'),
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-hold-and-win-template.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `hold-and-win-template-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

const hash = (value) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const EXISTING_KINDS = ['lines', 'bookOf', 'ways', 'cluster', 'scatter'];
const EXISTING_TEMPLATES = ['lines', 'bookOf', 'ways'];

const current = {
	sceneSets: Object.fromEntries(EXISTING_KINDS.map((k) => [k, hash(mod.getFullSceneSet(k))])),
	templates: Object.fromEntries(EXISTING_TEMPLATES.map((k) => [k, hash(mod.getTemplate(k))])),
	components: Object.fromEntries(
		mod.BUILTIN_COMPONENTS.filter((def) => !def.capability).map((def) => [def.id, hash(def)]),
	),
};

if (process.argv.includes('--print')) {
	console.log(JSON.stringify(current, null, '\t'));
	process.exit(0);
}

const PINNED = {
	sceneSets: {
		lines: '5a0b7dfbcec7837b',
		bookOf: 'd1d6f12eabc37c9c',
		ways: 'a916b41d79ac520a',
		cluster: '856c7d6f4504389c',
		scatter: 'dc289350e590c719',
	},
	templates: {
		lines: 'd0cfc7cabd389bfc',
		bookOf: '5e68efcd093859d9',
		ways: 'd91e190fd13e14a7',
	},
	components: {
		hudReadout: '89e8c935006c440a',
		button: '1673e469e2732636',
		textBox: 'fa7497117bed553e',
		freeSpinCounter: '5d4d337454a2169c',
		infoBar: 'fc386c75fba28aa7',
		loadingIntro: '1a9a5010e5aebad6',
		transition: '4af3cf66eeaaead6',
		freeSpinIntroVisual: '7d9d445fc7e7ea00',
		freeSpinOutroVisual: 'fb53e6f799a03d14',
		win: 'ba902e34733f24d7',
		tapToContinue: '39cf7fc4059e2116',
		loadingBar: '3166440d4ac35911',
		expandingSymbol: '5cf3a24b056c210d',
		freeSpinIntroSymbolReveal: '94b315c07a2d2151',
		featureCard: 'da9437173836ece3',
		confirmDialog: '7d44a35a92e64c1e',
		optionCard: '7e7ba516c11653f5',
	},
};

let failures = 0;
const assert = (cond, msg) => {
	if (!cond) {
		failures++;
		console.error(`FAIL: ${msg}`);
	}
};

for (const group of ['sceneSets', 'templates', 'components']) {
	for (const [id, pinned] of Object.entries(PINNED[group])) {
		assert(
			current[group][id] === pinned,
			`${group}.${id} changed (${current[group][id]} ≠ ${pinned})`,
		);
	}
	for (const id of Object.keys(current[group])) {
		assert(
			id in PINNED[group],
			`${group}.${id} is new and unpinned — a new shared piece must be kind-gated`,
		);
	}
}

// ─── The Hold and Win scene set ───────────────────────────────────────────────────────────────

const doc = mod.getFullSceneSet('holdAndWin');
const sceneById = new Map(doc.scenes.map((scene) => [scene.id, scene]));
const walk = (nodes, out = []) => {
	for (const node of nodes) {
		out.push(node);
		if (node.children) walk(node.children, out);
	}
	return out;
};
const instancesIn = (scene) => walk(scene.nodes).filter((n) => n.kind === 'componentInstance');

const FEATURE = [
	'respinBackground',
	'respinBoard',
	'respinCounter',
	'totalWinBar',
	'letters',
	'wheel',
	'featureIntro',
	'jackpotWin',
	'featureOutro',
];
const ALWAYS = ['loading', 'background', 'basegame', 'basegameOverlays', 'jackpotBar', 'pots'];
const BASE_BEATS = ['luckySpin', 'buyFeature', 'buyConfirm', 'hudBar', 'hudCorners'];
for (const id of [...FEATURE, ...ALWAYS, ...BASE_BEATS]) {
	assert(sceneById.has(id), `missing scene ${id}`);
}
for (const id of ['specialBook', 'freeSpinIntro', 'freeSpinCounter', 'freeSpinOutro', 'freegame']) {
	assert(!sceneById.has(id), `${id} is a free-spin / Book-of screen — not in the default set`);
}
for (const id of FEATURE) {
	const scene = sceneById.get(id);
	assert(
		scene?.role === 'mode' && scene.modeId === 'holdAndWin',
		`${id} is not a holdAndWin mode screen`,
	);
}
for (const id of [...ALWAYS, 'luckySpin']) {
	assert(sceneById.get(id)?.role !== 'mode', `${id} must show outside the feature`);
}
assert(sceneById.get('loading')?.role === 'loading', 'loading keeps its role');

// One message host, in the base game (it stays mounted under the respin board).
const hosts = doc.scenes.flatMap((scene) =>
	instancesIn(scene)
		.filter((n) => n.componentId === 'infoBar')
		.map(() => scene.id),
);
assert(hosts.length === 1 && hosts[0] === 'basegame', `one infoBar, in basegame (got ${hosts})`);

// Every instance resolves to a built-in and survives the scaffold projection.
const builtinIds = new Set(mod.BUILTIN_COMPONENTS.map((def) => def.id));
const scaffold = mod.engineOwnedOnly(doc);
assert(scaffold.scenes.length === doc.scenes.length, 'the scaffold keeps every screen');
for (const scene of doc.scenes) {
	const kept = scaffold.scenes.find((s) => s.id === scene.id);
	for (const node of instancesIn(scene)) {
		assert(builtinIds.has(node.componentId), `${scene.id}/${node.id}: unknown ${node.componentId}`);
	}
	assert(
		instancesIn(kept).length === instancesIn(scene).length,
		`${scene.id}: the scaffold dropped an engine piece`,
	);
}
const PLACED = ['respinCounter', 'jackpotBar', 'totalWinBar', 'potMeter', 'lettersStrip', 'wheel'];
for (const id of PLACED) {
	assert(
		doc.scenes.some((scene) => instancesIn(scene).some((n) => n.componentId === id)),
		`the template places no ${id}`,
	);
}

// Kind gating: offered to Hold and Win only; every other built-in still offered everywhere.
const GATED = [...PLACED, 'jackpotTile'];
for (const def of mod.BUILTIN_COMPONENTS) {
	const gated = GATED.includes(def.id);
	assert(!gated || def.capability === 'holdAndWin', `${def.id} is not kind-gated`);
	assert(mod.componentOfferedForKind(def, 'holdAndWin'), `${def.id} hidden from Hold and Win`);
	for (const kind of [...EXISTING_KINDS, 'myCustomKind', undefined]) {
		assert(
			mod.componentOfferedForKind(def, kind) === !gated,
			`${def.id} offered wrongly to ${kind}`,
		);
	}
}
const pot = mod.BUILTIN_COMPONENTS.find((d) => d.id === 'potMeter');
const fork = { ...pot, capability: undefined, scope: 'project' };
assert(
	!mod.componentOfferedForKind(fork, 'lines'),
	'a saved copy of a gated built-in keeps its gate',
);

// The template names every Hold and Win screen and pins no board shape (5×3 and 3×3 both fit).
const template = mod.getTemplate('holdAndWin');
assert(template && !template.board, 'the holdAndWin template exists and pins no board');
for (const id of [...FEATURE, 'jackpotBar', 'pots', 'luckySpin']) {
	assert(
		template?.scenes.some((scene) => scene.id === id),
		`the template lacks ${id}`,
	);
}
assert(
	!template?.scenes.some((scene) => scene.id.startsWith('freeSpin')),
	'the template has free-spin screens',
);

// Placement: on both boards, in every layout type, every persistent piece sits inside the main box
// and clear of the board. (The wheel and the beat screens cover the board on purpose.)
const SIZE = {
	respinCounter: [240, 96],
	totalWinBar: [360, 96],
	jackpotBar: [1008, 96],
	potMeter: [120, 70],
	infoBar: [504, 86],
	textBox: [260, 30],
};
for (const board of [mod.HOLD_AND_WIN_BOARD, mod.HOLD_AND_WIN_HOTFIRE_BOARD]) {
	const layout = mod.holdAndWinReferenceLayout(board);
	const basegame = layout.scenes.find((s) => s.id === 'basegame');
	const grid = walk(basegame.nodes).find((n) => n.kind === 'reelGrid');
	assert(
		grid.reels === board.reels && grid.rows === board.rows,
		`the reel grid is ${board.reels}×${board.rows}`,
	);
	for (const [type, size] of Object.entries(layout.mainSizesMap)) {
		const cx = size.width / 2;
		const cy = size.height / 2;
		const bw = (board.reels * board.cellSize) / 2;
		const bh = (board.rows * board.cellSize) / 2;
		for (const id of [
			'basegame',
			'jackpotBar',
			'pots',
			'respinCounter',
			'totalWinBar',
			'letters',
		]) {
			for (const node of instancesIn(layout.scenes.find((s) => s.id === id))) {
				const o = type === 'desktop' ? {} : (node.overrides?.[type] ?? {});
				const x = o.x ?? node.x;
				const y = o.y ?? node.y;
				const scale = (o.scale ?? node.scale)?.x ?? 1;
				const [w, h] =
					node.componentId === 'lettersStrip'
						? [board.reels * node.params.spacing, 70]
						: SIZE[node.componentId];
				const left = x - (w * scale) / 2;
				const right = x + (w * scale) / 2;
				const top = y - (h * scale) / 2;
				const bottom = y + (h * scale) / 2;
				const where = `${board.reels}×${board.rows} ${type} ${id}/${node.id}`;
				assert(
					left >= 0 && right <= size.width && top >= 0 && bottom <= size.height,
					`${where} leaves the main box`,
				);
				const clear = right <= cx - bw || left >= cx + bw || bottom <= cy - bh || top >= cy + bh;
				assert(clear, `${where} covers the board`);
			}
		}
	}
}

if (failures) {
	console.error(`\n${failures} failure(s).`);
	process.exit(1);
}
console.log('hold-and-win template: OK');
