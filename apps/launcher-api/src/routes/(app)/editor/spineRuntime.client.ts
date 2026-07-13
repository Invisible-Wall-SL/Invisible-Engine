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
	/** `Skeleton.getBounds` writes its result by CALLING `offset.set()/size.set()`
	 * (it expects real spine `Vector2` instances) — a plain `{x,y}` makes it throw.
	 * Callers must pass an object that implements this. */
	set(x: number, y: number): void;
}

export interface SpineCamera {
	position: { x: number; y: number; z: number };
	up: { x: number; y: number; z: number };
	zoom: number;
	viewportWidth: number;
	viewportHeight: number;
	update(): void;
}

/** A posed bone — its world transform AFTER `skeleton.updateWorldTransform`. `worldX`/`worldY`
 * are the world origin (the Symbols-SM live FX overlay projects it to screen to ride the bound
 * bone, mirroring the Rigger's `fxBoneWorld`). The rotation/scale accessors mirror the underlying
 * spine-webgl `Bone` — the Scene Editor's bone-ridden symbol preview reads them to honour a
 * component's `followRotation` / `followScale` (the SAME values the runtime `<SpineBoneAttach>`
 * uses: `-getWorldRotationX()*DEG_TO_RAD` for rotation, `getWorldScaleX()/getWorldScaleY()` for
 * scale). Read only once a rider is present, so non-rider previews touch none of them. */
export interface SpineBone {
	worldX: number;
	worldY: number;
	/** World rotation about X in DEGREES (skeleton space, CCW) — negate + `DEG_TO_RAD` for Pixi. */
	getWorldRotationX(): number;
	/** Accumulated world scale along the bone's local X (the bone chain scale). */
	getWorldScaleX(): number;
	/** Accumulated world scale along the bone's local Y (the bone chain scale). */
	getWorldScaleY(): number;
}

export interface SpineSkeleton {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	/** Setup-order bones; `bones[0]` is the root (== the rig origin when an fx binding has no bone). */
	bones: SpineBone[];
	setToSetupPose(): void;
	setSkinByName(name: string): void;
	setSlotsToSetupPose(): void;
	updateWorldTransform(physics?: unknown): void;
	getBounds(offset: SpineVector2, size: SpineVector2, temp: number[]): void;
	/** Bone by name, or `null` when the rig has none by that name (a stale fx binding). */
	findBone(name: string): SpineBone | null;
}

/** The live track's playhead — read (not accumulated) so the FX crossing stays in lockstep with the
 * pose `animationState.apply` produced this frame. `trackTime` grows unbounded for a looping entry;
 * the wrapped time is `trackTime % animation.duration`. */
export interface SpineTrackEntry {
	trackTime: number;
	animation: { duration: number } | null;
}

export interface SpineAnimationState {
	timeScale: number;
	setAnimation(track: number, name: string, loop: boolean): unknown;
	setEmptyAnimation(track: number, mixDuration: number): unknown;
	update(delta: number): void;
	apply(skeleton: SpineSkeleton): boolean;
	/** The current entry on `track` (its playhead + animation), or `null` when the track is empty. */
	getCurrent(track: number): SpineTrackEntry | null;
}

export interface SpineAnimationMeta {
	name: string;
	duration: number;
}
export interface SpineSkinMeta {
	name: string;
}
export interface SpineSlotMeta {
	name: string;
}
export interface SpineBoneMeta {
	name: string;
}
export interface SpineSkeletonData {
	animations: SpineAnimationMeta[];
	skins: SpineSkinMeta[];
	/** Setup-pose slots (`skeleton.data.slots`) — surfaced so the editor can offer a
	 * slot dropdown for spine-related component params (e.g. the free-spin count slot). */
	slots: SpineSlotMeta[];
	/** Setup-pose bones (`skeleton.data.bones`) — surfaced so the editor can offer a bone
	 * dropdown for spine-related component params (e.g. the symbol-reveal attach bone). */
	bones: SpineBoneMeta[];
}

/** Per-`assetKey` metadata the editor publishes for each loaded spine bundle — the
 * animation / skin / slot / bone name lists the Properties panel turns into dropdowns. */
export interface SpineMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
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
	// `scale` (settable) pre-multiplies the skeleton geometry on read — the SAME knob the
	// game's loader uses (`assetLoad.ts#parser.scale`) so the editor preview can match.
	SkeletonJson: new (loader: unknown) => {
		scale: number;
		readSkeletonData(json: unknown): SpineSkeletonData;
	};
	SkeletonBinary: new (loader: unknown) => {
		scale: number;
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
