/**
 * Invisible Flow v2 — HALF-ON SCREEN-DRIVING GUARD harness.
 *
 *   pnpm --filter flow-spike run v2halfon
 *
 * Proves, HEADLESSLY over the REAL `engine-flow-v2` modules, the safety net that stops a "half-on"
 * flow from silently hiding the game (the confirmed Test1 missing-reel bug):
 *
 *   A flow with `showContainer`/`hideContainer` nodes (author INTENDS to drive screens) but that
 *   does NOT own `load` cannot actually mount those screens — `flowV2DrivesScreens` is false — while
 *   its ownership of screen-lifecycle signals (`tapToStart`) still SUPPRESSES the coded loading →
 *   basegame path. Net: basegame/reel never mounts.
 *
 * Assertions:
 *   1. `flowScreenDrivingStatus` classifies four real shapes correctly:
 *      - the seeded book-events-only reference (`BOOK_OF_REFERENCE_DOC`) — NOT half-on (no container
 *        nodes), even though it WIRES `tapToStart` for audio (the false-positive control);
 *      - a half-on doc (gameSignals `tapToStart` → `showContainer(basegame)`, no `load`) — half-on;
 *      - a driven doc via a wired gameSignals `load` pin — drives screens, NOT half-on;
 *      - a driven doc via a `load` event node — drives screens, NOT half-on.
 *   2. `SCREEN_LIFECYCLE_SIGNALS` holds `load` + `tapToStart` and NOT a book event (`reveal`).
 *   3. The runtime's guarded `ownsEvent` predicate (replicated verbatim) reports a half-on flow's
 *      `tapToStart` as UN-owned (so the coded path runs) while KEEPING its book-event ownership —
 *      and a NON-half-on flow keeps `tapToStart` owned (the guard never over-reaches).
 *
 * Prints PASS/FAIL per assertion + a final `V2 HALF-ON GUARD HARNESS: PASSED`.
 */

import {
	BOOK_OF_REFERENCE_DOC,
	SCREEN_LIFECYCLE_SIGNALS,
	flowOwnsSignal,
	flowScreenDrivingStatus,
	type DataEdge,
	type ExecEdge,
	type FlowDoc,
	type Node,
} from 'engine-flow-v2';

let failures = 0;
const check = (label: string, cond: boolean): void => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
	if (!cond) failures += 1;
};

/** Build a minimal `book-of` FlowDoc from raw nodes/edges (bypasses the choreo builder — we only
 *  need the graph shapes the classifier reads). */
const makeDoc = (nodes: Node[], exec: ExecEdge[] = [], data: DataEdge[] = []): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
});

// The runtime's guarded ownership predicate — replicated VERBATIM from flowV2Runtime.svelte.ts so
// this harness pins the exact behaviour the game runs (the game module itself needs Svelte/game
// primitives that don't load headlessly).
const ownedEventsOf = (doc: FlowDoc): Set<string> =>
	new Set(doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => (n as { ref: string }).ref));
const ownsEventGuarded = (doc: FlowDoc, eventType: string): boolean => {
	const halfOn = flowScreenDrivingStatus(doc).halfOn;
	if (halfOn && SCREEN_LIFECYCLE_SIGNALS.has(eventType)) return false;
	return ownedEventsOf(doc).has(eventType) || flowOwnsSignal(doc, eventType);
};

// --- Fixtures ---------------------------------------------------------------

// A gameSignals node + a wire from `pin` into a `showContainer(basegame)` — the half-on shape when
// `pin` is a screen signal and `load` is NOT wired.
const signalsToShow = (pin: string): FlowDoc =>
	makeDoc(
		[
			{ id: 'sig', kind: 'gameSignals', pos: { x: 0, y: 0 } },
			{ id: 'showBase', kind: 'showContainer', pos: { x: 200, y: 0 }, ref: 'basegame' },
		],
		[{ from: { node: 'sig', pin }, to: { node: 'showBase', pin: 'exec' } }],
	);

const halfOnDoc = signalsToShow('tapToStart'); // owns tapToStart + has showContainer, NOT load.
const drivenBySignal = signalsToShow('load'); // owns load via gameSignals → drives screens.
const drivenByEvent = makeDoc(
	[
		{ id: 'onLoad', kind: 'event', pos: { x: 0, y: 0 }, ref: 'load' },
		{ id: 'showBase', kind: 'showContainer', pos: { x: 200, y: 0 }, ref: 'basegame' },
	],
	[{ from: { node: 'onLoad', pin: 'exec' }, to: { node: 'showBase', pin: 'exec' } }],
);

// --- 1. Classification ------------------------------------------------------

const ref = flowScreenDrivingStatus(BOOK_OF_REFERENCE_DOC);
check('reference seed: NOT half-on (no container nodes)', ref.halfOn === false);
check('reference seed: does NOT drive screens (book-events only)', ref.drivesScreens === false);
check('reference seed: has NO container nodes', ref.hasContainerNodes === false);
// The reference DOES wire tapToStart (audio) — the crucial false-positive control: wiring a
// screen-lifecycle signal WITHOUT a container node must never be flagged half-on.
check(
	'reference seed: wires tapToStart (audio) yet stays NOT half-on',
	flowOwnsSignal(BOOK_OF_REFERENCE_DOC, 'tapToStart') === true && ref.halfOn === false,
);

const half = flowScreenDrivingStatus(halfOnDoc);
check('half-on doc: IS half-on', half.halfOn === true);
check('half-on doc: does NOT drive screens', half.drivesScreens === false);
check('half-on doc: HAS container nodes', half.hasContainerNodes === true);

const bySignal = flowScreenDrivingStatus(drivenBySignal);
check('driven-by-signal: drives screens', bySignal.drivesScreens === true);
check('driven-by-signal: NOT half-on', bySignal.halfOn === false);

const byEvent = flowScreenDrivingStatus(drivenByEvent);
check('driven-by-event: drives screens', byEvent.drivesScreens === true);
check('driven-by-event: NOT half-on', byEvent.halfOn === false);

// --- 2. The signal set ------------------------------------------------------

check('SCREEN_LIFECYCLE_SIGNALS has load', SCREEN_LIFECYCLE_SIGNALS.has('load'));
check('SCREEN_LIFECYCLE_SIGNALS has tapToStart', SCREEN_LIFECYCLE_SIGNALS.has('tapToStart'));
check(
	'SCREEN_LIFECYCLE_SIGNALS excludes a book event (reveal)',
	!SCREEN_LIFECYCLE_SIGNALS.has('reveal'),
);

// --- 3. Guarded ownsEvent ---------------------------------------------------

// The half-on doc raw-owns tapToStart (a wired gameSignals pin) — the guard is what flips it.
check(
	'CONTROL: half-on doc RAW-owns tapToStart (guard is the only thing flipping it)',
	flowOwnsSignal(halfOnDoc, 'tapToStart') === true,
);
check(
	'guarded: half-on flow does NOT own tapToStart (coded path runs → reel mounts)',
	ownsEventGuarded(halfOnDoc, 'tapToStart') === false,
);
check('guarded: half-on flow does NOT own load', ownsEventGuarded(halfOnDoc, 'load') === false);

// Book-event ownership must survive the guard: add a reveal event node to the half-on doc.
const halfOnWithReveal = makeDoc(
	[
		...halfOnDoc.graph.nodes,
		{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 200 }, ref: 'reveal' },
	],
	halfOnDoc.graph.exec,
);
check(
	'guarded: half-on flow STILL owns its book event (reveal)',
	ownsEventGuarded(halfOnWithReveal, 'reveal') === true,
);

// The reference (NOT half-on) keeps tapToStart owned — the guard never over-reaches.
check(
	'guarded: non-half-on reference KEEPS tapToStart owned (no over-reach)',
	ownsEventGuarded(BOOK_OF_REFERENCE_DOC, 'tapToStart') === true,
);

// A fully-driven flow keeps load owned (guard inert).
check('guarded: driven flow KEEPS load owned', ownsEventGuarded(drivenBySignal, 'load') === true);

console.log('');
if (failures === 0) console.log('V2 HALF-ON GUARD HARNESS: PASSED');
else {
	console.log(`V2 HALF-ON GUARD HARNESS: FAILED (${failures} assertion(s))`);
	process.exit(1);
}
