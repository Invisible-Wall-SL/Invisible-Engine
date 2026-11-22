// Foot plant for 2.5D rigs (rig-controls K3, docs/design/rig-controls.md §6.3), on the SHIPPED code:
// `rig3dIk.ts` (`footContacts3d`, `plantFeet3d`, on K4's switches), the real Full body template made
// 3D as 🧊 Make 3D makes it (its `leg_ik_<s>` limbs, the feet in world space), every clip baked as the
// page and the save bake it (`rebakeClip3d`) and played by the REAL engine-rig (SkeletonJson →
// Skeleton → AnimationState), as a game plays it. The clips are a motion import's shape — `orient`
// keys at 24 fps — of a performer stepping in place while the body sways (so a planted foot holds
// in the world under a moving root, not on it) and each FK stance foot slides. Asserted:
//  - contacts: each stance found within two frames of where it is, and only those — not a foot in
//    the air at the top of a jump (still, but not lowest), nor one skating along the ground (lowest,
//    not still), nor a tap shorter than a contact; on ground that rises through the clip (a walk
//    toward the camera) every stance still;
//  - planted, as the game plays the bake: each foot held where it landed through its contact while FK
//    slid it; no jump where it lands or lifts (the ankle and the knee where FK put them); outside the
//    contacts the pose is FK's; the mix 1 in each contact and 0 between; a foot still to the clip's
//    end stays planted (no switch out); the rest of the body unchanged;
//  - refused: a leg already switched to IK in the clip, a 2D clip; the input is never edited;
//  - planted mutants, each must be caught (a mutant whose text is gone fails the run).
//   node tools/rigger-spike/foot-plant.mjs
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
const { AnimationStateData, Physics } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'foot-plant-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let built = 0;

/** The modules as one bundle; `mutant` plants one change in one source file (found exactly once). */
async function modules(mutant) {
	const entry = join(dir, `entry${built}.ts`);
	const out = join(dir, `bundle${built++}.mjs`);
	const at = (f) => JSON.stringify(join(LIB, f).replace(/\\/g, '/'));
	writeFileSync(
		entry,
		[
			`export * as T from ${at('server/rigTemplates.ts')};`,
			`export * as I from ${at('rig3dImport.ts')};`,
			`export * as K from ${at('rig3dIk.ts')};`,
			`export * as W from ${at('rig3dViews.ts')};`,
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
let INFO = true;
const info = (line) => INFO && console.log(`  ${line}`);
const R = Math.PI / 180;
const FPS = 24;
/** A turn in the picture (about the viewer's axis) by `deg`. */
const qz = (deg) => [Math.cos((deg * R) / 2), 0, 0, Math.sin((deg * R) / 2)];
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const SIDES = ['l', 'r'];
const kOf = (s) => (s === 'l' ? 1 : -1);
/** The game's tolerance for "where FK put it" (units, the picture). */
const TOL = 0.5;

// ── The rig, the clips ──────────────────────────────────────────────────────────────────────────

function rigFor(M) {
	const t = M.T.rigTemplateById('full-body');
	const art = t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const fit = M.T.templateRig(t, art);
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of art) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	const irig = structuredClone(fit.skeleton);
	const doc = M.W.make3dFromTemplate('hero', irig, t.rig3d);
	const limbs = SIDES.map((s) => t.controls.limbs[`leg_${s}`]);
	return { t, irig, doc, limbs, atlas: `${lines.join('\n')}\n` };
}

/**
 * A clip of `secs` s keyed every frame: `lift(s, t)` (0 = down, 1 = knee up) bends each leg, `slide(s,
 * t)` turns a stance thigh a few degrees (the FK foot slides), the root keyed in 2D by `root(t)`.
 */
function clipOf(rig, name, secs, { lift, slide = () => 0, root = () => [0, 0] }) {
	const n = Math.round(secs * FPS);
	const bones = {};
	for (const s of SIDES) {
		const k = kOf(s);
		const th = [];
		const sh = [];
		for (let i = 0; i <= n; i++) {
			const t = r4(i / FPS);
			const u = lift(s, t);
			th.push({ time: t, value: qz(k * (28 * u + slide(s, t))) });
			sh.push({ time: t, value: qz(-k * 56 * u) });
		}
		bones[`thigh_${s}`] = { orient: th };
		bones[`shin_${s}`] = { orient: sh };
	}
	const translate = [];
	for (let i = 0; i <= n; i++) {
		const t = r4(i / FPS);
		const [x, y] = root(t);
		translate.push({ time: t, x: r4(x), y: r4(y) });
	}
	const irig = structuredClone(rig.irig);
	irig.animations = { [name]: { bones: { root: { translate } } } };
	const doc = structuredClone(rig.doc);
	doc.clips = { [name]: { bones, duration: secs } };
	return { irig, doc, clip: name, secs };
}

/** Stepping in place: leg l up over [0.1, 0.45) of each second, leg r over [0.6, 0.95). */
const stepLift = (s, t) => {
	const ph = t % 1;
	const a = s === 'l' ? 0.1 : 0.6;
	return ph >= a && ph < a + 0.35 ? Math.sin((Math.PI * (ph - a)) / 0.35) : 0;
};
/** Where each stance is, by the clip's construction: [from, to] of the down runs within [0, secs]. */
function stances(s, secs) {
	const out = [];
	let from = 0;
	for (let c = 0; c < secs; c++) {
		const a = c + (s === 'l' ? 0.1 : 0.6);
		if (a > from) out.push([from, Math.min(a, secs)]);
		from = a + 0.35;
	}
	if (from < secs) out.push([from, secs]);
	return out.filter(([a, b]) => b - a >= 0.15);
}

// ── Played as the game plays it ─────────────────────────────────────────────────────────────────

function player(M, rig, x) {
	const baked = M.I.rebakeClip3d({ irig: x.irig, doc: x.doc, clip: x.clip });
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(baked.irig)),
	);
	return (t) => {
		const skel = new Skeleton(data);
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, x.clip, false);
		state.update(t);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		const at = (n) => {
			const b = skel.findBone(n);
			return [b.worldX, b.worldY];
		};
		return { at, bones: skel.bones.map((b) => [b.data.name, b.worldX, b.worldY]) };
	};
}

const plant = (M, rig, x, extra = {}) =>
	M.K.plantFeet3d({ irig: x.irig, doc: x.doc, clip: x.clip, limbs: rig.limbs, ...extra });
const found = (M, rig, x, extra = {}) =>
	M.K.footContacts3d({ irig: x.irig, doc: x.doc, clip: x.clip, limbs: rig.limbs, ...extra });

/** The contacts against the clip's stances: each within `slack` s at both ends, and no other. */
function matches(contacts, want, slack = 2.01 / FPS) {
	if (contacts.length !== want.length) return false;
	return contacts.every(
		(c, i) => Math.abs(c.from - want[i][0]) <= slack && Math.abs(c.to - want[i][1]) <= slack,
	);
}
const fmt = (cs) => cs.map((c) => `${c.from.toFixed(3)}–${c.to.toFixed(3)}`).join(' ');

// ── The checks ──────────────────────────────────────────────────────────────────────────────────

const SWAY = (t) => [6 * Math.sin((2 * Math.PI * t) / 2), 0];
const SLIDE = (s, t) => (stepLift(s, t) ? 0 : 3 * Math.sin(2 * Math.PI * t));

const CHECKS = {
	contacts(M) {
		const out = [];
		const rig = rigFor(M);
		const x = clipOf(rig, 'step', 3, { lift: stepLift, slide: SLIDE, root: SWAY });
		const r = found(M, rig, x);
		if (r.error) return [r.error];
		for (const s of SIDES) {
			const got = r.contacts[`leg_ik_${s}`];
			const want = stances(s, 3);
			info(`step: leg ${s} contacts ${fmt(got)} (leg ${r.legs[`leg_ik_${s}`].toFixed(0)} units)`);
			if (!matches(got, want))
				out.push(
					`leg ${s}: contacts ${fmt(got)}, stances ${want.map((w) => w.join('–')).join(' ')}`,
				);
			if (!got.some((c) => c.slide > 2)) out.push(`leg ${s}: FK did not slide (vacuous)`);
		}
		// On ground rising through the clip (a walk toward the camera), every stance still.
		const up = clipOf(rig, 'rise', 3, { lift: stepLift, root: (t) => [0, 30 * t] });
		const ru = found(M, rig, up);
		for (const s of SIDES)
			if (!matches(ru.contacts[`leg_ik_${s}`], stances(s, 3)))
				out.push(`rising ground, leg ${s}: ${fmt(ru.contacts[`leg_ik_${s}`])}`);
		// A jump: both feet up together over [0.6, 1.6), hanging still at the top for 0.4 s.
		const jump = (s, t) =>
			t < 0.6 || t >= 1.6 ? 0 : t < 0.9 ? (t - 0.6) / 0.3 : t < 1.3 ? 1 : (1.6 - t) / 0.3;
		const j = found(
			M,
			rig,
			clipOf(rig, 'jump', 2, { lift: jump, root: (t) => [0, 90 * jump('l', t)] }),
		);
		for (const s of SIDES) {
			const cs = j.contacts[`leg_ik_${s}`];
			if (
				!matches(cs, [
					[0, 0.6],
					[1.6, 2],
				])
			)
				out.push(`jump, leg ${s}: ${fmt(cs)} (the top of the jump is no contact)`);
		}
		// Skating: the feet stay down while the body slides fast across the ground.
		const skate = found(
			M,
			rig,
			clipOf(rig, 'skate', 2, { lift: () => 0, root: (t) => [t < 1 ? 0 : 400 * (t - 1), 0] }),
		);
		for (const s of SIDES) {
			const cs = skate.contacts[`leg_ik_${s}`];
			if (!matches(cs, [[0, 1]], 3.01 / FPS)) out.push(`skating, leg ${s}: ${fmt(cs)}`);
		}
		// Standing on one leg: leg l raised a little and held still for 0.6 s, above the other foot.
		const stork = (s, t) =>
			s === 'l' && t >= 0.4 && t < 1.2 ? Math.min(1, (t - 0.4) / 0.1, (1.2 - t) / 0.1) * 1.0 : 0;
		const st = found(M, rig, clipOf(rig, 'stork', 1.6, { lift: stork }));
		const sl = st.contacts.leg_ik_l;
		info(`one leg raised: leg l contacts ${fmt(sl)}`);
		if (
			!matches(sl, [
				[0, 0.4],
				[1.2, 1.6],
			])
		)
			out.push(`one leg raised, leg l: ${fmt(sl)}`);
		// A tap: leg l down for 0.08 s between two lifts.
		const tap = (s, t) =>
			s !== 'l' ? 0 : t >= 0.4 && t < 0.9 ? Math.abs(Math.sin(Math.PI * ((t - 0.4) / 0.25))) : 0;
		const tp = found(M, rig, clipOf(rig, 'tap', 1.5, { lift: tap }));
		const tl = tp.contacts.leg_ik_l;
		if (
			!matches(tl, [
				[0, 0.4],
				[0.9, 1.5],
			])
		)
			out.push(`a tap, leg l: ${fmt(tl)}`);
		return out;
	},

	planted(M) {
		const out = [];
		const rig = rigFor(M);
		const x = clipOf(rig, 'step', 3, { lift: stepLift, slide: SLIDE, root: SWAY });
		const before = JSON.stringify(x.doc);
		const r = plant(M, rig, x);
		if (r.error) return [r.error];
		if (JSON.stringify(x.doc) !== before) out.push('the input sidecar was edited');
		const fk = player(M, rig, x);
		const ik = player(M, rig, { ...x, doc: r.doc });
		let held = 0;
		let slid = 0;
		let jump = 0;
		let away = 0;
		let body = 0;
		const dt = 1 / 120;
		const inside = (cs, t) => cs.some((c) => t >= c.from - 1e-4 && t <= c.to + 1e-4);
		const REL = M.K.FOOT_PLANT.release;
		const near = (cs, t) => cs.some((c) => t >= c.to && t <= c.to + REL + 1e-3);
		let pop = 0;
		let swing = 0;
		for (const s of SIDES) {
			const cs = r.contacts[`leg_ik_${s}`];
			const foot = `foot_${s}`;
			for (const c of cs) {
				const a0 = ik(c.from + 1e-4).at(foot);
				for (let t = c.from + 1e-4; t <= c.to; t += dt) {
					held = Math.max(held, apart(ik(t).at(foot), a0));
					slid = Math.max(slid, apart(fk(t).at(foot), fk(c.from + 1e-4).at(foot)));
				}
				// Landing: just before and at it, the pose is FK's; lifting: across it, no step.
				for (const n of [foot, `shin_${s}`]) {
					const land = Math.max(
						c.from > 0 ? apart(ik(c.from - 2e-3).at(n), fk(c.from - 2e-3).at(n)) : 0,
						apart(ik(c.from + 1e-4).at(n), fk(c.from + 1e-4).at(n)),
					);
					const lift =
						c.to < x.secs - 1e-3 ? apart(ik(c.to - 1e-4).at(n), ik(c.to + 2e-4).at(n)) : 0;
					if (land > jump || lift > jump)
						info(
							`  ${n} @ ${c.from}–${c.to}: landing ${land.toFixed(3)}, lifting ${lift.toFixed(3)}`,
						);
					jump = Math.max(jump, land, lift);
				}
			}
			// Letting go: the foot eases from where it was held back onto FK's, no faster than FK swings it
			// plus the slide spread over the release.
			for (const c of cs) {
				if (c.to >= x.secs - 1e-3) continue;
				for (let t = c.to; t < c.to + REL; t += dt) {
					const d =
						apart(ik(t + dt).at(foot), ik(t).at(foot)) - apart(fk(t + dt).at(foot), fk(t).at(foot));
					if (d > pop && process.env.DEBUG_PLANT)
						info(
							`    pop ${d.toFixed(2)} at ${t.toFixed(3)} (${c.to}) mix ${M.K.ik3dMixAt(r.doc, 'step', `leg_ik_${s}`, t).toFixed(2)}`,
						);
					pop = Math.max(pop, d);
					swing = Math.max(swing, apart(fk(t + dt).at(foot), fk(t).at(foot)));
				}
			}
			for (let t = 0; t <= x.secs; t += dt) {
				if (inside(cs, t) || near(cs, t)) continue;
				away = Math.max(away, apart(ik(t).at(foot), fk(t).at(foot)));
			}
			const mixes = r.doc.clips.step.ik?.[`leg_ik_${s}`] ?? [];
			const M3 = (t) => M.K.ik3dMixAt(r.doc, 'step', `leg_ik_${s}`, t);
			for (const c of cs) {
				if (M3(c.from + 1e-3) !== 1 || M3((c.from + c.to) / 2) !== 1)
					out.push(`leg ${s}: the mix is not 1 in ${c.from}–${c.to}`);
				if (c.to < x.secs - 1e-3 && M3(c.to + REL + 2e-3) !== 0)
					out.push(`leg ${s}: the mix is not 0 after ${c.to}`);
			}
			if (!mixes.length) out.push(`leg ${s}: no mix keys`);
		}
		for (let t = 0; t <= x.secs; t += 0.05) {
			const a = fk(t).bones;
			const b = ik(t).bones;
			for (let i = 0; i < a.length; i++)
				if (!/thigh|shin|foot|toe|_ik_|_pole_/.test(a[i][0]))
					body = Math.max(body, Math.hypot(a[i][1] - b[i][1], a[i][2] - b[i][2]));
		}
		info(
			`planted: feet held within ${held.toFixed(3)} (FK slid ${slid.toFixed(1)}); ${jump.toFixed(3)} across a landing or a lift; ${away.toFixed(4)} off FK between contacts; the body ${body.toExponential(1)}`,
		);
		if (!(held < TOL)) out.push(`a planted foot moved ${held}`);
		if (!(slid > 3)) out.push(`FK slid only ${slid} (vacuous)`);
		if (!(jump < TOL)) out.push(`a jump of ${jump} where a foot lands or lifts`);
		info(
			`letting go: the foot ${pop.toFixed(2)} faster than FK's swing (${swing.toFixed(2)}) in a 120th of a second`,
		);
		if (!(pop < (2 * 20 * dt) / REL))
			out.push(`the foot pops as it lifts (${pop} a 120th of a second over FK's)`);
		if (!(away < TOL)) out.push(`${away} off FK between contacts`);
		if (!(body < 1e-6)) out.push(`the body moved ${body}`);

		// A second import over the range plants it afresh (`replace`): the same contacts, the feet held.
		const re = plant(M, rig, { ...x, doc: r.doc }, { replace: true, t0: 0, t1: x.secs });
		if (re.error) out.push(`planted again over the import: ${re.error}`);
		else {
			for (const s of SIDES)
				if (fmt(re.contacts[`leg_ik_${s}`]) !== fmt(r.contacts[`leg_ik_${s}`]))
					out.push(`planted again, leg ${s}: ${fmt(re.contacts[`leg_ik_${s}`])}`);
			const again = player(M, rig, { ...x, doc: re.doc });
			let worst = 0;
			for (let t = 0; t <= x.secs; t += 0.05)
				worst = Math.max(worst, apart(again(t).at('foot_l'), ik(t).at('foot_l')));
			if (!(worst < TOL)) out.push(`planted again, the foot ${worst} off the first plant`);
		}
		// A foot still to the end stays planted: no switch out.
		const stand = clipOf(rig, 'stand', 1, { lift: () => 0, slide: (s, t) => 4 * t, root: SWAY });
		const rs = plant(M, rig, stand);
		if (rs.error) return [...out, rs.error];
		for (const s of SIDES) {
			const cs = rs.contacts[`leg_ik_${s}`];
			const m = rs.doc.clips.stand.ik[`leg_ik_${s}`];
			if (cs.length !== 1 || !m.every((k) => k.mix === 1))
				out.push(`standing, leg ${s}: ${fmt(cs)}, mixes ${m.map((k) => k.mix).join(',')}`);
		}
		const sp = player(M, rig, { ...stand, doc: rs.doc });
		const d = apart(sp(0).at('foot_l'), sp(1).at('foot_l'));
		if (!(d < TOL)) out.push(`standing, the foot moved ${d}`);
		return out;
	},

	refused(M) {
		const out = [];
		const rig = rigFor(M);
		const x = clipOf(rig, 'step', 2, { lift: stepLift });
		const on = M.K.switchLimb3d({ ...x, limb: rig.limbs[0], to: 'ik', t0: 0.5 });
		const again = plant(M, rig, { ...x, doc: on.doc });
		if (!/already switches to IK/.test(again.error ?? ''))
			out.push(`a leg in IK: ${JSON.stringify(again).slice(0, 120)}`);
		const flat = plant(M, rig, { ...x, clip: 'nope' });
		if (!/not a 3D clip/.test(flat.error ?? '')) out.push(`a 2D clip: ${flat.error}`);
		const none = M.K.plantFeet3d({ ...x, limbs: [] });
		if (!none.error) out.push('no legs is not refused');
		return out;
	},
};

// ── Run them, then the planted mutants ──────────────────────────────────────────────────────────

const M0 = await modules();
for (const [name, check] of Object.entries(CHECKS)) {
	let got;
	const at = Date.now();
	try {
		got = check(M0);
	} catch (e) {
		got = [`threw: ${e.stack ?? e}`];
	}
	ok(
		`[${name}] ${got.length ? got.length + ' failure(s)' : 'passes'}`,
		!got.length,
		got.slice(0, 6).join('\n        '),
	);
	console.log(`  [${name}] ${Date.now() - at} ms`);
}

const MUTANTS = [
	{
		name: 'still ignored',
		check: 'contacts',
		file: 'rig3dIk.ts',
		find: 'return speed < o.still * L && ',
		replace: 'return ',
	},
	{
		name: 'the other foot ignored',
		check: 'contacts',
		file: 'rig3dIk.ts',
		find: 'y - lowerNow[i] <= o.low * L && ',
		replace: '',
	},
	{
		name: 'the ground ignored',
		check: 'contacts',
		file: 'rig3dIk.ts',
		find: ' && y - floor[i] <= o.ground * L;',
		replace: ';',
	},
	{
		name: 'the ground taken over the whole clip',
		check: 'contacts',
		file: 'rig3dIk.ts',
		find: 'const win = Math.max(0, Math.round(o.window / dt));',
		replace: 'const win = n;',
	},
	{
		name: 'no shortest contact',
		check: 'contacts',
		file: 'rig3dIk.ts',
		find: 'if (times[j] - times[i] >= o.min - EPS) {',
		replace: 'if (true) {',
	},
	{
		name: 'the foot keyed where FK has it',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: "keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), c.at, t, false);",
		replace:
			"keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), m.wrist, t, false);",
	},
	{
		name: 'held on the root, not in the world',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: "keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), c.at, t, false);",
		replace:
			"keyPlace(edit, owned, carrier, fk.at(c.from).get(parentOf.get(carrier) ?? ''), c.at, t, false);",
	},
	{
		name: 'no switch out',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: 'if (rel > EPS) {',
		replace: 'if (false) {',
	},
	{
		name: 'let go at once',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: 'const rel = Math.min(release, ',
		replace: 'const rel = Math.min(1e-3, ',
	},
	{
		name: 'no matched landing',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: "const landed = switchLimb3d({ irig: x.irig, doc, clip: x.clip, limb, to: 'ik', t0: c.from });",
		replace:
			"const landed = switchLimb3d({ irig: x.irig, doc, clip: x.clip, limb, to: 'ik', t0: c.from + 0.1 });",
	},
	{
		name: 'an import does not plant afresh',
		check: 'planted',
		file: 'rig3dIk.ts',
		find: 'if (x.replace)\n',
		replace: 'if (false)\n',
	},
	{
		name: 'a switched leg planted over',
		check: 'refused',
		file: 'rig3dIk.ts',
		find: 'if ((x.doc.clips?.[x.clip]?.ik?.[l.ik] ?? []).some((k) => k.mix > 0))',
		replace: 'if (false)',
	},
];
const ONLY = process.argv.find((a) => a.startsWith('--mutant='))?.slice(9);
INFO = false;
let caught = 0;
for (const m of MUTANTS) {
	if (ONLY && m.name !== ONLY) continue;
	let got;
	try {
		got = CHECKS[m.check](await modules(m));
	} catch (e) {
		got = /mutant .*: found/.test(String(e.message)) ? null : [`threw: ${e.message}`];
		if (got === null) {
			ok(`mutant "${m.name}" has its text`, false, e.message);
			continue;
		}
	}
	ok(`mutant "${m.name}" is caught by [${m.check}]`, got.length > 0);
	if (got.length) caught++;
}
console.log(`  ${caught}/${MUTANTS.length} planted mutants caught`);
console.log(`\n${checks - fails}/${checks} foot-plant checks pass`);
process.exit(fails ? 1 : 0);
