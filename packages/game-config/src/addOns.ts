/**
 * ADD-ONS merged into a project that already has its own game (`docs/design/pots-overlay.md` §3.1,
 * §4): the pots overlay and a Hold and Win bonus. Each adds its parts and replaces nothing the
 * project has — the `/config` Coin overlay section and the Game Maker's add-on action both go through
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
 * an editor's live doc survives an add. Each add-on edits the split form (`./bonusGames`): the coin
 * overlay and the primary respin mode, a preset's Hold and Win installed whole through
 * `setPrimaryHoldAndWin`. Its bonus part is already what normalization stores.
 */

import {
	HOLD_AND_WIN_SPECIALS,
	SPECIAL_SYMBOL_ROLE,
	baseGameDealsHoldAndWin,
	holdAndWinIsOverlayBonus,
	isHoldAndWinSymbol,
	type HoldAndWinSpecial,
} from './holdAndWin';
import type { HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import {
	BASE_GAME_MODE,
	HOLD_AND_WIN_MODE,
	gameModeById,
	gameTypeForMode,
	holdAndWinModeDecl,
	resolveGameModes,
} from './modes';
import {
	MAX_OVERLAY_POTS,
	OVERLAY_POT_IDS,
	isCoinDrop,
	type OverlayDrops,
	type OverlayPot,
	type PotBonus,
	type PotsOverlay,
} from './potsOverlay';
import {
	holdAndWinBonus,
	potsOverlayPreset,
	presetHoldAndWin,
	type PotsOverlayPreset,
	type PotsOverlayPresetId,
} from './potsOverlayPresets';
import {
	potsOverlayOf,
	primaryHoldAndWin,
	primaryRespinMode,
	removeHoldAndWin,
	setOverlayPots,
	setPrimaryHoldAndWin,
} from './bonusGames';
import {
	inferCoinOverlayStyle,
	normalizeCoinOverlay,
	overlayDropsTokens,
	type CoinOverlay,
} from './coinOverlay';
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
export function addSymbols(
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

/** The game type the primary respin mode pads from in this doc — or, without one, the one a Hold and
 *  Win added now would: the built-in's, an authored override of the `holdAndWin` mode on top. */
const holdAndWinGameType = (doc: GameConfigDoc): string =>
	gameTypeForMode(
		primaryRespinMode(doc.modes) ?? {
			...holdAndWinModeDecl(),
			...gameModeById(doc, HOLD_AND_WIN_MODE),
		},
	);

/** The id of `doc`'s primary respin mode, else the one a Hold and Win added now takes. */
const holdAndWinModeId = (doc: GameConfigDoc): string =>
	primaryRespinMode(doc.modes)?.id ?? HOLD_AND_WIN_MODE;

/** Merge a Hold and Win bonus into `doc` in place; a refusal's reason, or `undefined`. */
function mergeHoldAndWinBonus(
	doc: GameConfigDoc,
	id: HoldAndWinPresetId,
	renamed: AddOnRenames,
): string | undefined {
	if (primaryRespinMode(doc.modes)) return 'This project already has a Hold and Win block.';
	const bonus = holdAndWinBonus(id, doc);
	const gameType = holdAndWinGameType(doc);
	if (doc.paddingReels[gameType]) {
		return `This project already has "${gameType}" strips, which the Hold and Win respin board would pad from. Remove them first.`;
	}
	const names = addSymbols(doc, bonus.symbols, renamed);
	const strips = Object.values(bonus.paddingReels)[0] ?? [];
	doc.paddingReels[gameType] = strips.map((strip) =>
		strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
	);
	setPrimaryHoldAndWin(doc, bonus.holdAndWin);
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
 * pots (coins only) is refused on a Hold and Win game, whose rules count only its own landed coins;
 * there a preset's value-coin drops are left out too. `pots` sets how many pots it starts with
 * ({@link setOverlayPotCount}); absent ⇒ the preset's own.
 */
export function addPotsOverlay(
	doc: GameConfigDoc,
	id: PotsOverlayPresetId,
	pots?: number,
): AddOnResult {
	const result = mergePotsOverlay(doc, id, pots);
	if (!result.ok) return result;
	if (pots === undefined || pots === result.doc.coinOverlay?.pots?.length) {
		setOverlayPots(result.doc, potsOverlayOf(result.doc));
		return result;
	}
	if (pots === 0 && !primaryRespinMode(result.doc.modes)) {
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
	const potIds = new Set(kept.coinOverlay?.pots?.map((p) => p.id));
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
 *  that rather than at the preset's own pots. The preset's pots and drops are left on the overlay as
 *  they are, for the count to work on: the caller settles them (`setOverlayPots`). */
function mergePotsOverlay(doc: GameConfigDoc, id: PotsOverlayPresetId, pots?: number): AddOnResult {
	if (overlayDropsTokens(doc.coinOverlay)) {
		return { ok: false, reason: 'This project already has a pots overlay. Remove it first.' };
	}
	const next = structuredClone(doc);
	// A host's overlay keeps its style; a new one's is read from all it ends up holding.
	const keptStyle = next.coinOverlay?.style;
	const renamed = noRenames();
	const preset = potsOverlayPreset(id);
	// The preset's style replaces the host's only when the preset built or changed the Hold and Win
	// its pots start; over a bonus that already deals them the overlay keeps the style it had.
	let restyle = false;
	if (preset.holdAndWin && !primaryRespinMode(next.modes)) {
		const reason = mergeHoldAndWinBonus(next, preset.holdAndWin, renamed);
		if (reason) return { ok: false, reason };
		restyle = true;
	} else if (preset.holdAndWin) {
		const brought = bringPotSpecials(next, preset, pots, renamed);
		if (typeof brought === 'string') return { ok: false, reason: brought };
		restyle = brought;
	}
	const tokens = addSymbols(next, preset.tokens, renamed);
	// The preset's Hold and Win pots start the host's primary respin mode, whatever its id.
	const respinMode = holdAndWinModeId(next);
	const takenIds = new Set(primaryHoldAndWin(next)?.meters?.map((m) => m.id));
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
			bonus: pot.bonus.mode === HOLD_AND_WIN_MODE ? { ...pot.bonus, mode: respinMode } : pot.bonus,
		})),
		drops: {
			...preset.potsOverlay.drops,
			table: preset.potsOverlay.drops.table.map((entry) =>
				'pot' in entry ? { ...entry, pot: potIds[entry.pot] ?? entry.pot } : entry,
			),
		},
	};
	// The overlay drops tokens, so its Hold and Win is its bonus unless the base strips deal it.
	const asBonus = !baseGameDealsHoldAndWin(next);
	if (!(pots ?? overlay.pots.length) && !asBonus) {
		return {
			ok: false,
			reason:
				"This project's Hold and Win is its base game, started by coins landing on its reels, so dropped value coins would start nothing. Pick a preset with pots.",
		};
	}
	// For the same reason a preset's value-coin rows are left out there: only its pots fill.
	if (!asBonus) {
		overlay.drops.table = overlay.drops.table.filter((entry) => 'pot' in entry);
	}
	const { style: _style, ...body } = normalizeCoinOverlay({
		...next.coinOverlay,
		...overlay,
		style: undefined,
	}) ?? { style: undefined };
	next.coinOverlay = {
		...next.coinOverlay,
		style: restyle && preset.style ? preset.style : (keptStyle ?? inferCoinOverlayStyle(body)),
		pots: overlay.pots,
		drops: overlay.drops,
	};
	return { ok: true, doc: next, renamed };
}

/**
 * Bring onto `doc`'s primary respin mode's rules, in place, each special the preset's pots activate
 * that they lack (bonus-games Phase 8b): its respin rules from the preset's Hold and Win, its place
 * in the apply order, the symbol it lands as (renamed on a clash) and one cell of that symbol on each
 * of the mode's respin strips. Only the first `pots` pots count (the ones the overlay keeps). Rules
 * that already have every special are left exactly as they were. Returns whether it brought any, or
 * why it cannot.
 */
function bringPotSpecials(
	doc: GameConfigDoc,
	preset: PotsOverlayPreset,
	pots: number | undefined,
	renamed: AddOnRenames,
): string | boolean {
	const block = primaryRespinMode(doc.modes)!.holdAndWin;
	const kept = preset.potsOverlay.pots.slice(0, pots ?? preset.potsOverlay.pots.length);
	const wanted = [
		...new Set(kept.flatMap((p) => (p.bonus.activates ? [p.bonus.activates] : []))),
	].filter((kind) => !block.specials[kind]);
	if (!wanted.length || !preset.holdAndWin) return false;
	const gameType = holdAndWinGameType(doc);
	const strips = doc.paddingReels[gameType];
	if (!strips?.length) {
		return `This project's Hold and Win has no "${gameType}" strips for the ${wanted.join(', ')} to land on.`;
	}
	const bonus = holdAndWinBonus(preset.holdAndWin, doc);
	const symbols: Record<string, GameConfigSymbol> = {};
	for (const kind of wanted) {
		const {
			landsInBaseGame: _lands,
			instantCollectInBaseGame: _collects,
			...rules
		} = bonus.holdAndWin.specials[kind] as Record<string, unknown>;
		(block.specials as Record<string, unknown>)[kind] = structuredClone(rules);
		const role = SPECIAL_SYMBOL_ROLE[kind];
		const name = Object.keys(bonus.symbols).find((n) =>
			bonus.symbols[n].special_properties?.includes(role),
		);
		if (name) symbols[name] = bonus.symbols[name];
	}
	block.applyOrder = [
		...block.applyOrder,
		...bonus.holdAndWin.applyOrder.filter((kind) => wanted.includes(kind)),
		...wanted.filter((kind) => !bonus.holdAndWin.applyOrder.includes(kind)),
	];
	const names = Object.values(addSymbols(doc, symbols, renamed));
	doc.paddingReels[gameType] = strips.map((strip) => [
		...strip,
		...names.map((name) => ({ name })),
	]);
	return true;
}

/** A dictionary entry exactly as an add-on creates a token: tagged `meterSpecial`, paying nothing. */
const isBareToken = (symbol: GameConfigSymbol | undefined): boolean =>
	!!symbol &&
	!symbol.paytable?.length &&
	JSON.stringify(symbol.special_properties) === JSON.stringify(['meterSpecial']);

/** The symbols the overlay names: its pots' tokens and its meters' symbols. */
const overlaySymbols = (doc: GameConfigDoc): string[] => [
	...(doc.coinOverlay?.pots ?? []).map((p) => p.token),
	...(doc.coinOverlay?.meters ?? []).map((m) => m.symbol),
];

/** The symbols nothing but `tokens` names may be deleted with them: dealt by no strip, the token of
 *  no pot or Hold and Win meter. */
function dropUnusedTokens(doc: GameConfigDoc, tokens: Iterable<string>): void {
	const keep = new Set([...symbolsInPlay(doc), ...overlaySymbols(doc)]);
	for (const name of tokens) {
		if (!keep.has(name) && isBareToken(doc.symbols[name])) delete doc.symbols[name];
	}
}

/** The token for a new pot `id`: `POT_<ID>` when free, or when it is an unused symbol whose only
 *  role is `meterSpecial` (one a lower count kept because the author gave it a payout); else the
 *  first free suffix, reported in `renamed`. A Hold and Win role symbol is never taken over. */
function tokenForNewPot(doc: GameConfigDoc, id: string, renamed: AddOnRenames): string {
	const base = `POT_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
	const used = new Set([...symbolsInPlay(doc), ...overlaySymbols(doc)]);
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
		...(presetHoldAndWin('pots').meters ?? []).flatMap((m) => (m.activates ? [m.activates] : [])),
		...HOLD_AND_WIN_SPECIALS,
	]),
];

/** What a new pot starts: like the last pot's, with a pot to the primary respin mode taking the first
 *  special it configures ({@link potSpecials}) no other pot or meter activates. Without a pot to
 *  copy, the primary respin mode when the project has one, else its first bonus mode on the reels. */
function bonusForNewPot(doc: GameConfigDoc, like: OverlayPot | undefined): PotBonus | undefined {
	const block = primaryHoldAndWin(doc);
	const primary = primaryRespinMode(doc.modes)?.id;
	const mode =
		like?.bonus.mode ??
		primary ??
		resolveGameModes(doc).find((m) => m.id !== BASE_GAME_MODE && m.board === 'reels')?.id;
	if (!mode) return undefined;
	if (mode !== primary) return { ...like?.bonus, mode };
	const taken = new Set<HoldAndWinSpecial | undefined>([
		...(doc.coinOverlay?.pots ?? []).map((p) => p.bonus.activates),
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
 * only value coins, so it needs a Hold and Win that is the overlay's bonus (a Hold and Win game's own
 * counts only its landed coins) with a coin count trigger. `/config`'s pot count
 * and its last pot's × both ask here.
 */
export function zeroPotsRefusal(doc: GameConfigDoc): string | undefined {
	const block = primaryHoldAndWin(doc);
	if (!block) {
		return 'With no pots the overlay drops only value coins, which start a Hold and Win bonus — add one first, or keep at least one pot.';
	}
	if (!holdAndWinIsOverlayBonus(doc)) {
		return "This game's own Hold and Win is its base game, started by coins landing on its reels, so value coins alone start nothing — it needs at least one pot.";
	}
	if (!block.trigger.count) {
		return 'Value coins start this Hold and Win only through its coin count trigger, which it does not set — set one in the Coin overlay triggers first, or keep at least one pot.';
	}
	return undefined;
}

export function setOverlayPotCount(doc: GameConfigDoc, count: number): AddOnResult {
	if (!overlayDropsTokens(doc.coinOverlay)) {
		return { ok: false, reason: 'This project has no pots overlay.' };
	}
	if (!Number.isInteger(count) || count < 0 || count > MAX_OVERLAY_POTS) {
		return { ok: false, reason: `An overlay holds 0 to ${MAX_OVERLAY_POTS} pots.` };
	}
	const next = structuredClone(doc);
	// Edited in place, so every read below sees the pots as they are now.
	const overlay = next.coinOverlay as CoinOverlay & { pots: OverlayPot[]; drops: OverlayDrops };
	overlay.pots ??= [];
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
			...(primaryHoldAndWin(next)?.meters ?? []).map((m) => m.id),
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
		const trigger = primaryHoldAndWin(next)!.trigger.count!.min;
		const before = overlay.drops.maxPerSpin;
		if (before < trigger) {
			overlay.drops.maxPerSpin = trigger + 2;
			notes.push(
				`Most per spin raised from ${before} to ${trigger + 2}, so the ${trigger} coins the Hold and Win trigger needs can land on one spin. Lower it again if you add pots back.`,
			);
		}
	}
	setOverlayPots(next, potsOverlayOf(next));
	return { ok: true, doc: next, renamed, ...(notes.length ? { notes } : {}) };
}

/**
 * Take the Hold and Win BONUS out of `doc` in place: the primary respin mode and the routes to it
 * (`removeHoldAndWin`), its respin strips (unless another mode pads from them), and its record as an
 * imported bonus. Returns the symbols those strips dealt, for the caller to drop once nothing deals
 * them ({@link dropUnusedSymbols}).
 */
export function takeOutHoldAndWinBonus(doc: GameConfigDoc): Set<string> {
	const dealt = new Set<string>();
	const primary = primaryRespinMode(doc.modes);
	if (!primary) return dealt;
	const gameType = gameTypeForMode(primary);
	const shared = resolveGameModes(doc).some(
		(m) => m.id !== primary.id && m.id !== HOLD_AND_WIN_MODE && gameTypeForMode(m) === gameType,
	);
	if (!shared) {
		for (const name of symbolsInPlayForGameType(doc, gameType)) dealt.add(name);
		delete doc.paddingReels[gameType];
	}
	removeHoldAndWin(doc);
	const imports = doc.imports?.filter((i) => i.mode !== primary.id);
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
	const keep = new Set([...symbolsInPlay(doc), ...overlaySymbols(doc)]);
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
 * Take the pots overlay out of `doc`. When the primary respin game is the overlay's BONUS
 * ({@link holdAndWinIsOverlayBonus}) it goes too — without the overlay nothing could start it — with
 * its mode and its respin strips, unless another mode pads from those strips; so does a reels mode
 * imported for a pot to start (`importBonus`). A mode added on its own (`importRespinMode`,
 * `importSpinsMode`: `asMode`) stays, with the overlay's other routes to it. A symbol the removed
 * parts named is dropped only when no strip deals it any more and it is one an add-on makes (a bare
 * token, or a Hold and Win role symbol); everything else the project has is left exactly as it was.
 */
export function removePotsOverlay(doc: GameConfigDoc): GameConfigDoc {
	const next = structuredClone(doc);
	const overlay = potsOverlayOf(next);
	if (!overlay) return next;
	const tokens = new Set(overlay.pots.map((p) => p.token));
	const bonus = holdAndWinIsOverlayBonus(next) ? primaryRespinMode(next.modes)?.id : undefined;
	const bonusSymbols = bonus ? takeOutHoldAndWinBonus(next) : new Set<string>();
	// An imported reels mode is started only by a pot too, so it goes with the overlay.
	const reelsSymbols = (next.imports ?? [])
		.filter((i) => !i.asMode && i.mode !== bonus && i.mode !== HOLD_AND_WIN_MODE)
		.flatMap((i) => [...takeOutImportedReelsMode(next, i.mode)]);
	setOverlayPots(next, undefined);
	// Base-game coin values belong to the respin games they start; without one they go too.
	if (next.coinOverlay?.coins && !primaryRespinMode(next.modes)) {
		const { coins: _coins, ...rest } = next.coinOverlay;
		next.coinOverlay = rest;
		setOverlayPots(next, undefined);
	}
	dropUnusedSymbols(next, tokens, isBareToken);
	dropUnusedSymbols(next, bonusSymbols, isHoldAndWinSymbol);
	dropUnusedSymbols(next, reelsSymbols, () => true);
	return next;
}
