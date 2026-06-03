import type { LayoutDoc } from '../types';
import { bookofReferenceLayout } from './bookof';
import { defaultLayout } from './lines';

export { defaultLayout } from './lines';
export { bookofReferenceLayout } from './bookof';

/**
 * A built-in, fully-placed reference layout for a game type — the engine-truth
 * "import" of a game's current scenes (positions + layers), as opposed to the
 * empty template skeleton. The launcher editor's "Load game scene" picker lists
 * these so an author can open a game already laid out instead of from blank.
 * Currently only `lines` ships one; other types fall back to the skeleton.
 */
export interface ReferenceLayout {
	gameType: string;
	name: string;
	build: () => LayoutDoc;
}

const REFERENCE_LAYOUTS: ReferenceLayout[] = [
	{ gameType: 'lines', name: 'Lines — base game', build: () => defaultLayout('lines') },
	{ gameType: 'bookOf', name: 'Book of Borut — base game', build: bookofReferenceLayout },
];

/** The game types that have a built-in placed layout (for a load picker). */
export function listReferenceLayouts(): { gameType: string; name: string }[] {
	return REFERENCE_LAYOUTS.map(({ gameType, name }) => ({ gameType, name }));
}

/** The placed `LayoutDoc` for `gameType`, or `undefined` if none ships one. */
export function getReferenceLayout(gameType: string): LayoutDoc | undefined {
	return REFERENCE_LAYOUTS.find((r) => r.gameType === gameType)?.build();
}
