import type { ComponentParam } from './types';

/**
 * THE POT METER'S SKIN (Hold and Win Phase 12c, design `hold-and-win.md` §8) — the art params that
 * replace the coded pot's drawing, and the one reading of them that both the game's coded part
 * (`apps/lines` `HoldAndWinPot`) and the editor preview use, so the editor draws what the game draws.
 *
 * Every param is per placed instance (red / blue / green each carry their own art without forking
 * the def). Any pot image set replaces the coded bar (its track, fill and border) as a whole; the
 * labels and the motion keep their coded look until their own params are set. Unset, the pot draws
 * exactly the coded bar (parity).
 *
 * No value import here: `scripts/verify-pot-meter-mount.mjs` loads this file on its own.
 */

/** The edge a fill image grows from, named as the value bindings name a `fill` reveal. */
export const POT_FILL_DIRECTIONS = ['right', 'left', 'up', 'down'] as const;
export type PotFillDirection = (typeof POT_FILL_DIRECTIONS)[number];

/** The pot-body image per size stage: stage N shows the highest stage image at or below N. */
export const POT_STAGE_IMAGE_KEYS = ['stageImage1', 'stageImage2', 'stageImage3'] as const;

/** The coded pot's motion: the growth per size stage reached, and the pulse peak on a fill. */
export const POT_STAGE_GROWTH = 0.1;
export const POT_PULSE_SCALE = 1.3;

/** The share of the fill the editor previews (the game reveals the meter's own level). */
export const POT_PREVIEW_FILL_SHARE = 0.6;

export const POT_SKIN_PARAMS: ComponentParam[] = [
	{
		key: 'backgroundImage',
		kind: 'image',
		group: 'Pot art',
		label: 'pot (replaces the coded bar)',
	},
	{ key: 'fillImage', kind: 'image', group: 'Pot art', label: 'fill (revealed by the level)' },
	{
		key: 'fillDirection',
		kind: 'string',
		default: 'right',
		options: [...POT_FILL_DIRECTIONS],
		group: 'Pot art',
		label: 'fill grows towards',
	},
	{ key: 'frameImage', kind: 'image', group: 'Pot art', label: 'frame (over the fill)' },
	...POT_STAGE_IMAGE_KEYS.map((key, index): ComponentParam => ({
		key,
		kind: 'image',
		group: 'Pot art',
		label: `pot from size stage ${index + 1}`,
	})),
	{ key: 'artWidth', kind: 'number', group: 'Pot art', label: 'width (blank = image size)' },
	{ key: 'artHeight', kind: 'number', group: 'Pot art', label: 'height (blank = image size)' },
	{ key: 'showLevel', kind: 'boolean', default: true, group: 'Label', label: 'level ("RED 3/12")' },
	{
		key: 'showActivates',
		kind: 'boolean',
		default: true,
		group: 'Label',
		label: 'what a full pot activates',
	},
	{ key: 'labelFontFamily', kind: 'string', group: 'Label', label: 'font' },
	{ key: 'labelFill', kind: 'color', group: 'Label', label: 'colour' },
	{ key: 'labelScale', kind: 'number', group: 'Label', label: 'size × (blank = 1)' },
	{
		key: 'stageGrowth',
		kind: 'number',
		default: POT_STAGE_GROWTH,
		group: 'Motion',
		label: 'growth per size stage',
	},
	{
		key: 'pulseScale',
		kind: 'number',
		default: POT_PULSE_SCALE,
		group: 'Motion',
		label: 'pulse on a fill (1 = none)',
	},
];

export interface PotSkin {
	background?: string;
	/** {@link POT_STAGE_IMAGE_KEYS} in order; a gap falls back to the stage below it. */
	stages: (string | undefined)[];
	fill?: string;
	fillDirection: PotFillDirection;
	frame?: string;
	width?: number;
	height?: number;
	showLevel: boolean;
	showActivates: boolean;
	labelFontFamily?: string;
	labelFill?: number;
	labelScale: number;
	stageGrowth: number;
	pulseScale: number;
}

/**
 * Read the skin off an instance's resolved params. A cleared field (`''`) reads as unset, so it falls
 * back like an absent param instead of suppressing the coded drawing while drawing nothing.
 */
export function readPotSkin(param: (key: string) => unknown): PotSkin {
	const str = (key: string): string | undefined => {
		const value = param(key);
		return typeof value === 'string' && value !== '' ? value : undefined;
	};
	const num = (key: string): number | undefined => {
		const value = param(key);
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	};
	const bool = (key: string): boolean => param(key) !== false;
	const direction = str('fillDirection');
	return {
		background: str('backgroundImage'),
		stages: POT_STAGE_IMAGE_KEYS.map(str),
		fill: str('fillImage'),
		fillDirection: (POT_FILL_DIRECTIONS as readonly string[]).includes(direction ?? '')
			? (direction as PotFillDirection)
			: 'right',
		frame: str('frameImage'),
		width: positive(num('artWidth')),
		height: positive(num('artHeight')),
		showLevel: bool('showLevel'),
		showActivates: bool('showActivates'),
		labelFontFamily: str('labelFontFamily'),
		labelFill: num('labelFill'),
		labelScale: positive(num('labelScale')) ?? 1,
		stageGrowth: Math.max(0, num('stageGrowth') ?? POT_STAGE_GROWTH),
		pulseScale: positive(num('pulseScale')) ?? POT_PULSE_SCALE,
	};
}

const positive = (value: number | undefined): number | undefined =>
	value !== undefined && value > 0 ? value : undefined;

/** Whether any pot image is set — the coded bar then gives way to the art as a whole. */
export function potHasArt(skin: PotSkin): boolean {
	return !!(skin.background || skin.fill || skin.frame || skin.stages.some(Boolean));
}

/** The pot body at size stage `stage` (0 = below the first stage). */
export function potBodyImage(skin: PotSkin, stage: number): string | undefined {
	for (let s = Math.min(stage, skin.stages.length); s >= 1; s--) {
		const image = skin.stages[s - 1];
		if (image) return image;
	}
	return skin.background;
}

/** How much of the fill shows: the level over the meter's max, kept inside 0..1. */
export function potFillShare(level: number, max: number): number {
	if (!(max > 0) || !Number.isFinite(level)) return 0;
	return Math.min(1, Math.max(0, level / max));
}

/**
 * The rect a centred `width` × `height` fill image shows at `share`, grown from the edge opposite
 * `direction` — `up` grows from the bottom, so a pot of liquid rises.
 */
export function potFillRect(
	width: number,
	height: number,
	share: number,
	direction: PotFillDirection,
): { x: number; y: number; width: number; height: number } {
	const left = -width / 2;
	const top = -height / 2;
	const s = Math.min(1, Math.max(0, share));
	switch (direction) {
		case 'left':
			return { x: left + width * (1 - s), y: top, width: width * s, height };
		case 'up':
			return { x: left, y: top + height * (1 - s), width, height: height * s };
		case 'down':
			return { x: left, y: top, width, height: height * s };
		default:
			return { x: left, y: top, width: width * s, height };
	}
}
