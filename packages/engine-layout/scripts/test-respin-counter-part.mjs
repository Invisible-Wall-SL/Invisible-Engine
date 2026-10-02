// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Respin Counter's coded part (Hold and Win Phase 12c): the built-in's panel nodes sit
// inside the `Counter` part with their ids unchanged, the part is still (pulse off by default), the
// def stands for the part, a counter saved before the part existed (its nodes at the root) gets the
// stand-in and the new param back by id.
//
//   node scripts/test-respin-counter-part.mjs
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
			RESPIN_COUNTER_DEF,
			boundComponentSkin,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-respin-counter-part.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `respin-counter-part-test-${process.pid}.mjs`);
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
const PANEL_IDS = ['respinCounter-frame', 'respinCounter-caption', 'respinCounter-value'];
const def = mod.RESPIN_COUNTER_DEF;

console.info('the part');
const [part, ...rest] = def.root.children;
assert(rest.length === 0, 'the root holds only the Counter part');
assert(part.kind === 'container' && part.bind?.component === 'RespinCounterPart', 'a coded part');
assert(
	same(
		part.children.map((n) => n.id),
		PANEL_IDS,
	),
	'the frame, caption and value sit inside it, ids unchanged',
);
const frame = part.children[0];
assert(
	frame.paramBindings?.region === 'frameImage' && frame.paramBindings?.tint === 'frameTint',
	'the frame still binds frameImage / frameTint',
);
assert(def.standsFor === 'RespinCounterPart', 'the counter stands for its part');
assert(mod.partStandIn(def) === undefined, 'the built-in binds its part: no stand-in');
assert(mod.resolveComponentParams(def, {}).pulseScale === 1, 'pulse off by default (parity)');
assert(
	same(mod.boundComponentSkin('RespinCounterPart'), { layers: [] }),
	'skinnable in the editors, its art being its own nodes',
);

console.info('a counter saved before the part existed');
const flat = {
	...def,
	root: { ...def.root, children: structuredClone(part.children) },
	params: def.params.filter((p) => p.key !== 'pulseScale'),
};
delete flat.standsFor;
const merged = mod.mergeBuiltinCodedParams(flat);
assert(merged.standsFor === 'RespinCounterPart', 'gets standsFor back by id');
assert(
	merged.params.some((p) => p.key === 'pulseScale'),
	'gets the pulse param back by id',
);
assert(
	mod.partStandIn(merged) === 'RespinCounterPart',
	'its nodes at the root ⇒ the part stands in',
);
assert(
	same(
		merged.root.children.map((n) => n.id),
		PANEL_IDS,
	),
	'its own tree is left as saved',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall respin-counter-part assertions passed');
