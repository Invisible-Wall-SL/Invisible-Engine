import { resolveFamily, resolveOutcome, type ConfigFamily, type GameOutcome } from './family';
import type { GameConfigDoc } from './types';

/**
 * WHICH `/config` SECTIONS A FAMILY SHOWS (`docs/design/game-families.md` §6.2) — the one table the
 * page renders from and the validator follows, so a section the page hides is never the reason a
 * save is refused.
 *
 * A slot shows every section, which is the page as it was before families existed; the kind and
 * add-on gates inside each section (free spins, coins, Hold and Win, …) still apply on top.
 */
export const CONFIG_SECTIONS = [
	'rtp',
	'grid',
	'betModes',
	'coinBoard',
	'coinOverlay',
	'bonusModes',
	'symbols',
	'coinSymbols',
	'winModel',
	'freeSpins',
	'expandingSymbol',
	'reelBehaviour',
	'gameModes',
	'sounds',
	'paylines',
	'winLevels',
	'match3',
	'arcade',
] as const;

export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/** The sections of the slot page that also serve a real-money match-3 game. */
const MATCH3_RGS: readonly ConfigSection[] = [
	'rtp',
	'grid',
	'betModes',
	'winLevels',
	'symbols',
	'winModel',
	'sounds',
	'match3',
];

/** A free-play match-3 game has no stake, so no RTP, bet modes, win tiers or pays. */
const MATCH3_RULES: readonly ConfigSection[] = ['grid', 'symbols', 'sounds', 'match3'];

const ARCADE: readonly ConfigSection[] = ['arcade'];

const SLOT_SECTIONS: ReadonlySet<ConfigSection> = new Set(
	CONFIG_SECTIONS.filter((s) => s !== 'match3' && s !== 'arcade'),
);

/** The sections `/config` shows for a family and outcome. The Raw JSON editor shows for all. */
export function configSectionsFor(
	family: ConfigFamily,
	outcome: GameOutcome,
): ReadonlySet<ConfigSection> {
	if (family === 'match3') return new Set(outcome === 'rules' ? MATCH3_RULES : MATCH3_RGS);
	if (family === 'arcade') return new Set(ARCADE);
	return SLOT_SECTIONS;
}

/** {@link configSectionsFor} for a doc, through the resolvers. */
export const configSectionsOf = (
	doc: Pick<GameConfigDoc, 'family' | 'outcome'> | null | undefined,
): ReadonlySet<ConfigSection> => configSectionsFor(resolveFamily(doc), resolveOutcome(doc));

/** Does the Symbols section show pays? Only where a symbol is worth money: a slot, or a match-3
 *  game the RGS decides. */
export const configShowsPays = (doc: Pick<GameConfigDoc, 'family' | 'outcome'>): boolean =>
	resolveOutcome(doc) === 'rgs' && resolveFamily(doc) !== 'arcade';
