import {
	ColorMatrixFilter,
	Container,
	Graphics,
	MeshRope,
	Point,
	Sprite,
	Text,
	Texture,
} from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import {
	airborne,
	archAt,
	cellsOf,
	curlTarget,
	envelope,
	jumpFactor,
	LEAP,
	liftOf,
	underTint,
	underwater,
} from './leap';
import { BLOOD, createRedness, type Blood } from './blood';
import type { SalmonsTextures } from './load';
import { K } from './scale';
import { PIXEL_FONT } from './winAnimation';

/**
 * SALMONS' CHARACTERS IN THEIR ORIGINAL ART, animated in code as the old client
 * (`GuiltyForever/Salmon-` `client/game.js`) animated them, each at its body's width and standing
 * on its place (the bottom of its look at its feet):
 * - the salmon: a 12-point rope through its texture, facing and tilting with its projected
 *   velocity, breathing (squash), lifted and curling while it leaps (`leap.ts`), nose up while it
 *   climbs a waterfall (the room holds it) with a pulse each tap; swimming in open water it is
 *   drawn under the water's tint with a white glint flashing along its spine, and breaks the surface
 *   (crisp, no glint) in the air, climbing or on sand or a rock; the golden one drawn with its own
 *   texture; swimming through a bloodstain it turns red and sheds a red trail (`blood.ts`);
 * - the bear (drawn from above, facing left): turned to its heading, a claw streak on its swipe;
 * - the fisherman: the old client's tan circle, his line from his hand.
 * Over any of them a text can rise and fade (the catcher's "you catch NAME!").
 */

/** What a look is told each frame: where it is drawn (world px), when (ms), and how it is. */
export type LookFrame = {
	atMs: number;
	x: number;
	y: number;
	/** `engine-mechanics` `STATUS`: 0 free, 3 grounded, 4 hooked. */
	status: number;
	/** How high the room has lifted it off the ground, world px (a salmon's leap or climb). */
	z: number;
	/** Free but held still by the room's rules: a salmon climbing a waterfall. */
	held: boolean;
	marked: boolean;
};

/** The room events a look plays: a hop, a climb over a waterfall, an ability, a tap of Space. */
export type LookEvent = 'jumped' | 'climbed' | 'ability' | 'tap';

export type CodeLook = {
	mount: ArtMount;
	frame: (frame: LookFrame) => void;
	event: (event: LookEvent, atMs: number) => void;
	/** Raise `text` over it: it rises and fades (the original's floating catch text). */
	float: (text: string, atMs: number) => void;
	/** Where a line this look holds starts: `dx` right of its place, `lift` up from it. */
	hand: { dx: number; lift: number } | undefined;
	/** How far up from its place a line on it ends (its middle). */
	middle: number;
	/** What it draws now (the probe's): its kind, its texture region, whether a swipe shows, and
	 *  a salmon's lift (screen px), curl (0..1), whether it has the climb's pose and whether it is
	 *  drawn under the water. */
	drawn: () => {
		kind: string;
		region: string;
		swiping?: boolean;
		lift?: number;
		curl?: number;
		climbing?: boolean;
		underwater?: boolean;
		red?: boolean;
		/** The texts rising over it now ({@link CodeLook.float}). */
		floats?: string[];
	};
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
const PULSE_MS = 180;
/** How fast the drawn height follows the room's, per second: the room's steps come at its tick
 *  rate, the frames at the screen's. */
const LIFT_FOLLOW = 30;

/** The water a body at a world place swims in, and the tint drawn over it (`river.ts`
 *  `waterUnder`); `undefined` off the water. */
export type WaterAt = (x: number, y: number) => { tint: number | undefined } | undefined;

/** A look before its floating texts are added ({@link withFloats}). */
type BareLook = Omit<CodeLook, 'float'>;

function salmonLook(
	art: SalmonsTextures,
	glint: Texture,
	bodyW: number,
	waterAt: WaterAt,
	tintAlpha: number,
	blood: Blood,
): BareLook {
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
	// The original faced a new salmon upstream (`sprite.scale.set(-1, 1)`): its texture faces right.
	let facing = -1;
	let rotation = 0;
	let size = 1;
	let curl = 0;
	let cells = 0;
	let lastMs: number | undefined;
	let pulseAt = -Infinity;
	let flash = { at: -Infinity, ms: 200, next: Math.random() * 1200 };
	let marked = false;
	let climbPose = false;
	let under = false;
	let tintFilter: ColorMatrixFilter | undefined;
	let tinted: number | undefined;
	const redness = createRedness();
	let red = false;
	/** Draw the body under `tint` (the water's), or crisp with none. */
	const tintUnder = (tint: number | undefined) => {
		if (tint === tinted) return;
		tinted = tint;
		if (tint === undefined) {
			body.filters = [];
			return;
		}
		tintFilter ??= new ColorMatrixFilter();
		tintFilter.matrix = underTint(tint, tintAlpha) as ColorMatrixFilter['matrix'];
		body.filters = [tintFilter];
	};

	return {
		mount: mountOf(view),
		hand: undefined,
		middle: drawnH / 2,
		drawn: () => ({
			kind: 'rope',
			region: marked ? 'salmon_golden' : 'salmon_pink',
			lift: liftOf(cells),
			curl,
			climbing: climbPose,
			underwater: under,
			red,
		}),
		event: (event, atMs) => {
			if (event === 'climbed' || event === 'tap') pulseAt = atMs;
		},
		frame: (f) => {
			const now = f.atMs;
			const v = motion(f);
			if (f.marked !== marked) {
				marked = f.marked;
				rope.texture = marked ? golden : pink;
			}
			const target = cellsOf(f.z);
			const dt = lastMs === undefined ? 0 : Math.max(0, now - lastMs) / 1000;
			lastMs = now;
			cells = target <= 0 ? 0 : cells + (target - cells) * Math.min(1, dt * LIFT_FOLLOW);
			const leaping = airborne(cells);
			const jf = jumpFactor(cells);
			body.y = -drawnH / 2 - liftOf(cells);
			const free = f.status === STATUS_FREE;
			const climbing = free && f.held;
			climbPose = climbing;
			if (climbing) {
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
				if (leaping)
					rotation = lerpAngle(rotation, rotation - facing * jf * LEAP.tilt, LEAP.tiltEase);
				curl += (curlTarget(cells) - curl) * LEAP.curlEase;
				const arch = archAt(curl, now) * (texW / OLD_SALMON);
				points.forEach((p, i) => {
					p.y = arch * envelope(i, ROPE_POINTS);
				});
				size = lerp(size, 1 + jf * LEAP.swell, 0.1);
				const period = v.moving ? 400 : 1500;
				const amp = v.moving ? 0.02 : 0.008;
				const squash = Math.sin((now * 2 * Math.PI) / period) * amp;
				body.rotation = rotation;
				body.scale.set(facing * size * (1 + squash), size * (1 - squash));
			}
			const water = waterAt(f.x, f.y);
			under = underwater(cells, water !== undefined, climbing);
			tintUnder(under ? water?.tint : undefined);
			blood.sink(view, under);
			const open = free && under;
			const blooded = redness(open, open && blood.touches(f.x, f.y), now);
			if (blooded.red !== red) {
				red = blooded.red;
				rope.tint = red ? BLOOD.red : 0xffffff;
			}
			if (blooded.shed) blood.shed(f.x, f.y, now);
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
		destroy: () => {
			view.destroy({ children: true });
			tintFilter?.destroy();
		},
	};
}

const SWIPE_MS = 300;

function bearLook(art: SalmonsTextures, bodyW: number): BareLook {
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

function fishermanLook(bodyW: number): BareLook {
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

/** The original's floating text (`game.js` `player_caught`): 11 px, yellow with a black rim,
 *  rising 50 px over 1.8 s from 30 px over the character, fading over its last 30 %. */
const FLOAT = { ms: 1800, rise: 50, above: 30, fadeFrom: 0.7, fontSize: 11, fill: 0xffdd57 };

/** `look` with texts that rise over it, drawn above it in its own place. */
function withFloats(look: BareLook): CodeLook {
	const layer = new Container();
	const texts: { text: Text; atMs: number }[] = [];
	const startY = -look.middle - FLOAT.above * K;
	return {
		...look,
		drawn: () => ({ ...look.drawn(), floats: texts.map(({ text }) => text.text) }),
		mount: (into, app) => {
			const unmount = look.mount(into, app);
			into.addChild(layer);
			return () => {
				into.removeChild(layer);
				unmount();
			};
		},
		frame: (f) => {
			look.frame(f);
			for (let i = texts.length - 1; i >= 0; i--) {
				const { text, atMs } = texts[i];
				const t = (f.atMs - atMs) / FLOAT.ms;
				if (t >= 1) {
					text.destroy();
					texts.splice(i, 1);
					continue;
				}
				text.y = startY - Math.max(0, t) * FLOAT.rise * K;
				text.alpha = t < FLOAT.fadeFrom ? 1 : 1 - (t - FLOAT.fadeFrom) / (1 - FLOAT.fadeFrom);
			}
		},
		float: (value, atMs) => {
			const text = new Text({
				text: value,
				style: {
					fontFamily: PIXEL_FONT,
					fontSize: FLOAT.fontSize * K,
					fill: FLOAT.fill,
					stroke: { color: 0x000000, width: 3 },
					align: 'center',
				},
			});
			text.anchor.set(0.5, 1);
			text.y = startY;
			layer.addChild(text);
			texts.push({ text, atMs });
		},
		destroy: () => {
			layer.destroy({ children: true });
			look.destroy();
		},
	};
}

/** The looks of Salmons' three characters (by character id), or none for another; a salmon is
 *  drawn under the water `waterAt` finds, at `tintAlpha`, and reddened by `blood`'s stains. */
export function createLookFactory(
	art: SalmonsTextures,
	waterAt: WaterAt,
	tintAlpha: number,
	blood: Blood,
) {
	const glint = highlightTexture();
	const bare = (character: string, body: { w: number; h: number }): BareLook | undefined =>
		character === 'salmon'
			? salmonLook(art, glint, body.w, waterAt, tintAlpha, blood)
			: character === 'bear'
				? bearLook(art, body.w)
				: character === 'fisherman'
					? fishermanLook(body.w)
					: undefined;
	return {
		look: (character: string, body: { w: number; h: number }): CodeLook | undefined => {
			const look = bare(character, body);
			return look && withFloats(look);
		},
		destroy: () => glint.destroy(true),
	};
}
