// Dopesheet STRETCH spike — prove that scaling the selection's key TIMES about one anchor is a
// pure affine retime that loses no key and no easing.
//   node tools/rigger-spike/stretch.mjs <skeleton.json> [skeleton.atlas]
//
// Runs the SHIPPED code out of view.html (the stretch block + every retime function it dispatches
// to), not a re-implementation — the point is to catch a regression in the file that ships.
//
// ============================== THE CONTRACT ==============================
// With A = the anchor time, r = the ratio, a stretch must satisfy, for every selected key:
//
//   1. AFFINE           t' = A + (t − A)·r, rounded to 4dp. The anchor itself never moves (t=A).
//   2. LOSSLESS         the track keeps exactly as many keys as it had. Keys slide PAST each other
//                       in either direction, and `retimeTrackKey` DROPS a key it lands on, so the
//                       apply order is the whole game: spreading → farthest-from-anchor first,
//                       squashing → nearest first. Applying in selection order merges keys.
//   3. ORDER-PRESERVING an affine map with r > 0 preserves betweenness, so the key ORDER on every
//                       track is unchanged.
//   4. TIMING FOLLOWS   `retimeTrackKey` writes `time` and nothing else, so every OTHER time-valued
//                       field must be re-fitted alongside it: a bezier key's CONTROL TIMES, and a
//                       sequence key's `delay`. A segment is mapped onto its final extent, which
//                       also keeps it valid when only one of its two ends moved.
//   5. CLAMPED          `startDopeScale` derives the ratio limits: no key may cross t=0 (maxRatio),
//                       and two distinct times may never squash into one (minRatio keeps ≥1ms,
//                       10× the 1e-4 merge epsilon — rig editing has no undo).
//
// NOTE ON SCOPE: the stretch moves ONLY the selected keys. Unselected keys stay where they are and
// CAN be overwritten if a selected key lands on one — same as the existing drag-to-retime, which is
// why assertion 2 counts keys on the SELECTED tracks with a selection that covers them all.
// ==========================================================================

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath) {
	console.error('usage: node tools/rigger-spike/stretch.mjs <skeleton.json> [skeleton.atlas]');
	process.exit(2);
}
if (atlasPath) { /* accepted for batch symmetry; the stretch is pure timeline data */ }

// ---- pull the SHIPPED stretch + retime code out of view.html ----------------------------
const VIEW = new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url);
const html = readFileSync(VIEW, 'utf8');

const START = '// ---- Stretch (dopesheet): scale the selection';
const END = 'function startDopeMarquee(';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) {
	console.error('✗ could not find the stretch block in view.html — the markers moved');
	process.exit(2);
}
const shipped = html.slice(a, b);
for (const fn of ['dopeAnchorTime', 'trackKeyArrays', 'scaleTrackKeyTimings', 'startDopeScale', 'applyDopeScale', 'syncDopeScaleBar']) {
	if (!shipped.includes('function ' + fn)) {
		console.error(`✗ extracted block is missing ${fn}() — the markers moved`);
		process.exit(2);
	}
}

// The retime dispatch + every kind-specific retime lives elsewhere in the file. Pull each by name
// so the test drives the REAL writers, not a stand-in.
// view.html writes a top-level function either wholly on one line or closed by a `}` at column 0.
// Take the single line when its braces already balance, else slice to that column-0 close.
function pullFn(name) {
	const i = html.indexOf('\nfunction ' + name + '(');
	if (i < 0) { console.error(`✗ function ${name} not found in view.html`); process.exit(2); }
	const eol = html.indexOf('\n', i + 1);
	const first = html.slice(i, eol);
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
const deps = [
	...['animOf', 'chArr', 'ikChannelArr', 'tcChannelArr', 'pathChannelArr', 'pcAnim', 'PC_SIM',
		'PC_VAL_CHANS', 'PC_ALL_CHANS', 'activeSkinName', 'trackKeyTimes',
		'animEventArr', 'drawOrderArr', 'drawOrderKeyTimes'].map(pullConst),
	...['slotChannel', 'deformArrForTrack', 'sequenceArrForTrack', 'seqEffectiveDelay', 'scaleSequenceDelays', 'pinSequenceDelayAfter', 'retimeSequenceKey', 'copySequenceKey',
		'deleteSequenceKeyAt', 'sequenceTracksWithKeys', 'seqKeyLabel', 'trackId', 'scaleKeyTimes', 'dopeScaleClashes', 'fitKeyCurve', 'clampTrackCurves', 'boneKeyTimes', 'slotKeyTimes',
		'eventKeyTimes', 'ikKeyTimes', 'transformKeyTimes', 'physicsKeyTimes', 'pathKeyTimes', 'slotIsTwoColor', 'retimeTrackKey', 'retimeBoneKey', 'retimeSlotKey',
		'retimeChannelKey', 'retimeEventKey', 'retimeDrawOrderKey', 'retimeDeformKey', 'retimeIkKey',
		'retimeTransformKey', 'retimePhysicsKey', 'retimePathKey'].map(pullFn),
].join('\n');

// A div just real enough for the bar: class list, style, dataset, and removal from its parent.
function mkEl() {
	const e = { className: '', title: '', style: {}, dataset: {}, onmousedown: null };
	const set = () => new Set(e.className.split(' ').filter(Boolean));
	e.classList = {
		toggle(c, on) { const S = set(); if (on) S.add(c); else S.delete(c); e.className = [...S].join(' '); },
		contains: (c) => set().has(c),
	};
	e.remove = () => { const i = ruler.kids.indexOf(e); if (i >= 0) ruler.kids.splice(i, 1); };
	return e;
}
const matches = (el, sel) => sel.split(',').map((x) => x.trim().replace(/^\./, '')).some((c) => el.classList.contains(c));
const ruler = {
	kids: [],
	appendChild(c) { this.kids.push(c); },
	querySelector(sel) { return this.kids.find((k) => matches(k, sel)) || null; },
	querySelectorAll(sel) { return this.kids.filter((k) => matches(k, sel)); },
};

const sandbox = {
	roundN: (v, n) => { const f = Math.pow(10, n); return Math.round(v * f) / f; },
	// Enough DOM for syncDopeScaleBar to be driven for real — it only creates divs, appends them to
	// #tlRuler, and reads them back by class. `$` hands it the fake ruler; anything else is inert.
	$: (sel) => (sel === '#tlRuler' ? ruler : { textContent: '', style: {}, dataset: {}, classList: { toggle() {} } }),
	document: { querySelectorAll: () => [], createElement: () => mkEl() },
	markDirty() { sandbox.dirty = true; },
	rawDoc: null, skeleton: null, curAnim: null, animsDirty: false, dirty: false,
	dopeSel: [], dopeAnchorT: null, dopeScale: null, dopeTrackById: {}, dopeDotEls: {},
	graphSnap: false, tlPps: 100,
};
vm.createContext(sandbox);
// A `const` binding lives in the script's declarative scope, NOT on the sandbox object, so a spike
// can only reach `function` declarations unless the consts are published onto it explicitly.
const PUBLISH = 'Object.assign(globalThis, { animOf, activeSkinName, trackKeyTimes, PC_ALL_CHANS });';
vm.runInContext([deps, shipped, PUBLISH].join('\n'), sandbox, { filename: 'view.html#stretch' });

// ---- helpers ---------------------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Every dopesheet track an animation actually has keys on, as {tr, times}. Mirrors
// `timelineTracks()`'s overview mode (one row per keyed bone / slot / constraint) without needing
// the skeleton, so the spike can run on the raw doc alone.
function tracksOf(anim) {
	const out = [];
	const add = (tr, times) => { if (times.length) out.push({ tr, times: times.map(r4).sort((x, y) => x - y) }); };
	const unionOf = (node, chans) => {
		const set = new Set();
		for (const c of chans) if (Array.isArray(node[c])) for (const k of node[c]) set.add(r4(k.time || 0));
		return [...set];
	};
	for (const [name, cb] of Object.entries(anim.bones || {})) add({ kind: 'bone', name }, unionOf(cb, ['rotate', 'translate', 'scale', 'shear']));
	for (const [name, cs] of Object.entries(anim.slots || {})) add({ kind: 'slot', name }, unionOf(cs, ['attachment', 'rgba', 'rgba2']));
	for (const [name, arr] of Object.entries(anim.ik || {})) if (Array.isArray(arr)) add({ kind: 'ik', name }, arr.map((k) => k.time || 0));
	for (const [name, arr] of Object.entries(anim.transform || {})) if (Array.isArray(arr)) add({ kind: 'transform', name }, arr.map((k) => k.time || 0));
	for (const [name, node] of Object.entries(anim.path || {})) for (const ch of ['position', 'spacing', 'mix']) if (Array.isArray(node[ch])) add({ kind: 'pathch', name, ch }, node[ch].map((k) => k.time || 0));
	for (const [name, node] of Object.entries(anim.physics || {})) add({ kind: 'physics', name }, unionOf(node, sandbox.PC_ALL_CHANS));
	for (const slots of Object.values(anim.attachments || {}))
		for (const [slot, atts] of Object.entries(slots || {}))
			for (const [att, am] of Object.entries(atts || {})) {
				if (am && Array.isArray(am.deform)) add({ kind: 'deform', name: slot, att }, am.deform.map((k) => k.time || 0));
				if (am && Array.isArray(am.sequence)) add({ kind: 'sequence', name: slot, att }, am.sequence.map((k) => k.time || 0));
			}
	if (Array.isArray(anim.events)) add({ kind: 'events', name: 'events' }, [...new Set(anim.events.map((e) => r4(e.time || 0)))]);
	if (Array.isArray(anim.drawOrder)) add({ kind: 'draworder', name: 'draworder' }, anim.drawOrder.map((k) => r4(k.time || 0)));
	return out;
}

// Spine omits `time` on a key at 0 (it is the format default) — every reader in view.html treats it
// as a number, so normalise the same way `normalizeKeyTimes` does at load.
function normalizeTimes(node, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 8) return;
	for (const v of Object.values(node)) {
		if (Array.isArray(v)) {
			if (v.length && typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0])) for (const k of v) if (typeof k.time !== 'number') k.time = 0;
		} else normalizeTimes(v, depth + 1);
	}
}

// Load one animation into the sandbox and select every key on `picked`.
function open(doc, animName, picked) {
	sandbox.rawDoc = clone(doc);
	sandbox.curAnim = animName;
	sandbox.skeleton = null; // activeSkinName() then falls through to "default"
	normalizeTimes(sandbox.rawDoc.animations[animName]);
	sandbox.dopeTrackById = {};
	sandbox.dopeSel = [];
	for (const { tr, times } of picked) {
		const tid = sandbox.trackId(tr);
		sandbox.dopeTrackById[tid] = tr;
		for (const t of times) sandbox.dopeSel.push({ tid, time: t });
	}
	sandbox.dirty = false; sandbox.animsDirty = false;
}

// Drive the SHIPPED startDopeScale + applyDopeScale at a target ratio, exactly as the mousemove
// does: grab an end grip, let the pointer land where that ratio puts it.
function stretch(anchorT, edge, ratio) {
	sandbox.dopeAnchorT = anchorT;
	sandbox.startDopeScale({ clientX: 0 }, edge, 1);
	const d = sandbox.dopeScale;
	if (!d) return null;
	d.ratio = Math.max(d.minRatio, Math.min(d.maxRatio, ratio));
	for (const it of d.items) it.newTime = Math.max(0, r4(d.anchorT + (it.startTime - d.anchorT) * d.ratio));
	sandbox.applyDopeScale(d);
	sandbox.dopeScale = null;
	return d;
}

// Stretch a subset of ONE track's keys, leaving keys on BOTH sides of the selection unselected.
// This is the configuration the whole-track cases never reach, and the only one in which a selected
// key can land on an unselected one, or a segment can end up with one moving end.
function stretchWithin(animName, track, pickIdx, anchorIdx, ratio) {
	open(doc, animName, [{ tr: track.tr, times: pickIdx.map((i) => track.times[i]) }]);
	return { d: stretch(track.times[anchorIdx], 'r', ratio), doc0: null };
}
// Every bezier control time on a track must sit inside the segment its own key starts.
function curvesInSegments(tr) {
	let bad = 0, seen = 0;
	for (const arr of sandbox.trackKeyArrays(tr)) {
		for (let i = 0; i < arr.length - 1; i++) {
			if (!Array.isArray(arr[i].curve)) continue;
			const t1 = arr[i].time, t2 = arr[i + 1].time;
			for (let c = 0; c < arr[i].curve.length; c += 4) {
				for (const ci of [c, c + 2]) { seen++; if (!(arr[i].curve[ci] >= t1 - 1e-3 && arr[i].curve[ci] <= t2 + 1e-3)) bad++; }
			}
		}
	}
	return { bad, seen };
}

// ---- run -------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
const anims = Object.entries(doc.animations || {});
console.log(`\n${jsonPath.split(/[\\/]/).pop()} — ${anims.length} animation(s)\n`);

// Compare two track lists: same tracks, same key COUNT, times matching the affine image.
function compare(before, after, anchorT, rr, tag) {
	let lossless = true, affine = true, ordered = true, worst = 0;
	const map = (t) => Math.max(0, r4(anchorT + (t - anchorT) * rr));
	for (const bt of before) {
		const at = after.find((x) => sandbox.trackId(x.tr) === sandbox.trackId(bt.tr));
		if (!at || at.times.length !== bt.times.length) { lossless = false; continue; }
		const want = bt.times.map(map).sort((x, y) => x - y);
		for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(at.times[i] - want[i]));
		for (let i = 1; i < at.times.length; i++) if (at.times[i] < at.times[i - 1]) ordered = false;
	}
	if (worst > 1e-4) affine = false;
	log(lossless, `${tag} — every track keeps its key COUNT (no merge)`);
	log(affine, `${tag} — every key time is A+(t−A)·r (worst drift ${worst.toExponential(1)})`);
	log(ordered, `${tag} — key order preserved on every track`);
	return worst;
}

// Every bezier control time must sit inside its own segment, and — where both ends of the segment
// moved under the same map — land exactly on the affine image of where it was.
function checkCurves(before, doc0, anchorT, rr, tag) {
	let inSeg = true, curveAffine = true, curves = 0, cWorst = 0;
	const live = sandbox.rawDoc;
	for (const { tr } of before) {
		sandbox.rawDoc = doc0;
		const arrsB = sandbox.trackKeyArrays(tr).map(clone);
		sandbox.rawDoc = live;
		const arrsA = sandbox.trackKeyArrays(tr);
		for (let ai = 0; ai < arrsA.length; ai++) {
			const A = arrsA[ai], B = arrsB[ai] || [];
			for (let i = 0; i < A.length - 1; i++) {
				if (!Array.isArray(A[i].curve)) continue;
				curves++;
				const t1 = A[i].time, t2 = A[i + 1].time;
				for (let c = 0; c < A[i].curve.length; c += 4) {
					for (const ci of [c, c + 2]) {
						const v = A[i].curve[ci];
						if (!(v >= t1 - 1e-3 && v <= t2 + 1e-3)) inSeg = false;
						if (B[i] && Array.isArray(B[i].curve) && B[i].curve.length === A[i].curve.length) {
							const want = Math.min(t2, Math.max(t1, r4(anchorT + (B[i].curve[ci] - anchorT) * rr)));
							cWorst = Math.max(cWorst, Math.abs(v - want));
						}
					}
				}
			}
		}
	}
	if (cWorst > 1e-3) curveAffine = false;
	if (curves) {
		log(inSeg, `${tag} — all ${curves} bezier control times stay inside their segment`);
		log(curveAffine, `${tag} — control times took the same affine map (worst ${cWorst.toExponential(1)})`);
	}
	return curves;
}

let exercised = 0, sawWall = false, orderingProved = false;

for (const [animName, anim0] of anims) {
	const probe = clone(anim0);
	normalizeTimes(probe);
	const tracks = tracksOf(probe);
	const allTimes = [...new Set(tracks.flatMap((t) => t.times))].sort((x, y) => x - y);
	if (tracks.length === 0 || allTimes.length < 2) continue;
	exercised++;

	const first = allTimes[0], last = allTimes[allTimes.length - 1];
	const mid = allTimes[Math.floor(allTimes.length / 2)];
	// Three anchors + a legal ratio for each. Spreading about a middle/last anchor is only legal
	// while the earliest selected key stays ≥ 0 — hence a SQUASH there (always legal), and a real
	// spread only from the first key, where nothing lies to the anchor's left.
	const CASES = [
		{ anchorT: first, edge: 'r', ratio: [2, 3.5, 0.5, 0.25, 1.75][exercised % 5], what: 'first key' },
		{ anchorT: mid, edge: 'r', ratio: 0.5, what: 'middle key' },
		{ anchorT: last, edge: 'l', ratio: 0.6, what: 'last key' },
	].filter((c, i, all) => all.findIndex((x) => Math.abs(x.anchorT - c.anchorT) < 1e-9) === i);

	for (const { anchorT, edge, ratio, what } of CASES) {
		if (Math.abs((edge === 'r' ? last : first) - anchorT) < 1e-4) continue; // that grip IS the anchor
		open(doc, animName, tracks);
		const doc0 = clone(sandbox.rawDoc);
		const before = tracksOf(sandbox.rawDoc.animations[animName]);
		const d = stretch(anchorT, edge, ratio);
		if (!d) { log(false, `${animName} @${anchorT}s — startDopeScale refused a live grip`); continue; }
		const tag = `${animName} ×${d.ratio.toFixed(2)} @${anchorT.toFixed(3)}s (${what})`;
		log(Math.abs(d.ratio - 1) > 1e-6, `${tag} — the ratio actually moved off 1 (the case is live)`);
		compare(before, tracksOf(sandbox.rawDoc.animations[animName]), anchorT, d.ratio, tag);
		const hadAnchor = before.some((t) => t.times.some((x) => Math.abs(x - anchorT) < 1e-4));
		if (hadAnchor) log(tracksOf(sandbox.rawDoc.animations[animName]).some((t) => t.times.some((x) => Math.abs(x - anchorT) < 1e-4)),
			`${tag} — the ANCHOR key stayed at ${anchorT.toFixed(3)}s`);
		checkCurves(before, doc0, anchorT, d.ratio, tag);
	}

	// PARTIAL selection: stretch HALF the tracks and prove the other half did not move an inch.
	if (tracks.length > 1) {
		const picked = tracks.filter((_, i) => i % 2 === 0), left = tracks.filter((_, i) => i % 2 === 1);
		open(doc, animName, picked);
		const doc0 = clone(sandbox.rawDoc);
		const beforeL = tracksOf(sandbox.rawDoc.animations[animName]).filter((t) => left.some((x) => sandbox.trackId(x.tr) === sandbox.trackId(t.tr)));
		const pickedTimes = [...new Set(picked.flatMap((t) => t.times))].sort((x, y) => x - y);
		const d = stretch(pickedTimes[0], 'r', 2);
		if (d && Math.abs(d.ratio - 1) > 1e-6) {
			const tag = `${animName} ×${d.ratio.toFixed(2)} on ${picked.length}/${tracks.length} tracks`;
			compare(tracksOf(doc0.animations[animName]).filter((t) => picked.some((x) => sandbox.trackId(x.tr) === sandbox.trackId(t.tr))),
				tracksOf(sandbox.rawDoc.animations[animName]), pickedTimes[0], d.ratio, tag);
			const afterL = tracksOf(sandbox.rawDoc.animations[animName]).filter((t) => left.some((x) => sandbox.trackId(x.tr) === sandbox.trackId(t.tr)));
			let still = beforeL.length === afterL.length;
			for (const b of beforeL) {
				const aT = afterL.find((x) => sandbox.trackId(x.tr) === sandbox.trackId(b.tr));
				if (!aT || aT.times.length !== b.times.length || b.times.some((t, i) => Math.abs(t - aT.times[i]) > 1e-4)) still = false;
			}
			log(still, `${tag} — the ${left.length} UNSELECTED tracks did not move`);
			checkCurves(tracksOf(doc0.animations[animName]).filter((t) => picked.some((x) => sandbox.trackId(x.tr) === sandbox.trackId(t.tr))),
				doc0, pickedTimes[0], d.ratio, tag);
		}
	}

	// PARTIAL SELECTION WITHIN ONE TRACK — keys left unselected on BOTH sides. Only here can a
	// selected key land on an unselected one, and only here does a segment get one moving end.
	{
		const fat = tracks.filter((t) => t.times.length >= 4).sort((a, b) => b.times.length - a.times.length)[0];
		if (fat) {
			const n = fat.times.length;
			const pick = []; for (let i = 1; i < n - 1; i++) pick.push(i); // drop the first and last key
			const anchorIdx = 1;
			for (const ratio of [1.6, 0.6]) {
				open(doc, animName, [{ tr: fat.tr, times: pick.map((i) => fat.times[i]) }]);
				const t0 = sandbox.trackKeyTimes(fat.tr).slice();
				const anchorT = fat.times[anchorIdx];
				sandbox.dopeAnchorT = anchorT;
				sandbox.startDopeScale({ clientX: 0 }, 'r', 1);
				const d = sandbox.dopeScale;
				if (!d) { sandbox.dopeScale = null; continue; }
				d.ratio = Math.max(d.minRatio, Math.min(d.maxRatio, ratio));
				for (const it of d.items) it.newTime = Math.max(0, r4(d.anchorT + (it.startTime - d.anchorT) * d.ratio));
				const predicted = sandbox.dopeScaleClashes(d);
				sandbox.applyDopeScale(d);
				sandbox.dopeScale = null;
				const t1 = sandbox.trackKeyTimes(fat.tr);
				const tag = `${animName} ×${d.ratio.toFixed(2)} on ${pick.length}/${n} keys of ONE track`;
				// 1. every key that vanished was one a selected key landed on — and the count was predicted
				log(t0.length - t1.length === predicted, `${tag} — dopeScaleClashes predicted the ${predicted} overwritten key(s) exactly`);
				// 2. an unselected key that was NOT landed on must not have budged
				const untouched = [fat.times[0], fat.times[n - 1]].filter((t) => !d.items.some((it) => Math.abs(it.newTime - t) < 1e-4));
				log(untouched.every((t) => t1.some((x) => Math.abs(x - t) < 1e-4)), `${tag} — the unselected keys outside the selection stayed put`);
				// 3. FINDING: the key BEFORE the selection eases into it, so its segment changed length
				//    while it never moved. Its controls must still be inside their own segment.
				const { bad, seen } = curvesInSegments(fat.tr);
				if (seen) log(bad === 0, `${tag} — all ${seen} bezier control times still inside their segment (${bad} outside)`);
			}
		}
	}

	// 5. CLAMPED — the limits startDopeScale derives must actually hold.
	open(doc, animName, tracks);
	if (mid > first + 1e-6) {
		sandbox.dopeAnchorT = mid;
		sandbox.dopeScale = null;
		sandbox.startDopeScale({ clientX: 0 }, 'r', 1);
		const d = sandbox.dopeScale;
		if (d) {
			const earliest = Math.min(...d.items.map((i) => i.startTime));
			const atMax = mid + (earliest - mid) * d.maxRatio;
			log(atMax >= -1e-4, `${animName} — maxRatio ${d.maxRatio.toFixed(3)} keeps the earliest key at t≥0 (${atMax.toFixed(4)}s)`);
			log(Math.abs(d.maxRatio - mid / (mid - earliest)) < 1e-9, `${animName} — maxRatio is exactly A/(A−t₀), the t=0 wall`);
			if (earliest < 1e-9) { sawWall = true; log(d.wall === true, `${animName} — a key at 0s + a middle anchor ⇒ wall flagged (spread impossible, squash still fine)`); }
			for (const it of d.items) it.newTime = Math.max(0, r4(mid + (it.startTime - mid) * d.minRatio));
			const distinctBefore = new Set(d.items.map((i) => r4(i.startTime))).size;
			const distinctAfter = new Set(d.items.map((i) => r4(i.newTime))).size;
			log(distinctAfter === distinctBefore, `${animName} — minRatio ${d.minRatio.toExponential(2)} keeps all ${distinctBefore} distinct times apart`);
			sandbox.dopeScale = null;
		}
	}

	// A grip that IS the anchor has no lever — startDopeScale must refuse it.
	open(doc, animName, tracks);
	sandbox.dopeAnchorT = first;
	sandbox.dopeScale = null;
	sandbox.startDopeScale({ clientX: 0 }, 'l', 1);
	log(sandbox.dopeScale === null, `${animName} — the grip ON the anchor is refused (nothing to pull)`);
	sandbox.dopeScale = null;

	// Round trip: ×4 then ×0.25 about the same anchor returns the original times exactly.
	open(doc, animName, tracks);
	const t0 = tracksOf(sandbox.rawDoc.animations[animName]);
	const up = stretch(first, 'r', 4);
	if (up && Math.abs(up.ratio - 1) > 1e-6) {
		sandbox.dopeSel = up.items.map((it) => ({ tid: it.tid, time: it.newTime }));
		const back = stretch(first, 'r', 1 / up.ratio);
		if (back) {
			const t1 = tracksOf(sandbox.rawDoc.animations[animName]);
			let same = t0.length === t1.length, drift = 0;
			for (const x of t0) {
				const y = t1.find((z) => sandbox.trackId(z.tr) === sandbox.trackId(x.tr));
				if (!y || y.times.length !== x.times.length) { same = false; continue; }
				for (let i = 0; i < x.times.length; i++) drift = Math.max(drift, Math.abs(x.times[i] - y.times[i]));
			}
			log(same && drift < 1e-3, `${animName} — ×4 then ×0.25 about ${first.toFixed(3)}s round-trips (drift ${drift.toExponential(1)})`);
		}
	}

	// NEGATIVE CONTROL — the apply ORDER is the whole game, so prove the lossless assertion CAN fail.
	// A SPREAD walked in ascending (= selection) order marches each key onto the one above it, which
	// `retimeTrackKey` then drops; the shipped code walks farthest-from-the-anchor first instead.
	if (!orderingProved) {
		open(doc, animName, tracks);
		const n0 = tracksOf(sandbox.rawDoc.animations[animName]).reduce((n, t) => n + t.times.length, 0);
		sandbox.dopeAnchorT = first;
		sandbox.dopeScale = null;
		sandbox.startDopeScale({ clientX: 0 }, 'r', 1);
		const d = sandbox.dopeScale;
		if (d && d.maxRatio > 1.5) {
			d.ratio = 2;
			for (const it of d.items) it.newTime = Math.max(0, r4(d.anchorT + (it.startTime - d.anchorT) * d.ratio));
			for (const it of d.items) if (Math.abs(it.newTime - it.startTime) > 1e-4) sandbox.retimeTrackKey(it.tr, it.startTime, it.newTime); // NAIVE ascending order
			const n1 = tracksOf(sandbox.rawDoc.animations[animName]).reduce((n, t) => n + t.times.length, 0);
			if (n1 < n0) { orderingProved = true; log(true, `${animName} — control: the SAME spread applied in selection order loses ${n0 - n1} key(s), so the order assertion has teeth`); }
			sandbox.dopeScale = null;
		}
	}
}

if (!sawWall) console.log('  · (no animation here put a key at 0s under a middle anchor — wall case not exercised)');
if (!orderingProved) console.log('  · (no spread here collided in naive order — ordering control not exercised)');
// `scaleKeyTimes` — the whole-animation "stretch all keys to N seconds". It used to walk `a.bones`
// and `a.slots` ONLY, silently leaving events, draw order, ik/transform/path/physics, deform and
// sequence keys at their original times; it is now a structural walk. Assert every key time in the
// animation scales, whatever timeline it sits on, and keep the old behaviour as the control.
{
	// every {node, key} in an animation that holds a numeric time — including the ones the old walk missed
	const allTimes = (a) => {
		const out = [];
		const walk = (n) => {
			if (!n || typeof n !== 'object') return;
			if (Array.isArray(n)) { for (const k of n) { if (k && typeof k === 'object' && !Array.isArray(k) && typeof k.time === 'number') out.push(k.time); else walk(k); } return; }
			for (const v of Object.values(n)) walk(v);
		};
		walk(a);
		return out;
	};
	const outside = (a) => { // the timelines the OLD bones+slots walk could not reach
		const b = clone(a); delete b.bones; delete b.slots;
		return allTimes(b).filter((t) => t > 0).length;
	};
	let ranAny = false, sawOutside = false;
	for (const [animName, anim0] of anims) {
		const probe = clone(anim0); normalizeTimes(probe);
		const before = allTimes(probe).filter((t) => t > 0);
		if (!before.length) continue;
		ranAny = true;
		const scaled = clone(probe);
		sandbox.scaleKeyTimes(scaled, 2);
		const after = allTimes(scaled).filter((t) => t > 0);
		log(after.length === before.length, `${animName} — scaleKeyTimes ×2 keeps all ${before.length} key time(s)`);
		log(after.every((t, i) => Math.abs(t - r4(before[i] * 2)) < 1e-4), `${animName} — every key time doubled, on EVERY timeline`);
		const n = outside(probe);
		if (n && !sawOutside) {
			sawOutside = true;
			const half = clone(probe);
			for (const grp of [half.bones, half.slots]) for (const ch of Object.values(grp || {})) for (const keys of Object.values(ch)) if (Array.isArray(keys)) for (const k of keys) k.time = r4(k.time * 2); // the OLD walk
			log(allTimes(half).filter((t) => t > 0).some((t, i) => Math.abs(t - r4(before[i] * 2)) > 1e-4),
				`${animName} — control: the old bones+slots-only walk leaves ${n} key time(s) behind, so the check above has teeth`);
		}
		const back = clone(scaled); sandbox.scaleKeyTimes(back, 0.5);
		log(allTimes(back).filter((t) => t > 0).every((t, i) => Math.abs(t - before[i]) < 1e-3), `${animName} — ×2 then ×0.5 returns every key time to where it started`);
	}
	if (!ranAny) console.log('  · (no animation with a key past 0s — scaleKeyTimes not exercised)');
}

// The BAR's own guard: it needs 2+ selected keys across 2+ distinct times, else there is no range to
// resize and it must draw nothing. Assert both sides on whatever this rig happens to have — which is
// also what covers a rig whose every timeline sits at a single instant, where there is no range to
// grab however many keys are selected.
for (const [animName, anim0] of anims) {
	const probe = clone(anim0); normalizeTimes(probe);
	const tracks = tracksOf(probe);
	const times = [...new Set(tracks.flatMap((t) => t.times))].sort((a, b) => a - b);
	open(doc, animName, tracks);
	ruler.kids = [];
	sandbox.dopeAnchorT = times.length ? times[0] : null;
	sandbox.syncDopeScaleBar(1);
	if (times.length < 2) { log(ruler.kids.length === 0, `${animName} — ${times.length} distinct key time(s): the stretch bar correctly draws NOTHING`); continue; }
	const grips = ruler.kids.filter((k) => k.classList.contains('tl-scale-grip'));
	log(ruler.kids.length === 4 && grips.length === 2, `${animName} — the stretch bar draws a range + a pin + 2 grips`);
	log(grips.filter((g) => g.classList.contains('dead')).length === 1, `${animName} — exactly one grip is dead (the one sitting on the anchor)`);
	// Moving the anchor must re-wire in place, not rebuild: the dopesheet is NOT re-rendered on a key
	// mousedown (that would detach the key and swallow its dblclick), so the same elements must update.
	const before = ruler.kids.slice();
	sandbox.dopeAnchorT = times[times.length - 1];
	sandbox.syncDopeScaleBar(1);
	log(ruler.kids.length === 4 && ruler.kids.every((k, i) => k === before[i]), `${animName} — moving the anchor UPDATES the same elements (no rebuild)`);
	log(grips.filter((g) => g.classList.contains('dead')).length === 1 && grips.find((g) => g.dataset.edge === 'r').classList.contains('dead'),
		`${animName} — the dead grip follows the anchor to the other end`);
	// And it must disappear when the selection can no longer be stretched.
	sandbox.dopeSel = [sandbox.dopeSel[0]];
	sandbox.syncDopeScaleBar(1);
	log(ruler.kids.length === 0, `${animName} — dropping to one key REMOVES the bar`);
}

// SYNTHETIC — a stretch that provably lands on an unselected key. Real rigs rarely line up exactly,
// so the clash assertions above run at zero; this is the case that gives them teeth. Overwriting is
// deliberate (drag-to-retime does it too) — what must never happen is doing it SILENTLY, so what is
// asserted is that `dopeScaleClashes` predicts the loss the commit then causes.
{
	const T = { kind: 'bone', name: '__clash' };
	const tid = sandbox.trackId(T);
	sandbox.rawDoc = { animations: { __c: { bones: { __clash: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 10 }, { time: 1, angle: 99 }] } } } } };
	sandbox.curAnim = '__c';
	sandbox.dopeTrackById = { [tid]: T };
	sandbox.dopeSel = [{ tid, time: 0 }, { tid, time: 0.5 }];
	sandbox.dopeAnchorT = 0;
	sandbox.startDopeScale({ clientX: 0 }, 'r', 1);
	const d = sandbox.dopeScale;
	d.ratio = 2;
	for (const it of d.items) it.newTime = r4(d.anchorT + (it.startTime - d.anchorT) * d.ratio);
	const predicted = sandbox.dopeScaleClashes(d);
	log(predicted === 1, `synthetic — dopeScaleClashes sees the selected 0.5s key landing on the unselected 1s key (${predicted})`);
	sandbox.applyDopeScale(d);
	sandbox.dopeScale = null;
	const left = sandbox.rawDoc.animations.__c.bones.__clash.rotate;
	log(left.length === 2 && left[1].angle === 10, 'synthetic — and the commit really does overwrite it, which is why the hint counts it');
	// the same stretch with nothing in the way loses nothing
	sandbox.rawDoc = { animations: { __c: { bones: { __clash: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 10 }, { time: 2, angle: 99 }] } } } } };
	sandbox.dopeSel = [{ tid, time: 0 }, { tid, time: 0.5 }];
	sandbox.startDopeScale({ clientX: 0 }, 'r', 1);
	const d2 = sandbox.dopeScale;
	d2.ratio = 2;
	for (const it of d2.items) it.newTime = r4(it.startTime * 2);
	log(sandbox.dopeScaleClashes(d2) === 0, 'synthetic — and reports 0 when the same stretch lands in free space');
	sandbox.applyDopeScale(d2);
	sandbox.dopeScale = null;
	log(sandbox.rawDoc.animations.__c.bones.__clash.rotate.length === 3, 'synthetic — nothing lost in that case');
}

if (!checks) { console.log('  ✗ this rig exercised NO assertion — every block skipped'); pass = false; }
console.log(pass ? `\nPASS (${checks} checks)\n` : `\nFAIL (${checks} checks)\n`);
process.exit(pass ? 0 : 1);
