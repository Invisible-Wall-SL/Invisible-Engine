// Verify the AUTHOR-NAMED cue signal bus + the one-shot/loop hand-off predicate.
//
//   node scripts/test-cue-signal-bus.mjs
//
// Same esbuild-bundle trick as test-signal-gates.mjs: bundle the pure (Svelte-free) modules into one
// ESM file Node can run, then assert the two decisions that make "idle by default, a different
// animation looping while the game is in some mode" authorable:
//
//  (a) the OPEN bus — a signal name the game never wired via `registerComponentSignals` is still
//      subscribable, and `emitComponentSignal` fires it. This is what lets a Flow `fireCue` name
//      reach a spine cue without a coded registry entry per animation trigger. A REGISTERED name
//      must still win, so the two names that are both a vocab cue and a catalog signal
//      (`specialBookReveal` / `specialBookHide`) cannot double-fire.
//  (b) `handsOffToIdle` — a cue that explicitly asked to LOOP must keep its loop. The predicate used
//      to be "cue animation ≠ defaultAnimation", which matched exactly the idle-plus-a-held-mode rig
//      and silently overrode `loop` to false, so the mode animation played once and dropped back.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			clearComponentSignals,
			emitComponentSignal,
			getComponentSignal,
			handsOffToIdle,
			registerComponentSignals,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-cue-signal-bus.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `cue-signal-bus-test-${process.pid}.mjs`);
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

const {
	clearComponentSignals,
	emitComponentSignal,
	getComponentSignal,
	handsOffToIdle,
	registerComponentSignals,
} = mod;

// --- 1. The open bus: an unregistered name is live ---
console.info('\n1. Open bus — an author-named signal the game never registered');
clearComponentSignals();

assert(
	typeof getComponentSignal('characterSpin')?.subscribe === 'function',
	'an unregistered name resolves to a source (never undefined — the old `undefined` meant "skip this cue")',
);

let spinFires = 0;
const unsubSpin = getComponentSignal('characterSpin').subscribe(() => (spinFires += 1));
assert(spinFires === 0, 'subscribing alone does not fire (a signal is an event, not state)');

emitComponentSignal('characterSpin');
assert(spinFires === 1, 'emitComponentSignal fires the subscriber');

emitComponentSignal('characterSpin');
assert(spinFires === 2, 'a repeat emit fires again (a cue re-fire must be replayable)');

emitComponentSignal('somethingElse');
assert(spinFires === 2, 'an unrelated name does not fire it');

unsubSpin();
emitComponentSignal('characterSpin');
assert(spinFires === 2, 'unsubscribe detaches');

// --- 2. Two subscribers on one name (two spines reacting to the same cue) ---
console.info('\n2. Fan-out — several nodes may name the same signal');
clearComponentSignals();
let a = 0;
let b = 0;
const unsubA = getComponentSignal('shared').subscribe(() => (a += 1));
getComponentSignal('shared').subscribe(() => (b += 1));
emitComponentSignal('shared');
assert(
	a === 1 && b === 1,
	'both subscribers fire, even though each called getComponentSignal separately',
);
unsubA();
emitComponentSignal('shared');
assert(a === 1 && b === 2, 'unsubscribing one leaves the other attached');

// A subscriber that detaches DURING a fire (a cue that swaps the mounted tree) must not corrupt the walk.
clearComponentSignals();
let walked = 0;
let selfUnsub;
selfUnsub = getComponentSignal('reentrant').subscribe(() => {
	walked += 1;
	selfUnsub();
});
getComponentSignal('reentrant').subscribe(() => (walked += 1));
emitComponentSignal('reentrant');
assert(
	walked === 2,
	'a subscriber unsubscribing mid-fire does not skip its siblings (the walk copies)',
);

// --- 3. A REGISTERED name wins — no double-fire ---
console.info('\n3. Registry precedence — a game-wired signal cannot double-fire');
clearComponentSignals();
let registeredFires = 0;
let emitRegistered;
registerComponentSignals({
	specialBookReveal: {
		subscribe(run) {
			emitRegistered = run;
			return () => {
				emitRegistered = undefined;
			};
		},
	},
});
getComponentSignal('specialBookReveal').subscribe(() => {
	registeredFires += 1;
});
assert(
	typeof emitRegistered === 'function',
	'a registered name subscribes through the REGISTERED source',
);

emitComponentSignal('specialBookReveal');
assert(
	registeredFires === 0,
	'emitComponentSignal does NOT reach a registered name (so a flow cue + its emitter event fire once, not twice)',
);

emitRegistered();
assert(registeredFires === 1, 'the registered source still drives it exactly as before');

// --- 4. clearComponentSignals clears BOTH buses ---
console.info('\n4. Teardown');
clearComponentSignals();
let afterClear = 0;
getComponentSignal('afterClear').subscribe(() => (afterClear += 1));
emitComponentSignal('afterClear');
assert(afterClear === 1, 'the open bus works again after a clear');
clearComponentSignals();
emitComponentSignal('afterClear');
assert(
	afterClear === 1,
	'clearComponentSignals drops open subscribers too (no cross-test leakage)',
);

// --- 5. handsOffToIdle — the one-shot vs held-loop decision ---
console.info('\n5. handsOffToIdle — a looping cue keeps its loop');
const intro = { animation: 'intro' };
const spinLoop = { animation: 'spin', loop: true };

assert(
	handsOffToIdle(intro, 'idle', false) === true,
	'THE free-spin-intro shape: a one-shot cue with a distinct resting clip hands back to idle',
);
assert(
	handsOffToIdle(spinLoop, 'idle', false) === false,
	'REGRESSION GUARD: a cue that asked to loop, next to a distinct idle default, keeps looping (this was silently forced to one-shot)',
);
assert(
	handsOffToIdle(intro, 'intro', false) === false,
	'no distinct resting clip ⇒ nothing to hand off to',
);
assert(handsOffToIdle(intro, undefined, false) === false, 'no resting clip at all ⇒ no hand-off');
assert(handsOffToIdle(undefined, 'idle', false) === false, 'no active cue ⇒ no hand-off');
assert(
	handsOffToIdle(intro, 'idle', true) === false,
	'a button STATE animation is in effect ⇒ it drives the track, the cue must not steal the hand-off',
);
assert(
	handsOffToIdle(spinLoop, 'idle', true) === false,
	'state animation wins over a looping cue too',
);
assert(
	handsOffToIdle({ animation: 'spin', loop: false }, 'idle', false) === true,
	'an EXPLICITLY non-looping cue still hands off (loop:false is not the same as loop:true)',
);

// A cue carrying BOTH `loop` and `completeSignal` is a contradiction the editor can save (the
// completeSignal input is hidden when loop is ticked, but `updateCue` never clears the stored value —
// and before the loop fix, ticking loop on such a cue had no observable effect at all, so a shipped
// doc may well carry the pair). `completeSignal` must win: `SpineTrack` attaches its completion
// listener only when `loop` is false, so honouring the loop would silently drop the hand-off — the
// `hiddenUntilSignal` sibling never reveals, the `tapArmAfterSignal` tap never arms, and a screen held
// by `showContainer{awaitComplete}` hangs the round forever.
console.info('\n6. completeSignal beats loop — the hung-round guard');
assert(
	handsOffToIdle({ animation: 'intro', loop: true, completeSignal: 'introDone' }, 'idle', false) ===
		true,
	'REGRESSION GUARD: loop + completeSignal still hands off, so the completion listener is attached',
);
assert(
	handsOffToIdle({ animation: 'spin', loop: true }, 'idle', false) === false,
	'loop with NO completeSignal still holds (the held-mode case is untouched by that rule)',
);
assert(
	handsOffToIdle({ animation: 'intro', completeSignal: 'introDone' }, 'idle', false) === true,
	'a plain one-shot with a completeSignal is unchanged',
);
assert(
	handsOffToIdle(
		{ animation: 'intro', loop: true, completeSignal: 'introDone' },
		'intro',
		false,
	) === false,
	'…but only when there is a distinct resting clip to hand back to',
);

// A FLIPBOOK cue rides the same bus and lands in the same per-node map, but names a `clipId`
// instead of an `animation`. It must never drive the spine hand-off: that branch decides whether
// to force `loop=false` and hand a spine track back to its resting animation, which is meaningless
// for a clip swap — and, since the entry carries no `animation`, "cue animation ≠ default" would
// otherwise read TRUE (undefined ≠ 'idle') and un-loop a held clip.
console.info('\n7. A flipbook cue payload never drives the spine hand-off');
assert(
	handsOffToIdle({ clipId: 'spin' }, 'idle', false) === false,
	'a clip-swap cue with no animation hands off nothing',
);
assert(
	handsOffToIdle({ clipId: 'spin', loop: true }, 'idle', false) === false,
	'…including a looping one, which is the character-while-spinning case',
);
assert(
	handsOffToIdle({ animation: '', loop: true }, 'idle', false) === false,
	'an empty animation is treated the same (a half-authored spine cue drives nothing)',
);

console.info('');
if (failures > 0) {
	console.error(`${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('all cue-signal-bus assertions passed');
