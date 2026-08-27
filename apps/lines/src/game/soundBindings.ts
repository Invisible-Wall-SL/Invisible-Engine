import { landSlotForSymbol, type SoundCue, type SoundSlotId } from 'game-config';

import { bakedSymbolSounds } from '../editor-scenes';
import { cascadeSoundRung, trackCascadeStep as trackCascadeEvent } from './cascadeSoundStep';
import { eventEmitter } from './eventEmitter';
import { activeSounds, getActiveGameConfig } from './gameConfig';
import type { SoundEffectName } from './sound';
import type { BookEvent } from './typesBookEvent';

/**
 * WHAT THE GAME PLAYS, AND WHEN — the single resolution point between the two layers that can bind
 * a sound, and the one place the engine's presentation beats reach for a cue.
 *
 * Two layers, most specific first:
 *
 *  1. **Per symbol × state** — Invisible Symbols (`symbolSounds` in the symbols doc). "THIS symbol
 *     makes THIS noise entering THIS state." Sparse; almost always empty.
 *  2. **The game-wide SLOT** — Invisible Game Config (`sounds` in the config doc), which itself
 *     falls through to the shipped catalogue in `game-config/sounds`. This is the layer that
 *     carries the defaults, so a project that has authored nothing still plays the full sound set.
 *
 * There is no third layer and no literal below this file: a beat with no binding plays nothing, and
 * a beat whose binding is silenced (`enabled: false`) plays nothing. Both are expressed as an absent
 * cue rather than an empty name, because howler declines an unknown sprite key SILENTLY — so a
 * blank name would make "the author silenced this" and "the author mistyped this" identical in
 * game, which is how `tumble_win_1…5` sat unplayed in the audiosprite for the whole life of the
 * fork without anyone noticing.
 */

/**
 * The compile-time sound union is a convenience for the coded call sites, not a contract the
 * AUTHORED names can satisfy — an author binds any region of their own audiosprite, and the whole
 * point of the two layers above is that the engine does not need to know the name in advance.
 *
 * So the cast lives here, once, at the boundary between the resolvers (which speak `string`) and
 * the emitter (which speaks `SoundEffectName`), rather than being sprinkled over the call sites.
 * Mirrors `resolveActivationSound` in `anticipationPresentation.ts`, which made the same trade for
 * the same reason. An unknown name is inaudible, never an error.
 */
const broadcastCue = (cue: SoundCue | undefined, forcePlay?: boolean): void => {
	if (!cue) return;
	eventEmitter.broadcast({
		type: 'soundOnce',
		name: cue.name as SoundEffectName,
		volume: cue.volume,
		...(forcePlay === undefined ? {} : { forcePlay }),
	});
};

/** Layer 1 — the per-symbol override for one state, or `undefined` when this symbol says nothing
 *  about this moment (the overwhelmingly common case). */
const symbolStateCue = (symbolName: string, state: string): SoundCue | undefined => {
	const name = bakedSymbolSounds()[symbolName]?.[state];
	return name ? { name, volume: undefined } : undefined;
};

/** Layer 2 — the game-wide slot, catalogue defaults already applied. */
const slotCue = (slot: SoundSlotId, index?: number): SoundCue | undefined =>
	activeSounds().pick(slot, index);

/**
 * Track the round's cascade position. Called from `dispatchBookEvent` — the ONE seam all three
 * dispatch paths cross (coded, v1 flow, v2 flow), the same reason `recordWinCycleWins` lives there:
 * a flow-owned `tumbleBoard` never reaches the coded handler map, and a flow-driven game has to
 * sound the same as a coded one.
 *
 * The rule itself lives in `cascadeSoundStep.ts`, free of imports so it can be exercised offline —
 * it is the one part of this file with a wrong answer nobody would hear until a player did.
 */
export const trackCascadeStep = (bookEvent: BookEvent): void => {
	trackCascadeEvent(bookEvent.type);
};

/**
 * THE CASCADE POP — the cue for the beat where a tumble removes the winning symbols.
 *
 * This is the sound the engine has never made. The audiosprite has shipped a five-rung
 * `tumble_win_*` ladder since the fork and no code path has ever played a rung of it, so the names
 * showed up in the flow editor's sound library (generated from the `SoundName` union, which lists
 * names rather than wiring) while the board popped in silence.
 *
 * Fired ONCE per cascade step rather than once per exploding cell: a five-symbol win is one pop.
 * The once-player would collapse the repeats anyway, but relying on that would make the volume of a
 * win depend on how many cells it happened to cover.
 */
export const playTumbleExplosionSound = (): void => {
	const rung = cascadeSoundRung();
	if (rung === null) return;
	broadcastCue(slotCue('tumbleExplosion', rung));
};

/**
 * A single exploding symbol's OWN pop, when Invisible Symbols binds one for it. Layer 1 only —
 * the game-wide ladder above is the beat, this is a symbol adding its own voice to it, so a bound
 * symbol is heard IN ADDITION to the ladder rather than instead of it.
 */
export const playSymbolTumbleExplosionSound = (symbolName: string): void => {
	broadcastCue(symbolStateCue(symbolName, 'tumbleExplosion'));
};

/**
 * A single EMERGING symbol's own voice — the rise/fade/grow under `swapStyle: 'emerge'`, when
 * Invisible Symbols binds one for it.
 *
 * Layer 1 only, and ADDITIVE like the cascade pop above rather than overriding like `land` below.
 * The difference is whether there is a class cue to override: a landing symbol's own binding
 * replaces the generic land cue because they are two answers to the SAME slot, whereas an emerge
 * has no game-wide slot of its own — the beat it rides on is the ordinary landing cue that
 * `onSymbolLand` plays. So a bound symbol is heard in addition to that, and an unbound game (every
 * game today) sounds exactly like a cascade refill.
 */
export const playSymbolIntroSound = (symbolName: string): void => {
	broadcastCue(symbolStateCue(symbolName, 'intro'));
};

/**
 * A SYMBOL LANDING in its cell — on the reels at the end of a spin, and on the tumble overlay when a
 * cascade refill falls in (`tumbleBoardSlideDown` calls the same hook, which is why the cascade needs
 * no landing path of its own).
 *
 * Which cue depends on what the symbol IS, and that routing reads the config dictionary rather than
 * the symbol's id — see `landSlotForSymbol`. `scatterIndex` is the running scatter count this spin,
 * the rung of the scatter ladder; it is ignored for every other kind of symbol.
 *
 * Fires per symbol, which sounds like more than it is: the once-player declines a cue that is still
 * playing, so a reel of five royals is one thud, and the picture/royal pair overlapping across reels
 * is the layered board-settling sound a slot is supposed to make.
 */
export const playSymbolLandSound = (symbolName: string, scatterIndex: number): void => {
	// The symbol's own binding wins outright here — unlike the explosion above, a landing symbol
	// makes ONE noise, and an author who gave a symbol its own landing cue means that one instead of
	// the generic class cue, not on top of it.
	const own = symbolStateCue(symbolName, 'land');
	if (own) {
		broadcastCue(own);
		return;
	}
	const slot = landSlotForSymbol(symbolName, getActiveGameConfig().symbols);
	broadcastCue(slotCue(slot, scatterIndex - 1));
};

/**
 * The WILD's explosion, fired by a `wildExplode` EVENT on the symbol's spine timeline rather than by
 * a state change — so it lands on the animation's own beat. Routed through the slot so the cue is
 * authorable; it used to be the literal `sfx_wild_explode` in three separate components.
 */
export const playWildExplodeSound = (): void => {
	broadcastCue(slotCue('wildExplode'));
};
