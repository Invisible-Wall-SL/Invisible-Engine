import { z } from 'zod';
import { symbolDefaultsKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';
import { SYMBOL_STATES, type SymbolCell } from './symbolsStorage';
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
 *  2. OFFLINE FALLBACK — the committed `$lib/data/symbolDefaults/lines.json`,
 *     used for `apps/lines` dev and any project that has not published yet.
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
	.strict();

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
};

const FALLBACK_GAME = 'lines';

/**
 * Resolve the OFFLINE coded defaults for a game type, falling back to `lines`
 * (v1). This is the fallback when a project has not published its own map.
 */
export function symbolDefaultsFor(gameType: string | undefined): SymbolDefaults {
	return DEFAULTS_BY_GAME[gameType ?? FALLBACK_GAME] ?? DEFAULTS_BY_GAME[FALLBACK_GAME];
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
		return symbolDefaultsSchema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

/** Persist a project's published symbol defaults to R2 (validates first). */
export async function savePublishedSymbolDefaults(
	clientKey: string,
	projectKey: string,
	data: unknown,
): Promise<SymbolDefaults> {
	const next = symbolDefaultsSchema.parse(data);
	await putObjectText(
		symbolDefaultsKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
	);
	return next;
}
