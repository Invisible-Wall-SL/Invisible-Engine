/**
 * Editor-side spine resolution + skeleton building. Fetches the per-node descriptor
 * from `/api/editor/spine` (runtime line, PNG-preferred atlas text, stream URLs for
 * skeleton + pages), loads the vendored runtime, and assembles a ready-to-render
 * `SpineInstance`. All loading is async and defensive — a missing index, unknown
 * bundle, or load error resolves to `null` so the canvas keeps its placeholder.
 */
import {
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

async function fetchDescriptor(assetKey: string): Promise<SpineDescriptor | null> {
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
	if (descriptor.format === 'skel') {
		const reader = new spine.SkeletonBinary(loader);
		data = reader.readSkeletonData(new Uint8Array(skeletonBytes as ArrayBuffer));
	} else {
		const reader = new spine.SkeletonJson(loader);
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
	if (!descriptor) return null;
	const spine = await loadSpineRuntime(descriptor.runtime);
	// Cache-bust token from the editor's "Reload art" — forces a fresh fetch of
	// the skeleton + page textures after the underlying R2 art changed.
	const bust = (u: string): string => (version ? `${u}&v=${version}` : u);

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
}

/** Dispose an instance's GPU + atlas resources. Safe to call once per instance. */
export function disposeSpineInstance(instance: SpineInstance): void {
	try {
		instance.atlas.dispose();
	} catch {
		/* runtime may have already torn down the context */
	}
}
