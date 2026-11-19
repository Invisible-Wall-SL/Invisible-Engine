import {
	AmbientLight,
	DirectionalLight,
	PerspectiveCamera,
	Scene,
	Vector3,
	type Camera,
	type WebGLRenderer,
} from 'three';

import { createAnimator3d, type Animator3d } from './animator';
import type { Character3d, CharacterModels3d } from './characters';
import type { CharacterAnim3D } from './pure/animGraph';
import type { CharacterSample3d } from './pure/characterInputs';
import type { Attach3d } from './pure/looks';

/** The socket on the viewmodel's head that is put on the camera (`ie_conventions.py`). */
export const VIEWMODEL_EYE = 'eye';
/** The viewmodel's own field of view: narrower than the world's wide FOV, so the arms are not
 *  stretched at the screen's edges. */
export const VIEWMODEL_FOV = 55;

export type Viewmodel3d = {
	/** Loaded (model, libraries and attachments): it draws from now on. */
	readonly ready: boolean;
	readonly animator: Animator3d | undefined;
	/** One render frame of the own player: its sample and triggers drive the viewmodel's graph. */
	animate(dtMs: number, sample: CharacterSample3d | undefined, triggers: readonly string[]): void;
	/** Draw it over the world: depth cleared, its own camera turned as the world's. */
	draw(renderer: WebGLRenderer, world: Camera, aspect: number): void;
	dispose(): void;
};

/**
 * The own player's first-person viewmodel (owner decision 2026-11-18; the convention in
 * `docs/conventions/blender-3d-assets.md` "First-person viewmodel"): a `CH_<hero>_vm` model on the
 * IE Humanoid, its `SK_eye` socket on the camera, posed by its own graph (the `viewmodel.*` clips),
 * with its weapon on `SK_hand_r`. It lives in its own scene with its own light and camera and is
 * drawn after the world with the depth buffer cleared, so it never clips into a wall and the world's
 * FOV never stretches it.
 */
export function createViewmodel3d({
	models,
	modelId,
	libraries,
	doc,
	attach = [],
}: {
	models: CharacterModels3d;
	modelId: string;
	libraries: readonly string[];
	doc: CharacterAnim3D | undefined;
	attach?: readonly Attach3d[];
}): Viewmodel3d {
	const scene = new Scene();
	const camera = new PerspectiveCamera(VIEWMODEL_FOV, 1, 0.01, 10);
	const key = new DirectionalLight(0xffffff, 2);
	key.position.set(0.4, 1, 0.6);
	scene.add(new AmbientLight(0xffffff, 0.6), key, camera);
	void models.preload(modelId, libraries);
	for (const a of attach) void models.preload(a.modelId, []);

	let character: Character3d | undefined;
	let props: Character3d[] = [];
	let animator: Animator3d | undefined;
	const eye = new Vector3();

	const load = () => {
		const made = attach.map((a) => models.create(a.modelId, [], { onSocket: true }));
		const arms = made.every(Boolean) ? models.create(modelId, libraries) : undefined;
		if (!arms) {
			for (const p of made) p?.dispose();
			return;
		}
		attach.forEach((a, i) => {
			const prop = made[i];
			const socket = arms.socket(a.socket);
			if (prop && socket) socket.add(prop.root);
		});
		const eyeSocket = arms.socket(VIEWMODEL_EYE);
		if (!eyeSocket) console.warn(`[engine-3d] viewmodel ${modelId} has no SK_${VIEWMODEL_EYE}`);
		// Every part is drawn: the viewmodel is always near and always on screen.
		arms.root.traverse((o) => {
			o.frustumCulled = false;
			o.castShadow = false;
		});
		camera.add(arms.root);
		arms.root.updateMatrixWorld(true);
		// Put the eye on the camera: the root moves by the eye's place in the camera's space.
		if (eyeSocket) {
			eyeSocket.getWorldPosition(eye);
			camera.worldToLocal(eye);
			arms.root.position.sub(eye);
		}
		character = arms;
		props = made.filter((p): p is Character3d => !!p);
		animator = doc ? createAnimator3d({ character: arms, doc }) : undefined;
	};

	return {
		get ready() {
			return !!character;
		},
		get animator() {
			return animator;
		},
		animate(dtMs, sample, triggers) {
			if (!character) load();
			if (!character) return;
			const dt = Math.max(dtMs, 0) / 1000;
			if (!animator) {
				character.mixer.update(dt);
				return;
			}
			for (const input of animator.doc.inputs) {
				const name = input.source?.startsWith('character:') ? input.source.slice(10) : undefined;
				const value = name && sample ? sample[name as keyof CharacterSample3d] : undefined;
				if (value !== undefined) animator.graph.setInput(input.id, value);
			}
			for (const t of triggers) animator.graph.fire(t);
			animator.frame(dt, true);
		},
		draw(renderer, world, aspect) {
			if (!character) return;
			world.getWorldQuaternion(camera.quaternion);
			camera.position.set(0, 0, 0);
			if (camera.aspect !== aspect) {
				camera.aspect = aspect;
				camera.updateProjectionMatrix();
			}
			const auto = renderer.autoClear;
			renderer.autoClear = false;
			renderer.clearDepth();
			renderer.render(scene, camera);
			renderer.autoClear = auto;
		},
		dispose() {
			character?.dispose();
			for (const p of props) p.dispose();
			character = undefined;
		},
	};
}
