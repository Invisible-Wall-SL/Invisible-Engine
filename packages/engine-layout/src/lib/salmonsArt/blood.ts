import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import type { WaterAt } from './looks';
import { seededRandom } from './random';
import { CELL, K } from './scale';

/**
 * SALMONS' BLOODSTAINS AS THE OLD CLIENT DREW THEM (`GuiltyForever/Salmon-` PR #8, `client/game.js`
 * `addBloodstain`, `_updateBloodContact`, `_updateBloodTrail`), in its own units scaled by {@link K}:
 * - a stain is a blob of four dark-red ellipses at {@link BLOOD}`.alpha`, turned up to ±0.2 rad and
 *   scaled 0.8–1.3, at the place the room says a salmon died. The old client drew it in its
 *   underwater layer, over the swimming salmon and under the water's tint; here the river's tint is
 *   drawn before the players, so the stain is drawn in the tint's colour mixed in (as a swimming
 *   salmon is, `leap.ts` `underTint`), which is exactly the old picture, over the salmon drawn under
 *   the surface (`arcadeArt.svelte.ts` `LayerArt`) and under everything above it;
 * - a salmon swimming (free, under the water) within `contactCells` of a stain turns red
 *   (`red`, a tint) for `redMs`, and while red and swimming it sheds a puff every `trailEveryMs`,
 *   under the swimming salmon, that fades from `trailAlpha` over `trailMs`.
 * Its turn and size are a hash of its place, so every device draws a stain alike.
 */
export const BLOOD = Object.freeze({
	alpha: 0.35,
	turn: 0.4,
	scale: { min: 0.8, spread: 0.5 },
	contactCells: 0.8,
	redMs: 3000,
	red: 0xff3a3a,
	trailEveryMs: 70,
	trailMs: 3000,
	trailAlpha: 0.5,
	trailScale: 0.35,
	colours: { blood: 0x8a0f12, core: 0x5e0a0d },
});

/** A stain the room left, field px. */
export type Stain = { readonly x: number; readonly y: number };

/** The room's stains as its state holds them (a Colyseus `ArraySchema`, or a plain array). */
export type StainList = {
	readonly length: number;
	at(index: number): Stain | undefined;
};

export type Blood = {
	/** Drawn over what swims under the surface, and under the rest. */
	surface: ArtMount;
	/** Drawn under what swims. */
	wake: ArtMount;
	/** This frame: the room's stains (redrawn only when they changed) and the trail's fade. */
	frame: (stains: StainList | undefined, nowMs: number) => void;
	/** Whether a body at world (x, y) touches a stain. */
	touches: (x: number, y: number) => boolean;
	/** A puff of the trail where a red salmon swims, world (x, y). */
	shed: (x: number, y: number, nowMs: number) => void;
	/** What it draws now (the probe's). */
	drawn: () => { stains: number; trail: number };
	destroy: () => void;
};

/** `(1 − alpha) · c + alpha · tint` per channel: a colour drawn under the water's tint. */
export const underTintColour = (c: number, tint: number | undefined, alpha: number) => {
	if (tint === undefined) return c;
	const mix = (shift: number) =>
		Math.round(((c >> shift) & 0xff) * (1 - alpha) + ((tint >> shift) & 0xff) * alpha);
	return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};

const project = (x: number, y: number) => ({ x: x - y, y: (x + y) / 2 });

/**
 * A salmon's redness ({@link BLOOD}): told each frame whether it swims (free, under the water) and
 * whether it is in a stain, it says whether it is red (for `redMs` after it last swam in one) and
 * whether to shed a puff of its trail now (red and swimming, one each `trailEveryMs`).
 */
export function createRedness() {
	let until = -Infinity;
	let shedAt = -Infinity;
	return (swimming: boolean, inStain: boolean, nowMs: number) => {
		if (swimming && inStain) until = nowMs + BLOOD.redMs;
		const red = until > nowMs;
		const shed = red && swimming && nowMs - shedAt >= BLOOD.trailEveryMs;
		if (shed) shedAt = nowMs;
		return { red, shed };
	};
}

/**
 * The bloodstains of a room: `waterAt` finds the water (and its tint, at `tintAlpha`) under a
 * place, `ground` how far the ground there is raised (screen px).
 */
export function createBlood(
	waterAt: WaterAt,
	ground: (x: number, y: number) => number,
	tintAlpha: number,
): Blood {
	const reach = BLOOD.contactCells * CELL;
	const reachSq = reach * reach;
	const surface = new Container();
	const wake = new Container();
	let app: Application | undefined;
	const textures = new Map<number | 'dry', Texture>();
	let stains: Stain[] = [];
	let key = '';
	let dirty = false;
	const trail: { sprite: Sprite; atMs: number }[] = [];

	/** The stain's texture under the water at a place: its colours mixed with that water's tint. */
	const textureAt = (x: number, y: number): Texture | undefined => {
		if (!app) return undefined;
		const tint = waterAt(x, y)?.tint;
		const id = tint ?? 'dry';
		let texture = textures.get(id);
		if (!texture) {
			const blood = underTintColour(BLOOD.colours.blood, tint, tintAlpha);
			const core = underTintColour(BLOOD.colours.core, tint, tintAlpha);
			const g = new Graphics()
				.ellipse(0, 0, 30, 15)
				.fill(blood)
				.ellipse(-12, 3, 14, 7)
				.fill(blood)
				.ellipse(14, -4, 12, 6)
				.fill(blood)
				.ellipse(2, 0, 16, 8)
				.fill(core);
			texture = app.renderer.generateTexture({ target: g, resolution: 2 });
			g.destroy();
			textures.set(id, texture);
		}
		return texture;
	};

	/** A sprite of the stain's texture standing at world (x, y), raised with the ground there. */
	const placed = (x: number, y: number): Sprite | undefined => {
		const texture = textureAt(x, y);
		if (!texture) return undefined;
		const sprite = new Sprite(texture);
		sprite.anchor.set(0.5);
		const lift = ground(x, y);
		const at = project(x - lift, y - lift);
		sprite.position.set(at.x, at.y);
		return sprite;
	};

	const redraw = () => {
		if (!app || !dirty) return;
		dirty = false;
		for (const child of surface.removeChildren()) child.destroy();
		for (const { x, y } of stains) {
			const sprite = placed(x, y);
			if (!sprite) continue;
			const random = seededRandom(`salmons-stain:${x}:${y}`);
			sprite.alpha = BLOOD.alpha;
			sprite.rotation = (random() - 0.5) * BLOOD.turn;
			sprite.scale.set(K * (BLOOD.scale.min + random() * BLOOD.scale.spread));
			surface.addChild(sprite);
		}
	};

	const mountOf =
		(view: Container): ArtMount =>
		(into, pixi) => {
			app = pixi;
			into.addChild(view);
			redraw();
			return () => {
				into.removeChild(view);
			};
		};

	return {
		surface: mountOf(surface),
		wake: mountOf(wake),
		frame: (list, nowMs) => {
			// The room only adds at the end and lets go at the start: its length and ends say it all.
			const n = list?.length ?? 0;
			const first = list?.at(0);
			const last = list?.at(n - 1);
			const next = first && last ? `${n}:${first.x},${first.y}:${last.x},${last.y}` : '';
			if (next !== key) {
				key = next;
				stains = [];
				for (let i = 0; i < n; i++) {
					const s = list?.at(i);
					if (s) stains.push({ x: s.x, y: s.y });
				}
				dirty = true;
			}
			redraw();
			for (let i = trail.length - 1; i >= 0; i--) {
				const puff = trail[i];
				const t = (nowMs - puff.atMs) / BLOOD.trailMs;
				if (t >= 1) {
					puff.sprite.destroy();
					trail.splice(i, 1);
				} else puff.sprite.alpha = BLOOD.trailAlpha * (1 - Math.max(0, t));
			}
		},
		touches: (x, y) =>
			stains.some((s) => {
				const dx = x - s.x;
				const dy = y - s.y;
				return dx * dx + dy * dy < reachSq;
			}),
		shed: (x, y, nowMs) => {
			const sprite = placed(x, y);
			if (!sprite) return;
			sprite.scale.set(K * BLOOD.trailScale);
			sprite.alpha = BLOOD.trailAlpha;
			wake.addChild(sprite);
			trail.push({ sprite, atMs: nowMs });
		},
		drawn: () => ({ stains: surface.children.length, trail: trail.length }),
		destroy: () => {
			surface.destroy({ children: true });
			wake.destroy({ children: true });
			trail.length = 0;
			for (const texture of textures.values()) texture.destroy(true);
			textures.clear();
		},
	};
}
