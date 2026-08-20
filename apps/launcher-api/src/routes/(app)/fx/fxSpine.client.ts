/**
 * Invisible FX — load a project Spine skeleton as the Tier-B authoring BACKDROP, in the
 * SAME PixiJS scene as the particle emitters (so `FxStage` can read live bone world
 * transforms and pin emitters onto bones).
 *
 * `FxStage` drives Pixi imperatively (its own `Application`), so it can't mount the
 * declarative `<SpineProvider>`/`<SpineBone>`. Instead this builds a `spine-pixi-v8` `Spine`
 * the way the Invisible Spine Viewer's `view.html` builds its skeleton — fetch the atlas +
 * skeleton + page images ourselves (through `/spine/file`, the same per-file endpoint the
 * Viewer uses) and assemble `SkeletonData` by hand. We CAN'T lean on the package's Pixi
 * `Assets` atlas loader: it resolves page-image URLs relative to `path.dirname(atlasURL)`,
 * and our files come from `/spine/file?dir=…&name=…` (no real path), so the page images
 * would 404. Loading each file explicitly by `(dir_b64, name)` sidesteps that entirely.
 *
 * The result is a real `Spine` we add to the stage world; `spine.update(dt)` advances it,
 * `spine.getBonePosition(name)` + `spine.skeletonToPixiWorldCoordinates(pt)` give the live
 * bone world position the emitter rides (see `FxStage.svelte`). This mirrors what the
 * runtime `<SpineBone>` does declaratively (it parents children under the live bone) — done
 * imperatively here.
 */

import * as SPINE from '@esotericsoftware/spine-pixi-v8';
import type { TextureSource } from 'pixi.js';
import { loadPageSource } from '$lib/fx/effectEmitter.client';

/** One skeleton entry, exactly the shape `/spine/skeletons` returns (a subset we consume). */
export interface FxSkeletonEntry {
	name: string;
	folder: string;
	skeleton_file: string;
	atlas_file: string;
	format: 'skel' | 'json';
	dir_b64: string;
	id: number;
}

/** A loaded backdrop: the live `Spine` plus the picker metadata the inspector turns into
 * dropdowns (animation, skin, bone lists — read off the assembled `skeletonData`). The
 * `skeletonData` is also surfaced so the Tier-C spine-particle pool can build its own pooled
 * `Spine` instances from the SAME assembled data (via `createPixiSpineBackingFactory`) — the
 * particle skeletons share the page textures already wired here, allocating only their own
 * `Spine`. */
export interface LoadedFxSpine {
	spine: SPINE.Spine;
	skeletonData: SPINE.SkeletonData;
	animations: string[];
	skins: string[];
	bones: string[];
}

/** Build the `/spine/file` URL for one file of a bundle (the Viewer's per-file endpoint).
 * `shared` pins the lookup to `_shared/spines/` (the engine boot-mark preview). */
function fileUrl(dirB64: string, name: string, preferPng = false, shared = false): string {
	const pp = preferPng ? '&pp=1' : '';
	const sh = shared ? '&shared=1' : '';
	return `/spine/file?dir=${encodeURIComponent(dirB64)}&name=${encodeURIComponent(name)}${pp}${sh}`;
}

/** Options for {@link loadFxSpine}. */
export interface LoadSpineOptions {
	/** Resolve the bundle in `_shared/spines/` only, never the active project. */
	shared?: boolean;
}

/**
 * Load a skeleton entry into a live `spine-pixi-v8` `Spine`. Fetches the atlas text, wires
 * each atlas page to a Pixi `TextureSource` (loaded through `/spine/file`), then reads the
 * skeleton (`.json`/`.irig` via `SkeletonJson`, `.skel` via `SkeletonBinary`).
 */
export async function loadFxSpine(
	entry: FxSkeletonEntry,
	opts: LoadSpineOptions = {},
): Promise<LoadedFxSpine> {
	const shared = opts.shared === true;
	// `pp=1` belongs on the ATLAS request, not the page one: the WebP→PNG preference is a rewrite
	// of the page lines INSIDE the atlas text (the server's `atlasPreferPng`), which is exactly
	// where the Viewer's `view.html` puts it. Asking for it on the page image is a no-op — by then
	// the filename has already been decided.
	const atlasText = await (
		await fetch(fileUrl(entry.dir_b64, entry.atlas_file, true, shared))
	).text();
	const atlas = new SPINE.TextureAtlas(atlasText);

	// Wire each atlas page to its texture. The page `name` is the image filename the atlas
	// references, loaded through `/spine/file`.
	//
	// NOT `Assets.load`. Pixi's resolver picks a loader by the URL's apparent EXTENSION and drops
	// the query string first, so `/spine/file?dir=…&name=….png` reads as extension-less: the load
	// resolves to `null` ("we don't know how to parse it") and reading `.source` off that threw,
	// killing every skeleton load through this helper. `loadPageSource` fetches the bytes and
	// decodes them itself — the same fix the FX emitters' own page loading already carries.
	const pageCache = new Map<string, TextureSource>();
	for (const page of atlas.pages) {
		const url = fileUrl(entry.dir_b64, page.name, false, shared);
		page.setTexture(SPINE.SpineTexture.from(await loadPageSource(url, pageCache)));
	}

	const attachmentLoader = new SPINE.AtlasAttachmentLoader(atlas);
	let skeletonData: SPINE.SkeletonData;
	if (entry.format === 'skel') {
		const bytes = new Uint8Array(
			await (await fetch(fileUrl(entry.dir_b64, entry.skeleton_file, false, shared))).arrayBuffer(),
		);
		const binary = new SPINE.SkeletonBinary(attachmentLoader);
		skeletonData = binary.readSkeletonData(bytes);
	} else {
		const json = await (
			await fetch(fileUrl(entry.dir_b64, entry.skeleton_file, false, shared))
		).json();
		const reader = new SPINE.SkeletonJson(attachmentLoader);
		skeletonData = reader.readSkeletonData(json);
	}

	const spine = new SPINE.Spine(skeletonData);
	// We drive the skeleton ourselves from the stage ticker (play/pause-aware), so disable
	// the runtime's own auto-update.
	spine.autoUpdate = false;

	return {
		spine,
		skeletonData,
		animations: skeletonData.animations.map((a) => a.name),
		skins: skeletonData.skins.map((s) => s.name),
		bones: skeletonData.bones.map((b) => b.name),
	};
}

/** Play an animation on track 0 (looping by default); a no-op if the name is empty or not on
 * this skeleton (the picker can still hold a clip from a previously-loaded skeleton — calling
 * `setAnimation` with an unknown name throws, which would abort a backdrop switch). */
export function playFxAnimation(spine: SPINE.Spine, animation: string, loop = true): void {
	if (!animation) return;
	if (!spine.skeleton.data.findAnimation(animation)) return;
	spine.state.setAnimation(0, animation, loop);
}

/** Apply a skin by name (best-effort — an unknown skin is swallowed, the current skin kept). */
export function applyFxSkin(spine: SPINE.Spine, skin: string): void {
	if (!skin) return;
	try {
		spine.skeleton.setSkinByName(skin);
		spine.skeleton.setSlotsToSetupPose();
	} catch {
		// Unknown skin — keep the current one.
	}
}
