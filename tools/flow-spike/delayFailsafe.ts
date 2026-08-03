/**
 * Invisible Flow v2 — Delay FAIL-SAFE harness.
 *
 * Proves, headlessly against the REAL interpreter (`runFlowEvent`), that a Delay whose `ms` is WIRED
 * (the `showContainer.durationMs` pin → Delay) never collapses the hold to 0 when the pin can't
 * measure the animation — it falls back to the node's authored literal floor instead. This is the
 * fix for the live regression where a wired duration pin on a runtime that couldn't resolve it
 * (unloaded asset / old bundle) tore the shown Spine/FX screen down the instant it mounted.
 *
 * Flow under test: event `reveal` → showContainer('screen') → delay(ms ⟵ screen.durationMs) →
 * hideContainer('screen'). We vary what the env's `containerAnimationMs` returns (a real length, 0,
 * or an ABSENT hook = the old-runtime analogue) and whether the Delay carries a literal floor, and
 * assert the ms actually fed to `waitForTimeout`.
 */

import {
	runFlowEvent,
	type DataSource,
	type FlowDoc,
	type FlowV2Env,
	type RunContext,
	type TemplateVocabulary,
} from 'engine-flow-v2';

const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [{ name: 'reveal', payload: [] }],
	actions: [],
	cues: [],
	collections: [],
};

/** Build the show→delay→hide doc. `msLiteral` (when given) is the Delay's authored floor. */
const makeDoc = (msLiteral?: number): FlowDoc => {
	const delayInputs =
		msLiteral === undefined
			? undefined
			: { ms: { kind: 'literal', type: { t: 'ms' }, value: msLiteral } as DataSource };
	return {
		version: 2,
		templateId: 'book-of',
		containers: [{ id: 'screen', sceneId: 'scene.screen', z: 10 }],
		graph: {
			nodes: [
				{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
				{ id: 'showScreen', kind: 'showContainer', pos: { x: 200, y: 0 }, ref: 'screen' },
				{ id: 'wait', kind: 'delay', pos: { x: 400, y: 0 }, inputs: delayInputs },
				{ id: 'hideScreen', kind: 'hideContainer', pos: { x: 600, y: 0 }, ref: 'screen' },
			],
			exec: [
				{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'showScreen', pin: 'exec' } },
				{ from: { node: 'showScreen', pin: 'exec' }, to: { node: 'wait', pin: 'exec' } },
				{ from: { node: 'wait', pin: 'exec' }, to: { node: 'hideScreen', pin: 'exec' } },
			],
			data: [{ from: { node: 'showScreen', pin: 'durationMs' }, to: { node: 'wait', pin: 'ms' } }],
		},
	};
};

/** An unwired Delay (literal only) — the parity control. */
const makeUnwiredDoc = (msLiteral: number): FlowDoc => {
	const doc = makeDoc(msLiteral);
	doc.graph.data = [];
	return doc;
};

/** Recording env; `duration` is what `containerAnimationMs` reports, or `null` to OMIT the hook
 *  entirely (the old-runtime analogue — the interpreter then resolves the pin to 0). */
const makeEnv = (duration: number | null) => {
	const delays: number[] = [];
	const env: FlowV2Env = {
		async effect() {},
		async broadcast() {},
		async waitForTimeout(ms) {
			delays.push(ms);
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer() {},
		hideContainer() {},
		engineRead: () => undefined,
		...(duration === null ? {} : { containerAnimationMs: () => duration }),
	};
	return { env, delays };
};

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const run = async (doc: FlowDoc, duration: number | null): Promise<number | undefined> => {
	const { env, delays } = makeEnv(duration);
	const ctx: RunContext = { vocab: VOCAB, library: { functions: [] }, env };
	await runFlowEvent(doc, ctx, 'reveal', {});
	return delays[0];
};

const main = async () => {
	console.log('Invisible Flow v2 — Delay fail-safe harness\n');

	assert('measurable pin (800ms) drives the Delay', (await run(makeDoc(300), 800)) === 800);
	assert(
		'unmeasurable pin (0) falls back to the authored floor (300ms) — not 0',
		(await run(makeDoc(300), 0)) === 300,
	);
	assert(
		'ABSENT env hook (old-runtime analogue) also falls back to the floor (500ms)',
		(await run(makeDoc(500), null)) === 500,
	);
	assert(
		'unmeasurable pin + NO authored floor ⇒ 0 (honest, nothing to hold on)',
		(await run(makeDoc(undefined), 0)) === 0,
	);
	assert(
		'unwired Delay is unchanged — reads its literal (450ms)',
		(await run(makeUnwiredDoc(450), 999)) === 450,
	);

	console.log(`\nDELAY FAIL-SAFE HARNESS: ${failed ? 'FAILED' : 'PASSED'}`);
	if (failed) process.exit(1);
};

void main();
