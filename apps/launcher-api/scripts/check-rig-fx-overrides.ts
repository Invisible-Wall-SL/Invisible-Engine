/**
 * Guard the rig→FX binding OVERRIDES contract end to end, offline.
 *
 * Run: `pnpm --filter launcher-api run check:rig-fx-overrides`
 *
 * WHY. A keyframe's overrides (slot / opacity / size / delay / duration / speed) are read in three
 * places that must agree: the BAKE (`bindingsFromSkeleton` → the game's manifest), the per-keyframe
 * TIMELINE the live previews cross (`fxTimelineFromSkeleton`), and the runtime REGISTRY the game
 * resolves through (`registerRigFx`/`resolveRigFx`). All three clamp through ONE function,
 * `readRigFxOverrides` — and this is what holds them to it.
 *
 * Two rules here are load-bearing and neither is obvious from the code:
 *
 *  1. **Blank is not a default.** An unset override must stay ABSENT all the way through, so a rig
 *     that never used one bakes byte-identically to before they existed. A clamp that helpfully
 *     wrote `alpha: 1` would change every existing binding's manifest.
 *  2. **A binding is one KEYFRAME.** The manifest carries the beat — `animation` + `time` — beside
 *     the event name, so two keys of one name are two bindings that fire at their own time with
 *     their own numbers. It used to be keyed by the NAME alone, which made an effect on the 1s key
 *     fire on the 0.01s key beside the flipbook there — the failure this asserts against. Only a
 *     literal duplicate (same beat, same effect, same place) collapses.
 *
 * The launcher's `build` is NOT a typecheck (see apps/launcher-api/CLAUDE.md), so a green build
 * proves nothing about any of this. This runs the real modules.
 */
import {
	clearRigFx,
	readRigBeat,
	readRigFxOverrides,
	registerRigFx,
	resolveRigFx,
} from 'engine-layout';

import { bindingsFromSkeleton, fxTimelineFromSkeleton } from '../src/lib/server/rigFxExport';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		`${name} (got ${JSON.stringify(actual)})`,
		JSON.stringify(actual) === JSON.stringify(expected),
	);

// ── 1. readRigFxOverrides: the one clamp ────────────────────────────────────────────────────────
eq('nothing authored ⇒ nothing set', readRigFxOverrides({}), {});
eq('non-object ⇒ nothing set', readRigFxOverrides(null), {});
eq(
	'every override read through',
	readRigFxOverrides({ slot: 'head', alpha: 0.5, scale: 2, delay: 100, duration: 400, speed: 1.5 }),
	{ slot: 'head', alpha: 0.5, scale: 2, delay: 100, duration: 400, speed: 1.5 },
);
// Rule 1 — absent stays absent, never defaulted.
check('no alpha key when unauthored', !('alpha' in readRigFxOverrides({ slot: 'head' })));
check('no slot key when unauthored', !('slot' in readRigFxOverrides({ alpha: 1 })));
check('empty slot string is not a slot', !('slot' in readRigFxOverrides({ slot: '' })));
// Out-of-range and malformed are DROPPED, not coerced — a hand-edited rig cannot reach an emitter.
check('alpha above 1 dropped', !('alpha' in readRigFxOverrides({ alpha: 3 })));
check('alpha below 0 dropped', !('alpha' in readRigFxOverrides({ alpha: -1 })));
check('negative delay dropped', !('delay' in readRigFxOverrides({ delay: -5 })));
check('NaN speed dropped', !('speed' in readRigFxOverrides({ speed: Number.NaN })));
check('Infinity duration dropped', !('duration' in readRigFxOverrides({ duration: Infinity })));
check('string alpha dropped', !('alpha' in readRigFxOverrides({ alpha: '0.5' })));
eq('alpha 0 is a real value, not falsy-dropped', readRigFxOverrides({ alpha: 0 }), { alpha: 0 });

// `continuous` is the one BOOLEAN override: only the opt-in is stored, so the doc stays sparse and
// a binding that never used it bakes exactly as it did before the flag existed.
eq('continuous:true is read through', readRigFxOverrides({ continuous: true }), {
	continuous: true,
});
check(
	'continuous:false is not stored',
	!('continuous' in readRigFxOverrides({ continuous: false })),
);
check('a truthy non-boolean is rejected', !('continuous' in readRigFxOverrides({ continuous: 1 })));
check('the string true is rejected', !('continuous' in readRigFxOverrides({ continuous: 'true' })));

// ── 2. bindingsFromSkeleton: what the GAME gets ─────────────────────────────────────────────────
const skeleton = (events: unknown[]) => ({ animations: { idle: { events } } });

eq(
	'a bare binding bakes with its beat and no override keys',
	bindingsFromSkeleton(skeleton([{ time: 0, name: 'boom', fx: { effectId: 'e1' } }])),
	[{ event: 'boom', animation: 'idle', time: 0, effectId: 'e1' }],
);
eq(
	'overrides ride into the manifest',
	bindingsFromSkeleton(
		skeleton([{ time: 0, name: 'boom', fx: { effectId: 'e1', slot: 'head', alpha: 0.4 } }]),
	),
	[{ event: 'boom', animation: 'idle', time: 0, effectId: 'e1', slot: 'head', alpha: 0.4 }],
);
check(
	'a keyframe with no time bakes as t=0 (spine omits a zero time)',
	bindingsFromSkeleton(skeleton([{ name: 'boom', fx: { effectId: 'e1' } }]))[0]?.time === 0,
);
// Rule 2 — two keys of one name are TWO bindings, each with its own beat and its own numbers.
// (The reported bug: a clip keyed at 0.01s and an effect keyed at 1s, both on the default name.)
const twoKeys = bindingsFromSkeleton(
	skeleton([
		{ time: 0.01, name: 'event', fx: { effectId: 'e1', alpha: 0.2 } },
		{ time: 1, name: 'event', fx: { effectId: 'e1', alpha: 0.9 } },
	]),
);
check('two keys of one name are two bindings', twoKeys.length === 2);
eq('…each on its own beat', [twoKeys[0]?.time, twoKeys[1]?.time], [0.01, 1]);
eq('…each with its own numbers', [twoKeys[0]?.alpha, twoKeys[1]?.alpha], [0.2, 0.9]);
check(
	'the same name in another animation is another beat',
	bindingsFromSkeleton({
		animations: {
			idle: { events: [{ name: 'event', fx: { effectId: 'e1' } }] },
			win: { events: [{ name: 'event', fx: { effectId: 'e1' } }] },
		},
	})
		.map((b) => b.animation)
		.join() === 'idle,win',
);
// Only a literal duplicate collapses: same beat, same effect, same place.
check(
	'a duplicated key at one beat is ONE binding',
	bindingsFromSkeleton(
		skeleton([
			{ time: 0.5, name: 'boom', fx: { effectId: 'e1', alpha: 0.2 } },
			{ time: 0.5, name: 'boom', fx: { effectId: 'e1', alpha: 0.9 } },
		]),
	).length === 1,
);
check(
	'…but a different slot at that beat is a second one (placement is identity)',
	bindingsFromSkeleton(
		skeleton([
			{ time: 0.5, name: 'boom', fx: { effectId: 'e1', slot: 'head' } },
			{ time: 0.5, name: 'boom', fx: { effectId: 'e1', slot: 'body' } },
		]),
	).length === 2,
);
check(
	'a rejected value cannot sneak in through the bake',
	!(
		'alpha' in
		(bindingsFromSkeleton(skeleton([{ name: 'boom', fx: { effectId: 'e1', alpha: 99 } }]))[0] ?? {})
	),
);

// ── 3. fxTimelineFromSkeleton: what the PREVIEWS get ────────────────────────────────────────────
const timeline = fxTimelineFromSkeleton(
	skeleton([
		{ time: 0, name: 'boom', fx: { effectId: 'e1', alpha: 0.2 } },
		{ time: 1, name: 'boom', fx: { effectId: 'e1', alpha: 0.9 } },
	]),
);
check(
	'the timeline keeps BOTH beats (it is per-keyframe, not name-keyed)',
	timeline.idle?.length === 2,
);
eq(
	'…each with its own overrides',
	[timeline.idle?.[0]?.alpha, timeline.idle?.[1]?.alpha],
	[0.2, 0.9],
);
check(
	'a keyframe with no time is t=0 (spine omits a zero time)',
	fxTimelineFromSkeleton(skeleton([{ name: 'boom', fx: { effectId: 'e1' } }])).idle?.[0]?.time ===
		0,
);

// ── 3b. readRigBeat: the beat clamp the registry reads through ──────────────────────────────────
eq('a beat reads through', readRigBeat({ animation: 'win', time: 0.25 }), {
	animation: 'win',
	time: 0.25,
});
eq('t=0 is a real beat, not falsy-dropped', readRigBeat({ animation: 'win', time: 0 }), {
	animation: 'win',
	time: 0,
});
check('an empty animation name is not a beat', !('animation' in readRigBeat({ animation: '' })));
check('a negative time is dropped', !('time' in readRigBeat({ time: -1 })));
check('a NaN time is dropped', !('time' in readRigBeat({ time: Number.NaN })));
check('a string time is dropped', !('time' in readRigBeat({ time: '0.5' })));
eq('a legacy name-only binding has no beat', readRigBeat({ event: 'e', effectId: 'x' }), {});

// ── 4. registerRigFx/resolveRigFx: what the RUNTIME renders ─────────────────────────────────────
clearRigFx();
registerRigFx({
	rig: [
		{ event: 'boom', effectId: 'e1', bone: 'b', slot: 'head', alpha: 0.5, speed: 2 },
		// Junk the manifest should never contain, but which a hand-edited bundle could carry.
		{ event: 'bad', effectId: 'e2', alpha: 42, delay: -1 },
		{ event: '', effectId: 'e3' } as never,
	],
});
eq('a good binding round-trips whole', resolveRigFx('rig')[0], {
	event: 'boom',
	effectId: 'e1',
	bone: 'b',
	slot: 'head',
	alpha: 0.5,
	speed: 2,
});
check('a nameless binding is dropped at registration', resolveRigFx('rig').length === 2);
check(
	'the registry clamps too — bad alpha never reaches a renderer',
	!('alpha' in resolveRigFx('rig')[1]),
);
check('…and bad delay with it', !('delay' in resolveRigFx('rig')[1]));
check('unknown rig ⇒ empty, never a throw', resolveRigFx('nope').length === 0);
// The beat survives registration, and a pre-beat manifest still registers (name-only firing).
registerRigFx({
	beat: [
		{ event: 'e', animation: 'win', time: 0.01, effectId: 'x' },
		{ event: 'e', animation: 'win', time: 1, effectId: 'y' },
		{ event: 'e', effectId: 'legacy' },
	],
});
eq(
	'the beat rides through the registry',
	resolveRigFx('beat').map((b) => [b.animation, b.time]),
	[
		['win', 0.01],
		['win', 1],
		[undefined, undefined],
	],
);

// The flag has to TRAVEL: authored on the keyframe → baked into the manifest → out of the registry.
check(
	'continuous survives the bake',
	bindingsFromSkeleton(skeleton([{ name: 'boom', fx: { effectId: 'e1', continuous: true } }]))[0]
		?.continuous === true,
);
clearRigFx();
registerRigFx({ rig2: [{ event: 'e', effectId: 'x', continuous: true }] });
check('…and the registry', resolveRigFx('rig2')[0]?.continuous === true);
// The folder-tolerant lookup a Symbols-shipped rig depends on must survive the clamp rewrite.
clearRigFx();
registerRigFx({ myrig: [{ event: 'e', effectId: 'x' }] });
check(
	'a full R2 bundle prefix still resolves to its folder',
	resolveRigFx('client/project/spines/myrig/').length === 1,
);

if (fails > 0) {
	console.error(`\n${fails} check(s) failed.`);
	process.exit(1);
}
console.log('rig-fx overrides: all checks passed');
