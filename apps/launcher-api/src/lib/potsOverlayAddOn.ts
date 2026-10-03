import type { AddOnRenames } from 'game-config';

/**
 * What the Game Maker's pots overlay add-on reports (`$lib/server/projectAddOn.ts`), shared with the
 * page that shows it.
 *
 * - `added`: written now (`added` names what);
 * - `present`: the doc already had every part;
 * - `conflict`: someone saved the doc between this read and its write — run the action again;
 * - `skipped`: nothing could be written (`note` says why);
 * - `failed`: the write threw (`note` carries the error).
 */
export type AddOnPartStatus = 'added' | 'present' | 'conflict' | 'skipped' | 'failed';

export type AddOnPart = { status: AddOnPartStatus; added: string[]; note?: string };

export type AddOnSeedReport = {
	symbols: AddOnPart;
	layout: AddOnPart;
	winText: AddOnPart;
	/** Present only when the graft was asked for. */
	flow?: AddOnPart;
};

export type AddOnOutcome =
	| { ok: true; configAdded: boolean; renamed: AddOnRenames; seeds: AddOnSeedReport }
	| { ok: false; status: 400 | 403 | 409 | 500; error: string };
