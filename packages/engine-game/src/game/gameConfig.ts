import {
	normalizeGameConfigDoc,
	resolveWinLevel,
	resolveWinLevelChain,
	resolveWinLevels,
	resolveGrid,
	acceptServerWindow,
	reconcileGridDoc,
	gridShapeDiffers,
	type ServerWindow,
	resolveReelBehaviour,
	resolveSounds,
	resolveWinModel,
	symbolsInPlay,
	validateGameConfigDoc,
	winLevelType,
	type GameConfigDoc,
	type GameSounds,
	type ResolvedGrid,
	type ResolvedReelBehaviour,
	type ResolvedSounds,
	type ResolvedWinTier,
	type WinModel,
} from 'game-config';
import type { SoundBindings } from 'engine-layout';

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
	/** {@link activeGrid}'s identity-keyed memo — see the note there for why it is not reset-managed. */
	let gridMemoFor: GameConfigDoc | null = null;
	let gridMemo: ResolvedGrid | null = null;
	/** The RGS's declared board as of {@link captureServerGrid} — the ONE value {@link activeGrid}
	 *  reconciles against. `undefined` until captured, and on every game whose server declares no
	 *  window, which is what makes the un-captured state byte-identical to having no overlay at all. */
	let capturedWindow: ServerWindow | undefined;

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
		// A verdict reached before the live bundle landed was reached against the COMPILED template's
		// board, not the authored one — re-decide it against the config the game will actually run.
		gridChecked = false;
	}

	// ---------------------------------------------------------------------------
	// Server-config overlay — the RGS's DECLARED boot config, server-authoritative at runtime.
	//
	// The Play4Fun facade (`packages/rgs-translator-eagaming/engineFacade.ts`) publishes the server's
	// boot `config` event to `globalThis.__IE_SERVER_CONFIG__` (mirror of the `__IE_WIN_LEVELS__`
	// engine→facade bridge, in reverse: facade→engine, since the facade cannot import this app). When
	// it is present the RGS is the authority on the game's DERIVED display data — paylines / line count,
	// the in-play symbol GATE, the cosmetic strips and per-line colour indexing all follow the server.
	//
	// Read FRESH here on every accessor call rather than folded into the memoised `getActiveGameConfig()`
	// doc: the `config` event arrives asynchronously (during `requestAuthenticate`), which can be AFTER
	// the memo resets at boot, and these accessors run per-render / per-spin — so a live read picks the
	// config up the moment it lands, with no cache to invalidate. Undefined ⇒ no config event (a dev app
	// on plain `rgs-requests`, the real engine RGS, or any host with no facade) ⇒ every accessor falls
	// through to the authored doc, byte-identical to before (parity).
	// ---------------------------------------------------------------------------

	type ServerGameConfig = {
		availablePayLines: number[][];
		symbols: string[];
		/** `rows` is the BOUNDING BOX — the tallest column. `rowsPerReel` is present only when the
		 *  columns differ, so a server that never heard of stepped grids sends the shape it always
		 *  sent (`rgs-translator-eagaming`'s `Play4FunConfigContext['window']`, published verbatim). */
		window?: { reels: number; rows: number; rowsPerReel?: number[] };
	};

	/** The RGS-declared config, or `undefined` when no config event has been published (⇒ parity). A
	 *  config with no symbols is treated as absent — it cannot describe an in-play set or strips. */
	function serverConfig(): ServerGameConfig | undefined {
		warnOnServerGridMismatch();
		const cfg = (globalThis as { __IE_SERVER_CONFIG__?: ServerGameConfig }).__IE_SERVER_CONFIG__;
		if (!cfg || !Array.isArray(cfg.symbols) || cfg.symbols.length === 0) return undefined;
		return cfg;
	}

	/**
	 * The RGS's declared board, read STRAIGHT off the global — `{ reels, rows }`, or `undefined` when
	 * no config event has landed or the one that did declared no usable window.
	 *
	 * Deliberately NOT routed through {@link serverConfig}, and the reason is mechanical rather than
	 * stylistic: `serverConfig()` fires {@link warnOnServerGridMismatch}, which reads
	 * {@link boardDimensions}, which reads {@link activeGrid} — which is this function's caller. Going
	 * through it would be unbounded recursion on the first render. The warning already reads the
	 * global directly for its own half of the comparison, so this is the same source, named once.
	 *
	 * It also deliberately does NOT require `symbols`: a window is a complete statement about the
	 * board on its own, and a config that declares one while carrying no in-play set still knows how
	 * big the board is.
	 */
	function serverWindow(): ServerWindow | undefined {
		return acceptServerWindow(
			(globalThis as { __IE_SERVER_CONFIG__?: ServerGameConfig }).__IE_SERVER_CONFIG__?.window,
		);
	}

	/**
	 * ADOPT the RGS's declared board — once, at a point the game controls — and say whether doing so
	 * actually changed the grid.
	 *
	 * {@link activeGrid} reads {@link capturedWindow} rather than the global, and this is the only
	 * thing that writes it. That indirection is the whole design, for two reasons:
	 *
	 * 1. **The board is not an accessor.** `stateGame.board` is BUILT once, at `stateGame` module
	 *    init, from `initialBoard()`/`boardDimensions()`. Every other server-authoritative reader
	 *    (paylines, the in-play gate, the strips) is a live accessor and needs no boot hook, which is
	 *    what the note at `Game.svelte`'s runtime branch says — but a grid that resizes the board is
	 *    not one of those. Something has to rebuild it, and it has to happen on the BAKED path too,
	 *    where that branch never runs. Returning "did it change" is how the caller knows to, without
	 *    rebuilding a board that was already right (parity).
	 * 2. **A live read would be a non-reactive input to a hot accessor.** `__IE_SERVER_CONFIG__` is a
	 *    plain global with no Svelte dependency, so an accessor that read it per call could change
	 *    value with nothing invalidating the `$derived`s built on it — the mask sized for one grid
	 *    while the seats use another, resolving at whatever moment each happened to re-run. Latched,
	 *    the grid has exactly ONE transition, at a moment `Game.svelte` picks, before first paint.
	 *
	 * Safe to call more than once and safe to call before the config lands: it simply re-reads. The
	 * ordering it relies on is real rather than assumed — `<Authenticate>` gates the game's mount on
	 * the very request whose `config` event publishes the overlay, so it is already in at boot.
	 */
	function captureServerGrid(): boolean {
		const next = serverWindow();
		// Asked of the AUTHORED doc, which is what the reels were built from — this runs once, at boot,
		// before anything has been adopted.
		const doc = getActiveGameConfig();
		const changed = next
			? gridShapeDiffers(resolveGrid(doc), resolveGrid(reconcileGridDoc(doc, next)))
			: false;
		capturedWindow = next;
		gridMemo = null;
		gridMemoFor = null;
		return changed;
	}

	/** Latched once a server config actually DECLARES a window, so {@link warnOnServerGridMismatch}
	 *  costs one comparison rather than one per render. Released by {@link resetGameConfigCache}. */
	let gridChecked = false;

	/**
	 * Say out loud, once, when the RGS's DECLARED board and the board this client draws disagree.
	 *
	 * {@link boardDimensions} sizes the board off Invisible Game Config (`numReels`/`numRows`), which
	 * an online project fetches LIVE — so a grid change lands on the client immediately. The Invisible
	 * Test Server's mock now re-reads that SAME config live too (`GET /api/game-config/mock`, see
	 * `services/test-server/server.mjs`), so against our own mock the two agree within seconds of a
	 * save and this check should never fire. It stays because it still catches the cases where the
	 * server genuinely is not following: a game whose manifest entry predates that pointer (published
	 * before it shipped, or by the standalone desktop script) and therefore still deals the frozen
	 * publish-time snapshot, a launcher the test server cannot reach, and a REAL RGS — which is
	 * authoritative by design and will never follow the client's config.
	 *
	 * Left undetected the failure is total: the client draws 6×6 while the server deals 5×3, the reels
	 * and rows outside the server's board never receive a symbol, and wins are evaluated on a grid
	 * nobody is looking at.
	 *
	 * Nothing else noticed. The server overlay only ever consumed `window` to size the cosmetic blur
	 * (`serverPaddingReels`), so a mismatch this total presented as "the game stopped working" and
	 * cost a network-probe session to name. Both numbers are right here — say it.
	 *
	 * Fired from BOTH ends, because neither alone is enough. `Game.svelte` calls it at boot, which is
	 * deterministic today: `<Authenticate>` gates the game's mount on the very request whose `config`
	 * event publishes the overlay, so it is already in by then. `serverConfig()` calls it too, so a
	 * host that mounts the game FIRST and authenticates after still gets the check on the next
	 * accessor read instead of silently never. Idempotent either way. A config with no `window`
	 * decides nothing, so a host that omits it is byte-identical to before (parity).
	 */
	function warnOnServerGridMismatch(): void {
		if (gridChecked) return;
		// The CAPTURED window, so the message describes the board that was actually adopted rather
		// than whatever the global says at the moment of the read. Un-captured ⇒ nothing was adopted
		// ⇒ nothing to report.
		const win = capturedWindow;
		if (!win) return;
		gridChecked = true;

		// What the PROJECT authored, before {@link reconcileGridDoc} had its say — the comparison has
		// to be against the doc, because the resolved grid now follows the server by construction and
		// could only ever agree with it.
		const authored = resolveGrid(getActiveGameConfig());
		// Compare the SHAPE, not just the box: with a declared `rowsPerReel` the server can replace the
		// authored step while the bounding box agrees, and that is still the board changing under the
		// author's feet.
		const drawn = activeGrid();
		const same =
			drawn.reels === authored.reels &&
			drawn.rows.length === authored.rows.length &&
			drawn.rows.every((r, i) => r === authored.rows[i]);
		if (same) return;
		const stepRefused = authored.stepped && !win.rowsPerReel;

		const shapeOf = (g: ResolvedGrid) =>
			g.stepped ? `${g.reels}×[${g.rows.join(',')}]` : `${g.reels}×${g.maxRows}`;
		console.error(
			`[game-config] error: the RGS deals ${shapeOf(activeGrid())} and this project authored ` +
				`${shapeOf(authored)} (Invisible Game Config numReels/numRows). THE SERVER WINS — the ` +
				`board now draws ${shapeOf(drawn)}` +
				(stepRefused
					? ', and the authored per-column step was DROPPED, because the server declared a plain ' +
						'rectangle and a column drawn shorter than it dealt hides a cell that was scored. '
					: '. ') +
				'The test server follows this config on its own, so a disagreement means it is not ' +
				'following: publish the game once (older entries have no pointer back to the live ' +
				'config). Against a real RGS — which is authoritative and declares only a rectangle — ' +
				'author the config to the size the server deals.',
		);
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
	 * This is the runtime's read of the win model, and it deliberately selects no win EVALUATION: the
	 * RGS decides what a spin pays and the engine presents it, which is the only shape that survives
	 * meeting a real provider. What the model DOES drive here is every surface whose meaning depends
	 * on it — `payoutDivisor()`, payline colour, the payline diagram, win-line shape, anticipation.
	 *
	 * The mock's evaluator must mirror `payoutDivisor()` exactly (see `payoutBaseFor` in
	 * `scripts/mock-rgs-server.mjs`), or the info page prices a win differently from the wallet that
	 * credits it. `pnpm check:stake` is the gate on that agreement.
	 */
	function activeWinModel(): WinModel {
		return resolveWinModel(getActiveGameConfig());
	}

	/**
	 * HOW THE BOARD PRESENTS A ROUND — roll or swap in place, clear the outgoing board first, and how
	 * long each column waits before it falls. Resolved from the active config, defaults already
	 * applied (`ReelBehaviour`).
	 *
	 * Read through `resolveReelBehaviour` rather than off the doc, so "absent means the reels roll"
	 * is spelled out once, and so the `clearBoard`-needs-`swapInPlace` dependency cannot be answered
	 * differently here than it is in the tool that authors it.
	 *
	 * NOT memoised beyond `getActiveGameConfig`'s own memo: this is three field reads, and a second
	 * cache would be a second thing `resetGameConfigCache()` has to remember to drop — the exact
	 * omission that freezes an online game to the sample config.
	 */
	function activeReelBehaviour(): ResolvedReelBehaviour {
		return resolveReelBehaviour(getActiveGameConfig());
	}

	/**
	 * WHAT THE GAME PLAYS AT EACH NAMED PRESENTATION MOMENT — the cascade pop, the reel-stop ladder,
	 * the landing cues — resolved from the active config with the catalogue defaults already applied
	 * (`game-config/sounds`).
	 *
	 * Note the inverted default: every other optional block here resolves an absent value to "what
	 * the engine did before the block existed", and for sound that was NOTHING — the cue had no
	 * literal to play. So an absent block resolves to the full catalogue instead, and a project that
	 * never opens the Sounds panel gets the whole sound set rather than the silence it has now.
	 *
	 * NOT memoised beyond `getActiveGameConfig`'s own memo, for the same reason `activeReelBehaviour`
	 * isn't: a second cache is a second thing `resetGameConfigCache()` has to remember to drop, which
	 * is the omission that freezes an online game to the sample config.
	 */
	function activeSounds(): ResolvedSounds {
		const slots = soundBindings?.slots;
		return resolveSounds(slots ? { sounds: slots as GameSounds } : getActiveGameConfig());
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
		// The RESOLVED grid, not the raw doc: the board follows the RGS's declared window
		// ({@link reconcileGridDoc}), and a ways count taken from the authored `numRows` would price a
		// spin against a board the game is not drawing — the same client/math divergence one layer up.
		const rows = activeGrid().rows;
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
		// Resolved grid, for the reason {@link activeWaysCount} gives: the board the game DRAWS is the
		// one every derived display number has to agree with.
		return activeGrid().rows[0] ?? 3;
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
		const grid = activeGrid();
		return { x: grid.reels, y: grid.maxRows };
	}


	/**
	 * THE GRID — per-column heights and their vertical placement, resolved once
	 * (`game-config`'s {@link resolveGrid}). The accessor every surface that needs to know how tall
	 * ONE column is reads, in place of assuming {@link boardDimensions}`.y`.
	 *
	 * `boardDimensions()` above is deliberately unchanged and still reports the BOUNDING BOX: it is
	 * what the board's pixel footprint, its layout anchor and its scene coordinates are pinned to,
	 * and a stepped board still occupies that whole rectangle. What changes is that the rectangle
	 * is no longer a claim that every column FILLS it.
	 *
	 * Read `grid.stepped` before branching. It is false for every board that exists today, and each
	 * consumer keeps its existing rectangular code path on that answer — not an equivalent one, the
	 * same one. `apps/lines` ships as the shared `_runtime/lines` bundle to every online game, so a
	 * uniform board must come out the far side untouched.
	 *
	 * A FUNCTION, not a const, for the reason the header gives: the live online config resolves
	 * after this module evaluates, so a const would freeze to the compiled template's grid.
	 */
	function activeGrid(): ResolvedGrid {
		const config = getActiveGameConfig();
		// Memoised on the config's IDENTITY, not in a cache of its own. `resolveGrid` allocates two
		// arrays and this runs per cell per render, so re-resolving it every call is real garbage on
		// the hot path — but a second cache would be a second thing `resetGameConfigCache()` has to
		// remember to drop, which is the omission that freezes an online game to the template (see
		// `activeReelBehaviour`, which stays un-memoised for exactly that reason — it is three field
		// reads and allocates nothing). Keying on the object reference gets the memo without the
		// bookkeeping: dropping `cached` yields a NEW doc object, so this invalidates itself.
		// The LATCHED window, never a live read of the global — see {@link captureServerGrid}. That is
		// what keeps this a pure function of two values that change only at points `Game.svelte`
		// controls, so the memo needs no key beyond the doc identity and no consumer can observe the
		// grid changing underneath it mid-render.
		if (gridMemo && gridMemoFor === config) return gridMemo;
		gridMemoFor = config;
		gridMemo = capturedWindow
			? resolveGrid(reconcileGridDoc(config, capturedWindow))
			: resolveGrid(config);
		return gridMemo;
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
		const grid = activeGrid();
		const strips = paddingReels('basegame');
		const fallback = Object.keys(getActiveGameConfig().symbols)[0] ?? 'H1';
		return Array.from({ length: grid.reels }, (_unused, reel) => {
			const strip = strips[reel] ?? [];
			// `rows + 2` per COLUMN, not per board: the ±1 padding buffers this column's own window,
			// and `createReelForSpinning` takes each reel's length from the array it is handed
			// (`reelLength = initialSymbols.length`), so a short column becomes a short reel with no
			// further plumbing. Uniform grids give every column the same `maxRows + 2` as before.
			const cells = grid.rowsForReel(reel) + 2;
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
			// CARRIED, not dropped. A resolved tier knows its own threshold and one consumer needs it on
			// the presentation object: the big-win tap-to-step SEEKS the count to the tapped tier's amount
			// (`threshold × BOOK_AMOUNT_MULTIPLIER`, `WinVisual.escalationBoundaries`). Omitting it read as
			// harmless — the level already comes from the resolver — but it made every AUTHORED config's
			// boundaries `[0, 0, …]` through `?? 0`, so on exactly the projects that author their tiers the
			// tap stepped the tier ART while the number carried on counting from wherever it was. The coded
			// `winLevelMap` fallback carries a threshold, which is why this only ever broke real games.
			threshold: tier.threshold,
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

	// ---------------------------------------------------------------------------
	// WHAT PLAYS WHEN — the Invisible Sound doc's choices, published at boot from the baked catalog.
	//
	// Sound authoring used to live in the config doc (`sounds`, `winLevels[].sound`) and the symbols
	// doc. It lives in the sound tool now, and the EXPORT resolves the migration, so what arrives here
	// is one settled answer. Absent ⇒ every read below falls through to the config/coded path exactly
	// as before, which is what keeps an un-migrated project and un-baked dev byte-identical.
	// ---------------------------------------------------------------------------

	let soundBindings: SoundBindings | undefined;

	/**
	 * Publish the project's sound choices. Called at boot after {@link resetGameConfigCache}, from the
	 * game's own baked-catalog accessor — the same shape as {@link publishWinPresentation}, and for
	 * the same reason: this package cannot reach a game's bundle, so the game hands it in.
	 */
	function publishSoundBindings(bindings: SoundBindings | undefined): void {
		soundBindings = bindings;
	}

	/** A tier's authored cues, or `undefined` when the sound doc says nothing about it. */
	function tierSoundBinding(alias: string): { sfx?: string; bgm?: string } | undefined {
		return soundBindings?.winTiers?.[alias];
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
		// The sound tool outranks the win instance's params, which outrank the config/coded tier. It
		// has to: it is the surface that lists every tier at once, so a cue picked there and then
		// silently overruled by a param buried in a component instance would be indistinguishable
		// from a cue that simply does not play.
		const authored = tierSoundBinding(alias);
		const sfx = authored?.sfx ?? presentationString(`${alias}Sfx`);
		const bgm = authored?.bgm ?? presentationString(`${alias}Bgm`);
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
	 * (`packages/rgs-translator-eagaming/engineFacade.ts`). The facade is a drop-in for `rgs-requests` and
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

		// There WAS a boot warning here for a declared-but-unhonoured win model. It is gone because
		// all four are now honoured end to end: priced correctly (`payoutDivisor`), drawn with the
		// right win-line shape, anticipation either running (`lines`/`ways`) or standing down, and
		// PAID by a matching evaluator in the Invisible Test Server's mock — a payline walk, a ways
		// walk, a cluster flood fill, and a scatter count-anywhere.
		//
		// Restore it if a FIFTH model is ever added to `WIN_MODEL_TYPES`: the symptom of an
		// unhonoured model is a game that pays line wins while claiming to be something else, which
		// is indistinguishable from a math bug, and this is the one place that would know it is
		// expected. What it must NOT become again is a warning that outlives the gap — this one
		// claimed for a while that every client surface fell back to line behaviour, which had
		// stopped being true.
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
		activeReelBehaviour,
		activeSounds,
		publishSoundBindings,
		activeWinModel,
		activeGrid,
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
		captureServerGrid,
		warnOnGameConfigIssues,
		warnOnServerGridMismatch,
	};
}
