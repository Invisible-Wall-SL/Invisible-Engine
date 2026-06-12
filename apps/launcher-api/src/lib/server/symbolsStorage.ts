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

/** A single symbol×state binding — sprite frame or spine animation. */
const symbolCellSchema = z
	.object({
		type: z.enum(['sprite', 'spine']),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema,
	})
	.strict();

/** State → binding, sparse over the fixed v1 state set. */
const symbolStatesSchema = z.record(z.enum(SYMBOL_STATES), symbolCellSchema);

/** Symbol name → state → binding. Symbol keys are arbitrary, sparse. */
const symbolMapSchema = z.record(z.string().min(1), symbolStatesSchema);

export const symbolsDocSchema = z
	.object({
		version: z.literal(1).default(1),
		symbols: symbolMapSchema.default({}),
		updatedAt: z.string().optional(),
	})
	.strip();

export type SymbolCell = z.infer<typeof symbolCellSchema>;
export type SymbolsDoc = z.infer<typeof symbolsDocSchema>;

/** The empty, valid doc a never-authored project degrades to (parity with a missing editor doc). */
export function emptySymbolsDoc(): SymbolsDoc {
	return { version: 1, symbols: {} };
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
	return { version: 1, symbols };
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
