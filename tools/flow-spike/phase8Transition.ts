/**
 * Invisible Flow — Phase 8 entrance-transition harness (design doc §6, the droppable
 * "Transition (fade)" node).
 *
 *   pnpm --filter flow-spike run transition
 *
 * Proves, HEADLESSLY, the interpreter↔host FADE contract: an edge carrying a `transition`
 * SURFACES the entrance transition for its NEWLY-activated target via `onActiveScreensChange`'s
 * `entrances` arg, while a transition-less edge surfaces NONE (parity — a hard cut). The HOST owns
 * the actual tween; the interpreter must merely surface the effect so the host can mount hidden.
 *
 *  1. A fade edge activating a target ⇒ `entrances` carries `{ screenId, transition:{kind:'fade',…} }`.
 *  2. A transition-less edge activating a target ⇒ `entrances` carries `{ screenId }` with no
 *     `transition` (undefined) ⇒ the host hard-cuts (parity, byte-identical to today's mount).
 *  3. A LAYER re-trigger onto an ALREADY-active target is a consumed no-op ⇒ NO entrance surfaces
 *     (no fade replay while the overlay persists).
 *  4. A `complete` fan-out surfaces each newly-activated target's edge transition; a re-entrant
 *     handoff back onto the still-active base surfaces NO entrance (no fade replay on the base).
 *  5. `normalizeFlowDoc` round-trips the `transition` (clamps ms ≥ 0, defaults easing); an absent
 *     transition stays absent (parity).
 *
 * It drives the REAL `createPresentationMachine` + `normalizeFlowDoc` from `engine-flow`.
 */

import {
	createPresentationMachine,
	normalizeFlowDoc,
	type FlowDoc,
	type FlowRuntime,
	type ScreenEntrance,
} from 'engine-flow';

// A virtual runtime — no emitter subscribers, immediate delays (deterministic).
const runtime: FlowRuntime = {
	emitter: { broadcast: () => {}, broadcastAsync: () => Promise.resolve([]) },
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
};

// basegame (persistent base) → bigWin via a bookEvent LAYER carrying a FADE; bigWin → basegame via
// a `complete` handoff (no transition). loading → basegame + loading → hud via `complete` fan-out,
// the basegame edge carrying a fade, the hud edge a hard cut.
const flowDoc: FlowDoc = {
	version: 1,
	screens: [{ id: 'loading', initial: true }, { id: 'basegame' }, { id: 'hud' }, { id: 'bigWin' }],
	transitions: [
		// complete FAN-OUT: loading hands off to basegame (fade) + hud (hard cut).
		{
			id: 't1',
			from: 'loading',
			to: 'basegame',
			trigger: { kind: 'complete' },
			order: 0,
			transition: { kind: 'fade', ms: 400, easing: 'easeOut' },
		},
		{ id: 't2', from: 'loading', to: 'hud', trigger: { kind: 'complete' }, order: 1 },
		// bookEvent LAYER with a fade: bigWin stacks over the persistent base.
		{
			id: 't3',
			from: 'basegame',
			to: 'bigWin',
			trigger: { kind: 'bookEvent', event: 'setWin' },
			order: 0,
			transition: { kind: 'fade', ms: 250, easing: 'easeInOut' },
		},
		// complete HANDOFF (no transition): bigWin dismisses itself back to the base.
		{ id: 't4', from: 'bigWin', to: 'basegame', trigger: { kind: 'complete' }, order: 0 },
	],
};

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow — Phase 8 entrance-transition (fade) harness\n');

	// Record every notify: the active set + the entrances surfaced.
	let lastEntrances: readonly ScreenEntrance[] = [];
	const notified: { ids: readonly string[]; entrances: readonly ScreenEntrance[] }[] = [];
	const machine = createPresentationMachine(flowDoc, {
		runtime,
		onActiveScreensChange: (ids, entrances) => {
			lastEntrances = entrances;
			notified.push({ ids, entrances });
		},
	});

	// --- 1 + 2 + 4. complete FAN-OUT surfaces a fade for basegame + a hard cut for hud ---
	console.log('complete fan-out (loading → basegame[fade] + hud[cut]):');
	await machine.onComplete();
	const baseEntrance = lastEntrances.find((e) => e.screenId === 'basegame');
	const hudEntrance = lastEntrances.find((e) => e.screenId === 'hud');
	assert(
		'fan-out surfaces BOTH newly-activated targets',
		lastEntrances.length === 2 && !!baseEntrance && !!hudEntrance,
		JSON.stringify(lastEntrances),
	);
	assert(
		'fade edge ⇒ target entrance carries the transition (kind/ms/easing)',
		eq(baseEntrance?.transition, { kind: 'fade', ms: 400, easing: 'easeOut' }),
		JSON.stringify(baseEntrance),
	);
	assert(
		'transition-less edge ⇒ target entrance carries NO transition (hard cut, parity §7)',
		hudEntrance !== undefined && hudEntrance.transition === undefined,
		JSON.stringify(hudEntrance),
	);
	assert(
		'loading deactivated + basegame/hud active',
		eq(machine.activeScreenIds, ['basegame', 'hud']),
	);

	// --- 1. bookEvent LAYER surfaces a fade for the newly-layered overlay ---
	console.log('\nbookEvent LAYER (basegame → bigWin[fade]):');
	await machine.onBookEvent({ type: 'setWin' });
	const bigWinEntrance = lastEntrances.find((e) => e.screenId === 'bigWin');
	assert(
		'a layered overlay with a fade surfaces its transition',
		lastEntrances.length === 1 &&
			eq(bigWinEntrance?.transition, { kind: 'fade', ms: 250, easing: 'easeInOut' }),
		JSON.stringify(lastEntrances),
	);

	// --- 3. a repeat LAYER trigger onto the already-active overlay surfaces NOTHING ---
	console.log('\nrepeat LAYER trigger (bigWin already active):');
	const notifiesBefore = notified.length;
	await machine.onBookEvent({ type: 'setWin' });
	assert(
		'a re-trigger onto an already-active target is a consumed no-op ⇒ NO notify, NO entrance',
		notified.length === notifiesBefore,
		`notifies delta ${notified.length - notifiesBefore}`,
	);

	// --- 4. re-entrant `complete` handoff back onto the still-active base surfaces NO entrance ---
	console.log('\ncomplete HANDOFF back to the persistent base (bigWin → basegame):');
	await machine.onComplete();
	assert(
		'bigWin removed; base persists',
		eq(machine.activeScreenIds, ['basegame', 'hud']),
		JSON.stringify(machine.activeScreenIds),
	);
	assert(
		'a handoff onto the ALREADY-active base surfaces NO entrance (no fade replay on the base)',
		lastEntrances.length === 0,
		JSON.stringify(lastEntrances),
	);

	// --- 5. normalize round-trips the transition (clamp ms ≥ 0, default easing) ---
	console.log('\nnormalize round-trips the transition:');
	const dirty = {
		version: 1,
		screens: [{ id: 'a' }, { id: 'b' }],
		transitions: [
			// a valid fade with a negative ms (clamped) + missing easing (defaulted to linear).
			{
				id: 'x',
				from: 'a',
				to: 'b',
				trigger: { kind: 'complete' },
				transition: { kind: 'fade', ms: -50 },
			},
			// a transition-less edge stays transition-less (parity).
			{ id: 'y', from: 'b', to: 'a', trigger: { kind: 'complete' } },
			// a junk transition kind is dropped.
			{
				id: 'z',
				from: 'a',
				to: 'b',
				trigger: { kind: 'bookEvent', event: 'e' },
				transition: { kind: 'wipe', ms: 100 },
			},
		],
	};
	const norm = normalizeFlowDoc(dirty);
	const tx = norm.transitions.find((t) => t.id === 'x');
	const ty = norm.transitions.find((t) => t.id === 'y');
	const tz = norm.transitions.find((t) => t.id === 'z');
	assert(
		'fade ms clamped ≥ 0 + easing defaulted to linear',
		eq(tx?.transition, { kind: 'fade', ms: 0, easing: 'linear' }),
		JSON.stringify(tx?.transition),
	);
	assert('transition-less edge stays transition-less', ty?.transition === undefined);
	assert('unknown transition kind is dropped (parity)', tz?.transition === undefined);
	assert(
		'normalize is idempotent for the transition',
		eq(normalizeFlowDoc(norm).transitions, norm.transitions),
	);

	console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}\n`);
	process.exit(failed ? 1 : 0);
};

void main();
