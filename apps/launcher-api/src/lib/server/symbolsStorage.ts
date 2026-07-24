import { z } from 'zod';
import { isManifestAssetKey, SYMBOL_STATES } from 'engine-layout';
import { createAtlasRefResolver } from './manifestBasename';
import { symbolsDocKey } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

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

/** The fixed v1 state set — re-exported from its ONE home in `engine-layout`.
 *  `bookIntro`/`bookIdle` are book-only (the tool gates their grid columns by game
 *  type — see the `/symbols` page), but the schema accepts them for EVERY game so a
 *  book game's authored/published bindings always round-trip. */
export { SYMBOL_STATES };

const sizeRatiosSchema = z.object({
	width: z.number(),
	height: z.number(),
});

/** A single symbol×state binding — a static sprite frame, a spine animation, or an Invisible
 *  Flipbook clip. `sizeRatios` is OPTIONAL on an override cell: absent means the cell inherits
 *  the doc-level `defaultSizeRatios` global (and, failing that, the coded map size).
 *
 *  `flipbook` exists because Spine was previously the ONLY way to animate a state: a `sprite`
 *  cell is one frozen frame, so any moving Spin/Land/Win had to be a skeleton. A frame animation
 *  off an atlas is far cheaper — and it is the cheaper fallback for the Tier-C spine-particle
 *  perf ceiling tracked in docs/status/fx.md.
 *
 *  A flipbook cell carries `clipId` instead of leaning on `assetKey`; the clip already names its
 *  own sheets (and may span several). `assetKey` stays required so a cell is never assetless —
 *  for a flipbook it holds the clip's primary sheet, which keeps every existing consumer that
 *  reads `assetKey` working. */
const symbolCellSchema = z
	.object({
		type: z.enum(['sprite', 'spine', 'flipbook']),
		assetKey: z.string().min(1),
		animationName: z.string().min(1).optional(),
		/** Required in practice for `type: 'flipbook'` — the authored clip this cell plays. */
		clipId: z.string().min(1).optional(),
		sizeRatios: sizeRatiosSchema.optional(),
	})
	.strict()
	.refine((c) => c.type !== 'flipbook' || !!c.clipId, {
		message: 'a flipbook cell needs a clipId',
		path: ['clipId'],
	});

/** State → binding, sparse over the fixed v1 state set. */
const symbolStatesSchema = z.record(z.enum(SYMBOL_STATES), symbolCellSchema);

/** Symbol name → state → binding. Symbol keys are arbitrary, sparse. */
const symbolMapSchema = z.record(z.string().min(1), symbolStatesSchema);

/**
 * A symbol's DISPLAY NAME — the human word the game says for the id (`H1` → "Banana"). Lives in
 * THIS doc because this tool already owns what a symbol is; Invisible Win Text reads it as
 * `{symbolName}` rather than keeping a second, drift-prone symbol list of its own.
 *
 * Both forms are authored and neither is auto-derived: `"{count} {symbolName}"` is read with a
 * number in front of it, and guessing an English `+s` produces "Cherrys" (and means nothing in a
 * translated build). `plural` unset falls back to `singular`, which is right for the many names
 * that don't inflect. See `engine-layout/symbolNames.ts` for the resolution both tools share.
 */
const symbolNameSchema = z
	.object({
		singular: z.string().min(1).optional(),
		plural: z.string().min(1).optional(),
	})
	.strict();

/** Symbol id → display name. Sparse: an unnamed symbol is simply absent and falls back to its id. */
const symbolNamesSchema = z.record(z.string().min(1), symbolNameSchema);

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

/**
 * Global free-spin BOARD-GLOW override — the reel-house backdrop spine behind the reels. Optional +
 * spine-only, mirroring {@link highlightCellSchema}: absent means the game keeps its coded
 * `reelhouse` glow, so an untouched project ships no `boardGlow` and renders byte-identical.
 *
 * `animations` names the coded start→idle→exit chain's three tracks (the engine still OWNS the
 * chaining; this only renames the animations it plays), each sparse — an unset one falls through to
 * its coded `reelhouse_glow_*` name, so a rig that only renames the loop needs one field.
 *
 * `sizeRatios` is the asset's OWN fit ratio against the board box (the coded spine's 0.62×0.66),
 * optional here — NOT a doc-level layout global. The doc-level `defaultSizeRatios` was deliberately
 * removed from this schema (design §S1) because reel LAYOUT belongs in the Scene Editor; this is the
 * per-asset ratio a swapped rig needs to fit the same box, the same thing `highlight.sizeRatios` is.
 */
const boardGlowSchema = z
	.object({
		type: z.literal('spine'),
		assetKey: z.string().min(1),
		animations: z
			.object({
				start: z.string().min(1).optional(),
				idle: z.string().min(1).optional(),
				exit: z.string().min(1).optional(),
			})
			.strict()
			.optional(),
		sizeRatios: sizeRatiosSchema.optional(),
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

/** Resting-board replay of the winning SYMBOLS (the game's `winSymbolCycle`): keep them
 *  animating until the next spin. `enabled` absent means ON; `delay` is the pause in SECONDS
 *  between two passes. Deliberately a SIBLING of `winLine`, not a field inside it — the replay
 *  never draws the line or its stamped amount, so turning the line off must not stop it. */
const winCycleSchema = z
	.object({
		enabled: z.boolean().optional(),
		delay: z.number().optional(),
	})
	.strict();

export const symbolsDocSchema = z
	.object({
		version: z.literal(1).default(1),
		symbols: symbolMapSchema.default({}),
		names: symbolNamesSchema.optional(),
		highlight: highlightCellSchema.optional(),
		boardGlow: boardGlowSchema.optional(),
		winLine: winLineSchema.optional(),
		winCycle: winCycleSchema.optional(),
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
	// Names: drop a blank/whitespace form and then a now-empty entry, so clearing the boxes leaves
	// no key and the symbol falls back to its id (the same sparse-round-trip rule as `symbols`).
	const names: SymbolsDoc['names'] = {};
	for (const [symbol, entry] of Object.entries(doc.names ?? {})) {
		const singular = entry?.singular?.trim();
		const plural = entry?.plural?.trim();
		const kept: NonNullable<SymbolsDoc['names']>[string] = {};
		if (singular) kept.singular = singular;
		if (plural) kept.plural = plural;
		if (Object.keys(kept).length) names[symbol] = kept;
	}
	const next: SymbolsDoc = { version: 1, symbols };
	// Sparse like every other optional field: a project that never named a symbol persists no
	// `names` key at all, so its doc stays byte-identical to before this existed.
	if (Object.keys(names).length) next.names = names;
	if (doc.highlight) next.highlight = doc.highlight;
	// Copied explicitly — this rebuild is a whitelist, so a field that passes Zod but isn't listed
	// here is still dropped on save (the silent round-trip trap).
	if (doc.boardGlow) next.boardGlow = doc.boardGlow;
	const winLine = pruneWinLine(doc.winLine);
	if (winLine) next.winLine = winLine;
	// Sparse like `winLine.enabled`: only the non-default (off) flag persists, but an authored
	// delay always does — its default is a number the author may legitimately re-pick.
	const winCycle: NonNullable<SymbolsDoc['winCycle']> = {};
	if (doc.winCycle?.enabled === false) winCycle.enabled = false;
	if (doc.winCycle?.delay !== undefined) winCycle.delay = doc.winCycle.delay;
	if (Object.keys(winCycle).length) next.winCycle = winCycle;
	return next;
}

/**
 * Load a project's symbols doc, falling back to an empty valid doc when the R2
 * object is missing or unparseable (parity with `loadDoc`).
 */
export async function loadSymbolsDoc(clientKey: string, projectKey: string): Promise<SymbolsDoc> {
	return (await loadSymbolsDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * {@link loadSymbolsDoc} plus the ETag its next save must match.
 *
 * `etag` comes off the READ, independent of whether the body parsed — a corrupt doc
 * also falls back to `emptySymbolsDoc()`, so inferring "create" from "empty doc" would
 * make it 412 forever. `etag === null` means, and only means, no object.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadSymbolsDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: SymbolsDoc; etag: string | null }> {
	const obj = await getObjectTextWithEtag(symbolsDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptySymbolsDoc(), etag: null };
	try {
		return { doc: normalizeSymbolsDoc(JSON.parse(obj.text)), etag: obj.etag };
	} catch {
		return { doc: emptySymbolsDoc(), etag: obj.etag };
	}
}

/** A sprite cell's assetKey that pins its atlas by a bare-basename scoped ref — `<basename>::region`
 *  where the basename has no `/`. `parseScopedFrameRef` refuses it (its `isManifestAssetKey` needs a
 *  `/`), so the runtime treats the whole thing as a bare region and the atlas-scoped lookup never
 *  engages — the same miss the flipbook clips had. Split it here so the manifest can be repaired. */
function splitNonManifestScopedRef(assetKey: string): { prefix: string; region: string } | null {
	const i = assetKey.indexOf('::');
	if (i <= 0) return null;
	const prefix = assetKey.slice(0, i);
	// A FULL `.json` manifest ref is already correct (the working `.json` scoped path). Only a bare
	// manifest basename (no `/`) or a Sheet-Maker OUTPUT PREFIX (`.../sheets/S_Lotus/`, no `.json`)
	// needs resolving to the real manifest key the sheet ships + registers under.
	if (isManifestAssetKey(prefix)) return null;
	return { prefix, region: assetKey.slice(i + 2) };
}

/**
 * Repair every SPRITE cell whose scoped `<prefix>::<region>` assetKey names its atlas by anything
 * OTHER than a full `.json` manifest key — a bare manifest basename OR a Sheet-Maker output prefix
 * (`.../sheets/S_Lotus/`) — by resolving the prefix to the real `.json` manifest the sheet ships +
 * registers under. Without this the flat `<prefix>::region` key the tool stored never lands in the
 * game's `loadedAssets` (the sprite renders blank), and same-named frames on DISTINCT atlases
 * collide. The export layer is the only place with the R2 listing to resolve a prefix → real key.
 *
 * Both forms go through the shared `createAtlasRefResolver` (the same resolution the Flipbook ship
 * path uses, and the same the region picker used to preview the sheet). A BARE (unscoped) ref
 * carries no atlas and is left as-is. Gated: a doc with only full-`.json` (or bare) refs pays
 * nothing. Non-sprite cells untouched.
 */
export async function canonicalizeSymbolsDocForExport(
	doc: SymbolsDoc,
	clientKey: string,
	projectKey: string,
): Promise<SymbolsDoc> {
	const prefixes = new Set<string>();
	for (const states of Object.values(doc.symbols)) {
		for (const cell of Object.values(states)) {
			if (cell?.type !== 'sprite') continue;
			const split = splitNonManifestScopedRef(cell.assetKey);
			if (split) prefixes.add(split.prefix);
		}
	}
	if (prefixes.size === 0) return doc;

	// Resolve each distinct prefix → its full `.json` manifest key. The shared resolver owns both
	// forms (bare basename via the project's manifest listing + the Sheet-Maker sheet folders;
	// output prefix by listing its own folder) and caches, so a prefix reused across
	// states/symbols costs one lookup — see `manifestBasename.ts`.
	const resolve = createAtlasRefResolver(clientKey, projectKey);
	const resolved = new Map<string, string>();
	for (const prefix of prefixes) {
		const manifest = await resolve(prefix);
		if (manifest !== prefix) resolved.set(prefix, manifest);
	}
	if (resolved.size === 0) return doc;

	const symbols: SymbolsDoc['symbols'] = {};
	for (const [name, states] of Object.entries(doc.symbols)) {
		const nextStates = { ...states } as Record<string, SymbolCell>;
		for (const [state, cell] of Object.entries(nextStates)) {
			if (cell.type !== 'sprite') continue;
			const split = splitNonManifestScopedRef(cell.assetKey);
			const manifest = split && resolved.get(split.prefix);
			if (split && manifest)
				nextStates[state] = { ...cell, assetKey: `${manifest}::${split.region}` };
		}
		symbols[name] = nextStates as SymbolsDoc['symbols'][string];
	}
	return { ...doc, symbols };
}

/**
 * Persist a project's symbols doc to R2 (validates + stamps `updatedAt`), guarded by
 * `baseEtag` — see `r2.precondition` for the convention. Throws `ConflictError` when
 * another author saved first; returns the new ETag.
 */
export async function saveSymbolsDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: SymbolsDoc; etag: string | null }> {
	const next = normalizeSymbolsDoc(doc);
	const stamped = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		symbolsDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}
