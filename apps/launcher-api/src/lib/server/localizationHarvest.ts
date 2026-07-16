import type { ComponentDef, ComponentParam, LayoutDoc, LayoutNode, WinTextDoc } from 'engine-layout';
import { collectWinTextTemplates } from 'engine-layout';
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
	/** Which tool owns these sources — stamped onto every entry the section reconciles.
	 *  Defaults to `'editor'` (the original, and only, collector). */
	origin?: 'editor' | 'winText';
}

/** Display grouping handed to the page: a section is a list of entry keys, in order. */
export interface DisplaySection {
	sceneId: string;
	sceneName: string;
	keys: string[];
}

/**
 * Resolves a `componentInstance`'s {@link ComponentDef} so the harvester can reach
 * the text AUTHORED INSIDE the component (most game text lives there, not on the
 * instance) — `(id, version) => def`. The page wires this to `loadComponent`
 * (project ◁ shared ◁ built-in); see `+page.server.ts`.
 */
export type ComponentDefResolver = (
	id: string,
	version?: number,
) => Promise<ComponentDef | undefined>;

/**
 * The generic unconfigured default text the built-in `textBox` / button defs ship
 * with. Harvesting it would flood the table with meaningless "Text" rows, so a
 * resolved value equal to it is dropped (a real, authored caption is never just
 * this placeholder).
 */
const GENERIC_PLACEHOLDER = 'Text';

/** A string is localizable only if it has at least one letter (skip pure numbers/symbols). */
function isLocalizableText(value: unknown): value is string {
	return typeof value === 'string' && /\p{L}/u.test(value);
}

function childrenOf(node: LayoutNode): LayoutNode[] {
	const children = (node as { children?: LayoutNode[] }).children;
	return Array.isArray(children) ? children : [];
}

/** A readable row label for a node (its author label, else its kind/component id). */
function nodeLabel(node: LayoutNode): string {
	if (typeof node.label === 'string' && node.label.trim()) return node.label.trim();
	if (node.kind === 'componentInstance') return node.componentId;
	return node.kind;
}

function paramIndex(def: ComponentDef): Map<string, ComponentParam> {
	return new Map((def.params ?? []).map((p) => [p.key, p]));
}

/** Whether a `componentInstance` binds a live engine value feed (`source` param). */
function boundToFeed(params: Record<string, unknown>): boolean {
	return typeof params.source === 'string' && params.source.trim() !== '';
}

/**
 * Harvest the localizable text AUTHORED INSIDE a component def, resolving each text
 * node's displayed string against the instance's param overrides (then the def's
 * param defaults). Skips text whose bound param is `engineProvided` (a live value
 * like "0 OF 0", not prose) or — for the `text` param — overridden by a `source`
 * feed (§18), and the generic placeholder. Static (non-bound) text nodes are taken
 * verbatim. Nested component instances inside a def aren't recursed (rare; v1).
 */
function collectDefText(
	def: ComponentDef,
	instanceParams: Record<string, unknown>,
	feed: boolean,
	label: string,
	add: (source: string, label: string) => void,
): void {
	const params = paramIndex(def);
	const walk = (node: LayoutNode): void => {
		if (node.kind === 'text') {
			const binding = node.paramBindings?.text;
			if (binding) {
				const param = params.get(binding);
				const engineFed = param?.engineProvided === true;
				const sourceOverridden = binding === 'text' && feed;
				if (!engineFed && !sourceOverridden) {
					const value = instanceParams[binding] ?? param?.default ?? node.text;
					if (typeof value === 'string') add(value, label);
				}
			} else {
				add(node.text, label);
			}
		}
		childrenOf(node).forEach(walk);
	};
	walk(def.root);
}

/**
 * Collect every localizable text component in the editor doc, grouped by scene.
 * Pulls from `kind:'text'` nodes, a `componentInstance`'s own `text`/`label` params
 * (the `label` caption is never overridden by a `source` feed, so it's always
 * taken; `text` is skipped when a feed is bound), AND the text authored INSIDE each
 * instance's component def (resolved via `resolveDef`). Scenes with no text are
 * dropped so the page only shows sections that matter.
 */
export async function harvestSceneText(
	doc: LayoutDoc,
	resolveDef: ComponentDefResolver,
): Promise<HarvestSection[]> {
	// Cache resolved defs per `id@version` — a scene re-instances the same def many
	// times (e.g. one button placed across the HUD).
	const defCache = new Map<string, ComponentDef | undefined>();
	const getDef = async (id: string, version?: number): Promise<ComponentDef | undefined> => {
		const tag = `${id}@${version ?? 'latest'}`;
		if (!defCache.has(tag)) defCache.set(tag, await resolveDef(id, version));
		return defCache.get(tag);
	};

	const out: HarvestSection[] = [];
	for (const scene of doc.scenes) {
		const items: HarvestedItem[] = [];
		const seen = new Set<string>();
		// Key on the EXACT (untrimmed) string: the in-game resolver looks the catalog
		// up by the raw `node.text` (`resolveLocalizedText` in `LayoutNodeView`), so a
		// trimmed key would never match padded text and the translation wouldn't ship.
		// Source-as-key ⇒ key === source; deduped per scene.
		const add = (source: string, label: string): void => {
			if (!isLocalizableText(source) || source === GENERIC_PLACEHOLDER || seen.has(source)) return;
			seen.add(source);
			items.push({ key: source, source, label });
		};

		const visit = async (node: LayoutNode): Promise<void> => {
			const label = nodeLabel(node);
			if (node.kind === 'text') add(node.text, label);
			if (node.kind === 'componentInstance') {
				const params = (node.params ?? {}) as Record<string, unknown>;
				const feed = boundToFeed(params);
				// `label` is a static caption (the readout's "BALANCE" above the live
				// value) — a `source` feeds the value, never the label, so always take it.
				if (typeof params.label === 'string') add(params.label, label);
				if (!feed && typeof params.text === 'string') add(params.text, label);
				const def = await getDef(node.componentId, node.componentVersion);
				if (def) collectDefText(def, params, feed, label, add);
			}
			for (const child of childrenOf(node)) await visit(child);
		};

		for (const node of scene.nodes) await visit(node);
		if (items.length > 0) out.push({ sceneId: scene.id, sceneName: scene.name || scene.id, items });
	}
	return out;
}

/** The synthetic section id the win-text templates are grouped under. Not a real scene — the
 *  page keys sections by this, and it must not collide with a scene id. */
export const WIN_TEXT_SECTION_ID = '__winText';

/**
 * Collect Invisible Win Text's authored TEMPLATES as one translatable section.
 *
 * This is what makes win copy localizable at all. The game used to compose its win strings
 * post-format ("Win $1.00 — 2 of a kind"), which is unique per amount and so could never be a
 * catalog key. A template ("{count} OF A KIND") is finite and stable, so it CAN be — and the
 * engine resolves the template through the catalog before interpolating the numbers back in.
 *
 * Source-as-key + exact/untrimmed, matching {@link harvestSceneText}. The Win Text tool owns
 * these sources, so they're read-only here (`origin: 'winText'`).
 */
export function harvestWinText(doc: WinTextDoc | undefined): HarvestSection[] {
	const items = collectWinTextTemplates(doc).filter((i) => isLocalizableText(i.source));
	if (items.length === 0) return [];
	return [
		{ sceneId: WIN_TEXT_SECTION_ID, sceneName: 'Win text', items, origin: 'winText' },
	];
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
		const origin = section.origin ?? 'editor';
		const keys: string[] = [];
		for (const item of section.items) {
			let entry = byKey.get(item.key);
			if (entry) {
				// The collecting tool owns the source text; refresh it and tag the origin.
				entry.source = item.source;
				entry.origin = origin;
			} else {
				entry = {
					id: newId(),
					key: item.key,
					source: item.source,
					translations: {},
					origin,
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
