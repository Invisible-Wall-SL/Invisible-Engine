import type { ComponentDef } from 'engine-layout';
import { MAX_COMPONENT_DEPTH } from 'engine-layout';

/**
 * A request from the Screens side of `/editor` to the Components side. `id: null` opens the
 * components home. `rootLabel` names the screen the author came from (the breadcrumb's first
 * crumb); `def` + `etag` carry a component the page just created, so the workspace can open it
 * before its own list has it.
 */
export interface ComponentOpenRequest {
	seq: number;
	id: string | null;
	rootLabel: string | null;
	def?: ComponentDef;
	etag?: string | null;
	/** Close the open component (asking about unsaved work) and go back to the Screens side. */
	exit?: boolean;
}

/**
 * Whether a nested instance inside the open def may be opened in place. `trailDepth` is how many
 * defs enclose the open one. The game skips instances nested `MAX_COMPONENT_DEPTH` deep or more
 * (`ComponentInstance.svelte`), so the editor never opens a def the game would not draw.
 */
export function canEnterNested(trailDepth: number): boolean {
	return trailDepth + 1 < MAX_COMPONENT_DEPTH;
}
