/**
 * Invisible Flow — tap-to-continue / signal-trigger harness (design doc §6.2, §7).
 *
 *   pnpm --filter flow-spike run tap
 *
 * Proves, HEADLESSLY, the tap-to-continue runtime additions:
 *
 *  A. `signal` transition trigger — `emitSignal(name)` fires an active-screen edge whose
 *     trigger is `{kind:'signal', signal:<name>}`, and is IGNORED for a non-matching name
 *     (mirroring how a `bookEvent` trigger matches the arriving event `type`, §6.2). A
 *     signal with no listening edge is a safe no-op.
 *
 *  B. `completeActiveScreen()` — runs the active screen's `exit` choreography then fires its
 *     `complete`/`exited` pin, so a `complete`-triggered edge from that screen advances the
 *     flow (the click analogue of the screen self-signalling done, §6.2).
 *
 *  C. Inert parity (§7) — with NO FlowDoc the interpreter is inert: both
 *     `completeActiveScreen()` and `emitSignal()` are SAFE no-ops returning false (the game
 *     stays on its coded path, byte-identical to current `main`).
 *
 *  D. Round-trip (the bake/save contract) — a FlowDoc using a `signal` trigger survives
 *     `normalizeFlowDoc` canonical + idempotent, and an invalid signal trigger (missing/empty
 *     `signal`) is dropped without corrupting the rest of the doc.
 *
 * Drives the REAL engine-flow HSM / interpreter / normalize against a recording runtime,
 * mirroring the Phase-4 rig. Determinism: a virtual `waitForTimeout` (records the scaled ms).
 */

import {
	createFlowInterpreter,
	normalizeFlowDoc,
	type ChoreographyNode,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — logs broadcasts + delays so a swap's exit/enter order is observable.
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const stableArgs = (e: EmitterEvent) => {
		const { type: _type, ...rest } = e;
		return Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
	};
	const runtime: FlowRuntime = {
		emitter: {
			broadcast: (e) => {
				log.push(`broadcast ${e.type}${stableArgs(e)}`);
			},
			broadcastAsync: (e) => {
				log.push(`broadcastAsync ${e.type}${stableArgs(e)}`);
				return Promise.resolve([]);
			},
		},
		timeScale: () => (turbo ? 2 : 1),
		waitForTimeout: (ms) => {
			log.push(`delay ${ms}`);
			return Promise.resolve();
		},
	};
	return { log, runtime };
};

const enter = (label: string): ChoreographyNode => ({
	kind: 'broadcast',
	event: 'flowEnter',
	payload: { screen: { kind: 'literal', value: label } },
});
const exit = (label: string): ChoreographyNode => ({
	kind: 'broadcast',
	event: 'flowExit',
	payload: { screen: { kind: 'literal', value: label } },
});

// A tap-driven flow: an idle/win-presentation screen that the user TAPS to continue.
//  - a `signal` edge (`tapContinue`) advances winPresentation → basegame;
//  - a `complete` edge advances bonusIntro → bonus (the "complete the active screen" path).
const flowDoc: FlowDoc = {
	version: 1,
	screens: [
		{
			id: 'winPresentation',
			initial: true,
			choreography: { enter: enter('winPresentation'), exit: exit('winPresentation') },
		},
		{ id: 'basegame', choreography: { enter: enter('basegame'), exit: exit('basegame') } },
		{ id: 'bonusIntro', choreography: { enter: enter('bonusIntro'), exit: exit('bonusIntro') } },
		{ id: 'bonus', choreography: { enter: enter('bonus'), exit: exit('bonus') } },
	],
	transitions: [
		{
			id: 't_tap',
			from: 'winPresentation',
			to: 'basegame',
			trigger: { kind: 'signal', signal: 'tapContinue' },
			order: 0,
		},
		{
			id: 't_complete',
			from: 'bonusIntro',
			to: 'bonus',
			trigger: { kind: 'complete' },
			order: 0,
		},
	],
};

const scenes: Record<string, MountableScene> = {
	winPresentation: { id: 'winPresentation', space: 'game' },
	basegame: { id: 'basegame', space: 'game' },
	bonusIntro: { id: 'bonusIntro', space: 'game' },
	bonus: { id: 'bonus', space: 'game' },
};
const resolveScene = (id: string): MountableScene | undefined => scenes[id];

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow — tap-to-continue / signal-trigger harness\n');

	// --- A. signal trigger ---
	console.log('A. emitSignal — matched fires, non-matching/un-listened is a no-op:');
	{
		const { log, runtime } = makeRig(false);
		const interp = createFlowInterpreter({
			flowDoc,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		assert('interpreter is active with a FlowDoc', interp.isActive);
		assert('initial screen is winPresentation', interp.activeScreenId === 'winPresentation');
		await interp.start();
		log.length = 0;

		// A non-matching signal name does nothing.
		const wrong = await interp.emitSignal('somethingElse');
		assert(
			'non-matching signal name ⇒ no transition (ignored)',
			!wrong && interp.activeScreenId === 'winPresentation' && log.length === 0,
		);

		// The matching signal advances winPresentation → basegame, running exit then enter.
		const tapped = await interp.emitSignal('tapContinue');
		assert(
			'matching signal `tapContinue` ⇒ winPresentation → basegame',
			tapped && interp.activeScreenId === 'basegame',
		);
		assert(
			'swap ran exit(winPresentation) then enter(basegame) in order',
			eq(log, [
				'broadcast flowExit {"screen":"winPresentation"}',
				'broadcast flowEnter {"screen":"basegame"}',
			]),
		);

		// On basegame there is no signal edge ⇒ a tap is a safe no-op.
		log.length = 0;
		const noEdge = await interp.emitSignal('tapContinue');
		assert(
			'signal with no listening edge on the active screen ⇒ no-op',
			!noEdge && interp.activeScreenId === 'basegame' && log.length === 0,
		);
	}

	// --- B. completeActiveScreen() ---
	console.log('\nB. completeActiveScreen — exit choreography then advance a `complete` edge:');
	{
		// Start the flow at bonusIntro by authoring it as initial in a focused doc.
		const introDoc: FlowDoc = {
			version: 1,
			screens: [
				{
					id: 'bonusIntro',
					initial: true,
					choreography: { enter: enter('bonusIntro'), exit: exit('bonusIntro') },
				},
				{ id: 'bonus', choreography: { enter: enter('bonus'), exit: exit('bonus') } },
			],
			transitions: [
				{ id: 't_c', from: 'bonusIntro', to: 'bonus', trigger: { kind: 'complete' }, order: 0 },
			],
		};
		const { log, runtime } = makeRig(false);
		const interp = createFlowInterpreter({
			flowDoc: introDoc,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		await interp.start();
		log.length = 0;

		const advanced = await interp.completeActiveScreen();
		assert(
			'completeActiveScreen advanced bonusIntro → bonus via the complete edge',
			advanced && interp.activeScreenId === 'bonus',
		);
		assert(
			'completeActiveScreen ran exit(bonusIntro) then enter(bonus)',
			eq(log, [
				'broadcast flowExit {"screen":"bonusIntro"}',
				'broadcast flowEnter {"screen":"bonus"}',
			]),
		);

		// On bonus there is no complete edge ⇒ a further tap-complete is a no-op.
		log.length = 0;
		const noEdge = await interp.completeActiveScreen();
		assert(
			'completeActiveScreen with no complete edge ⇒ no-op',
			!noEdge && interp.activeScreenId === 'bonus' && log.length === 0,
		);
	}

	// --- C. Inert parity (§7) — no FlowDoc ⇒ both hooks are safe no-ops ---
	console.log('\nC. Inert parity — no FlowDoc ⇒ tap hooks are safe no-ops (§7):');
	{
		const { runtime } = makeRig(false);
		const inert = createFlowInterpreter({
			flowDoc: undefined,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		assert(
			'no FlowDoc ⇒ not active, no active screen',
			!inert.isActive && inert.activeScreenId === undefined,
		);
		const c = await inert.completeActiveScreen();
		const s = await inert.emitSignal('tapContinue');
		assert('completeActiveScreen() ⇒ false (no-op)', c === false);
		assert('emitSignal() ⇒ false (no-op)', s === false);
	}

	// --- D. Round-trip — signal trigger survives normalize; invalid is dropped ---
	console.log('\nD. normalizeFlowDoc — signal trigger round-trips; invalid dropped (§7):');
	{
		const once = normalizeFlowDoc(flowDoc);
		const twice = normalizeFlowDoc(once);
		assert('signal-trigger doc is canonical + idempotent through normalize', eq(once, twice));
		const signalEdge = once.transitions.find((t) => t.id === 't_tap');
		assert(
			'signal trigger preserved (kind + name)',
			eq(signalEdge?.trigger, { kind: 'signal', signal: 'tapContinue' }),
		);

		// A signal trigger missing/empty `signal` is invalid ⇒ the whole transition is dropped,
		// the valid sibling survives (never corrupting the doc).
		const dirty = {
			version: 1,
			screens: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
			transitions: [
				{ id: 'bad', from: 'a', to: 'b', trigger: { kind: 'signal' } },
				{ id: 'badEmpty', from: 'a', to: 'b', trigger: { kind: 'signal', signal: '' } },
				{ id: 'good', from: 'a', to: 'c', trigger: { kind: 'signal', signal: 'tapContinue' } },
			],
		};
		const normalizedDirty = normalizeFlowDoc(dirty);
		assert(
			'invalid signal triggers dropped, valid one kept',
			normalizedDirty.transitions.length === 1 && normalizedDirty.transitions[0]?.id === 'good',
			JSON.stringify(normalizedDirty.transitions.map((t) => t.id)),
		);
	}

	console.log(
		`\n${failed ? 'TAP-TO-CONTINUE HARNESS: FAILED' : 'TAP-TO-CONTINUE HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
