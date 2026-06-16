// Spike — constrained Delaunay triangulation (CDT) to replace Delaunay+centroid-clip.
// Ear-clip the hull polygon (every hull vertex referenced, boundary respected), insert
// interior points by triangle-split, then a Delaunay flip pass that NEVER flips a hull
// boundary edge. Guarantees: every vertex referenced, all hull edges present, exact
// non-overlapping cover of the polygon (no concavity crossing), good triangle quality.
//   node tools/rigger-spike/retriangulate-cdt.mjs

// ---- candidate functions (to be ported into view.html) --------------------
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

function cdt(w, hull) {
	const m = w.length / 2;
	if (m < 3) return [];
	const ring = []; for (let i = 0; i < hull; i++) ring.push(i);
	let tris = earClip(ring, w);
	if (!tris) return null;
	// insert interior points (hull..m-1) by splitting the containing triangle
	for (let p = hull; p < m; p++) {
		let placed = false;
		for (let ti = 0; ti < tris.length; ti++) {
			const [a, b, c] = tris[ti];
			const r = bary(w[p * 2], w[p * 2 + 1], w[a * 2], w[a * 2 + 1], w[b * 2], w[b * 2 + 1], w[c * 2], w[c * 2 + 1]);
			if (r && r.u >= -1e-7 && r.v >= -1e-7 && r.w >= -1e-7) {
				tris.splice(ti, 1, [a, b, p], [b, c, p], [c, a, p]);
				placed = true; break;
			}
		}
		// if not strictly inside any triangle, attach to the nearest triangle's centroid owner
		if (!placed) {
			let best = -1, bestD = Infinity;
			for (let ti = 0; ti < tris.length; ti++) {
				const [a, b, c] = tris[ti];
				const cx = (w[a * 2] + w[b * 2] + w[c * 2]) / 3, cy = (w[a * 2 + 1] + w[b * 2 + 1] + w[c * 2 + 1]) / 3;
				const dd = (cx - w[p * 2]) ** 2 + (cy - w[p * 2 + 1]) ** 2;
				if (dd < bestD) { bestD = dd; best = ti; }
			}
			if (best >= 0) { const [a, b, c] = tris[best]; tris.splice(best, 1, [a, b, p], [b, c, p], [c, a, p]); }
		}
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
			tris[recs[0].ti] = [a, c, d];
			tris[recs[1].ti] = [b, d, c];
			changed = true; break;
		}
	}
	return tris;
}
// ---------------------------------------------------------------------------

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
	const w0 = HULL.concat(interior);
	const ded = dedup(w0, hull);
	const w = ded.w2, hull2 = ded.hull;
	const m = w.length / 2;
	const tris = cdt(w, hull2);
	if (!tris) { log(false, `${name}: ear-clip failed`); return; }
	const used = new Set(tris.flat());
	const orphan = []; for (let i = 0; i < m; i++) if (!used.has(i)) orphan.push(i);
	log(orphan.length === 0, `${name}: removed ${ded.removed} dup(s); every vertex referenced (orphans: [${orphan.join(',')}])`);
	let allEdges = true; for (let i = 0; i < hull2; i++) { const k = ek(i, (i + 1) % hull2); const present = tris.some(([a, b, c]) => [ek(a, b), ek(b, c), ek(c, a)].includes(k)); if (!present) { allEdges = false; break; } }
	log(allEdges, `${name}: all hull boundary edges present`);
	let area = 0; for (const [a, b, c] of tris) area += triArea(w, a, b, c);
	const pa = polyArea(w, hull2);
	log(Math.abs(area - pa) < pa * 1e-4, `${name}: exact cover (Σtri ${area.toFixed(1)} ≈ poly ${pa.toFixed(1)})`);
	const degen = tris.filter(([a, b, c]) => triArea(w, a, b, c) <= 1e-6).length;
	log(degen === 0, `${name}: no degenerate triangles (${degen})`);
}

console.log('\n=== constrained Delaunay (cactus) ===');
run('no-interior', []);
run('one-interior', [400, 350]);
run('two-interior', [400, 350, 620, 360]);
run('two-interior-b', [400, 350, 180, 360]);
run('center+arms+armpits', [400, 350, 650, 360, 150, 360, 560, 300, 240, 300]);
// stress: interior point ON a hull-ish line + a near-duplicate of an interior point
run('dense-grid', Array.from({ length: 20 }, (_, k) => [350 + (k % 5) * 30, 200 + Math.floor(k / 5) * 80]).flat());

console.log(pass ? '\n✅ PASS — CDT references every vertex, keeps all hull edges, covers exactly, no concavity crossing.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
