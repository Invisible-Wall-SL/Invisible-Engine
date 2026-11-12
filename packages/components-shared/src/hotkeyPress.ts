/**
 * The key presses in progress, one record per press, and who each one belongs to. Import-free, so
 * fixtures can load it headlessly.
 *
 * A press runs from its first `keyDown` to its `keyUp`, OS auto-repeats included. `EnableHotkey`
 * keeps the ledger: it opens a press before it broadcasts the key-down, so anything the key-down
 * sets off already finds the press, closes it with the key-up or when focus leaves the page, and
 * hands each hotkey event its press.
 *
 * ONE KEY PRESS, ONE ACTION — the keyboard's twin of the pointer's hit test. Every `OnHotkey` hears
 * every event, so each used to decide alone whether to act: one Space ran a win gate's dismiss and
 * the authored win screen's tap at once, or slammed a round and skipped its big-win count-up, where a
 * tap runs only the surface in front (`ContinuePressMask`). Now a press belongs to ONE hotkey: the
 * newest listening one that would act on it, decided at the key-down before any of them acts, so
 * nothing an action changes can hand the same press to a second hotkey. A hotkey with no `onpress`
 * (hold-to-spin) takes no press: it watches every one.
 *
 * Hold-to-spin also reads the press (`EnableSpaceHold`): it continues from idle only for a Space
 * press a round started during. It used to infer that from the game leaving idle after the press,
 * and the resume check `ResumeBet` runs as the player gets past the start screen is not a round: one
 * Space there dismissed the screen and, once a blocked page let the hold timer run first, bet a spin.
 *
 * Scoped to a game's event emitter ({@link hotkeyPressesFor}), so two games or stories on one page
 * keep their keys apart.
 */

export type HotkeyPress = {
	/** The hotkey the press belongs to, once one took it. */
	owner?: symbol;
	/** A round started (a `bet` went out) while the key was down. */
	startedRound?: boolean;
};

/** The part of a hotkey event this decides on (`EmitterEventHotKey`). */
export type HotkeyEventShape = {
	key: string;
	action: 'keyUp' | 'keyDown';
	repeat?: boolean;
	press?: HotkeyPress;
};

/** How one `OnHotkey` listens, read at each event. */
export type HotkeyListener = {
	hotkey: string;
	disabled?: boolean;
	ignorePressInProgress?: boolean;
	/** This hotkey has seen the current press's `keyDown`. */
	pressSeen: boolean;
};

/**
 * Whether a hotkey listening as `listener` responds to `event`, before any press is taken: the
 * event's action, or `undefined`. A hotkey with `ignorePressInProgress` acts only on a press that
 * starts while it listens: no auto-repeat, and no `keyUp` of a press it never saw go down.
 */
export const listensTo = (
	event: HotkeyEventShape,
	listener: HotkeyListener,
): HotkeyEventShape['action'] | undefined => {
	if (listener.disabled) return undefined;
	if (event.key !== listener.hotkey) return undefined;
	if (listener.ignorePressInProgress) {
		if (event.repeat) return undefined;
		if (event.action === 'keyUp' && !listener.pressSeen) return undefined;
	}
	return event.action;
};

/** One game's keyboard: the presses in progress, by key, and the hotkeys that take presses. */
export const createHotkeyPresses = () => {
	const live = new Map<string, HotkeyPress>();
	// Oldest first; each one's `wants` says whether it would act on a key-down now.
	const takers: { owner: symbol; wants: (event: HotkeyEventShape) => boolean }[] = [];
	// Key-downs whose owner is decided, so every hotkey hearing one gets the same answer.
	const decided = new WeakSet<HotkeyEventShape>();

	return {
		/** A `keyDown`: a new press, or on an OS auto-repeat the one held. */
		down(key: string, repeat: boolean): HotkeyPress {
			const held = live.get(key);
			if (repeat && held) return held;
			const press: HotkeyPress = {};
			live.set(key, press);
			return press;
		},
		/** A `keyUp`: the press is over. Returns it, for its key-up event. */
		up(key: string): HotkeyPress | undefined {
			const press = live.get(key);
			live.delete(key);
			return press;
		},
		/** Focus left the page: no `keyUp` comes for the presses in progress. */
		drop(): void {
			live.clear();
		},
		/** The press of `key` in progress, if any. */
		live(key: string): HotkeyPress | undefined {
			return live.get(key);
		},
		/** A hotkey that acts on presses starts listening; returns its leave. */
		join(owner: symbol, wants: (event: HotkeyEventShape) => boolean): () => void {
			const taker = { owner, wants };
			takers.push(taker);
			return () => {
				const index = takers.indexOf(taker);
				if (index >= 0) takers.splice(index, 1);
			};
		},
		/**
		 * Whether `owner` acts on `event`. A press nobody has taken goes, at its key-down, to the newest
		 * hotkey that wants it, and stays theirs to its key-up; one nobody wanted is offered again at
		 * the next auto-repeat. An event with no press (broadcast by hand, as a story does) is
		 * everyone's, as before.
		 */
		owns(event: HotkeyEventShape, owner: symbol): boolean {
			const press = event.press;
			if (!press) return true;
			if (press.owner === undefined && event.action === 'keyDown' && !decided.has(event)) {
				decided.add(event);
				for (let i = takers.length - 1; i >= 0; i--) {
					if (!takers[i].wants(event)) continue;
					press.owner = takers[i].owner;
					break;
				}
			}
			return press.owner === owner;
		},
	};
};

export type HotkeyPresses = ReturnType<typeof createHotkeyPresses>;

const byEmitter = new WeakMap<object, HotkeyPresses>();

/** The keyboard of the game whose event emitter is `emitter`. */
export const hotkeyPressesFor = (emitter: object): HotkeyPresses => {
	let presses = byEmitter.get(emitter);
	if (!presses) {
		presses = createHotkeyPresses();
		byEmitter.set(emitter, presses);
	}
	return presses;
};
