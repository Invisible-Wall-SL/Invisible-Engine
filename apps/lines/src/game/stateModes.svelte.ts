import { createModeController, type ModeTransition } from 'engine-game';
import { gameModeById, gameTypeForMode, resolveGameModes } from 'game-config';

import { eventEmitter } from './eventEmitter';
import { getActiveGameConfig } from './gameConfig';
import { stateGame } from './stateGame.svelte';
import type { MusicName } from './sound';
import type { GameType } from './types';

/**
 * Present a mode transition beyond the engine state — wired by the flow runtime so an authored
 * Mode trigger / Exit / All modes finished graph plays here. Unset ⇒ only the coded defaults.
 */
let flowPresenter: ((transition: ModeTransition) => Promise<void>) | undefined;

export const setModeTransitionPresenter = (
	presenter: ((transition: ModeTransition) => Promise<void>) | undefined,
): void => {
	flowPresenter = presenter;
};

/**
 * The coded part of a transition: a mode that declares its own music starts it when it comes on
 * screen. The built-in modes declare none, so a free-spin round keeps its handler-driven music.
 */
const presentCoded = (transition: ModeTransition): void => {
	if (transition.kind !== 'enter' && transition.kind !== 'resume') return;
	const music = gameModeById(getActiveGameConfig(), transition.mode.id)?.music;
	// An authored cue name, the same footing as a music slot's (`soundBindings` `musicCue`): howler
	// declines an unknown sprite key silently.
	if (music) eventEmitter.broadcast({ type: 'soundMusic', name: music as MusicName });
};

/**
 * This game's MODE STACK (`docs/design/hold-and-win.md` §4.5) — which mode is on screen, which are
 * suspended under it and which are queued. Moved by the play seam (`createPlayBook`'s `modes`), read
 * by the mode-tagged screens (`Game.svelte`) and the flow (`$engine.activeMode`).
 */
export const stateModes = createModeController({
	gameTypeOf: (modeId) => {
		const mode = gameModeById(getActiveGameConfig(), modeId);
		return mode ? gameTypeForMode(mode) : modeId;
	},
	setGameType: (gameType) => {
		stateGame.gameType = gameType as GameType;
	},
	present: async (transition) => {
		await flowPresenter?.(transition);
		presentCoded(transition);
	},
});

/** The ids of every mode on the stack (reactive) — what a mode-tagged screen mounts against. */
// A fresh, read-only snapshot per read: the reactivity is the stack's, so a SvelteSet would add none.
export const activeModeIds = (): ReadonlySet<string> =>
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	new Set(stateModes.state.stack.map((entry) => entry.id));

/** Every HUD screen some mode names as its own (`GameModeDecl.hud`). */
export const modeHudIds = (): ReadonlySet<string> =>
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	new Set(
		resolveGameModes(getActiveGameConfig())
			.map((mode) => mode.hud)
			.filter((hud): hud is string => !!hud),
	);

/** The HUD screen the mode on screen replaces the HUD with, if it names one (reactive). */
export const activeModeHud = (): string | undefined =>
	gameModeById(getActiveGameConfig(), stateModes.active())?.hud;
