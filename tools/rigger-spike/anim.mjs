// Phase 5 spike — prove the bone-keyframe data model the Animate mode will WRITE is
// byte-valid Spine 4.2 and plays back through the official runtime exactly as our own
// linear interpolation predicts. Establishes the channel semantics:
//   rotate.value  = local rotation OFFSET from setup     (bone.rotation = data.rotation + v)
//   translate.x/y = local translation offset from setup  (bone.x = data.x + x)
//   scale.x/y     = local scale MULTIPLIER of setup       (bone.scaleX = data.scaleX * x)
//   shear.x/y     = local shear OFFSET from setup          (bone.shearX = data.shearX + x)
//   node tools/rigger-spike/anim.mjs <skeleton.json> <skeleton.atlas>
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

// ---- our own linear interpolation (what poseAtTime() in the viewer will do) --------
function lerpKeys(keys, t, fields) {
	if (!keys.length) return null;
	if (t <= keys[0].time) return pick(keys[0], fields);
	if (t >= keys[keys.length - 1].time) return pick(keys[keys.length - 1], fields);
	let i = 0; while (i < keys.length - 1 && keys[i + 1].time <= t) i++;
	const a = keys[i], b = keys[i + 1], u = (t - a.time) / (b.time - a.time);
	const out = {}; for (const f of fields) out[f] = (a[f] ?? 0) + ((b[f] ?? 0) - (a[f] ?? 0)) * u;
	return out;
}
const pick = (k, fields) => { const o = {}; for (const f of fields) o[f] = k[f] ?? 0; return o; };

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
// pick a non-root bone that exists
const boneName = (raw.bones.find((b) => b.parent) || raw.bones[1] || raw.bones[0]).name;
const setup = raw.bones.find((b) => b.name === boneName);
const sRot = setup.rotation || 0, sX = setup.x || 0, sY = setup.y || 0, sSX = setup.scaleX ?? 1, sSY = setup.scaleY ?? 1, sShX = setup.shearX || 0, sShY = setup.shearY || 0;

raw.animations = raw.animations || {};
raw.animations.spikeAnim = {
	bones: {
		[boneName]: {
			rotate: [{ time: 0, value: 0 }, { time: 1, value: 40 }],
			translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 30, y: -20 }],
			scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 1.5, y: 0.5 }],
			shear: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 15, y: -10 }],
		},
	},
};

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5 anim keyframe model → reload: ${jsonPath} (bone "${boneName}") ===`);

let data = null;
try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED the authored animation — ' + e.message); }
if (data) {
	const anim = data.findAnimation('spikeAnim');
	log(!!anim, 'animation loads');
	log(Math.abs(anim.duration - 1) < 1e-6, `duration derived = ${anim.duration} (want 1)`);
	const sk = new Skeleton(data);
	const t = 0.5;
	sk.setToSetupPose();
	anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const bone = sk.findBone(boneName);

	// our prediction at t=0.5 (linear)
	const r = lerpKeys(raw.animations.spikeAnim.bones[boneName].rotate, t, ['value']);
	const tr = lerpKeys(raw.animations.spikeAnim.bones[boneName].translate, t, ['x', 'y']);
	const sc = lerpKeys(raw.animations.spikeAnim.bones[boneName].scale, t, ['x', 'y']);
	const sh = lerpKeys(raw.animations.spikeAnim.bones[boneName].shear, t, ['x', 'y']);
	const exp = {
		rotation: sRot + r.value,        // offset
		x: sX + tr.x, y: sY + tr.y,      // offset
		scaleX: sSX * sc.x, scaleY: sSY * sc.y, // multiplier
		shearX: sShX + sh.x, shearY: sShY + sh.y, // offset
	};
	const near = (a, b, name) => log(Math.abs(a - b) < 1e-3, `${name}: runtime ${a.toFixed(3)} ≈ predicted ${b.toFixed(3)}`);
	near(bone.rotation, exp.rotation, 'rotate (offset+setup)');
	near(bone.x, exp.x, 'translate.x (offset+setup)');
	near(bone.y, exp.y, 'translate.y (offset+setup)');
	near(bone.scaleX, exp.scaleX, 'scale.x (mult×setup)');
	near(bone.scaleY, exp.scaleY, 'scale.y (mult×setup)');
	near(bone.shearX, exp.shearX, 'shear.x (offset+setup)');
	near(bone.shearY, exp.shearY, 'shear.y (offset+setup)');

	// endpoint sanity: at t=1 the bone hits the full keyed values
	sk.setToSetupPose();
	anim.apply(sk, 0, 1, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	const b1 = sk.findBone(boneName);
	near(b1.rotation, sRot + 40, '@t=1 rotate');
	near(b1.scaleX, sSX * 1.5, '@t=1 scale.x');
}

console.log(pass ? '\n✅ PASS — authored bone keyframes load + play exactly as our linear model predicts (offset rotate/translate, multiplier scale).' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
