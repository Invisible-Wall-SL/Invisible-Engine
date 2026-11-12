// @ts-nocheck — a Node script inside a browser package; its tsconfig has no Node types, so checking it
// only adds noise to the package's svelte-check.
/**
 * Offline fixture: one key press is one action (`src/hotkeyPress.ts`).
 *
 *   pnpm check:all --only onePress
 *
 * Why (`docs/status/engine.md`, 2026-11-12):
 *   - One Space on `bookofborutremake`'s start screen dismissed it AND bet a spin. The spin hotkey
 *     stood down; hold-to-spin (`EnableSpaceHold`) bet: a blocked page let its 400 ms timer run
 *     before the key-up, and `continueFromIdle` took the resume check `ResumeBet` runs as the player
 *     gets in for a round the press started. Hold-to-spin now reads the press: a `bet` while the key
 *     is down marks it.
 *   - One Space ran two surfaces where a tap runs one: in a free-spin big win, `WinGate`'s
 *     post-count-up dismiss and the authored `bigWin` screen's tap (a tap runs only the newest,
 *     `ContinuePressMask`); on `overlay-buffaloduel`'s big-win count-up, where the spin hotkey is
 *     live, a slam of the round and the count-up's skip. And nothing but each hotkey's own `disabled`
 *     read stopped a surface that acts first from handing the same key-down to one heard after it.
 *     Now a press belongs to the newest listening hotkey that would act on it, decided at the
 *     key-down.
 *
 * Drives the real ledger (`hotkeyPress.ts`), the real event emitter (`utils-event-emitter`) and the
 * real continue registry (`state-shared`), with each `OnHotkey` modelled by the component's own gate:
 * `listensTo`, then (with `onpress`) `owns`. Every scenario runs twice: `shipped` is the rule before
 * (each hotkey decides alone; hold-to-spin stamps a round whenever the game is not idle) and must
 * reproduce the double action; `fixed` must not. Then pins, in the components' source, the wiring
 * the model stands for.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHotkeyPresses, hotkeyPressesFor, listensTo } from '../src/hotkeyPress.ts';
import { createEventEmitter } from '../../utils-event-emitter/src/createEventEmitter.ts';
import {
	registerContinuePress,
	runContinuePress,
	topContinuePress,
} from '../../state-shared/src/continuePress.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

/**
 * A slot game around the keys, in `mode`: `EnableHotkey` (opens a press before it broadcasts the
 * key-down and hands the event its press), the spin hotkey (`Game.svelte`'s; `disabled` while a
 * continue press is up, unless `spinLive` — a count-up no celebration lock covers), hold-to-spin
 * (`EnableSpaceHold`), continue screens (`PressToContinue`) and count-ups (`CountUpInteraction`).
 * `spinFirst: false` mounts the spin hotkey after the first continue screen.
 */
const createSlot = (mode, { spinFirst = true, spinLive = false } = {}) => {
	const { eventEmitter } = createEventEmitter();
	const presses = createHotkeyPresses();
	const log = [];
	const slot = { log, idle: true, continues: 0, bets: 0, slams: 0, holdOn: false, holds: 0 };
	const hotkeys = new Set();

	/** `OnHotkey`: its gate, its press state, its hold timer (run by `holdFires`). */
	const hotkey = ({
		name,
		disabled = () => false,
		ignorePressInProgress,
		onpress,
		onhold,
		onholdend,
	}) => {
		const owner = Symbol(name);
		let pressSeen = false;
		let waiting = false;
		let holding = false;
		const listener = () => ({
			hotkey: 'Space',
			disabled: disabled(),
			ignorePressInProgress,
			pressSeen,
		});
		const keyDown = () => {
			pressSeen = true;
			waiting = true;
			if (!holding) onpress?.();
		};
		const keyUp = () => {
			pressSeen = false;
			waiting = false;
			if (holding) onholdend?.();
			holding = false;
		};
		const leave =
			mode === 'fixed' && onpress
				? presses.join(owner, (event) => listensTo(event, listener()) === 'keyDown')
				: undefined;
		const unsubscribe = eventEmitter.subscribe({
			hotKey: (event) => {
				const action = listensTo(event, listener());
				if (!action) return;
				if (mode === 'fixed' && onpress && !presses.owns(event, owner)) return;
				if (action === 'keyUp') return keyUp();
				return keyDown();
			},
		});
		const handle = {
			holdFires() {
				if (!waiting || holding) return;
				holding = true;
				onhold?.();
			},
			/** Focus loss (`cancelPress`): a hold ends, a press that is not one yet is dropped. */
			cancel() {
				pressSeen = false;
				waiting = false;
				if (holding) onholdend?.();
				holding = false;
			},
			unmount() {
				unsubscribe();
				leave?.();
				hotkeys.delete(handle);
				keyUp();
			},
		};
		hotkeys.add(handle);
		return handle;
	};

	const bet = () => {
		slot.bets += 1;
		slot.idle = false;
		eventEmitter.broadcast({ type: 'bet' });
	};

	// Hold-to-spin, as shipped (timestamps) or fixed (the press a `bet` went out under).
	let clock = 0;
	let pressStartedAt = 0;
	let roundStartedAt = 0;
	eventEmitter.subscribe({
		bet: () => {
			if (mode === 'shipped') roundStartedAt = ++clock;
			const press = presses.live('Space');
			if (mode === 'fixed' && press) press.startedRound = true;
		},
	});
	/** The game leaves idle without a round: the actor's resume check as the player gets in. */
	slot.resumeCheck = () => {
		if (mode === 'shipped') roundStartedAt = ++clock;
	};
	const continueFromIdle = () => {
		if (!slot.idle) return;
		if (mode === 'shipped' && (!pressStartedAt || roundStartedAt < pressStartedAt)) return;
		if (mode === 'fixed' && !presses.live('Space')?.startedRound) return;
		if (slot.continues) return;
		log.push('hold: next round');
		bet();
	};

	const mountSpin = () =>
		hotkey({
			name: 'spin',
			ignorePressInProgress: true,
			disabled: () => !spinLive && slot.continues > 0,
			onpress: () => {
				log.push('spin');
				if (slot.idle) bet();
				else slot.slams += 1;
			},
		});
	const mountHold = () =>
		hotkey({
			name: 'hold',
			onpress: mode === 'shipped' ? () => (pressStartedAt ||= ++clock) : undefined,
			onhold: () => {
				slot.holdOn = true;
				slot.holds += 1;
				continueFromIdle();
			},
			onholdend: () => {
				slot.holdOn = false;
				if (mode === 'shipped') pressStartedAt = 0;
			},
		});
	/** `PressToContinue`: counts and registers its press (the pointer mask runs the newest). */
	slot.continueScreen = (onpress) => {
		slot.continues += 1;
		const run = () => onpress();
		const unregister = registerContinuePress(run);
		const surface = hotkey({ name: 'continue', ignorePressInProgress: true, onpress: run });
		let up = true;
		return {
			close() {
				if (!up) return;
				up = false;
				slot.continues -= 1;
				unregister();
				surface.unmount();
			},
		};
	};
	/** `CountUpInteraction` with tap-to-skip: skips on the key-down. */
	slot.countUp = (onSkip) =>
		hotkey({ name: 'count-up', ignorePressInProgress: true, onpress: onSkip });
	if (spinFirst) {
		slot.spin = mountSpin();
		slot.hold = mountHold();
	} else {
		slot.mountRest = () => {
			slot.spin = mountSpin();
			slot.hold = mountHold();
		};
	}
	slot.endRound = () => {
		slot.idle = true;
	};
	slot.keyDown = (repeat = false) => {
		const press = presses.down('Space', repeat);
		eventEmitter.broadcast({ type: 'hotKey', key: 'Space', action: 'keyDown', repeat, press });
	};
	slot.keyUp = () => {
		const press = presses.up('Space');
		eventEmitter.broadcast({ type: 'hotKey', key: 'Space', action: 'keyUp', press });
	};
	slot.blur = () => {
		presses.drop();
		hotkeys.forEach((h) => h.cancel());
	};
	/** A round the press did not start, e.g. a click on the spin button while Space is down. */
	slot.click = () => {
		if (slot.idle) bet();
	};
	return slot;
};

// --- (1) The start screen: hold-to-spin read the resume check as a round ------------------------
/** One press, the screen closed by it, the page blocked past the hold timer. */
const startScreen = (mode, { betweenPressAndHold } = {}) => {
	const slot = createSlot(mode);
	const start = slot.continueScreen(() => slot.log.push('continue'));
	slot.keyDown();
	// The screen completes in a later flush, then the player is in: `ResumeBet`'s check.
	start.close();
	slot.resumeCheck();
	betweenPressAndHold?.(slot);
	slot.hold.holdFires();
	slot.keyUp();
	return slot;
};

console.log('the start screen: one Space, held through a blocked page');
{
	const shipped = startScreen('shipped');
	check(
		'shipped: the one press continues AND bets (the reproduction)',
		shipped.bets === 1 && shipped.log.join() === 'continue,hold: next round',
		shipped.log.join(),
	);
	const fixed = startScreen('fixed');
	check(
		'fixed: it only continues',
		fixed.bets === 0 && fixed.log.join() === 'continue',
		fixed.log.join(),
	);
	check(
		'fixed: the hold still registers and ends with the key (the open product call, unchanged)',
		fixed.holds === 1 && !fixed.holdOn,
	);
	const clicked = startScreen('fixed', {
		betweenPressAndHold: (slot) => (slot.click(), slot.endRound()),
	});
	check(
		"fixed: a round another input starts while Space is down is that press's round",
		clicked.bets === 2 && clicked.log.join() === 'continue,hold: next round',
		clicked.log.join(),
	);
}

// --- (2) A continue surface heard first, whose action re-enables the spin hotkey ----------------
console.log('a continue surface heard before the spin hotkey');
{
	const run = (mode) => {
		const slot = createSlot(mode, { spinFirst: false });
		const screen = slot.continueScreen(() => {
			slot.log.push('continue');
			screen.close();
		});
		slot.mountRest();
		slot.keyDown();
		slot.keyUp();
		return slot;
	};
	const shipped = run('shipped');
	check(
		'shipped: the spin hotkey reads `disabled` after the continue and bets too',
		shipped.bets === 1 && shipped.log.join() === 'continue,spin',
		shipped.log.join(),
	);
	const fixed = run('fixed');
	check(
		'fixed: only the continue',
		fixed.bets === 0 && fixed.log.join() === 'continue',
		fixed.log.join(),
	);
}

// --- (3) Two continue surfaces up: the win gate's dismiss, then the authored win screen's tap -----
console.log("two continue surfaces up (a free-spin big win's gate dismiss and screen tap)");
{
	const run = (mode) => {
		const slot = createSlot(mode);
		slot.idle = false;
		const runs = [];
		const pointer = [];
		let tapping = false;
		const gate = slot.continueScreen(() => (tapping ? pointer : runs).push('gate'));
		const tap = slot.continueScreen(() => (tapping ? pointer : runs).push('tap'));
		// What a pointer tap starting now runs (`ContinuePressMask`).
		tapping = true;
		runContinuePress(topContinuePress());
		tapping = false;
		slot.keyDown();
		slot.keyUp();
		gate.close();
		tap.close();
		return { runs, pointer, slams: slot.slams };
	};
	const shipped = run('shipped');
	check(
		'shipped: both run on one Space',
		shipped.runs.join() === 'gate,tap',
		JSON.stringify(shipped),
	);
	const fixed = run('fixed');
	check(
		'fixed: only the newest, the one a pointer tap runs',
		fixed.runs.join() === 'tap' && fixed.pointer.join() === 'tap' && fixed.slams === 0,
		JSON.stringify(fixed),
	);
	check('every continue press unregistered', topContinuePress() === undefined);
}

// --- (4) A big-win count-up no celebration lock covers: the spin hotkey is live ------------------
console.log("a big-win count-up with the spin hotkey live (overlay-buffaloduel's)");
{
	const run = (mode) => {
		const slot = createSlot(mode, { spinLive: true });
		slot.idle = false;
		const countUp = slot.countUp(() => slot.log.push('skip'));
		slot.keyDown();
		slot.keyUp();
		countUp.unmount();
		return slot;
	};
	const shipped = run('shipped');
	check(
		'shipped: one Space slams the round AND skips the count-up',
		shipped.slams === 1 && shipped.log.join() === 'spin,skip',
		shipped.log.join(),
	);
	const fixed = run('fixed');
	check(
		'fixed: it only skips the count-up, as a tap on the screen does',
		fixed.slams === 0 && fixed.log.join() === 'skip',
		fixed.log.join(),
	);
}

// --- Every one-action press still works -----------------------------------------------------------
console.log('one-action presses, fixed');
{
	const slot = createSlot('fixed');
	slot.keyDown();
	slot.keyUp();
	check('Space at idle bets', slot.bets === 1 && slot.log.join() === 'spin', slot.log.join());
	slot.keyDown();
	slot.keyUp();
	check('Space mid-round slams', slot.slams === 1 && slot.bets === 1);
	slot.keyDown();
	slot.keyUp();
	check(
		"a second press mid-round is the spin hotkey's again (autoplay's cancel)",
		slot.slams === 2 && slot.bets === 1,
	);
	slot.endRound();

	// Hold-to-spin from idle: the press bets, a fast round ends before 400 ms, the hold continues.
	slot.log.length = 0;
	slot.keyDown();
	slot.endRound();
	slot.hold.holdFires();
	check(
		'a hold whose press bet continues from idle',
		slot.bets === 3 && slot.log.join() === 'spin,hold: next round',
		slot.log.join(),
	);
	check('the hold is on', slot.holdOn);
	slot.keyDown(true);
	check('an auto-repeat while held does nothing more', slot.bets === 3 && slot.log.length === 2);
	slot.keyUp();
	check(
		'the key-up that ends the hold ends it, and nothing else',
		!slot.holdOn && slot.bets === 3 && slot.log.length === 2,
	);

	// A press that slams a round which ends before 400 ms started no round: no bet from idle.
	slot.log.length = 0;
	slot.keyDown();
	slot.endRound();
	slot.hold.holdFires();
	slot.keyUp();
	check(
		'a slam press held into idle places no bet',
		slot.bets === 3 && slot.slams === 3,
		slot.log.join(),
	);

	// A Space held across a continue: the screen takes the press, and its repeats bet nothing.
	slot.log.length = 0;
	const screen = slot.continueScreen(() => {
		slot.log.push('continue');
		screen.close();
	});
	slot.keyDown();
	slot.keyDown(true);
	slot.keyDown(true);
	slot.hold.holdFires();
	check(
		'a Space held through a continue screen into idle places no bet',
		slot.bets === 3 && slot.log.join() === 'continue',
		slot.log.join(),
	);
	check('...and the hold still registers (the open product call, unchanged)', slot.holdOn);
	slot.keyUp();
	slot.keyDown();
	slot.keyUp();
	check('the next fresh press spins', slot.bets === 4);

	// A count-up's tap skips it while the round runs (the spin hotkey locked, as on the remake).
	slot.log.length = 0;
	const countUp = slot.countUp(() => slot.log.push('skip'));
	slot.keyDown();
	slot.keyUp();
	countUp.unmount();
	check('a count-up tap skips the count', slot.log.join() === 'skip' && slot.slams === 3);

	// Focus leaves while a press that bet is down, and comes back with the key still held: the OS
	// auto-repeats are a press of their own, which started no round.
	slot.endRound();
	slot.log.length = 0;
	slot.keyDown();
	slot.blur();
	slot.endRound();
	slot.keyDown(true);
	slot.hold.holdFires();
	slot.keyUp();
	check(
		"a key held across focus loss does not carry the old press's round into a hold",
		slot.bets === 5 && slot.log.join() === 'spin',
		slot.log.join(),
	);
}

console.log('what a hotkey listens to (the filter `OnHotkey` had inline)');
{
	const down = { key: 'Space', action: 'keyDown' };
	const up = { key: 'Space', action: 'keyUp' };
	const repeat = { ...down, repeat: true };
	const plain = { hotkey: 'Space', pressSeen: false };
	const fresh = { ...plain, ignorePressInProgress: true };
	check('a key-down of its key', listensTo(down, plain) === 'keyDown');
	check('not while disabled', listensTo(down, { ...plain, disabled: true }) === undefined);
	check('not another key', listensTo({ ...down, key: 'Escape' }, plain) === undefined);
	check(
		'a plain hotkey hears auto-repeats and every key-up',
		listensTo(repeat, plain) === 'keyDown' && listensTo(up, plain) === 'keyUp',
	);
	check('`ignorePressInProgress`: no auto-repeat', listensTo(repeat, fresh) === undefined);
	check(
		'`ignorePressInProgress`: the key-up of a press it saw, only',
		listensTo(up, fresh) === undefined && listensTo(up, { ...fresh, pressSeen: true }) === 'keyUp',
	);
}

console.log('the ledger');
{
	const presses = createHotkeyPresses();
	const a = presses.down('Space', false);
	check('an auto-repeat is the press held', presses.down('Space', true) === a);
	check('a fresh key-down is a new press', presses.down('Space', false) !== a);
	check(
		'a repeat with no press held starts one',
		presses.down('Enter', true) === presses.live('Enter'),
	);
	presses.drop();
	check(
		'focus loss drops every press',
		presses.live('Space') === undefined && presses.live('Enter') === undefined,
	);
	const b = presses.down('Space', false);
	check(
		'the key-up ends the press and hands it back',
		presses.up('Space') === b && presses.live('Space') === undefined,
	);

	const owner = Symbol('a');
	check(
		"an event with no press is everyone's (a story)",
		presses.owns({ key: 'Space', action: 'keyDown' }, owner),
	);
	// A press nobody wanted is offered again at the next repeat (a surface armed mid-press, acting on
	// repeats like `Popup`'s Escape).
	let open = false;
	const leave = presses.join(owner, () => open);
	const p = presses.down('Escape', false);
	const first = { key: 'Escape', action: 'keyDown', press: p };
	check('nobody wants it: not taken', !presses.owns(first, owner) && p.owner === undefined);
	open = true;
	check('the same event keeps its answer', !presses.owns(first, owner));
	check(
		'offered again at the repeat',
		presses.owns(
			{ key: 'Escape', action: 'keyDown', repeat: true, press: presses.down('Escape', true) },
			owner,
		),
	);
	leave();
	check(
		'a hotkey that left is never picked',
		(() => {
			const q = presses.down('Escape', false);
			presses.owns({ key: 'Escape', action: 'keyDown', press: q }, Symbol('b'));
			return q.owner === undefined;
		})(),
	);
	check(
		'a key-up never takes a press, whoever would',
		(() => {
			const leaveEager = presses.join(Symbol('eager'), () => true);
			presses.down('Escape', false);
			const q = presses.up('Escape');
			presses.owns({ key: 'Escape', action: 'keyUp', press: q }, Symbol('c'));
			leaveEager();
			return q.owner === undefined;
		})(),
	);
	const emitter = {};
	check(
		'one keyboard per emitter',
		hotkeyPressesFor(emitter) === hotkeyPressesFor(emitter) &&
			hotkeyPressesFor({}) !== hotkeyPressesFor(emitter),
	);
}

// --- The components wire what the model stands for ------------------------------------------------
console.log('the components');
const here = dirname(fileURLToPath(import.meta.url));
const source = (file) =>
	readFileSync(join(here, '../src/components', file), 'utf8').replace(/\s+/g, ' ');
{
	const onHotkey = source('OnHotkey.svelte');
	check(
		'OnHotkey: an `onpress` hotkey joins the takers while it listens',
		/const leave = props\.onpress \? presses\.join\(owner, \(event\) => listensTo\(event, listener\(\)\) === 'keyDown'\) : undefined;/.test(
			onHotkey,
		),
	);
	check(
		'OnHotkey: it acts only on what it listens to, and on a press only if it owns it',
		/const action = listensTo\(emitterEvent, listener\(\)\); if \(!action\) return; if \(props\.onpress && !presses\.owns\(emitterEvent, owner\)\) return; if \(action === 'keyUp'\) return keyUp\(\); return keyDown\(\);/.test(
			onHotkey,
		),
	);
	check(
		'OnHotkey: it leaves with its subscription',
		/return \(\) => \{ unsubscribe\(\); leave\?\.\(\); \};/.test(onHotkey),
	);
	check(
		'OnHotkey: its listener is the props it has (`disabled` read at the event)',
		/const listener = \(\) => \(\{ hotkey: props\.hotkey, disabled: props\.disabled, ignorePressInProgress: props\.ignorePressInProgress, pressSeen, \}\);/.test(
			onHotkey,
		),
	);

	const enable = source('EnableHotkey.svelte');
	check(
		'EnableHotkey: a press opens before its key-down goes out, and the key-down carries it',
		/if \(key\) \{ const press = presses\.down\(key, e\.repeat\); context\.eventEmitter\.broadcast\(\{ type: 'hotKey', key, action: 'keyDown', repeat: e\.repeat, press, \}\);/.test(
			enable,
		),
	);
	check(
		'EnableHotkey: the key-up closes it and carries it',
		/if \(key\) \{ const press = presses\.up\(key\); context\.eventEmitter\.broadcast\(\{ type: 'hotKey', key, action: 'keyUp', press \}\);/.test(
			enable,
		),
	);
	check(
		'EnableHotkey: focus loss drops the presses',
		/window\.addEventListener\('blur', presses\.drop\);/.test(enable),
	);

	const hold = source('EnableSpaceHold.svelte');
	check(
		'EnableSpaceHold: a `bet` marks the Space press in progress',
		/bet: \(\) => \{ const press = presses\.live\('Space'\); if \(press\) press\.startedRound = true; \}/.test(
			hold,
		),
	);
	check(
		'EnableSpaceHold: it continues from idle only for a press that started a round',
		/const continueFromIdle = \(\) => \{ if \(!props\.isIdle\?\.\(\) \|\| !presses\.live\('Space'\)\?\.startedRound\) return;/.test(
			hold,
		),
	);
	check(
		'EnableSpaceHold: it takes no press (no `onpress`) and infers no round from idle',
		/<OnHotkey hotkey="Space" holdMs=\{HOLD_TO_SPIN_MS\} onhold=\{spaceHoldOn\} onholdend=\{spaceHoldOff\} \/>/.test(
			hold,
		) && !/roundStartedAt|pressStartedAt|\$effect/.test(hold),
	);
}

if (failures) throw new Error(`onePress.fixture: ${failures} FAILED`);
console.log('\nonePress.fixture: all ok');
