/**
 * Invisible Flow v2 — the `textMessage` node's shared helpers (schema §6.3).
 *
 * A Text Message node CARRIES its own player-facing text (unlike a `showContainer`, which points at
 * a scene). That text is both the authored default AND the localization key — so it must be
 * harvestable by Invisible Localization exactly the way `collectWinTextTemplates`
 * (`engine-layout/winText.ts`) flattens win copy. This module is the one home for that collector +
 * the node's coded defaults, imported by BOTH the launcher (the flow editor's node factory + the
 * localization harvest) and the game (the render layer), so the two can't drift.
 */

import type { FlowDoc, Graph, TextMessageNode } from './types';

/** The coded defaults a newly-dropped Text Message node starts with — the editable "default text". */
export const TEXT_MESSAGE_DEFAULTS = {
	text: 'Message',
	/** Default to the game's shared info-bar message channel — a new message looks + sits like every
	 *  other in-game message out of the box (switch to `'anchor'` for a positioned overlay). */
	placement: 'infoBar' as const,
	/** Normalized 0..1 screen anchor, used only when `placement:'anchor'` (centre, lower third). */
	place: { x: 0.5, y: 0.85 },
	visibleWhile: 'none' as const,
} satisfies Partial<TextMessageNode>;

/** Every `textMessage` node in a graph, recursing into group bodies (a message may sit in a group). */
const textMessageNodes = (graph: Graph): TextMessageNode[] => {
	const out: TextMessageNode[] = [];
	for (const node of graph.nodes) {
		if (node.kind === 'textMessage') out.push(node);
		else if (node.kind === 'group') out.push(...textMessageNodes(node.body));
	}
	return out;
};

/**
 * Every authored message string in a FlowDoc, flattened for Invisible Localization's harvest. Emits
 * the EXACT untrimmed string as both key and source (matching `harvestSceneText` /
 * `collectWinTextTemplates`: the runtime resolver looks a string up by the raw literal, so a trimmed
 * key would never match). Blank messages are skipped (nothing to translate); identical strings
 * dedupe to one entry. `label` is the human hint shown in the localization tool's section.
 */
export function collectTextMessages(
	doc: FlowDoc | undefined,
): { key: string; source: string; label: string }[] {
	if (!doc) return [];
	const out: { key: string; source: string; label: string }[] = [];
	const seen = new Set<string>();
	for (const node of textMessageNodes(doc.graph)) {
		const source = node.text;
		if (!source || !source.trim() || seen.has(source)) continue;
		seen.add(source);
		out.push({ key: source, source, label: `Message — ${node.id}` });
	}
	return out;
}
