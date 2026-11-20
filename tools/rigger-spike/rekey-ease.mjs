// Re-keying a bone keeps its easing — spike.
//   node tools/rigger-spike/rekey-ease.mjs
//   node tools/rigger-spike/rekey-ease.mjs --mutants   # every planted bug must fail a check
//
// Runs the SHIPPED bone writers out of view.html — `keyBone` (the gizmo, a drag, ◆ Key, ◆ Key all,
// the typed fields), `keyRestPose` (⟲ Rest) and `faceKeyChannel` (a Controls slider) — on a clip whose
// keys are eased with the page's own `setKeyCurve`, then re-keys one of them and plays the result in
// engine-rig.
//
// The regression it guards (owner, 2026-11-20): `upsertKey` replaced a key wholesale, so re-keying a
// bone on an eased key dropped its easing. And a bone curve holds its handles as VALUES, so the
// previous key's curve, left as it was, bent the segment INTO the key toward the old value.
//
//   1. KEEPS    the re-keyed key keeps its curve (eased stays eased, stepped stays stepped, linear
//               gets none), and a key made where there was none gets none.
//   2. SHAPE    both segments ease the same way between their new values as they did between the
//               old: engine-rig's progress through each segment is unchanged, sampled through it.
//   3. PRESET   an ease preset re-keyed is the preset baked on the new values (as `setKeyCurve` would
//               make it) — including on a segment that was flat before.
//   4. WRITERS  keyBone, keyRestPose and faceKeyChannel all keep it.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { RIG_CORE } from './rig.mjs';

const RIGMOD = await import(RIG_CORE);
const { SkeletonJson, Skeleton, Physics, MixBlend, MixDirection, TextureAtlas, AtlasAttachmentLoader } = RIGMOD;
const html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8');

const balanced = (s) => {
	let n = 0;
	for (const c of s) {
		if (c === '{') n++;
		else if (c === '}') n--;
	}
	return n === 0;
};
function pull(src, head, close) {
	const i = src.indexOf('\n' + head);
	if (i < 0) throw new Error(`"${head}" not found in view.html — the markers moved`);
	const first = src.slice(i, src.indexOf('\n', i + 1));
	if (balanced(first) && first.includes(head.endsWith('(') ? '{' : '=')) return first;
	return src.slice(i, src.indexOf(close, i) + close.length);
}
const CONSTS = ['animOf', 'roundN', 'BONE_CHS_2D', 'BONE_CHS_3D', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'];
const FNS = ['clip3d', 'boneTL', 'boneChs', 'upsertKey', 'upsertBoneKey', 'keyBone', 'setKeyCurve', 'keyRestPose', 'sampleChannel', 'bezierValue', 'faceKeyChannel'];
const shippedOf = (src) =>
	[
		...CONSTS.map((n) => pull(src, `const ${n} = `, '\n};')),
		...FNS.map((n) => pull(src, `function ${n}(`, '\n}')),
		`Object.assign(globalThis, { ${CONSTS.join(', ')} });`,
	].join('\n');

// A bones-only rig: its setup values differ from the format defaults, so an offset key is not its value.
const RIG = {
	skeleton: { spine: '4.2.0' },
	bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 5, y: 7, rotation: 10, scaleX: 1.2, length: 50 }],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
};
const loadData = (doc) => new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(''))).readSkeletonData(JSON.parse(JSON.stringify(doc)));
/** engine-rig: bone `arm`'s rotation, x, y, scaleX, scaleY at t. */
function play(doc, t) {
	const sk = new Skeleton(loadData(doc));
	sk.setToSetupPose();
	sk.data.findAnimation('a').apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	sk.updateWorldTransform(Physics.none);
	const b = sk.findBone('arm');
	return { rotate: b.rotation, x: b.x, y: b.y, scaleX: b.scaleX, scaleY: b.scaleY };
}
// Progress through segment t0→t1 of each played field (null where the field does not move).
function progress(doc, t0, t1, at) {
	const a = play(doc, t0), b = play(doc, t1), m = play(doc, at);
	return Object.fromEntries(Object.keys(a).map((f) => [f, Math.abs(b[f] - a[f]) > 1e-6 ? (m[f] - a[f]) / (b[f] - a[f]) : null]));
}

function run(src, quiet) {
	let pass = 0, fail = 0;
	const ok = (name, cond, detail) => {
		if (cond) pass++;
		else fail++;
		if (!quiet) console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
	};
	const head = (t) => { if (!quiet) console.log(`\n${t}`); };
	const sb = {
		rawDoc: null, skeleton: null, curAnim: 'a', animTime: 0, animMode: true, selBone: null,
		rig3d: { doc: null }, ownsBone3d: () => false, tweakRootRotOffset: () => 0, ensureCurAnim: () => 'a',
		keyableChannels: (n, c) => c, markDirty() {}, refreshAnimCounts() {}, renderBoneDetail() {}, renderTimeline() {},
		$: () => ({ textContent: '' }),
	};
	vm.createContext(sb);
	vm.runInContext(shippedOf(src), sb, { filename: 'view.html#rekey-ease' });
	const arm = () => sb.rawDoc.animations.a.bones.arm;
	/** A clip with arm keyed at 0, 0.5 and 1 on rotate / translate / scale (`flat`: 0 and 0.5 equal). */
	function open(flat) {
		sb.rawDoc = { ...JSON.parse(JSON.stringify(RIG)), animations: { a: { bones: { arm: {
			rotate: [{ time: 0, value: 0 }, { time: 0.5, value: flat ? 0 : 90 }, { time: 1, value: 30 }],
			translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: flat ? 0 : 40, y: flat ? 0 : -20 }, { time: 1, x: 10, y: 5 }],
			scale: [{ time: 0, x: 1, y: 1 }, { time: 0.5, x: flat ? 1 : 1.5, y: flat ? 1 : 0.8 }, { time: 1, x: 1, y: 1 }],
		} } } } };
		sb.skeleton = new Skeleton(loadData(sb.rawDoc));
		sb.skeleton.setToSetupPose();
		sb.setKeyCurve('arm', 0, 'easeout');
		sb.setKeyCurve('arm', 0.5, 'easein');
	}
	/** Pose arm as a drag leaves it at time t (setup + the given offsets), then keyBone every channel. */
	function rekeyByBone(t, rot, x, y, sx, sy) {
		const b = sb.skeleton.findBone('arm'), d = b.data;
		b.rotation = d.rotation + rot; b.x = d.x + x; b.y = d.y + y; b.scaleX = d.scaleX * sx; b.scaleY = d.scaleY * sy;
		sb.animTime = t;
		sb.keyBone('arm', { rotate: true, translate: true, scale: true }, false);
	}
	/** Each segment still eases as before: engine-rig's progress through it, now vs before. */
	function sameShape(before, label) {
		const after = sb.rawDoc;
		let worst = 0, where = '';
		for (const [t0, t1] of [[0, 0.5], [0.5, 1]])
			for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
				const at = t0 + (t1 - t0) * f, p = progress(before, t0, t1, at), q = progress(after, t0, t1, at);
				for (const k of Object.keys(p)) if (p[k] != null && q[k] != null) {
					const d = Math.abs(p[k] - q[k]);
					if (d > worst) { worst = d; where = `${k} ${t0}→${t1} @ ${at}`; }
				}
			}
		ok(`${label}: both segments ease as before, between the new values (worst ${worst.toExponential(2)})`, worst < 2e-3, where);
	}
	/** The preset as setKeyCurve bakes it on the doc's current values, per channel at time t. */
	function rebaked(t, preset) {
		const keep = sb.rawDoc;
		sb.rawDoc = JSON.parse(JSON.stringify(keep));
		sb.setKeyCurve('arm', t, preset);
		const out = Object.fromEntries(Object.entries(arm()).map(([ch, ks]) => [ch, ks.find((k) => Math.abs(k.time - t) < 1e-4).curve]));
		sb.rawDoc = keep;
		return out;
	}
	const curveAt = (ch, t) => arm()[ch].find((k) => Math.abs(k.time - t) < 1e-4).curve;
	const near = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-3);

	head('1–3. keyBone (a drag, ◆ Key): the key at 0.5s re-keyed to new values');
	open(false);
	const before = JSON.parse(JSON.stringify(sb.rawDoc));
	rekeyByBone(0.5, 45, -15, 25, 0.6, 1.3);
	ok('the re-keyed key keeps its curve on every channel', ['rotate', 'translate', 'scale'].every((ch) => Array.isArray(curveAt(ch, 0.5))));
	ok('…and holds the new values', arm().rotate[1].value === 45 && arm().translate[1].x === -15 && arm().scale[1].y === 1.3, JSON.stringify(arm().rotate[1]));
	sameShape(before, 'keyBone');
	const pre5 = rebaked(0.5, 'easein'), pre0 = rebaked(0, 'easeout');
	ok('its ease-in is the preset baked on the new values', ['rotate', 'translate', 'scale'].every((ch) => near(curveAt(ch, 0.5), pre5[ch])), JSON.stringify([curveAt('rotate', 0.5), pre5.rotate]));
	ok('the ease-out INTO it (the 0s key’s) too', ['rotate', 'translate', 'scale'].every((ch) => near(curveAt(ch, 0), pre0[ch])), JSON.stringify([curveAt('rotate', 0), pre0.rotate]));

	head('1. stepped stays stepped, linear stays linear, a new key gets none');
	open(false);
	sb.setKeyCurve('arm', 0.5, 'stepped');
	sb.setKeyCurve('arm', 0, 'linear');
	rekeyByBone(0.5, 20, 1, 2, 1, 1);
	ok('stepped stays stepped', curveAt('rotate', 0.5) === 'stepped');
	rekeyByBone(0, 5, 0, 0, 1, 1);
	ok('linear stays linear', curveAt('rotate', 0) === undefined, JSON.stringify(curveAt('rotate', 0)));
	rekeyByBone(0.75, 12, 0, 0, 1, 1);
	ok('a key made where there was none has no curve', curveAt('rotate', 0.75) === undefined);

	head('3. a segment that was flat: the preset re-keyed is the preset on the new values');
	open(true);
	rekeyByBone(0.5, 60, 20, -10, 1.4, 0.9);
	const flat0 = rebaked(0, 'easeout'), flat5 = rebaked(0.5, 'easein');
	ok('the flat 0→0.5 segment’s ease-out fits its new end', ['rotate', 'translate', 'scale'].every((ch) => near(curveAt(ch, 0), flat0[ch])), JSON.stringify([curveAt('rotate', 0), flat0.rotate]));
	ok('the re-keyed key’s ease-in fits its new start', ['rotate', 'translate', 'scale'].every((ch) => near(curveAt(ch, 0.5), flat5[ch])), JSON.stringify([curveAt('rotate', 0.5), flat5.rotate]));

	head('4. ⟲ Rest and a Controls slider keep it too');
	open(false);
	let b4 = JSON.parse(JSON.stringify(sb.rawDoc));
	sb.keyRestPose(sb.rawDoc.animations.a, ['arm'], 0.5);
	ok('⟲ Rest: the key keeps its curve', Array.isArray(curveAt('rotate', 0.5)) && arm().rotate[1].value === 0 && arm().scale[1].x === 1);
	sameShape(b4, '⟲ Rest');
	open(false);
	b4 = JSON.parse(JSON.stringify(sb.rawDoc));
	const ch = { min: -100, max: 100, drives: [{ bone: 'arm', prop: 'rotate', per: 1 }, { bone: 'arm', prop: 'x', per: 0.5 }] };
	sb.faceKeyChannel(sb.rawDoc.animations.a, ch, 60, 0.5, null, [ch], null);
	ok('a Controls slider: the key keeps its curve', Array.isArray(curveAt('rotate', 0.5)) && Array.isArray(curveAt('translate', 0.5)) && arm().rotate[1].value === 60 && arm().translate[1].x === 30, JSON.stringify(arm().translate[1]));
	sameShape(b4, 'a Controls slider');
	return { pass, fail };
}

const MUTANTS = [
	['re-keying drops the curve (the bug)', 'if (old.curve !== undefined){', 'if (false){'],
	['the previous key’s curve is left bent to the old value', '  if (prev && Array.isArray(prev.curve)) refit(prev, prev, old, prev, key);\n', ''],
	['the key’s own curve kept but not refitted', 'if (next && Array.isArray(key.curve)) refit(key, old, next, key, next);', ''],
	['a flat segment’s handles stay put', 'seg.curve[n] + (c ? wb - vb : wa - va)', 'seg.curve[n]'],
	['keyBone still writes with upsertKey', 'cb.rotate = cb.rotate || []; upsertBoneKey(cb.rotate, animTime,', 'cb.rotate = cb.rotate || []; upsertKey(cb.rotate, animTime,'],
	['⟲ Rest still writes with upsertKey', 'upsertBoneKey(cb.rotate, time, { value: 0 });', 'upsertKey(cb.rotate, time, { value: 0 });'],
	['a Controls slider still writes with upsertKey', 'if (d.prop === "rotate"){ upsertBoneKey(tl, t,', 'if (d.prop === "rotate"){ upsertKey(tl, t,'],
];

if (process.argv.includes('--mutants')) {
	let caught = 0;
	console.log('rekey-ease mutants (each must fail a check):');
	for (const [name, find, replace] of MUTANTS) {
		const n = html.split(find).length - 1;
		if (n !== 1) {
			console.log(`  ✗ ${name}: its line is in view.html ${n} times — the mutant is stale`);
			continue;
		}
		let res;
		try { res = run(html.replace(find, replace), true); } catch (e) { res = { fail: 1, threw: e.message }; }
		if (res.fail) caught++;
		console.log(`  ${res.fail ? '✓' : '✗'} ${name}${res.fail ? ` (${res.threw ? 'threw' : res.fail + ' check(s) failed'})` : ' — NOT caught'}`);
	}
	console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
	process.exit(caught === MUTANTS.length ? 0 : 1);
}

console.log('rekey-ease — re-keying a bone keeps its easing (vs engine-rig)');
const { pass, fail } = run(html, false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
