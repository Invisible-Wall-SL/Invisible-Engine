import { error, fail, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadComponent } from '$lib/server/componentStorage';
import { loadDoc as loadEditorDoc } from '$lib/server/editorStorage';
import { loadDocWithEtag, normalizeDoc, saveDoc } from '$lib/server/localization';
import type { LocalizationDoc } from '$lib/server/localization';
import {
	harvestSceneText,
	harvestSymbolNames,
	harvestWinText,
	reconcileWithEditor,
} from '$lib/server/localizationHarvest';
import { ConflictError } from '$lib/server/r2';
import { writeBaseEtagForm } from '$lib/server/writeGuard';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { TranslateError, translateBatch } from '$lib/server/translate';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { loadWinTextDoc } from '$lib/server/winTextStorage';
import type { Actions, PageServerLoad } from './$types';

/**
 * Auth + role gate for actions, where `await parent()` is unavailable so the
 * effective tool manifest must be recomputed. The loader instead reuses the
 * parent layout's already-resolved `tools` (see `load`). Returns `(client, project)`.
 */
async function gate(
	locals: App.Locals,
	cookies: import('@sveltejs/kit').Cookies,
	url: URL,
): Promise<{ clientKey: string; projectKey: string }> {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'localization', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Localization.');
	}
	// The save MUST target the SAME explicit project the page was loaded with.
	return resolveToolScope({ url, sessionToken: cookies.get(SESSION_COOKIE), user: locals.user });
}

/** Parse the `doc` form field (JSON) into a normalized document. */
function parseDocField(raw: FormDataEntryValue | null): LocalizationDoc {
	if (typeof raw !== 'string') throw new TranslateError('Missing document payload.');
	return normalizeDoc(JSON.parse(raw));
}

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'localization')) {
		throw error(403, 'Your role does not have access to Invisible Localization.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	// Auto-collect the project's text and fold it into the doc as read-only entries owned by the
	// tool that authored them: the Scene Editor's text nodes (grouped by scene), Invisible Win
	// Text's templates (one "Win text" section), and the Invisible Symbols State Machine's display
	// names (one "Symbol names" section). A missing doc on any side harvests nothing — the tool
	// behaves exactly as before.
	const [loaded, editorDoc, winTextDoc, symbolsDoc] = await Promise.all([
		loadDocWithEtag(clientKey, projectKey),
		loadEditorDoc(clientKey, projectKey),
		loadWinTextDoc(clientKey, projectKey),
		loadSymbolsDoc(clientKey, projectKey),
	]);
	// The client doc deliberately differs from the stored bytes (auto-collected entries
	// are folded in below), so the etag guards the stored OBJECT and must not be
	// re-derived from the payload.
	const { doc, etag: docEtag } = loaded;
	const sections = [
		...(await harvestSceneText(editorDoc, (id, version) => loadComponent(id, projectKey, version))),
		...harvestWinText(winTextDoc),
		...harvestSymbolNames(symbolsDoc),
	];
	const { entries, display } = reconcileWithEditor(doc, sections);
	// `clientKey` is threaded to the page for the Phase 2c soft edit-lease key
	// `(toolId, clientKey, projectKey, docKey)` — mirroring the other authoring tools.
	return { clientKey, projectKey, doc: { ...doc, entries }, docEtag, sections: display };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies, url }) => {
		const { clientKey, projectKey } = await gate(locals, cookies, url);
		const form = await request.formData();
		let doc: LocalizationDoc;
		try {
			doc = parseDocField(form.get('doc'));
		} catch {
			return fail(400, { error: 'Invalid document.' });
		}
		// `force` = the author answering the conflict banner with "overwrite theirs".
		const baseEtag = writeBaseEtagForm(form);
		// Don't persist untranslated AUTO-collected entries (`editor` scene text, `winText`
		// templates) — they're re-derived from their owning tool on every load, so storing the bare
		// source strings would just bloat the doc and leave stale rows when text is removed. Keep
		// any auto entry that has at least one translation (work to preserve) and every `manual`
		// entry as-is. Tests `=== 'manual'` rather than listing auto origins, so a future collector
		// can't silently start persisting bare sources.
		doc.entries = doc.entries.filter(
			(e) => e.origin === 'manual' || Object.values(e.translations).some((t) => t.text.trim()),
		);
		try {
			const { doc: saved, etag } = await saveDoc(clientKey, projectKey, doc, baseEtag);
			return { saved: true, updatedAt: saved.updatedAt, etag };
		} catch (e) {
			if (e instanceof ConflictError) {
				// `fail`, not `error()` — the client's envelope parser reads `out.error`.
				// The local doc stays on screen; nothing here may discard a reviewer's work.
				return fail(409, {
					error:
						'Someone else saved these strings while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
					conflict: true as const,
				});
			}
			throw e;
		}
	},

	translate: async ({ request, locals, cookies, url }) => {
		await gate(locals, cookies, url);
		let doc: LocalizationDoc;
		let ids: string[];
		try {
			const data = await request.formData();
			doc = parseDocField(data.get('doc'));
			const rawIds = data.get('ids');
			ids =
				typeof rawIds === 'string' && rawIds
					? (JSON.parse(rawIds) as string[]).filter((i): i is string => typeof i === 'string')
					: doc.entries.map((e) => e.id);
		} catch {
			return fail(400, { error: 'Invalid request.' });
		}

		const wanted = new Set(ids);
		const items = doc.entries
			.filter((e) => wanted.has(e.id) && e.source.trim())
			.map((e) => ({ id: e.id, source: e.source }));

		if (items.length === 0) return fail(400, { error: 'No source text to translate.' });
		if (doc.targetLangs.length === 0) return fail(400, { error: 'No target languages set.' });

		try {
			const result = await translateBatch({
				sourceLang: doc.sourceLang,
				targetLangs: doc.targetLangs,
				context: doc.context,
				items,
			});
			// Return raw translations marked unreviewed; the client merges + the
			// human saves. We never auto-persist machine output.
			return { translations: result };
		} catch (e) {
			if (e instanceof TranslateError) return fail(400, { error: e.message });
			return fail(502, { error: 'Translation failed. Please try again.' });
		}
	},
};
