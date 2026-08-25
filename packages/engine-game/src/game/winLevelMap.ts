import { SECOND } from 'constants-shared/time';

// `threshold` — the win as a multiple of the total bet at/above which this tier is reached (the
// facade's coded ladder as data). It is the per-template SOURCE the Game Config defaults generator
// reads to seed a project's authored `winLevels`; the un-authored runtime path still gets its level
// from the facade's `computeWinLevel`, and the spike asserts the two agree so they cannot drift.
export const winLevelMap = {
	1: {
		level: 1,
		alias: 'zero',
		type: 'small',
		threshold: 0,
		text: null,
		presentDuration: 0,
		sound: { sfx: undefined, bgm: undefined },
		animation: undefined,
	},
	2: {
		level: 2,
		alias: 'standard',
		type: 'small',
		threshold: 0,
		text: null,
		presentDuration: 0.6 * SECOND,
		sound: { sfx: undefined, bgm: undefined },
		animation: undefined,
	},
	3: {
		level: 3,
		alias: 'small',
		type: 'small',
		threshold: 1.5,
		text: null,
		presentDuration: 1 * SECOND,
		sound: { sfx: undefined, bgm: undefined },
		animation: undefined,
	},
	4: {
		level: 4,
		alias: 'nice',
		type: 'medium',
		threshold: 3,
		text: null,
		presentDuration: 1.5 * SECOND,
		sound: { sfx: undefined, bgm: undefined },
		animation: undefined,
	},
	5: {
		level: 5,
		alias: 'substantial',
		type: 'medium',
		threshold: 6,
		text: null,
		presentDuration: 2.0 * SECOND,
		sound: { sfx: undefined, bgm: undefined },
		animation: undefined,
	},
	6: {
		level: 6,
		alias: 'big',
		type: 'big',
		threshold: 10,
		text: 'BIG WIN',
		presentDuration: 6 * SECOND,
		sound: { sfx: undefined, bgm: 'bgm_winlevel_big' },
		animation: { intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' },
	},
	7: {
		level: 7,
		alias: 'superwin',
		type: 'big',
		threshold: 20,
		text: 'SUPER WIN',
		presentDuration: 18 * SECOND,
		sound: { sfx: undefined, bgm: 'bgm_winlevel_superwin' },
		animation: { intro: 'super_win_intro', idle: 'super_win_idle', outro: 'super_win_exit' },
	},
	8: {
		level: 8,
		alias: 'mega',
		type: 'big',
		threshold: 40,
		text: 'MEGA WIN',
		presentDuration: 20 * SECOND,
		sound: { sfx: undefined, bgm: 'bgm_winlevel_mega' },
		animation: { intro: 'mega_win_intro', idle: 'mega_win_idle', outro: 'mega_win_exit' },
	},
	9: {
		level: 9,
		alias: 'epic',
		type: 'big',
		threshold: 70,
		text: 'EPIC WIN!',
		presentDuration: 26 * SECOND,
		sound: { sfx: undefined, bgm: 'bgm_winlevel_epic' },
		animation: { intro: 'epic_win_intro', idle: 'epic_win_idle', outro: 'epic_win_exit' },
	},
	10: {
		level: 10,
		alias: 'max',
		type: 'big',
		threshold: 120,
		text: 'MAX WIN',
		presentDuration: 32 * SECOND,
		sound: { sfx: undefined, bgm: 'bgm_winlevel_max' },
		animation: { intro: 'max_win_intro', idle: 'max_win_idle', outro: 'max_win_exit' },
	},
} as const;

export type WinLevelMap = typeof winLevelMap;
export type WinLevel = keyof typeof winLevelMap;

export type WinLevelType = 'small' | 'medium' | 'big';
export type WinLevelAnimation = { intro: string; idle: string; outro: string };

/**
 * The presentation record for one win tier. STRUCTURAL (not `WinLevelMap[WinLevel]`, the union of the
 * coded table's literal entries) so a CONFIG-authored tier — built at runtime from
 * `getActiveGameConfig().winLevels` in `gameConfig.ts` — also satisfies it. The coded `winLevelMap`
 * entries remain assignable (they are a subtype), so the un-authored path is unchanged. `spineKey` is
 * new + optional: a coded tier omits it (the component's default `bigwin` bundle), an authored tier
 * may point at its own.
 */
export type WinLevelData = {
	level: number;
	alias: string;
	type: WinLevelType;
	/** Win-as-bet-multiplier at/above which this tier is reached. The config-defaults generator reads
	 *  the coded ladder through it, and the big-win tap-to-step SEEKS the count to it
	 *  (`WinVisual.escalationBoundaries`) — so a tier built from an authored config carries it too
	 *  (`tierToWinLevelData`), which is what makes the two paths agree. Optional only because a tier
	 *  assembled outside those two builders has no ladder position to state. */
	threshold?: number;
	text: string | null;
	presentDuration: number;
	sound: { sfx: string | undefined; bgm: string | undefined };
	animation: WinLevelAnimation | undefined;
	spineKey?: string;
};

/** A tier's alias. Widened to `string` because an authored config names its own tiers — the coded
 *  table's aliases are just the built-in set, no longer the whole universe. */
export type WinLevelAlias = string;
