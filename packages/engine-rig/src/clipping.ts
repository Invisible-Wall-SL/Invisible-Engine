import type { ClippingAttachment } from './attachments';
import type { Slot } from './slot';

const EPS = 1e-9;

function signedArea(poly: ArrayLike<number>, count: number): number {
	let area = 0;
	for (let i = 0, j = count - 2; i < count; j = i, i += 2)
		area += poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
	return area / 2;
}

/** Ear-clips a simple polygon (`x, y` pairs, any winding) into triangle indices. */
export function triangulate(polygon: ArrayLike<number>): number[] {
	const n = polygon.length >> 1;
	const out: number[] = [];
	if (n < 3) return out;
	const ccw = signedArea(polygon, polygon.length) > 0;
	const indices = Array.from({ length: n }, (_, i) => i);
	const x = (i: number): number => polygon[i << 1];
	const y = (i: number): number => polygon[(i << 1) + 1];
	const cross = (a: number, b: number, c: number): number =>
		(x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
	const convex = (a: number, b: number, c: number): boolean =>
		ccw ? cross(a, b, c) > EPS : cross(a, b, c) < -EPS;
	const inside = (p: number, a: number, b: number, c: number): boolean => {
		const d1 = cross(a, b, p);
		const d2 = cross(b, c, p);
		const d3 = cross(c, a, p);
		return ccw ? d1 >= -EPS && d2 >= -EPS && d3 >= -EPS : d1 <= EPS && d2 <= EPS && d3 <= EPS;
	};
	let guard = n * n;
	while (indices.length > 3 && guard-- > 0) {
		let clipped = false;
		for (let i = 0; i < indices.length; i++) {
			const a = indices[(i + indices.length - 1) % indices.length];
			const b = indices[i];
			const c = indices[(i + 1) % indices.length];
			if (!convex(a, b, c)) continue;
			let ear = true;
			for (const p of indices) {
				if (p === a || p === b || p === c) continue;
				if (inside(p, a, b, c)) {
					ear = false;
					break;
				}
			}
			if (!ear) continue;
			out.push(a, b, c);
			indices.splice(i, 1);
			clipped = true;
			break;
		}
		// Degenerate input (collinear or self-touching): drop a vertex and carry on.
		if (!clipped) indices.splice(0, 1);
	}
	if (indices.length === 3) out.push(indices[0], indices[1], indices[2]);
	return out;
}

/** Merges triangles of a triangulated polygon into larger convex polygons (counter-clockwise). */
export function decompose(polygon: ArrayLike<number>, triangles: number[]): number[][] {
	const pts = (idx: number[]): number[] => idx.flatMap((i) => [polygon[i << 1], polygon[(i << 1) + 1]]);
	const isConvex = (idx: number[]): boolean => {
		const p = pts(idx);
		const n = idx.length;
		let sign = 0;
		for (let i = 0; i < n; i++) {
			const ax = p[i * 2];
			const ay = p[i * 2 + 1];
			const bx = p[((i + 1) % n) * 2];
			const by = p[((i + 1) % n) * 2 + 1];
			const cx = p[((i + 2) % n) * 2];
			const cy = p[((i + 2) % n) * 2 + 1];
			const c = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
			if (Math.abs(c) < EPS) continue;
			const s = c > 0 ? 1 : -1;
			if (sign === 0) sign = s;
			else if (s !== sign) return false;
		}
		return true;
	};
	const polys: number[][] = [];
	for (let t = 0; t < triangles.length; t += 3) {
		const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
		let merged = false;
		for (const poly of polys) {
			// Find a shared edge (a, b) in poly matching (b, a) or (a, b) in the triangle.
			for (let i = 0; i < poly.length && !merged; i++) {
				const a = poly[i];
				const b = poly[(i + 1) % poly.length];
				const ta = tri.indexOf(a);
				const tb = tri.indexOf(b);
				if (ta === -1 || tb === -1) continue;
				const other = tri.find((v) => v !== a && v !== b);
				if (other === undefined || poly.includes(other)) continue;
				const candidate = poly.slice(0, i + 1).concat([other], poly.slice(i + 1));
				if (isConvex(candidate)) {
					poly.splice(0, poly.length, ...candidate);
					merged = true;
				}
			}
			if (merged) break;
		}
		if (!merged) polys.push(tri);
	}
	return polys.map((idx) => {
		const p = pts(idx);
		if (signedArea(p, p.length) < 0) {
			const r: number[] = [];
			for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
			return r;
		}
		return p;
	});
}

/** Clips triangles against a slot's clipping attachment until its end slot. */
export class SkeletonClipping {
	clippedVertices: number[] = [];
	clippedTriangles: number[] = [];
	clippedUVs: number[] = [];
	private clipAttachment: ClippingAttachment | null = null;
	private clippingPolygons: number[][] = [];
	private world: number[] = [];

	clipStart(slot: Slot, clip: ClippingAttachment): number {
		if (this.clipAttachment) return 0;
		const n = clip.worldVerticesLength;
		if (n < 6) return 0;
		this.clipAttachment = clip;
		const world = this.world;
		world.length = n;
		clip.computeWorldVertices(slot, 0, n, world, 0, 2);
		this.clippingPolygons = decompose(world, triangulate(world));
		return this.clippingPolygons.length;
	}

	clipEndWithSlot(slot: Slot): void {
		if (this.clipAttachment && this.clipAttachment.endSlot === slot.data) this.clipEnd();
	}

	clipEnd(): void {
		if (!this.clipAttachment) return;
		this.clipAttachment = null;
		this.clippingPolygons = [];
		this.clippedVertices.length = 0;
		this.clippedTriangles.length = 0;
		this.clippedUVs.length = 0;
	}

	isClipping(): boolean {
		return this.clipAttachment !== null;
	}

	/** Positions only (`x, y` pairs in `vertices`). */
	clipTriangles(vertices: ArrayLike<number>, triangles: ArrayLike<number>, trianglesLength: number): void {
		this.clip(vertices, triangles, trianglesLength, null);
	}

	/** Positions and UVs, each as `x, y` / `u, v` pairs, written to the three `clipped*` arrays. */
	clipTrianglesUnpacked(
		vertices: ArrayLike<number>,
		triangles: ArrayLike<number>,
		trianglesLength: number,
		uvs: ArrayLike<number>,
	): void {
		this.clip(vertices, triangles, trianglesLength, uvs);
	}

	private clip(
		vertices: ArrayLike<number>,
		triangles: ArrayLike<number>,
		trianglesLength: number,
		uvs: ArrayLike<number> | null,
	): void {
		const outV = this.clippedVertices;
		const outT = this.clippedTriangles;
		const outUV = this.clippedUVs;
		outV.length = 0;
		outT.length = 0;
		outUV.length = 0;
		for (let t = 0; t < trianglesLength; t += 3) {
			const i1 = triangles[t] << 1;
			const i2 = triangles[t + 1] << 1;
			const i3 = triangles[t + 2] << 1;
			const x1 = vertices[i1];
			const y1 = vertices[i1 + 1];
			const x2 = vertices[i2];
			const y2 = vertices[i2 + 1];
			const x3 = vertices[i3];
			const y3 = vertices[i3 + 1];
			const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
			for (const polygon of this.clippingPolygons) {
				const poly = clipConvex([x1, y1, x2, y2, x3, y3], polygon);
				const count = poly.length >> 1;
				if (count < 3) continue;
				const base = outV.length >> 1;
				for (let k = 0; k < poly.length; k += 2) {
					const px = poly[k];
					const py = poly[k + 1];
					outV.push(px, py);
					if (!uvs) continue;
					// Barycentric weights of the clipped point in the source triangle.
					let a = 1;
					let b = 0;
					if (Math.abs(det) > EPS) {
						a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / det;
						b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / det;
					}
					const c = 1 - a - b;
					outUV.push(
						uvs[i1] * a + uvs[i2] * b + uvs[i3] * c,
						uvs[i1 + 1] * a + uvs[i2 + 1] * b + uvs[i3 + 1] * c,
					);
				}
				for (let k = 1; k < count - 1; k++) outT.push(base, base + k, base + k + 1);
			}
		}
	}
}

/** Sutherland–Hodgman: clips polygon `subject` against convex counter-clockwise `clip`. */
function clipConvex(subject: number[], clip: number[]): number[] {
	let output = subject;
	const n = clip.length;
	for (let e = 0; e < n && output.length >= 6; e += 2) {
		const ex1 = clip[e];
		const ey1 = clip[e + 1];
		const ex2 = clip[(e + 2) % n];
		const ey2 = clip[(e + 3) % n];
		const edx = ex2 - ex1;
		const edy = ey2 - ey1;
		const side = (x: number, y: number): number => edx * (y - ey1) - edy * (x - ex1);
		const input = output;
		output = [];
		const m = input.length;
		for (let i = 0; i < m; i += 2) {
			const cx = input[i];
			const cy = input[i + 1];
			const px = input[(i + m - 2) % m];
			const py = input[(i + m - 1) % m];
			const cs = side(cx, cy);
			const ps = side(px, py);
			if (cs >= 0) {
				if (ps < 0) {
					const t = ps / (ps - cs);
					output.push(px + (cx - px) * t, py + (cy - py) * t);
				}
				output.push(cx, cy);
			} else if (ps >= 0) {
				const t = ps / (ps - cs);
				output.push(px + (cx - px) * t, py + (cy - py) * t);
			}
		}
	}
	return output;
}
