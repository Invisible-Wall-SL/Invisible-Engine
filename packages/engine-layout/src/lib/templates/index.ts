import type { GameTemplate } from '../types';

import { bookofTemplate } from './bookof';
import { linesTemplate } from './lines';
import { waysTemplate } from './ways';

/**
 * Built-in game-type templates — the code **fallback** used when no
 * `editor/templates/<gameType>.json` exists in R2 (§7.5). The launcher reads
 * R2 first, then falls back here; games and the editor resolve their template
 * the same way.
 */
const TEMPLATES: Record<string, GameTemplate> = {
	lines: linesTemplate,
	bookOf: bookofTemplate,
	ways: waysTemplate,
};

/** The built-in template for a game type, or `undefined` if none is registered. */
export function getTemplate(gameType: string): GameTemplate | undefined {
	return TEMPLATES[gameType];
}

/** Game types that ship a built-in template. */
export function listTemplateGameTypes(): string[] {
	return Object.keys(TEMPLATES);
}

export { linesTemplate, bookofTemplate, waysTemplate };
export { standardTemplate } from './standard';
