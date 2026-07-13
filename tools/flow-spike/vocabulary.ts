/**
 * Invisible Flow — emitter-vocabulary codegen harness (design doc §3, Phase-7 held follow-up).
 *
 *   pnpm --filter flow-spike run vocab
 *
 * Proves, HEADLESSLY, that the EXPORTED emitter vocabulary replacing the hardcoded
 * `DEFAULT_EMITTER_VOCABULARY` in the `/flow` choreography palette is FAITHFUL to the game's
 * real compile-time vocabulary — an authoring-fidelity step only (it changes which Broadcast
 * events + effect names the picker OFFERS, never the runtime, so there is zero game-parity
 * risk and no submodule bump).
 *
 * Checks:
 *  1. The codegen is IN SYNC with source — `gen-flow-vocabulary.mjs --check` exits 0, i.e. the
 *     committed `apps/lines/src/game/emitterVocabulary.ts` + the launcher registry equal what the
 *     parser re-derives from `typesEmitterEvent.ts` + `flowEffects.ts` (so the fixture cannot
 *     silently drift from the union/effect map the way the hand-written default could).
 *  2. COVERAGE — every Broadcast `event` and every `effect` name the REAL `LINES_FLOW_DOC`
 *     authors is present in `LINES_EMITTER_VOCABULARY` (the picker can offer everything the
 *     shipped flow actually uses).
 *  3. SUPERSET-of-default — the exported vocabulary covers every event the bundled
 *     `DEFAULT_EMITTER_VOCABULARY` lists (it is the real union, never a regression), and adds
 *     at least one the hand-transcribed default missed (proving codegen catches drift).
 *  4. RESOLVER fallback — `resolveEmitterVocabulary` returns the lines vocab for `lines`/`bookOf`
 *     and the parity-safe `DEFAULT_EMITTER_VOCABULARY` for an unknown/absent gameType (§7).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_EMITTER_VOCABULARY,
	findEmitterEffect,
	findEmitterEvent,
	type ChoreographyNode,
} from 'engine-flow';

import { LINES_FLOW_DOC } from '../../apps/lines/src/game/flowDoc';
import { LINES_EMITTER_VOCABULARY } from '../../apps/lines/src/game/emitterVocabulary';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

// ---------------------------------------------------------------------------
// 1. Codegen is in sync with source.
// ---------------------------------------------------------------------------

console.log('\n[1] codegen --check (fixture == parsed-from-source)');
let checkOk = false;
try {
	execFileSync('node', ['scripts/gen-flow-vocabulary.mjs', '--check'], {
		cwd: ROOT,
		stdio: 'pipe',
	});
	checkOk = true;
} catch {
	checkOk = false;
}
assert(checkOk, 'committed emitterVocabulary.ts + launcher registry are up to date with source');

// ---------------------------------------------------------------------------
// 2. Coverage — the exported vocab offers everything the real FlowDoc authors.
// ---------------------------------------------------------------------------

console.log('\n[2] coverage of the real LINES_FLOW_DOC');

const usedEvents = new Set<string>();
const usedEffects = new Set<string>();
const walk = (node: ChoreographyNode | undefined): void => {
	if (!node) return;
	switch (node.kind) {
		case 'broadcast':
			if (node.event) usedEvents.add(node.event);
			break;
		case 'effect':
			if (node.name) usedEffects.add(node.name);
			break;
		case 'sequence':
		case 'parallel':
			node.children.forEach(walk);
			break;
		case 'forEach':
			walk(node.body);
			break;
		case 'branch':
			walk(node.then);
			walk(node.otherwise);
			break;
		case 'delay':
			break;
	}
};
for (const screen of LINES_FLOW_DOC.screens) {
	walk(screen.choreography?.enter);
	walk(screen.choreography?.while);
	walk(screen.choreography?.exit);
}
for (const event of LINES_FLOW_DOC.events ?? []) walk(event.choreography);

const missingEvents = [...usedEvents].filter((e) => !findEmitterEvent(LINES_EMITTER_VOCABULARY, e));
const missingEffects = [...usedEffects].filter(
	(n) => !findEmitterEffect(LINES_EMITTER_VOCABULARY, n),
);
assert(usedEvents.size > 0, `FlowDoc authors ${usedEvents.size} distinct broadcast events`);
assert(usedEffects.size > 0, `FlowDoc authors ${usedEffects.size} distinct effects`);
assert(
	missingEvents.length === 0,
	`every authored broadcast event is in the exported vocab${
		missingEvents.length ? ` (missing: ${missingEvents.join(', ')})` : ''
	}`,
);
assert(
	missingEffects.length === 0,
	`every authored effect is in the exported vocab${
		missingEffects.length ? ` (missing: ${missingEffects.join(', ')})` : ''
	}`,
);

// ---------------------------------------------------------------------------
// 3. The exported vocab is a superset of the bundled default (the real union).
// ---------------------------------------------------------------------------

console.log('\n[3] exported vocab ⊇ DEFAULT_EMITTER_VOCABULARY');
const exportedTypes = new Set(LINES_EMITTER_VOCABULARY.events.map((e) => e.type));
const defaultTypes = DEFAULT_EMITTER_VOCABULARY.events.map((e) => e.type);
const notCovered = defaultTypes.filter((t) => !exportedTypes.has(t));
assert(
	notCovered.length === 0,
	`exported vocab covers every default event${
		notCovered.length ? ` (uncovered: ${notCovered.join(', ')})` : ''
	}`,
);
const extra = [...exportedTypes].filter((t) => !defaultTypes.includes(t));
assert(
	extra.length > 0,
	`exported vocab adds events the hand-written default missed (e.g. ${extra.join(', ') || 'none'})`,
);

// ---------------------------------------------------------------------------
// 4. The launcher registry maps the right gameTypes + a parity-safe fallback. The registry
//    module imports `$lib`-free `engine-flow` only but resolves that against launcher-api's
//    node_modules, so it is asserted by source (the resolver is a literal `record[k] ?? default`).
// ---------------------------------------------------------------------------

console.log('\n[4] launcher registry (apps/launcher-api/src/lib/emitterVocabularies.ts)');
const registrySrc = readFileSync(
	resolve(ROOT, 'apps/launcher-api/src/lib/emitterVocabularies.ts'),
	'utf8',
);
assert(
	/EMITTER_VOCABULARIES:\s*Record<string,\s*EmitterVocabulary>/.test(registrySrc),
	'typed registry',
);
assert(/^\s*'?lines'?:\s*\{/m.test(registrySrc), 'maps gameType "lines"');
assert(/^\s*'?bookOf'?:\s*\{/m.test(registrySrc), 'maps gameType "bookOf" (Book of Borut)');
assert(
	/\?\?\s*DEFAULT_EMITTER_VOCABULARY/.test(registrySrc),
	'resolveEmitterVocabulary falls back to DEFAULT_EMITTER_VOCABULARY (parity-safe, §7)',
);

console.log('');
if (failures > 0) {
	console.error(`VOCAB SPIKE FAILED — ${failures} assertion(s).`);
	process.exit(1);
}
console.log('VOCAB SPIKE PASSED.');
