import { createGameContext } from 'engine-game';

import { eventEmitter, type EmitterEvent } from './eventEmitter';
import { stateXstate, stateXstateDerived } from './stateXstate';
import { stateLayout, stateLayoutDerived } from './stateLayout';
import { stateApp } from './stateApp';

import { stateGame, stateGameDerived } from './stateGame.svelte';
import { i18nDerived } from '../i18n/i18nDerived';

/**
 * This game's COMPOSITION ROOT: it builds every instance, `engine-game` owns the wiring.
 * See `createGameContext` for why the context is injected rather than relocated.
 */
export const { setContext, getContext } = createGameContext<
	EmitterEvent,
	{
		stateGame: typeof stateGame;
		stateGameDerived: typeof stateGameDerived;
		i18nDerived: typeof i18nDerived;
	}
>({
	eventEmitter: { eventEmitter },
	xstate: { stateXstate, stateXstateDerived },
	layout: { stateLayout, stateLayoutDerived },
	app: { stateApp },
	parts: { stateGame, stateGameDerived, i18nDerived },
});
