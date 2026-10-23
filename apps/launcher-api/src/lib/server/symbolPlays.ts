import { SYMBOL_STATES, symbolStatesPlayed, type SymbolPlayFacts } from 'engine-layout';
import { symbolStateDonor } from 'engine-game/src/game/symbolCell';
import {
	gameTypeForMode,
	resolveCascade,
	resolveExpandingSymbol,
	resolveMeters,
	resolveReelBehaviour,
	respinModeDecls,
	symbolsInPlayForGameType,
	symbolsUsed,
	symbolUses,
	type GameConfigDoc,
} from 'game-config';

/**
 * What the board knows about each symbol `doc` can show — the facts `symbolStatesPlayed`
 * (engine-layout) narrows a symbol's states with. `roles` gives a symbol's Hold and Win roles: the
 * Symbols page passes them only on a project with the respin feature.
 */
export function symbolPlayFacts(
	doc: GameConfigDoc,
	roles: (name: string) => readonly string[],
): Record<string, SymbolPlayFacts> {
	const uses = symbolUses(doc);
	// A coin board has no reels: its base game is dealt onto the respin board.
	const respinTypes = new Set(respinModeDecls(doc).map(gameTypeForMode));
	const onReels = new Set(
		doc.coinBoard
			? []
			: Object.keys(doc.paddingReels)
					.filter((gameType) => !respinTypes.has(gameType))
					.flatMap((gameType) => symbolsInPlayForGameType(doc, gameType)),
	);
	const meters = resolveMeters(doc);
	const symbolsOf = (source: string) =>
		new Set(meters.filter((meter) => meter.source === source).map((meter) => meter.symbol));
	const tokens = symbolsOf('overlay');
	const fillers = symbolsOf('symbol');
	return Object.fromEntries(
		symbolsUsed(doc).map((name) => [
			name,
			{
				dealt: uses[name] === 'inPlay',
				onReels: onReels.has(name),
				token: tokens.has(name),
				holdAndWinRoles: roles(name),
				fillsMeter: fillers.has(name),
			},
		]),
	);
}

/** Does the board take its symbols off — a cascade, or a swap that clears before the next board? */
export const clearsBoard = (doc: GameConfigDoc | null | undefined): boolean =>
	resolveCascade(doc ?? undefined) || resolveReelBehaviour(doc ?? undefined).clearBoard;

/**
 * The states a scaffold binds for a symbol: the ones the game plays for it, and the ones those
 * borrow when left empty (`symbolStateDonor`) — a token's `win`, which its Fly to meter draws. A new
 * project then carries no art on a state the game never draws for that symbol.
 */
export function seededStates(doc: GameConfigDoc, facts: SymbolPlayFacts): ReadonlySet<string> {
	const played = symbolStatesPlayed(SYMBOL_STATES, facts, {
		bookReveal: resolveExpandingSymbol(doc) !== undefined,
		clearsBoard: clearsBoard(doc),
	});
	return new Set([...played, ...played.flatMap((state) => symbolStateDonor(state) ?? [])]);
}
