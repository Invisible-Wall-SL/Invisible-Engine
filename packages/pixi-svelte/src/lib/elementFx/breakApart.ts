/**
 * The BREAK kinds (`crash`, `crumble`): the element is rendered once to a texture, hidden, and the
 * still is cut into pieces that fly. The pieces live in a few small `MeshSimple`s the batcher draws
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
	/** Crumble only: the share of the play before it lets go. */
	delay: number;
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
			});
		}
	}
	return { pieces, uvs, indices };
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
	const cut = style === 'crash' ? cutShards(still, options, rand) : cutChunks(still, options, rand);
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

	const place = (
		piece: Piece,
		t: number,
		flight: number,
		out: { [index: number]: number },
		base: number,
	): void => {
		const life = style === 'crash' ? flight : clamp01((t - piece.delay) / (1 - piece.delay));
		const tau =
			style === 'crash' ? flight * (1 - hit) * seconds : life * (1 - piece.delay) * seconds;
		const x = piece.cx + piece.vx * tau;
		const y = piece.cy + piece.vy * tau + 0.5 * gravity * tau * tau;
		const angle = piece.spin * tau;
		const scale = style === 'crash' ? 1 - 0.3 * life : 1 - 0.6 * smoothstep(0.3, 1, life);
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
