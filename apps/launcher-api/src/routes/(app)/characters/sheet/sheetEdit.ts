import type { GameConfigDoc } from 'game-config';

/**
 * How a card of the sheet edits the config: `run` gets the page's live doc (through the page's
 * `change`, so nothing runs while the page is read-only) and returns why the edit is refused.
 * The card gets that reason back, or `null` when the edit was made.
 */
export type SheetEdit = (run: (doc: GameConfigDoc) => string | null | void) => string | null;

/** Show what the doc holds after an edit: one that was refused, or stored as another text, leaves
 *  the typed text in the field otherwise. */
export function settle(el: HTMLInputElement | HTMLSelectElement, stored: unknown): void {
	const text = stored === undefined ? '' : String(stored);
	if (el.value !== text) el.value = text;
}
