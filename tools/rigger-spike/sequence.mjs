// Sequence-timeline spike (GATE) — pin Spine 4.2's `sequence` timeline against the OFFICIAL
// runtime before trusting the Rigger's new dopesheet track, and prove that a retime which scales
// key times must scale `delay` with them.
//   node tools/rigger-spike/sequence.mjs <skeleton.json> <skeleton.atlas>
//
// ========================= EMPIRICAL FINDINGS =========================
// (read off @esotericsoftware/spine-core@4.2.74 — SkeletonJson L975-987 and
//  SequenceTimeline.apply in Animation.js — and then EXERCISED below, not taken from memory.)
//
// JSON shape — the SAME node deform lives in:
//   animations.<a>.attachments.<skin>.<slot>.<att>.sequence = [{ time?, mode?, index?, delay? }]
//     time    default 0   — Spine omits it at 0, like every other timeline
//     mode    default "hold" — hold|once|loop|pingpong|onceReverse|loopReverse|pingpongReverse
//     index   default 0   — which image of the sequence this key starts on
//     delay   INHERITS the previous key's value (the loader carries `lastDelay` forward from 0)
//   There is NO `curve`: a sequence key is a step. Hence not easable.
//   The ATTACHMENT (in the skin, not the animation) carries `sequence: {count, start, digits,
//   setup}` — the timeline is meaningless without it, and the loader needs it to build the
//   timeline at all (`new SequenceTimeline(n, slotIndex, attachment)` reads attachment.sequence.id).
//
// THE CRUX — `delay` is SECONDS PER SUB-FRAME, not an offset:
//   apply() does  index += ((time - before) / delay + 0.00001) | 0
//   so it is how long each image is held. A stretch that scales key times but not `delay` makes a
//   sequence play at its ORIGINAL speed inside a longer window: it runs out of images early and
//   holds the last one. Asserted below by REPLAYING the animation through the runtime.
//
// CONTRACT PROVED HERE:
//   A. Scaling every key time AND every delay by r, then sampling at t·r, yields the IDENTICAL
//      image index at every sample. (`scaleKeyTimes`, the shipped whole-animation stretch.)
//   B. Negative control: scaling times but NOT delays diverges — so assertion A has teeth.
//   C. The dopesheet plumbing the Rigger just gained (track discovery, key times, retime, delete,
//      and the owned-vs-inherited `delay` bookkeeping in `scaleSequenceDelays`) behaves.
// ======================================================================

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// A git worktree has no node_modules of its own, so walk up to the first checkout that does.
const SUB = 'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js';
const SPINE_CORE = (() => {
	for (let up = 2; up <= 8; up++) {
		const u = new URL('../'.repeat(up) + SUB, import.meta.url);
		if (existsSync(fileURLToPath(u))) return u.href;
	}
	console.error(`✗ spine-core 4.2.74 not found — run pnpm install (looked for ${SUB})`);
	process.exit(2);
})();
const SPINE_NS = await import(SPINE_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, MixBlend, MixDirection } = SPINE_NS;

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/sequence.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}
const atlasText = readFileSync(atlasPath, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

function loadSkeleton(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	const sd = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(obj));
	const sk = new Skeleton(sd);
	sk.setToSetupPose();
	sk.updateWorldTransform(1);
	return { sd, sk };
}

// ---- pull the SHIPPED sequence + stretch code out of view.html --------------------------
const VIEW = new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url);
const html = readFileSync(VIEW, 'utf8');
function pullFn(name) {
	const i = html.indexOf('\nfunction ' + name + '(');
	if (i < 0) { console.error(`✗ function ${name} not found in view.html`); process.exit(2); }
	const eol = html.indexOf('\n', i + 1), first = html.slice(i, eol);
	const balanced = (s) => { let n = 0; for (const c of s) { if (c === '{') n++; else if (c === '}') n--; } return n === 0 && s.includes('{'); };
	if (balanced(first)) return first;
	const end = html.indexOf('\n}', i);
	if (end < 0) { console.error(`✗ function ${name} has no column-0 close`); process.exit(2); }
	return html.slice(i, end + 2);
}
function pullConst(name) {
	const i = html.indexOf('\nconst ' + name + ' = ');
	if (i < 0) { console.error(`✗ const ${name} not found in view.html`); process.exit(2); }
	const eol = html.indexOf('\n', i + 1), first = html.slice(i, eol);
	const balanced = (s) => { let n = 0; for (const c of s) { if (c === '{') n++; else if (c === '}') n--; } return n === 0; };
	if (balanced(first)) return first;   // a one-liner (most of them)
	const end = html.indexOf('\n};', i); // a multi-line arrow closes with `};` at column 0
	if (end < 0) { console.error(`✗ const ${name} has no column-0 close`); process.exit(2); }
	return html.slice(i, end + 3);
}
const shipped = [
	pullConst('animOf'), pullConst('activeSkinName'), pullConst('SEQ_MODES'), pullConst('seqPad'),
	...['scaleKeyTimes', 'sequenceTracksWithKeys', 'sequenceArrForTrack', 'seqEffectiveDelay',
		'seqKeyLabel', 'pinSequenceDelayAfter', 'seqDelaysBefore', 'seqDelaysRestore',
		'retimeSequenceKey', 'copySequenceKey', 'sequenceKeySkin',
		'deleteSequenceKeyAt', 'scaleSequenceDelays', 'applyDopeScale', 'retimeTrackKey', 'clampTrackCurves',
		'fitKeyCurve', 'dupKeyInArr',
		'trackId', 'trackKeyArrays', 'scaleTrackKeyTimings', 'normalizeKeyTimes',
		'sequenceFrames', 'detectSequence', 'keySequenceAtPlayhead', 'setSeqKeyField',
		'sequenceSkinFor', 'attachmentDefFor', 'slotAttachmentList', 'ensureCurAnim',
		'animsWithSequenceKeys', 'dropSequenceKeysFor', 'makeAttachmentLoader', 'placeholderRegion',
		'animHasName'].map(pullFn),
].join('\n');
// A `const` binding lives in the script's declarative scope, NOT on the sandbox object, so a spike
// can only reach `function` declarations unless the consts are published onto it explicitly.
const PUBLISH = 'Object.assign(globalThis, { animOf, activeSkinName, SEQ_MODES, seqPad });';
// One real TextureAtlas, so the authoring helpers resolve frame names against actual regions.
const sandboxAtlas = (() => {
	const a = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of a.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return a;
})();
const sandbox = {
	roundN: (v, n) => { const f = Math.pow(10, n); return Math.round(v * f) / f; },
	// `activeSkinName` reads the skin picker through `$`; `activeSkin` is what it reports.
	$: (sel) => (sel === '#skin' ? { value: activeSkin } : null),
	markDirty() {}, refreshAnimCounts() {}, renderSeqDetail() {},
	selSeqKey: null,
	rawDoc: null, skeleton: null, curAnim: null, animsDirty: false, animMode: true, animTime: 0,
	// trackKeyArrays reaches these for other track kinds; a sequence track never uses them.
	chArr: () => null, ikChannelArr: () => null, tcChannelArr: () => null, pathChannelArr: () => null,
	pcAnim: () => null, PC_ALL_CHANS: [], slotChannel: () => null, deformArrForTrack: () => null,
	// The authoring helpers resolve frame names against the LOADED atlas; hand them the real one.
	selected: { atlas_file: 'atlas' },
	missingArt: [],
	SPINE: SPINE_NS,
	assetMgr: { require: () => sandboxAtlas },
};
vm.createContext(sandbox);
vm.runInContext([shipped, PUBLISH].join('\n'), sandbox, { filename: 'view.html#sequence' });

let pass = true, checks = 0;
let activeSkin = 'default'; // what the sandbox's skin picker reports to `activeSkinName`
const log = (ok, msg) => { checks++; console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

// ---- sample what the RUNTIME actually shows ---------------------------------------------
// Replay an animation and record the image index the runtime picks for every sequenced slot.
function sampleIndices(doc, animName, times) {
	const { sd, sk } = loadSkeleton(doc);
	const anim = sd.animations.find((x) => x.name === animName);
	if (!anim) return null;
	const out = [];
	for (const t of times) {
		sk.setToSetupPose();
		anim.apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
		out.push(sk.slots.map((s) => s.sequenceIndex));
	}
	return out;
}
const sameSeries = (a, b) => a && b && a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((v, j) => v === b[i][j]));

// ---- run ---------------------------------------------------------------------------------
const doc0 = JSON.parse(readFileSync(jsonPath, 'utf8'));
console.log(`\n${jsonPath.split(/[\\/]/).pop()}\n`);

// Which animations actually carry a sequence timeline?
const withSeq = Object.entries(doc0.animations || {}).filter(([, a]) => {
	for (const slots of Object.values(a.attachments || {}))
		for (const atts of Object.values(slots || {}))
			for (const am of Object.values(atts || {})) if (am && Array.isArray(am.sequence) && am.sequence.length) return true;
	return false;
});
if (!withSeq.length) console.log('  — no sequence timeline in this rig; the runtime replay is skipped (the synthetic checks below still run)\n');

const RATIO = 2;
let anyAdvanced = false;
for (const [animName, anim0] of withSeq) {
	// A. the runtime shows the SAME images when times AND delays scale together
	let dur = 0;
	const scan = (o, dep = 0) => { if (!o || typeof o !== 'object' || dep > 8) return; for (const v of Object.values(o)) { if (Array.isArray(v)) { for (const k of v) if (k && typeof k.time === 'number' && k.time > dur) dur = k.time; } else scan(v, dep + 1); } };
	scan(anim0);
	// Sample past the last key, and over at least a second: a sequence needs no second key to
	// animate — one `once`/`loop` key at t=0 flips images purely on `delay`, and several rigs here
	// are exactly that. A window sized only by `dur` collapses to a single instant on those, which
	// silently makes both the equality and its control vacuous.
	const N = 40, span = Math.max(dur * 1.2, 1), times = Array.from({ length: N }, (_, i) => (span * i) / (N - 1));
	const base = sampleIndices(doc0, animName, times);
	if (!base) { log(false, `${animName} — could not load through the official runtime`); continue; }

	const scaled = clone(doc0);
	sandbox.scaleKeyTimes(scaled.animations[animName], RATIO);
	const after = sampleIndices(scaled, animName, times.map((t) => t * RATIO));
	log(sameSeries(base, after), `${animName} — ×${RATIO} with delay scaled: the SAME image at every t·${RATIO} (${N} samples)`);

	// B. NEGATIVE CONTROL — scale times only, and the runtime diverges. Only meaningful where the
	//    sequence actually ADVANCES: a `hold` key, or a slot whose setup pose shows no attachment
	//    (SequenceTimeline.apply early-returns then), legitimately sits on one image the whole time,
	//    so there is nothing for a wrong delay to change. Track it and require it once per rig.
	const advances = base.some((row) => row.some((v) => v > 0));
	if (!advances) continue;
	anyAdvanced = true;
	const noDelay = clone(doc0);
	sandbox.scaleKeyTimes(noDelay.animations[animName], RATIO);
	for (const slots of Object.values(noDelay.animations[animName].attachments || {}))
		for (const atts of Object.values(slots || {}))
			for (const am of Object.values(atts || {})) if (Array.isArray(am.sequence)) for (const k of am.sequence) if (typeof k.delay === 'number') k.delay = r4(k.delay / RATIO); // undo the delay scale
	const broken = sampleIndices(noDelay, animName, times.map((t) => t * RATIO));
	log(!sameSeries(base, broken), `${animName} — control: scaling times but NOT delay DOES diverge, so the check above has teeth`);
}
if (withSeq.length) log(anyAdvanced, 'at least one animation here really ADVANCES its sequence, so the runtime replay is not vacuous');

// ---- C. the Rigger's dopesheet plumbing --------------------------------------------------
// The editor path reads `k.time` as a number everywhere, which the rig LOAD guarantees by running
// `normalizeKeyTimes` (Spine omits `time` at 0 — explosion.json's first sequence key does). Run the
// SHIPPED normalizer here so this exercises the doc shape the app actually holds, not the raw file.
const norm = (d) => { sandbox.normalizeKeyTimes(d); return d; };
const animName = withSeq.length ? withSeq[0][0] : null;
if (animName) {
sandbox.rawDoc = norm(clone(doc0));
sandbox.curAnim = animName;
sandbox.skeleton = null;

const tracks = sandbox.sequenceTracksWithKeys(sandbox.animOf(animName));
log(tracks.length > 0, `${animName} — sequenceTracksWithKeys finds ${tracks.length} track(s) the dopesheet can now show`);
const tr = tracks[0];
const arr = sandbox.sequenceArrForTrack(tr);
log(Array.isArray(arr) && arr.length > 0, `${animName} — sequenceArrForTrack resolves ${tr.name}/${tr.att} across skins (${arr ? arr.length : 0} keys)`);
log(sandbox.trackKeyArrays(tr).length === 1, 'trackKeyArrays exposes the sequence array to the stretch');
log(/mode /.test(sandbox.seqKeyLabel(tr, r4(arr[arr.length - 1].time || 0))), 'seqKeyLabel reads the key back for the tooltip');

// retime moves exactly one key and keeps the array sorted
{
	const t0 = r4(arr[arr.length - 1].time || 0), n0 = arr.length;
	sandbox.retimeSequenceKey(tr, t0, t0 + 0.25);
	const a2 = sandbox.sequenceArrForTrack(tr);
	log(a2.length === n0 && a2.some((k) => Math.abs(k.time - r4(t0 + 0.25)) < 1e-4), 'retimeSequenceKey moves the key without losing one');
	log(a2.every((k, i) => i === 0 || (k.time || 0) >= (a2[i - 1].time || 0)), 'and leaves the array sorted by time');
}

// delete must not silently re-time the keys that INHERIT the deleted key's delay
{
	sandbox.rawDoc = norm(clone(doc0));
	const a1 = sandbox.sequenceArrForTrack(tr);
	const owner = a1.findIndex((k) => typeof k.delay === 'number');
	if (owner >= 0 && a1[owner + 1] && typeof a1[owner + 1].delay !== 'number') {
		const held = a1[owner].delay;
		sandbox.deleteSequenceKeyAt(tr, r4(a1[owner].time || 0));
		const a2 = sandbox.sequenceArrForTrack(tr) || [];
		const follower = a2[0];
		log(!!follower && Math.abs(follower.delay - held) < 1e-9, 'deleting the key that OWNS the delay pins it on the follower that inherited it');
	}
}

}

// SYNTHETIC — the owned-vs-inherited `delay` bookkeeping. Runs on ANY rig (it builds its own
// timeline), so a checkout with no sequence rig still gates this logic.
{
	const mk = (keys) => { const d = clone(doc0); d.animations = d.animations || {}; d.animations.__t = { attachments: { default: { s: { a: { sequence: keys } } } } }; return d; };
	const T = { kind: 'sequence', name: 's', att: 'a' };
	const tid = sandbox.trackId(T);
	// Drive the real COMMIT, not the remap in isolation: `applyDopeScale` splits the timing remaps
	// from the retimes into two non-interleaved phases, and calling the remap directly is exactly how
	// the earlier interleaving bug stayed green here. `selectedTimes` is honoured in the given ORDER,
	// because `d.items` follows click order and the delay resolution must not depend on it.
	const run = (keys, selectedTimes) => {
		sandbox.rawDoc = mk(keys); sandbox.curAnim = '__t';
		sandbox.dopeTrackById = { [tid]: T };
		const d = { anchorT: 0, ratio: 2, items: selectedTimes.map((t) => ({ tid, tr: T, startTime: t, newTime: r4(t * 2) })) };
		sandbox.applyDopeScale(d);
		return sandbox.sequenceArrForTrack(T);
	};
	// The effective hold time each key actually plays at, after inheritance — what the runtime sees.
	const effective = (arr) => { let e = 0; return arr.map((k) => (typeof k.delay === 'number' ? (e = k.delay) : e)); };
	let out = run([{ time: 0, mode: 'loop', delay: 0.04 }, { time: 1, mode: 'loop' }], [0, 1]);
	log(Math.abs(out[0].delay - 0.08) < 1e-9 && typeof out[1].delay !== 'number',
		'whole selection: the OWNED delay doubles and the inheritor keeps inheriting (still 1 value in the file)');

	out = run([{ time: 0, mode: 'loop', delay: 0.04 }, { time: 1, mode: 'loop' }], [0]);
	log(Math.abs(out[0].delay - 0.08) < 1e-9 && Math.abs(out[1].delay - 0.04) < 1e-9,
		'owner alone selected: the UNSELECTED inheritor is pinned at the OLD 0.04 so its speed is unchanged');

	out = run([{ time: 0, mode: 'loop', delay: 0.04 }, { time: 1, mode: 'loop' }], [1]);
	log(typeof out[0].delay === 'number' && Math.abs(out[0].delay - 0.04) < 1e-9 && Math.abs(out[1].delay - 0.08) < 1e-9,
		'inheritor alone selected: it gets its own scaled 0.08 and the unselected owner is untouched');

	// THREE keys with an UNSELECTED inheritor in the middle — the case a per-key pass could not get
	// right, and where its answer depended on which selected key was clicked first.
	for (const order of [[0, 2], [2, 0]]) {
		out = run([{ time: 0, mode: 'loop', delay: 0.04 }, { time: 1, mode: 'loop' }, { time: 2, mode: 'loop' }], order);
		const eff = effective(out);
		log(Math.abs(eff[0] - 0.08) < 1e-9 && Math.abs(eff[1] - 0.04) < 1e-9 && Math.abs(eff[2] - 0.08) < 1e-9,
			`unselected inheritor in the middle, clicked [${order}]: effective delays ${eff.map((v) => v.toFixed(3))} — both selected keys scaled, the skipped one unchanged`);
	}

	out = run([{ time: 0, mode: 'loop' }, { time: 1, mode: 'loop' }], [0, 1]);
	log(typeof out[0].delay !== 'number', 'delay 0 (the loader default) is left alone — the runtime divides by it');
}

// ---- D. AUTHORING: the declaration, and why a wrong one is dangerous ---------------------
// Only meaningful on a rig that has a sequence attachment to reason about.
if (withSeq.length) {
	sandbox.rawDoc = norm(clone(doc0));
	sandbox.curAnim = withSeq[0][0];
	const decl = (() => {
		for (const sk of sandbox.rawDoc.skins || [])
			for (const [slot, atts] of Object.entries(sk.attachments || {}))
				for (const [att, d] of Object.entries(atts)) if (d.sequence) return { slot, att, def: d };
		return null;
	})();

	if (decl) {
		const basePath = decl.def.path || decl.att;
		const seq = decl.def.sequence;

		// Every frame the SHIPPED resolver names is really in the atlas.
		const frames = sandbox.sequenceFrames(basePath, seq);
		log(frames.length === seq.count && frames.every((f) => f.ok),
			`sequenceFrames resolves all ${frames.length} frames of ${basePath} (${frames[0].name} … ${frames[frames.length - 1].name})`);

		// THE DANGER, measured against the OFFICIAL loader rather than asserted from the docs: three
		// of these make the rig unopenable, and the editor refuses to write exactly those three.
		const setSeq = (patch) => {
			const d = clone(doc0);
			for (const sk of d.skins) for (const atts of Object.values(sk.attachments || {})) for (const a of Object.values(atts)) if (a.sequence) Object.assign(a.sequence, patch);
			return d;
		};
		const loads = (obj) => { try { loadSkeleton(obj); return true; } catch { return false; } };
		const resolves = (patch) => sandbox.sequenceFrames(basePath, { ...seq, ...patch }).every((f) => f.ok);
		// Perturb each field RELATIVE to what this rig actually declares — `start` is not always 1
		// in the wild (tumble_win's frames are `expl-00`…`expl-17`, so it declares 0), and an
		// assertion that hardcoded the default would call a correct rig broken.
		const realStart = seq.start == null ? 1 : seq.start;
		for (const [label, patch, canLoad] of [
			['count +1', { count: seq.count + 1 }, false],
			[`start ${realStart - 1} (off-by-one from ${realStart})`, { start: realStart - 1 }, false],
			['digits +1', { digits: (seq.digits || 0) + 1 }, false],
		]) {
			log(loads(setSeq(patch)) === canLoad, `${label}: the official loader THROWS — a rig saved that way would not open`);
			log(!resolves(patch), `${label}: the editor's resolve check catches it, so it is never written`);
		}
		// `setup` is clamped by the runtime and cannot brick anything, which is why the editor does
		// not gate it. `count` one SHORT loads too — it silently drops the tail rather than throwing.
		log(loads(setSeq({ setup: 999 })), 'setup past the end still loads (Sequence.apply clamps it) — correctly not gated');
		log(loads(setSeq({ count: Math.max(1, seq.count - 1) })), 'count one short loads and silently drops the last frame — a truncation, not a crash');

		// Detection re-derives the shipped declaration from the atlas alone, from the base path AND
		// from a single frame of it (picking frame 1 should offer the whole flipbook).
		const d1 = sandbox.detectSequence(basePath);
		log(!!d1 && d1.count === seq.count && d1.start === (seq.start == null ? 1 : seq.start) && d1.digits === seq.digits,
			`detectSequence(${basePath}) re-derives the shipped declaration ${JSON.stringify(d1)}`);
		const oneFrame = frames[0].name;
		const d2 = sandbox.detectSequence(oneFrame);
		log(!!d2 && d2.base === basePath && d2.count === seq.count,
			`detectSequence("${oneFrame}") strips the frame number and offers the whole run`);
		log(sandbox.detectSequence('definitely_not_a_region_') === null, 'detectSequence returns null when there is no numbered run');

		// THE TOLERANT LOADER. Spine throws on a missing frame; the Rigger must still open the rig,
		// or a re-packed atlas leaves it unrepairable in the only tool that could repair it.
		const held = sandbox.missingArt;
		sandbox.missingArt = [];
		let opened = true;
		try {
			const bad = new TextureAtlas(atlasText);
			const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
			for (const p of bad.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
			new SkeletonJson(sandbox.makeAttachmentLoader(bad)).readSkeletonData(setSeq({ count: seq.count + 1 }));
		} catch { opened = false; }
		log(opened, 'makeAttachmentLoader OPENS a rig whose sequence names a frame the atlas lacks (Spine alone throws)');
		log(sandbox.missingArt.some((m) => m.type === 'sequence frame'), `and reports it as a missing frame (${sandbox.missingArt.length} recorded) so the banner can name it`);
		sandbox.missingArt = held;

		// KEYING at the playhead, through the shipped writer.
		const T = { kind: 'sequence', name: decl.slot, att: decl.att };
		sandbox.rawDoc = norm(clone(doc0));
		sandbox.curAnim = '__new';
		sandbox.rawDoc.animations.__new = { bones: {} };
		sandbox.animTime = 0.75;
		const k1 = sandbox.keySequenceAtPlayhead(T);
		log(!!k1 && Math.abs(k1.time - 0.75) < 1e-4, 'keySequenceAtPlayhead writes a key at the playhead');
		log(k1 && typeof k1.delay === 'number' && k1.delay > 0, `and gives a first key a real hold time (${k1 && k1.delay}s) rather than 0, which would never advance`);
		sandbox.animTime = 1.5;
		const k2 = sandbox.keySequenceAtPlayhead(T);
		log(sandbox.sequenceArrForTrack(T).length === 2, 'a second key lands beside the first, in the same skin node');
		log(k2 && k2.mode === k1.mode && k2.index === k1.index, 'and continues the flipbook rather than restarting it at image 0');
		sandbox.animTime = 0.75;
		sandbox.keySequenceAtPlayhead(T);
		log(sandbox.sequenceArrForTrack(T).length === 2, 'keying the same time twice updates rather than duplicating');

		// FIELD EDITS, including the one distinction the format makes and a UI could destroy.
		const arr = sandbox.sequenceArrForTrack(T);
		sandbox.setSeqKeyField(T, arr[0], 'mode', 'pingpong');
		log(arr[0].mode === 'pingpong', 'setSeqKeyField writes a valid mode');
		sandbox.setSeqKeyField(T, arr[0], 'mode', 'nonsense');
		log(arr[0].mode === 'pingpong', 'and refuses one the runtime does not have');
		sandbox.setSeqKeyField(T, arr[0], 'index', 9999);
		log(arr[0].index === seq.count - 1, `index is clamped to the declared frame count (${arr[0].index})`);
		sandbox.setSeqKeyField(T, arr[0], 'delay', 0);
		log(arr[0].delay === 0, 'an explicit 0 hold time is WRITTEN (the sequence then sits on one image)');
		sandbox.setSeqKeyField(T, arr[0], 'delay', '');
		log(!('delay' in arr[0]), 'and an empty field REMOVES it, so the key inherits — the two are never conflated');

		// REMOVING the declaration must take the timeline with it: the loader builds a
		// SequenceTimeline from `attachment.sequence.id`, so keys left on an attachment that is no
		// longer a sequence are the same class of unopenable rig as a missing frame.
		// Strip the declaration from EVERY sequenced attachment (there may be several) so the only
		// variable is whether the keys went too.
		const stripDecls = (doc) => {
			const out = clone(doc);
			for (const sk of out.skins) for (const atts of Object.values(sk.attachments || {})) for (const a of Object.values(atts)) if (a.sequence){ delete a.sequence; a.path = frames[0].name; }
			return out;
		};
		sandbox.rawDoc = norm(clone(doc0));
		log(!loads(stripDecls(sandbox.rawDoc)),
			'control: dropping the declaration and LEAVING the keys makes the rig unopenable — which is why removal clears both');

		const before = sandbox.animsWithSequenceKeys(decl.slot, decl.att);
		log(before.length > 0, `animsWithSequenceKeys finds the ${before.length} animation(s) that would be orphaned`);
		for (const sk of sandbox.rawDoc.skins || [])
			for (const [slot, atts] of Object.entries(sk.attachments || {}))
				for (const [att, d] of Object.entries(atts)) if (d.sequence) sandbox.dropSequenceKeysFor(slot, att);
		log(sandbox.animsWithSequenceKeys(decl.slot, decl.att).length === 0, 'dropSequenceKeysFor clears every one of them');
		log(loads(stripDecls(sandbox.rawDoc)), 'and the rig loads again once the declaration goes with them');
	}
}

// ---- E. MULTI-SKIN — where a new key is allowed to land -----------------------------------
// The sequence row is offered from whichever skin DECLARES the sequence (active, falling back to
// default), so keying blind into the ACTIVE skin writes a timeline for an attachment that skin has
// not got. SkeletonJson then reads `attachment.sequence.id` off null and the rig never opens again
// — and the tolerant loader cannot rescue it, because that throw is in readAnimation, not the
// attachment loader. Every other assertion here runs on a single-skin rig, which is exactly why
// this one builds its own two-skin doc.
{
	const T = { kind: 'sequence', name: 's', att: 'art_' };
	const ATLAS = 'probe.png\nsize:64,64\nfilter:Linear,Linear\nart_01\nbounds:0,0,8,8\nart_02\nbounds:8,0,8,8\n';
	const mkDoc = () => ({
		skeleton: { spine: '4.2' },
		bones: [{ name: 'root' }],
		slots: [{ name: 's', bone: 'root', attachment: 'art_' }],
		skins: [
			{ name: 'default', attachments: { s: { art_: { width: 10, height: 10, sequence: { count: 2, start: 1, digits: 2 } } } } },
			// A legitimate override skin for the SAME slot that simply does not define `art_`.
			{ name: 'gold', attachments: { s: { plain_: { path: 'art_01', width: 4, height: 4 } } } },
		],
		animations: { a: { bones: {} } },
	});
	const loadsWith = (doc, loaderFor) => {
		const at = new TextureAtlas(ATLAS);
		const stub = { getImage: () => ({ width: 64, height: 64 }), setFilters() {}, setWraps() {}, dispose() {} };
		for (const pg of at.pages) { pg.width = pg.width || 64; pg.height = pg.height || 64; try { pg.setTexture(stub); } catch { pg.texture = stub; } }
		try { new SkeletonJson(loaderFor(at)).readSkeletonData(clone(doc)); return true; } catch (e) { return String(e.message); }
	};

	for (const skin of ['gold', 'default']) {
		activeSkin = skin;
		sandbox.rawDoc = mkDoc();
		sandbox.curAnim = 'a';
		sandbox.animTime = 0.5;
		const k = sandbox.keySequenceAtPlayhead(T);
		const nodes = Object.keys(sandbox.rawDoc.animations.a.attachments || {});
		log(!!k && nodes.length === 1 && nodes[0] === 'default',
			`active skin "${skin}": the key lands under the skin that DECLARES the sequence (${nodes.join(',') || 'nowhere'})`);
		log(loadsWith(sandbox.rawDoc, (at) => new AtlasAttachmentLoader(at)) === true,
			`active skin "${skin}": and the rig still opens in stock Spine`);
	}

	// The control: writing into a skin that does not declare it really is fatal, and really is
	// beyond the tolerant loader's reach.
	const broken = mkDoc();
	broken.animations.a.attachments = { gold: { s: { art_: { sequence: [{ time: 0.5, mode: 'loop', delay: 0.04 }] } } } };
	const why = loadsWith(broken, (at) => new AtlasAttachmentLoader(at));
	log(why !== true, `control: a key under a skin that does not declare the sequence DOES brick the rig (${String(why).slice(0, 46)})`);
	log(loadsWith(broken, (at) => sandbox.makeAttachmentLoader(at)) !== true,
		'control: and the tolerant loader cannot rescue that one — the throw is in readAnimation');
	activeSkin = 'default';
}

console.log(pass ? `\nPASS (${checks} checks)\n` : `\nFAIL (${checks} checks)\n`);
process.exit(pass ? 0 : 1);
