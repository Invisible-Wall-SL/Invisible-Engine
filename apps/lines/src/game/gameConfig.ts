import {
	normalizeGameConfigDoc,
	resolveWinLevel,
	resolveWinLevelChain,
	resolveWinLevels,
	symbolsInPlay,
	validateGameConfigDoc,
	winLevelType,
	type GameConfigDoc,
	type ResolvedWinTier,
} from 'game-config';

import { bakedGameConfig } from '../editor-scenes';
import compiledConfig from './config';
import { SYMBOL_SIZE } from './constants';
import type { GameType, RawSymbol } from './types';
import { winLevelMap, type WinLevel, type WinLevelData } from './winLevelMap';

/**
 * The game config the game actually runs on — Phase 3 of `docs/design/invisible-game-config.md`.
 *
 * Resolution, and the ONLY place it is decided: `runtime → baked → compiled template`. Until this
 * module existed, `config.ts` was imported directly at module scope by `types.ts`, `constants.ts`,
 * `paytable.ts` and `infoManifest.ts`, which is why every online project shipped the same symbol
 * dictionary, the same 20 paylines and the same strips no matter what it played.
 *
 * Memoised on first read, exactly like `getActiveSymbolInfoMap()`, and for the same reason: the
 * BAKED path is a static import present at module-init, but the live RUNTIME path (Invisible Game
 * Maker) fetches asynchronously in `+layout.ts`'s `load()`, which resolves AFTER module evaluation.
 * Anything that reads a config value at import time would therefore freeze to the compiled
 * template. {@link resetGameConfigCache} drops the memo once the runtime bundle is applied
 * (`Game.svelte`) — miss that call and an online game silently runs the sample config forever,
 * which is the bug this whole tool exists to kill.
 *
 * A never-authored project resolves to `normalizeGameConfigDoc(compiledConfig)`, so it renders
 * byte-identically to before. That parity is the contract every doc in this pipeline holds to.
 */

let cached: GameConfigDoc | null = null;

/**
 * The compiled template, normalized. Kept as a lazily-built fallback rather than a module-scope
 * const so a malformed edit to `config.ts` surfaces at first use with a real message instead of
 * throwing during module evaluation, where the stack says nothing useful.
 */
function compiled(): GameConfigDoc {
	const doc = normalizeGameConfigDoc(compiledConfig);
	if (!doc) {
		throw new Error(
			'game/config.ts does not describe a game (no symbol dictionary, or no reel strips).',
		);
	}
	return doc;
}

/** The active config: the authored doc when one shipped, else the compiled template. */
export function getActiveGameConfig(): GameConfigDoc {
	if (!cached) cached = bakedGameConfig() ?? compiled();
	return cached;
}

/**
 * Drop the {@link getActiveGameConfig} memo so the next read re-resolves. Called once the live
 * runtime bundle is fetched + applied (`Game.svelte`), to discard a config memoised at import
 * time — before the async doc arrived. A no-op for the baked path (that memo was already
 * correct), preserving dev parity.
 */
export function resetGameConfigCache(): void {
	cached = null;
	warned = false;
}

/** Every symbol this game can actually deal — the gate, sourced from `packages/game-config` so
 *  there is one implementation and not a second answer here. */
export function getSymbolsInPlay(): string[] {
	return symbolsInPlay(getActiveGameConfig());
}

/** The cosmetic strips for one game type, or `[]` when the config declares no such type. Empty
 *  rather than `undefined` so a caller indexing an unknown game type gets an empty reel, not a
 *  crash mid-spin. */
export function getPaddingReels(gameType: string): Array<Array<{ name: string }>> {
	return getActiveGameConfig().paddingReels[gameType] ?? [];
}

/**
 * The cosmetic reel strips for a game type, typed for the board API. The one home for the strips
 * now that they come from the active config, NOT `constants.ts` — which stays import-light so the
 * build-time symbol-defaults publish can import it standalone (see the note there).
 *
 * The `RawSymbol[][]` assertion lives here rather than at each call site: the config's cells are
 * `{ name: string }`, the board wants `RawSymbol[][]`, and the strips only ever hold real symbol ids.
 */
export function paddingReels(gameType: GameType): RawSymbol[][] {
	return getPaddingReels(gameType) as RawSymbol[][];
}

/** Line count — the bet-per-line divisor (`total bet / numLines`). */
export function getNumLines(): number {
	return Object.keys(getActiveGameConfig().paylines).length;
}

/** Paylines as row indices per reel, in declaration order — what the info page draws. */
export function getPaylines(): number[][] {
	return Object.values(getActiveGameConfig().paylines);
}

/**
 * The authored colour (`#rrggbb`) for a payline by its 0-based DECLARATION index — the same index a
 * win reports in `meta.lineIndex`. `paylines`/`paylineColors` are both keyed by payline id, so the
 * index is mapped through `Object.keys(paylines)`. Returns `undefined` when the line isn't coloured
 * (or the config predates the field), so the caller falls back to the single Symbols-tool win-line
 * colour — an un-coloured game is byte-identical to before.
 */
export function paylineColor(lineIndex: number | undefined): string | undefined {
	if (lineIndex === undefined || lineIndex < 0) return undefined;
	const config = getActiveGameConfig();
	const id = Object.keys(config.paylines)[lineIndex];
	return id === undefined ? undefined : config.paylineColors?.[id];
}

/** Visible rows on the first reel — the info page's grid height. */
export function getNumRows(): number {
	return getActiveGameConfig().numRows[0] ?? 3;
}

/**
 * The board's grid COUNT — `{ x: columns/reels, y: visible rows }` — from the active config, the
 * single source of truth that used to be the hardcoded `BOARD_DIMENSIONS` derived from
 * `INITIAL_BOARD` in `constants.ts`. Authoring `numReels`/`numRows` in Invisible Game Config now
 * resizes the board (`docs/design/invisible-game-config.md`, grid-dimensions enhancement).
 *
 * `y` is the MAX over `numRows`: the board is a rectangle wide/tall enough to hold a stepped grid,
 * and every current game is uniform so this equals `numRows[0]`. The whole board — geometry, mask,
 * win lines, initial fill — sizes off this. Like every config read it must be a FUNCTION, not a
 * const: the live online config resolves after module init (see the header), so a const would
 * freeze to the compiled template.
 */
export function boardDimensions(): { x: number; y: number } {
	const config = getActiveGameConfig();
	return { x: config.numReels, y: Math.max(...config.numRows, 1) };
}

/** The board's PIXEL footprint (gap-less) — `SYMBOL_SIZE × the grid count`. The old
 *  `BOARD_SIZES` const, now config-driven. */
export function boardSizes(): { width: number; height: number } {
	const { x, y } = boardDimensions();
	return { width: SYMBOL_SIZE * x, height: SYMBOL_SIZE * y };
}

/**
 * The static board shown BEFORE the first spin — one column per reel, each `rows + 2` cells (the
 * ±1 padding the reel animation buffers above/below the visible window). It replaces the hand-
 * curated `INITIAL_BOARD` literal, seeding each column from the top of that reel's basegame strip
 * so the pre-spin display uses the game's OWN in-play symbols instead of the sample's.
 *
 * The strip is cycled when shorter than the window (a short authored strip still fills the column),
 * and a game type with no strips falls back to the first dictionary symbol so the board is never
 * empty — a blank initial cell renders as nothing, the failure `warnOnGameConfigIssues` guards.
 */
export function initialBoard(): RawSymbol[][] {
	const { x, y } = boardDimensions();
	const strips = paddingReels('basegame');
	const fallback = Object.keys(getActiveGameConfig().symbols)[0] ?? 'H1';
	const cells = y + 2;
	return Array.from({ length: x }, (_unused, reel) => {
		const strip = strips[reel] ?? [];
		return Array.from({ length: cells }, (_c, i) =>
			strip.length ? strip[i % strip.length] : { name: fallback },
		);
	});
}

// ---------------------------------------------------------------------------
// Win tiers (big-win levels) — config-authored `winLevels`, or the coded `winLevelMap` fallback.
//
// The contract the rest of the game speaks is unchanged: a `winLevel` NUMBER on the book event,
// looked up to a `WinLevelData`. When a project authors `winLevels`, that lookup table + the tier
// thresholds come from the config instead of the coded table; when it does NOT, every accessor
// returns the coded value verbatim, so an un-authored game is byte-identical.
// ---------------------------------------------------------------------------

/** The resolved authored tiers, or `undefined` when the project keeps the coded `winLevelMap`. */
export function activeWinLevels(): ResolvedWinTier[] | undefined {
	return resolveWinLevels(getActiveGameConfig());
}

/** Map one authored tier into the engine's `WinLevelData` shape. The coded table's fields map 1:1:
 *  `name`→`text`, `durationMs`→`presentDuration`, `sound`/`animation`/`spineKey` pass through. */
function tierToWinLevelData(tier: ResolvedWinTier): WinLevelData {
	return {
		level: tier.level,
		alias: tier.alias,
		type: tier.type,
		text: tier.name || null,
		presentDuration: tier.durationMs ?? 0,
		sound: { sfx: tier.sound?.sfx, bgm: tier.sound?.bgm },
		animation: tier.animation,
		spineKey: tier.spineKey,
	};
}

// ---------------------------------------------------------------------------
// Win presentation overlay — per-tier DURATION + SOUND authored on the `win` componentInstance.
//
// The `win` component owns per-tier presentation (spine / intro-idle-outro / duration / sfx-bgm),
// keyed by tier ALIAS (`docs/tools/component-editor.md`). The ANIMATION + SPINE are consumed INSIDE
// the win component tree (`WinVisual` reads its live params); DURATION + SOUND are consumed OUTSIDE
// it (`WinGate` reads `presentDuration`; `winLevelSoundsPlay` reads `sound`), so those two are bridged
// here — the game publishes the win instance's params at boot ({@link publishWinPresentation}, from
// the baked/runtime doc) and this overlay lets them override the config/coded tier fallback. Empty
// (no `win` instance, or dev with no baked doc) ⇒ every field falls through to the config/coded value,
// byte-identical to before.
// ---------------------------------------------------------------------------

let winPresentation: Record<string, unknown> = {};

/**
 * Publish the `win` componentInstance's authored params (its `node.params`) so the per-tier DURATION +
 * SOUND overrides reach `activeWinLevelData`. Called at boot after {@link resetGameConfigCache}
 * (`Game.svelte`), from {@link bakedWinPresentationParams}. Undefined ⇒ cleared (fall back to config/
 * coded), so an un-authored / coded-`Win`-bind game is byte-identical.
 */
export function publishWinPresentation(params: Record<string, unknown> | undefined): void {
	winPresentation = params ?? {};
}

function presentationString(key: string): string | undefined {
	const v = winPresentation[key];
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function presentationNumber(key: string): number | undefined {
	const v = winPresentation[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Overlay the win instance's per-tier DURATION + SOUND onto a resolved tier, keyed by its alias. The
 * per-tier value (`<alias>Duration`/`<alias>Sfx`/`<alias>Bgm`) wins; otherwise the config/coded value
 * is kept. Animation + spine are NOT overlaid here — `WinVisual` resolves those from its live params.
 */
function withWinPresentation(data: WinLevelData): WinLevelData {
	const alias = data.alias;
	const duration = presentationNumber(`${alias}Duration`);
	const sfx = presentationString(`${alias}Sfx`);
	const bgm = presentationString(`${alias}Bgm`);
	if (duration === undefined && sfx === undefined && bgm === undefined) return data;
	return {
		...data,
		presentDuration: duration ?? data.presentDuration,
		sound: { sfx: sfx ?? data.sound.sfx, bgm: bgm ?? data.sound.bgm },
	};
}

/**
 * The `WinLevelData` for a book event's `winLevel` NUMBER — from the authored tiers when present,
 * else the coded `winLevelMap`. The ONE lookup every win consumer now routes through
 * (`bookEventHandlerMap`, `flowEffects`, `unskippablePresentation`), replacing the direct
 * `winLevelMap[winLevel as WinLevel]` so an authored config's tiers drive the presentation.
 */
export function activeWinLevelData(level: number): WinLevelData | undefined {
	const tiers = activeWinLevels();
	if (tiers) {
		const tier = tiers.find((t) => t.level === level);
		return tier ? withWinPresentation(tierToWinLevelData(tier)) : undefined;
	}
	const coded = winLevelMap[level as WinLevel];
	return coded ? withWinPresentation(coded) : undefined;
}

/** Look a tier up by its alias — the authored tiers when present, else the coded table. Used by the
 *  free-spin alias path (`getWinLevelDataByWinLevelAlias`). */
export function activeWinLevelByAlias(alias: string): WinLevelData | undefined {
	const tiers = activeWinLevels();
	if (tiers) {
		const tier = tiers.find((t) => t.alias === alias);
		return tier ? withWinPresentation(tierToWinLevelData(tier)) : undefined;
	}
	const coded = Object.values(winLevelMap).find((data) => data.alias === alias);
	return coded ? withWinPresentation(coded) : undefined;
}

/** Whether a `winLevel` NUMBER is a big-win tier — authored `type === 'big'`, else the coded table's
 *  `type`. The big-win GATE, so a 3-tier config triggers big-win on its own big tier, not a magic 6. */
export function activeWinLevelIsBig(level: number): boolean {
	const type = winLevelType(getActiveGameConfig(), level);
	if (type !== undefined) return type === 'big';
	return winLevelMap[level as WinLevel]?.type === 'big';
}

/**
 * The BIG-win tier thresholds (win-as-bet-multiplier), ascending — the authored tiers' big thresholds
 * when a project authors `winLevels`, else the coded `winLevelMap`'s. The reel-anticipation arming
 * policy gates on these: it arms once the reachable win clears the smallest big threshold and stacks
 * a level per further big threshold crossed (`docs/design/reel-anticipation.md`). Empty when no big
 * tier exists (anticipation then never arms on the win axis).
 */
export function activeBigTierThresholds(): number[] {
	const tiers = activeWinLevels();
	const thresholds = tiers
		? tiers.filter((tier) => tier.type === 'big').map((tier) => tier.threshold)
		: Object.values(winLevelMap)
				.filter((tier) => tier.type === 'big')
				.map((tier) => tier.threshold);
	return thresholds.slice().sort((a, b) => a - b);
}

/** The escalation chain (as `WinLevelData`) for a winning `level`, or `undefined` when escalation is
 *  off / un-authored — the big-win component plays only the single winning tier in that case. */
export function activeWinLevelChain(level: number): WinLevelData[] | undefined {
	const chain = resolveWinLevelChain(getActiveGameConfig(), level);
	return chain?.map((tier) => withWinPresentation(tierToWinLevelData(tier)));
}

/** The threshold-ladder level for a win as a bet-multiplier, or `undefined` when un-authored (the
 *  facade then uses its coded ladder). Not read in-engine — exposed for parity/testing. */
export function activeWinLevel(betMultiplier: number): number | undefined {
	return resolveWinLevel(getActiveGameConfig(), betMultiplier);
}

/**
 * Publish the resolved tiers (level + threshold + type only) to a global the RGS FACADE reads
 * (`packages/rgs-translator-eagaming/stakeFacade.ts`). The facade is a drop-in for `rgs-requests` and
 * cannot import this app, so a global is the decoupled bridge: it lets the facade emit a `winLevel`
 * from the AUTHORED ladder and gate big-win on the authored `type`, instead of its hardcoded ladder.
 * Cleared (set to the un-authored signal) when the project authors no tiers, so the facade falls back
 * byte-identically. Called at boot after {@link resetGameConfigCache} (`Game.svelte`).
 */
export function publishWinLevelsToFacade(): void {
	const tiers = activeWinLevels();
	(globalThis as { __IE_WIN_LEVELS__?: unknown }).__IE_WIN_LEVELS__ = tiers
		? tiers.map((tier) => ({ level: tier.level, threshold: tier.threshold, type: tier.type }))
		: undefined;
}

let warned = false;

/**
 * Report anything wrong with the ACTIVE config, loudly, once.
 *
 * This replaces a guarantee that Phase 3 deliberately gave up. `SymbolName` used to be
 * `keyof typeof config.symbols` — a compile-time type — so a symbol the game could not draw was a
 * build error. An authored config is only known at runtime, so the type widened to `string` and
 * the check has to happen here instead.
 *
 * `knownArt` is the caller's symbol→art map (`getActiveSymbolInfoMap()`), passed in rather than
 * imported to keep this module free of the symbol-map import cycle (`symbolMap` → `editor-scenes`
 * → here). A symbol on a strip with no art renders as nothing mid-spin, which reads as a rendering
 * bug and is the most expensive failure to diagnose — so it is an ERROR, not a warning.
 */
export function warnOnGameConfigIssues(knownArt: Record<string, unknown>): void {
	if (warned) return;
	warned = true;

	const config = getActiveGameConfig();
	for (const issue of validateGameConfigDoc(config)) {
		const line = `[game-config] ${issue.severity}: ${issue.path} — ${issue.message}`;
		if (issue.severity === 'error') console.error(line);
		else console.warn(line);
	}

	const missing = symbolsInPlay(config).filter((name) => !knownArt[name]);
	if (missing.length) {
		const one = missing.length === 1;
		console.error(
			`[game-config] error: ${missing.join(', ')} ${one ? 'is' : 'are'} dealt by the reel ` +
				`strips but ${one ? 'has' : 'have'} no entry in the symbol map, so ${one ? 'it' : 'they'} ` +
				`will render as nothing. Add ${one ? 'it' : 'them'} in the Invisible Symbols State ` +
				'Machine, or remove them from the strips.',
		);
	}
}
