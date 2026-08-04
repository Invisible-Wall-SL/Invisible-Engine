// Verify Phase 3.6b constraint-edge (mesh `edges`) authoring headlessly:
//   1. forceConstraintEdge makes a missing diagonal PRESENT without folding the triangulation.
//   2. hull + edges round-trip byte-for-byte through spine-core (hullLength = hull*2; edges
//      identical, all even, all < uvs.length) — the desktop-Spine layout contract.
//   3. parse/serialize/remap edges survive a vertex removal (drop touching, renumber rest).
//
// Geometry helpers below MIRROR the pure functions in
//   apps/launcher-api/static/rigger/view.html  (sideOf/segmentsCross/earClip/hasEdge/
//    forceConstraintEdge, and parseEdges/serializeEdges/remapEdges/removeOneRemap)
// which live in one non-module <script> and can't be imported — keep the two in sync.
//   node tools/rigger-spike/hulledges.mjs

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log('\n=== Phase 3.6b hull + constraint edges ===');

// ---- mirrored pure geometry (view.html) -----------------------------------
const sideOf = (w, p, q, r) => (w[q * 2] - w[p * 2]) * (w[r * 2 + 1] - w[p * 2 + 1]) - (w[q * 2 + 1] - w[p * 2 + 1]) * (w[r * 2] - w[p * 2]);
function segmentsCross(w, a, b, c, d){
	const d1 = sideOf(w, c, d, a), d2 = sideOf(w, c, d, b), d3 = sideOf(w, a, b, c), d4 = sideOf(w, a, b, d);
	return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function earClip(ring, worldPos){
	const P = ring.map((i) => ({ i, x: worldPos[i * 2], y: worldPos[i * 2 + 1] }));
	let area = 0;
	for (let i = 0; i < P.length; i++){ const j = (i + 1) % P.length; area += P[i].x * P[j].y - P[j].x * P[i].y; }
	if (area < 0) P.reverse();
	const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const inTri = (p, a, b, c) => {
		const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
		return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
	};
	const v = P.slice(), tris = [];
	let guard = 0;
	while (v.length > 3 && guard++ < 2000){
		let clipped = false;
		for (let i = 0; i < v.length; i++){
			const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
			if (cross(a, b, c) <= 0) continue;
			let ear = true;
			for (const q of v){ if (q === a || q === b || q === c) continue; if (inTri(q, a, b, c)){ ear = false; break; } }
			if (!ear) continue;
			tris.push([a.i, b.i, c.i]); v.splice(i, 1); clipped = true; break;
		}
		if (!clipped) return null;
	}
	if (v.length === 3) tris.push([v[0].i, v[1].i, v[2].i]);
	return tris;
}
function hasEdge(tris, a, b){
	for (const [x, y, z] of tris)
		if ((x === a || y === a || z === a) && (x === b || y === b || z === b)) return true;
	return false;
}
function forceConstraintEdge(tris, w, a, b){
	const ax = w[a * 2], ay = w[a * 2 + 1], bx = w[b * 2], by = w[b * 2 + 1];
	for (let i = 0; i < w.length / 2; i++){
		if (i === a || i === b) continue;
		const px = w[i * 2], py = w[i * 2 + 1];
		if (Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) > 1e-6) continue;
		const t = Math.abs(bx - ax) > Math.abs(by - ay) ? (px - ax) / (bx - ax) : (py - ay) / (by - ay);
		if (t > 1e-4 && t < 1 - 1e-4) return false;
	}
	const crossed = [];
	for (let ti = 0; ti < tris.length; ti++){
		const T = tris[ti];
		let hit = false;
		for (let i = 0; i < 3 && !hit; i++){
			const u = T[i], v = T[(i + 1) % 3];
			if (u === a || u === b || v === a || v === b) continue;
			if (segmentsCross(w, a, b, u, v)) hit = true;
		}
		if (hit) crossed.push(ti);
	}
	if (!crossed.length) return false;
	const count = new Map(), keyOf = (x, y) => Math.min(x, y) + ':' + Math.max(x, y);
	for (const ti of crossed){ const T = tris[ti]; for (const [x, y] of [[T[0], T[1]], [T[1], T[2]], [T[2], T[0]]]) count.set(keyOf(x, y), (count.get(keyOf(x, y)) || 0) + 1); }
	const adj = new Map();
	const link = (x, y) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); };
	for (const ti of crossed){ const T = tris[ti]; for (const [x, y] of [[T[0], T[1]], [T[1], T[2]], [T[2], T[0]]]) if (count.get(keyOf(x, y)) === 1){ link(x, y); link(y, x); } }
	if (!adj.has(a) || !adj.has(b)) return false;
	for (const [, nb] of adj) if (nb.length !== 2) return false;
	const ring = [a]; let prev = a, cur = adj.get(a)[0], guard = 0;
	while (cur !== a && guard++ < adj.size + 2){ ring.push(cur); const [n0, n1] = adj.get(cur); const nxt = n0 === prev ? n1 : n0; prev = cur; cur = nxt; }
	if (cur !== a || ring.length !== adj.size) return false;
	const ia = ring.indexOf(a), ib = ring.indexOf(b);
	if (ia < 0 || ib < 0) return false;
	const arc = (from, to) => { const out = []; for (let i = from; ; i = (i + 1) % ring.length){ out.push(ring[i]); if (i === to) break; } return out; };
	const poly1 = arc(ia, ib), poly2 = arc(ib, ia);
	if (poly1.length < 3 || poly2.length < 3) return false;
	const t1 = earClip(poly1, w), t2 = earClip(poly2, w);
	if (!t1 || !t2) return false;
	crossed.sort((x, y) => y - x);
	for (const ti of crossed) tris.splice(ti, 1);
	for (const t of t1) tris.push(t);
	for (const t of t2) tris.push(t);
	return true;
}
// edges bookkeeping (view.html)
const parseEdges = (rd) => { const e = rd && rd.edges; if (!Array.isArray(e)) return []; const out = []; for (let i = 0; i + 1 < e.length; i += 2){ const a = e[i] >> 1, b = e[i + 1] >> 1; if (a !== b) out.push([a, b]); } return out; };
function serializeEdges(rd, pairs){ const seen = new Set(), flat = []; for (const [a, b] of pairs){ const lo = Math.min(a, b), hi = Math.max(a, b); if (lo === hi) continue; const k = lo + ':' + hi; if (seen.has(k)) continue; seen.add(k); flat.push(lo * 2, hi * 2); } if (flat.length) rd.edges = flat; else delete rd.edges; }
function remapEdges(rd, remap){ if (!rd || !Array.isArray(rd.edges)) return; const out = []; for (const [a, b] of parseEdges(rd)){ const na = remap[a], nb = remap[b]; if (na == null || nb == null || na < 0 || nb < 0 || na === nb) continue; out.push([na, nb]); } serializeEdges(rd, out); }
const removeOneRemap = (k, count) => { const r = new Array(count); for (let i = 0; i < count; i++) r[i] = i === k ? -1 : i < k ? i : i - 1; return r; };

// ---- 1. constraint present, no fold ---------------------------------------
{
	// a convex hexagon; a naive fan triangulation from vertex 0 that OMITS the 1–4 diagonal
	const w = [0, 0,  2, 0,  3, 1.5,  2, 3,  0, 3,  -1, 1.5]; // verts 0..5, all on the hull
	let tris = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]]; // fan from 0 — no edge (1,4)
	const before = hasEdge(tris, 1, 4);
	const ok = forceConstraintEdge(tris, w, 1, 4);
	const after = hasEdge(tris, 1, 4);
	log(!before && ok && after, `forced missing diagonal (1,4): before=${before} forced=${ok} after=${after}`);
	// no folds: every triangle CCW-or-CW consistently (all same sign of signed area)
	const signs = tris.map(([a, b, c]) => Math.sign(sideOf(w, a, b, c)));
	log(signs.every((s) => s !== 0) && (signs.every((s) => s > 0) || signs.every((s) => s < 0)), `triangulation stays fold-free (${tris.length} tris, one winding)`);
	// total area preserved (cavity retriangulation is area-conserving)
	const area = (ts) => ts.reduce((s, [a, b, c]) => s + Math.abs(sideOf(w, a, b, c)) / 2, 0);
	log(Math.abs(area(tris) - area([[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]])) < 1e-6, 'total area unchanged after forcing');
	// collinear guard: a vertex exactly on the segment → returns false, tris untouched
	const w2 = [0, 0,  2, 0,  4, 0,  4, 2,  0, 2]; // vert 1 lies on segment 0–2
	let t2 = [[0, 1, 4], [1, 3, 4], [1, 2, 3]];
	const snapshot = JSON.stringify(t2);
	const forced = forceConstraintEdge(t2, w2, 0, 2);
	log(forced === false && JSON.stringify(t2) === snapshot, 'collinear vertex on the segment → refused, tris untouched');
}

// ---- 2. hull + edges round-trip through spine-core -------------------------
{
	const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
	const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);
	// minimal atlas: one 64×64 page with one region "img"
	const atlasText = 'page.png\nsize: 64,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimg\n  rotate: false\n  xy: 0, 0\n  size: 64, 64\n  orig: 64, 64\n  offset: 0, 0\n  index: -1\n';
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 64, height: 64 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages){ p.width = 64; p.height = 64; try { p.setTexture(stub); } catch { p.texture = stub; } }
	const HULL = 4;
	const rd = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5], vertices: [0, 0, 64, 0, 64, 64, 0, 64, 32, 32], hull: HULL, triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] };
	serializeEdges(rd, [...Array.from({ length: HULL }, (_, i) => [i, (i + 1) % HULL]), [0, 2]]); // hull loop + one interior constraint
	const rawEdges = rd.edges.slice();
	const skel = { skeleton: { spine: '4.2.00', hash: 'x' }, bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root', attachment: 'img' }], skins: [{ name: 'default', attachments: { s: { img: rd } } }] };
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(skel);
	const att = data.findSkin('default').getAttachments().find((e) => e.name === 'img').attachment;
	log(att.hullLength === HULL * 2, `hullLength ${att.hullLength} === hull ${HULL} × 2`);
	log(JSON.stringify(Array.from(att.edges)) === JSON.stringify(rawEdges), `edges round-trip byte-identical (${rawEdges.join(',')})`);
	const nUv = rd.uvs.length; // uv components == vertex components; edges index by ×2 into it
	log(rawEdges.every((v) => v % 2 === 0 && v < nUv), `every edge value even and < uvs.length (${nUv})`);
}

// ---- 3. remap on vertex removal -------------------------------------------
{
	const rd = {};
	serializeEdges(rd, [[0, 1], [1, 2], [2, 3], [1, 3]]); // 4 edges over verts 0..3
	remapEdges(rd, removeOneRemap(2, 4)); // remove vertex 2: 0→0,1→1,2→gone,3→2
	const got = parseEdges(rd).map(([a, b]) => `${a}-${b}`).sort().join(',');
	// (0,1) kept; (1,2)&(2,3) touched 2 → dropped; (1,3)→(1,2)
	log(got === '0-1,1-2', `after removing vtx 2: edges = [${got}] (dropped 2's, renumbered 3→2)`);
}

console.log(pass ? '\n✅ PASS — constraint edges force cleanly, hull/edges round-trip, remap is correct.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
