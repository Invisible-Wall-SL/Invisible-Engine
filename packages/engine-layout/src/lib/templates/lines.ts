import type { GameTemplate } from '../types';

import { standardTemplate } from './standard';

/**
 * The `lines` game-type template — the standard reel-game screen set (see
 * {@link standardTemplate} for the slot model and why the scene list is shared).
 */
export const linesTemplate: GameTemplate = standardTemplate('lines');
