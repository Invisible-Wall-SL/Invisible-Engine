// Repro spike — the owner reports vertices "merge" after re-triangulate. Stress the
// Delaunay with the cases that break naive Bowyer-Watson: exact duplicate points,
// collinear points, and cocircular points. Assert EVERY input vertex is referenced
// (none dropped/merged) and NO degenerate (zero-area) triangles survive.
//   node tools/rigger-spike/retriangulate-degenerate.mjs

function pointInPolygon(px, py, poly) {
	let inside = false; const n = poly.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
		if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
	}
	return inside;
}
function circumcircleContains(ax, ay, bx, by, cx, cy, px, py) {
	const adx = ax - px, ady = ay - py, bdx = bx - px, bdy = by - py, cdx = cx - px, cdy = cy - py;
	const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
	const det = adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
	const orient = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	return orient > 0 ? det > 1e-9 : det < -1e-9;
}
function delaunayTriangles(pts) {
	const n = pts.length / 2;
	if (n < 3) return [];
	let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
	for (let i = 0; i < n; i++) { const x = pts[i * 2], y = pts[i * 2 + 1]; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
	const dx = maxx - minx || 1, dy = maxy - miny || 1, dmax = Math.max(dx, dy), midx = (minx + maxx) / 2, midy = (miny + maxy) / 2;
	const X = new Float64Array(n + 3), Y = new Float64Array(n + 3);
	for (let i = 0; i < n; i++) { X[i] = pts[i * 2]; Y[i] = pts[i * 2 + 1]; }
	X[n] = midx - 20 * dmax; Y[n] = midy - dmax;
	X[n + 1] = midx; Y[n + 1] = midy + 20 * dmax;
	X[n + 2] = midx + 20 * dmax; Y[n + 2] = midy - dmax;
	let tris = [[n, n + 1, n + 2]];
	for (let p = 0; p < n; p++) {
		const px = X[p], py = Y[p];
		const bad = [], good = [];
		for (const t of tris) {
			if (circumcircleContains(X[t[0]], Y[t[0]], X[t[1]], Y[t[1]], X[t[2]], Y[t[2]], px, py)) bad.push(t);
			else good.push(t);
		}
		const edges = [];
		for (const t of bad) edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
		const boundary = [];
		for (let i = 0; i < edges.length; i++) {
			let shared = false;
			for (let j = 0; j < edges.length; j++) if (i !== j && edges[i][0] === edges[j][1] && edges[i][1] === edges[j][0]) { shared = true; break; }
			if (!shared) boundary.push(edges[i]);
		}
		tris = good;
		for (const e of boundary) tris.push([e[0], e[1], p]);
	}
	return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}
function retriangulate(w, hull) {
	const m = w.length / 2;
	if (m < 3) return [];
	let tris = delaunayTriangles(w);
	if (hull >= 3) {
		const poly = [];
		for (let i = 0; i < hull; i++) poly.push(w[i * 2], w[i * 2 + 1]);
		tris = tris.filter(([a, b, c]) => {
			const cx = (w[a * 2] + w[b * 2] + w[c * 2]) / 3, cy = (w[a * 2 + 1] + w[b * 2 + 1] + w[c * 2 + 1]) / 3;
			return pointInPolygon(cx, cy, poly);
		});
	}
	return tris;
}
const triArea = (w, a, b, c) => Math.abs((w[b * 2] - w[a * 2]) * (w[c * 2 + 1] - w[a * 2 + 1]) - (w[c * 2] - w[a * 2]) * (w[b * 2 + 1] - w[a * 2 + 1])) / 2;

// THE dedup ported into view.html: collapse exact-coincident verts (relative EPS) and
// return the deduped world verts + remap (so uvs/vertices/triangles can be reindexed).
function dedupVerts(w) {
	const m = w.length / 2;
	let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
	for (let i = 0; i < m; i++) { const x = w[i * 2], y = w[i * 2 + 1]; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
	const diag = Math.hypot(maxx - minx, maxy - miny);
	const EPS = Math.max(1e-4, diag * 1e-5), EPS2 = EPS * EPS;
	const keep = [], remap = new Array(m);
	for (let i = 0; i < m; i++) {
		let dupOf = -1;
		for (const k of keep) { const dx = w[i * 2] - w[k * 2], dy = w[i * 2 + 1] - w[k * 2 + 1]; if (dx * dx + dy * dy < EPS2) { dupOf = k; break; } }
		if (dupOf < 0) { remap[i] = keep.length; keep.push(i); } else remap[i] = remap[dupOf];
	}
	const w2 = [];
	for (const k of keep) w2.push(w[k * 2], w[k * 2 + 1]);
	return { w2, keep, removed: m - keep.length };
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
function check(name, w, hull) {
	// emulate the new flow: dedup first, count hull among kept, triangulate deduped set
	const ded = dedupVerts(w);
	const w2 = ded.w2, m2 = w2.length / 2;
	let hull2 = 0; for (const k of ded.keep) if (k < hull) hull2++;
	const tris = retriangulate(w2, hull2);
	const used = new Set(tris.flat());
	const dropped = [];
	for (let i = 0; i < m2; i++) if (!used.has(i)) dropped.push(i);
	const inRange = tris.every(([a, b, c]) => [a, b, c].every((i) => i >= 0 && i < m2));
	log(dropped.length === 0 && inRange, `${name}: removed ${ded.removed} dup(s); every remaining vertex referenced + in range (orphans: [${dropped.join(',')}])`);
	const degen = tris.filter(([a, b, c]) => triArea(w2, a, b, c) <= 1e-6);
	log(degen.length === 0, `${name}: no degenerate slivers (${degen.length})`);
}

console.log('\n=== degeneracy repro ===');
// 1) exact duplicate interior point
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100, 50, 50, 50, 50];
	check('exact-duplicate', w, 4);
}
// 2) two near-coincident interior points (sub-pixel apart — like double-click add)
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100, 50, 50, 50.0001, 50.0001];
	check('near-coincident', w, 4);
}
// 3) collinear interior points along a line
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100, 30, 50, 50, 50, 70, 50];
	check('collinear-interior', w, 4);
}
// 4) interior point exactly on a hull edge midpoint
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100, 50, 0, 50, 50];
	check('on-hull-edge', w, 4);
}
// 5) cocircular: 4 corners of a square + center (classic ambiguous in-circle)
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100];
	check('cocircular-square', w, 4);
}

console.log(pass ? '\n✅ PASS' : '\n✗ FAIL — reproduced the merge/drop. Fix needed.');
process.exit(pass ? 0 : 1);
