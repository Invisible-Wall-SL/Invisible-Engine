// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Total Win Bar's coded part (Hold and Win Phase 12c): the built-in's panel nodes sit
// inside the `Bar` part with their ids and bindings unchanged, the bar neither catches the coins nor
// pulses by default (the coins fly to the HUD's win meter, as they always did), the def stands for
// the part, and a bar saved before the part existed gets the stand-in and both params back by id.
//
//   node scripts/test-total-win-bar-part.mjs
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
			TOTAL_WIN_BAR_ANCHOR,
			TOTAL_WIN_BAR_DEF,
			boundComponentSkin,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-total-win-bar-part.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `total-win-bar-part-test-${process.pid}.mjs`);
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
const PANEL_IDS = ['totalWinBar-frame', 'totalWinBar-caption', 'totalWinBar-value'];
const NEW_PARAMS = ['catchesCoins', 'landPulseScale'];
const def = mod.TOTAL_WIN_BAR_DEF;

console.info('the part');
const [part, ...rest] = def.root.children;
assert(rest.length === 0, 'the root holds only the Bar part');
assert(part.kind === 'container' && part.bind?.component === 'TotalWinBarPart', 'a coded part');
assert(
	same(
		part.children.map((n) => n.id),
		PANEL_IDS,
	),
	'the frame, caption and value sit inside it, ids unchanged',
);
assert(part.children[2].paramBindings?.text === 'value', 'the value still binds value');
const params = mod.resolveComponentParams(def, {});
assert(params.catchesCoins === false, 'catches no coins by default (parity: the win meter does)');
assert(params.landPulseScale === 1, 'still by default (parity)');
assert(params.source === 'featureTotal', 'the source default is unchanged');
assert(def.standsFor === 'TotalWinBarPart', 'the bar stands for its part');
assert(mod.partStandIn(def) === undefined, 'the built-in binds its part: no stand-in');
assert(
	mod.TOTAL_WIN_BAR_ANCHOR.startsWith('flights:'),
	'its anchor is out of the layout-node-id namespace',
);
assert(same(mod.boundComponentSkin('TotalWinBarPart'), { layers: [] }), 'skinnable in the editors');

console.info('a bar saved before the part existed');
const flat = {
	...def,
	root: { ...def.root, children: structuredClone(part.children) },
	params: def.params.filter((p) => !NEW_PARAMS.includes(p.key)),
};
delete flat.standsFor;
const merged = mod.mergeBuiltinCodedParams(flat);
assert(merged.standsFor === 'TotalWinBarPart', 'gets standsFor back by id');
assert(
	NEW_PARAMS.every((key) => merged.params.some((p) => p.key === key)),
	'gets both params back by id',
);
assert(mod.partStandIn(merged) === 'TotalWinBarPart', 'its nodes at the root ⇒ the part stands in');
assert(
	mod.resolveComponentParams(merged, {}).catchesCoins === false,
	'and the stand-in catches nothing until asked to',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall total-win-bar-part assertions passed');
