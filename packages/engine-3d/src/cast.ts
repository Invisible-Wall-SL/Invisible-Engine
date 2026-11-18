import type { Character3d, CharacterModels3d } from './characters';
import type { BodyView3d } from './pure/play';
import { lookFor3d, type Look3d } from './pure/looks';
import type { BodyLooks3d } from './world';

/** The clip a character plays until its animation graph runs (Phase 2 A1–A2). */
const IDLE = 'locomotion.idle';

export type Cast3d = BodyLooks3d & {
	/** Advance every character's animation by one render frame (real time, outside the fixed step). */
	frame(dtMs: number): void;
	/** The characters on screen, by body id (the probe reads them). */
	readonly characters: ReadonlyMap<string, Character3d>;
	dispose(): void;
};

/**
 * The bodies' characters: each body gets the look its character names (`arcade.world3d.looks`),
 * cloned from `models` with its attachments hung on their sockets. Until a look's files have
 * loaded the world keeps drawing the placeholder capsule.
 */
export function createCast3d({
	models,
	looks,
}: {
	models: CharacterModels3d;
	looks: Readonly<Record<string, Look3d>>;
}): Cast3d {
	const characters = new Map<string, Character3d>();
	const attached = new Map<string, Character3d[]>();
	for (const look of Object.values(looks)) {
		void models.preload(look.modelId, look.modelIds);
		for (const a of look.attach) void models.preload(a.modelId, []);
	}
	return {
		look(body: BodyView3d) {
			const look = lookFor3d(looks, body.character);
			if (!look) return undefined;
			// Drawn once the model AND every attachment have loaded (a late sword never pops in).
			const props = look.attach.map((a) => models.create(a.modelId, [], { onSocket: true }));
			const character = props.every(Boolean)
				? models.create(look.modelId, look.modelIds)
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
			const idle = character.clips.get(IDLE);
			if (idle) character.mixer.clipAction(idle).play();
			characters.set(body.id, character);
			attached.set(
				body.id,
				props.filter((p): p is Character3d => !!p),
			);
			return character.root;
		},
		forget(id) {
			characters.get(id)?.dispose();
			for (const prop of attached.get(id) ?? []) prop.dispose();
			characters.delete(id);
			attached.delete(id);
		},
		frame(dtMs) {
			const dt = Math.max(dtMs, 0) / 1000;
			for (const character of characters.values()) character.mixer.update(dt);
		},
		characters,
		dispose() {
			for (const id of [...characters.keys()]) this.forget(id);
		},
	};
}
