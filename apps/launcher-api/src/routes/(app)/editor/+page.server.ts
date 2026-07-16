import { error, fail, redirect } from '@sveltejs/kit';
import {
	findUnfilledRequiredSlots,
	getFullSceneSet,
	reelGridWarnings,
	type LayoutDoc,
} from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { loadDocWithEtag, saveDoc } from '$lib/server/editorStorage';
import { listKinds } from '$lib/server/kindStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { ConflictError, formBaseEtag } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { loadTemplate } from '$lib/server/templateStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

/**
 * The editor is a client-only canvas/WebGL app (pixi-like 2D canvas + a spine
 * WebGL preview). Server-rendering it is pointless AND fragile — certain saved
 * docs made the SSR render throw a 500 even though the `load` data was fine.
 * Disable SSR: `load` still runs server-side (data flows to the client), only
 * the component render is client-only. Fixes the 500 + is the right call here.
 */
export const ssr = false;

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
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	// The save MUST target the SAME explicit project the page was loaded with, so the
	// action resolves scope from its own `url` (`?project=`) — not the session alone.
	return resolveToolScope({ url, sessionToken: cookies.get(SESSION_COOKIE), user: locals.user });
}

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'editor')) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	// The project's resolved game type, fetched ONCE — drives both the fresh-doc
	// canvas-box seed (a never-saved project gets the game's REAL main box) and the
	// template/symbol-default resolution below (the doc's own `gameType` wins when set).
	const resolvedProjectGameType = await projectGameType(projectKey);
	const [loaded, assets, components, customKinds, symbolsDoc, publishedSymbolDefaults] =
		await Promise.all([
			loadDocWithEtag(clientKey, projectKey, resolvedProjectGameType),
			listProjectAssets(clientKey, projectKey),
			// Components the project can use (shared + project, project shadowing shared,
			// §8.3). Drives the scene-mode component picker AND the editor canvas's
			// `componentInstance` resolution (passed down so the canvas renders an
			// instance's `root` without calling the engine registry).
			listComponents({ projectKey }),
			// Author-created custom game KINDS (§21): shared, engine-skeleton `LayoutDoc`s
			// that join the built-in kinds in the "New game from kind" picker so a new kind
			// needs no code change. The picker fetches a chosen custom kind's doc on demand.
			listKinds(),
			// The Symbols State Machine override doc + the project's PUBLISHED coded symbol
			// defaults — so the canvas can draw the REAL static symbol art in each reel cell
			// (mirrors symbols/+page.server.ts). Both degrade gracefully to a fallback.
			loadSymbolsDoc(clientKey, projectKey),
			loadPublishedSymbolDefaults(clientKey, projectKey),
		]);
	// `docEtag` is what the client must send back on save so a concurrent author can't
	// be clobbered; `null` means the doc does not exist yet (a create). It is carried
	// separately from `doc` because a corrupt-but-present doc still HAS an etag — see
	// `loadDocWithEtag`.
	const { doc, etag: docEtag } = loaded;
	// Template + initial slot warnings, so the UI shows slot state on first load
	// (§7.1) — not only after a save round-trip. Resolve from the doc's persisted
	// `gameType` first (the author's choice sticks across sessions), falling back
	// to the project's resolved game type when the doc predates that field.
	const resolvedGameType = doc.gameType ?? resolvedProjectGameType;
	const template = await loadTemplate(resolvedGameType);
	const warnings = template
		? [...findUnfilledRequiredSlots(doc, template), ...reelGridWarnings(doc, template)]
		: [];
	// The project display name — the default for the HUD game-name (shown in the
	// editor as a fallback, NOT written to the doc, so it tracks the project name
	// until the author types an explicit override).
	const gameName = await projectName(projectKey);
	// Resolve the symbol set the canvas draws: the project's PUBLISHED coded map when
	// available, else the committed coded defaults for the resolved game type. The
	// override doc above is layered on top per-cell in the client (parity with the tool).
	const symbolDefaults = publishedSymbolDefaults ?? symbolDefaultsFor(resolvedGameType);
	// The game-type reference's canonical canvas box — passed to the client so the
	// editor can flag a doc whose `mainSizesMap` differs from the game's REAL main
	// box (and offer a one-click "Match game box" fix). Plain JSON, safe to clone.
	const referenceMainSizes = getFullSceneSet(resolvedGameType)?.mainSizesMap ?? null;
	// Content checks (missing/unassigned asset references) are computed live in the
	// client (`+page.svelte`) from `assets`, since they must track edits before any
	// save and `$lib/server` can't enter the browser bundle — no server copy here.
	return {
		clientKey,
		projectKey,
		doc,
		docEtag,
		assets,
		template,
		warnings,
		gameName,
		components,
		customKinds,
		symbolDefaults,
		symbolsDoc,
		referenceMainSizes,
	};
};

export const actions: Actions = {
	save: async ({ request, locals, cookies, url }) => {
		const { clientKey, projectKey } = await gate(locals, cookies, url);
		const form = await request.formData();
		const raw = form.get('doc');
		if (typeof raw !== 'string') {
			return fail(400, { action: 'save' as const, error: 'Missing doc payload.' });
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return fail(400, { action: 'save' as const, error: 'Invalid doc.' });
		}
		// `force` is the author answering the conflict banner with "overwrite theirs" —
		// the ONLY legitimate way to reach an unconditional write from a browser. It is
		// deliberately a separate field rather than an omitted etag, so an unguarded
		// write is always an explicit choice in the payload, never an accident.
		const baseEtag = form.get('force') === '1' ? undefined : formBaseEtag(form.get('baseEtag'));

		let saved: LayoutDoc;
		let etag: string | null;
		try {
			// `saveDoc` normalizes + stamps `updatedAt`, so the wire payload is the
			// only validation barrier we need.
			({ doc: saved, etag } = await saveDoc(clientKey, projectKey, parsed as LayoutDoc, baseEtag));
		} catch (e) {
			if (e instanceof ConflictError) {
				// Someone else saved this project since this tab loaded it. Refuse rather
				// than overwrite their work — and return `fail`, NOT `error()`, so the
				// client's envelope parser can read the reason. The client keeps its local
				// doc and stays dirty; nothing here may discard it.
				return fail(409, {
					action: 'save' as const,
					error:
						'Someone else saved this project while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
					conflict: true as const,
				});
			}
			throw e;
		}
		// Non-blocking template validation (§7.1): flag any required slot the
		// saved doc leaves unfilled, surfaced to the editor without rejecting.
		const template = await loadTemplate(saved.gameType ?? (await projectGameType(projectKey)));
		const warnings = template
			? [...findUnfilledRequiredSlots(saved, template), ...reelGridWarnings(saved, template)]
			: [];
		return {
			action: 'save' as const,
			saved: true,
			updatedAt: saved.updatedAt,
			etag,
			warnings,
		};
	},
};
