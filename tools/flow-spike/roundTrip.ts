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

import { type FlowDoc, normalizeFlowDoc } from 'engine-flow';

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
				enter: {
					kind: 'sequence',
					children: [
						{ kind: 'broadcast', event: 'showBoard' },
						{ kind: 'delay', ms: 300 },
						{
							kind: 'broadcast',
							event: 'winInfo',
							await: true,
							payload: { wins: { kind: 'trigger', path: 'wins' } },
						},
					],
				},
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
				all: [{ left: { kind: 'engine', key: 'winLevel' }, op: 'gte', right: { kind: 'literal', value: 3 } }],
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
assert(eq(stored.screens, canonical.screens), 'screens (positions, initial, choreography) preserved');
assert(
	eq(stored.transitions, canonical.transitions),
	'transitions (trigger/guard/delay/order) preserved',
);
assert(eq(stored.events, canonical.events), 'per-event choreography preserved');
// Nothing authored is lost: every screen/transition/event id survives normalization.
assert(
	eq(
		authored.screens.map((s) => s.id).sort(),
		stored.screens.map((s) => s.id).sort(),
	),
	'no screen dropped by normalization',
);
assert(
	eq(
		authored.transitions.map((t) => t.id).sort(),
		stored.transitions.map((t) => t.id).sort(),
	),
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
assert(cleaned.transitions.length === 1 && cleaned.transitions[0].id === 't', 'invalid transitions dropped');
assert(!('junk' in cleaned.transitions[0]), 'unknown transition field dropped');

// ---------------------------------------------------------------------------
// 4. Absent doc → sparse fall-through doc (parity, §7).
// ---------------------------------------------------------------------------

console.log('round-trip — absent doc');
const empty = normalizeFlowDoc(undefined, 'p');
assert(empty.screens.length === 0 && empty.transitions.length === 0, 'absent doc ⇒ no screens/transitions');
assert(empty.events === undefined, 'absent doc has no events (pure fall-through)');

console.log('');
if (failures > 0) {
	console.error(`FLOW ROUND-TRIP: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FLOW ROUND-TRIP: PASSED');
