/**
 * Invisible Flow v2 — free-spin BOARD-GLOW harness.
 *
 *   pnpm --filter flow-spike run v2boardglow
 *
 * The pink reel-house glow behind the board is a coded Spine (`BoardFrame.svelte`) whose show/hide
 * is broadcast by the CODED `freeSpinTrigger` / `freeSpinEnd` handlers. A v2 flow that OWNS those
 * book events replaces the whole coded handler — so before `showBoardGlow`/`hideBoardGlow` existed,
 * authoring the free-spin entry silently dropped the glow with no way to put it back. This is the
 * same failure the `showWinLine`/`hideWinLine` pair was added to fix; the pair here is its analogue.
 *
 * Asserts:
 *   1. `showBoardGlow` / `hideBoardGlow` are declared book-of vocabulary EFFECTS (so the palette
 *      offers them), take no params, and a flow authoring them validates with ZERO issues.
 *   2. Wiring them off the Game Signals `freeSpinTrigger` / `freeSpinEnd` records the effects — the
 *      author CAN restore the glow, and can place it anywhere in the choreography.
 *   3. THE CONTROL — a flow that owns `freeSpinTrigger` WITHOUT authoring `showBoardGlow` records
 *      NO glow effect. This proves assertion 2 is load-bearing: the actions are the only way an
 *      owned free-spin entry gets its glow, so the gap they close is real and not hypothetical.
 *   4. ORDER-FREEDOM — the glow can be authored BEFORE or AFTER other steps in the same chain
 *      (it is a plain fire-and-forget effect, not an awaited one), so it never blocks the round.
 *
 * NOTE ON SCOPE: like `flowV2Vocab`, this asserts the CONTRACT + the interpreter walk. It does NOT
 * assert the game implements the effects — `flowEffects.ts` imports `.svelte.ts` rune modules that
 * tsx cannot load headlessly. That half is covered by the `assertVocabBacked` dev guard in
 * `flowV2Runtime.svelte.ts` + the `lines` typecheck.
 *
 * Prints PASS/FAIL per assertion + a final `V2 BOARD-GLOW HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	runFlowEvent,
	validateFlowDoc,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

const SHOW = 'showBoardGlow';
const HIDE = 'hideBoardGlow';

/** The authored free-spin entry + exit: the glow rides the book events the coded handlers used. */
const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onTrigger', kind: 'event', pos: { x: 0, y: 0 }, ref: 'freeSpinTrigger' },
			{ id: 'glowOn', kind: 'action', pos: { x: 300, y: 0 }, ref: SHOW },
			{ id: 'onEnd', kind: 'event', pos: { x: 0, y: 200 }, ref: 'freeSpinEnd' },
			{ id: 'glowOff', kind: 'action', pos: { x: 300, y: 200 }, ref: HIDE },
		],
		exec: [
			{ from: { node: 'onTrigger', pin: 'exec' }, to: { node: 'glowOn', pin: 'exec' } },
			{ from: { node: 'onEnd', pin: 'exec' }, to: { node: 'glowOff', pin: 'exec' } },
		],
		data: [],
	},
	containers: [],
};

/** The CONTROL: `freeSpinTrigger` is owned, but the author never wired the glow. */
const DOC_NO_GLOW: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onTrigger', kind: 'event', pos: { x: 0, y: 0 }, ref: 'freeSpinTrigger' },
			{ id: 'music', kind: 'action', pos: { x: 300, y: 0 }, ref: 'soundMusic' },
		],
		exec: [{ from: { node: 'onTrigger', pin: 'exec' }, to: { node: 'music', pin: 'exec' } }],
		data: [],
	},
	containers: [],
};

/** The glow authored AFTER a delay — proves it is not order-locked to the head of the chain. */
const DOC_LATE_GLOW: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onTrigger', kind: 'event', pos: { x: 0, y: 0 }, ref: 'freeSpinTrigger' },
			{
				id: 'wait',
				kind: 'delay',
				pos: { x: 200, y: 0 },
				// `ms` is a data-IN pin, not a node field — a literal source feeds it.
				inputs: { ms: { kind: 'literal', type: { t: 'int' }, value: 250 } },
			},
			{ id: 'glowOn', kind: 'action', pos: { x: 400, y: 0 }, ref: SHOW },
		],
		exec: [
			{ from: { node: 'onTrigger', pin: 'exec' }, to: { node: 'wait', pin: 'exec' } },
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'glowOn', pin: 'exec' } },
		],
		data: [],
	},
	containers: [],
};

const makeRecordingEnv = () => {
	const log: string[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			const args = Object.values(payload);
			log.push(`effect ${name}(${args.map((v) => JSON.stringify(v)).join(',')})`);
		},
		async broadcast(cue) {
			log.push(`broadcast ${cue}`);
		},
		async waitForTimeout(ms) {
			log.push(`delay ${ms}`);
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer(id, z) {
			log.push(`show ${id}@${z}`);
		},
		hideContainer(id) {
			log.push(`hide ${id}`);
		},
		engineRead: () => undefined,
	};
	return { env, log };
};

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const main = async () => {
	console.log('Invisible Flow v2 — free-spin board-glow harness\n');

	// --- 1. the vocabulary declares the pair, and a doc using it validates ---
	console.log('1. the board-glow pair is declared + authorable:');
	{
		for (const name of [SHOW, HIDE]) {
			const decl = BOOK_OF_VOCAB.actions.find((a) => a.name === name);
			assert(
				`book-of vocabulary declares \`${name}\` as an effect`,
				decl !== undefined && decl.category === 'effect',
				BOOK_OF_VOCAB.actions.map((a) => a.name).join(','),
			);
			assert(`\`${name}\` takes no params (a plain signal)`, decl?.params.length === 0);
		}
		const issues = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'a flow authoring the pair validates with 0 issues',
			issues.length === 0,
			JSON.stringify(issues),
		);
	}

	// --- 2. the authored events record the effects ---
	console.log('\n2. an owned free-spin entry/exit fires the glow:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC, ctx, 'freeSpinTrigger', {});
		assert(
			`freeSpinTrigger records exactly \`effect ${SHOW}()\``,
			JSON.stringify(log) === JSON.stringify([`effect ${SHOW}()`]),
			log.join(' | '),
		);

		const { env: env2, log: log2 } = makeRecordingEnv();
		const ctx2: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env: env2 };
		await runFlowEvent(DOC, ctx2, 'freeSpinEnd', {});
		assert(
			`freeSpinEnd records exactly \`effect ${HIDE}()\``,
			JSON.stringify(log2) === JSON.stringify([`effect ${HIDE}()`]),
			log2.join(' | '),
		);
	}

	// --- 3. THE CONTROL: owning the event without the action ⇒ no glow at all ---
	console.log('\n3. CONTROL — an owned freeSpinTrigger with no authored glow has NO glow:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC_NO_GLOW, ctx, 'freeSpinTrigger', {});
		assert(
			'no board-glow effect is recorded (the gap the pair closes is real)',
			!log.some((line) => line.includes('BoardGlow')),
			log.join(' | '),
		);
	}

	// --- 4. the glow is order-free within the chain ---
	console.log('\n4. the glow can be authored anywhere in the chain:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC_LATE_GLOW, ctx, 'freeSpinTrigger', {});
		assert(
			`a glow behind a delay still fires, after it`,
			JSON.stringify(log) === JSON.stringify(['delay 250', `effect ${SHOW}()`]),
			log.join(' | '),
		);
	}

	console.log(failed ? '\nV2 BOARD-GLOW HARNESS: FAILED' : '\nV2 BOARD-GLOW HARNESS: PASSED');
	process.exit(failed ? 1 : 0);
};

void main();
