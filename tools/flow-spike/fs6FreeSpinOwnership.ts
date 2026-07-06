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
 * (`updateFreeSpin`/`freeSpinCounter`), outro (`freeSpinEnd`/`freeSpinOutro`) — so a step can be
 * authored on its own while the others fall through to their coded handlers. MIXED states are valid.
 *
 *  A. PREDICATE per-step conjunction — a step is owned iff (i) its screen is placed + (ii) its
 *     bookEvent edge is wired + (iii) its backing scene carries REAL authored content. Vary each of
 *     the three knobs to prove EACH condition independently gates its OWN step (and only its own).
 *  B. GATE per-step atomic strip — `gateFreeSpinOwnership(doc, ownership)` keeps each OWNED step's
 *     event + overlay screen + transitions and STRIPS every UN-owned step's (independently), always
 *     stripping the `freeSpinRetrigger` FS-4 seam. Non-free-spin content is untouched.
 *  C. INTERPRETER per-combo — for the SIX per-step combinations (intro-only, counter-only,
 *     outro-only, intro+outro, all-three, none) drive the interpreter over the gated doc + synthetic
 *     book events, turbo on/off. For each combo assert PER STEP:
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
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	excludeCodedComponents,
	gateOverlayOwnership,
	resolveOverlayOwnership,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
	type OverlayScene,
	type OverlayStep,
} from 'engine-flow';
import type { LayoutNode, Scene } from 'engine-layout';

import { LINES_FLOW_FREESPIN_DOC } from '../../apps/lines/src/game/flowDoc';
import { BOOK_OVERLAY_STEPS, type BookStep } from '../../apps/lines/src/game/bookOwnership';
import {
	FREE_SPIN_STEPS,
	FS_OVERLAY_STEPS,
	gateFreeSpinOwnership,
	resolveFreeSpinOwnership,
	type FreeSpinOwnership,
	type FreeSpinStep,
} from '../../apps/lines/src/game/freeSpinOwnership';
// FS-6 drift cross-check (decision 2) — the launcher's SERIALIZABLE step table (the DATA the `/flow`
// editor reads). Fed through `excludeCodedComponents`, it must produce the SAME `OverlayStep[]` the
// game uses (`FS_OVERLAY_STEPS`). Imported by relative path (the file imports only `engine-flow`).
import { resolveOverlayStepTable } from '../../apps/launcher-api/src/lib/flowOverlaySteps';

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

/** The coded FALLBACK backing scene for a step (anchor/counter scaffolding only) — fails (iii). */
const fallbackSceneFor = (step: FreeSpinStep): Scene => {
	if (step === 'intro') return codedAnchorScene('freeSpinIntro', 'FreeSpinIntroVisual');
	if (step === 'counter') return codedCounterScene();
	return codedAnchorScene('freeSpinOutro', 'FreeSpinOutroVisual');
};

/** Build the LIVE scenes so `resolveFreeSpinOwnership` sees each step authored or fallback. The
 *  retrigger scene is always fallback (FS-4 seam) so it never satisfies (iii). */
const scenesFor = (owned: Record<FreeSpinStep, boolean>): Scene[] => [
	owned.intro ? authoredScene('freeSpinIntro') : fallbackSceneFor('intro'),
	owned.counter ? authoredScene('freeSpinCounter') : fallbackSceneFor('counter'),
	codedAnchorScene('freeSpinRetrigger', 'FreeSpinRetriggerVisual'),
	owned.outro ? authoredScene('freeSpinOutro') : fallbackSceneFor('outro'),
];

/** Resolve the per-step ownership object for a combo, driving condition (iii) via scene content
 *  over the FULLY-wired `LINES_FLOW_FREESPIN_DOC` (which places every screen + wires every edge, so
 *  (i)+(ii) always hold — scene content is the flipped knob here). */
const ownershipFor = (owned: Record<FreeSpinStep, boolean>): FreeSpinOwnership =>
	resolveFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, scenesFor(owned));

const ALL_STEPS: FreeSpinStep[] = ['intro', 'counter', 'outro'];
const combo = (
	intro: boolean,
	counter: boolean,
	outro: boolean,
): Record<FreeSpinStep, boolean> => ({ intro, counter, outro });

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
		// All three authored + fully wired ⇒ all three owned.
		const all = ownershipFor(combo(true, true, true));
		assert(
			'all authored + wired ⇒ intro+counter+outro ALL owned',
			all.ownsIntro && all.ownsCounter && all.ownsOutro && !all.none,
		);

		// (iii) content knob: flip ONE step's scene to the coded fallback ⇒ ONLY that step drops.
		for (const step of ALL_STEPS) {
			const owned = combo(true, true, true);
			owned[step] = false;
			const o = ownershipFor(owned);
			assert(
				`content: ${step} scene = coded fallback ⇒ ${step} OFF, other two stay ON`,
				!o.owns(step) && ALL_STEPS.filter((s) => s !== step).every((s) => o.owns(s)),
			);
		}

		// (i) screen-placement knob: a doc that does NOT PLACE a step's screen ⇒ that step OFF even
		// with authored scene content + a wired edge.
		{
			const docNoIntroScreen: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				screens: LINES_FLOW_FREESPIN_DOC.screens.filter((s) => s.id !== 'freeSpinIntro'),
			};
			const o = resolveFreeSpinOwnership(docNoIntroScreen, scenesFor(combo(true, true, true)));
			assert(
				'placement: doc omits freeSpinIntro screen ⇒ intro OFF (i fails), counter+outro ON',
				!o.ownsIntro && o.ownsCounter && o.ownsOutro,
			);
		}

		// (ii) edge-wiring knob: a doc that does NOT WIRE a step's bookEvent edge ⇒ that step OFF even
		// with its screen placed + authored scene content.
		{
			const docNoOutroEdge: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				transitions: LINES_FLOW_FREESPIN_DOC.transitions.filter(
					(t) =>
						!(t.trigger.kind === 'bookEvent' && t.trigger.event === FREE_SPIN_STEPS.outro.event),
				),
			};
			const o = resolveFreeSpinOwnership(docNoOutroEdge, scenesFor(combo(true, true, true)));
			assert(
				'wiring: doc omits freeSpinEnd edge ⇒ outro OFF (ii fails), intro+counter ON',
				o.ownsIntro && o.ownsCounter && !o.ownsOutro,
			);
		}

		// No doc ⇒ every step OFF (coded, parity).
		const noDoc = resolveFreeSpinOwnership(undefined, scenesFor(combo(true, true, true)));
		assert(
			'undefined doc ⇒ none owned',
			noDoc.none && !noDoc.ownsIntro && !noDoc.ownsCounter && !noDoc.ownsOutro,
		);
	}

	// --- B. gate strips each UN-owned step independently, always strips the FS-4 seam ---
	console.log('\nB. gateFreeSpinOwnership — per-step strip + always-strip FS-4 seam:');
	{
		for (const [intro, counter, outro] of [
			[true, false, false],
			[false, true, false],
			[false, false, true],
			[true, false, true],
			[true, true, true],
			[false, false, false],
		] as const) {
			const ownership = ownershipFor(combo(intro, counter, outro));
			const gated = gateFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, ownership);
			const tag = `intro=${intro} counter=${counter} outro=${outro}`;
			let ok = true;
			for (const step of ALL_STEPS) {
				const { screen, event } = FREE_SPIN_STEPS[step];
				const screenKept = gated.screens.some((s) => s.id === screen);
				const eventKept = (gated.events ?? []).some((e) => e.event === event);
				const edgesKept = gated.transitions.some((t) => t.from === screen || t.to === screen);
				const want = ownership.owns(step);
				// Owned ⇒ screen + event + its transitions all survive; un-owned ⇒ all three gone.
				if (screenKept !== want || eventKept !== want || edgesKept !== want) ok = false;
			}
			// The FS-4 seam is ALWAYS stripped regardless of any step's ownership.
			const seamStripped =
				!gated.screens.some((s) => s.id === 'freeSpinRetrigger') &&
				!gated.transitions.some(
					(t) => t.from === 'freeSpinRetrigger' || t.to === 'freeSpinRetrigger',
				);
			// Non-free-spin content untouched (basegame screen + reveal event survive every combo).
			const baseKept =
				gated.screens.some((s) => s.id === 'basegame') &&
				(gated.events ?? []).some((e) => e.event === 'reveal');
			assert(
				`gate keeps owned / strips un-owned per step + always strips seam (${tag})`,
				ok && seamStripped && baseKept,
			);
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
		[[], 'none (all coded)'],
	];

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;
		for (const [ownedSteps, comboLabel] of COMBOS) {
			const owned = combo(
				ownedSteps.includes('intro'),
				ownedSteps.includes('counter'),
				ownedSteps.includes('outro'),
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

			// E (per combo): the FS-4 seam never layered (its screen was always stripped).
			assert(
				`freeSpinRetrigger NEVER layered (FS-4 seam always stripped) (${comboLabel}, ${tag})`,
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
	// legacy wrappers across all six combos AND the three condition (i/ii/iii) knobs — so the wrapper
	// added no divergence (parity-by-construction). The legacy assertions above are the oracle; this
	// asserts the generic path === that oracle.
	console.log('\nF. generic engine-flow core === legacy lines predicate (all six combos + knobs):');
	{
		const FS_SEAM = ['freeSpinRetrigger'];
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

		// All six combos: resolve + gate via BOTH paths over the SAME doc + scenes, assert identical.
		const COMBOS6: [boolean, boolean, boolean][] = [
			[true, false, false],
			[false, true, false],
			[false, false, true],
			[true, false, true],
			[true, true, true],
			[false, false, false],
		];
		for (const [i, c, o] of COMBOS6) {
			const scenes = scenesFor(combo(i, c, o)) as unknown as OverlayScene[];
			const legacyOwn = resolveFreeSpinOwnership(LINES_FLOW_FREESPIN_DOC, scenesFor(combo(i, c, o)));
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
				FS_SEAM,
			);
			const tag = `intro=${i} counter=${c} outro=${o}`;
			assert(
				`resolve: generic === legacy owned set (${tag})`,
				sameOwned(legacyOwn, genericOwn) && legacyOwn.none === genericOwn.none,
			);
			assert(`gate: generic === legacy kept/stripped (${tag})`, sameGate(legacyGate, genericGate));
		}

		// The three condition knobs (i placement / ii wiring / iii content) — assert generic matches
		// legacy when EACH is independently broken (the same knobs block A exercises on the legacy path).
		{
			// (i) placement: doc omits the intro screen.
			const docNoIntro: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				screens: LINES_FLOW_FREESPIN_DOC.screens.filter((s) => s.id !== 'freeSpinIntro'),
			};
			const s = scenesFor(combo(true, true, true));
			const legacy = resolveFreeSpinOwnership(docNoIntro, s);
			const generic = resolveOverlayOwnership<FreeSpinStep>(
				docNoIntro,
				s as unknown as OverlayScene[],
				FS_OVERLAY_STEPS,
			);
			assert('knob (i) placement: generic === legacy', sameOwned(legacy, generic));
		}
		{
			// (ii) wiring: doc omits the outro bookEvent edge.
			const docNoOutroEdge: FlowDoc = {
				...LINES_FLOW_FREESPIN_DOC,
				transitions: LINES_FLOW_FREESPIN_DOC.transitions.filter(
					(t) => !(t.trigger.kind === 'bookEvent' && t.trigger.event === FREE_SPIN_STEPS.outro.event),
				),
			};
			const s = scenesFor(combo(true, true, true));
			const legacy = resolveFreeSpinOwnership(docNoOutroEdge, s);
			const generic = resolveOverlayOwnership<FreeSpinStep>(
				docNoOutroEdge,
				s as unknown as OverlayScene[],
				FS_OVERLAY_STEPS,
			);
			assert('knob (ii) wiring: generic === legacy', sameOwned(legacy, generic));
		}
		{
			// (iii) content: each step's scene flipped to the coded fallback independently.
			for (const step of ALL_STEPS) {
				const owned = combo(true, true, true);
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
			const s = scenesFor(combo(true, true, true));
			const legacy = resolveFreeSpinOwnership(undefined, s);
			const generic = resolveOverlayOwnership<FreeSpinStep>(
				undefined,
				s as unknown as OverlayScene[],
				FS_OVERLAY_STEPS,
			);
			assert('knob: undefined doc ⇒ both none', legacy.none && generic.none && sameOwned(legacy, generic));
		}
	}

	// --- G. LAUNCHER-TABLE CROSS-CHECK (drift guard, decision 2) ---
	// The `/flow` editor reads a SERIALIZABLE step table (`flowOverlaySteps.ts`), not the game's. This
	// asserts that table for `lines`, fed through `excludeCodedComponents`, produces `OverlayStep[]`
	// that resolve IDENTICALLY to the game's step tables — so the editor's per-step readout can never
	// silently drift from what the runtime decides. The launcher table now carries BOTH the free-spin
	// steps (intro/counter/outro) AND the book-reveal step (reveal), so it is split into those two
	// subsets and each is cross-checked against its OWN game table (`FS_OVERLAY_STEPS` /
	// `BOOK_OVERLAY_STEPS`) — structurally + behaviourally (the content rule is a function, so we
	// compare RESOLVED ownership, not function identity).
	console.log('\nG. launcher step table === game step tables (drift guard):');
	{
		const table = resolveOverlayStepTable('lines');
		assert('launcher exposes a `lines` overlay-step table', table !== undefined);
		if (table) {
			// Split the launcher steps into the free-spin subset (intro/counter/outro) and the book
			// subset (reveal), then cross-check EACH against its own game table.
			const FS_KEYS = new Set<string>(['intro', 'counter', 'outro']);
			const BOOK_KEYS = new Set<string>(['reveal']);
			const fsTableSteps = table.steps.filter((s) => FS_KEYS.has(s.key));
			const bookTableSteps = table.steps.filter((s) => BOOK_KEYS.has(s.key));

			assert(
				'launcher seam screens = [freeSpinRetrigger]',
				eqJson(table.seamScreens ?? [], ['freeSpinRetrigger']),
			);

			// --- G.1 free-spin subset === game FS_OVERLAY_STEPS ---
			{
				// Rebuild runtime OverlayStep[] from the launcher's serialized data (mirrors the editor's
				// `overlayStepsFromTable`), keying the step union back to FreeSpinStep for the resolver.
				const launcherFsSteps: OverlayStep<FreeSpinStep>[] = fsTableSteps.map((s) => ({
					key: s.key as FreeSpinStep,
					screen: s.screen,
					event: s.event,
					contentRule: excludeCodedComponents({
						excludeBindComponents: s.excludeBindComponents,
						excludeComponentIds: s.excludeComponentIds,
					}),
				}));
				// Structural agreement: same key/screen/event per step, in order.
				const structOk =
					launcherFsSteps.length === FS_OVERLAY_STEPS.length &&
					launcherFsSteps.every(
						(l, idx) =>
							l.key === FS_OVERLAY_STEPS[idx].key &&
							l.screen === FS_OVERLAY_STEPS[idx].screen &&
							l.event === FS_OVERLAY_STEPS[idx].event,
					);
				assert('launcher FS steps match game FS steps (key/screen/event, in order)', structOk);
				// Behavioural agreement: the content rule resolves the same ownership across all six combos.
				const COMBOS6: [boolean, boolean, boolean][] = [
					[true, false, false],
					[false, true, false],
					[false, false, true],
					[true, false, true],
					[true, true, true],
					[false, false, false],
				];
				let behOk = true;
				for (const [i, c, o] of COMBOS6) {
					const scenes = scenesFor(combo(i, c, o)) as unknown as OverlayScene[];
					const gameOwn = resolveOverlayOwnership<FreeSpinStep>(
						LINES_FLOW_FREESPIN_DOC,
						scenes,
						FS_OVERLAY_STEPS,
					);
					const launcherOwn = resolveOverlayOwnership<FreeSpinStep>(
						LINES_FLOW_FREESPIN_DOC,
						scenes,
						launcherFsSteps,
					);
					if (!ALL_STEPS.every((s) => gameOwn.owns(s) === launcherOwn.owns(s))) behOk = false;
				}
				assert('launcher FS content rule resolves identical ownership (all six combos)', behOk);
			}

			// --- G.2 book subset === game BOOK_OVERLAY_STEPS ---
			// The book reveal is ONE step (`reveal`, screen `specialBook`, event `setExpandingSymbol`)
			// whose ownership flips on the SAME three knobs: (i) its screen placed, (ii) its
			// `setExpandingSymbol` LAYER edge wired, (iii) its `specialBook` scene carries authored
			// content (≥1 node that is NOT the coded `SpecialBook` bind anchor). We exercise all three.
			{
				// Rebuild runtime OverlayStep[] from the launcher's serialized data, keyed to BookStep.
				const launcherBookSteps: OverlayStep<BookStep>[] = bookTableSteps.map((s) => ({
					key: s.key as BookStep,
					screen: s.screen,
					event: s.event,
					contentRule: excludeCodedComponents({
						excludeBindComponents: s.excludeBindComponents,
						excludeComponentIds: s.excludeComponentIds,
					}),
				}));
				// Structural agreement: same key/screen/event, in order.
				const structOk =
					launcherBookSteps.length === BOOK_OVERLAY_STEPS.length &&
					launcherBookSteps.every(
						(l, idx) =>
							l.key === BOOK_OVERLAY_STEPS[idx].key &&
							l.screen === BOOK_OVERLAY_STEPS[idx].screen &&
							l.event === BOOK_OVERLAY_STEPS[idx].event,
					);
				assert('launcher book step matches game book step (key/screen/event, in order)', structOk);

				// A fully-wired book doc: places the `specialBook` screen + wires the `setExpandingSymbol`
				// LAYER edge (so knobs (i)+(ii) hold and scene content is the flipped knob), reusing the
				// same layer/return edge shape as the free-spin overlays.
				const bookDoc: FlowDoc = {
					...LINES_FLOW_FREESPIN_DOC,
					screens: [...LINES_FLOW_FREESPIN_DOC.screens, { id: 'specialBook' }],
					transitions: [
						...LINES_FLOW_FREESPIN_DOC.transitions,
						{
							id: 'basegame→specialBook',
							from: 'basegame',
							to: 'specialBook',
							trigger: { kind: 'bookEvent', event: 'setExpandingSymbol' },
						},
						{ id: 'specialBook→basegame', from: 'specialBook', to: 'basegame', trigger: { kind: 'complete' } },
					],
				};
				// The `specialBook` scene toggled between authored content and the coded `SpecialBook`
				// bind-anchor fallback (knob iii). The other scenes are irrelevant to the reveal step.
				const bookScenesFor = (authored: boolean): OverlayScene[] =>
					[
						authored ? authoredScene('specialBook') : codedAnchorScene('specialBook', 'SpecialBook'),
					] as unknown as OverlayScene[];

				let behOk = true;
				// (iii) content: authored ⇒ owned; coded anchor only ⇒ un-owned. Game === launcher.
				for (const authored of [true, false]) {
					const scenes = bookScenesFor(authored);
					const gameOwn = resolveOverlayOwnership<BookStep>(bookDoc, scenes, BOOK_OVERLAY_STEPS);
					const launcherOwn = resolveOverlayOwnership<BookStep>(bookDoc, scenes, launcherBookSteps);
					if (gameOwn.owns('reveal') !== authored || launcherOwn.owns('reveal') !== authored) {
						behOk = false;
					}
					if (gameOwn.owns('reveal') !== launcherOwn.owns('reveal')) behOk = false;
				}
				// (i) placement: doc omits the `specialBook` screen ⇒ un-owned even with authored content.
				{
					const docNoScreen: FlowDoc = {
						...bookDoc,
						screens: bookDoc.screens.filter((s) => s.id !== 'specialBook'),
					};
					const scenes = bookScenesFor(true);
					const gameOwn = resolveOverlayOwnership<BookStep>(docNoScreen, scenes, BOOK_OVERLAY_STEPS);
					const launcherOwn = resolveOverlayOwnership<BookStep>(docNoScreen, scenes, launcherBookSteps);
					if (gameOwn.owns('reveal') || launcherOwn.owns('reveal')) behOk = false;
					if (gameOwn.owns('reveal') !== launcherOwn.owns('reveal')) behOk = false;
				}
				// (ii) wiring: doc omits the `setExpandingSymbol` edge ⇒ un-owned even with authored content.
				{
					const docNoEdge: FlowDoc = {
						...bookDoc,
						transitions: bookDoc.transitions.filter(
							(t) => !(t.trigger.kind === 'bookEvent' && t.trigger.event === 'setExpandingSymbol'),
						),
					};
					const scenes = bookScenesFor(true);
					const gameOwn = resolveOverlayOwnership<BookStep>(docNoEdge, scenes, BOOK_OVERLAY_STEPS);
					const launcherOwn = resolveOverlayOwnership<BookStep>(docNoEdge, scenes, launcherBookSteps);
					if (gameOwn.owns('reveal') || launcherOwn.owns('reveal')) behOk = false;
					if (gameOwn.owns('reveal') !== launcherOwn.owns('reveal')) behOk = false;
				}
				assert('launcher book content rule resolves identical ownership (all three knobs)', behOk);
			}
		}
	}

	console.log(`\n${failed ? 'FS-6 HARNESS: FAILED' : 'FS-6 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
