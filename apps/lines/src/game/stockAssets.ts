import {
	FREE_SPIN_INTRO_PRESENTATION_ID,
	FREE_SPIN_OUTRO_PRESENTATION_ID,
	SYMBOL_STATES,
	TRANSITION_WIPE_COMPONENT_ID,
	WIN_PRESENTATION_COMPONENT_ID,
	forwardInstanceParams,
	forwardedParams,
	hasAuthoredBackground,
	hasAuthoredBoardGlow,
	partStandIn,
	resolveComponentParams,
	resolveLayoutInstanceParams,
	type ComponentDef,
	type ComponentInstanceNode,
	type LayoutDoc,
	type LayoutNode,
	type LayoutType,
	type Scene,
} from 'engine-layout';
import { createSymbolMap } from 'engine-game/src/game/symbolMap';
import { resolveSymbolState } from 'engine-game/src/game/symbolCell';
import type { SymbolInfoMap } from 'engine-game/src/game/types';
import { symbolsUsed, type GameConfigDoc } from 'game-config';

import { SYMBOL_INFO_MAP } from './constants';
import { modeScreenFor } from './respinModes';
import {
	basegameOverlaysSceneOf,
	basegameSceneOf,
	buyConfirmSceneOf,
	buyFeatureSceneOf,
	freeSpinCounterSceneOf,
	specialBookSceneOf,
	winVisualSceneOf,
} from './sceneSelection';
import {
	ALWAYS_KEPT,
	KEPT_TOGETHER,
	PART_NEEDS,
	STOCK_KEYS,
	STOCK_NAMES,
	SYMBOL_RIG_KEYS,
	nameMatches,
	type StockKey,
} from './stockAssetRules';

/**
 * WHICH STOCK ASSETS A PROJECT CAN EVER DRAW.
 *
 * The shared runtime registers the upstream sample game's art and audio (`assets.ts`) for every
 * game, and the loader downloads every registered key. A project that authored its own art paid
 * for all of it: 14.8 MB of the Borut remake's 71 MB boot, most of it never drawn. This decides,
 * from the data the game holds before the loader starts, which stock keys are reachable; the rest
 * are taken off the asset table (`stockAssetBoot.ts`).
 *
 * It is a reachability walk, and every doubt resolves to KEEP:
 * - no layout doc at boot (dev, live-doc) ⇒ every key;
 * - a registered coded part with no rule in `PART_NEEDS`, an unreadable def or node, or any
 *   throw ⇒ every key;
 * - a name is collected wherever it appears in authored data (bar a few fields that are never
 *   asset keys), so over-collecting only ever keeps something.
 *
 * A key is kept when one of these fires:
 * - REFERENCE: a collected name looks it up (`STOCK_NAMES`) — from the mounted scenes and every
 *   def they expand (with each instance's EFFECTIVE params: `resolveComponentParams`, counting a
 *   param only where the def consumes it), the symbols doc, effects, rig FX, the flow docs, the
 *   cinematics, the win text, and the game config (minus the names that are symbol ids there);
 * - PART: a bound coded part it mounts would fall back to it ({@link PART_NEEDS});
 * - MOUNT: a coded mount the game always makes would fall back to it ({@link codedMountNeeds});
 * - SYMBOLS: a symbol the game can show resolves to a coded cell naming it, through the renderer's
 *   own merge and state inheritance;
 * - FLAGS: an authored-overlay flag swaps in a built-in that names it ({@link AUTHORED_OVERLAY_DEFS});
 * - ALWAYS: it is in `ALWAYS_KEPT`.
 */

type Params = Record<string, unknown>;

/** The authored data a boot holds before the loader starts — `editor-scenes.ts` `bootStockAssetData`. */
export type StockAssetData = {
	/** The layout the game mounts, after `normalizeHudScenes` — what `loadEditorScenes` resolves. */
	doc: LayoutDoc;
	/** The symbols doc (Invisible Symbols): `map`, `highlight`, `boardGlow`, `anticipation`, … */
	symbols?: StockSymbolsDoc;
	effects?: readonly StockEffect[];
	rigFx?: Record<string, readonly { effectId?: string }[]>;
	/** Every other authored doc the game renders from (flow, flow v2 and its library, cinematics,
	 *  win text, flipbooks, …) — read for names only. */
	other?: readonly unknown[];
};

export type StockSymbolsDoc = {
	map?: SymbolInfoMap;
	highlight?: { assetKey?: string };
	boardGlow?: { assetKey?: string };
	anticipation?: { spineKey?: string };
	[key: string]: unknown;
};

type StockEffect = {
	id?: string;
	layers?: readonly { placement?: { space?: string; bone?: string } }[];
};

export type StockAssetsInput = {
	/** `undefined` when this boot has no layout doc yet — every key is kept. */
	data: StockAssetData | undefined;
	/** The reference layout the game falls back to (`fallbackLayout.ts`). */
	fallbackDoc: LayoutDoc;
	/** The def an instance renders (`resolveComponent`, with the built-ins registered later). */
	resolveDef: (id: string, version?: number) => ComponentDef | undefined;
	/** The project's per-component param defaults (`getComponentDefaults`). */
	componentDefaults: (id: string) => Record<string, unknown> | undefined;
	/** Whether a `bind` name resolves to a registered coded part (`getBoundComponent`). */
	isBoundPart: (name: string) => boolean;
	/** The active game config (`getActiveGameConfig`). */
	config: GameConfigDoc;
	/** The symbols the board deals, server-declared when the RGS is authoritative (`getSymbolsInPlay`). */
	symbolsInPlay: readonly string[];
};

export type StockAssetsAnalysis = {
	needed: Set<StockKey>;
	/** Set when the walk could not decide and kept every key. */
	keptAllBecause?: string;
	/** For each kept key, where the names that reached it came from (`scene basegame`, `part Win`,
	 *  `symbol W.static`, …). Empty when every key was kept. */
	reasons: Partial<Record<StockKey, string[]>>;
};

/** Every collected name and where it came from. */
type Names = Map<string, Set<string>>;

const addName = (names: Names, name: string, origin: string): void => {
	const origins = names.get(name);
	if (origins) origins.add(origin);
	else names.set(name, new Set([origin]));
};

class KeepAll extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The built-ins each `settings.authoredOverlays` flag swaps in for coded parts
 * (`authoredOverlays.ts`). On ⇒ each is walked as a placed instance. The authored Win also reads
 * its tier clips off the loaded `bigwin` skeleton (`Game.svelte` `registerAuthoredWinTimelines`),
 * which `winPresentation` names.
 */
export const AUTHORED_OVERLAY_DEFS: Record<'transition' | 'win' | 'freeSpins', readonly string[]> =
	{
		transition: [TRANSITION_WIPE_COMPONENT_ID],
		win: [WIN_PRESENTATION_COMPONENT_ID],
		freeSpins: [FREE_SPIN_INTRO_PRESENTATION_ID, FREE_SPIN_OUTRO_PRESENTATION_ID],
	};

/**
 * The stock names the coded mounts `Game.svelte` always makes fall back to.
 * - `Background` (`Game.svelte` `{#if !suppressCodedBackground}`, `Background.svelte:95-128`) unless
 *   a background scene carries authored content.
 * - The foreground rig hosts every bone-placed effect not bound to a rig (`Effects.svelte:41-63,118-123`).
 * - `BoardFrame` (`{#if !suppressCodedBoardGlow}`, `BoardFrame.svelte:20-21`): the authored glow rig
 *   ?? `reelhouse`, unless the `boardGlow` scene carries authored content.
 * - Every winning cell's frame (`Symbol.svelte` `showWinFrame`, `SymbolWinFrame.svelte:30-32`): the
 *   authored highlight ?? `anticipation`.
 * - The reel anticipation overlay (`Anticipations.svelte:95-96`, `anticipationPresentation.ts:141-142`):
 *   the authored `spineKey` || `anticipation`.
 */
function codedMountNeeds(data: StockAssetData): string[] {
	const out: string[] = [];
	const { doc, symbols, effects = [], rigFx = {} } = data;
	if (!hasAuthoredBackground(doc.scenes)) {
		out.push('foregroundAnimation', 'foregroundFeatureAnimation');
	}
	const rigBound = new Set(
		Object.values(rigFx).flatMap((binds) => (binds ?? []).map((bind) => bind?.effectId)),
	);
	const bonePlaced = effects.some(
		(effect) =>
			!rigBound.has(effect.id) &&
			(effect.layers ?? []).some(
				(layer) => layer?.placement?.space === 'bone' && !!layer.placement.bone,
			),
	);
	if (bonePlaced) out.push('foregroundAnimation');
	if (!hasAuthoredBoardGlow(doc.scenes)) out.push(symbols?.boardGlow?.assetKey ?? 'reelhouse');
	out.push(symbols?.highlight?.assetKey ?? 'anticipation');
	out.push(symbols?.anticipation?.spineKey || 'anticipation');
	return out;
}

/**
 * Fields whose string values are never asset keys (ids, labels, text, value feeds, signals,
 * animation names, param names). Skipping them is what stops an animation set called
 * `anticipation` or a feed called `freeSpins` from reading as a reference; anything else counts.
 * Only their STRINGS are skipped: an object under one is walked, because it can hold a real
 * reference — `symbols.winLine.text.font: 'purple'` is the win amount's bitmap font, and skipping
 * the whole `text` object dropped that font from the games that draw with it.
 */
const NON_ASSET_FIELDS = new Set([
	'id',
	'label',
	'text',
	'options',
	'source',
	'visibleSource',
	'signal',
	'completeSignal',
	'hiddenUntilSignal',
	'playOn',
	'animation',
	'animations',
	'animationName',
	'animationSet',
	'defaultAnimation',
	'paramBindings',
	'singular',
	'plural',
]);

/** Deeper than any authored data nests; a walk this deep is not data, so keep everything. */
const MAX_DATA_DEPTH = 64;
/** More nodes than any layout expands to (defs inside defs included); past it, keep everything. */
const MAX_WALKED_NODES = 100_000;

function collectNames(
	value: unknown,
	into: Names,
	origin: string,
	depth = 0,
	stringsAreNames = true,
): void {
	if (depth > MAX_DATA_DEPTH) throw new KeepAll('authored data nests deeper than any doc does');
	if (typeof value === 'string') {
		if (stringsAreNames) addName(into, value, origin);
	} else if (Array.isArray(value)) {
		for (const item of value) collectNames(item, into, origin, depth + 1, stringsAreNames);
	} else if (isRecord(value)) {
		for (const [key, item] of Object.entries(value)) {
			collectNames(item, into, origin, depth + 1, !NON_ASSET_FIELDS.has(key));
		}
	}
}

/** Every string anywhere in `value`, field names ignored — what a def can consume a param by. */
function collectAllStrings(value: unknown, into: Set<string>, depth = 0): void {
	if (depth > MAX_DATA_DEPTH) throw new KeepAll('a component def nests deeper than any def does');
	if (typeof value === 'string') into.add(value);
	else if (Array.isArray(value)) for (const item of value) collectAllStrings(item, into, depth + 1);
	else if (isRecord(value)) {
		for (const item of Object.values(value)) collectAllStrings(item, into, depth + 1);
	}
}

const RIG_BUNDLE_PATH = /(?:^|\/)spines\/(.+?)\/?$/;
const BUILTIN_PREFIX = 'builtin:';

/**
 * The stock keys `value` looks up: as written; as the region of an atlas-scoped `<sheet>::<frame>`
 * ref (the lookup falls back to the bare frame); as the bundle of an R2 rig prefix
 * (`RigProvider.svelte` resolves `…/spines/<bundle>/` to `<bundle>`); or as a `builtin:` sheet/rig.
 */
export function stockKeysNamedBy(value: string): StockKey[] {
	const forms = new Set([value]);
	const scope = value.lastIndexOf('::');
	if (scope >= 0) forms.add(value.slice(scope + 2));
	const bundle = RIG_BUNDLE_PATH.exec(value)?.[1];
	if (bundle) forms.add(bundle);
	return STOCK_KEYS.filter(
		(key) =>
			value === `${BUILTIN_PREFIX}${key}` ||
			STOCK_NAMES[key].some((name) => [...forms].some((form) => nameMatches(name, form))),
	);
}

const isWellFormedDef = (def: unknown): def is ComponentDef =>
	isRecord(def) &&
	isRecord(def.root) &&
	(def.params === undefined || Array.isArray(def.params)) &&
	(def.root.children === undefined || Array.isArray(def.root.children));

const hasBind = (node: unknown): boolean =>
	isRecord(node) &&
	(isRecord(node.bind) ||
		(Array.isArray(node.children) && node.children.some((child) => hasBind(child))));

/**
 * The params a def CONSUMES: all of them when it binds a coded part (the part reads any param
 * through `getComponentParams`), else every key its nodes bind (`paramBindings`, `params.*` forwards
 * included) or that the def names anywhere outside its param list (a state-machine `{key}` source,
 * a signal scope, …). A default nobody consumes never reaches the screen.
 */
function consumedParams(def: ComponentDef): 'all' | ((key: string) => boolean) {
	if (hasBind(def.root)) return 'all';
	const strings = new Set<string>();
	collectAllStrings({ ...def, params: undefined }, strings);
	const tokens = new Set<string>();
	for (const text of strings) {
		for (const match of text.matchAll(/\{([^{}]+)\}/g)) tokens.add(match[1]);
	}
	return (key) => strings.has(key) || tokens.has(key);
}

/** An instance's own params as the renderer resolves them: the base set and each layout's override
 *  set, each with the enclosing instance's forwarded params overlaid (`ComponentInstance.svelte`). */
function instanceParamSets(node: LayoutNode, enclosing: Params): (Params | undefined)[] {
	const instance = node as ComponentInstanceNode;
	const sets = [forwardInstanceParams(node, instance.params, enclosing)];
	for (const layout of Object.keys(instance.overrides ?? {})) {
		const layoutParams = resolveLayoutInstanceParams(instance, layout as LayoutType);
		if (layoutParams !== instance.params) {
			sets.push(forwardInstanceParams(node, layoutParams, enclosing));
		}
	}
	return sets;
}

/**
 * The scenes the game mounts: every scene of the doc (a flow may show any of them), with the
 * overlays scene as `Game.svelte` mounts it (`basegameOverlaysSceneOf`), plus each reference scene
 * the game falls back to for an id or role the doc lacks. The authored-win swap of the reference
 * overlays is not applied: it only removes coded parts, and the flag's own needs are walked anyway.
 */
function mountedScenes(doc: LayoutDoc, fallback: LayoutDoc): Scene[] {
	const scenes = doc.scenes;
	const modeIds = new Set(
		scenes.flatMap((scene) => (scene.role === 'mode' && scene.modeId ? [scene.modeId] : [])),
	);
	const counterIds = new Set([
		modeScreenFor(scenes, undefined, 'freeSpinCounter'),
		...[...modeIds].map((mode) => modeScreenFor(scenes, mode, 'freeSpinCounter')),
	]);
	const selected = [
		basegameSceneOf(scenes, fallback),
		winVisualSceneOf(scenes, fallback),
		...[...counterIds].map((id) => freeSpinCounterSceneOf(scenes, fallback, id)),
		specialBookSceneOf(scenes, fallback),
		buyFeatureSceneOf(scenes, fallback),
		buyConfirmSceneOf(scenes, fallback),
	];
	const out = scenes.filter((scene) => scene.id !== 'basegameOverlays');
	out.push(basegameOverlaysSceneOf(doc, fallback, false));
	for (const scene of selected) if (scene && !out.includes(scene)) out.push(scene);
	return out;
}

/** {@link analyseStockAssets}'s answer alone. */
export const stockAssetsNeeded = (input: StockAssetsInput): Set<StockKey> =>
	analyseStockAssets(input).needed;

export function analyseStockAssets(input: StockAssetsInput): StockAssetsAnalysis {
	if (!input.data) {
		return { needed: new Set(STOCK_KEYS), keptAllBecause: 'no layout doc at boot', reasons: {} };
	}
	try {
		return reachable(input, input.data);
	} catch (error) {
		return {
			needed: new Set(STOCK_KEYS),
			keptAllBecause: error instanceof KeepAll ? error.message : `the walk threw: ${error}`,
			reasons: {},
		};
	}
}

function reachable(input: StockAssetsInput, data: StockAssetData): StockAssetsAnalysis {
	const { doc, symbols } = data;
	if (!isRecord(doc) || !Array.isArray(doc.scenes))
		throw new KeepAll('the layout doc has no scenes');
	if (doc.scenes.some((scene) => !isRecord(scene) || !Array.isArray(scene.nodes))) {
		throw new KeepAll('a scene of the layout doc has no node list');
	}
	const names: Names = new Map();
	let walked = 0;

	const visitPart = (name: string, params: Params, props: Params): void => {
		const needs = PART_NEEDS[name];
		if (needs) for (const need of needs(params, props)) addName(names, need, `part ${name}`);
		else if (input.isBoundPart(name)) throw new KeepAll(`bound part '${name}' has no stock rule`);
	};

	const expandInstance = (
		node: LayoutNode,
		enclosing: Params,
		stack: readonly string[],
		itemParamsUnknown: boolean,
	): void => {
		const id = (node as { componentId?: unknown }).componentId;
		if (typeof id !== 'string' || !id || stack.includes(id)) return;
		const version = (node as { componentVersion?: unknown }).componentVersion;
		const def = input.resolveDef(id, typeof version === 'number' ? version : undefined);
		// `ComponentInstance.svelte`: an unregistered id renders nothing.
		if (def === undefined) return;
		if (!isWellFormedDef(def)) throw new KeepAll(`component '${id}' is not a readable def`);
		const consumes = consumedParams(def);
		const projectDefaults = input.componentDefaults(id);
		// A repeater's items carry params from runtime data, and a param forwarded from an enclosing
		// param that holds nothing here is filled at runtime (a live feed) — either way any of the
		// def's params may be live, so every one counts.
		const anyParamLive =
			itemParamsUnknown ||
			forwardedParams(node).some(([, parentKey]) => enclosing[parentKey] === undefined);
		for (const own of instanceParamSets(node, enclosing)) {
			const params = resolveComponentParams(def, own, projectDefaults);
			for (const [key, value] of Object.entries(params)) {
				if (anyParamLive || consumes === 'all' || consumes(key)) {
					collectNames(value, names, `component ${id}`);
				}
			}
			walkNodes([def.root], params, [...stack, id], `component ${id}`);
			const standIn = partStandIn(def);
			if (standIn) visitPart(standIn, params, {});
		}
	};

	const walkNodes = (
		nodes: unknown,
		params: Params,
		stack: readonly string[],
		origin: string,
	): void => {
		if (!Array.isArray(nodes)) throw new KeepAll('a node list is not a list');
		for (const node of nodes) {
			if (!isRecord(node)) throw new KeepAll('a node is not an object');
			walked += 1;
			if (walked > MAX_WALKED_NODES) throw new KeepAll('the layout expands past the walk budget');
			const { children, ...own } = node;
			collectNames(own, names, origin);
			const bind = node.bind;
			if (isRecord(bind) && typeof bind.component === 'string') {
				visitPart(bind.component, params, isRecord(bind.props) ? bind.props : {});
			}
			if (node.kind === 'componentInstance' || node.kind === 'repeater') {
				expandInstance(node as unknown as LayoutNode, params, stack, node.kind === 'repeater');
			}
			if (children !== undefined) walkNodes(children, params, stack, origin);
		}
	};

	for (const scene of mountedScenes(doc, input.fallbackDoc)) {
		walkNodes(scene.nodes, {}, [], `scene ${scene.id}`);
	}

	// FLAGS: each authored-overlay flag's built-ins, walked as placed instances.
	const flags = doc.settings?.authoredOverlays ?? {};
	for (const [flag, ids] of Object.entries(AUTHORED_OVERLAY_DEFS)) {
		if (!flags[flag as keyof typeof flags]) continue;
		for (const componentId of ids) {
			expandInstance({ kind: 'componentInstance', componentId } as LayoutNode, {}, [], false);
		}
	}
	// A bet mode's buy card is a def named by the config, mounted by the buy screen's repeater.
	const presentation = (input.config as { betModePresentation?: unknown }).betModePresentation;
	for (const mode of Object.values(isRecord(presentation) ? presentation : {})) {
		const card = isRecord(mode) && typeof mode.card === 'string' ? mode.card : undefined;
		if (card) {
			expandInstance({ kind: 'repeater', componentId: card } as LayoutNode, {}, [], true);
		}
	}

	collectNames(symbols, names, 'symbols doc');
	collectNames(data.effects, names, 'effects');
	collectNames(data.rigFx, names, 'rig FX');
	collectNames(data.other, names, 'authored docs');
	for (const need of codedMountNeeds(data)) addName(names, need, 'coded mount');

	// SYMBOLS: every symbol the game can show, through the renderer's own merge (`symbolMap.ts`) and
	// state resolution (`symbolCell.ts`), for every state it can be asked for.
	const merged = createSymbolMap({
		codedMap: SYMBOL_INFO_MAP as SymbolInfoMap,
		bakedMap: () => symbols?.map,
	}).getActiveSymbolInfoMap();
	// What the board can show is THE GATE (`game-config` `inPlay.ts`): the strips and the server's
	// declaration, plus the pots overlay's tokens. A dictionary entry nothing deals never draws.
	const config = input.config;
	const shown = new Set([...input.symbolsInPlay, ...symbolsUsed(config)]);
	// `engine-game` `gameConfig.ts` `initialBoard`: a board that deals nothing is padded with the
	// dictionary's first symbol, else `H1`.
	if (shown.size === 0) shown.add(Object.keys(config.symbols ?? {})[0] ?? 'H1');
	for (const name of Object.keys(SYMBOL_INFO_MAP)) if (names.has(name)) shown.add(name);
	for (const name of shown) {
		const states = merged[name];
		if (!states) continue;
		for (const state of new Set<string>([...SYMBOL_STATES, ...Object.keys(states)])) {
			const drawn = resolveSymbolState(states, state);
			if (drawn) collectNames(states[drawn], names, `symbol ${name}.${drawn}`);
		}
	}

	// The config names symbols by the same ids as the symbol rigs; the symbol rule decides those.
	const configNames: Names = new Map();
	collectNames(config, configNames, 'game config');
	for (const key of SYMBOL_RIG_KEYS) configNames.delete(key);

	const reasons: Partial<Record<StockKey, string[]>> = {};
	const keep = (key: StockKey, origins: Iterable<string>): void => {
		reasons[key] = [...new Set([...(reasons[key] ?? []), ...origins])];
	};
	for (const key of ALWAYS_KEPT) keep(key, ['always']);
	for (const [name, origins] of [...names, ...configNames]) {
		for (const key of stockKeysNamedBy(name))
			keep(
				key,
				[...origins].map((o) => `${o}: ${name}`),
			);
	}
	for (const group of KEPT_TOGETHER) {
		const by = group.find((key) => reasons[key]);
		if (by) for (const key of group) if (!reasons[key]) keep(key, [`kept with ${by}`]);
	}
	return { needed: new Set(Object.keys(reasons) as StockKey[]), reasons };
}

/**
 * The asset table without the stock keys `needed` leaves out. A key is removed only while its entry
 * is still the stock one: a project asset registered under the same name replaced it in the table
 * and stays. Compared by type and source rather than identity, because the table the game holds is
 * a `$state` proxy of these entries.
 */
export function withoutStockAssets<T extends Record<string, unknown>>(
	registered: T,
	stock: Record<string, unknown>,
	needed: ReadonlySet<string>,
): { assets: T; skipped: string[] } {
	const skipped = Object.keys(stock).filter(
		(key) => !needed.has(key) && key in registered && sameEntry(registered[key], stock[key]),
	);
	if (skipped.length === 0) return { assets: registered, skipped };
	const assets = { ...registered };
	for (const key of skipped) delete assets[key];
	return { assets, skipped };
}

const sameEntry = (a: unknown, b: unknown): boolean =>
	isRecord(a) &&
	isRecord(b) &&
	a.type === b.type &&
	JSON.stringify(a.src) === JSON.stringify(b.src);
