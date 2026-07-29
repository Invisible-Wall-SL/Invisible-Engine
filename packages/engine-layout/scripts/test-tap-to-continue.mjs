// Verify the shared tap-to-continue capability's pure helpers + param round-trip
// (Invisible Flow §6.2; docs/design/invisible-editor.md §8.5).
//
//   node scripts/test-tap-to-continue.mjs
//
// Same esbuild-bundle trick as test-engine-owned-only.mjs: the monorepo consumes
// packages as raw TS, so bundle the pure-data helpers (no `.svelte`) into one ESM
// file Node can execute, then assert their behaviour.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			TAP_TO_CONTINUE_PARAM,
			TAP_SIGNAL_PARAM,
			TAP_SHOW_PROMPT_PARAM,
			TAP_ARM_AFTER_SIGNAL_PARAM,
			TAP_TO_CONTINUE_COMPONENT,
			TAP_TO_CONTINUE_PARAMS,
			isTapToContinueEnabled,
			tapSignalOf,
			tapShowPromptOf,
			tapArmAfterSignalOf,
			tapDimBehind,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-tap-to-continue.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `tap-to-continue-test-${process.pid}.mjs`);
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

// --- helper defaults (parity: OFF by default) ---
assert(mod.isTapToContinueEnabled({}) === false, 'enabled is false on an empty param map (parity)');
assert(
	mod.isTapToContinueEnabled({ [mod.TAP_TO_CONTINUE_PARAM]: false }) === false,
	'enabled is false when toggle explicitly off',
);
assert(
	mod.isTapToContinueEnabled({ [mod.TAP_TO_CONTINUE_PARAM]: true }) === true,
	'enabled is true when toggle on',
);
// A non-boolean truthy value must NOT enable it (strict === true).
assert(
	mod.isTapToContinueEnabled({ [mod.TAP_TO_CONTINUE_PARAM]: 'yes' }) === false,
	'enabled is false for a non-boolean truthy value (strict ===)',
);

// --- signal reader (trim + empty-safe) ---
assert(mod.tapSignalOf({}) === '', 'signal is empty when unset');
assert(
	mod.tapSignalOf({ [mod.TAP_SIGNAL_PARAM]: '  dismiss  ' }) === 'dismiss',
	'signal is trimmed',
);
assert(mod.tapSignalOf({ [mod.TAP_SIGNAL_PARAM]: 42 }) === '', 'signal is empty for a non-string');

// --- the bound-component name is stable (the registerBoundComponents key) ---
assert(mod.TAP_TO_CONTINUE_COMPONENT === 'TapToContinue', 'bound-component name is TapToContinue');

// --- the editor param catalog exposes the shared instance params (toggle + signal +
// dim colour/opacity + the opt-in engine-prompt show flag) ---
const keys = mod.TAP_TO_CONTINUE_PARAMS.map((p) => p.key);
assert(
	keys.length === 6 &&
		keys.includes(mod.TAP_TO_CONTINUE_PARAM) &&
		keys.includes(mod.TAP_SIGNAL_PARAM) &&
		keys.includes(mod.TAP_SHOW_PROMPT_PARAM) &&
		keys.includes(mod.TAP_ARM_AFTER_SIGNAL_PARAM),
	'catalog exposes the tapToContinue + tapSignal + tapShowPrompt + tapArmAfterSignal params',
);
// --- arm-after-signal reader (trim + empty-safe), and its catalog param is a string ---
assert(mod.tapArmAfterSignalOf({}) === '', 'arm-after-signal is empty when unset (arms on mount)');
assert(
	mod.tapArmAfterSignalOf({ [mod.TAP_ARM_AFTER_SIGNAL_PARAM]: '  introDone  ' }) === 'introDone',
	'arm-after-signal is trimmed',
);
assert(
	mod.tapArmAfterSignalOf({ [mod.TAP_ARM_AFTER_SIGNAL_PARAM]: 7 }) === '',
	'arm-after-signal is empty for a non-string',
);
const armParam = mod.TAP_TO_CONTINUE_PARAMS.find((p) => p.key === mod.TAP_ARM_AFTER_SIGNAL_PARAM);
assert(armParam?.kind === 'string', 'arm-after-signal param is a string');
const showPrompt = mod.TAP_TO_CONTINUE_PARAMS.find((p) => p.key === mod.TAP_SHOW_PROMPT_PARAM);
assert(
	showPrompt?.kind === 'boolean' && showPrompt.default === true,
	'engine-prompt param is boolean, default true (prompt shown unless turned off)',
);
// An unset param means SHOWN (default-shown); only an explicit `false` hides the prompt.
assert(mod.tapShowPromptOf({}) === true, 'no param ⇒ engine prompt shown (default)');
assert(
	mod.tapShowPromptOf({ [mod.TAP_SHOW_PROMPT_PARAM]: false }) === false,
	'explicit false ⇒ engine prompt hidden',
);
const toggle = mod.TAP_TO_CONTINUE_PARAMS.find((p) => p.key === mod.TAP_TO_CONTINUE_PARAM);
assert(toggle?.kind === 'boolean' && toggle.default === false, 'toggle is boolean, default false');
const signal = mod.TAP_TO_CONTINUE_PARAMS.find((p) => p.key === mod.TAP_SIGNAL_PARAM);
assert(signal?.kind === 'string', 'signal param is a string');

// --- resolveComponentParams threads the SHARED params even though no def declares
// them (params live only on the instance; resolveComponentParams merges node.params
// regardless of the def) ---
const def = { id: 'x', name: 'X', version: 1, scope: 'project', category: 'overlay', root: {} };
const resolved = mod.resolveComponentParams(def, {
	[mod.TAP_TO_CONTINUE_PARAM]: true,
	[mod.TAP_SIGNAL_PARAM]: 'go',
});
assert(mod.isTapToContinueEnabled(resolved) === true, 'resolved params carry the on toggle');
assert(mod.tapSignalOf(resolved) === 'go', 'resolved params carry the signal');
// Parity: a def with no tap params + an instance with none ⇒ tap stays off.
assert(
	mod.isTapToContinueEnabled(mod.resolveComponentParams(def, undefined)) === false,
	'no instance params ⇒ tap off (parity)',
);

// --- tapDimBehind: the DIM sits behind the scene content iff the tap node is NOT the topmost
// (last-painted) node — the author placed content ABOVE it in the outline. This is the layer-order
// rule LayoutScene splits the surface on, so a celebration screen shows over its dim. ---
const order = ['tap', 'gunshots', 'retriggerArt', 'gunshots2'];
assert(
	mod.tapDimBehind(order, 'tap') === true,
	'a tap FIRST in paint order (content above it) ⇒ dim BEHIND the content',
);
assert(
	mod.tapDimBehind(order, 'retriggerArt') === true,
	'a tap in the MIDDLE with a later sibling (content still above it) ⇒ dim behind',
);
assert(
	mod.tapDimBehind(['bg', 'art', 'tap'], 'tap') === false,
	'a tap LAST in paint order (topmost, nothing above) ⇒ dim IN FRONT (legacy parity)',
);
assert(
	mod.tapDimBehind(['tap'], 'tap') === false,
	'the ONLY node ⇒ dim in front (nothing to sit behind) — parity',
);
assert(
	mod.tapDimBehind(order, 'nested') === false,
	'a tap id not among the top-level nodes (a nested instance) ⇒ in front (safe legacy default)',
);

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ tap-to-continue helpers + param round-trip verified.');
