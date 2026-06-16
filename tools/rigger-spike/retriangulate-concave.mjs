// Repro — owner reports a HULL vertex "merges" after re-triangulating with a 2nd interior
// point on a CONCAVE shape (cactus: body + 2 arms → reflex "armpit" hull vertices). The
// shipped Delaunay+centroid-clip can clip away EVERY triangle touching a reflex hull
// vertex, orphaning it. Assert: does any hull vertex become unreferenced?
//   node tools/rigger-spike/retriangulate-concave.mjs

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
		for (const t of tris) { if (circumcircleContains(X[t[0]], Y[t[0]], X[t[1]], Y[t[1]], X[t[2]], Y[t[2]], px, py)) bad.push(t); else good.push(t); }
		const edges = [];
		for (const t of bad) edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
		const boundary = [];
		for (let i = 0; i < edges.length; i++) { let shared = false; for (let j = 0; j < edges.length; j++) if (i !== j && edges[i][0] === edges[j][1] && edges[i][1] === edges[j][0]) { shared = true; break; } if (!shared) boundary.push(edges[i]); }
		tris = good;
		for (const e of boundary) tris.push([e[0], e[1], p]);
	}
	return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}
function retriangulate(w, hull) {
	const m = w.length / 2; if (m < 3) return [];
	let tris = delaunayTriangles(w);
	if (hull >= 3) {
		const poly = []; for (let i = 0; i < hull; i++) poly.push(w[i * 2], w[i * 2 + 1]);
		tris = tris.filter(([a, b, c]) => { const cx = (w[a * 2] + w[b * 2] + w[c * 2]) / 3, cy = (w[a * 2 + 1] + w[b * 2 + 1] + w[c * 2 + 1]) / 3; return pointInPolygon(cx, cy, poly); });
	}
	return tris;
}

// cactus-like concave boundary loop (CCW). Reflex "armpit" verts at indices 4 and 9.
//  body top → right shoulder → right arm out/down → armpit(reflex) → body bottom → ...
const HULL = [
	300, 600,  // 0 top-left of body
	500, 600,  // 1 top-right of body
	520, 400,  // 2 right shoulder
	750, 420,  // 3 right arm tip top
	760, 250,  // 4 right arm tip bottom
	560, 300,  // 5 REFLEX right armpit (juts inward/up)
	520, 80,   // 6 body bottom-right
	280, 80,   // 7 body bottom-left
	240, 300,  // 8 REFLEX left armpit
	40, 250,   // 9 left arm tip bottom
	50, 420,   // 10 left arm tip top
	280, 400,  // 11 left shoulder
];
const hull = HULL.length / 2;

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
function run(name, interior) {
	const w = HULL.concat(interior);
	const tris = retriangulate(w, hull);
	const used = new Set(tris.flat());
	const orphanHull = []; for (let i = 0; i < hull; i++) if (!used.has(i)) orphanHull.push(i);
	const orphanInt = []; for (let i = hull; i < w.length / 2; i++) if (!used.has(i)) orphanInt.push(i);
	log(orphanHull.length === 0, `${name}: hull vertices all referenced (orphaned hull: [${orphanHull.join(',')}])`);
	if (orphanInt.length) console.log(`     (interior orphans: [${orphanInt.join(',')}])`);
}

console.log('\n=== concave cactus repro (centroid-clip) ===');
run('no-interior', []);
run('one-interior', [400, 350]);
run('two-interior', [400, 350, 620, 360]);          // 2nd near the right armpit
run('two-interior-b', [400, 350, 180, 360]);        // 2nd near the left armpit
run('center+arms', [400, 350, 650, 360, 150, 360]);

console.log(pass ? '\n✅ PASS (could not repro)' : '\n✗ FAIL — centroid-clip orphans a reflex hull vertex. Needs constrained triangulation.');
process.exit(pass ? 0 : 1);
