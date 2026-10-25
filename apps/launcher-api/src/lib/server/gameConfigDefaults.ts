import {
	DEFAULT_HOLD_AND_WIN_PRESET,
	GAME_OUTCOMES,
	HOLD_AND_WIN_COIN_BOARD_KEY,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_PRESET_LABELS,
	HOLD_AND_WIN_TEMPLATE_JACKPOTS,
	holdAndWinPresetKey,
	holdAndWinTemplateKey,
	normalizeGameConfigDoc,
	resolveWinLevels,
	type GameConfigDoc,
	type GameOutcome,
	type HoldAndWinPresetId,
	type HoldAndWinTemplateJackpots,
} from 'game-config';
import { loadGameConfigDoc, loadGameConfigDocWithEtag } from './gameConfigStorage';
import holdAndWinClassic from '$lib/data/gameConfig/holdAndWin.classic.json';
import holdAndWinCoinBoard from '$lib/data/gameConfig/holdAndWin.coinBoard.json';
import holdAndWinCollector from '$lib/data/gameConfig/holdAndWin.collector.json';
import holdAndWinPlain from '$lib/data/gameConfig/holdAndWin.plain.json';
import holdAndWinPlainNoJackpots from '$lib/data/gameConfig/holdAndWin.plainNoJackpots.json';
import holdAndWinPots from '$lib/data/gameConfig/holdAndWin.pots.json';
import linesBookOfThermopylae from '$lib/data/gameConfig/lines.bookOfThermopylae.json';
import linesConfig from '$lib/data/gameConfig/lines.json';
import arcadeRulesConfig from '$lib/data/gameConfig/arcade.rules.json';
import match3RgsConfig from '$lib/data/gameConfig/match3.rgs.json';
import match3RulesConfig from '$lib/data/gameConfig/match3.rules.json';
import scatterConfig from '$lib/data/gameConfig/scatter.json';
import waysConfig from '$lib/data/gameConfig/ways.json';

/**
 * Coded Game Config defaults — the per-GAME-TYPE starting point a project inherits until it
 * authors its own (Phase 2 of `docs/design/invisible-game-config.md`).
 *
 * Generated from each game type's own `src/game/config.ts` by
 * `scripts/generate-game-config-defaults.ts`, never hand-edited, so the committed default and the
 * compiled template cannot drift. `tools/game-config-spike` re-derives and compares, so drift is a
 * fixture failure rather than something you find in production.
 *
 * Deliberately per-GAME-TYPE and committed, not per-project and published like
 * `symbolDefaults.ts`: the launcher must be able to seed a brand-new project before it has any R2
 * presence at all. A project's own authored config (`gameConfigStorage.ts`) always wins.
 *
 * Resolution order, and the one every consumer must follow:
 *   authored R2 doc → committed template default → the game's compiled config (Phase 3)
 * An un-authored project must therefore render byte-identically to today.
 */

const FALLBACK_GAME_TYPE = 'lines';

/** The rules-decided match-3 seed (`match3.rules.json`, hand-written: no game app compiles one). */
const MATCH3_RULES_KEY = 'match3.rules';

/** The RGS-decided match-3 seed (`match3.rgs.json`, hand-written): one base bet mode and a gem
 *  paytable priced in multiples of the whole stake. It plays on the test server's match-3 mock. */
const MATCH3_RGS_KEY = 'match3.rgs';

/** The arcade seed (`arcade.rules.json`, hand-written): the catcher / dodger sample's play field,
 *  bodies and collision pairs (game-families P10.8). Free play: an arcade game has no RGS path. */
const ARCADE_RULES_KEY = 'arcade.rules';

/** Who decides a new game's rounds — what Game Maker asks for a `match3` game. */
export const isGameOutcome = (v: unknown): v is GameOutcome =>
	typeof v === 'string' && (GAME_OUTCOMES as readonly string[]).includes(v);

/** The LINES presets (`docs/design/book-feature.md` §3.5): whole configs a lines project may start
 *  from, beside the kind's own default. */
export const LINES_PRESET_IDS = ['bookOfThermopylae'] as const;
export type LinesPresetId = (typeof LINES_PRESET_IDS)[number];
const LINES_PRESET_KEY: Record<LinesPresetId, string> = {
	bookOfThermopylae: 'lines.bookOfThermopylae',
};
const LINES_PRESET_LABELS: Record<LinesPresetId, string> = {
	bookOfThermopylae: 'Book of Thermopylae',
};
export const isLinesPresetId = (id: unknown): id is LinesPresetId =>
	typeof id === 'string' && (LINES_PRESET_IDS as readonly string[]).includes(id);

/**
 * The JSON is normalized at import rather than trusted. It is generated, so it *should* already be
 * canonical — but it is also a checked-in file a human can edit, and a hand-edit that slips past
 * review would otherwise reach a game unvalidated. Normalizing here costs one pass at module load
 * and makes that impossible.
 */
const DEFAULTS_BY_GAME_TYPE: Record<string, GameConfigDoc> = Object.fromEntries(
	Object.entries({
		lines: linesConfig,
		ways: waysConfig,
		scatter: scatterConfig,
		[holdAndWinPresetKey('pots')]: holdAndWinPots,
		[holdAndWinPresetKey('classic')]: holdAndWinClassic,
		[holdAndWinPresetKey('collector')]: holdAndWinCollector,
		[holdAndWinTemplateKey('on')]: holdAndWinPlain,
		[holdAndWinTemplateKey('off')]: holdAndWinPlainNoJackpots,
		[HOLD_AND_WIN_COIN_BOARD_KEY]: holdAndWinCoinBoard,
		[LINES_PRESET_KEY.bookOfThermopylae]: linesBookOfThermopylae,
		[MATCH3_RULES_KEY]: match3RulesConfig,
		[MATCH3_RGS_KEY]: match3RgsConfig,
		[ARCADE_RULES_KEY]: arcadeRulesConfig,
	}).flatMap(([gameType, raw]) => {
		const doc = normalizeGameConfigDoc(raw);
		return doc ? [[gameType, doc] as const] : [];
	}),
);

/** A kind whose defaults are PRESETS resolves to its default preset's key. `match3` defaults to its
 *  rules-decided game (game-families P10.5); the RGS-decided seed (P10.6) is asked for by outcome.
 *  `arcade` has only its rules-decided game (P10.8). */
const KIND_DEFAULT_KEY: Record<string, string> = {
	holdAndWin: holdAndWinPresetKey(DEFAULT_HOLD_AND_WIN_PRESET),
	match3: MATCH3_RULES_KEY,
	arcade: ARCADE_RULES_KEY,
};

export type GameConfigPreset = { id: string; label: string; doc: GameConfigDoc };

const HOLD_AND_WIN_TEMPLATE_LABELS: Record<HoldAndWinTemplateJackpots, string> = {
	on: 'Plain (Jackpots on)',
	off: 'Plain (Jackpots off)',
};

/**
 * The presets a kind offers in `/config`'s "Reset to preset" — empty for a kind with none.
 * `holdAndWin`: the plain template with jackpots on / off (bonus-games §0), the coin board template
 * (`docs/design/hold-and-win-coin-board.md`), then Pots / Classic sticky / Collector streak
 * (`docs/design/hold-and-win.md` §6).
 * `lines`: the Book of Thermopylae (the Book-of mechanic as a lines config).
 */
export function gameConfigPresetsFor(gameType: string | undefined): GameConfigPreset[] {
	if (gameType === 'lines') {
		return LINES_PRESET_IDS.flatMap((id) => {
			const doc = DEFAULTS_BY_GAME_TYPE[LINES_PRESET_KEY[id]];
			return doc ? [{ id, label: LINES_PRESET_LABELS[id], doc }] : [];
		});
	}
	if (gameType !== 'holdAndWin') return [];
	const plain = HOLD_AND_WIN_TEMPLATE_JACKPOTS.flatMap((jackpots) => {
		const doc = holdAndWinTemplateSeed(jackpots);
		return doc
			? [
					{
						id: holdAndWinTemplateKey(jackpots),
						label: HOLD_AND_WIN_TEMPLATE_LABELS[jackpots],
						doc,
					},
				]
			: [];
	});
	const coinBoard = holdAndWinCoinBoardSeed();
	return [
		...plain,
		...(coinBoard
			? [
					{
						id: HOLD_AND_WIN_COIN_BOARD_KEY,
						label: 'Coin board only (no line game)',
						doc: coinBoard,
					},
				]
			: []),
		...HOLD_AND_WIN_PRESET_IDS.flatMap((id) => {
			const doc = DEFAULTS_BY_GAME_TYPE[holdAndWinPresetKey(id)];
			return doc ? [{ id, label: HOLD_AND_WIN_PRESET_LABELS[id], doc }] : [];
		}),
	];
}

/**
 * The committed default for a game type, falling back to `lines` — the same fallback
 * `symbolDefaultsFor` uses, so the two surfaces never disagree about what an unknown game type is.
 *
 * Returns `null` only if even the fallback is missing, which would mean the generated JSON is
 * broken. Callers must treat `null` as "use the compiled config", never as "no symbols".
 */
export function gameConfigDefaultFor(gameType: string | undefined): GameConfigDoc | null {
	const key = gameType ? (KIND_DEFAULT_KEY[gameType] ?? gameType) : FALLBACK_GAME_TYPE;
	return DEFAULTS_BY_GAME_TYPE[key] ?? DEFAULTS_BY_GAME_TYPE[FALLBACK_GAME_TYPE] ?? null;
}

/**
 * Is this kind's template the config a never-saved project plays? Such a project plays the compiled
 * lines config (its runtime bundle carries none), which is the template of every kind that falls
 * back to `lines` — lines, cluster, Book-of, a custom kind — and not of ways, scatter or Hold and Win.
 */
export const templateIsBuiltIn = (gameType: string | undefined): boolean =>
	gameConfigDefaultFor(gameType) === DEFAULTS_BY_GAME_TYPE[FALLBACK_GAME_TYPE];

/**
 * The config a NEW project of this kind is scaffolded with, or `null` to leave it un-authored.
 *
 * Only a kind whose defaults are presets is seeded: its mock and runtime need the kind's block, and
 * an un-authored project falls through to the compiled LINES config, which has none — so a fresh
 * `holdAndWin` project was dealt plain lines until someone saved `/config`. A lines project seeds a
 * lines PRESET only when one is asked for (Game Maker's "Book of Thermopylae"). Every other kind
 * stays un-authored, so what it plays is byte-identical to before (the compiled template, `null`
 * bake). A `match3` project seeds its RGS-decided game only when `outcome: 'rgs'` is asked for
 * (Game Maker's "Who decides the result?"); without one it seeds the rules game, as before.
 */
export function gameConfigSeedFor(
	gameType: string,
	preset?: HoldAndWinPresetId | LinesPresetId,
	outcome?: GameOutcome,
): GameConfigDoc | null {
	if (gameType === 'match3' && outcome === 'rgs')
		return DEFAULTS_BY_GAME_TYPE[MATCH3_RGS_KEY] ?? null;
	if (gameType === 'lines') {
		return isLinesPresetId(preset)
			? (DEFAULTS_BY_GAME_TYPE[LINES_PRESET_KEY[preset]] ?? null)
			: null;
	}
	if (!(gameType in KIND_DEFAULT_KEY)) return null;
	if (gameType === 'holdAndWin' && preset && !isLinesPresetId(preset)) {
		return DEFAULTS_BY_GAME_TYPE[holdAndWinPresetKey(preset)] ?? null;
	}
	return gameConfigDefaultFor(gameType);
}

/**
 * The config Game Maker's "Hold and Win" template creates (`docs/design/bonus-games.md` §0): the plain
 * game, coins only, with or without jackpots. Pots and Collector are coin overlay styles now, added
 * through "＋ Coin overlay…"; the three presets stay `/config`'s "Reset to preset" and the samples'.
 */
export const holdAndWinTemplateSeed = (
	jackpots: HoldAndWinTemplateJackpots,
): GameConfigDoc | null => DEFAULTS_BY_GAME_TYPE[holdAndWinTemplateKey(jackpots)] ?? null;

/** The config Game Maker's "Hold and Win" template creates with **Base game: Coin board only**
 * (`docs/design/hold-and-win-coin-board.md`): no line game, the coin board on every spin. */
export const holdAndWinCoinBoardSeed = (): GameConfigDoc | null =>
	DEFAULTS_BY_GAME_TYPE[HOLD_AND_WIN_COIN_BOARD_KEY] ?? null;

export type GameConfigSource = 'authored' | 'template';

export type ResolvedGameConfig = {
	doc: GameConfigDoc | null;
	/** Where `doc` came from. The tool shows it ("inherited from the lines template") so an author
	 *  always knows whether they are editing their own config or looking at the seed. */
	source: GameConfigSource;
	/** The ETag of the authored doc, or `null` when none exists — the compare-and-swap precondition
	 *  the tool must send back on save. Seeded-from-template means `null`, which correctly asks R2
	 *  for `If-None-Match: *`: the first save must create, not overwrite. */
	etag: string | null;
};

/**
 * Resolve what a project's config actually IS, with provenance — the single entry point for the
 * tool page, the bake and the runtime bundle, so none of them re-implement the precedence.
 */
export async function resolveGameConfig(
	clientKey: string,
	projectKey: string,
	gameType: string | undefined,
): Promise<ResolvedGameConfig> {
	return resolvedGameConfigFrom(await loadGameConfigDocWithEtag(clientKey, projectKey), gameType);
}

/** {@link resolveGameConfig}'s precedence over a stored doc already read (`doc: null` when there is
 *  none, or it is unreadable) — the authored doc, else the kind's template. */
export function resolvedGameConfigFrom(
	authored: { doc: GameConfigDoc | null; etag: string | null },
	gameType: string | undefined,
): ResolvedGameConfig {
	if (authored.doc) return { doc: authored.doc, source: 'authored', etag: authored.etag };
	return { doc: gameConfigDefaultFor(gameType), source: 'template', etag: authored.etag };
}

/**
 * The doc alone, for callers that only need the config and not where it came from (the runtime
 * bundle). Kept separate from {@link loadGameConfigDoc}, which deliberately does NOT fall back:
 * a bake that wants to know "did this project author anything?" must be able to ask.
 */
export async function resolveGameConfigDoc(
	clientKey: string,
	projectKey: string,
	gameType: string | undefined,
): Promise<GameConfigDoc | null> {
	return (await loadGameConfigDoc(clientKey, projectKey)) ?? gameConfigDefaultFor(gameType);
}

/** One project big-win tier as the reel-anticipation panel consumes it — the `alias` it authors FX
 *  under and the player-facing `name` it shows as the column header. */
export type BigTier = { alias: string; name: string };

/**
 * A config's BIG-win tiers (`alias` + `name`), ascending by threshold — the source the
 * reel-anticipation `/symbols` panel mirrors (one FX column per big tier, keyed by alias). Applies the
 * same `type === 'big'` filter the engine's `activeBigTiers()` uses, so the panel's columns match the
 * tiers the game arms. Empty when the config authors no big tier (the panel then shows a note asking
 * the author to add big-win tiers in `/config` first).
 */
export function bigTiersOf(doc: GameConfigDoc | null): BigTier[] {
	const tiers = doc ? resolveWinLevels(doc) : undefined;
	if (!tiers) return [];
	return tiers
		.filter((tier) => tier.type === 'big')
		.slice()
		.sort((a, b) => a.threshold - b.threshold)
		.map((tier) => ({ alias: tier.alias, name: tier.name || tier.alias }));
}
