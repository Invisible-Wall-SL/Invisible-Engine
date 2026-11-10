import { untrack } from 'svelte';
import { backOut } from 'svelte/easing';
import { Tween } from 'svelte/motion';
import { respinCellKey, type HoldAndWinEnhancement } from 'engine-game';
import { enhancementDisplayName, formatWinText } from 'engine-layout';
import { symbolHoldAndWinRoles } from 'game-config';

import { bakedWinText } from '../editor-scenes';
import { getActiveGameConfig } from './gameConfig';
import { stateRespinBoard } from './stateRespinBoard.svelte';

/**
 * THE ENHANCEMENT DIALS of a collector bonus (`docs/design/hold-and-win-enhancements.md` §3.3, Phase
 * 14b — the partner's Fortune Vault Force 5, our Getting Hot). A feature that enters with
 * `enhancements` lights one dial per enhancement it drew; a boost or multiply hit lights its dial
 * while its beam flies, a miss shows the dial's X. The super bonus draws them all.
 *
 * KEYED OFF THE EVENTS: nothing here is set unless a feature arrives carrying `enhancements`, so a game
 * that never receives one never shows a dial (`enhancementsVisible` stays false).
 */

/** The four dials, in the order they stand above the board: Expand, Boost, Multiply, Respin. */
export const ENHANCEMENT_DIALS = ['extraRow', 'boost', 'multiply', 'extraRespins'] as const;
export type EnhancementDial = (typeof ENHANCEMENT_DIALS)[number];

/** `off` — not drawn this feature; `on` — drawn; `hit` — its beam is flying; `miss` — its X shows. */
export type EnhancementDialState = 'off' | 'on' | 'hit' | 'miss';

const offDials = (): Record<EnhancementDial, EnhancementDialState> => ({
	extraRow: 'off',
	boost: 'off',
	multiply: 'off',
	extraRespins: 'off',
});

export const stateEnhancements = $state({
	/** A feature with enhancements is open: its dials are drawn. */
	shown: false,
	/** It is the super bonus (every enhancement on). */
	superBonus: false,
	/** What the feature drew, as the server named it. */
	drawn: [] as HoldAndWinEnhancement[],
	dials: offDials(),
	/** The line a dial shows while it is hit ("+$5.00", "×3"). */
	captions: {} as Partial<Record<EnhancementDial, string>>,
	/** Each dial's beats so far — a part pulses when its count moves. */
	beats: { extraRow: 0, boost: 0, multiply: 0, extraRespins: 0 } as Record<EnhancementDial, number>,
});

export const isEnhancementDial = (kind: string): kind is EnhancementDial =>
	(ENHANCEMENT_DIALS as readonly string[]).includes(kind);

/** The dials a drawn set lights: each drawn one, every one for the super bonus. */
export const dialsLitBy = (drawn: readonly HoldAndWinEnhancement[]): EnhancementDial[] =>
	drawn.includes('superBonus')
		? [...ENHANCEMENT_DIALS]
		: ENHANCEMENT_DIALS.filter((d) => drawn.includes(d));

/** Is the open feature one that drew enhancements? */
export const isEnhancedFeature = (): boolean => stateEnhancements.shown;

/** Are the dials on screen: an enhanced feature with its board up. */
export const enhancementsVisible = (): boolean => stateEnhancements.shown && stateRespinBoard.shown;

/**
 * Open the dials for a feature that drew `drawn`. `lit` false leaves every dial off, for an entry
 * beat to light them one by one; a resume lights them at once.
 */
export const openEnhancements = (drawn: readonly HoldAndWinEnhancement[], { lit = true } = {}) => {
	stateEnhancements.shown = true;
	stateEnhancements.superBonus = drawn.includes('superBonus');
	stateEnhancements.drawn = [...drawn];
	stateEnhancements.captions = {};
	const dials = offDials();
	if (lit) for (const dial of dialsLitBy(drawn)) dials[dial] = 'on';
	stateEnhancements.dials = dials;
};

export const closeEnhancements = () => {
	stateEnhancements.shown = false;
	stateEnhancements.superBonus = false;
	stateEnhancements.drawn = [];
	stateEnhancements.dials = offDials();
	stateEnhancements.captions = {};
};

/** Put a dial on `state`; a hit carries its `caption`, every other state clears it. */
export const setDial = (dial: EnhancementDial, state: EnhancementDialState, caption?: string) => {
	stateEnhancements.dials[dial] = state;
	if (state === 'hit' && caption) stateEnhancements.captions[dial] = caption;
	else delete stateEnhancements.captions[dial];
	if (state !== 'off') stateEnhancements.beats[dial] += 1;
};

/** An enhancement's name, as the dial and the banners say it (Win Text `enhancementNames`). */
export const enhancementName = (kind: string): string =>
	enhancementDisplayName(bakedWinText(), kind);

/** The drawn enhancements, "BOOST · MULTIPLY" — the super bonus by its own name. */
export const enhancementsActiveText = (): string =>
	stateEnhancements.shown
		? (stateEnhancements.superBonus
				? ['superBonus']
				: ENHANCEMENT_DIALS.filter((d) => stateEnhancements.drawn.includes(d))
			)
				.map(enhancementName)
				.join(' · ')
		: '';

/** The banner as the feature opens — "BOOST · MULTIPLY ACTIVE". */
export const enhancementsActiveBannerText = (): string =>
	formatWinText(bakedWinText().feature.enhancementsActive, {
		enhancements: enhancementsActiveText(),
	});

export const superBonusText = (): string => formatWinText(bakedWinText().feature.superBonus);

/** A boost hit on its dial — "+$5.00". */
export const boostHitText = (amount: string): string =>
	formatWinText(bakedWinText().feature.boostHit, { amount });

/** A multiply hit on its dial — "×3". */
export const multiplyHitText = (factor: number): string =>
	formatWinText(bakedWinText().feature.multiplyHit, { count: factor });

/**
 * A dial's pulse: `current` jumps to `scale` and settles back to 1 each time the dial lights, hits
 * or misses. Call from a component's setup (it owns an effect); `scale` 1 keeps the dial still.
 */
export const createDialPulse = (kind: () => EnhancementDial, scale: () => number) => {
	const pulse = new Tween(1);
	let seen = untrack(() => stateEnhancements.beats[kind()]);
	$effect(() => {
		const beats = stateEnhancements.beats[kind()];
		if (beats === seen) return;
		seen = beats;
		const to = untrack(scale);
		if (to === 1) return;
		void pulse
			.set(to, { duration: 0 })
			.then(() => pulse.set(1, { duration: 380, easing: backOut }));
	});
	return pulse;
};

const DIAL_STATE_VALUES: Record<EnhancementDialState, number> = { off: 0, on: 1, hit: 2, miss: 3 };

/** A dial's state as a number, what a value binding gates each state's art on: 0 off, 1 on, 2 hit,
 *  3 miss — and 0 while no enhanced feature is up. */
export const dialStateValue = (dial: EnhancementDial): number =>
	enhancementsVisible() ? DIAL_STATE_VALUES[stateEnhancements.dials[dial]] : 0;

/**
 * What the collectors in view hold together (× total bet) — each collector's label as it reads now,
 * so it climbs with every coin a collect lands in one. 0 with no collector held, and for every
 * feature but a collector one.
 */
export const collectorsTotal = (): number => {
	if (!stateRespinBoard.shown) return 0;
	const symbols = getActiveGameConfig().symbols;
	return stateRespinBoard.held.reduce((sum, cell) => {
		if (!symbolHoldAndWinRoles(symbols[cell.symbol.name]).includes('collector')) return sum;
		const display = stateRespinBoard.heldDisplay[respinCellKey(cell.reel, cell.row)];
		const shown =
			display && 'tween' in display && display.field === 'value'
				? display.tween.current
				: (cell.symbol.value ?? 0);
		return sum + shown;
	}, 0);
};
