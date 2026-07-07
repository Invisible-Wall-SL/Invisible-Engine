/**
 * Invisible Flow v1→v2 — Phase B.3: translate the Book of Borut REMAKE's REAL flow.json and report.
 *
 *   node ...fetch remake flow.json → scratchpad/remake-flow-v1.json..., then:
 *   pnpm --filter flow-spike run v2translateremake
 *
 * Runs the B.1/B.2 translator on the remake's actual authored v1 flow (11 screens, 29 transitions) →
 * a v2 FlowDoc, and prints the shape + any validation ERRORS/warnings — so we see exactly how the
 * real flow converts before it goes anywhere near production. Read-only (no R2 write).
 */

import { readFileSync } from 'node:fs';
import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	validateFlowDoc,
	BOOK_OF_VOCAB,
	type FlowV2Effect,
	type RunContext,
} from 'engine-flow-v2';
import type { FlowDoc as FlowDocV1 } from 'engine-flow';
import { translateFlowDoc } from 'engine-flow-migrate';

const PATH =
	'C:/Users/gualt/AppData/Local/Temp/claude/C--Invisible-Wall-SL-Engine-Invisible-Engine/70b6762b-6678-446d-9d95-3018c93811d7/scratchpad/remake-flow-v1.json';

const v1 = JSON.parse(readFileSync(PATH, 'utf8')) as FlowDocV1;
console.log(
	`v1: ${v1.screens.length} screens, ${v1.transitions.length} transitions, ${(v1.events ?? []).length} event choreographies\n`,
);

const v2 = translateFlowDoc(v1, BOOK_OF_VOCAB);

const kinds: Record<string, number> = {};
for (const n of v2.graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
const events = v2.graph.nodes
	.filter((n) => n.kind === 'event')
	.map((n) => (n as { ref: string }).ref);

console.log(
	`v2: ${v2.graph.nodes.length} nodes, ${v2.graph.exec.length} exec edges, ${v2.containers.length} containers`,
);
console.log('  node kinds:', JSON.stringify(kinds));
console.log('  containers:', v2.containers.map((c) => `${c.id}@${c.z}`).join(', '));
console.log('  events:', events.join(', '));

const issues = validateFlowDoc(v2, BOOK_OF_VOCAB, { version: 2, functions: [] });
const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

console.log(`\nvalidation: ${errors.length} ERRORS, ${warnings.length} warnings`);
if (errors.length) {
	console.error('  ERRORS:');
	for (const e of errors) console.error(`    ${e.code}: ${e.message}`);
}
if (warnings.length) {
	const byCode: Record<string, number> = {};
	for (const w of warnings) byCode[w.code] = (byCode[w.code] ?? 0) + 1;
	console.log('  warnings by code:', JSON.stringify(byCode));
	console.log(
		'  (unknown-event warnings are EXPECTED — synthetic `complete:<screen>` events are the open input boundary)',
	);
}

// Replay the GAME-SIDE holder logic against the REAL translated flow: `dispatchFlowV2Event(name)` for
// lifecycle/book events + `dispatchFlowV2Complete()`, which mirrors v1's `fireComplete` — scan the
// SHOWN containers top-of-stack first and dispatch the FIRST whose complete event the flow owns (NOT
// the literal topmost: persistent HUDs sit above the game screens by z but own no `complete`).
let softFail = false;
const check = (label: string, ok: boolean, detail?: string) => {
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) softFail = true;
};

const mount = createContainerMountModel(v2.containers, () => {});
const noop: FlowV2Effect = () => {};
const env = createFlowV2Env({
	mount,
	effect: () => noop, // invoke-intent actions are no-ops here — we only assert screen swaps
	broadcast: () => {},
	waitForTimeout: () => Promise.resolve(),
	timeScale: () => 1,
	engineRead: () => undefined,
});
const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: { version: 2, functions: [] }, env };
const owns = (name: string) =>
	v2.graph.nodes.some((n) => n.kind === 'event' && (n as { ref: string }).ref === name);
const shownIds = () => mount.ordered().map((c) => c.id);

// `dispatchFlowV2Event`: run the event iff the flow owns it (ownership-gated), else no-op.
const dispatchEvent = async (name: string) => {
	if (!owns(name)) return false;
	await runFlowEvent(v2, ctx, name, {});
	return true;
};
// `dispatchFlowV2Complete`: scan shown containers top-down for the first OWNED `complete:<id>`.
const dispatchComplete = async () => {
	const shown = mount.ordered();
	for (let i = shown.length - 1; i >= 0; i--) {
		if (await dispatchEvent(`complete:${shown[i].id}`)) return shown[i].id;
	}
	return undefined;
};

console.log('\ngame-side holder-logic replay on the REAL translated flow:');

// 1. boot: `load` shows the initial screen; taps complete it up the lifecycle to the game.
await dispatchEvent('load');
check(
	'load → shows the initial splash s_q9iw9aqf',
	shownIds().join(',') === 's_q9iw9aqf',
	shownIds().join(','),
);

const c1 = await dispatchComplete();
check(
	'tap completes the splash → loading',
	c1 === 's_q9iw9aqf' && shownIds().join(',') === 'loading',
	`${c1}: ${shownIds().join(',')}`,
);

const c2 = await dispatchComplete();
const afterLoading = shownIds();
check(
	'tap completes loading → the game fans out (basegame + HUD layers)',
	c2 === 'loading' && afterLoading.includes('basegame') && afterLoading.includes('hudBar'),
	afterLoading.join(','),
);

// 2. the SCAN fix: enter free spins (a book event LAYERS freeSpinIntro over the still-shown basegame,
//    UNDER the higher-z HUDs), then a tap must complete the INTRO, not the HUD sitting on top of it.
await dispatchEvent('freeSpinTrigger');
const duringIntro = shownIds();
check(
	'freeSpinTrigger LAYERS freeSpinIntro (basegame stays shown underneath)',
	duringIntro.includes('freeSpinIntro') && duringIntro.includes('basegame'),
	duringIntro.join(','),
);
const literalTop = duringIntro.at(-1);
check(
	'the literal-top container is a HUD (owns NO complete) — the old `.at(-1)` logic would MISS',
	literalTop !== 'freeSpinIntro' && !owns(`complete:${literalTop}`),
	`literal top = ${literalTop}`,
);
const c3 = await dispatchComplete();
check(
	'the scan completes freeSpinIntro (the game screen under the HUDs), not the HUD',
	c3 === 'freeSpinIntro',
	`completed ${c3}`,
);
check(
	'completing the intro shows specialBook, basegame still shown',
	shownIds().includes('specialBook') && shownIds().includes('basegame'),
	shownIds().join(','),
);

console.log(
	errors.length === 0 ? '\nREMAKE FLOW TRANSLATES with 0 ERRORS ✓' : '\nREMAKE FLOW HAS ERRORS ✗',
);
console.log(
	!softFail
		? 'GAME-SIDE holder logic DRIVES the real lifecycle (boot + scan-based complete) ✓'
		: 'GAME-SIDE holder replay had failures ✗',
);
process.exit(errors.length === 0 && !softFail ? 0 : 1);
