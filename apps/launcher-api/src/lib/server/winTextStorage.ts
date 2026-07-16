import { z } from 'zod';
import type { WinTextDoc } from 'engine-layout';
import { winTextDocKey } from './projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * Invisible Win Text doc — the per-project TEMPLATES for every string the game says about a
 * win (win-line message, amount format, win-level tiers, info-bar toast), authored online and
 * shipped to the game through the bake.
 *
 * Pure config, no assets, so it needs no `deploy/` export step and travels verbatim (the
 * `symbols.winLine` precedent). SPARSE: only authored fields appear; everything unset falls
 * through to the coded `WIN_TEXT_DEFAULTS`, so an unauthored project renders byte-identically.
 * The schema therefore validates shape, not completeness.
 *
 * The TYPE + the defaults + the resolution order live in `engine-layout/winText.ts` (imported
 * above) because the game and this tool must agree; only the Zod validator lives here, so the
 * engine package stays dependency-free. The prune helpers below take their arguments as
 * `WinTextDoc[...]` and are fed the Zod-inferred type, so the two shapes drifting apart is a
 * type error rather than a silent dropped field.
 *
 * See `docs/design/invisible-win-text.md`.
 */

/** A single authored template. Blank is allowed and meaningful — it clears an override
 *  (pruned on save), and an empty template renders nothing. */
const templateSchema = z.string();

const lineMessageSchema = z
	.object({
		default: templateSchema.optional(),
		byCount: z.record(z.string().min(1), templateSchema).optional(),
		bySymbol: z.record(z.string().min(1), templateSchema).optional(),
		byCell: z.record(z.string().min(1), templateSchema).optional(),
	})
	.strict();

const toastSchema = z
	.object({
		full: templateSchema.optional(),
		amountOnly: templateSchema.optional(),
		countOnly: templateSchema.optional(),
	})
	.strict();

export const winTextDocSchema = z
	.object({
		version: z.literal(1).default(1),
		lineMessage: lineMessageSchema.optional(),
		amountFormat: templateSchema.optional(),
		winLevels: z.record(z.string().min(1), templateSchema).optional(),
		toast: toastSchema.optional(),
		updatedAt: z.string().optional(),
	})
	.strip();

/** The empty, valid doc a never-authored project degrades to. */
export function emptyWinTextDoc(): WinTextDoc {
	return { version: 1 };
}

/** Drop blank templates — a cleared field must round-trip to "unset" (and so fall back to the
 *  coded default) rather than persist `''`, which would render as an authored empty string. */
function pruneMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!map) return undefined;
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(map)) {
		if (value.trim()) next[key] = value;
	}
	return Object.keys(next).length ? next : undefined;
}

function pruneLineMessage(input: WinTextDoc['lineMessage']): WinTextDoc['lineMessage'] {
	if (!input) return undefined;
	const next: NonNullable<WinTextDoc['lineMessage']> = {};
	if (input.default?.trim()) next.default = input.default;
	const byCount = pruneMap(input.byCount);
	if (byCount) next.byCount = byCount;
	const bySymbol = pruneMap(input.bySymbol);
	if (bySymbol) next.bySymbol = bySymbol;
	const byCell = pruneMap(input.byCell);
	if (byCell) next.byCell = byCell;
	return Object.keys(next).length ? next : undefined;
}

function pruneToast(input: WinTextDoc['toast']): WinTextDoc['toast'] {
	if (!input) return undefined;
	const next: NonNullable<WinTextDoc['toast']> = {};
	if (input.full?.trim()) next.full = input.full;
	if (input.amountOnly?.trim()) next.amountOnly = input.amountOnly;
	if (input.countOnly?.trim()) next.countOnly = input.countOnly;
	return Object.keys(next).length ? next : undefined;
}

/**
 * Validate + normalize arbitrary parsed/posted data into a {@link WinTextDoc}, pruning blanks
 * so a reset round-trips to "unset". Throws `ZodError` on invalid input — the PUT endpoint maps
 * that to a 400.
 *
 * The rebuild below is an explicit WHITELIST: a field that passes Zod but isn't copied here is
 * still dropped on save. That is deliberate (it's the `normalizeSymbolsDoc` convention), but it
 * is also the silent round-trip trap — a NEW doc field must be added here too or it vanishes.
 */
export function normalizeWinTextDoc(input: unknown): WinTextDoc {
	const doc = winTextDocSchema.parse(input ?? {});
	const next: WinTextDoc = { version: 1 };
	const lineMessage = pruneLineMessage(doc.lineMessage);
	if (lineMessage) next.lineMessage = lineMessage;
	if (doc.amountFormat?.trim()) next.amountFormat = doc.amountFormat;
	const winLevels = pruneMap(doc.winLevels);
	if (winLevels) next.winLevels = winLevels;
	const toast = pruneToast(doc.toast);
	if (toast) next.toast = toast;
	return next;
}

/**
 * Load a project's win-text doc WITH its ETag — the read half of the conditional-write
 * contract (`docs/design/multi-user-concurrency.md`).
 *
 * `existed` is reported separately from the doc, and that separation is load-bearing rather than
 * ceremony: a MISSING object and a PRESENT-but-unparseable one both degrade to an empty doc, but
 * they need OPPOSITE preconditions. Collapsing them (returning "no doc" for both) would give a
 * corrupt `win-text.json` an `ifNoneMatch: '*'` precondition forever ⇒ 412 forever ⇒ the project
 * becomes permanently unsaveable with no way out from the UI. Carrying the corrupt object's ETag
 * lets it be deliberately overwritten.
 */
export async function loadWinTextDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: WinTextDoc; etag: string | null; existed: boolean }> {
	const obj = await getObjectTextWithEtag(winTextDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptyWinTextDoc(), etag: null, existed: false };
	try {
		return { doc: normalizeWinTextDoc(JSON.parse(obj.text)), etag: obj.etag, existed: true };
	} catch {
		return { doc: emptyWinTextDoc(), etag: obj.etag, existed: true };
	}
}

/** The doc alone — for readers with nothing to write back (the bake export, the runtime bundle,
 *  the Localization harvest). */
export async function loadWinTextDoc(clientKey: string, projectKey: string): Promise<WinTextDoc> {
	return (await loadWinTextDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * Persist a project's win-text doc to R2 (validates + stamps `updatedAt`).
 *
 * `baseEtag` is the precondition: a string ⇒ `If-Match` (fail if it changed since the author
 * loaded it), `null` ⇒ `If-None-Match: *` (fail if someone created it meanwhile), `undefined` ⇒
 * unconditional last-writer-wins. Throws {@link ConflictError} when the precondition loses — the
 * endpoint MUST map that to a 409 via `json()`, never `error()`.
 *
 * Without this, two authors on one project silently clobber each other's ENTIRE doc: the page
 * loads the whole doc and PUTs the whole doc, so the second save erases the first's work, not
 * just the conflicting cell. `updatedAt` alone can't catch it — it's stamped, never compared.
 */
export async function saveWinTextDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: WinTextDoc; etag: string | null }> {
	const next = normalizeWinTextDoc(doc);
	const stamped = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		winTextDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}

export { ConflictError };
