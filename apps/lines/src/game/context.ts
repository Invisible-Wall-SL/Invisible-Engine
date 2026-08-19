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
const gameContext = createGameContext<
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

export const { setContext, getContext } = gameContext;

export type LinesContext = ReturnType<typeof gameContext.getContext>;

/**
 * Hand this game's context shape to `engine-game`, so components that have moved INTO the package
 * still read `context.stateGame` (and this game's emitter events) with full typing. Declaration
 * merging is the only direction that works: the package must not import from an app.
 */
declare module 'engine-game' {
	// Declaring no members of its own is the POINT: this merges `LinesContext` into the package's
	// `GameContext` seam. The rule's advice (drop the interface, it equals its supertype) would
	// delete the augmentation and with it every package component's typing.
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	interface GameContext extends LinesContext {}
}
