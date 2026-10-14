// The flow the `held` variant of `scripts/win-parity/run.mjs` serves: the committed reference flow
// (`?flowV2=lines` boots this same doc) with `holdToSpeedUp: true` authored on its `winUpdate` action,
// the way a project enables hold-to-fast-forward on the win count-up. No reference game authors it,
// so the gate has to: without it `WinGate.speedScale` stays 1 on both sides and a held Space would
// prove nothing about the coded ramp vs the authored play rate.
//
//   pnpm --filter launcher-api exec tsx ../../scripts/win-parity/flow-variant.ts <out.json>
//
// Writes `{ flowV2, flowV2Library }` — the two bundle fields `bakedFlowV2Doc()` / `bakedFlowV2Library()`
// read — for the parity script to merge into the served snapshot's `runtime.json`. Run through tsx
// (the reference modules import `soundEnums.generated`, which the root ts-loader does not resolve).

import { writeFileSync } from 'node:fs';

import { boolLit } from '../../packages/engine-flow-v2/src/reference/bookOfChoreo';
import {
	BOOK_OF_DRIVEN_SEED_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
} from '../../packages/engine-flow-v2/src/reference/drivenSeed';

const out = process.argv[2];
if (!out) {
	console.error('usage: flow-variant.ts <out.json>');
	process.exit(2);
}

const doc = structuredClone(BOOK_OF_DRIVEN_SEED_DOC);
const winUpdates = doc.graph.nodes.filter((n) => n.kind === 'action' && n.ref === 'winUpdate');
if (winUpdates.length !== 1)
	throw new Error(
		`expected one winUpdate action in the reference flow, found ${winUpdates.length}`,
	);
for (const node of winUpdates) node.inputs = { ...node.inputs, holdToSpeedUp: boolLit(true) };

writeFileSync(out, JSON.stringify({ flowV2: doc, flowV2Library: BOOK_OF_DRIVEN_SEED_LIBRARY }));
console.log(`flow variant → ${out} (holdToSpeedUp on ${winUpdates.length} winUpdate action)`);
