/**
 * Transient player message ("toast") state.
 *
 * A lightweight, non-blocking message line games can use to narrate play —
 * e.g. "Bet $1.00", "Win $20.00 — 3× L5", "Not enough credits". Distinct from
 * `stateModal` (full-screen, blocking dialogs). Auto-clears after a timeout.
 *
 * Usage from a game:
 *   import { showMessage } from 'state-shared';
 *   showMessage('Win $20.00 — 3× L5', { kind: 'win' });
 */

export type GameMessageKind = 'info' | 'win' | 'warn';

export type GameMessage = {
	/** Monotonic id so the renderer can re-trigger its enter animation. */
	id: number;
	/** The plain text — the CLEAN, always-renderable form (used by any string reader and the coded
	 *  HTML toast). Symbol names are written out here. */
	text: string;
	kind: GameMessageKind;
	/**
	 * An optional RICH variant of `text` carrying inline-image sentinels (`engine-layout`'s
	 * `wrapInlineImage`) — e.g. the paying symbol as a sprite instead of its name. A Pixi renderer
	 * that understands the sentinels (the info-bar text node) shows this; everything else uses the
	 * clean `text`. Unset for ordinary messages (parity: the renderer just gets `text`).
	 */
	richText?: string;
};

export const stateMessage = $state({
	current: null as GameMessage | null,
});

let nextId = 0;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a transient message. Replaces any current one and (re)starts the
 *  auto-clear timer. Pass `durationMs: 0` to keep it until the next message or
 *  an explicit clearMessage(). */
export const showMessage = (
	text: string,
	options: { kind?: GameMessageKind; durationMs?: number; richText?: string } = {},
): void => {
	nextId += 1;
	const id = nextId;
	stateMessage.current = { id, text, kind: options.kind ?? 'info', richText: options.richText };

	if (clearTimer) clearTimeout(clearTimer);
	const duration = options.durationMs ?? 2600;
	if (duration > 0) {
		clearTimer = setTimeout(() => {
			// Only clear if no newer message replaced this one.
			if (stateMessage.current?.id === id) stateMessage.current = null;
		}, duration);
	}
};

export const clearMessage = (): void => {
	if (clearTimer) clearTimeout(clearTimer);
	stateMessage.current = null;
};
