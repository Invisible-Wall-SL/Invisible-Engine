import {
	AmbientLight,
	BoxGeometry,
	Color,
	DataTexture,
	DirectionalLight,
	Mesh,
	MeshToonMaterial,
	NearestFilter,
	PerspectiveCamera,
	RedFormat,
	Scene,
	WebGLRenderer,
} from 'three';

export type World3dOptions = {
	/** The clear colour behind the world (the Pixi canvas above is transparent). */
	background?: number;
	/** Pixel-ratio cap, like the Pixi canvas's (`pixi-svelte` `canvasResolution`): 2 by default. */
	maxPixelRatio?: number;
};

/** One frame of the game's clock: the world advances by it and draws. */
export type World3dFrame = { deltaMs: number };

export type World3d = {
	/** Advance the world by one frame of the game's ticker and draw it. */
	sync(frame: World3dFrame): void;
	/** Size the canvas to `width` × `height` CSS pixels. */
	resize(width: number, height: number): void;
	/** Remove the canvas and free every GPU resource. */
	destroy(): void;
};

/** Three bands of light: the toon look, with no texture file to load. */
const toonRamp = () => {
	const ramp = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
	ramp.minFilter = NearestFilter;
	ramp.magFilter = NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
};

/** Radians per millisecond the spike's cube turns. */
const SPIN = 0.0009;

/**
 * Mount a 3D world in a new canvas inserted into `host` before its first child (the Pixi canvas),
 * fixed to the viewport and blind to the pointer: the Pixi canvas, painted after it, stays on top and
 * keeps every click. Phase 0a draws one toon-shaded spinning cube; the bodies, the camera rig and
 * picking come with step 2 of the plan.
 */
export function mountWorld3d(host: HTMLElement, opts: World3dOptions = {}): World3d {
	const canvas = document.createElement('canvas');
	canvas.dataset.ieWorld3d = '';
	Object.assign(canvas.style, {
		position: 'fixed',
		left: '0',
		top: '0',
		pointerEvents: 'none',
	});
	host.insertBefore(canvas, host.firstChild);

	const renderer = new WebGLRenderer({
		canvas,
		antialias: true,
		powerPreference: 'high-performance',
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
	renderer.setClearColor(new Color(opts.background ?? 0x1b2433));

	const scene = new Scene();
	const camera = new PerspectiveCamera(40, 1, 0.1, 100);
	camera.position.set(0, 1.6, 5);
	camera.lookAt(0, 0, 0);

	const ramp = toonRamp();
	const geometry = new BoxGeometry(1.4, 1.4, 1.4);
	const material = new MeshToonMaterial({ color: 0xf2a541, gradientMap: ramp });
	const cube = new Mesh(geometry, material);
	scene.add(cube);

	const sun = new DirectionalLight(0xffffff, 2.2);
	sun.position.set(3, 4, 2);
	scene.add(sun, new AmbientLight(0xffffff, 0.35));

	const resize = (width: number, height: number) => {
		renderer.setSize(width, height);
		camera.aspect = width / Math.max(height, 1);
		camera.updateProjectionMatrix();
	};

	return {
		sync: ({ deltaMs }) => {
			cube.rotation.y += deltaMs * SPIN;
			cube.rotation.x += deltaMs * SPIN * 0.4;
			renderer.render(scene, camera);
		},
		resize,
		destroy: () => {
			geometry.dispose();
			material.dispose();
			ramp.dispose();
			renderer.dispose();
			canvas.remove();
		},
	};
}
