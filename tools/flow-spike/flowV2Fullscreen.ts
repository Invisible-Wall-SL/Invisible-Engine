/**
 * Invisible Flow v2 — FULLSCREEN gesture harness.
 *
 *   pnpm --filter flow-spike run v2fullscreen
 *
 * Fullscreen is unlike every other HUD action: browsers refuse `requestFullscreen` unless the
 * call happens INSIDE a trusted user-gesture call stack. The press path to it is
 *
 *   click → ComponentInstance.firePress → resolveFlowV2Press → dispatchContainerEvent
 *         → runFlowContainerEvent → execFrom → runNode → env.effect('toggleFullscreen')
 *
 * — a chain of `async` functions. That is SAFE only because an async function body runs
 * synchronously up to its first `await`, and each `await`'s operand is evaluated BEFORE
 * suspension, so `env.effect` is still invoked in the click's own stack. This harness pins that
 * down: it is the invariant the whole feature rests on, it is invisible in the source, and an
 * innocent-looking refactor (awaiting anything earlier in the walk) would silently break
 * fullscreen in production while every other action kept working.
 *
 * Asserts:
 *   1. `fullscreen` is in ENGINE_ACTION_CATALOG (a button can bind it) and projects an
 *      `onFullscreen` pin; `toggleFullscreen` is a declared book-of vocabulary command.
 *   2. Firing `fullscreenButton.onFullscreen` records `effect toggleFullscreen()`.
 *   3. THE GESTURE INVARIANT — that effect is recorded SYNCHRONOUSLY: it is already in the log
 *      on the line after the (un-awaited) dispatch call returns its promise.
 *   4. CONTROL — the same doc with a `delay` node ahead of the action does NOT record
 *      synchronously. This proves assertion 3 can actually fail, and that the authoring rule
 *      ("wire fullscreen directly off the press, never behind a delay") is real.
 *
 * Prints PASS/FAIL per assertion + a final `V2 FULLSCREEN HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	containerEventDeclId,
	containerEventPinLabel,
	deriveContainerEvents,
	runFlowContainerEvent,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type RunContext,
} from 'engine-flow-v2';
// Straight at the module, not the `engine-layout` barrel: the barrel is a Svelte-package entry
// whose chain tsx can't resolve outside Vite. (Other spikes get away with `import type` — erased
// at runtime; this is a real value import.)
import { ENGINE_ACTION_CATALOG } from '../../packages/engine-layout/src/lib/componentCatalog';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

const BUTTON = 'fullscreenButton';
const ACTION = 'fullscreen';
const COMMAND = 'toggleFullscreen';

/** The authored shape: the HUD's fullscreen button press runs the command DIRECTLY. */
const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'showHud', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'hudBar' },
			{ id: 'doFullscreen', kind: 'action', pos: { x: 300, y: 0 }, ref: COMMAND },
		],
		exec: [
			{
				from: { node: 'showHud', pin: containerEventDeclId(BUTTON, ACTION) },
				to: { node: 'doFullscreen', pin: 'exec' },
			},
		],
		data: [],
	},
	containers: [{ id: 'hudBar', sceneId: 'hudBar', z: 0 }],
};

/** The same press, but behind a `delay` — the authoring mistake the rule warns against. */
const DOC_WITH_DELAY: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'showHud', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'hudBar' },
			{ id: 'wait', kind: 'delay', pos: { x: 200, y: 0 }, ms: 0 },
			{ id: 'doFullscreen', kind: 'action', pos: { x: 400, y: 0 }, ref: COMMAND },
		],
		exec: [
			{
				from: { node: 'showHud', pin: containerEventDeclId(BUTTON, ACTION) },
				to: { node: 'wait', pin: 'exec' },
			},
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'doFullscreen', pin: 'exec' } },
		],
		data: [],
	},
	containers: [{ id: 'hudBar', sceneId: 'hudBar', z: 0 }],
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
	console.log('Invisible Flow v2 — fullscreen gesture harness\n');

	// --- 1. the action key + pin projection + vocabulary command all exist ---
	console.log('1. `fullscreen` is bindable and projects an `onFullscreen` pin:');
	{
		assert(
			'ENGINE_ACTION_CATALOG contains `fullscreen`',
			ENGINE_ACTION_CATALOG.includes(ACTION),
			ENGINE_ACTION_CATALOG.join(','),
		);
		const decls = deriveContainerEvents([{ componentId: BUTTON, event: ACTION }]);
		assert(
			`a component bound to \`fullscreen\` projects the pin \`${containerEventPinLabel(ACTION)}\``,
			decls.length === 1 && decls[0].label === 'onFullscreen',
			JSON.stringify(decls),
		);
		assert(
			'book-of vocabulary declares the `toggleFullscreen` command',
			BOOK_OF_VOCAB.actions.some((a) => a.name === COMMAND && a.category === 'command'),
			BOOK_OF_VOCAB.actions.map((a) => a.name).join(','),
		);
	}

	// --- 2. firing the pin runs the command ---
	console.log('\n2. firing the pin runs `toggleFullscreen`:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, ctx, BUTTON, ACTION);
		assert(
			'records exactly `effect toggleFullscreen()`',
			JSON.stringify(log) === JSON.stringify([`effect ${COMMAND}()`]),
			log.join(' | '),
		);
	}

	// --- 3. THE GESTURE INVARIANT: the effect lands synchronously ---
	console.log('\n3. the effect runs SYNCHRONOUSLY (the user gesture survives the walk):');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		// Deliberately NOT awaited — this models the press handler, which is a sync `void` call.
		const pending = runFlowContainerEvent(DOC, ctx, BUTTON, ACTION);
		const landedSynchronously = log.includes(`effect ${COMMAND}()`);
		await pending;
		assert(
			'`toggleFullscreen` is already recorded before the dispatch promise is awaited',
			landedSynchronously,
			`log after sync return: [${log.join(' | ')}]`,
		);
	}

	// --- 4. CONTROL: a delay ahead of it spends the gesture ---
	console.log('\n4. CONTROL — a `delay` ahead of the action breaks synchronicity:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		const pending = runFlowContainerEvent(DOC_WITH_DELAY, ctx, BUTTON, ACTION);
		const landedSynchronously = log.includes(`effect ${COMMAND}()`);
		await pending;
		assert(
			'behind a delay, `toggleFullscreen` is NOT recorded synchronously (so assertion 3 is a real test)',
			!landedSynchronously,
			`log after sync return: [${log.join(' | ')}]`,
		);
		assert(
			'…but it does still run eventually (the delay only defers it)',
			log.includes(`effect ${COMMAND}()`),
			log.join(' | '),
		);
	}

	console.log(
		failed ? '\nV2 FULLSCREEN HARNESS: FAILED\n' : '\nV2 FULLSCREEN HARNESS: PASSED\n',
	);
	process.exit(failed ? 1 : 0);
};

void main();
