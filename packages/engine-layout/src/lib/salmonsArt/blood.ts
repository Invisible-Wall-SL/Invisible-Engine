import { Container, Graphics, RenderLayer, Sprite, type Application, type Texture } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import { ISO_PROJECTOR, type IsoProjector } from '../projection';
import { seededRandom } from './random';
import { CELL, K } from './scale';

/**
 * SALMONS' BLOODSTAINS (`GuiltyForever/Salmon-` PR #8, `client/game.js` `addBloodstain`,
 * `_updateBloodContact`, `_updateBloodTrail`), in the old client's units scaled by {@link K}:
 * - a stain (a pool of blood) is a blob of four dark-red ellipses, turned up to ±0.2 rad and scaled
 *   0.8–1.3, at the place the room says a salmon died, on water or on land;
 * - a salmon swimming (free, under the water) within `contactCells` of a stain turns red
 *   (`red`, a tint) for `redMs`, and while red and swimming it sheds a puff every `trailEveryMs`
 *   that fades over `trailMs`.
 * ON TOP OF THE WATER, SEE-THROUGH (owner, 2026-11-24). The old client drew the stains in its
 * underwater layer, and this kit copied that picture by mixing the water's tint into their colour
 * and drawing the trail beneath the swimming salmon: the blood looked sunk. Now a pool and a puff
 * are drawn in their own colours, over the water's tint and over whatever swims under the surface
 * ({@link Blood.sink}), under everything that stands on the water or the banks, at the opacity the
 * game's config names (`arcade.online.rules.stains`; {@link BLOOD}`.alpha` / `.trailAlpha` when it
 * names none: 0.3, 70 % transparent).
 * Its colours are brighter than the old client's (0x8a0f12 over a 0x5e0a0d core): at 30 % over
 * blue water the old dark red read as grey, not as blood.
 * Its turn and size are a hash of its place, so every device draws a stain alike.
 */
export const BLOOD = Object.freeze({
	alpha: 0.3,
	turn: 0.4,
	scale: { min: 0.8, spread: 0.5 },
	contactCells: 0.8,
	redMs: 3000,
	red: 0xff3a3a,
	trailEveryMs: 70,
	trailMs: 3000,
	trailAlpha: 0.3,
	trailScale: 0.35,
	colours: { blood: 0xd01018, core: 0x8a0f12 },
});

/** How see-through the blood is drawn: a pool's opacity, and a trail puff's where it is shed. */
export type BloodOpacity = { readonly pool: number; readonly trail: number };

const unit = (value: number | undefined, fallback: number) =>
	typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** The opacities a game's `rules.stains` names (`game-config` `ArcadeOnlineStains`), each held to
 *  0–1; {@link BLOOD}'s where it names none. */
export const bloodOpacity = (
	stains: { opacity?: number; trailOpacity?: number } | undefined,
): BloodOpacity => ({
	pool: unit(stains?.opacity, BLOOD.alpha),
	trail: unit(stains?.trailOpacity, BLOOD.trailAlpha),
});

/** A stain the room left, field px. */
export type Stain = { readonly x: number; readonly y: number };

/** The room's stains as its state holds them (a Colyseus `ArraySchema`, or a plain array). */
export type StainList = {
	readonly length: number;
	at(index: number): Stain | undefined;
};

export type Blood = {
	/**
	 * Drawn with the river, over its water: what swims under the surface, then the trail, then the
	 * stains. The players' layer is drawn after the river, so the blood is over a salmon
	 * {@link Blood.sink}s and under every other instance; nothing outside this kit orders it, so no
	 * other game's runtime carries a byte of it.
	 */
	mount: ArtMount;
	/** Draw `view` (a salmon's look) under the surface while `under`, else in its own place. */
	sink: (view: Container, under: boolean) => void;
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
 * The bloodstains of a room: `ground` is how far the ground at a place is raised (screen px),
 * `opacity` how see-through they are drawn, `projector` the screen's projection (`projection.ts`:
 * Salmons' is mirrored), read as each piece is placed.
 */
export function createBlood(
	ground: (x: number, y: number) => number,
	opacity: BloodOpacity = bloodOpacity(undefined),
	projector: () => IsoProjector = () => ISO_PROJECTOR,
): Blood {
	const reach = BLOOD.contactCells * CELL;
	const reachSq = reach * reach;
	const surface = new Container();
	const wake = new Container();
	// What swims under the surface is drawn here, out of the players' layer, in that layer's depth
	// order: the zIndex `<SpawnLayer>` gives the instance holding it.
	const depthOf = (view: Container) => {
		let at: Container | null = view;
		while (at && at.zIndex === 0) at = at.parent;
		return at?.zIndex ?? 0;
	};
	const sunk = new RenderLayer({
		sortableChildren: true,
		sortFunction: (a, b) => depthOf(a) - depthOf(b),
	});
	let app: Application | undefined;
	let texture: Texture | undefined;
	let stains: Stain[] = [];
	let key = '';
	let dirty = false;
	const trail: { sprite: Sprite; atMs: number }[] = [];

	/** The stain's texture, in its own colours: it lies on the water, not under its tint. */
	const stainTexture = (): Texture | undefined => {
		if (!app) return undefined;
		if (!texture) {
			const { blood, core } = BLOOD.colours;
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
		}
		return texture;
	};

	/** A sprite of the stain's texture standing at world (x, y), raised with the ground there. */
	const placed = (x: number, y: number): Sprite | undefined => {
		const drawn = stainTexture();
		if (!drawn) return undefined;
		const sprite = new Sprite(drawn);
		sprite.anchor.set(0.5);
		const lift = ground(x, y);
		// Raised straight up the screen by the ground's lift, on either projection.
		const at = projector().project(x - lift, y - lift);
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
			sprite.alpha = opacity.pool;
			sprite.rotation = (random() - 0.5) * BLOOD.turn;
			sprite.scale.set(K * (BLOOD.scale.min + random() * BLOOD.scale.spread));
			surface.addChild(sprite);
		}
	};

	return {
		mount: (into, pixi) => {
			app = pixi;
			// Bottom to top: what swims under the surface, the trail it leaves, the pools.
			into.addChild(sunk, wake, surface);
			redraw();
			return () => {
				sunk.detachAll();
				into.removeChild(sunk, wake, surface);
			};
		},
		sink: (view, under) => {
			// Only while the river is drawn: a view in a layer that is not is not drawn at all.
			const sinking = under && sunk.parent !== null && view.parent !== null;
			if (sinking && view.parentRenderLayer !== sunk) sunk.attach(view);
			else if (!sinking && view.parentRenderLayer === sunk) sunk.detach(view);
		},
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
				} else puff.sprite.alpha = opacity.trail * (1 - Math.max(0, t));
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
			sprite.alpha = opacity.trail;
			wake.addChild(sprite);
			trail.push({ sprite, atMs: nowMs });
		},
		drawn: () => ({ stains: surface.children.length, trail: trail.length }),
		destroy: () => {
			sunk.detachAll();
			sunk.destroy();
			surface.destroy({ children: true });
			wake.destroy({ children: true });
			trail.length = 0;
			texture?.destroy(true);
			texture = undefined;
		},
	};
}
