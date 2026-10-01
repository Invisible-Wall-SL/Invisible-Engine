import { HOLD_AND_WIN_SYMBOL_ROLES, type GameConfigDoc } from 'game-config';
import { z } from 'zod';
import { symbolDefaultsKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';
import { stripUnknownKeysWithWarning } from './stripUnknownKeys';
import {
	migrateLegacySymbolStates,
	SYMBOL_STATES,
	type SymbolCell,
	type SymbolsDoc,
} from './symbolsStorage';
import holdAndWinDefaults from '$lib/data/symbolDefaults/holdAndWin.json';
import linesDefaults from '$lib/data/symbolDefaults/lines.json';

/**
 * Coded symbol defaults — the dev-parity twin of each game's `SYMBOL_INFO_MAP`.
 * They are the grid's SOURCE OF TRUTH for the symbol list, the fixed state set,
 * and the DEFAULT binding of every cell. The authored R2 doc (`symbolsStorage`)
 * is a SPARSE override layered ON TOP of this map, cell by cell.
 *
 * Two sources, in precedence order:
 *  1. PUBLISHED — each game publishes its own `SYMBOL_INFO_MAP` to R2 at build
 *     time (`publish-symbol-defaults.mjs` → `PUT /api/editor/symbol-defaults` →
 *     `savePublishedSymbolDefaults`), so a project's tool grid is driven by ITS
 *     coded map. Loaded per-project with `loadPublishedSymbolDefaults`.
 *  2. OFFLINE FALLBACK — the committed `$lib/data/symbolDefaults/<kind>.json`,
 *     used for `apps/lines` dev and any project that has not published yet:
 *     `lines.json` for every kind, except `holdAndWin.json` — the 3 Pots preset's
 *     symbol set (its line symbols plus BONUS / JACKPOT / BOOST / COLLECT / MULTI /
 *     MYSTERY / BLANK) bound to placeholder art that ships with `apps/lines`.
 *
 * Mirrors how the editor's `defaultLayout('lines')` imports its basegame truth.
 * See `docs/design/invisible-symbols-state-machine.md`.
 */

export type SymbolState = (typeof SYMBOL_STATES)[number];

/** A coded default binding — same shape as an authored cell. */
export type DefaultCell = SymbolCell;

const sizeRatiosSchema = z.object({
	width: z.number(),
	height: z.number(),
});

/** A single default binding — sprite frame or spine animation. Same cell shape
 * as the authored override (`symbolsStorage`'s `symbolCellSchema`), reused here. */
const defaultCellSchema = z
	.object({
		type: z.enum(['sprite', 'spine']),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		/** Tool-only `<folder>/<stem>` spine resolver hint (e.g. `symbols/h1`) for a
		 *  shared-atlas symbol bundle, so the grid can preview the SPECIFIC skeleton of
		 *  a default spine cell. Display/preview only — never written to a saved override. */
		previewKey: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema,
	})
	// `.strip()` not `.strict()`: a game's coded `SYMBOL_INFO_MAP` may carry extra
	// engine-only cell fields the tool doesn't model (e.g. Book of Borut's
	// `winFrame`). Strict rejection 400s the whole publish, which a build swallows
	// under `--optional` → the tool grid silently keeps a STALE set. Strip unknowns
	// instead (the publish script also pre-strips; this is defence in depth).
	.strip();

/** State → binding. DENSE: a published default carries every state for a symbol,
 * so (unlike the sparse overrides doc) we don't drop or require sparseness. */
const defaultStatesSchema = z.record(z.enum(SYMBOL_STATES), defaultCellSchema);

/** Symbol name → state → binding. */
const defaultSymbolsSchema = z.record(z.string().min(1), defaultStatesSchema);

/** The game's built-in global win-frame ("highlight") default — display only, so
 *  the tool can show "current = default (payframe)". Spine-only, same cell shape. */
const highlightDefaultSchema = z
	.object({
		type: z.literal('spine'),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		previewKey: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema,
	})
	.strict();

export const symbolDefaultsSchema = z
	.object({
		version: z.number(),
		gameType: z.string(),
		symbols: defaultSymbolsSchema,
		highlight: highlightDefaultSchema.optional(),
	})
	.strip();

export type SymbolDefaults = z.infer<typeof symbolDefaultsSchema>;

const DEFAULTS_BY_GAME: Record<string, SymbolDefaults> = {
	lines: symbolDefaultsSchema.parse(linesDefaults),
	holdAndWin: symbolDefaultsSchema.parse(holdAndWinDefaults),
};

const FALLBACK_GAME = 'lines';

/**
 * Resolve the OFFLINE coded defaults for a game type, falling back to `lines`
 * (v1). This is the fallback when a project has not published its own map.
 */
export function symbolDefaultsFor(gameType: string | undefined): SymbolDefaults {
	return DEFAULTS_BY_GAME[gameType ?? FALLBACK_GAME] ?? DEFAULTS_BY_GAME[FALLBACK_GAME];
}

const SEEDED_HOLD_AND_WIN_ROLES = new Set<string>(
	HOLD_AND_WIN_SYMBOL_ROLES.filter((role) => role !== 'blank'),
);
const hasSeededRole = (roles: string[] | undefined) =>
	roles?.some((role) => SEEDED_HOLD_AND_WIN_ROLES.has(role)) ?? false;

/**
 * The symbols doc a `holdAndWin` project is scaffolded with, or `null` when nothing needs binding.
 *
 * The defaults above feed only the tools: the game's symbol map is the coded lines
 * `SYMBOL_INFO_MAP` with the project's symbols doc merged over it, so a Hold and Win symbol nobody
 * bound draws no art. Every symbol of `config` that carries a Hold and Win role (a `blank` draws
 * nothing by design) gets its `holdAndWin.json` cells — type / assetKey / animationName only, since
 * they bind coded game assets the exporter leaves alone.
 */
export function holdAndWinSymbolsSeed(config: GameConfigDoc | null): SymbolsDoc | null {
	if (!config) return null;
	const defaults = DEFAULTS_BY_GAME.holdAndWin.symbols;
	const symbols: SymbolsDoc['symbols'] = {};
	for (const [name, symbol] of Object.entries(config.symbols)) {
		if (!hasSeededRole(symbol.special_properties)) continue;
		const cells = defaults[name];
		if (!cells) {
			console.warn(
				`[symbols] ${name} has a Hold and Win role but no default art; bind it in /symbols`,
			);
			continue;
		}
		const states: SymbolsDoc['symbols'][string] = {};
		for (const [state, cell] of Object.entries(cells) as [SymbolState, DefaultCell][]) {
			states[state] = {
				type: cell.type,
				assetKey: cell.assetKey,
				...(cell.animationName ? { animationName: cell.animationName } : {}),
			};
		}
		if (Object.keys(states).length) symbols[name] = states;
	}
	return Object.keys(symbols).length ? { version: 1, symbols } : null;
}

/**
 * Load a project's PUBLISHED symbol defaults from R2, or `null` when the object
 * is missing or fails validation (parity with `loadPublishedEditorScenes` / a
 * missing doc — the caller then falls back to {@link symbolDefaultsFor}).
 */
export async function loadPublishedSymbolDefaults(
	clientKey: string,
	projectKey: string,
): Promise<SymbolDefaults | null> {
	const raw = await getObjectText(symbolDefaultsKey(clientKey, projectKey));
	if (!raw) return null;
	try {
		// A game vendoring the engine as a SUBMODULE publishes the state names ITS pinned commit
		// knows, so a game that has not bumped past the 2026-09-10 rename still ships
		// `tumbleExplosion`. The state records are keyed by `z.enum(SYMBOL_STATES)`, which REJECTS
		// an unlisted key — un-folded, that project's whole published grid would read as `null` and
		// silently fall back to the committed `lines` defaults.
		return parseSymbolDefaults(JSON.parse(raw));
	} catch {
		return null;
	}
}

/**
 * Validate a published map. Unknown keys AND unknown enum values are dropped on the publish as well as
 * on the load (`docs/conventions/doc-readers.md`): a game pinned to a newer engine may publish a cell
 * `type` this build does not know, and a refused publish is swallowed by the build's `--optional`,
 * leaving the grid on a stale set. Such a cell is dropped (its state shows no default); an unknown
 * `highlight.type` drops the highlight default.
 */
export function parseSymbolDefaults(input: unknown): SymbolDefaults {
	return symbolDefaultsSchema.parse(
		stripUnknownKeysWithWarning(
			symbolDefaultsSchema,
			migrateLegacySymbolStates(input),
			'symbol-defaults',
			'drop',
		),
	);
}

/** Persist a project's published symbol defaults to R2 (validates first). */
export async function savePublishedSymbolDefaults(
	clientKey: string,
	projectKey: string,
	data: unknown,
): Promise<SymbolDefaults> {
	// Folded on the WRITE too: an un-bumped game's `publish:symbols` would otherwise 400, and the
	// build swallows that under `--optional` — the silent double-fail this pipeline has been bitten
	// by before. See `migrateLegacySymbolStates`.
	const next = parseSymbolDefaults(data);
	await putObjectText(
		symbolDefaultsKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
	);
	return next;
}
