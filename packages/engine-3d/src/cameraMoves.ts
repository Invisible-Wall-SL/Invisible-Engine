import {
	PropertyBinding,
	Quaternion,
	Vector3,
	type AnimationClip,
	type Camera,
	type Interpolant,
	type KeyframeTrack,
	type Object3D,
} from 'three';

import type { CameraMove3d } from './pure/camera';

/**
 * A game's authored camera moves (`docs/design/3d/animation-evaluation.md` §4): one GLB of camera
 * clips animated in Blender (`tools/blender/ie_camera_move.py` → `anim/cameras/<arena>.glb`), each
 * clip a node TRS track on the camera. A move is sampled, not mixed: each track's own interpolant
 * (linear, quaternions slerped) written to its node, then the camera node's WORLD pose read, so a
 * clip may animate a parent of the camera too. Not an `AnimationMixer` per clip: a mixer writes a
 * value only when it differs from the last one IT wrote, so two clips on one node left the other
 * clip's position in place (the roundEnd move started where the intro ended). FOV is the file
 * camera's, constant per move.
 */
export function cameraMovesOf(
	scene: Object3D,
	clips: readonly AnimationClip[],
): Map<string, CameraMove3d> {
	let camera: Camera | undefined;
	scene.traverse((node) => {
		if (!camera && (node as Camera).isCamera) camera = node as Camera;
	});
	const moves = new Map<string, CameraMove3d>();
	if (!camera) return moves;
	const eye = camera;
	const fov = 'fov' in eye && typeof eye.fov === 'number' ? eye.fov : 45;
	const position = new Vector3();
	const rotation = new Quaternion();
	for (const clip of clips) {
		const writers = clip.tracks.flatMap((track) => {
			const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
			const node = PropertyBinding.findNode(scene, nodeName) as Object3D | null;
			if (!node) return [];
			// Set per track by its interpolation mode (linear; slerp for a quaternion track); not
			// in three's type declarations.
			const interpolant = (
				track as KeyframeTrack & { createInterpolant(): Interpolant }
			).createInterpolant();
			const at = (t: number) => interpolant.evaluate(t) as ArrayLike<number>;
			switch (propertyName) {
				case 'position':
					return [(t: number) => void node.position.fromArray(at(t) as number[])];
				case 'quaternion':
					return [(t: number) => void node.quaternion.fromArray(at(t) as number[]).normalize()];
				case 'scale':
					return [(t: number) => void node.scale.fromArray(at(t) as number[])];
				default:
					return [];
			}
		});
		moves.set(clip.name, {
			name: clip.name,
			durationMs: clip.duration * 1000,
			fov,
			sample(tMs) {
				const t = Math.max(0, Math.min(tMs, clip.duration * 1000)) / 1000;
				for (const write of writers) write(t);
				scene.updateMatrixWorld(true);
				eye.getWorldPosition(position);
				eye.getWorldQuaternion(rotation);
				return {
					position: { x: position.x, y: position.y, z: position.z },
					rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
				};
			},
		});
	}
	return moves;
}

/** Read a camera-moves GLB (the glTF loader is its own lazy chunk, fetched only by a game that has
 *  moves): from a URL, or from its bytes (Node: `check:engine-3d-camera`). */
export async function loadCameraMoves3d(
	from: string | ArrayBuffer,
): Promise<Map<string, CameraMove3d>> {
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const loader = new GLTFLoader();
	const gltf =
		typeof from === 'string' ? await loader.loadAsync(from) : await loader.parseAsync(from, '');
	return cameraMovesOf(gltf.scene, gltf.animations);
}
