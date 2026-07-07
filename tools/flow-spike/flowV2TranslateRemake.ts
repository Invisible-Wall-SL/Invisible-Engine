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
import { validateFlowDoc, BOOK_OF_VOCAB } from 'engine-flow-v2';
import type { FlowDoc as FlowDocV1 } from 'engine-flow';
import { translateFlowDoc } from './flowV2Translate';

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

console.log(
	errors.length === 0 ? '\nREMAKE FLOW TRANSLATES with 0 ERRORS ✓' : '\nREMAKE FLOW HAS ERRORS ✗',
);
process.exit(errors.length === 0 ? 0 : 1);
