/**
 * Invisible Flow — FS-6 free-spin OWNERSHIP switch harness (design doc §14, §7).
 *
 *   pnpm --filter flow-spike run fs6
 *
 * Proves, HEADLESSLY, the FS-6 auto-derived ownership flip against the REAL pure predicate
 * (`freeSpinOwnership.ts`) + the REAL engine-flow interpreter over the REAL
 * `LINES_FLOW_FREESPIN_DOC` (with its FULL Phase-5 free-spin choreographies):
 *
 *  A. PREDICATE conjunction — `flowOwnsFreeSpins` is FALSE unless BOTH (i) the doc wires the three
 *     free-spin LAYER edges + places the backing screens AND (ii) all four scenes carry real
 *     authored content. Wiring-only, content-only, partial-content, and fallback-anchor-only cases
 *     all stay OFF; only the full conjunction flips ON. (A stray node in ONE scene can't flip it.)
 *  B. GATE — `gateFreeSpinOwnership(doc, false)` STRIPS the free-spin events + overlay
 *     transitions/screens (so they fall through to coded); `(doc, true)` returns the doc unchanged.
 *  C. OFF MODE (coded owns) — with the gated-OFF doc the interpreter authors NO free-spin event
 *     (they fall through to the coded handlers) and the free-spin book events cause NO active-set
 *     layering (base stays alone). Byte-parity with pre-FS-6 fall-through.
 *  D. ON MODE (flow owns) — with the gated-ON doc the free-spin events ARE authored (run the full
 *     choreographies → their load-bearing EFFECTS run AND they STILL broadcast the `*Show`/`*CountUp`
 *     events that arm the kept round-gates), the coded handler does NOT run for them (no double), and
 *     the overlay screens LAYER over the persistent base. Turbo on/off identical.
 *  E. ATOMIC-FLIP invariant — for the SAME resolved doc + scenes, the predicate value that gates the
 *     interpreter's event-authoring is the SAME one `Game.svelte` uses for the coded-mount gate:
 *     ownership ⟺ gated-doc-authors-the-free-spin-events. Never one without the other.
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';
import type { Scene } from 'engine-layout';

import { LINES_FLOW_FREESPIN_DOC } from '../../apps/lines/src/game/flowDoc';
import {
	flowOwnsFreeSpins,
	gateFreeSpinOwnership,
} from '../../apps/lines/src/game/freeSpinOwnership';

// ---------------------------------------------------------------------------
// Recording rig — logs broadcasts AND which named effects ran (the load-bearing state leaves).
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const effectsRan: string[] = [];
	const { eventEmitter } = createEventEmitter<EmitterEvent>();
	const recording = {
		broadcast: (e: EmitterEvent) => {
			log.push(`broadcast ${e.type}`);
			eventEmitter.broadcast(e);
		},
		broadcastAsync: (e: EmitterEvent) => {
			log.push(`broadcastAsync ${e.type}`);
			return eventEmitter.broadcastAsync(e);
		},
	};
	const runtime: FlowRuntime = {
		emitter: recording,
		timeScale: () => (turbo ? 2 : 1),
		waitForTimeout: (ms) => {
			log.push(`delay ${ms}`);
			return Promise.resolve();
		},
		// Record every named effect the choreography invokes (the load-bearing gameType/counter/sound
		// leaves) so ON mode can assert they ran. Returns a no-op body (the harness only needs the fact).
		effect: (name: string) => () => void effectsRan.push(name),
	};
	return { log, effectsRan, runtime };
};

const mountScenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'canvas' },
	freeSpinCounter: { id: 'freeSpinCounter', space: 'canvas' },
	freeSpinRetrigger: { id: 'freeSpinRetrigger', space: 'canvas' },
	freeSpinOutro: { id: 'freeSpinOutro', space: 'canvas' },
};

const CONTEXT = { bookEvents: [] as unknown[] };

// ---------------------------------------------------------------------------
// Synthetic editor scenes — the LIVE `Scene[]` the predicate reads for condition (ii).
// ---------------------------------------------------------------------------

/** A scene with REAL authored content (an author-placed image node) — satisfies (ii). */
const authoredScene = (id: string): Scene => ({
	id,
	name: id,
	space: 'canvas',
	nodes: [{ id: `${id}-art`, kind: 'sprite', x: 0, y: 0, asset: 'fs.png' } as never],
});

/** A scene carrying ONLY the coded engine bind-anchor (the reference FALLBACK) — fails (ii). */
const codedAnchorScene = (id: string, component: string): Scene => ({
	id,
	name: id,
	space: 'canvas',
	nodes: [
		{
			id: `${id}-anchor`,
			kind: 'container',
			x: 0,
			y: 0,
			bind: { component },
			children: [],
		} as never,
	],
});

/** The coded counter scene (a `freeSpinCounter` componentInstance) — coded scaffolding, fails (ii). */
const codedCounterScene = (): Scene => ({
	id: 'freeSpinCounter',
	name: 'freeSpinCounter',
	space: 'canvas',
	nodes: [
		{
			id: 'fs-counter',
			kind: 'componentInstance',
			componentId: 'freeSpinCounter',
			x: 0,
			y: 0,
			params: {},
		} as never,
	],
});

/** All four fs scenes with authored content ⇒ condition (ii) holds. */
const AUTHORED_SCENES: Scene[] = [
	authoredScene('freeSpinIntro'),
	authoredScene('freeSpinCounter'),
	authoredScene('freeSpinRetrigger'),
	authoredScene('freeSpinOutro'),
];

/** The reference-fallback fs scenes (coded anchors only) ⇒ condition (ii) fails. */
const FALLBACK_SCENES: Scene[] = [
	codedAnchorScene('freeSpinIntro', 'FreeSpinIntroVisual'),
	codedCounterScene(),
	codedAnchorScene('freeSpinOutro', 'FreeSpinOutroVisual'),
];

const makeInterp = (
	doc: FlowDoc,
	rig: ReturnType<typeof makeRig>,
	setChanges: string[][],
	codedRan: string[],
) =>
	createFlowInterpreter<{ type: string }, { bookEvents: unknown[] }>({
		flowDoc: doc,
		runtime: rig.runtime,
		resolveScene: (id) => mountScenes[id],
		onActiveScreensChange: (ids) => setChanges.push([...ids]),
		codedHandlers: {
			freeSpinTrigger: async () => void codedRan.push('freeSpinTrigger'),
			updateFreeSpin: async () => void codedRan.push('updateFreeSpin'),
			freeSpinEnd: async () => void codedRan.push('freeSpinEnd'),
			reveal: async () => void codedRan.push('reveal'),
		},
	});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const eqJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const main = async () => {
	console.log('Invisible Flow — FS-6 free-spin ownership switch harness\n');

	// --- A. predicate conjunction ---
	console.log('A. predicate conjunction (flowOwnsFreeSpins):');
	{
		// Full conjunction: the fixture wires the edges + screens, and all four scenes are authored.
		assert(
			'wired doc + all four scenes authored ⇒ ON',
			flowOwnsFreeSpins(LINES_FLOW_FREESPIN_DOC, AUTHORED_SCENES) === true,
		);
		// Wiring present but scenes are the coded fallback (only anchors) ⇒ OFF (content fails (ii)).
		assert(
			'wired doc + FALLBACK scenes (coded anchors only) ⇒ OFF (content fails)',
			flowOwnsFreeSpins(LINES_FLOW_FREESPIN_DOC, FALLBACK_SCENES) === false,
		);
		// Content present but the doc does NOT wire the free-spin edges ⇒ OFF (wiring fails (i)).
		const unwiredDoc: FlowDoc = {
			version: 1,
			projectKey: 'lines',
			screens: [{ id: 'basegame', initial: true }],
			transitions: [],
			events: [],
		};
		assert(
			'authored scenes + UNWIRED doc ⇒ OFF (wiring fails)',
			flowOwnsFreeSpins(unwiredDoc, AUTHORED_SCENES) === false,
		);
		// A stray authored node in ONE scene only (the other two still fallback) ⇒ OFF.
		const partial: Scene[] = [
			authoredScene('freeSpinIntro'),
			codedCounterScene(),
			codedAnchorScene('freeSpinOutro', 'FreeSpinOutroVisual'),
		];
		assert(
			'authored content in ONE scene only ⇒ OFF (a stray node can never flip ownership)',
			flowOwnsFreeSpins(LINES_FLOW_FREESPIN_DOC, partial) === false,
		);
		// No doc ⇒ OFF.
		assert('undefined doc ⇒ OFF', flowOwnsFreeSpins(undefined, AUTHORED_SCENES) === false);
	}

	// --- B. gate strips OFF, passes through ON ---
	console.log('\nB. gateFreeSpinOwnership:');
	{
		const off = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, false);
		const fsEvents = (off.events ?? []).filter((e) =>
			['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].includes(e.event),
		);
		const fsScreens = off.screens.filter((s) => s.id.startsWith('freeSpin'));
		const fsEdges = off.transitions.filter(
			(t) => t.from.startsWith('freeSpin') || t.to.startsWith('freeSpin'),
		);
		assert(
			'OFF ⇒ free-spin events + overlay screens + overlay edges all STRIPPED',
			fsEvents.length === 0 && fsScreens.length === 0 && fsEdges.length === 0,
		);
		// Non-free-spin content survives (basegame screen + the base events like reveal/winInfo).
		assert(
			'OFF ⇒ base screen + non-free-spin events survive (reveal/winInfo authored)',
			off.screens.some((s) => s.id === 'basegame') &&
				(off.events ?? []).some((e) => e.event === 'reveal'),
		);
		const on = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, true);
		assert('ON ⇒ doc returned unchanged (===)', on === LINES_FLOW_FREESPIN_DOC);
	}

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;

		// --- C. OFF mode — coded owns, events fall through, no layering ---
		console.log(`\nC. OFF mode — coded owns, free-spin events fall through, no layering (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const gatedOff = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, false);
			const interp = makeInterp(gatedOff, rig, setChanges, codedRan);
			await interp.start();
			assert(`OFF: base only at boot (${tag})`, eqJson(interp.activeScreenIds, ['basegame']));
			assert(
				`OFF: free-spin events are NOT authored (fall through) (${tag})`,
				!interp.isAuthoredEvent('freeSpinTrigger') &&
					!interp.isAuthoredEvent('updateFreeSpin') &&
					!interp.isAuthoredEvent('freeSpinEnd'),
			);
			await interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, CONTEXT);
			await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
			await interp.dispatchBookEvent({ type: 'freeSpinEnd' }, CONTEXT);
			await settle();
			assert(
				`OFF: coded handlers ran for all 3 free-spin events (${tag})`,
				codedRan.includes('freeSpinTrigger') &&
					codedRan.includes('updateFreeSpin') &&
					codedRan.includes('freeSpinEnd'),
			);
			assert(
				`OFF: NO active-set layering (base stayed alone the whole time) (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame']) &&
					setChanges.every((s) => eqJson(s, ['basegame'])),
			);
			assert(
				`OFF: choreography EFFECTS did NOT run (coded owns state) (${tag})`,
				rig.effectsRan.length === 0,
			);
		}

		// --- D. ON mode — flow owns, choreographies run + arm gates, no coded double ---
		console.log(`\nD. ON mode — flow owns visuals, choreographies run, no coded double (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const gatedOn = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, true);
			const interp = makeInterp(gatedOn, rig, setChanges, codedRan);
			await interp.start();
			assert(
				`ON: free-spin events ARE authored (interpreter-driven) (${tag})`,
				interp.isAuthoredEvent('freeSpinTrigger') &&
					interp.isAuthoredEvent('updateFreeSpin') &&
					interp.isAuthoredEvent('freeSpinEnd'),
			);

			await interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, CONTEXT);
			await settle();
			// The coded handler must NOT run (authored wins) — no double-present.
			assert(
				`ON: coded freeSpinTrigger handler did NOT run (no double) (${tag})`,
				!codedRan.includes('freeSpinTrigger'),
			);
			// The load-bearing effects ran (gameType/counter/sound state).
			assert(
				`ON: load-bearing effects ran (setFreeGameType + counter) (${tag})`,
				rig.effectsRan.includes('setFreeGameType') &&
					rig.effectsRan.includes('setFreeSpinCounterTotalOnly'),
			);
			// The choreography STILL broadcasts the events that arm the kept round-gates.
			assert(
				`ON: still broadcasts freeSpinIntroShow + freeSpinIntroUpdate (arm the kept gate) (${tag})`,
				rig.log.includes('broadcast freeSpinIntroShow') &&
					rig.log.includes('broadcastAsync freeSpinIntroUpdate'),
			);
			// The overlay screen LAYERED over the persistent base (active-set ownership).
			assert(
				`ON: freeSpinIntro LAYERED over persistent basegame (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinIntro']),
			);

			// freeSpinEnd → the outro choreography arms the outro gate + count-up.
			await interp.completeActiveScreen(); // dismiss intro
			await settle();
			rig.log.length = 0;
			rig.effectsRan.length = 0;
			await interp.dispatchBookEvent({ type: 'freeSpinEnd' }, CONTEXT);
			await settle();
			// The outro gate is armed by `freeSpinOutroShow` (a direct broadcast) + the count-up. The
			// count-up rides an EFFECT (`freeSpinOutroCountUp`, whose real body broadcasts the awaited
			// `freeSpinOutroCountUp` → the gate's `waitForResolve`), so assert BOTH the direct broadcast
			// and that the count-up effect ran (its body arms the gate in-game).
			assert(
				`ON: freeSpinEnd broadcasts freeSpinOutroShow + runs the freeSpinOutroCountUp effect (arm outro gate) (${tag})`,
				rig.log.includes('broadcast freeSpinOutroShow') &&
					rig.effectsRan.includes('freeSpinOutroCountUp'),
			);
			assert(
				`ON: outro load-bearing effects ran (enterFreeSpinOutro sets gameType=basegame) (${tag})`,
				rig.effectsRan.includes('enterFreeSpinOutro') &&
					rig.effectsRan.includes('exitFreeSpinOutro'),
			);
			assert(`ON: coded freeSpinEnd did NOT run (${tag})`, !codedRan.includes('freeSpinEnd'));
		}
	}

	// --- E. atomic-flip invariant ---
	console.log('\nE. atomic-flip — ownership predicate ⟺ gated-doc authors the free-spin events:');
	{
		for (const [label, scenes] of [
			['authored', AUTHORED_SCENES],
			['fallback', FALLBACK_SCENES],
		] as const) {
			const owns = flowOwnsFreeSpins(LINES_FLOW_FREESPIN_DOC, scenes);
			const gated = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, owns);
			const authorsFsEvents = (gated.events ?? []).some((e) =>
				['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].includes(e.event),
			);
			const mountsCodedScenes = !owns; // Game.svelte mounts coded fs scenes iff !owns
			// Atomic: the doc authors the free-spin events EXACTLY when the coded mount is suppressed.
			assert(
				`${label}: event-authoring (${authorsFsEvents}) ⟺ coded-mount-suppressed (${!mountsCodedScenes}) ⟺ owns (${owns})`,
				authorsFsEvents === owns && !mountsCodedScenes === owns,
			);
		}
	}

	console.log(`\n${failed ? 'FS-6 HARNESS: FAILED' : 'FS-6 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
