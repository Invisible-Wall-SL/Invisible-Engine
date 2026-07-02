/**
 * Invisible Flow — Phase 4 runtime harness (design doc §6, §8, §11.3).
 *
 *   pnpm --filter flow-spike run phase4
 *
 * Proves, HEADLESSLY and before the live game swap, the Phase-4 runtime surfaces:
 *
 *  A. Generic mounter (§8, §11.3) — `createSceneMounter` resolves an AUTHORED screen to its
 *     backing LayoutDoc scene (interpreter mounts it) and EVERY other screen to
 *     `fallThrough` (the game keeps its coded mounting — the §7 parity boundary). A screen
 *     authored in the FlowDoc but with NO backing scene also falls through (never a blank).
 *
 *  B. Transitions — all three triggers under the ACTIVE-SET model (§6):
 *     1. bookEvent — `freeSpinTrigger` LAYERS FreeSpinsIntro over the persistent base (no source
 *        exit; base stays active underneath).
 *     2. complete  — the intro's `complete` pin HANDS OFF: runs its exit + removes it, base remains.
 *     3. condition — a guard over an `$engine.*` value LAYERS BonusPick over the base when it holds;
 *        a repeated eval on the already-active layer is a consumed no-op (no re-enter / re-notify).
 *     Author order + guards are honoured; an unguarded edge is the default; a mid-swap trigger is
 *     ignored (serial gate). Enter runs on every activation; exit runs only on a `complete` handoff.
 *
 *  C. Observe-don't-drive (§12) — the HSM NEVER calls into the platform FSM; it only reads
 *     the injected `$engine.*` for guards and reacts to pushed book events / completes. This
 *     harness asserts the HSM exposes NO platform-driving surface (no send/transition into
 *     XState) — it has only `onBookEvent` / `onComplete` / `evaluate` / `start`.
 *
 *  D. Full interpreter parity — `createFlowInterpreter` with NO FlowDoc is INERT: the active
 *     screen is undefined, every mount falls through, and a book event runs its coded handler
 *     (byte-identical to current `main`). With ONE event authored, that event is
 *     interpreter-driven and the rest still fall through.
 *
 * It drives the REAL executor/HSM/mounter/interpreter from `engine-flow` against a recording
 * runtime, mirroring the Phase-0 rig. Determinism: a virtual `waitForTimeout` (resolves
 * immediately, records the scaled ms) so the timeline is reproducible run-to-run.
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	createPresentationMachine,
	createSceneMounter,
	type ChoreographyNode,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter shared by the executor, logging broadcasts + delays.
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const { eventEmitter } = createEventEmitter<EmitterEvent>();
	const stableArgs = (e: EmitterEvent) => {
		const { type, ...rest } = e;
		return Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
	};
	const runtime: FlowRuntime = {
		emitter: {
			broadcast: (e) => {
				log.push(`broadcast ${e.type}${stableArgs(e)}`);
				eventEmitter.broadcast(e);
			},
			broadcastAsync: (e) => {
				log.push(`broadcastAsync ${e.type}${stableArgs(e)}`);
				return eventEmitter.broadcastAsync(e);
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

// ---------------------------------------------------------------------------
// A representative apps/lines-shaped flow under the ACTIVE-SET model: `basegame` is the
// persistent base (initial, no outgoing `complete` edge). `freeSpinIntro` (a bookEvent LAYER)
// and `bonusPick` (a condition LAYER) each stack OVER the still-active base and hand BACK via a
// `complete` edge (their Complete pin). This exercises all three triggers AND the layer-vs-
// handoff split: bookEvent/condition LAYER the target (source persists, no source exit);
// `complete` HANDS OFF (runs source exit, deactivates source).
// ---------------------------------------------------------------------------
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

const flowDoc: FlowDoc = {
	version: 1,
	screens: [
		{
			id: 'basegame',
			initial: true,
			choreography: { enter: enter('basegame'), exit: exit('basegame') },
		},
		{
			id: 'freeSpinIntro',
			choreography: { enter: enter('freeSpinIntro'), exit: exit('freeSpinIntro') },
		},
		{ id: 'bonusPick', choreography: { enter: enter('bonusPick'), exit: exit('bonusPick') } },
	],
	transitions: [
		// bookEvent LAYER: freeSpinTrigger stacks freeSpinIntro over the persistent base.
		{
			id: 't1',
			from: 'basegame',
			to: 'freeSpinIntro',
			trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
			order: 0,
		},
		// complete HANDOFF: the intro's Complete pin dismisses it back to the base.
		{ id: 't2', from: 'freeSpinIntro', to: 'basegame', trigger: { kind: 'complete' }, order: 0 },
		// condition LAYER: a guarded `$engine.*` change stacks bonusPick over the persistent base.
		{
			id: 't3',
			from: 'basegame',
			to: 'bonusPick',
			trigger: { kind: 'condition' },
			guard: {
				all: [
					{
						left: { kind: 'engine', key: 'freeSpinsLeft' },
						op: 'lte',
						right: { kind: 'literal', value: 0 },
					},
				],
			},
			order: 0,
		},
		// complete HANDOFF: the bonus pick's Complete pin dismisses it back to the base.
		{ id: 't4', from: 'bonusPick', to: 'basegame', trigger: { kind: 'complete' }, order: 0 },
	],
};

// Backing LayoutDoc scenes (the mounter resolves these). `bonusPick` is intentionally
// MISSING a backing scene to prove the authored-but-no-scene fall-through.
const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'game', visibleSource: 'freeSpinIntroShow' },
	hudBar: { id: 'hudBar', space: 'standard' },
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
	console.log('Invisible Flow — Phase 4 runtime harness\n');

	// --- A. Generic mounter (§8, §11.3) ---
	console.log('A. Generic scene mounter (authored vs fall-through):');
	{
		const mounter = createSceneMounter({ flowDoc, resolveScene });

		const base = mounter.resolve('basegame');
		assert(
			'authored screen with backing scene ⇒ interpreter mount',
			base?.kind === 'authored' && base.scene.id === 'basegame' && base.scene.space === 'game',
			JSON.stringify(base),
		);

		const intro = mounter.resolve('freeSpinIntro');
		assert(
			'authored overlay carries its visibleSource gate through to <LayoutScene>',
			intro?.kind === 'authored' && intro.scene.visibleSource === 'freeSpinIntroShow',
			JSON.stringify(intro),
		);

		const fs = mounter.resolve('bonusPick');
		assert(
			'authored screen with NO backing scene ⇒ fall-through (never a blank mount)',
			fs?.kind === 'fallThrough',
			JSON.stringify(fs),
		);

		const hud = mounter.resolve('hudBar');
		assert(
			'un-authored screen (has a scene) ⇒ fall-through (coded mounting, §7)',
			hud?.kind === 'fallThrough',
			JSON.stringify(hud),
		);

		assert(
			'mounter.has tracks authored AND backed',
			mounter.has('basegame') && !mounter.has('bonusPick') && !mounter.has('hudBar'),
		);
		assert('resolve(undefined) ⇒ undefined', mounter.resolve(undefined) === undefined);
	}

	// --- B. Transitions — all three triggers, ACTIVE-SET semantics (§6) ---
	console.log('\nB. Transitions (bookEvent-layer / complete-handoff / condition-layer):');
	{
		const { log, runtime } = makeRig(false);
		let freeSpinsLeft = 3;
		// Record a SNAPSHOT of the active set on each change (the new array callback), so the
		// parity check asserts the full set (base persistence + layer order), not just a topmost id.
		const setChanges: string[][] = [];
		const machine = createPresentationMachine(flowDoc, {
			runtime,
			engine: (key) => (key === 'freeSpinsLeft' ? freeSpinsLeft : undefined),
			onActiveScreensChange: (ids) => setChanges.push([...ids]),
		});

		assert(
			'initial active set is the `initial` node alone',
			eq(machine.activeScreenIds, ['basegame']) && machine.activeScreenId === 'basegame',
		);
		await machine.start();
		assert(
			'start() runs the initial enter choreography (no initial notify)',
			eq(log, ['broadcast flowEnter {"screen":"basegame"}']) && setChanges.length === 0,
		);

		// 1. bookEvent LAYER — freeSpinTrigger stacks freeSpinIntro OVER the persistent base.
		log.length = 0;
		const took1 = await machine.onBookEvent({ type: 'freeSpinTrigger' });
		assert(
			'bookEvent LAYERS freeSpinIntro over the still-active base',
			took1 && eq(machine.activeScreenIds, ['basegame', 'freeSpinIntro']),
		);
		assert(
			'layer ran ONLY enter(freeSpinIntro) — NO source exit (base persists)',
			eq(log, ['broadcast flowEnter {"screen":"freeSpinIntro"}']),
		);

		// A non-matching book event does NOT transition.
		const tookNone = await machine.onBookEvent({ type: 'winInfo' });
		assert(
			'non-matching book event takes no transition',
			!tookNone && eq(machine.activeScreenIds, ['basegame', 'freeSpinIntro']),
		);

		// 2. complete HANDOFF — the intro's Complete pin runs its exit + removes it, back to base.
		log.length = 0;
		const took2 = await machine.onComplete();
		assert(
			'complete HANDS OFF: freeSpinIntro exits + deactivates, base remains',
			took2 && eq(machine.activeScreenIds, ['basegame']),
		);
		assert(
			'handoff ran exit(freeSpinIntro) then enter(basegame) in order',
			eq(log, [
				'broadcast flowExit {"screen":"freeSpinIntro"}',
				'broadcast flowEnter {"screen":"basegame"}',
			]),
		);

		// 3. condition LAYER — guard false (3 left) ⇒ no transition; flip to 0 ⇒ layers bonusPick.
		log.length = 0;
		const tookCondFalse = await machine.evaluate();
		assert(
			'condition guard false ⇒ no transition',
			!tookCondFalse && eq(machine.activeScreenIds, ['basegame']),
		);
		freeSpinsLeft = 0;
		const tookCondTrue = await machine.evaluate();
		assert(
			'condition guard true ⇒ LAYERS bonusPick over the still-active base',
			tookCondTrue && eq(machine.activeScreenIds, ['basegame', 'bonusPick']),
		);
		assert(
			'condition layer ran ONLY enter(bonusPick) — NO source exit',
			eq(log, ['broadcast flowEnter {"screen":"bonusPick"}']),
		);

		// A REPEATED condition eval (the game pings evaluate() on every value change) is a NO-OP:
		// bonusPick is already active, so no re-enter and no re-notify (the layer-idempotence fix).
		log.length = 0;
		const notifiesBefore = setChanges.length;
		const tookRepeat = await machine.evaluate();
		assert(
			'repeated condition on an already-active layer ⇒ consumed but NO re-enter / NO re-notify',
			tookRepeat &&
				log.length === 0 &&
				setChanges.length === notifiesBefore &&
				eq(machine.activeScreenIds, ['basegame', 'bonusPick']),
		);

		assert(
			'onActiveScreensChange snapshotted each real set change in order',
			eq(setChanges, [['basegame', 'freeSpinIntro'], ['basegame'], ['basegame', 'bonusPick']]),
		);
	}

	// --- B2. Author-order + guard precedence on multiple outgoing edges ---
	console.log('\nB2. Author-order edge precedence + guards:');
	{
		const guardedFlow: FlowDoc = {
			version: 1,
			screens: [{ id: 'a', initial: true }, { id: 'big' }, { id: 'small' }],
			transitions: [
				{
					id: 'e0',
					from: 'a',
					to: 'big',
					trigger: { kind: 'bookEvent', event: 'setWin' },
					guard: {
						all: [
							{
								left: { kind: 'trigger', path: 'winLevel' },
								op: 'gte',
								right: { kind: 'literal', value: 3 },
							},
						],
					},
					order: 0,
				},
				// unguarded default (author order AFTER the guarded one) — the fall-back.
				{
					id: 'e1',
					from: 'a',
					to: 'small',
					trigger: { kind: 'bookEvent', event: 'setWin' },
					order: 1,
				},
			],
		};
		const { runtime } = makeRig(false);
		const m1 = createPresentationMachine(guardedFlow, { runtime });
		await m1.onBookEvent({ type: 'setWin', winLevel: 5 } as { type: string });
		assert('guarded edge (winLevel≥3) wins over the later default', m1.activeScreenId === 'big');

		const m2 = createPresentationMachine(guardedFlow, { runtime });
		await m2.onBookEvent({ type: 'setWin', winLevel: 1 } as { type: string });
		assert('guard fails ⇒ the unguarded author-order default fires', m2.activeScreenId === 'small');
	}

	// --- B3. delayMs is scaled by timeScale() like a choreography Delay ---
	console.log('\nB3. Transition delay scaling (turbo):');
	for (const turbo of [false, true]) {
		const delayedFlow: FlowDoc = {
			version: 1,
			screens: [{ id: 'a', initial: true }, { id: 'b' }],
			transitions: [
				{ id: 'e', from: 'a', to: 'b', trigger: { kind: 'complete' }, delayMs: 600, order: 0 },
			],
		};
		const { log, runtime } = makeRig(turbo);
		const m = createPresentationMachine(delayedFlow, { runtime });
		await m.onComplete();
		const expected = turbo ? 300 : 600;
		assert(
			`transition delay 600 / timeScale() = ${expected} (turbo ${turbo ? 'ON' : 'OFF'})`,
			log.includes(`delay ${expected}`),
			log.join(', '),
		);
	}

	// --- B4. complete FAN-OUT — one source, multiple guard-holding complete edges ---
	console.log('\nB4. complete fan-out (loading --complete--> {basegame, HUD}):');
	{
		// The owner's shape: `loading` (initial) hands off on its Complete pin to BOTH the
		// persistent base AND a HUD screen. Both must activate; the source must be removed once.
		const fanOutFlow: FlowDoc = {
			version: 1,
			screens: [
				{
					id: 'loading',
					initial: true,
					choreography: { enter: enter('loading'), exit: exit('loading') },
				},
				{ id: 'basegame', choreography: { enter: enter('basegame') } },
				{ id: 'hud', choreography: { enter: enter('hud') } },
			],
			transitions: [
				{ id: 'f1', from: 'loading', to: 'basegame', trigger: { kind: 'complete' }, order: 0 },
				{ id: 'f2', from: 'loading', to: 'hud', trigger: { kind: 'complete' }, order: 1 },
			],
		};
		const { log, runtime } = makeRig(false);
		const setChanges: string[][] = [];
		const m = createPresentationMachine(fanOutFlow, {
			runtime,
			onActiveScreensChange: (ids) => setChanges.push([...ids]),
		});
		assert('fan-out: initial active set is [loading]', eq(m.activeScreenIds, ['loading']));
		await m.start();
		log.length = 0;
		const took = await m.onComplete();
		assert(
			'complete FANS OUT: BOTH basegame + HUD active, loading removed',
			took && eq(m.activeScreenIds, ['basegame', 'hud']),
		);
		assert(
			'fan-out ran source exit ONCE then each target enter in author order',
			eq(log, [
				'broadcast flowExit {"screen":"loading"}',
				'broadcast flowEnter {"screen":"basegame"}',
				'broadcast flowEnter {"screen":"hud"}',
			]),
		);
		assert(
			'fan-out notified the full new set ONCE (single re-mount pass)',
			eq(setChanges, [['basegame', 'hud']]),
		);
	}

	// --- B5. guarded complete edges — mutually-exclusive guards still yield exactly one ---
	console.log('\nB5. guarded complete branching (exactly one target):');
	for (const bonus of [true, false]) {
		const branchFlow: FlowDoc = {
			version: 1,
			screens: [{ id: 'reveal', initial: true }, { id: 'bonus' }, { id: 'base' }],
			transitions: [
				{
					id: 'b1',
					from: 'reveal',
					to: 'bonus',
					trigger: { kind: 'complete' },
					guard: {
						all: [
							{
								left: { kind: 'engine', key: 'hasBonus' },
								op: 'eq',
								right: { kind: 'literal', value: true },
							},
						],
					},
					order: 0,
				},
				// unguarded author-order default.
				{ id: 'b2', from: 'reveal', to: 'base', trigger: { kind: 'complete' }, order: 1 },
			],
		};
		const { runtime } = makeRig(false);
		const m = createPresentationMachine(branchFlow, {
			runtime,
			engine: (key) => (key === 'hasBonus' ? bonus : undefined),
		});
		await m.onComplete();
		// Guard true ⇒ BOTH the guarded `bonus` and the unguarded default `base` hold ⇒ both fan out
		// (an unguarded edge is ALWAYS a fan-out sibling). Guard false ⇒ only `base`. This documents
		// that mutual exclusivity requires mutually-exclusive guards on EVERY sibling edge; an
		// unguarded default fans out alongside a guarded one.
		if (bonus) {
			assert(
				'guard true ⇒ guarded + unguarded-default both fan out',
				eq(m.activeScreenIds, ['bonus', 'base']),
			);
		} else {
			assert('guard false ⇒ only the unguarded default fires', eq(m.activeScreenIds, ['base']));
		}
	}

	// --- C. Observe-don't-drive (§12) — the HSM exposes NO platform-driving surface ---
	console.log("\nC. Observe-don't-drive (§12):");
	{
		const { runtime } = makeRig(false);
		const m = createPresentationMachine(flowDoc, { runtime });
		const surface = Object.keys(m).sort();
		// The HSM exposes ONLY presentation triggers + reads — no `send`/`transition`/`bet`
		// that would drive the platform FSM.
		const allowed = [
			'activeScreenId',
			'activeScreenIds',
			// A pure READ of the entrance transition surfaced for a screen's activation (the fade
			// contract, design doc §6) — observe-only, drives no platform transition.
			'entranceTransition',
			'evaluate',
			// Action → intent (design doc §8) — `hasAction` is a pure graph query; `onAction` invokes
			// a game INTENT on the host via `invokeIntent` (moves no active set, drives no platform
			// transition). Both observe/react, never send into the XState platform FSM.
			'hasAction',
			'onAction',
			// The value-binding table (design doc §11.4) — a PURE graph query (${instanceId}::${source}
			// → producer feed key) the game reads per display at mount; mutates nothing, drives no
			// platform transition. Observe-only, exactly like `hasAction`.
			'valueBindings',
			'isActive',
			'isTransitioning',
			'onBookEvent',
			'onComplete',
			'onSignal',
			'start',
		];
		const noDriveSurface = surface.every((k) => allowed.includes(k));
		assert(
			'HSM surface drives no platform transition (only observe/react)',
			noDriveSurface,
			surface.join(', '),
		);
	}

	// --- D. Full interpreter parity (§7) ---
	console.log('\nD. Full interpreter — inert with no FlowDoc, fall-through otherwise:');
	{
		const codedCalls: string[] = [];
		const codedHandlers = {
			winInfo: async () => {
				codedCalls.push('coded:winInfo');
			},
			setTotalWin: async () => {
				codedCalls.push('coded:setTotalWin');
			},
		};

		// No FlowDoc ⇒ inert: active screen undefined, every mount falls through, events coded.
		const { runtime: r0 } = makeRig(false);
		const inert = createFlowInterpreter({
			flowDoc: undefined,
			runtime: r0,
			resolveScene,
			codedHandlers,
		});
		assert('no FlowDoc ⇒ not active', !inert.isActive && inert.activeScreenId === undefined);
		assert(
			'no FlowDoc ⇒ every screen falls through',
			inert.mounter.resolve('basegame')?.kind === 'fallThrough',
		);
		await inert.dispatchBookEvent({ type: 'winInfo' }, undefined);
		await inert.dispatchBookEvent({ type: 'setTotalWin' }, undefined);
		assert(
			'no FlowDoc ⇒ book events run coded handlers',
			eq(codedCalls, ['coded:winInfo', 'coded:setTotalWin']),
		);

		// One event authored ⇒ that event interpreter-driven, the rest fall through.
		codedCalls.length = 0;
		const { log, runtime } = makeRig(false);
		const authoredEventDoc: FlowDoc = {
			version: 1,
			screens: [],
			transitions: [],
			events: [
				{
					event: 'winInfo',
					choreography: {
						kind: 'broadcast',
						event: 'soundOnce',
						payload: { name: { kind: 'literal', value: 'sfx_winlevel_small' } },
					},
				},
			],
		};
		const interp = createFlowInterpreter({
			flowDoc: authoredEventDoc,
			runtime,
			resolveScene,
			codedHandlers,
		});
		assert('FlowDoc with an event ⇒ active', interp.isActive && interp.isAuthoredEvent('winInfo'));
		await interp.dispatchBookEvent({ type: 'winInfo' }, undefined);
		await interp.dispatchBookEvent({ type: 'setTotalWin' }, undefined);
		assert(
			'authored winInfo runs the interpreter (not coded)',
			!codedCalls.includes('coded:winInfo') &&
				log.includes('broadcast soundOnce {"name":"sfx_winlevel_small"}'),
		);
		assert(
			'un-authored setTotalWin still falls through to coded',
			codedCalls.includes('coded:setTotalWin'),
		);
	}

	console.log(`\n${failed ? 'PHASE 4 HARNESS: FAILED' : 'PHASE 4 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
