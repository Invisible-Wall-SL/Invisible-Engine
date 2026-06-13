import { error, json } from '@sveltejs/kit';
import { getReferenceLayout, type LayoutDoc, type LayoutNode } from 'engine-layout';
import { loadRegionSet } from '$lib/server/editorRegions';
import { listProjectAssets } from '$lib/server/projectAssets';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Project-aware "Import composed reference" (§19.6). Returns a kind's FILLED
 * reference layout (board-frame art included) with its bare board-frame sprite
 * names rewritten to the ACTIVE project's atlas region — so the editor renders
 * the frame instead of choking on a name it can't resolve. Mirrors the seed
 * script's `frameNode()`: a renderable frame sprite is `{ assetKey: <project
 * manifest key>, region: 'frame_bg.png' }`, NOT a bare `assetKey: 'frame_bg.png'`.
 *
 * Best-effort: a bare name with no matching region in the project is left
 * untouched (it previews as a placeholder — acceptable). The whole rewrite is a
 * preview convenience; the project's REAL doc is only seeded by the seed script.
 */

/** Image extensions a BARE (non-manifest) sprite `assetKey` ends with. */
const IMAGE_EXT_RE = /\.(png|webp|jpe?g)$/i;

/** A bare image name is a candidate to rewrite; a `.json`/manifest path is not. */
function isBareImageName(assetKey: string): boolean {
	return IMAGE_EXT_RE.test(assetKey) && !assetKey.endsWith('.json') && !assetKey.includes('/');
}

/** Walk a node tree, applying `visit` to every node (containers recursed). */
function walkNodes(nodes: LayoutNode[], visit: (node: LayoutNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.kind === 'container') walkNodes(node.children, visit);
	}
}

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
	});

	const gameType = url.searchParams.get('gameType');
	if (!gameType) throw error(400, 'missing gameType');

	// Import is only for FILLED (art-bearing) kinds — getReferenceLayout returns
	// undefined for the engine-skeleton kinds, so a non-importable type 404s.
	const doc = getReferenceLayout(gameType);
	if (!doc) throw error(404, 'no reference layout for that game type');

	// Collect the bare frame-art names the doc references, so we only resolve the
	// project's atlases when there is something to rewrite.
	const wanted = new Set<string>();
	for (const scene of doc.scenes) {
		walkNodes(scene.nodes, (node) => {
			if (node.kind === 'sprite' && !node.region && isBareImageName(node.assetKey)) {
				wanted.add(node.assetKey);
			}
		});
	}

	if (wanted.size > 0) {
		// Reuse the editor's own asset listing + region resolution — NO bespoke R2
		// scan. For each atlas manifest the active project has, load its region set
		// and index every region name → the manifest's resolved `assetKey` (the key
		// the editor resolves a sprite against, e.g. `<client>/<project>/manifests/
		// reels_frame.json`). First manifest wins for a given region name.
		const assets = await listProjectAssets(clientKey, projectKey);
		const regionToManifest = new Map<string, string>();
		const manifestKeys = assets.atlases
			.filter((a) => a.kind === 'atlas-manifest')
			.map((a) => a.key);
		const sets = await Promise.all(
			manifestKeys.map((key) => loadRegionSet(key, clientKey, projectKey)),
		);
		for (const set of sets) {
			for (const region of set.regions) {
				if (wanted.has(region.name) && !regionToManifest.has(region.name)) {
					regionToManifest.set(region.name, set.assetKey);
				}
			}
		}

		// Apply the rewrite in place: a bare frame name that a project atlas defines
		// becomes a region sprite pointing at that manifest (in-game identical;
		// editor-renderable). Unmatched names are left bare (best-effort preview).
		for (const scene of doc.scenes) {
			walkNodes(scene.nodes, (node) => {
				if (node.kind !== 'sprite' || node.region || !isBareImageName(node.assetKey)) return;
				const manifestKey = regionToManifest.get(node.assetKey);
				if (!manifestKey) return;
				node.region = node.assetKey;
				node.assetKey = manifestKey;
			});
		}
	}

	return json(doc satisfies LayoutDoc);
};
