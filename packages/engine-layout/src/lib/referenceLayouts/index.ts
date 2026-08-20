import type { LayoutDoc } from '../types';
import { bookofReferenceLayout } from './bookof';
import { clusterReferenceLayout } from './cluster';
import { defaultLayout } from './lines';
import { scatterReferenceLayout } from './scatter';
import { waysReferenceLayout } from './ways';

export { defaultLayout } from './lines';
export { bookofReferenceLayout } from './bookof';
export { waysReferenceLayout } from './ways';
export { clusterReferenceLayout } from './cluster';
export { scatterReferenceLayout } from './scatter';
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
const FULL_SCENE_SOURCES: Record<string, { name: string; build: () => LayoutDoc; filled?: true }> =
	{
		// `filled` kinds ship a board-frame-bearing layout — so "Import composed
		// reference" (§19.6) is meaningful for them (the filled doc carries art). The
		// project-aware import endpoint rewrites their bare frame names to the active
		// project's atlas region. The non-filled engine-skeleton kinds have no art, so
		// importing them would equal scaffolding — pointless, hence not importable.
		lines: { name: 'Lines', build: () => defaultLayout('lines'), filled: true },
		bookOf: { name: 'Book of', build: () => bookofReferenceLayout(), filled: true },
		// Engine-skeleton kinds (§19.8): no filled `import`, but offered in the
		// "New game from kind" picker via the scaffold projection.
		// `ways` is FILLED: it shares the reference art + board geometry with `lines`, so its layout is
		// worth importing (see `referenceLayouts/ways.ts`). `cluster`/`scatter` stay engine-skeleton —
		// neither template is being built, and both would need a tumble mechanic the runtime lacks.
		ways: { name: 'Ways', build: () => waysReferenceLayout(), filled: true },
		cluster: { name: 'Cluster', build: () => clusterReferenceLayout() },
		scatter: { name: 'Scatter', build: () => scatterReferenceLayout() },
	};

export function getFullSceneSet(gameType: string): LayoutDoc | undefined {
	return FULL_SCENE_SOURCES[gameType]?.build();
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
