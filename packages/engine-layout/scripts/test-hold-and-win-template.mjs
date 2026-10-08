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
			`export { getFullSceneSet, holdAndWinReferenceLayout, HOLD_AND_WIN_BOARD, HOLD_AND_WIN_HOTFIRE_BOARD, addOnSceneIds, mergeMissingScreens } from '../src/lib/referenceLayouts/index.ts';`,
			`export { getTemplate } from '../src/lib/templates/index.ts';`,
			`export { BUILTIN_COMPONENTS, componentOfferedForKind } from '../src/lib/builtinComponents.ts';`,
			`export { isComponentMounted, sceneMountKey, trackComponentMount } from '../src/lib/mountedComponents.ts';`,
			`export { HOLD_AND_WIN_BANNER_SCREENS, reserveExpandingBoard, expandingBoardReserved } from '../src/lib/referenceLayouts/holdAndWin.ts';`,
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

// `bookOfBorut` is the Book-of reference set (a lines look, not a kind).
const EXISTING_KINDS = ['lines', 'bookOfBorut', 'ways', 'cluster', 'scatter'];
const EXISTING_TEMPLATES = ['lines', 'ways'];

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
		// book-feature Phase 7: the Book-of set became a reference set of lines — only its doc's
		// `gameType` moved (`bookOf` → `lines`; scenes/bookof.json differs in that line alone).
		bookOfBorut: 'd08b587924b9efdb',
		ways: 'a916b41d79ac520a',
		cluster: '856c7d6f4504389c',
		scatter: 'dc289350e590c719',
	},
	templates: {
		lines: 'd0cfc7cabd389bfc',
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
		freeSpinIntroVisual: 'd5692d66c8d6226b',
		freeSpinOutroVisual: 'ad4d1cd5c1253f8b',
		win: '71a38a1aec1b23fe',
		tapToContinue: '39cf7fc4059e2116',
		loadingBar: '3166440d4ac35911',
		expandingSymbol: '5cf3a24b056c210d',
		freeSpinIntroSymbolReveal: '7a031172a96f7ca2',
		featureCard: '2140ccce4c6653dc',
		confirmDialog: '7d44a35a92e64c1e',
		optionCard: '7e7ba516c11653f5',
		// Phase 11c: the operator platform jackpot belongs to every kind, so its bar is offered to all
		// of them on purpose — a new library entry, not a change to any existing screen or component.
		platformJackpotBar: '76fce9d675bc4c8f',
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
const PLACED = [
	'respinCounter',
	'jackpotBar',
	'totalWinBar',
	'potMeter',
	'lettersStrip',
	'wheel',
	'respinCells',
	'lockedRow',
];
for (const id of PLACED) {
	assert(
		doc.scenes.some((scene) => instancesIn(scene).some((n) => n.componentId === id)),
		`the template places no ${id}`,
	);
}

// Kind gating: offered to Hold and Win only; every other built-in still offered everywhere. The pot
// parts are gated on `pots`, so the pots overlay add-on (docs/design/pots-overlay.md §4) offers
// them to any kind, and nothing else of the feature; a Hold and Win block offers all of it.
const GATED = [...PLACED, 'jackpotTile', 'letterTile', 'cellTile'];
const POTS = ['potMeter'];
for (const def of mod.BUILTIN_COMPONENTS) {
	const gated = GATED.includes(def.id);
	const pots = POTS.includes(def.id);
	assert(
		!gated || def.capability === (pots ? 'pots' : 'holdAndWin'),
		`${def.id} is not kind-gated (${def.capability})`,
	);
	assert(mod.componentOfferedForKind(def, 'holdAndWin'), `${def.id} hidden from Hold and Win`);
	assert(
		mod.componentOfferedForKind(def, 'holdAndWin', { potsOverlay: true }),
		`${def.id} hidden from Hold and Win with the overlay`,
	);
	for (const kind of [...EXISTING_KINDS, 'myCustomKind', undefined]) {
		assert(
			mod.componentOfferedForKind(def, kind) === !gated,
			`${def.id} offered wrongly to ${kind}`,
		);
		assert(
			mod.componentOfferedForKind(def, kind, { holdAndWin: false, potsOverlay: false }) === !gated,
			`${def.id} offered wrongly to ${kind} with both add-ons off`,
		);
		assert(
			mod.componentOfferedForKind(def, kind, { potsOverlay: true }) === (!gated || pots),
			`${def.id} offered wrongly to ${kind} with the pots overlay`,
		);
		assert(
			mod.componentOfferedForKind(def, kind, { holdAndWin: true }),
			`${def.id} hidden from ${kind} with a Hold and Win block`,
		);
	}
}
const byId = (id) => mod.BUILTIN_COMPONENTS.find((d) => d.id === id);
assert(
	mod.componentOfferedForKind(byId('potMeter'), 'lines', { potsOverlay: true }),
	'a Book-of overlay host is offered the Pot Meter',
);
assert(
	!mod.componentOfferedForKind(byId('respinCells'), 'lines', { potsOverlay: true }),
	'…but not the respin cell tiles',
);
const pot = byId('potMeter');
const fork = { ...pot, capability: undefined, scope: 'project' };
assert(
	!mod.componentOfferedForKind(fork, 'lines'),
	'a saved copy of a gated built-in keeps its gate',
);
assert(
	mod.componentOfferedForKind(fork, 'lines', { potsOverlay: true }),
	'…and its gate is the built-in’s `pots`',
);
assert(
	!mod.componentOfferedForKind({ ...byId('respinCounter'), capability: undefined }, 'lines', {
		potsOverlay: true,
	}),
	'a saved respin counter stays off an overlay host',
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
// Reserving an expanding board's area (11b follow-up): the scaffold path and the editor action share
// one helper; it is absolute (reserving twice changes nothing) and touches only the reel grid.
{
	const plain = mod.getFullSceneSet('holdAndWin');
	assert(!mod.expandingBoardReserved(plain, 6), 'an unexpanded scaffold does not reserve 6 rows');
	const once = mod.reserveExpandingBoard(plain, 6);
	const twice = mod.reserveExpandingBoard(once, 6);
	assert(JSON.stringify(once) === JSON.stringify(twice), 'reserving twice changes nothing');
	assert(mod.expandingBoardReserved(once, 6), 'a reserved doc reads as reserved');
	const gridOf = (d) =>
		walk(d.scenes.find((sc) => sc.id === 'basegame').nodes).find((n) => n.kind === 'reelGrid');
	const g0 = gridOf(plain);
	const g1 = gridOf(once);
	assert(
		g1.x === g0.x && g1.y === g0.y && JSON.stringify(g1.overrides) === JSON.stringify(g0.overrides),
		'the grid node does not move',
	);
	assert(
		g1.cellSize === 66 && g1.boardNudgeY === -99,
		`6 rows reserve 66 px cells nudged up 1.5 rows (got ${g1.cellSize}, ${g1.boardNudgeY})`,
	);
	const withOption = mod.getFullSceneSet('holdAndWin', { maxRows: 6 });
	assert(
		gridOf(withOption).cellSize === 66 && gridOf(withOption).boardNudgeY === -99,
		'getFullSceneSet takes maxRows',
	);
	assert(
		JSON.stringify(mod.getFullSceneSet('lines', { maxRows: 6 })) ===
			JSON.stringify(mod.getFullSceneSet('lines')),
		'other kinds ignore maxRows',
	);
	assert(mod.expandingBoardReserved(plain, 3), 'a board that never grows is always reserved');
}

// An expanding board (11b) reserves its maxRows area: the grid moves up, its cells shrink, and the
// pieces around it clear the whole grown block.
for (const [board, options] of [
	[mod.HOLD_AND_WIN_BOARD, {}],
	[mod.HOLD_AND_WIN_HOTFIRE_BOARD, {}],
	[mod.HOLD_AND_WIN_BOARD, { maxRows: 6 }],
	[mod.HOLD_AND_WIN_HOTFIRE_BOARD, { maxRows: 5 }],
]) {
	const layout = mod.holdAndWinReferenceLayout(board, options);
	const basegame = layout.scenes.find((s) => s.id === 'basegame');
	const grid = walk(basegame.nodes).find((n) => n.kind === 'reelGrid');
	assert(
		grid.reels === board.reels && grid.rows === board.rows,
		`the reel grid is ${board.reels}×${board.rows}`,
	);
	const maxRows = options.maxRows ?? board.rows;
	if (!options.maxRows)
		assert(grid.cellSize === board.cellSize, 'an unexpanding board keeps its cells');
	for (const [type, size] of Object.entries(layout.mainSizesMap)) {
		const g = type === 'desktop' ? {} : (grid.overrides?.[type] ?? {});
		const gx = g.x ?? grid.x;
		const gy = g.y ?? grid.y;
		// The base board is centred on the grid node, lifted by its board nudge; the reserved rows hang
		// below it.
		const cx = gx;
		const top = gy + (grid.boardNudgeY ?? 0) - (board.rows * grid.cellSize) / 2;
		const bottomEdge = top + maxRows * grid.cellSize;
		const cy = (top + bottomEdge) / 2;
		const bw = (board.reels * grid.cellSize) / 2;
		const bh = (bottomEdge - top) / 2;
		assert(top >= 0 && bottomEdge <= size.height, `${type}: the ${maxRows}-row block fits the box`);
		if (options.maxRows)
			assert(Math.abs(cy - size.height / 2) < 1, `${type}: the grown block is centred`);
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
				const where = `${board.reels}×${maxRows} ${type} ${id}/${node.id}`;
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

// Step-aside: a coded default yields only while its authored twin is MOUNTED, ref-counted.
const key = mod.sceneMountKey('luckySpin');
assert(!mod.isComponentMounted(key), 'nothing is mounted before a mount');
const releaseA = mod.trackComponentMount(key);
const releaseB = mod.trackComponentMount(key);
releaseA();
assert(mod.isComponentMounted(key), 'a second mount keeps it counted');
releaseB();
assert(
	!mod.isComponentMounted(key),
	'the last unmount releases it — the coded default plays again',
);
assert(!mod.isComponentMounted('luckySpin'), 'a screen key never collides with a component id');
// The banner's authored screens exist, gated on the banner beat they replace; the wheel screen
// holds the `wheel` component the coded wheel steps aside for.
const GATE = { luckySpin: 'luckySpinShow', jackpot: 'jackpotWinShow' };
for (const [kind, id] of Object.entries(mod.HOLD_AND_WIN_BANNER_SCREENS)) {
	assert(sceneById.get(id)?.visibleSource === GATE[kind], `${id} is not gated on ${GATE[kind]}`);
}
assert(
	instancesIn(sceneById.get('wheel')).some((n) => n.componentId === 'wheel'),
	'the wheel screen holds no wheel component',
);

// ─── Add-on screens (pots overlay Phase 5b, docs/design/pots-overlay.md §4) ───────────────────
// The add-on flags merge the overlay's screens into another kind's set; with none set every set is
// the kind's own. The Hold and Win set itself, before `potIds` existed, hashed as pinned here.
{
	const json = (value) => JSON.stringify(value);
	const ids = (d) => d.scenes.map((sc) => sc.id);
	const MODE_SCREENS = [
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
	const HW_PINNED = {
		plain: '3f585158f5da883f',
		maxRows6: '1e65875ac8b7fa53',
		hotfire: '1c148ee2579db66a',
	};
	assert(
		hash(mod.getFullSceneSet('holdAndWin')) === HW_PINNED.plain,
		'the Hold and Win set changed',
	);
	assert(
		hash(mod.getFullSceneSet('holdAndWin', { maxRows: 6 })) === HW_PINNED.maxRows6,
		'the expanded Hold and Win set changed',
	);
	assert(
		hash(mod.holdAndWinReferenceLayout(mod.HOLD_AND_WIN_BOARD)) === HW_PINNED.plain,
		'the Hold and Win reference changed',
	);
	assert(
		hash(mod.holdAndWinReferenceLayout(mod.HOLD_AND_WIN_HOTFIRE_BOARD)) === HW_PINNED.hotfire,
		'the Super Hotfire reference changed',
	);
	const hwDefault = json(mod.getFullSceneSet('holdAndWin'));
	assert(
		json(mod.getFullSceneSet('holdAndWin', { potIds: ['red', 'blue', 'green'] })) === hwDefault,
		'the default pot ids are red, blue, green',
	);
	assert(
		json(mod.getFullSceneSet('holdAndWin', { potsOverlay: true, holdAndWin: true })) === hwDefault,
		'the add-on flags change nothing on the holdAndWin kind',
	);
	assert(
		!ids(mod.getFullSceneSet('holdAndWin', { potIds: [] })).includes('pots'),
		'an empty pot list drops the pots screen',
	);
	{
		const pots = mod
			.getFullSceneSet('bookOfBorut', { potsOverlay: true, potIds: ['a', 'b', 'a'] })
			.scenes.find((scene) => scene.id === 'pots');
		assert(
			JSON.stringify(pots?.nodes.map((n) => n.id)) === JSON.stringify(['pot-a', 'pot-b']),
			'a repeated pot id yields one pot (unique node ids)',
		);
	}
	assert(
		mod.addOnSceneIds('holdAndWin', { potsOverlay: true, holdAndWin: true }).length === 0,
		'the holdAndWin kind has no add-on screens',
	);

	for (const kind of EXISTING_KINDS) {
		assert(
			hash(mod.getFullSceneSet(kind, { holdAndWin: false, potsOverlay: false })) ===
				PINNED.sceneSets[kind],
			`${kind}: flags off changed the set`,
		);
		assert(mod.addOnSceneIds(kind).length === 0, `${kind}: no flag, no add-on screens`);
		const plainIds = ids(mod.getFullSceneSet(kind));
		for (const options of [{ potsOverlay: true }, { holdAndWin: true, potsOverlay: true }]) {
			const added = mod.addOnSceneIds(kind, options);
			const merged = mod.getFullSceneSet(kind, options);
			for (const id of added) {
				const at = merged.scenes.findIndex((sc) => sc.id === id);
				assert(at > 0, `${kind}: add-on ${id} found a preceding screen`);
			}
			assert(
				json(ids(merged).filter((id) => !added.includes(id))) === json(plainIds),
				`${kind}: the kind's own screens keep their order`,
			);
		}
	}

	const bookOf = mod.getFullSceneSet('bookOfBorut');
	const byId = (d) => new Map(d.scenes.map((sc) => [sc.id, json(sc)]));
	const keepsOwn = (merged, label) => {
		const own = byId(merged);
		for (const scene of bookOf.scenes)
			assert(own.get(scene.id) === json(scene), `${label}: ${scene.id} changed`);
	};

	const potsOnly = { potsOverlay: true, potIds: ['gold', 'jade'] };
	const withPots = mod.getFullSceneSet('bookOfBorut', potsOnly);
	assert(
		json(mod.addOnSceneIds('bookOfBorut', potsOnly)) === json(['pots']),
		'pots overlay adds pots',
	);
	assert(withPots.scenes.length === bookOf.scenes.length + 1, 'pots overlay adds one screen');
	const potsAt = ids(withPots).indexOf('pots');
	assert(ids(withPots)[potsAt - 1] === 'basegame', 'the pots screen sits right after basegame');
	const pots = withPots.scenes[potsAt];
	assert(
		json(pots.nodes.filter((n) => n.componentId === 'potMeter').map((n) => n.params.meter)) ===
			json(['gold', 'jade']),
		'the pots screen holds the config pots in order',
	);
	assert(
		json(pots.nodes.map((n) => n.x - withPots.mainSizesMap.desktop.width / 2)) === json([-80, 80]),
		'two pots stay centred on the board',
	);
	keepsOwn(withPots, 'pots overlay');
	assert(
		json(withPots.mainSizesMap) === json(bookOf.mainSizesMap),
		'the merge keeps the kind’s main sizes',
	);

	const bonus = { potsOverlay: true, holdAndWin: true, potIds: ['gold', 'jade'] };
	const withBonus = mod.getFullSceneSet('bookOfBorut', bonus);
	const expected = ['jackpotBar', 'pots', ...MODE_SCREENS];
	const addedIds = ids(withBonus).filter((id) => !ids(bookOf).includes(id));
	assert(
		json([...addedIds].sort()) === json([...expected].sort()),
		`a Hold and Win bonus adds pots, the jackpot bar and the mode screens (got ${addedIds})`,
	);
	assert(
		json([...mod.addOnSceneIds('bookOfBorut', bonus)].sort()) === json([...expected].sort()),
		'addOnSceneIds names the same screens',
	);
	assert(!ids(withBonus).includes('luckySpin'), 'Lucky Spin is never an add-on');
	for (const id of ['freeSpinIntro', 'freeSpinCounter', 'freeSpinOutro'])
		assert(ids(withBonus).includes(id), `the free-spin screen ${id} survives`);
	keepsOwn(withBonus, 'Hold and Win bonus');
	assert(
		ids(withBonus)[ids(withBonus).indexOf('wheel') - 1] === 'basegameOverlays',
		'the beat screens follow basegameOverlays',
	);

	// The editor's merge: an authored doc keeps every scene byte-identical; only the missing add-on
	// screens are inserted, and a second merge adds nothing.
	const authored = structuredClone(bookOf.scenes);
	const base = authored.find((sc) => sc.id === 'basegame');
	base.name = 'My base game';
	base.nodes[0] = { ...base.nodes[0], x: base.nodes[0].x + 37 };
	const before = json(authored);
	const addOns = mod.addOnSceneIds('bookOfBorut', bonus);
	const once = mod.mergeMissingScreens(authored, withBonus.scenes, addOns);
	assert(json(authored) === before, 'the merge does not mutate its input');
	const onceById = new Map(once.map((sc) => [sc.id, json(sc)]));
	for (const scene of authored)
		assert(onceById.get(scene.id) === json(scene), `merge: authored ${scene.id} changed`);
	assert(
		json(once.map((sc) => sc.id).filter((id) => !addOns.includes(id))) ===
			json(authored.map((sc) => sc.id)),
		'merge: authored screens keep their order',
	);
	assert(once.length === authored.length + addOns.length, 'merge adds every add-on screen');
	const twice = mod.mergeMissingScreens(once, withBonus.scenes, addOns);
	assert(json(twice) === json(once), 'a second merge adds nothing');

	const ownPots = { id: 'pots', name: 'My pots', nodes: [] };
	const hasPots = [...authored.slice(0, 3), ownPots, ...authored.slice(3)];
	const kept = mod.mergeMissingScreens(hasPots, withBonus.scenes, addOns);
	assert(
		kept.filter((sc) => sc.id === 'pots').length === 1 &&
			json(kept.find((sc) => sc.id === 'pots')) === json(ownPots),
		'a doc with its own pots screen keeps it',
	);
}

if (failures) {
	console.error(`\n${failures} failure(s).`);
	process.exit(1);
}
console.log('hold-and-win template: OK');
