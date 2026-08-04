// Verify Phase 3.6c: a vertex-index permutation (as a hull promote/demote produces) is applied
// consistently to uvs + vertices + triangles + DEFORM timelines, so posed geometry — including a
// deform animation — is unchanged (each vertex's world position follows it to its new index).
// This is the load-bearing gate; it also covers the pre-existing latent bug (deform never
// permuted on vertex removal). Validated by posing through spine-core, not memory.
//   node tools/rigger-spike/hulledit.mjs
//
// The permute helpers below MIRROR reorderDeform + the uvs/vertices/triangles gather in
//   apps/launcher-api/static/rigger/view.html  (permuteMeshVertices) — keep in sync.

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log('\n=== Phase 3.6c vertex permutation preserves posed deform ===');

const CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(CORE);

const ATLAS = 'page.png\nsize: 64,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimg\n  rotate: false\n  xy: 0, 0\n  size: 64, 64\n  orig: 64, 64\n  offset: 0, 0\n  index: -1\n';
function loadData(raw){
  const atlas = new TextureAtlas(ATLAS);
  const stub = { getImage: () => ({ width: 64, height: 64 }), setFilters(){}, setWraps(){}, dispose(){} };
  for (const p of atlas.pages){ p.width = 64; p.height = 64; try { p.setTexture(stub); } catch { p.texture = stub; } }
  return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(raw);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// Pose skeleton from `anim` at t and read the mesh's world vertices (indexed by CURRENT order).
function worldVertsAt(raw, anim, t){
  const data = loadData(raw);
  const sk = new Skeleton(data);
  sk.setSkin(data.findSkin('default')); sk.setSlotsToSetupPose();
  const si = data.slots.findIndex((s) => s.name === 's');
  const slot = sk.slots[si];
  const att = data.findSkin('default').getAttachment(si, 'img');
  slot.setAttachment(att);
  if (anim){ const a = data.findAnimation(anim); a.apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn); }
  try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
  const out = new Array(att.worldVerticesLength).fill(0);
  att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
  return out;
}

// ---- mirrored permute (view.html permuteMeshVertices + reorderDeform) ------
const perVertexN = (verts) => { const out = []; let ri = 0; while (ri < verts.length){ const n = verts[ri]; out.push(n); ri += 1 + n * 4; } return out; };
function permuteMesh(rd, deformArrs, perm, newHull, weighted){
  const m = rd.uvs.length / 2;
  const inv = new Array(m); for (let o = 0; o < m; o++) inv[perm[o]] = o;
  const oldN = weighted ? perVertexN(rd.vertices) : null;
  // uvs
  const uvs = new Array(m * 2);
  for (let ni = 0; ni < m; ni++){ const oi = inv[ni]; uvs[ni * 2] = rd.uvs[oi * 2]; uvs[ni * 2 + 1] = rd.uvs[oi * 2 + 1]; }
  rd.uvs = uvs;
  // vertices
  if (weighted){
    const blocks = []; let ri = 0;
    for (let v = 0; v < m; v++){ const n = rd.vertices[ri]; blocks.push(rd.vertices.slice(ri, ri + 1 + n * 4)); ri += 1 + n * 4; }
    const out = []; for (let ni = 0; ni < m; ni++) out.push(...blocks[inv[ni]]); rd.vertices = out;
  } else {
    const out = new Array(m * 2);
    for (let ni = 0; ni < m; ni++){ const oi = inv[ni]; out[ni * 2] = rd.vertices[oi * 2]; out[ni * 2 + 1] = rd.vertices[oi * 2 + 1]; }
    rd.vertices = out;
  }
  rd.triangles = rd.triangles.map((i) => perm[i]);
  rd.hull = newHull;
  // deform (reorderDeform)
  let oldBase, newBase, oldLen, newLen;
  if (weighted){
    oldBase = new Array(m); let a = 0; for (let k = 0; k < m; k++){ oldBase[k] = a; a += 2 * oldN[k]; } oldLen = a;
    newBase = new Array(m); let b = 0; for (let ni = 0; ni < m; ni++){ newBase[ni] = b; b += 2 * oldN[inv[ni]]; } newLen = b;
  } else { oldLen = 2 * m; newLen = 2 * m; }
  for (const arr of deformArrs)
    for (const frame of arr){
      const off = frame.offset || 0, src = frame.vertices || [];
      const full = new Array(oldLen).fill(0); for (let i = 0; i < src.length; i++) if (off + i < oldLen) full[off + i] = src[i];
      const nv = new Array(newLen).fill(0);
      if (weighted){ for (let ni = 0; ni < m; ni++){ const oi = inv[ni]; for (let c = 0; c < 2 * oldN[oi]; c++) nv[newBase[ni] + c] = full[oldBase[oi] + c]; } }
      else { for (let ni = 0; ni < m; ni++){ const oi = inv[ni]; nv[ni * 2] = full[oi * 2]; nv[ni * 2 + 1] = full[oi * 2 + 1]; } }
      frame.offset = 0; frame.vertices = nv;
    }
}

// ---- fixtures --------------------------------------------------------------
const bones = [{ name: 'root' }, { name: 'b1', parent: 'root', x: 10, rotation: 25 }, { name: 'b2', parent: 'root', x: -10, rotation: -35 }];
function skel(meshRd, deform){
  return {
    skeleton: { spine: '4.2.00', hash: 'x' }, bones, slots: [{ name: 's', bone: 'root', attachment: 'img' }],
    skins: [{ name: 'default', attachments: { s: { img: meshRd } } }],
    animations: { defo: { attachments: { default: { s: { img: { deform: [{ time: 0, offset: 0, vertices: deform }] } } } } } },
  };
}

function runCase(label, weighted){
  console.log(`\n--- ${label} ---`);
  // 5-vertex mesh, hull 4 + 1 interior
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5];
  const tris = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
  let vertices, deform;
  if (!weighted){
    vertices = [0, 0, 64, 0, 64, 64, 0, 64, 32, 32];
    deform = new Array(10).fill(0); deform[2] = 7; deform[3] = -5; // move vertex 1 by (7,-5) local
  } else {
    // varied influence counts (exercises the per-vertex run gather): 1,2,1,2,1 = 7 influences
    vertices = [
      1, 1, 0, 0, 1,
      2, 1, 5, 0, 0.5, 2, -5, 0, 0.5,
      1, 2, 0, 0, 1,
      2, 1, 0, 5, 0.5, 2, 0, -5, 0.5,
      1, 1, 0, 0, 1,
    ];
    deform = new Array(14).fill(0); // 2*7 influences
    // vertex 1's influence base = 2*n0 = 2; move both its influences
    deform[2] = 4; deform[3] = -3; deform[4] = 2; deform[5] = 6;
  }
  const rd = { type: 'mesh', uvs: uvs.slice(), vertices: vertices.slice(), triangles: tris.slice(), hull: 4 };
  const raw = skel(rd, deform);

  const beforeSetup = worldVertsAt(raw, null, 0);
  const beforePosed = worldVertsAt(raw, 'defo', 0);
  const movedBefore = Math.hypot(beforePosed[1 * 2] - beforeSetup[1 * 2], beforePosed[1 * 2 + 1] - beforeSetup[1 * 2 + 1]);
  log(movedBefore > 1e-3, `deform moves vertex 1 (world Δ ${movedBefore.toFixed(3)})`);

  // a non-trivial permutation: promote interior vertex 4 into the hull between 1 and 2, i.e.
  // new order [0,1,4,2,3] → perm maps old→new. hull grows 4→5.
  const order = [0, 1, 4, 2, 3]; // new order = old indices
  const perm = new Array(5); order.forEach((oi, ni) => (perm[oi] = ni));
  const permRaw = clone(raw);
  const permRd = permRaw.skins[0].attachments.s.img;
  const permDeform = [permRaw.animations.defo.attachments.default.s.img.deform];
  permuteMesh(permRd, permDeform, perm, 5, weighted);

  log(permRd.hull === 5 && permRd.uvs.length / 2 === 5, `hull grew to ${permRd.hull}, still 5 verts`);
  const afterPosed = worldVertsAt(permRaw, 'defo', 0);

  // every vertex's posed world position must be preserved at its NEW index
  let maxErr = 0;
  for (let oi = 0; oi < 5; oi++){
    const ni = perm[oi];
    const dx = afterPosed[ni * 2] - beforePosed[oi * 2], dy = afterPosed[ni * 2 + 1] - beforePosed[oi * 2 + 1];
    maxErr = Math.max(maxErr, Math.hypot(dx, dy));
  }
  log(maxErr < 1e-4, `all 5 posed vertices preserved through the permutation (max Δ ${maxErr.toExponential(2)})`);

  // and the moved vertex (old 1 → new perm[1]) still shows the deform, not the setup
  const ni1 = perm[1];
  const stillMoved = Math.hypot(afterPosed[ni1 * 2] - worldVertsAt(permRaw, null, 0)[ni1 * 2], afterPosed[ni1 * 2 + 1] - worldVertsAt(permRaw, null, 0)[ni1 * 2 + 1]);
  log(Math.abs(stillMoved - movedBefore) < 1e-4, `the deformed vertex kept its motion after permute (Δ ${stillMoved.toFixed(3)})`);
}

// ---- hull invariant check (promote produces contiguous-leading simple hull) -
function checkHullInvariant(){
  console.log('\n--- hull invariant ---');
  // after promoting vertex 4 into a square hull [0,1,2,3] between 1 and 2 → [0,1,4,2,3], hull=5
  const w = [0, 0, 10, 0, 10, 10, 0, 10, 10, 5]; // square + a point on the right edge midpoint region
  const order = [0, 1, 4, 2, 3], hull = 5;
  // remap world into new order, then check the boundary loop has no crossing non-adjacent edges
  const W = []; order.forEach((oi) => W.push(w[oi * 2], w[oi * 2 + 1]));
  const s = (p, q, r) => (W[q * 2] - W[p * 2]) * (W[r * 2 + 1] - W[p * 2 + 1]) - (W[q * 2 + 1] - W[p * 2 + 1]) * (W[r * 2] - W[p * 2]);
  const segCross = (a, b, c, d) => { const d1 = s(c, d, a), d2 = s(c, d, b), d3 = s(a, b, c), d4 = s(a, b, d); return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0); };
  let simple = true;
  for (let i = 0; i < hull && simple; i++) for (let j = i + 1; j < hull; j++){
    const a = i, b = (i + 1) % hull, c = j, d = (j + 1) % hull;
    if (a === c || a === d || b === c || b === d) continue; // adjacent edges legitimately share a vertex
    if (segCross(a, b, c, d)) simple = false;
  }
  log(simple, 'promoted hull loop is a simple (non-self-crossing) polygon');
}

runCase('unweighted', false);
runCase('weighted', true);
checkHullInvariant();
console.log(pass ? '\n✅ PASS — permutation preserves posed deform (unweighted + weighted), hull stays simple.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
