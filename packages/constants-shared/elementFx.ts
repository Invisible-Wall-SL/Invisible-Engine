/**
 * ELEMENT FX — the ONE catalog of effects that play ON an element: a rig, a flipbook, a particle
 * effect, an image, a text, a component, a whole screen or the reels. Where the flow's
 * `cameraEffect` (`constants-shared/camera`) moves the whole game, an Element FX moves, bends,
 * lights or breaks one thing.
 *
 * Dependency-free on purpose: the Scene Editor (its kind picker and per-kind param rows), the flow
 * vocabulary (its `ElementFxKind` dropdown) and the runtime (`pixi-svelte`'s `elementFx`) all read
 * this list, so none of them can offer an effect the others do not know. Adding a kind = one entry
 * here + its implementation in `pixi-svelte/src/lib/elementFx/kinds.ts`, whose table is typed
 * `Record<ElementFxKind, …>` and so fails the type check until the kind is implemented.
 *
 * The authored shape ({@link ElementFxEntry}) rides inside the layout doc (a node's or a screen's
 * `elementFx` list), which already ships: no new asset class (rule 8).
 */

/** `custom`: an effect authored in Invisible Shader Graph ({@link CustomElementFx}). */
export type ElementFxCategory = 'motion' | '3d' | 'distort' | 'light' | 'break' | 'custom';

/**
 * How a kind behaves over one play.
 * - `emphasis` plays and returns to rest.
 * - `loop` is built to repeat seamlessly (a hover, a wave, a pulsing glow); it is the natural pick
 *   for an `always` trigger, and fades in and out when played a set number of times.
 * - `enter` starts hidden and ends at rest; while its delay runs the element stays hidden.
 * - `exit` ends hidden and STAYS hidden until the effect is stopped or an `enter` kind plays.
 */
export const ELEMENT_FX_PHASES = ['emphasis', 'loop', 'enter', 'exit'] as const;

export type ElementFxPhase = (typeof ELEMENT_FX_PHASES)[number];

export type ElementFxParamSpec =
	| {
			id: string;
			label: string;
			kind: 'number';
			default: number;
			min: number;
			max: number;
			step?: number;
			unit?: string;
			note?: string;
	  }
	| { id: string; label: string; kind: 'color'; default: string; note?: string }
	| { id: string; label: string; kind: 'bool'; default: boolean; note?: string }
	| {
			id: string;
			label: string;
			kind: 'choice';
			default: string;
			options: readonly string[];
			note?: string;
	  };

export interface ElementFxKindSpec {
	kind: string;
	label: string;
	category: ElementFxCategory;
	phase: ElementFxPhase;
	/** One play's length when the entry leaves `durationMs` unset. */
	durationMs: number;
	description: string;
	params: readonly ElementFxParamSpec[];
}

const COLOR = (id: string, label: string, value: string): ElementFxParamSpec => ({
	id,
	label,
	kind: 'color',
	default: value,
});

export const ELEMENT_FX = [
	// --- motion: the element's own transform, so it works on anything and costs no GPU pass ---
	{
		kind: 'shake',
		label: 'Shake',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 500,
		description: 'A decaying rattle.',
		params: [
			{ id: 'axis', label: 'Axis', kind: 'choice', default: 'both', options: ['both', 'x', 'y'] },
			{ id: 'frequency', label: 'Speed', kind: 'number', default: 14, min: 2, max: 40, unit: 'Hz' },
		],
	},
	{
		kind: 'wobble',
		label: 'Wobble',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Rocks left and right around its centre, settling.',
		params: [
			{ id: 'angle', label: 'Angle', kind: 'number', default: 12, min: 1, max: 60, unit: '°' },
			{ id: 'cycles', label: 'Rocks', kind: 'number', default: 3, min: 1, max: 10, step: 1 },
		],
	},
	{
		kind: 'pulse',
		label: 'Pulse',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 600,
		description: 'Swells and shrinks back once.',
		params: [
			{ id: 'scale', label: 'Scale', kind: 'number', default: 1.15, min: 1.01, max: 2, step: 0.01 },
		],
	},
	{
		kind: 'heartbeat',
		label: 'Heartbeat',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Two quick beats, the second softer.',
		params: [
			{ id: 'scale', label: 'Scale', kind: 'number', default: 1.15, min: 1.01, max: 2, step: 0.01 },
		],
	},
	{
		kind: 'jelly',
		label: 'Jelly',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Squashes and stretches on its base like jelly.',
		params: [
			{
				id: 'squash',
				label: 'Squash',
				kind: 'number',
				default: 0.2,
				min: 0.02,
				max: 0.6,
				step: 0.01,
			},
			{ id: 'cycles', label: 'Wobbles', kind: 'number', default: 3, min: 1, max: 10, step: 1 },
		],
	},
	{
		kind: 'bounce',
		label: 'Bounce',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 1000,
		description: 'Hops up and lands with a squash, each bounce lower.',
		params: [
			{
				id: 'height',
				label: 'Height',
				kind: 'number',
				default: 0.3,
				min: 0.02,
				max: 2,
				step: 0.01,
				note: 'In element heights.',
			},
			{ id: 'bounces', label: 'Bounces', kind: 'number', default: 2, min: 1, max: 5, step: 1 },
		],
	},
	{
		kind: 'spin',
		label: 'Spin',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Turns on itself in the screen plane.',
		params: [
			{
				id: 'turns',
				label: 'Turns',
				kind: 'number',
				default: 1,
				min: -5,
				max: 5,
				step: 0.25,
				note: 'Negative turns spin anticlockwise.',
			},
		],
	},
	{
		kind: 'swing',
		label: 'Swing',
		category: 'motion',
		phase: 'emphasis',
		durationMs: 1600,
		description: 'Swings like a sign hanging from its top edge.',
		params: [
			{ id: 'angle', label: 'Angle', kind: 'number', default: 15, min: 1, max: 60, unit: '°' },
			{ id: 'cycles', label: 'Swings', kind: 'number', default: 3, min: 1, max: 10, step: 1 },
		],
	},
	{
		kind: 'float',
		label: 'Float',
		category: 'motion',
		phase: 'loop',
		durationMs: 2400,
		description: 'Hovers gently up and down.',
		params: [
			{
				id: 'distance',
				label: 'Distance',
				kind: 'number',
				default: 0.05,
				min: 0.005,
				max: 0.5,
				step: 0.005,
				note: 'In element heights.',
			},
			{ id: 'tilt', label: 'Tilt', kind: 'number', default: 2, min: 0, max: 20, unit: '°' },
		],
	},
	{
		kind: 'popIn',
		label: 'Pop in',
		category: 'motion',
		phase: 'enter',
		durationMs: 450,
		description: 'Grows from nothing with an overshoot.',
		params: [
			{
				id: 'overshoot',
				label: 'Overshoot',
				kind: 'number',
				default: 0.15,
				min: 0,
				max: 0.6,
				step: 0.01,
			},
		],
	},
	{
		kind: 'popOut',
		label: 'Pop out',
		category: 'motion',
		phase: 'exit',
		durationMs: 400,
		description: 'Swells, then shrinks away to nothing.',
		params: [
			{
				id: 'overshoot',
				label: 'Swell',
				kind: 'number',
				default: 0.1,
				min: 0,
				max: 0.6,
				step: 0.01,
			},
		],
	},
	{
		kind: 'slamIn',
		label: 'Slam in',
		category: 'motion',
		phase: 'enter',
		durationMs: 700,
		description: 'Drops in from above and lands hard: squash and a rattle.',
		params: [
			{
				id: 'height',
				label: 'Drop',
				kind: 'number',
				default: 0.8,
				min: 0,
				max: 4,
				step: 0.05,
				note: 'In element heights.',
			},
			{
				id: 'squash',
				label: 'Squash',
				kind: 'number',
				default: 0.22,
				min: 0,
				max: 0.6,
				step: 0.01,
			},
		],
	},
	{
		kind: 'fadeIn',
		label: 'Fade in',
		category: 'motion',
		phase: 'enter',
		durationMs: 400,
		description: 'Fades up from invisible.',
		params: [],
	},
	{
		kind: 'fadeOut',
		label: 'Fade out',
		category: 'motion',
		phase: 'exit',
		durationMs: 400,
		description: 'Fades away and stays hidden.',
		params: [],
	},

	// --- 3D: a perspective pass, so a playing rig keeps animating while it turns ---
	{
		kind: 'flipX',
		label: 'Flip (3D, sideways)',
		category: '3d',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Flips on itself around its vertical axis, like a coin.',
		params: [
			{ id: 'turns', label: 'Turns', kind: 'number', default: 1, min: -5, max: 5, step: 0.5 },
			{
				id: 'perspective',
				label: 'Perspective',
				kind: 'number',
				default: 0.5,
				min: 0,
				max: 1,
				step: 0.05,
			},
			{ id: 'shade', label: 'Shade the far side', kind: 'bool', default: true },
		],
	},
	{
		kind: 'flipY',
		label: 'Flip (3D, over)',
		category: '3d',
		phase: 'emphasis',
		durationMs: 900,
		description: 'Flips on itself around its horizontal axis, top over bottom.',
		params: [
			{ id: 'turns', label: 'Turns', kind: 'number', default: 1, min: -5, max: 5, step: 0.5 },
			{
				id: 'perspective',
				label: 'Perspective',
				kind: 'number',
				default: 0.5,
				min: 0,
				max: 1,
				step: 0.05,
			},
			{ id: 'shade', label: 'Shade the far side', kind: 'bool', default: true },
		],
	},
	{
		kind: 'bounce3D',
		label: 'Bounce 3D',
		category: '3d',
		phase: 'emphasis',
		durationMs: 1100,
		description: 'Jumps out of the screen at you, tilting, and settles back with a bounce.',
		params: [
			{ id: 'height', label: 'Lift', kind: 'number', default: 0.4, min: 0.05, max: 1, step: 0.01 },
			{ id: 'tilt', label: 'Tilt', kind: 'number', default: 18, min: 0, max: 45, unit: '°' },
			{ id: 'bounces', label: 'Bounces', kind: 'number', default: 2, min: 1, max: 5, step: 1 },
		],
	},
	{
		kind: 'sphericon',
		label: 'Sphericon',
		category: '3d',
		phase: 'emphasis',
		durationMs: 2400,
		description:
			'Folds into a spinning sphericon wrapped in its own art — two half double-cones joined with a quarter turn — rolls, and unfolds back.',
		params: [
			{ id: 'turns', label: 'Rolls', kind: 'number', default: 1, min: 0.5, max: 4, step: 0.5 },
			{ id: 'tilt', label: 'Tilt', kind: 'number', default: 25, min: 0, max: 70, unit: '°' },
			{ id: 'shade', label: 'Light it', kind: 'bool', default: true },
		],
	},
	{
		kind: 'tilt3D',
		label: 'Tilt 3D',
		category: '3d',
		phase: 'loop',
		durationMs: 3000,
		description: 'Sways in perspective, as if held up and turned in the light.',
		params: [
			{ id: 'angle', label: 'Angle', kind: 'number', default: 14, min: 1, max: 45, unit: '°' },
		],
	},

	// --- distort: the element's pixels bent in place ---
	{
		kind: 'waveX',
		label: 'Wave (X)',
		category: 'distort',
		phase: 'loop',
		durationMs: 2000,
		description: 'Rows slide left and right in a travelling wave.',
		params: [
			{
				id: 'amplitude',
				label: 'Amplitude',
				kind: 'number',
				default: 0.03,
				min: 0.002,
				max: 0.25,
				step: 0.001,
				note: 'In element widths.',
			},
			{
				id: 'wavelength',
				label: 'Wavelength',
				kind: 'number',
				default: 0.5,
				min: 0.05,
				max: 3,
				step: 0.01,
				note: 'In element heights.',
			},
			{
				id: 'speed',
				label: 'Speed',
				kind: 'number',
				default: 1,
				min: -6,
				max: 6,
				step: 0.1,
				unit: 'waves/s',
			},
		],
	},
	{
		kind: 'waveY',
		label: 'Wave (Y)',
		category: 'distort',
		phase: 'loop',
		durationMs: 2000,
		description: 'Columns slide up and down in a travelling wave.',
		params: [
			{
				id: 'amplitude',
				label: 'Amplitude',
				kind: 'number',
				default: 0.03,
				min: 0.002,
				max: 0.25,
				step: 0.001,
				note: 'In element heights.',
			},
			{
				id: 'wavelength',
				label: 'Wavelength',
				kind: 'number',
				default: 0.5,
				min: 0.05,
				max: 3,
				step: 0.01,
				note: 'In element widths.',
			},
			{
				id: 'speed',
				label: 'Speed',
				kind: 'number',
				default: 1,
				min: -6,
				max: 6,
				step: 0.1,
				unit: 'waves/s',
			},
		],
	},
	{
		kind: 'flag',
		label: 'Flag',
		category: 'distort',
		phase: 'loop',
		durationMs: 2000,
		description: 'Ripples like a flag pinned at its left edge, with light on the folds.',
		params: [
			{
				id: 'amplitude',
				label: 'Amplitude',
				kind: 'number',
				default: 0.05,
				min: 0.005,
				max: 0.25,
				step: 0.001,
				note: 'In element heights.',
			},
			{
				id: 'wavelength',
				label: 'Wavelength',
				kind: 'number',
				default: 0.6,
				min: 0.1,
				max: 3,
				step: 0.01,
				note: 'In element widths.',
			},
			{
				id: 'speed',
				label: 'Speed',
				kind: 'number',
				default: 1.2,
				min: -6,
				max: 6,
				step: 0.1,
				unit: 'waves/s',
			},
		],
	},
	{
		kind: 'twist',
		label: 'Twist',
		category: 'distort',
		phase: 'emphasis',
		durationMs: 1200,
		description: 'Swirls around its centre and unwinds.',
		params: [
			{
				id: 'angle',
				label: 'Angle',
				kind: 'number',
				default: 200,
				min: -1080,
				max: 1080,
				unit: '°',
			},
			{
				id: 'radius',
				label: 'Radius',
				kind: 'number',
				default: 0.8,
				min: 0.1,
				max: 2,
				step: 0.01,
				note: 'In half-diagonals.',
			},
		],
	},
	{
		kind: 'curl',
		label: 'Curl',
		category: 'distort',
		phase: 'emphasis',
		durationMs: 1600,
		description: 'A corner curls up like a page and lays back down.',
		params: [
			{
				id: 'corner',
				label: 'Corner',
				kind: 'choice',
				default: 'bottomRight',
				options: ['bottomRight', 'bottomLeft', 'topRight', 'topLeft'],
			},
			{
				id: 'amount',
				label: 'Peel',
				kind: 'number',
				default: 0.4,
				min: 0.05,
				max: 1,
				step: 0.01,
				note: '1 peels the whole element off.',
			},
			{
				id: 'radius',
				label: 'Roll',
				kind: 'number',
				default: 0.1,
				min: 0.02,
				max: 0.4,
				step: 0.01,
				note: 'The curl radius, in diagonals.',
			},
		],
	},
	{
		kind: 'ripple',
		label: 'Ripple',
		category: 'distort',
		phase: 'emphasis',
		durationMs: 1000,
		description: 'A shock ring spreads out from the centre.',
		params: [
			{
				id: 'amplitude',
				label: 'Amplitude',
				kind: 'number',
				default: 0.04,
				min: 0.005,
				max: 0.2,
				step: 0.001,
				note: 'In element sizes.',
			},
			{
				id: 'width',
				label: 'Ring width',
				kind: 'number',
				default: 0.15,
				min: 0.02,
				max: 0.6,
				step: 0.01,
				note: 'In element sizes.',
			},
		],
	},
	{
		kind: 'bulge',
		label: 'Bulge',
		category: 'distort',
		phase: 'emphasis',
		durationMs: 700,
		description: 'Puffs out from the centre like a lens, then flattens (negative pinches in).',
		params: [
			{
				id: 'strength',
				label: 'Strength',
				kind: 'number',
				default: 0.6,
				min: -1,
				max: 1,
				step: 0.01,
			},
			{
				id: 'radius',
				label: 'Radius',
				kind: 'number',
				default: 0.7,
				min: 0.1,
				max: 2,
				step: 0.01,
				note: 'In half-diagonals.',
			},
		],
	},
	{
		kind: 'melt',
		label: 'Melt',
		category: 'distort',
		phase: 'exit',
		durationMs: 2000,
		description:
			'Melts like wax: the top sinks and the rest runs down in uneven drips, then it is gone.',
		params: [
			{
				id: 'length',
				label: 'Drip length',
				kind: 'number',
				default: 0.8,
				min: 0.2,
				max: 2,
				step: 0.05,
				note: 'In element heights.',
			},
			{ id: 'drips', label: 'Drips', kind: 'number', default: 7, min: 2, max: 24, step: 1 },
			COLOR('color', 'Heat colour', '#ff6a00'),
			{
				id: 'heat',
				label: 'Heat',
				kind: 'number',
				default: 0,
				min: 0,
				max: 1,
				step: 0.05,
				note: 'How much the running part glows in the heat colour.',
			},
		],
	},

	// --- light / colour ---
	{
		kind: 'glow',
		label: 'Glow',
		category: 'light',
		phase: 'loop',
		durationMs: 1600,
		description: 'A coloured glow around the edges that breathes in and out.',
		params: [
			COLOR('color', 'Colour', '#ffd75e'),
			{
				id: 'distance',
				label: 'Reach',
				kind: 'number',
				default: 14,
				min: 2,
				max: 40,
				step: 1,
				unit: 'px',
			},
			{
				id: 'strength',
				label: 'Strength',
				kind: 'number',
				default: 3,
				min: 0.2,
				max: 10,
				step: 0.1,
			},
		],
	},
	{
		kind: 'outline',
		label: 'Outline',
		category: 'light',
		phase: 'loop',
		durationMs: 1600,
		description: 'A coloured outline that pulses.',
		params: [
			COLOR('color', 'Colour', '#ffffff'),
			{
				id: 'thickness',
				label: 'Thickness',
				kind: 'number',
				default: 3,
				min: 1,
				max: 12,
				step: 0.5,
				unit: 'px',
			},
		],
	},
	{
		kind: 'shine',
		label: 'Shine',
		category: 'light',
		phase: 'emphasis',
		durationMs: 900,
		description: 'A bright band sweeps across, only where the element is.',
		params: [
			COLOR('color', 'Colour', '#ffffff'),
			{ id: 'width', label: 'Width', kind: 'number', default: 0.22, min: 0.03, max: 1, step: 0.01 },
			{ id: 'angle', label: 'Angle', kind: 'number', default: 25, min: -90, max: 90, unit: '°' },
			{
				id: 'strength',
				label: 'Strength',
				kind: 'number',
				default: 0.85,
				min: 0.05,
				max: 2,
				step: 0.01,
			},
		],
	},
	{
		kind: 'flash',
		label: 'Flash',
		category: 'light',
		phase: 'emphasis',
		durationMs: 300,
		description: 'Lights up in a colour and fades back.',
		params: [
			COLOR('color', 'Colour', '#ffffff'),
			{ id: 'peak', label: 'Peak', kind: 'number', default: 0.85, min: 0.05, max: 1, step: 0.01 },
		],
	},
	{
		kind: 'hueCycle',
		label: 'Rainbow',
		category: 'light',
		phase: 'loop',
		durationMs: 3000,
		description: 'Cycles its colours round the rainbow.',
		params: [
			{ id: 'cycles', label: 'Cycles', kind: 'number', default: 1, min: 1, max: 8, step: 1 },
		],
	},
	{
		kind: 'chromatic',
		label: 'Chromatic',
		category: 'light',
		phase: 'emphasis',
		durationMs: 600,
		description: 'Splits into red, green and blue that wobble back together.',
		params: [
			{
				id: 'offset',
				label: 'Split',
				kind: 'number',
				default: 8,
				min: 1,
				max: 40,
				step: 0.5,
				unit: 'px',
			},
		],
	},
	{
		kind: 'glitch',
		label: 'Glitch',
		category: 'light',
		phase: 'emphasis',
		durationMs: 700,
		description: 'Digital glitch: slices jump sideways and the colours tear.',
		params: [
			{
				id: 'amount',
				label: 'Amount',
				kind: 'number',
				default: 0.6,
				min: 0.05,
				max: 1,
				step: 0.01,
			},
		],
	},
	{
		kind: 'blur',
		label: 'Blur',
		category: 'light',
		phase: 'emphasis',
		durationMs: 600,
		description: 'Blurs out of focus and back.',
		params: [
			{
				id: 'strength',
				label: 'Strength',
				kind: 'number',
				default: 10,
				min: 1,
				max: 40,
				step: 0.5,
			},
		],
	},
	{
		kind: 'pixelate',
		label: 'Pixelate',
		category: 'light',
		phase: 'emphasis',
		durationMs: 700,
		description: 'Breaks into big pixels and resolves back.',
		params: [
			{
				id: 'size',
				label: 'Pixel size',
				kind: 'number',
				default: 16,
				min: 2,
				max: 80,
				step: 1,
				unit: 'px',
			},
		],
	},
	{
		kind: 'freeze',
		label: 'Freeze (ice)',
		category: 'light',
		phase: 'emphasis',
		durationMs: 2600,
		description:
			'Freezes into ice: frost creeps over it along the crystals, it holds frozen with a glint sweeping across, then thaws back.',
		params: [
			COLOR('color', 'Ice colour', '#9fdcff'),
			{
				id: 'from',
				label: 'Frost from',
				kind: 'choice',
				default: 'edges',
				options: ['edges', 'center', 'top', 'bottom'],
			},
			{
				id: 'hold',
				label: 'Hold',
				kind: 'number',
				default: 0.4,
				min: 0,
				max: 0.9,
				step: 0.05,
				note: 'The share of the play it stays frozen. To keep it frozen, key it and hold its progress at the middle.',
			},
			{ id: 'crystals', label: 'Crystals', kind: 'number', default: 12, min: 3, max: 40, step: 1 },
		],
	},
	{
		kind: 'burn',
		label: 'Burn to ashes',
		category: 'light',
		phase: 'exit',
		durationMs: 2600,
		description:
			'Catches fire: a ragged front of flame sweeps across, scorching ahead of it and leaving grey ash with cooling embers that crumbles away, sparks rising.',
		params: [
			{
				id: 'from',
				label: 'Burns from',
				kind: 'choice',
				default: 'bottom',
				options: ['bottom', 'top', 'edges', 'center', 'left', 'right'],
			},
			COLOR('color', 'Flame colour', '#ff7a1a'),
			COLOR('ash', 'Ash colour', '#6b6660'),
			{ id: 'grain', label: 'Ragged', kind: 'number', default: 6, min: 2, max: 20, step: 0.5 },
			{ id: 'sparks', label: 'Sparks', kind: 'bool', default: true },
		],
	},
	{
		kind: 'poison',
		label: 'Poison',
		category: 'light',
		phase: 'loop',
		durationMs: 2400,
		description:
			'Poisoned: it drains to a sickly green, dark veins creep in from its edges and pulse, bubbles rise through it, and it sways queasily.',
		params: [
			COLOR('color', 'Venom colour', '#8aff3c'),
			{ id: 'veins', label: 'Veins', kind: 'number', default: 8, min: 2, max: 24, step: 0.5 },
			{ id: 'bubbles', label: 'Bubbles', kind: 'bool', default: true },
		],
	},
	{
		kind: 'electrocute',
		label: 'Electrocute',
		category: 'light',
		phase: 'emphasis',
		durationMs: 1400,
		description:
			'Electrocuted: jagged arcs crackle across it, its outline glows, it flickers to a scorched negative and jitters, then lets go.',
		params: [
			COLOR('color', 'Arc colour', '#8fd8ff'),
			{ id: 'arcs', label: 'Arcs', kind: 'number', default: 3, min: 1, max: 6, step: 1 },
			{ id: 'flicker', label: 'Flicker', kind: 'bool', default: true },
		],
	},
	{
		kind: 'petrify',
		label: 'Petrify (stone)',
		category: 'light',
		phase: 'emphasis',
		durationMs: 2600,
		description:
			'Turns to stone: grey granite creeps over it with a dusty front, cracked and carved in relief, it locks with a thud, holds, then flakes off in chips.',
		params: [
			COLOR('color', 'Stone colour', '#9a958c'),
			{
				id: 'from',
				label: 'Stone from',
				kind: 'choice',
				default: 'bottom',
				options: ['bottom', 'top', 'edges', 'center'],
			},
			{
				id: 'hold',
				label: 'Hold',
				kind: 'number',
				default: 0.4,
				min: 0,
				max: 0.9,
				step: 0.05,
				note: 'The share of the play it stays stone. To keep it stone, key it and hold its progress at the middle.',
			},
			{ id: 'grain', label: 'Grain', kind: 'number', default: 9, min: 2, max: 30, step: 1 },
		],
	},
	{
		kind: 'turnToGold',
		label: 'Turn to gold',
		category: 'light',
		phase: 'emphasis',
		durationMs: 2600,
		description:
			'Turns to gold: polished gold spreads from where it is touched behind a molten front, its own detail lit as embossed metal, it rings as it sets, holds with a glint sweeping across and sparkles twinkling, then draws back.',
		params: [
			COLOR('color', 'Gold colour', '#ffc83d'),
			{
				id: 'from',
				label: 'Gold from',
				kind: 'choice',
				default: 'center',
				options: ['center', 'bottom', 'top', 'edges'],
			},
			{
				id: 'hold',
				label: 'Hold',
				kind: 'number',
				default: 0.4,
				min: 0,
				max: 0.9,
				step: 0.05,
				note: 'The share of the play it stays gold. To keep it gold, key it and hold its progress at the middle.',
			},
			{ id: 'sparkles', label: 'Sparkles', kind: 'bool', default: true },
		],
	},
	{
		kind: 'dissolveOut',
		label: 'Dissolve out',
		category: 'light',
		phase: 'exit',
		durationMs: 1200,
		description: 'Burns away in a noisy dissolve with a glowing edge.',
		params: [
			COLOR('color', 'Edge colour', '#ffb347'),
			{ id: 'edge', label: 'Edge', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01 },
			{ id: 'grain', label: 'Grain', kind: 'number', default: 8, min: 1, max: 40, step: 0.5 },
		],
	},
	{
		kind: 'dissolveIn',
		label: 'Dissolve in',
		category: 'light',
		phase: 'enter',
		durationMs: 1200,
		description: 'Burns into view in a noisy dissolve with a glowing edge.',
		params: [
			COLOR('color', 'Edge colour', '#7fe3ff'),
			{ id: 'edge', label: 'Edge', kind: 'number', default: 0.08, min: 0, max: 0.3, step: 0.01 },
			{ id: 'grain', label: 'Grain', kind: 'number', default: 8, min: 1, max: 40, step: 0.5 },
		],
	},

	// --- break: a still of the element, cut into pieces that fly ---
	{
		kind: 'crash',
		label: 'Crash',
		category: 'break',
		phase: 'exit',
		durationMs: 1400,
		description: 'Takes a hit, then smashes into shards that fly apart and fall.',
		params: [
			{ id: 'pieces', label: 'Shards', kind: 'number', default: 18, min: 4, max: 60, step: 1 },
			{ id: 'force', label: 'Force', kind: 'number', default: 1, min: 0.1, max: 3, step: 0.05 },
			{ id: 'gravity', label: 'Gravity', kind: 'number', default: 1, min: 0, max: 4, step: 0.05 },
		],
	},
	{
		kind: 'crumble',
		label: 'Crumble',
		category: 'break',
		phase: 'exit',
		durationMs: 1800,
		description: 'Falls apart into chunks that drop away, bottom first.',
		params: [
			{ id: 'pieces', label: 'Chunks', kind: 'number', default: 120, min: 16, max: 600, step: 1 },
			{ id: 'gravity', label: 'Gravity', kind: 'number', default: 1, min: 0.1, max: 4, step: 0.05 },
			{ id: 'spread', label: 'Spread', kind: 'number', default: 0.4, min: 0, max: 2, step: 0.05 },
		],
	},
	{
		kind: 'shatter',
		label: 'Shatter (glass)',
		category: 'break',
		phase: 'exit',
		durationMs: 1800,
		description:
			'Breaks like a pane of glass: cracks race out from the impact, then it falls apart in spiderweb shards that tumble and drop, those by the impact first.',
		params: [
			{
				id: 'impact',
				label: 'Impact',
				kind: 'choice',
				default: 'random',
				options: ['random', 'center', 'top', 'bottom', 'left', 'right'],
			},
			{ id: 'pieces', label: 'Shards', kind: 'number', default: 56, min: 16, max: 160, step: 1 },
			{
				id: 'crack',
				label: 'Cracking',
				kind: 'number',
				default: 0.3,
				min: 0.05,
				max: 0.6,
				step: 0.05,
				note: 'The share of the play the cracks spread for before the pane falls.',
			},
			{ id: 'gravity', label: 'Gravity', kind: 'number', default: 1, min: 0, max: 4, step: 0.05 },
		],
	},
	{
		kind: 'crystallize',
		label: 'Crystallize (ice shards)',
		category: 'break',
		phase: 'exit',
		durationMs: 2400,
		description:
			'Crystallizes into ice: crystals grow over it facet by facet, it locks as ice glinting and creaking, then bursts into ice shards that tumble, flash and fall.',
		params: [
			COLOR('color', 'Ice colour', '#9fdcff'),
			{
				id: 'from',
				label: 'Ice from',
				kind: 'choice',
				default: 'center',
				options: ['center', 'bottom', 'top', 'edges'],
			},
			{ id: 'pieces', label: 'Shards', kind: 'number', default: 28, min: 8, max: 80, step: 1 },
			{
				id: 'freeze',
				label: 'Crystallizing',
				kind: 'number',
				default: 0.45,
				min: 0.15,
				max: 0.8,
				step: 0.05,
				note: 'The share of the play the ice grows and holds before it bursts.',
			},
			{ id: 'gravity', label: 'Gravity', kind: 'number', default: 1, min: 0, max: 4, step: 0.05 },
		],
	},
	{
		kind: 'disintegrate',
		label: 'Dissolve to particles',
		category: 'break',
		phase: 'exit',
		durationMs: 2200,
		description:
			'Turns to dust: specks peel away in a ragged front and blow off on the wind, swaying and shrinking to nothing.',
		params: [
			{
				id: 'particles',
				label: 'Particles',
				kind: 'number',
				default: 700,
				min: 100,
				max: 2000,
				step: 50,
			},
			{
				id: 'drift',
				label: 'Wind',
				kind: 'choice',
				default: 'upRight',
				options: ['upRight', 'up', 'upLeft', 'right', 'left', 'down'],
			},
			{
				id: 'turbulence',
				label: 'Turbulence',
				kind: 'number',
				default: 0.6,
				min: 0,
				max: 2,
				step: 0.05,
			},
		],
	},
	{
		kind: 'assemble',
		label: 'Assemble from particles',
		category: 'break',
		phase: 'enter',
		durationMs: 2200,
		description:
			'Comes together from dust: specks blow in on the wind, swaying and growing as they arrive, and settle into the element, the far side first.',
		params: [
			{
				id: 'particles',
				label: 'Particles',
				kind: 'number',
				default: 700,
				min: 100,
				max: 2000,
				step: 50,
			},
			{
				id: 'drift',
				label: 'From',
				kind: 'choice',
				default: 'upRight',
				options: ['upRight', 'up', 'upLeft', 'right', 'left', 'down'],
			},
			{
				id: 'turbulence',
				label: 'Turbulence',
				kind: 'number',
				default: 0.6,
				min: 0,
				max: 2,
				step: 0.05,
			},
		],
	},
] as const satisfies readonly ElementFxKindSpec[];

export type ElementFxKind = (typeof ELEMENT_FX)[number]['kind'];

export const ELEMENT_FX_KINDS: readonly ElementFxKind[] = ELEMENT_FX.map((spec) => spec.kind);

export const ELEMENT_FX_CATEGORIES: readonly { id: ElementFxCategory; label: string }[] = [
	{ id: 'motion', label: 'Motion' },
	{ id: '3d', label: '3D' },
	{ id: 'distort', label: 'Distort' },
	{ id: 'light', label: 'Light & colour' },
	{ id: 'break', label: 'Break' },
];

const SPECS = new Map<string, ElementFxKindSpec>(ELEMENT_FX.map((spec) => [spec.kind, spec]));

/** A BUILT-IN kind: one of the catalog's. A custom kind is not one ({@link isPlayableElementFxKind}). */
export const isElementFxKind = (value: unknown): value is ElementFxKind =>
	typeof value === 'string' && SPECS.has(value);

/** A built-in kind's spec. */
export const elementFxSpec = (kind: ElementFxKind): ElementFxKindSpec =>
	SPECS.get(kind) as ElementFxKindSpec;

/**
 * Any kind's spec: a built-in's, or a custom kind's while it is registered
 * ({@link setCustomElementFx}); `undefined` for any other.
 */
export const findElementFxSpec = (kind: ElementFxKindId): ElementFxKindSpec | undefined =>
	SPECS.get(kind) ?? CUSTOM.get(kind)?.spec;

// -------------------------------------------------------------------------------------------------
// CUSTOM EFFECTS — authored in Invisible Shader Graph (`docs/design/invisible-shader-graph.md`) and
// compiled there (`engine-shadergraph`'s `compileShaderEffect`). The game and the tools register the
// project's set; a custom kind then plays wherever a built-in does: on a node, a screen, the reels,
// a symbol's state and through the Flow's `elementEffect`, with the same triggers, keyed poses,
// turbo and stop.
// -------------------------------------------------------------------------------------------------

export const CUSTOM_ELEMENT_FX_PREFIX = 'custom:';

/** A custom effect's kind: `custom:<id>`, its id a slug. */
export type CustomElementFxKind = `custom:${string}`;

/** Any kind an entry or a play may name: a built-in, or a custom effect's. */
export type ElementFxKindId = ElementFxKind | CustomElementFxKind;

const CUSTOM_KIND = /^custom:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A well-formed custom kind, registered or not. */
export const isCustomElementFxKind = (value: unknown): value is CustomElementFxKind =>
	typeof value === 'string' && CUSTOM_KIND.test(value);

/** The kind a custom effect with this id plays as. */
export const customElementFxKind = (id: string): CustomElementFxKind => `custom:${id}`;

/** One uniform of a compiled graph, and what the runtime writes into it each frame. */
export interface CustomElementFxUniform {
	name: string;
	type: 'float' | 'vec2' | 'vec3' | 'vec4';
	/** `time`: `uFx` = (progress 0…1, seconds, intensity, looping 0 / 1). `param`: one param's value. */
	source: { kind: 'time' } | { kind: 'param'; id: string };
}

/** A pass value: a literal, or one of the effect's own params (of the same kind). */
export type CustomElementFxPassValue = ElementFxParamValue | { param: string };

/**
 * A built-in pass drawn after the graph: the kind's own filter, playing in step with the effect,
 * its params set by value or tied to the effect's params.
 */
export interface CustomElementFxPass {
	kind: ElementFxPassKind;
	params?: Readonly<Record<string, CustomElementFxPassValue>>;
	/** Multiplies the effect's strength for this pass. Unset ⇒ 1. */
	intensity?: number;
}

/** How a curve gets from one key to the next. */
export const ELEMENT_FX_CURVE_EASES = ['linear', 'smooth', 'in', 'out', 'hold'] as const;
export type ElementFxCurveEase = (typeof ELEMENT_FX_CURVE_EASES)[number];

/** A value over one play: keys at `t` 0…1 in order, each easing to the next. */
export type ElementFxCurve = readonly { t: number; v: number; ease?: ElementFxCurveEase }[];

/**
 * The motion channels a custom effect may move, and their units: `x` / `y` in shares of the
 * element's width / height, `scale` / `scaleX` / `scaleY` as multipliers, `rotation` in degrees,
 * `alpha` a multiplier. Every channel but `alpha` scales with the effect's intensity.
 */
export const ELEMENT_FX_MOTION_CHANNELS = [
	'x',
	'y',
	'scale',
	'scaleX',
	'scaleY',
	'rotation',
	'alpha',
] as const;
export type ElementFxMotionChannel = (typeof ELEMENT_FX_MOTION_CHANNELS)[number];

export interface CustomElementFxMotion {
	channels: Partial<Readonly<Record<ElementFxMotionChannel, ElementFxCurve>>>;
	/** The point scale and rotation turn about, as a share of the element's box. Unset ⇒ centre. */
	pivot?: { x: number; y: number };
}

/**
 * The built-in kinds a custom effect may draw as a pass after its graph: those that are a single
 * shader pass, with no motion of their own and no break. `check:element-fx` holds this list to the
 * runtime's kinds.
 */
export const ELEMENT_FX_PASS_KINDS = [
	'glow',
	'outline',
	'shine',
	'flash',
	'hueCycle',
	'chromatic',
	'glitch',
	'blur',
	'pixelate',
] as const satisfies readonly ElementFxKind[];
export type ElementFxPassKind = (typeof ELEMENT_FX_PASS_KINDS)[number];

/** A custom effect, compiled and ready to play. */
export interface CustomElementFx {
	/** Its kind, label, phase, length, description and params, as a built-in's. */
	spec: ElementFxKindSpec & { kind: CustomElementFxKind; category: 'custom' };
	/** The graph: one Element FX pass body (`ElementFxFilter`) and its uniforms. */
	shader: { body: string; uniforms: readonly CustomElementFxUniform[] };
	/** Room the graph draws outside the element's box, as a share of its larger side. */
	padding: number;
	passes: readonly CustomElementFxPass[];
	motion?: CustomElementFxMotion;
}

/** A custom effect's passes and the keys on one motion curve, at most. */
export const CUSTOM_ELEMENT_FX_PASS_LIMIT = 4;
export const ELEMENT_FX_CURVE_KEY_LIMIT = 32;
/** Room a custom effect's graph may ask for outside the element, in shares of its larger side. */
export const CUSTOM_ELEMENT_FX_PADDING_MAX = 2;

/** The values each motion channel may take (x / y in element sizes, rotation in degrees). */
export const ELEMENT_FX_MOTION_RANGES: Readonly<
	Record<ElementFxMotionChannel, { min: number; max: number }>
> = {
	x: { min: -10, max: 10 },
	y: { min: -10, max: 10 },
	scale: { min: 0, max: 10 },
	scaleX: { min: 0, max: 10 },
	scaleY: { min: 0, max: 10 },
	rotation: { min: -3600, max: 3600 },
	alpha: { min: 0, max: 1 },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** Why a list of param specs is malformed, or [] when it is not. */
export function elementFxParamSpecIssues(params: readonly unknown[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of params) {
		const spec = isRecord(raw) ? raw : {};
		const id = typeof spec.id === 'string' ? spec.id : '';
		if (!id) {
			out.push('a param has no id');
			continue;
		}
		if (seen.has(id)) out.push(`param "${id}" is defined twice`);
		seen.add(id);
		if (typeof spec.label !== 'string') out.push(`param "${id}" has no label`);
		const { default: value, min, max, options } = spec;
		if (spec.kind === 'number') {
			if (!(finite(value) && finite(min) && finite(max) && min <= value && value <= max)) {
				out.push(`param "${id}": its default must sit between its min and max`);
			}
		} else if (spec.kind === 'color') {
			if (typeof value !== 'string' || !HEX.test(value)) {
				out.push(`param "${id}": its default is not a #rrggbb colour`);
			}
		} else if (spec.kind === 'bool') {
			if (typeof value !== 'boolean') out.push(`param "${id}": its default is not on or off`);
		} else if (spec.kind === 'choice') {
			if (
				!Array.isArray(options) ||
				!options.length ||
				!options.every((option) => typeof option === 'string') ||
				typeof value !== 'string' ||
				!options.includes(value)
			) {
				out.push(`param "${id}": its options must be words, its default one of them`);
			}
		} else {
			out.push(`param "${id}": unknown kind`);
		}
	}
	return out;
}

/**
 * Why a custom effect's passes are malformed, or [] when they are not: each a pass kind, its params
 * ones that kind has, each a valid value or tied to one of `params` of the same kind, its strength
 * within the runtime's.
 */
export function customElementFxPassIssues(
	passes: unknown,
	params: ReadonlyMap<string, ElementFxParamSpec>,
): string[] {
	if (passes === undefined) return [];
	if (!Array.isArray(passes)) return ['passes is not a list'];
	if (passes.length > CUSTOM_ELEMENT_FX_PASS_LIMIT) {
		return [`at most ${CUSTOM_ELEMENT_FX_PASS_LIMIT} passes`];
	}
	const out: string[] = [];
	passes.forEach((raw: unknown, i) => {
		const at = `pass ${i + 1}`;
		if (!isRecord(raw)) return void out.push(`${at} is not a pass`);
		const kind = raw.kind;
		if (!(ELEMENT_FX_PASS_KINDS as readonly unknown[]).includes(kind)) {
			out.push(`${at}: "${String(kind)}" is not one of ${ELEMENT_FX_PASS_KINDS.join(', ')}`);
			return;
		}
		const specs = new Map(elementFxSpec(kind as ElementFxPassKind).params.map((p) => [p.id, p]));
		if (raw.params !== undefined && !isRecord(raw.params)) out.push(`${at}: params is not a map`);
		for (const [id, value] of Object.entries(isRecord(raw.params) ? raw.params : {})) {
			const spec = specs.get(id);
			if (!spec) {
				out.push(`${at}: ${String(kind)} has no param "${id}"`);
			} else if (isRecord(value)) {
				const bound = typeof value.param === 'string' ? params.get(value.param) : undefined;
				const fits =
					!!bound &&
					bound.kind === spec.kind &&
					(bound.kind !== 'choice' ||
						(spec.kind === 'choice' &&
							Array.isArray(bound.options) &&
							bound.options.every((o) => spec.options.includes(o))));
				if (!fits) {
					out.push(`${at}: "${id}" is not tied to one of the effect's ${spec.kind} params`);
				}
			} else {
				const read = readElementFxParam(spec, value);
				if (read === undefined || (spec.kind === 'number' && read !== value)) {
					out.push(`${at}: "${id}" is not a valid ${spec.kind}`);
				}
			}
		}
		const { min, max } = ELEMENT_FX_LIMITS.intensity;
		if (
			raw.intensity !== undefined &&
			!(finite(raw.intensity) && raw.intensity >= min && raw.intensity <= max)
		) {
			out.push(`${at}: intensity must be ${min}…${max}`);
		}
	});
	return out;
}

/**
 * Why a custom effect's motion is malformed, or [] when it is not: known channels, each curve 1…32
 * keys in order over 0…1 with values in the channel's range and known eases, a pivot near the box.
 */
export function customElementFxMotionIssues(motion: unknown): string[] {
	if (motion === undefined) return [];
	if (!isRecord(motion) || !isRecord(motion.channels)) return ['motion has no channels map'];
	const out: string[] = [];
	for (const [channel, curve] of Object.entries(motion.channels)) {
		const range = ELEMENT_FX_MOTION_RANGES[channel as ElementFxMotionChannel];
		if (!(ELEMENT_FX_MOTION_CHANNELS as readonly string[]).includes(channel) || !range) {
			out.push(`"${channel}" is not one of ${ELEMENT_FX_MOTION_CHANNELS.join(', ')}`);
			continue;
		}
		if (!Array.isArray(curve) || !curve.length || curve.length > ELEMENT_FX_CURVE_KEY_LIMIT) {
			out.push(`${channel}: a curve has 1…${ELEMENT_FX_CURVE_KEY_LIMIT} keys`);
			continue;
		}
		let last = 0;
		curve.forEach((key: unknown, i) => {
			if (
				!isRecord(key) ||
				!finite(key.t) ||
				!(key.t >= last && key.t <= 1) ||
				!finite(key.v) ||
				key.v < range.min ||
				key.v > range.max ||
				(key.ease !== undefined &&
					!(ELEMENT_FX_CURVE_EASES as readonly unknown[]).includes(key.ease))
			) {
				out.push(
					`${channel}: key ${i + 1} needs t in order over 0…1, a value in ${range.min}…${range.max}, a known ease`,
				);
			} else {
				last = key.t;
			}
		});
	}
	const pivot = motion.pivot;
	if (
		pivot !== undefined &&
		!(isRecord(pivot) && [pivot.x, pivot.y].every((v) => finite(v) && v >= -1 && v <= 2))
	) {
		out.push('pivot needs x and y in −1…2');
	}
	return out;
}

const UNIFORM_TYPES: readonly unknown[] = ['float', 'vec2', 'vec3', 'vec4'];
const GLSL_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * A custom effect as the registry takes it, or `undefined` when it cannot play: a plain copy, every
 * part checked (its spec and params, its shader's body and uniforms, its padding, passes and
 * motion), so a malformed effect from storage or a bundle is dropped rather than failing mid-play.
 */
export function readCustomElementFx(raw: unknown): CustomElementFx | undefined {
	if (!isRecord(raw) || !isRecord(raw.spec) || !isRecord(raw.shader)) return undefined;
	const { spec, shader } = raw;
	const { min: shortest, max: longest } = ELEMENT_FX_LIMITS.durationMs;
	if (
		!isCustomElementFxKind(spec.kind) ||
		typeof spec.label !== 'string' ||
		!spec.label.trim() ||
		spec.category !== 'custom' ||
		!(ELEMENT_FX_PHASES as readonly unknown[]).includes(spec.phase) ||
		!finite(spec.durationMs) ||
		spec.durationMs < shortest ||
		spec.durationMs > longest ||
		typeof spec.description !== 'string' ||
		!Array.isArray(spec.params) ||
		elementFxParamSpecIssues(spec.params).length
	) {
		return undefined;
	}
	const params = new Map((spec.params as ElementFxParamSpec[]).map((param) => [param.id, param]));
	const uniforms = shader.uniforms;
	if (
		typeof shader.body !== 'string' ||
		!shader.body ||
		!Array.isArray(uniforms) ||
		!uniforms.every(
			(u) =>
				isRecord(u) &&
				typeof u.name === 'string' &&
				GLSL_NAME.test(u.name) &&
				UNIFORM_TYPES.includes(u.type) &&
				isRecord(u.source) &&
				(u.source.kind === 'time' ||
					(u.source.kind === 'param' &&
						typeof u.source.id === 'string' &&
						params.has(u.source.id))),
		)
	) {
		return undefined;
	}
	if (
		!finite(raw.padding) ||
		raw.padding < 0 ||
		raw.padding > CUSTOM_ELEMENT_FX_PADDING_MAX ||
		!Array.isArray(raw.passes) ||
		customElementFxPassIssues(raw.passes, params).length ||
		customElementFxMotionIssues(raw.motion).length
	) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(raw)) as CustomElementFx;
}

const CUSTOM = new Map<string, CustomElementFx>();

/**
 * The custom effects that play from now on: the given set, replacing the last one (the game at
 * boot, the editor when it opens a project). Each is read through {@link readCustomElementFx}: one
 * that cannot play is left out; a kind given twice plays as its last. An effect already playing
 * keeps what it started with. Returns what was registered.
 */
export function setCustomElementFx(effects: readonly unknown[]): CustomElementFx[] {
	CUSTOM.clear();
	for (const raw of effects) {
		const effect = readCustomElementFx(raw);
		if (!effect) continue;
		CUSTOM.delete(effect.spec.kind);
		CUSTOM.set(effect.spec.kind, effect);
	}
	return [...CUSTOM.values()];
}

/** A registered custom effect. */
export const customElementFx = (kind: string): CustomElementFx | undefined => CUSTOM.get(kind);

/** The registered custom effects, in the order they were given. */
export const customElementFxList = (): CustomElementFx[] => [...CUSTOM.values()];

/** A kind that can play now: a built-in, or a registered custom effect. */
export const isPlayableElementFxKind = (value: unknown): value is ElementFxKindId =>
	isElementFxKind(value) || (typeof value === 'string' && CUSTOM.has(value));

const EASED: Record<ElementFxCurveEase, (k: number) => number> = {
	linear: (k) => k,
	smooth: (k) => k * k * (3 - 2 * k),
	in: (k) => k * k,
	out: (k) => 1 - (1 - k) * (1 - k),
	hold: () => 0,
};

/** `curve` at `t`: its first value before its first key, its last after its last. */
export function sampleElementFxCurve(curve: ElementFxCurve, t: number): number {
	if (!curve.length) return 0;
	if (t <= curve[0].t) return curve[0].v;
	for (let i = 1; i < curve.length; i++) {
		const next = curve[i];
		if (t >= next.t) continue;
		const prev = curve[i - 1];
		const span = next.t - prev.t;
		const k = span > 0 ? (t - prev.t) / span : 1;
		return prev.v + (next.v - prev.v) * EASED[prev.ease ?? 'linear'](k);
	}
	return curve[curve.length - 1].v;
}

/** What a param's uniform holds for `value`: its number, its colour, 0 / 1, or its choice's index. */
export function elementFxParamUniform(spec: ElementFxParamSpec, value: unknown): number[] {
	switch (spec.kind) {
		case 'number':
			return [finite(value) ? value : spec.default];
		case 'color':
			return hexRgb(typeof value === 'string' && HEX.test(value) ? value : spec.default);
		case 'bool':
			return [(typeof value === 'boolean' ? value : spec.default) ? 1 : 0];
		case 'choice': {
			const at = spec.options.indexOf(typeof value === 'string' ? value : spec.default);
			return [Math.max(0, at < 0 ? spec.options.indexOf(spec.default) : at)];
		}
	}
}

const hexRgb = (hex: string): number[] =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * When an authored entry plays.
 * - `always` loops while the element is on screen.
 * - `enter` plays when the element appears (each time it is shown).
 * - `cue` plays each time its cue fires: a Flow `fireCue`, a component signal, a cue a timeline or
 *   a state of the owning component raises.
 * - `keyed` never plays on its own: a timeline (and so a state-machine state) poses it through its
 *   {@link elementFxProgressChannel} and {@link elementFxIntensityChannel} keys, so it scrubs.
 */
export const ELEMENT_FX_TRIGGERS = ['always', 'enter', 'cue', 'keyed'] as const;
export type ElementFxTrigger = (typeof ELEMENT_FX_TRIGGERS)[number];

export type ElementFxParamValue = number | string | boolean;

/** One authored effect on an element (a node's or a screen's `elementFx` list). */
export interface ElementFxEntry {
	/** Unique in its list; the editor names them `efx1`, `efx2`, … */
	id: string;
	/** A built-in kind, or a custom effect's `custom:<id>`. */
	kind: ElementFxKindId;
	trigger: ElementFxTrigger;
	/** `trigger: 'cue'`: the cue that plays it. */
	cue?: string;
	/** Any trigger: a cue that stops it and puts the element back at rest. */
	stopCue?: string;
	/** One play. Unset ⇒ the kind's own length. */
	durationMs?: number;
	/** Wait before each start. */
	delayMs?: number;
	/** 1 = the kind's reference strength. Unset ⇒ 1. */
	intensity?: number;
	/** How many times it plays; 0 = until stopped. Unset ⇒ once, or forever for `always`. */
	repeat?: number;
	/** The kind's own knobs, by param id; an unset one takes the kind's default. */
	params?: Record<string, ElementFxParamValue>;
	/** Off in the editor without deleting it: never plays. */
	disabled?: boolean;
}

export const ELEMENT_FX_LIMITS = {
	durationMs: { min: 50, max: 20_000 },
	delayMs: { min: 0, max: 20_000 },
	intensity: { min: 0, max: 4 },
	repeat: { min: 0, max: 100 },
} as const;

/**
 * The timeline channels that pose a `keyed` entry — `engine-cinematic`'s `ELEMENT_FX_CHANNEL_PREFIX`
 * (`check:element-fx` holds the two equal). `efx:<id>` is how far through the effect it is (0 = at
 * rest … 1 = its end); `efx:<id>:intensity` multiplies its strength (1 = as authored).
 */
export const ELEMENT_FX_CHANNEL_PREFIX = 'efx:';
const INTENSITY_SUFFIX = ':intensity';

export const elementFxProgressChannel = (id: string): string => `${ELEMENT_FX_CHANNEL_PREFIX}${id}`;
export const elementFxIntensityChannel = (id: string): string =>
	`${ELEMENT_FX_CHANNEL_PREFIX}${id}${INTENSITY_SUFFIX}`;

/** The entry a channel poses and which of its two values, or `undefined` for any other channel. */
export function elementFxOfChannel(
	channel: string,
): { id: string; value: 'progress' | 'intensity' } | undefined {
	if (!channel.startsWith(ELEMENT_FX_CHANNEL_PREFIX)) return undefined;
	const rest = channel.slice(ELEMENT_FX_CHANNEL_PREFIX.length);
	if (rest.endsWith(INTENSITY_SUFFIX)) {
		const id = rest.slice(0, -INTENSITY_SUFFIX.length);
		return id ? { id, value: 'intensity' } : undefined;
	}
	return rest ? { id: rest, value: 'progress' } : undefined;
}

/** The channels a timeline can key on a node with these entries: two per enabled `keyed` entry. */
export function elementFxChannels(entries: readonly ElementFxEntry[]): string[] {
	return entries
		.filter((e) => e.trigger === 'keyed' && !e.disabled)
		.flatMap((e) => [elementFxProgressChannel(e.id), elementFxIntensityChannel(e.id)]);
}

/** The target name the flow uses for the reels. */
export const ELEMENT_FX_REELS_TARGET = 'reels';
/** The target name the flow uses for a whole screen. */
export const elementFxScreenTarget = (sceneId: string): string => `screen:${sceneId}`;

const HEX = /^#[0-9a-f]{6}$/i;

const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * One param value read against its spec: a number clamped to its range, a `#rrggbb` colour, a
 * boolean, or one of the choice's options. Anything else is `undefined` (the kind's default).
 */
export function readElementFxParam(
	spec: ElementFxParamSpec,
	value: unknown,
): ElementFxParamValue | undefined {
	switch (spec.kind) {
		case 'number':
			return finite(value) ? clamp(value, spec.min, spec.max) : undefined;
		case 'color':
			return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : undefined;
		case 'bool':
			return typeof value === 'boolean' ? value : undefined;
		case 'choice':
			return typeof value === 'string' && spec.options.includes(value) ? value : undefined;
	}
}

/** Every param of `kind`, authored values over the kind's defaults (none for an unregistered one). */
export function resolveElementFxParams(
	kind: ElementFxKindId,
	params: Readonly<Record<string, unknown>> | undefined,
): Record<string, ElementFxParamValue> {
	const out: Record<string, ElementFxParamValue> = {};
	for (const spec of findElementFxSpec(kind)?.params ?? []) {
		out[spec.id] = readElementFxParam(spec, params?.[spec.id]) ?? spec.default;
	}
	return out;
}

const optionalNumber = (
	value: unknown,
	limits: { min: number; max: number },
	integer = false,
): number | undefined => {
	if (!finite(value)) return undefined;
	const clamped = clamp(value, limits.min, limits.max);
	return integer ? Math.round(clamped) : clamped;
};

const optionalName = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * One entry as the runtime and the editor read it, or `undefined` when it cannot play (no id, an
 * unknown kind — a doc from a newer build — or no trigger). Values out of range are clamped, a
 * malformed one is dropped back to its default, and an unknown param is dropped, so a stored
 * entry can never feed the runtime a `NaN`.
 *
 * A well-formed custom kind is kept even before its effect is registered, so the order a game
 * reads its docs and registers its effects in cannot lose one: it plays once registered. Its
 * params are read against its spec when it is registered, else kept as plain values for
 * {@link resolveElementFxParams} to read when it plays.
 */
export function readElementFxEntry(raw: unknown): ElementFxEntry | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const value = raw as Record<string, unknown>;
	const id = optionalName(value.id);
	const kind = value.kind;
	const trigger = value.trigger;
	if (!id || !(isElementFxKind(kind) || isCustomElementFxKind(kind))) return undefined;
	if (!(ELEMENT_FX_TRIGGERS as readonly unknown[]).includes(trigger)) return undefined;
	const entry: ElementFxEntry = { id, kind, trigger: trigger as ElementFxTrigger };
	const cue = optionalName(value.cue);
	if (cue) entry.cue = cue;
	const stopCue = optionalName(value.stopCue);
	if (stopCue) entry.stopCue = stopCue;
	const durationMs = optionalNumber(value.durationMs, ELEMENT_FX_LIMITS.durationMs);
	if (durationMs !== undefined) entry.durationMs = durationMs;
	const delayMs = optionalNumber(value.delayMs, ELEMENT_FX_LIMITS.delayMs);
	if (delayMs !== undefined) entry.delayMs = delayMs;
	const intensity = optionalNumber(value.intensity, ELEMENT_FX_LIMITS.intensity);
	if (intensity !== undefined) entry.intensity = intensity;
	const repeat = optionalNumber(value.repeat, ELEMENT_FX_LIMITS.repeat, true);
	if (repeat !== undefined) entry.repeat = repeat;
	if (value.params && typeof value.params === 'object') {
		const params: Record<string, ElementFxParamValue> = {};
		const given = value.params as Record<string, unknown>;
		const spec = findElementFxSpec(kind);
		if (spec) {
			for (const param of spec.params) {
				const read = readElementFxParam(param, given[param.id]);
				if (read !== undefined) params[param.id] = read;
			}
		} else {
			for (const [key, v] of Object.entries(given)) {
				if (finite(v) || typeof v === 'string' || typeof v === 'boolean') params[key] = v;
			}
		}
		if (Object.keys(params).length) entry.params = params;
	}
	if (value.disabled === true) entry.disabled = true;
	return entry;
}

/** A stored `elementFx` list as the runtime plays it: unreadable entries and repeat ids dropped. */
export function readElementFxEntries(raw: unknown): ElementFxEntry[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: ElementFxEntry[] = [];
	for (const item of raw) {
		const entry = readElementFxEntry(item);
		if (!entry || seen.has(entry.id)) continue;
		seen.add(entry.id);
		out.push(entry);
	}
	return out;
}

/**
 * Does `entry` play out on its own once it starts: an `enter` entry with a count of plays. An
 * `always` one loops and an `enter` one set to 0 plays until stopped, so neither ever ends. This is
 * what a player's `ondone` waits for.
 */
export const elementFxEnterEnds = (entry: ElementFxEntry): boolean =>
	!entry.disabled && entry.trigger === 'enter' && (entry.repeat ?? 1) > 0;

/** The cue names a list listens for (plays and stops), for the flow's cue palette. */
export function elementFxCueNames(entries: readonly ElementFxEntry[]): string[] {
	const names = new Set<string>();
	for (const entry of entries) {
		if (entry.disabled) continue;
		if (entry.trigger === 'cue' && entry.cue) names.add(entry.cue);
		if (entry.stopCue) names.add(entry.stopCue);
	}
	return [...names];
}
