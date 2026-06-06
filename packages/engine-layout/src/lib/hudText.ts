import type { LayoutNode, TextStyle } from './types';

/**
 * Editor-authored override for a coded HUD **text** element (the logo / game-name
 * corners) — see `docs/design/invisible-editor.md` §9 Phase 4. The HUD snippet's
 * content stays coded in the game; the editor only supplies an optional font/size/
 * fill (`style`) and an optional replacement `text`, which the game's `gameName`/
 * `logo` snippet merges into its `<Text>`. Stored on the bind anchor's
 * `bind.props` (the existing escape hatch for bind nodes), so it round-trips
 * through the doc with no new node field.
 */
export interface HudTextOverride {
	/** Partial text style merged over the snippet's coded base style. */
	style?: Partial<TextStyle>;
	/** Replacement label string (e.g. rename "LINES GAME"). Absent = coded default. */
	text?: string;
}

/**
 * Read a bind anchor's HUD-text override from `bind.props`. Returns `undefined`
 * when the node isn't a bind anchor or carries no override, so callers fall back
 * to the coded default (parity). Defensive against malformed stored props.
 */
export function getHudTextOverride(node: LayoutNode | undefined): HudTextOverride | undefined {
	const props = node?.bind?.props;
	if (!props || typeof props !== 'object') return undefined;
	const p = props as Record<string, unknown>;
	const style =
		p.style && typeof p.style === 'object' ? (p.style as Partial<TextStyle>) : undefined;
	const text = typeof p.text === 'string' ? p.text : undefined;
	if (!style && text === undefined) return undefined;
	return { style, text };
}
