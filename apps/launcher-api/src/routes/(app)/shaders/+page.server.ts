import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import { mapWithConcurrency } from '$lib/server/concurrency';
import { loadRegionSet } from '$lib/server/editorRegions';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { canPublishSharedShaders, canWriteCustomGlsl } from '$lib/server/shaderScope';
import { listShaders, loadShader } from '$lib/server/shaderStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Shader Graph — `/shaders` (`docs/design/invisible-shader-graph.md` §8 step 5).
 *
 * The preview mounts its own WebGL `PIXI.Application`, so no SSR, as for `/fx`. The loader gates on
 * the `shaders` tool, then lists the project's graphs (its own and the studio-shared ones it does
 * not override), the project's atlases for the preview's region picker (the `/fx` listing over
 * `manifests/*.json`), and — with `?graph=<id>` — that graph and the ETag its next save must match.
 * A `?graph=` the project does not have (a stale link, a graph deleted since) opens nothing and
 * says so: a doc read from nothing has no Output, and the library cannot add one.
 */
export const ssr = false;

/** Manifests read at once for the region picker. */
const ATLAS_READS = 8;

export interface ShaderAtlas {
	manifestKey: string;
	label: string;
	regions: string[];
}

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'shaders')) {
		throw error(403, 'Your role does not have access to Invisible Shader Graph.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const openId = url.searchParams.get('graph')?.trim() ?? '';
	const openShared = url.searchParams.get('shared') === '1';
	const [shaders, manifests, opened, canPublishShared, canCustomGlsl] = await Promise.all([
		listShaders(clientKey, projectKey),
		listObjects(`${SUB.manifests(clientKey, projectKey)}/`, 500),
		openId ? loadShader(clientKey, projectKey, openId, openShared) : null,
		canPublishSharedShaders(locals),
		canWriteCustomGlsl(locals),
	]);

	const manifestKeys = manifests.keys.filter((k) => k.toLowerCase().endsWith('.json'));
	const sets = await mapWithConcurrency(manifestKeys, ATLAS_READS, (key) => loadRegionSet(key));
	const atlases: ShaderAtlas[] = manifestKeys
		.map((manifestKey, i) => ({ manifestKey, set: sets[i] }))
		.filter(({ set }) => set.regions.length > 0 && !!set.pageKey)
		.map(({ manifestKey, set }) => ({
			manifestKey,
			label: manifestKey
				.slice(manifestKey.lastIndexOf('/') + 1)
				.replace(/^atlas_manifest_/, '')
				.replace(/\.json$/i, ''),
			regions: set.regions.map((r) => r.name),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));

	return {
		clientKey,
		projectKey,
		tools,
		shaders,
		atlases,
		/** The graph `?graph=` opened, or null. A shared one opens with no ETag: saving it writes
		 *  the project its own copy. */
		opened: opened?.exists
			? { doc: opened.doc, etag: openShared ? null : opened.etag, shared: openShared }
			: null,
		/** A `?graph=` with no such graph. */
		missing: opened && !opened.exists ? openId : null,
		/** Holds `shaderPublish`: may publish to the studio library and remove from it (the API
		 *  checks it again; this only keeps the page from offering a button that 403s). */
		canPublishShared,
		/** Holds `shaderCustomGlsl`: may add Custom GLSL and change its code or ports (the save checks
		 *  it again). */
		canCustomGlsl,
	};
};
