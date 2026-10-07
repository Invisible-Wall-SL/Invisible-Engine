import { resolveGrid } from './grid';
import { symbolsInPlay, symbolsInPlayFromStrips } from './inPlay';
import { SCATTER_TRIGGER_COUNT, inPlayScatterSymbol } from './serverPaytable';
import type { FreeSpinsConfig, GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/**
 * FREE SPINS — the switch and the trigger (`GameConfigDoc.freeSpins`).
 *
 * The RGS owns the outcome: a partner server awards free spins by its own math whatever this says.
 * What the block decides is what OUR side does with them — whether the Invisible Test Server's mock
 * ever enters the feature and on what, and what the info page promises the player. Before it
 * existed the mock hardcoded "3 or more scatters", so a project could not make a game without free
 * spins at all, and removing the free-spin chain in the Flow did nothing: the round still entered
 * the feature.
 */

/** Fewest trigger symbols that award free spins when the project states no count. */
export const DEFAULT_FREE_SPINS_TRIGGER_COUNT = SCATTER_TRIGGER_COUNT;

/** The free-spins rule with every default filled in. */
export type ResolvedFreeSpins = {
	enabled: boolean;
	/** The authored trigger symbol, else the in-play scatter, else `undefined` (nothing can trigger). */
	triggerSymbol: string | undefined;
	triggerCount: number;
};

type FreeSpinsDoc = Pick<GameConfigDoc, 'freeSpins' | 'symbols' | 'paddingReels'>;

const validCount = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1;
const validSymbol = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const scatterOf = (doc: FreeSpinsDoc): string | undefined =>
	inPlayScatterSymbol(doc.symbols, symbolsInPlayFromStrips(doc.paddingReels));

/**
 * The free-spins rule this game plays. Read it through here rather than touching `doc.freeSpins`,
 * for the same reason `resolveCascade` exists: "absent means the scatter, three of them" would
 * otherwise be re-implemented at each site and eventually mis-implemented at one of them.
 */
export function resolveFreeSpins(doc: FreeSpinsDoc | undefined): ResolvedFreeSpins {
	const symbol = doc?.freeSpins?.triggerSymbol;
	const count = doc?.freeSpins?.triggerCount;
	return {
		enabled: doc?.freeSpins?.enabled !== false,
		triggerSymbol: validSymbol(symbol) ? symbol : doc ? scatterOf(doc) : undefined,
		triggerCount: validCount(count) ? count : DEFAULT_FREE_SPINS_TRIGGER_COUNT,
	};
}

/**
 * Is the trigger the one every game had before it was authorable — 3 or more of the in-play
 * scatter? Every surface that keeps its old output for an un-authored game (the mock contract, the
 * rules page) asks this one question, so they cannot disagree about what counts as a departure.
 */
export function freeSpinsTriggerIsDefault(doc: FreeSpinsDoc | undefined): boolean {
	const { triggerSymbol, triggerCount } = resolveFreeSpins(doc);
	return (
		triggerCount === DEFAULT_FREE_SPINS_TRIGGER_COUNT &&
		triggerSymbol === (doc ? scatterOf(doc) : undefined)
	);
}

/**
 * Normalize an authored `freeSpins` block, or `undefined` when nothing in it departs from the
 * default. Same invariant as `normalizeCascade`: a config that simply has free spins on three
 * scatters stores no block and normalizes byte-identically to one written before the block existed.
 *
 * The trigger fields survive `enabled: false` on purpose — switching free spins off and back on
 * must not cost the author the trigger they set up.
 */
export function normalizeFreeSpins(raw: unknown): FreeSpinsConfig | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const { enabled, triggerSymbol, triggerCount } = raw as Record<string, unknown>;
	const block: FreeSpinsConfig = {};
	if (enabled === false) block.enabled = false;
	if (validSymbol(triggerSymbol)) block.triggerSymbol = triggerSymbol;
	if (validCount(triggerCount) && triggerCount !== DEFAULT_FREE_SPINS_TRIGGER_COUNT) {
		block.triggerCount = triggerCount;
	}
	return Object.keys(block).length ? block : undefined;
}

const quotedList = (names: string[]): string => {
	const quoted = names.map((name) => `"${name}"`);
	return quoted.length > 1
		? `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
		: quoted[0];
};

/**
 * The free-spins block against the rest of the doc.
 *
 * A `holdAndWin` or `potsOverlay` block beside it is ANOTHER bonus: a buy may buy that one, and a
 * game may reach it without any trigger symbol (a Hold and Win kind has no free spins at all, and a
 * pots overlay starts its bonus from a full pot). So the two checks that ask "is there anything for
 * free spins to be?" stand down for such a doc. The trigger itself is checked only while free spins
 * are on.
 */
export const validateFreeSpins = (doc: GameConfigDoc): GameConfigIssue[] => {
	const issues: GameConfigIssue[] = [];
	const freeSpins = resolveFreeSpins(doc);
	const otherBonus = Boolean(doc.holdAndWin || doc.potsOverlay);

	if (!freeSpins.enabled) {
		if (otherBonus) return issues;
		// A mode SOLD as a buy (its card) or bought in the math is a purchase of the feature. On the
		// lines mock a buy always buys free spins, so with them off the card sells nothing — and the
		// mock refuses the bet rather than charging the buy price for a base spin.
		const buys = Object.entries(doc.betModes)
			.filter(([mode, math]) => math.buyBonus || doc.betModePresentation?.[mode]?.kind === 'buy')
			.map(([mode]) => mode);
		if (buys.length) {
			const many = buys.length > 1;
			issues.push({
				severity: 'error',
				path: 'freeSpins',
				message: `Free spins are off, so the ${quotedList(buys)} buy ${many ? 'modes have' : 'mode has'} nothing to buy. Remove ${many ? 'them' : 'it'} in Bet modes.`,
			});
		}
		return issues;
	}

	const authored = doc.freeSpins?.triggerSymbol;
	if (validSymbol(authored)) {
		if (!doc.symbols[authored]) {
			issues.push({
				severity: 'error',
				path: 'freeSpins.triggerSymbol',
				message: `The free-spins trigger symbol ${authored} is not in the symbol dictionary, so free spins can never trigger.`,
			});
		} else if (!symbolsInPlay(doc).includes(authored)) {
			issues.push({
				severity: 'error',
				path: 'freeSpins.triggerSymbol',
				message: `${authored} triggers free spins but appears on no reel strip — it is never dealt, so free spins can never trigger.`,
			});
		}
	} else if (!freeSpins.triggerSymbol && !otherBonus) {
		issues.push({
			severity: 'warning',
			path: 'freeSpins',
			message:
				'Free spins are on but nothing can trigger them: no scatter symbol is on the reel strips. Choose a trigger symbol, put a scatter on the strips, or turn free spins off.',
		});
	}

	const cells = resolveGrid(doc).rows.reduce((sum, rows) => sum + rows, 0);
	if (freeSpins.triggerCount > cells) {
		issues.push({
			severity: 'error',
			path: 'freeSpins.triggerCount',
			message: `Free spins need ${freeSpins.triggerCount} trigger symbols but the board only has ${cells} cells, so they can never trigger.`,
		});
	}
	return issues;
};
