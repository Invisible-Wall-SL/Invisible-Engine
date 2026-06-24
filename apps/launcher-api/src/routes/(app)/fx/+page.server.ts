import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadRegionSet } from '$lib/server/editorRegions';
import { listEffects, loadEffect, type FxEffectRow, type FxMeta } from '$lib/server/fxStorage';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { resolveToolScope } from '$lib/server/toolScope';
import type { EffectDoc } from 'engine-fx';
import type { PageServerLoad } from './$types';

/**
 * Invisible FX — `/fx` (Phase 1, emitter-core authoring shell).
 *
 * The stage mounts its OWN WebGL `PIXI.Application` + a live `@barvynkoa/particle-emitter`
 * `Emitter` (touches `window`/canvas); SSR is pointless and fragile, the same call the
 * Scene Editor + Flow make. `load` still runs server-side: it streams the project's atlas
 * list (for the region picker), the saved-effect list (for the picker), and — when
 * `?effect=<id>` is present — the opened EffectDoc + its editor-only sidecar.
 */
export const ssr = false;

interface FxAtlas {
	/** Manifest R2 key — the value a layer keeps as `art.assetKey`. */
	manifestKey: string;
	label: string;
	regions: string[];
}

/**
 * Loader: auth + `fx`-scope gate (Invisible FX is now a registered tool — `roles.ts`), then
 * REUSE the launcher's atlas listing (`loadRegionSet` over the project's `manifests/*.json`
 * — the exact pattern the Rigger's `/api/rigger/atlases` uses) so the region picker can drive
 * a layer's `art.assetKey` + `art.frames`. The page reads regions + the page image through
 * the existing `/api/editor/regions` + `/api/editor/asset` (now `fx`-or-`editor` gated). The
 * saved-effect index + the optionally-opened effect come from `fxStorage` (the `/api/fx/save`
 * sibling read path).
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!roleHasTool(locals.user.role, 'fx')) {
		throw error(403, 'Your role does not have access to Invisible FX.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const basename = (k: string): string => {
		const i = k.lastIndexOf('/');
		return i === -1 ? k : k.slice(i + 1);
	};

	const manifestsPrefix = `${SUB.manifests(clientKey, projectKey)}/`;
	const listed = await listObjects(manifestsPrefix, 500);
	const manifestKeys = listed.keys.filter((k) => k.toLowerCase().endsWith('.json'));

	const atlases: FxAtlas[] = [];
	for (const manifestKey of manifestKeys) {
		const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
		if (!rs.regions.length || !rs.pageKey) continue; // unusable (no regions or no page)
		atlases.push({
			manifestKey,
			label: basename(manifestKey)
				.replace(/^atlas_manifest_/, '')
				.replace(/\.json$/i, ''),
			regions: rs.regions.map((r) => r.name),
		});
	}
	atlases.sort((a, b) => a.label.localeCompare(b.label));

	// Saved-effect index (for the picker) + the optionally-opened effect.
	const effects: FxEffectRow[] = await listEffects(clientKey, projectKey);
	const openId = url.searchParams.get('effect')?.trim() ?? '';
	let openedDoc: EffectDoc | null = null;
	let openedMeta: FxMeta | null = null;
	if (openId) {
		const { doc, meta } = await loadEffect(clientKey, projectKey, openId);
		openedDoc = doc;
		openedMeta = meta;
	}

	return { clientKey, projectKey, tools, atlases, effects, openedDoc, openedMeta };
};
