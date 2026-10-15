/**
 * The WIN WALK as a pure conductor (Rive plan Phase 8b, `docs/design/rive-style-editor.md` §13.6.5).
 *
 * `WinGate` runs `nextStep` over plain data on the authored path: each step fires a per-tier signal
 * the placed `winPresentation` instance plays a timeline on, and the hold that timeline registers
 * is the clock the coded rig `complete` was (`WinAnimation.svelte`). This replays the walk step for
 * step against that coded behaviour, imported from source:
 *  - the chain walks intro → one idle cycle → next tier (each its own held fire), and lands on the
 *    final tier's loop straight after its intro;
 *  - `countUpComplete` flips the final tier to its outro, or collapses a mid-walk chain to it;
 *  - a tier whose outro is its idle has NO exit (`tierHasExit`) and concludes at once;
 *  - a tap steps the walk forward one tier, never back; the stale hold is ignored by its step;
 *  - the landing tap's hold keeps the idle; a lapsed hold runs the collapse;
 *  - an un-escalating win never gains an outro; a plain win fires `winPlain` and nothing else;
 *  - THE LATE MOUNT: a fire whose instance registers no hold synchronously is re-read once after a
 *    deferred tick (a seeded late subscriber registers then); still none ⇒ the step falls through
 *    at once (never hangs), exactly as the coded gate concludes without a mounted visual.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/winWalk.fixture.ts
 */
import { readLF } from '../../../scripts/lib/read-lf.mjs';

import { tierHasExit } from '../src/game/winEscalation.ts';
import {
	awaitFireHolds,
	createWinWalk,
	nextStep,
	type WinWalk,
	type WinWalkEffect,
	type WinWalkSignals,
	type WinWalkTier,
} from '../src/game/winWalk.ts';

// A minimal assert of its own, not `node:assert`: this package's tsconfig has no Node types, so the
// import would add a type error the svelte-check baseline would have to carry for a new file.
const fail = (message: string): never => {
	throw new Error(message);
};
const assert = {
	ok: (value: unknown, message: string): void => {
		if (!value) fail(message);
	},
	equal: (actual: unknown, expected: unknown, message = 'values differ'): void => {
		if (actual !== expected)
			fail(`${message}\n  expected ${String(expected)}\n  got      ${String(actual)}`);
	},
	deepEqual: (actual: unknown, expected: unknown, message = 'values differ'): void => {
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a !== e) fail(`${message}\n  expected ${e}\n  got      ${a}`);
	},
	match: (text: string, re: RegExp, message: string): void => {
		if (!re.test(text)) fail(message);
	},
};

/** The names `engine-layout`'s `winTierSignal` & co. produce, handed in as the gate hands them. */
const SIGNALS: WinWalkSignals = {
	tier: (alias) => `winTier.${alias}`,
	cycle: (alias) => `winTierIdle.${alias}`,
	loop: (alias) => `winTierLoop.${alias}`,
	outro: (alias) => `winTierOutro.${alias}`,
	plain: 'winPlain',
};

const tier = (
	alias: string,
	animationMap: { intro: string; idle: string; outro: string },
	boundaryAmount = 0,
): WinWalkTier => ({
	alias,
	hasExit: tierHasExit(animationMap),
	boundaryAmount,
});

/** The engine's reference `bigwin` authoring: a real exit per tier. */
const REFERENCE = [
	tier('big', { intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' }, 1_000),
	tier(
		'superwin',
		{ intro: 'super_win_intro', idle: 'super_win_idle', outro: 'super_win_exit' },
		2_000,
	),
	tier('mega', { intro: 'mega_win_intro', idle: 'mega_win_idle', outro: 'mega_win_exit' }, 4_000),
];
/** The Book of Borut remake's authoring: every "outro" is that tier's own idle ⇒ no exit. */
const REMAKE = [
	tier('big', { intro: 'Tier1_Intro', idle: 'Tier1_Idle', outro: 'Tier1_Idle' }),
	tier('superwin', { intro: 'Tier2_Intro', idle: 'Tier2_Idle', outro: 'Tier2_Idle' }),
	tier('mega', { intro: 'Tier3Intro', idle: 'Tier3_Idle', outro: 'Tier3_Idle' }),
];

type Fire = Extract<WinWalkEffect, { kind: 'fire' }>;

/** A gate: applies events, records every effect, and ends the last held fire on demand. */
const gate = (tiers: WinWalkTier[], escalating: boolean) => {
	let walk: WinWalk = createWinWalk(tiers, escalating, SIGNALS);
	const log: string[] = [];
	const held: Fire[] = [];
	let outroComplete = false;
	const apply = (event: Parameters<typeof nextStep>[1]): void => {
		const next = nextStep(walk, event);
		walk = next.walk;
		for (const effect of next.effects) {
			if (effect.kind === 'fire') {
				log.push(effect.signal);
				if (effect.holds) held.push(effect);
			} else if (effect.kind === 'stepIndex') log.push(`index:${effect.index}`);
			else {
				outroComplete = true;
				log.push('outroComplete');
			}
		}
	};
	/** The hold of the LAST held fire ends (the timeline reached its end). */
	const holdEnds = (): void => {
		const fire = held[held.length - 1];
		assert.ok(fire, 'expected a held fire to end');
		apply({ type: 'holdEnd', step: fire.step });
	};
	return {
		apply,
		holdEnds,
		log,
		held,
		get walk() {
			return walk;
		},
		get outroComplete() {
			return outroComplete;
		},
	};
};

// ---------------------------------------------------------------------------------------------
// THE NATURAL WALK — the coded `WinAnimation` chain: intro → idle (one cycle) → next tier's intro,
// landing on the final tier's looping idle; the count landing plays the final exit.
// ---------------------------------------------------------------------------------------------
{
	const g = gate(REFERENCE, true);
	g.apply({ type: 'start' });
	assert.deepEqual(g.log, ['index:0', 'winTier.big'], 'expected the first tier to walk at once');
	assert.equal(g.held[0].holds, true, 'expected the walk to be a held fire');
	g.holdEnds();
	assert.equal(g.log.at(-1), 'winTierIdle.big', "expected the intro's end to play one idle cycle");
	g.holdEnds();
	g.holdEnds();
	g.holdEnds();
	assert.deepEqual(
		g.log,
		[
			'index:0',
			'winTier.big',
			'winTierIdle.big',
			'index:1',
			'winTier.superwin',
			'winTierIdle.superwin',
			'index:2',
			'winTier.mega',
		],
		'expected each idle cycle end to walk to the next tier',
	);
	g.holdEnds();
	assert.equal(
		g.log.at(-1),
		'winTierLoop.mega',
		"expected the final intro's end to start the loop",
	);
	assert.equal(g.held.length, 5, 'expected the loop not to be a held fire');
	g.apply({ type: 'countUpComplete' });
	assert.equal(
		g.log.at(-1),
		'winTierOutro.mega',
		'expected the count landing to play the final exit',
	);
	assert.equal(g.outroComplete, false, 'expected the gate to wait for the exit');
	g.holdEnds();
	assert.equal(g.outroComplete, true, 'expected the exit hold to conclude the presentation');
	assert.equal(g.walk.phase, 'done');
}

// A FAST count-up lands mid-walk: the chain COLLAPSES to the final tier and plays its exit.
{
	const g = gate(REFERENCE, true);
	g.apply({ type: 'start' });
	g.apply({ type: 'countUpComplete' });
	assert.deepEqual(
		g.log.slice(2),
		['index:2', 'winTierOutro.mega'],
		'expected the collapse to jump to the final tier and fire its outro',
	);
	// The first tier's walk hold is now STALE: its end must not move the walk.
	g.apply({ type: 'holdEnd', step: g.held[0].step });
	assert.equal(g.walk.phase, 'outro', 'expected a stale hold to be ignored by its step');
	g.holdEnds();
	assert.equal(g.outroComplete, true);
}

// NO EXIT (the remake's authoring): the count landing concludes at once, the idle stays on screen.
{
	const g = gate(REMAKE, true);
	g.apply({ type: 'start' });
	for (let i = 0; i < 5; i++) g.holdEnds();
	assert.equal(g.log.at(-1), 'winTierLoop.mega');
	g.apply({ type: 'countUpComplete' });
	assert.equal(g.outroComplete, true, 'expected no exit ⇒ done at once');
	assert.ok(!g.log.includes('winTierOutro.mega'), 'expected no outro fire without an exit');
}

// ---------------------------------------------------------------------------------------------
// TAP-TO-STEP — a tap jumps the walk FORWARD one tier (its intro), never back; the stale hold is
// ignored; the walk keeps advancing from the tapped tier.
// ---------------------------------------------------------------------------------------------
{
	const g = gate(REFERENCE, true);
	g.apply({ type: 'start' });
	g.apply({ type: 'tap', toTier: 1 });
	assert.deepEqual(
		g.log.slice(2),
		['index:1', 'winTier.superwin'],
		'expected the tap to walk to tier 1',
	);
	g.apply({ type: 'holdEnd', step: g.held[0].step });
	assert.equal(g.walk.index, 1, "expected the first tier's stale hold to be ignored");
	g.apply({ type: 'tap', toTier: 0 });
	assert.equal(g.walk.index, 1, 'expected a tap never to pull the walk back');
	g.holdEnds();
	g.holdEnds();
	assert.equal(g.log.at(-1), 'winTier.mega', "expected the tapped tier's idle end to walk on");
	g.apply({ type: 'tap', toTier: 7 });
	assert.equal(g.walk.index, 2, 'expected a tap past the end to clamp to the final tier');
	assert.equal(
		g.log.filter((l) => l === 'winTier.mega').length,
		1,
		'expected no re-fire on the final tier',
	);
}

// LAND-THEN-DISMISS: the landing tap's hold keeps the final idle looping — no outro — until the
// hold lapses, which runs the collapse; a dismiss press resolves the gate's own wait (not here).
{
	const g = gate(REFERENCE, true);
	g.apply({ type: 'start' });
	g.apply({ type: 'holdOutro', on: true });
	g.apply({ type: 'countUpComplete' });
	assert.ok(!g.log.some((l) => l.startsWith('winTierOutro')), 'expected the hold to keep the idle');
	assert.equal(g.walk.concluded, false);
	g.apply({ type: 'holdOutro', on: false });
	assert.equal(g.log.at(-1), 'winTierOutro.mega', 'expected a lapsed hold to run the collapse');
}

// ---------------------------------------------------------------------------------------------
// PARITY — an un-escalating big win: intro → looping idle, NO outro, hidden by `winHide`; a plain
// small / medium win fires `winPlain` and nothing else.
// ---------------------------------------------------------------------------------------------
{
	const g = gate([REFERENCE[0]], false);
	g.apply({ type: 'start' });
	g.holdEnds();
	assert.deepEqual(g.log, ['index:0', 'winTier.big', 'winTierLoop.big']);
	g.apply({ type: 'countUpComplete' });
	g.apply({ type: 'tap', toTier: 1 });
	assert.deepEqual(
		g.log,
		['index:0', 'winTier.big', 'winTierLoop.big'],
		'expected no outro, no step',
	);
	assert.equal(g.outroComplete, false, 'expected the single-tier path never to report an outro');
}
{
	const g = gate([], false);
	g.apply({ type: 'start' });
	assert.deepEqual(g.log, ['winPlain']);
	assert.equal(g.held.length, 0, 'expected the plain number to hold nothing');
	g.apply({ type: 'countUpComplete' });
	assert.deepEqual(g.log, ['winPlain']);
}

// ---------------------------------------------------------------------------------------------
// BEFORE THE START — the gate defers `start` a frame, and the count, a tap or the landing hold can
// arrive first. They fire nothing then and are folded into the start, as the coded walk read its
// props at mount; a second `start` is ignored.
// ---------------------------------------------------------------------------------------------
{
	// An instant count: the chain collapses straight to the final tier's outro — no tier-0 walk, no
	// second walk over it, and the outro's hold is the only pending one.
	const g = gate(REFERENCE, true);
	g.apply({ type: 'countUpComplete' });
	assert.deepEqual(g.log, [], 'expected an early count to fire nothing');
	g.apply({ type: 'start' });
	assert.deepEqual(
		g.log,
		['index:2', 'winTierOutro.mega'],
		'expected the start to collapse to the final outro',
	);
	g.apply({ type: 'start' });
	assert.equal(g.log.length, 2, 'expected a second start to be ignored');
	g.holdEnds();
	assert.equal(g.outroComplete, true, 'expected the outro hold to conclude');
}
{
	// The landing hold arrived with the count: walk from tier 0; the collapse waits for the lapse.
	const g = gate(REFERENCE, true);
	g.apply({ type: 'holdOutro', on: true });
	g.apply({ type: 'countUpComplete' });
	g.apply({ type: 'start' });
	assert.deepEqual(g.log, ['index:0', 'winTier.big'], 'expected the held start to walk tier 0');
	g.apply({ type: 'holdOutro', on: false });
	assert.equal(g.log.at(-1), 'winTierOutro.mega', 'expected the lapse to run the collapse');
}
{
	// An early tap: the walk starts on the tier it asked for.
	const g = gate(REFERENCE, true);
	g.apply({ type: 'tap', toTier: 1 });
	g.apply({ type: 'holdOutro', on: false });
	assert.deepEqual(g.log, [], 'expected an early tap to fire nothing');
	g.apply({ type: 'start' });
	assert.deepEqual(g.log, ['index:1', 'winTier.superwin'], 'expected the start at the tapped tier');
}
{
	// Un-escalating: an early count changes nothing — the single tier walks as always.
	const g = gate([REFERENCE[0]], false);
	g.apply({ type: 'countUpComplete' });
	g.apply({ type: 'tap', toTier: 1 });
	g.apply({ type: 'start' });
	assert.deepEqual(g.log, ['index:0', 'winTier.big']);
}

// ---------------------------------------------------------------------------------------------
// FLAG OFF ⇒ NOTHING NEW IS REGISTERED. The wiring is Svelte, so it is asserted against the source
// (the `winTapLand` precedent): the signals and the board box are registered inside the gate's
// `if (authoredWin)` block alone, the timelines generate behind `authoredWinRuntime.on`, and the
// coded `WinVisual` reads the retire once.
// ---------------------------------------------------------------------------------------------
{
	const read = (rel: string): string => readLF(new URL(`../../../${rel}`, import.meta.url));
	const game = read('apps/lines/src/components/Game.svelte');
	const block = game.slice(game.indexOf('if (authoredWin) {'), game.indexOf('editorDoc = doc;'));
	assert.ok(block.length > 0, 'expected the authored-win block before the doc is published');
	assert.ok(
		block.includes('registerComponentSignals(') &&
			block.includes('registerBoardBox(') &&
			block.includes('registerComponents({ [authoredWinDef().id]: authoredWinDef() })'),
		'expected the signals, the board box and the def to register inside the flag block only',
	);
	assert.equal(
		game.split('authoredWinDef()').length - 1,
		2,
		'expected the def to be registered once (the id read and the def itself)',
	);
	assert.equal(game.split('registerBoardBox(').length - 1, 1, 'expected no other registerBoardBox');
	assert.equal(
		game.split('authoredWinSignals(').length - 1,
		1,
		'expected no other registration of the authored signals',
	);
	assert.match(
		game,
		/if \(!authoredWinRuntime\.on \|\| !stateApp\.loaded\) return;\s*registerAuthoredWinTimelines\(/,
		'expected the timelines to generate only behind the flag',
	);
	assert.ok(
		read('apps/lines/src/components/WinVisual.svelte').includes("isCodedOverlayRetired('win')"),
		'expected the coded visual to read the retire',
	);
}

void (async () => {
	// ---------------------------------------------------------------------------------------------
	// THE LATE MOUNT — how a fire's hold is read. (a) registered synchronously in the bus callback ⇒
	// read right after the fire, awaited; (b) the instance mounts a frame late and is seeded ⇒ the one
	// deferred re-read sees its hold; (c) nothing ever registers ⇒ falls through at once. Never hangs.
	// ---------------------------------------------------------------------------------------------
	{
		let deferred = 0;
		const defer = async (): Promise<void> => {
			deferred += 1;
		};
		// (a) synchronous hold.
		{
			let release = (): void => {};
			const hold = new Promise<void>((resolve) => (release = resolve));
			let settled = false;
			const read = () => [hold];
			const result = awaitFireHolds(read, defer).then((r) => {
				settled = true;
				return r;
			});
			await Promise.resolve();
			assert.equal(settled, false, 'expected a registered hold to be awaited');
			release();
			assert.equal(await result, 'held');
			assert.equal(deferred, 0, 'expected no deferred re-read when the hold was there');
		}
		// (b) a late mount: empty on the first read, registered by the time the deferred read runs.
		{
			const holds: Promise<void>[] = [];
			const read = () => [...holds];
			const lateDefer = async (): Promise<void> => {
				deferred += 1;
				holds.push(Promise.resolve());
			};
			assert.equal(
				await awaitFireHolds(read, lateDefer),
				'held',
				'expected the re-read to see a late hold',
			);
		}
		// (c) no instance at all: falls through after the one re-read.
		{
			const before = deferred;
			assert.equal(await awaitFireHolds(() => [], defer), 'empty');
			assert.equal(
				deferred - before,
				1,
				'expected exactly one deferred re-read, then fall-through',
			);
		}
		// The conductor on a fallen-through chain walks every tier at once and lands on the loop — the
		// gate then concludes on its own clocks, as it does with no visual mounted.
		const g = gate(REFERENCE, true);
		g.apply({ type: 'start' });
		for (const fire of [...g.held]) g.apply({ type: 'holdEnd', step: fire.step });
		while (g.walk.phase === 'walk' || g.walk.phase === 'cycle') g.holdEnds();
		assert.equal(g.walk.phase, 'loop', 'expected empty holds to fall through to the loop');
		g.apply({ type: 'countUpComplete' });
		g.holdEnds();
		assert.equal(g.outroComplete, true, 'expected an empty outro hold to conclude at once');
	}
})().then(() =>
	console.log(
		'\nOK — the win walk conducts the coded chain step for step; empty holds fall through, never hang.',
	),
);
