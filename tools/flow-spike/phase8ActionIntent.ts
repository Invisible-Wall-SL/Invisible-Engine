/**
 * Invisible Flow — Phase 8 action→intent harness (design doc `flow-driven-game.md` §8).
 *
 *   pnpm --filter flow-spike run actionintent
 *
 * Proves, HEADLESSLY against the REAL engine-flow HSM/interpreter + the REAL `deriveScreenPins`
 * and `normalizeFlowDoc`, the Spin-only functional-action-pin slice:
 *
 *  A. Intent pins (§8.3) — `deriveScreenPins(scene, resolve, { intents, isIntentHost })` derives one
 *     `intent` INPUT pin per action key on the HOST screen and NONE on a non-host screen. Stable id
 *     `${screenId}::intent:${key}`, placed right after the structural pins.
 *
 *  B. Runtime INVOKES an intent, moves NO active set (§8.5) — a FlowDoc with a `spin` action edge
 *     into the host's `spin` intent calls `invokeIntent(hostId, 'spin')` EXACTLY ONCE on
 *     `emitAction('spin')`, and `activeScreenIds` is UNCHANGED (no activate/deactivate/notify).
 *     `hasAction('spin')` is true with the edge.
 *
 *  C. Parity (§8.8) — with NO action edge: `hasAction('spin')` is false, `emitAction('spin')` is a
 *     no-op (never calls `invokeIntent`), and the active set is untouched. A guard on an action edge
 *     that fails ⇒ no invoke. An action edge for a DIFFERENT key ⇒ `hasAction('spin')` false.
 *
 *  D. Round-trip (the bake/save contract) — an `action` edge + a `gameplayHost` screen survive
 *     `normalizeFlowDoc` (idempotently); a partial action edge (missing `intent`) is dropped.
 *
 * Determinism: a virtual `waitForTimeout` (resolves immediately). The rig mirrors phase4Runtime.ts.
 */

import {
	createFlowInterpreter,
	createPresentationMachine,
	deriveScreenPins,
	normalizeFlowDoc,
	type ComponentDef,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
	type Scene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — a virtual clock + a no-op emitter (this slice broadcasts nothing itself;
// the intent invoke is what we record).
// ---------------------------------------------------------------------------
const makeRuntime = (): FlowRuntime => ({
	emitter: {
		broadcast: () => {},
		broadcastAsync: () => Promise.resolve([]),
	},
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
});

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

// A minimal HUD scene carrying a spin button instance (the `action` output pin source), and a bare
// base-game scene (the intent host). Shaped like a real LayoutDoc scene the launcher loads.
const hudScene: Scene = {
	id: 'hud',
	name: 'HUD',
	space: 'standard',
	nodes: [
		{
			id: 'n_spin',
			kind: 'componentInstance',
			componentId: 'button',
			label: 'Spin',
			params: { action: 'spin' },
		},
	],
} as unknown as Scene;

const baseScene: Scene = {
	id: 'basegame',
	name: 'Base game',
	space: 'game',
	nodes: [],
} as unknown as Scene;

// A button ComponentDef so the instance's `action` pin resolves (not orphaned).
const buttonDef: ComponentDef = {
	id: 'button',
	name: 'Button',
	params: [{ key: 'action' }],
	root: { id: 'r', kind: 'container', children: [] },
} as unknown as ComponentDef;
const resolveDef = (id: string): ComponentDef | undefined =>
	id === 'button' ? buttonDef : undefined;

// The mounter needs MountableScenes.
const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	hud: { id: 'hud', space: 'standard' },
};
const resolveScene = (id: string): MountableScene | undefined => scenes[id];

const main = async () => {
	console.log('Invisible Flow — Phase 8 action→intent harness\n');

	// --- A. Intent pins on the host only (§8.3) ---
	console.log('A. Intent pins derived on the host, none elsewhere:');
	{
		const hostPins = deriveScreenPins(baseScene, resolveDef, {
			intents: ['spin'],
			isIntentHost: true,
		});
		const intentPins = hostPins.filter((p) => p.role === 'intent');
		assert(
			'host derives exactly one `spin` intent input pin (stable id, direction in)',
			intentPins.length === 1 &&
				intentPins[0].id === 'basegame::intent:spin' &&
				intentPins[0].direction === 'in' &&
				intentPins[0].key === 'spin',
			JSON.stringify(intentPins),
		);
		// Intent pins sit right after the three structural pins (enter, active, complete).
		assert(
			'intent pin is placed right after the structural pins (deterministic order)',
			hostPins[3]?.id === 'basegame::intent:spin',
			hostPins.map((p) => p.id).join(', '),
		);

		const nonHostPins = deriveScreenPins(hudScene, resolveDef, {
			intents: ['spin'],
			isIntentHost: false,
		});
		assert(
			'a non-host screen derives NO intent pins (even with a vocabulary)',
			nonHostPins.every((p) => p.role !== 'intent'),
		);
		// The HUD's spin button still derives its ACTION output pin (the wire source).
		const actionPin = nonHostPins.find((p) => p.role === 'action' && p.key === 'spin');
		assert(
			'the HUD spin button still derives its `action` output pin (the wire source)',
			!!actionPin && actionPin.direction === 'out' && actionPin.id === 'n_spin::action:spin',
			JSON.stringify(actionPin),
		);
	}

	// --- B. Runtime invokes the intent, moves NO active set (§8.5) ---
	console.log('\nB. emitAction invokes the intent exactly once, active set unchanged:');
	{
		const invokes: { screenId: string; intent: string }[] = [];
		const setChanges: string[][] = [];
		// The action edge's SOURCE must be an active screen for its outgoing edges to be considered
		// (`outgoing()` scans the active set). Base game is the active host, so the wire runs
		// basegame's spin action → basegame's spin intent — the real "HUD button owned by the base
		// screen fires the base's spin intent" shape once the HUD is folded into the base's pins.
		const baseSourcedDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }, { id: 'hud' }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'basegame',
					trigger: { kind: 'action', pin: 'spin', intent: 'spin' },
				},
			],
		};
		const m = createPresentationMachine(baseSourcedDoc, {
			runtime: makeRuntime(),
			invokeIntent: (screenId, intent) => invokes.push({ screenId, intent }),
			onActiveScreensChange: (ids) => setChanges.push([...ids]),
		});
		const before = [...m.activeScreenIds];
		assert('hasAction("spin") is true when wired', m.hasAction('spin'));
		const took = await m.onAction('spin');
		assert(
			'emitAction invokes intent exactly once on (host, spin)',
			took && eq(invokes, [{ screenId: 'basegame', intent: 'spin' }]),
			JSON.stringify(invokes),
		);
		assert(
			'active set is UNCHANGED (no activate/deactivate)',
			eq(m.activeScreenIds, before) && eq(before, ['basegame']),
		);
		assert(
			'an action edge fires NO onActiveScreensChange (moves no screen)',
			setChanges.length === 0,
		);
	}

	// --- C. Parity — no action edge, guard-fail, wrong key (§8.8) ---
	console.log('\nC. Parity: no action edge / guard-fail / wrong key ⇒ no invoke, set untouched:');
	{
		// No action edge at all.
		const invokes: string[] = [];
		const parityDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }],
			transitions: [],
		};
		const m = createPresentationMachine(parityDoc, {
			runtime: makeRuntime(),
			invokeIntent: (_s, i) => invokes.push(i),
		});
		assert('hasAction("spin") is false with no action edge', !m.hasAction('spin'));
		const took = await m.onAction('spin');
		assert(
			'emitAction is a no-op with no action edge (no invoke, set untouched)',
			!took && invokes.length === 0 && eq(m.activeScreenIds, ['basegame']),
		);

		// Guard on the action edge that fails ⇒ no invoke.
		const guardedDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'basegame',
					trigger: { kind: 'action', pin: 'spin', intent: 'spin' },
					guard: {
						all: [
							{
								left: { kind: 'engine', key: 'canSpin' },
								op: 'eq',
								right: { kind: 'literal', value: true },
							},
						],
					},
				},
			],
		};
		const guardInvokes: string[] = [];
		const mg = createPresentationMachine(guardedDoc, {
			runtime: makeRuntime(),
			engine: () => false, // canSpin = false ⇒ guard fails
			invokeIntent: (_s, i) => guardInvokes.push(i),
		});
		assert('guard-failing action edge ⇒ hasAction false', !mg.hasAction('spin'));
		await mg.onAction('spin');
		assert('guard-failing action edge ⇒ no invoke', guardInvokes.length === 0);

		// An action edge for a DIFFERENT key ⇒ hasAction('spin') false.
		const otherDoc: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true }],
			transitions: [
				{
					id: 't1',
					from: 'basegame',
					to: 'basegame',
					trigger: { kind: 'action', pin: 'buyBonus', intent: 'buyBonus' },
				},
			],
		};
		const mo = createPresentationMachine(otherDoc, { runtime: makeRuntime() });
		assert("action edge for another key ⇒ hasAction('spin') false", !mo.hasAction('spin'));
	}

	// --- C2. Full interpreter parity — inert with no FlowDoc ---
	console.log('\nC2. Full interpreter: inert ⇒ hasAction false, emitAction no-op:');
	{
		const invokes: string[] = [];
		const inert = createFlowInterpreter({
			flowDoc: undefined,
			runtime: makeRuntime(),
			resolveScene,
			codedHandlers: {},
			invokeIntent: (_s, i) => invokes.push(i),
		});
		assert('inert interpreter ⇒ hasAction("spin") false', !inert.hasAction('spin'));
		const took = await inert.emitAction('spin');
		assert('inert interpreter ⇒ emitAction no-op', !took && invokes.length === 0);

		// A wired interpreter routes through invokeIntent.
		const wiredInvokes: { s: string; i: string }[] = [];
		const wired = createFlowInterpreter({
			flowDoc: {
				version: 1,
				screens: [{ id: 'basegame', initial: true }],
				transitions: [
					{
						id: 't1',
						from: 'basegame',
						to: 'basegame',
						trigger: { kind: 'action', pin: 'spin', intent: 'spin' },
					},
				],
			},
			runtime: makeRuntime(),
			resolveScene,
			codedHandlers: {},
			invokeIntent: (s, i) => wiredInvokes.push({ s, i }),
		});
		assert('wired interpreter ⇒ hasAction("spin") true', wired.hasAction('spin'));
		await wired.emitAction('spin');
		assert(
			'wired interpreter ⇒ emitAction invokes (basegame, spin) once',
			eq(wiredInvokes, [{ s: 'basegame', i: 'spin' }]),
		);
	}

	// --- D. Round-trip (the bake/save contract) ---
	console.log('\nD. normalize round-trips the action edge + gameplayHost; drops partials:');
	{
		const authored: FlowDoc = {
			version: 1,
			screens: [{ id: 'basegame', initial: true, gameplayHost: true }, { id: 'hud' }],
			transitions: [
				{
					id: 't1',
					from: 'hud',
					to: 'basegame',
					trigger: { kind: 'action', pin: 'spin', intent: 'spin' },
				},
			],
		};
		const once = normalizeFlowDoc(authored);
		const twice = normalizeFlowDoc(JSON.parse(JSON.stringify(once)));
		assert('gameplayHost survives normalize', once.screens[0].gameplayHost === true);
		assert(
			'action edge survives normalize (pin + intent kept)',
			eq(once.transitions[0].trigger, { kind: 'action', pin: 'spin', intent: 'spin' }),
		);
		assert('normalize is idempotent for the action edge + host', eq(once, twice));

		// A partial action edge (missing intent) is dropped, not stored.
		const partial = normalizeFlowDoc({
			version: 1,
			screens: [{ id: 'a', initial: true }],
			transitions: [{ id: 't', from: 'a', to: 'a', trigger: { kind: 'action', pin: 'spin' } }],
		});
		assert('a partial action edge (no intent) is dropped', partial.transitions.length === 0);
	}

	console.log(
		`\n${failed ? 'PHASE 8 ACTION→INTENT HARNESS: FAILED' : 'PHASE 8 ACTION→INTENT HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
