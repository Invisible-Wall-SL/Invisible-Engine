import { Container, Graphics, MeshRope, Point, Sprite, Texture } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import type { SalmonsTextures } from './load';

/**
 * SALMONS' CHARACTERS IN THEIR ORIGINAL ART, animated in code as the old client
 * (`GuiltyForever/Salmon-` `client/game.js`) animated them, each at its body's width and standing
 * on its place (the bottom of its look at its feet):
 * - the salmon: a 12-point rope through its texture, facing and tilting with its projected
 *   velocity, breathing (squash), arching on a hop, nose up at a waterfall's foot with a pulse
 *   each tap, a white glint flashing along its spine in open water; the golden one drawn with its
 *   own texture;
 * - the bear (drawn from above, facing left): turned to its heading, a claw streak on its swipe;
 * - the fisherman: the old client's tan circle, his line from his hand.
 */

/** What a look is told each frame: where it is drawn (world px), when (ms), and how it is. */
export type LookFrame = {
	atMs: number;
	x: number;
	y: number;
	/** `engine-mechanics` `STATUS`: 0 free, 3 grounded, 4 hooked. */
	status: number;
	marked: boolean;
};

/** The room events a look plays: a hop, a climb over a waterfall, an ability, a tap of Space. */
export type LookEvent = 'jumped' | 'climbed' | 'ability' | 'tap';

export type CodeLook = {
	mount: ArtMount;
	frame: (frame: LookFrame) => void;
	event: (event: LookEvent, atMs: number) => void;
	/** Where a line this look holds starts: `dx` right of its place, `lift` up from it. */
	hand: { dx: number; lift: number } | undefined;
	/** How far up from its place a line on it ends (its middle). */
	middle: number;
	/** What it draws now (the probe's): its kind, its texture region, whether a swipe shows. */
	drawn: () => { kind: string; region: string; swiping?: boolean };
	destroy: () => void;
};

const STATUS_FREE = 0;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
	let d = (b - a) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return a + d * t;
};

/** A character's velocity as drawn, over the last {@link WINDOW_MS}, and its screen direction. */
const WINDOW_MS = 150;
function createMotion() {
	const trail: { x: number; y: number; atMs: number }[] = [];
	return (f: LookFrame) => {
		trail.push({ x: f.x, y: f.y, atMs: f.atMs });
		while (trail.length > 2 && f.atMs - trail[1].atMs >= WINDOW_MS) trail.shift();
		const from = trail[0];
		const dt = f.atMs - from.atMs;
		const vx = dt > 0 ? ((f.x - from.x) * 1000) / dt : 0;
		const vy = dt > 0 ? ((f.y - from.y) * 1000) / dt : 0;
		return { vx, vy, sx: vx - vy, sy: (vx + vy) / 2, moving: Math.hypot(vx, vy) > 12 };
	};
}

/** A look's container mounted into the place `<SpawnLayer>` gives it, and taken out again. */
const mountOf =
	(view: Container): ArtMount =>
	(into) => {
		into.addChild(view);
		return () => {
			into.removeChild(view);
		};
	};

/** The 64 × 6 white stripe of the salmon's spine glint, faded at its edges and ends. */
function highlightTexture(): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 6;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const v = ctx.createLinearGradient(0, 0, 0, 6);
		v.addColorStop(0, 'rgba(255,255,255,0)');
		v.addColorStop(0.5, 'rgba(255,255,255,1)');
		v.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = v;
		ctx.fillRect(0, 0, 64, 6);
		const h = ctx.createLinearGradient(0, 0, 64, 0);
		h.addColorStop(0, 'rgba(0,0,0,0)');
		h.addColorStop(0.18, 'rgba(0,0,0,1)');
		h.addColorStop(0.82, 'rgba(0,0,0,1)');
		h.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.globalCompositeOperation = 'destination-in';
		ctx.fillStyle = h;
		ctx.fillRect(0, 0, 64, 6);
	}
	return Texture.from(canvas);
}

/** The old salmon's length, px: its sizes are in these units, scaled to the body. */
const OLD_SALMON = 50;
const ROPE_POINTS = 12;
const GLINT_POINTS = 7;
const GLINT_HALF = 12;
const GLINT_FROM = 3;
const HOP_MS = 600;
const PULSE_MS = 180;
/** How near below a waterfall's foot a salmon is climbing it, px, and how still it holds. */
const FOOT_PX = 40;
const STILL_PX_S = 40;

function salmonLook(
	art: SalmonsTextures,
	glint: Texture,
	river: SalmonsRiverDrawing,
	bodyW: number,
): CodeLook {
	const pink = art.region('salmon_pink');
	const golden = art.region('salmon_golden');
	const texW = pink.width;
	const m = bodyW / OLD_SALMON;
	const drawnH = (bodyW * pink.height) / texW;
	const view = new Container();
	const body = new Container();
	body.y = -drawnH / 2;
	view.addChild(body);
	const ropeBox = new Container();
	ropeBox.scale.set(bodyW / texW);
	const points = Array.from(
		{ length: ROPE_POINTS },
		(_, i) => new Point((-0.5 + i / (ROPE_POINTS - 1)) * texW, 0),
	);
	const rope = new MeshRope({ texture: pink, points });
	ropeBox.addChild(rope);
	const glintBox = new Container();
	glintBox.scale.set(m);
	const glintPoints = Array.from(
		{ length: GLINT_POINTS },
		(_, i) => new Point(-GLINT_HALF + (i / (GLINT_POINTS - 1)) * 2 * GLINT_HALF, 0),
	);
	const highlight = new MeshRope({ texture: glint, points: glintPoints });
	highlight.blendMode = 'add';
	highlight.alpha = 0;
	glintBox.addChild(highlight);
	body.addChild(ropeBox, glintBox);

	const motion = createMotion();
	let facing = 1;
	let rotation = 0;
	let size = 1;
	let curl = 0;
	let hopAt = -Infinity;
	let pulseAt = -Infinity;
	let flash = { at: -Infinity, ms: 200, next: Math.random() * 1200 };
	let marked = false;
	const falls = river.waterfalls ?? [];
	const climbing = (x: number, y: number) =>
		falls.some((f) => {
			const foot = f.y + f.h;
			return y >= foot && y <= foot + FOOT_PX + 22 && x >= f.x && x <= f.x + f.w;
		});

	return {
		mount: mountOf(view),
		hand: undefined,
		middle: drawnH / 2,
		drawn: () => ({ kind: 'rope', region: marked ? 'salmon_golden' : 'salmon_pink' }),
		event: (event, atMs) => {
			if (event === 'jumped') hopAt = atMs;
			else if (event === 'climbed' || event === 'tap') pulseAt = atMs;
		},
		frame: (f) => {
			const now = f.atMs;
			const v = motion(f);
			if (f.marked !== marked) {
				marked = f.marked;
				rope.texture = marked ? golden : pink;
			}
			const hopK = (now - hopAt) / HOP_MS;
			const hopping = hopK >= 0 && hopK < 1;
			const jf = hopping ? Math.sin(hopK * Math.PI) : 0;
			const free = f.status === STATUS_FREE;
			const atFoot = free && !hopping && Math.abs(v.vy) < STILL_PX_S && climbing(f.x, f.y);
			if (atFoot) {
				rotation = lerpAngle(rotation, -facing * (Math.PI / 2), 0.3);
				const k = (now - pulseAt) / PULSE_MS;
				const pulse = k >= 0 && k < 1 ? Math.sin(k * Math.PI) * 0.18 : 0;
				size = lerp(size, 1, 0.1);
				curl += (0 - curl) * 0.15;
				for (const p of points) p.y *= 0.85;
				body.rotation = rotation;
				body.scale.set(facing * size * (1 + pulse), size * (1 + pulse));
			} else {
				if (v.moving) {
					if (v.sx < 0) facing = -1;
					else if (v.sx > 0) facing = 1;
					const tilt = facing > 0 ? Math.atan2(v.sy, v.sx) : Math.atan2(-v.sy, -v.sx);
					rotation = lerpAngle(rotation, tilt, 0.2);
				}
				if (hopping) rotation = lerpAngle(rotation, rotation - facing * jf * 0.4, 0.15);
				curl += (Math.min(1, jf) - curl) * 0.15;
				const arch = -curl * Math.sin((now * 2 * Math.PI * 2) / 1000) * 36 * (texW / OLD_SALMON);
				points.forEach((p, i) => {
					p.y = arch * Math.pow(1 - i / (ROPE_POINTS - 1), 2.5);
				});
				size = lerp(size, 1 + jf * 0.12, 0.1);
				const period = v.moving ? 400 : 1500;
				const amp = v.moving ? 0.02 : 0.008;
				const squash = Math.sin((now * 2 * Math.PI) / period) * amp;
				body.rotation = rotation;
				body.scale.set(facing * size * (1 + squash), size * (1 - squash));
			}
			const open = free && !hopping && !atFoot;
			highlight.visible = open;
			if (open) {
				glintPoints.forEach((p, i) => {
					p.y = (points[GLINT_FROM + i].y * OLD_SALMON) / texW;
				});
				if (now >= flash.next)
					flash = {
						at: now,
						ms: 120 + Math.random() * 260,
						next: now + 350 + Math.random() * 1800,
					};
				const k = (now - flash.at) / flash.ms;
				const bell = k >= 0 && k <= 1 ? Math.sin(k * Math.PI) : 0;
				highlight.alpha = bell * bell * 1.2;
			} else highlight.alpha = 0;
		},
		destroy: () => view.destroy({ children: true }),
	};
}

const SWIPE_MS = 300;

function bearLook(art: SalmonsTextures, bodyW: number): CodeLook {
	const texture = art.region('bear');
	const k = bodyW / 80;
	const drawnH = (bodyW * texture.height) / texture.width;
	const view = new Container();
	const centre = new Container();
	centre.y = -drawnH / 2;
	view.addChild(centre);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5);
	sprite.scale.set(bodyW / texture.width);
	const claw = new Graphics().ellipse(-18, 0, 22, 4).fill(0x664422);
	claw.scale.set(k);
	claw.visible = false;
	centre.addChild(sprite, claw);
	const motion = createMotion();
	let heading = 0;
	let swipe = { at: -Infinity, side: -1, aim: 0 };
	return {
		mount: mountOf(view),
		hand: undefined,
		middle: drawnH / 2,
		drawn: () => ({ kind: 'sprite', region: 'bear', swiping: claw.visible }),
		event: (event, atMs) => {
			if (event === 'ability') swipe = { at: atMs, side: -swipe.side, aim: heading };
		},
		frame: (f) => {
			const v = motion(f);
			if (v.moving) heading = Math.atan2(v.sy, v.sx);
			sprite.rotation = lerpAngle(sprite.rotation, heading + Math.PI, 0.2);
			const t = (f.atMs - swipe.at) / SWIPE_MS;
			claw.visible = t >= 0 && t < 1;
			if (!claw.visible) return;
			const angle = swipe.aim + swipe.side * (-Math.PI / 8 + (t * Math.PI) / 4);
			claw.position.set(Math.cos(angle) * 50 * k, Math.sin(angle) * 50 * k);
			claw.rotation = angle;
			claw.alpha = 1 - t;
		},
		destroy: () => view.destroy({ children: true }),
	};
}

/** The old fisherman's radius, px, and his hand from his middle. */
const OLD_FISHERMAN_R = 12;
const OLD_HAND = { x: 8, y: -10 };

function fishermanLook(bodyW: number): CodeLook {
	const s = bodyW / (OLD_FISHERMAN_R * 2);
	const r = OLD_FISHERMAN_R * s;
	const view = new Container();
	view.addChild(new Graphics().circle(0, -r, r).fill(0xe8c170));
	return {
		mount: mountOf(view),
		hand: { dx: OLD_HAND.x * s, lift: r - OLD_HAND.y * s },
		middle: r,
		drawn: () => ({ kind: 'circle', region: '' }),
		event: () => {},
		frame: () => {},
		destroy: () => view.destroy({ children: true }),
	};
}

/** The looks of Salmons' three characters (by character id), or none for another. */
export function createLookFactory(art: SalmonsTextures, river: SalmonsRiverDrawing) {
	const glint = highlightTexture();
	return {
		look: (character: string, body: { w: number; h: number }): CodeLook | undefined =>
			character === 'salmon'
				? salmonLook(art, glint, river, body.w)
				: character === 'bear'
					? bearLook(art, body.w)
					: character === 'fisherman'
						? fishermanLook(body.w)
						: undefined,
		destroy: () => glint.destroy(true),
	};
}
