/**
 * Invisible Flow — FS-1 free-spin lifecycle harness (design doc §14, §7).
 *
 *   pnpm --filter flow-spike run fs1
 *
 * Proves, HEADLESSLY and against the REAL engine-flow interpreter/presentation over the REAL
 * `LINES_FLOW_FREESPIN_DOC` (imported from apps/lines), that the free-spin lifecycle drives the
 * correct ACTIVE-SET transitions under the owner's "same basegame + overlays" model: the
 * `basegame` screen PERSISTS throughout, and intro / counter / retrigger / outro LAYER over it
 * and dismiss themselves on their own Complete pin. NO edge ever deactivates `basegame`.
 *
 *  A. The canonical sequence — a synthetic `freeSpinTrigger` … `updateFreeSpin` … `freeSpinEnd`
 *     book-event stream LAYERS intro → (intro completes) → counter → (outro on end) with
 *     `basegame` active AT EVERY STEP; each overlay returns to the plain base on its Complete.
 *  B. `basegame` NEVER leaves the active set across the whole lifecycle (the DECISION-1 invariant).
 *  C. The counter PERSISTS — a second `updateFreeSpin` while the counter is already layered is a
 *     `changesActiveSet` no-op (no re-enter, no re-notify) — the counter stays up, no flicker.
 *  D. The retrigger LAYER edge (FS-4, landed) fires on the REAL `freeSpinRetrigger` book event: an
 *     unrelated event never layers it (parity), while a `freeSpinRetrigger` DOES layer it over the
 *     persistent base + counter, and its Complete dismisses it — the reconciled seam wiring.
 *  E. EVENT-AUTHORING — since FS-6, the RAW `LINES_FLOW_FREESPIN_DOC` AUTHORS the free-spin book
 *     events (the full Phase-5 choreographies), so `dispatchBookEvent` runs the interpreter (not the
 *     coded handler) — the flow owns the presentation. The OWNERSHIP GATING (OFF ⇒ these fall
 *     through) is proven separately by `fs6FreeSpinOwnership.ts`; this harness drives the RAW fixture
 *     (= the ownership-ON doc). `reveal`/`winInfo` are authored too (base flow).
 *  F. Parity — the default `LINES_FLOW_DOC` authors ZERO transitions (inert by default, §7); the
 *     free-spin doc's edge shape is exactly 4 LAYER (bookEvent) + 4 HANDOFF (complete), and
 *     `basegame` has NO outgoing complete edge (it is PERSISTENT).
 *
 * Determinism: a virtual `waitForTimeout` (records scaled ms); turbo on/off asserted identical.
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

import { LINES_FLOW_DOC, LINES_FLOW_FREESPIN_DOC } from '../../apps/lines/src/game/flowDoc';

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter routed through a log so enter/exit beats are observable.
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
		// Record which named effects the authored choreographies invoke (the load-bearing state
		// leaves) — a no-op body; the harness only needs the fact that they ran.
		effect: (name: string) => () => void effectsRan.push(name),
	};
	return { log, effectsRan, runtime };
};

const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'canvas' },
	freeSpinCounter: { id: 'freeSpinCounter', space: 'canvas' },
	freeSpinRetrigger: { id: 'freeSpinRetrigger', space: 'canvas' },
	freeSpinOutro: { id: 'freeSpinOutro', space: 'canvas' },
};

const CONTEXT = { bookEvents: [] as unknown[] };

/** Build the interpreter over a doc, recording active-set changes AND which coded handlers ran
 *  (so the fall-through half can be asserted — an un-authored free-spin event calls the coded body). */
const makeInterp = (
	doc: FlowDoc,
	rig: ReturnType<typeof makeRig>,
	setChanges: string[][],
	codedRan: string[],
) =>
	createFlowInterpreter<{ type: string }, { bookEvents: unknown[] }>({
		flowDoc: doc,
		runtime: rig.runtime,
		resolveScene: (id) => scenes[id],
		onActiveScreensChange: (ids) => setChanges.push([...ids]),
		// The coded fall-through: each handler just records that it ran (the REAL bodies mutate
		// stateUi / present the coded overlays — here we only need to prove they WERE called).
		codedHandlers: {
			freeSpinTrigger: async () => void codedRan.push('freeSpinTrigger'),
			updateFreeSpin: async () => void codedRan.push('updateFreeSpin'),
			freeSpinEnd: async () => void codedRan.push('freeSpinEnd'),
			reveal: async () => void codedRan.push('reveal'),
			// FS-4 (landed): the retrigger fires on the real `freeSpinRetrigger` event. A no-op coded
			// twin keeps the dispatcher quiet for an un-authored game (present-nothing parity).
			freeSpinRetrigger: async () => void codedRan.push('freeSpinRetrigger'),
		},
	});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const eqJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const main = async () => {
	console.log('Invisible Flow — FS-1 free-spin lifecycle harness\n');

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;

		// --- A + B. the canonical lifecycle; basegame persists at every step ---
		console.log(
			`A+B. canonical freeSpinTrigger…updateFreeSpin…freeSpinEnd, base persists (${tag}):`,
		);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const interp = makeInterp(LINES_FLOW_FREESPIN_DOC, rig, setChanges, codedRan);
			await interp.start();
			assert(`boot ⇒ base only active (${tag})`, eqJson(interp.activeScreenIds, ['basegame']));

			// freeSpinTrigger ⇒ LAYER the intro over the persistent base.
			await interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, CONTEXT);
			await settle();
			assert(
				`freeSpinTrigger ⇒ LAYERS freeSpinIntro over base (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinIntro']),
			);
			assert(`intro.enter beat ran (${tag})`, rig.log.includes('broadcast flowFsIntroEnter'));

			// The intro dismisses ITSELF on its Complete pin ⇒ base remains.
			await interp.completeActiveScreen();
			await settle();
			assert(
				`intro Complete ⇒ dismisses itself, base remains (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame']),
			);
			assert(`intro.exit beat ran (${tag})`, rig.log.includes('broadcast flowFsIntroExit'));

			// updateFreeSpin ⇒ LAYER the counter.
			await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
			await settle();
			assert(
				`updateFreeSpin ⇒ LAYERS freeSpinCounter over base (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinCounter']),
			);

			// freeSpinEnd ⇒ LAYER the outro on top of the still-active counter + base.
			await interp.dispatchBookEvent({ type: 'freeSpinEnd' }, CONTEXT);
			await settle();
			assert(
				`freeSpinEnd ⇒ LAYERS freeSpinOutro (base + counter + outro) (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinCounter', 'freeSpinOutro']),
			);

			// outro Complete ⇒ dismisses the outro (top of stack), base + counter remain.
			await interp.completeActiveScreen();
			await settle();
			assert(
				`outro Complete ⇒ dismisses outro, base + counter remain (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinCounter']),
			);
			// counter Complete ⇒ dismisses the counter, back to the plain base.
			await interp.completeActiveScreen();
			await settle();
			assert(
				`counter Complete ⇒ back to plain base (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame']),
			);

			// B — basegame was present in EVERY recorded active set across the whole lifecycle.
			assert(
				`basegame NEVER left the active set (DECISION-1 invariant) (${tag})`,
				setChanges.every((set) => set.includes('basegame')),
				JSON.stringify(setChanges),
			);
		}

		// --- C. the counter persists — a repeat updateFreeSpin is a layer no-op ---
		console.log(`C. counter persists — repeat updateFreeSpin ⇒ no re-enter / re-notify (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const interp = makeInterp(LINES_FLOW_FREESPIN_DOC, rig, setChanges, codedRan);
			await interp.start();

			await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
			await settle();
			const notifiesAfterFirst = setChanges.length;
			rig.log.length = 0;
			rig.effectsRan.length = 0;

			// A SECOND updateFreeSpin while the counter is already layered ⇒ consumed no-op (transition).
			await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
			await settle();
			assert(
				`repeat updateFreeSpin ⇒ counter stays, NO re-enter, NO re-notify (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinCounter']) &&
					!rig.log.includes('broadcast flowFsCounterEnter') &&
					setChanges.length === notifiesAfterFirst,
			);
			// The AUTHORED updateFreeSpin choreography STILL ran on the repeat (its `updateFreeSpinCounter`
			// effect updates the displayed number) — the number updates via the EVENT, not a re-enter,
			// even though the transition no-ops the re-layer. (No coded handler runs — flow owns it.)
			assert(
				`authored updateFreeSpin ran on the repeat (number updates via the effect) (${tag})`,
				rig.effectsRan.includes('updateFreeSpinCounter') && !codedRan.includes('updateFreeSpin'),
			);
		}

		// --- D. the retrigger edge (FS-4, landed) fires on the real `freeSpinRetrigger` event ---
		console.log(
			`D. retrigger edge — inert on unrelated events, layers on freeSpinRetrigger (${tag}):`,
		);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const codedRan: string[] = [];
			const interp = makeInterp(LINES_FLOW_FREESPIN_DOC, rig, setChanges, codedRan);
			await interp.start();

			// An unrelated event in the normal stream ⇒ the retrigger edge never fires.
			await interp.dispatchBookEvent({ type: 'updateFreeSpin' }, CONTEXT);
			await settle();
			assert(
				`unrelated event ⇒ freeSpinRetrigger NEVER layers (${tag})`,
				!interp.activeScreenIds.includes('freeSpinRetrigger'),
			);

			// The real `freeSpinRetrigger` event (the facade's type) DOES layer the retrigger overlay.
			await interp.dispatchBookEvent({ type: 'freeSpinRetrigger' }, CONTEXT);
			await settle();
			assert(
				`freeSpinRetrigger ⇒ LAYERS freeSpinRetrigger over base + counter (wiring correct) (${tag})`,
				interp.activeScreenIds.includes('freeSpinRetrigger') &&
					interp.activeScreenIds.includes('basegame'),
			);
			await interp.completeActiveScreen();
			await settle();
			assert(
				`retrigger Complete ⇒ dismisses it, base + counter remain (${tag})`,
				!interp.activeScreenIds.includes('freeSpinRetrigger') &&
					interp.activeScreenIds.includes('basegame'),
			);
		}

		// --- E. event-authoring — the RAW (ownership-ON) fixture AUTHORS the free-spin events ---
		console.log(
			`E. raw fixture authors the free-spin events (flow owns; ownership gating = fs6) (${tag}):`,
		);
		{
			const rig = makeRig(turbo);
			const codedRan: string[] = [];
			const interp = makeInterp(LINES_FLOW_FREESPIN_DOC, rig, [], codedRan);
			await interp.start();

			assert(
				`freeSpinTrigger / updateFreeSpin / freeSpinEnd ARE authored (flow owns presentation) (${tag})`,
				interp.isAuthoredEvent('freeSpinTrigger') &&
					interp.isAuthoredEvent('updateFreeSpin') &&
					interp.isAuthoredEvent('freeSpinEnd'),
			);
			assert(
				`reveal / winInfo stay AUTHORED (interpreter-driven base flow) (${tag})`,
				interp.isAuthoredEvent('reveal') && interp.isAuthoredEvent('winInfo'),
			);

			await interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, CONTEXT);
			await interp.dispatchBookEvent({ type: 'reveal' }, CONTEXT);
			await settle();
			assert(
				`authored ⇒ NO coded handler ran (no double); interpreter drove both (${tag})`,
				!codedRan.includes('freeSpinTrigger') && !codedRan.includes('reveal'),
			);
		}
	}

	// --- F. Parity + edge-shape (turbo-independent) ---
	console.log(
		'\nF. Parity — default doc inert; free-spin doc = 4 LAYER + 4 HANDOFF, base persistent:',
	);
	{
		assert(
			'default LINES_FLOW_DOC authors ZERO transitions (free-spin lifecycle inert by default, §7)',
			LINES_FLOW_DOC.transitions.length === 0,
		);
		const layerEdges = LINES_FLOW_FREESPIN_DOC.transitions.filter(
			(t) => t.trigger.kind === 'bookEvent',
		);
		const handoffEdges = LINES_FLOW_FREESPIN_DOC.transitions.filter(
			(t) => t.trigger.kind === 'complete',
		);
		assert(
			'free-spin doc = exactly 4 bookEvent LAYER edges + 4 complete HANDOFF edges',
			layerEdges.length === 4 && handoffEdges.length === 4,
		);
		// Every LAYER edge sources FROM basegame; every HANDOFF returns TO basegame.
		assert(
			'every LAYER edge is basegame → overlay; every HANDOFF is overlay → basegame',
			layerEdges.every((t) => t.from === 'basegame') &&
				handoffEdges.every((t) => t.to === 'basegame'),
		);
		// The DECISION-1 invariant at the graph level: basegame has NO outgoing complete edge, so it
		// is PERSISTENT (the presentation machine never deactivates it).
		assert(
			'basegame has NO outgoing complete edge ⇒ it is PERSISTENT (never deactivated)',
			!LINES_FLOW_FREESPIN_DOC.transitions.some(
				(t) => t.from === 'basegame' && t.trigger.kind === 'complete',
			),
		);
		// The four backing scene ids the owner authors online (the scene-id contract).
		const overlayTargets = new Set(layerEdges.map((t) => t.to));
		assert(
			'scene-id contract — intro / counter / retrigger / outro are the four overlay targets',
			['freeSpinIntro', 'freeSpinCounter', 'freeSpinRetrigger', 'freeSpinOutro'].every((id) =>
				overlayTargets.has(id),
			),
		);
		// Since FS-6, the free-spin book events ARE authored in events[] (the full Phase-5
		// choreographies — flow owns the presentation). Ownership GATING (stripping them when OFF)
		// is proven by fs6FreeSpinOwnership.ts; the raw fixture is the ownership-ON doc.
		assert(
			'free-spin book events ARE authored in events[] (full Phase-5 choreographies, flow owns)',
			['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].every((event) =>
				LINES_FLOW_FREESPIN_DOC.events?.some((e) => e.event === event),
			),
		);
	}

	console.log(`\n${failed ? 'FS-1 HARNESS: FAILED' : 'FS-1 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
