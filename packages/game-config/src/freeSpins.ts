import { normalizeExpandingSymbol } from './expandingSymbol';
import { resolveGrid } from './grid';
import { symbolsInPlay, symbolsInPlayFromStrips } from './inPlay';
import { SCATTER_TRIGGER_COUNT, inPlayScatterSymbol } from './serverPaytable';
import type { FreeSpinsAward, FreeSpinsConfig, GameConfigDoc } from './types';
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

/** Spins awarded on entering free spins when the project authors no table. */
export const DEFAULT_FREE_SPINS_AWARD = 10;

/** Spins ADDED by a retrigger when the project authors no table. */
export const DEFAULT_RETRIGGER_AWARD = 5;

/**
 * The most free spins one round may reach — its entry award plus every retrigger. The Invisible Test
 * Server's mocks stop a retrigger that would pass it (`MAX_ROUND_FREE_SPINS` in
 * `scripts/mock-rgs-server.mjs`, held equal by `check:freespins`), so a feature always ends; here it
 * bounds what an award row may say. A partner server's own math decides its rounds.
 */
export const MAX_FREE_SPINS_PER_ROUND = 200;

/**
 * Fewest trigger symbols a game may ask for. Free spins RETRIGGER on the same rule they trigger on,
 * and a free spin uses one spin up: a retrigger that adds, on average, a spin or more per spin played
 * never lets the round end. With books landing about once in twenty cells, two of them on a 5×3
 * board land on about one free spin in six, so +10 per retrigger adds ~1.7 spins per spin; three land
 * on about one in thirty. Any symbol lands at least as often as a scatter, so the floor holds for a
 * symbol trigger too. The mocks' round cap ends such a round anyway; this stops it being authored.
 */
export const MIN_FREE_SPINS_TRIGGER_COUNT = 3;

/** What an un-authored award table awards: on entering, and added by a retrigger. */
export type FreeSpinsDefaults = { award: number; retrigger: number };

/** Every lines-family game's defaults — what the lines mock deals when told nothing. */
export const FREE_SPINS_DEFAULTS: FreeSpinsDefaults = {
	award: DEFAULT_FREE_SPINS_AWARD,
	retrigger: DEFAULT_RETRIGGER_AWARD,
};

/** The free-spins rule with every default filled in. */
export type ResolvedFreeSpins = {
	enabled: boolean;
	/** The authored trigger symbol, else the in-play scatter, else `undefined` (nothing can trigger). */
	triggerSymbol: string | undefined;
	triggerCount: number;
	/** Spins awarded on entering, by count — the authored rows sorted by count, else one row at
	 *  `triggerCount` awarding {@link DEFAULT_FREE_SPINS_AWARD}. */
	awards: FreeSpinsAward[];
	/** Spins added by a retrigger, the same way; default {@link DEFAULT_RETRIGGER_AWARD}. */
	retriggerAwards: FreeSpinsAward[];
	randomAwards: boolean;
};

type FreeSpinsDoc = Pick<GameConfigDoc, 'freeSpins' | 'symbols' | 'paddingReels'>;

const validCount = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1;
const validSymbol = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const scatterOf = (doc: FreeSpinsDoc): string | undefined =>
	inPlayScatterSymbol(doc.symbols, symbolsInPlayFromStrips(doc.paddingReels));

/**
 * One award row, or `undefined` when it cannot award anything: a whole `count` and `spins` of at
 * least 1. `maxSpins` survives only as a real range — a whole number ABOVE `spins`. Equal is no
 * range, and below is a mistake the validator reports from the authored row. A count above
 * {@link MAX_FREE_SPINS_PER_ROUND} is KEPT, not dropped, so the validator refuses it at save (the
 * server normalizes before it validates) instead of the row silently vanishing.
 */
const awardRow = (raw: unknown): FreeSpinsAward | undefined => {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const { count, spins, maxSpins } = raw as Record<string, unknown>;
	if (!validCount(count) || !validCount(spins)) return undefined;
	return validCount(maxSpins) && maxSpins > spins ? { count, spins, maxSpins } : { count, spins };
};

/**
 * A table's usable rows, sorted by count. The sort is STABLE and a duplicate count is KEPT: two
 * rows naming one count are a mistake the validator shows the author, not something to settle by
 * quietly dropping one of them.
 */
const awardRows = (raw: unknown): FreeSpinsAward[] =>
	(Array.isArray(raw) ? raw : [])
		.map(awardRow)
		.filter((row): row is FreeSpinsAward => row !== undefined)
		.sort((a, b) => a.count - b.count);

const resolveAwardTable = (raw: unknown, triggerCount: number, spins: number): FreeSpinsAward[] => {
	const rows = awardRows(raw);
	return rows.length ? rows : [{ count: triggerCount, spins }];
};

/**
 * Normalize one award table, or `undefined` when it says nothing the default does not: no usable
 * row, or every row awarding exactly `defaultSpins` with no range. Rows are sorted by count;
 * duplicates are kept for the validator (see `awardRows`).
 *
 * The save normalizer uses this for the ENTRY table only. A retrigger table's default depends on the
 * game's kind (+5, or +10 for a Book-of game) and a config does not carry its kind, so
 * `normalizeFreeSpins` keeps a retrigger table even when it equals a default; `/config`, which knows
 * the kind, calls this with the kind's default to drop a table edited back to it.
 */
export function normalizeAwardTable(
	raw: unknown,
	defaultSpins: number,
): FreeSpinsAward[] | undefined {
	const rows = awardRows(raw);
	const departs = rows.some((row) => row.spins !== defaultSpins || row.maxSpins !== undefined);
	return departs ? rows : undefined;
}

/** The row that awards for `landed` trigger symbols: the largest count at or below it — the first
 *  of them, should two rows share a count. `undefined` when every row starts above it. */
const awardRowFor = (
	table: readonly FreeSpinsAward[],
	landed: number,
): FreeSpinsAward | undefined => {
	let found: FreeSpinsAward | undefined;
	for (const row of table) {
		if (row.count <= landed && (!found || row.count > found.count)) found = row;
	}
	return found;
};

/**
 * How many spins `landed` trigger symbols award from `table`, as `{ min, max }` — equal ends unless
 * `random` is on and the row has a range. `undefined` when no row applies.
 *
 * THE lookup. The `/config` hint and the fixtures read awards through here (the validator through
 * the row lookup beneath it); the mock (plain Node, so it cannot import this) mirrors it in its own
 * `awardRowFor`, and `check:freespins` plays the mock and holds every award it deals to this one.
 */
export function freeSpinsAwardFor(
	table: readonly FreeSpinsAward[],
	landed: number,
	random: boolean,
): { min: number; max: number } | undefined {
	const row = awardRowFor(table, landed);
	if (!row) return undefined;
	return { min: row.spins, max: random ? (row.maxSpins ?? row.spins) : row.spins };
}

/** One part of the award rule as a person reads it: which counts (`3`, `3–4`, `5+`) award how many
 *  spins (`10`, `1–3`). */
export type FreeSpinsAwardRange = { counts: string; spins: string };

/**
 * A RESOLVED award table as the rule a player meets, from `from` trigger symbols up (`from` is the
 * trigger count — fewer never enter the feature). Only rows that are actually reached appear, each
 * with the counts it covers; a row that starts below `from` but still covers it reads from `from`.
 */
export function describeFreeSpinsAwards(
	table: readonly FreeSpinsAward[],
	from: number,
	random: boolean,
): FreeSpinsAwardRange[] {
	return table.flatMap((row, i) => {
		const start = Math.max(row.count, from);
		const award = freeSpinsAwardFor(table, start, random);
		if (!award || awardRowFor(table, start) !== row) return [];
		const next = table.slice(i + 1).find((later) => later.count > row.count);
		const counts = !next
			? `${start}+`
			: next.count - 1 === start
				? `${start}`
				: `${start}–${next.count - 1}`;
		const spins = award.min === award.max ? `${award.min}` : `${award.min}–${award.max}`;
		return [{ counts, spins }];
	});
}

/**
 * The free-spins rule this game plays. Read it through here rather than touching `doc.freeSpins`,
 * for the same reason `resolveCascade` exists: "absent means the scatter, three of them" would
 * otherwise be re-implemented at each site and eventually mis-implemented at one of them.
 */
export function resolveFreeSpins(
	doc: FreeSpinsDoc | undefined,
	defaults: FreeSpinsDefaults = FREE_SPINS_DEFAULTS,
): ResolvedFreeSpins {
	const symbol = doc?.freeSpins?.triggerSymbol;
	const count = doc?.freeSpins?.triggerCount;
	const triggerCount = validCount(count) ? count : DEFAULT_FREE_SPINS_TRIGGER_COUNT;
	return {
		enabled: doc?.freeSpins?.enabled !== false,
		triggerSymbol: validSymbol(symbol) ? symbol : doc ? scatterOf(doc) : undefined,
		triggerCount,
		awards: resolveAwardTable(doc?.freeSpins?.awards, triggerCount, defaults.award),
		retriggerAwards: resolveAwardTable(
			doc?.freeSpins?.retriggerAwards,
			triggerCount,
			defaults.retrigger,
		),
		randomAwards: doc?.freeSpins?.randomAwards === true,
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
 * Does the AWARD rule depart from the one the game's mock deals untold — `defaults` (10 spins, +5 on
 * a retrigger for lines, +10 for a Book-of game), never random? The mock contract sends the award
 * tables only when it does.
 */
export function freeSpinsAwardsAreDefault(
	doc: FreeSpinsDoc | undefined,
	defaults: FreeSpinsDefaults = FREE_SPINS_DEFAULTS,
): boolean {
	const block = doc?.freeSpins;
	return (
		block?.randomAwards !== true &&
		!normalizeAwardTable(block?.awards, defaults.award) &&
		!normalizeAwardTable(block?.retriggerAwards, defaults.retrigger)
	);
}

/**
 * Normalize an authored `freeSpins` block, or `undefined` when nothing in it departs from the
 * default — the one exception is the retrigger table, kept whenever it has a usable row (see
 * below). Same invariant as `normalizeCascade`: a config that simply has free spins on three
 * scatters stores no block and normalizes byte-identically to one written before the block existed.
 *
 * The trigger and award fields survive `enabled: false` on purpose — switching free spins off and
 * back on must not cost the author what they set up. The award tables come out sorted by count:
 * this runs at save, so a table is put in order then rather than under the author's cursor.
 */
export function normalizeFreeSpins(raw: unknown): FreeSpinsConfig | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const {
		enabled,
		triggerSymbol,
		triggerCount,
		randomAwards,
		awards,
		retriggerAwards,
		expandingSymbol,
	} = raw as Record<string, unknown>;
	const block: FreeSpinsConfig = {};
	if (enabled === false) block.enabled = false;
	if (validSymbol(triggerSymbol)) block.triggerSymbol = triggerSymbol;
	if (validCount(triggerCount) && triggerCount !== DEFAULT_FREE_SPINS_TRIGGER_COUNT) {
		block.triggerCount = triggerCount;
	}
	if (randomAwards === true) block.randomAwards = true;
	const entry = normalizeAwardTable(awards, DEFAULT_FREE_SPINS_AWARD);
	if (entry) block.awards = entry;
	// Kept whatever it awards: its default depends on the KIND (+5, or +10 for a Book-of game), which
	// a config does not carry, so a +5 table stored for a Book-of game must survive. `/config`, which
	// knows the kind, deletes a table edited back to the kind's default.
	const retrigger = awardRows(retriggerAwards);
	if (retrigger.length) block.retriggerAwards = retrigger;
	// Last: its presence IS the feature, so it survives even as `{}` (`normalizeExpandingSymbol`).
	const special = normalizeExpandingSymbol(expandingSymbol);
	if (special) block.expandingSymbol = special;
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
	if (freeSpins.triggerCount < MIN_FREE_SPINS_TRIGGER_COUNT) {
		issues.push({
			severity: 'error',
			path: 'freeSpins.triggerCount',
			message: `Free spins trigger on ${freeSpins.triggerCount} ${freeSpins.triggerSymbol ?? 'symbol'}${freeSpins.triggerCount === 1 ? '' : 's'}, which land so often during free spins that they would keep retriggering and the feature would never end. Set How many to ${MIN_FREE_SPINS_TRIGGER_COUNT} or more.`,
		});
	}
	if (freeSpins.triggerCount > cells) {
		issues.push({
			severity: 'error',
			path: 'freeSpins.triggerCount',
			message: `Free spins need ${freeSpins.triggerCount} trigger symbols but the board only has ${cells} cells, so they can never trigger.`,
		});
	}

	issues.push(
		...validateAwardTable(AWARD_TABLES.awards, doc.freeSpins?.awards, freeSpins, cells),
		...validateAwardTable(
			AWARD_TABLES.retriggerAwards,
			doc.freeSpins?.retriggerAwards,
			freeSpins,
			cells,
		),
	);
	const ranged = [...freeSpins.awards, ...freeSpins.retriggerAwards].some(
		(row) => row.maxSpins !== undefined,
	);
	if (freeSpins.randomAwards && !ranged) {
		issues.push({
			severity: 'warning',
			path: 'freeSpins.randomAwards',
			message:
				'Random amounts are on but no award row has a range, so every award is still a fixed number. Give a row a "to" value above its spins.',
		});
	}
	return issues;
};

type AwardTableKey = 'awards' | 'retriggerAwards';

/** How each table names itself to the author (as `/config` labels it), and what its rows serve. */
const AWARD_TABLES: Record<AwardTableKey, { key: AwardTableKey; label: string; gap: string }> = {
	awards: { key: 'awards', label: 'Free spins awarded', gap: 'enter free spins' },
	retriggerAwards: { key: 'retriggerAwards', label: 'Retrigger adds', gap: 'retrigger them' },
};

/**
 * One award table against the trigger it serves — only for an AUTHORED table, since the default
 * one is a single row at the trigger count and cannot be wrong.
 *
 * Duplicates and a range whose top is below its bottom are checked on the rows as authored: the
 * page validates the doc as it is being edited, so both show up and block the save there, before
 * the canonicalizer could sort or drop anything.
 */
const validateAwardTable = (
	table: (typeof AWARD_TABLES)[AwardTableKey],
	authored: FreeSpinsAward[] | undefined,
	freeSpins: ResolvedFreeSpins,
	cells: number,
): GameConfigIssue[] => {
	if (!Array.isArray(authored) || !authored.length) return [];
	const issues: GameConfigIssue[] = [];
	const path = `freeSpins.${table.key}`;
	if (authored.length > cells) {
		issues.push({
			severity: 'error',
			path,
			message: `${table.label} has ${authored.length} rows, but the board only has ${cells} cells, so no more than ${cells} trigger counts can ever land. Remove rows.`,
		});
	}
	for (const row of authored) {
		const over = [row.spins, row.maxSpins].find(
			(n) => validCount(n) && n > MAX_FREE_SPINS_PER_ROUND,
		);
		if (over !== undefined) {
			issues.push({
				severity: 'error',
				path,
				message: `${table.label}: the row for ${row.count} awards ${over} spins, more than the ${MAX_FREE_SPINS_PER_ROUND} a free-spins round may reach. Lower it to ${MAX_FREE_SPINS_PER_ROUND} or fewer.`,
			});
		}
	}
	const rows = freeSpins[table.key];
	const { triggerCount } = freeSpins;

	const seen = new Set<number>();
	for (const count of rows.map((row) => row.count)) {
		if (seen.has(count)) {
			issues.push({
				severity: 'error',
				path,
				message: `${table.label} has more than one row for ${count} — give each row its own count.`,
			});
		}
		seen.add(count);
	}
	for (const row of authored) {
		if (validCount(row.maxSpins) && validCount(row.spins) && row.maxSpins < row.spins) {
			issues.push({
				severity: 'error',
				path,
				message: `${table.label}: the row for ${row.count} runs from ${row.spins} down to ${row.maxSpins} — the "to" value cannot be below the spins.`,
			});
		}
	}
	if (rows[0].count > triggerCount) {
		issues.push({
			severity: 'error',
			path,
			message: `${table.label} starts at ${rows[0].count}, but ${triggerCount} trigger symbols already ${table.gap}, so that landing would award nothing. Add a row for ${triggerCount}.`,
		});
	}
	const covering = awardRowFor(rows, triggerCount);
	for (const row of rows) {
		if (row.count < triggerCount && row !== covering) {
			issues.push({
				severity: 'warning',
				path,
				message: `${table.label}: the row for ${row.count} is never used — fewer than ${triggerCount} trigger symbols never ${table.gap}, and the row for ${covering?.count} takes over from there.`,
			});
		}
	}
	return issues;
};
