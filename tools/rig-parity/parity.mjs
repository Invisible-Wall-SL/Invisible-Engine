// Parity gate: the Invisible rig runtime (packages/engine-rig) against the reference runtime the
// games used before it, compared as black boxes on every Spine skeleton in the repo.
//
//   node tools/rig-parity/parity.mjs [--filter <substring>] [--verbose]
//
//   node tools/rig-parity/parity.mjs --dir <folder>   (any other folder of skeleton + atlas pairs)
//
// For each skeleton (+ its atlas) both runtimes read the same JSON, then every animation is posed at
// sampled times — directly through `Animation.apply`, and through an `AnimationState` playing a
// scripted sequence of sets, queues, mixes and an additive layer — and after each pose the bone
// matrices, slot colors / attachments / sequence frames, draw order, world vertices, UVs, bounds,
// fired events and listener callbacks are compared. Exit code 1 on any mismatch.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { SPINE_CORE } from '../rigger-spike/spine.mjs';
import { loadRig, ROOT } from './load.mjs';

const args = process.argv.slice(2);
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;
const verbose = args.includes('--verbose');
const extraDir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;

const RIG = await loadRig();
const REF = await import(SPINE_CORE);

const ABS = 2e-3;
const REL = 2e-4;
const close = (a, b) => {
	if (a === b) return true;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b);
	return Math.abs(a - b) <= ABS + REL * Math.max(Math.abs(a), Math.abs(b));
};

function findSkeletons() {
	const out = [];
	const walk = (d) => {
		for (const n of readdirSync(d)) {
			if (['node_modules', '.git', '.turbo', '.svelte-kit', 'build', 'dist'].includes(n)) continue;
			const p = join(d, n);
			const s = statSync(p);
			if (s.isDirectory()) walk(p);
			else if (n.endsWith('.skel')) {
				const atlases = readdirSync(dirname(p)).filter((f) => f.endsWith('.atlas'));
				const atlas = atlases.find((a) => basename(a, '.atlas') === basename(n, '.skel')) ?? atlases[0];
				if (atlas) out.push({ json: p, atlas: join(dirname(p), atlas), binary: true });
			} else if (n.endsWith('.json') && s.size > 200 && s.size < 50e6) {
				let j;
				try {
					j = JSON.parse(readFileSync(p, 'utf8'));
				} catch {
					continue;
				}
				if (!j?.skeleton || !j.bones) continue;
				const atlases = readdirSync(dirname(p)).filter((f) => f.endsWith('.atlas'));
				if (!atlases.length) continue;
				const atlas = atlases.find((a) => basename(a, '.atlas') === basename(n, '.json')) ?? atlases[0];
				out.push({ json: p, atlas: join(dirname(p), atlas) });
			}
		}
	};
	walk(extraDir ?? ROOT);
	return out;
}

const stubTexture = { getImage() {}, setFilters() {}, setWraps() {}, dispose() {} };

function load(X, source, atlasText) {
	const atlas = new X.TextureAtlas(atlasText);
	for (const page of atlas.pages) page.setTexture(stubTexture);
	const loader = new X.AtlasAttachmentLoader(atlas);
	if (source instanceof Uint8Array) return new X.SkeletonBinary(loader).readSkeletonData(source);
	return new X.SkeletonJson(loader).readSkeletonData(JSON.parse(source));
}

/** Everything observable about a posed skeleton, flattened to numbers and strings. */
function snapshot(X, sk) {
	const nums = [];
	const keys = [];
	const strs = [];
	const add = (key, ...values) => {
		for (let i = 0; i < values.length; i++) {
			nums.push(values[i]);
			keys.push(values.length > 1 ? `${key}[${i}]` : key);
		}
	};
	for (const b of sk.bones)
		add(`bone ${b.data.name} a,b,c,d,x,y,active`, b.a, b.b, b.c, b.d, b.worldX, b.worldY, b.active ? 1 : 0);
	for (const s of sk.slots) {
		add(`slot ${s.data.name} rgba`, s.color.r, s.color.g, s.color.b, s.color.a);
		if (s.darkColor) add(`slot ${s.data.name} dark`, s.darkColor.r, s.darkColor.g, s.darkColor.b);
		add(`slot ${s.data.name} sequenceIndex`, s.sequenceIndex);
		strs.push(`${s.data.name}=${s.attachment ? s.attachment.name : '-'}`);
		const a = s.attachment;
		if (!a || !s.bone.active) continue;
		const verts = [];
		if (a instanceof X.RegionAttachment) {
			a.computeWorldVertices(s, verts, 0, 2);
			add(`slot ${s.data.name} uvs`, ...a.uvs);
		} else if (a instanceof X.MeshAttachment) {
			a.computeWorldVertices(s, 0, a.worldVerticesLength, verts, 0, 2);
			add(`slot ${s.data.name} uvs`, ...a.uvs);
		} else if (a instanceof X.VertexAttachment) {
			a.computeWorldVertices(s, 0, a.worldVerticesLength, verts, 0, 2);
		}
		add(`slot ${s.data.name} vertices`, ...verts);
	}
	strs.push('order:' + sk.drawOrder.map((s) => s.data.index).join(','));
	const off = new X.Vector2();
	const size = new X.Vector2();
	sk.getBounds(off, size, []);
	if (Number.isFinite(off.x)) add('bounds', off.x, off.y, size.x, size.y);
	return { nums, strs, keys };
}

let failures = 0;
let checks = 0;
function compare(label, a, b) {
	checks++;
	if (a.strs.length !== b.strs.length || a.nums.length !== b.nums.length) {
		fail(label, `shape differs: ${a.nums.length}/${a.strs.length} vs ${b.nums.length}/${b.strs.length}`, a, b);
		return false;
	}
	for (let i = 0; i < a.strs.length; i++)
		if (a.strs[i] !== b.strs[i]) {
			fail(label, `${a.strs[i]} ≠ ${b.strs[i]}`);
			return false;
		}
	for (let i = 0; i < a.nums.length; i++)
		if (!close(a.nums[i], b.nums[i])) {
			fail(label, `${a.keys[i]}: ${a.nums[i]} ≠ ${b.nums[i]}`);
			return false;
		}
	return true;
}

const failed = new Map();
function fail(label, msg) {
	failures++;
	const rig = label.split(' :: ')[0];
	if (!failed.has(rig)) failed.set(rig, []);
	const list = failed.get(rig);
	if (list.length < 3) list.push(`${label} — ${msg}`);
}

function eventLog(list) {
	return list.map((e) => `${e.data.name}@${e.time.toFixed(4)}:${e.intValue}:${e.floatValue}:${e.stringValue}`).join('|');
}

function directPoses(name, refData, rigData, flipY) {
	for (const refAnim of refData.animations) {
		const rigAnim = rigData.findAnimation(refAnim.name);
		if (!rigAnim) {
			fail(`${name} :: ${refAnim.name}`, 'animation missing');
			continue;
		}
		checks++;
		if (!close(refAnim.duration, rigAnim.duration)) fail(`${name} :: ${refAnim.name}`, `duration ${refAnim.duration} ≠ ${rigAnim.duration}`);
		const refSk = new REF.Skeleton(refData);
		const rigSk = new RIG.Skeleton(rigData);
		if (flipY) {
			refSk.scaleY = -1;
			rigSk.scaleY = -1;
			refSk.scaleX = 1.5;
			rigSk.scaleX = 1.5;
		}
		const d = refAnim.duration || 1;
		let last = -1;
		for (let k = 0; k <= 16; k++) {
			const t = (d * k) / 13;
			for (const [X, sk, anim] of [
				[REF, refSk, refAnim],
				[RIG, rigSk, rigAnim],
			]) {
				sk.setToSetupPose();
				anim.apply(sk, last, t, true, (sk.__events = []), 1, X.MixBlend.setup, X.MixDirection.mixIn);
				sk.updateWorldTransform(X.Physics.update);
			}
			const label = `${name} :: ${refAnim.name} @${t.toFixed(3)}${flipY ? ' flipped' : ''}`;
			if (!compare(label, snapshot(REF, refSk), snapshot(RIG, rigSk))) break;
			checks++;
			const ea = eventLog(refSk.__events);
			const eb = eventLog(rigSk.__events);
			if (ea !== eb) fail(label, `events ${ea} ≠ ${eb}`);
			last = t;
		}
	}
}

function recorder(log) {
	const tag = (e) => `${e.trackIndex}:${e.animation ? e.animation.name : '?'}`;
	return {
		start: (e) => log.push('start ' + tag(e)),
		interrupt: (e) => log.push('interrupt ' + tag(e)),
		end: (e) => log.push('end ' + tag(e)),
		dispose: (e) => log.push('dispose ' + tag(e)),
		complete: (e) => log.push('complete ' + tag(e)),
		event: (e, ev) => log.push(`event ${tag(e)} ${ev.data.name}@${ev.time.toFixed(4)}`),
	};
}

/** A scripted session on both runtimes: sets, queued adds, mixes, an additive layer, an empty mix-out. */
function stateScenario(name, refData, rigData) {
	const anims = refData.animations.map((a) => a.name);
	if (!anims.length) return;
	const runs = [];
	for (const [X, data] of [
		[REF, refData],
		[RIG, rigData],
	]) {
		const sk = new X.Skeleton(data);
		const sd = new X.AnimationStateData(data);
		sd.defaultMix = 0.2;
		const state = new X.AnimationState(sd);
		const log = [];
		state.addListener(recorder(log));
		runs.push({ X, sk, state, log, snaps: [] });
	}
	const a0 = anims[0];
	const a1 = anims[1 % anims.length];
	const a2 = anims[2 % anims.length];
	const script = {
		0: (s) => s.setAnimation(0, a0, true),
		12: (s) => s.setAnimation(0, a1, false),
		14: (s) => s.addAnimation(0, a2, true, 0),
		20: (s) => {
			const e = s.setAnimation(1, a1, true);
			e.alpha = 0.5;
			e.mixBlend = 2;
		},
		45: (s) => s.setAnimation(0, a0, false),
		47: (s) => s.setAnimation(0, a2, true),
		70: (s) => s.setEmptyAnimation(1, 0.3),
		90: (s) => s.addEmptyAnimation(0, 0.25, 0.1),
	};
	const dt = 1 / 30;
	for (let frame = 0; frame < 140; frame++) {
		for (const r of runs) {
			script[frame]?.(r.state);
			r.state.update(dt);
			r.state.apply(r.sk);
			r.sk.update(dt);
			r.sk.updateWorldTransform(r.X.Physics.update);
		}
		const label = `${name} :: state frame ${frame}`;
		if (!compare(label, snapshot(REF, runs[0].sk), snapshot(RIG, runs[1].sk))) return;
	}
	checks++;
	const la = runs[0].log.join('\n');
	const lb = runs[1].log.join('\n');
	if (la !== lb) {
		const A = runs[0].log;
		const B = runs[1].log;
		let i = 0;
		while (i < A.length && A[i] === B[i]) i++;
		fail(`${name} :: state listeners`, `first difference at #${i}: ${A[i]} ≠ ${B[i]}`);
	}
}

const rigs = findSkeletons().filter((r) => !filter || r.json.includes(filter));
let loaded = 0;
for (const r of rigs) {
	const name = relative(extraDir ?? ROOT, r.json);
	const jsonText = r.binary ? new Uint8Array(readFileSync(r.json)) : readFileSync(r.json, 'utf8');
	const atlasText = readFileSync(r.atlas, 'utf8');
	let refData;
	try {
		refData = load(REF, jsonText, atlasText);
	} catch (e) {
		if (verbose) console.log(`skip ${name}: reference cannot load it (${e.message})`);
		continue;
	}
	let rigData;
	try {
		rigData = load(RIG, jsonText, atlasText);
	} catch (e) {
		fail(`${name} :: load`, e.stack);
		continue;
	}
	loaded++;
	try {
		directPoses(name, refData, rigData, false);
		directPoses(name, refData, rigData, true);
		stateScenario(name, refData, rigData);
	} catch (e) {
		fail(`${name} :: run`, e.stack);
	}
}

for (const [rig, list] of failed) {
	console.log(`✗ ${rig}`);
	for (const line of list) console.log('    ' + line);
}
console.log(
	`${failed.size === 0 ? '✓' : '✗'} rig parity: ${loaded} skeletons, ${checks} checks, ${failures} failures (${failed.size} rigs)`,
);
process.exit(failures ? 1 : 0);
