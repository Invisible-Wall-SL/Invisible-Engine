// Phase 5.3 spike — prove the keyframe CURVE format (stepped + bezier) the curve UI
// writes loads through spine-core and plays exactly as our own evaluator predicts.
// Spine 4.2: a key's `curve` is "stepped", or an array where for value index v the
// controls are curve[v*4 .. v*4+3] = (cx1,cy1,cx2,cy2) in ABSOLUTE (time,value) coords.
//   node tools/rigger-spike/curve.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
function rotAt(raw, t) {
	const data = loadData(raw); const anim = data.findAnimation('curveAnim'); const sk = new Skeleton(data);
	sk.setToSetupPose(); anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	return sk.findBone(boneName).rotation - sk.findBone(boneName).data.rotation; // offset from setup
}
// our evaluator (mirrors the viewer's bezierValue): cubic bezier X(s),Y(s); solve X(s)=t.
function bezierValue(t1, v1, cx1, cy1, cx2, cy2, t2, v2, t) {
	if (t <= t1) return v1; if (t >= t2) return v2;
	const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
	const Y = (s) => { const u = 1 - s; return u * u * u * v1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * v2; };
	let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
	return Y((lo + hi) / 2);
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const boneName = (raw.bones.find((b) => b.parent) || raw.bones[1] || raw.bones[0]).name;

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5.3 curve format → reload: ${jsonPath} (bone "${boneName}") ===`);

// (1) STEPPED — at t=0.5 the value holds at key0 (0), not linear 45.
raw.animations = { curveAnim: { bones: { [boneName]: { rotate: [{ time: 0, value: 0, curve: 'stepped' }, { time: 1, value: 90 }] } } } };
{
	const v = rotAt(raw, 0.5);
	log(Math.abs(v - 0) < 1e-3, `stepped @0.5 holds at 0 (runtime ${v.toFixed(3)})`);
	const v2 = rotAt(raw, 0.999);
	log(Math.abs(v2 - 0) < 1e-2, `stepped holds until the next key (@0.999 ${v2.toFixed(3)})`);
}

// (2) BEZIER ease-in (0.42,0,1,1) on a 0→90 rotate. Controls in absolute coords:
//     cx1=0.42, cy1=0, cx2=1, cy2=90.
raw.animations = { curveAnim: { bones: { [boneName]: { rotate: [{ time: 0, value: 0, curve: [0.42, 0, 1, 90] }, { time: 1, value: 90 }] } } } };
{
	let bad = 0, worst = 0;
	for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
		const runtime = rotAt(raw, t);
		const pred = bezierValue(0, 0, 0.42, 0, 1, 90, 1, 90, t);
		const d = Math.abs(runtime - pred); worst = Math.max(worst, d); if (d > 0.5) bad++;
		console.log(`     t=${t}: runtime ${runtime.toFixed(3)}  ours ${pred.toFixed(3)}  Δ${d.toFixed(3)}`);
	}
	log(bad === 0, `bezier matches our evaluator at all samples (worst Δ ${worst.toFixed(3)})`);
	// ease-in means slow start → at t=0.5 value is BELOW the linear 45
	const mid = rotAt(raw, 0.5);
	log(mid < 45, `ease-in is sub-linear at the midpoint (${mid.toFixed(2)} < 45)`);
}

console.log(pass ? '\n✅ PASS — stepped + bezier curves load + play as our evaluator predicts.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
