/**
 * Invisible Flow — FS-6 PER-STEP free-spin OWNERSHIP harness (design doc §14, §7).
 *
 *   pnpm --filter flow-spike run fs6
 *
 * Proves, HEADLESSLY, the FS-6 auto-derived PER-STEP ownership flip against the REAL pure predicate
 * (`freeSpinOwnership.ts` — `resolveFreeSpinOwnership` + `gateFreeSpinOwnership`) + the REAL
 * engine-flow interpreter over the REAL `LINES_FLOW_FREESPIN_DOC` (with its FULL Phase-5 free-spin
 * choreographies). Since the owner's 2026-07-03 PER-STEP direction, ownership is decided
 * INDEPENDENTLY for each overlay step — intro (`freeSpinTrigger`/`freeSpinIntro`), counter
 * (`updateFreeSpin`/`freeSpinCounter`), retrigger (`freeSpinRetrigger`/`freeSpinRetrigger`), outro
 * (`freeSpinEnd`/`freeSpinOutro`) — so a step can be authored on its own while the others fall
 * through to their coded handlers. MIXED states are valid. Since FS-4 landed (#142), `retrigger`
 * is a FIRST-CLASS optional step like the rest — owned when authored, stripped when not — NOT the
 * always-stripped seam this harness asserted before it.
 *
 *  A. PREDICATE per-step conjunction — a step is owned iff (i) its screen is placed + (ii) its
 *     bookEvent edge is wired + (iii) its backing scene carries REAL authored content. Vary each of
 *     the three knobs to prove EACH condition independently gates its OWN step (and only its own).
 *  B. GATE per-step atomic strip — `gateFreeSpinOwnership(doc, ownership)` keeps each OWNED step's
 *     event + overlay screen + transitions and STRIPS every UN-owned step's (independently) —
 *     `freeSpinRetrigger` included, kept when authored and stripped when not. The gate only ever
 *     STRIPS, so a step is kept iff the doc CARRIED it AND it is owned. Non-free-spin content is
 *     untouched.
 *  C. INTERPRETER per-combo — for the SEVEN per-step combinations (intro-only, counter-only,
 *     outro-only, intro+outro, all-three, all-four, none) drive the interpreter over the gated doc
 *     + synthetic book events, turbo on/off. For each combo assert PER STEP:
 *       - OWNED  ⇒ event AUTHORED (coded handler skipped, no double), overlay screen SURVIVES the gate
 *                  and LAYERS over the persistent base, and its load-bearing effects run.
 *       - UN-OWNED ⇒ event FALLS THROUGH (coded handler ran), overlay screen STRIPPED (no layering).
 *     Plus: the load-bearing gameType/counter chain is byte-identical to the fully-coded run;
 *     whichever of intro/outro is PRESENT still ARMS its round-gate (the `*Show`/`*CountUp`
 *     broadcasts fire on WHICHEVER path runs — authored OR coded); no step is double-present.
 *  D. ATOMIC-FLIP per step — for the SAME resolved doc + scenes, per step: event-authoring in the
 *     gated doc ⟺ `Game.svelte`'s coded-mount suppression ⟺ `ownership.owns(step)`. Never one
 *     without the other, independently per step.
 *  E. NONE (all-OFF) — byte-identical to the fully-coded run (every fs event falls through, no
 *     overlay layers, base stays alone) — the pre-FS-6 fall-through parity.
 *  F. GENERIC EQUIVALENCE — the generic `engine-flow` core (`resolveOverlayOwnership` +
 *     `gateOverlayOwnership`) run DIRECTLY over `FS_OVERLAY_STEPS` returns byte-identical results
 *     to the legacy lines wrappers, across every combo + knob. Lines passes NO seam list: since
 *     FS-4 there is no always-stripped screen, so the generic gate must match the legacy exactly.
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	gateOverlayOwnership,
	resolveOverlayOwnership,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
	type OverlayScene,
} from 'engine-flow';
import type { LayoutNode, Scene } from 'engine-layout';

import { LINES_FLOW_FREESPIN_DOC } from '../../apps/lines/src/game/flowDoc';
import {
	FREE_SPIN_STEPS,
	FS_OVERLAY_STEPS,
	gateFreeSpinOwnership,
	resolveFreeSpinOwnership,
	type FreeSpinOwnership,
	type FreeSpinStep,
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
		// leaves) so ON steps can assert they ran. Returns a no-op body (the harness only needs the fact).
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
// Synthetic editor scenes — the LIVE `Scene[]` the predicate reads for condition (iii).
// ---------------------------------------------------------------------------

/** A scene with REAL authored content (an author-placed image node) — satisfies (iii). */
const authoredScene = (id: string): Scene => ({
	id,
	name: id,
	space: 'canvas',
	nodes: [
		{ id: `${id}-art`, kind: 'sprite', x: 0, y: 0, asset: 'fs.png' } as unknown as LayoutNode,
	],
});

/** A scene carrying ONLY the coded engine bind-anchor (the reference FALLBACK) — fails (iii). */
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
		} as unknown as LayoutNode,
	],
});

/** The coded counter scene (a `freeSpinCounter` componentInstance) — coded scaffolding, fails (iii). */
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
		} as unknown as LayoutNode,
	],
});

/** An EMPTY scene — the un-authored `retrigger` fallback. `retrigger` has NO coded bind-anchor
 *  (its coded fallback is the present-nothing no-op handler), so ANY node in a `freeSpinRetrigger`
 *  scene counts as authored content and only an EMPTY scene fails (iii). */
const emptyScene = (id: string): Scene => ({ id, name: id, space: 'canvas', nodes: [] });

/** The FALLBACK backing scene for a step (coded scaffolding only, or empty) — fails (iii). */
const fallbackSceneFor = (step: FreeSpinStep): Scene => {
	if (step === 'intro') return codedAnchorScene('freeSpinIntro', 'FreeSpinIntroVisual');
	if (step === 'counter') return codedCounterScene();
	if (step === 'retrigger') return emptyScene('freeSpinRetrigger');
	return codedAnchorScene('freeSpinOutro', 'FreeSpinOutroVisual');
};

const ALL_STEPS: FreeSpinStep[] = ['intro', 'counter', 'retrigger', 'outro'];

/** A per-step authored/fallback combo. `retrigger` defaults OFF — the parity default an
 *  un-authored game ships (FS-4 made it a first-class OPTIONAL step, not an always-on one). */
const combo = (
	intro: boolean,
	counter: boolean,
	outro: boolean,
	retrigger = false,
): Record<FreeSpinStep, boolean> => ({ intro, counter, retrigger, outro });

/** The per-step ownership matrix the gate + generic-equivalence blocks both run: the six
 *  intro/counter/outro mixes plus the two that exercise the FS-4 retrigger step (retrigger-only,
 *  and all four authored). `[intro, counter, outro, retrigger]`. */
const GATE_COMBOS: readonly (readonly [boolean, boolean, boolean, boolean])[] = [
	[true, false, false, false],
	[false, true, false, false],
	[false, false, true, false],
	[true, false, true, false],
	[true, true, true, false],
	[false, false, false, false],
	[false, false, false, true],
	[true, true, true, true],
];

/** Build the LIVE scenes so `resolveFreeSpinOwnership` sees each step authored or fallback. */
const scenesFor = (owned: Record<FreeSpinStep, boolean>): Scene[] =>
	ALL_STEPS.map((step) =>
		owned[step] ? authoredScene(FREE_SPIN_STEPS[step].screen) : fallbackSceneFor(step),
	);

/** Resolve the per-step ownership object for a combo, driving condition (iii) via scene content
 *  over the FULLY-wired `LINES_FLOW_FREESPIN_DOC` (which places every screen + wires every edge, so
 *  (i)+(ii) always hold — scene content is the flipped knob here). */
const ownershipFor = (owned: Record<FreeSpinStep, boolean>): FreeSpinOwnership =>
	resolveFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, scenesFor(owned));

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

// Per-step load-bearing effects the AUTHORED choreography runs (from flowDoc.ts). Used to assert an
// OWNED step's authored path ran the state leaves; an UN-OWNED step falls through so they are absent
// on the interpreter side (the coded handler runs them instead — proven by `codedRan`).
const OWNED_EFFECTS: Record<FreeSpinStep, string[]> = {
	intro: ['setFreeGameType', 'setFreeSpinCounterTotalOnly'],
	counter: ['updateFreeSpinCounter'],
	// The retrigger step's authored chain lives in Flow v2 (`onFreeSpinRetrigger` →
	// `showContainer`), not in this v1 doc's event choreographies — so it runs no v1 effects here.
	// Covered by `fs4`.
	retrigger: [],
	outro: ['enterFreeSpinOutro', 'exitFreeSpinOutro', 'freeSpinOutroCountUp'],
};
// Per-step round-gate ARM broadcasts (the `*Show`/`*CountUp` events that arm the kept
// FreeSpinIntroGate/FreeSpinOutroGate). Intro + outro carry a round-gate; the counter does not.
const GATE_ARM_BROADCASTS: Partial<Record<FreeSpinStep, string[]>> = {
	intro: ['broadcast freeSpinIntroShow'],
	outro: ['broadcast freeSpinOutroShow'],
};

const main = async () => {
	console.log('Invisible Flow — FS-6 PER-STEP free-spin ownership harness\n');

	// --- A. predicate per-step conjunction — each condition gates its OWN step independently ---
	console.log('A. predicate per-step conjunction (resolveFreeSpinOwnership):');
	{
		// All four authored + fully wired ⇒ all four owned (retrigger included since FS-4).
		const all = ownershipFor(combo(true, true, true, true));
		assert(
			'all authored + wired ⇒ intro+counter+retrigger+outro ALL owned',
			all.ownsIntro && all.ownsCounter && all.ownsRetrigger && all.ownsOutro && !all.none,
		);

		// (iii) content knob: flip ONE step's scene to its fallback ⇒ ONLY that step drops.
		for (const step of ALL_STEPS) {
			const owned = combo(true, true, true, true);
			owned[step] = false;
			const o = ownershipFor(owned);
			assert(
				`content: ${step} scene = fallback ⇒ ${step} OFF, the other three stay ON`,
				!o.owns(step) && ALL_STEPS.filter((s) => s !== step).every((s) => o.owns(s)),
			);
		}

		// (i) screen-placement knob: a doc that does NOT PLACE a step's screen ⇒ that step OFF even
		// with authored scene content + a wired edge. Run for EVERY step, so the retrigger step is held
		// to the same conjunction as the rest.
		for (const step of ALL_STEPS) {
			const { screen } = FREE_SPIN_STEPS[step];
			const docNoScreen: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				screens: LINES_FLOW_FREESPIN_DOC.screens.filter((s) => s.id !== screen),
			};
			const o = resolveFreeSpinOwnership(docNoScreen, scenesFor(combo(true, true, true, true)));
			assert(
				`placement: doc omits the ${screen} screen ⇒ ${step} OFF (i fails), the other three ON`,
				!o.owns(step) && ALL_STEPS.filter((x) => x !== step).every((x) => o.owns(x)),
			);
		}

		// (ii) edge-wiring knob: a doc that does NOT WIRE a step's bookEvent edge ⇒ that step OFF even
		// with its screen placed + authored scene content.
		for (const step of ALL_STEPS) {
			const { event } = FREE_SPIN_STEPS[step];
			const docNoEdge: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				transitions: LINES_FLOW_FREESPIN_DOC.transitions.filter(
					(t) => !(t.trigger.kind === 'bookEvent' && t.trigger.event === event),
				),
			};
			const o = resolveFreeSpinOwnership(docNoEdge, scenesFor(combo(true, true, true, true)));
			assert(
				`wiring: doc omits the ${event} edge ⇒ ${step} OFF (ii fails), the other three ON`,
				!o.owns(step) && ALL_STEPS.filter((x) => x !== step).every((x) => o.owns(x)),
			);
		}

		// No doc ⇒ every step OFF (coded, parity).
		const noDoc = resolveFreeSpinOwnership(undefined, scenesFor(combo(true, true, true, true)));
		assert(
			'undefined doc ⇒ none owned',
			noDoc.none && ALL_STEPS.every((step) => !noDoc.owns(step)),
		);
	}

	// --- B. gate strips each UN-owned step independently (retrigger included since FS-4) ---
	// The gate only ever STRIPS — never adds — so the per-step invariant is: kept iff the ORIGINAL
	// doc CARRIED it AND the step is owned. That distinction is load-bearing for `retrigger`, whose
	// screen + LAYER edge the doc carries but whose `freeSpinRetrigger` event choreography it does
	// NOT (FS-4 authoring is the Flow-v2 `onFreeSpinRetrigger` → `showContainer` chain, not a v1
	// event entry).
	console.log('\nB. gateFreeSpinOwnership — per-step strip (retrigger is a step, not a seam):');
	{
		for (const [intro, counter, outro, retrigger] of GATE_COMBOS) {
			const ownership = ownershipFor(combo(intro, counter, outro, retrigger));
			const gated = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, ownership);
			const tag = `intro=${intro} counter=${counter} outro=${outro} retrigger=${retrigger}`;
			let ok = true;
			for (const step of ALL_STEPS) {
				const { screen, event } = FREE_SPIN_STEPS[step];
				const carried = (d: FlowDoc) => ({
					screen: d.screens.some((s) => s.id === screen),
					event: (d.events ?? []).some((e) => e.event === event),
					edges: d.transitions.some((t) => t.from === screen || t.to === screen),
				});
				const before = carried(LINES_FLOW_FREESPIN_DOC);
				const after = carried(gated);
				const want = ownership.owns(step);
				// Owned ⇒ all the doc carried for this step survives; un-owned ⇒ all of it is gone.
				if (
					after.screen !== (before.screen && want) ||
					after.event !== (before.event && want) ||
					after.edges !== (before.edges && want)
				) {
					ok = false;
				}
			}
			// Non-free-spin content untouched (basegame screen + reveal event survive every combo).
			const baseKept =
				gated.screens.some((s) => s.id === 'basegame') &&
				(gated.events ?? []).some((e) => e.event === 'reveal');
			assert(`gate keeps owned / strips un-owned, per step (${tag})`, ok && baseKept);
		}
	}

	// --- C + D. interpreter per-combo — per-step authoring ⟺ mount-suppression ⟺ ownership ---
	// The load-bearing chain baseline: intro sets gameType=freegame, outro sets it back — that chain
	// must run under ANY mix (each event runs EITHER its authored choreography OR its coded handler,
	// each of which does THAT step's own state). We prove it by asserting each step's state runs on
	// EXACTLY one path (authored effect ran ⟺ owned; coded handler ran ⟺ un-owned) — never both,
	// never neither. That is the byte-identical-to-fully-coded guarantee, per step.
	const COMBOS: [FreeSpinStep[], string][] = [
		[['intro'], 'intro-only (counter+outro coded)'],
		[['counter'], 'counter-only (intro+outro coded)'],
		[['outro'], 'outro-only (intro+counter coded)'],
		[['intro', 'outro'], 'intro+outro (counter coded)'],
		[['intro', 'counter', 'outro'], 'all-three'],
		[['intro', 'counter', 'retrigger', 'outro'], 'all-four (retrigger authored too)'],
		[[], 'none (all coded)'],
	];

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;
		for (const [ownedSteps, comboLabel] of COMBOS) {
			const owned = combo(
				ownedSteps.includes('intro'),
				ownedSteps.includes('counter'),
				ownedSteps.includes('outro'),
				ownedSteps.includes('retrigger'),
			);
			const ownership = ownershipFor(owned);
			console.log(`\nC/D. ${comboLabel} (${tag}):`);

			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const gated = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, ownership);
			const interp = makeInterp(gated, rig, setChanges, codedRan);
			await interp.start();
			assert(
				`base only at boot (${comboLabel}, ${tag})`,
				eqJson(interp.activeScreenIds, ['basegame']),
			);

			// Fire the three fs events in lifecycle order, dismissing each owned overlay so the next
			// layers cleanly. (An un-owned overlay never layers, so there is nothing to dismiss.)
			const dispatchAndDismiss = async (step: FreeSpinStep) => {
				const { event, screen } = FREE_SPIN_STEPS[step];
				await interp.dispatchBookEvent({ type: event }, CONTEXT);
				await settle();
				const authored = interp.isAuthoredEvent(event);
				const want = ownership.owns(step);
				// D. per-step atomic flip: event-authoring ⟺ ownership (⟺ coded-mount-suppressed).
				assert(
					`${step}: event-authoring (${authored}) ⟺ owns (${want}) — atomic flip (${tag})`,
					authored === want,
				);
				// The load-bearing state runs on EXACTLY one path: authored effects ⟺ owned; coded
				// handler ⟺ un-owned. Never both (double), never neither (byte-identical to fully-coded).
				const authoredEffectsRan = OWNED_EFFECTS[step].every((n) => rig.effectsRan.includes(n));
				const codedRanForStep = codedRan.includes(event);
				assert(
					`${step}: load-bearing state on EXACTLY one path (authored=${authoredEffectsRan} coded=${codedRanForStep}) — owned=${want} (${tag})`,
					authoredEffectsRan === want && codedRanForStep === !want,
				);
				assert(
					`${step}: no double-present (authored XOR coded ran) (${tag})`,
					authoredEffectsRan !== codedRanForStep,
				);
				// The overlay screen: owned ⇒ it LAYERED over the persistent base; un-owned ⇒ its screen
				// was stripped so nothing layered (base stayed alone through the dispatch).
				const layered = interp.activeScreenIds.includes(screen);
				assert(
					`${step}: overlay ${want ? 'LAYERS' : 'does NOT layer (stripped)'} over persistent base (${tag})`,
					layered === want && interp.activeScreenIds.includes('basegame'),
				);
				// Round-gate arm: intro/outro carry a gate — the `*Show` broadcast fires on WHICHEVER
				// path runs (authored broadcast when owned; the coded handler broadcasts it when
				// un-owned — here the no-op coded stub can't, so we assert only the AUTHORED path arms
				// it, and that the coded handler was the one that ran otherwise, i.e. the gate is armed
				// by the live path in-game). For the OWNED case the authored choreography must broadcast
				// the arm event; that is the load-bearing round-gate guarantee FS-6 keeps.
				const armEvents = GATE_ARM_BROADCASTS[step];
				if (armEvents && want) {
					assert(
						`${step}: OWNED path still broadcasts the round-gate arm (${armEvents.join(', ')}) (${tag})`,
						armEvents.every((e) => rig.log.includes(e)),
					);
				}
				// Dismiss an owned overlay so the lifecycle can continue.
				if (layered) {
					await interp.completeActiveScreen();
					await settle();
					assert(
						`${step}: owned overlay dismisses itself on Complete, base remains (${tag})`,
						!interp.activeScreenIds.includes(screen) && interp.activeScreenIds.includes('basegame'),
					);
				}
			};

			await dispatchAndDismiss('intro');
			await dispatchAndDismiss('counter');
			await dispatchAndDismiss('outro');

			// basegame never left the active set through the whole lifecycle (DECISION-1, per combo).
			assert(
				`basegame NEVER left the active set (${comboLabel}, ${tag})`,
				setChanges.every((s) => s.includes('basegame')) &&
					eqJson(interp.activeScreenIds, ['basegame']),
				JSON.stringify(setChanges),
			);

			// E (per combo): the retrigger overlay never layered — the lifecycle above dispatches only
			// intro/counter/outro, so an OWNED (kept) retrigger screen must still stay off the active set
			// until its OWN `freeSpinRetrigger` event fires. Ownership of one step never leaks into
			// another's layering. (The retrigger runtime chain itself is covered by `fs4Retrigger`.)
			assert(
				`freeSpinRetrigger NEVER layered without its own event (${comboLabel}, ${tag})`,
				setChanges.every((s) => !s.includes('freeSpinRetrigger')),
			);
		}
	}

	// --- E. NONE (all-OFF) — byte-identical to the fully-coded fall-through ---
	console.log(
		'\nE. NONE (all-OFF) ⇒ byte-identical to fully-coded (every fs event falls through):',
	);
	{
		const rig = makeRig(false);
		const setChanges: string[][] = [];
		const codedRan: string[] = [];
		const ownership = ownershipFor(combo(false, false, false));
		const gated = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, ownership);
		const interp = makeInterp(gated, rig, setChanges, codedRan);
		await interp.start();
		assert(
			'NONE: all fs events un-authored (fall through)',
			!interp.isAuthoredEvent('freeSpinTrigger') &&
				!interp.isAuthoredEvent('updateFreeSpin') &&
				!interp.isAuthoredEvent('freeSpinEnd'),
		);
		await interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, CONTEXT);
		await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
		await interp.dispatchBookEvent({ type: 'freeSpinEnd' }, CONTEXT);
		await settle();
		assert(
			'NONE: coded handlers ran for all 3 fs events, no authored effects, base stayed alone',
			codedRan.includes('freeSpinTrigger') &&
				codedRan.includes('updateFreeSpin') &&
				codedRan.includes('freeSpinEnd') &&
				rig.effectsRan.length === 0 &&
				eqJson(interp.activeScreenIds, ['basegame']) &&
				setChanges.every((s) => eqJson(s, ['basegame'])),
		);
	}

	// --- F. GENERIC EQUIVALENCE — the generic engine-flow core matches the legacy lines predicate ---
	// The FS-6 refactor made `resolveFreeSpinOwnership`/`gateFreeSpinOwnership` thin wrappers over the
	// generic `resolveOverlayOwnership`/`gateOverlayOwnership`. This block proves the GENERIC core, run
	// DIRECTLY over the lines step table (`FS_OVERLAY_STEPS`), returns byte-identical results to the
	// legacy wrappers across every combo AND the three condition (i/ii/iii) knobs, per step — so
	// the wrapper added no divergence (parity-by-construction). The legacy assertions above are the
	// oracle; this asserts the generic path === that oracle.
	console.log('\nF. generic engine-flow core === legacy lines predicate (every combo + knob):');
	{
		// NO seam list: since FS-4, lines has no always-stripped overlay, so the generic gate must
		// match the legacy one on the step table alone. Passing one here was the stale FS-4-seam
		// assumption that made this block disagree with the (unchanged, correct) legacy gate.
		// Compare a legacy FreeSpinOwnership against a generic OverlayOwnership: same owned set.
		const sameOwned = (legacy: FreeSpinOwnership, generic: { owns: (k: FreeSpinStep) => boolean }) =>
			ALL_STEPS.every((s) => legacy.owns(s) === generic.owns(s));
		// Compare two FlowDocs by their kept screens/events/transitions (order-independent sets).
		const sameGate = (a: FlowDoc, b: FlowDoc) =>
			eqJson(
				a.screens.map((s) => s.id).sort(),
				b.screens.map((s) => s.id).sort(),
			) &&
			eqJson(
				(a.events ?? []).map((e) => e.event).sort(),
				(b.events ?? []).map((e) => e.event).sort(),
			) &&
			eqJson(
				a.transitions.map((t) => t.id).sort(),
				b.transitions.map((t) => t.id).sort(),
			);

		// Every combo: resolve + gate via BOTH paths over the SAME doc + scenes, assert identical.
		for (const [i, c, o, r] of GATE_COMBOS) {
			const scenes = scenesFor(combo(i, c, o, r)) as unknown as OverlayScene[];
			const legacyOwn = resolveFreeSpinOwnership(
				LINES_FLOW_FREESPIN_DOC,
				scenesFor(combo(i, c, o, r)),
			);
			const genericOwn = resolveOverlayOwnership<FreeSpinStep>(
				LINES_FLOW_FREESPIN_DOC,
				scenes,
				FS_OVERLAY_STEPS,
			);
			const legacyGate = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, legacyOwn);
			const genericGate = gateOverlayOwnership<FreeSpinStep>(
				LINES_FLOW_FREESPIN_DOC,
				genericOwn,
				FS_OVERLAY_STEPS,
			);
			const tag = `intro=${i} counter=${c} outro=${o} retrigger=${r}`;
			assert(
				`resolve: generic === legacy owned set (${tag})`,
				sameOwned(legacyOwn, genericOwn) && legacyOwn.none === genericOwn.none,
			);
			assert(`gate: generic === legacy kept/stripped (${tag})`, sameGate(legacyGate, genericGate));
		}

		// The three condition knobs (i placement / ii wiring / iii content) — assert generic matches
		// legacy when EACH is independently broken (the same knobs block A exercises on the legacy path).
		{
			// (i) placement: doc omits each step's screen in turn.
			for (const step of ALL_STEPS) {
				const docNoScreen: FlowDoc = {
					...LINES_FLOW_FREESPIN_DOC,
					screens: LINES_FLOW_FREESPIN_DOC.screens.filter(
						(s) => s.id !== FREE_SPIN_STEPS[step].screen,
					),
				};
				const s = scenesFor(combo(true, true, true, true));
				const legacy = resolveFreeSpinOwnership(docNoScreen, s);
				const generic = resolveOverlayOwnership<FreeSpinStep>(
					docNoScreen,
					s as unknown as OverlayScene[],
					FS_OVERLAY_STEPS,
				);
				assert(`knob (i) placement ${step}: generic === legacy`, sameOwned(legacy, generic));
			}
		}
		{
			// (ii) wiring: doc omits each step's bookEvent edge in turn.
			for (const step of ALL_STEPS) {
				const docNoEdge: FlowDoc = {
					...LINES_FLOW_FREESPIN_DOC,
					transitions: LINES_FLOW_FREESPIN_DOC.transitions.filter(
						(t) =>
							!(t.trigger.kind === 'bookEvent' && t.trigger.event === FREE_SPIN_STEPS[step].event),
					),
				};
				const s = scenesFor(combo(true, true, true, true));
				const legacy = resolveFreeSpinOwnership(docNoEdge, s);
				const generic = resolveOverlayOwnership<FreeSpinStep>(
					docNoEdge,
					s as unknown as OverlayScene[],
					FS_OVERLAY_STEPS,
				);
				assert(`knob (ii) wiring ${step}: generic === legacy`, sameOwned(legacy, generic));
			}
		}
		{
			// (iii) content: each step's scene flipped to its fallback independently.
			for (const step of ALL_STEPS) {
				const owned = combo(true, true, true, true);
				owned[step] = false;
				const s = scenesFor(owned);
				const legacy = resolveFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, s);
				const generic = resolveOverlayOwnership<FreeSpinStep>(
					LINES_FLOW_FREESPIN_DOC,
					s as unknown as OverlayScene[],
					FS_OVERLAY_STEPS,
				);
				assert(`knob (iii) content ${step}: generic === legacy`, sameOwned(legacy, generic));
			}
		}
		// undefined doc: both paths ⇒ none owned.
		{
			const s = scenesFor(combo(true, true, true, true));
			const legacy = resolveFreeSpinOwnership(undefined, s);
			const generic = resolveOverlayOwnership<FreeSpinStep>(
				undefined,
				s as unknown as OverlayScene[],
				FS_OVERLAY_STEPS,
			);
			assert('knob: undefined doc ⇒ both none', legacy.none && generic.none && sameOwned(legacy, generic));
		}
	}

	console.log(`\n${failed ? 'FS-6 HARNESS: FAILED' : 'FS-6 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
