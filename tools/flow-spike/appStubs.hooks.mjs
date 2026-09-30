/**
 * Node resolve hooks that let a spike import a real `apps/lines` game module whose OTHER imports
 * need the SvelteKit/Svelte compiler tsx does not have: `state-shared` (runes + `$app/state`) and
 * the game's `gameConfig` (engine-game → pixi-svelte `.svelte` components). Each is swapped for a
 * plain-data stand-in; the module under test runs unmodified. Registered by `appStubs.register.mjs`.
 */

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const STATE_SHARED = moduleUrl('export const stateUi = { unskippablePresentationActive: false };');

// Only a `setWin` reads the win tiers, and no stubbed spike book carries one.
const LINES_GAME_CONFIG = moduleUrl('export const activeWinLevelIsBig = () => false;');

export async function resolve(specifier, context, nextResolve) {
	if (specifier === 'state-shared') return { url: STATE_SHARED, shortCircuit: true };
	if (specifier === './gameConfig' && context.parentURL?.includes('/apps/lines/src/game/'))
		return { url: LINES_GAME_CONFIG, shortCircuit: true };
	return nextResolve(specifier, context);
}
