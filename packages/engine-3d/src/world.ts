import {
	AmbientLight,
	BoxGeometry,
	BufferGeometry,
	CapsuleGeometry,
	CircleGeometry,
	Color,
	DataTexture,
	DirectionalLight,
	Float32BufferAttribute,
	Group,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	MeshToonMaterial,
	NearestFilter,
	PCFShadowMap,
	PerspectiveCamera,
	Plane,
	Raycaster,
	RedFormat,
	RingGeometry,
	Scene,
	Vector2,
	Vector3,
	WebGLRenderer,
} from 'three';

import type { Collider3dSpec } from 'engine-mechanics/src/motion3d.js';

import type { BodyView3d } from './pure/play';
import { rigPosition, yawRadians, type Rig3d, type Vec3 } from './pure/rig';
import { CAPS_3D, type Caps3d } from './pure/tier';

export type World3dOptions = {
	/** The canvas to draw in: the seam reserves it before the Pixi context is created, so the page
	 *  check behind Pixi's canvas sees it (`ArcadeStage3D.svelte`). It is swapped for a blank copy
	 *  on `destroy()`, so the next world gets a fresh WebGL context in the same place. */
	canvas: HTMLCanvasElement;
	/** The clear colour behind the world (the Pixi canvas above is transparent). */
	background?: number;
	/** What the tier may spend (`pure/tier.ts` `CAPS_3D`): MSAA, shadow map or blob shadows,
	 *  who casts. The `half` column when absent. */
	caps?: Pick<Caps3d, 'antialias' | 'shadows' | 'shadowMapSize' | 'shadowCasters'>;
};

/** Where the camera looks this frame. */
export type View3d = { target: Vec3; rig: Rig3d };

export type World3d = {
	/** Draw the level's colliders as placeholder blocks (once per level). */
	setLevel(colliders: readonly Collider3dSpec[]): void;
	/** Move one object per body (adding and removing them), place the camera, and draw. */
	sync(bodies: readonly BodyView3d[], view: View3d): void;
	/** Size the canvas to `width` × `height` CSS pixels. */
	resize(width: number, height: number): void;
	/** Device pixels per CSS pixel the 3D canvas renders at (may be below the HUD's). */
	setPixelRatio(ratio: number): void;
	readonly pixelRatio: number;
	/** A shadow map of `size`², or blob shadows (a disc at each body's feet, no shadow map). The
	 *  dynamic-resolution controller steps it down (`pure/quality.ts`). */
	setShadows(shadows: Caps3d['shadows'], size: number): void;
	/** The point on the level (or the ground plane y = 0) under a viewport position, or none. */
	pick(clientX: number, clientY: number): Vec3 | undefined;
	/** Show the aim marker at a point, or hide it. */
	setAim(point: Vec3 | undefined): void;
	/** Free every GPU resource and leave a blank canvas in this one's place. */
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

/** Corners of a collider's foot, in turn round it: (minX,minZ) (maxX,minZ) (maxX,maxZ) (minX,maxZ). */
const corners = (c: Collider3dSpec): [number, number][] => [
	[c.minX, c.minZ],
	[c.maxX, c.minZ],
	[c.maxX, c.maxZ],
	[c.minX, c.maxZ],
];

/** Per facing: the two foot corners on the high edge, each with the low corner across from it. */
const RAMP_EDGES: Record<string, [number, number, number, number]> = {
	'+x': [1, 0, 2, 3],
	'-x': [0, 1, 3, 2],
	'+z': [3, 0, 2, 1],
	'-z': [0, 3, 1, 2],
};

/** A wedge rising from `minY` on its low edge to `maxY` on the edge its facing names. */
function rampGeometry(c: Collider3dSpec & { kind: 'ramp' }): BufferGeometry {
	const foot = corners(c);
	const [h1, l1, h2, l2] = RAMP_EDGES[c.facing];
	const at = (i: number, top: boolean) => [foot[i][0], top ? c.maxY : c.minY, foot[i][1]];
	const tris = [
		[at(0, false), at(1, false), at(2, false)],
		[at(0, false), at(2, false), at(3, false)],
		[at(l1, false), at(h1, true), at(h2, true)],
		[at(l1, false), at(h2, true), at(l2, false)],
		[at(h1, false), at(h2, false), at(h2, true)],
		[at(h1, false), at(h2, true), at(h1, true)],
		[at(l1, false), at(h1, false), at(h1, true)],
		[at(l2, false), at(h2, false), at(h2, true)],
	];
	// Wind every face outward (seen from outside, counter-clockwise), so the wedge renders and casts
	// with front faces like a box: a point a quarter up at the middle of the run is inside it.
	const inside = [(c.minX + c.maxX) / 2, c.minY + (c.maxY - c.minY) / 4, (c.minZ + c.maxZ) / 2];
	for (const tri of tris) {
		const [a, b, d] = tri;
		const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
		const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
		const out = [0, 1, 2].reduce((sum, i) => sum + n[i] * (a[i] - inside[i]), 0);
		if (out < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(tris.flat(2), 3));
	geometry.computeVertexNormals();
	return geometry;
}

/** Placeholder colours: the floor, a raised block, a wall, a ramp; the hero and everyone else. */
const PALETTE = {
	floor: 0x5d7a5a,
	block: 0xc9a46b,
	wall: 0x4a4f63,
	ramp: 0xd98c4a,
	hero: 0xf2a541,
	other: 0x6aa6d9,
	aim: 0xffffff,
};

/**
 * Mount a 3D world in `opts.canvas` (fixed under the Pixi canvas, which stays on top and takes
 * every pointer: the seam forwards what the HUD does not take to {@link World3d.pick}).
 * Phase 1 draws placeholders: blocks and wedges for the level, a capsule with a nose per body.
 */
export function mountWorld3d(opts: World3dOptions): World3d {
	const { canvas } = opts;
	const caps = opts.caps ?? CAPS_3D.half;
	const renderer = new WebGLRenderer({
		canvas,
		antialias: caps.antialias,
		powerPreference: 'high-performance',
	});
	renderer.setClearColor(new Color(opts.background ?? 0x1b2433));
	let shadows = caps.shadows;
	const blobs = new Set<Mesh>();
	const shadowSize = shadows === 'map' ? caps.shadowMapSize : 0;
	renderer.shadowMap.enabled = shadowSize > 0;
	renderer.shadowMap.type = PCFShadowMap;

	const scene = new Scene();
	const camera = new PerspectiveCamera(45, 1, 0.1, 400);
	const ramp = toonRamp();
	const materials = new Map<number, MeshToonMaterial>();
	const material = (color: number) => {
		let m = materials.get(color);
		if (!m) {
			m = new MeshToonMaterial({ color, gradientMap: ramp });
			materials.set(color, m);
		}
		return m;
	};

	const sun = new DirectionalLight(0xffffff, 2.2);
	sun.position.set(8, 16, 6);
	sun.castShadow = shadowSize > 0;
	sun.shadow.mapSize.set(shadowSize, shadowSize);
	// Against acne on the slopes the sun grazes (the ramps).
	sun.shadow.bias = -0.0005;
	sun.shadow.normalBias = 0.03;
	Object.assign(sun.shadow.camera, {
		left: -20,
		right: 20,
		top: 20,
		bottom: -20,
		near: 1,
		far: 60,
	});
	sun.shadow.camera.updateProjectionMatrix();
	scene.add(
		sun,
		sun.target,
		new AmbientLight(0xffffff, 0.25),
		new HemisphereLight(0xbfd8ff, 0x3a3020, 0.6),
	);

	const levelGroup = new Group();
	const bodyGroup = new Group();
	scene.add(levelGroup, bodyGroup);

	const capsules = new Map<string, Group>();
	const capsuleGeometries = new Map<string, BufferGeometry>();
	const nose = new BoxGeometry(0.18, 0.18, 0.35);

	const aim = new Mesh(new RingGeometry(0.25, 0.4, 24), material(PALETTE.aim));
	aim.rotation.x = -Math.PI / 2;
	aim.visible = false;
	scene.add(aim);

	const disposeLevel = () => {
		for (const child of levelGroup.children) (child as Mesh).geometry.dispose();
		levelGroup.clear();
	};

	// A blob shadow: a soft dark disc at the feet, for tiers with no shadow map (§5.3 `quarter`).
	const blobGeometry = new CircleGeometry(1, 20);
	const blobMaterial = new MeshBasicMaterial({
		color: 0x000000,
		transparent: true,
		opacity: 0.35,
		depthWrite: false,
	});

	const capsule = (body: BodyView3d): Group => {
		const key = `${body.radius}:${body.height}`;
		let geometry = capsuleGeometries.get(key);
		if (!geometry) {
			geometry = new CapsuleGeometry(
				body.radius,
				Math.max(body.height - 2 * body.radius, 0),
				6,
				16,
			);
			capsuleGeometries.set(key, geometry);
		}
		const color = body.kind === 'hero' ? PALETTE.hero : PALETTE.other;
		const shape = new Mesh(geometry, material(color));
		shape.position.y = body.height / 2;
		shape.castShadow = true;
		const tip = new Mesh(nose, material(PALETTE.wall));
		// The front is −z, where yaw 0 looks (`pure/rig.ts` `yawToward`).
		tip.position.set(0, body.height * 0.72, -body.radius);
		const group = new Group();
		group.add(shape, tip);
		const blob = new Mesh(blobGeometry, blobMaterial);
		blob.rotation.x = -Math.PI / 2;
		blob.position.y = 0.02;
		blob.scale.setScalar(body.radius * 1.4);
		blob.visible = shadows === 'blob';
		blobs.add(blob);
		group.add(blob);
		return group;
	};

	let pixelRatio = 1;
	const raycaster = new Raycaster();
	const ground = new Plane(new Vector3(0, 1, 0), 0);
	const ndc = new Vector2();
	const hit = new Vector3();

	return {
		setLevel(colliders) {
			disposeLevel();
			for (const c of colliders) {
				let mesh: Mesh;
				if (c.kind === 'ramp') {
					mesh = new Mesh(rampGeometry(c), material(PALETTE.ramp));
				} else {
					const w = c.maxX - c.minX;
					const h = c.maxY - c.minY;
					const d = c.maxZ - c.minZ;
					const color =
						c.maxY <= 0 ? PALETTE.floor : w <= 1.01 || d <= 1.01 ? PALETTE.wall : PALETTE.block;
					mesh = new Mesh(new BoxGeometry(w, h, d), material(color));
					mesh.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
				}
				mesh.receiveShadow = true;
				mesh.castShadow = caps.shadowCasters === 'all' && c.maxY > 0;
				levelGroup.add(mesh);
			}
		},
		sync(bodies, { target, rig }) {
			const seen = new Set<string>();
			for (const body of bodies) {
				seen.add(body.id);
				let object = capsules.get(body.id);
				if (!object) {
					object = capsule(body);
					capsules.set(body.id, object);
					bodyGroup.add(object);
				}
				object.position.set(body.x, body.y, body.z);
				object.rotation.y = yawRadians(body.yaw);
			}
			for (const [id, object] of capsules)
				if (!seen.has(id)) {
					bodyGroup.remove(object);
					for (const child of object.children) blobs.delete(child as Mesh);
					capsules.delete(id);
				}
			const at = rigPosition(target, rig);
			if (camera.fov !== rig.fov) {
				camera.fov = rig.fov;
				camera.updateProjectionMatrix();
			}
			camera.position.set(at.x, at.y, at.z);
			camera.lookAt(target.x, target.y, target.z);
			// The shadow box follows the view, so its texels stay where the player looks.
			sun.position.set(target.x + 8, target.y + 16, target.z + 6);
			sun.target.position.set(target.x, target.y, target.z);
			renderer.render(scene, camera);
		},
		resize(width, height) {
			renderer.setSize(width, height);
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
		},
		setPixelRatio(ratio) {
			if (ratio === pixelRatio) return;
			pixelRatio = ratio;
			renderer.setPixelRatio(ratio);
		},
		setShadows(next, size) {
			const mapSize = next === 'map' ? size : 0;
			if (next === shadows && mapSize === sun.shadow.mapSize.x) return;
			const recompile = (next === 'map') !== (shadows === 'map');
			shadows = next;
			renderer.shadowMap.enabled = mapSize > 0;
			sun.castShadow = mapSize > 0;
			if (mapSize > 0 && mapSize !== sun.shadow.mapSize.x) {
				sun.shadow.mapSize.set(mapSize, mapSize);
				sun.shadow.map?.dispose();
				sun.shadow.map = null;
			}
			for (const blob of blobs) blob.visible = next === 'blob';
			// Shadow receiving is compiled into each material's program.
			if (recompile) for (const m of materials.values()) m.needsUpdate = true;
		},
		get pixelRatio() {
			return pixelRatio;
		},
		pick(clientX, clientY) {
			const rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return undefined;
			ndc.set(
				((clientX - rect.left) / rect.width) * 2 - 1,
				-((clientY - rect.top) / rect.height) * 2 + 1,
			);
			raycaster.setFromCamera(ndc, camera);
			const [first] = raycaster.intersectObjects(levelGroup.children, false);
			if (first) return { x: first.point.x, y: first.point.y, z: first.point.z };
			return raycaster.ray.intersectPlane(ground, hit)
				? { x: hit.x, y: hit.y, z: hit.z }
				: undefined;
		},
		setAim(point) {
			aim.visible = !!point;
			if (point) aim.position.set(point.x, point.y + 0.03, point.z);
		},
		destroy() {
			disposeLevel();
			for (const geometry of capsuleGeometries.values()) geometry.dispose();
			nose.dispose();
			blobGeometry.dispose();
			blobMaterial.dispose();
			aim.geometry.dispose();
			for (const m of materials.values()) m.dispose();
			ramp.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
			canvas.replaceWith(canvas.cloneNode(false));
		},
	};
}
