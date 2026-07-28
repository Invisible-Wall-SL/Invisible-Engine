// Verify the pure component-scoped SIGNAL GATE helpers (Invisible Flow — intro-complete sequencing).
//
//   node scripts/test-signal-gates.mjs
//
// Same esbuild-bundle trick as test-tap-to-continue.mjs: bundle the pure helpers (no `.svelte`) into
// one ESM file Node can run, then assert the reveal/arm/complete-listener decisions. This is the
// offline proof of the three authoring gates the runtime (`LayoutNodeView`/`ComponentInstance`) drive:
//  (a) a node with `hiddenUntilSignal` is hidden until that signal fires, then shown;
//  (b) a spine one-shot attaches its `completeSignal` listener only when non-looping;
//  (c) a tap surface is inert before `tapArmAfterSignal` and armed after.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			hasSignalFired,
			isNodeRevealed,
			isTapArmed,
			wantsCompleteListener,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-signal-gates.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `signal-gates-test-${process.pid}.mjs`);
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

// --- hasSignalFired: a positive count means fired ---
assert(mod.hasSignalFired('introDone', {}) === false, 'unfired signal reads false on empty counts');
assert(mod.hasSignalFired('introDone', { introDone: 0 }) === false, 'a zero count reads not-fired');
assert(mod.hasSignalFired('introDone', { introDone: 1 }) === true, 'a positive count reads fired');
assert(
	mod.hasSignalFired('introDone', { other: 3 }) === false,
	'only the named signal counts (not a sibling)',
);

// --- (a) reveal gate: hidden until the named signal fires, then shown; unset ⇒ always shown ---
assert(mod.isNodeRevealed(undefined, {}) === true, 'no gate ⇒ always revealed (parity)');
assert(mod.isNodeRevealed('', {}) === true, 'empty gate ⇒ always revealed (parity)');
assert(
	mod.isNodeRevealed('introDone', {}) === false,
	'gated node is HIDDEN before the signal fires',
);
assert(
	mod.isNodeRevealed('introDone', { introDone: 1 }) === true,
	'gated node is SHOWN once the signal fires',
);
// Re-arm semantics: a fresh mount starts from empty counts ⇒ hidden again.
assert(
	mod.isNodeRevealed('introDone', {}) === false,
	'a fresh mount (empty counts) re-hides the gated node',
);

// --- (c) tap arm: inert before the signal, armed after; unset ⇒ armed on mount ---
assert(mod.isTapArmed(undefined, {}) === true, 'no arm-signal ⇒ armed on mount (parity)');
assert(mod.isTapArmed('', {}) === true, 'empty arm-signal ⇒ armed on mount (parity)');
assert(mod.isTapArmed('introDone', {}) === false, 'tap is INERT before its arm-signal fires');
assert(
	mod.isTapArmed('introDone', { introDone: 1 }) === true,
	'tap is ARMED once its arm-signal fires',
);

// --- (b) completion listener: attach ONLY for a one-shot (non-looping) with a callback ---
assert(
	mod.wantsCompleteListener(false, true) === true,
	'one-shot + callback ⇒ attach the completion listener',
);
assert(
	mod.wantsCompleteListener(undefined, true) === true,
	'unset loop (defaults non-looping here) + callback ⇒ attach',
);
assert(
	mod.wantsCompleteListener(true, true) === false,
	'a LOOPING animation never fires a single completion (no listener)',
);
assert(
	mod.wantsCompleteListener(false, false) === false,
	'no callback ⇒ no listener (parity — unchanged spine behaviour)',
);

// --- End-to-end micro-scenario: enter → intro plays → introDone fires → amount + tap appear ---
// Model the instance's fired-signal counts evolving as the runtime would drive them.
let fired = {};
// On mount: the amount is hidden, the tap is inert.
assert(mod.isNodeRevealed('introDone', fired) === false, 'scenario: amount hidden on mount');
assert(mod.isTapArmed('introDone', fired) === false, 'scenario: tap inert on mount');
// `enter` fires (plays the intro) but does NOT reveal a node gated on `introDone`.
fired = { ...fired, enter: 1 };
assert(
	mod.isNodeRevealed('introDone', fired) === false,
	'scenario: enter alone does not reveal the amount',
);
// The intro one-shot completes → its `completeSignal: introDone` fires.
fired = { ...fired, introDone: 1 };
assert(mod.isNodeRevealed('introDone', fired) === true, 'scenario: amount appears after intro');
assert(mod.isTapArmed('introDone', fired) === true, 'scenario: tap arms after intro');

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ signal-gate helpers verified.');
