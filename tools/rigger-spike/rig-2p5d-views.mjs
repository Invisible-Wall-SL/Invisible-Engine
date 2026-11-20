// Drawings by angle (2.5D P5, docs/design/rig-2p5d.md §4.7, §9), on the SHIPPED code: the real
// `half-body`, `full-body` and `bust-face` templates (`src/lib/server/rigTemplates.ts`), made 3D as
// 🧊 Make 3D makes them (`src/lib/rig3dViews.ts` → `rig3dImport.ts`), a 3D clip baked as the page
// and the save bake it (`rebakeClip3d` → `rig3d.ts` → `rig2p5d.ts`), and every result read by the
// strict irig reader and played by the REAL engine-rig (SkeletonJson → Skeleton → AnimationState, as
// a game plays it). Asserted:
//  - the right drawing at each angle: a torso turned 0°, 45°, 90° either way shows its front, ¾ and
//    side drawings, square to the viewer — `_r` for the card facing the picture's right — and a head
//    turned 45° shows its ¾ head; past the side view a side turnaround shows a front-half drawing
//    mirrored (the other ¾ at 135°, the front at 180°), a full one its ¾-back and back, unmirrored;
//  - a missing drawing falls back toward the front: with no ¾ art the front holds to 67.5°, then the
//    side shows; with no side art the ¾ holds to the side and past it;
//  - hold and hysteresis: a turn jittering ±2° at a ¾ boundary never swaps; one swinging ±12° swaps
//    no sooner than the hold apart; with margin and hold 0 the same jitter swaps over and over;
//  - image bones: made 3D, a slot whose bone carries more (a hand with its fingers, a bust's body
//    with its neck) moves onto an image bone of its own, appended last, so every slot — weighted
//    meshes included — draws exactly as before at setup and in a 2D clip; the hand's drawings then
//    show as the hand turns; a slot left on its carrying bone is refused; an image bone hung from the
//    chest and following the hand sits on the hand at setup, bakes the hand turning through edge-on
//    in fewer keys than one under the hand, and stays put in a 2D clip (it moves in 3D clips only);
//  - the templates: every view a part of its slot; a full turnaround is offered only on art with back
//    drawings, keeps them and drops a slot's views when its art has none; a side one drops them; the
//    3D import's square head outline turns with the head once the head has drawings;
//  - the views panel's data: a blank angle shows what it falls back to, a drawing replaced is not
//    kept twice; a deleted drawing, a renamed slot and a deleted bone leave the 3D data in step;
//  - planted mutants, each must be caught: no fallback, no image-bone refusal, back drawings kept on a
//    side turnaround, a full turnaround without back art, views kept on a carrying bone, no image
//    bones made, a follower placed at its parent's origin, an image bone inserted mid-list (weighted
//    indices), no follower at all, the head outline kept square, no full turnaround offered, a stale
//    drawing kept, a slot rename lost, a replaced drawing kept, no hold, no hysteresis margin.
//   node tools/rigger-spike/rig-2p5d-views.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const LIB = join(APP, 'src/lib');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, readIrig } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'rig-2p5d-views-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let built = 0;

/**
 * The modules as one bundle; `mutant` plants one change in one source file (its `find` must occur
 * exactly once, so a mutant can never go stale silently).
 */
async function modules(mutant) {
	const entry = join(dir, `entry${built}.ts`);
	const out = join(dir, `bundle${built++}.mjs`);
	const at = (f) => JSON.stringify(join(LIB, f).replace(/\\/g, '/'));
	writeFileSync(
		entry,
		[
			`export * as B from ${at('rig2p5d.ts')};`,
			`export * as S from ${at('rig3d.ts')};`,
			`export * as I from ${at('rig3dImport.ts')};`,
			`export * as V from ${at('rig3dViews.ts')};`,
			`export * as T from ${at('server/rigTemplates.ts')};`,
		].join('\n'),
	);
	const plugins = mutant
		? [
				{
					name: 'mutant',
					setup(build) {
						const file = join(LIB, mutant.file).replace(/\\/g, '/').toLowerCase();
						build.onLoad({ filter: /\.ts$/ }, (args) => {
							if (args.path.replace(/\\/g, '/').toLowerCase() !== file) return undefined;
							const src = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
							const n = src.split(mutant.find).length - 1;
							if (n !== 1) throw new Error(`mutant ${mutant.name}: found ${n}× in ${mutant.file}`);
							return { contents: src.replace(mutant.find, mutant.replace), loader: 'ts' };
						});
					},
				},
			]
		: [];
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'error',
		plugins,
	});
	return import(pathToFileURL(out).href);
}

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const R = Math.PI / 180;
/** A turn about the card's up by `deg` (+: its face toward the picture's right). */
const qy = (deg) => [Math.cos((deg * R) / 2), 0, Math.sin((deg * R) / 2), 0];
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
const clone = (v) => structuredClone(v);

/** A template's rig from art for every part but `skip`, and the atlas the art packs into. */
function rigFrom(M, tpl, skip = []) {
	const regions = tpl.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	let x = 0;
	let y = 0;
	for (const r of regions) {
		if (x + r.w > 8192) {
			x = 0;
			y += 512;
		}
		lines.push(r.name, `bounds:${x},${y},${r.w},${r.h}`);
		x += r.w;
	}
	return { irig: M.T.templateRig(tpl, regions).skeleton, atlas: `${lines.join('\n')}\n` };
}

/** engine-rig posing `irig` (read by the strict reader first), playing `anim` from 0. */
function poser(irig, atlas, anim) {
	const text = JSON.stringify(irig);
	readIrig(text);
	const a = new TextureAtlas(atlas);
	for (const p of a.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(a)).readSkeletonData(JSON.parse(text));
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	if (anim) state.setAnimation(0, anim, false);
	let now = 0;
	return (t = 0) => {
		skel.setToSetupPose();
		state.update(t - now);
		now = t;
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
const shown = (skel, slot) => skel.findSlot(slot).getAttachment()?.name ?? null;
/** How square a bone's world 2×2 is (σ2 / σ1) and whether it is mirrored. */
function squareOf(skel, bone) {
	const { a, b, c, d } = skel.findBone(bone);
	const s = a * a + b * b + c * c + d * d;
	const det = a * d - b * c;
	const disc = Math.sqrt(Math.max(0, s * s - 4 * det * det));
	return { square: Math.sqrt((s - disc) / 2) / Math.sqrt((s + disc) / 2), mirrored: det < 0 };
}
/** Every slot's drawn vertices (regions and meshes, weighted ones included). */
function verticesOf(skel) {
	const out = {};
	for (const s of skel.slots) {
		const a = s.getAttachment();
		if (!a) continue;
		const v = [];
		if (a.worldVerticesLength !== undefined)
			a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2);
		else if (a.computeWorldVertices) a.computeWorldVertices(s, v, 0, 2);
		out[s.data.name] = v;
	}
	return out;
}
const farthest = (p, q) => {
	let e = 0;
	let at = '';
	for (const [slot, v] of Object.entries(p))
		for (let i = 0; i < v.length; i++) {
			const d = Math.abs(v[i] - (q[slot]?.[i] ?? NaN));
			if (!(d <= e)) {
				e = Number.isNaN(d) ? Infinity : d;
				at = slot;
			}
		}
	return { e, at };
};

/** Orient keys holding each angle `hold` s, turning `move` s between: [keys, the holds' middles]. */
function holds(angles, hold = 0.3, move = 0.2) {
	const keys = [];
	const probes = [];
	let t = 0;
	for (const [i, deg] of angles.entries()) {
		if (i) t += move;
		keys.push({ time: +t.toFixed(4), value: qy(deg) });
		probes.push([+(t + hold / 2).toFixed(4), deg]);
		t += hold;
		keys.push({ time: +t.toFixed(4), value: qy(deg) });
	}
	return { keys, probes, duration: t };
}

/** Make the rig 3D as 🧊 Make 3D does, key `bones` in clip `turn`, bake it as the page does. */
function bake3d(M, rig, tpl, bones, { turnaround, made, views } = {}) {
	const irig = clone(made ? made.irig : rig.irig);
	const doc = made ? clone(made.doc) : M.V.make3dFromTemplate('hero', irig, tpl.rig3d, turnaround);
	if (views) for (const [slot, v] of Object.entries(views)) Object.assign(doc.views[slot], v);
	doc.clips = { turn: { bones } };
	const out = M.I.rebakeClip3d({ irig, doc, clip: 'turn' });
	return { ...out, made: irig, play: poser(out.irig, rig.atlas, 'turn') };
}

const failsOf = (list) => list.filter(Boolean);
/** What a check measured, printed on the gate's own run (not the mutants'). */
let INFO = true;
const info = (line) => INFO && console.log(`  ${line}`);
const want = (cond, label) => (cond ? null : label);

// ── The checks: each answers the failures it finds (the planted mutants must make one fail) ─────────

const CHECKS = {
	/** A torso turned to each angle shows the drawing made for it, square; past the side, per turnaround. */
	angles(M) {
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const out = [];
		for (const [turnaround, extra, after] of [
			['side', [135, 180], { 135: ['torso_3q_l', true], 180: ['torso', true] }],
			['full', [135, 180, -135], { 135: ['torso_3q_back_r', false], 180: ['torso_back', false] }],
		]) {
			const seq = [0, 45, 90, ...extra.filter((a) => a > 0), 90, 45, 0, -45, -90];
			if (turnaround === 'full') seq.push(-135);
			const h = holds(seq);
			const b = bake3d(M, rig, tpl, { torso_image: { orient: h.keys } }, { turnaround });
			const expect = {
				0: ['torso', false],
				45: ['torso_3q_r', false],
				90: ['torso_side_r', false],
				'-45': ['torso_3q_l', false],
				'-90': ['torso_side_l', false],
				'-135': ['torso_3q_back_l', false],
				...after,
			};
			for (const [t, deg] of h.probes) {
				const skel = b.play(t);
				const [name, mirrored] = expect[deg];
				const sq = squareOf(skel, 'torso_image');
				out.push(
					want(
						shown(skel, 'torso') === name && sq.mirrored === mirrored && sq.square > 0.98,
						`[${turnaround}] at ${deg}° engine-rig shows ${shown(skel, 'torso')} (square ${sq.square.toFixed(3)}, ${sq.mirrored ? '' : 'un'}mirrored), want ${name}`,
					),
				);
			}
		}
		// The head: its outline (a leaf under the head, unkeyed) shows its ¾ drawing as the head turns.
		const h = holds([0, 45, -45]);
		const b = bake3d(M, rig, tpl, { head: { orient: h.keys } });
		for (const [t, deg] of h.probes) {
			const name = { 0: 'head', 45: 'head_3q_r', '-45': 'head_3q_l' }[deg];
			out.push(
				want(
					shown(b.play(t), 'head') === name,
					`head at ${deg}°: shows ${shown(b.play(t), 'head')}`,
				),
			);
		}
		return failsOf(out);
	},

	/** A missing drawing falls back toward the front one. */
	fallback(M) {
		const tpl = M.T.HALF_BODY;
		const out = [];
		const no3q = rigFrom(M, tpl, ['torso_3q_r', 'torso_3q_l']);
		const h = holds([0, 30, 50, 60, 75, 90]);
		const b = bake3d(M, no3q, tpl, { torso_image: { orient: h.keys } });
		const at = {
			0: 'torso',
			30: 'torso',
			50: 'torso',
			60: 'torso',
			75: 'torso_side_r',
			90: 'torso_side_r',
		};
		for (const [t, deg] of h.probes) {
			const skel = b.play(t);
			out.push(
				want(
					shown(skel, 'torso') === at[deg],
					`no ¾ art, ${deg}°: shows ${shown(skel, 'torso')}, want ${at[deg]}`,
				),
			);
			if (deg === 50)
				out.push(
					want(
						Math.abs(squareOf(skel, 'torso_image').square - Math.cos(50 * R)) < 0.02,
						`no ¾ art, 50°: the front turns as a card (σ ratio ${squareOf(skel, 'torso_image').square.toFixed(3)})`,
					),
				);
		}
		const noSide = rigFrom(M, tpl, ['torso_side_r', 'torso_side_l']);
		const h2 = holds([0, 45, 90, 110]);
		const b2 = bake3d(M, noSide, tpl, { torso_image: { orient: h2.keys } });
		for (const [t, deg] of h2.probes) {
			const name = deg ? 'torso_3q_r' : 'torso';
			out.push(
				want(
					shown(b2.play(t), 'torso') === name,
					`no side art, ${deg}°: shows ${shown(b2.play(t), 'torso')}`,
				),
			);
		}
		const doc = M.V.make3dFromTemplate('hero', clone(no3q.irig), tpl.rig3d);
		const row = M.V.viewRows(doc, 'torso').find((r) => r.angle === -45);
		out.push(
			want(
				row && !row.drawing && row.shown.join() === 'torso',
				`the ¾ right row: ${JSON.stringify(row)}`,
			),
		);
		return failsOf(out);
	},

	/** Hold and hysteresis: a jitter at a boundary never swaps; a swing swaps no sooner than the hold. */
	timing(M) {
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const out = [];
		const wave = (mid, amp, hz, secs = 2) => {
			const keys = [];
			for (let i = 0; i <= secs * 120; i++) {
				const t = i / 120;
				keys.push({ time: +t.toFixed(5), value: qy(mid + amp * Math.sin(2 * Math.PI * hz * t)) });
			}
			return keys;
		};
		const swapsOf = (b) => {
			const keys = b.irig.animations.turn.slots?.torso?.attachment ?? [];
			return keys.map((k) => k.time ?? 0);
		};
		const jitter = bake3d(M, rig, tpl, { torso_image: { orient: wave(22.5, 2, 6) } });
		out.push(
			want(
				swapsOf(jitter).length <= 1,
				`±2° at the ¾ boundary: ${swapsOf(jitter).length} attachment keys`,
			),
		);
		const loose = bake3d(
			M,
			rig,
			tpl,
			{ torso_image: { orient: wave(22.5, 2, 6) } },
			{
				views: { torso: { margin: 0, hold: 0 } },
			},
		);
		out.push(
			want(
				swapsOf(loose).length > 10,
				`with margin and hold 0 the jitter swaps ${swapsOf(loose).length}×`,
			),
		);
		const swing = bake3d(M, rig, tpl, { torso_image: { orient: wave(22.5, 12, 8) } });
		const times = swapsOf(swing);
		info(
			`swaps: ±2° jitter ${swapsOf(jitter).length - 1}, the same with margin and hold 0 ${swapsOf(loose).length - 1}, a ±12° swing ${times.length - 1} (the shortest gap ${Math.min(...times.slice(1).map((t, i) => t - times[i])).toFixed(3)} s)`,
		);
		const gaps = times.slice(1).map((t, i) => t - times[i]);
		out.push(
			want(
				times.length > 4 && gaps.every((g) => g >= 0.1 - 1e-6),
				`±12° swing: swaps at ${times.map((t) => t.toFixed(3)).join(' ')}`,
			),
		);
		// engine-rig shows what the bake chose, on every frame of the swing.
		for (let t = 0; t <= 2; t += 1 / 240) {
			let name = null;
			for (const d of swing.bake.drawings.torso) if (d.time <= t + 1e-9) name = d.attachment;
			if (shown(swing.play(t), 'torso') !== name) {
				out.push(
					`t=${t.toFixed(4)}: engine-rig shows ${shown(swing.play(t), 'torso')}, the bake chose ${name}`,
				);
				break;
			}
		}
		return failsOf(out);
	},

	/** Image bones: made where a slot's bone carries more, drawing exactly as before. */
	imageBones(M) {
		const out = [];
		const made = {};
		for (const tpl of [M.T.HALF_BODY, M.T.FULL_BODY, M.T.BUST_FACE]) {
			const rig = rigFrom(M, tpl);
			const irig = clone(rig.irig);
			const before = new Set(irig.bones.map((b) => b.name));
			const doc = M.V.make3dFromTemplate('hero', irig, tpl.rig3d);
			made[tpl.id] = irig.bones
				.filter((b) => !before.has(b.name))
				.map((b) => `${b.name}<${b.parent}`);
			out.push(
				want(
					!M.S.rig3dDocProblems(doc).length && !M.S.rig3dIrigProblems(doc, irig).length,
					`${tpl.id}: the 3D data fits`,
				),
			);
			out.push(
				want(
					irig.bones
						.slice(0, rig.irig.bones.length)
						.every((b, i) => b.name === rig.irig.bones[i].name),
					`${tpl.id}: image bones appended after every other bone`,
				),
			);
			// At setup, and in a 2D clip turning an arm and a hand, every slot draws exactly as before.
			const anim = {
				bones: Object.fromEntries(
					['lower_arm_l', 'hand_l', 'chest']
						.filter((n) => before.has(n))
						.map((n, i) => [n, { rotate: [{ value: 0 }, { time: 1, value: 25 + 10 * i }] }]),
				),
			};
			const a = clone(rig.irig);
			const b = clone(irig);
			a.animations = { wave: anim };
			b.animations = { wave: clone(anim) };
			for (const t of [0, 0.6]) {
				const d = farthest(
					verticesOf(poser(a, rig.atlas, 'wave')(t)),
					verticesOf(poser(b, rig.atlas, 'wave')(t)),
				);
				out.push(
					want(
						d.e < 1e-3,
						`${tpl.id} at ${t}s: ${d.at} drawn ${d.e.toFixed(4)} off after the image bones`,
					),
				);
			}
		}
		out.push(
			want(
				made['half-body'].join() === 'hand_l_image<hand_l,hand_r_image<hand_r' &&
					made['full-body'].length === 0 &&
					made['bust-face'].join() === 'body_image<chest',
				`image bones made: ${JSON.stringify(made)}`,
			),
		);
		// The hand's drawings show as the hand turns about the arm.
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const h = holds([0, 45, 90, -45]);
		const b = bake3d(M, rig, tpl, { hand_l: { orient: h.keys } });
		for (const [t, deg] of h.probes) {
			const name = { 0: 'hand_l', 45: 'hand_l_3q_r', 90: 'hand_l_side_r', '-45': 'hand_l_3q_l' }[
				deg
			];
			out.push(
				want(
					shown(b.play(t), 'hand_l') === name,
					`hand at ${deg}°: shows ${shown(b.play(t), 'hand_l')}`,
				),
			);
		}
		return failsOf(out);
	},

	/** A slot left on a bone that carries more is refused (its drawings' turn would turn them too). */
	refusal(M) {
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const irig = clone(rig.irig);
		const doc = M.I.rig3dFromTemplate('hero', irig, tpl.rig3d, { carrying: true });
		const problems = M.B.rig2p5dProblems(M.S.rigOf(irig, doc), {
			name: 'x',
			duration: 1,
			bones: {},
		});
		return failsOf([
			want(
				problems.some(
					(p) => p.includes('slot hand_l') && p.includes('thumb_1_l') && p.includes('image bone'),
				),
				`the hand on its own bone: ${problems.join('; ') || 'not refused'}`,
			),
		]);
	},

	/** A follower: on the hand at setup, cheaper through edge-on, still in 2D clips. */
	follower(M) {
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const out = [];
		const build = (hang) => {
			const irig = clone(rig.irig);
			const doc = M.I.rig3dFromTemplate('hero', irig, tpl.rig3d, { carrying: true });
			M.V.addImageBone(irig, doc, 'hand_l', hang);
			M.V.addImageBone(irig, doc, 'hand_r');
			return { irig, doc };
		};
		const child = build();
		const follow = build('chest');
		out.push(
			want(
				follow.doc.bones?.hand_l_image?.follow === 'hand_l',
				`follow: ${JSON.stringify(follow.doc.bones?.hand_l_image)}`,
			),
		);
		const setup = poser(follow.irig, rig.atlas)();
		const [h, i] = [setup.findBone('hand_l'), setup.findBone('hand_l_image')];
		out.push(
			want(
				Math.hypot(
					h.worldX - i.worldX,
					h.worldY - i.worldY,
					h.a - i.a,
					h.b - i.b,
					h.c - i.c,
					h.d - i.d,
				) < 1e-3,
				`the follower at setup: (${i.worldX.toFixed(2)}, ${i.worldY.toFixed(2)}) vs the hand (${h.worldX.toFixed(2)}, ${h.worldY.toFixed(2)})`,
			),
		);
		// The hand turns through edge-on (90°) and on, and back.
		const hk = holds([0, 45, 90, 100, 90, 45, 0], 0.2, 0.25);
		const keysOf = (b) =>
			Object.values(b.irig.animations.turn.bones.hand_l_image ?? {}).reduce(
				(n, k) => n + k.length,
				0,
			);
		const bc = bake3d(M, rig, tpl, { hand_l: { orient: hk.keys } }, { made: child });
		const bf = bake3d(M, rig, tpl, { hand_l: { orient: hk.keys } }, { made: follow });
		const [kc, kf] = [keysOf(bc), keysOf(bf)];
		info(
			`the hand turning through edge-on: its image bone ${kf} timeline keys following from the chest, ${kc} under the hand`,
		);
		out.push(
			want(
				kf < kc * 0.8,
				`the image bone's keys through edge-on: ${kf} following from the chest vs ${kc} under the hand`,
			),
		);
		for (const [t, deg] of hk.probes) {
			const name = { 0: 'hand_l', 45: 'hand_l_3q_r', 90: 'hand_l_side_r', 100: 'hand_l_side_r' }[
				deg
			];
			for (const [label, b] of [
				['under the hand', bc],
				['following', bf],
			]) {
				const skel = b.play(t);
				out.push(
					want(
						shown(skel, 'hand_l') === name,
						`${label} at ${deg}°: shows ${shown(skel, 'hand_l')}`,
					),
				);
				if (deg === 90)
					out.push(
						want(
							squareOf(skel, 'hand_l_image').square > 0.98,
							`${label} at 90°: the side drawing square`,
						),
					);
			}
		}
		// A 2D clip moving the arm: the follower stays where the setup has it (3D clips only).
		const arm = { bones: { lower_arm_l: { rotate: [{ value: 0 }, { time: 1, value: 40 }] } } };
		const moved = clone(follow.irig);
		moved.animations = { arm };
		const p = poser(moved, rig.atlas, 'arm')(1);
		out.push(
			want(
				Math.hypot(
					p.findBone('hand_l_image').worldX - i.worldX,
					p.findBone('hand_l_image').worldY - i.worldY,
				) < 1e-3 &&
					Math.hypot(
						p.findBone('hand_l').worldX - h.worldX,
						p.findBone('hand_l').worldY - h.worldY,
					) > 10,
				'in a 2D clip the follower stays put while the hand moves',
			),
		);
		return failsOf(out);
	},

	/** The templates' turnarounds, and what a side or full turnaround keeps of their views. */
	turnarounds(M) {
		const out = [];
		const tpl = M.T.HALF_BODY;
		const back = tpl.parts
			.filter(
				(p) =>
					/_3q_back_[lr]$/.test(p.name) ||
					['torso_back', 'head_back', 'hand_l_back', 'hand_r_back'].includes(p.name),
			)
			.map((p) => p.name);
		const all = rigFrom(M, tpl);
		const front = rigFrom(M, tpl, back);
		out.push(
			want(
				M.V.templateTurnarounds(all.irig, tpl.rig3d).join() === 'side,full',
				'full offered on art with back drawings',
			),
		);
		out.push(
			want(
				M.V.templateTurnarounds(front.irig, tpl.rig3d).join() === 'side',
				'only side offered on art without',
			),
		);
		const side = M.V.make3dFromTemplate('hero', clone(all.irig), tpl.rig3d, 'side');
		const full = M.V.make3dFromTemplate('hero', clone(all.irig), tpl.rig3d, 'full');
		out.push(
			want(
				Object.values(side.views).every((v) => v.drawings.every((d) => Math.abs(d.turn) <= 90)),
				'side keeps no back drawing',
			),
		);
		out.push(
			want(
				full.views.torso.drawings.length === 8 && full.turnaround === 'full',
				`full keeps the torso's 8: ${full.views.torso.drawings.length}`,
			),
		);
		// Full, on art whose hands have no back drawings: the hands keep no views (turn as cards).
		const noHandBack = rigFrom(
			M,
			tpl,
			back.filter((n) => n.startsWith('hand_')),
		);
		const irig = clone(noHandBack.irig);
		const doc = M.V.make3dFromTemplate('hero', irig, tpl.rig3d, 'full');
		out.push(
			want(
				!doc.views.hand_l && doc.views.torso,
				`full without hand backs: ${Object.keys(doc.views)}`,
			),
		);
		const problems = M.B.rig2p5dProblems(M.S.rigOf(irig, doc), {
			name: 'x',
			duration: 1,
			bones: {},
		});
		out.push(want(!problems.length, `…and it bakes: ${problems.join('; ')}`));
		// With no 3D data, an import's own start (`rig3dFromTemplate`) keeps no views it would refuse.
		const plain = M.I.rig3dFromTemplate('hero', clone(all.irig), tpl.rig3d);
		const p2 = M.B.rig2p5dProblems(M.S.rigOf(all.irig, plain), {
			name: 'x',
			duration: 1,
			bones: {},
		});
		out.push(
			want(
				!plain.views.hand_l && !p2.length,
				`an import's start: ${p2.join('; ') || Object.keys(plain.views)}`,
			),
		);
		for (const t of [M.T.HALF_BODY, M.T.FULL_BODY, M.T.BUST_FACE])
			out.push(want(M.T.rigTemplateProblem(t) === null, `${t.id}: ${M.T.rigTemplateProblem(t)}`));
		return failsOf(out);
	},

	/** The 3D import's square head outline takes the head's turn once the head has drawings. */
	headImport(M) {
		const tpl = M.T.HALF_BODY;
		const entries = tpl.motion.bones3d;
		const has = (m) => m.entries.some((e) => e.bone === 'head_image');
		const all = rigFrom(M, tpl);
		const noHead = rigFrom(
			M,
			tpl,
			tpl.parts.filter((p) => p.name.startsWith('head_')).map((p) => p.name),
		);
		const d1 = M.V.make3dFromTemplate('hero', clone(all.irig), tpl.rig3d);
		const d2 = M.V.make3dFromTemplate('hero', clone(noHead.irig), tpl.rig3d);
		return failsOf([
			want(
				!has(M.V.motion3dFor(entries, all.irig, d1)),
				'with head drawings the outline is not kept square',
			),
			want(has(M.V.motion3dFor(entries, noHead.irig, d2)), 'without them it is'),
			want(has(entries), 'the template itself is unchanged'),
		]);
	},

	/** The views panel's data, and the 3D data kept in step with renames and deletes. */
	panel(M) {
		const out = [];
		const tpl = M.T.HALF_BODY;
		const rig = rigFrom(M, tpl);
		const irig = clone(rig.irig);
		const doc = M.V.make3dFromTemplate('hero', irig, tpl.rig3d);
		M.V.setViewDrawing(doc, 'torso', -45, 'torso_side_r');
		out.push(
			want(
				doc.views.torso.drawings.filter((d) => d.turn === -45).length === 1,
				'a replaced drawing is not kept twice',
			),
		);
		M.V.setViewDrawing(doc, 'torso', -45, null);
		const row = M.V.viewRows(doc, 'torso').find((r) => r.angle === -45);
		out.push(
			want(
				!row.drawing && row.shown.join() === 'torso',
				`a cleared angle falls back: ${JSON.stringify(row)}`,
			),
		);
		M.V.setViewTiming(doc, 'torso', 'hold', 0.25);
		out.push(want(doc.views.torso.hold === 0.25, 'the hold is set'));
		// A deleted attachment, a renamed slot, a deleted followed bone.
		delete irig.skins[0].attachments.torso.torso_side_l;
		M.V.fit3dToRig(doc, irig);
		out.push(
			want(
				!doc.views.torso.drawings.some((d) => d.attachment === 'torso_side_l'),
				'a deleted drawing leaves the views',
			),
		);
		M.V.rename3d(doc, 'slot', 'torso', 'body');
		out.push(want(doc.views.body && !doc.views.torso, 'a renamed slot keeps its views'));
		M.V.addImageBone(irig, doc, 'head', 'neck');
		irig.bones = irig.bones.filter((b) => b.name !== 'head_image');
		const followed = irig.slots.find((s) => s.name === 'head').bone;
		out.push(
			want(
				doc.bones[followed]?.follow === 'head_image',
				'the head outline follows its old image bone',
			),
		);
		M.V.fit3dToRig(doc, irig);
		out.push(want(!doc.bones[followed]?.follow, 'a deleted followed bone leaves no follow'));
		return failsOf(out);
	},
};

// ── Run them, then the planted mutants ──────────────────────────────────────────────────────────

const ONLY = process.argv
	.find((a) => a.startsWith('--only='))
	?.slice(7)
	.split(',');
const M0 = await modules();
const t0 = Date.now();
for (const [name, check] of Object.entries(CHECKS)) {
	if (ONLY && !ONLY.includes(name)) continue;
	let found;
	const at = Date.now();
	try {
		found = check(M0);
	} catch (e) {
		found = [`threw: ${e.stack ?? e}`];
	}
	ok(
		`[${name}] ${found.length ? found.length + ' failure(s)' : 'passes'}`,
		!found.length,
		found.slice(0, 6).join('\n        '),
	);
	console.log(`  [${name}] ${Date.now() - at} ms`);
}
const checkMs = Date.now() - t0;

const MUTANTS = [
	{
		name: 'no fallback toward the front',
		check: 'fallback',
		file: 'rig2p5d.ts',
		find: 'if (!f.own) for (const d of f.shown) out.get(d)?.push(f.angle);',
		replace: '',
	},
	{
		name: 'no refusal of a drawing slot on a carrying bone',
		check: 'refusal',
		file: 'rig2p5d.ts',
		find: '\t\tif (carried.length)\n',
		replace: '\t\tif (false)\n',
	},
	{
		name: 'no hold',
		check: 'timing',
		file: 'rig2p5d.ts',
		find: 't - last.time >= hold',
		replace: 'true',
	},
	{
		name: 'no hysteresis margin',
		check: 'timing',
		file: 'rig2p5d.ts',
		find: 'nz(best) > nz(last.drawing) + margin',
		replace: 'nz(best) > nz(last.drawing)',
	},
	{
		name: 'back drawings kept on a side turnaround',
		check: 'turnarounds',
		file: 'rig3dImport.ts',
		find: "(turnaround === 'full' || Math.abs(d.turn) <= 90)",
		replace: 'true',
	},
	{
		name: 'a full turnaround keeps a slot without back art',
		check: 'turnarounds',
		file: 'rig3dImport.ts',
		find: "if (turnaround === 'full' && !kept.some((d) => Math.abs(d.turn) > 90)) continue;",
		replace: '',
	},
	{
		name: 'views kept on a carrying bone without an image bone',
		check: 'turnarounds',
		file: 'rig3dImport.ts',
		find: '(carrying || alone(slot))',
		replace: 'true',
	},
	{
		name: 'no image bones made',
		check: 'imageBones',
		file: 'rig3dViews.ts',
		find: 'if (slotCarries(irig, doc, slot).length) addImageBone(irig, doc, slot);',
		replace: '',
	},
	{
		name: "a follower placed at its parent's origin",
		check: 'follower',
		file: 'rig3dViews.ts',
		find: 'x: round(m.x), y: round(m.y) };',
		replace: 'x: 0, y: 0 };',
	},
	{
		name: 'an image bone inserted after its parent (weighted indices shift)',
		check: 'imageBones',
		file: 'rig3dViews.ts',
		find: 'bones.push({ name, parent: bone });',
		replace:
			'bones.splice(bones.findIndex((b) => b.name === bone) + 1, 0, { name, parent: bone });',
	},
	{
		name: 'no follower: hung under the hand whatever is asked',
		check: 'follower',
		file: 'rig3dViews.ts',
		find: 'if (hangFrom === undefined || hangFrom === bone) {',
		replace: 'if (true) {',
	},
	{
		name: 'the head outline kept square',
		check: 'headImport',
		file: 'rig3dViews.ts',
		find: 'entries: bones3d.entries.filter((e) => !(e.viewer && drawn.has(e.bone)))',
		replace: 'entries: bones3d.entries',
	},
	{
		name: 'no full turnaround offered',
		check: 'turnarounds',
		file: 'rig3dViews.ts',
		find: "return back ? ['side', 'full'] : ['side'];",
		replace: "return ['side'];",
	},
	{
		name: 'a deleted drawing kept',
		check: 'panel',
		file: 'rig3dViews.ts',
		find: 'view.drawings = view.drawings.filter((d) => has.get(slot)?.has(d.attachment));',
		replace: '',
	},
	{
		name: 'a slot rename lost',
		check: 'panel',
		file: 'rig3dViews.ts',
		find: '\t\tmove(doc.views);\n',
		replace: '\n',
	},
	{
		name: 'a replaced drawing kept',
		check: 'panel',
		file: 'rig3dViews.ts',
		find: '.filter((d) => d !== own)',
		replace: '.filter(() => true)',
	},
];
INFO = false;
for (const m of MUTANTS.filter((x) => !ONLY || ONLY.includes(x.check))) {
	const M = await modules(m);
	let found;
	try {
		found = CHECKS[m.check](M);
	} catch (e) {
		found = [`threw: ${String(e.message ?? e).split('\n')[0]}`];
	}
	ok(`mutant "${m.name}" is caught by [${m.check}]`, found.length > 0);
	console.log(
		`  mutant ${m.name}: [${m.check}] ${found.length ? found[0].split('\n')[0] : 'NOT CAUGHT'}`,
	);
}

console.log(`${checks - fails}/${checks} checks passed (the checks ran in ${checkMs} ms)`);
if (fails) process.exit(1);
