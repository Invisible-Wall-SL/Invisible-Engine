import { localizationDocKey } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

/** One translated value for a target language; `reviewed` gates it for export. */
export interface LocalizationTranslation {
	text: string;
	reviewed: boolean;
}

/** A single source string (one table row) and its per-language translations. */
export interface LocalizationEntry {
	id: string;
	key: string;
	source: string;
	translations: Record<string, LocalizationTranslation>;
	/**
	 * Where this string came from — i.e. which tool OWNS the source text.
	 *
	 * `'editor'` = auto-collected from the project's Scene Editor text components.
	 * `'winText'` = auto-collected from Invisible Win Text's templates (`{count} OF A KIND`, …).
	 * `'symbols'` = auto-collected from the Invisible Symbols State Machine's display names
	 * (`SymbolsDoc.names`, e.g. `H1` → "Banana"/"Bananas").
	 * `'flow'` = auto-collected from Invisible Flow's `textMessage` node text (in-game prompts).
	 * `'gameConfig'` = auto-collected from Invisible Game Config's bet-mode copy — the buy-feature
	 * cards' title/description/button, the confirm dialog's body, and the HUD's bet-mode badge.
	 * `'uiText'` = the ENGINE's own coded UI strings (HUD captions, menus, modals, info-page rules).
	 * Project-independent — the shared runtime bundle owns them; each project translates them.
	 * All six are AUTO origins: the source is read-only here (the owning tool edits it), the rows
	 * are re-derived on every load, and an untranslated one is not persisted.
	 * `'manual'` = hand-authored in this table; this tool owns it, so it is editable and always
	 * persisted. Defaults to `'manual'` so legacy docs (no field) round-trip as before.
	 *
	 * Anything that is not `'manual'` is an auto origin — prefer testing for that rather than
	 * listing origins, so a future collector doesn't silently fall into the manual bucket.
	 */
	origin: 'manual' | 'editor' | 'winText' | 'symbols' | 'flow' | 'gameConfig' | 'uiText';
}

/** The whole per-project localization document stored as JSON in R2. */
export interface LocalizationDoc {
	sourceLang: string;
	targetLangs: string[];
	context: string;
	entries: LocalizationEntry[];
	updatedAt: string;
}

function emptyDoc(): LocalizationDoc {
	return { sourceLang: 'en', targetLangs: [], context: '', entries: [], updatedAt: '' };
}

/** Load a project's document, or a sensible empty default when none exists. */
export async function loadDoc(clientKey: string, projectKey: string): Promise<LocalizationDoc> {
	return (await loadDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * {@link loadDoc} plus the ETag its next save must match. `etag` is read off the
 * object, NOT inferred from a successful parse — a corrupt doc also returns
 * `emptyDoc()`, so treating "empty" as "absent" would send a create precondition and
 * 412 forever. `etag === null` means, and only means, no object.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: LocalizationDoc; etag: string | null }> {
	const obj = await getObjectTextWithEtag(localizationDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptyDoc(), etag: null };
	try {
		return { doc: normalizeDoc(JSON.parse(obj.text)), etag: obj.etag };
	} catch {
		return { doc: emptyDoc(), etag: obj.etag };
	}
}

/**
 * Persist a project's document to R2 (stamps `updatedAt`), guarded by `baseEtag` —
 * see `r2.precondition`. Throws `ConflictError` when another author saved first, so
 * a reviewer's approvals are never silently discarded by a stale tab. Returns the new
 * ETag.
 */
export async function saveDoc(
	clientKey: string,
	projectKey: string,
	doc: LocalizationDoc,
	baseEtag?: string | null,
): Promise<{ doc: LocalizationDoc; etag: string | null }> {
	const next = normalizeDoc(doc);
	next.updatedAt = new Date().toISOString();
	const etag = await putObjectText(
		localizationDocKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: next, etag };
}

/** Coerce arbitrary parsed/posted data into a valid document shape. */
export function normalizeDoc(input: unknown): LocalizationDoc {
	const obj = (input ?? {}) as Partial<LocalizationDoc>;
	const sourceLang = typeof obj.sourceLang === 'string' && obj.sourceLang ? obj.sourceLang : 'en';
	const targetLangs = Array.isArray(obj.targetLangs)
		? [...new Set(obj.targetLangs.filter((l): l is string => typeof l === 'string' && !!l))]
		: [];
	const context = typeof obj.context === 'string' ? obj.context : '';
	const entries = Array.isArray(obj.entries)
		? obj.entries.map((e) => normalizeEntry(e, targetLangs))
		: [];
	return { sourceLang, targetLangs, context, entries, updatedAt: '' };
}

function normalizeEntry(input: unknown, targetLangs: string[]): LocalizationEntry {
	const e = (input ?? {}) as Partial<LocalizationEntry>;
	const id = typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID();
	const key = typeof e.key === 'string' ? e.key : '';
	const source = typeof e.source === 'string' ? e.source : '';
	const translations: Record<string, LocalizationTranslation> = {};
	const src = (e.translations ?? {}) as Record<string, Partial<LocalizationTranslation>>;
	for (const lang of targetLangs) {
		const t = src[lang];
		if (t && typeof t.text === 'string') {
			translations[lang] = { text: t.text, reviewed: t.reviewed === true };
		}
	}
	const origin =
		e.origin === 'editor' ||
		e.origin === 'winText' ||
		e.origin === 'symbols' ||
		e.origin === 'flow' ||
		e.origin === 'gameConfig' ||
		e.origin === 'uiText'
			? e.origin
			: 'manual';
	return { id, key, source, translations, origin };
}
