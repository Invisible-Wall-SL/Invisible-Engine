// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Hold and Win coin board's Scene Editor pieces (Phase 13e,
// docs/design/hold-and-win-coin-board.md): the Line Overlay component (a coded part on the Phase 12c
// pattern: counts in as the Line Overlay, stands for its part, skinnable params with the coded look as
// defaults), the coin-board template (the board is a base screen holding the cell tiles and a placed
// Line Overlay; no pots, no locked rows; the counter and Total Win stay feature screens; the HUD bar
// gains the lines selector's anchor at the coded spot), and that a plain Hold and Win set is untouched.
//
//   node scripts/test-coin-board-template.mjs
//
// Same esbuild-bundle trick as test-pot-skin.mjs: bundle the real modules and assert against them.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			BUILTIN_COMPONENTS,
			HOLD_AND_WIN_COMPONENTS,
			HUD_LINES_NODE,
			LINE_OVERLAY_DEF,
			LINE_OVERLAY_MOUNT,
			STANDARD_MAIN_SIZES_MAP,
			codedLinesSelectorSpot,
			componentOfferedForKind,
			engineOwnedOnly,
			getFullSceneSet,
			linesSelectorSpot,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-coin-board-template.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `coin-board-template-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nodesOf = (scene) => {
	const out = [];
	const walk = (nodes) =>
		nodes.forEach((n) => {
			out.push(n);
			if (n.kind === 'container') walk(n.children);
		});
	walk(scene?.nodes ?? []);
	return out;
};

console.info('the Line Overlay');
const def = mod.LINE_OVERLAY_DEF;
const [part, ...rest] = def.root.children;
assert(rest.length === 0, 'the root holds only the Lines part');
assert(part.bind?.component === 'LineOverlayPart' && part.children.length === 0, 'a coded part');
assert(def.id === mod.LINE_OVERLAY_MOUNT, 'its id is what it counts in under');
assert(def.standsFor === 'LineOverlayPart', 'it stands for its part');
assert(mod.partStandIn(def) === undefined, '…and needs no stand-in while it binds it');
assert(
	mod.partStandIn({ ...def, root: { ...def.root, children: [] } }) === 'LineOverlayPart',
	'a copy without the part still counts in through a stand-in',
);
const params = mod.resolveComponentParams(def, {});
assert(
	params.lineWidth === 4.2 && params.lineAlpha === 0.8 && params.showTabs === true,
	'the line defaults are the coded look (4.2 px at 0.8, tabs on)',
);
assert(
	params.tabScale === 1 && params.tabTextFill === 0x111111,
	'the tab defaults are the coded look',
);
assert(params.lineColor === undefined, 'no single colour by default: each line keeps its own');
assert(
	mod.HOLD_AND_WIN_COMPONENTS.includes(def) && mod.BUILTIN_COMPONENTS.includes(def),
	'a built-in Hold and Win component',
);
assert(
	mod.componentOfferedForKind(def, 'holdAndWin') && !mod.componentOfferedForKind(def, 'lines'),
	'offered to a Hold and Win project, not a lines one',
);
const saved = { ...def, params: def.params.filter((p) => p.key !== 'tabScale') };
delete saved.standsFor;
const merged = mod.mergeBuiltinCodedParams(saved);
assert(
	merged.params.some((p) => p.key === 'tabScale') && merged.standsFor === 'LineOverlayPart',
	'a copy saved without a param or standsFor gets both back by id',
);

console.info('the coin-board template');
const plain = mod.getFullSceneSet('holdAndWin', { potIds: [] });
const coin = mod.getFullSceneSet('holdAndWin', { coinBoard: true });
const scene = (doc, id) => doc.scenes.find((s) => s.id === id);
const board = scene(coin, 'respinBoard');
assert(
	board && board.role === undefined && board.modeId === undefined,
	'the board is a base screen',
);
assert(board.name === 'Coin board', '…named the Coin board');
assert(
	same(
		board.nodes.map((n) => n.componentId),
		['respinCells', 'lineOverlay'],
	),
	'it holds the cell tiles and a placed Line Overlay (no locked rows)',
);
for (const id of ['respinBackground', 'respinCounter', 'totalWinBar', 'letters']) {
	assert(scene(coin, id)?.modeId === 'holdAndWin', `${id} stays a feature screen`);
}
assert(
	scene(coin, 'jackpotBar') && !scene(coin, 'jackpotBar').role,
	'the jackpot bar is always up',
);
assert(!scene(coin, 'pots'), 'no pots screen, whatever pots are asked for');
assert(
	!scene(mod.getFullSceneSet('holdAndWin', { coinBoard: true, potIds: ['red'] }), 'pots'),
	'…even when pots are named',
);
const base = scene(coin, 'basegame');
assert(
	same(
		base.nodes.map((n) => n.kind),
		['reelGrid', 'componentInstance'],
	),
	'the base game keeps the board position and the message host, nothing else',
);
assert(
	!nodesOf(scene(plain, 'respinBoard')).some((n) => n.componentId === 'lineOverlay'),
	'a plain Hold and Win set places no Line Overlay',
);
assert(
	scene(plain, 'respinBoard').modeId === 'holdAndWin',
	'…and keeps its board a feature screen',
);
assert(
	same(
		coin.scenes.map((s) => s.id),
		plain.scenes.map((s) => s.id),
	),
	'the same screens, in the same order, as a plain set without pots',
);
const scaffolded = mod.engineOwnedOnly(coin);
assert(
	nodesOf(scene(scaffolded, 'respinBoard')).some((n) => n.componentId === 'lineOverlay'),
	'the scaffold projection keeps the Line Overlay',
);

console.info('the lines selector anchor');
const bar = scene(coin, 'hudBar');
const anchor = bar.nodes.find((n) => n.id === mod.HUD_LINES_NODE);
assert(anchor?.kind === 'container' && anchor.children.length === 0, 'an empty HUD bar anchor');
assert(
	!scene(plain, 'hudBar').nodes.some((n) => n.id === mod.HUD_LINES_NODE),
	'a plain HUD has none',
);
const plainBar = scene(plain, 'hudBar');
for (const layoutType of Object.keys(mod.STANDARD_MAIN_SIZES_MAP)) {
	const coded = mod.codedLinesSelectorSpot(plainBar, layoutType);
	const at = mod.linesSelectorSpot(bar, layoutType);
	const close = (a, b) => Math.abs(a - b) < 1e-6;
	assert(
		close(at.x, coded.x) && close(at.y, coded.y) && close(at.scale, coded.scale),
		`${layoutType}: the anchor sits where the coded selector drew`,
	);
}
const moved = {
	...bar,
	nodes: bar.nodes.map((n) => (n.id === mod.HUD_LINES_NODE ? { ...n, x: 100, y: 50 } : n)),
};
assert(
	same(mod.linesSelectorSpot(moved, 'desktop'), { x: 100, y: 50, scale: anchor.scale?.x ?? 1 }),
	'a moved anchor moves the selector',
);
const hidden = {
	...bar,
	nodes: bar.nodes.map((n) =>
		n.id === mod.HUD_LINES_NODE ? { ...n, overrides: { desktop: { visible: false } } } : n,
	),
};
assert(
	same(mod.linesSelectorSpot(hidden, 'desktop'), mod.codedLinesSelectorSpot(plainBar, 'desktop')),
	'a hidden anchor falls back to the coded spot (the selector is never lost)',
);

if (failures) {
	console.error(`\n${failures} failure(s).`);
	process.exit(1);
}
console.log('coin-board template: OK');
