import { symbolsUsed, type GameConfigDoc } from 'game-config';
import { resolvedGameConfigFrom } from './gameConfigDefaults';

/**
 * The symbols every `/flow-v2` symbol picker offers: `symbolsUsed` of the config Invisible Game
 * Config opens with (`resolveGameConfig`'s precedence — the saved doc, else the kind's template), so
 * Flow lists exactly what `/config` has in play and `/symbols` shows. No config at all ⇒ `[]`, which
 * the editor treats as "unknown" (`withSymbols`). `check:flow-symbols-follow-config` pins it.
 */
export function flowSymbolsFrom(
	stored: { doc: GameConfigDoc | null; etag: string | null },
	gameType: string | undefined,
): string[] {
	const { doc } = resolvedGameConfigFrom(stored, gameType);
	return doc ? symbolsUsed(doc) : [];
}
