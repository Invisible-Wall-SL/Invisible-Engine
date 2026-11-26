// 🗺 From my sheet — 🗺 Edit mapping and 🔄 Update rig (docs/design/frame-to-rig.md §13.1b), headless on
// the SHIPPED code: the rig 🦴 Create rig makes from the committed sheet fixture (`fixtures/sheet-rig/`,
// arranged as its preview draws it at rest), what an author then does to it, then its mapping edited
// and the rig updated by the shipped merge (`updateSheetRig`, as `/api/rigger/from-sheet/update` runs
// it: frame to rig's `frameRigUpdate`), posed by engine-rig as a game does.
//
// The author keys the left upper arm in a clip of their own (and the glasses' bone), adds a bone in
// the MIDDLE of the bone list (so every weighted vertex after it is renumbered) with a slot and an
// image of its own, and drags a vertex of the torso's mesh. The mapping: the neck re-mapped to another
// region, the left upper arm turned 25° on the arrange canvas, the glasses taken off, a badge worn on
// the torso. Asserted:
//  - kept: every bone of the rig (the user bone where the author put it), its slot and image, the
//    author's clip and keys;
//  - remapped: the neck draws its new region; every weighted vertex names the bone the build names
//    though their places moved; a part the mapping did not touch draws, in the frame, where it did;
//  - rearranged: in the frame the upper arm draws where the new arrangement puts it (as a new rig
//    made from it would), moved from where it was; a frame clip the page spelled with its defaults
//    filled in reads as the author's own only when its values changed;
//  - framekept: a frame clip the author keyed themselves stays, and the report says so;
//  - props: the badge has a bone and a slot drawn over the torso; the glasses' bone, slot, image and
//    the key on its bone are gone, and the report named that key first;
//  - handedit: the torso's mesh reads as edited (and only it), may be kept (it draws the region it
//    drew), is kept when asked and replaced when not;
//  - finite: the updated rig passes the `.irig` save check and every clip poses finite;
//  - layers: a reorder in Setup's slots stays through the update while the 🗺 Layers list is unchanged
//    (or opened from the rig's own order); a changed list orders the slots it lists, every other slot
//    and every draw-order key's drawing kept;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-rig-update.mjs [--only <guard>]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const SERVER = join(LIB, 'server');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);

const tmp = mkdtempSync(join(tmpdir(), 'sheet-rig-update-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let bundles = 0;
const SHIPPED = /[\\/](rigSheetUpdate|rigFrameUpdate|rigSheetFit|rigTemplates)\.ts$/;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first. */
async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetUpdate.ts';",
				"export * from './server/rigSheetFit.ts';",
				"export { sheetLayerList } from './rigSheetMap.ts';",
				"export * from './server/rigTemplates.ts';",
				"export { attachmentHash } from './server/rigFrameUpdate.ts';",
				"export { irigDocProblem } from './server/riggerIrig.ts';",
				"export { regionsToRigAtlas } from './server/rig.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-rig-update-entry.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'silent',
		plugins: [
			{
				name: 'stubs-and-mutants',
				setup(build) {
					build.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({
						path: 'env',
						namespace: 'stub',
					}));
					build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
						contents: 'export const env = {};',
						loader: 'js',
					}));
					// `rig.ts` reaches R2, sharp and the page store; what is read here uses none.
					build.onResolve({ filter: /.*/ }, (args) =>
						/[\\/]rig\.ts$/.test(args.importer) &&
						!args.path.startsWith('engine-') &&
						!/rigTemplates|rigSidecars|rigSheetMap|rig3d|rigControls/.test(args.path)
							? { path: args.path, namespace: 'rig-deps' }
							: undefined,
					);
					build.onLoad({ filter: /.*/, namespace: 'rig-deps' }, () => ({
						contents: 'module.exports = {};',
						loader: 'js',
					}));
					build.onLoad({ filter: SHIPPED }, (args) => {
						let text = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
						for (const [file, from, to] of mutate) {
							if (!args.path.replaceAll('\\', '/').endsWith(`/${file}`)) continue;
							if (!text.includes(from)) throw new Error(`mutant: "${from}" is not in ${file}`);
							text = text.replace(from, to);
						}
						return { contents: text, loader: 'ts' };
					});
				},
			},
		],
	});
	return import(pathToFileURL(out).href);
}

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- the sheet, its rig, the author's work and the edited mapping ------------------------------------
const SHEET = read(join(FIX, 'sheet.json'));
const TRUTH = read(join(FIX, 'truth.json'));
const REGIONS = SHEET.regions.map(({ name, w, h }) => ({ name, w, h }));
const regionOf = (name) => SHEET.regions.find((r) => r.name === name);
const slotOf = (M, part) => M.HALF_BODY.parts.find((p) => p.name === part)?.slot ?? part;
const boneOfSlot = (M, slot) => M.HALF_BODY.slots.find((s) => s.name === slot).bone;
/** How far the left upper arm is turned on the arrange canvas by the edit (degrees). */
const TURN = 25;
const USER_BONE = 'user_tail';
const USER_SLOT = 'user_patch';
/** A drawing at least this far from where it was has moved (rig units). */
const MOVED = 5;
/** Two drawings this close (rig units, the rig's offsets written to 1e-4) are the same. */
const SAME = 0.01;

/** The mapping the page sends for the sheet, arranged as its preview draws it at rest. */
function baseMapping(M) {
	const parts = {};
	for (const [part, t] of Object.entries(TRUTH.parts))
		parts[part] = { region: t.region, joints: t.joints, ...(t.face ? { face: t.face } : {}) };
	const m = {
		sheet: 1,
		manifestKey: 'fixture/manifests/atlas_manifest_Sheet.json',
		template: { id: M.HALF_BODY.id, version: M.HALF_BODY.version },
		parts,
		props: TRUTH.props.map((p) => ({
			name: p.part,
			region: p.region,
			host: p.host,
			bone: boneOfSlot(M, slotOf(M, p.host)),
			at: p.on,
		})),
	};
	const sp = M.sheetPreview(M.HALF_BODY, REGIONS, m);
	if (!sp.ok) throw new Error(sp.problem);
	const arrange = {};
	for (const a of sp.value.art) {
		if (!TRUTH.parts[a.name]) continue;
		const x = a.matrix;
		arrange[a.name] = {
			at: [
				Math.round((sp.value.origin[0] + x[4] / sp.value.scale) * 1e3) / 1e3,
				Math.round((sp.value.origin[1] - x[5] / sp.value.scale) * 1e3) / 1e3,
			],
			turn: Math.round(((-Math.atan2(x[2], x[0]) * 180) / Math.PI) * 1e4) / 1e4,
		};
	}
	return { ...m, arrange };
}

/** The mapping as the author edits it: the neck re-mapped, the upper arm turned, glasses off, a badge on. */
function editedMapping(M, base) {
	const m = clone(base);
	const glow = regionOf('bg_glow');
	m.parts.neck = {
		region: 'bg_glow',
		joints: { base: [glow.w / 2, glow.h * 0.85], top: [glow.w / 2, glow.h * 0.15] },
	};
	// Turned about its shoulder, as the page's ↻ turns a part about its first joint.
	const arm = m.arrange.upper_arm_l;
	const r = regionOf(m.parts.upper_arm_l.region);
	const [jx, jy] = m.parts.upper_arm_l.joints.shoulder;
	const q = [jx - r.w / 2, r.h / 2 - jy];
	const onCanvas = (turn) => {
		const t = (turn * Math.PI) / 180;
		return [Math.cos(t) * q[0] + Math.sin(t) * q[1], Math.sin(t) * q[0] - Math.cos(t) * q[1]];
	};
	const shoulder = onCanvas(arm.turn).map((v, i) => v + arm.at[i]);
	arm.turn += TURN;
	arm.at = onCanvas(arm.turn).map((v, i) => shoulder[i] - v);
	m.props = m.props.filter((p) => p.name !== 'prop_glasses');
	const torso = m.parts.torso;
	m.props.push({
		name: 'prop_badge',
		region: 'shadow_blob',
		host: 'torso',
		bone: boneOfSlot(M, 'torso'),
		at: [(torso.joints.shoulder_l[0] + torso.joints.hips[0]) / 2, torso.joints.hips[1] * 0.6],
	});
	return m;
}

/** What 🦴 Create rig makes of `mapping`: the `.irig` and the fit. */
function create(M, mapping) {
	const sr = M.sheetRig(M.HALF_BODY, REGIONS, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	return M.templateRig(M.HALF_BODY, REGIONS, sr.value.fit, sr.value.art).skeleton;
}

/** The author's work on the rig: a clip, a bone mid-list with a slot and image, a dragged torso vertex. */
function authored(doc) {
	const d = clone(doc);
	const at = d.bones.findIndex((b) => b.name === 'chest') + 1;
	d.bones.splice(at, 0, { name: USER_BONE, parent: 'chest', x: 12, y: -30, rotation: 15 });
	// Every weighted vertex after the new bone names its bone one place further on.
	for (const atts of Object.values(d.skins[0].attachments))
		for (const att of Object.values(atts)) {
			if (att.type !== 'mesh' || att.vertices.length === att.uvs.length) continue;
			for (let i = 0; i < att.vertices.length;) {
				const n = att.vertices[i++];
				for (let k = 0; k < n; k++, i += 4) if (att.vertices[i] >= at) att.vertices[i]++;
			}
		}
	d.slots.push({ name: USER_SLOT, bone: USER_BONE, attachment: USER_SLOT });
	d.skins[0].attachments[USER_SLOT] = {
		[USER_SLOT]: { path: 'gold_chain', width: 40, height: 30 },
	};
	d.animations.wave = {
		bones: {
			upper_arm_l: {
				rotate: [
					{ time: 0, value: 0 },
					{ time: 0.5, value: 30 },
				],
			},
			prop_glasses: { translate: [{ time: 0.25, x: 3, y: 1 }] },
		},
	};
	const torso = d.skins[0].attachments.torso.torso;
	const i = torso.vertices.indexOf(1) + 2;
	torso.vertices[i] = Math.round((torso.vertices[i] + 2.5) * 1e4) / 1e4;
	return d;
}

// ---- engine-rig ------------------------------------------------------------------------------------
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function loadData(M, doc) {
	const atlas = new RIG.TextureAtlas(
		M.regionsToRigAtlas('sheet.png', SHEET.width, SHEET.height, SHEET.regions),
	);
	for (const p of atlas.pages) p.setTexture(stub);
	return new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
}
/** `doc` posed at `time` of its clip `anim` (none: the setup). */
function posed(M, doc, anim = null, time = 0) {
	const data = loadData(M, doc);
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, anim, false);
		state.update(time);
		state.apply(skel);
	}
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}
/** A slot's drawing in the world: its vertices. */
function drawing(skel, slotName, attName) {
	const slot = skel.findSlot(slotName);
	const att = skel.getAttachmentByName(slotName, attName);
	if (att instanceof RIG.MeshAttachment) {
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return v;
	}
	if (att instanceof RIG.RegionAttachment) {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		return v;
	}
	return null;
}
const centre = (v) => {
	let [x, y] = [0, 0];
	for (let i = 0; i < v.length; i += 2) [x, y] = [x + v[i], y + v[i + 1]];
	return [(2 * x) / v.length, (2 * y) / v.length];
};
const farthest = (a, b) => {
	let d = 0;
	for (let i = 0; i < a.length; i += 2) d = Math.max(d, d2([a[i], a[i + 1]], [b[i], b[i + 1]]));
	return d;
};
/** The bones each weighted vertex of an attachment names, by name. */
function vertexBones(doc, att) {
	const names = doc.bones.map((b) => b.name);
	const out = [];
	if (att.type !== 'mesh' || att.vertices.length === att.uvs.length) return out;
	for (let i = 0; i < att.vertices.length;) {
		const n = att.vertices[i++];
		const one = [];
		for (let k = 0; k < n; k++, i += 4) one.push(names[att.vertices[i]]);
		out.push(one.join('+'));
	}
	return out;
}

/** The whole case: the rig made, the author's work, and the update. */
function updateCase(M, { keep = [], editFrame = false, spellDefaults = false } = {}) {
	const base = baseMapping(M);
	const edited = editedMapping(M, base);
	const made = create(M, base);
	const before = authored(made);
	if (editFrame) before.animations.frame.bones.chest = { rotate: [{ time: 0, value: 7 }] };
	// The frame clip as a store may spell it: a key's time and value left out where they are 0.
	if (spellDefaults)
		for (const tls of Object.values(before.animations.frame.bones))
			for (const k of tls.rotate ?? []) {
				if (k.time === 0) delete k.time;
				if (Math.abs(k.value) < 1e-3) delete k.value;
			}
	const res = M.updateSheetRig({
		template: M.HALF_BODY,
		regions: REGIONS,
		was: base,
		mapping: edited,
		current: before,
		keep: new Set(keep),
	});
	if (!res.ok) throw new Error(res.problem);
	return { base, edited, made, before, ...res.value };
}

const GUARDS = {
	/** Every bone (the user's where they put it), its slot and image, the author's clip and keys. */
	kept(M, log) {
		const { before, doc } = updateCase(M);
		let good = true;
		const gone = before.bones.filter(
			(b) => b.name !== 'prop_glasses' && !doc.bones.some((x) => x.name === b.name),
		);
		good =
			ok('kept: every bone of the rig', gone.length === 0, gone.map((b) => b.name).join()) && good;
		const ub = doc.bones.find((b) => b.name === USER_BONE);
		good =
			ok(
				'kept: the user bone where the author put it',
				ub?.parent === 'chest' && ub.x === 12 && ub.y === -30 && ub.rotation === 15,
				JSON.stringify(ub),
			) && good;
		good =
			ok(
				"kept: the author's slot and image",
				doc.slots.some((s) => s.name === USER_SLOT && s.bone === USER_BONE) &&
					doc.skins[0].attachments[USER_SLOT]?.[USER_SLOT]?.path === 'gold_chain',
			) && good;
		good =
			ok(
				"kept: the author's clip and its keys on the arm",
				JSON.stringify(doc.animations.wave.bones.upper_arm_l) ===
					JSON.stringify(before.animations.wave.bones.upper_arm_l),
				JSON.stringify(doc.animations.wave),
			) && good;
		log(`${doc.bones.length} bones (${before.bones.length} before), the user bone and clip kept`);
		return good;
	},

	/** The neck draws its new region; vertices name the build's bones by name; untouched parts stay. */
	remapped(M, log) {
		const { made, before, doc, edited } = updateCase(M);
		let good = true;
		good =
			ok(
				'remapped: the neck draws its new region',
				doc.skins[0].attachments.neck?.neck?.path === 'bg_glow',
				JSON.stringify(doc.skins[0].attachments.neck?.neck?.path),
			) && good;
		const fresh = create(M, edited);
		const named = Object.keys(fresh.skins[0].attachments).filter(
			(s) => s.startsWith('torso') || s.startsWith('head'),
		);
		for (const slot of named)
			for (const [name, att] of Object.entries(fresh.skins[0].attachments[slot])) {
				const got = doc.skins[0].attachments[slot]?.[name];
				if (!got || name === 'torso') continue;
				good =
					ok(
						`remapped: ${name}'s vertices name the bones the build names, by name`,
						JSON.stringify(vertexBones(doc, got)) === JSON.stringify(vertexBones(fresh, att)),
					) && good;
			}
		const [b, a] = [posed(M, made, 'frame'), posed(M, doc, 'frame')];
		const off = farthest(
			drawing(b, 'lower_arm_r', 'lower_arm_r'),
			drawing(a, 'lower_arm_r', 'lower_arm_r'),
		);
		good =
			ok('remapped: an untouched part draws in the frame where it did', off <= SAME, `${off}`) &&
			good;
		void before;
		log(
			`neck → ${doc.skins[0].attachments.neck.neck.path}; the right forearm moved ${off.toExponential(1)}`,
		);
		return good;
	},

	/** The re-arranged upper arm draws in the frame where a new rig of the edited mapping draws it. */
	rearranged(M, log) {
		let good = true;
		const c = updateCase(M);
		const fresh = create(M, c.edited);
		const [was, now, want] = [
			posed(M, c.made, 'frame'),
			posed(M, c.doc, 'frame'),
			posed(M, fresh, 'frame'),
		];
		const arm = (s) => drawing(s, 'upper_arm_l', 'upper_arm_l');
		const moved = d2(centre(arm(was)), centre(arm(now)));
		const off = farthest(arm(now), arm(want));
		good =
			ok(
				`rearranged: the upper arm turned ${TURN}° on the canvas moves in the frame, where a new rig draws it`,
				c.report.frame === 'replaced' && moved >= MOVED && off <= SAME,
				`frame ${c.report.frame}, moved ${moved.toFixed(2)}, off ${off}`,
			) && good;
		const spelled = updateCase(M, { spellDefaults: true });
		good =
			ok(
				'rearranged: a frame clip spelled without its defaults is not the author’s own',
				spelled.report.frame === 'replaced',
				spelled.report.frame,
			) && good;
		log(
			`frame ${c.report.frame}; the arm moved ${moved.toFixed(1)}, off a new rig by ${off.toExponential(1)}`,
		);
		return good;
	},

	/** A frame clip the author keyed themselves stays. */
	framekept(M, log) {
		const c = updateCase(M, { editFrame: true });
		const chest = c.doc.animations.frame?.bones?.chest?.rotate?.[0]?.value;
		log(`frame ${c.report.frame}, the author's chest key ${chest}`);
		return ok(
			'framekept: a frame clip the author keyed stays theirs, and the report says so',
			c.report.frame === 'kept' && chest === 7,
			`frame ${c.report.frame}, chest ${chest}`,
		);
	},

	/** The badge gets a bone and a slot over the torso; the glasses go with the key on their bone. */
	props(M, log) {
		const { doc, report } = updateCase(M);
		let good = true;
		const order = doc.slots.map((s) => s.name);
		good =
			ok(
				'props: the badge has a bone on the torso and a slot drawn over it',
				doc.bones.some((b) => b.name === 'prop_badge') &&
					order.indexOf('prop_badge') > order.indexOf('torso') &&
					report.added.includes('prop_badge'),
				order.join(' '),
			) && good;
		const glasses = report.removed.find((r) => r.name === 'prop_glasses');
		good =
			ok(
				'props: the glasses, their bone, slot, image and the key on their bone are gone, the key named first',
				!doc.bones.some((b) => b.name === 'prop_glasses') &&
					!order.includes('prop_glasses') &&
					!doc.animations.wave.bones.prop_glasses &&
					!!glasses?.references.some((r) => /wave/.test(r)),
				JSON.stringify(glasses),
			) && good;
		log(
			`added ${report.added.join(', ')}; removed ${report.removed.map((r) => r.name).join(', ')}`,
		);
		return good;
	},

	/** The torso's hand-edited mesh: read as edited (only it), may be kept, kept when asked, else replaced. */
	handedit(M, log) {
		let good = true;
		const asked = updateCase(M);
		const torso = asked.report.handEdited;
		good =
			ok(
				"handedit: only the torso's mesh reads as edited, and may be kept",
				torso.length === 1 && torso[0].part === 'torso' && torso[0].canKeep && !torso[0].kept,
				JSON.stringify(torso),
			) && good;
		const kept = updateCase(M, { keep: ['torso'] });
		good =
			ok(
				'handedit: kept when asked (the dragged vertex stays), replaced when not',
				JSON.stringify(kept.doc.skins[0].attachments.torso.torso.vertices) ===
					JSON.stringify(kept.before.skins[0].attachments.torso.torso.vertices) &&
					JSON.stringify(asked.doc.skins[0].attachments.torso.torso.vertices) !==
						JSON.stringify(asked.before.skins[0].attachments.torso.torso.vertices),
			) && good;
		log(`hand-edited: ${torso.map((h) => `${h.part} (may keep: ${h.canKeep})`).join(', ')}`);
		return good;
	},

	/** The updated rig passes the save check and every clip poses finite. */
	finite(M, log) {
		const { doc } = updateCase(M);
		let good = ok(
			'finite: the updated rig passes the .irig save check',
			M.irigDocProblem(doc) === null,
			`${M.irigDocProblem(doc)}`,
		);
		let bad = '';
		for (const anim of Object.keys(doc.animations))
			for (const t of [0, 0.25, 0.5]) {
				const s = posed(M, doc, anim, t);
				for (const slot of s.slots) {
					const a = slot.getAttachment();
					if (!a) continue;
					const v = drawing(s, slot.data.name, a.name);
					if (v && [...v].some((x) => !Number.isFinite(x)))
						bad ||= `${anim}@${t} ${slot.data.name}`;
				}
			}
		good = ok('finite: every clip poses finite', bad === '', bad) && good;
		log(`${Object.keys(doc.animations).length} clips posed finite`);
		return good;
	},

	/**
	 * 🗺 Layers: a reorder in Setup's slots stays through 🔄 Update rig while the Layers list is
	 * unchanged, or opened from the rig's own order as 🗺 Edit mapping opens it; a changed list orders
	 * the slots it lists, every other slot and every draw-order key's drawing kept.
	 */
	layers(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const base = baseMapping(M);
		const made = create(M, base);
		const drawn = new Set(
			M.sheetLayerList(
				t.slots.map((s) => s.name),
				(p) => slotOf(M, p),
				base,
			),
		);
		// The author's reorder in Setup's slots: the watch under its forearm; and a clip of theirs with
		// a draw-order key drawing the left hand in front of everything.
		const before = clone(made);
		const watch = before.slots.splice(
			before.slots.findIndex((s) => s.name === 'prop_wrist_r'),
			1,
		)[0];
		before.slots.splice(
			before.slots.findIndex((s) => s.name === 'lower_arm_r'),
			0,
			watch,
		);
		const hand = before.slots.findIndex((s) => s.name === 'hand_l');
		before.animations.layered = {
			drawOrder: [
				{ time: 0.5, offsets: [{ slot: 'hand_l', offset: before.slots.length - 1 - hand }] },
			],
		};
		const setup = (doc) => doc.slots.map((s) => s.name);
		const keyed = (doc) =>
			posed(M, doc, 'layered', 0.6)
				.drawOrder.map((s) => s.data.name)
				.join();
		const update = (mapping) => {
			const r = M.updateSheetRig({
				template: t,
				regions: REGIONS,
				was: base,
				mapping,
				current: before,
			});
			if (!r.ok) throw new Error(r.problem);
			return r.value;
		};
		const same = update(clone(base));
		good =
			ok(
				'layers: a Setup reorder kept through 🔄 Update rig while the Layers list is unchanged',
				setup(same.doc).join() === setup(before).join() && same.report.layered.length === 0,
				setup(same.doc).join(' '),
			) && good;
		const fromRig = setup(before)
			.filter((n) => drawn.has(n))
			.reverse();
		const opened = update({ ...clone(base), layers: fromRig });
		good =
			ok(
				"layers: the list opened from the rig's own order keeps it",
				setup(opened.doc).join() === setup(before).join(),
				setup(opened.doc).join(' '),
			) && good;
		const own = [...fromRig];
		own.splice(own.indexOf('prop_chain'), 1);
		own.splice(own.indexOf('torso') + 1, 0, 'prop_chain');
		const changed = update({ ...clone(base), layers: own });
		const after = setup(changed.doc);
		good =
			ok(
				'layers: a changed list orders the slots it lists (the chain behind the torso)',
				after
					.filter((n) => drawn.has(n))
					.reverse()
					.join() === own.join() && changed.report.layered.includes('prop_chain'),
				after.join(' '),
			) && good;
		const others = (list) =>
			JSON.stringify(list.map((n, i) => [n, i]).filter(([n]) => !drawn.has(n)));
		good =
			ok(
				'layers: every slot it does not list keeps its place',
				others(after) === others(setup(before)),
			) && good;
		good =
			ok(
				"layers: the author's draw-order key still draws what it drew",
				keyed(changed.doc) === keyed(before) && keyed(before) !== setup(before).join(),
				`${keyed(changed.doc)}\n        ${keyed(before)}`,
			) && good;
		log(`${drawn.size} layers; the chain moved behind the torso, the key's drawing kept`);
		return good;
	},
};

const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
const M0 = await load();
for (const [id, guard] of Object.entries(GUARDS)) {
	if (ONLY && id !== ONLY) continue;
	console.log(`\n=== ${id}`);
	guard(M0, (line) => console.log(`    ${line}`));
}
if (ONLY || process.argv.includes('--no-mutants')) {
	console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
	process.exit(fails === 0 ? 0 : 1);
}

console.log('\n=== mutants of the shipped code: each must turn its check red');
const UPD = 'rigSheetUpdate.ts';
const MUTANTS = [
	[
		'kept',
		'the rig rebuilt from the mapping, not merged',
		[UPD, 'current: o.current,\n\t\tfresh,', 'current: fresh,\n\t\tfresh,'],
	],
	[
		'remapped',
		'the parts built from the kept mapping, not the edited one',
		[
			UPD,
			'const now = build(o.template, o.regions, o.mapping);',
			'const now = build(o.template, o.regions, o.was);',
		],
	],
	[
		'rearranged',
		"the frame clip never the new arrangement's",
		[UPD, 'if (!sameKeys(neu, old)) {', 'if (false) {'],
	],
	[
		'rearranged',
		'a clip read as the author’s by its spelling',
		[
			UPD,
			'export function sameKeys(a: unknown, b: unknown): boolean {',
			'export function sameKeys(a: unknown, b: unknown): boolean {\n\treturn JSON.stringify(a) === JSON.stringify(b);',
		],
	],
	[
		'framekept',
		"the author's frame clip replaced",
		[
			UPD,
			"if (cur !== undefined && !(was.ok && sameKeys(cur, old))) frame = 'kept';\n\t\telse if",
			'if',
		],
	],
	[
		'props',
		'as made read off the new build',
		[
			UPD,
			'const asMade = was.ok ? was.value.skeleton : o.current;',
			'const asMade = was.ok ? now.value.skeleton : o.current;',
		],
	],
	[
		'layers',
		"a Setup reorder lost to the mapping's order on every update",
		[
			UPD,
			'if (JSON.stringify(o.mapping.layers ?? null) !== JSON.stringify(o.was.layers ?? null)) {',
			'if (true) {',
		],
	],
	[
		'layers',
		'a changed Layers list never applied',
		[
			UPD,
			'if (JSON.stringify(o.mapping.layers ?? null) !== JSON.stringify(o.was.layers ?? null)) {',
			'if (false) {',
		],
	],
	[
		'layers',
		'the list applied back to front',
		[UPD, '\t\t).reverse();\n\t\tconst slots', '\t\t);\n\t\tconst slots'],
	],
	['layers', "a draw-order key's drawing not kept", [UPD, '\t\t\tback();\n', '']],
	[
		'handedit',
		'a hand-edited mesh never kept',
		[
			UPD,
			'const keep = new Set([...(o.keep ?? [])].filter(sameRegion));',
			'const keep = new Set<string>();',
		],
	],
];
const SOURCES = { [UPD]: join(SERVER, UPD) };
for (const [guard, what, mutation] of MUTANTS) {
	const [file, from] = mutation;
	if (!readFileSync(SOURCES[file], 'utf8').replace(/\r\n/g, '\n').includes(from)) {
		ok(`mutant planted: ${what}`, false, `"${from}" is not in ${file}`);
		continue;
	}
	const before = fails;
	const quiet = console.error;
	console.error = () => {};
	let red;
	try {
		red = !GUARDS[guard](await load([mutation]), () => {}) || fails > before;
	} catch {
		red = true;
	} finally {
		console.error = quiet;
	}
	fails = before;
	ok(`mutant caught by "${guard}": ${what}`, red);
	console.log(`    ${red ? 'red  ' : 'GREEN'} ${guard}: ${what}`);
}

console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
process.exit(fails === 0 ? 0 : 1);
