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
 * an editor's live doc survives an add. Each add-on edits the legacy `holdAndWin` / `potsOverlay` pair
 * (a doc only in the split form gets it first, {@link withLegacyPair}) and rewrites the split form
 * from it ({@link syncBonusSplit}, `./bonusGames`), so a result is already the doc normalization
 * stores.
 */

import {
	HOLD_AND_WIN_SPECIALS,
	holdAndWinIsOverlayBonus,
	isHoldAndWinSymbol,
	type HoldAndWinSpecial,
} from './holdAndWin';
import { HOLD_AND_WIN_PRESETS, type HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import {
	BASE_GAME_MODE,
	HOLD_AND_WIN_MODE,
	gameModeById,
	gameTypeForMode,
	resolveGameModes,
} from './modes';
import {
	MAX_OVERLAY_POTS,
	OVERLAY_POT_IDS,
	isCoinDrop,
	type OverlayPot,
	type PotBonus,
	type PotsOverlay,
} from './potsOverlay';
import { holdAndWinBonus, potsOverlayPreset, type PotsOverlayPresetId } from './potsOverlayPresets';
import { legacyHoldAndWin, legacyPotsOverlay, syncBonusSplit, withLegacyPair } from './bonusGames';
import type { GameConfigDoc, GameConfigSymbol } from './types';

/** The names an add-on had to change because the project already used them: preset name → name
 *  in the doc. Empty when nothing clashed. */
export type AddOnRenames = {
	symbols: Record<string, string>;
	pots: Record<string, string>;
};

/** `notes`: anything else the change did that the author should be told — a setting it moved, the
 *  pots it removed. Absent when there is nothing to say. */
export type AddOnResult =
	| { ok: true; doc: GameConfigDoc; renamed: AddOnRenames; notes?: string[] }
	| { ok: false; reason: string };

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
	const next = withLegacyPair(structuredClone(doc));
	const renamed = noRenames();
	const reason = mergeHoldAndWinBonus(next, id, renamed);
	return reason ? { ok: false, reason } : { ok: true, doc: syncBonusSplit(next), renamed };
}

/**
 * Add the pots overlay preset `id`: its `potsOverlay` block and its token symbols (in the dictionary
 * only, never on a strip). A preset that pairs a Hold and Win bonus also adds that bonus, unless the
 * project already has a Hold and Win block — a Hold and Win game keeps its own, and its pots fill
 * beside the block's meters. Refused when the project already has an overlay, and a preset with no
 * pots (coins only) is refused on a Hold and Win game, whose block counts only its own landed coins;
 * there a preset's value-coin drops are left out too. `pots` sets how many pots it starts with
 * ({@link setOverlayPotCount}); absent ⇒ the preset's own.
 */
export function addPotsOverlay(
	doc: GameConfigDoc,
	id: PotsOverlayPresetId,
	pots?: number,
): AddOnResult {
	const result = mergePotsOverlay(doc, id, pots);
	if (!result.ok || pots === undefined || pots === result.doc.potsOverlay?.pots.length) {
		return result;
	}
	if (pots === 0 && !result.doc.holdAndWin) {
		return {
			ok: false,
			reason:
				'With no pots the overlay drops only value coins, which start a Hold and Win bonus. Pick a preset that brings one (3 Pots, Coins only), or keep at least one pot.',
		};
	}
	const counted = setOverlayPotCount(result.doc, pots);
	if (!counted.ok) return counted;
	// A rename reported by the merge is dropped when the count cut the pot or token it named.
	const kept = counted.doc;
	const potIds = new Set(kept.potsOverlay?.pots.map((p) => p.id));
	return {
		...counted,
		renamed: {
			symbols: {
				...Object.fromEntries(
					Object.entries(result.renamed.symbols).filter(([, name]) => name in kept.symbols),
				),
				...counted.renamed.symbols,
			},
			pots: Object.fromEntries(
				Object.entries(result.renamed.pots).filter(([, potId]) => potIds.has(potId)),
			),
		},
	};
}

/** `pots`, when given, is the count the overlay will end with, so the coins-only refusal looks at
 *  that rather than at the preset's own pots. */
function mergePotsOverlay(doc: GameConfigDoc, id: PotsOverlayPresetId, pots?: number): AddOnResult {
	if (legacyPotsOverlay(doc)) {
		return { ok: false, reason: 'This project already has a pots overlay. Remove it first.' };
	}
	const next = withLegacyPair(structuredClone(doc));
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
	if (!(pots ?? overlay.pots.length) && !holdAndWinIsOverlayBonus(next)) {
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
	return { ok: true, doc: syncBonusSplit(next), renamed };
}

/** A dictionary entry exactly as an add-on creates a token: tagged `meterSpecial`, paying nothing. */
const isBareToken = (symbol: GameConfigSymbol | undefined): boolean =>
	!!symbol &&
	!symbol.paytable?.length &&
	JSON.stringify(symbol.special_properties) === JSON.stringify(['meterSpecial']);

/** The symbols nothing but `tokens` names may be deleted with them: dealt by no strip, the token of
 *  no pot or Hold and Win meter. */
function dropUnusedTokens(doc: GameConfigDoc, tokens: Iterable<string>): void {
	const keep = new Set([
		...symbolsInPlay(doc),
		...(doc.potsOverlay?.pots ?? []).map((p) => p.token),
		...(doc.holdAndWin?.meters ?? []).map((m) => m.symbol),
	]);
	for (const name of tokens) {
		if (!keep.has(name) && isBareToken(doc.symbols[name])) delete doc.symbols[name];
	}
}

/** The token for a new pot `id`: `POT_<ID>` when free, or when it is an unused symbol whose only
 *  role is `meterSpecial` (one a lower count kept because the author gave it a payout); else the
 *  first free suffix, reported in `renamed`. A Hold and Win role symbol is never taken over. */
function tokenForNewPot(doc: GameConfigDoc, id: string, renamed: AddOnRenames): string {
	const base = `POT_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
	const used = new Set([
		...symbolsInPlay(doc),
		...(doc.potsOverlay?.pots ?? []).map((p) => p.token),
		...(doc.holdAndWin?.meters ?? []).map((m) => m.symbol),
	]);
	const roles = doc.symbols[base]?.special_properties;
	if (JSON.stringify(roles) === JSON.stringify(['meterSpecial']) && !used.has(base)) return base;
	const name = freeName(base, new Set(Object.keys(doc.symbols)));
	doc.symbols[name] = { special_properties: ['meterSpecial'] };
	if (name !== base) renamed.symbols[base] = name;
	return name;
}

/** The specials Hold and Win pots activate in turn: the 3 Pots order (red, blue, green), then the
 *  rest. */
const potSpecials = (): HoldAndWinSpecial[] => [
	...new Set([
		...(HOLD_AND_WIN_PRESETS.pots.holdAndWin?.meters ?? []).flatMap((m) =>
			m.activates ? [m.activates] : [],
		),
		...HOLD_AND_WIN_SPECIALS,
	]),
];

/** What a new pot starts: like the last pot's, with a Hold and Win pot taking the first configured
 *  special ({@link potSpecials}) no other pot or meter activates. Without a pot to copy, Hold and Win
 *  when the project has a block, else its first bonus mode on the reels. */
function bonusForNewPot(doc: GameConfigDoc, like: OverlayPot | undefined): PotBonus | undefined {
	const block = legacyHoldAndWin(doc);
	const mode =
		like?.bonus.mode ??
		(block
			? HOLD_AND_WIN_MODE
			: resolveGameModes(doc).find((m) => m.id !== BASE_GAME_MODE && m.board === 'reels')?.id);
	if (!mode) return undefined;
	if (mode !== HOLD_AND_WIN_MODE) return { ...like?.bonus, mode };
	const taken = new Set<HoldAndWinSpecial | undefined>([
		...(legacyPotsOverlay(doc)?.pots ?? []).map((p) => p.bonus.activates),
		...(block?.meters ?? []).map((m) => m.activates),
	]);
	const activates = potSpecials().find((s) => block?.specials[s] && !taken.has(s));
	return activates ? { mode, activates } : { mode };
}

/**
 * Give the overlay `count` pots, 0 to {@link MAX_OVERLAY_POTS}. Pots go from the end, with their drop
 * rows and the bare tokens nothing else uses. A new pot takes the next free id of
 * {@link OVERLAY_POT_IDS}, its own token, the last pot's size and drop weight, and a bonus like the
 * last pot's ({@link bonusForNewPot}).
 *
 * 0 is allowed when {@link zeroPotsRefusal} says so. A value-coin drop row is then added when the
 * table has none, and the most drops per spin is raised to reach the trigger, as the Coins only
 * preset sets it. `notes` says what was removed and what was raised.
 */
/**
 * Why `doc`'s overlay cannot go down to no pots, or `undefined` when it can. With no pots it drops
 * only value coins, so it needs a Hold and Win block that is the overlay's bonus (a Hold and Win
 * game's own block counts only its landed coins) with a coin count trigger. `/config`'s pot count
 * and its last pot's × both ask here.
 */
export function zeroPotsRefusal(doc: GameConfigDoc): string | undefined {
	const block = legacyHoldAndWin(doc);
	if (!block) {
		return 'With no pots the overlay drops only value coins, which start a Hold and Win bonus — add one first, or keep at least one pot.';
	}
	if (!holdAndWinIsOverlayBonus(doc)) {
		return "This game's own Hold and Win is its base game, started by coins landing on its reels, so value coins alone start nothing — it needs at least one pot.";
	}
	if (!block.trigger.count) {
		return 'Value coins start this Hold and Win only through its coin count trigger, which it does not set — set one in the Hold and Win section first, or keep at least one pot.';
	}
	return undefined;
}

export function setOverlayPotCount(doc: GameConfigDoc, count: number): AddOnResult {
	if (!legacyPotsOverlay(doc)) return { ok: false, reason: 'This project has no pots overlay.' };
	if (!Number.isInteger(count) || count < 0 || count > MAX_OVERLAY_POTS) {
		return { ok: false, reason: `An overlay holds 0 to ${MAX_OVERLAY_POTS} pots.` };
	}
	const next = withLegacyPair(structuredClone(doc));
	const overlay = next.potsOverlay!;
	const renamed = noRenames();
	const notes: string[] = [];
	const removed = overlay.pots.splice(count);
	if (removed.length) {
		notes.push(
			`Removed ${removed.map((p) => p.id).join(', ')}. What is authored for ${removed.length > 1 ? 'them' : 'it'} elsewhere (a Pot Meter, a Win Text name, a flight style) is kept and draws nothing until a pot with that id returns.`,
		);
	}
	const gone = new Set(
		removed.map((p) => p.id).filter((id) => !overlay.pots.some((p) => p.id === id)),
	);
	overlay.drops.table = overlay.drops.table.filter((e) => isCoinDrop(e) || !gone.has(e.pot));
	dropUnusedTokens(
		next,
		removed.map((p) => p.token),
	);

	while (overlay.pots.length < count) {
		const like = overlay.pots.at(-1);
		const bonus = bonusForNewPot(next, like);
		if (!bonus)
			return { ok: false, reason: 'This project has no bonus mode a full pot could start.' };
		const taken = new Set([
			...overlay.pots.map((p) => p.id),
			...(next.holdAndWin?.meters ?? []).map((m) => m.id),
		]);
		const id =
			OVERLAY_POT_IDS.find((name) => !taken.has(name)) ??
			freeName(OVERLAY_POT_IDS[overlay.pots.length % OVERLAY_POT_IDS.length], taken);
		overlay.pots.push({
			id,
			token: tokenForNewPot(next, id, renamed),
			maxLevel: like?.maxLevel ?? 12,
			sizeStages: like ? [...like.sizeStages] : [5, 9],
			bonus,
		});
		const weight =
			overlay.drops.table.find((e) => !isCoinDrop(e) && e.pot === like?.id)?.weight ?? 1;
		overlay.drops.table.push({ pot: id, weight });
	}

	if (!count) {
		const refusal = zeroPotsRefusal(next);
		if (refusal) return { ok: false, reason: refusal };
		if (!overlay.drops.table.some(isCoinDrop)) overlay.drops.table.push({ coin: true, weight: 1 });
		// Enough coins must be able to land on one spin to reach the trigger, as the Coins only
		// preset sets it. Said, not done silently: it stays raised when pots come back.
		const trigger = next.holdAndWin!.trigger.count!.min;
		const before = overlay.drops.maxPerSpin;
		if (before < trigger) {
			overlay.drops.maxPerSpin = trigger + 2;
			notes.push(
				`Most per spin raised from ${before} to ${trigger + 2}, so the ${trigger} coins the Hold and Win trigger needs can land on one spin. Lower it again if you add pots back.`,
			);
		}
	}
	return { ok: true, doc: syncBonusSplit(next), renamed, ...(notes.length ? { notes } : {}) };
}

/**
 * Take the Hold and Win BONUS out of `doc` in place: the block, its mode and its respin strips
 * (unless another mode pads from them), and its record as an imported bonus. `doc` carries the legacy
 * pair ({@link withLegacyPair}), so normalization drops the routes to the mode with it. Returns the
 * symbols those strips dealt, for the caller to drop once nothing deals them
 * ({@link dropUnusedSymbols}).
 */
export function takeOutHoldAndWinBonus(doc: GameConfigDoc): Set<string> {
	const dealt = new Set<string>();
	if (!doc.holdAndWin) return dealt;
	const gameType = holdAndWinGameType(doc);
	const shared = resolveGameModes(doc).some(
		(m) => m.id !== HOLD_AND_WIN_MODE && gameTypeForMode(m) === gameType,
	);
	if (!shared) {
		for (const name of symbolsInPlayForGameType(doc, gameType)) dealt.add(name);
		delete doc.paddingReels[gameType];
	}
	delete doc.holdAndWin;
	const modes = doc.modes?.filter((m) => m.id !== HOLD_AND_WIN_MODE);
	if (modes?.length) doc.modes = modes;
	else delete doc.modes;
	const imports = doc.imports?.filter((i) => i.mode !== HOLD_AND_WIN_MODE);
	if (imports?.length) doc.imports = imports;
	else delete doc.imports;
	return dealt;
}

/**
 * Delete each of `names` from the dictionary that `removable` accepts and that nothing still names:
 * no strip deals it, and it is no meter's symbol or pot's token.
 */
export function dropUnusedSymbols(
	doc: GameConfigDoc,
	names: Iterable<string>,
	removable: (symbol: GameConfigSymbol | undefined) => boolean,
): void {
	const keep = new Set([
		...symbolsInPlay(doc),
		...(doc.holdAndWin?.meters ?? []).map((m) => m.symbol),
		...(doc.potsOverlay?.pots ?? []).map((p) => p.token),
	]);
	for (const name of names) {
		if (!keep.has(name) && removable(doc.symbols[name])) delete doc.symbols[name];
	}
}

/**
 * Take an imported REELS mode out of `doc` in place (`./imports`): its declaration, its strips and its
 * record. Returns the symbols it owned (its record's map — a symbol it shared with the host is not
 * there), for the caller to drop once nothing deals them ({@link dropUnusedSymbols}).
 */
export function takeOutImportedReelsMode(doc: GameConfigDoc, mode: string): Set<string> {
	const record = doc.imports?.find((i) => i.mode === mode);
	const decl = doc.modes?.find((m) => m.id === mode);
	if (decl?.board === 'reels') delete doc.paddingReels[gameTypeForMode(decl)];
	const modes = doc.modes?.filter((m) => m.id !== mode);
	if (modes?.length) doc.modes = modes;
	else delete doc.modes;
	const imports = doc.imports?.filter((i) => i.mode !== mode);
	if (imports?.length) doc.imports = imports;
	else delete doc.imports;
	return new Set(Object.values(record?.symbols ?? {}));
}

/**
 * Take the pots overlay out of `doc`. When the `holdAndWin` block is the overlay's BONUS
 * ({@link holdAndWinIsOverlayBonus}) it goes too — without the overlay nothing could start it — with
 * its mode override and its respin strips, unless another mode pads from those strips. A symbol the
 * removed parts named is dropped only when no strip deals it any more and it is one an add-on makes
 * (a bare token, or a Hold and Win role symbol); everything else the project has is left exactly as
 * it was.
 */
export function removePotsOverlay(doc: GameConfigDoc): GameConfigDoc {
	const next = withLegacyPair(structuredClone(doc));
	const overlay = next.potsOverlay;
	if (!overlay) return next;
	const tokens = new Set(overlay.pots.map((p) => p.token));
	const bonusSymbols = holdAndWinIsOverlayBonus(next)
		? takeOutHoldAndWinBonus(next)
		: new Set<string>();
	// An imported reels mode is started only by a pot too, so it goes with the overlay.
	const reelsSymbols = (next.imports ?? [])
		.filter((i) => i.mode !== HOLD_AND_WIN_MODE)
		.flatMap((i) => [...takeOutImportedReelsMode(next, i.mode)]);
	delete next.potsOverlay;
	// Without a Hold and Win of its own the project has no overlay left; with one, normalization keeps
	// that game's trigger half and drops the pots (`./bonusGames`).
	if (!next.holdAndWin) delete next.coinOverlay;
	dropUnusedSymbols(next, tokens, isBareToken);
	dropUnusedSymbols(next, bonusSymbols, isHoldAndWinSymbol);
	dropUnusedSymbols(next, reelsSymbols, () => true);
	return syncBonusSplit(next);
}
