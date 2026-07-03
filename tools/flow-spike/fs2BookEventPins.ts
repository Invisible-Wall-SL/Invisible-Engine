/**
 * Invisible Flow — FS-2 book-event trigger pins harness (design doc `invisible-flow.md` §14).
 *
 *   pnpm --filter flow-spike run fs2
 *
 * Proves, HEADLESSLY against the REAL engine-flow `deriveScreenPins` / `createPresentationMachine` /
 * `normalizeFlowDoc` / `validateFlowDoc` / `bookEventTypes`, the book-event trigger INPUT pin slice:
 *
 *  A. Book-event pins (§14 FS-2) — `deriveScreenPins(scene, resolve, { bookEvents })` derives one
 *     `bookEvent` INPUT pin per event on EVERY screen (a union advertised everywhere, NOT host-gated
 *     like intents). Stable id `${screenId}::bookEvent:${event}`, direction `in`, key = the event.
 *
 *  B. A pin-drawn edge fires unchanged (§14) — an edge INTO a `freeSpinTrigger` pin produces a
 *     `FlowTransition` whose trigger is `{ kind:'bookEvent', event:'freeSpinTrigger' }` (+ fromPin/
 *     toPin) that the interpreter's `onBookEvent` fires EXACTLY as today (matching `trigger.event`).
 *     The interpreter is UNCHANGED (it ignores fromPin/toPin) — parity by construction.
 *
 *  C. Round-trip (the bake/save contract) — the pin-sourced edge (fromPin/toPin + trigger.event)
 *     survives `normalizeFlowDoc` idempotently; a freshly-drawn bookEvent edge with an EMPTY event is
 *     PRESERVED (the author names it after drawing — dropping it would lose an in-progress edge). It
 *     just never FIRES (`onBookEvent` never matches an empty event), so parity is safe either way.
 *
 *  D. Parity (§14) — a TYPED-name bookEvent edge (old style, NO fromPin/toPin) fires the SAME way
 *     via `onBookEvent`, unchanged. Validation warns (never drops) an edge naming an event outside
 *     the vocabulary; an in-vocabulary event (typed or pin-drawn) is clean.
 *
 * Determinism: a virtual `waitForTimeout` (resolves immediately). The rig mirrors phase8ActionIntent.ts.
 */

import {
	bookEventTypes,
	createPresentationMachine,
	deriveScreenPins,
	normalizeFlowDoc,
	validateFlowDoc,
	type ComponentDef,
	type EmitterVocabulary,
	type FlowDoc,
	type FlowRuntime,
	type Scene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — a virtual clock + a no-op emitter (this slice fires transitions, not broadcasts).
// ---------------------------------------------------------------------------
const makeRuntime = (): FlowRuntime => ({
	emitter: {
		broadcast: () => {},
		broadcastAsync: () => Promise.resolve([]),
	},
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
});

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

// A bare base-game scene + a free-spin overlay scene — shaped like real LayoutDoc scenes.
const baseScene: Scene = {
	id: 'basegame',
	name: 'Base game',
	space: 'game',
	nodes: [],
} as unknown as Scene;
const freeScene: Scene = {
	id: 'freeGame',
	name: 'Free game',
	space: 'game',
	nodes: [],
} as unknown as Scene;

const resolveDef = (_id: string): ComponentDef | undefined => undefined;

// The book-event vocabulary the game exports (a slice of the real lines `EmitterVocabulary`).
const vocab: EmitterVocabulary = {
	source: 'lines',
	events: [],
	bookEvents: [{ type: 'freeSpinTrigger' }, { type: 'freeSpinEnd' }, { type: 'updateFreeSpin' }],
};
const bookEvents = bookEventTypes(vocab);

const main = async () => {
	console.log('Invisible Flow — FS-2 book-event trigger pins harness\n');

	// --- A. Book-event pins on EVERY screen (§14) ---
	console.log('A. Book-event trigger input pins derived on every screen (union, not host-gated):');
	{
		const basePins = deriveScreenPins(baseScene, resolveDef, { bookEvents });
		const freePins = deriveScreenPins(freeScene, resolveDef, { bookEvents });
		const baseBook = basePins.filter((p) => p.role === 'bookEvent');
		const freeBook = freePins.filter((p) => p.role === 'bookEvent');
		assert(
			'base screen derives one bookEvent input pin per vocabulary event (stable ids, direction in)',
			baseBook.length === 3 &&
				baseBook.every((p) => p.direction === 'in') &&
				baseBook[0].id === 'basegame::bookEvent:freeSpinTrigger' &&
				baseBook[0].key === 'freeSpinTrigger',
			JSON.stringify(baseBook.map((p) => p.id)),
		);
		assert(
			'the SAME vocabulary is advertised on a second screen (a union — not host-gated)',
			freeBook.length === 3 && freeBook[0].id === 'freeGame::bookEvent:freeSpinTrigger',
			JSON.stringify(freeBook.map((p) => p.id)),
		);
		// Deterministic order — vocabulary order, right after the structural pins (no intents here).
		assert(
			'bookEvent pins are placed right after the structural pins (deterministic order)',
			basePins[3]?.id === 'basegame::bookEvent:freeSpinTrigger',
			basePins.map((p) => p.id).join(', '),
		);
		// No vocabulary ⇒ no bookEvent pins (parity — the typed-name path still works).
		const noVocab = deriveScreenPins(baseScene, resolveDef, {});
		assert(
			'no vocabulary ⇒ NO bookEvent pins (typed-name path unaffected, parity)',
			noVocab.every((p) => p.role !== 'bookEvent'),
		);
	}

	// --- B. A pin-drawn edge fires unchanged via onBookEvent (§14) ---
	console.log('\nB. A pin-drawn edge produces the exact trigger onBookEvent already fires:');
	{
		// The shape the `/flow` onConnect mints when the author drops onto the `freeSpinTrigger` pin.
		const freePin = 'freeGame::bookEvent:freeSpinTrigger';
		const pinDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }, { id: 'freeGame' }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'freeGame',
					trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
					fromPin: 'basegame::complete',
					toPin: freePin,
				},
			],
		};
		assert(
			'the edge trigger is exactly { kind:"bookEvent", event:"freeSpinTrigger" }',
			eq(pinDoc.transitions[0].trigger, { kind: 'bookEvent', event: 'freeSpinTrigger' }),
		);
		const setChanges: string[][] = [];
		const m = createPresentationMachine(pinDoc, {
			runtime: makeRuntime(),
			onActiveScreensChange: (ids) => setChanges.push([...ids]),
		});
		assert('boot: only the base game is active', eq(m.activeScreenIds, ['basegame']));
		// The interpreter matches on trigger.event — the pin id is IGNORED (fromPin/toPin authoring-only).
		const took = await m.onBookEvent({ type: 'freeSpinTrigger' });
		assert(
			'onBookEvent("freeSpinTrigger") fires the pin-drawn edge (freeGame layers over base)',
			took && eq(m.activeScreenIds, ['basegame', 'freeGame']),
			JSON.stringify(m.activeScreenIds),
		);
		assert('the set change was notified once', setChanges.length === 1);
		// A DIFFERENT book event doesn't fire this edge.
		const took2 = await m.onBookEvent({ type: 'reveal' });
		assert('an unrelated book event fires nothing', !took2);
	}

	// --- C. Round-trip (the bake/save contract) ---
	console.log('\nC. normalize round-trips the pin-sourced edge; drops an empty-event edge:');
	{
		const authored: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }, { id: 'freeGame' }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'freeGame',
					trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
					fromPin: 'basegame::complete',
					toPin: 'freeGame::bookEvent:freeSpinTrigger',
				},
			],
		};
		const once = normalizeFlowDoc(authored);
		const twice = normalizeFlowDoc(JSON.parse(JSON.stringify(once)));
		assert(
			'the pin handles + event survive normalize',
			once.transitions[0].fromPin === 'basegame::complete' &&
				once.transitions[0].toPin === 'freeGame::bookEvent:freeSpinTrigger' &&
				eq(once.transitions[0].trigger, { kind: 'bookEvent', event: 'freeSpinTrigger' }),
			JSON.stringify(once.transitions[0]),
		);
		assert('normalize is idempotent for the pin-sourced edge', eq(once, twice));

		// A freshly-drawn bookEvent edge with an EMPTY event is PRESERVED (the author names it after
		// drawing; dropping it would lose an in-progress edge). It just never FIRES (see below), so it
		// is parity-safe. This matches today's `+page.svelte` onConnect legacy path (`event: ''`).
		const empty = normalizeFlowDoc({
			version: 1,
			screens: [{ id: 'a', initial: true }],
			transitions: [{ id: 't', from: 'a', to: 'a', trigger: { kind: 'bookEvent', event: '' } }],
		});
		assert(
			'a freshly-drawn bookEvent edge with an empty event is PRESERVED (named after drawing)',
			empty.transitions.length === 1 &&
				eq(empty.transitions[0].trigger, { kind: 'bookEvent', event: '' }),
			JSON.stringify(empty.transitions),
		);
		// …and it never FIRES until named (onBookEvent won't match an empty event type).
		const emptyM = createPresentationMachine(
			{
				version: 1,
				screens: [{ id: 'a', initial: true }, { id: 'b' }],
				transitions: [{ id: 't', from: 'a', to: 'b', trigger: { kind: 'bookEvent', event: '' } }],
			},
			{ runtime: makeRuntime() },
		);
		const emptyTook = await emptyM.onBookEvent({ type: 'freeSpinTrigger' });
		assert('an empty-event edge never fires (parity-safe until named)', !emptyTook);
	}

	// --- D. Parity — typed-name edge fires unchanged; validation warns unknown events ---
	console.log('\nD. Parity: a typed-name edge fires unchanged; unknown-event warns (never drops):');
	{
		// Old-style typed-name edge (NO fromPin/toPin) — must fire EXACTLY as before.
		const typedDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }, { id: 'freeGame' }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'freeGame',
					trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
				},
			],
		};
		const m = createPresentationMachine(typedDoc, { runtime: makeRuntime() });
		const took = await m.onBookEvent({ type: 'freeSpinTrigger' });
		assert(
			'a typed-name bookEvent edge (no pins) fires the SAME (parity)',
			took && eq(m.activeScreenIds, ['basegame', 'freeGame']),
		);

		// Validation: an event OUTSIDE the vocabulary is warned (never dropped).
		const unknownDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }, { id: 'freeGame' }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'freeGame',
					trigger: { kind: 'bookEvent', event: 'notARealEvent' },
					fromPin: 'basegame::complete',
					toPin: 'freeGame::bookEvent:notARealEvent',
				},
			],
		};
		const issues = validateFlowDoc(unknownDoc, {}, { bookEvents });
		const unknown = issues.filter((i) => i.kind === 'unknown-book-event');
		assert(
			'an out-of-vocabulary book event is a warning (not dropped)',
			unknown.length === 1 && unknown[0].screenId === 'freeGame',
			JSON.stringify(issues),
		);
		// The edge is still in the doc (warned, never removed).
		assert(
			'the unknown-event edge is NOT removed from the doc',
			unknownDoc.transitions.length === 1,
		);
		// An in-vocabulary event (pin-drawn) produces no unknown-book-event warning.
		const cleanIssues = validateFlowDoc(typedDoc, {}, { bookEvents });
		assert(
			'an in-vocabulary book event yields no unknown-book-event warning',
			cleanIssues.every((i) => i.kind !== 'unknown-book-event'),
		);
		// No vocabulary supplied ⇒ the check is skipped (no false positives).
		const skipIssues = validateFlowDoc(unknownDoc, {}, {});
		assert(
			'no vocabulary supplied ⇒ the unknown-book-event check is skipped (no false positives)',
			skipIssues.every((i) => i.kind !== 'unknown-book-event'),
		);
	}

	console.log(
		`\n${failed ? 'FS-2 BOOK-EVENT PINS HARNESS: FAILED' : 'FS-2 BOOK-EVENT PINS HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
