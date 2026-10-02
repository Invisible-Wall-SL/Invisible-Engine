/**
 * The closed set of `$engine.*` keys the lines reader answers (`linesEngineReader`, the bounded
 * vocabulary, §11.4). Plain data, so a headless gate can hold every template vocabulary's values
 * and collections to it; the reader is typed against it, so a key listed here without a read is a
 * compile error.
 */
export const LINES_ENGINE_KEYS = [
	'balance',
	'win',
	'totalWin',
	'bet',
	'gameType',
	'isFreeGame',
	'activeMode',
	'modeDepth',
	'queuedModes',
	'freeSpinsRemaining',
	'freeSpinsTotal',
	'autoSpinsRemaining',
	'isAutoSpinning',
	'reels',
	'respinsLeft',
	'respinTotal',
	'featureWorth',
	'activeModifiers',
	'jackpot.mini',
	'jackpot.minor',
	'jackpot.major',
	'jackpot.grand',
	'platformJackpot.mini',
	'platformJackpot.minor',
	'platformJackpot.major',
	'platformJackpot.grand',
] as const;

export type LinesEngineKey = (typeof LINES_ENGINE_KEYS)[number];
