// Guard against the reactive re-entrancy loop in `ComponentInstance`'s signal-subscription effect.
//
//   node scripts/test-signal-subscribe-untrack.mjs
//
// THE BUG (fixed): a registered signal source may EMIT SYNCHRONOUSLY on subscribe — the seed-on-
// subscribe latch (e.g. `freeSpinOutroCountUpComplete` fires `run()` immediately when the outro
// count-up already completed, the fix for the instant-count-up race). That emission runs the
// subscribe callback INSIDE the `$effect` that sets the subscriptions up, and the callback
// (`fireComponentSignal`) READS + WRITES `firedSignals[signalKey]`. Without `untrack`, the READ
// leaks as a dependency of the subscription effect and the WRITE re-invalidates it — an infinite
// reactive loop (`effect_update_depth_exceeded`). It reproduced on a SLAMMED free-spin outro
// (count-up completes in the same tick the outro-visual instance subscribes, so the latch is set).
//
// A true reactive test needs the Svelte client scheduler (a browser), which this package's Node
// scripts don't have — so, like the sibling gate tests, this asserts the STRUCTURAL invariant that
// prevents the loop: the signal-subscription setup is wrapped in `untrack(...)`, so a synchronous
// seed can never leak a dependency back into the effect. Removing the guard re-introduces the loop
// and fails here.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(HERE, '../src/lib/ComponentInstance.svelte'), 'utf8');

let failures = 0;
const assert = (cond, msg) => {
	if (cond) console.info(`  ✓ ${msg}`);
	else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};

// `untrack` must be imported (the guard primitive).
assert(/import\s*\{[^}]*\buntrack\b[^}]*\}\s*from\s*'svelte'/.test(src), '`untrack` is imported from svelte');

// Isolate the signal-subscription effect: the one that iterates `signalToTargets` and subscribes.
const marker = 'const source = getComponentSignal(signalKey);';
const idx = src.indexOf(marker);
assert(idx !== -1, 'the signal-subscription effect is present');

// Walk backwards from the subscription loop to the enclosing `$effect(` and assert an `untrack(`
// sits between them — i.e. the subscribe SETUP runs untracked, so a synchronous seed can't leak a
// dependency (the `fireComponentSignal` read/write) back into the effect.
const before = src.slice(0, idx);
const effectAt = before.lastIndexOf('$effect(');
assert(effectAt !== -1, 'the subscription loop is inside an `$effect`');
const between = src.slice(effectAt, idx);
assert(/untrack\s*\(/.test(between), 'the subscription setup is wrapped in `untrack(...)`');

// The subscribe callbacks must still WRITE the signal bus (untrack suppresses tracking, not writes),
// so `hiddenUntilSignal`/`tapArmed` consumers keep updating on later emissions.
const effectBlock = src.slice(effectAt, idx + 1500);
assert(/fireComponentSignal\(signalKey\)/.test(effectBlock), 'the callback still records the fire (`fireComponentSignal`)');

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ signal-subscription untrack guard verified.');
