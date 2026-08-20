import {
	normalizeGameConfigDoc,
	resolveWinLevel,
	resolveWinLevelChain,
	resolveWinLevels,
	resolveWinModel,
	symbolsInPlay,
	validateGameConfigDoc,
	winLevelType,
	type GameConfigDoc,
	type ResolvedWinTier,
	type WinModel,
} from 'game-config';

import { SYMBOL_SIZE } from './constants';
import type { RawSymbol } from './types';
import { winLevelMap, type WinLevel, type WinLevelData } from './winLevelMap';

/**
 * The two SOURCES a game's config can come from. Phase A5 of
 * `docs/design/game-type-templates.md`.
 *
 * The resolution itself — `runtime → baked → compiled`, the memo, the win-tier ladder, the
 * board grid — is identical for every game type and lives here. What differs per game is only
 * where the two lower-priority sources come from: the app's baked bundle and its compiled
 * template. Those arrive as `deps`, which is the entire seam.
 *
 * NOTE for Phase C: `getPaylines`/`getNumLines`/`paylineColor` moved across unchanged and are
 * still LINES-shaped. They become one arm of the `winModel` discriminant when the config schema
 * is generalized — this slice deliberately did not touch them, so the relocation stays provable.
 */
export interface GameConfigDeps {
	/** The project's baked config (`bakedGameConfig()` from the app's editor bundle), or `null`. */
	bakedConfig: () => GameConfigDoc | null | undefined;
	/** The game's COMPILED template config (`./config` in the app) — the last-resort fallback that
	 *  keeps a never-authored project byte-identical. */
	compiledConfig: unknown;
}

export function createGameConfig<TGameType extends string>(deps: GameConfigDeps) {
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
	 * A never-authored project resolves to `normalizeGameConfigDoc(deps.compiledConfig)`, so it renders
	 * byte-identically to before. That parity is the contract every doc in this pipeline holds to.
	 */

	let cached: GameConfigDoc | null = null;

	/**
	 * The compiled template, normalized. Kept as a lazily-built fallback rather than a module-scope
	 * const so a malformed edit to `config.ts` surfaces at first use with a real message instead of
	 * throwing during module evaluation, where the stack says nothing useful.
	 */
	function compiled(): GameConfigDoc {
		const doc = normalizeGameConfigDoc(deps.compiledConfig);
		if (!doc) {
			throw new Error(
				'game/config.ts does not describe a game (no symbol dictionary, or no reel strips).',
			);
		}
		return doc;
	}

	/** The active config: the authored doc when one shipped, else the compiled template. */
	function getActiveGameConfig(): GameConfigDoc {
		if (!cached) cached = deps.bakedConfig() ?? compiled();
		return cached;
	}

	/**
	 * Drop the {@link getActiveGameConfig} memo so the next read re-resolves. Called once the live
	 * runtime bundle is fetched + applied (`Game.svelte`), to discard a config memoised at import
	 * time — before the async doc arrived. A no-op for the baked path (that memo was already
	 * correct), preserving dev parity.
	 */
	function resetGameConfigCache(): void {
		cached = null;
		warned = false;
	}

	// ---------------------------------------------------------------------------
	// Server-config overlay — the RGS's DECLARED boot config, server-authoritative at runtime.
	//
	// The Play4Fun facade (`packages/rgs-translator-eagaming/stakeFacade.ts`) publishes the server's
	// boot `config` event to `globalThis.__IE_SERVER_CONFIG__` (mirror of the `__IE_WIN_LEVELS__`
	// engine→facade bridge, in reverse: facade→engine, since the facade cannot import this app). When
	// it is present the RGS is the authority on the game's DERIVED display data — paylines / line count,
	// the in-play symbol GATE, the cosmetic strips and per-line colour indexing all follow the server.
	//
	// Read FRESH here on every accessor call rather than folded into the memoised `getActiveGameConfig()`
	// doc: the `config` event arrives asynchronously (during `requestAuthenticate`), which can be AFTER
	// the memo resets at boot, and these accessors run per-render / per-spin — so a live read picks the
	// config up the moment it lands, with no cache to invalidate. Undefined ⇒ no config event (a dev app
	// on plain `rgs-requests`, the real Stake RGS, or any host with no facade) ⇒ every accessor falls
	// through to the authored doc, byte-identical to before (parity).
	// ---------------------------------------------------------------------------

	type ServerGameConfig = {
		availablePayLines: number[][];
		symbols: string[];
		window?: { reels: number; rows: number };
	};

	/** The RGS-declared config, or `undefined` when no config event has been published (⇒ parity). A
	 *  config with no symbols is treated as absent — it cannot describe an in-play set or strips. */
	function serverConfig(): ServerGameConfig | undefined {
		const cfg = (globalThis as { __IE_SERVER_CONFIG__?: ServerGameConfig }).__IE_SERVER_CONFIG__;
		if (!cfg || !Array.isArray(cfg.symbols) || cfg.symbols.length === 0) return undefined;
		return cfg;
	}

	/**
	 * Auto-generate cosmetic reel strips from the server's in-play symbol set. When the RGS is
	 * authoritative there are no authored strips to cycle, and the real weighted strips never reach the
	 * client — this is ONLY the spinning blur, so a plain repeat of the in-play symbols (rotated per
	 * reel so adjacent columns differ) is all the visual needs. Length covers `initialBoard()`'s
	 * `rows + 2` window and gives the roll enough cells to look continuous.
	 */
	function serverPaddingReels(server: ServerGameConfig): Array<Array<{ name: string }>> {
		const symbols = server.symbols;
		if (symbols.length === 0) return [];
		const reels = server.window?.reels ?? server.availablePayLines[0]?.length ?? symbols.length;
		const rows = server.window?.rows ?? 3;
		const length = Math.max(rows + 2, symbols.length, 12);
		return Array.from({ length: reels }, (_unused, reel) => {
			const offset = reel % symbols.length;
			const rotated = [...symbols.slice(offset), ...symbols.slice(0, offset)];
			return Array.from({ length }, (_c, i) => ({ name: rotated[i % rotated.length] }));
		});
	}

	/** Every symbol this game can actually deal — the gate. The server's declared symbol set when the
	 *  RGS is authoritative, else `packages/game-config`'s strip-derived gate (one implementation, no
	 *  second answer). Sorted to match `symbolsInPlay`. */
	function getSymbolsInPlay(): string[] {
		const server = serverConfig();
		if (server) return [...server.symbols].sort();
		return symbolsInPlay(getActiveGameConfig());
	}

	/** The cosmetic strips for one game type, or `[]` when the config declares no such type. Empty
	 *  rather than `undefined` so a caller indexing an unknown game type gets an empty reel, not a
	 *  crash mid-spin. When the RGS is authoritative the strips are auto-generated from its in-play set
	 *  (there are no authored strips) — the same generated blur for every game type. */
	function getPaddingReels(gameType: string): Array<Array<{ name: string }>> {
		const server = serverConfig();
		if (server) return serverPaddingReels(server);
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
	function paddingReels(gameType: TGameType): RawSymbol[][] {
		return getPaddingReels(gameType) as RawSymbol[][];
	}

	/** Line count — the bet-per-line divisor (`total bet / numLines`). The server's `availablePayLines`
	 *  count when the RGS is authoritative (so displayed per-line pay values divide by the real line
	 *  count), else the authored doc's payline count. */
	function getNumLines(): number {
		const lines = serverConfig()?.availablePayLines;
		if (lines && lines.length > 0) return lines.length;
		return Object.keys(getActiveGameConfig().paylines).length;
	}

	/** Paylines as row indices per reel, in declaration order — what the info page draws. The server's
	 *  `availablePayLines` when the RGS is authoritative, else the authored doc's paylines. */
	function getPaylines(): number[][] {
		// A non-lines game has no paylines to draw. Without this the info page renders the RGS's
		// `availablePayLines` as a payline grid on a ways/cluster/scatter game — 20 diagrams for
		// lines that decide nothing. `InfoOverlay` draws nothing for an empty list, so this simply
		// removes the section. Phase D of docs/design/game-type-templates.md.
		//
		// `getNumLines()` is deliberately NOT gated with it: that number is the bet-per-line divisor
		// (`buildPayTableRows`, `createLinesReach`), and what a ways paytable should show per WAY is
		// a presentation decision, not a mechanical one. Left for whoever designs that surface.
		if (activeWinModel().type !== 'lines') return [];
		const lines = serverConfig()?.availablePayLines;
		if (lines && lines.length > 0) return lines;
		return Object.values(getActiveGameConfig().paylines);
	}

	/**
	 * The authored colour (`#rrggbb`) for a payline by its 0-based line INDEX — the same index a win
	 * reports in `meta.lineIndex` (the server paylineId) and the index the info page walks `getPaylines`
	 * by. The authored colours are keyed by payline id; both the authored `paylines` and the server's
	 * `availablePayLines` describe the SAME lines in the SAME order, so the ordinal index maps cleanly
	 * to the authored id at that position — `Object.keys(paylines)[index]` — whether the lines came from
	 * the server or the doc. Returns `undefined` when the line isn't coloured (or the config predates the
	 * field), so the caller falls back to the single Symbols-tool win-line colour — an un-coloured game
	 * is byte-identical to before.
	 */
	function paylineColor(lineIndex: number | undefined): string | undefined {
		if (lineIndex === undefined || lineIndex < 0) return undefined;
		const config = getActiveGameConfig();
		// A non-lines game has no paylines, so `meta.lineIndex` is not a payline id and the ordinal
		// mapping below would colour a win from an unrelated line's swatch. Gated HERE rather than at
		// the two call sites (`winLineColorFor`, the info page's `paylineColors`) so the rule has one
		// home — Phase D of docs/design/game-type-templates.md.
		if (activeWinModel().type !== 'lines') return undefined;
		const id = Object.keys(config.paylines)[lineIndex];
		return id === undefined ? undefined : config.paylineColors?.[id];
	}

	/**
	 * HOW this project decides a win, resolved from the active config (Phase C/D of
	 * `docs/design/game-type-templates.md`). `lines` for every config that predates the field, so
	 * every existing game is unchanged.
	 *
	 * This is the runtime's read of the win model. It does NOT yet select a different win
	 * EVALUATION — the engine still presents whatever the RGS reports — but it is what lets the
	 * payline-specific surfaces stand down, and what `warnOnGameConfigIssues` uses to say plainly
	 * that a declared `ways`/`cluster`/`scatter` model is not being honoured yet.
	 */
	function activeWinModel(): WinModel {
		return resolveWinModel(getActiveGameConfig());
	}

	/**
	 * How many WAYS the grid pays — the product of each reel's visible rows (a 5×3 board pays
	 * 3⁵ = 243). The ways analogue of the line count: buying a spin buys every way, so the
	 * per-way stake is `totalBet / waysCount` exactly as the per-line stake is `totalBet / numLines`.
	 *
	 * Read from the config's own `numRows` (one entry per reel), so a stepped or resized grid is
	 * counted correctly rather than assumed to be uniform.
	 */
	function activeWaysCount(): number {
		const rows = getActiveGameConfig().numRows;
		if (!rows.length) return 1;
		return rows.reduce((product, r) => product * Math.max(1, Math.floor(r)), 1);
	}

	/**
	 * The stake a paytable multiplier is quoted against, as a divisor of the total bet.
	 *
	 * `buildPayTableRows` computes `base = totalBet / divisor` for every non-scatter entry, so this
	 * is what makes the info page price a payout correctly for the game's win model:
	 *
	 *   - `lines`   → the line count. A multiplier pays per LINE.
	 *   - `ways`    → the ways count. A multiplier pays per WAY, and a spin buys all of them.
	 *   - `cluster` / `scatter` → 1. Those models have no per-line/per-way subdivision; a multiplier
	 *     applies to the whole bet, which is already how `mode: 'scatter'` entries are priced.
	 *
	 * Named for what it IS rather than `numLines`, because the number stopped being a line count the
	 * moment a game could pay by ways. It is only ever a divisor — nothing renders it as a label.
	 */
	function payoutDivisor(): number {
		switch (activeWinModel().type) {
			case 'ways':
				return activeWaysCount();
			case 'cluster':
			case 'scatter':
				return 1;
			default:
				return getNumLines();
		}
	}

	/** Visible rows on the first reel — the info page's grid height. */
	function getNumRows(): number {
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
	function boardDimensions(): { x: number; y: number } {
		const config = getActiveGameConfig();
		return { x: config.numReels, y: Math.max(...config.numRows, 1) };
	}

	/** The board's PIXEL footprint (gap-less) — `SYMBOL_SIZE × the grid count`. The old
	 *  `BOARD_SIZES` const, now config-driven. */
	function boardSizes(): { width: number; height: number } {
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
	function initialBoard(): RawSymbol[][] {
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
	function activeWinLevels(): ResolvedWinTier[] | undefined {
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
	function publishWinPresentation(params: Record<string, unknown> | undefined): void {
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
	function activeWinLevelData(level: number): WinLevelData | undefined {
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
	function activeWinLevelByAlias(alias: string): WinLevelData | undefined {
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
	function activeWinLevelIsBig(level: number): boolean {
		const type = winLevelType(getActiveGameConfig(), level);
		if (type !== undefined) return type === 'big';
		return winLevelMap[level as WinLevel]?.type === 'big';
	}

	/**
	 * The BIG-win tiers, ascending by threshold — the authored `winLevels` big tiers when a project
	 * authors its config, else the coded `winLevelMap`'s big rows. Each carries the tier's `alias` (the
	 * key the reel-anticipation FX is authored under and the arming stamps on a reel), its player-facing
	 * `name`, and its `threshold` (win-as-bet-multiplier). This is the SINGLE generic source the whole
	 * anticipation feature mirrors: the arming stacks a level per big tier the reachable win crosses and
	 * tags the reel with the reached tier's alias; the FX ramp + the `/symbols` panel key off the same
	 * list, so the tiers grow/shrink with the config rather than a fixed big/mega/massive triple. Empty
	 * when no big tier exists (anticipation then never arms on the win axis).
	 */
	function activeBigTiers(): { alias: string; name: string; threshold: number }[] {
		const tiers = activeWinLevels();
		const big = tiers
			? tiers
					.filter((tier) => tier.type === 'big')
					.map((tier) => ({
						alias: tier.alias,
						name: tier.name || tier.alias,
						threshold: tier.threshold,
					}))
			: Object.values(winLevelMap)
					.filter((tier) => tier.type === 'big')
					.map((tier) => ({
						alias: tier.alias,
						name: tier.text || tier.alias,
						threshold: tier.threshold,
					}));
		return big.slice().sort((a, b) => a.threshold - b.threshold);
	}

	/**
	 * The BIG-win tier thresholds (win-as-bet-multiplier), ascending — derived from {@link activeBigTiers}
	 * so the two never disagree. The reel-anticipation arming policy gates on these: it arms once the
	 * reachable win clears the smallest big threshold and stacks a level per further big threshold crossed
	 * (`docs/design/reel-anticipation.md`).
	 */
	function activeBigTierThresholds(): number[] {
		return activeBigTiers().map((tier) => tier.threshold);
	}

	/** The escalation chain (as `WinLevelData`) for a winning `level`, or `undefined` when escalation is
	 *  off / un-authored — the big-win component plays only the single winning tier in that case. */
	function activeWinLevelChain(level: number): WinLevelData[] | undefined {
		const chain = resolveWinLevelChain(getActiveGameConfig(), level);
		return chain?.map((tier) => withWinPresentation(tierToWinLevelData(tier)));
	}

	/** The threshold-ladder level for a win as a bet-multiplier, or `undefined` when un-authored (the
	 *  facade then uses its coded ladder). Not read in-engine — exposed for parity/testing. */
	function activeWinLevel(betMultiplier: number): number | undefined {
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
	function publishWinLevelsToFacade(): void {
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
	function warnOnGameConfigIssues(knownArt: Record<string, unknown>): void {
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

		// A project can DECLARE any win model in `/config` (Phase C), but the shared runtime only
		// HONOURS some of them. `ways` is honoured throughout: the paytable prices per way, the win
		// line draws merged per-reel bars, and reel anticipation runs the ways reach. `cluster` and
		// `scatter` are still declaration-only — every client surface that reads the model falls back
		// to line behaviour for them. Say so at boot rather than letting such a game look merely
		// wrong: the symptom is indistinguishable from a math bug, and this is the one place that
		// knows it is expected.
		const model = activeWinModel();
		if (model.type === 'cluster' || model.type === 'scatter') {
			console.warn(
				`[game-config] warning: this config declares a '${model.type}' win model, but the engine ` +
					'has no runtime for it — the game is being presented as LINES. The declaration is ' +
					'stored, validated and priced correctly; only the presentation is missing. See ' +
					'docs/design/game-type-templates.md (Phase D).',
			);
		}
	}

	return {
		activeBigTierThresholds,
		activeBigTiers,
		activeWinLevel,
		activeWinLevelByAlias,
		activeWinLevelChain,
		activeWinLevelData,
		activeWinLevelIsBig,
		activeWaysCount,
		activeWinLevels,
		activeWinModel,
		boardDimensions,
		boardSizes,
		getActiveGameConfig,
		getNumLines,
		getNumRows,
		getPaddingReels,
		getPaylines,
		getSymbolsInPlay,
		initialBoard,
		paddingReels,
		paylineColor,
		payoutDivisor,
		publishWinLevelsToFacade,
		publishWinPresentation,
		resetGameConfigCache,
		warnOnGameConfigIssues,
	};
}
