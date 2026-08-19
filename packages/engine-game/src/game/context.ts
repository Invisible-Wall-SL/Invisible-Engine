import { setContextEventEmitter, getContextEventEmitter } from 'utils-event-emitter';
import type { EmitterEventBase } from 'utils-event-emitter';
import { setContextXstate, getContextXstate } from 'utils-xstate';
import { setContextLayout, getContextLayout } from 'utils-layout';
import { setContextApp, getContextApp } from 'pixi-svelte';

/**
 * The context plumbing every game shares, with the game-specific half INJECTED.
 *
 * Phase A2 of `docs/design/game-type-templates.md`. This is the dependency inversion the extraction
 * turned out to need: the context could not simply be relocated, because four separate things in it
 * are bound to the app —
 *   - `eventEmitter` is typed by an event union whose game half is assembled from the COMPONENTS
 *     (`typesEmitterEvent.ts`), including mechanic-specific ones (`winLine`, `specialBook`);
 *   - `stateApp` is built from that game's `assets.ts` + baked editor art;
 *   - `stateLayout` carries that game's background ratios and main sizes;
 *   - `stateGame` / `i18nDerived` are the app's own.
 *
 * So the app stays the COMPOSITION ROOT — it builds every instance — and this factory owns the
 * wiring: which Svelte context keys get set, and the exact shape + precedence of what `getContext()`
 * returns. `apps/lines/src/game/context.ts` is now a thin call to this, which is why all 39
 * component import sites keep working untouched.
 *
 * Fully generic in the app's own types (`TEmitterEvent`, `TParts`), so nothing here widens or
 * weakens the typing the components already rely on — the returned context is inferred, not erased.
 */
export function createGameContext<
	TEmitterEvent extends EmitterEventBase,
	TParts extends object,
>(deps: {
	/** The event-emitter context value — the `{ eventEmitter }` wrapper, matching the setter. */
	eventEmitter: Parameters<typeof setContextEventEmitter<TEmitterEvent>>[0];
	xstate: Parameters<typeof setContextXstate>[0];
	layout: Parameters<typeof setContextLayout>[0];
	app: Parameters<typeof setContextApp>[0];
	/** The game-specific half (`stateGame`, `stateGameDerived`, `i18nDerived`, …). Spread LAST, so
	 *  it keeps the precedence the hand-written context had on any key collision. */
	parts: TParts;
}) {
	const setContext = () => {
		setContextEventEmitter<TEmitterEvent>(deps.eventEmitter);
		setContextXstate(deps.xstate);
		setContextLayout(deps.layout);
		setContextApp(deps.app);
	};

	const getContext = () => ({
		...getContextEventEmitter<TEmitterEvent>(),
		...getContextLayout(),
		...getContextXstate(),
		...getContextApp(),
		...deps.parts,
	});

	currentGetContext = getContext;

	return { setContext, getContext };
}

/**
 * The shape a game's context has, as seen from INSIDE this package.
 *
 * Empty here on purpose, and filled by the app through declaration merging:
 *
 * ```ts
 * declare module 'engine-game' {
 *   interface GameContext extends LinesContext {}
 * }
 * ```
 *
 * That is what lets a component living in this package read `context.stateGame` or the game's own
 * emitter events with full typing, without this package importing anything from an app — which it
 * cannot do, and which is the constraint the whole extraction turns on.
 */
// Empty ON PURPOSE — this is a declaration-merging seam, not a type that forgot its members. The
// app fills it via `declare module 'engine-game'`, which is the only direction available since a
// package must not import from an app. `object`/`unknown` (what the rule suggests) cannot be
// merged into, so they would defeat the mechanism entirely.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GameContext {}

let currentGetContext: (() => unknown) | undefined;

/**
 * The context accessor for components INSIDE this package — the counterpart to the app's own
 * `getContext`, delegating to the very same closure so the two can never diverge.
 *
 * It stores the FUNCTION, not the value: `getContext` calls Svelte's `getContext()` under the hood,
 * which is only legal during component initialisation, so resolving it eagerly would break.
 *
 * Registration happens when the app's composition root module is evaluated, which the app's own
 * boot import forces long before any component mounts. The throw is therefore a real
 * misconfiguration (a package component mounted with no composition root), not a race.
 */
export function getGameContext(): GameContext {
	if (!currentGetContext) {
		throw new Error(
			'engine-game: createGameContext() has not run — the app must import its context module before mounting components.',
		);
	}
	return currentGetContext() as GameContext;
}
