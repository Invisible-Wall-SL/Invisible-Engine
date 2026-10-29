import {
	createArcadeLoop,
	hopsOnThePlane,
	type ArcadeCharacterIo,
	type ArcadeLoop,
} from 'engine-game';
import {
	isoViewRect,
	sceneCamera,
	sceneProjection,
	scenePaths,
	sceneTilemaps,
	sceneWorld,
	stashFlowInstanceInput,
	worldCameraScene,
	type LayoutType,
	type LayoutNode,
	type Scene,
	type ScenePath,
	type SceneTileGrid,
} from 'engine-layout';
import {
	setCulled,
	setHiding,
	setLifts,
	setWorldCameraView,
	spawnLayerPoint,
	spawnStore,
} from 'engine-layout/svelte';
import { normalizeGameConfigDoc, resolveArcade, type ArcadeCharacter } from 'game-config';

import { bakedGameConfig } from '../editor-scenes';
import { registerBoardEffects, registerBoardValues } from './flowBoardEffects';
import { typingInto } from './flowKeys';
import { getFlowV2 } from './flowV2InterpreterHolder';

/**
 * THE ARCADE RUNTIME (`docs/design/game-families.md` §4.2, §6.4) — the shared runtime's family
 * branch for a rules-decided arcade game.
 *
 * `engine-game`'s loop moves the bodies (`createArcadeLoop`, over `engine-mechanics` `motion.js`);
 * this module gives it the game's live set — every spawn layer declared by the time the play field
 * mounts — and its Flow: the loop's signals go to the v2 flow, and its actions and values are
 * registered for the flow to call. `<ArcadeStage />` ticks it.
 *
 * When a screen declares a world or a camera (P10.12, `worldCameraScene`), the loop is given that
 * camera, the play field becomes the world (unless the config names a `field`), and after every
 * frame the camera and the culled instances are published for `<LayoutScene>` and `<SpawnLayer>` to
 * draw by. A game with neither publishes nothing.
 *
 * CHARACTERS (§4.3, P10.11): when the config has some, the loop is also given the player's input —
 * the flow key map's actions while their keys are held, and a pressed pointer in the play field's
 * space — the layout's paths, the flow's variables, the looks' inputs (`animInputs`, set on the
 * spawned instances) and the spawn store for shots. A config without characters attaches none of it.
 * From P10.13 they also get the level's tiles — the top-level `tilemap` nodes of every screen that
 * holds a spawn layer — and a hopping character's height is published after each frame for
 * `<SpawnLayer>` to draw as a lift and a shadow.
 *
 * ABILITIES AND ZONE FORCES (§4.3, P11.5) need nothing more: the loop reads them from the config
 * and the characters' input (`ability1` / `ability2` in the flow key map); a character an ability
 * put out is published as culled, with or without a camera.
 *
 * A slot game never starts it: only `<ArcadeStage />` calls {@link startArcade}, and `Game.svelte`
 * mounts that only for a mechanic that is a play field.
 */

/** The URL parameter that pins `$engine.random`'s seed (the playtester uses it). */
const ARCADE_SEED_PARAM = 'arseed';

let loop: ArcadeLoop | undefined;
/** The config's characters have abilities, so a caught one is hidden (culled) even with no camera. */
let hides = false;
/** The config has a hopping character, so lifts are published. */
let hops = false;
let shadowOf: (componentId: string) => { shadow: number; foot: number } = () => ({
	shadow: 0,
	foot: 0,
});
let world: { w: number; h: number } | undefined;
let view = () => ({ w: 0, h: 0 });

const seedOf = (): string => {
	const pinned =
		typeof window === 'undefined'
			? null
			: new URLSearchParams(window.location.search).get(ARCADE_SEED_PARAM);
	// Under `?ie_determinism=` `Math.random` is seeded, so an unpinned run still replays.
	return pinned || String(Math.floor(Math.random() * 2 ** 32));
};

/** The characters' side of the loop, made only for a config with characters. */
let characterIo: CharacterRuntime | undefined;

interface CharacterRuntime extends ArcadeCharacterIo {
	setScenes(scenes: readonly Scene[], layoutType: LayoutType): void;
	/** Follow the held keys and the pointer on the canvas; returns the detach of both. */
	attachInput(canvas: HTMLElement, toGlobal: (x: number, y: number) => Point): () => void;
}

type Point = { x: number; y: number };

const holdsSpawnLayer = (nodes: readonly LayoutNode[]): boolean =>
	nodes.some(
		(node) =>
			node.kind === 'spawnLayer' || (node.kind === 'container' && holdsSpawnLayer(node.children)),
	);

/** The held keys, the pressed pointer, the paths: what the characters stage reads each step. */
function createCharacterRuntime(characters: readonly ArcadeCharacter[]): CharacterRuntime {
	const live = spawnStore();
	const heldKeys = new Set<string>();
	const keyActions = (key: string) => getFlowV2()?.keyActions(key) ?? [];
	// A letter is kept in one case, so a Shift between its press and its release does not strand it.
	const keyOf = (key: string) => (key.length === 1 ? key.toLowerCase() : key);
	const looks = new Set(characters.map((c) => c.component));
	/** The layer a pointer is read in: the first declared layer that can hold a character. */
	const characterLayer = () =>
		live.layers().find((id) => live.layer(id)?.spawnable.some((c) => looks.has(c)));
	let pressed: Point | undefined;
	let paths: Record<string, ScenePath> = {};
	let pathsKey = '';
	let tiles: SceneTileGrid[] = [];
	let tilesKey = '';
	return {
		input: {
			held: (action) => [...heldKeys].some((key) => keyActions(key).includes(action)),
			pointer: () => {
				const layer = pressed && characterLayer();
				return pressed && layer ? spawnLayerPoint(layer, pressed.x, pressed.y) : undefined;
			},
		},
		paths: () => paths,
		tiles: () => tiles,
		variable: (id) => getFlowV2()?.state?.read(id),
		setInstanceInput: (id, input, value) => void stashFlowInstanceInput(id, input, value),
		spawn: (layer, componentId, x, y) => {
			const result = live.spawn(layer, componentId, { x, y });
			return result.ok ? result.instance.id : undefined;
		},
		setScenes(scenes, layoutType) {
			const next: Record<string, ScenePath> = {};
			for (const scene of scenes)
				for (const [id, path] of Object.entries(scenePaths(scene, layoutType)))
					if (!(id in next)) next[id] = path;
			const key = JSON.stringify(next);
			if (key !== pathsKey) {
				pathsKey = key;
				paths = next;
			}
			const grids = scenes
				.filter((scene) => holdsSpawnLayer(scene.nodes ?? []))
				.flatMap((scene) => sceneTilemaps(scene, layoutType));
			const gridsKey = JSON.stringify(grids.map((g) => ({ ...g, cells: [...g.cells] })));
			if (gridsKey === tilesKey) return;
			tilesKey = gridsKey;
			tiles = grids;
		},
		attachInput(canvas, toGlobal) {
			const down = (e: KeyboardEvent) => {
				if (!typingInto(e.target)) heldKeys.add(keyOf(e.key));
			};
			const up = (e: KeyboardEvent) => {
				heldKeys.delete(keyOf(e.key));
			};
			const blur = () => heldKeys.clear();
			const at = (e: PointerEvent) => {
				pressed = toGlobal(e.clientX, e.clientY);
			};
			const move = (e: PointerEvent) => {
				if (pressed) at(e);
			};
			const release = () => {
				pressed = undefined;
			};
			const onWindow = <K extends keyof WindowEventMap>(
				type: K,
				listener: (e: WindowEventMap[K]) => void,
			) => {
				window.addEventListener(type, listener);
				return () => window.removeEventListener(type, listener);
			};
			canvas.addEventListener('pointerdown', at);
			const off = [
				onWindow('keydown', down),
				onWindow('keyup', up),
				onWindow('blur', blur),
				onWindow('pointermove', move),
				onWindow('pointerup', release),
				onWindow('pointercancel', release),
				() => canvas.removeEventListener('pointerdown', at),
			];
			return () => {
				for (const detach of off) detach();
				heldKeys.clear();
				pressed = undefined;
			};
		},
	};
}

/**
 * Start the loop, once per page. The loop outlives the play field's mount: a screen change that
 * remounts it goes on with the bodies it has.
 *
 * `designSize` reads the current layout's design size: the field when the config names none and
 * no screen has a world, and the camera's view, so a rotated device moves both with it.
 */
export const startArcade = (designSize: () => { width: number; height: number }): ArcadeLoop => {
	if (loop) return loop;
	const rules = resolveArcade(normalizeGameConfigDoc(bakedGameConfig()));
	const live = spawnStore();
	if (rules.characters.length) characterIo = createCharacterRuntime(rules.characters);
	hops = rules.characters.some(hopsOnThePlane);
	hides = rules.characters.length > 0 && rules.abilities.length > 0;
	if (hides) setHiding();
	shadowOf = (componentId) => {
		const body = rules.bodies[componentId];
		if (body?.shape === 'box') return { shadow: body.w, foot: body.h / 2 };
		if (body?.shape === 'circle') return { shadow: body.r * 2, foot: body.r };
		return { shadow: 0, foot: 0 };
	};
	// Lifting is on before the first spawn, so no instance remounts when the first lift arrives.
	if (hops) setLifts(new Map());
	view = () => {
		const { width, height } = designSize();
		return { w: width, h: height };
	};
	loop = createArcadeLoop({
		rules,
		field: () => rules.field ?? world ?? view(),
		layers: () => live.layers(),
		live,
		seed: seedOf(),
		signal: (name, payload) => {
			void getFlowV2()?.dispatch(name, payload);
		},
		...characterIo,
	});
	registerBoardEffects(loop.effects);
	registerBoardValues((key) => loop?.value(key));
	return loop;
};

/** Give the characters the layout's paths (every screen's top-level `path` nodes) and its tiles
 *  (the top-level `tilemap` nodes of the screens with a spawn layer). No characters, nothing read. */
export const useArcadePaths = (scenes: readonly Scene[], layoutType: LayoutType) => {
	characterIo?.setScenes(scenes, layoutType);
};

/** Follow the held keys and a pressed pointer on the canvas for the characters, while the play
 *  field is mounted; returns the detach. No characters, no listener. */
export const useArcadeInput = (
	canvas: HTMLElement | undefined,
	toGlobal: (x: number, y: number) => Point,
): (() => void) | undefined =>
	canvas && characterIo ? characterIo.attachInput(canvas, toGlobal) : undefined;

/**
 * Give the loop the camera of the layout's world screen, if it has one. The layout may load after
 * the play field first mounts, so `<ArcadeStage />` calls this whenever its screens change; the
 * first world screen seen is kept for the page.
 */
export const useWorldCamera = (scenes: readonly Scene[]) => {
	if (!loop || loop.camera()) return;
	const scene = worldCameraScene(scenes);
	if (!scene) return;
	world = sceneWorld(scene);
	// An isometric screen (P11.4) shows a turned region: the loop judges the view by its world box.
	const visible = sceneProjection(scene) ? isoViewRect : undefined;
	loop.attachCamera({ spec: sceneCamera(scene), world, view, ...(visible ? { visible } : {}) });
};

/** One frame of the play field. */
export const tickArcade = (dtMs: number) => {
	if (!loop) return;
	loop.frame(dtMs);
	if (hops) {
		const live = spawnStore();
		const lifts = new Map<string, { z: number; shadow: number; foot: number }>();
		for (const [id, z] of loop.lifts())
			lifts.set(id, { z, ...shadowOf(live.get(id)?.componentId ?? '') });
		setLifts(lifts);
	}
	const camera = loop.camera();
	if (!camera) {
		if (hides) setCulled(loop.culled());
		return;
	}
	setWorldCameraView(camera);
	setCulled(loop.culled());
};
