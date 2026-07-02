/**
 * Invisible Flow — Phase 2 save→reload round-trip headless test (design doc §7/§12).
 *
 *   pnpm --filter flow-spike run roundtrip
 *
 * Proves, HEADLESSLY (no R2, no browser), the serialize/deserialize contract the
 * `/api/flow/save` endpoint relies on: a hand-authored FlowDoc — the macro graph with
 * every transition shape (bookEvent / complete / condition), a guard, a delay, an author
 * order, AND a per-screen choreography sub-graph — survives the exact path the save
 * endpoint takes:
 *
 *   author → JSON.stringify (what the page POSTs) → normalizeFlowDoc (what the endpoint
 *   stores) → JSON round-trip (what R2 returns) → normalizeFlowDoc (what the loader
 *   returns) → IDENTICAL document.
 *
 * It also proves `normalizeFlowDoc` is idempotent (a stored doc re-normalizes to itself),
 * drops junk fields without corrupting valid data, and that an absent doc normalizes to a
 * sparse no-transitions doc (the parity-safe fall-through, §7).
 */

import {
	FIXED_PREVIEW_CONTEXT,
	FIXED_PREVIEW_ENGINE,
	FIXED_PREVIEW_TRIGGER,
	previewChoreography,
	type ChoreographyNode,
	type FlowDoc,
	type PreviewEntry,
	normalizeFlowDoc,
} from 'engine-flow';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// A representative authored FlowDoc — every macro feature Phase 2 can author.
// ---------------------------------------------------------------------------

// A non-trivial authored choreography exercising EVERY executor node kind (design doc
// §9.A): sequence/parallel/delay, broadcast in all THREE shapes (sync / awaited / fire-
// and-forget), branch (with a guard + else), and forEach (over a $trigger list, with an
// $item payload read). This is the Phase-3 micro-authoring round-trip subject.
const winInfoEnter: ChoreographyNode = {
	kind: 'sequence',
	children: [
		// Phase-8 salvage: an `effect` node with a `$context.*` payload accessor — the two new
		// authorable kinds (the effect node landed via #63; `$context` is this slice).
		// `revealBoard` reads the surrounding book list off the dispatch context, exactly as a
		// reveal's multiple-reveal check would.
		{
			kind: 'effect',
			name: 'revealBoard',
			payload: {
				bookEvent: { kind: 'trigger', path: '' },
				bookEvents: { kind: 'context', path: 'bookEvents' },
			},
		},
		{
			kind: 'broadcast',
			event: 'soundOnce',
			payload: { name: { kind: 'literal', value: 'sfx_win' } },
		},
		{
			kind: 'parallel',
			children: [
				{ kind: 'broadcast', event: 'boardShow' },
				{ kind: 'broadcast', event: 'uiHide', async: true, await: false },
			],
		},
		{ kind: 'delay', ms: 300 },
		{
			kind: 'forEach',
			list: { kind: 'trigger', path: 'wins' },
			mode: 'sequence',
			body: {
				kind: 'broadcast',
				event: 'boardWithAnimateSymbols',
				async: true,
				await: true,
				payload: { symbolPositions: { kind: 'item', path: 'positions' } },
			},
		},
		{
			kind: 'branch',
			guard: {
				all: [
					{
						left: { kind: 'engine', key: 'winLevel' },
						op: 'gte',
						right: { kind: 'literal', value: 3 },
					},
				],
			},
			then: { kind: 'broadcast', event: 'winShow' },
			otherwise: { kind: 'broadcast', event: 'winHide' },
		},
	],
};

const authored: FlowDoc = {
	version: 1,
	projectKey: 'bookofborut',
	screens: [
		{
			id: 'baseGame',
			label: 'Base Game',
			position: { x: 80, y: 80 },
			initial: true,
			choreography: {
				enter: winInfoEnter,
				exit: { kind: 'sequence', children: [{ kind: 'broadcast', event: 'boardHide' }] },
			},
		},
		{
			id: 'freeSpinsIntro',
			label: 'Free Spins Intro',
			position: { x: 480, y: 80 },
		},
	],
	transitions: [
		{
			id: 't_book',
			from: 'baseGame',
			to: 'freeSpinsIntro',
			trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
			delayMs: 250,
			order: 0,
			guard: {
				all: [
					{
						left: { kind: 'engine', key: 'winLevel' },
						op: 'gte',
						right: { kind: 'literal', value: 3 },
					},
				],
			},
		},
		{
			id: 't_complete',
			from: 'freeSpinsIntro',
			to: 'baseGame',
			trigger: { kind: 'complete' },
			order: 0,
		},
		{
			id: 't_condition',
			from: 'baseGame',
			to: 'baseGame',
			trigger: { kind: 'condition' },
			order: 1,
		},
	],
	events: [
		{
			event: 'setTotalWin',
			choreography: { kind: 'broadcast', event: 'updateTotalWin' },
		},
	],
};

// ---------------------------------------------------------------------------
// 1. The full save → reload path is a fixed point on a valid authored doc.
// ---------------------------------------------------------------------------

console.log('round-trip — save→reload identity');

// What the endpoint stores (it stamps updatedAt, which we compare separately).
const stored = normalizeFlowDoc(JSON.parse(JSON.stringify(authored)), 'bookofborut');
// What the loader returns after R2 hands the JSON back.
const reloaded = normalizeFlowDoc(JSON.parse(JSON.stringify(stored)), 'bookofborut');

// The canonical form of the authored doc — what the editor's doc normalizes to. The
// round-trip contract is that the CANONICAL form is a fixed point (key order is
// canonicalized by normalize, so compare against the canonical doc, not raw key order).
const canonical = normalizeFlowDoc(authored, 'bookofborut');

assert(eq(stored, reloaded), 'stored doc reloads byte-identical (normalize ∘ JSON round-trip)');
assert(
	eq(stored.screens, canonical.screens),
	'screens (positions, initial, choreography) preserved',
);
assert(
	eq(stored.transitions, canonical.transitions),
	'transitions (trigger/guard/delay/order) preserved',
);
assert(eq(stored.events, canonical.events), 'per-event choreography preserved');
// Nothing authored is lost: every screen/transition/event id survives normalization.
assert(
	eq(authored.screens.map((s) => s.id).sort(), stored.screens.map((s) => s.id).sort()),
	'no screen dropped by normalization',
);
assert(
	eq(authored.transitions.map((t) => t.id).sort(), stored.transitions.map((t) => t.id).sort()),
	'no transition dropped by normalization',
);
assert(stored.projectKey === 'bookofborut', 'projectKey stamped');

// ---------------------------------------------------------------------------
// 2. Idempotence — re-normalizing a stored doc yields the same doc.
// ---------------------------------------------------------------------------

console.log('round-trip — idempotence');
assert(eq(normalizeFlowDoc(stored), stored), 'normalizeFlowDoc is idempotent');

// ---------------------------------------------------------------------------
// 3. Junk fields are dropped without corrupting valid data.
// ---------------------------------------------------------------------------

console.log('round-trip — junk rejection');
const dirty = {
	version: 99,
	projectKey: 'p',
	rogue: 'should vanish',
	screens: [
		{ id: 'ok', label: 'OK', extra: 'drop me' },
		{ label: 'no id — dropped' },
		'not even an object',
	],
	transitions: [
		{ id: 't', from: 'ok', to: 'ok', trigger: { kind: 'bookEvent', event: 'e' }, junk: 1 },
		{ id: 'bad', from: 'ok', to: 'ok', trigger: { kind: 'mystery' } },
		{ id: 'missingTo', from: 'ok', trigger: { kind: 'complete' } },
	],
};
const cleaned = normalizeFlowDoc(dirty, 'p');
assert(cleaned.version === 1, 'version forced to 1');
assert(!('rogue' in cleaned), 'rogue top-level field dropped');
assert(cleaned.screens.length === 1 && cleaned.screens[0].id === 'ok', 'invalid screens dropped');
assert(!('extra' in cleaned.screens[0]), 'unknown screen field dropped');
assert(
	cleaned.transitions.length === 1 && cleaned.transitions[0].id === 't',
	'invalid transitions dropped',
);
assert(!('junk' in cleaned.transitions[0]), 'unknown transition field dropped');

// ---------------------------------------------------------------------------
// 4. Absent doc → sparse fall-through doc (parity, §7).
// ---------------------------------------------------------------------------

console.log('round-trip — absent doc');
const empty = normalizeFlowDoc(undefined, 'p');
assert(
	empty.screens.length === 0 && empty.transitions.length === 0,
	'absent doc ⇒ no screens/transitions',
);
assert(empty.events === undefined, 'absent doc has no events (pure fall-through)');

// ---------------------------------------------------------------------------
// 5. Authored choreography survives the round-trip AND drives the executor — every
//    node kind (sequence/parallel/delay/broadcast×3/branch/forEach) is preserved and
//    runs through the REAL executor via the deterministic preview (Phase 3, §9.A/§11.6).
// ---------------------------------------------------------------------------

console.log('round-trip — authored choreography (all node kinds)');

// Compare against the CANONICAL form (normalize canonicalizes key order, the same
// discipline the macro round-trip uses above) — content, not raw key order, is the contract.
const canonicalEnter = canonical.screens.find((s) => s.id === 'baseGame')?.choreography?.enter;
const reloadedEnter = reloaded.screens.find((s) => s.id === 'baseGame')?.choreography?.enter;
assert(eq(reloadedEnter, canonicalEnter), 'enter choreography round-trips identical (canonical)');
assert(
	eq(
		reloaded.screens.find((s) => s.id === 'baseGame')?.choreography?.exit,
		canonical.screens.find((s) => s.id === 'baseGame')?.choreography?.exit,
	),
	'exit choreography round-trips identical (canonical)',
);

// The reloaded choreography is what the runtime would execute. Run it through the REAL
// executor (the deterministic preview) and assert the broadcast+delay timeline.
const runPreview = async (): Promise<void> => {
	if (!reloadedEnter) {
		failures++;
		console.error('  ✗ no reloaded enter choreography to preview');
		return;
	}
	const normal = await previewChoreography(reloadedEnter, {
		speed: 1,
		trigger: FIXED_PREVIEW_TRIGGER,
		context: FIXED_PREVIEW_CONTEXT,
		engine: (k) => FIXED_PREVIEW_ENGINE[k],
	});
	const turbo = await previewChoreography(reloadedEnter, {
		speed: 2,
		trigger: FIXED_PREVIEW_TRIGGER,
		context: FIXED_PREVIEW_CONTEXT,
		engine: (k) => FIXED_PREVIEW_ENGINE[k],
	});

	const events = normal.timeline
		.filter((e): e is Extract<typeof e, { kind: 'broadcast' }> => e.kind === 'broadcast')
		.map((e) => e.event);
	// soundOnce, boardShow + uiHide (parallel), forEach×2 wins (boardWithAnimateSymbols),
	// branch then-branch (winLevel 3 ≥ 3 ⇒ winShow). The else (winHide) must NOT appear.
	assert(events[0] === 'soundOnce', 'first broadcast is soundOnce');
	assert(
		events.includes('boardShow') && events.includes('uiHide'),
		'parallel branch broadcasts both ran',
	);
	assert(
		events.filter((e) => e === 'boardWithAnimateSymbols').length === 2,
		'forEach ran once per win item (2 wins ⇒ 2 broadcasts)',
	);
	assert(
		events.includes('winShow') && !events.includes('winHide'),
		'branch took the then-path (winLevel ≥ 3)',
	);

	// Determinism: two runs at the same speed produce identical timelines.
	const normal2 = await previewChoreography(reloadedEnter, {
		speed: 1,
		trigger: FIXED_PREVIEW_TRIGGER,
		context: FIXED_PREVIEW_CONTEXT,
		engine: (k) => FIXED_PREVIEW_ENGINE[k],
	});
	assert(
		eq(normal.timeline, normal2.timeline),
		'preview is deterministic (identical timeline run-to-run)',
	);

	// Speed scalar: the single 300ms delay halves under turbo (÷ timeScale 2 ⇒ 150ms),
	// proving the authored Speed flows into the scalar the executor reads (§9.C).
	const normalDelay = normal.timeline.find((e) => e.kind === 'delay');
	const turboDelay = turbo.timeline.find((e) => e.kind === 'delay');
	assert(
		normalDelay?.kind === 'delay' && normalDelay.scaledMs === 300,
		'delay at 1× is the authored 300ms',
	);
	assert(
		turboDelay?.kind === 'delay' && turboDelay.scaledMs === 150,
		'delay at 2× (turbo) is halved to 150ms',
	);
	assert(
		normal.durationMs === 300 && turbo.durationMs === 150,
		'total virtual duration scales with speed',
	);

	// Phase-8 salvage: the `effect` node + `$context` accessor survive the round-trip AND run
	// through the REAL executor — the effect appears as a labeled `effect` timeline entry (the
	// ChoreoPreview `undefined [undefined]` bug fix), in order, with its `$context.bookEvents`
	// payload accessor RESOLVED against the fixed context feed.
	const effects = normal.timeline.filter(
		(e): e is Extract<PreviewEntry, { kind: 'effect' }> => e.kind === 'effect',
	);
	assert(
		effects.length === 1 && effects[0].name === 'revealBoard',
		'effect node ran (revealBoard)',
	);
	assert(
		eq(effects[0]?.payload?.bookEvents, FIXED_PREVIEW_CONTEXT.bookEvents),
		'$context.bookEvents resolved against the fixed context feed in the effect payload',
	);
	// The effect is the FIRST op (it precedes soundOnce in the authored sequence) — ordering
	// is preserved through round-trip + executor.
	assert(
		normal.timeline[0]?.kind === 'effect',
		'effect is the first timeline op (order preserved)',
	);
};

await runPreview();

// ---------------------------------------------------------------------------
// 6. Value BINDING edges (design doc flow-driven §11.8 step 1) — a `value` trigger
//    survives the save→reload round-trip idempotently, and a PARTIAL value trigger is
//    dropped without corrupting its siblings in the same doc.
// ---------------------------------------------------------------------------

console.log('round-trip — value binding edges (§11)');

// A doc with a VALID value edge (producer `balance` → the HUD balance display's value input)
// alongside an ordinary bookEvent edge, to prove siblings are untouched.
const valueDoc: FlowDoc = {
	version: 1,
	projectKey: 'p',
	screens: [{ id: 'baseGame', initial: true }, { id: 'hud' }],
	transitions: [
		{
			id: 't_value',
			from: 'baseGame',
			to: 'hud',
			trigger: {
				kind: 'value',
				producer: 'balance',
				sink: { instanceId: 'inst_balance', source: 'balance' },
			},
		},
		{
			id: 't_book',
			from: 'baseGame',
			to: 'hud',
			trigger: { kind: 'bookEvent', event: 'setWin' },
		},
	],
};

const valueStored = normalizeFlowDoc(JSON.parse(JSON.stringify(valueDoc)), 'p');
const valueReloaded = normalizeFlowDoc(JSON.parse(JSON.stringify(valueStored)), 'p');
const valueEdge = valueStored.transitions.find((t) => t.id === 't_value');
assert(
	valueEdge?.trigger.kind === 'value' &&
		valueEdge.trigger.producer === 'balance' &&
		valueEdge.trigger.sink.instanceId === 'inst_balance' &&
		valueEdge.trigger.sink.source === 'balance',
	'valid value trigger preserved (producer + sink)',
);
assert(eq(valueStored, valueReloaded), 'value edge round-trips idempotently (normalize ∘ JSON)');
assert(eq(normalizeFlowDoc(valueStored), valueStored), 'value-edge doc is a normalize fixed point');

// PARTIAL value triggers — missing `producer`, or `sink.instanceId`, or `sink.source` — must be
// dropped (the edge is invalid ⇒ no trigger ⇒ transition dropped), WITHOUT touching the valid
// sibling in the same doc. This is the parity discipline (§11.6): a partial edge reverts to
// auto-bind, never a stored half-edge.
const partialDoc = {
	version: 1,
	projectKey: 'p',
	screens: [{ id: 'baseGame' }, { id: 'hud' }],
	transitions: [
		{
			id: 'noProducer',
			from: 'baseGame',
			to: 'hud',
			trigger: { kind: 'value', sink: { instanceId: 'i', source: 's' } },
		},
		{
			id: 'noInstance',
			from: 'baseGame',
			to: 'hud',
			trigger: { kind: 'value', producer: 'balance', sink: { source: 's' } },
		},
		{
			id: 'noSource',
			from: 'baseGame',
			to: 'hud',
			trigger: { kind: 'value', producer: 'balance', sink: { instanceId: 'i' } },
		},
		{
			id: 'noSink',
			from: 'baseGame',
			to: 'hud',
			trigger: { kind: 'value', producer: 'balance' },
		},
		{
			id: 'goodValue',
			from: 'baseGame',
			to: 'hud',
			trigger: {
				kind: 'value',
				producer: 'win',
				sink: { instanceId: 'inst_win', source: 'win' },
			},
		},
	],
};
const partialCleaned = normalizeFlowDoc(partialDoc, 'p');
const survivingIds = partialCleaned.transitions.map((t) => t.id).sort();
assert(
	eq(survivingIds, ['goodValue']),
	'all partial value triggers dropped; the valid sibling survives',
);
const surviving = partialCleaned.transitions.find((t) => t.id === 'goodValue');
assert(
	surviving?.trigger.kind === 'value' &&
		surviving.trigger.producer === 'win' &&
		surviving.trigger.sink.instanceId === 'inst_win' &&
		surviving.trigger.sink.source === 'win',
	'the valid sibling value trigger is preserved intact after partials dropped',
);

console.log('');
if (failures > 0) {
	console.error(`FLOW ROUND-TRIP: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FLOW ROUND-TRIP: PASSED');
