/**
 * The BREAK kinds (`crash`, `crumble`, `shatter`, `crystallize`, `disintegrate`, and `assemble`,
 * which plays dust backwards): the element is rendered to a texture, hidden, and the still is cut
 * into pieces that fly. The pieces live in a few small `MeshSimple`s the batcher draws together: each frame
 * moves their vertices. The pieces sit in a holder placed beside the element (same parent, same
 * depth, its resting transform), so they draw where it drew.
 *
 * Mostly a still: a playing rig freezes on the frame it broke on, which is what breaking glass would
 * do too. A LIVE break ({@link BreakOptions.live}, `assemble`) is redrawn from the element every
 * frame instead, and laid over wherever the element now rests and whatever box it now fills.
 */

import {
	Container,
	Graphics,
	MeshSimple,
	Matrix,
	Rectangle,
	RenderTexture,
	Sprite,
	type Renderer,
	type Texture,
} from 'pixi.js';
import { EFX_SIDES } from 'constants-shared/glslLibrary';
import { clamp01, easeOutBack, rgb, smoothstep } from './frame';
import type { BreakStyle } from './kinds';
import { freezeFilter } from './shaders';

export interface BreakRun {
	/** Pose the pieces at `t` (0…1 of the play). */
	update(t: number): void;
	/**
	 * A live break only: redraw the pieces from the element as it is now, laid over `box` (its box
	 * now, in its own space; undefined keeps the last) where it now rests (`rest`, with `alpha`).
	 */
	follow?(rest: Matrix, alpha: number, box: Rectangle | undefined): void;
	destroy(): void;
}

export interface BreakOptions {
	style: BreakStyle;
	target: Container;
	renderer: Renderer;
	/** The element's box in its own space: what is cut up. */
	box: Rectangle;
	/** The element's resting local transform: where the pieces start. */
	rest: Matrix;
	intensity: number;
	params: Readonly<Record<string, unknown>>;
	playSeconds: number;
	/** Show the live element: the run gets a {@link BreakRun.follow} to call every frame. */
	live?: boolean;
	/** The pieces' alpha, a still's (a live break's is given each frame). Unset ⇒ 1. */
	alpha?: number;
}

/** A small seeded generator, so one break is laid out the same way however often it is posed. */
const random = (seed: number) => {
	let s = Math.floor(seed * 2147483646) % 2147483647 || 1;
	return (): number => {
		s = (s * 16807) % 2147483647;
		return (s - 1) / 2147483646;
	};
};

/** Pixi batches a mesh up to 100 vertices; past that it draws it alone. */
const MAX_BATCHED_VERTICES = 96;

const param = (params: Readonly<Record<string, unknown>>, id: string, fallback: number): number => {
	const v = params[id];
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

interface Piece {
	/** Vertex offsets from the piece's centre at rest. */
	rel: number[];
	cx: number;
	cy: number;
	vx: number;
	vy: number;
	spin: number;
	/** Crumble and dust: the share of the play before it lets go. */
	delay: number;
	/** Dust only: how far it sways across the wind, and where in the sway it starts. */
	sway: number;
	phase: number;
	/** Glass and ice: how fast it tumbles end over end, and when the cracks (glass) or the ice
	 *  (ice) reach it, a share of the play. */
	tumble: number;
	reachedAt: number;
}

/** A crack line in a pane, drawn from its end nearer the impact as the cracks spread past it. */
interface Crack {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** How far from the impact the line starts and ends. */
	near: number;
	far: number;
	/** A ring crack, drawn finer than the spokes that run out from the impact. */
	ring: boolean;
}

/**
 * The pieces' layout: vertices around each piece's centre, uvs into the still, triangle indices. A
 * piece of n vertices is a fan of n − 2 triangles, its indices in piece order.
 */
interface Cut {
	pieces: Piece[];
	uvs: Float32Array;
	indices: Uint32Array;
	/** Glass: the impact, how far the cracks run, and the crack lines. */
	cracks?: { x: number; y: number; reach: number; lines: Crack[] };
	/** Ice: when it bursts, how long one facet takes to ice over, when the last has, and the
	 *  points that twinkle while it holds ([x, y, phase]). */
	ice?: { burst: number; grow: number; iced: number; sparkles: number[][] };
}

const gridSize = (count: number, w: number, h: number): { cols: number; rows: number } => {
	const rows = Math.max(1, Math.round(Math.sqrt((count * h) / Math.max(w, 1))));
	const cols = Math.max(1, Math.round(count / rows));
	return { cols, rows };
};

/** Crash: a jittered grid cut into triangles, thrown out from the centre. */
const cutShards = (box: Rectangle, options: BreakOptions, rand: () => number): Cut => {
	const { width: w, height: h } = box;
	const size = Math.max(w, h);
	const { cols, rows } = gridSize(Math.max(2, param(options.params, 'pieces', 18) / 2), w, h);
	const force = param(options.params, 'force', 1) * Math.max(0.2, options.intensity);
	const points: number[][] = [];
	for (let r = 0; r <= rows; r++) {
		for (let c = 0; c <= cols; c++) {
			const edgeX = c === 0 || c === cols;
			const edgeY = r === 0 || r === rows;
			const jx = edgeX ? 0 : (rand() - 0.5) * 0.7 * (w / cols);
			const jy = edgeY ? 0 : (rand() - 0.5) * 0.7 * (h / rows);
			points.push([box.x + (c / cols) * w + jx, box.y + (r / rows) * h + jy]);
		}
	}
	const at = (c: number, r: number): number[] => points[r * (cols + 1) + c];
	const impactX = box.x + w * (0.5 + (rand() - 0.5) * 0.2);
	const impactY = box.y + h * (0.5 + (rand() - 0.5) * 0.2);
	const triangles: number[][][] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const [a, b, d, e] = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
			if ((r + c) % 2 === 0) triangles.push([a, b, d], [a, d, e]);
			else triangles.push([a, b, e], [b, d, e]);
		}
	}
	const uvs = new Float32Array(triangles.length * 6);
	const indices = new Uint32Array(triangles.length * 3);
	const pieces = triangles.map((tri, i) => {
		const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
		const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
		tri.forEach(([x, y], k) => {
			uvs[i * 6 + k * 2] = (x - box.x) / w;
			uvs[i * 6 + k * 2 + 1] = (y - box.y) / h;
			indices[i * 3 + k] = i * 3 + k;
		});
		let dx = cx - impactX;
		let dy = cy - impactY;
		const len = Math.hypot(dx, dy);
		if (len < 1e-3) {
			const a = rand() * Math.PI * 2;
			dx = Math.cos(a);
			dy = Math.sin(a);
		} else {
			dx /= len;
			dy /= len;
		}
		const speed = (0.5 + rand()) * force * size * 1.1;
		return {
			rel: tri.flatMap(([x, y]) => [x - cx, y - cy]),
			cx,
			cy,
			vx: dx * speed,
			vy: dy * speed - 0.35 * force * size,
			spin: (rand() - 0.5) * 10 * force,
			delay: 0,
			sway: 0,
			phase: 0,
			tumble: 0,
			reachedAt: 0,
		};
	});
	return { pieces, uvs, indices };
};

/** Crumble: square chunks that let go bottom row first and drop. */
const cutChunks = (box: Rectangle, options: BreakOptions, rand: () => number): Cut => {
	const { width: w, height: h } = box;
	const size = Math.max(w, h);
	const { cols, rows } = gridSize(param(options.params, 'pieces', 120), w, h);
	const spread = param(options.params, 'spread', 0.4) * Math.max(0.2, options.intensity);
	const count = cols * rows;
	const uvs = new Float32Array(count * 8);
	const indices = new Uint32Array(count * 6);
	const pieces: Piece[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const i = r * cols + c;
			const x0 = box.x + (c / cols) * w;
			const x1 = box.x + ((c + 1) / cols) * w;
			const y0 = box.y + (r / rows) * h;
			const y1 = box.y + ((r + 1) / rows) * h;
			const cx = (x0 + x1) / 2;
			const cy = (y0 + y1) / 2;
			const corners = [
				[x0, y0],
				[x1, y0],
				[x1, y1],
				[x0, y1],
			];
			corners.forEach(([x, y], k) => {
				uvs[i * 8 + k * 2] = (x - box.x) / w;
				uvs[i * 8 + k * 2 + 1] = (y - box.y) / h;
			});
			indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
			pieces.push({
				rel: corners.flatMap(([x, y]) => [x - cx, y - cy]),
				cx,
				cy,
				vx: (rand() - 0.5) * spread * size * 0.8,
				vy: -rand() * 0.15 * h,
				spin: (rand() - 0.5) * 5,
				delay: 0.45 * (1 - (r + 0.5) / rows) + 0.1 * rand(),
				sway: 0,
				phase: 0,
				tumble: 0,
				reachedAt: 0,
			});
		}
	}
	return { pieces, uvs, indices };
};

/** Where a dissolve's wind blows, on the screen (y down). */
const WIND: Record<string, readonly [number, number]> = {
	upRight: [Math.SQRT1_2, -Math.SQRT1_2],
	up: [0, -1],
	upLeft: [-Math.SQRT1_2, -Math.SQRT1_2],
	right: [1, 0],
	left: [-1, 0],
	down: [0, 1],
};

/** The wind a dissolve's `drift` param names; up and to the right when it names none. */
export const dustWind = (params: Readonly<Record<string, unknown>>): readonly [number, number] =>
	WIND[String(params.drift)] ?? WIND.upRight;

/** The share of the play one speck flies for; the last lets go this long before the end. */
const DUST_LIFE = 0.38;

/** A smooth random field over the unit square (value noise on a 5 × 5 lattice): what makes the
 *  dissolve's front ragged rather than a straight line. */
const valueNoise = (rand: () => number): ((u: number, v: number) => number) => {
	const n = 5;
	const lattice = Array.from({ length: (n + 1) * (n + 1) }, rand);
	const at = (i: number, j: number): number => lattice[j * (n + 1) + i];
	return (u, v) => {
		const x = clamp01(u) * n;
		const y = clamp01(v) * n;
		const i = Math.min(n - 1, Math.floor(x));
		const j = Math.min(n - 1, Math.floor(y));
		const fx = smoothstep(0, 1, x - i);
		const fy = smoothstep(0, 1, y - j);
		const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
		const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
		return top + (bottom - top) * fy;
	};
};

/**
 * Dust: square specks that let go in a ragged front, the side the wind blows towards first (so
 * the specks blow off clear of what is left), and drift away on it, swaying, turning and shrinking
 * to nothing.
 */
const cutSpecks = (box: Rectangle, options: BreakOptions, rand: () => number): Cut => {
	const { width: w, height: h } = box;
	const size = Math.max(w, h);
	const { cols, rows } = gridSize(param(options.params, 'particles', 700), w, h);
	const [wx, wy] = dustWind(options.params);
	const turbulence = param(options.params, 'turbulence', 0.6);
	const strength = Math.max(0.2, options.intensity);
	const noise = valueNoise(rand);
	// How far along the wind each corner of the box lies: the front runs from the leading corner.
	const reach = (u: number, v: number): number => u * wx + v * wy;
	const lead = Math.max(reach(0, 0), reach(1, 0), reach(0, 1), reach(1, 1));
	const trail = Math.min(reach(0, 0), reach(1, 0), reach(0, 1), reach(1, 1));
	const count = cols * rows;
	const uvs = new Float32Array(count * 8);
	const indices = new Uint32Array(count * 6);
	const pieces: Piece[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const i = r * cols + c;
			const x0 = box.x + (c / cols) * w;
			const x1 = box.x + ((c + 1) / cols) * w;
			const y0 = box.y + (r / rows) * h;
			const y1 = box.y + ((r + 1) / rows) * h;
			const u = (c + 0.5) / cols;
			const v = (r + 0.5) / rows;
			const corners = [
				[x0, y0],
				[x1, y0],
				[x1, y1],
				[x0, y1],
			];
			corners.forEach(([x, y], k) => {
				uvs[i * 8 + k * 2] = (x - box.x) / w;
				uvs[i * 8 + k * 2 + 1] = (y - box.y) / h;
			});
			indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
			const order = (lead - reach(u, v)) / Math.max(lead - trail, 1e-6);
			const front = 0.72 * order + 0.22 * noise(u, v) + 0.06 * rand();
			const speed = (0.45 + 0.9 * rand()) * size * strength;
			const across = (rand() - 0.5) * turbulence * size * 0.35;
			pieces.push({
				rel: corners.flatMap(([x, y]) => [x - (x0 + x1) / 2, y - (y0 + y1) / 2]),
				cx: (x0 + x1) / 2,
				cy: (y0 + y1) / 2,
				vx: wx * speed - wy * across,
				vy: wy * speed + wx * across,
				spin: (rand() - 0.5) * 8,
				delay: Math.min(1 - DUST_LIFE, front * (1 - DUST_LIFE)),
				sway: turbulence * (0.02 + 0.05 * rand()) * size,
				phase: rand() * Math.PI * 2,
				tumble: 0,
				reachedAt: 0,
			});
		}
	}
	return { pieces, uvs, indices };
};

/** Where a pane takes its hit, as shares of its box; `random` anywhere in its middle. */
const IMPACT: Record<string, readonly [number, number]> = {
	center: [0.5, 0.5],
	top: [0.5, 0.18],
	bottom: [0.5, 0.82],
	left: [0.18, 0.5],
	right: [0.82, 0.5],
};

/** The share of a shard's size its crack opens to. */
const GLASS_GAP = 0.03;

/** How far the cracks have run at `u` (0…1 of the cracking): fast from the hit, then slowing. */
const crackFront = (u: number): number => 1 - (1 - clamp01(u)) ** 2;

/** `polygon` (points) clipped to `box` (Sutherland–Hodgman); fewer than 3 points when outside. */
const clipToBox = (polygon: number[][], box: Rectangle): number[][] => {
	const sides: [axis: 0 | 1, bound: number, keep: 1 | -1][] = [
		[0, box.x, 1],
		[0, box.x + box.width, -1],
		[1, box.y, 1],
		[1, box.y + box.height, -1],
	];
	let out = polygon;
	for (const [axis, bound, keep] of sides) {
		const input = out;
		out = [];
		for (let i = 0; i < input.length; i++) {
			const a = input[i];
			const b = input[(i + 1) % input.length];
			const aIn = keep * (a[axis] - bound) >= 0;
			const bIn = keep * (b[axis] - bound) >= 0;
			if (aIn) out.push(a);
			if (aIn !== bIn) {
				const k = (bound - a[axis]) / (b[axis] - a[axis]);
				out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
			}
		}
	}
	return out;
};

/** The part of segment `a`–`b` inside `box` (Liang–Barsky), or null. */
const clipSegment = (a: number[], b: number[], box: Rectangle): number[][] | null => {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	let t0 = 0;
	let t1 = 1;
	const edges: [number, number][] = [
		[-dx, a[0] - box.x],
		[dx, box.x + box.width - a[0]],
		[-dy, a[1] - box.y],
		[dy, box.y + box.height - a[1]],
	];
	for (const [p, q] of edges) {
		if (p === 0) {
			if (q < 0) return null;
			continue;
		}
		const r = q / p;
		if (p < 0) t0 = Math.max(t0, r);
		else t1 = Math.min(t1, r);
		if (t0 > t1) return null;
	}
	return [
		[a[0] + dx * t0, a[1] + dy * t0],
		[a[0] + dx * t1, a[1] + dy * t1],
	];
};

/**
 * Glass: a spiderweb fracture. Spokes run out from the impact and irregular rings cross them,
 * denser near the hit; each cell, clipped to the box, is a shard. The cracks spread from the
 * impact over the first `crack` of the play, opening a hairline gap round each shard they reach;
 * then the pane falls in, the shards by the impact first, each pushed out from it a little,
 * coming towards the viewer, tumbling end over end and dropping.
 */
const cutGlass = (box: Rectangle, options: BreakOptions, rand: () => number): Cut => {
	const { width: w, height: h } = box;
	const size = Math.max(w, h);
	const count = param(options.params, 'pieces', 56);
	const spokes = Math.max(5, Math.round(Math.sqrt(count * 1.5)));
	const rings = Math.max(2, Math.round(count / spokes));
	const crack = param(options.params, 'crack', 0.3);
	const force = Math.max(0.2, options.intensity);
	const named = IMPACT[String(options.params.impact)];
	const [iu, iv] = named ?? [0.25 + 0.5 * rand(), 0.25 + 0.5 * rand()];
	const ix = box.x + iu * w;
	const iy = box.y + iv * h;
	const corners = [
		[box.x, box.y],
		[box.x + w, box.y],
		[box.x, box.y + h],
		[box.x + w, box.y + h],
	];
	const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x - ix, y - iy)), 1);
	const turn = rand() * Math.PI * 2;
	const angles = Array.from(
		{ length: spokes },
		(_, i) => turn + ((i + (rand() - 0.5) * 0.6) / spokes) * Math.PI * 2,
	);
	// The outer ring is a polygon of chords: far enough out that every chord clears the corners.
	const widest = Math.max(
		...angles.map((a, i) => (i + 1 < spokes ? angles[i + 1] : angles[0] + Math.PI * 2) - a),
	);
	const radii = Array.from({ length: rings + 1 }, (_, j) =>
		j === rings ? (reach * 1.05) / Math.cos(widest / 2) : reach * (j / rings) ** 1.35,
	);
	// Each crossing of a spoke and a ring moves along its spoke by under a third of the gap to the
	// next ring, so the rings stay in order and every cell stays convex.
	const at = Array.from({ length: spokes }, (_, i) =>
		radii.map((r, j) => {
			const gap = j === 0 || j === rings ? 0 : Math.min(r - radii[j - 1], radii[j + 1] - r);
			const rr = r + (rand() - 0.5) * 0.6 * gap;
			return [ix + Math.cos(angles[i]) * rr, iy + Math.sin(angles[i]) * rr];
		}),
	);
	const uvs: number[] = [];
	const indices: number[] = [];
	const pieces: Piece[] = [];
	for (let i = 0; i < spokes; i++) {
		const next = (i + 1) % spokes;
		for (let j = 0; j < rings; j++) {
			const cell =
				j === 0
					? [[ix, iy], at[i][1], at[next][1]]
					: [at[i][j], at[next][j], at[next][j + 1], at[i][j + 1]];
			const shard = clipToBox(cell, box);
			if (shard.length < 3) continue;
			const cx = shard.reduce((sum, p) => sum + p[0], 0) / shard.length;
			const cy = shard.reduce((sum, p) => sum + p[1], 0) / shard.length;
			const first = uvs.length / 2;
			for (const [x, y] of shard) uvs.push((x - box.x) / w, (y - box.y) / h);
			for (let k = 1; k < shard.length - 1; k++) indices.push(first, first + k, first + k + 1);
			const dx = cx - ix;
			const dy = cy - iy;
			const away = Math.hypot(dx, dy);
			const reached = Math.min(1, away / reach);
			const push = (0.12 + 0.3 * rand()) * size * force;
			pieces.push({
				rel: shard.flatMap(([x, y]) => [x - cx, y - cy]),
				cx,
				cy,
				vx: away > 1e-3 ? (dx / away) * push : 0,
				vy: (away > 1e-3 ? (dy / away) * push : 0) - 0.12 * size * force,
				spin: (rand() - 0.5) * 3,
				delay: crack + (1 - crack) * (0.06 + 0.32 * reached + 0.08 * rand()),
				sway: 0,
				phase: 0,
				tumble: (2.5 + 4 * rand()) * (rand() < 0.5 ? -1 : 1),
				reachedAt: crack * (1 - Math.sqrt(1 - reached)),
			});
		}
	}
	const lines: Crack[] = [];
	const segment = (a: number[], b: number[], ring: boolean): void => {
		const inside = clipSegment(a, b, box);
		if (!inside) return;
		const da = Math.hypot(inside[0][0] - ix, inside[0][1] - iy);
		const db = Math.hypot(inside[1][0] - ix, inside[1][1] - iy);
		const [p, q] = da <= db ? inside : [inside[1], inside[0]];
		lines.push({
			x0: p[0],
			y0: p[1],
			x1: q[0],
			y1: q[1],
			near: Math.min(da, db),
			far: Math.max(da, db),
			ring,
		});
	};
	// Every spoke shows; a quarter of the ring cracks stay hidden (the shards still part there).
	for (let i = 0; i < spokes; i++) {
		segment([ix, iy], at[i][rings], false);
		for (let j = 1; j < rings; j++) {
			if (rand() < 0.75) segment(at[i][j], at[(i + 1) % spokes][j], true);
		}
	}
	return {
		pieces,
		uvs: new Float32Array(uvs),
		indices: new Uint32Array(indices),
		cracks: { x: ix, y: iy, reach, lines },
	};
};

/** Where the ice starts, as shares of the box; `edges` creeps in from all four sides. */
const ICE_FROM: Record<string, readonly [number, number]> = {
	center: [0.5, 0.5],
	bottom: [0.5, 1],
	top: [0.5, 0],
};

/** The share of a shard's size its seam opens to as the ice creaks, just before it bursts. */
const ICE_GAP = 0.04;

/** The part of convex `polygon` on the side of the line through (mx, my) away from (nx, ny):
 *  where `(p − m) · n ≤ 0`. */
const clipHalfPlane = (
	polygon: number[][],
	mx: number,
	my: number,
	nx: number,
	ny: number,
): number[][] => {
	const out: number[][] = [];
	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % polygon.length];
		const da = (a[0] - mx) * nx + (a[1] - my) * ny;
		const db = (b[0] - mx) * nx + (b[1] - my) * ny;
		if (da <= 0) out.push(a);
		if (da <= 0 !== db <= 0) {
			const k = da / (da - db);
			out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
		}
	}
	return out;
};

/**
 * Ice: crystal facets, the cells of seeds jittered off a grid (each the part of the box nearer its
 * seed than any other), each a shard. Over the first 70% of the crystallizing (`freeze`) the ice
 * spreads from `from`, each facet icing over from its own centre as the front reaches it; the
 * facets hold, their seams creak open, and at `freeze` it bursts out from its middle, the shards
 * tumbling end over end, glinting as they turn, and falling.
 */
const cutIce = (box: Rectangle, options: BreakOptions, rand: () => number): Cut => {
	const { width: w, height: h } = box;
	const size = Math.max(w, h);
	const burst = param(options.params, 'freeze', 0.45);
	const grow = 0.12 * burst;
	const force = Math.max(0.2, options.intensity);
	const { cols, rows } = gridSize(param(options.params, 'pieces', 28), w, h);
	const seeds: number[][] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			seeds.push([
				box.x + ((c + 0.5 + (rand() - 0.5) * 0.8) / cols) * w,
				box.y + ((r + 0.5 + (rand() - 0.5) * 0.8) / rows) * h,
			]);
		}
	}
	const start = ICE_FROM[String(options.params.from)];
	const sx = start ? box.x + start[0] * w : 0;
	const sy = start ? box.y + start[1] * h : 0;
	const farthest = start
		? Math.max(
				...[
					[box.x, box.y],
					[box.right, box.y],
					[box.x, box.bottom],
					[box.right, box.bottom],
				].map(([x, y]) => Math.hypot(x - sx, y - sy)),
				1,
			)
		: 1;
	/** How far the ice has to come to reach (x, y), 0…1. */
	const order = (x: number, y: number): number => {
		if (start) return Math.hypot(x - sx, y - sy) / farthest;
		const u = (x - box.x) / w;
		const v = (y - box.y) / h;
		return 2 * Math.min(u, 1 - u, v, 1 - v);
	};
	const mx = box.x + w / 2;
	const my = box.y + h / 2;
	const rect = [
		[box.x, box.y],
		[box.right, box.y],
		[box.right, box.bottom],
		[box.x, box.bottom],
	];
	const uvs: number[] = [];
	const indices: number[] = [];
	const pieces: Piece[] = [];
	const sparkles: number[][] = [];
	for (let i = 0; i < seeds.length; i++) {
		const [ax, ay] = seeds[i];
		let cell = rect;
		for (let j = 0; j < seeds.length && cell.length >= 3; j++) {
			if (j === i) continue;
			const [bx, by] = seeds[j];
			cell = clipHalfPlane(cell, (ax + bx) / 2, (ay + by) / 2, bx - ax, by - ay);
		}
		if (cell.length < 3) continue;
		const cx = cell.reduce((sum, p) => sum + p[0], 0) / cell.length;
		const cy = cell.reduce((sum, p) => sum + p[1], 0) / cell.length;
		const first = uvs.length / 2;
		for (const [x, y] of cell) uvs.push((x - box.x) / w, (y - box.y) / h);
		for (let k = 1; k < cell.length - 1; k++) indices.push(first, first + k, first + k + 1);
		if (rand() < 0.4)
			sparkles.push([...cell[Math.floor(rand() * cell.length)], rand() * Math.PI * 2]);
		let dx = cx - mx;
		let dy = cy - my;
		const away = Math.hypot(dx, dy);
		if (away < 1e-3) {
			const a = rand() * Math.PI * 2;
			dx = Math.cos(a);
			dy = Math.sin(a);
		} else {
			dx /= away;
			dy /= away;
		}
		const speed = (0.35 + 0.55 * rand()) * size * force;
		pieces.push({
			rel: cell.flatMap(([x, y]) => [x - cx, y - cy]),
			cx,
			cy,
			vx: dx * speed,
			vy: dy * speed - 0.3 * size * force,
			spin: (rand() - 0.5) * 5,
			delay: burst + (1 - burst) * 0.05 * rand(),
			sway: 0,
			phase: 0,
			tumble: (3 + 5 * rand()) * (rand() < 0.5 ? -1 : 1),
			reachedAt: burst * (0.62 * order(cx, cy) + 0.08 * rand()),
		});
	}
	const iced = Math.max(0, ...pieces.map((piece) => piece.reachedAt)) + grow;
	return {
		pieces,
		uvs: new Float32Array(uvs),
		indices: new Uint32Array(indices),
		ice: { burst, grow, iced, sparkles },
	};
};

const CUTS: Record<BreakStyle, (box: Rectangle, options: BreakOptions, rand: () => number) => Cut> =
	{
		crash: cutShards,
		crumble: cutChunks,
		glass: cutGlass,
		ice: cutIce,
		dust: cutSpecks,
	};

/** The still of `target`'s box, without leaving it a render group if it was not one. */
const snapshot = (renderer: Renderer, target: Container, box: Rectangle) => {
	const wasGroup = target.isRenderGroup;
	const texture = renderer.generateTexture({ target, frame: box, antialias: true });
	if (!wasGroup && target.isRenderGroup) target.disableRenderGroup();
	return texture;
};

/** The largest side, in pixels, a live break's texture grows to. */
const MAX_LIVE_PX = 4096;

/** The size, in points, of a live break's texture for `box`, capped at {@link MAX_LIVE_PX}. */
const liveSize = (renderer: Renderer, box: Rectangle): { width: number; height: number } => {
	const fit = Math.min(1, MAX_LIVE_PX / (Math.max(box.width, box.height) * renderer.resolution));
	return {
		width: Math.max(1, Math.floor(box.width * fit)),
		height: Math.max(1, Math.floor(box.height * fit)),
	};
};

/** Drawn every frame, so no multisampling: the still a break cuts once keeps it. */
const liveTexture = (renderer: Renderer, box: Rectangle): RenderTexture =>
	RenderTexture.create({ ...liveSize(renderer, box), resolution: renderer.resolution });

const drawTransform = new Matrix();

/**
 * Draw `target`'s `box` into all of `texture`, at full alpha (whoever faded the element fades its
 * pieces instead). The target stays a render group ({@link holdGroup}): drawing it every frame would
 * otherwise rebuild its parent's render each time.
 */
const redraw = (renderer: Renderer, target: Container, box: Rectangle, texture: Texture): void => {
	const sx = texture.width / box.width;
	const sy = texture.height / box.height;
	const alpha = target.alpha;
	target.alpha = 1;
	try {
		renderer.render({
			container: target,
			target: texture,
			clearColor: [0, 0, 0, 0],
			transform: drawTransform.set(sx, 0, 0, sy, -box.x * sx, -box.y * sy),
		});
	} finally {
		target.alpha = alpha;
	}
	texture.source.updateMipmaps();
};

/** The live breaks drawing each element, and whether it was a render group before the first. */
const liveGroups = new WeakMap<Container, { runs: number; wasGroup: boolean }>();

/** A live break starts drawing `target`, which drawing makes a render group. */
const holdGroup = (target: Container): void => {
	const held = liveGroups.get(target);
	if (held) held.runs++;
	else liveGroups.set(target, { runs: 1, wasGroup: target.isRenderGroup });
};

/** A live break stops drawing `target`: the last one gives it back as it was, unless its owner has
 *  since cached it as a texture (which needs the group). */
const releaseGroup = (target: Container): void => {
	const held = liveGroups.get(target);
	if (!held || --held.runs > 0) return;
	liveGroups.delete(target);
	if (held.wasGroup || target.destroyed || !target.isRenderGroup || target.isCachedAsTexture)
		return;
	target.disableRenderGroup();
};

/**
 * Where a live break lays its pieces now: every box the element has filled so far (`seen`, then
 * `box`), grown about its centre to the cut's proportions. It only grows, and evenly, so a zoom
 * carries the pieces with it while a rig swinging or a child moving neither stretches nor shakes them.
 */
const liveRegion = (seen: Rectangle, box: Rectangle | undefined, cut: Rectangle): Rectangle => {
	const x0 = Math.min(seen.x, box?.x ?? seen.x);
	const y0 = Math.min(seen.y, box?.y ?? seen.y);
	const x1 = Math.max(seen.right, box ? box.x + box.width : seen.right);
	const y1 = Math.max(seen.bottom, box ? box.y + box.height : seen.bottom);
	const k = Math.max((x1 - x0) / cut.width, (y1 - y0) / cut.height);
	const w = cut.width * k;
	const h = cut.height * k;
	return new Rectangle((x0 + x1 - w) / 2, (y0 + y1 - h) / 2, w, h);
};

/**
 * The still frozen solid, for the ice shards: the freeze pass at full cover (no front, no glint),
 * rendered once. Its crystals are finer than the facets, so each shard reads as ice inside too.
 */
const iceStill = (
	renderer: Renderer,
	still: Texture,
	options: BreakOptions,
	seed: number,
): Texture => {
	const filter = freezeFilter();
	const color = options.params.color;
	const crystals = Math.max(3, Math.round(Math.sqrt(param(options.params, 'pieces', 28)) * 1.4));
	filter.set('uFreeze', 1, crystals, seed, EFX_SIDES.indexOf('edges'));
	filter.set('uIce', ...rgb(typeof color === 'string' ? color : '#9fdcff'));
	filter.set('uGlint', 1, -10);
	const sprite = new Sprite(still);
	sprite.filters = [filter];
	const holder = new Container();
	holder.addChild(sprite);
	const iced = renderer.generateTexture({
		target: holder,
		frame: new Rectangle(0, 0, still.width, still.height),
		antialias: true,
	});
	holder.destroy({ children: true });
	filter.destroy();
	return iced;
};

/**
 * Start a break: snapshot, cut, and place the pieces. `undefined` when there is nothing to break (no
 * parent, an empty box) — the caller then plays the fallback fade.
 */
export function startBreak(options: BreakOptions): BreakRun | undefined {
	const { target, box, renderer, style, live } = options;
	const parent = target.parent;
	if (!parent || box.width < 1 || box.height < 1 || !target.visible) return undefined;

	let texture: Texture;
	if (live) {
		holdGroup(target);
		texture = liveTexture(renderer, box);
		redraw(renderer, target, box, texture);
	} else {
		texture = snapshot(renderer, target, box);
	}
	const still = live
		? new Rectangle(box.x, box.y, box.width, box.height)
		: new Rectangle(box.x, box.y, texture.width, texture.height);
	const seed = Math.random();
	const rand = random(seed);
	const cut = CUTS[style](still, options, rand);
	const iced = cut.ice ? iceStill(renderer, texture, options, seed * 97) : undefined;
	const layer = new Container();
	// Small meshes, so the batcher draws them all in one go. One large mesh is drawn on its own and
	// keeps the still bound after it is destroyed (Pixi then warns as the texture goes).
	const cutMeshes = (source: Texture): { mesh: MeshSimple; first: number; count: number }[] => {
		const out: { mesh: MeshSimple; first: number; count: number }[] = [];
		for (let first = 0, vertex = 0, index = 0; first < cut.pieces.length;) {
			let count = 0;
			let vertices = 0;
			let triangles = 0;
			while (first + count < cut.pieces.length) {
				const n = cut.pieces[first + count].rel.length / 2;
				if (count > 0 && vertices + n > MAX_BATCHED_VERTICES) break;
				vertices += n;
				triangles += n - 2;
				count++;
			}
			const indices = cut.indices.slice(index, index + triangles * 3);
			for (let i = 0; i < indices.length; i++) indices[i] -= vertex;
			const mesh = new MeshSimple({
				texture: source,
				vertices: new Float32Array(vertices * 2),
				uvs: cut.uvs.slice(vertex * 2, (vertex + vertices) * 2),
				indices,
			});
			layer.addChild(mesh);
			out.push({ mesh, first, count });
			first += count;
			vertex += vertices;
			index += triangles * 3;
		}
		return out;
	};
	const meshes = cutMeshes(texture);
	// Ice: the same shards cut from the frozen still, drawn over the plain ones as they ice over.
	const iceMeshes = iced ? cutMeshes(iced) : [];
	const cracks = cut.cracks ? layer.addChild(new Graphics()) : undefined;
	const frost = cut.ice ? layer.addChild(new Graphics()) : undefined;
	const glints = cut.ice ? layer.addChild(new Graphics()) : undefined;
	// The seams, flashes and twinkles lie on the element only, not on the clear parts of its box.
	const shape = frost ? layer.addChild(new Sprite(texture)) : undefined;
	if (frost && shape) {
		shape.position.set(still.x, still.y);
		shape.setSize(still.width, still.height);
		frost.mask = shape;
	}
	const holder = new Container({ label: 'elementFx:break', zIndex: target.zIndex });
	if (options.alpha !== undefined) holder.alpha = options.alpha;
	holder.setFromMatrix(options.rest);
	holder.addChild(layer);
	parent.addChildAt(holder, Math.min(parent.children.length, parent.getChildIndex(target) + 1));

	const size = Math.max(still.width, still.height);
	const gravity =
		param(options.params, 'gravity', 1) *
		(style === 'crash' || style === 'ice' ? 2.6 : style === 'glass' ? 2.8 : 2.4) *
		size;
	const seconds = options.playSeconds;
	const hit = style === 'crash' ? 0.12 : 0;
	/** How long the element shakes from its hit: a crash's whole wind-up, a pane's first jolt. */
	const jolting = style === 'crash' ? hit : style === 'glass' ? 0.05 : 0;
	const crack = param(options.params, 'crack', 0.3);
	const [wx, wy] = dustWind(options.params);
	/** Dust picks up speed on the wind as it goes. */
	const gust = 1.6 * size * Math.max(0.2, options.intensity);

	const burst = cut.ice?.burst ?? 1;
	/** How far a facet has iced over at `t`, from its centre out, overshooting as it snaps in. */
	const grown = (piece: Piece, t: number): number =>
		cut.ice ? easeOutBack(clamp01((t - piece.reachedAt) / cut.ice.grow), 1.6) : 1;

	/** Where a piece is at `t`: its centre, its turn and its scale across and along. */
	const fly = (
		piece: Piece,
		t: number,
		flight: number,
	): [number, number, number, number, number] => {
		if (style === 'ice') {
			const open = 1 - ICE_GAP * smoothstep(0.88 * burst, burst, t);
			const life = clamp01((t - piece.delay) / (1 - piece.delay));
			const tau = life * (1 - piece.delay) * seconds;
			const scale = open * (1 - 0.4 * smoothstep(0.35, 1, life));
			return [
				piece.cx + piece.vx * tau,
				piece.cy + piece.vy * tau + 0.5 * gravity * tau * tau,
				piece.spin * tau,
				scale * Math.cos(piece.tumble * tau),
				scale,
			];
		}
		if (style === 'glass') {
			const open = 1 - GLASS_GAP * smoothstep(piece.reachedAt, piece.reachedAt + 0.04, t);
			const life = clamp01((t - piece.delay) / (1 - piece.delay));
			const tau = life * (1 - piece.delay) * seconds;
			const scale = open * (1 + 0.18 * smoothstep(0, 0.35, life));
			return [
				piece.cx + piece.vx * tau,
				piece.cy + piece.vy * tau + 0.5 * gravity * tau * tau,
				piece.spin * tau,
				scale * Math.cos(piece.tumble * tau),
				scale,
			];
		}
		if (style === 'dust') {
			const life = clamp01((t - piece.delay) / DUST_LIFE);
			const tau = life * DUST_LIFE * seconds;
			const sway = piece.sway * Math.sin(piece.phase + tau * 9) * life;
			const scale = 1 - smoothstep(0.35, 1, life);
			return [
				piece.cx + piece.vx * tau + 0.5 * gust * wx * tau * tau - wy * sway,
				piece.cy + piece.vy * tau + 0.5 * gust * wy * tau * tau + wx * sway,
				piece.spin * tau,
				scale,
				scale,
			];
		}
		const life = style === 'crash' ? flight : clamp01((t - piece.delay) / (1 - piece.delay));
		const tau =
			style === 'crash' ? flight * (1 - hit) * seconds : life * (1 - piece.delay) * seconds;
		const scale = style === 'crash' ? 1 - 0.3 * life : 1 - 0.6 * smoothstep(0.3, 1, life);
		return [
			piece.cx + piece.vx * tau,
			piece.cy + piece.vy * tau + 0.5 * gravity * tau * tau,
			piece.spin * tau,
			scale,
			scale,
		];
	};

	/** Write `piece`'s vertices at `t` into `out` from `base`, shrunk to `grow` about its centre. */
	const place = (
		piece: Piece,
		t: number,
		flight: number,
		out: { [index: number]: number },
		base: number,
		grow = 1,
	): void => {
		const [x, y, angle, across, along] = fly(piece, t, flight);
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		for (let k = 0; k < piece.rel.length; k += 2) {
			const rx = piece.rel[k] * across * grow;
			const ry = piece.rel[k + 1] * along * grow;
			out[base + k] = x + rx * cos - ry * sin;
			out[base + k + 1] = y + rx * sin + ry * cos;
		}
	};

	/** Glass: the crack lines spreading from the impact, a flash where it was hit, and both gone
	 *  as the shards part. Each line is drawn twice, dark then light, so it reads on any art. */
	const drawCracks = (t: number): void => {
		if (!cracks || !cut.cracks) return;
		const shown = 1 - smoothstep(crack, crack + 0.1, t);
		cracks.visible = shown > 0;
		if (!cracks.visible) return;
		const { x, y, reach, lines } = cut.cracks;
		const front = reach * crackFront(t / crack);
		const trace = (ring: boolean): void => {
			for (const line of lines) {
				if (line.ring !== ring || front <= line.near) continue;
				const k = Math.min(1, (front - line.near) / Math.max(line.far - line.near, 1e-6));
				cracks
					.moveTo(line.x0, line.y0)
					.lineTo(line.x0 + (line.x1 - line.x0) * k, line.y0 + (line.y1 - line.y0) * k);
			}
		};
		cracks.clear();
		for (const ring of [true, false]) {
			const width = Math.max(1, size * (ring ? 0.0035 : 0.006));
			const alpha = (ring ? 0.6 : 1) * shown;
			trace(ring);
			cracks.stroke({ width: width * 2.2, color: 0x000000, alpha: 0.35 * alpha });
			trace(ring);
			cracks.stroke({ width, color: 0xffffff, alpha: 0.85 * alpha });
		}
		const flash = 1 - clamp01(t / 0.1);
		if (flash > 0) {
			cracks.circle(x, y, size * (0.03 + 0.12 * (1 - flash))).fill({
				color: 0xffffff,
				alpha: 0.7 * flash,
			});
		}
	};

	const outline: number[] = [];
	/** Ice: each facet flashing white as it ices over and its seams traced in white, gone as it
	 *  bursts, and points on it twinkling while it holds (all on the element's own shape); then a
	 *  flash at the burst, and each shard glinting as it turns face-on in the air. */
	const drawIce = (t: number, flight: number): void => {
		if (!frost || !glints || !cut.ice) return;
		const { grow, sparkles } = cut.ice;
		frost.clear();
		glints.clear();
		const seams = 1 - smoothstep(burst, burst + 0.04, t);
		frost.visible = seams > 0;
		if (seams > 0) {
			const facet = (piece: Piece): number[] | undefined => {
				const g = grown(piece, t);
				if (g <= 0) return undefined;
				place(piece, t, flight, outline, 0, g);
				return outline.slice(0, piece.rel.length);
			};
			for (const piece of cut.pieces) {
				const flash = 1 - clamp01((t - piece.reachedAt) / (1.5 * grow));
				const points = flash > 0 ? facet(piece) : undefined;
				if (points) frost.poly(points).fill({ color: 0xffffff, alpha: 0.45 * flash });
			}
			for (const piece of cut.pieces) {
				const points = facet(piece);
				if (points) frost.poly(points);
			}
			frost.stroke({ width: Math.max(1, size * 0.004), color: 0xffffff, alpha: 0.6 * seams });
		}
		const twinkling =
			smoothstep(0.8 * cut.ice.iced, cut.ice.iced, t) * (1 - smoothstep(burst, burst + 0.03, t));
		if (twinkling > 0) {
			for (const [x, y, phase] of sparkles) {
				const k = Math.max(0, Math.sin(phase + t * seconds * 9)) ** 4 * twinkling;
				if (k < 0.02) continue;
				const r = size * 0.04 * k;
				frost.star(x, y, 4, r, r * 0.22).fill({ color: 0xffffff, alpha: 0.9 * k });
			}
		}
		const blast = clamp01((t - burst) / 0.08);
		if (blast > 0 && blast < 1) {
			glints
				.circle(still.x + still.width / 2, still.y + still.height / 2, size * (0.1 + 0.5 * blast))
				.fill({ color: 0xffffff, alpha: 0.45 * (1 - blast) });
		}
		for (const piece of cut.pieces) {
			if (t <= piece.delay) continue;
			const life = clamp01((t - piece.delay) / (1 - piece.delay));
			const tau = life * (1 - piece.delay) * seconds;
			const glint = Math.max(0, 1 - 5 * Math.abs(Math.sin(piece.tumble * tau))) * (1 - life);
			if (glint < 0.05) continue;
			const [x, y] = fly(piece, t, flight);
			const r = size * 0.03 * glint;
			glints.star(x, y, 4, r, r * 0.22).fill({ color: 0xffffff, alpha: glint });
		}
	};

	const pose = (t: number): void => {
		const flight = clamp01((t - hit) / (1 - hit));
		if (style === 'ice') {
			const creak = t < burst ? smoothstep(0.84 * burst, burst, t) : 0;
			const jolt = 0.012 * size * Math.max(0.2, options.intensity) * creak;
			layer.position.set(jolt * Math.sin(t * seconds * 70), 0);
		} else if (t < jolting) {
			const k = 1 - t / jolting;
			const jolt = 0.03 * size * Math.max(0.2, options.intensity) * k;
			layer.position.set(jolt * Math.sin(t * 900), jolt * Math.cos(t * 700));
		} else {
			layer.position.set(0, 0);
		}
		// Under ice, the plain shards are covered once every facet has iced over.
		const plain = !cut.ice || t < cut.ice.iced;
		for (const { mesh, first, count } of meshes) {
			mesh.visible = plain;
			if (!plain) continue;
			const vertices = mesh.vertices;
			for (let i = 0, base = 0; i < count; i++) {
				const piece = cut.pieces[first + i];
				place(piece, t, flight, vertices, base);
				base += piece.rel.length;
			}
		}
		for (const { mesh, first, count } of iceMeshes) {
			const vertices = mesh.vertices;
			for (let i = 0, base = 0; i < count; i++) {
				const piece = cut.pieces[first + i];
				place(piece, t, flight, vertices, base, grown(piece, t));
				base += piece.rel.length;
			}
		}
		drawCracks(t);
		drawIce(t, flight);
		layer.alpha =
			style === 'crash'
				? 1 - smoothstep(0.55, 1, flight)
				: 1 - smoothstep(style === 'glass' ? 0.8 : 0.85, 1, t);
	};
	pose(0);

	/** A texture a live break outgrew: destroyed a frame later, once nothing draws with it. */
	let retired: Texture | undefined;
	let liveBox = still;
	const placed = new Matrix();
	const boxMap = new Matrix();
	/**
	 * Redraw from the element now, laid over where it now is ({@link liveRegion}): the cut stays in
	 * the box it broke in, and the holder maps that box onto this one, so the pieces grow and move
	 * with the element. The texture is remade when the element outgrows it, so it stays sharp.
	 */
	const follow = (rest: Matrix, alpha: number, box: Rectangle | undefined): void => {
		retired?.destroy(true);
		retired = undefined;
		liveBox = liveRegion(
			liveBox,
			box && box.width >= 1 && box.height >= 1 ? box : undefined,
			still,
		);
		const fit = liveSize(renderer, liveBox);
		if (fit.width > texture.width * 1.25 || fit.height > texture.height * 1.25) {
			retired = texture;
			texture = liveTexture(renderer, liveBox);
			for (const { mesh } of meshes) mesh.texture = texture;
			if (shape) {
				shape.texture = texture;
				shape.setSize(still.width, still.height);
			}
		}
		redraw(renderer, target, liveBox, texture);
		const k = liveBox.width / still.width;
		placed
			.copyFrom(rest)
			.append(boxMap.set(k, 0, 0, k, liveBox.x - still.x * k, liveBox.y - still.y * k));
		holder.setFromMatrix(placed);
		holder.alpha = alpha;
		holder.visible = target.visible;
		holder.zIndex = target.zIndex;
	};

	return {
		update: pose,
		follow: live ? follow : undefined,
		destroy(): void {
			// `context`: a Graphics destroyed with options keeps its own context, and its buffers.
			if (!holder.destroyed) holder.destroy({ children: true, context: true });
			texture.destroy(true);
			retired?.destroy(true);
			iced?.destroy(true);
			if (live) releaseGroup(target);
		},
	};
}
