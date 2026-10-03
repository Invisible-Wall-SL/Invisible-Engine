/**
 * ADD-ONS merged into a project that already has its own game (`docs/design/pots-overlay.md` §3.1,
 * §4): the pots overlay and a Hold and Win bonus. Each adds its parts and replaces nothing the
 * project has — the `/config` Add-ons section and the Game Maker's add-on action both go through
 * here, so neither is ever a whole-doc reset.
 *
 * NAME CLASHES ARE RENAMED, never merged: a preset symbol or pot id the project already uses takes
 * the first free `_2`, `_3`… suffix everywhere the add-on names it (its respin strips, its pot
 * tokens, its drop table), and the result lists each rename so the tool can say so. A host symbol is
 * never shared or redefined, so {@link removePotsOverlay} never takes one.
 *
 * A Hold and Win block beside an overlay whose base strips deal no Hold and Win symbol is the
 * overlay's BONUS ({@link holdAndWinIsOverlayBonus}), however it was added: it belongs to the
 * overlay, and removing the overlay removes it. Without an overlay the same block is the base game's
 * feature, which is why `/config` offers a bonus only beside an overlay.
 *
 * Pure: the input is never mutated. The result is NOT normalized, so a half-typed field elsewhere in
 * an editor's live doc survives an add.
 */

import { holdAndWinIsOverlayBonus, isHoldAndWinSymbol } from './holdAndWin';
import type { HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import { HOLD_AND_WIN_MODE, gameModeById, gameTypeForMode, resolveGameModes } from './modes';
import type { PotsOverlay } from './potsOverlay';
import { holdAndWinBonus, potsOverlayPreset, type PotsOverlayPresetId } from './potsOverlayPresets';
import type { GameConfigDoc, GameConfigSymbol } from './types';

/** The names an add-on had to change because the project already used them: preset name → name
 *  in the doc. Empty when nothing clashed. */
export type AddOnRenames = {
	symbols: Record<string, string>;
	pots: Record<string, string>;
};

export type AddOnResult =
	{ ok: true; doc: GameConfigDoc; renamed: AddOnRenames } | { ok: false; reason: string };

const freeName = (wanted: string, taken: Set<string>): string => {
	if (!taken.has(wanted)) return wanted;
	let n = 2;
	while (taken.has(`${wanted}_${n}`)) n += 1;
	return `${wanted}_${n}`;
};

/** Add `symbols` under free names; returns the name each one ended up with. */
function addSymbols(
	doc: GameConfigDoc,
	symbols: Record<string, GameConfigSymbol>,
	renamed: AddOnRenames,
): Record<string, string> {
	const taken = new Set(Object.keys(doc.symbols));
	const names: Record<string, string> = {};
	for (const [wanted, entry] of Object.entries(symbols)) {
		const name = freeName(wanted, taken);
		taken.add(name);
		names[wanted] = name;
		if (name !== wanted) renamed.symbols[wanted] = name;
		doc.symbols[name] = entry;
	}
	return names;
}

/** The game type the Hold and Win mode pads from in this doc, its authored mode override included. */
const holdAndWinGameType = (doc: GameConfigDoc): string =>
	gameTypeForMode(gameModeById(doc, HOLD_AND_WIN_MODE) ?? { id: HOLD_AND_WIN_MODE });

/** Merge a Hold and Win bonus into `doc` in place; a refusal's reason, or `undefined`. */
function mergeHoldAndWinBonus(
	doc: GameConfigDoc,
	id: HoldAndWinPresetId,
	renamed: AddOnRenames,
): string | undefined {
	if (doc.holdAndWin) return 'This project already has a Hold and Win block.';
	const bonus = holdAndWinBonus(id, doc);
	const gameType = holdAndWinGameType({ ...doc, holdAndWin: bonus.holdAndWin });
	if (doc.paddingReels[gameType]) {
		return `This project already has "${gameType}" strips, which the Hold and Win respin board would pad from. Remove them first.`;
	}
	const names = addSymbols(doc, bonus.symbols, renamed);
	const strips = Object.values(bonus.paddingReels)[0] ?? [];
	doc.paddingReels[gameType] = strips.map((strip) =>
		strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
	);
	doc.holdAndWin = bonus.holdAndWin;
	return undefined;
}

const noRenames = (): AddOnRenames => ({ symbols: {}, pots: {} });

/**
 * Add a Hold and Win bonus — its block, the symbols its respin board deals and its respin strips — to
 * a project of any kind. Refused when the project already has a block.
 */
export function addHoldAndWinBonus(doc: GameConfigDoc, id: HoldAndWinPresetId): AddOnResult {
	const next = structuredClone(doc);
	const renamed = noRenames();
	const reason = mergeHoldAndWinBonus(next, id, renamed);
	return reason ? { ok: false, reason } : { ok: true, doc: next, renamed };
}

/**
 * Add the pots overlay preset `id`: its `potsOverlay` block and its token symbols (in the dictionary
 * only, never on a strip). A preset that pairs a Hold and Win bonus also adds that bonus, unless the
 * project already has a Hold and Win block — a Hold and Win game keeps its own, and its pots fill
 * beside the block's meters. Refused when the project already has an overlay, and a preset with no
 * pots (coins only) is refused on a Hold and Win game, whose block counts only its own landed coins;
 * there a preset's value-coin drops are left out too.
 */
export function addPotsOverlay(doc: GameConfigDoc, id: PotsOverlayPresetId): AddOnResult {
	if (doc.potsOverlay) {
		return { ok: false, reason: 'This project already has a pots overlay. Remove it first.' };
	}
	const next = structuredClone(doc);
	const renamed = noRenames();
	const preset = potsOverlayPreset(id);
	if (preset.holdAndWin && !next.holdAndWin) {
		const reason = mergeHoldAndWinBonus(next, preset.holdAndWin, renamed);
		if (reason) return { ok: false, reason };
	}
	const tokens = addSymbols(next, preset.tokens, renamed);
	const takenIds = new Set(next.holdAndWin?.meters?.map((m) => m.id));
	const potIds: Record<string, string> = {};
	for (const pot of preset.potsOverlay.pots) {
		const potId = freeName(pot.id, takenIds);
		takenIds.add(potId);
		potIds[pot.id] = potId;
		if (potId !== pot.id) renamed.pots[pot.id] = potId;
	}
	const overlay: PotsOverlay = {
		pots: preset.potsOverlay.pots.map((pot) => ({
			...pot,
			id: potIds[pot.id],
			token: tokens[pot.token] ?? pot.token,
		})),
		drops: {
			...preset.potsOverlay.drops,
			table: preset.potsOverlay.drops.table.map((entry) =>
				'pot' in entry ? { ...entry, pot: potIds[entry.pot] ?? entry.pot } : entry,
			),
		},
	};
	next.potsOverlay = overlay;
	if (!overlay.pots.length && !holdAndWinIsOverlayBonus(next)) {
		return {
			ok: false,
			reason:
				"This project's Hold and Win is its base game, started by coins landing on its reels, so dropped value coins would start nothing. Pick a preset with pots.",
		};
	}
	// For the same reason a preset's value-coin rows are left out there: only its pots fill.
	if (!holdAndWinIsOverlayBonus(next)) {
		overlay.drops.table = overlay.drops.table.filter((entry) => 'pot' in entry);
	}
	return { ok: true, doc: next, renamed };
}

/** A dictionary entry exactly as an add-on creates a token: tagged `meterSpecial`, paying nothing. */
const isBareToken = (symbol: GameConfigSymbol | undefined): boolean =>
	!!symbol &&
	!symbol.paytable?.length &&
	JSON.stringify(symbol.special_properties) === JSON.stringify(['meterSpecial']);

/**
 * Take the pots overlay out of `doc`. When the `holdAndWin` block is the overlay's BONUS
 * ({@link holdAndWinIsOverlayBonus}) it goes too — without the overlay nothing could start it — with
 * its mode override and its respin strips, unless another mode pads from those strips. A symbol the removed parts named is dropped only when no
 * strip deals it any more and it is one an add-on makes (a bare token, or a Hold and Win role
 * symbol); everything else the project has is left exactly as it was.
 */
export function removePotsOverlay(doc: GameConfigDoc): GameConfigDoc {
	const next = structuredClone(doc);
	const overlay = next.potsOverlay;
	if (!overlay) return next;
	const tokens = new Set(overlay.pots.map((p) => p.token));
	const bonusSymbols = new Set<string>();
	if (holdAndWinIsOverlayBonus(next)) {
		const gameType = holdAndWinGameType(next);
		const shared = resolveGameModes(next).some(
			(m) => m.id !== HOLD_AND_WIN_MODE && gameTypeForMode(m) === gameType,
		);
		if (!shared) {
			for (const name of symbolsInPlayForGameType(next, gameType)) bonusSymbols.add(name);
			delete next.paddingReels[gameType];
		}
		delete next.holdAndWin;
		const modes = next.modes?.filter((m) => m.id !== HOLD_AND_WIN_MODE);
		if (modes?.length) next.modes = modes;
		else delete next.modes;
	}
	delete next.potsOverlay;
	const keep = new Set([
		...symbolsInPlay(next),
		...(next.holdAndWin?.meters ?? []).map((m) => m.symbol),
	]);
	for (const name of tokens) {
		if (!keep.has(name) && isBareToken(next.symbols[name])) delete next.symbols[name];
	}
	for (const name of bonusSymbols) {
		if (!keep.has(name) && isHoldAndWinSymbol(next.symbols[name])) delete next.symbols[name];
	}
	return next;
}
