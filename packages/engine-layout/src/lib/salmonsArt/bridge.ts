import { cellsOf, liftOf } from './leap';
import { CELL } from './scale';

/**
 * SALMONS' BRIDGES AS THEY ARE DRAWN AND STOOD ON, in one place so the art and the room's rule
 * cannot drift (pinned by `scripts/check-salmons-levels.mjs` against `engine-mechanics`
 * `salmonsRules` `BRIDGE_SLOPE` and the map's `BRIDGE_HEIGHT`):
 *
 * - `height`: a deck's height, grid cells, when the level names none (the original's 6);
 * - `slope`: how many cells each slope runs onto its bank, from the end deck cell's middle to the
 *   ground. The room ramps a fisherman over 2 on BOTH ends (the original server's `slopeLen`); the
 *   original's art drew the near one 3 long (`gyStart − 3`), so he stood a cell short of its foot.
 *   Drawn as the rule, both 2.
 * - `onDeckZ`: the original's z of a player on a bridge, `sortSY + 10000` (a player elsewhere is
 *   `sy + 1000`): over every deck and every player near it.
 */
export const BRIDGE = Object.freeze({ height: 6, slope: 2, onDeckZ: 10000, playerZ: 1000 });

/** How far a deck `height` cells up is drawn over the ground under it, screen px. */
export const deckLift = (height: number = BRIDGE.height): number => liftOf(height);

/** Where each slope of a deck `n` cells long runs, in deck cells from its first: from the ground
 *  (`land`) to the deck (`end`). */
export const slopeEnds = (n: number): readonly { land: number; end: number }[] => [
	{ land: -BRIDGE.slope, end: 0 },
	{ land: n - 1 + BRIDGE.slope, end: n - 1 },
];

/**
 * How far over the ground under it a character the room has put `zPx` high (world px) is drawn,
 * screen px, by moving its place (`online.ts` `raisedPlace`), so its look, rig or clip, its line,
 * what it holds and its rising text all stand there: a fisherman on a bridge (the room's `z` is the
 * deck's height there, {@link deckLift} on the deck). None for a salmon: its look draws its own
 * leap and climb from `z` (`looks.ts`).
 */
export const aloftLift = (character: string, zPx: number): number =>
	character === 'salmon' || !(zPx > 0) ? 0 : liftOf(cellsOf(zPx));

/**
 * The depth bias (ground depth px, `projection.ts` `isoDepthOrder`) of a body drawn `lift` screen px
 * up by its place: the raise's own loss of depth (back `lift` on both axes) undone, and the
 * original's bridge order ({@link BRIDGE} `onDeckZ`, old px of screen y, `CELL / 16` ground depth
 * each) on top, so it is drawn over the deck it stands on. 0 on the ground.
 */
export const aloftDepth = (lift: number): number =>
	lift > 0 ? 2 * lift + (BRIDGE.onDeckZ - BRIDGE.playerZ) * (CELL / 16) : 0;
