/**
 * The key presses in progress, one record per press, so a component can tell what happened while a
 * key was down. Import-free, so fixtures can load it headlessly.
 *
 * A press runs from its first `keyDown` to its `keyUp`, OS auto-repeats included. `EnableHotkey`
 * keeps the ledger: it opens a press before it broadcasts the key-down, so anything the key-down
 * sets off already finds the press, and closes it with the key-up or when focus leaves the page.
 *
 * Hold-to-spin is the reader (`EnableSpaceHold`): it continues from idle only for a Space press a
 * round started during. It used to infer that from the game leaving idle after the press, and the
 * resume check `ResumeBet` runs as the player gets past the start screen is not a round: one Space
 * there dismissed the screen and, once a blocked page let the hold timer run first, bet a spin.
 *
 * Scoped to a game's event emitter ({@link hotkeyPressesFor}), so two games or stories on one page
 * keep their keys apart.
 */

export type HotkeyPress = {
	/** A round started (a `bet` went out) while the key was down. */
	startedRound?: boolean;
};

/** One game's keyboard: the presses in progress, by key. */
export const createHotkeyPresses = () => {
	const live = new Map<string, HotkeyPress>();

	return {
		/** A `keyDown`: a new press, or on an OS auto-repeat the one held. */
		down(key: string, repeat: boolean): HotkeyPress {
			const held = live.get(key);
			if (repeat && held) return held;
			const press: HotkeyPress = {};
			live.set(key, press);
			return press;
		},
		/** A `keyUp`: the press is over. */
		up(key: string): void {
			live.delete(key);
		},
		/** Focus left the page: no `keyUp` comes for the presses in progress. */
		drop(): void {
			live.clear();
		},
		/** The press of `key` in progress, if any. */
		live(key: string): HotkeyPress | undefined {
			return live.get(key);
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
