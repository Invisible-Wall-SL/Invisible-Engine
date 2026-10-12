/**
 * The tool and info facts `check:spins-modes-tools` pins for every CURRENT doc (bonus-games Phase 8c):
 * the Scene Editor's scene set and add-on screens, the Flow add-ons, grafted starter flow and publish
 * verdict, the Win Text lines and Localization sections, the `/symbols` page data and the info page's
 * paytable / paylines / grid. Built from APIs `main` already had, so the same module run on a `main`
 * tree measures the digests the gate compares against (`--print`) — save the borut sample's pots
 * edit, which goes through the split-form writers (`main` wrote its `potsOverlay` mirror).
 */

import { createHash } from 'node:crypto';
import { freshDrivenSeedDoc, graftAddOnSteps } from 'engine-flow-v2';
import {
	addOnSceneIds,
	engineOwnedOnly,
	getFullSceneSet,
	resolveWinText,
	resolveWinTextForMode,
	type Scene,
	type WinTextDoc,
} from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEMPLATES,
	addPotsOverlay,
	flowAddOnsOf,
	normalizeGameConfigDoc,
	potsOverlayOf,
	respinModeIds,
	setOverlayPots,
	shownPaytable,
	symbolsInPlay,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { createGameConfig } from '../../../../packages/engine-game/src/game/gameConfig.ts';
import { sceneSetOptionsFor } from '../../src/lib/addOns.ts';
import { validateFlowV2Against } from '../../src/lib/server/flowV2Validation.ts';
import { gameConfigDefaultFor } from '../../src/lib/server/gameConfigDefaults.ts';
import { harvestProjectWinText } from '../../src/lib/server/localizationHarvest.ts';
import { symbolDefaultsFor } from '../../src/lib/server/symbolDefaults.ts';
import { symbolsPageConfig } from '../../src/lib/server/symbolsPageConfig.ts';

export const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(structuredClone(raw));
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

export const withOverlay = (doc: GameConfigDoc, id: PotsOverlayPresetId): GameConfigDoc => {
	const result = addPotsOverlay(doc, id);
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};

export const EMPTY_LIBRARY = { version: 2 as const, functions: [] };

export const scenesFor = (kind: string, doc: GameConfigDoc | null): Scene[] =>
	engineOwnedOnly(getFullSceneSet(kind, sceneSetOptionsFor(kind, doc))!).scenes;

/** An authored Win Text doc every current doc's lines are read through. */
export const AUTHORED_WIN_TEXT: WinTextDoc = {
	version: 1,
	lineMessage: { default: '{count} {symbolName}', byCount: { '5': 'FIVE!' } },
	winLevels: { big: 'BIG WIN' },
	jackpots: { award: '{jackpot}!' },
	respins: { counter: '{count} LEFT' },
};

/** Every current doc the gate holds byte-identical: [name, kind, doc]. */
export function currentDocs(): [string, string, GameConfigDoc | null][] {
	const lines = normalize(gameConfigDefaultFor('lines'));
	const book = normalize(gameConfigDefaultFor('bookOf'));
	const borut = withOverlay(book, 'threePots');
	const pots = potsOverlayOf(borut)!;
	setOverlayPots(borut, {
		...pots,
		pots: pots.pots.map((p) => (p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p)),
	});
	return [
		['no config', 'lines', null],
		['lines', 'lines', lines],
		['ways', 'ways', normalize(gameConfigDefaultFor('ways'))],
		['cluster', 'cluster', normalize(gameConfigDefaultFor('cluster'))],
		['free spins (bookOf)', 'bookOf', book],
		...Object.entries(HOLD_AND_WIN_PRESETS).map(([id, doc]): [string, string, GameConfigDoc] => [
			`hw-${id}-sample`,
			'holdAndWin',
			normalize(doc),
		]),
		...Object.entries(HOLD_AND_WIN_TEMPLATES).map(([id, doc]): [string, string, GameConfigDoc] => [
			`holdAndWin template ${id}`,
			'holdAndWin',
			normalize(doc),
		]),
		...(['threePots', 'potsToFreeSpins'] as PotsOverlayPresetId[]).map(
			(id): [string, string, GameConfigDoc] => [`lines + ${id}`, 'lines', withOverlay(lines, id)],
		),
		['borut-pots-sample', 'bookOf', borut],
	];
}

export const digest = (value: unknown): string =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** The info page's data for `doc` with no mode bound (the base game): its paytable rows, paylines,
 *  grid and divisor, read through the engine's own config accessors. */
export function baseInfoData(doc: GameConfigDoc) {
	const config = createGameConfig<string>({ bakedConfig: () => doc, compiledConfig: doc });
	return {
		paytable: shownPaytable(doc.symbols, symbolsInPlay(doc)),
		paylines: config.getPaylines(),
		board: config.boardDimensions(),
		rows: config.getNumRows(),
		divisor: config.payoutDivisor(),
	};
}

/** Every fact of `doc`, digested. */
export function factsOf(kind: string, doc: GameConfigDoc | null): Record<string, string> {
	const options = sceneSetOptionsFor(kind, doc);
	const addOns = flowAddOnsOf(doc);
	const seed = graftAddOnSteps(freshDrivenSeedDoc(kind), addOns).doc;
	// `spinsModes` is Phase 8c's own key (always empty here, pinned by the gate); the rest is main's.
	const { spinsModes: _spins, ...symbols } = symbolsPageConfig(kind, symbolDefaultsFor(kind), {
		doc,
		source: 'authored',
		etag: null,
	}) as ReturnType<typeof symbolsPageConfig> & { spinsModes?: unknown };
	const respinModes = doc ? respinModeIds(doc) : [];
	return {
		scenes: digest(getFullSceneSet(kind, options)),
		addOnScreens: digest(addOnSceneIds(kind, options)),
		flowAddOns: digest(addOns),
		flowSeed: digest(seed),
		flowVerdict: digest(
			validateFlowV2Against(seed, scenesFor(kind, doc), null, EMPTY_LIBRARY, [], addOns),
		),
		winText: digest([
			resolveWinText(AUTHORED_WIN_TEXT),
			...respinModes.map((mode) => resolveWinTextForMode(AUTHORED_WIN_TEXT, mode)),
		]),
		localization: digest(harvestProjectWinText(AUTHORED_WIN_TEXT, kind, doc)),
		symbols: digest(symbols),
		info: doc ? digest(baseInfoData(doc)) : 'none',
	};
}

/** Run directly: print every current doc's facts (to measure `main`'s). */
if (process.argv[1]?.endsWith('spinsToolsFacts.ts')) {
	const out: Record<string, string> = {};
	for (const [name, kind, doc] of currentDocs()) {
		for (const [fact, value] of Object.entries(factsOf(kind, doc)))
			out[`${name} · ${fact}`] = value;
	}
	console.log(JSON.stringify(out, null, '\t'));
}
