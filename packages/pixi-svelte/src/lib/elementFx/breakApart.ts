/**
 * The BREAK kinds (`crash`, `crumble`, `shatter`, `disintegrate`, and `assemble`, which plays dust
 * backwards): the element is rendered once to a texture, hidden, and the still is cut into pieces
 * that fly. The pieces live in a few small `MeshSimple`s the batcher draws together: each frame
 * moves their vertices. The pieces sit in a holder placed beside the element (same parent, same
 * depth, its resting transform), so they draw where it drew.
 *
 * A still, not the live element: a playing rig freezes on the frame it broke on, which is what
 * breaking glass would do too.
 */

import { Container, Graphics, MeshSimple, Rectangle, type Matrix, type Renderer } from 'pixi.js';
import { clamp01, smoothstep } from './frame';
import type { BreakStyle } from './kinds';

export interface BreakRun {
	/** Pose the pieces at `t` (0…1 of the play). */
	update(t: number): void;
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
	/** Glass only: how fast it tumbles end over end, and when the cracks reach it (a share of the
	 *  play). */
	tumble: number;
	cracksAt: number;
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
			cracksAt: 0,
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
				cracksAt: 0,
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
				cracksAt: 0,
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
				cracksAt: crack * (1 - Math.sqrt(1 - reached)),
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

const CUTS: Record<BreakStyle, (box: Rectangle, options: BreakOptions, rand: () => number) => Cut> =
	{
		crash: cutShards,
		crumble: cutChunks,
		glass: cutGlass,
		dust: cutSpecks,
	};

/** The still of `target`'s box, without leaving it a render group if it was not one. */
const snapshot = (renderer: Renderer, target: Container, box: Rectangle) => {
	const wasGroup = target.isRenderGroup;
	const texture = renderer.generateTexture({ target, frame: box, antialias: true });
	if (!wasGroup && target.isRenderGroup) target.disableRenderGroup();
	return texture;
};

/**
 * Start a break: snapshot, cut, and place the pieces. `undefined` when there is nothing to break (no
 * parent, an empty box) — the caller then plays the fallback fade.
 */
export function startBreak(options: BreakOptions): BreakRun | undefined {
	const { target, box, renderer, style } = options;
	const parent = target.parent;
	if (!parent || box.width < 1 || box.height < 1 || !target.visible) return undefined;

	const texture = snapshot(renderer, target, box);
	const still = new Rectangle(box.x, box.y, texture.width, texture.height);
	const rand = random(Math.random());
	const cut = CUTS[style](still, options, rand);
	// Small meshes, so the batcher draws them all in one go. One large mesh is drawn on its own and
	// keeps the still bound after it is destroyed (Pixi then warns as the texture goes).
	const layer = new Container();
	const meshes: { mesh: MeshSimple; first: number; count: number }[] = [];
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
			texture,
			vertices: new Float32Array(vertices * 2),
			uvs: cut.uvs.slice(vertex * 2, (vertex + vertices) * 2),
			indices,
		});
		layer.addChild(mesh);
		meshes.push({ mesh, first, count });
		first += count;
		vertex += vertices;
		index += triangles * 3;
	}
	const cracks = cut.cracks ? layer.addChild(new Graphics()) : undefined;
	const holder = new Container({ label: 'elementFx:break', zIndex: target.zIndex });
	holder.setFromMatrix(options.rest);
	holder.addChild(layer);
	parent.addChildAt(holder, Math.min(parent.children.length, parent.getChildIndex(target) + 1));

	const size = Math.max(still.width, still.height);
	const gravity =
		param(options.params, 'gravity', 1) *
		(style === 'crash' ? 2.6 : style === 'glass' ? 2.8 : 2.4) *
		size;
	const seconds = options.playSeconds;
	const hit = style === 'crash' ? 0.12 : 0;
	/** How long the element shakes from its hit: a crash's whole wind-up, a pane's first jolt. */
	const jolting = style === 'crash' ? hit : style === 'glass' ? 0.05 : 0;
	const crack = param(options.params, 'crack', 0.3);
	const [wx, wy] = dustWind(options.params);
	/** Dust picks up speed on the wind as it goes. */
	const gust = 1.6 * size * Math.max(0.2, options.intensity);

	/** Where a piece is at `t`: its centre, its turn and its scale across and along. */
	const fly = (
		piece: Piece,
		t: number,
		flight: number,
	): [number, number, number, number, number] => {
		if (style === 'glass') {
			const open = 1 - GLASS_GAP * smoothstep(piece.cracksAt, piece.cracksAt + 0.04, t);
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

	const place = (
		piece: Piece,
		t: number,
		flight: number,
		out: { [index: number]: number },
		base: number,
	): void => {
		const [x, y, angle, across, along] = fly(piece, t, flight);
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		for (let k = 0; k < piece.rel.length; k += 2) {
			const rx = piece.rel[k] * across;
			const ry = piece.rel[k + 1] * along;
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

	const pose = (t: number): void => {
		const flight = clamp01((t - hit) / (1 - hit));
		if (t < jolting) {
			const k = 1 - t / jolting;
			const jolt = 0.03 * size * Math.max(0.2, options.intensity) * k;
			layer.position.set(jolt * Math.sin(t * 900), jolt * Math.cos(t * 700));
		} else {
			layer.position.set(0, 0);
		}
		for (const { mesh, first, count } of meshes) {
			const vertices = mesh.vertices;
			for (let i = 0, base = 0; i < count; i++) {
				const piece = cut.pieces[first + i];
				place(piece, t, flight, vertices, base);
				base += piece.rel.length;
			}
		}
		drawCracks(t);
		layer.alpha =
			style === 'crash'
				? 1 - smoothstep(0.55, 1, flight)
				: 1 - smoothstep(style === 'glass' ? 0.8 : 0.85, 1, t);
	};
	pose(0);

	return {
		update: pose,
		destroy(): void {
			if (!holder.destroyed) holder.destroy({ children: true });
			texture.destroy(true);
		},
	};
}
