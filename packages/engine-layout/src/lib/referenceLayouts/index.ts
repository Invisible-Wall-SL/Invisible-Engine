import type { LayoutDoc, Scene } from '../types';
import { bookofReferenceLayout } from './bookof';
import { clusterReferenceLayout } from './cluster';
import {
	HOLD_AND_WIN_BOARD,
	HOLD_AND_WIN_MODE,
	holdAndWinReferenceLayout,
	POTS_SCREEN,
	type HoldAndWinTemplateOptions,
} from './holdAndWin';
import { defaultLayout } from './lines';
import { scatterReferenceLayout } from './scatter';
import { waysReferenceLayout } from './ways';

export { defaultLayout } from './lines';
export { bookofReferenceLayout } from './bookof';
export { waysReferenceLayout } from './ways';
export { clusterReferenceLayout } from './cluster';
export { scatterReferenceLayout } from './scatter';
export {
	holdAndWinReferenceLayout,
	HOLD_AND_WIN_BOARD,
	HOLD_AND_WIN_HOTFIRE_BOARD,
	HOLD_AND_WIN_MODE,
	HOLD_AND_WIN_BANNER_SCREENS,
	POTS_SCREEN,
	EXPANDING_BLOCK_SHARE,
	expandingBoardReserve,
	expandingBoardReserved,
	reserveExpandingBoard,
	type HoldAndWinTemplateOptions,
} from './holdAndWin';
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
 * The canonical FULL scene set for a game type — the complete screen list the
 * game has (loading/logo, background, basegame, overlays, free-spins, HUD). The
 * editor's "Add missing screens" action diffs this against a project's doc and
 * appends only the scenes the doc LACKS (by id), non-destructively.
 *
 * Two readers, two projections of this ONE source (§19.3):
 * - "New game from kind" (`listFullSceneSets` → scaffold/`engineOwnedOnly`) — ALL
 *   kinds, art dropped.
 * - "Import composed reference" (`listImportableKinds` → filled, project-aware
 *   rewrite) — only the `filled` kinds, which carry board-frame art.
 *
 * Returns `undefined` for an unknown game type.
 */
const FULL_SCENE_SOURCES: Record<
	string,
	{
		name: string;
		build: (options?: HoldAndWinTemplateOptions) => LayoutDoc;
		filled?: true;
		/** Other kinds this set is a reference FOR: loaded into one of their projects it is that
		 *  project's own layout, not another kind's (see {@link referenceLoadsAs}). */
		referenceFor?: readonly string[];
	}
> = {
	// `filled` kinds ship a board-frame-bearing layout — so "Import composed
	// reference" (§19.6) is meaningful for them (the filled doc carries art). The
	// project-aware import endpoint rewrites their bare frame names to the active
	// project's atlas region. The non-filled engine-skeleton kinds have no art, so
	// importing them would equal scaffolding — pointless, hence not importable.
	lines: { name: 'Lines', build: () => defaultLayout('lines'), filled: true },
	// The Book-of look is a reference for a LINES game too: a Book-of game is lines plus the
	// expanding symbol (`docs/design/book-feature.md` Phase 5c).
	bookOf: {
		name: 'Book of',
		build: () => bookofReferenceLayout(),
		filled: true,
		referenceFor: ['lines'],
	},
	// Engine-skeleton kinds (§19.8): no filled `import`, but offered in the
	// "New game from kind" picker via the scaffold projection.
	// `ways` is FILLED: it shares the reference art + board geometry with `lines`, so its layout is
	// worth importing (see `referenceLayouts/ways.ts`). `cluster`/`scatter` stay engine-skeleton —
	// neither template is being built, and both would need a tumble mechanic the runtime lacks.
	ways: { name: 'Ways', build: () => waysReferenceLayout(), filled: true },
	cluster: { name: 'Cluster', build: () => clusterReferenceLayout() },
	scatter: { name: 'Scatter', build: () => scatterReferenceLayout() },
	// Hold and Win (Phase 6): the respin feature's screens on the engine skeleton — one set for
	// all three reference games. Engine pieces only (no art), so scaffold-only like the skeletons.
	holdAndWin: {
		name: 'Hold and Win',
		build: (options) => holdAndWinReferenceLayout(undefined, options),
	},
};

/**
 * Scene-set options: the Hold and Win template's (`maxRows`, `potIds`) plus the project's add-on
 * capabilities (docs/design/pots-overlay.md §4). On any kind but `holdAndWin`, `potsOverlay` or
 * `holdAndWin` merges the add-on screens into the kind's set; the `holdAndWin` kind already has
 * them, so there the flags change nothing.
 */
export type SceneSetOptions = HoldAndWinTemplateOptions & {
	holdAndWin?: boolean;
	potsOverlay?: boolean;
};

/**
 * The add-on screens, in the Hold and Win reference's order: the Pots screen for either add-on;
 * with a Hold and Win bonus also the Jackpot bar and every `holdAndWin` mode screen. Lucky Spin
 * is left out — it is an error on an overlay host's bonus.
 */
function addOnScenes(options: SceneSetOptions): { reference: Scene[]; ids: string[] } {
	const { potIds, maxRows, holdAndWin } = options;
	const reference = holdAndWinReferenceLayout(HOLD_AND_WIN_BOARD, { potIds, maxRows }).scenes;
	const ids = reference
		.filter(
			(scene) =>
				scene.id === POTS_SCREEN ||
				(holdAndWin &&
					(scene.id === 'jackpotBar' ||
						(scene.role === 'mode' && scene.modeId === HOLD_AND_WIN_MODE))),
		)
		.map((scene) => scene.id);
	return { reference, ids };
}

const hasAddOn = (gameType: string, options: SceneSetOptions): boolean =>
	gameType !== 'holdAndWin' && Boolean(options.holdAndWin || options.potsOverlay);

/**
 * `current` with the `reference` scenes named by `ids` merged in — each right after the nearest
 * scene that precedes it in `reference` and is already present (else first), in `reference` order,
 * so the layer order follows the game's own set. A scene whose id `current` already has is skipped;
 * the existing scenes are never edited, so a second merge adds nothing.
 */
export function mergeMissingScreens(
	current: readonly Scene[],
	reference: readonly Scene[],
	ids: readonly string[],
): Scene[] {
	const next = [...current];
	reference.forEach((ref, refIdx) => {
		if (!ids.includes(ref.id) || next.some((scene) => scene.id === ref.id)) return;
		let at = 0;
		for (let i = refIdx - 1; i >= 0; i--) {
			const prev = next.findIndex((scene) => scene.id === reference[i].id);
			if (prev !== -1) {
				at = prev + 1;
				break;
			}
		}
		next.splice(at, 0, structuredClone(ref));
	});
	return next;
}

/** The ids of the add-on screens `getFullSceneSet(gameType, options)` merges into the kind's set. */
export function addOnSceneIds(gameType: string, options: SceneSetOptions = {}): string[] {
	if (!FULL_SCENE_SOURCES[gameType] || !hasAddOn(gameType, options)) return [];
	return addOnScenes(options).ids;
}

/**
 * The full scene set for `gameType`. `options.maxRows` — a Hold and Win project whose Game Config
 * expands its respin board — reserves the grown board's area (the other kinds ignore it);
 * `options.potIds` names the pots screen's pots. The add-on flags merge the add-on screens into
 * any other kind's set ({@link SceneSetOptions}); with none set the set is the kind's own.
 */
export function getFullSceneSet(
	gameType: string,
	options: SceneSetOptions = {},
): LayoutDoc | undefined {
	const doc = FULL_SCENE_SOURCES[gameType]?.build(options);
	if (!doc || !hasAddOn(gameType, options)) return doc;
	const { reference, ids } = addOnScenes(options);
	return { ...doc, scenes: mergeMissingScreens(doc.scenes, reference, ids) };
}

/**
 * The placed `LayoutDoc` for `gameType`, or `undefined` if it ships no FILLED
 * (board-frame-bearing) layout. Backs "Import composed reference": only the
 * `filled` kinds (`lines` + `bookOf`) carry art worth importing. `bookOf` is now
 * included because the project-aware import endpoint rewrites its bare frame
 * names to the active project's atlas region (§19.6) — a generic standalone-key
 * layout couldn't render an atlas FRAME, so it was previously excluded.
 */
export function getReferenceLayout(gameType: string): LayoutDoc | undefined {
	const src = FULL_SCENE_SOURCES[gameType];
	return src?.filled ? src.build() : undefined;
}

/**
 * The game types that have a full scene set (for the editor's "New game from
 * kind" picker). Broader than {@link listImportableKinds}: it includes the
 * engine-skeleton kinds (`ways`/`cluster`/`scatter`) too, because the scaffold
 * projection (`engineOwnedOnly`) drops art so even art-less kinds are scaffoldable.
 */
export function listFullSceneSets(): { gameType: string; name: string }[] {
	return Object.entries(FULL_SCENE_SOURCES).map(([gameType, { name }]) => ({ gameType, name }));
}

/**
 * The game type a reference set loads AS into a project of `projectKind`: the project's own when
 * the set is its kind or a reference for it (the Book-of set into a lines project), else the set's
 * own kind — a cross-type load, which the editor confirms and never autosaves.
 */
export function referenceLoadsAs(setKind: string, projectKind: string): string {
	if (!projectKind || setKind === projectKind) return setKind;
	return FULL_SCENE_SOURCES[setKind]?.referenceFor?.includes(projectKind) ? projectKind : setKind;
}

/**
 * The game types offered in the editor's "Import composed reference" group — the
 * kinds with a FILLED (art-bearing) reference layout (`lines` + `bookOf` today).
 * The engine-skeleton kinds have no art, so for them import == scaffold; they are
 * deliberately omitted (§19.6). Returned as `{ id, name }` for the picker.
 */
export function listImportableKinds(): { id: string; name: string }[] {
	return Object.entries(FULL_SCENE_SOURCES)
		.filter(([, src]) => src.filled)
		.map(([id, { name }]) => ({ id, name }));
}
