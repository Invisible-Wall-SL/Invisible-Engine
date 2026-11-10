import type { LayoutDoc, Scene } from 'engine-layout';
import { basegameSceneId, loadingSceneId } from 'engine-layout';

/**
 * The default screen path of a game no Flow v2 graph drives (flow-driven-game §1). The loading
 * screen is the only screen at boot, so the board stays hidden behind it; the first time it
 * completes — its loading bar's `completeOnLoaded` or a tap (`registerFlowComplete` in
 * `Game.svelte`) — it gives way to the base game, which stays up for the rest of the session.
 * Book events are not involved: with no flow, `playBook` presents them through the coded map.
 */
export type BootScreens = {
	/** The loading and base-game scene ids, which only this path mounts. */
	readonly screenIds: ReadonlySet<string>;
	/** The scene behind a boot screen id; `undefined` for any other id. */
	scene: (screenId: string | undefined) => Scene | undefined;
	/** `[loading]` until the loading screen completes, `[basegame]` from then on. */
	readonly activeScreenIds: readonly string[];
	/** The loading screen finished: swap it for the base game. True only the first time. */
	complete: () => boolean;
};

/**
 * Build the boot screens from the live editor doc. `undefined` when the doc has no loading or no
 * base-game scene: the game then mounts every scene through its coded path.
 */
export const createBootScreens = (
	editorDoc: LayoutDoc,
	/** Told the new active set once, when the loading screen gives way to the base game. */
	onActiveScreensChange: (screenIds: readonly string[]) => void,
): BootScreens | undefined => {
	const loadingId = loadingSceneId(editorDoc.scenes);
	const basegameId = basegameSceneId(editorDoc.scenes);
	const sceneOf = (screenId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === screenId);
	if (!sceneOf(loadingId) || !sceneOf(basegameId)) return undefined;

	const screenIds: ReadonlySet<string> = new Set([loadingId, basegameId]);
	let activeScreenIds: readonly string[] = [loadingId];

	return {
		screenIds,
		scene: (screenId) =>
			screenId !== undefined && screenIds.has(screenId) ? sceneOf(screenId) : undefined,
		get activeScreenIds() {
			return activeScreenIds;
		},
		complete: () => {
			if (activeScreenIds[0] !== loadingId) return false;
			activeScreenIds = [basegameId];
			onActiveScreensChange(activeScreenIds);
			return true;
		},
	};
};
