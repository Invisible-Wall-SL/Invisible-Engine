/**
 * The BREAK kinds (`crash`, `crumble`, `disintegrate`): the element is rendered once to a texture,
 * hidden, and the still is cut into pieces that fly. The pieces live in a few small `MeshSimple`s the batcher draws
 * together: each frame moves their vertices. The pieces sit in a holder placed beside the
 * element (same parent, same depth, its resting transform), so they draw where it drew.
 *
 * A still, not the live element: a playing rig freezes on the frame it broke on, which is what
 * breaking glass would do too.
 */

import { Container, MeshSimple, Rectangle, type Matrix, type Renderer } from 'pixi.js';
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
}

/** The pieces' layout: vertices around each piece's centre, uvs into the still, triangle indices. */
interface Cut {
	pieces: Piece[];
	uvs: Float32Array;
	indices: Uint32Array;
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
			});
		}
	}
	return { pieces, uvs, indices };
};

const CUTS: Record<BreakStyle, (box: Rectangle, options: BreakOptions, rand: () => number) => Cut> =
	{
		crash: cutShards,
		crumble: cutChunks,
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
	const perPiece = style === 'crash' ? 6 : 8;
	const indicesPerPiece = style === 'crash' ? 3 : 6;
	// Small meshes, so the batcher draws them all in one go. One large mesh is drawn on its own and
	// keeps the still bound after it is destroyed (Pixi then warns as the texture goes).
	const piecesPerMesh = Math.floor(MAX_BATCHED_VERTICES / (perPiece / 2));
	const layer = new Container();
	const meshes: { mesh: MeshSimple; first: number; count: number }[] = [];
	for (let first = 0; first < cut.pieces.length; first += piecesPerMesh) {
		const count = Math.min(piecesPerMesh, cut.pieces.length - first);
		const indices = cut.indices.slice(first * indicesPerPiece, (first + count) * indicesPerPiece);
		const offset = first * (perPiece / 2);
		for (let i = 0; i < indices.length; i++) indices[i] -= offset;
		const mesh = new MeshSimple({
			texture,
			vertices: new Float32Array(count * perPiece),
			uvs: cut.uvs.slice(first * perPiece, (first + count) * perPiece),
			indices,
		});
		layer.addChild(mesh);
		meshes.push({ mesh, first, count });
	}
	const holder = new Container({ label: 'elementFx:break', zIndex: target.zIndex });
	holder.setFromMatrix(options.rest);
	holder.addChild(layer);
	parent.addChildAt(holder, Math.min(parent.children.length, parent.getChildIndex(target) + 1));

	const size = Math.max(still.width, still.height);
	const gravity = param(options.params, 'gravity', 1) * (style === 'crash' ? 2.6 : 2.4) * size;
	const seconds = options.playSeconds;
	const hit = style === 'crash' ? 0.12 : 0;
	const [wx, wy] = dustWind(options.params);
	/** Dust picks up speed on the wind as it goes. */
	const gust = 1.6 * size * Math.max(0.2, options.intensity);

	/** Where a piece is at `t`: its centre, its turn and its scale. */
	const fly = (piece: Piece, t: number, flight: number): [number, number, number, number] => {
		if (style === 'dust') {
			const life = clamp01((t - piece.delay) / DUST_LIFE);
			const tau = life * DUST_LIFE * seconds;
			const sway = piece.sway * Math.sin(piece.phase + tau * 9) * life;
			return [
				piece.cx + piece.vx * tau + 0.5 * gust * wx * tau * tau - wy * sway,
				piece.cy + piece.vy * tau + 0.5 * gust * wy * tau * tau + wx * sway,
				piece.spin * tau,
				1 - smoothstep(0.35, 1, life),
			];
		}
		const life = style === 'crash' ? flight : clamp01((t - piece.delay) / (1 - piece.delay));
		const tau =
			style === 'crash' ? flight * (1 - hit) * seconds : life * (1 - piece.delay) * seconds;
		return [
			piece.cx + piece.vx * tau,
			piece.cy + piece.vy * tau + 0.5 * gravity * tau * tau,
			piece.spin * tau,
			style === 'crash' ? 1 - 0.3 * life : 1 - 0.6 * smoothstep(0.3, 1, life),
		];
	};

	const place = (
		piece: Piece,
		t: number,
		flight: number,
		out: { [index: number]: number },
		base: number,
	): void => {
		const [x, y, angle, scale] = fly(piece, t, flight);
		const cos = Math.cos(angle) * scale;
		const sin = Math.sin(angle) * scale;
		for (let k = 0; k < piece.rel.length; k += 2) {
			const rx = piece.rel[k];
			const ry = piece.rel[k + 1];
			out[base + k] = x + rx * cos - ry * sin;
			out[base + k + 1] = y + rx * sin + ry * cos;
		}
	};

	const pose = (t: number): void => {
		const flight = clamp01((t - hit) / (1 - hit));
		if (style === 'crash' && t < hit) {
			const k = 1 - t / hit;
			const jolt = 0.03 * size * Math.max(0.2, options.intensity) * k;
			layer.position.set(jolt * Math.sin(t * 900), jolt * Math.cos(t * 700));
		} else {
			layer.position.set(0, 0);
		}
		for (const { mesh, first, count } of meshes) {
			const vertices = mesh.vertices;
			for (let i = 0; i < count; i++)
				place(cut.pieces[first + i], t, flight, vertices, i * perPiece);
		}
		layer.alpha = style === 'crash' ? 1 - smoothstep(0.55, 1, flight) : 1 - smoothstep(0.85, 1, t);
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
