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

/**
 * Does this tab hold the ETag of `id`'s stored object? `null` counts (a built-in, or a def never
 * saved: the first save creates); only a def the map has never heard of — one refreshed from the
 * listing after load — needs its ETag read before it can be saved.
 */
export function etagKnown(etags: Record<string, string | null>, id: string): boolean {
	return Object.prototype.hasOwnProperty.call(etags, id);
}

/** JSON with object keys sorted at every depth, so two reads of one def compare equal. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = canonical((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/** Are two component defs the same content, whatever their key order? */
export function sameDef(a: unknown, b: unknown): boolean {
	return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * What to do with a def + ETag read for an open draft that had no ETag (`loadEtag`). The ETag
 * belongs to the content it was read with, never to an older copy of the draft:
 *   - `adopt` — the stored def is still the one the draft was opened from: its ETag is the save's
 *     precondition;
 *   - `reseed` — someone saved since, and the draft has no edits: open their version, with its
 *     ETag;
 *   - `keep` — someone saved since and the draft HAS edits, or the save is busy, conflicted or
 *     blocked: adopt nothing. The save then asserts a create, which conflicts, and the author gets
 *     the ordinary "save on top" choice instead of silently overwriting their version.
 */
export function etagAdoption(opts: {
	openedFrom: unknown;
	stored: unknown;
	dirty: boolean;
	blocked: boolean;
}): 'adopt' | 'reseed' | 'keep' {
	if (opts.blocked) return 'keep';
	if (sameDef(opts.openedFrom, opts.stored)) return 'adopt';
	return opts.dirty ? 'keep' : 'reseed';
}
