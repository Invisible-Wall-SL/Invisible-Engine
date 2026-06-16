// Spike — prove the Delaunay re-triangulation the rigger will use over a mesh's
// hull boundary + interior ("floating") points is VALID: every triangle's indices
// in range, no degenerate triangles, every interior point referenced (the mesh
// "passes through" it), and for a convex hull the triangles exactly tile the hull
// (Σ triangle area == hull area → a non-overlapping cover). Also checks a CONCAVE
// hull carves its notch (a point in the notch is left uncovered).
//   node tools/rigger-spike/retriangulate.mjs [skeleton.json skeleton.atlas]
import { readFileSync } from 'node:fs';

// ---- the EXACT functions ported into view.html ----------------------------
function pointInPolygon(px, py, poly) {
	let inside = false;
	const n = poly.length / 2;
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
// ---------------------------------------------------------------------------

const triArea = (w, a, b, c) => Math.abs((w[b * 2] - w[a * 2]) * (w[c * 2 + 1] - w[a * 2 + 1]) - (w[c * 2] - w[a * 2]) * (w[b * 2 + 1] - w[a * 2 + 1])) / 2;
function bary(px, py, ax, ay, bx, by, cx, cy) {
	const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
	if (Math.abs(d) < 1e-12) return null;
	const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
	const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
	return { u, v, w: 1 - u - v };
}
const covered = (w, tris, px, py) => tris.some(([a, b, c]) => { const r = bary(px, py, w[a * 2], w[a * 2 + 1], w[b * 2], w[b * 2 + 1], w[c * 2], w[c * 2 + 1]); return r && r.u >= -1e-6 && r.v >= -1e-6 && r.w >= -1e-6; });

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

function checkValid(name, w, hull, tris, { interiorRefd = true } = {}) {
	const m = w.length / 2;
	const inRange = tris.every(([a, b, c]) => [a, b, c].every((i) => i >= 0 && i < m));
	log(inRange, `${name}: all indices in range`);
	const noDegen = tris.every(([a, b, c]) => triArea(w, a, b, c) > 1e-6);
	log(noDegen, `${name}: no degenerate triangles`);
	if (interiorRefd) {
		const used = new Set(tris.flat());
		let allInt = true; for (let i = hull; i < m; i++) if (!used.has(i)) allInt = false;
		log(allInt, `${name}: every interior point is woven into the mesh`);
	}
	return { inRange, noDegen };
}

// --- Test 1: square hull + 4×4 interior grid → exact tiling -----------------
console.log('\n=== Re-triangulation spike ===');
{
	const w = [0, 0, 100, 0, 100, 100, 0, 100]; // hull (CCW square)
	const hull = 4;
	for (let gy = 1; gy <= 4; gy++) for (let gx = 1; gx <= 4; gx++) w.push(gx * 20, gy * 20);
	const tris = retriangulate(w, hull);
	checkValid('square+grid', w, hull, tris);
	let area = 0; for (const [a, b, c] of tris) area += triArea(w, a, b, c);
	log(Math.abs(area - 10000) < 1, `square+grid: triangles tile the hull exactly (Σarea ${area.toFixed(1)} ≈ 10000)`);
}

// --- Test 2: many random interior points → still a clean cover --------------
{
	const w = [0, 0, 200, 0, 200, 120, 0, 120];
	const hull = 4;
	let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
	for (let i = 0; i < 30; i++) w.push(8 + rnd() * 184, 8 + rnd() * 104);
	const tris = retriangulate(w, hull);
	checkValid('random-30', w, hull, tris);
	let area = 0; for (const [a, b, c] of tris) area += triArea(w, a, b, c);
	log(Math.abs(area - 200 * 120) < 2, `random-30: Σarea ${area.toFixed(1)} ≈ ${200 * 120} (no overlaps/gaps)`);
}

// --- Test 3: concave L-hull → the notch is carved out -----------------------
{
	// L-shape: outer 6-vertex boundary with a notch in the top-right quadrant
	const w = [0, 0, 100, 0, 100, 50, 50, 50, 50, 100, 0, 100];
	const hull = 6;
	w.push(25, 25, 25, 75, 10, 50); // interior points in the solid part
	const tris = retriangulate(w, hull);
	checkValid('concave-L', w, hull, tris);
	// a point deep in the notch (top-right, x>50 && y>50) must NOT be covered
	log(!covered(w, tris, 75, 75), 'concave-L: the notch is left uncovered (concavity respected)');
	// a point in the solid part MUST be covered
	log(covered(w, tris, 25, 25) || covered(w, tris, 20, 20), 'concave-L: the solid body is covered');
	let area = 0; for (const [a, b, c] of tris) area += triArea(w, a, b, c);
	log(Math.abs(area - 7500) < 5, `concave-L: Σarea ${area.toFixed(1)} ≈ 7500 (L = 100·100 − 50·50)`);
}

// --- Test 4 (optional): swap into a real skeleton + load via spine-core ------
const [, , jsonPath, atlasPath] = process.argv;
if (jsonPath && atlasPath) {
	const CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
	const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(CORE);
	const atlasText = readFileSync(atlasPath, 'utf8');
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	// find the first mesh attachment, retriangulate it from its own (local) verts
	let found = null;
	for (const skinName of Object.keys(raw.skins ? (Array.isArray(raw.skins) ? {} : raw.skins) : {})) void skinName;
	const skins = Array.isArray(raw.skins) ? raw.skins : Object.entries(raw.skins || {}).map(([name, attachments]) => ({ name, attachments }));
	outer: for (const sk of skins) for (const slot of Object.keys(sk.attachments || {})) for (const an of Object.keys(sk.attachments[slot])) {
		const a = sk.attachments[slot][an];
		if (a.type === 'mesh' && Array.isArray(a.uvs) && a.uvs.length >= 8) { found = { sk, slot, an, a }; break outer; }
	}
	if (!found) { log(true, '(no mesh attachment in file — skipped spine-core load)'); }
	else {
		const a = found.a;
		// reconstruct planar verts: for a non-weighted mesh `vertices` IS [x,y,...]
		const m = a.uvs.length / 2;
		let planar = null;
		if (Array.isArray(a.vertices) && a.vertices.length === m * 2) planar = a.vertices.slice();
		if (planar) {
			const tris = retriangulate(planar, a.hull || m);
			checkValid(`real:${found.slot}/${found.an}`, planar, a.hull || m, tris, { interiorRefd: (a.hull || m) < m });
			a.triangles = tris.flat();
			const atlas = new TextureAtlas(atlasText);
			const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
			for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
			let ok = true; try { new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(raw); } catch (e) { ok = false; console.log('   spine-core: ' + e.message); }
			log(ok, `real mesh re-triangulated (${tris.length} tris) loads through spine-core`);
		} else log(true, '(first mesh is weighted — planar reconstruct skipped)');
	}
}

console.log(pass ? '\n✅ PASS — re-triangulation weaves interior points in, tiles convex hulls exactly, and carves concavities.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
