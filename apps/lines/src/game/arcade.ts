import { createArcadeLoop, type ArcadeLoop } from 'engine-game';
import { sceneCamera, sceneWorld, worldCameraScene, type Scene } from 'engine-layout';
import { setCulled, setWorldCameraView, spawnStore } from 'engine-layout/svelte';
import { normalizeGameConfigDoc, resolveArcade } from 'game-config';

import { bakedGameConfig } from '../editor-scenes';
import { registerBoardEffects, registerBoardValues } from './flowBoardEffects';
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
 * A slot game never starts it: only `<ArcadeStage />` calls {@link startArcade}, and `Game.svelte`
 * mounts that only for a mechanic that is a play field.
 */

/** The URL parameter that pins `$engine.random`'s seed (the playtester uses it). */
const ARCADE_SEED_PARAM = 'arseed';

let loop: ArcadeLoop | undefined;
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
	});
	registerBoardEffects(loop.effects);
	registerBoardValues((key) => loop?.value(key));
	return loop;
};

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
	loop.attachCamera({ spec: sceneCamera(scene), world, view });
};

/** One frame of the play field. */
export const tickArcade = (dtMs: number) => {
	if (!loop) return;
	loop.frame(dtMs);
	const camera = loop.camera();
	if (!camera) return;
	setWorldCameraView(camera);
	setCulled(loop.culled());
};
