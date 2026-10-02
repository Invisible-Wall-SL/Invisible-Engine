import type { ComponentParam } from './types';

/**
 * THE WHEEL'S SKIN (Hold and Win Phase 12c, design `hold-and-win.md` §8) — the art params that
 * replace the coded pre-feature wheel's drawing, and the one reading of them the game's coded part
 * (`apps/lines` `HoldAndWinWheelArt`) uses.
 *
 * The face turns with the spin; the rim and the pointer stay put. The prize labels and the landed
 * outline keep their coded drawing, each behind its own switch: they come from the Game Config's
 * prizes and the server's segment, which no authored art can know. Unset, the wheel draws exactly
 * the coded wheel (parity).
 */
export const WHEEL_SKIN_PARAMS: ComponentParam[] = [
	{
		key: 'faceImage',
		kind: 'image',
		group: 'Wheel art',
		label: 'face, turning (replaces the coded segments)',
	},
	{ key: 'rimImage', kind: 'image', group: 'Wheel art', label: 'rim, fixed over the face' },
	{
		key: 'pointerImage',
		kind: 'image',
		group: 'Wheel art',
		label: 'pointer, tip down at the top (its own size)',
	},
	{
		key: 'artSize',
		kind: 'number',
		group: 'Wheel art',
		label: 'face and rim size (blank = the wheel)',
	},
	{ key: 'showLabels', kind: 'boolean', default: true, group: 'Labels', label: 'prize labels' },
	{ key: 'labelFontFamily', kind: 'string', group: 'Labels', label: 'font' },
	{ key: 'labelFill', kind: 'color', group: 'Labels', label: 'colour' },
	{ key: 'labelScale', kind: 'number', group: 'Labels', label: 'size × (blank = 1)' },
	{
		key: 'showLanded',
		kind: 'boolean',
		default: true,
		group: 'Labels',
		label: 'outline the landed segment',
	},
];

export interface WheelSkin {
	face?: string;
	rim?: string;
	pointer?: string;
	/** The face and rim box; absent ⇒ the wheel's diameter. */
	artSize?: number;
	showLabels: boolean;
	labelFontFamily?: string;
	labelFill?: number;
	labelScale: number;
	showLanded: boolean;
}

/**
 * Read the skin off an instance's resolved params. A cleared field (`''`) reads as unset, so it falls
 * back like an absent param instead of suppressing the coded drawing while drawing nothing.
 */
export function readWheelSkin(param: (key: string) => unknown): WheelSkin {
	const str = (key: string): string | undefined => {
		const value = param(key);
		return typeof value === 'string' && value !== '' ? value : undefined;
	};
	const positive = (key: string): number | undefined => {
		const value = param(key);
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
	};
	const fill = param('labelFill');
	return {
		face: str('faceImage'),
		rim: str('rimImage'),
		pointer: str('pointerImage'),
		artSize: positive('artSize'),
		showLabels: param('showLabels') !== false,
		labelFontFamily: str('labelFontFamily'),
		labelFill: typeof fill === 'number' && Number.isFinite(fill) ? fill : undefined,
		labelScale: positive('labelScale') ?? 1,
		showLanded: param('showLanded') !== false,
	};
}
