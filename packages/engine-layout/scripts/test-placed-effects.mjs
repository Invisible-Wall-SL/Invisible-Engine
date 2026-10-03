// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify `collectPlacedEffectIds`, the one walk the game (which effects NOT to auto-mount at the stage
// origin) and the launcher (which effects a bundle keeps) share: an effect node placed in a scene,
// in a container, in a component def, inside a bind part's skin (an FX in a Pot), or in a pinned
// def version counts as placed; an instance is not expanded (its def is walked once); an effect
// node with no id does not count.
//
//   node scripts/test-placed-effects.mjs
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
		contents: `export { collectPlacedEffectIds, POT_METER_DEF } from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-placed-effects.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `placed-effects-test-${process.pid}.mjs`);
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
const same = (set, ids) => JSON.stringify([...set].sort()) === JSON.stringify([...ids].sort());
const effect = (id, effectId) => ({ id, kind: 'effect', effectId, x: 0, y: 0 });

const part = mod.POT_METER_DEF.root.children[0];
const frogPot = {
	...mod.POT_METER_DEF,
	id: 'frogPot',
	root: {
		...mod.POT_METER_DEF.root,
		children: [{ ...part, children: [effect('frog-fx', 'frogCheer')] }],
	},
};
const pinned = {
	...frogPot,
	version: 1,
	root: { ...frogPot.root, children: [effect('old', 'oldCheer')] },
};
const nodes = [
	effect('rain', 'rain'),
	{ id: 'box', kind: 'container', x: 0, y: 0, children: [effect('sparkle', 'sparkle')] },
	{ id: 'pot-red', kind: 'componentInstance', componentId: 'frogPot', x: 0, y: 0 },
	effect('blank', ''),
];

console.info('scenes');
assert(
	same(mod.collectPlacedEffectIds(nodes), ['rain', 'sparkle']),
	'a scene effect and one in a container',
);
assert(
	!mod.collectPlacedEffectIds(nodes).has('frogCheer'),
	'an instance is not expanded without its def',
);

console.info('component defs');
const withDefs = mod.collectPlacedEffectIds(nodes, [frogPot]);
assert(withDefs.has('frogCheer'), 'an effect inside a bind part’s skin (an FX in a Pot) is placed');
assert(same(withDefs, ['rain', 'sparkle', 'frogCheer']), 'nothing else, and no blank id');
assert(
	mod.collectPlacedEffectIds([], [frogPot, pinned]).has('oldCheer'),
	'a pinned version’s effect counts too',
);
assert(mod.collectPlacedEffectIds([]).size === 0, 'an empty doc places nothing');

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall placed-effects assertions passed');
