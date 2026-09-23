import { error, fail, redirect } from '@sveltejs/kit';
import {
	findUnfilledRequiredSlots,
	getFullSceneSet,
	reelGridWarnings,
	type GridDimensions,
	type LayoutDoc,
} from 'engine-layout';
import { resolveBetModes, resolveGrid, resolveWinLevels, type GameConfigDoc } from 'game-config';
import type { RepeaterSourceMap, RepeaterSourcePreview } from './editorCanvas.helpers';
import {
	AUTO_SPINS_TEXT_OPTIONS,
	LOSS_LIMIT_TEXT_OPTIONS,
	SINGLE_WIN_LIMIT_TEXT_OPTIONS,
} from 'constants-shared/autoSpins';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import {
	keyComponentDefaultsById,
	listComponentDefaults,
} from '$lib/server/componentDefaultsStorage';
import { listComponents } from '$lib/server/componentStorage';
import { loadDocWithEtag, saveDoc } from '$lib/server/editorStorage';
import { listKinds } from '$lib/server/kindStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { ConflictError } from '$lib/server/r2';
import { writeBaseEtagForm } from '$lib/server/writeGuard';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { resolveLayoutProfile } from '$lib/server/layoutProfile';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { loadTemplate, loadTemplateWithEtag } from '$lib/server/templateStorage';
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

/**
 * The board grid COUNT the editor draws and validates against, from the project's authored Game
 * Config — `{ reels, rows }` as before, plus the per-column shape when the grid is STEPPED
 * (docs/design/stepped-grid.md).
 *
 * `rowsPerReel`/`rowOffsets` come from `resolveGrid`, the SAME resolver the game runs, rather than
 * from a second reading of `numRows` here. The alignment rule (where a short column sits in the
 * bounding box) then has one implementation, so the editor cannot preview a board the game will not
 * draw. Omitted entirely for a uniform grid, so the preview takes its existing rectangular path.
 */
function gridDimensionsOf(doc: GameConfigDoc | null | undefined): GridDimensions | undefined {
	if (!doc) return undefined;
	const grid = resolveGrid(doc);
	if (!grid.stepped) return { reels: grid.reels, rows: grid.maxRows };
	return {
		reels: grid.reels,
		rows: grid.maxRows,
		rowsPerReel: grid.rows,
		rowOffsets: grid.rows.map((_r, i) => grid.rowOffsetForReel(i)),
	};
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
	const [
		loaded,
		assets,
		components,
		storedComponentDefaults,
		customKinds,
		symbolsDoc,
		publishedSymbolDefaults,
	] = await Promise.all([
		loadDocWithEtag(clientKey, projectKey, resolvedProjectGameType),
		listProjectAssets(clientKey, projectKey),
		// Components the project can use (shared + project, project shadowing shared,
		// §8.3). Drives the scene-mode component picker AND the editor canvas's
		// `componentInstance` resolution (passed down so the canvas renders an
		// instance's `root` without calling the engine registry).
		listComponents({ projectKey }),
		// Per-project component DEFAULTS (§13.3) — the `projectDefaults` layer
		// `resolveComponentParams` applies under each placed instance's own params. The
		// canvas needs it to preview what the GAME renders (the runtime registers the same
		// map via `/api/editor/doc`); without it a shared def's per-project appearance is
		// invisible here. Re-keyed onto the real def ids below.
		listComponentDefaults(projectKey),
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
	// `templateEtag` guards the GLOBAL `_shared/editor-templates/<gameType>.json`;
	// null = no R2 override yet (the built-in fallback), so a save creates.
	const { template, etag: templateEtag } = await loadTemplateWithEtag(resolvedGameType);
	// The board grid COUNT comes from the project's authored Game Config (numReels/numRows) — the
	// same source the game runs on — so the editor preview draws the real grid and the reelGrid node
	// is validated against it. `resolveGameConfig` prefers the authored doc, else the game-type
	// template default; `null` (no default at all) ⇒ the reelGrid node keeps its own reels/rows.
	const { doc: gameConfigDoc } = await resolveGameConfig(clientKey, projectKey, resolvedGameType);
	const gridDimensions = gridDimensionsOf(gameConfigDoc);
	// The `win` component authors its per-tier PRESENTATION (spine/animations/duration/sound) from the
	// config's BIG tiers, keyed by alias — so the component's groups mirror the config. Null when the
	// project hasn't authored `winLevels` ⇒ the client keeps the built-in default tiers (byte-identical).
	const winTiers = gameConfigDoc
		? (resolveWinLevels(gameConfigDoc)
				?.filter((tier) => tier.type === 'big')
				.map((tier) => ({ alias: tier.alias, name: tier.name || tier.alias })) ?? null)
		: null;
	// The `repeater` node can't run its live `source` array in the editor, so we resolve each known
	// source's SAMPLE data from the config here. `featureCards` mirrors the runtime `registerBuyFeature`
	// feed: one card per NON-default bet mode (`resolveBetModes` filtered to non-`base` kinds), fed the
	// SAME per-item values the runtime feeds (title/description/price/buttonLabel/iconKey). `price` uses a
	// SAMPLE base bet (the live bet isn't known in the editor), so it reads as an illustrative figure.
	// A resolver keyed by source name keeps this extensible + safe: an unknown source, or no non-default
	// mode, is simply absent from the map ⇒ the canvas keeps its fixed fallback sample (parity).
	const SAMPLE_BASE_BET = 1;
	const featureCardModes = gameConfigDoc
		? resolveBetModes(gameConfigDoc).filter((mode) => mode.kind !== 'base')
		: [];
	const repeaterSources: RepeaterSourceMap = {};
	if (featureCardModes.length > 0) {
		repeaterSources.featureCards = {
			count: featureCardModes.length,
			items: featureCardModes.map((mode) => ({
				title: mode.title,
				description: mode.description,
				price: '$' + (SAMPLE_BASE_BET * mode.costMultiplier).toFixed(2),
				buttonLabel: mode.button,
				iconKey: mode.art.icon,
			})),
		};
	}
	// The HUD-menu ladders. Unlike `featureCards` these aren't config-derived: the bet ladder comes
	// from the RGS at runtime and the autoplay ladders are engine constants, so neither is knowable
	// here. The sample is a representative ladder of the right LENGTH and shape, which is what the
	// placeholder needs — it sizes and counts the grid an author is laying out, nothing more.
	const optionItems = (labels: readonly string[]): RepeaterSourcePreview => ({
		count: labels.length,
		items: labels.map((label, index) => ({ label, selected: index === 0 })),
	});
	repeaterSources.betOptions = optionItems([
		'1.00',
		'2.00',
		'5.00',
		'10.00',
		'20.00',
		'50.00',
		'100.00',
		'200.00',
		'MAX',
	]);
	repeaterSources.autoSpinOptions = optionItems([...AUTO_SPINS_TEXT_OPTIONS]);
	repeaterSources.autoSpinLossLimitOptions = optionItems([...LOSS_LIMIT_TEXT_OPTIONS]);
	repeaterSources.autoSpinWinLimitOptions = optionItems([...SINGLE_WIN_LIMIT_TEXT_OPTIONS]);
	const warnings = template
		? [...findUnfilledRequiredSlots(doc, template), ...reelGridWarnings(doc, gridDimensions)]
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
	// The layout profile this project INHERITS when it authors no override — the admin
	// global default, else the coded DEFAULT_LAYOUT_PROFILE. The client seeds the Layout
	// editor from this and compares the doc's override against it to save it sparsely
	// (omit when identical). `source` is 'global' | 'default' here (project layer skipped).
	const { profile: inheritedLayoutProfile, source: inheritedLayoutSource } =
		await resolveLayoutProfile();
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
		templateEtag,
		warnings,
		gameName,
		components,
		// Re-keyed onto the real def ids: a sidecar's filename is `r2Slug(id)`, so the raw
		// listing keys `hudReadout` as `hudreadout` and `componentDefaults[def.id]` would miss.
		componentDefaults: keyComponentDefaultsById(
			storedComponentDefaults,
			components.map((c) => c.id),
		),
		customKinds,
		symbolDefaults,
		symbolsDoc,
		referenceMainSizes,
		inheritedLayoutProfile,
		inheritedLayoutSource,
		// The authored board grid the canvas draws the reelGrid at (config's numReels/numRows). Null
		// when no config resolves ⇒ the canvas falls back to the reelGrid node's own reels/rows.
		gridDimensions: gridDimensions ?? null,
		// The config's BIG tiers (alias + display name) the `win` component builds its per-tier
		// presentation groups from. Null ⇒ the built-in default tiers (byte-identical).
		winTiers,
		// Per-source SAMPLE data for `repeater` placeholders (currently `featureCards` → the config's
		// non-default bet modes). Empty ⇒ every repeater keeps its fixed fallback sample (parity).
		repeaterSources,
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
		const baseEtag = writeBaseEtagForm(form);
		// `backup: 'always'` = "this save is committing a DESTRUCTIVE layout swap" (a scaffold /
		// custom-kind / reference load the author accepted). Those are exactly the writes someone
		// wants back, and they are rare, so they bypass the autosave coalescing window in
		// `editorDocBackups.ts`. The client asserts it; the default is `'auto'`, so a tab running
		// an older bundle simply gets the ordinary coalesced backup rather than none.
		const backup = form.get('backup') === 'always' ? 'always' : 'auto';

		let saved: LayoutDoc;
		let etag: string | null;
		try {
			// `saveDoc` normalizes + stamps `updatedAt`, so the wire payload is the
			// only validation barrier we need.
			({ doc: saved, etag } = await saveDoc(
				clientKey,
				projectKey,
				parsed as LayoutDoc,
				baseEtag,
				backup,
			));
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
		const savedGameType = saved.gameType ?? (await projectGameType(projectKey));
		const template = await loadTemplate(savedGameType);
		// Same config-grid source as the load, so the save round-trip re-checks the reelGrid node
		// against the authored numReels/numRows rather than a stale template board.
		const { doc: savedGameConfig } = await resolveGameConfig(clientKey, projectKey, savedGameType);
		const savedGrid = gridDimensionsOf(savedGameConfig);
		const warnings = template
			? [...findUnfilledRequiredSlots(saved, template), ...reelGridWarnings(saved, savedGrid)]
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
