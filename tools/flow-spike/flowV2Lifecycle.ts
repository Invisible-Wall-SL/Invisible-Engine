/**
 * Invisible Flow v2 — Phase A slice 1 LIFECYCLE + INTENT harness.
 *
 *   pnpm --filter flow-spike run v2lifecycle
 *
 * Proves v2 can express the NON-book-event surfaces a real game's flow needs (the v1 parity gap the
 * Book of Borut remake revealed): the LOADING→basegame lifecycle (screens as z-ordered containers,
 * swapped on a `tapToStart` signal event) and INTENTS (a `spin`/`stop`/`buyBonus` button event → an
 * invoke-intent mechanic action). These are the constructs the Phase-B v1→v2 translator targets:
 *   - a v1 `complete`/loading transition → a lifecycle/signal EVENT → showContainer/hideContainer;
 *   - a v1 `action` (button) transition   → an intent EVENT → an invoke-intent ACTION.
 *
 * Asserts the flow validates clean vs `BOOK_OF_VOCAB` AND runs the exact show/hide/effect sequence.
 * Prints PASS/FAIL per assertion + a final `V2 LIFECYCLE HARNESS: PASSED`.
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	validateFlowDoc,
	BOOK_OF_VOCAB,
	type FlowDoc,
	type FlowV2Effect,
	type FunctionLibraryDoc,
	type RunContext,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// Screens as containers (custom z): loading on top at boot; basegame + hud underneath.
const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			// loading lifecycle: enter load → show loading; tap → hide loading + show basegame & hud.
			{ id: 'onLoad', kind: 'event', pos: { x: 0, y: 0 }, ref: 'load' },
			{ id: 'showLoading', kind: 'showContainer', pos: { x: 220, y: 0 }, ref: 'loading' },

			{ id: 'onTap', kind: 'event', pos: { x: 0, y: 160 }, ref: 'tapToStart' },
			{ id: 'hideLoading', kind: 'hideContainer', pos: { x: 220, y: 160 }, ref: 'loading' },
			{ id: 'showBase', kind: 'showContainer', pos: { x: 440, y: 160 }, ref: 'basegame' },
			{ id: 'showHud', kind: 'showContainer', pos: { x: 660, y: 160 }, ref: 'hud' },

			// intents: a button event → invoke the template mechanic.
			{ id: 'onSpin', kind: 'event', pos: { x: 0, y: 320 }, ref: 'spin' },
			{ id: 'doSpin', kind: 'action', pos: { x: 220, y: 320 }, ref: 'startSpin' },

			{ id: 'onStop', kind: 'event', pos: { x: 0, y: 420 }, ref: 'stop' },
			{ id: 'doStop', kind: 'action', pos: { x: 220, y: 420 }, ref: 'stopSpin' },

			{ id: 'onBuy', kind: 'event', pos: { x: 0, y: 520 }, ref: 'buyBonus' },
			{ id: 'doBuy', kind: 'action', pos: { x: 220, y: 520 }, ref: 'confirmBuyBonus' },
		],
		exec: [
			{ from: { node: 'onLoad', pin: 'exec' }, to: { node: 'showLoading', pin: 'exec' } },
			{ from: { node: 'onTap', pin: 'exec' }, to: { node: 'hideLoading', pin: 'exec' } },
			{ from: { node: 'hideLoading', pin: 'exec' }, to: { node: 'showBase', pin: 'exec' } },
			{ from: { node: 'showBase', pin: 'exec' }, to: { node: 'showHud', pin: 'exec' } },
			{ from: { node: 'onSpin', pin: 'exec' }, to: { node: 'doSpin', pin: 'exec' } },
			{ from: { node: 'onStop', pin: 'exec' }, to: { node: 'doStop', pin: 'exec' } },
			{ from: { node: 'onBuy', pin: 'exec' }, to: { node: 'doBuy', pin: 'exec' } },
		],
		data: [],
	},
	containers: [
		{ id: 'basegame', sceneId: 'basegame', z: 0 },
		{ id: 'hud', sceneId: 'hudBar', z: 50 },
		{ id: 'loading', sceneId: 'loading', z: 100 },
	],
};

const makeEnv = () => {
	const log: string[] = [];
	const registry: Record<string, FlowV2Effect> = {
		startSpin: () => void log.push('startSpin'),
		stopSpin: () => void log.push('stopSpin'),
		confirmBuyBonus: () => void log.push('confirmBuyBonus'),
	};
	const mount = createContainerMountModel(DOC.containers, () => {});
	const env = createFlowV2Env({
		mount,
		effect: (name) => registry[name],
		broadcast: () => {},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	// Wrap show/hide to record order (the mount model itself only tracks the set).
	const wrapped = {
		...env,
		showContainer: (id: string, z: number) => {
			log.push(`show ${id}@${z}`);
			return env.showContainer(id, z);
		},
		hideContainer: (id: string) => {
			log.push(`hide ${id}`);
			return env.hideContainer(id);
		},
	};
	return { env: wrapped, log, mount };
};

const main = async () => {
	console.log('Invisible Flow v2 — Phase A lifecycle + intent harness\n');

	console.log('1. the flow validates clean vs BOOK_OF_VOCAB:');
	{
		const issues = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'0 issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
	}

	console.log('\n2. loading lifecycle — load shows loading; tapToStart swaps to the game:');
	{
		const { env, log, mount } = makeEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC, ctx, 'load', {});
		assert('load → show loading@100', eq(log, ['show loading@100']), log.join(' | '));
		log.length = 0;
		await runFlowEvent(DOC, ctx, 'tapToStart', {});
		assert(
			'tapToStart → hide loading, show basegame@0 + hud@50',
			eq(log, ['hide loading', 'show basegame@0', 'show hud@50']),
			log.join(' | '),
		);
		assert(
			'mount model ends with basegame + hud shown (loading gone), z-ordered',
			eq(
				mount.ordered().map((c) => c.id),
				['basegame', 'hud'],
			),
			mount
				.ordered()
				.map((c) => c.id)
				.join(','),
		);
	}

	console.log('\n3. intents — a button event invokes the template mechanic:');
	{
		const { env, log } = makeEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC, ctx, 'spin', {});
		await runFlowEvent(DOC, ctx, 'stop', {});
		await runFlowEvent(DOC, ctx, 'buyBonus', {});
		assert(
			'spin/stop/buyBonus → startSpin/stopSpin/confirmBuyBonus',
			eq(log, ['startSpin', 'stopSpin', 'confirmBuyBonus']),
			log.join(' | '),
		);
	}

	console.log(`\n${failed ? 'V2 LIFECYCLE HARNESS: FAILED' : 'V2 LIFECYCLE HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
