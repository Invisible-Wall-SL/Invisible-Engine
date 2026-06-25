/**
 * Invisible FX — Phase 4 (pipeline wiring), TRIGGER increment headless harness:
 *
 *   pnpm --filter fx-spike run trigger
 *
 * The event-bus trigger is what makes an authored effect FIRE in a running game (a Flow
 * Broadcast / game event of `trigger.eventType` plays the effect). The runtime `<EffectLayer>`
 * (pixi-svelte) can't render WebGL here, so — as the sibling tools do — we verify OFFLINE:
 *
 *   1. The PURE classification (`layerTrigger`/`planLayer` in `engine-fx`): ambient `always`
 *      emits at mount; `event` is dormant (carries `eventType`/`duration`); no-trigger ⇒ ambient;
 *      `event` with no `eventType` can never fire.
 *   2. The SUBSCRIBE/FIRE/STOP cycle against the REAL `createEventEmitter` bus (the same bus a
 *      Flow Broadcast fires) — replicating `<EffectLayer>`'s subscription so the actual gating
 *      logic is pinned: an event layer is dormant until its `eventType` fires, then emits, then
 *      stops after `duration` ms; a non-matching event does nothing; unsubscribe stops re-firing.
 *
 * The WebGL pixels (a real game spawning particles on an event, the bone layer riding the rig)
 * still need live owner-verify (see the design doc).
 */

import { createEventEmitter } from 'utils-event-emitter';
import { layerTrigger, planLayer, type EmitterConfigV3, type EmitterLayer } from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const baseConfig = (): EmitterConfigV3 => ({
	lifetime: { min: 0.5, max: 0.8 },
	frequency: 0.012,
	emitterLifetime: -1,
	maxParticles: 200,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [{ type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }] } } }],
});

const layer = (over: Partial<EmitterLayer>): EmitterLayer => ({
	key: 'layer-x',
	config: baseConfig(),
	art: { assetKey: 'sparks', frames: ['s1'] },
	placement: { space: 'free' },
	particleKind: 'sprite',
	...over,
});

// ---------------------------------------------------------------------------
// 1. Pure trigger classification (the seam `<EffectLayer>` stands on).
// ---------------------------------------------------------------------------
console.log('fx trigger — pure classification');

const ambient = layerTrigger(layer({ trigger: { on: 'always' } }));
assert(ambient.mode === 'always' && ambient.emit === true, 'an `always` trigger emits at mount');
assert(
	ambient.eventType === undefined,
	'an ambient layer carries no eventType (nothing to subscribe)',
);

const noTrigger = layerTrigger(layer({ trigger: undefined }));
assert(
	noTrigger.mode === 'always' && noTrigger.emit === true,
	'a layer with NO trigger is treated as ambient (emits at mount)',
);

const evented = layerTrigger(
	layer({ trigger: { on: 'event', eventType: 'bigWin', duration: 800 } }),
);
assert(
	evented.mode === 'event' && evented.emit === false,
	'an `event` trigger is dormant at mount (emit false until its event fires)',
);
assert(
	evented.eventType === 'bigWin' && evented.duration === 800,
	'an `event` trigger carries its eventType + duration for the subscription',
);

const eventNoType = layerTrigger(layer({ trigger: { on: 'event' } }));
assert(
	eventNoType.mode === 'event' && eventNoType.eventType === undefined,
	'an `event` trigger with NO eventType stays dormant (can never fire — fail-safe)',
);

// planLayer surfaces the same trigger plan alongside the mount plan.
const plan = planLayer(layer({ trigger: { on: 'event', eventType: 'winShow' } }));
assert(
	plan.emit === false && plan.trigger.mode === 'event' && plan.trigger.eventType === 'winShow',
	'planLayer carries the trigger plan (emit gating + eventType) onto the mount plan',
);

// ---------------------------------------------------------------------------
// 2. Subscribe / fire / stop against the REAL event bus.
//    Replicates `<EffectLayer>`'s subscription so the live gating logic is pinned.
// ---------------------------------------------------------------------------
console.log('fx trigger — subscribe / fire / stop on the real bus');

/**
 * Wire one layer to a real `createEventEmitter` bus exactly as `<EffectLayer>` does: ambient ⇒
 * emit at once; `event` ⇒ dormant, subscribe `eventType`, pulse emit on each matching event and
 * (when a `duration` is set) stop after that many ms via a timer. Returns the live emit getter,
 * a manual `tick(ms)` that fires due timers (deterministic — no real clock), and `dispose`.
 */
function wireLayer(emitterLayer: EmitterLayer) {
	const trigger = layerTrigger(emitterLayer);
	let emitting = trigger.emit;

	// A tiny deterministic timer shim so the harness needs no real time.
	let pendingStopAt: number | undefined;
	let now = 0;
	const tick = (ms: number): void => {
		now += ms;
		if (pendingStopAt !== undefined && now >= pendingStopAt) {
			emitting = false;
			pendingStopAt = undefined;
		}
	};

	const { eventEmitter } = createEventEmitter<{ type: string }>();
	let unsubscribe = (): void => {};
	if (trigger.mode === 'event' && trigger.eventType) {
		const eventType = trigger.eventType;
		const duration = trigger.duration;
		unsubscribe = eventEmitter.subscribe({
			[eventType]: () => {
				emitting = true;
				pendingStopAt = undefined;
				if (typeof duration === 'number' && duration >= 0) {
					pendingStopAt = now + duration;
				}
			},
		});
	}

	return {
		get emitting() {
			return emitting;
		},
		fire: (type: string) => eventEmitter.broadcast({ type }),
		tick,
		dispose: () => {
			unsubscribe();
			emitting = false;
		},
	};
}

// Ambient: emitting from the start, ignores events.
const amb = wireLayer(layer({ trigger: { on: 'always' } }));
assert(amb.emitting === true, 'ambient layer emits immediately');
amb.fire('bigWin');
assert(amb.emitting === true, 'ambient layer stays emitting (events do not gate it)');

// Event with duration: dormant → fires on its type → stops after duration.
const ev = wireLayer(layer({ trigger: { on: 'event', eventType: 'bigWin', duration: 500 } }));
assert(ev.emitting === false, 'event layer is dormant before its event');
ev.fire('winShow');
assert(ev.emitting === false, 'a NON-matching event does not start an event layer');
ev.fire('bigWin');
assert(ev.emitting === true, 'the matching event STARTS the event layer');
ev.tick(499);
assert(ev.emitting === true, 'still emitting just before the duration elapses');
ev.tick(1);
assert(ev.emitting === false, 'the layer STOPS after `duration` ms');

// Re-fire re-arms the burst (and resets the stop timer).
ev.fire('bigWin');
assert(ev.emitting === true, 'a re-fire restarts the burst');
ev.tick(250);
ev.fire('bigWin');
ev.tick(300);
assert(ev.emitting === true, 're-firing mid-burst RESETS the stop timer (still within 500ms)');
ev.tick(200);
assert(ev.emitting === false, 'stops 500ms after the LAST fire');

// Event with NO duration: fires and stays on (the config emitterLifetime governs in-game).
const evNoDur = wireLayer(layer({ trigger: { on: 'event', eventType: 'winShow' } }));
evNoDur.fire('winShow');
assert(evNoDur.emitting === true, 'a duration-less event layer fires and stays emitting');
evNoDur.tick(100000);
assert(
	evNoDur.emitting === true,
	'with no duration it never auto-stops (config emitterLifetime governs the burst)',
);

// Unsubscribe stops re-firing (no leak).
const ev2 = wireLayer(layer({ trigger: { on: 'event', eventType: 'bigWin', duration: 100 } }));
ev2.dispose();
ev2.fire('bigWin');
assert(ev2.emitting === false, 'after dispose, the matching event no longer fires the layer');

console.log('');
if (failures === 0) {
	console.log('FX TRIGGER: PASSED');
} else {
	console.error(`FX TRIGGER: ${failures} FAILURE(S)`);
	process.exit(1);
}
