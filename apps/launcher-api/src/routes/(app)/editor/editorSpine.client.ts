/**
 * Editor-side spine resolution + skeleton building. Fetches the per-node descriptor
 * from `/api/editor/spine` (runtime line, PNG-preferred atlas text, stream URLs for
 * skeleton + pages), loads the vendored runtime, and assembles a ready-to-render
 * `SpineInstance`. All loading is async and defensive — a missing index, unknown
 * bundle, or load error resolves to `null` so the canvas keeps its placeholder.
 */
import { SPINE_FALLBACK_NATURAL_SIZE, authoredSpineBox } from 'constants-shared/spine';

import { EDITOR_SPINE_LOAD_SCALE } from '$lib/spineScale';
import {
	getSpinePhysics,
	loadSpineRuntime,
	type SpineAnimationState,
	type SpineRuntime,
	type SpineSkeleton,
	type SpineSkeletonData,
	type SpineTextureAtlas,
} from './spineRuntime.client';

interface SpineDescriptor {
	found: true;
	folder: string;
	format: 'skel' | 'json';
	runtime: string;
	pma: boolean;
	atlasText: string;
	skeletonUrl: string;
	pageNames: string[];
	pageUrls: string[];
}

export interface SpineInstance {
	skeleton: SpineSkeleton;
	animationState: SpineAnimationState;
	data: SpineSkeletonData;
	atlas: SpineTextureAtlas;
	premultipliedAlpha: boolean;
	/** First animation name, when the skeleton has any (the default to play). */
	firstAnimation: string | null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		// Tolerate a missing/404 page image (e.g. an atlas that names a second page
		// the export never produced) — resolve null so the skeleton still builds from
		// the pages that DID load, with a 1×1 placeholder for the missing one. Beats
		// failing the whole spine (and, in the grid, hammering the network).
		img.onerror = () => resolve(null);
		img.crossOrigin = 'anonymous';
		img.src = url;
	});
}

/** 1×1 transparent stand-in for an atlas page whose image failed to load — keeps the
 *  runtime happy; regions packed on that page simply draw nothing. */
let placeholderCanvas: HTMLCanvasElement | null = null;
function placeholderImage(): HTMLCanvasElement {
	if (!placeholderCanvas) {
		placeholderCanvas = document.createElement('canvas');
		placeholderCanvas.width = 1;
		placeholderCanvas.height = 1;
	}
	return placeholderCanvas;
}

/**
 * The engine's BUILT-IN spines, vendored into the launcher's `static/` so a tool can preview a
 * coded default. These ship as LOCAL game assets (`apps/lines/static/assets/spines/…`), so they
 * are not in R2 and `/api/editor/spine` cannot resolve them — without a copy here the Symbols SM
 * could only ever show a "can't be previewed" placeholder for the defaults it documents.
 * Keep in sync with the coded keys: `reelhouse` = `BoardFrame.svelte`'s free-spin board glow,
 * `anticipation` = the `payframe` win-frame highlight.
 */
const BUILTIN_PREFIX = 'builtin:';
const BUILTIN_SPINES: Record<string, { dir: string; skeleton: string; atlas: string }> = {
	reelhouse: {
		dir: '/builtin/spines/reelhouse',
		skeleton: 'reelhouse_glow.json',
		atlas: 'reelhouse_glow.atlas',
	},
	anticipation: {
		dir: '/builtin/spines/anticipation',
		skeleton: 'anticipation.json',
		atlas: 'anticipation.atlas',
	},
};

/** Prefix a key so {@link loadSpineInstance} resolves it from the vendored built-ins. */
export const builtinSpineKey = (id: string): string => `${BUILTIN_PREFIX}${id}`;
/** Whether this project ships a vendored copy of the coded default `id`. */
export const hasBuiltinSpine = (id: string): boolean => id in BUILTIN_SPINES;

/**
 * Synthesize the descriptor `/api/editor/spine` would return, from the vendored static files.
 * Page names come from the atlas itself (the un-indented image lines) and `pma` from the same
 * `pma: true` header rule the server-side index uses, so a built-in renders byte-identically to
 * the R2 path — no premultiply/halo divergence.
 */
async function builtinDescriptor(id: string): Promise<SpineDescriptor | null> {
	const entry = BUILTIN_SPINES[id];
	if (!entry) return null;
	const res = await fetch(`${entry.dir}/${entry.atlas}`);
	if (!res.ok) return null;
	const atlasText = await res.text();
	const pageNames = atlasText
		.split(/\r?\n/)
		.filter((line) => line === line.trimStart() && /\.(webp|png|jpe?g)$/i.test(line.trim()))
		.map((line) => line.trim());
	return {
		found: true,
		folder: entry.dir,
		format: 'json',
		// Both vendored skeletons are exported from Spine 4.1; the loader keeps the first
		// runtime line a page loads, so this must match what the rest of the page uses.
		runtime: '4.1',
		pma: /^\s*pma\s*:\s*true\s*$/im.test(atlasText.slice(0, 2000)),
		atlasText,
		skeletonUrl: `${entry.dir}/${entry.skeleton}`,
		pageNames,
		pageUrls: pageNames.map((name) => `${entry.dir}/${name}`),
	};
}

async function fetchDescriptor(assetKey: string): Promise<SpineDescriptor | null> {
	if (assetKey.startsWith(BUILTIN_PREFIX)) {
		return builtinDescriptor(assetKey.slice(BUILTIN_PREFIX.length));
	}
	const res = await fetch(`/api/editor/spine?key=${encodeURIComponent(assetKey)}`);
	if (!res.ok) return null;
	const body = (await res.json()) as { found?: boolean } & Partial<SpineDescriptor>;
	if (!body.found) return null;
	return body as SpineDescriptor;
}

/** Premultiply each atlas page on upload — same fix the Spine Viewer applies so
 * straight-alpha exports don't show white/additive halos. */
function premultiplyPages(gl: WebGLRenderingContext, atlas: SpineTextureAtlas): void {
	for (const page of atlas.pages) {
		const tex = page as unknown as {
			texture?: { texture?: WebGLTexture; _image?: TexImageSource };
		};
		const glTex = tex.texture?.texture;
		const image = tex.texture?._image;
		if (!glTex || !image) continue;
		gl.bindTexture(gl.TEXTURE_2D, glTex);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	}
}

function buildSkeleton(
	spine: SpineRuntime,
	gl: WebGLRenderingContext,
	descriptor: SpineDescriptor,
	pageImages: Map<string, HTMLImageElement | null>,
	skeletonBytes: ArrayBuffer | string,
): SpineInstance {
	const atlas = new spine.TextureAtlas(descriptor.atlasText);
	for (const page of atlas.pages) {
		const image = pageImages.get(page.name) ?? placeholderImage();
		page.setTexture(new spine.GLTexture(gl, image as unknown as HTMLImageElement));
	}
	if (descriptor.pma) premultiplyPages(gl, atlas);

	const loader = new spine.AtlasAttachmentLoader(atlas);
	let data: SpineSkeletonData;
	// Apply the SAME load scale the deploy pipeline bakes in + the game applies on load
	// (`assetLoad.ts` sets `parser.scale`), so a natural-sized spine previews at its true
	// in-game size instead of 1/N of it. See `EDITOR_SPINE_LOAD_SCALE`.
	if (descriptor.format === 'skel') {
		const reader = new spine.SkeletonBinary(loader);
		reader.scale = EDITOR_SPINE_LOAD_SCALE;
		data = reader.readSkeletonData(new Uint8Array(skeletonBytes as ArrayBuffer));
	} else {
		const reader = new spine.SkeletonJson(loader);
		reader.scale = EDITOR_SPINE_LOAD_SCALE;
		data = reader.readSkeletonData(skeletonBytes as string);
	}

	const skeleton = new spine.Skeleton(data);
	if (data.skins.length) {
		const def = data.skins.find((s) => s.name === 'default') ?? data.skins[0];
		skeleton.setSkinByName(def.name);
	}
	skeleton.setToSetupPose();

	const animationState = new spine.AnimationState(new spine.AnimationStateData(data));
	const firstAnimation = data.animations[0]?.name ?? null;
	return {
		skeleton,
		animationState,
		data,
		atlas,
		premultipliedAlpha: descriptor.pma,
		firstAnimation,
	};
}

/**
 * Resolve + build a spine instance for a node's `assetKey`. The caller owns the
 * shared GL context (so all instances batch through one `SceneRenderer`). Returns
 * `null` on any failure (no index, unknown bundle, load/parse error).
 */
export async function loadSpineInstance(
	assetKey: string,
	gl: WebGLRenderingContext,
	version = 0,
): Promise<SpineInstance | null> {
	const descriptor = await fetchDescriptor(assetKey);
	if (!descriptor) {
		// The bundle couldn't be resolved for RENDER (unknown key / no `skeletons.json` entry /
		// missing atlas). Silent-null used to leave a bare placeholder with no clue why — log it so a
		// spine that previews in the picker (its meta resolved) but won't render on the canvas is
		// diagnosable in-browser instead of an invisible dead end.
		console.warn(`[editor] spine "${assetKey}" could not be resolved for render (no descriptor)`);
		return null;
	}
	const spine = await loadSpineRuntime(descriptor.runtime);
	// Cache-bust token from the editor's "Reload art" — forces a fresh fetch of
	// the skeleton + page textures after the underlying R2 art changed. Use the
	// right separator: builtin spine URLs (`/builtin/spines/…`) carry no query, so
	// a bare `&v=` would land in the PATH and 404 the asset.
	const bust = (u: string): string =>
		version ? `${u}${u.includes('?') ? '&' : '?'}v=${version}` : u;

	// A fetch/parse failure returns null (the documented contract) rather than
	// throwing — otherwise one bad asset becomes an uncaught rejection that stalls
	// the caller's whole load batch, blanking every OTHER cell in the grid too.
	try {
		const [skeletonBytes, ...images] = await Promise.all([
			descriptor.format === 'skel'
				? fetch(bust(descriptor.skeletonUrl)).then((r) => {
						if (!r.ok) throw new Error('skeleton fetch failed');
						return r.arrayBuffer();
					})
				: fetch(bust(descriptor.skeletonUrl)).then((r) => {
						if (!r.ok) throw new Error('skeleton fetch failed');
						return r.text();
					}),
			...descriptor.pageUrls.map((u) => loadImage(bust(u))),
		]);

		const pageImages = new Map<string, HTMLImageElement | null>();
		descriptor.pageNames.forEach((name, i) =>
			pageImages.set(name, images[i] as HTMLImageElement | null),
		);

		return buildSkeleton(spine, gl, descriptor, pageImages, skeletonBytes);
	} catch (e) {
		// A skeleton/atlas fetch or PARSE error (e.g. a runtime-version mismatch, or an `.irig`
		// structure the vendored runtime can't read) — the descriptor resolved but the bundle
		// wouldn't build. Log it (with the bundle format) so a rig that ships + renders in-game but
		// fails to preview in the editor is diagnosable, instead of a silent placeholder.
		console.warn(`[editor] spine "${assetKey}" failed to build (format ${descriptor.format})`, e);
		return null;
	}
}

/** Dispose an instance's GPU + atlas resources. Safe to call once per instance. */
export function disposeSpineInstance(instance: SpineInstance): void {
	try {
		instance.atlas.dispose();
	} catch {
		/* runtime may have already torn down the context */
	}
}

/** A rig's SIZING rect, in runtime (y-up) coords: the box a contain/cover fit measures
 * against, plus where its centre sits relative to the skeleton origin. */
export interface SpineArtBounds {
	offX: number;
	offY: number;
	bw: number;
	bh: number;
}

/**
 * Measure a rig's natural sizing rect — the ONE definition every editor surface that
 * fits a skeleton into a box reads (the Scene Editor's reel cells, the Symbols grid).
 *
 * Prefers the AUTHORED skeleton box (`skeleton.{x,y,width,height}`, via `authoredSpineBox`):
 * it's pose-independent, present in every proper export, and it is the exact rect the game's
 * `spineSizeScale` sizes by and `<SpineProvider centreBox>` centres on — so a preview fitted
 * to it matches what ships. The box is read WHERE the header puts it: a Rigger rig's frame is
 * rarely centred on its origin, and reading only the size used to place it as if it were.
 * Falls back to a live setup-pose `getBounds` (with its own centre) for a rig whose export
 * omits the size, and finally to a neutral {@link SPINE_FALLBACK_NATURAL_SIZE} box so a
 * degenerate rig still draws something rather than vanishing. That last box is SHARED with
 * the runtime's `spineSizeScale`: while the two picked different fallbacks, an unmeasurable
 * carrier rig drew at one size here and another in the game.
 *
 * Pose-independent, so a caller may measure once at load and reuse the result: measuring
 * runs `setToSetupPose()`, which would otherwise wipe an applied animation frame.
 */
export function measureSpineBounds(inst: SpineInstance): SpineArtBounds {
	const box = authoredSpineBox(inst.skeleton.data);
	if (box) return { offX: box.x, offY: box.y, bw: box.width, bh: box.height };
	const skel = inst.skeleton;
	// Measure at unit scale — a caller's render loop may have baked its zoom into the
	// skeleton's scale, which would otherwise come back multiplied into the bounds.
	const sx = skel.scaleX;
	const sy = skel.scaleY;
	skel.scaleX = 1;
	skel.scaleY = 1;
	skel.setToSetupPose();
	skel.updateWorldTransform(getSpinePhysics());
	// `getBounds` writes its result by CALLING `.set()` on these — a plain `{x,y}` makes it
	// THROW (silently caught → the fallback box), so they must implement it.
	const offset = {
		x: 0,
		y: 0,
		set(x: number, y: number) {
			this.x = x;
			this.y = y;
		},
	};
	const size = {
		x: 0,
		y: 0,
		set(x: number, y: number) {
			this.x = x;
			this.y = y;
		},
	};
	try {
		skel.getBounds(offset, size, []);
	} catch {
		/* bounds unavailable */
	}
	skel.scaleX = sx;
	skel.scaleY = sy;
	if (size.x > 0 && size.y > 0) return { offX: offset.x, offY: offset.y, bw: size.x, bh: size.y };
	const fallback = SPINE_FALLBACK_NATURAL_SIZE;
	return { offX: -fallback / 2, offY: -fallback / 2, bw: fallback, bh: fallback };
}
