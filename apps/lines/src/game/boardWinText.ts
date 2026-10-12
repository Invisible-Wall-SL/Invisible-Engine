import type { ResolvedWinText } from 'engine-layout';

import { bakedWinTextFor } from '../editor-scenes';
import { activeSpinsGame } from './gameConfig';

/**
 * The win text the board on screen speaks: while a spins mode is on top, its own win-line message and
 * win-tier captions over the base game's (`WinTextDoc.modes[<id>]`, bonus-games Phase 8), else the
 * base game's. A doc without a spins mode never reads the mode stack, so it reads exactly
 * `bakedWinText()`.
 */
export const boardWinText = (): ResolvedWinText => bakedWinTextFor(activeSpinsGame()?.mode);
