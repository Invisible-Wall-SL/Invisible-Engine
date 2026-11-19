import {
	Frustum,
	Matrix4,
	Sphere,
	Vector3,
	type PerspectiveCamera,
	type WebGLRenderer,
} from 'three';

import { createAnimator3d, type Animator3d } from './animator';
import type { Character3d, CharacterModels3d } from './characters';
import type { CharacterAnim3D } from './pure/animGraph';
import { createCharacterInputs3d } from './pure/characterInputs';
import { lookFor3d, type Look3d } from './pure/looks';
import type { BodyView3d } from './pure/play';
import { createViewmodel3d, type Viewmodel3d } from './viewmodel';
import type { BodyLooks3d } from './world';

/** The clip a character without an animation doc plays. */
const IDLE = 'locomotion.idle';

/** A character off screen is posed every this many frames (its graph still advances every one). */
export const OFF_SCREEN_EVERY = 4;

/** What the gameplay says this frame, by input `source` name (`character:speed` → `speed`). */
export type CharacterSources3d = Partial<Record<string, number | boolean>>;

export type Cast3d = BodyLooks3d & {
	/** Fire a trigger on one body's graph at its next {@link animate} (a room one-shot, the own
	 *  device's press, predicted). */
	trigger(id: string, trigger: string): void;
	/**
	 * One render frame (real time, outside the fixed step): each body's gameplay → its graph's
	 * `character:*` inputs (`pure/characterInputs.ts`, plus the queued triggers), then every
	 * character posed — on screen every frame, off screen every {@link OFF_SCREEN_EVERY}th, culled
	 * never (its graph still advances).
	 */
	animate(bodies: readonly BodyView3d[], dtMs: number, camera: PerspectiveCamera): void;
	/**
	 * First person for this body (the own player), or none: its look's viewmodel is drawn by
	 * {@link drawOverlay}, driven by that body's gameplay. The world hides the body itself
	 * (`World3d.setHiddenFromView`).
	 */
	setFirstPerson(id: string | undefined, character?: string): void;
	/** The viewmodel's pass, after the world (`World3d.setOverlay`). */
	drawOverlay(renderer: WebGLRenderer, camera: PerspectiveCamera): void;
	/** The viewmodel, while first person shows one. */
	readonly viewmodel: Viewmodel3d | undefined;
	/** The characters, by body id (the probe reads them). */
	readonly characters: ReadonlyMap<string, Character3d>;
	/** Their animation graphs, by body id. */
	readonly animators: ReadonlyMap<string, Animator3d>;
	dispose(): void;
};

const SOURCE = 'character:';

/**
 * The bodies' characters: each body gets the look its character names (`arcade.world3d.looks`),
 * cloned from `models` with its attachments hung on their sockets, and — when the look names an
 * animation doc (`arcade.world3d.anim`) — its own animation graph on its own mixer (`animator.ts`).
 * Until a look's files have loaded the world keeps drawing the placeholder capsule.
 */
export function createCast3d({
	models,
	looks,
	anims = {},
	topSpeed,
}: {
	models: CharacterModels3d;
	looks: Readonly<Record<string, Look3d>>;
	anims?: Readonly<Record<string, CharacterAnim3D>>;
	/** A body's top speed (m/s): what 1 is on its graph's local move axes. */
	topSpeed: (body: BodyView3d) => number;
}): Cast3d {
	const inputs = createCharacterInputs3d({ topSpeed });
	const queued = new Map<string, string[]>();
	const characters = new Map<string, Character3d>();
	const animators = new Map<string, Animator3d>();
	const attached = new Map<string, Character3d[]>();
	const libraries = (look: Look3d) => [
		...new Set([...look.modelIds, ...((look.anim && anims[look.anim]?.modelIds) || [])]),
	];
	const lookIds = new Map<Look3d, string>(Object.entries(looks).map(([id, look]) => [look, id]));
	for (const look of Object.values(looks)) {
		void models.preload(look.modelId, libraries(look));
		for (const a of look.attach) void models.preload(a.modelId, []);
	}
	let firstPerson: { id: string; viewmodel: Viewmodel3d } | undefined;
	const frustum = new Frustum();
	const viewProjection = new Matrix4();
	const bounds = new Sphere(new Vector3(), 1.2);
	let frames = 0;

	const forget = (id: string) => {
		characters.get(id)?.dispose();
		for (const prop of attached.get(id) ?? []) prop.dispose();
		characters.delete(id);
		animators.delete(id);
		attached.delete(id);
		inputs.forget(id);
		queued.delete(id);
	};

	/** Every doc input whose `source` is `character:<name>` takes `sources[name]`. */
	const drive = (id: string, sources: CharacterSources3d, triggers: readonly string[]) => {
		const animator = animators.get(id);
		if (!animator) return;
		for (const input of animator.doc.inputs) {
			if (!input.source?.startsWith(SOURCE)) continue;
			const value = sources[input.source.slice(SOURCE.length)];
			if (value !== undefined) animator.graph.setInput(input.id, value);
		}
		for (const trigger of triggers) animator.graph.fire(trigger);
	};

	return {
		look(body: BodyView3d) {
			const look = lookFor3d(looks, body.character);
			if (!look) return undefined;
			// Drawn once the model AND every attachment have loaded (a late sword never pops in).
			const props = look.attach.map((a) => models.create(a.modelId, [], { onSocket: true }));
			const character = props.every(Boolean)
				? models.create(look.modelId, libraries(look))
				: undefined;
			if (!character) {
				for (const prop of props) prop?.dispose();
				return undefined;
			}
			look.attach.forEach((a, i) => {
				const socket = character.socket(a.socket);
				const prop = props[i];
				if (socket && prop) socket.add(prop.root);
				else if (!socket) console.warn(`[engine-3d] ${look.modelId} has no socket SK_${a.socket}`);
			});
			const doc = look.anim ? anims[look.anim] : undefined;
			if (doc) {
				const overrides = doc.heroOverrides?.[lookIds.get(look) ?? ''];
				animators.set(body.id, createAnimator3d({ character, doc, overrides }));
			} else {
				if (look.anim) console.warn(`[engine-3d] no animation doc "${look.anim}"`);
				const idle = character.clips.get(IDLE);
				if (idle) character.mixer.clipAction(idle).play();
			}
			characters.set(body.id, character);
			attached.set(
				body.id,
				props.filter((p): p is Character3d => !!p),
			);
			return character.root;
		},
		forget,
		trigger(id, trigger) {
			queued.set(id, [...(queued.get(id) ?? []), trigger]);
		},
		animate(bodies, dtMs, camera) {
			for (const body of bodies) {
				const fp = firstPerson?.id === body.id ? firstPerson.viewmodel : undefined;
				if (!animators.has(body.id) && !fp) continue;
				const { sample, triggers } = inputs.update(body, dtMs);
				const all = [...triggers, ...(queued.get(body.id) ?? [])];
				drive(body.id, sample, all);
				fp?.animate(dtMs, sample, all);
				queued.delete(body.id);
			}
			const dt = Math.max(dtMs, 0) / 1000;
			frames += 1;
			camera.updateMatrixWorld();
			viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			frustum.setFromProjectionMatrix(viewProjection);
			for (const [id, character] of characters) {
				const animator = animators.get(id);
				if (!animator) {
					character.mixer.update(dt);
					continue;
				}
				character.root.getWorldPosition(bounds.center);
				bounds.center.y += 0.9;
				const pose = character.culled()
					? false
					: frustum.intersectsSphere(bounds) || frames % OFF_SCREEN_EVERY === 0;
				animator.frame(dt, pose);
			}
		},
		setFirstPerson(id, character) {
			if (firstPerson?.id === id) return;
			firstPerson?.viewmodel.dispose();
			firstPerson = undefined;
			const vm = id ? lookFor3d(looks, character)?.viewmodel : undefined;
			if (!id || !vm) return;
			firstPerson = {
				id,
				viewmodel: createViewmodel3d({
					models,
					modelId: vm.modelId,
					libraries: [
						...new Set([...vm.modelIds, ...((vm.anim && anims[vm.anim]?.modelIds) || [])]),
					],
					doc: vm.anim ? anims[vm.anim] : undefined,
					attach: vm.attach,
				}),
			};
		},
		drawOverlay(renderer, camera) {
			firstPerson?.viewmodel.draw(renderer, camera, camera.aspect);
		},
		get viewmodel() {
			return firstPerson?.viewmodel;
		},
		characters,
		animators,
		dispose() {
			for (const id of [...characters.keys()]) forget(id);
			firstPerson?.viewmodel.dispose();
			firstPerson = undefined;
		},
	};
}
