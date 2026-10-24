/**
 * The graph twins of the distorting built-ins: the 3D passes (the flips, Bounce 3D, the sphericon,
 * Tilt 3D) and the bends (the waves, the flag, twist, curl, ripple, bulge). Each rebuilds its
 * built-in's pass from nodes, and its per-kind timing and param mapping
 * (`pixi-svelte/src/lib/elementFx/kinds.ts`) from time and math nodes; the pass calls the
 * `glslLibrary` functions the built-in's calls. Angles go to the nodes in degrees.
 */

import type { ElementFxCurve } from 'constants-shared/elementFx';
import type { BuiltinTwin } from '../twins';
import { twinGraph, type In, type Ref } from './graph';

type Graph = ReturnType<typeof twinGraph>;

const TAU = 2 * Math.PI;

/**
 * The built-ins' bell (`sin(π t)`) and swell (`0.5 − 0.5 cos(2π t)`) on Oscillate, whose sine is
 * exact to the last digits: a GPU's own sin can be 1e-4 off, which a twist of three turns shows.
 */
const bell = (g: Graph, t: In): Ref => g.node('oscillate', { t, rate: 0.5 }).out;
const swell = (g: Graph, t: In): Ref =>
	g.sub(0.5, g.mul(0.5, g.node('oscillate', { t, phase: 0.25 }).out));

/** `color` (premultiplied) with its colour scaled by `k`, its alpha kept. */
const scaleColor = (g: Graph, color: In, k: In): Ref => g.mul(color, g.combine(k, k, k, 1).xyzw);

/**
 * The element on a card turned in 3D (a `perspective` node's outputs): read where the card is, its
 * far side shaded toward 0.45 as it turns edge on (while `shade` is 1, when given), nothing where
 * the eye misses the card.
 */
const card = (g: Graph, plane: Record<string, Ref>, shade?: In): Ref => {
	const color = g.node('sample', { uv: plane.uv }).out;
	const lit = g.mix(0.45, 1, plane.facing);
	const k = shade === undefined ? lit : g.mix(1, lit, shade);
	return g.node('fade', { color: scaleColor(g, color, k), amount: plane.hit }).out;
};

/**
 * Flip (3D): `turns` turns about the vertical axis (flipX) or the horizontal one (flipY), eased in
 * and out (steady while it loops), lifted toward the eye mid-turn by 0.12 element sizes × strength;
 * `perspective` 0…1 is a focal length of 6…1.4 element sizes.
 */
function flip(kind: 'flipX' | 'flipY'): BuiltinTwin {
	const g = twinGraph(kind, { padding: 0.5 });
	const { progress, intensity, looping } = g.time();
	const turned = g.mix(g.node('easeInOut', { t: progress }).out, progress, looping);
	const angle = g.mul(g.mul(g.param('turns'), 360), turned);
	const lift = g.mul(g.mul(intensity, 0.12), bell(g, progress));
	const focal = g.node('remap', { x: g.param('perspective'), outMin: 6, outMax: 1.4 }).out;
	const plane = g.node('perspective', {
		turnX: kind === 'flipY' ? angle : 0,
		turnY: kind === 'flipX' ? angle : 0,
		lift,
		focal,
	});
	g.output(card(g, plane, g.param('shade')));
	return { kind, doc: g.doc() };
}

/**
 * The built-in's squash at its default 2 hops, as a scale curve (`sign` 1 widens, −1 shortens by
 * 0.12 × the squash): 0 until the first hop nears the ground, 1 as it lands, 0 again as the second
 * takes off, up to that hop's weight (√0.45) as it lands at 85% of the play, eased out by the end.
 */
const squashCurve = (sign: 1 | -1): ElementFxCurve => {
	const second = Math.sqrt(0.45);
	const landed = 0.85 / (1 + second);
	const span = 0.85 - landed;
	const v = (squash: number): number => 1 + sign * 0.12 * squash;
	return [
		{ t: 0, v: v(0) },
		{ t: 0.88 * landed, v: v(0) },
		{ t: landed, v: v(1) },
		{ t: landed + 0.12 * span, v: v(0) },
		{ t: landed + 0.88 * span, v: v(0) },
		{ t: 0.85, v: v(second), ease: 'smooth' },
		{ t: 1, v: v(0) },
	];
};

/**
 * Bounce 3D: `bounces` hops out of the screen (the first `height` × strength element sizes toward
 * the eye), tilting up to `tilt` × strength about both axes and settling; focal 3.47, shaded. Each
 * landing squashes the element (its motion). The built-in pads by 0.3 + 0.8 × `height` × strength;
 * the twin by `height`'s top at strength 1.
 */
function bounce3D(): BuiltinTwin {
	const g = twinGraph('bounce3D', {
		padding: 1.1,
		motion: { channels: { scaleX: squashCurve(1), scaleY: squashCurve(-1) } },
	});
	const { progress, intensity } = g.time();
	const arcs = g.node('bounce', { t: progress, count: g.param('bounces') });
	const tilt = g.mul(g.mul(g.param('tilt'), intensity), g.oneMinus(progress));
	const plane = g.node('perspective', {
		turnX: g.mul(tilt, g.node('oscillate', { t: progress, rate: 1.5 }).out),
		turnY: g.mul(g.mul(tilt, 0.7), g.node('oscillate', { t: progress, phase: 0.6 / TAU }).out),
		lift: g.mul(g.mul(arcs.height, g.param('height')), intensity),
		focal: 3.47,
	});
	g.output(card(g, plane));
	return {
		kind: 'bounce3D',
		doc: g.doc(),
		motionGap:
			'The squash lands where the default 2 hops land: a curve cannot read the Bounces param (the lift, in the graph, follows it), and above strength 1.5 the built-in stops squashing harder.',
	};
}

/**
 * Sphericon: folds into the solid over the first 18% and back over the last 18%, rolling a whole
 * number of half turns (`turns` to the nearest half, at least one), swinging 36° side to side as it
 * rolls and tilted `tilt` toward the viewer while folded; lit from the upper left when `shade` is on.
 */
function sphericon(): BuiltinTwin {
	const g = twinGraph('sphericon', { padding: 0.25 });
	const { progress, intensity } = g.time();
	const folded = g.mul(g.smooth(0, 0.18, progress), g.oneMinus(g.smooth(0.82, 1, progress)));
	const turns = g.max(g.mul(g.floor(g.add(g.mul(g.param('turns'), 2), 0.5)), 0.5), 0.5);
	const solid = g.node('sphericon', {
		roll: g.mul(g.mul(turns, progress), 360),
		swing: g.mul(g.node('oscillate', { t: progress, rate: turns }).out, 36),
		tilt: g.mul(g.param('tilt'), folded),
		length: 0.55,
	});
	const color = g.node('sample', { uv: solid.uv }).out;
	const alpha = g.split(color).w;
	const light = g.node('light', { normal: solid.normal, light: [-0.45, -0.6, 1], shininess: 18 });
	const diffuse = g.add(g.mul(light.diffuse, 0.75), 0.35);
	const specular = g.mul(g.mul(light.specular, 0.35), alpha);
	const shine = g.combine(specular, specular, specular, 0).xyzw;
	const lit = g.min(g.add(scaleColor(g, color, diffuse), shine), alpha);
	const shaded = g.mix(color, lit, g.param('shade'));
	const onSolid = g.node('fade', { color: shaded, amount: solid.hit }).out;
	const blend = g.min(g.mul(folded, g.max(intensity, 0.25)), 1);
	g.output(g.mix(g.node('sample').out, onSolid, blend));
	return { kind: 'sphericon', doc: g.doc() };
}

/**
 * Tilt 3D: swayed in perspective (focal 3.24, shaded), `angle` × strength about Y and half that
 * about X a quarter turn behind, over the loop envelope.
 */
function tilt3D(): BuiltinTwin {
	const g = twinGraph('tilt3D', { padding: 0.3 });
	const { progress, intensity } = g.time();
	const envelope = g.node('loopEnvelope', { t: progress }).out;
	const angle = g.mul(g.mul(g.param('angle'), intensity), envelope);
	const plane = g.node('perspective', {
		turnX: g.mul(g.mul(angle, 0.5), g.node('oscillate', { t: progress, phase: 0.25 }).out),
		turnY: g.mul(angle, g.node('oscillate', { t: progress }).out),
		lift: 0,
		focal: 3.24,
	});
	g.output(card(g, plane));
	return { kind: 'tilt3D', doc: g.doc() };
}

/** A wave's inputs: `amplitude` × strength over the loop envelope, travelling `speed` waves a second. */
const waveDrive = (g: Graph): Record<string, Ref> => {
	const { progress, seconds, intensity } = g.time();
	return {
		amplitude: g.mul(
			g.mul(g.param('amplitude'), intensity),
			g.node('loopEnvelope', { t: progress }).out,
		),
		wavelength: g.param('wavelength'),
		phase: g.mul(g.param('speed'), seconds),
	};
};

/**
 * Wave (X) / (Y): rows slide sideways, or columns up and down. The built-in pads by the amplitude ×
 * strength; the twin by the amplitude's top (0.25), so nothing is cut at strength 1.
 */
function wave(kind: 'waveX' | 'waveY'): BuiltinTwin {
	const g = twinGraph(kind, { padding: 0.25 });
	const at = g.node('wave', waveDrive(g), { axis: kind === 'waveX' ? 'x' : 'y' }).out;
	g.output(g.node('sample', { uv: at }).out);
	return { kind, doc: g.doc() };
}

/** Flag: a wave pinned at the left edge, lit on its folds; padded as the waves are. */
function flag(): BuiltinTwin {
	const g = twinGraph('flag', { padding: 0.25 });
	const cloth = g.node('flag', waveDrive(g));
	g.output(scaleColor(g, g.node('sample', { uv: cloth.uv }).out, cloth.light));
	return { kind: 'flag', doc: g.doc() };
}

/** Twist: `angle` × strength at the centre, in and out over a bell (a sine while it loops). */
function twist(): BuiltinTwin {
	const g = twinGraph('twist', {});
	const { progress, intensity, looping } = g.time();
	const k = g.mix(bell(g, progress), g.node('oscillate', { t: progress }).out, looping);
	const angle = g.mul(g.mul(g.param('angle'), intensity), k);
	const at = g.node('twist', { angle, radius: g.param('radius') }).out;
	g.output(g.node('sample', { uv: at }).out);
	return { kind: 'twist', doc: g.doc() };
}

/**
 * Curl: the corner peels in over 45% of the play, holds, and lays back down (a swell while it
 * loops), as far as `amount` × strength (1 at most) of a peel that rolls the whole page off.
 */
function curl(): BuiltinTwin {
	const g = twinGraph('curl', {});
	const { progress, intensity, looping } = g.time();
	const once = g.node('hold', { t: progress, hold: 0.1 }).out;
	const peel = g.mix(once, swell(g, progress), looping);
	const amount = g.min(g.mul(g.param('amount'), intensity), 1);
	const roll = g.param('radius');
	const reach = g.mul(g.mul(peel, amount), g.add(g.mul(roll, Math.PI), 1));
	// The corner (bottomRight, bottomLeft, topRight, topLeft) as 0 or 1 across and down.
	const corner = g.param('corner');
	const right = g.oneMinus(g.mul(g.fract(g.mul(corner, 0.5)), 2));
	const bottom = g.oneMinus(g.step(1.5, corner));
	g.output(g.node('curl', { corner: g.combine(right, bottom).xy, reach, radius: roll }).out);
	return { kind: 'curl', doc: g.doc() };
}

/** Ripple: a ring running out to 0.6 diagonals, pushing and lighting less as it goes. */
function ripple(): BuiltinTwin {
	const g = twinGraph('ripple', {});
	const { progress, intensity } = g.time();
	const fade = g.oneMinus(progress);
	const ring = g.node('ripple', {
		at: g.mul(progress, 0.6),
		width: g.param('width'),
		amount: g.mul(g.mul(g.param('amplitude'), intensity), fade),
	});
	const color = g.node('sample', { uv: ring.uv }).out;
	const bright = g.mul(g.mul(g.min(intensity, 2), 0.25), fade);
	const glow = g.mul(g.mul(g.split(color).w, bright), ring.ring);
	g.output(g.add(color, g.combine(glow, glow, glow, 0).xyzw));
	return { kind: 'ripple', doc: g.doc() };
}

/** Bulge: the `strength` param × the entry's strength (−1…1) about the centre, over a swell. */
function bulge(): BuiltinTwin {
	const g = twinGraph('bulge', {});
	const { progress, intensity } = g.time();
	const strength = g.clamp(g.mul(g.param('strength'), intensity), -1, 1);
	const at = g.node('bulge', {
		strength: g.mul(strength, swell(g, progress)),
		radius: g.param('radius'),
	}).out;
	g.output(g.node('sample', { uv: at }).out);
	return { kind: 'bulge', doc: g.doc() };
}

export const DISTORT_TWINS: readonly BuiltinTwin[] = [
	flip('flipX'),
	flip('flipY'),
	bounce3D(),
	sphericon(),
	tilt3D(),
	wave('waveX'),
	wave('waveY'),
	flag(),
	twist(),
	curl(),
	ripple(),
	bulge(),
];
