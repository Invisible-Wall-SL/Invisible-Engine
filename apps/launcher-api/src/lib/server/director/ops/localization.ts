import {
	loadDocWithEtag,
	saveDoc,
	type LocalizationDoc,
	type LocalizationEntry,
} from '../../localization';
import { reconcileWithEditor } from '../../localizationHarvest';
import { harvestProjectSections } from '../../localizationSections';
import { localizationDocKey } from '../../projectPaths';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';

/**
 * Invisible Localization adapters (PLAN 2.6), through `localization.ts`: the tool's own load and
 * `saveDoc` (`If-Match`). Director writes SOURCE strings only. It never translates and never
 * marks a line reviewed — only reviewed lines ship, and reviewing is a person's job. A changed
 * source leaves its existing translations in place but unreviewed, since they translate the old
 * text. Rows another tool owns (scene text, win text, symbol names, …) are refused and listed:
 * their source is edited in that tool. Ownership is the page's own: the stored doc folded with the
 * project's harvested text (`harvestProjectSections` + `reconcileWithEditor`), so a key the harvest
 * produces is never shadowed by a manual row the next page load would take back.
 */

const KEY = '^[A-Za-z0-9_.:/-]{1,160}$';

/** The stored doc, refused when unreadable, and every row the page shows with its owner. */
async function loadStrings(ctx: AdapterContext) {
	const { clientKey, projectKey } = projectOf(ctx);
	const [loaded, sections] = await Promise.all([
		loadDocWithEtag(clientKey, projectKey),
		harvestProjectSections(clientKey, projectKey),
	]);
	if (loaded.corrupt) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			"The project's strings doc is unreadable. A person must repair it in Invisible Localization.",
		);
	}
	return { ...loaded, shown: reconcileWithEditor(loaded.doc, sections).entries };
}

const entrySummary = (e: LocalizationEntry) => ({
	key: e.key,
	source: e.source,
	origin: e.origin,
	translations: Object.fromEntries(
		Object.entries(e.translations).map(([lang, t]) => [lang, { reviewed: t.reviewed }]),
	),
});

export const getStrings = defineOp<
	Record<string, never>,
	{
		sourceLang: string;
		targetLangs: string[];
		protectedTerms: string[];
		strings: ReturnType<typeof entrySummary>[];
		baseEtag: string;
	}
>({
	tool: 'localization',
	name: 'get_strings',
	description:
		"The project's game strings as Invisible Localization shows them: key, source text, which tool owns it (`origin`; only `manual` rows are edited here), and per language whether its translation is reviewed. Plus the baseEtag to hand back to localization.update_strings.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['builder'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const { doc, etag, shown } = await loadStrings(ctx);
		return {
			sourceLang: doc.sourceLang,
			targetLangs: doc.targetLangs,
			protectedTerms: doc.protectedTerms,
			strings: shown.map(entrySummary),
			baseEtag: baseOf(etag),
		};
	},
});

export const updateStrings = defineOp<
	{ strings: { key: string; source: string }[]; baseEtag: string },
	{
		added: string[];
		changed: string[];
		unchanged: string[];
		refused: { key: string; reason: string }[];
		baseEtag: string;
	}
>({
	tool: 'localization',
	name: 'update_strings',
	description:
		'Add or change SOURCE strings (the source language only), keyed by `key`. Nothing is translated and nothing is marked reviewed: a changed string keeps its translations but they become unreviewed. Strings owned by another tool are refused and listed.',
	inputSchema: {
		type: 'object',
		properties: {
			strings: {
				type: 'array',
				maxItems: 200,
				items: {
					type: 'object',
					properties: {
						key: { type: 'string', pattern: KEY },
						source: { type: 'string', pattern: '\\S', maxLength: 2000 },
					},
					required: ['key', 'source'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['strings', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (_input, scope) => [localizationDocKey(scope.clientKey, scope.projectKey)],
	handler: async (ctx, { strings, baseEtag }) => {
		const keys = strings.map((s) => s.key);
		const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
		if (twice.length) {
			throw new AdapterError(
				400,
				'invalid_input',
				`Keys named twice: ${[...new Set(twice)].join(', ')}.`,
			);
		}
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, shown } = await loadStrings(ctx);
		const owner = new Map(shown.map((e) => [e.key, e.origin]));
		const entries = [...doc.entries];
		const out = {
			added: [] as string[],
			changed: [] as string[],
			unchanged: [] as string[],
			refused: [] as { key: string; reason: string }[],
		};
		for (const { key, source } of strings) {
			const at = entries.findIndex((e) => e.key === key);
			const current = entries[at];
			const origin = owner.get(key) ?? 'manual';
			if (origin !== 'manual') {
				out.refused.push({ key, reason: `owned by ${origin}: edit its source in that tool` });
			} else if (!current) {
				entries.push({ id: '', key, source, translations: {}, origin: 'manual' });
				out.added.push(key);
			} else if (current.source === source) {
				out.unchanged.push(key);
			} else {
				const translations = Object.fromEntries(
					Object.entries(current.translations).map(([lang, t]) => [
						lang,
						{ text: t.text, reviewed: false },
					]),
				);
				entries[at] = { ...current, source, translations };
				out.changed.push(key);
			}
		}
		if (out.added.length + out.changed.length === 0) return { ...out, baseEtag };
		const next: LocalizationDoc = { ...doc, entries };
		const saved = await saveDoc(clientKey, projectKey, next, preconditionOf(baseEtag), ctx.savedBy);
		return { ...out, baseEtag: baseOf(saved.etag) };
	},
});

export const LOCALIZATION_OPS = [getStrings, updateStrings];
