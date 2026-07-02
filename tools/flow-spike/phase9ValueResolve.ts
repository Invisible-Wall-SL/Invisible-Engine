/**
 * Invisible Flow — Phase 9 value-resolution harness (design doc `flow-driven-game.md` §11.4).
 *
 *   pnpm --filter flow-spike run valueresolve
 *
 * Proves, HEADLESSLY against the REAL engine-flow interpreter + HSM, the value-binding resolution
 * half of value dataflow — a PURE, static, event-free resolve the game reads per display at mount:
 *
 *  A. Auto-bind by name (§11.2 rule 3) — with NO value edge, `resolveValueSource(i, s)` returns `s`
 *     verbatim for every display (byte-parity, §11.6).
 *
 *  B. Override by edge — one `value` edge rebinding display A returns A's `producer` feed key, while
 *     a sibling display B (unwired) still returns its OWN `source`.
 *
 *  C. Inert interpreter — constructed with no FlowDoc ⇒ ALWAYS returns `source` (no binding map even
 *     built; the byte-parity guarantee, §11.6).
 *
 *  D. Duplicate sinks (author error) — two value edges onto the same `${instanceId}::${source}`
 *     resolve LAST-WINS (doc order), deterministically, never throwing.
 *
 *  Plus the machine-level `valueBindings()` table shape (map keys/values + last-wins) and that the
 *  returned map is a defensive copy (mutating it does not corrupt the memoized cache).
 *
 * Determinism: a virtual `waitForTimeout` (resolves immediately); the resolve reads no clock.
 */

import {
	createFlowInterpreter,
	createPresentationMachine,
	normalizeFlowDoc,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Rig — a no-op runtime (this slice broadcasts nothing; the resolve reads only the graph).
// ---------------------------------------------------------------------------
const makeRuntime = (): FlowRuntime => ({
	emitter: {
		broadcast: () => {},
		broadcastAsync: () => Promise.resolve([]),
	},
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
});

const resolveScene = (): MountableScene | undefined => undefined;

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A value edge rebinding a display: producer feed `key` → the display's `{ instanceId, source }`.
const valueEdge = (
	id: string,
	producer: string,
	instanceId: string,
	source: string,
): FlowDoc['transitions'][number] => ({
	id,
	from: 'basegame',
	to: 'hud',
	trigger: { kind: 'value', producer, sink: { instanceId, source } },
});

const buildDoc = (transitions: FlowDoc['transitions']): FlowDoc => ({
	version: 1,
	screens: [{ id: 'basegame', initial: true }, { id: 'hud' }],
	transitions,
});

console.log('\nInvisible Flow — Phase 9 value-resolution harness (§11.4)\n');

// ---------------------------------------------------------------------------
// A. Auto-bind by name — no value edge ⇒ returns `source` verbatim.
// ---------------------------------------------------------------------------
console.log('A. Auto-bind by name (no value edge ⇒ source verbatim):');
{
	const noBinding = createFlowInterpreter({
		flowDoc: buildDoc([]),
		runtime: makeRuntime(),
		resolveScene,
		codedHandlers: {},
	});
	assert(
		'unwired display ⇒ resolveValueSource returns its own source',
		noBinding.resolveValueSource('n_balance', 'balance') === 'balance',
	);
	assert(
		'another unwired display ⇒ its own source',
		noBinding.resolveValueSource('n_win', 'win') === 'win',
	);
	assert(
		'unknown instance ⇒ its own source (no crash)',
		noBinding.resolveValueSource('nope', 'bet') === 'bet',
	);
}

// ---------------------------------------------------------------------------
// B. Override by edge — one edge rebinds A; sibling B keeps its own source.
// ---------------------------------------------------------------------------
console.log('\nB. Override by edge (A rebound, B untouched):');
{
	// Display A: instance `n_out` bound to `win` is REBOUND to produce `totalWin`. Display B: `n_bal`
	// bound to `balance` is left unwired.
	const wired = createFlowInterpreter({
		flowDoc: buildDoc([valueEdge('t_a', 'totalWin', 'n_out', 'win')]),
		runtime: makeRuntime(),
		resolveScene,
		codedHandlers: {},
	});
	assert(
		'rebound display A ⇒ resolves to the producer (totalWin)',
		wired.resolveValueSource('n_out', 'win') === 'totalWin',
	);
	assert(
		'sibling display B (unwired) ⇒ its own source (balance)',
		wired.resolveValueSource('n_bal', 'balance') === 'balance',
	);
	// The SAME instance with a DIFFERENT source key is a different binding — not rebound.
	assert(
		'same instance, different source key ⇒ not rebound',
		wired.resolveValueSource('n_out', 'bet') === 'bet',
	);
}

// ---------------------------------------------------------------------------
// C. Inert interpreter — no FlowDoc ⇒ always source.
// ---------------------------------------------------------------------------
console.log('\nC. Inert interpreter (no FlowDoc ⇒ always source):');
{
	const inert = createFlowInterpreter({
		flowDoc: undefined,
		runtime: makeRuntime(),
		resolveScene,
		codedHandlers: {},
	});
	assert(
		'inert ⇒ resolveValueSource returns source verbatim',
		inert.resolveValueSource('n_out', 'win') === 'win',
	);
	assert(
		'inert ⇒ another display returns source',
		inert.resolveValueSource('n_bal', 'balance') === 'balance',
	);
	assert('inert interpreter isActive false', inert.isActive === false);
}

// ---------------------------------------------------------------------------
// D. Duplicate sinks — last-wins, deterministic, never throws.
// ---------------------------------------------------------------------------
console.log('\nD. Duplicate sinks (author error ⇒ last-wins, doc order):');
{
	// Two edges onto the SAME sink `n_out::win`: first → bet, second → totalWin. Last (totalWin) wins.
	const dup = createFlowInterpreter({
		flowDoc: buildDoc([
			valueEdge('t_first', 'bet', 'n_out', 'win'),
			valueEdge('t_second', 'totalWin', 'n_out', 'win'),
		]),
		runtime: makeRuntime(),
		resolveScene,
		codedHandlers: {},
	});
	assert(
		'duplicate sink ⇒ last edge in doc order wins (totalWin)',
		dup.resolveValueSource('n_out', 'win') === 'totalWin',
	);
}

// ---------------------------------------------------------------------------
// E. Machine-level valueBindings() table — shape, last-wins, defensive copy.
// ---------------------------------------------------------------------------
console.log('\nE. valueBindings() table (shape + defensive copy):');
{
	const doc = buildDoc([
		valueEdge('t1', 'totalWin', 'n_out', 'win'),
		valueEdge('t2', 'bet', 'n_bal', 'balance'),
		valueEdge('t3', 'balance', 'n_out', 'win'), // duplicate sink for n_out::win ⇒ overrides t1
	]);
	const machine = createPresentationMachine(doc, { runtime: makeRuntime() });
	const bindings = machine.valueBindings();
	assert(
		'table maps ${instanceId}::${source} → producer',
		bindings.get('n_bal::balance') === 'bet',
	);
	assert(
		'table last-wins on duplicate sink (t3 over t1)',
		bindings.get('n_out::win') === 'balance',
	);
	assert('table has exactly one entry per distinct sink', bindings.size === 2);
	// Defensive copy: mutating the returned map does not corrupt the memoized cache.
	bindings.set('n_out::win', 'HACKED');
	assert(
		'returned map is a defensive copy (cache intact)',
		machine.valueBindings().get('n_out::win') === 'balance',
	);
	// A doc with NO value edge ⇒ an empty table (not undefined).
	const emptyMachine = createPresentationMachine(buildDoc([]), { runtime: makeRuntime() });
	assert('no value edges ⇒ empty table', emptyMachine.valueBindings().size === 0);
}

// ---------------------------------------------------------------------------
// F. Round-trip — a value edge survives normalize (the bake/save contract, cross-check).
// ---------------------------------------------------------------------------
console.log('\nF. Round-trip (value edge survives normalize):');
{
	const doc = buildDoc([valueEdge('t1', 'totalWin', 'n_out', 'win')]);
	const stored = normalizeFlowDoc(JSON.parse(JSON.stringify(doc)), 'p');
	const machine = createPresentationMachine(stored, { runtime: makeRuntime() });
	assert(
		'normalized value edge still resolves (via valueBindings)',
		machine.valueBindings().get('n_out::win') === 'totalWin',
	);
	assert('normalize is idempotent for the value-edge doc', eq(normalizeFlowDoc(stored), stored));
}

console.log('');
if (!failed) {
	console.log('PHASE 9 VALUE-RESOLVE HARNESS: PASSED\n');
} else {
	console.log('PHASE 9 VALUE-RESOLVE HARNESS: FAILED\n');
	process.exit(1);
}
