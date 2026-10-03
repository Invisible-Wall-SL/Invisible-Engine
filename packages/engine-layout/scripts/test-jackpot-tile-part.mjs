// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Jackpot Tile's coded part (Hold and Win Phase 12c): the built-in's panel nodes sit
// inside the `Tile` part with their ids and bindings unchanged, the tile is still by default, it keeps
// its tier scope, it stands for no part (it registers nothing), and both bars still place four of
// it by id.
//
//   node scripts/test-jackpot-tile-part.mjs
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
			JACKPOT_BAR_DEF,
			JACKPOT_TILE_DEF,
			PLATFORM_JACKPOT_BAR_DEF,
			boundComponentSkin,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-jackpot-tile-part.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `jackpot-tile-part-test-${process.pid}.mjs`);
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
const PANEL_IDS = ['jackpotTile-frame', 'jackpotTile-caption', 'jackpotTile-value'];
const tile = mod.JACKPOT_TILE_DEF;

console.info('the part');
const [part, ...rest] = tile.root.children;
assert(rest.length === 0, 'the root holds only the Tile part');
assert(part.kind === 'container' && part.bind?.component === 'JackpotTilePart', 'a coded part');
assert(
	same(
		part.children.map((n) => n.id),
		PANEL_IDS,
	),
	'the frame, caption and value sit inside it, ids unchanged',
);
assert(
	part.children[2].paramBindings?.text === 'value' &&
		part.children[1].paramBindings?.text === 'label',
	'the value and caption still bind value / label',
);
assert(
	tile.signalScope === 'source' && tile.signalScopeKind === 'tier',
	'still scoped by its source, as a tier (12a)',
);
assert(tile.standsFor === undefined, 'stands for no part: it registers nothing');
assert(mod.partStandIn(tile) === undefined, 'so no stand-in');
const params = mod.resolveComponentParams(tile, {});
assert(params.winPulseScale === 1, 'still by default (parity)');
assert(params.source === 'jackpot.grand', 'the source default is unchanged');
assert(same(mod.boundComponentSkin('JackpotTilePart'), { layers: [] }), 'skinnable in the editors');

console.info('a tile saved before the part');
const flat = {
	...tile,
	root: { ...tile.root, children: structuredClone(part.children) },
	params: tile.params.filter((p) => p.key !== 'winPulseScale'),
};
const merged = mod.mergeBuiltinCodedParams(flat);
assert(
	merged.params.some((p) => p.key === 'winPulseScale'),
	'gets the pulse param back by id',
);
assert(merged.standsFor === undefined, 'gets no stand-in: it draws as saved, unpulsed');

console.info('the bars');
for (const bar of [mod.JACKPOT_BAR_DEF, mod.PLATFORM_JACKPOT_BAR_DEF]) {
	const tiles = bar.root.children;
	assert(
		tiles.length === 4 &&
			tiles.every((n) => n.kind === 'componentInstance' && n.componentId === 'jackpotTile'),
		`${bar.id} still places four jackpotTile instances`,
	);
}
assert(
	same(
		mod.JACKPOT_BAR_DEF.root.children.map((n) => n.params.source),
		['jackpot.mini', 'jackpot.minor', 'jackpot.major', 'jackpot.grand'],
	),
	'the bar feeds each tile its tier',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall jackpot-tile-part assertions passed');
