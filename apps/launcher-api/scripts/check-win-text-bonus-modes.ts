/**
 * Contract check for bonus-games Phase 5d — Win Text and Localization per respin mode
 * (docs/design/bonus-games.md §2.4):
 *   pnpm --filter launcher-api check:win-text-bonus-modes
 *
 * What it pins, over the REAL `winTextStorage.ts` normalizer, the engine-layout resolver the game
 * runs (`resolveWinTextForMode`, behind `bakedWinTextFor`) and the Localization harvest:
 *  1. A doc with TWO respin modes keeps each mode's own jackpot / respin / wheel / feature-frame
 *     lines through save → reload, and the bundle (which carries the saved doc verbatim) resolves
 *     them apart: mode 2 speaks its own, the primary its own.
 *  2. Mode 2 without lines reads the primary's, wholly and field by field; a stray entry under the
 *     primary's own id is never read for it.
 *  3. Localization lists both modes: the primary's "Win text" section, then a `Win text — <mode>`
 *     section with mode 2's own tiers and lines, in the shared catalog (keyed by source text).
 *  4. Every current doc (the `hw-*` presets, `borut-pots-sample`, plain lines with free spins,
 *     bookOf, lines + an overlay) is byte-identical: its respin-mode list gives the tiers and wheel
 *     the legacy block gave, its Localization sections equal the pre-5d call's, and a doc without
 *     `modes` normalizes and resolves exactly as before.
 *
 * The `--tsconfig` maps SvelteKit's `$env/dynamic/private` to a stub (`scripts/lib/env-stub.ts`).
 */

import {
	kindCapabilities,
	resolveWinText,
	resolveWinTextForMode,
	type WinTextDoc,
} from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	primaryRespinMode,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { projectAddOns } from '../src/lib/addOns.ts';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';
import {
	WIN_TEXT_SECTION_ID,
	harvestProjectWinText,
	harvestWinText,
} from '../src/lib/server/localizationHarvest.ts';
import { normalizeWinTextDoc } from '../src/lib/server/winTextStorage.ts';
import { winTextRespinModes } from '../src/lib/winTextModes.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const clone = <T>(v: T): T => structuredClone(v);
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};
const withOverlay = (doc: GameConfigDoc, id: PotsOverlayPresetId): GameConfigDoc => {
	const result = addPotsOverlay(doc, id);
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};
/** Save → reload: the normalizer the PUT runs, through JSON, then the one the load runs. */
const saveReload = (doc: unknown): WinTextDoc =>
	normalizeWinTextDoc(JSON.parse(JSON.stringify(normalizeWinTextDoc(doc, 'reject'))));

/** `doc` plus a second respin mode `holdAndWin_2` with renamed tiers and a wheel, saved the way a
 *  split-form writer saves it (the legacy keys deleted). */
const SECOND = 'holdAndWin_2';
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	const game = clone(primaryRespinMode(out.modes)!.holdAndWin);
	game.jackpots = game.jackpots.map((jackpot) => ({ ...jackpot, name: `GOLD_${jackpot.name}` }));
	game.wheel = clone(HOLD_AND_WIN_PRESETS.collector.holdAndWin!.wheel);
	out.modes = [
		...(out.modes ?? []),
		{ ...holdAndWinModeDecl(), id: SECOND, gameType: 'respin_2', label: 'Gold', holdAndWin: game },
	];
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	return normalize(out);
};

const lines = normalize(gameConfigDefaultFor('lines'));
const two = withSecondMode(withOverlay(lines, 'threePots'));
const primaryTiers = two.holdAndWin!.jackpots.map((jackpot) => jackpot.name);

const authored: WinTextDoc = {
	version: 1,
	jackpots: { captions: { [primaryTiers[0]]: 'Bronze' }, award: '{jackpot} WIN' },
	respins: { counter: 'SPINS {count}' },
	feature: { intro: 'HOLD ON', potLabel: '{pot} {level}' },
	wheel: { coinBoost: 'BOOST ×{count}' },
	modes: {
		[SECOND]: {
			jackpots: {
				captions: { [`GOLD_${primaryTiers[0]}`]: 'Gold Bronze' },
				award: 'GOLD {jackpot}',
			},
			respins: { counter: 'GOLD SPINS {count}', last: 'LAST GOLD' },
			wheel: { coinBoost: 'GOLD BOOST ×{count}' },
			feature: { intro: 'GOLD RUSH', outro: 'GOLD OVER' },
		},
	},
};

// ── 1. two respin modes keep distinct lines through save → reload → bundle ──────────────────────
{
	const reloaded = saveReload(authored);
	check('1. save → reload keeps every line of both modes', reloaded, authored);
	check('1. a second save is a no-op', saveReload(reloaded), reloaded);
	// The bake and the runtime bundle ship the saved doc as it is (`bundle.winText`); the game
	// resolves it through `bakedWinTextFor(<active mode>)`.
	const bundle: WinTextDoc = JSON.parse(JSON.stringify(reloaded));
	const primary = resolveWinTextForMode(bundle, undefined);
	const gold = resolveWinTextForMode(bundle, SECOND);
	check(
		'1. the primary speaks its own lines',
		[
			primary.jackpots.award,
			primary.respins.counter,
			primary.wheel.coinBoost,
			primary.feature.intro,
			primary.jackpots.captions[primaryTiers[0]],
		],
		['{jackpot} WIN', 'SPINS {count}', 'BOOST ×{count}', 'HOLD ON', 'Bronze'],
	);
	check(
		'1. mode 2 speaks its own lines',
		[
			gold.jackpots.award,
			gold.respins.counter,
			gold.respins.last,
			gold.wheel.coinBoost,
			gold.feature.intro,
			gold.feature.outro,
			gold.jackpots.captions[`GOLD_${primaryTiers[0]}`],
		],
		[
			'GOLD {jackpot}',
			'GOLD SPINS {count}',
			'LAST GOLD',
			'GOLD BOOST ×{count}',
			'GOLD RUSH',
			'GOLD OVER',
			'Gold Bronze',
		],
	);
	check(
		"1. mode 2 shares the game's pot lines and names",
		[gold.feature.potLabel, gold.feature.specialNames, gold.feature.potNames],
		[primary.feature.potLabel, primary.feature.specialNames, primary.feature.potNames],
	);
	check(
		'1. a blank mode line prunes, and an emptied mode drops the map',
		saveReload({ ...authored, modes: { [SECOND]: { respins: { counter: ' ' } } } }).modes,
		undefined,
	);
}

// ── 2. a mode without lines reads the primary's ─────────────────────────────────────────────────
{
	const { modes: _, ...primaryOnly } = authored;
	check(
		'2. mode 2 without an entry reads exactly the primary',
		resolveWinTextForMode(primaryOnly, SECOND),
		resolveWinText(primaryOnly),
	);
	const partial: WinTextDoc = { ...primaryOnly, modes: { [SECOND]: { respins: { last: 'X' } } } };
	const read = resolveWinTextForMode(partial, SECOND);
	check(
		'2. a mode that wrote one line reads the primary for every other',
		{ ...read, respins: { ...read.respins, last: resolveWinText(partial).respins.last } },
		resolveWinText(partial),
	);
	check(
		"2. an entry under the primary's own id is never read for the primary",
		resolveWinTextForMode(
			{ ...primaryOnly, modes: { holdAndWin: { respins: { counter: 'X' } } } },
			undefined,
		),
		resolveWinText(primaryOnly),
	);
	check(
		'2. an inherited key is not a mode',
		resolveWinTextForMode(primaryOnly, 'constructor'),
		resolveWinText(primaryOnly),
	);
}

// ── 3. Localization lists both modes ────────────────────────────────────────────────────────────
{
	check(
		'3. the respin modes, the primary first, each with its own tiers and wheel',
		winTextRespinModes(two).map(({ mode, label, jackpotTiers, hasWheel }) => [
			mode,
			label,
			jackpotTiers,
			hasWheel,
		]),
		[
			['holdAndWin', 'Hold and Win', primaryTiers, false],
			[SECOND, 'Gold', primaryTiers.map((tier) => `GOLD_${tier}`), true],
		],
	);
	const sections = harvestProjectWinText(authored, 'lines', two);
	check(
		'3. a "Win text" section, then one for mode 2',
		sections.map((s) => [s.sceneId, s.sceneName, s.origin]),
		[
			[WIN_TEXT_SECTION_ID, 'Win text', 'winText'],
			[`${WIN_TEXT_SECTION_ID}:${SECOND}`, `Win text — ${SECOND}`, 'winText'],
		],
	);
	const goldKeys = sections[1].items.map((i) => i.key);
	check(
		"3. mode 2's section lists its own tiers and lines",
		[
			'Gold Bronze',
			`GOLD_${primaryTiers[1]}`,
			'GOLD {jackpot}',
			'GOLD SPINS {count}',
			'LAST GOLD',
			'GOLD RUSH',
			'GOLD OVER',
			'GOLD BOOST ×{count}',
		].filter((key) => !goldKeys.includes(key)),
		[],
	);
	check(
		"3. …and what it reads from the primary, but none of the primary's tiers or pot lines",
		[
			goldKeys.includes('RESPINS RESET'),
			goldKeys.includes('Bronze'),
			goldKeys.includes('{pot} {level}'),
		],
		[true, false, false],
	);
	check(
		"3. the primary's section is unchanged by mode 2's lines",
		sections[0],
		harvestProjectWinText({ ...authored, modes: undefined }, 'lines', two)[0],
	);
}

// ── 4. every current doc is byte-identical ──────────────────────────────────────────────────────
{
	const book = normalize(gameConfigDefaultFor('bookOf'));
	const borut = withOverlay(book, 'threePots');
	borut.potsOverlay!.pots = borut.potsOverlay!.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p,
	);
	const docs: [string, string, GameConfigDoc | null][] = [
		['no config', 'lines', null],
		['lines (free spins)', 'lines', lines],
		['bookOf', 'bookOf', book],
		...Object.entries(HOLD_AND_WIN_PRESETS).map(
			([id, doc]) =>
				[`hw-${id}-sample`, 'holdAndWin', normalize(clone(doc))] as [string, string, GameConfigDoc],
		),
		['holdAndWin template', 'holdAndWin', normalize(gameConfigDefaultFor('holdAndWin'))],
		['borut-pots-sample', 'bookOf', normalize(borut)],
		...(['threePots', 'potsToFreeSpins'] as PotsOverlayPresetId[]).map(
			(id) => [`lines + ${id}`, 'lines', withOverlay(lines, id)] as [string, string, GameConfigDoc],
		),
	];
	/** The pre-5d Localization call (`localizationSections.ts`): tiers off the legacy block. */
	const before = (doc: WinTextDoc | undefined, kind: string, config: GameConfigDoc | null) => {
		const { addOns, potIds } = projectAddOns(config);
		const capabilities = kindCapabilities(kind, addOns);
		return harvestWinText(doc, {
			holdAndWin: capabilities.holdAndWin,
			pots: capabilities.pots,
			jackpots: (config?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
			meters: potIds ?? [],
		});
	};
	const { modes: _, ...current } = authored;
	for (const [name, kind, config] of docs) {
		const modes = winTextRespinModes(config);
		check(`4. ${name} · at most one respin mode`, modes.length <= 1, true);
		check(
			`4. ${name} · the /win-text tiers and wheel are the legacy block's`,
			[modes[0]?.jackpotTiers ?? [], modes[0]?.hasWheel ?? false],
			[
				(config?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
				Boolean(config?.holdAndWin?.wheel),
			],
		);
		for (const [which, doc] of [
			['unauthored', undefined],
			['authored', current],
		] as const) {
			check(
				`4. ${name} · ${which} · Localization sections`,
				harvestProjectWinText(doc, kind, config),
				before(doc, kind, config),
			);
		}
	}
	check(
		'4. a doc without modes normalizes without the key',
		Object.hasOwn(normalizeWinTextDoc(current), 'modes'),
		false,
	);
	check(
		'4. …and the game resolves it exactly as before',
		resolveWinTextForMode(current, undefined),
		resolveWinText(current),
	);
}

if (failures) {
	console.log(`\ncheck:win-text-bonus-modes — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:win-text-bonus-modes — all ${checks} checks pass`);
