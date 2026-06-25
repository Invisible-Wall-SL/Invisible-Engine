import { localizationDocKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

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
	 * Where this string came from. `'editor'` entries are auto-collected from the
	 * project's Scene Editor text components (the source is read-only — the editor
	 * owns it); `'manual'` entries are hand-authored in the Localization table.
	 * Defaults to `'manual'` so legacy docs (no field) round-trip as before.
	 */
	origin: 'manual' | 'editor';
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
	const raw = await getObjectText(localizationDocKey(clientKey, projectKey));
	if (!raw) return emptyDoc();
	try {
		return normalizeDoc(JSON.parse(raw));
	} catch {
		return emptyDoc();
	}
}

/** Persist a project's document to R2 (stamps `updatedAt`). */
export async function saveDoc(
	clientKey: string,
	projectKey: string,
	doc: LocalizationDoc,
): Promise<LocalizationDoc> {
	const next = normalizeDoc(doc);
	next.updatedAt = new Date().toISOString();
	await putObjectText(
		localizationDocKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
	);
	return next;
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
	const origin = e.origin === 'editor' ? 'editor' : 'manual';
	return { id, key, source, translations, origin };
}
