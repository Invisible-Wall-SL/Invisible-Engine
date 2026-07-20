import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadRegionSet } from '$lib/server/editorRegions';
import { listClips, loadClip, type FlipbookClipRow } from '$lib/server/flipbookStorage';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { resolveToolScope } from '$lib/server/toolScope';
import type { FlipbookClip } from 'engine-flipbook';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flipbook — `/flipbook` (design doc `invisible-flipbook.md` step 4).
 *
 * The page mounts a live 2D-canvas playback preview and drag-reorders the frame list, so SSR is
 * pointless — the same call `/fx`, `/editor` and `/flow` make. `load` still runs server-side: it
 * streams the project's atlas list (for the region picker), the saved-clip list (for the picker),
 * and — when `?clip=<id>` is present — the opened clip plus its ETag for the save's CAS.
 */
export const ssr = false;

interface FlipbookAtlas {
	/** Manifest R2 key — the value a clip keeps as `assetKey`. */
	manifestKey: string;
	label: string;
	regions: string[];
}

/**
 * Loader: auth + `flipbook`-scope gate, then REUSE the launcher's atlas listing (`loadRegionSet`
 * over the project's `manifests/*.json` — the exact block `/fx` uses) so the region picker can
 * drive a clip's `assetKey` + ordered `frames`. The page reads the per-region rects + the page
 * image through the existing `/api/editor/regions` + `/api/editor/asset` (now `flipbook`-gated
 * as an alt tool, alongside `fx`/`rigger`).
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!roleHasTool(locals.user.role, 'flipbook')) {
		throw error(403, 'Your role does not have access to Invisible Flipbook.');
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

	const atlases: FlipbookAtlas[] = [];
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

	// Saved-clip index (for the left rail) + the optionally-opened clip.
	const clips: FlipbookClipRow[] = await listClips(clientKey, projectKey);
	const openId = url.searchParams.get('clip')?.trim() ?? '';
	let openedClip: FlipbookClip | null = null;
	// ETag of the OPENED clip, for the save's compare-and-swap. `null` = nothing opened (the
	// author is composing a new clip), which the save asserts with `ifNoneMatch`.
	let openedEtag: string | null = null;
	if (openId) {
		const loaded = await loadClip(clientKey, projectKey, openId);
		openedClip = loaded.clip;
		openedEtag = loaded.etag;
	}

	return { clientKey, projectKey, tools, atlases, clips, openedClip, openedEtag };
};
