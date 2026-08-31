/**
 * Guard the rig→FLIPBOOK binding contract end to end, offline — the clip twin of
 * `check-rig-fx-overrides.ts`.
 *
 * Run: `pnpm --filter launcher-api run check:rig-flipbook-overrides`
 *
 * WHY. A keyframe's overrides are read in three places that must agree: the BAKE
 * (`flipbookBindingsFromSkeleton` → the game's manifest), the per-keyframe TIMELINE the live
 * previews cross (`flipbookTimelineFromSkeleton`), and the runtime REGISTRY the game resolves
 * through (`registerRigFlipbooks`/`resolveRigFlipbooks`). All three clamp through ONE function,
 * `readRigFlipbookOverrides` — and this is what holds them to it.
 *
 * Three rules here are load-bearing and none is obvious from the code:
 *
 *  1. **Blank is not a default.** An unset override must stay ABSENT all the way through, so a rig
 *     that never used one bakes byte-identically to before they existed.
 *  2. **`false` is not blank — for the playback flags.** `loop`, `flipX` and `flipY` all have a
 *     non-false default somewhere in the chain (a clip may be authored looping or mirrored), so a
 *     binding must be able to store `false`. Dropping it the way `continuous: false` is dropped
 *     would make "play this one once" unauthorable. `continuous` is the one whose default really is
 *     `false`, so only its opt-in is stored.
 *  3. **Placement identifies a binding; the settings ride along.** The manifest is keyed by the
 *     event NAME, so the bake de-dupes on `(event, clipId, bone, slot)` and keeps the FIRST match's
 *     settings. Putting them in the key would mount one event twice and play two overlapping clips
 *     on every beat — the failure this asserts against.
 *
 * The launcher's `build` is NOT a typecheck (see apps/launcher-api/CLAUDE.md), so a green build
 * proves nothing about any of this. This runs the real modules.
 */
import {
	readRigFlipbookOverrides,
	registerRigFlipbooks,
	resolveRigFlipbooks,
	clearRigFlipbooks,
} from 'engine-layout';

import {
	flipbookBindingsFromSkeleton,
	flipbookTimelineFromSkeleton,
} from '../src/lib/server/rigFlipbookExport';

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

// ── 1. readRigFlipbookOverrides: the one clamp ──────────────────────────────────────────────────
eq('nothing authored ⇒ nothing set', readRigFlipbookOverrides({}), {});
eq('non-object ⇒ nothing set', readRigFlipbookOverrides(null), {});
eq(
	'every override read through',
	readRigFlipbookOverrides({
		slot: 'hand',
		alpha: 0.5,
		scale: 2,
		delay: 100,
		duration: 400,
		fps: 30,
		loop: false,
		direction: 'pingpong',
		flipX: true,
		flipY: false,
		continuous: true,
	}),
	{
		slot: 'hand',
		continuous: true,
		loop: false,
		flipX: true,
		flipY: false,
		direction: 'pingpong',
		alpha: 0.5,
		scale: 2,
		delay: 100,
		duration: 400,
		fps: 30,
	},
);
// Rule 1 — absent stays absent, never defaulted.
check('no alpha key when unauthored', !('alpha' in readRigFlipbookOverrides({ slot: 'hand' })));
check('no slot key when unauthored', !('slot' in readRigFlipbookOverrides({ alpha: 1 })));
check('empty slot string is not a slot', !('slot' in readRigFlipbookOverrides({ slot: '' })));
check('no loop key when unauthored', !('loop' in readRigFlipbookOverrides({ alpha: 1 })));
check('no direction key when unauthored', !('direction' in readRigFlipbookOverrides({ alpha: 1 })));
// Rule 2 — an explicit false on a playback flag SURVIVES; only `continuous: false` is dropped.
eq('loop:false survives', readRigFlipbookOverrides({ loop: false }), { loop: false });
eq('flipX:false survives', readRigFlipbookOverrides({ flipX: false }), { flipX: false });
check(
	'continuous:false is dropped (its default IS false)',
	!('continuous' in readRigFlipbookOverrides({ continuous: false })),
);
// Out-of-range and malformed are DROPPED, not coerced — a hand-edited rig cannot reach a renderer.
check('alpha above 1 dropped', !('alpha' in readRigFlipbookOverrides({ alpha: 3 })));
check('alpha below 0 dropped', !('alpha' in readRigFlipbookOverrides({ alpha: -1 })));
check('negative delay dropped', !('delay' in readRigFlipbookOverrides({ delay: -5 })));
check('NaN scale dropped', !('scale' in readRigFlipbookOverrides({ scale: Number.NaN })));
check(
	'Infinity duration dropped',
	!('duration' in readRigFlipbookOverrides({ duration: Infinity })),
);
check('string alpha dropped', !('alpha' in readRigFlipbookOverrides({ alpha: '0.5' })));
check(
	'unknown direction dropped',
	!('direction' in readRigFlipbookOverrides({ direction: 'zig' })),
);
check('loop as a string is not a boolean', !('loop' in readRigFlipbookOverrides({ loop: 'yes' })));
// A ZERO framerate is a stopped clip, not a slow one — and `<Flipbook>` reads `fps ?? 24`, so
// storing 0 would silently become 24 in game while the doc claimed otherwise.
check('fps 0 dropped', !('fps' in readRigFlipbookOverrides({ fps: 0 })));
check('negative fps dropped', !('fps' in readRigFlipbookOverrides({ fps: -12 })));
eq('a positive fps survives', readRigFlipbookOverrides({ fps: 12 }), { fps: 12 });

// ── 2. the bake: what identifies a binding ──────────────────────────────────────────────────────
const skeleton = (events: unknown[]) => ({ animations: { idle: { events } } });

eq(
	'a bare binding bakes with no override keys',
	flipbookBindingsFromSkeleton(skeleton([{ name: 'flash', flipbook: { clipId: 'c1' } }])),
	[{ event: 'flash', clipId: 'c1' }],
);
eq(
	'bone + slot + settings all travel',
	flipbookBindingsFromSkeleton(
		skeleton([
			{
				name: 'flash',
				flipbook: { clipId: 'c1', bone: 'hand', slot: 'fx', scale: 2, loop: false },
			},
		]),
	),
	[{ event: 'flash', clipId: 'c1', bone: 'hand', slot: 'fx', loop: false, scale: 2 }],
);
// Rule 3 — same (event, clip, bone, slot) is ONE binding however the settings differ.
check(
	'two keyframes of one binding collapse to one mount',
	flipbookBindingsFromSkeleton(
		skeleton([
			{ name: 'flash', flipbook: { clipId: 'c1', scale: 1 } },
			{ time: 0.5, name: 'flash', flipbook: { clipId: 'c1', scale: 2 } },
		]),
	).length === 1,
);
check(
	'…and the FIRST match’s settings win',
	flipbookBindingsFromSkeleton(
		skeleton([
			{ name: 'flash', flipbook: { clipId: 'c1', scale: 1 } },
			{ time: 0.5, name: 'flash', flipbook: { clipId: 'c1', scale: 2 } },
		]),
	)[0]?.scale === 1,
);
check(
	'a different SLOT is a different binding (placement is identity)',
	flipbookBindingsFromSkeleton(
		skeleton([
			{ name: 'flash', flipbook: { clipId: 'c1', slot: 'a' } },
			{ time: 0.5, name: 'flash', flipbook: { clipId: 'c1', slot: 'b' } },
		]),
	).length === 2,
);
check(
	'an event with no clip bound contributes nothing',
	flipbookBindingsFromSkeleton(skeleton([{ name: 'cue' }, { name: 'x', flipbook: {} }])).length ===
		0,
);
check(
	'an FX-only event does not become a clip binding',
	flipbookBindingsFromSkeleton(skeleton([{ name: 'boom', fx: { effectId: 'e1' } }])).length === 0,
);

// ── 3. the timeline: per-keyframe, NOT de-duped ─────────────────────────────────────────────────
const tl = flipbookTimelineFromSkeleton(
	skeleton([
		{ time: 0.5, name: 'flash', flipbook: { clipId: 'c1', scale: 2 } },
		{ name: 'flash', flipbook: { clipId: 'c1', scale: 1 } },
	]),
);
check('both keyframes survive the timeline', tl.idle?.length === 2);
// Spine OMITS `time` when it is 0, so an absent time must read as t=0 — not as "no time", which
// would drop the beat every author puts at the very start of a clip.
eq(
	'sorted, and an absent time IS t=0',
	tl.idle?.map((b) => b.time),
	[0, 0.5],
);
eq(
	'per-keyframe settings are kept apart',
	tl.idle?.map((b) => b.scale),
	[1, 2],
);

// ── 4. the registry: the same clamp on the way in ───────────────────────────────────────────────
clearRigFlipbooks();
registerRigFlipbooks({
	rig: [
		{ event: 'flash', clipId: 'c1', bone: 'hand', slot: 'fx', alpha: 0.5, fps: 30, loop: false },
		{ event: 'flash2', clipId: 'c2', alpha: 9, delay: -1, direction: 'sideways' as never },
		{ event: '', clipId: 'c3' },
	],
});
eq('a good binding round-trips whole', resolveRigFlipbooks('rig')[0], {
	event: 'flash',
	clipId: 'c1',
	bone: 'hand',
	slot: 'fx',
	loop: false,
	alpha: 0.5,
	fps: 30,
});
check('a nameless binding is dropped at registration', resolveRigFlipbooks('rig').length === 2);
check(
	'the registry clamps too — bad alpha never reaches a renderer',
	!('alpha' in resolveRigFlipbooks('rig')[1]),
);
check('…and bad delay with it', !('delay' in resolveRigFlipbooks('rig')[1]));
check('…and an unknown direction', !('direction' in resolveRigFlipbooks('rig')[1]));
check('unknown rig ⇒ empty, never a throw', resolveRigFlipbooks('nope').length === 0);

// The flag has to TRAVEL: authored on the keyframe → baked into the manifest → out of the registry.
check(
	'continuous survives the bake',
	flipbookBindingsFromSkeleton(
		skeleton([{ name: 'amb', flipbook: { clipId: 'c1', continuous: true } }]),
	)[0]?.continuous === true,
);
clearRigFlipbooks();
registerRigFlipbooks({ rig2: [{ event: 'amb', clipId: 'c1', continuous: true }] });
check('…and the registry', resolveRigFlipbooks('rig2')[0]?.continuous === true);
// …as does an explicit `loop: false`, which is the one an over-eager sparse rule would eat.
clearRigFlipbooks();
registerRigFlipbooks({ rig3: [{ event: 'one', clipId: 'c1', loop: false }] });
check('loop:false survives registration', resolveRigFlipbooks('rig3')[0]?.loop === false);

// The folder-tolerant lookup a Symbols-shipped rig depends on must survive the clamp rewrite — it is
// shared with `resolveRigFx` (`bundleFolderOf`), so a break here breaks both.
clearRigFlipbooks();
registerRigFlipbooks({ myrig: [{ event: 'e', clipId: 'c' }] });
check(
	'a full R2 bundle prefix still resolves to its folder',
	resolveRigFlipbooks('client/project/spines/myrig/').length === 1,
);

if (fails > 0) {
	console.error(`\n${fails} check(s) failed.`);
	process.exit(1);
}
console.log('rig-flipbook overrides: all checks passed');
