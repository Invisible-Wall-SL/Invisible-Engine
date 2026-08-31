/**
 * Walk a project's rig bundles and hand each one's PARSED source skeleton JSON to a collector.
 *
 * The shared half of the rig-timeline binding exports (`rigFxExport`, `rigFlipbookExport`). Both
 * need exactly the same thing — every rig in `skeletons.json`, its raw skeleton read from R2, keyed
 * by the bundle `folder` — and only differ in which custom field they collect off the events. Doing
 * that plumbing once means the two manifests can never disagree about which rigs exist or how a
 * rig's runtime key is derived.
 *
 * WHY THE RAW JSON. spine-pixi discards custom `event.*` fields at parse time, so a binding cannot
 * be read back through the runtime event stream — it must come from the rig data directly. Only
 * JSON-format skeletons can carry one; a binary `.skel` is skipped fast.
 *
 * CRUX — the key. It MUST equal the string `LayoutNodeView` passes as `<SpineProvider key=…>` for a
 * placed rig, so `resolveRigFx` / `resolveRigFlipbooks` hit. For an editor-placed spine node the
 * game's doc has that `assetKey` rewritten from the full R2 bundle prefix down to the plain bundle
 * NAME (`resolveSpineKeysForGame` → `bundleFromAssetKey`), which is exactly the `skeletons.json`
 * `folder` — the same value `editorArtExport.ts` sets `result.entry.key` to for an editor-art spine.
 */
import { getObjectText } from './r2';
import { loadSkeletonIndex, resolveBundlePrefix } from './spine';

/** One animation event as it sits in the rig JSON, before spine-pixi ever sees it. The custom
 * binding fields are `unknown` here — each export reads its own through its own clamp. */
export interface RawRigEvent {
	name?: unknown;
	/** Keyframe time (seconds). Spine OMITS it when it is 0, so absent means t=0 — never "no time". */
	time?: unknown;
	fx?: unknown;
	flipbook?: unknown;
}

export interface RawRigAnimation {
	events?: unknown;
}

export interface RawRigSkeleton {
	animations?: Record<string, RawRigAnimation>;
}

/**
 * Call `visit(folder, skeleton)` once per readable JSON rig in the project. A rig whose skeleton
 * can't be resolved, read or parsed contributes nothing — an unreadable rig must not fail a bake.
 */
export async function walkRigSkeletons(
	clientKey: string,
	projectKey: string,
	visit: (folder: string, data: RawRigSkeleton) => void,
): Promise<void> {
	const entries = await loadSkeletonIndex(clientKey, projectKey);
	for (const entry of entries) {
		if (!entry.folder || !entry.skeleton_file) continue;
		// Binary `.skel` skeletons can't carry a custom event field; skip them fast.
		if (entry.format === 'skel') continue;
		const prefix = await resolveBundlePrefix(
			clientKey,
			projectKey,
			entry.folder,
			entry.skeleton_file,
		);
		if (!prefix) continue;
		const text = await getObjectText(`${prefix}/${entry.skeleton_file}`);
		if (!text) continue;
		let data: RawRigSkeleton;
		try {
			data = JSON.parse(text) as RawRigSkeleton;
		} catch {
			continue;
		}
		visit(entry.folder, data);
	}
}

/** Every event of every animation, flattened — what a collector iterates. Sorted per-animation is
 * the caller's business (a name-keyed manifest doesn't care; a timeline does). */
export function eventsOf(data: RawRigSkeleton): RawRigEvent[] {
	const animations = data.animations;
	if (!animations || typeof animations !== 'object') return [];
	const out: RawRigEvent[] = [];
	for (const anim of Object.values(animations)) {
		const events = anim?.events;
		if (Array.isArray(events)) out.push(...(events as RawRigEvent[]));
	}
	return out;
}
