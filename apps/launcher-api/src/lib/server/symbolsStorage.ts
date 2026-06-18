import { z } from 'zod';
import { symbolsDocKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

/**
 * Invisible Symbols State Machine doc — the per-project symbol→state→asset
 * binding map authored online and shipped to the game through the deploy chain
 * (export → deploy → bake → pull → register). The doc is the data-driven twin of
 * each game's coded `SYMBOL_INFO_MAP` and is merged OVER it cell-by-cell, so it
 * is SPARSE: only edited symbols/states appear; everything unset falls through
 * to the coded default. The schema below therefore validates shape, not
 * completeness. Mirrors `apps/lines/src/game/types.ts#SymbolInfoMap` (the engine
 * S1 contract) — keep the two in step.
 *
 * Schema lives here so S4's exporter (`symbolExport.ts`) and the S3 tool
 * endpoints can both import one source of truth.
 * See `docs/design/invisible-symbols-state-machine.md`.
 */

/** The fixed v1 state set (matches `SYMBOL_STATES` in `apps/lines/src/game/types.ts`). */
export const SYMBOL_STATES = [
	'static',
	'spin',
	'land',
	'win',
	'postWinStatic',
	'explosion',
] as const;

const sizeRatiosSchema = z.object({
	width: z.number(),
	height: z.number(),
});

/** A single symbol×state binding — sprite frame or spine animation. `sizeRatios` is
 *  OPTIONAL on an override cell: absent means the cell inherits the doc-level
 *  `defaultSizeRatios` global (and, failing that, the coded map size). */
const symbolCellSchema = z
	.object({
		type: z.enum(['sprite', 'spine']),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema.optional(),
	})
	.strict();

/** State → binding, sparse over the fixed v1 state set. */
const symbolStatesSchema = z.record(z.enum(SYMBOL_STATES), symbolCellSchema);

/** Symbol name → state → binding. Symbol keys are arbitrary, sparse. */
const symbolMapSchema = z.record(z.string().min(1), symbolStatesSchema);

/** Global win-frame ("highlight") override — a single spine that loops over winning
 *  symbols. Optional + spine-only: absent means the game uses its built-in default. */
const highlightCellSchema = z
	.object({
		type: z.literal('spine'),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema,
	})
	.strict();

/** Win-line overlay config (Invisible Symbols State Machine). All fields optional and
 *  sparse — anything unset falls through to the game's coded defaults, so an untouched
 *  project ships no `winLine` and renders byte-identical. `enabled` absent means ON;
 *  `{ enabled: false }` turns the overlay OFF. Colours are CSS hex strings (Pixi 8
 *  `ColorSource` consumes them directly); `width`/`size` are multiples of the symbol
 *  size; `speed` is a draw-speed multiplier. No assets here — the chosen `text.font`
 *  travels via the existing font pipeline. */
const winLineLineSchema = z
	.object({
		color: z.string().optional(),
		width: z.number().optional(),
		glow: z.boolean().optional(),
		glowColor: z.string().optional(),
		animated: z.boolean().optional(),
		speed: z.number().optional(),
	})
	.strict();

const winLineTextSchema = z
	.object({
		font: z.string().optional(),
		size: z.number().optional(),
		color: z.string().optional(),
	})
	.strict();

const winLineSchema = z
	.object({
		enabled: z.boolean().optional(),
		line: winLineLineSchema.optional(),
		text: winLineTextSchema.optional(),
	})
	.strict();

export const symbolsDocSchema = z
	.object({
		version: z.literal(1).default(1),
		symbols: symbolMapSchema.default({}),
		/** Global symbol size every symbol inherits unless a cell sets its own `sizeRatios`.
		 *  Optional + sparse: absent → cells fall through to the coded map size. */
		defaultSizeRatios: sizeRatiosSchema.optional(),
		highlight: highlightCellSchema.optional(),
		winLine: winLineSchema.optional(),
		updatedAt: z.string().optional(),
	})
	.strip();

export type SymbolCell = z.infer<typeof symbolCellSchema>;
export type SymbolsDoc = z.infer<typeof symbolsDocSchema>;

/** The empty, valid doc a never-authored project degrades to (parity with a missing editor doc). */
export function emptySymbolsDoc(): SymbolsDoc {
	return { version: 1, symbols: {} };
}

/** Drop empty `line`/`text` style objects and a now-empty `winLine`, so a reset
 *  round-trips to "no winLine" (sparse) rather than persisting `{}`. */
function pruneWinLine(winLine: SymbolsDoc['winLine']): SymbolsDoc['winLine'] {
	if (!winLine) return undefined;
	const next: NonNullable<SymbolsDoc['winLine']> = {};
	if (winLine.enabled === false) next.enabled = false;
	if (winLine.line && Object.keys(winLine.line).length) next.line = winLine.line;
	if (winLine.text && Object.keys(winLine.text).length) next.text = winLine.text;
	return Object.keys(next).length ? next : undefined;
}

/**
 * Validate + normalize arbitrary parsed/posted data into a {@link SymbolsDoc}.
 * Drops empty `symbols` entries (a symbol with no remaining states) so a delete
 * round-trip leaves no dangling keys. Throws `ZodError` on invalid input — the
 * PUT endpoint maps that to a 400.
 */
export function normalizeSymbolsDoc(input: unknown): SymbolsDoc {
	const doc = symbolsDocSchema.parse(input ?? {});
	const symbols: SymbolsDoc['symbols'] = {};
	for (const [name, states] of Object.entries(doc.symbols)) {
		if (states && Object.keys(states).length > 0) symbols[name] = states;
	}
	const next: SymbolsDoc = { version: 1, symbols };
	if (doc.defaultSizeRatios) next.defaultSizeRatios = doc.defaultSizeRatios;
	if (doc.highlight) next.highlight = doc.highlight;
	const winLine = pruneWinLine(doc.winLine);
	if (winLine) next.winLine = winLine;
	return next;
}

/**
 * Load a project's symbols doc, falling back to an empty valid doc when the R2
 * object is missing or unparseable (parity with `loadDoc`).
 */
export async function loadSymbolsDoc(
	clientKey: string,
	projectKey: string,
): Promise<SymbolsDoc> {
	const raw = await getObjectText(symbolsDocKey(clientKey, projectKey));
	if (!raw) return emptySymbolsDoc();
	try {
		return normalizeSymbolsDoc(JSON.parse(raw));
	} catch {
		return emptySymbolsDoc();
	}
}

/** Persist a project's symbols doc to R2 (validates + stamps `updatedAt`). */
export async function saveSymbolsDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
): Promise<SymbolsDoc> {
	const next = normalizeSymbolsDoc(doc);
	const stamped = { ...next, updatedAt: new Date().toISOString() };
	await putObjectText(
		symbolsDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
	);
	return stamped;
}
