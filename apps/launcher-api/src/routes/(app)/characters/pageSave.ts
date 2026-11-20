import type { GameConfigDoc, GameConfigIssue } from 'game-config';
import type { SaveContext, SaveOutcome } from '../../../lib/saveState.svelte';
import { adoptSaved, bodyFor } from '../config/pageDoc';
import type { SheetEdit } from './sheet/sheetEdit';

/**
 * How `/characters` SAVES and what may EDIT its doc, apart from the page so
 * `scripts/check-characters-tool.ts` §10 runs the page's own wiring (the real `SaveState` and
 * `LeaseState` against the real `PUT /api/game-config`).
 */

export interface PageSaveOptions {
	projectKey: string;
	/** The page's live doc, as it is now. */
	doc: () => GameConfigDoc;
	/** A save landed: `doc` is the stored config for the page to hold, `stored` a second copy of
	 *  it for *Compare*'s baseline. Called for a save that landed and for no other answer. */
	onSaved: (saved: { doc: GameConfigDoc; stored: GameConfigDoc }) => void;
	fetch?: typeof fetch;
}

/** The transport of the page's `SaveState`: one PUT of the whole config through `bodyFor`, as
 *  `/config` sends it, conditional on the ETag the page holds unless forced. */
export function pageSaveTransport(
	options: PageSaveOptions,
): (ctx: SaveContext) => Promise<SaveOutcome> {
	return async ({ baseEtag, force }) => {
		const send = options.fetch ?? fetch;
		const res = await send(`/api/game-config?project=${encodeURIComponent(options.projectKey)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ doc: bodyFor(options.doc()), baseEtag, force }),
		});
		if (res.status === 409) {
			const c = (await res.json()) as { message?: string };
			return { ok: false, reason: 'conflict', message: c.message };
		}
		if (res.status === 400) {
			const c = (await res.json()) as { issues?: GameConfigIssue[] };
			const n = c.issues?.length ?? 0;
			return {
				ok: false,
				reason: 'error',
				message: n
					? `Can't save: ${n} blocking ${n === 1 ? 'issue' : 'issues'}.`
					: "This config can't be saved.",
			};
		}
		if (!res.ok) {
			return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
		}
		const saved = (await res.json()) as { doc: GameConfigDoc; etag: string | null };
		options.onSaved({ doc: adoptSaved(saved.doc), stored: adoptSaved(saved.doc) });
		return { ok: true, etag: saved.etag };
	};
}

/** Why the page's doc cannot be edited now, or `null`. While a save is in flight nothing is: the
 *  save adopts the stored config when it lands, which would drop an edit made meanwhile. */
export const editRefusal = (state: { readOnly: boolean; saving: boolean }): string | null =>
	state.saving
		? 'A save is in flight: nothing can be edited until it lands. Try again then.'
		: state.readOnly
			? 'This page is read-only: nothing was changed.'
			: null;

/**
 * The page's two ways to edit its doc. `change` runs one edit on the live doc and answers whether
 * it ran: not at all while {@link editRefusal} holds. `sheetEdit` is `change` for the sheet's
 * cards: the edit's own refusal comes back to the card, and so does the page's when the edit did
 * not run, so a card never reports an edit that was not made.
 */
export function pageEdits(options: {
	/** {@link editRefusal} of the page, now. */
	refusal: () => string | null;
	doc: () => GameConfigDoc;
	/** After an edit that ran; `brain` when it was a brain edit. */
	after?: (brain: boolean) => void;
}): {
	change: (run: (doc: GameConfigDoc) => void, brain?: boolean) => boolean;
	sheetEdit: SheetEdit;
} {
	const change = (run: (doc: GameConfigDoc) => void, brain = false): boolean => {
		if (options.refusal()) return false;
		run(options.doc());
		options.after?.(brain);
		return true;
	};
	const sheetEdit: SheetEdit = (run) => {
		const blocked = options.refusal();
		if (blocked) return blocked;
		let refused: string | null | void = null;
		change((doc) => (refused = run(doc)));
		return refused ?? null;
	};
	return { change, sheetEdit };
}
