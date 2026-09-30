// Verify the Phase 3.6a visual-UV-panel geometry headlessly: the region-local UV ↔ panel-pixel
// fit transform (letterbox), the drag clamp, the nearest-vertex hit-test, and the art's aspect —
// the whole untrimmed image, which is what a mesh's UVs span, or the rotated pack's swapped span
// without one. These are the pure pieces; the art blit (drawRegionUpright) is drawn in a real
// browser and read back per pixel by tools/rigger-spike/trimmesh.mjs.
//
// `uvArtAspect` and `computeUvFit` are pulled out of view.html; the hit-test and the drag mirror
// uvPanelNearestVert and cv.onpointermove, which read the page's globals.
//   node tools/rigger-spike/uvpanel.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
const approx = (a, b, e = 1e-6) => Math.abs(a - b) < e;

console.log('\n=== Phase 3.6a UV-panel geometry ===');

const html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pull = (name) => {
	const at = html.indexOf('\nfunction ' + name + '(');
	if (at < 0) throw new Error(name + ' not found in view.html');
	return html.slice(at, html.indexOf('\n}', at) + 2);
};
const shipped = {};
vm.createContext(shipped);
vm.runInContext(pull('uvArtAspect') + pull('computeUvFit') + ';globalThis.uvArtAspect = uvArtAspect; globalThis.computeUvFit = computeUvFit;', shipped);
const { uvArtAspect, computeUvFit } = shipped;

function nearestVert(uvs, fit, p, dpr = 1){
	const n = uvs.length / 2, R = 14 * dpr;
	let best = -1, bd = Infinity;
	for (let k = 0; k < n; k++){
		const dx = fit.ox + uvs[k * 2] * fit.aw - p.x;
		const dy = fit.oy + uvs[k * 2 + 1] * fit.ah - p.y;
		const d = Math.hypot(dx, dy);
		if (d < bd){ bd = d; best = k; }
	}
	return bd <= R ? best : -1;
}
// panel drag: pixel → region-local uv, clamped (as cv.onpointermove does)
const dragUV = (fit, p) => ({
	u: Math.max(0, Math.min(1, (p.x - fit.ox) / fit.aw)),
	v: Math.max(0, Math.min(1, (p.y - fit.oy) / fit.ah)),
});
// uv → panel pixel (as redrawUVPanel plots)
const uvToPx = (fit, u, v) => ({ x: fit.ox + u * fit.aw, y: fit.oy + v * fit.ah });

// ---- 1. letterbox: art box fits inside the panel, centered -----------------
{
	for (const [aspect, PW, PH] of [[1, 240, 240], [2, 240, 240], [0.5, 240, 240], [3.3, 480, 300], [0.3, 300, 480]]){
		const f = computeUvFit(aspect, PW, PH);
		const within = f.ox >= -1e-9 && f.oy >= -1e-9 && f.ox + f.aw <= PW + 1e-9 && f.oy + f.ah <= PH + 1e-9;
		const centered = approx(f.ox * 2 + f.aw, PW, 1e-6) && approx(f.oy * 2 + f.ah, PH, 1e-6);
		const keepsAspect = approx(f.aw / f.ah, aspect, 1e-6);
		log(within && centered && keepsAspect, `letterbox aspect ${aspect} in ${PW}x${PH} → box ${f.aw.toFixed(1)}x${f.ah.toFixed(1)} @(${f.ox.toFixed(1)},${f.oy.toFixed(1)})`);
	}
}

// ---- 2. uv → pixel → uv round-trip is identity -----------------------------
{
	const f = computeUvFit(1.7, 240, 240);
	let ok = true;
	for (const u of [0, 0.25, 0.5, 0.9, 1]) for (const v of [0, 0.33, 0.5, 1]){
		const p = uvToPx(f, u, v), back = dragUV(f, p);
		if (!approx(back.u, u, 1e-9) || !approx(back.v, v, 1e-9)) ok = false;
	}
	log(ok, 'uv → pixel → uv identity across the unit square');
}

// ---- 3. clamp: dragging outside the art box clamps uv to [0,1] --------------
{
	const f = computeUvFit(1, 240, 240);
	const lo = dragUV(f, { x: f.ox - 999, y: f.oy - 999 });
	const hi = dragUV(f, { x: f.ox + f.aw + 999, y: f.oy + f.ah + 999 });
	log(lo.u === 0 && lo.v === 0 && hi.u === 1 && hi.v === 1, `clamp: below→(${lo.u},${lo.v}) above→(${hi.u},${hi.v})`);
}

// ---- 4. nearest-vertex hit-test: closest wins, radius respected ------------
{
	const f = computeUvFit(1, 240, 240);
	const uvs = [0.1, 0.1, 0.9, 0.1, 0.5, 0.9]; // 3 verts
	const p1 = uvToPx(f, 0.9, 0.1);
	log(nearestVert(uvs, f, { x: p1.x + 3, y: p1.y - 2 }) === 1, 'picks the nearest vertex (idx 1)');
	const far = { x: f.ox + f.aw / 2, y: f.oy + f.ah / 2 }; // center — far from all 3
	log(nearestVert(uvs, f, far) === -1, 'returns -1 when nothing is within the hit radius');
}

// ---- 5. rotated-pack aspect swap -------------------------------------------
{
	const page = { width: 1024, height: 1024 };
	// a packed rect 200 wide × 100 tall on the page
	const base = { page, u: 0.1, v: 0.1, u2: 0.1 + 200 / 1024, v2: 0.1 + 100 / 1024 };
	const flat = uvArtAspect({ ...base, degrees: 0 });
	const rot = uvArtAspect({ ...base, degrees: 90 });
	log(approx(flat, 2, 1e-6), `degrees 0: aspect ${flat.toFixed(3)} (packed 200x100 → 2.0)`);
	log(approx(rot, 0.5, 1e-6), `degrees 90: aspect ${rot.toFixed(3)} (art upright is 100x200 → 0.5)`);
	log(approx(uvArtAspect({ ...base, u2: base.u + 100 / 1024, v2: base.v + 100 / 1024, degrees: 0 }), 1, 1e-6), 'square region → aspect 1');
	// trimmed: the ink is 200x100, the image it was cut from 300x300 — the panel shows the image
	const trimmed = uvArtAspect({ ...base, degrees: 90, originalWidth: 300, originalHeight: 300 });
	log(approx(trimmed, 1, 1e-6), `trimmed to 200x100 from a 300x300 image: aspect ${trimmed.toFixed(3)} (the image's, 1.0)`);
}

console.log(pass ? '\n✅ PASS — UV-panel geometry is consistent.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
