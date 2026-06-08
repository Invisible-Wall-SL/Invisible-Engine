import type { LayoutDoc } from '../types';
import { bookofReferenceLayout } from './bookof';
import { defaultLayout } from './lines';

export { defaultLayout } from './lines';
export { bookofReferenceLayout } from './bookof';
// The game HUD as editor scenes (identical across game types) — used by the
// editor's "Add HUD layer" action + a game's fallback doc.
export {
	hudScenes,
	hudBarScene,
	hudCornersScene,
	HUD_SCENE_IDS,
	isHudScene,
	HUD_DEFAULT_TEXT,
	defaultHudText,
} from './hud';

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
	// NOTE: `bookOf` is intentionally NOT offered in the picker. Its board frame
	// is an atlas FRAME (`frame_bg.png` lives inside the `reels_frame` atlas), so a
	// generic standalone-key layout can't render it in the editor AND loading it
	// would autosave over a project's real seeded doc. The canonical path for a
	// real game is the per-project seed (`scripts/seed-game-editor.mjs`), which
	// emits region sprites pointing at the project's manifest. `bookofReferenceLayout`
	// stays exported for that seed/tooling.
];

/** The game types that have a built-in placed layout (for a load picker). */
export function listReferenceLayouts(): { gameType: string; name: string }[] {
	return REFERENCE_LAYOUTS.map(({ gameType, name }) => ({ gameType, name }));
}

/** The placed `LayoutDoc` for `gameType`, or `undefined` if none ships one. */
export function getReferenceLayout(gameType: string): LayoutDoc | undefined {
	return REFERENCE_LAYOUTS.find((r) => r.gameType === gameType)?.build();
}

/**
 * The canonical FULL scene set for a game type — the complete screen list the
 * game has (loading/logo, background, basegame, overlays, free-spins, HUD). The
 * editor's "Add missing screens" action diffs this against a project's doc and
 * appends only the scenes the doc LACKS (by id), non-destructively.
 *
 * Distinct from {@link getReferenceLayout}/the picker: it covers `bookOf` too.
 * That's safe for the merge precisely because the merge adopts only ABSENT
 * scenes — never `bookofReferenceLayout`'s board-frame nodes (whose atlas region
 * the generic layout can't reproduce), since a seeded project already has
 * `basegame`. Returns `undefined` for an unknown game type.
 */
const FULL_SCENE_SOURCES: Record<string, () => LayoutDoc> = {
	lines: () => defaultLayout('lines'),
	bookOf: () => bookofReferenceLayout(),
};

export function getFullSceneSet(gameType: string): LayoutDoc | undefined {
	return FULL_SCENE_SOURCES[gameType]?.();
}
