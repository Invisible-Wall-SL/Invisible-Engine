// @ts-nocheck — a Node script inside a browser package; its tsconfig has no Node types, so checking it
// only adds noise to the package's svelte-check.
/**
 * Offline fixture: one Space on a start screen continues and does not also bet a spin.
 *
 *   pnpm check:all --only onePress
 *
 * Why: on `bookofborutremake`'s start screen one Space dismissed the screen AND bet a spin
 * (WebKitGTK on a quick press, any browser on a Space held past 400 ms; `docs/status/engine.md`,
 * 2026-11-12). Traced: the spin hotkey stood down as it should; hold-to-spin (`EnableSpaceHold`) bet.
 * Dismissing the screen mounts the base game, which blocks the page long enough that the 400 ms
 * hold timer runs before the key-up, and `continueFromIdle` took "the game left idle after the
 * press" for "this press started a round": the resume check `ResumeBet` runs once the player is in
 * is not a round. Hold-to-spin now reads the press itself (`src/hotkeyPress.ts`): a `bet` while the
 * key is down marks it.
 *
 * Drives the real ledger (`hotkeyPress.ts`) and the real event emitter (`utils-event-emitter`),
 * with each `OnHotkey` modelled by its own listen rule and `EnableSpaceHold`'s hold by its rule.
 * Every scenario runs twice: `shipped` is hold-to-spin's rule before this (a press start stamped by
 * its `onpress`, a round stamped whenever the game is not idle) and must reproduce the bet; `fixed`
 * must not. Then pins, in the components' source, the wiring the model stands for.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHotkeyPresses, hotkeyPressesFor } from '../src/hotkeyPress.ts';
import { createEventEmitter } from '../../utils-event-emitter/src/createEventEmitter.ts';

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
 * key-down, closes it with the key-up), the spin hotkey (`Game.svelte`'s, `disabled` while a continue
 * press is up), hold-to-spin (`EnableSpaceHold`) and continue screens (`PressToContinue`).
 */
const createSlot = (mode) => {
	const { eventEmitter } = createEventEmitter();
	const presses = createHotkeyPresses();
	const log = [];
	const slot = { log, idle: true, continues: 0, bets: 0, slams: 0, holdOn: false, holds: 0 };

	/** `OnHotkey`: its listen rule, its press state, its hold timer (run by `holdFires`). */
	const hotkey = ({
		disabled = () => false,
		ignorePressInProgress,
		onpress,
		onhold,
		onholdend,
	}) => {
		let pressSeen = false;
		let waiting = false;
		let holding = false;
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
		const unsubscribe = eventEmitter.subscribe({
			hotKey: (event) => {
				if (disabled()) return;
				if (event.key !== 'Space') return;
				if (ignorePressInProgress) {
					if (event.repeat) return;
					if (event.action === 'keyUp' && !pressSeen) return;
				}
				if (event.action === 'keyUp') return keyUp();
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
				hotkeys.delete(handle);
				keyUp();
			},
		};
		hotkeys.add(handle);
		return handle;
	};
	const hotkeys = new Set();

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

	slot.spin = hotkey({
		ignorePressInProgress: true,
		disabled: () => slot.continues > 0,
		onpress: () => {
			log.push('spin');
			if (slot.idle) bet();
			else slot.slams += 1;
		},
	});
	slot.hold = hotkey({
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
	slot.continueScreen = (onpress) => {
		slot.continues += 1;
		const surface = hotkey({ ignorePressInProgress: true, onpress });
		let up = true;
		return {
			close() {
				if (!up) return;
				up = false;
				slot.continues -= 1;
				surface.unmount();
			},
		};
	};
	slot.endRound = () => {
		slot.idle = true;
	};
	slot.keyDown = (repeat = false) => {
		presses.down('Space', repeat);
		eventEmitter.broadcast({ type: 'hotKey', key: 'Space', action: 'keyDown', repeat });
	};
	slot.keyUp = () => {
		presses.up('Space');
		eventEmitter.broadcast({ type: 'hotKey', key: 'Space', action: 'keyUp' });
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

/** The start screen: one press, the screen closed by it, the page blocked past the hold timer. */
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
	slot.keyUp();
	slot.keyDown();
	slot.keyUp();
	check('the next fresh press spins', slot.bets === 4);

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
	presses.down('Space', false);
	presses.up('Space');
	check('the key-up ends the press', presses.live('Space') === undefined);
	const emitter = {};
	check(
		'one keyboard per emitter',
		hotkeyPressesFor(emitter) === hotkeyPressesFor(emitter) &&
			hotkeyPressesFor({}) !== hotkeyPressesFor(emitter),
	);
}

console.log('the components');
const here = dirname(fileURLToPath(import.meta.url));
const source = (file) =>
	readFileSync(join(here, '../src/components', file), 'utf8').replace(/\s+/g, ' ');
{
	const enable = source('EnableHotkey.svelte');
	check(
		'EnableHotkey: a press opens before its key-down goes out',
		/if \(key\) \{ presses\.down\(key, e\.repeat\); context\.eventEmitter\.broadcast\(\{ type: 'hotKey', key, action: 'keyDown',/.test(
			enable,
		),
	);
	check(
		'EnableHotkey: and closes with its key-up',
		/if \(key\) \{ presses\.up\(key\); context\.eventEmitter\.broadcast\(\{ type: 'hotKey', key, action: 'keyUp' \}\);/.test(
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
		'EnableSpaceHold: nothing infers a round from the game leaving idle',
		!/roundStartedAt|pressStartedAt|\$effect/.test(hold),
	);
}

if (failures) throw new Error(`onePress.fixture: ${failures} FAILED`);
console.log('\nonePress.fixture: all ok');
