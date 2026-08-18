import type {
	ComponentDef,
	ComponentParam,
	LayoutDoc,
	LayoutNode,
	WinTextDoc,
} from 'engine-layout';
import { collectUiTextStrings, collectWinTextTemplates } from 'engine-layout';
import type { FlowDoc } from 'engine-flow-v2';
import { collectTextMessages } from 'engine-flow-v2';
import type { GameConfigDoc } from 'game-config';
import { resolveBetModes } from 'game-config';
import type { LocalizationDoc, LocalizationEntry } from './localization';
import type { SymbolsDoc } from './symbolsStorage';

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
	 *  Defaults to `'editor'` (the original collector). */
	origin?: 'editor' | 'winText' | 'symbols' | 'flow' | 'gameConfig' | 'uiText';
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
	return [{ sceneId: WIN_TEXT_SECTION_ID, sceneName: 'Win text', items, origin: 'winText' }];
}

/** The synthetic section id the symbol display names are grouped under (see {@link WIN_TEXT_SECTION_ID}). */
export const SYMBOL_NAMES_SECTION_ID = '__symbolNames';

/**
 * Collect the Invisible Symbols State Machine's authored DISPLAY NAMES as one translatable section
 * — so "Banana"/"Bananas" (the words a game says for `H1`) are localizable, not just the win
 * templates that interpolate them. Without this a translated info-bar line still reads "…4 Bananas"
 * in English, because the template translates but the name substituted into it does not.
 *
 * Source-as-key, but keyed on the TRIMMED name: unlike scene/win text (looked up by the exact raw
 * literal), `resolveSymbolName` trims before it calls `resolveLocalizedText` (symbolNames.ts), so a
 * padded key would never match. `normalizeSymbolsDoc` already stores trimmed names; we trim again to
 * stay honest against the resolver's contract. Only AUTHORED names are emitted — an unnamed symbol
 * resolves to its bare id (`H1`), which must never become a translatable row. Numeric-only names
 * ("7") are dropped by {@link isLocalizableText} (they need no translation). Each row is labelled
 * with the symbol id + form so the same word on two symbols is still traceable.
 */
export function harvestSymbolNames(doc: SymbolsDoc | undefined): HarvestSection[] {
	const items: HarvestedItem[] = [];
	const seen = new Set<string>();
	const add = (raw: string | undefined, label: string): void => {
		const source = raw?.trim();
		if (!source || !isLocalizableText(source) || seen.has(source)) return;
		seen.add(source);
		items.push({ key: source, source, label });
	};
	for (const [symbol, entry] of Object.entries(doc?.names ?? {})) {
		add(entry?.singular, `${symbol} — singular`);
		add(entry?.plural, `${symbol} — plural`);
	}
	if (items.length === 0) return [];
	return [
		{ sceneId: SYMBOL_NAMES_SECTION_ID, sceneName: 'Symbol names', items, origin: 'symbols' },
	];
}

/** The synthetic section id the Flow message strings are grouped under (see {@link WIN_TEXT_SECTION_ID}). */
export const FLOW_MESSAGE_SECTION_ID = '__flowMessages';

/**
 * Collect the authored text of every Invisible Flow `textMessage` node as one translatable section.
 *
 * A Text Message node carries its own player-facing line ("Click spin button to start", "Good
 * luck"), and that line is BOTH the editable default AND the localization key — so it must be
 * harvestable exactly like scene text and win templates. The game renders each node's text through
 * `resolveLocalizedText`, so the source-as-key (exact/untrimmed) contract from {@link harvestSceneText}
 * applies verbatim. Flow owns these sources, so they're read-only here (`origin: 'flow'`).
 */
export function harvestFlowMessages(doc: FlowDoc | undefined): HarvestSection[] {
	const items = collectTextMessages(doc).filter((i) => isLocalizableText(i.source));
	if (items.length === 0) return [];
	return [{ sceneId: FLOW_MESSAGE_SECTION_ID, sceneName: 'Flow messages', items, origin: 'flow' }];
}

/** The synthetic section id the engine's coded UI strings are grouped under (see {@link WIN_TEXT_SECTION_ID}). */
export const UI_TEXT_SECTION_ID = '__uiText';

/**
 * Collect the ENGINE's coded UI strings — the HUD captions (`BALANCE`/`WIN`/`BET`), the menu and
 * info-page entries, the bet menu, the settings and autoplay modals, and the info page's rules copy.
 *
 * These already localize by source-as-key (every one renders through `stateI18nDerived.translate`),
 * but they were never DISCOVERABLE: `/localization` harvested only what an author had typed in a
 * tool, so the shipped chrome had no row to translate and stayed in the source language for every
 * language the code catalogs don't ship — and the code catalogs ship `en` and `zh` only. A game
 * could therefore be fully translated and still show an English `BALANCE`, `CONFIRM`, or
 * `INSUFFICIENT FUNDS…`.
 *
 * The list comes from `engine-layout`'s `UI_TEXT` registry, which is the SAME source the two
 * `i18nDerived` maps read their literals from — so it cannot drift from what the game renders.
 * Project-independent (unlike every other collector), which is exactly right: the chrome is the
 * shared runtime bundle's, so every project sees the same rows and translates them for itself.
 */
export function harvestUiText(): HarvestSection[] {
	const items = collectUiTextStrings().filter((i) => isLocalizableText(i.source));
	if (items.length === 0) return [];
	return [{ sceneId: UI_TEXT_SECTION_ID, sceneName: 'Game UI', items, origin: 'uiText' }];
}

/** The synthetic section id the bet-mode copy is grouped under (see {@link WIN_TEXT_SECTION_ID}). */
export const BET_MODE_SECTION_ID = '__betModes';

/**
 * Collect Invisible Game Config's BET-MODE COPY as one translatable section — the title,
 * description and button label on each buy-feature card, the confirm dialog's body, and the HUD
 * badge a mode shows while it is the active stake.
 *
 * This copy lives in `/config` (`betModePresentation[mode].text`), not in a scene: the card is ONE
 * `featureCard` component whose text nodes bind `engineProvided` params, and the repeater feeds a
 * different string per mode at RUNTIME. So the scene walk in {@link harvestSceneText} can never see
 * it (it deliberately skips `engineProvided` binds — they carry live values, not prose), and the
 * strings stayed English in every locale no matter how complete the catalog was.
 *
 * Harvested from {@link resolveBetModes}, i.e. the RESOLVED copy the game actually renders — so the
 * derived defaults a config never overrides (`BUY` / `PLAY` / `ACTIVATE`, and a title falling back to
 * the mode key) are translatable too, matching how the win-text toast defaults harvest.
 *
 * Source-as-key, exact/untrimmed like scene text: the card's text nodes go through
 * `resolveLocalizedText` (`LayoutNodeView`) and the dialog/badge through `stateI18nDerived.translate`,
 * and neither trims. Only the `base` mode's `betAmountLabel` is taken — its title/description/button
 * have no surface (the buy menu lists non-default modes only), so harvesting them would add rows for
 * text no player ever sees.
 */
export function harvestBetModeText(doc: GameConfigDoc | null | undefined): HarvestSection[] {
	if (!doc) return [];
	const items: HarvestedItem[] = [];
	const seen = new Set<string>();
	const add = (source: string, label: string): void => {
		if (!isLocalizableText(source) || seen.has(source)) return;
		seen.add(source);
		items.push({ key: source, source, label });
	};
	for (const mode of resolveBetModes(doc)) {
		// The bet readout's badge applies to whichever mode is active, base included.
		add(mode.betAmountLabel, `${mode.mode} — bet label`);
		if (mode.kind === 'base') continue;
		add(mode.title, `${mode.mode} — title`);
		add(mode.description, `${mode.mode} — description`);
		add(mode.button, `${mode.mode} — button`);
		add(mode.dialog, `${mode.mode} — confirm dialog`);
	}
	if (items.length === 0) return [];
	return [{ sceneId: BET_MODE_SECTION_ID, sceneName: 'Bet modes', items, origin: 'gameConfig' }];
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
