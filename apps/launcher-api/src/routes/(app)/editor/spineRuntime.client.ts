/**
 * Thin typed access to the vendored `spine-webgl` runtime — the SAME runtime the
 * Invisible Spine Viewer uses (`static/spine/vendor/spine-webgl-<line>.js`). The
 * launcher app has no `pixi.js` / `@esotericsoftware/spine-pixi-v8` npm deps, so
 * the editor preview reuses this already-shipped global-script runtime instead of
 * adding deps. Each runtime line (`4.1` / `4.2`) is a separate global build; only
 * one can be active per page, so the loader keeps the first line it loaded.
 *
 * We type only the handful of members the editor overlay touches. Everything is
 * structural — the global is `unknown` until narrowed here.
 */

export interface SpineVector2 {
	x: number;
	y: number;
}

export interface SpineCamera {
	position: { x: number; y: number; z: number };
	up: { x: number; y: number; z: number };
	zoom: number;
	viewportWidth: number;
	viewportHeight: number;
	update(): void;
}

export interface SpineSkeleton {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	setToSetupPose(): void;
	setSkinByName(name: string): void;
	setSlotsToSetupPose(): void;
	updateWorldTransform(physics?: unknown): void;
	getBounds(offset: SpineVector2, size: SpineVector2, temp: number[]): void;
}

export interface SpineAnimationState {
	timeScale: number;
	setAnimation(track: number, name: string, loop: boolean): unknown;
	setEmptyAnimation(track: number, mixDuration: number): unknown;
	update(delta: number): void;
	apply(skeleton: SpineSkeleton): boolean;
}

export interface SpineAnimationMeta {
	name: string;
	duration: number;
}
export interface SpineSkinMeta {
	name: string;
}
export interface SpineSkeletonData {
	animations: SpineAnimationMeta[];
	skins: SpineSkinMeta[];
}

export interface SpineTexturePage {
	name: string;
	setTexture(texture: unknown): void;
}
export interface SpineTextureAtlas {
	pages: SpineTexturePage[];
	dispose(): void;
}

export interface SpineRuntime {
	SceneRenderer: new (canvas: HTMLCanvasElement, gl: WebGLRenderingContext) => SpineSceneRenderer;
	GLTexture: new (gl: WebGLRenderingContext, image: TexImageSource) => unknown;
	TextureAtlas: new (atlasText: string) => SpineTextureAtlas;
	AtlasAttachmentLoader: new (atlas: SpineTextureAtlas) => unknown;
	SkeletonJson: new (loader: unknown) => { readSkeletonData(json: unknown): SpineSkeletonData };
	SkeletonBinary: new (loader: unknown) => {
		readSkeletonData(bytes: Uint8Array): SpineSkeletonData;
	};
	Skeleton: new (data: SpineSkeletonData) => SpineSkeleton;
	AnimationState: new (data: unknown) => SpineAnimationState;
	AnimationStateData: new (data: SpineSkeletonData) => unknown;
	Physics?: { update: unknown };
}

export interface SpineSceneRenderer {
	camera: SpineCamera;
	begin(): void;
	end(): void;
	drawSkeleton(skeleton: SpineSkeleton, premultipliedAlpha: boolean): void;
	dispose(): void;
}

const loaded = new Map<string, Promise<SpineRuntime>>();
let activeLine: string | null = null;

/**
 * Load (once) the vendored runtime for a spine line (`4.1` / `4.2`). Because each
 * build owns the single `window.spine` global, only the first line loaded per page
 * can be served; a request for a different line resolves to the already-loaded one
 * (cross-version skeletons in one editor session are rare and a preview-only edge).
 */
export function loadSpineRuntime(line: string): Promise<SpineRuntime> {
	const norm = line === '4.1' ? '4.1' : '4.2';
	if (activeLine && activeLine !== norm) {
		const existing = loaded.get(activeLine);
		if (existing) return existing;
	}
	const hit = loaded.get(norm);
	if (hit) return hit;

	const p = new Promise<SpineRuntime>((resolve, reject) => {
		const w = window as unknown as { spine?: SpineRuntime };
		if (w.spine && activeLine === norm) {
			resolve(w.spine);
			return;
		}
		const script = document.createElement('script');
		script.src = `/spine/vendor/spine-webgl-${norm}.js`;
		script.onload = () => {
			if (w.spine) {
				activeLine = norm;
				resolve(w.spine);
			} else {
				reject(new Error(`spine runtime ${norm} did not expose a global`));
			}
		};
		script.onerror = () => reject(new Error(`failed to load spine runtime ${norm}`));
		document.head.appendChild(script);
	});
	loaded.set(norm, p);
	return p;
}

/** The currently loaded runtime line, or `null` before the first load. */
export function activeSpineLine(): string | null {
	return activeLine;
}

/** The loaded runtime global, or `null` before any `loadSpineRuntime` resolves. */
export function getActiveRuntime(): SpineRuntime | null {
	return (window as unknown as { spine?: SpineRuntime }).spine ?? null;
}

/** Build the shared `SceneRenderer` once a runtime is loaded. */
export function createSceneRenderer(
	canvas: HTMLCanvasElement,
	gl: WebGLRenderingContext,
): SpineSceneRenderer | null {
	const spine = getActiveRuntime();
	if (!spine) return null;
	return new spine.SceneRenderer(canvas, gl);
}

/** The runtime's `Physics.update` token (4.2+) or `undefined` (4.1). */
export function getSpinePhysics(): unknown {
	return getActiveRuntime()?.Physics?.update;
}
