/**
 * Invisible FX — `/fx` trigger PICKER headless harness (the UI mutators behind the
 * inspector's Trigger section). The live dropdown pixels are authed-page-only, so — as the
 * sibling tools do — the PURE editing logic + the save→reopen survival are pinned OFFLINE:
 *
 *   pnpm --filter fx-spike run trigger-ui
 *
 * Proves:
 *  1. The trigger mutators (`setTriggerMode` / `setTriggerEvent` / `setTriggerDuration`) are
 *     PURE + immutable, edit ONLY `layer.trigger` (never the verbatim `config`, never the
 *     placement), and the always↔event toggle is non-destructive for event mode but DROPS
 *     `eventType`/`duration` when going `always` (mirroring `setPlacementSpace('free')`).
 *  2. `triggerMode` reads the inspector default (no trigger ⇒ `always`).
 *  3. An authored trigger SURVIVES `normalizeEffectDoc` (the save→reopen gatekeeper) — every
 *     shape the picker can produce (ambient, event+type+duration, event+type-no-duration,
 *     event-no-type dormant) round-trips byte-identically and idempotently.
 */

import { normalizeEffectDoc, type EffectDoc, type EmitterLayer } from 'engine-fx';
import {
	newLayer,
	setTriggerDuration,
	setTriggerEvent,
	setTriggerMode,
	triggerMode,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. Trigger mutators are pure, immutable, and touch ONLY `trigger`.
// ---------------------------------------------------------------------------
console.log('fx trigger-ui — mutators');
const base = newLayer('layer-1');
const baseSnapshot = JSON.stringify(base);

assert(triggerMode(base) === 'always', 'a new layer (no trigger) reads as `always`');

const toEvent = setTriggerMode(base, 'event');
assert(JSON.stringify(base) === baseSnapshot, 'setTriggerMode does not mutate its input');
assert(base.trigger === undefined, 'input layer keeps no trigger (immutable)');
assert(toEvent.trigger?.on === 'event', 'switching to event sets on=event');
assert(triggerMode(toEvent) === 'event', 'triggerMode reads the switched mode');
assert(eq(toEvent.config, base.config), 'setTriggerMode leaves `config` byte-identical');
assert(eq(toEvent.placement, base.placement), 'setTriggerMode leaves `placement` byte-identical');

const onEvt = setTriggerEvent(toEvent, 'winShow');
assert(onEvt.trigger?.eventType === 'winShow', 'setTriggerEvent sets the eventType');
assert(onEvt.trigger?.on === 'event', 'setTriggerEvent forces on=event');
assert(eq(onEvt.config, base.config), 'setTriggerEvent leaves `config` byte-identical');

const withDur = setTriggerDuration(onEvt, 1200);
assert(withDur.trigger?.duration === 1200, 'setTriggerDuration sets the duration');
assert(withDur.trigger?.eventType === 'winShow', 'setTriggerDuration keeps the eventType');
assert(onEvt.trigger?.duration === undefined, 'duration edit does not mutate the prior layer');

// A blank duration (NaN from the UI's numOrBlank) CLEARS it → emitterLifetime governs.
const clearedDur = setTriggerDuration(withDur, Number.NaN);
assert(clearedDur.trigger?.duration === undefined, 'a NaN/blank duration clears it');
assert(clearedDur.trigger?.eventType === 'winShow', 'clearing duration keeps the eventType');

// Clearing the event (empty string) leaves the layer event-mode but dormant (no eventType).
const clearedEvt = setTriggerEvent(withDur, '   ');
assert(clearedEvt.trigger?.on === 'event', 'clearing the event keeps on=event');
assert(clearedEvt.trigger?.eventType === undefined, 'an empty/whitespace event clears the binding');
assert(clearedEvt.trigger?.duration === 1200, 'clearing the event keeps the duration');

// always↔event toggle: going `always` DROPS eventType + duration; going back to `event` is
// non-destructive ONLY across an event↔event-ish path (always wipes — by design, like free).
const backAlways = setTriggerMode(withDur, 'always');
assert(backAlways.trigger?.on === 'always', 'toggle back to always');
assert(backAlways.trigger?.eventType === undefined, 'going always drops the eventType');
assert(backAlways.trigger?.duration === undefined, 'going always drops the duration');
assert(eq(backAlways.config, base.config), 'going always leaves `config` byte-identical');

// event→event toggle keeps the fields (the non-destructive path the spec calls for).
const reEvent = setTriggerMode(setTriggerMode(withDur, 'event'), 'event');
assert(reEvent.trigger?.eventType === 'winShow', 'event↔event keeps the eventType');
assert(reEvent.trigger?.duration === 1200, 'event↔event keeps the duration');

// ---------------------------------------------------------------------------
// 2. An authored trigger survives normalizeEffectDoc (save→reopen).
// ---------------------------------------------------------------------------
console.log('fx trigger-ui — normalize round-trip');

const withTrigger = (key: string, trigger: EmitterLayer['trigger']): EmitterLayer => ({
	...newLayer(key),
	art: { assetKey: 'atlas_manifest_fx.json', frames: ['spark'] },
	trigger,
});

const authored: EffectDoc = {
	version: 1,
	id: 'burst',
	name: 'Burst',
	layers: [
		withTrigger('ambient', { on: 'always' }),
		withTrigger('on-win', { on: 'event', eventType: 'winShow', duration: 1200 }),
		withTrigger('on-board', { on: 'event', eventType: 'boardSettle' }),
		withTrigger('dormant', { on: 'event' }),
	],
};

const once = normalizeEffectDoc(authored);
const twice = normalizeEffectDoc(once);
assert(eq(authored, once), 'an authored doc with mixed triggers is a normalize FIXED POINT');
assert(eq(once, twice), 'normalize is idempotent on the authored triggers');

const triggerOf = (doc: EffectDoc, key: string): EmitterLayer['trigger'] =>
	doc.layers.find((l) => l.key === key)?.trigger;

assert(eq(triggerOf(once, 'ambient'), { on: 'always' }), 'ambient trigger survives');
assert(
	eq(triggerOf(once, 'on-win'), { on: 'event', eventType: 'winShow', duration: 1200 }),
	'event+type+duration trigger survives',
);
assert(
	eq(triggerOf(once, 'on-board'), { on: 'event', eventType: 'boardSettle' }),
	'event+type (no duration) trigger survives',
);
assert(
	eq(triggerOf(once, 'dormant'), { on: 'event' }),
	'event with no type (dormant) survives as on=event',
);

// A picker-built doc (mutators applied to fresh layers) also survives a JSON↔normalize round-trip.
let built: EmitterLayer = withTrigger('built', undefined);
built = setTriggerMode(built, 'event');
built = setTriggerEvent(built, 'freeSpinIntroShow');
built = setTriggerDuration(built, 800);
const builtDoc: EffectDoc = { version: 1, id: 'b', name: 'B', layers: [built] };
const builtRt = normalizeEffectDoc(JSON.parse(JSON.stringify(builtDoc)));
assert(
	eq(triggerOf(builtRt, 'built'), { on: 'event', eventType: 'freeSpinIntroShow', duration: 800 }),
	'a picker-built event trigger survives JSON→normalize',
);

// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
	console.log('fx trigger-ui — ALL GREEN');
} else {
	console.error(`fx trigger-ui — ${failures} FAILURE(S)`);
	process.exit(1);
}
