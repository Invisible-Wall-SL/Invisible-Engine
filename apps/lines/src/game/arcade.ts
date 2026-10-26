import { createArcadeLoop, type ArcadeCharacterIo, type ArcadeLoop } from 'engine-game';
import {
	scenePaths,
	stashFlowInstanceInput,
	type LayoutType,
	type Scene,
	type ScenePath,
} from 'engine-layout';
import { spawnLayerPoint, spawnStore } from 'engine-layout/svelte';
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
 * CHARACTERS (§4.3, P10.11): when the config has some, the loop is also given the player's input —
 * the flow key map's actions while their keys are held, and a pressed pointer in the play field's
 * space — the layout's paths, the flow's variables, the looks' inputs (`animInputs`, set on the
 * spawned instances) and the spawn store for shots. A config without characters attaches none of it.
 *
 * A slot game never starts it: only `<ArcadeStage />` calls {@link startArcade}, and `Game.svelte`
 * mounts that only for a mechanic that is a play field.
 */

/** The URL parameter that pins `$engine.random`'s seed (the playtester uses it). */
const ARCADE_SEED_PARAM = 'arseed';

let loop: ArcadeLoop | undefined;

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
	/** Follow the pointer on the canvas; returns the detach. */
	attachPointer(canvas: HTMLElement, toGlobal: (x: number, y: number) => Point): () => void;
}

type Point = { x: number; y: number };

/** The held keys, the pressed pointer, the paths: what the characters stage reads each step. */
function createCharacterRuntime(characters: readonly ArcadeCharacter[]): CharacterRuntime {
	const live = spawnStore();
	const heldKeys = new Set<string>();
	const keyActions = (key: string) => getFlowV2()?.keyActions(key) ?? [];
	// A letter is kept in one case, so a Shift between its press and its release does not strand it.
	const keyOf = (key: string) => (key.length === 1 ? key.toLowerCase() : key);
	if (typeof window !== 'undefined') {
		window.addEventListener('keydown', (e) => {
			if (!typingInto(e.target)) heldKeys.add(keyOf(e.key));
		});
		window.addEventListener('keyup', (e) => heldKeys.delete(keyOf(e.key)));
		window.addEventListener('blur', () => heldKeys.clear());
	}
	const looks = new Set(characters.map((c) => c.component));
	/** The layer a pointer is read in: the first declared layer that can hold a character. */
	const characterLayer = () =>
		live.layers().find((id) => live.layer(id)?.spawnable.some((c) => looks.has(c)));
	let pressed: Point | undefined;
	let paths: Record<string, ScenePath> = {};
	let pathsKey = '';
	return {
		input: {
			held: (action) => [...heldKeys].some((key) => keyActions(key).includes(action)),
			pointer: () => {
				const layer = pressed && characterLayer();
				return pressed && layer ? spawnLayerPoint(layer, pressed.x, pressed.y) : undefined;
			},
		},
		paths: () => paths,
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
			if (key === pathsKey) return;
			pathsKey = key;
			paths = next;
		},
		attachPointer(canvas, toGlobal) {
			const at = (e: PointerEvent) => {
				pressed = toGlobal(e.clientX, e.clientY);
			};
			const move = (e: PointerEvent) => {
				if (pressed) at(e);
			};
			const release = () => {
				pressed = undefined;
			};
			canvas.addEventListener('pointerdown', at);
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', release);
			window.addEventListener('pointercancel', release);
			return () => {
				canvas.removeEventListener('pointerdown', at);
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', release);
				window.removeEventListener('pointercancel', release);
				pressed = undefined;
			};
		},
	};
}

/**
 * Start the loop, once per page. The loop outlives the play field's mount: a screen change that
 * remounts it goes on with the bodies it has.
 *
 * `designSize` reads the current layout's design size: the field when the config names none, so a
 * rotated device moves the field's edges with it.
 */
export const startArcade = (designSize: () => { width: number; height: number }): ArcadeLoop => {
	if (loop) return loop;
	const rules = resolveArcade(normalizeGameConfigDoc(bakedGameConfig()));
	const live = spawnStore();
	if (rules.characters.length) characterIo = createCharacterRuntime(rules.characters);
	loop = createArcadeLoop({
		rules,
		field: () => {
			if (rules.field) return rules.field;
			const { width, height } = designSize();
			return { w: width, h: height };
		},
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

/** Give the characters the layout's paths (every screen's top-level `path` nodes). No characters,
 *  nothing read. */
export const useArcadePaths = (scenes: readonly Scene[], layoutType: LayoutType) => {
	characterIo?.setScenes(scenes, layoutType);
};

/** Follow a pressed pointer on the canvas for the characters; returns the detach. No characters,
 *  no listener. */
export const useArcadePointer = (
	canvas: HTMLElement | undefined,
	toGlobal: (x: number, y: number) => Point,
): (() => void) | undefined =>
	canvas && characterIo ? characterIo.attachPointer(canvas, toGlobal) : undefined;

/** One frame of the play field. */
export const tickArcade = (dtMs: number) => {
	loop?.frame(dtMs);
};
