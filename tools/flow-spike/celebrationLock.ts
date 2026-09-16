/**
 * Invisible Flow — SPIN-BUTTON CELEBRATION LOCK harness.
 *
 *   pnpm --filter flow-spike run celebrationlock
 *
 * Proves, HEADLESSLY against the REAL modules, that the lock reads the right signal for each of the
 * two incompatible container authoring models — and, specifically, that a flow seeded from the
 * canonical `drivenSeed` no longer pins the lock on for the whole session.
 *
 * The live failure this covers (`invisible_wall/test6`): the boot chain ran
 * `… → show_14 (freeSpinIntro) → show_15 (freeSpinOutro) → …` and the doc contained no
 * `hideContainer` for either, so both containers stayed mounted forever. A mount-only lock therefore
 * latched at boot and never cleared — greying the TURBO button from the first frame (it disables on
 * the same `isCelebrationLocked` read), killing slam-stop for the entire session, and rendering a
 * rolling spin as a greyed STOP.
 *
 *  A. `hideContainerIds` — the static graph read that tells the two models apart, including through
 *     a collapsed group.
 *  B. `resolveCelebrationLock` — MOUNT-ONCE model (test6): mounted-but-cue-hidden must NOT lock, and
 *     the cue must still lock it while the celebration is actually drawn.
 *  C. `resolveCelebrationLock` — SHOW/HIDE model (Borut): the mount alone still locks, with no cue.
 *  D. Parity — the coded / v1 path (`flowV2DrivesScreens: false`) keeps the bare mount test, and the
 *     name-agnostic `winAwaitTargets` clause is untouched.
 */

import { hideContainerIds } from '../../packages/engine-flow-v2/src/runtime';
import type { FlowDoc } from '../../packages/engine-flow-v2/src/types';
import { resolveCelebrationLock } from '../../apps/lines/src/game/celebrationLock';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

console.log('Invisible Flow — SPIN-BUTTON CELEBRATION LOCK harness\n');

const doc = (nodes: FlowDoc['graph']['nodes']): FlowDoc => ({
	version: 2,
	templateId: 'book-of',
	graph: { nodes, exec: [], data: [] },
	containers: [],
});

const show = (id: string, ref: string) =>
	({ id, kind: 'showContainer', pos: { x: 0, y: 0 }, ref }) as FlowDoc['graph']['nodes'][number];
const hide = (id: string, ref: string) =>
	({ id, kind: 'hideContainer', pos: { x: 0, y: 0 }, ref }) as FlowDoc['graph']['nodes'][number];

// ---------------------------------------------------------------------------
// A. hideContainerIds — the static "does this doc ever take it down?" read.
// ---------------------------------------------------------------------------
console.log('A. hideContainerIds (model discriminator):');

// The test6 shape: everything shown at boot, only `loading` ever hidden.
const mountOnceDoc = doc([
	show('show_0', 'loading'),
	hide('hide_9', 'loading'),
	show('show_10', 'basegame'),
	show('show_14', 'freeSpinIntro'),
	show('show_15', 'freeSpinOutro'),
]);
const mountOnceHides = hideContainerIds(mountOnceDoc);
assert(
	'mount-once doc hides only `loading`',
	mountOnceHides.size === 1 && mountOnceHides.has('loading'),
);
assert('mount-once doc does NOT hide freeSpinIntro', !mountOnceHides.has('freeSpinIntro'));
assert('mount-once doc does NOT hide freeSpinOutro', !mountOnceHides.has('freeSpinOutro'));

// The Borut shape: the celebration is shown and hidden around its presentation.
const showHideDoc = doc([
	show('show_0', 'loading'),
	hide('hide_9', 'loading'),
	show('show_i', 'freeSpinIntro'),
	hide('hide_i', 'freeSpinIntro'),
]);
const showHideHides = hideContainerIds(showHideDoc);
assert('show/hide doc hides freeSpinIntro', showHideHides.has('freeSpinIntro'));

// A `hideContainer` collapsed into a group is still a hide — the scan walks group bodies.
const group = (id: string, body: FlowDoc['graph']['nodes']) =>
	({
		id,
		kind: 'group',
		pos: { x: 0, y: 0 },
		label: 'outro',
		body: { nodes: body, exec: [], data: [] },
		boundary: [],
	}) as FlowDoc['graph']['nodes'][number];

const groupedDoc = doc([
	show('show_i', 'freeSpinIntro'),
	group('grp_1', [hide('hide_o', 'freeSpinOutro')]),
]);
assert(
	'a hideContainer inside a GROUP is still found',
	hideContainerIds(groupedDoc).has('freeSpinOutro'),
);

// A NESTED group body is walked too.
const nestedDoc = doc([group('grp_1', [group('grp_2', [hide('hide_i', 'freeSpinIntro')])])]);
assert(
	'a hideContainer inside a NESTED group is found',
	hideContainerIds(nestedDoc).has('freeSpinIntro'),
);

// A malformed group must not take the boot-time read down (the interpreter tolerates worse).
const malformedDoc = doc([
	{
		id: 'grp_bad',
		kind: 'group',
		pos: { x: 0, y: 0 },
	} as unknown as FlowDoc['graph']['nodes'][number],
	hide('hide_i', 'freeSpinIntro'),
]);
let threw = false;
try {
	assert(
		'a malformed group is skipped, siblings still read',
		hideContainerIds(malformedDoc).has('freeSpinIntro'),
	);
} catch {
	threw = true;
}
assert('hideContainerIds never throws on a malformed group', !threw);

// ---------------------------------------------------------------------------
// B. MOUNT-ONCE model — the test6 regression.
// ---------------------------------------------------------------------------
console.log('\nB. resolveCelebrationLock — mount-once + cue model (test6):');

const mountOnce = (over: Partial<Parameters<typeof resolveCelebrationLock>[0]> = {}) =>
	resolveCelebrationLock({
		// Both celebration containers are mounted for the whole session.
		activeScreenIds: ['basegame', 'hudBar', 'freeSpinIntro', 'freeSpinOutro'],
		flowV2DrivesScreens: true,
		flowHideTargets: mountOnceHides,
		winAwaitTargets: new Set(['loading']),
		introCueShown: false,
		outroCueShown: false,
		...over,
	});

const idle = mountOnce();
assert('THE BUG: mounted-but-cue-hidden intro does NOT lock', idle.intro === false);
assert('THE BUG: mounted-but-cue-hidden outro does NOT lock', idle.outro === false);
assert('…so the turbo button is live at idle', idle.intro === false && idle.outro === false);

const introPlaying = mountOnce({ introCueShown: true });
assert('freeSpinIntroShow cue LOCKS the intro', introPlaying.intro === true);
assert('…and leaves the outro alone', introPlaying.outro === false);

const outroPlaying = mountOnce({ outroCueShown: true });
assert('freeSpinOutroShow cue LOCKS the outro', outroPlaying.outro === true);

// The cue can never outlive its container: both signals are required together.
const unmountedButCued = mountOnce({ activeScreenIds: ['basegame'], introCueShown: true });
assert(
	'a raised cue on an UNMOUNTED container does not lock',
	unmountedButCued.intro === false && unmountedButCued.outro === false,
);

// ---------------------------------------------------------------------------
// C. SHOW/HIDE model — Book of Borut must be unchanged.
// ---------------------------------------------------------------------------
console.log('\nC. resolveCelebrationLock — show/hide model (Borut), no cues at all:');

const borut = (screens: string[]) =>
	resolveCelebrationLock({
		activeScreenIds: screens,
		flowV2DrivesScreens: true,
		flowHideTargets: showHideHides,
		winAwaitTargets: new Set(),
		introCueShown: false,
		outroCueShown: false,
	});

assert(
	'mount alone LOCKS the intro (no cue broadcast)',
	borut(['basegame', 'freeSpinIntro']).intro,
);
assert('unmounting it CLEARS the lock', borut(['basegame']).intro === false);

// ---------------------------------------------------------------------------
// D. Parity — coded / v1 path + the name-agnostic win clause.
// ---------------------------------------------------------------------------
console.log('\nD. parity (coded / v1 path + winAwaitTargets):');

const coded = (screens: string[]) =>
	resolveCelebrationLock({
		activeScreenIds: screens,
		flowV2DrivesScreens: false,
		flowHideTargets: new Set(),
		winAwaitTargets: new Set(['anything']),
		introCueShown: false,
		outroCueShown: false,
	});

assert('coded path: mount alone locks the intro', coded(['freeSpinIntro']).intro === true);
assert('coded path: mount alone locks the outro', coded(['freeSpinOutro']).outro === true);
assert('coded path: `bigWin` still locks the win', coded(['bigWin']).win === true);
assert(
	'coded path: winAwaitTargets is inert (no v2 flow)',
	coded(['anything']).win === false && coded(['anything']).flowHoldsPresentation === false,
);

const held = resolveCelebrationLock({
	activeScreenIds: ['basegame', 'myWinScreen'],
	flowV2DrivesScreens: true,
	flowHideTargets: new Set(['myWinScreen']),
	winAwaitTargets: new Set(['myWinScreen']),
	introCueShown: false,
	outroCueShown: false,
});
assert('v2: an await-target container held on screen locks the win', held.win === true);
assert(
	'v2: …and publishes flowHoldsPresentation for the win gate',
	held.flowHoldsPresentation === true,
);

console.log(failed ? '\nFAILED' : '\nAll assertions passed');
process.exit(failed ? 1 : 0);
