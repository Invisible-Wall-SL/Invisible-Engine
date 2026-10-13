import { getContext, setContext } from 'svelte';

/**
 * The id of the `<LayoutScene>` a node renders inside, for a placed `<ComponentInstance>` to tag
 * its Flow instance handle with (`flowInstances.ts`). Absent ⇒ rendered outside a scene (a coded
 * mount, the editor's component stage): the handle carries no screen.
 */
const SCENE_ID_KEY = Symbol('engine-layout:sceneId');

export function setSceneIdContext(sceneId: string): void {
	setContext(SCENE_ID_KEY, sceneId);
}

export function getSceneIdContext(): string | undefined {
	return getContext<string | undefined>(SCENE_ID_KEY);
}
