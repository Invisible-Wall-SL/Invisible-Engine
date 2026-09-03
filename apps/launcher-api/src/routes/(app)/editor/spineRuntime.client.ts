/**
 * Thin typed access to the vendored `spine-webgl` runtime — the SAME runtime the
 * Invisible Spine Viewer uses (`static/spine/vendor/spine-webgl-<line>.js`). The
 * launcher app has no `pixi.js` / `@esotericsoftware/spine-pixi-v8` npm deps, so
 * the editor preview reuses this already-shipped global-script runtime instead of
 * adding deps. Each runtime line is a separate global build owning `window.spine`, so the
 * editor loads exactly ONE — 4.2, the line the game runs — see `loadSpineRuntime`.
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
	/** The parsed skeleton data — the authored box lives here (`data.x/y/width/height`). */
	data: SpineSkeletonData;
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
	/** The AUTHORED skeleton box (`skeleton.{x,y,width,height}`) — the pose-independent
	 * sizing rect, and the SAME rect the game's `spineSizeScale` fits against. `x`/`y` is its
	 * bottom-left corner in y-up skeleton coords; a Spine-editor rig centres it on the origin, a
	 * Rigger rig need not (read it through `authoredSpineBox`, never assume). `width`/`height`
	 * are `0` when the export omits them, which is why {@link measureSpineBounds} falls back to
	 * a live `getBounds`. NOTE: the runtime does NOT scale any of these by the loader's
	 * `parser.scale` — only the geometry. */
	x?: number;
	y?: number;
	width: number;
	height: number;
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

/**
 * The ONE vendored runtime line the editor previews with. It is the line the GAME runs
 * (`@esotericsoftware/spine-pixi-v8` 4.2), and a 4.2 reader loads a 4.1 export — the two built-in
 * 4.1 skeletons (anticipation, reelhouse) parse and pose under it, guarded by
 * `scripts/check-builtin-spines.mjs` — so every skeleton on a page is built, posed and drawn by
 * the same runtime object.
 *
 * There used to be one script per requested line, "first line loaded wins". That rule was enforced
 * only once a script had FINISHED loading, so a page that asked for 4.1 (the built-ins) and 4.2 (a
 * Rigger `.irig`) before either arrived injected BOTH, and whichever finished last owned
 * `window.spine`. Skeletons built by one runtime were then posed with the other's `Physics` token
 * and drawn by the other's `SceneRenderer`: on a cold /symbols load every 4.2 cell threw
 * "physics is undefined" each frame and stayed blank until a reload happened to order the scripts
 * the other way.
 */
const SPINE_RUNTIME_LINE = '4.2';
let runtimePromise: Promise<SpineRuntime> | null = null;
let runtime: SpineRuntime | null = null;

/** Load the runtime once per page; every caller shares the same promise and the same object. */
export function loadSpineRuntime(): Promise<SpineRuntime> {
	if (runtimePromise) return runtimePromise;
	runtimePromise = new Promise<SpineRuntime>((resolve, reject) => {
		const w = window as unknown as { spine?: SpineRuntime };
		const script = document.createElement('script');
		script.src = `/spine/vendor/spine-webgl-${SPINE_RUNTIME_LINE}.js`;
		script.onload = () => {
			if (w.spine) {
				runtime = w.spine;
				resolve(w.spine);
			} else {
				reject(new Error(`spine runtime ${SPINE_RUNTIME_LINE} did not expose a global`));
			}
		};
		script.onerror = () => {
			// Let the next caller retry instead of pinning every later load to this failure.
			runtimePromise = null;
			reject(new Error(`failed to load spine runtime ${SPINE_RUNTIME_LINE}`));
		};
		document.head.appendChild(script);
	});
	return runtimePromise;
}

/**
 * The loaded runtime object, or `null` before `loadSpineRuntime` resolves. Captured at load —
 * never read live off `window.spine`, which any later script on the page could replace.
 */
export function getActiveRuntime(): SpineRuntime | null {
	return runtime;
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
