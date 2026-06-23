// Spike — constrained Delaunay triangulation (CDT) to replace Delaunay+centroid-clip.
// Ear-clip the hull polygon (every hull vertex referenced, boundary respected), insert
// interior points by triangle-split, then a Delaunay flip pass that NEVER flips a hull
// boundary edge. Guarantees: every vertex referenced, all hull edges present, exact
// non-overlapping cover of the polygon (no concavity crossing), good triangle quality,
// and — the property the editor's "remove vertex" depends on — EVERY interior vertex
// has a clean manifold one-ring (so it can always be removed).
//   node tools/rigger-spike/retriangulate-cdt.mjs
//
// These functions are the canonical source for view.html's cdtTriangulate / pointInHull /
// splitTrisOnEdge / removeMeshVertex ring walk — keep them in sync.

const EDGE_EPS = 1e-4; // bary min below this → treat the point as ON an edge (split both tris)
const OUT_EPS = 1e-2; // even the closest triangle's bary min below -this → point is outside → skip

function earClip(ring, w) {
	const P = ring.map((i) => ({ i, x: w[i * 2], y: w[i * 2 + 1] }));
	let area = 0;
	for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; area += P[i].x * P[j].y - P[j].x * P[i].y; }
	if (area < 0) P.reverse();
	const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const inTri = (p, a, b, c) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))); };
	const v = P.slice(), tris = [];
	let guard = 0;
	while (v.length > 3 && guard++ < 5000) {
		let clipped = false;
		for (let i = 0; i < v.length; i++) {
			const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
			if (cross(a, b, c) <= 0) continue;
			let ear = true;
			for (const q of v) { if (q === a || q === b || q === c) continue; if (inTri(q, a, b, c)) { ear = false; break; } }
			if (!ear) continue;
			tris.push([a.i, b.i, c.i]); v.splice(i, 1); clipped = true; break;
		}
		if (!clipped) return null;
	}
	if (v.length === 3) tris.push([v[0].i, v[1].i, v[2].i]);
	return tris;
}
function bary(px, py, ax, ay, bx, by, cx, cy) {
	const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
	if (Math.abs(d) < 1e-12) return null;
	const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
	const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
	return { u, v, w: 1 - u - v };
}
function circumcircleContains(ax, ay, bx, by, cx, cy, px, py) {
	const adx = ax - px, ady = ay - py, bdx = bx - px, bdy = by - py, cdx = cx - px, cdy = cy - py;
	const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
	const orient = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	if (Math.abs(orient) < 1e-9) return false; // degenerate triangle → never "contains"
	const det = adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
	return orient > 0 ? det > 1e-9 : det < -1e-9;
}
const ek = (u, v) => (u < v ? u + ',' + v : v + ',' + u);
function ccw(w, p, q, r) { return (w[q * 2] - w[p * 2]) * (w[r * 2 + 1] - w[p * 2 + 1]) - (w[q * 2 + 1] - w[p * 2 + 1]) * (w[r * 2] - w[p * 2]); }
function segCross(w, a, b, c, d) { const d1 = ccw(w, c, d, a), d2 = ccw(w, c, d, b), d3 = ccw(w, a, b, c), d4 = ccw(w, a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }

// Split the 1-or-2 triangles sharing edge (ea,eb) by inserting p on that edge, keeping
// each triangle's winding. (1 sharer = a hull boundary edge; 2 = an interior edge.)
// Preserving winding is what keeps the result fold-free and manifold.
function splitTrisOnEdge(tris, ea, eb, p) {
	const hits = [];
	for (let ti = 0; ti < tris.length; ti++) {
		const T = tris[ti];
		if (T.indexOf(ea) < 0 || T.indexOf(eb) < 0) continue;
		for (let i = 0; i < 3; i++) {
			const u = T[i], v = T[(i + 1) % 3], third = T[(i + 2) % 3];
			if ((u === ea && v === eb) || (u === eb && v === ea)) { hits.push({ ti, u, v, third }); break; }
		}
	}
	hits.sort((x, y) => y.ti - x.ti); // splice high→low so earlier indices stay valid
	for (const h of hits) tris.splice(h.ti, 1, [h.u, p, h.third], [p, h.v, h.third]);
	return hits.length;
}

function cdt(w, hull) {
	const m = w.length / 2;
	if (m < 3) return [];
	const ring = []; for (let i = 0; i < hull; i++) ring.push(i);
	let tris = earClip(ring, w);
	if (!tris) return null;
	// insert interior points (hull..m-1). Strictly inside → split into 3. On/near an edge →
	// split BOTH triangles sharing it (no T-junction, no sliver, can't invert). Truly outside
	// the polygon (shouldn't happen — caller pre-filters) → skip rather than fold.
	for (let p = hull; p < m; p++) {
		let inside = -1, host = -1, hostMin = -Infinity, hostEdge = -1;
		for (let ti = 0; ti < tris.length; ti++) {
			const [a, b, c] = tris[ti];
			const r = bary(w[p * 2], w[p * 2 + 1], w[a * 2], w[a * 2 + 1], w[b * 2], w[b * 2 + 1], w[c * 2], w[c * 2 + 1]);
			if (!r) continue;
			const mn = Math.min(r.u, r.v, r.w);
			if (mn >= EDGE_EPS) { inside = ti; break; }
			if (mn > hostMin) { hostMin = mn; host = ti; hostEdge = r.u <= r.v && r.u <= r.w ? 0 : r.v <= r.w ? 1 : 2; }
		}
		if (inside >= 0) {
			const [a, b, c] = tris[inside];
			tris.splice(inside, 1, [a, b, p], [b, c, p], [c, a, p]);
			continue;
		}
		if (host < 0 || hostMin < -OUT_EPS) continue; // outside the polygon → skip
		const [a, b, c] = tris[host];
		const ea = hostEdge === 0 ? b : hostEdge === 1 ? c : a;
		const eb = hostEdge === 0 ? c : hostEdge === 1 ? a : b;
		splitTrisOnEdge(tris, ea, eb, p);
	}
	// constraint edges = hull boundary loop
	const constraints = new Set();
	for (let i = 0; i < hull; i++) constraints.add(ek(i, (i + 1) % hull));
	// Delaunay flip pass (never flip a constraint edge)
	let guard = 0, changed = true;
	while (changed && guard++ < 4000) {
		changed = false;
		const edge = new Map();
		for (let ti = 0; ti < tris.length; ti++) {
			const [a, b, c] = tris[ti];
			for (const [u, v, opp] of [[a, b, c], [b, c, a], [c, a, b]]) { const k = ek(u, v); if (!edge.has(k)) edge.set(k, []); edge.get(k).push({ ti, u, v, opp }); }
		}
		for (const [k, recs] of edge) {
			if (recs.length !== 2 || constraints.has(k)) continue;
			const a = recs[0].u, b = recs[0].v, c = recs[0].opp, d = recs[1].opp;
			if (!circumcircleContains(w[a * 2], w[a * 2 + 1], w[b * 2], w[b * 2 + 1], w[c * 2], w[c * 2 + 1], w[d * 2], w[d * 2 + 1])) continue;
			if (!segCross(w, a, b, c, d)) continue; // only flip if quad is convex (diagonals cross)
			// tri0 winds a→b→c, tri1 winds b→a→d. New diagonal c-d → the two CCW triangles
			// are [a,d,c] and [b,c,d]. (Emitting [a,c,d]/[b,d,c] reverses winding — the bug
			// that made flipped triangles non-manifold and blocked remove-vertex.)
			tris[recs[0].ti] = [a, d, c];
			tris[recs[1].ti] = [b, c, d];
			changed = true; break;
		}
	}
	// drop any exact-degenerate (collinear) triangle a split may have left behind
	tris = tris.filter(([a, b, c]) => Math.abs(ccw(w, a, b, c)) > 1e-7);
	return tris;
}

// Ray-cast point-in-polygon for the (possibly concave) outline = first `hull` verts of w.
function pointInHull(px, py, w, hull) {
	let inside = false;
	for (let i = 0, j = hull - 1; i < hull; j = i++) {
		const xi = w[i * 2], yi = w[i * 2 + 1], xj = w[j * 2], yj = w[j * 2 + 1];
		if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
	}
	return inside;
}

// The editor flow: dedup → drop interior points outside the outline → CDT.
function reweave(w0, hull0) {
	const ded = dedup(w0, hull0);
	let w = ded.w2, hull = ded.hull;
	const m = w.length / 2;
	const keep = [];
	let droppedOutside = 0;
	for (let i = 0; i < m; i++) {
		if (i < hull) { keep.push(i); continue; }
		if (pointInHull(w[i * 2], w[i * 2 + 1], w, hull)) keep.push(i); else droppedOutside++;
	}
	if (droppedOutside) { const w2 = []; for (const k of keep) w2.push(w[k * 2], w[k * 2 + 1]); w = w2; }
	const tris = cdt(w, hull);
	return { w, hull, tris, removedDup: ded.removed, droppedOutside };
}

// The remove-vertex ring walk, lifted verbatim from view.html's removeMeshVertex. Returns
// true iff interior vertex k has a clean, single, manifold one-ring (so it's removable).
function ringRemovable(tris, k) {
	const edges = [];
	for (const [a, b, c] of tris) {
		if (a !== k && b !== k && c !== k) continue;
		if (a === k) edges.push([b, c]); else if (b === k) edges.push([c, a]); else edges.push([a, b]);
	}
	if (edges.length < 3) return false;
	const nxt = new Map(); for (const [f, to] of edges) nxt.set(f, to);
	const startV = edges[0][0], ringArr = [startV];
	let cur = nxt.get(startV), g = 0;
	while (cur !== undefined && cur !== startV && g++ < edges.length + 2) { ringArr.push(cur); cur = nxt.get(cur); }
	return cur === startV && ringArr.length === edges.length;
}

// dedup (tight relative EPS) — runs BEFORE cdt in the real flow, returns deduped verts + new hull count
function dedup(w, hull) {
	const m = w.length / 2;
	let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
	for (let i = 0; i < m; i++) { const x = w[i * 2], y = w[i * 2 + 1]; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
	const EPS = Math.max(1e-4, Math.hypot(maxx - minx, maxy - miny) * 1e-5), E2 = EPS * EPS;
	const keep = [];
	for (let i = 0; i < m; i++) { let dup = false; for (const k of keep) { const dx = w[i * 2] - w[k * 2], dy = w[i * 2 + 1] - w[k * 2 + 1]; if (dx * dx + dy * dy < E2) { dup = true; break; } } if (!dup) keep.push(i); }
	const w2 = []; for (const k of keep) w2.push(w[k * 2], w[k * 2 + 1]);
	let h2 = 0; for (const k of keep) if (k < hull) h2++;
	return { w2, hull: h2, removed: m - keep.length };
}
const triArea = (w, a, b, c) => Math.abs((w[b * 2] - w[a * 2]) * (w[c * 2 + 1] - w[a * 2 + 1]) - (w[c * 2] - w[a * 2]) * (w[b * 2 + 1] - w[a * 2 + 1])) / 2;
function polyArea(w, hull) { let a = 0; for (let i = 0; i < hull; i++) { const j = (i + 1) % hull; a += w[i * 2] * w[j * 2 + 1] - w[j * 2] * w[i * 2 + 1]; } return Math.abs(a) / 2; }

const HULL = [300, 600, 500, 600, 520, 400, 750, 420, 760, 250, 560, 300, 520, 80, 280, 80, 240, 300, 40, 250, 50, 420, 280, 400];
const hull = HULL.length / 2;
let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
function run(name, interior) {
	const { w, hull: hull2, tris, removedDup, droppedOutside } = reweave(HULL.concat(interior), hull);
	if (!tris) { log(false, `${name}: ear-clip failed`); return; }
	const m = w.length / 2;
	const used = new Set(tris.flat());
	const orphan = []; for (let i = 0; i < m; i++) if (!used.has(i)) orphan.push(i);
	log(orphan.length === 0, `${name}: dup ${removedDup}, outside ${droppedOutside}; every kept vertex referenced (orphans: [${orphan.join(',')}])`);
	let allEdges = true; for (let i = 0; i < hull2; i++) { const k = ek(i, (i + 1) % hull2); const present = tris.some(([a, b, c]) => [ek(a, b), ek(b, c), ek(c, a)].includes(k)); if (!present) { allEdges = false; break; } }
	log(allEdges, `${name}: all hull boundary edges present`);
	let area = 0; for (const [a, b, c] of tris) area += triArea(w, a, b, c);
	const pa = polyArea(w, hull2);
	log(Math.abs(area - pa) < pa * 1e-4, `${name}: exact cover (Σtri ${area.toFixed(1)} ≈ poly ${pa.toFixed(1)})`);
	const inverted = tris.filter(([a, b, c]) => ccw(w, a, b, c) <= 1e-7).length;
	log(inverted === 0, `${name}: no inverted/degenerate triangles (${inverted})`);
	// THE property "remove vertex" relies on: every interior vertex has a removable one-ring.
	const stuck = []; for (let k = hull2; k < m; k++) if (!ringRemovable(tris, k)) stuck.push(k);
	log(stuck.length === 0, `${name}: every interior vertex is removable (stuck: [${stuck.join(',')}])`);
}

console.log('\n=== constrained Delaunay + manifold/removable guarantees (cactus) ===');
run('no-interior', []);
run('one-interior', [400, 350]);
run('two-interior', [400, 350, 620, 360]);
run('two-interior-b', [400, 350, 180, 360]);
run('center+arms+armpits', [400, 350, 650, 360, 150, 360, 560, 300, 240, 300]);
// stress: a 4×5 interior grid (the user's "add 15 points then retriangulate then remove")
run('dense-grid', Array.from({ length: 20 }, (_, k) => [350 + (k % 5) * 30, 200 + Math.floor(k / 5) * 80]).flat());
// regression: a point well OUTSIDE the outline must be dropped, leaving a fully removable mesh
run('outside-point', [400, 350, 2000, 2000]);
// regression: a point sitting exactly ON an interior edge (T-junction trigger)
run('on-edge', [400, 350, 400, 475]);

console.log(pass ? '\n✅ PASS — CDT covers exactly, never folds, and every interior vertex stays removable.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
