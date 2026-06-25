import type { LayoutDoc, LayoutNode, Scene } from 'engine-layout';
import type { LocalizationDoc, LocalizationEntry } from './localization';

/**
 * Auto-collect the human-readable text the author placed in the Scene Editor and
 * fold it into the Localization tool — so every text box in the game shows up as a
 * translatable row, grouped by the screen it lives on, with zero re-keying.
 *
 * Each harvested string's translation `key` IS the source text itself (the
 * source-as-key model): the engine's text resolver matches a text node's rendered
 * string against the catalog, so translating "BIG WIN" here ships to every text
 * node that renders "BIG WIN" (see `engine-layout/registerTextResolver.ts` + design
 * §18). Identical strings — even across screens — share one translation.
 */

/** One collected text component (a single editor node's localizable string). */
export interface HarvestedItem {
	/** Translation key = the trimmed source text (source-as-key). */
	key: string;
	source: string;
	/** A human label for the row (the node's label / component id). */
	label: string;
}

/** One screen's worth of collected text (a UI "section"). */
export interface HarvestSection {
	sceneId: string;
	sceneName: string;
	items: HarvestedItem[];
}

/** Display grouping handed to the page: a section is a list of entry keys, in order. */
export interface DisplaySection {
	sceneId: string;
	sceneName: string;
	keys: string[];
}

/**
 * `componentInstance` params that hold author-written, human-readable text worth
 * localizing. `text` (textBox) and `label` (button / HUD readout / counter / info
 * bar). `icon` is an asset/glyph name, not prose — deliberately excluded.
 */
const TEXT_PARAM_KEYS = ['text', 'label'] as const;

/** A string is localizable only if it has at least one letter (skip pure numbers/symbols). */
function isLocalizableText(value: unknown): value is string {
	return typeof value === 'string' && /\p{L}/u.test(value);
}

function childrenOf(node: LayoutNode): LayoutNode[] {
	const children = (node as { children?: LayoutNode[] }).children;
	return Array.isArray(children) ? children : [];
}

/** Pull every localizable string out of one node (not its children). */
function nodeTexts(node: LayoutNode): string[] {
	const out: string[] = [];
	if (node.kind === 'text' && isLocalizableText(node.text)) {
		out.push(node.text);
	}
	if (node.kind === 'componentInstance') {
		const params = (node.params ?? {}) as Record<string, unknown>;
		// A live engine value feed overrides the static text in-game, so harvesting
		// the placeholder text would be pointless — skip it when `source` is bound.
		const boundToFeed = typeof params.source === 'string' && params.source.trim() !== '';
		if (!boundToFeed) {
			for (const key of TEXT_PARAM_KEYS) {
				if (isLocalizableText(params[key])) out.push(params[key] as string);
			}
		}
	}
	return out;
}

/** A readable row label for a node (its author label, else its kind/component id). */
function nodeLabel(node: LayoutNode): string {
	if (typeof node.label === 'string' && node.label.trim()) return node.label.trim();
	if (node.kind === 'componentInstance') return node.componentId;
	return node.kind;
}

function harvestScene(scene: Scene): HarvestSection {
	const items: HarvestedItem[] = [];
	const seen = new Set<string>();
	const walk = (node: LayoutNode): void => {
		const label = nodeLabel(node);
		for (const source of nodeTexts(node)) {
			// Key on the EXACT (untrimmed) string: the in-game resolver looks the
			// catalog up by the raw `node.text` (`resolveLocalizedText` in
			// `LayoutNodeView`), so a trimmed key would never match padded text and
			// the translation would silently not ship. Source-as-key ⇒ key === source.
			if (seen.has(source)) continue;
			seen.add(source);
			items.push({ key: source, source, label });
		}
		childrenOf(node).forEach(walk);
	};
	scene.nodes.forEach(walk);
	return { sceneId: scene.id, sceneName: scene.name || scene.id, items };
}

/**
 * Collect every localizable text component in the editor doc, grouped by scene.
 * Scenes with no text are dropped so the page only shows sections that matter.
 */
export function harvestSceneText(doc: LayoutDoc): HarvestSection[] {
	return doc.scenes.map(harvestScene).filter((s) => s.items.length > 0);
}

function newId(): string {
	return crypto.randomUUID();
}

/**
 * Fold the harvested scene text into a stored localization doc. Returns the merged
 * entry list (existing translations preserved, missing source strings added as
 * fresh `editor` entries) plus the display sections (scene → keys). Pure: callers
 * decide what to persist (see the page's save action, which prunes empty `editor`
 * entries — they're re-derived from the editor each load).
 */
export function reconcileWithEditor(
	doc: LocalizationDoc,
	sections: HarvestSection[],
): { entries: LocalizationEntry[]; display: DisplaySection[] } {
	// Work on copies so we never mutate the caller's doc; index them keep-first so a
	// harvested item always reuses (and mutates) the first entry the user sees, even
	// if the stored doc somehow has duplicate keys.
	const entries: LocalizationEntry[] = [];
	const byKey = new Map<string, LocalizationEntry>();
	for (const entry of doc.entries) {
		const copy = { ...entry };
		entries.push(copy);
		if (!byKey.has(copy.key)) byKey.set(copy.key, copy);
	}

	const display: DisplaySection[] = [];
	for (const section of sections) {
		const keys: string[] = [];
		for (const item of section.items) {
			let entry = byKey.get(item.key);
			if (entry) {
				// The editor owns the source text; refresh it and tag the origin.
				entry.source = item.source;
				entry.origin = 'editor';
			} else {
				entry = {
					id: newId(),
					key: item.key,
					source: item.source,
					translations: {},
					origin: 'editor',
				};
				byKey.set(entry.key, entry);
				entries.push(entry);
			}
			if (!keys.includes(item.key)) keys.push(item.key);
		}
		display.push({ sceneId: section.sceneId, sceneName: section.sceneName, keys });
	}

	return { entries, display };
}
