/**
 * How a 3D game's characters look: `arcade.world3d.looks` in the raw Game Config (the block the 3D
 * room and `world3dOf` read; `game-config` drops it, so no 2D bundle changes). Per character id
 * (the room's `character`, `default` for anyone else):
 *
 *   "looks": { "default": {
 *     "modelId": "testhero",                                  // a `hero` model of the models index
 *     "modelIds": ["anim_locomotion", "anim_combat"],         // its clip libraries (`anim` models)
 *     "attach": [{ "socket": "hand_r", "modelId": "testsword" }],
 *     "anim": "humanoid"                                     // its CharacterAnim3D doc, by id
 *   } }
 *
 * The field names are the models export's (`modelId` / `modelIds`, walked raw), so naming a model
 * here is what makes a publish ship it (CLAUDE.md rule 8).
 */
export type Attach3d = { socket: string; modelId: string };

export type Look3d = {
	modelId: string;
	/** Clip libraries, by model id. */
	modelIds: string[];
	attach: Attach3d[];
	/** The `arcade.world3d.anim` doc this look plays, by id. */
	anim?: string;
};

export const DEFAULT_LOOK = 'default';

const MAX_LOOKS = 64;
const MAX_LIST = 16;

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
/** A model id, exactly as the launcher's rule takes it (`apps/launcher-api/src/lib/models/modelId.ts`
 *  `MODEL_ID`; `check:engine-3d` compares the two). */
export const LOOK_MODEL_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const name = (v: unknown) => (typeof v === 'string' && LOOK_MODEL_ID.test(v) ? v : undefined);

/** Every well-formed look; a malformed one is dropped with its path in `problems`. */
export function looksOf3d(raw: unknown): { looks: Record<string, Look3d>; problems: string[] } {
	const looks: Record<string, Look3d> = {};
	const problems: string[] = [];
	if (raw === undefined) return { looks, problems };
	if (!isObject(raw)) return { looks, problems: ['arcade.world3d.looks: not an object'] };
	for (const [id, entry] of Object.entries(raw).slice(0, MAX_LOOKS)) {
		const path = `arcade.world3d.looks.${id}`;
		const modelId = isObject(entry) ? name(entry.modelId) : undefined;
		if (!isObject(entry) || !modelId) {
			problems.push(`${path}.modelId: a model id`);
			continue;
		}
		const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);
		const modelIds = list(entry.modelIds)
			.map(name)
			.filter((v): v is string => !!v);
		const attach = list(entry.attach).flatMap((a, i) => {
			const socket = isObject(a) ? name(a.socket) : undefined;
			const model = isObject(a) ? name(a.modelId) : undefined;
			if (socket && model) return [{ socket, modelId: model }];
			problems.push(`${path}.attach.${i}: { socket, modelId }`);
			return [];
		});
		const anim = name(entry.anim);
		looks[id] = { modelId, modelIds, attach, ...(anim ? { anim } : {}) };
	}
	return { looks, problems };
}

/** The look of a character: its own, else `default`, else none (the placeholder capsule). */
export const lookFor3d = (looks: Readonly<Record<string, Look3d>>, character?: string) =>
	(character ? looks[character] : undefined) ?? looks[DEFAULT_LOOK];
