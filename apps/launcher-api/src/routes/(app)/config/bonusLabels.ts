import type { HoldAndWinSpecial, HoldAndWinSymbolRole } from 'game-config';

/** How `/config`'s bonus sections name a Hold and Win symbol role and a special. */
export const ROLE_LABELS: Record<HoldAndWinSymbolRole, string> = {
	coin: 'coin',
	jackpot: 'jackpot',
	collector: 'collector',
	coinMultiplier: 'multiplier',
	payer: 'payer',
	mystery: 'mystery',
	meterSpecial: 'meter special',
	blank: 'blank',
	addRespins: 'add respins',
	upgrade: 'upgrade',
	unlock: 'unlock (opens a row)',
};

export const SPECIAL_LABELS: Record<HoldAndWinSpecial, string> = {
	collector: 'Collector',
	multiplier: 'Multiplier',
	payer: 'Payer',
	mystery: 'Mystery',
	addRespins: 'Add respins',
	upgrade: 'Upgrade',
};

type NumberInput = Event & { currentTarget: HTMLInputElement };

/** A number box's handler that ignores a blank / half-typed value, so a keystroke never collapses
 *  a field to 0 or NaN. */
export const num =
	(apply: (n: number) => void, integer = false) =>
	(e: NumberInput) => {
		const n = e.currentTarget.valueAsNumber;
		if (Number.isFinite(n)) apply(integer ? Math.floor(n) : n);
	};
