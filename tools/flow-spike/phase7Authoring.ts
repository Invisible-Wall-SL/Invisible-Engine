/**
 * Invisible Flow — Phase 7 authoring-UX headless test (design doc §4/§6/§7, §9 row 7).
 *
 *   pnpm --filter flow-spike run phase7
 *
 * Proves, HEADLESSLY, the two PURE editor helpers Phase 7 adds to `engine-flow`:
 *
 *  1. `validateFlowDoc` — the validation pass: unreachable screens, dead-ends,
 *     no-initial / multiple-initial, and the orphaned-pin fold-in (§4/§6). These are
 *     WARNINGS surfaced in the UI, never a runtime gate (§7).
 *  2. `diffFlowDoc` — the authored-vs-coded diff: which screens/events the FlowDoc
 *     drives (interpreter) vs which fall through to the coded default (§7).
 *
 * Plus the copy/paste invariant: a "pasted" subgraph (fresh transition ids, choreography
 * carried over) round-trips canonical through `normalizeFlowDoc` (the save/bake contract),
 * so copy/paste never produces an un-shippable doc.
 */

import {
	diffFlowDoc,
	normalizeFlowDoc,
	validateFlowDoc,
	type FlowDoc,
	type FlowIssue,
	type OrphanSummary,
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
const hasKind = (issues: FlowIssue[], kind: string, screenId?: string): boolean =>
	issues.some((i) => i.kind === kind && (screenId === undefined || i.screenId === screenId));

// ---------------------------------------------------------------------------
// 1. Validation — a graph exercising every issue class.
// ---------------------------------------------------------------------------

console.log('\n[1] validateFlowDoc — graph structure + orphan fold-in');

// A clean linear flow: A(initial) → B → C, C is terminal (allowed: it has an inbound path
// and is the graph's leaf; a leaf screen with no outgoing edge is a dead-end UNLESS it is
// reachable AND intentional — the validator flags any non-initial screen with no outgoing
// edge as a dead-end, so C IS flagged; that's the honest warning the author resolves).
const linear: FlowDoc = {
	version: 1,
	screens: [
		{ id: 'A', label: 'A', initial: true },
		{ id: 'B', label: 'B' },
		{ id: 'C', label: 'C' },
	],
	transitions: [
		{ id: 't1', from: 'A', to: 'B', trigger: { kind: 'complete' } },
		{ id: 't2', from: 'B', to: 'C', trigger: { kind: 'complete' } },
	],
};
const linearIssues = validateFlowDoc(linear);
assert(!hasKind(linearIssues, 'unreachable'), 'linear: no unreachable screens');
assert(hasKind(linearIssues, 'dead-end', 'C'), 'linear: leaf C flagged dead-end');
assert(!hasKind(linearIssues, 'dead-end', 'A'), 'linear: A is not a dead-end (has outgoing)');
assert(!hasKind(linearIssues, 'no-initial'), 'linear: initial present');

// Unreachable: D has no inbound path from the initial A.
const withUnreachable: FlowDoc = {
	version: 1,
	screens: [
		{ id: 'A', label: 'A', initial: true },
		{ id: 'B', label: 'B' },
		{ id: 'D', label: 'D (island)' },
	],
	transitions: [{ id: 't1', from: 'A', to: 'B', trigger: { kind: 'complete' } }],
};
const unreachIssues = validateFlowDoc(withUnreachable);
assert(hasKind(unreachIssues, 'unreachable', 'D'), 'unreachable: island D flagged');
assert(!hasKind(unreachIssues, 'unreachable', 'B'), 'unreachable: reachable B not flagged');

// No initial.
const noInitial: FlowDoc = {
	version: 1,
	screens: [{ id: 'A', label: 'A' }],
	transitions: [],
};
assert(hasKind(validateFlowDoc(noInitial), 'no-initial'), 'no-initial: flagged');

// Multiple initial.
const multiInitial: FlowDoc = {
	version: 1,
	screens: [
		{ id: 'A', label: 'A', initial: true },
		{ id: 'B', label: 'B', initial: true },
	],
	transitions: [{ id: 't1', from: 'A', to: 'B', trigger: { kind: 'complete' } }],
};
assert(hasKind(validateFlowDoc(multiInitial), 'multiple-initial'), 'multiple-initial: flagged');

// Single-screen flow (apps/lines basegame) — terminal-by-design, NOT a dead-end.
const single: FlowDoc = {
	version: 1,
	screens: [{ id: 'basegame', label: 'Base Game', initial: true }],
	transitions: [],
};
const singleIssues = validateFlowDoc(single);
assert(!hasKind(singleIssues, 'dead-end'), 'single-screen flow: not flagged dead-end');
assert(singleIssues.length === 0, 'single-screen flow: clean (no issues)');

// Orphaned pins folded in from the caller's per-screen summary.
const orphans: OrphanSummary = { A: 2 };
const orphanIssues = validateFlowDoc(single, { basegame: 0 });
assert(orphanIssues.length === 0, 'orphan fold-in: zero orphans ⇒ no orphan issue');
const orphanIssues2 = validateFlowDoc(linear, orphans);
assert(hasKind(orphanIssues2, 'orphaned-pins', 'A'), 'orphan fold-in: A flagged with 2 orphans');
assert(
	orphanIssues2.find((i) => i.kind === 'orphaned-pins')?.count === 2,
	'orphan fold-in: count carried through',
);

// Every node-scoped issue carries a clickable screenId.
const allScoped = unreachIssues
	.filter((i) => i.kind !== 'no-initial' && i.kind !== 'multiple-initial')
	.every((i) => typeof i.screenId === 'string');
assert(allScoped, 'every node-scoped issue carries a screenId (clickable to focus)');

// ---------------------------------------------------------------------------
// 2. Diff — authored vs coded.
// ---------------------------------------------------------------------------

console.log('\n[2] diffFlowDoc — authored vs coded default (§7)');

const partial: FlowDoc = {
	version: 1,
	screens: [
		{
			id: 'basegame',
			label: 'Base Game',
			initial: true,
			choreography: { enter: { kind: 'sequence', children: [] } },
		},
		{ id: 'intro', label: 'Intro' }, // no choreography ⇒ falls through
	],
	transitions: [],
	events: [
		{ event: 'winInfo', choreography: { kind: 'sequence', children: [] } },
		{ event: 'reveal', choreography: { kind: 'sequence', children: [] } },
	],
};
const coded = ['reveal', 'winInfo', 'setWin', 'setTotalWin', 'finalWin'];
const diff = diffFlowDoc(partial, coded);
assert(diff.authoredScreenCount === 1, 'diff: 1 screen authored (basegame)');
assert(diff.codedScreenCount === 1, 'diff: 1 screen coded (intro)');
assert(
	diff.screens.find((s) => s.screenId === 'basegame')?.phases.enter === true,
	'diff: basegame enter phase flagged authored',
);
assert(
	diff.screens.find((s) => s.screenId === 'intro')?.authored === false,
	'diff: intro shows coded',
);
assert(diff.authoredEventCount === 2, 'diff: 2 events authored (winInfo, reveal)');
assert(diff.codedEventCount === coded.length - 2, 'diff: remaining coded events counted');
assert(
	diff.events.find((e) => e.event === 'finalWin')?.authored === false,
	'diff: finalWin shows coded (un-authored)',
);
assert(diff.summary.includes('authored'), 'diff: summary line built');

// ---------------------------------------------------------------------------
// 3. Copy/paste invariant — a pasted subgraph round-trips canonical (bake-safe).
// ---------------------------------------------------------------------------

console.log('\n[3] copy/paste — pasted subgraph round-trips through normalizeFlowDoc');

// A "pasted" doc: the original screen + a paste of it onto a new scene id, with FRESH
// transition ids (the §12 discipline the launcher's pasteScreens enforces). It must
// survive the save/bake serialize contract idempotently.
const pasted: FlowDoc = {
	version: 1,
	projectKey: 'demo',
	screens: [
		{
			id: 'sceneA',
			label: 'A',
			initial: true,
			position: { x: 0, y: 0 },
			choreography: { enter: { kind: 'broadcast', event: 'boardShow' } },
		},
		{
			// Pasted copy: a DIFFERENT backing scene id, choreography carried over.
			id: 'sceneB',
			label: 'A',
			position: { x: 40, y: 40 },
			choreography: { enter: { kind: 'broadcast', event: 'boardShow' } },
		},
	],
	transitions: [
		{ id: 't_fresh_1', from: 'sceneA', to: 'sceneB', trigger: { kind: 'complete' } },
	],
};
const norm1 = normalizeFlowDoc(pasted);
const norm2 = normalizeFlowDoc(JSON.parse(JSON.stringify(norm1)));
assert(eq(norm1, norm2), 'pasted doc: normalizeFlowDoc idempotent (round-trips)');
assert(norm1.screens.length === 2, 'pasted doc: both screens preserved');
assert(
	norm1.transitions[0].id === 't_fresh_1' && norm1.transitions[0].from === 'sceneA',
	'pasted doc: fresh transition id + remapped endpoints preserved',
);
assert(
	eq(norm1.screens[1].choreography, pasted.screens[1].choreography),
	'pasted doc: carried-over choreography preserved on the pasted screen',
);
// Fresh-id discipline: the pasted screen + transition ids are distinct from the source.
const ids = [
	...norm1.screens.map((s) => s.id),
	...norm1.transitions.map((t) => t.id),
];
assert(new Set(ids).size === ids.length, 'pasted doc: all screen + transition ids unique (no recycling)');

// ---------------------------------------------------------------------------

console.log(
	`\n${failures === 0 ? 'PHASE 7 AUTHORING: PASSED' : `FAILED — ${failures} assertion(s)`}`,
);
process.exit(failures === 0 ? 0 : 1);
