/**
 * Offline fixture for the render quality gate (`qualityGate.ts`) — run with:
 *   pnpm check:all --only qualityGate
 *
 * Pins: a slot game (any game that is not a play field) gets its own gate back, the same functions,
 * so it measures on `isPlaying` and switches on its quiet exactly as before, and never reads the
 * arcade clock; an arcade game measures while its play field ticks, not in the settling time after
 * a level mounts nor once the field stopped ticking, and is quiet exactly when it does not measure.
 */

import {
	ARCADE_SETTLE_MS,
	FIELD_STALE_MS,
	lastFieldTick,
	noteFieldTick,
	qualityGate,
	type FieldClock,
} from './qualityGate.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

// A slot machine as Game.svelte reads it: playing or idle.
let playing = false;
const slot = { measuring: () => playing, quiet: () => !playing };
let clockReads = 0;
let clock: FieldClock = { now: 0 };
const readClock = () => {
	clockReads += 1;
	return clock;
};

console.log('a slot game keeps its gate');
const slotGate = qualityGate(false, slot, readClock);
check('the same measuring', slotGate.measuring === slot.measuring);
check('the same quiet', slotGate.quiet === slot.quiet);
check('idle: not measured, quiet', !slotGate.measuring() && slotGate.quiet());
playing = true;
check('a round plays: measured, not quiet', slotGate.measuring() && !slotGate.quiet());
clock = { now: 10_000, tickedAt: 9_990 };
check('a ticking field elsewhere changes nothing', slotGate.measuring());
check('the arcade clock is never read', clockReads === 0);

console.log('an arcade game measures its play');
playing = false;
const arcadeGate = qualityGate(true, slot, readClock);
const at = (c: FieldClock) => {
	clock = c;
	return { measuring: arcadeGate.measuring(), quiet: arcadeGate.quiet() };
};
const both = (g: { measuring: boolean; quiet: boolean }, measuring: boolean) =>
	g.measuring === measuring && g.quiet === !measuring;
check(
	'the machine idle does not matter',
	clockReads === 0 && arcadeGate.measuring !== slot.measuring,
);
check('no field tick yet: quiet', both(at({ now: 5_000 }), false));
check('the field ticks: measured', both(at({ now: 5_000, tickedAt: 4_984 }), true));
check(
	'the field ticked long ago: quiet',
	both(at({ now: 5_000, tickedAt: 5_000 - FIELD_STALE_MS }), false),
);
check(
	'a level just mounted: settling, quiet',
	both(at({ now: 5_000, tickedAt: 4_990, mountedAt: 5_000 - ARCADE_SETTLE_MS + 1 }), false),
);
check(
	'past the settling time: measured',
	both(at({ now: 5_000, tickedAt: 4_990, mountedAt: 5_000 - ARCADE_SETTLE_MS }), true),
);
check(
	'a long session (mount long ago): measured',
	both(at({ now: 600_000, tickedAt: 599_984, mountedAt: 1_000 }), true),
);
check('the clock was read', clockReads > 0);

console.log('the field tick note');
check('nothing noted at start', lastFieldTick() === undefined);
noteFieldTick(1234);
check('the last tick is kept', lastFieldTick() === 1234);
const live = qualityGate(true, slot, () => ({ now: 1250, tickedAt: lastFieldTick() }));
check('a noted tick is play', live.measuring() && !live.quiet());

if (failures) throw new Error(`qualityGate.fixture: ${failures} check(s) failed`);
console.log('\nqualityGate.fixture: all ok');
