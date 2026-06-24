import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadRegionSet } from '$lib/server/editorRegions';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible FX — `/fx` (Phase 1, emitter-core preview shell).
 *
 * The stage mounts its OWN WebGL `PIXI.Application` + a live `@barvynkoa/particle-emitter`
 * `Emitter` (touches `window`/canvas); SSR is pointless and fragile, the same call the
 * Scene Editor + Flow make. `load` still runs server-side and streams the project's atlas
 * list; only the component render is client-only.
 */
export const ssr = false;

interface FxAtlas {
	/** Manifest R2 key — the value a layer keeps as `art.assetKey`. */
	manifestKey: string;
	label: string;
	regions: string[];
}

/**
 * Loader: auth + EDITOR-scope gate (Invisible FX is UNREGISTERED in `roles.ts` until the
 * real saveable page ships, so it rides the existing `editor` scope — same surface the
 * Scene Editor authors against, no new auth/tool id), then REUSE the launcher's atlas
 * listing (`loadRegionSet` over the project's `manifests/*.json` — the exact pattern the
 * Rigger's `/api/rigger/atlases` uses) so the region picker can drive a layer's
 * `art.assetKey` + `art.frames`. No new shared surface; the page reads regions + the page
 * image through the existing `editor`-gated `/api/editor/regions` + `/api/editor/asset`.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!roleHasTool(locals.user.role, 'editor')) {
		throw error(403, 'Your role does not have access to Invisible FX.');
	}
	void tools;
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

	return { clientKey, projectKey, tools, atlases };
};
