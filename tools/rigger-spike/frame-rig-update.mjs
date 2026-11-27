// Frame to rig F2j — ✂ Edit cut and 🔄 Update rig (docs/design/frame-to-rig.md §12 F2j), headless on the
// SHIPPED code: the rig 🦴 Create rig makes from atlas-tool's committed fixture cut (the shipped fit,
// `templateRig` over the committed sheet), its `frame-source.json` (`frameSourceOf`), then what an
// author does to it, then the cut re-edited and the rig updated by the shipped merge
// (`updateFrameRig`, as `/api/rigger/from-frame/update` runs it), posed by engine-rig as a game does.
//
// The author: keys the left upper arm and the torso's mesh in a clip of their own, adds a bone in the
// MIDDLE of the bone list (so every weighted vertex after it is renumbered) with a slot and an image of
// its own, keys the glasses' bone, and drags a vertex of the left hand's mesh. The cut: the left upper
// arm taken from another frame (the fixture turned 14° at 0.8), a badge added on the torso, the glasses
// removed. Asserted:
//  - kept: every bone of the rig (the user bone where the author put it), its slot and image, every
//    clip and key (the deform keys on the torso, whose mesh deforms the same values), the draw order;
//  - rebuilt: the upper arm's mesh is the new cut's, every part's weighted vertex names the bone the
//    build names (by name, though their places moved), the unchanged parts draw in the frame's pose
//    exactly where they did;
//  - props: the badge has a bone (appended, a child of the torso's image) and a slot drawn over the
//    torso; the glasses' bone, slot, image and the keys on its bone are gone, and the report named
//    those keys first;
//  - hand edit: the hand's mesh reads as edited (and only it, though the user bone renumbered every
//    mesh), may be kept (its drawing did not change), is kept when asked and replaced when not;
//  - the sidecar: Create rig's and Update rig's `frame-source.json` pass the save's check, name the
//    cut, its per-part frames and props, and hash each part as made;
//  - finite: the updated rig passes the `.irig` save check and every clip poses finite through
//    engine-rig, every vertex of every attachment;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/frame-rig-update.mjs [--only <guard>]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const SERVER = join(APP, 'src/lib/server');
const FIX = join(ROOT, 'services/atlas-tool/fixtures/rig_from_frame');
const PARTS = join(FIX, 'parts');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const sharp = createRequire(join(APP, 'package.json'))('sharp');

const dir = mkdtempSync(join(tmpdir(), 'frame-rig-update-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let bundles = 0;
const SHIPPED = /(rigFrameUpdate|rigFrameSource|rigFrameFit|rigTemplates|rigTemplateFit)\.ts$/;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source first. */
async function load(mutate = []) {
	const out = join(dir, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './rigFrameUpdate.ts';",
				"export * from './rigFrameFit.ts';",
				"export * from './rigTemplates.ts';",
				"export { frameSourceProblems } from '../rigFrameSource.ts';",
				"export { irigDocProblem } from './riggerIrig.ts';",
				"export { regionsToRigAtlas } from './rig.ts';",
			].join('\n'),
			resolveDir: SERVER,
			loader: 'ts',
			sourcefile: 'frame-rig-update-entry.ts',
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
					// `rig.ts` reaches R2, sharp and the page store; `regionsToRigAtlas` reads none of them.
					build.onResolve({ filter: /.*/ }, (args) =>
						/[\\/]rig\.ts$/.test(args.importer) && !args.path.startsWith('engine-')
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
let quiet = false;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	if (!quiet) console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};

// ---- the fixture: the cut, its sheet and a second frame --------------------------------------------
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const TRACK = read(join(FIX, 'track.json'));
const CUT = { ...read(join(PARTS, 'cut.json')), clip: { id: 'nelly', frame: 1 } };
const SHEET = read(join(PARTS, 'sheet.json'));
const LABELS = await sharp(join(PARTS, 'labels.png'))
	.extractChannel(0)
	.raw()
	.toBuffer({ resolveWithObject: true });
const PAGE = await sharp(join(PARTS, 'sheet.png'))
	.ensureAlpha()
	.raw()
	.toBuffer({ resolveWithObject: true });
const OTHER = 'f2r-fixture-0002';
const A = 'c/p/manifests/atlas_manifest_Nelly_parts.json';
const B = 'c/p/manifests/atlas_manifest_Nelly_parts_b.json';
const MOVED = 'upper_arm_l';
const ADDED = 'prop_badge';
const REMOVED = 'prop_glasses';
const EDITED = 'hand_l';
const USER_BONE = 'tail';

/** The track turned `deg` about the frame's middle and scaled by `k` (its normalised points). */
function turnTrack(track, deg, k) {
	const [w, h] = CUT.size;
	const c = Math.cos((deg * Math.PI) / 180);
	const s = Math.sin((deg * Math.PI) / 180);
	const move = (p) => {
		if (!p) return p;
		const x = (p[0] - 0.5) * w;
		const y = (p[1] - 0.5) * h;
		return [(k * (x * c - y * s)) / w + 0.5, (k * (x * s + y * c)) / h + 0.5, ...p.slice(2)];
	};
	return {
		...track,
		pose: { ...track.pose, landmarks: track.pose.landmarks.map(move) },
		hands: track.hands.map((hd) => ({ ...hd, landmarks: hd.landmarks.map(move) })),
		face: { ...track.face, landmarks: track.face.landmarks.map(move) },
	};
}

/** Each region's alpha on its canvas, as `regionAlphas` reads a sheet page. */
function alphasOf(regions, page = PAGE) {
	const out = new Map();
	for (const r of regions) {
		const data = new Uint8Array(r.w * r.h);
		for (let y = 0; y < r.h; y++)
			for (let x = 0; x < r.w; x++)
				data[y * r.w + x] = page.data[((r.y + y) * page.info.width + r.x + x) * 4 + 3];
		out.set(r.name, { data, w: r.w, h: r.h });
	}
	return out;
}

/**
 * The cut re-edited: the badge painted on the torso (a 24 px square on the label map, a new prop
 * hung from the torso's image), the glasses removed (their pixels back to the head, the indices
 * above them down one), the upper arm taken from the other frame. And the sheet the parts job makes
 * from it: the badge's image in, the glasses' out, the upper arm's from the other frame (another size).
 */
function reEdited() {
	const cut = structuredClone(CUT);
	const labels = new Uint8Array(LABELS.data);
	const gone = cut.names.indexOf(REMOVED);
	const head = cut.names.indexOf('head');
	for (let i = 0; i < labels.length; i++) {
		if (labels[i] === gone) labels[i] = head;
		else if (labels[i] !== 255 && labels[i] > gone) labels[i]--;
	}
	cut.names.splice(gone, 1);
	cut.props = cut.props.filter((p) => p.name !== REMOVED);
	const torso = cut.names.indexOf('torso');
	const w = LABELS.info.width;
	let painted = 0;
	const [cx, cy] = centreOf(labels, w, torso);
	cut.names.push(ADDED);
	for (let y = cy - 12; y < cy + 12; y++)
		for (let x = cx - 12; x < cx + 12; x++)
			if (labels[y * w + x] === torso) {
				labels[y * w + x] = cut.names.length - 1;
				painted++;
			}
	cut.props.push({
		name: ADDED,
		bone: 'chest',
		host: 'torso',
		after: 'torso',
		take: true,
		motion: 'rides',
		px: painted,
	});
	cut.sources = { [MOVED]: OTHER };
	const regions = SHEET.regions
		.filter((r) => r.name !== REMOVED)
		.map((r) =>
			r.name === MOVED
				? { ...r, w: r.w + 12, h: r.h + 30, origW: r.w + 12, origH: r.h + 30 }
				: { ...r },
		);
	regions.push({ name: ADDED, x: 0, y: 0, w: 26, h: 26 });
	return { cut, labels, regions };
}
function centreOf(labels, w, v) {
	let [sx, sy, n] = [0, 0, 0];
	for (let i = 0; i < labels.length; i++)
		if (labels[i] === v) {
			sx += i % w;
			sy += Math.floor(i / w);
			n++;
		}
	return [Math.round(sx / n), Math.round(sy / n)];
}

const requestOf = (M, cut, labels, sources = {}) =>
	M.framePartsRequest(
		M.HALF_BODY,
		cut,
		TRACK,
		M.propPivots(labels, LABELS.info.width, cut),
		sources,
	);

// ---- engine-rig, as a game loads and poses a rig ---------------------------------------------------
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function loaded(M, doc, regions) {
	const atlas = new RIG.TextureAtlas(
		M.regionsToRigAtlas('sheet.png', SHEET.width, SHEET.height, regions),
	);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(doc)),
	);
	return data;
}
/** The slots in the order engine-rig draws them with clip `anim` at `t`. */
function drawn(data, anim, t) {
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
	state.setAnimation(0, anim, false);
	state.update(t);
	state.apply(skel);
	return skel.drawOrder.map((s) => s?.data.name ?? '(none)');
}

/** Every attachment's world vertices with clip `anim` at `t` (setup when null), by slot/attachment. */
function posed(data, anim, t) {
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, anim, false);
		state.update(t);
		state.apply(skel);
	}
	skel.updateWorldTransform(RIG.Physics.update);
	const out = new Map();
	for (const slot of skel.slots) {
		const att = slot.getAttachment();
		if (!att) continue;
		const verts = new Float32Array(Math.max(8, att.worldVerticesLength ?? 8));
		if (att instanceof RIG.RegionAttachment) att.computeWorldVertices(slot, verts, 0, 2);
		else if (att instanceof RIG.MeshAttachment)
			att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
		else continue;
		out.set(`${slot.data.name}/${att.name}`, verts);
	}
	return out;
}

// ---- the rig as created, then as the author left it ------------------------------------------------
const skinOf = (doc) => doc.skins.find((s) => s.name === 'default') ?? doc.skins[0];
const slotOf = (doc, name) =>
	Object.entries(skinOf(doc).attachments).find(([, by]) => by[name])?.[0];
const attOf = (doc, name) => skinOf(doc).attachments[slotOf(doc, name)]?.[name];
/** A weighted mesh's influences by bone NAME: [[name, x, y, w], …] per vertex. */
function byName(doc, att) {
	const names = doc.bones.map((b) => b.name);
	const out = [];
	const v = att.vertices;
	for (let i = 0; i < v.length;) {
		const k = v[i++];
		const one = [];
		for (let j = 0; j < k; j++, i += 4) one.push([names[v[i]], v[i + 1], v[i + 2], v[i + 3]]);
		out.push(one);
	}
	return out;
}

function created(M) {
	const r = requestOf(M, CUT, new Uint8Array(LABELS.data));
	if (!r.ok) throw new Error(r.problem);
	const rig = M.templateRig(M.HALF_BODY, SHEET.regions, r.value.fit);
	const names = M.madeAttachments(rig.skeleton).map((a) => a.name);
	const source = M.frameSourceOf({
		rig: 'Nelly',
		template: rig.ref,
		cut: CUT,
		cutEtag: '"c1"',
		frames: {},
		parts: M.madeParts(rig.skeleton, names),
		art: A,
		artRevision: 'rev-a',
	});
	return { doc: rig.skeleton, fit: r.value.fit, source };
}

/** The author's work on the rig: a clip, a bone in the middle of the list, a slot, a key on a prop, a mesh edit. */
function authored(created) {
	const doc = structuredClone(created.doc);
	const at = doc.bones.findIndex((b) => b.name === 'torso_image') + 1;
	const was = doc.bones.map((b) => b.name);
	doc.bones.splice(at, 0, { name: USER_BONE, parent: 'torso_image', x: 12, y: -40, rotation: 20 });
	// The Rigger renumbers every weighted vertex past the new bone, as a bone added there does.
	const to = new Map(was.map((n, i) => [i, doc.bones.findIndex((b) => b.name === n)]));
	for (const by of Object.values(skinOf(doc).attachments))
		for (const att of Object.values(by)) {
			if (!att.uvs || att.vertices.length <= att.uvs.length) continue;
			const v = att.vertices;
			for (let i = 0; i < v.length;) {
				const k = v[i++];
				for (let j = 0; j < k; j++, i += 4) v[i] = to.get(v[i]);
			}
		}
	doc.slots.push({ name: 'badge_user', bone: USER_BONE, attachment: 'hand_r' });
	skinOf(doc).attachments.badge_user = { hand_r: { width: 40, height: 40 } };
	const torso = attOf(doc, 'torso');
	const deform = Array.from({ length: deformCount(torso) }, (_, i) => (i % 7 === 0 ? 3 : 0));
	doc.animations.wave = {
		bones: {
			upper_arm_l: { rotate: [{ value: 0 }, { time: 0.5, value: 35 }, { time: 1, value: 0 }] },
			[USER_BONE]: { rotate: [{ value: 0 }, { time: 1, value: -15 }] },
			[REMOVED]: { rotate: [{ value: 0 }, { time: 1, value: 10 }] },
		},
		slots: { badge_user: { rgba: [{ color: 'ffffffff' }, { time: 1, color: 'ff8080ff' }] } },
		attachments: {
			default: {
				[slotOf(doc, 'torso')]: { torso: { deform: [{ vertices: deform }, { time: 1 }] } },
			},
		},
		// The author's slot brought down three, then the torso drawn over everything: slots added and
		// removed before them move both keys' setup places.
		drawOrder: [
			{ time: 0.5, offsets: [{ slot: 'badge_user', offset: -3 }] },
			{
				time: 0.75,
				offsets: [
					{
						slot: slotOf(doc, 'torso'),
						offset:
							doc.slots.length - 1 - doc.slots.findIndex((s) => s.name === slotOf(doc, 'torso')),
					},
				],
			},
		],
	};
	const hand = attOf(doc, EDITED);
	hand.vertices[2] += 6; // the first vertex's first influence, dragged 6 px right
	return doc;
}
function deformCount(att) {
	let n = 0;
	const v = att.vertices;
	for (let i = 0; i < v.length;) {
		const k = v[i++];
		n += k * 2;
		i += k * 4;
	}
	return n;
}

function updated(M, made, current, keep = []) {
	const { cut, labels, regions } = reEdited();
	const sources = {
		[MOVED]: { job: OTHER, cut: CUT, track: turnTrack(TRACK, 14, 0.8) },
	};
	const r = requestOf(M, cut, labels, sources);
	if (!r.ok) throw new Error(r.problem);
	const before = alphasOf(SHEET.regions);
	const after = alphasOf(regions);
	const result = M.updateFrameRig({
		template: M.HALF_BODY,
		regions,
		fit: r.value.fit,
		current,
		made: made.source,
		props: cut.props,
		keep: new Set(keep),
		outlines: { before, after },
	});
	const fresh = M.templateRig(M.HALF_BODY, regions, r.value.fit).skeleton;
	const source = M.frameSourceOf({
		rig: 'Nelly',
		template: { id: M.HALF_BODY.id, version: M.HALF_BODY.version },
		cut,
		cutEtag: '"c2"',
		frames: { [MOVED]: 2 },
		parts: result.parts,
		art: B,
		artRevision: 'rev-b',
	});
	return { ...result, fresh, regions, source, cut };
}

// ---- the guards ------------------------------------------------------------------------------------
const GUARDS = {
	kept(M) {
		const made = created(M);
		const mine = authored(made);
		const { doc } = updated(M, made, mine);
		const names = (d) => d.bones.map((b) => b.name).filter((n) => n !== ADDED);
		const sameBones =
			JSON.stringify(names(doc)) === JSON.stringify(names(mine).filter((n) => n !== REMOVED));
		const user = doc.bones.find((b) => b.name === USER_BONE);
		const userSlot = doc.slots.find((s) => s.name === 'badge_user');
		const wave = doc.animations.wave;
		const torsoSlot = slotOf(doc, 'torso');
		const deformKept =
			JSON.stringify(wave?.attachments?.default?.[torsoSlot]?.torso) ===
			JSON.stringify(mine.animations.wave.attachments.default[torsoSlot].torso);
		const clips =
			Object.keys(doc.animations).sort().join() === Object.keys(mine.animations).sort().join();
		const frameSame =
			JSON.stringify(doc.animations.frame) === JSON.stringify(mine.animations.frame);
		const keysSame =
			JSON.stringify(wave.bones.upper_arm_l) ===
				JSON.stringify(mine.animations.wave.bones.upper_arm_l) &&
			JSON.stringify(wave.bones[USER_BONE]) ===
				JSON.stringify(mine.animations.wave.bones[USER_BONE]) &&
			JSON.stringify(wave.slots) === JSON.stringify(mine.animations.wave.slots);
		const constraints = ['ik', 'transform', 'path', 'physics'].every(
			(k) => JSON.stringify(doc[k] ?? []) === JSON.stringify(mine[k] ?? []),
		);
		// What each draw-order key draws in front of what, as engine-rig poses it: the same slots in the
		// same order (less the prop removed), the new prop just over its torso.
		const { regions } = reEdited();
		const was = loaded(M, mine, SHEET.regions);
		const now = loaded(M, doc, regions);
		const orders = [0.5, 0.75].map((t) => {
			const a = drawn(was, 'wave', t).filter((n) => n !== REMOVED);
			const b = drawn(now, 'wave', t);
			const badge = b.indexOf(ADDED) === b.indexOf(torsoSlot) + 1;
			return {
				same: JSON.stringify(a) === JSON.stringify(b.filter((n) => n !== ADDED)),
				badge,
				top: b.at(-2),
			};
		});
		return (
			ok(
				'every bone of the rig stays, in its order (the user bone in the middle too)',
				sameBones,
				`${names(doc).length} vs ${names(mine).length}`,
			) &
			ok(
				'the user bone keeps its parent and setup',
				user?.parent === 'torso_image' && user.x === 12 && user.y === -40 && user.rotation === 20,
				JSON.stringify(user),
			) &
			ok(
				"the author's slot and its image stay",
				!!userSlot && !!skinOf(doc).attachments.badge_user?.hand_r,
			) &
			ok('every clip stays, the frame clip as it was', clips && frameSame) &
			ok("the author's keys stay: the arm's, the user bone's, the slot's", keysSame) &
			ok(
				'each draw-order key draws the same slots in front of each other, the new prop over its torso',
				orders.every((o) => o.same && o.badge) && orders[1].top === torsoSlot,
				JSON.stringify(orders),
			) &
			ok('the deform keys on the torso stay (its mesh deforms the same values)', deformKept) &
			ok('every constraint stays', constraints)
		);
	},
	rebuilt(M) {
		const made = created(M);
		const mine = authored(made);
		const { doc, fresh, regions, report } = updated(M, made, mine);
		const moved = attOf(doc, MOVED);
		const changed = JSON.stringify(moved) !== JSON.stringify(attOf(mine, MOVED));
		const asBuilt =
			JSON.stringify(byName(doc, moved)) === JSON.stringify(byName(fresh, attOf(fresh, MOVED)));
		// Every rebuilt part names, by name, the bones the build names, though the user bone moved their places.
		const rebuilt = report.replaced.filter((n) => attOf(doc, n)?.uvs);
		const named = rebuilt.every(
			(n) =>
				JSON.stringify(byName(doc, attOf(doc, n))) ===
				JSON.stringify(byName(fresh, attOf(fresh, n))),
		);
		// The parts the new cut did not change draw in the frame's pose exactly where they did.
		const before = posed(loaded(M, mine, SHEET.regions), 'frame', 0);
		const now = posed(loaded(M, doc, regions), 'frame', 0);
		let off = 0;
		for (const part of ['torso', 'head', 'lower_arm_r', 'upper_arm_r', 'neck']) {
			const key = `${slotOf(doc, part)}/${part}`;
			const a = before.get(key);
			const b = now.get(key);
			if (!a || !b || a.length !== b.length) {
				off = Infinity;
				break;
			}
			for (let i = 0; i < a.length; i++) off = Math.max(off, Math.abs(a[i] - b[i]));
		}
		return (
			ok("the moved part's mesh is the new cut's", changed && asBuilt) &&
			ok(
				"every rebuilt part's vertices name the build's bones by name",
				named,
				rebuilt.join(', '),
			) &
				ok(
					'the parts the cut did not change draw where they did, in the frame pose',
					off < 1e-3,
					`${off.toFixed(4)} px`,
				)
		);
	},
	props(M) {
		const made = created(M);
		const mine = authored(made);
		const { doc, report } = updated(M, made, mine);
		const bone = doc.bones.find((b) => b.name === ADDED);
		const appended = doc.bones.at(-1)?.name === ADDED;
		const slots = doc.slots.map((s) => s.name);
		const over = slots.indexOf(ADDED) === slots.indexOf(slotOf(doc, 'torso')) + 1;
		const image = !!attOf(doc, ADDED);
		const goneBone = !doc.bones.some((b) => b.name === REMOVED);
		const goneSlot = !doc.slots.some((s) => s.name === REMOVED) && !slotOf(doc, REMOVED);
		const goneKeys = !doc.animations.wave.bones[REMOVED];
		const named = report.removed.find((r) => r.name === REMOVED);
		return (
			ok(
				'the new prop has a bone of its own, appended, hung from the torso image',
				!!bone && appended && bone.parent === 'torso_image',
				JSON.stringify(bone),
			) &
			ok('…and a slot drawn just over the torso, with its image', over && image, slots.join(' ')) &
			ok("the removed prop's bone, slot and image are gone", goneBone && goneSlot) &
			ok('…the keys on its bone too', goneKeys) &
			ok(
				'…and the report named those keys before they went',
				!!named && named.references.some((s) => s.includes('wave') && s.includes('bone')),
				JSON.stringify(named),
			)
		);
	},
	edited(M) {
		const made = created(M);
		const mine = authored(made);
		const replaced = updated(M, made, mine);
		const kept = updated(M, made, mine, [EDITED]);
		const flagged = replaced.report.handEdited;
		const only = flagged.length === 1 && flagged[0].part === EDITED;
		const offered = flagged[0]?.canKeep === true;
		const keptMesh =
			JSON.stringify(attOf(kept.doc, EDITED)) === JSON.stringify(attOf(mine, EDITED));
		const newMesh =
			JSON.stringify(byName(replaced.doc, attOf(replaced.doc, EDITED))) ===
			JSON.stringify(byName(replaced.fresh, attOf(replaced.fresh, EDITED)));
		// The moved part's drawing changed: a hand-edited mesh there is never offered.
		const arm = structuredClone(mine);
		attOf(arm, MOVED).vertices[2] += 4;
		const armed = updated(M, made, arm, [MOVED]).report.handEdited.find((h) => h.part === MOVED);
		return (
			ok(
				"only the hand's mesh reads as hand-edited (the user bone renumbered every mesh)",
				only,
				JSON.stringify(flagged),
			) &
			ok(
				"its drawing did not change, so keeping the author's mesh is offered",
				offered,
				JSON.stringify(flagged[0]),
			) &
			ok("kept when asked: the author's mesh as they left it", keptMesh) &
			ok('replaced when not: the new build bound to the rig', newMesh) &
			ok(
				'a part whose drawing changed is not offered (kept or not)',
				!!armed && !armed.canKeep && !armed.kept,
				JSON.stringify(armed),
			)
		);
	},
	sidecar(M) {
		const made = created(M);
		const mine = authored(made);
		const up = updated(M, made, mine);
		const a = M.frameSourceProblems(made.source);
		const b = M.frameSourceProblems(up.source);
		const names = M.madeAttachments(
			M.templateRig(M.HALF_BODY, SHEET.regions, made.fit).skeleton,
		).map((x) => x.name);
		const madeAll =
			names.every((n) => made.source.parts[n]?.hash) &&
			Object.keys(made.source.parts).length === names.length;
		const next = up.source;
		return (
			ok("Create rig's frame-source.json passes the save's check", !a.length, a.join('; ')) &
			ok("Update rig's passes it too", !b.length, b.join('; ')) &
			ok(
				'it names the clip, the main frame, the cut, its template',
				made.source.clip?.id === 'nelly' &&
					made.source.clip.frame === 1 &&
					made.source.job === CUT.job &&
					made.source.template.id === M.HALF_BODY.id,
			) &
			ok('it hashes every part and prop the cut made', madeAll) &
			ok(
				"the update's names the part from another frame, the props now, the new sheet",
				next.sources[MOVED] === OTHER &&
					next.frames[MOVED] === 2 &&
					next.props.some((p) => p.name === ADDED) &&
					!next.props.some((p) => p.name === REMOVED) &&
					next.art === B &&
					!next.parts[REMOVED] &&
					!!next.parts[ADDED],
			) &
			ok(
				'a malformed one is refused',
				M.frameSourceProblems({ ...next, job: '../x' }).length > 0 &&
					M.frameSourceProblems({ ...next, extra: 1 }).length > 0,
			)
		);
	},
	finite(M) {
		const made = created(M);
		const mine = authored(made);
		const { doc, regions } = updated(M, made, mine);
		const problem = M.irigDocProblem(doc);
		if (!ok('the updated rig passes the .irig save check', !problem, problem)) return false;
		const data = loaded(M, doc, regions);
		let bad = 0;
		let poses = 0;
		for (const a of data.animations)
			for (const t of [0, a.duration / 2, a.duration]) {
				poses++;
				for (const v of posed(data, a.name, t).values()) if (!v.every(Number.isFinite)) bad++;
			}
		for (const v of posed(data, null, 0).values()) if (!v.every(Number.isFinite)) bad++;
		return ok(
			`every clip poses finite through engine-rig (${poses} poses)`,
			bad === 0 && poses > 0,
			`${bad} attachments not finite`,
		);
	},
	iou(M) {
		const img = (w, h, x0, y0, s) => {
			const data = new Uint8Array(w * h);
			for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) data[y * w + x] = 255;
			return { data, w, h };
		};
		// The same square centred on canvases two pixels apart, and a square moved off its place.
		const same = M.alphaIoU(img(20, 20, 5, 5, 10), img(22, 22, 6, 6, 10));
		const moved = M.alphaIoU(img(20, 20, 5, 5, 10), img(20, 20, 8, 5, 10));
		return ok(
			'the outline compare centres the images on each other',
			same === 1 && moved < 0.6,
			`${same} ${moved}`,
		);
	},
};

// ---- mutants: each planted in the shipped code must turn its guard red ------------------------------
const MUTANTS = [
	[
		'kept',
		'draw-order keys left as they were while slots come and go',
		'rigFrameUpdate.ts',
		'\treorder();\n\treturn { doc, report };',
		'\treturn { doc, report };',
	],
	[
		'kept',
		'a new slot drawn at the end of each key, not with its host',
		'rigFrameUpdate.ts',
		'now.splice(i === 0 ? 0 : now.indexOf(after[i - 1]) + 1, 0, n);',
		'now.push(n);',
	],
	[
		'rebuilt',
		"the build's bone indices kept, not renamed into the rig",
		'rigFrameUpdate.ts',
		'const next = bound(att, freshNames, input.freshBind, rigNames(), nearest, report);',
		'const next = structuredClone(att);',
	],
	[
		'kept',
		"the build's clips taken over the rig's",
		'rigFrameUpdate.ts',
		'return { doc, report };\n}',
		'doc.animations = structuredClone(fresh.animations);\n\treturn { doc, report };\n}',
	],
	[
		'kept',
		'deform keys dropped whatever the mesh',
		'rigFrameUpdate.ts',
		'if (was === now) return 0;',
		'if (was === now && was === -1) return 0;',
	],
	[
		'kept',
		"a bone the build lacks dropped (the build's bones taken)",
		'rigFrameUpdate.ts',
		'const doc = structuredClone(input.current) as Doc;',
		'const doc = structuredClone(input.current) as Doc;\n\tdoc.bones = doc.bones.filter((b) => (input.fresh as Doc).bones.some((f) => f.name === b.name));',
	],
	[
		'props',
		"a new prop's slot left out",
		'rigFrameUpdate.ts',
		'\tfor (const { at, slot } of newSlotPlaces(doc.slots, freshSlots, isProp))\n\t\tdoc.slots.splice(at, 0, { ...slot, bone: has(slot.bone) ? slot.bone : nearest(slot.bone) });\n',
		'',
	],
	[
		'props',
		"a removed prop's bone left in",
		'rigFrameUpdate.ts',
		'if (needed) return { keptBone: idx >= 0 };',
		'if (needed || true) return { keptBone: idx >= 0 };',
	],
	[
		'props',
		"a new prop's bone inserted after its parent, nothing renumbered",
		'rigFrameUpdate.ts',
		'doc.bones.push(placedOn(b, nearest(b.parent ?? b.name), fresh, doc));',
		'doc.bones.splice(doc.bones.findIndex((x) => x.name === b.parent) + 1, 0, placedOn(b, nearest(b.parent ?? b.name), fresh, doc));',
	],
	[
		'props',
		'the references not looked for',
		'rigFrameUpdate.ts',
		'const refs = references(doc, r);',
		'const refs: string[] = [];',
	],
	[
		'edited',
		'a mesh hashed by bone index',
		'rigFrameUpdate.ts',
		'if (inf) shape.vertices = inf.map((one) => one.map(([b, x, y, w]) => [boneNames[b], x, y, w]));',
		'',
	],
	[
		'edited',
		"the author's keep ignored",
		'rigFrameUpdate.ts',
		'const kept = input.keep?.has(name) ?? false;',
		'const kept = false;',
	],
	[
		'edited',
		'keeping offered whatever the drawing',
		'rigFrameUpdate.ts',
		'return [part, { iou, canKeep: near && iou !== null && iou >= KEEP_IOU }];',
		'return [part, { iou, canKeep: true }];',
	],
	[
		'edited',
		'no mesh ever read as edited',
		'rigFrameUpdate.ts',
		'isRecord(now) && madeHash !== undefined && attachmentHash(now, rigNames()) !== madeHash;',
		'false;',
	],
	[
		'sidecar',
		'the per-part frames left out of the sidecar',
		'rigFrameUpdate.ts',
		'sources: { ...(o.cut.sources ?? {}) },',
		'sources: {},',
	],
	[
		'sidecar',
		'an unknown field let through',
		'rigFrameSource.ts',
		'for (const k of Object.keys(value)) if (!KEYS.has(k)) out.push(`${at}.${k} is not a field`);',
		'',
	],
	[
		'iou',
		'the images not centred',
		'rigFrameUpdate.ts',
		'const [dx, dy] = [Math.round((b.w - a.w) / 2), Math.round((b.h - a.h) / 2)];',
		'const [dx, dy] = [0, 0];',
	],
];

const only = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
const M = await load();
for (const [name, guard] of Object.entries(GUARDS)) {
	if (only && name !== only) continue;
	const before = fails;
	guard(M);
	console.log(`${fails === before ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log('\nmutants of the shipped code: each must turn its guard red');
for (const [guard, what, file, from, to] of MUTANTS) {
	if (only && guard !== only) continue;
	const before = fails;
	quiet = true;
	let red;
	try {
		red = !GUARDS[guard](await load([[file, from, to]]));
	} catch (e) {
		red = !String(e).includes('mutant:');
		if (!red) {
			quiet = false;
			ok(`mutant plants (${what})`, false, String(e));
		}
	} finally {
		quiet = false;
		fails = before;
	}
	if (ok(`mutant caught by ${guard}: ${what}`, red))
		console.log(`ok    mutant caught by ${guard}: ${what}`);
}
console.log(`\n${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
