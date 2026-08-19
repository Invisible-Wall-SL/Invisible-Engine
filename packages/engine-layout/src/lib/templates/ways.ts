import type { GameTemplate } from '../types';

import { standardTemplate } from './standard';

/**
 * The `ways` game-type template — identical to `lines` BY CONSTRUCTION, not by coincidence. A ways
 * game runs the same shared runtime, mounts the same coded components and has the same board
 * (`apps/ways/src/game/constants.ts`: `SYMBOL_SIZE = 120`, `BOARD_DIMENSIONS = 5×3`); its whole
 * difference from lines is how it PAYS, which the Game Config's `winModel` declares and a
 * screen/slot schema does not describe. Give it its own literal only if its SCREENS diverge.
 */
export const waysTemplate: GameTemplate = standardTemplate('ways');
