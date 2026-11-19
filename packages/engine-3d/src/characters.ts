import {
	AnimationClip,
	AnimationMixer,
	BackSide,
	Box3,
	Color,
	DataTexture,
	Group,
	LOD,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	MeshToonMaterial,
	NearestFilter,
	Object3D,
	RedFormat,
	SkinnedMesh,
	Sphere,
	type Material,
	type Texture,
	type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import type { ModelExportIndex } from 'constants-shared/models';
import type { ModelTierId } from 'constants-shared/modelTiers';

import {
	lodDistances,
	lodNameOf,
	modelAt3d,
	toonOf,
	type ModelAt3d,
	type Toon3d,
} from './pure/models';
import type { Caps3d } from './pure/tier';

/** One character on screen: its own skeleton, LOD, sockets and mixer. */
export type Character3d = {
	readonly root: Object3D;
	readonly mixer: AnimationMixer;
	/** Every clip the character's libraries brought, by `<set>.<clip>` name, bound to its bones. */
	readonly clips: ReadonlyMap<string, AnimationClip>;
	/** The `SK_<name>` attach point, by `<name>`. */
	socket(name: string): Object3D | undefined;
	/** The LOD level drawn after the last render (0 = the richest shipped), per mesh group. */
	lodLevels(): number[];
	/** Every LOD group is below its smallest screen size (nothing drawn): no need to pose it. */
	culled(): boolean;
	dispose(): void;
};

export type CharacterModels3d = {
	/** A new character of a model and the clip libraries named, or undefined while it loads (or when
	 *  the index has no such model). Each call clones: every character has its own skeleton. */
	create(
		modelId: string,
		libraries: readonly string[],
		opts?: { onSocket?: boolean },
	): Character3d | undefined;
	/** Start loading a model and its clip libraries ahead of the first `create`. */
	preload(modelId: string, libraries: readonly string[]): Promise<void>;
	/** Recompute every LOD's distances for a new FOV (never per frame). */
	setFov(fovDeg: number): void;
	dispose(): void;
};

/** The only bone whose translation a clip keys (`docs/conventions/blender-3d-assets.md`). */
export const HIPS_BONE = 'pelvis';

/**
 * A clip for a hero whose hips stand at `hero` metres when the library's skeleton has them at
 * `library`: the hips translation track scaled by `hero / library` (heroes of other heights share
 * one library, since clips key rotations only, plus the hips). The same clip when the heights match.
 */
export function scaleHips(
	clip: AnimationClip,
	hero: number | undefined,
	library: number | undefined,
): AnimationClip {
	if (!hero || !library || Math.abs(hero / library - 1) < 1e-4) return clip;
	const k = hero / library;
	const scaled = clip.clone();
	for (const track of scaled.tracks)
		if (track.name === `${HIPS_BONE}.position`)
			for (let i = 0; i < track.values.length; i++) track.values[i] *= k;
	return scaled;
}

/** Three bands of light: the toon look, used when a model ships no ramp of its own. */
export const defaultToonRamp = (): DataTexture => {
	const ramp = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
	ramp.minFilter = NearestFilter;
	ramp.magFilter = NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
};

type Template = {
	at: ModelAt3d;
	gltf: GLTF;
	/** Bounding-sphere radius of each LOD group's richest level, by base name. */
	radius: Map<string, number>;
};

/** The rim term, added to the toon light before it is written out (a hard-edged fresnel). */
const RIM_FRAGMENT = /* glsl */ `
	{
		float facing = 1.0 - saturate( dot( normalize( vViewPosition ), normal ) );
		outgoingLight += uRimColor * uRim * smoothstep( 0.55, 0.62, facing );
	}
	#include <opaque_fragment>`;

/** The toon material for a glTF material: base colour (map and factor), the ramp, normal and
 *  emissive maps when the tier kept them (a dropped map compiles no variant), the rim light. */
function toonMaterial(
	source: Material,
	toon: Toon3d,
	ramp: Texture,
	anisotropy: number,
): MeshToonMaterial {
	const std = source as MeshStandardMaterial;
	const material = new MeshToonMaterial({
		name: source.name,
		color: std.color?.clone() ?? new Color(0xffffff),
		map: std.map ?? null,
		gradientMap: ramp,
		normalMap: std.normalMap ?? null,
		emissive: std.emissive?.clone() ?? new Color(0),
		emissiveMap: std.emissiveMap ?? null,
		transparent: std.transparent,
		alphaTest: std.alphaTest,
		side: std.side,
	});
	for (const map of [material.map, material.normalMap, material.emissiveMap])
		if (map) map.anisotropy = anisotropy;
	if (toon.rim > 0) {
		material.onBeforeCompile = (shader) => {
			shader.uniforms.uRim = { value: toon.rim };
			shader.uniforms.uRimColor = { value: new Color(...toon.rimColor) };
			shader.fragmentShader = shader.fragmentShader
				.replace('void main() {', 'uniform float uRim;\nuniform vec3 uRimColor;\nvoid main() {')
				.replace('#include <opaque_fragment>', RIM_FRAGMENT);
		};
		material.customProgramCacheKey = () => 'ie-toon-rim';
	}
	return material;
}

/** The inverted hull: back faces pushed out along the (skinned) normal, in one flat colour. */
function outlineMaterial(toon: Toon3d): MeshBasicMaterial {
	const material = new MeshBasicMaterial({
		color: new Color(...toon.outlineColor),
		side: BackSide,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uOutline = { value: toon.outline };
		shader.vertexShader = shader.vertexShader
			.replace('void main() {', 'uniform float uOutline;\nvoid main() {')
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\n#ifndef USE_SKINNING\n\ttransformed += normalize( normal ) * uOutline;\n#endif',
			)
			.replace(
				'#include <skinning_vertex>',
				'#include <skinning_vertex>\n#ifdef USE_SKINNING\n\ttransformed += normalize( objectNormal ) * uOutline;\n#endif',
			);
	};
	material.customProgramCacheKey = () => 'ie-toon-outline';
	return material;
}

/**
 * The model loader of the 3D view (runtime step 3, T2): GLBs from the `models` export index at the
 * chosen tier (`tiers[tier] ?? tiers.full`), read with three's `GLTFLoader` + `KTX2Loader` (the Basis
 * transcoder three vendors, run in its worker pool and started at once so the first texture does not
 * wait) + `MeshoptDecoder`. One template per model; every character is a `SkeletonUtils.clone` of it
 * with the toon material from `extras.toon` (ramp, rim, inverted-hull outline), a `THREE.LOD` per
 * `<base>_LOD<n>` group whose distances come from the export's screen sizes and the FOV, and its own
 * `AnimationMixer` holding the clip libraries' clips (bound by bone name).
 */
export function createCharacterModels3d({
	renderer,
	index,
	tier,
	base,
	caps,
	fovDeg,
}: {
	renderer: WebGLRenderer;
	index: ModelExportIndex | undefined;
	tier: ModelTierId;
	/** What the index's `models/…` paths resolve against. */
	base: string;
	caps: Pick<Caps3d, 'anisotropy' | 'lodBias' | 'shadows'>;
	fovDeg: number;
}): CharacterModels3d {
	const ktx2 = new KTX2Loader().detectSupport(renderer);
	const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
	// Start the transcoder now: it is fetched and compiled in the worker while the level draws.
	void ktx2.init?.();
	const anisotropy = Math.min(caps.anisotropy, renderer.capabilities.getMaxAnisotropy());
	const ramp = defaultToonRamp();
	const templates = new Map<string, Template>();
	/** Per clip library: its clips and the rest height of its hips bone (local to `root`). */
	const libraries = new Map<string, { clips: AnimationClip[]; hips: number | undefined }>();
	const pending = new Map<string, Promise<void>>();
	/** Ids whose load finished without a result (not in the index, or the fetch failed). */
	const failed = new Set<string>();
	type Placed = { lod: LOD; levels: number[]; radius: number };
	const live = new Set<{ lods: Placed[]; at: ModelAt3d }>();
	let fov = fovDeg;

	const load = (id: string, store: (gltf: GLTF, at: ModelAt3d) => void): Promise<void> => {
		const known = pending.get(id);
		if (known) return known;
		const at = modelAt3d(index, id, tier, base);
		if (!at) {
			console.warn(`[engine-3d] model "${id}" is not in the models index`);
			failed.add(id);
			const none = Promise.resolve();
			pending.set(id, none);
			return none;
		}
		const job = loader.loadAsync(at.url).then(
			(gltf) => store(gltf, at),
			(error) => {
				failed.add(id);
				console.error(`[engine-3d] model "${id}" (${at.url}) did not load`, error);
			},
		);
		pending.set(id, job);
		return job;
	};

	const loadModel = (id: string) =>
		load(id, (gltf, at) => {
			const radius = new Map<string, number>();
			gltf.scene.updateMatrixWorld(true);
			gltf.scene.traverse((o) => {
				const lod = lodNameOf(o.name);
				if (!lod || radius.has(lod.base)) return;
				const sphere = new Box3().setFromObject(o).getBoundingSphere(new Sphere());
				radius.set(lod.base, sphere.radius);
			});
			templates.set(id, { at, gltf, radius });
		});
	const loadLibrary = (id: string) =>
		load(id, (gltf) => {
			libraries.set(id, {
				clips: gltf.animations,
				hips: gltf.scene.getObjectByName(HIPS_BONE)?.position.y,
			});
		});

	const place = (lods: readonly Placed[], at: ModelAt3d) => {
		for (const { lod, levels, radius } of lods) {
			const distances = lodDistances(radius, fov, levels, at.entry.lodScreenSize, caps.lodBias);
			lod.levels.forEach((level, i) => {
				level.distance = distances[i];
			});
		}
	};

	const create: CharacterModels3d['create'] = (modelId, names, opts) => {
		const template = templates.get(modelId);
		if (!template || names.some((n) => !libraries.has(n) && !failed.has(n))) {
			void loadModel(modelId);
			for (const n of names) void loadLibrary(n);
			return undefined;
		}
		const model = cloneSkinned(template.gltf.scene);
		// A body's model faces glTF +z (Blender −y) and the view's yaw 0 looks down −z; a model hung
		// on a socket keeps the socket's own axes.
		if (!opts?.onSocket) model.rotation.y = Math.PI;
		const root = new Group();
		root.name = modelId;
		root.add(model);
		const sockets = new Map<string, Object3D>();
		const groups = new Map<string, { level: number; object: Object3D }[]>();
		const materials: Material[] = [];
		root.traverse((o) => {
			if (o.name.startsWith('SK_')) sockets.set(o.name.slice(3), o);
			const lod = lodNameOf(o.name);
			if (lod)
				groups.set(lod.base, [...(groups.get(lod.base) ?? []), { level: lod.level, object: o }]);
		});
		const lods: Placed[] = [];
		for (const [name, members] of groups) {
			members.sort((a, b) => (a.level < 0 ? -1 : b.level < 0 ? 1 : a.level - b.level));
			const parent = members[0].object.parent ?? root;
			const lod = new LOD();
			lod.name = `${name}_LOD`;
			parent.add(lod);
			for (const { object } of members) {
				object.traverse((o) => {
					if (!(o instanceof Mesh)) return;
					const toon = toonOf(o.material.userData);
					const material = toonMaterial(o.material as Material, toon, ramp, anisotropy);
					materials.push(material);
					o.material = material;
					o.castShadow = caps.shadows === 'map';
					o.receiveShadow = false;
					o.frustumCulled = !(o instanceof SkinnedMesh);
					if (toon.outline > 0) {
						const hullMaterial = outlineMaterial(toon);
						materials.push(hullMaterial);
						const hull =
							o instanceof SkinnedMesh
								? new SkinnedMesh(o.geometry, hullMaterial)
								: new Mesh(o.geometry, hullMaterial);
						if (hull instanceof SkinnedMesh && o instanceof SkinnedMesh)
							hull.bind(o.skeleton, o.bindMatrix);
						hull.frustumCulled = false;
						hull.name = `${o.name}_outline`;
						o.add(hull);
					}
				});
				lod.addLevel(object, 0, 0.1);
			}
			// The cull level: nothing drawn below the smallest screen size.
			lod.addLevel(new Object3D(), Infinity);
			lods.push({
				lod,
				levels: members.map((m) => m.level),
				radius: template.radius.get(name) ?? 1,
			});
		}
		const tracked = { lods, at: template.at };
		place(lods, template.at);
		live.add(tracked);

		const clips = new Map<string, AnimationClip>();
		const heroHips = model.getObjectByName(HIPS_BONE)?.position.y;
		for (const n of names) {
			const library = libraries.get(n);
			for (const clip of library?.clips ?? [])
				clips.set(clip.name, scaleHips(clip, heroHips, library?.hips));
		}
		const mixer = new AnimationMixer(model);
		return {
			root,
			mixer,
			clips,
			socket: (name) => sockets.get(name),
			lodLevels: () => lods.map(({ lod }) => lod.getCurrentLevel()),
			culled: () =>
				lods.length > 0 && lods.every(({ lod }) => lod.getCurrentLevel() === lod.levels.length - 1),
			dispose() {
				live.delete(tracked);
				mixer.stopAllAction();
				mixer.uncacheRoot(model);
				for (const m of materials) m.dispose();
				root.removeFromParent();
			},
		};
	};

	return {
		create,
		async preload(modelId, names) {
			await Promise.all([loadModel(modelId), ...names.map(loadLibrary)]);
		},
		setFov(fovDeg) {
			if (fovDeg === fov) return;
			fov = fovDeg;
			for (const { lods, at } of live) place(lods, at);
		},
		dispose() {
			for (const t of templates.values())
				t.gltf.scene.traverse((o) => {
					if (o instanceof Mesh) {
						o.geometry.dispose();
						for (const m of [o.material].flat()) {
							for (const value of Object.values(m))
								if (value && typeof value === 'object' && 'isTexture' in value)
									(value as Texture).dispose();
							m.dispose();
						}
					}
				});
			ramp.dispose();
			ktx2.dispose();
		},
	};
}
