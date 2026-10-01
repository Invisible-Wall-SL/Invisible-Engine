import {
	DEFAULT_HOLD_AND_WIN_PRESET,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_PRESET_LABELS,
	holdAndWinPresetKey,
	normalizeGameConfigDoc,
	resolveWinLevels,
	type GameConfigDoc,
} from 'game-config';
import { loadGameConfigDoc, loadGameConfigDocWithEtag } from './gameConfigStorage';
import holdAndWinClassic from '$lib/data/gameConfig/holdAndWin.classic.json';
import holdAndWinCollector from '$lib/data/gameConfig/holdAndWin.collector.json';
import holdAndWinPots from '$lib/data/gameConfig/holdAndWin.pots.json';
import linesConfig from '$lib/data/gameConfig/lines.json';
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
	}).flatMap(([gameType, raw]) => {
		const doc = normalizeGameConfigDoc(raw);
		return doc ? [[gameType, doc] as const] : [];
	}),
);

/** A kind whose defaults are PRESETS resolves to its default preset's key. */
const KIND_DEFAULT_KEY: Record<string, string> = {
	holdAndWin: holdAndWinPresetKey(DEFAULT_HOLD_AND_WIN_PRESET),
};

export type GameConfigPreset = { id: string; label: string; doc: GameConfigDoc };

/**
 * The presets a kind offers in `/config`'s "Reset to preset" — empty for a kind with one default.
 * `holdAndWin`: Pots / Classic sticky / Collector streak (`docs/design/hold-and-win.md` §6).
 */
export function gameConfigPresetsFor(gameType: string | undefined): GameConfigPreset[] {
	if (gameType !== 'holdAndWin') return [];
	return HOLD_AND_WIN_PRESET_IDS.flatMap((id) => {
		const doc = DEFAULTS_BY_GAME_TYPE[holdAndWinPresetKey(id)];
		return doc ? [{ id, label: HOLD_AND_WIN_PRESET_LABELS[id], doc }] : [];
	});
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
 * The config a NEW project of this kind is scaffolded with, or `null` to leave it un-authored.
 *
 * Only a kind whose defaults are presets is seeded: its mock and runtime need the kind's block, and
 * an un-authored project falls through to the compiled LINES config, which has none — so a fresh
 * `holdAndWin` project was dealt plain lines until someone saved `/config`. Every other kind stays
 * un-authored, so what it plays is byte-identical to before (the compiled template, `null` bake).
 */
export function gameConfigSeedFor(gameType: string): GameConfigDoc | null {
	return gameType in KIND_DEFAULT_KEY ? gameConfigDefaultFor(gameType) : null;
}

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
	const authored = await loadGameConfigDocWithEtag(clientKey, projectKey);
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
 * The project's BIG-win tiers (`alias` + `name`), ascending by threshold — the source the
 * reel-anticipation `/symbols` panel mirrors (one FX column per big tier, keyed by alias). Resolves
 * the same config the game does (authored R2 doc → committed template default) and applies the same
 * `type === 'big'` filter the engine's `activeBigTiers()` uses, so the panel's columns match the tiers
 * the game actually arms. Empty when the config authors no big tier (the panel then shows a note
 * asking the author to add big-win tiers in `/config` first).
 */
export async function resolveBigTiers(
	clientKey: string,
	projectKey: string,
	gameType: string | undefined,
): Promise<BigTier[]> {
	const { doc } = await resolveGameConfig(clientKey, projectKey, gameType);
	return bigTiersOf(doc);
}

/** {@link resolveBigTiers} for a config already in hand. */
export function bigTiersOf(doc: GameConfigDoc | null): BigTier[] {
	const tiers = doc ? resolveWinLevels(doc) : undefined;
	if (!tiers) return [];
	return tiers
		.filter((tier) => tier.type === 'big')
		.slice()
		.sort((a, b) => a.threshold - b.threshold)
		.map((tier) => ({ alias: tier.alias, name: tier.name || tier.alias }));
}
