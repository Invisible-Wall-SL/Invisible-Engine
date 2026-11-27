/**
 * 🗺 From my sheet (docs/design/frame-to-rig.md §13): a template rig over an artist's own sheet,
 * its regions mapped to the template's parts and each placed on its bones by its joints.
 *
 * - **The scale**: the template's shoulder width over the torso's drawn one (as a frame's fit), or
 *   the middle of the limbs' template over drawn lengths, or the author's.
 * - **The fit** (`RigFit`): each chain bone keeps the template's direction and takes its part's drawn
 *   length (shoulder to elbow, elbow to wrist, the neck, the jaw to the face, the hips to the
 *   shoulders), so the controls and clips play as on any rig of the template.
 * - **Where each drawing sits** (`TemplateArt`): its start joint on its bone, turned so its end joint
 *   lies along the bone, at the scale — so a part drawn lying down stands on its bone. One-joint parts
 *   (the face's, hair, ears, a foot) sit upright with their pivot on their bone. The setup is the
 *   template's rest, and there is no `frame` clip.
 * - **Arranged** (`arrange`, the drawings put together on a canvas as the artist drew the character):
 *   the arrangement is the frame, as a cut frame is to frame to rig (§4.6). Each arranged drawing
 *   sits where the canvas puts it, at the scale; the canvas turns about the waist (the spine's start
 *   stays where it is at rest); the clip `frame` turns each chain bone so its child lies where its
 *   drawing's end joint does (`fitFromJoints`: the torso's spine and chest with the torso, each limb
 *   along its drawing). A part not arranged sits on its bones in that pose.
 * - **Drawn apart, so rigid across its joints** (`skinBends` with `apart`): each drawing keeps its
 *   drawn proportions on its own bone in every pose, the overlap the artist drew hiding each joint.
 *   It bends only inside itself, bound in the frame's pose (the setup without an arrangement): the
 *   torso at its waist and shoulder lines, the head over the face's bones (`frameFace`, F2i) when the
 *   tracker found a face on it.
 * - **Props** hang from a bone of their own where they sit on their host's drawing, drawn over it,
 *   or just behind it when the artist's Photoshop layers say so (`psdBehind`).
 *
 * The mapping is kept in the bundle's `sheet.json` (`SHEET_SIDECAR`), so it opens again and a rig can
 * be made from it again.
 */
import { PROP_NAME } from './rigCutEdits';
import { apartFace, faceNote, frameFace } from './rigFrameFace';
import { HEAD_TURN_DEFAULT, HEAD_TURN_MAX, headTurn } from './rigHeadTurn';
import { sheetBones, type SheetBone } from './rigSheetBones';
import { fitFromJoints, framePose, skinBends, turnedAtSetup, type Fitted } from './rigFrameFit';
import {
	boneWorld,
	controlTarget,
	faceBones,
	fitTemplate,
	frameWorld,
	MAX_LAYERS,
	type Affine,
	type RigFit,
	type RigFitProp,
} from './rigTemplateFit';
import {
	templateFitProblem,
	templateMade,
	type RigTemplate,
	type RigTemplateChannel,
	type TemplateArt,
	type TemplateRegion,
} from './rigTemplates';
import {
	CUSTOM_NAME,
	SHEET_JOINTS,
	sheetKind,
	sheetLayerList,
	sheetPropPlaces,
	sheetSide,
	sheetSlotNames,
	type P,
	type SheetKind,
	type SheetMapping,
	type SheetPartMap,
	type SheetPlace,
	type SheetProp,
} from '../rigSheetMap';
import { inDrawOrder } from '../rigSlotOrder';
import { parseModuleChoice } from './rigTemplateModules';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: unknown): v is P => Array.isArray(v) && v.length === 2 && v.every(finite);
const extraKey = (o: Record<string, unknown>, keys: readonly string[]) =>
	Object.keys(o).find((k) => !keys.includes(k));
const NAME = /^[^\0/\\]{1,200}$/;
/** The face mesh the tracker finds (468, or 478 with the irises). */
const FACE_POINTS = [468, 478];
const MAX_PROPS = 64;
/** The most template bones a mapping keeps with nothing drawn on them. */
const MAX_KEEP = 1024;
/** The slot the template's mouth shapes swap in. */
const MOUTH_SLOT = 'mouth';
/** A sheet's pixel coordinates stay within this (a drawing's joint may sit just off it). */
const MAX_PX = 100_000;
/** A turn on the arrange canvas, degrees either way. */
const MAX_TURN = 3600;

/** A create's or a sidecar's `sheet`, checked for shape only (what it names: `sheetMappingProblem`). */
export function parseSheetMapping(raw: unknown): { mapping: SheetMapping } | { problem: string } {
	const no = (problem: string) => ({ problem });
	if (!isRecord(raw)) return no('a sheet mapping is an object');
	const extra = extraKey(raw, [
		'sheet',
		'manifestKey',
		'template',
		'parts',
		'props',
		'scale',
		'arrange',
		'swapSides',
		'layers',
		'turn',
		'keep',
	]);
	if (extra !== undefined) return no(`a sheet mapping has no field "${extra}"`);
	if (raw.swapSides !== undefined && typeof raw.swapSides !== 'boolean')
		return no('`swapSides` is true or false');
	if (raw.sheet !== 1) return no('a sheet mapping is version 1 (`sheet: 1`)');
	if (typeof raw.manifestKey !== 'string' || !raw.manifestKey) return no('it names its sheet');
	const tpl = raw.template;
	if (
		!isRecord(tpl) ||
		extraKey(tpl, ['id', 'version', 'modules']) !== undefined ||
		typeof tpl.id !== 'string' ||
		!Number.isInteger(tpl.version)
	)
		return no('it names its template as { id, version, modules? }');
	const modules = parseModuleChoice(tpl.modules);
	if (modules === null) return no("its template's modules are { module: option }");
	if (raw.scale !== undefined && !(finite(raw.scale) && raw.scale > 0 && raw.scale < 1000))
		return no('its scale is a number above 0');
	if (raw.turn !== undefined && !(finite(raw.turn) && raw.turn >= 0 && raw.turn <= HEAD_TURN_MAX))
		return no(`its head turn is a strength from 0 (off) to ${HEAD_TURN_MAX}`);
	const px = (p: unknown): p is P => point(p) && p.every((v) => Math.abs(v) <= MAX_PX);
	if (!isRecord(raw.parts)) return no('`parts` is { part: { region, joints, face? } }');
	const parts: Record<string, SheetPartMap> = {};
	for (const [name, o] of Object.entries(raw.parts)) {
		if (
			!isRecord(o) ||
			extraKey(o, ['region', 'joints', 'face']) !== undefined ||
			typeof o.region !== 'string' ||
			!NAME.test(o.region) ||
			!isRecord(o.joints)
		)
			return no(`part "${name}" is { region, joints: { joint: [x, y] }, face? }`);
		const joints: Record<string, P> = {};
		for (const [j, p] of Object.entries(o.joints)) {
			if (!px(p)) return no(`part "${name}"'s joint "${j}" is [x, y], sheet pixels`);
			joints[j] = [p[0], p[1]];
		}
		const map: SheetPartMap = { region: o.region, joints };
		if (o.face !== undefined) {
			if (!Array.isArray(o.face) || !FACE_POINTS.includes(o.face.length) || !o.face.every(px))
				return no(`part "${name}"'s face is the tracker's ${FACE_POINTS.join(' or ')} points`);
			map.face = (o.face as P[]).map((p) => [p[0], p[1]]);
		}
		parts[name] = map;
	}
	const turn = (v: unknown): v is number => finite(v) && Math.abs(v) <= MAX_TURN;
	if (!Array.isArray(raw.props) || raw.props.length > MAX_PROPS)
		return no(`\`props\` is a list of up to ${MAX_PROPS} { name, region, host, bone, at, turn? }`);
	const props: SheetProp[] = [];
	for (const p of raw.props) {
		if (
			!isRecord(p) ||
			extraKey(p, ['name', 'region', 'host', 'bone', 'at', 'turn', 'custom']) !== undefined ||
			typeof p.name !== 'string' ||
			typeof p.region !== 'string' ||
			!NAME.test(p.region) ||
			typeof p.host !== 'string' ||
			typeof p.bone !== 'string' ||
			!px(p.at) ||
			(p.turn !== undefined && !turn(p.turn)) ||
			(p.custom !== undefined && p.custom !== true)
		)
			return no(
				'a prop is { name, region, host, bone, at: [x, y], turn?: degrees, custom?: true }',
			);
		props.push({
			name: p.name,
			region: p.region,
			host: p.host,
			bone: p.bone,
			at: [p.at[0], p.at[1]],
			...(p.turn !== undefined ? { turn: p.turn as number } : {}),
			...(p.custom === true ? { custom: true as const } : {}),
		});
	}
	let arrange: Record<string, SheetPlace> | undefined;
	if (raw.arrange !== undefined) {
		if (!isRecord(raw.arrange)) return no('`arrange` is { part: { at: [x, y], turn } }');
		arrange = {};
		for (const [part, o] of Object.entries(raw.arrange)) {
			if (!isRecord(o) || extraKey(o, ['at', 'turn']) !== undefined || !px(o.at) || !turn(o.turn))
				return no(`part "${part}" is arranged as { at: [x, y], turn: degrees }, sheet pixels`);
			arrange[part] = { at: [o.at[0], o.at[1]], turn: o.turn };
		}
	}
	let layers: string[] | undefined;
	if (raw.layers !== undefined) {
		if (
			!Array.isArray(raw.layers) ||
			raw.layers.length > MAX_LAYERS ||
			!raw.layers.every((n) => typeof n === 'string' && NAME.test(n)) ||
			new Set(raw.layers).size !== raw.layers.length
		)
			return no(`\`layers\` is a list of up to ${MAX_LAYERS} slot names, front to back, each once`);
		layers = [...(raw.layers as string[])];
	}
	let keep: string[] | undefined;
	if (raw.keep !== undefined) {
		if (
			!Array.isArray(raw.keep) ||
			raw.keep.length > MAX_KEEP ||
			!raw.keep.every((n) => typeof n === 'string' && NAME.test(n)) ||
			new Set(raw.keep).size !== raw.keep.length
		)
			return no(`\`keep\` is a list of up to ${MAX_KEEP} bone names, each once`);
		keep = [...(raw.keep as string[])];
	}
	const mapping: SheetMapping = {
		sheet: 1,
		manifestKey: raw.manifestKey,
		template: {
			id: tpl.id,
			version: tpl.version as number,
			...(modules && Object.keys(modules).length ? { modules } : {}),
		},
		parts,
		props,
		...(raw.scale !== undefined ? { scale: raw.scale as number } : {}),
		...(arrange ? { arrange } : {}),
		...(raw.swapSides === true ? { swapSides: true as const } : {}),
		...(layers ? { layers } : {}),
		...(raw.turn !== undefined ? { turn: raw.turn as number } : {}),
		...(keep?.length ? { keep } : {}),
	};
	return { mapping };
}

/** A part's kind, side and the bones its joints sit on, by its slot. */
function partOf(t: RigTemplate, part: string) {
	const p = t.parts.find((x) => x.name === part)!;
	const slot = t.slots.find((s) => s.name === p.slot)!;
	const kind = sheetKind(p.slot);
	const side = sheetSide(p.slot);
	const main =
		slot.setup ?? t.parts.find((x) => x.slot === p.slot && x.name === p.slot)?.name ?? part;
	return { p, slot, kind, side, main: main === part };
}

/** Why `m` does not map sheet `regions` onto template `t`, or null. */
export function sheetMappingProblem(
	t: RigTemplate,
	regions: readonly TemplateRegion[],
	m: SheetMapping,
): string | null {
	if (m.template.id !== t.id)
		return `it is mapped to the template "${m.template.id}", not "${t.id}"`;
	const names = new Set(regions.map((r) => r.name));
	const parts = Object.keys(m.parts);
	if (!parts.length && !m.props.length) return 'it maps no region to a part';
	for (const [part, map] of Object.entries(m.parts)) {
		if (!t.parts.some((p) => p.name === part)) return `the template has no part "${part}"`;
		if (!names.has(map.region)) return `the sheet has no region "${map.region}"`;
		const { kind } = partOf(t, part);
		const want: readonly string[] = SHEET_JOINTS[kind];
		const have = Object.keys(map.joints);
		if (want.length !== have.length || want.some((j) => !map.joints[j]))
			return `part "${part}" is placed by its ${want.join(', ')}`;
		if (map.face && kind !== 'head') return `part "${part}" is not a head, so it has no face`;
	}
	for (const part of Object.keys(m.arrange ?? {})) {
		if (!m.parts[part]) return `"${part}" is arranged but not mapped`;
		if (!partOf(t, part).main)
			return `"${part}" is drawn in its slot's place: arrange the slot's main drawing`;
	}
	const bones = new Set(t.bones.map((b) => b.name));
	const taken = new Set([...t.slots.map((s) => s.name), ...t.parts.map((p) => p.name), ...bones]);
	for (const p of m.props) {
		if (p.custom && !CUSTOM_NAME.test(p.name))
			return `a custom part is named with a lowercase letter, then up to 40 lowercase letters, digits or _ (${p.name})`;
		if (!p.custom && !PROP_NAME.test(p.name))
			return `a prop is named prop_ and up to 40 lowercase letters, digits or _ (${p.name})`;
		if (taken.has(p.name))
			return `the prop ${p.name} is named twice, or like a part of the template`;
		taken.add(p.name);
		if (!names.has(p.region)) return `the sheet has no region "${p.region}"`;
		if (!m.parts[p.host]) return `the prop ${p.name} sits on "${p.host}", which is not mapped`;
		if (!bones.has(p.bone) || controlTarget(p.bone))
			return `the prop ${p.name} hangs from a bone the template has (not a control)`;
	}
	if (m.layers) {
		const slotOf = (part: string) => partOf(t, part).slot.name;
		const drawn = new Set([...parts.map(slotOf), ...m.props.map((p) => p.name)]);
		const stray = m.layers.find((n) => !drawn.has(n));
		if (stray !== undefined)
			return `the layers list "${stray}", which no mapped part or prop is drawn in`;
	}
	const unknown = m.keep?.find((b) => !bones.has(b));
	if (unknown !== undefined) return `it keeps a bone "${unknown}" the template does not have`;
	return null;
}

/** What a sheet makes of a template: the fit, each part's art, and what the report says. */
export interface SheetRig {
	fit: RigFit;
	art: Record<string, TemplateArt>;
	/** Rig units per sheet pixel. */
	scale: number;
	/** What of the drawn face the face's bones move (`faceNote`), or empty. */
	face: string;
	/**
	 * The arrange canvas pixel at the rig's origin (rig units = `scale` × its pixels from there, y
	 * up): where an arrangement puts the rig, else (0, 0).
	 */
	origin: P;
	/** Jointed mouth parts made with their slots empty: mouth shapes are mapped too, and win. */
	hidden: string[];
	/** Every bone of the template, made or left out, and why (`sheetBones`, §13.1i). */
	skeleton: SheetBone[];
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const len = (a: P): number => Math.hypot(a[0], a[1]);
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const angle = (a: P): number => Math.atan2(a[1], a[0]);
const apply = (m: Affine, [x, y]: P): P => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
/** `m` after `n` (`n` first). */
const compose = (m: Affine, n: Affine): Affine => [
	m[0] * n[0] + m[1] * n[2],
	m[0] * n[1] + m[1] * n[3],
	m[2] * n[0] + m[3] * n[2],
	m[2] * n[1] + m[3] * n[3],
	m[0] * n[4] + m[1] * n[5] + m[4],
	m[2] * n[4] + m[3] * n[5] + m[5],
];
function invert(m: Affine): Affine {
	const det = m[0] * m[3] - m[1] * m[2];
	const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
	return [a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5])];
}
/** A turn of `deg` clockwise on the page, about `at`, as a map of image points (y up). */
const turnedAt = (deg: number, at: P): Affine => {
	const r = (deg * Math.PI) / 180;
	return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), at[0], at[1]];
};
/** A drawing put on the arrange canvas: its image points (y up) to canvas pixels (y down). */
const onCanvas = ({ at, turn }: SheetPlace): Affine => {
	const r = (turn * Math.PI) / 180;
	return [Math.cos(r), Math.sin(r), Math.sin(r), -Math.cos(r), at[0], at[1]];
};
/** Canvas pixels to the rig's world: `k` rig units a pixel, y up, the rig's origin at `o`. */
const canvasToWorld = (k: number, o: P): Affine => [k, 0, 0, -k, -k * o[0], k * o[1]];
/** A drawing's ink as a box of its image (from the untrimmed middle, y up; a trim's `offY` is from its bottom). */
function inkBox(r: TemplateRegion): P[] {
	const [w, h] = [r.origW ?? r.w, r.origH ?? r.h];
	const x0 = (r.offX ?? (w - r.w) / 2) - w / 2;
	const y0 = (r.offY ?? (h - r.h) / 2) - h / 2;
	return [
		[x0, y0],
		[x0 + r.w, y0],
		[x0 + r.w, y0 + r.h],
		[x0, y0 + r.h],
	];
}
/** The create report's line on the head turn: how far a 25° turn slides the face across the head. */
const headTurnNote = (depth: number) =>
	`The head turns round: a 25° turn or nod slides its face ${Math.round(depth * Math.sin((25 * Math.PI) / 180))} units across it and the head's round part-way, its outline staying; what the head wears turns with it, at its depth.`;
/** The create report's line on a head drawn without its face. */
const APART_FACE =
	'The head’s middle turns and nods with the face, its outline staying where it is: the face is drawn apart, each feature on its own bone.';
/** A drawing's joint as a point of its image: from the middle of the untrimmed region, y up. */
const imagePoint = (r: TemplateRegion, [x, y]: P): P => [
	x - (r.origW ?? r.w) / 2,
	(r.origH ?? r.h) / 2 - y,
];

/**
 * The image placed with its point `qa` on `wa` (the rig's world), turned so the way from `qa` along
 * `qd` (image) lies along `wd` (world), at scale `k`.
 */
function placed(qa: P, qd: P, wa: P, wd: P, k: number): Affine {
	const r = angle(wd) - angle(qd);
	const [c, s] = [Math.cos(r) * k, Math.sin(r) * k];
	return [c, -s, s, c, wa[0] - (c * qa[0] - s * qa[1]), wa[1] - (s * qa[0] + c * qa[1])];
}

/**
 * The bones whose offsets are the length a part's two joints draw, by kind (`_s` its side): the
 * neck's is shared by its upper half and the head, as the template shares it.
 */
const LENGTH: Partial<Record<SheetKind, string[]>> = {
	upper_arm: ['lower_arm_s'],
	lower_arm: ['hand_s'],
	thigh: ['shin_s'],
	shin: ['foot_s'],
	neck: ['neck_upper', 'head'],
	head: ['face'],
};
/** The bones a part's first joint and its direction lie on, by kind. */
const ON: Partial<Record<SheetKind, [string, string]>> = {
	upper_arm: ['upper_arm_s', 'lower_arm_s'],
	lower_arm: ['lower_arm_s', 'hand_s'],
	hand: ['hand_s', 'middle_1_s'],
	thigh: ['thigh_s', 'shin_s'],
	shin: ['shin_s', 'foot_s'],
	neck: ['neck', 'head'],
	head: ['head', 'face'],
};
/** A fitted length is never under this share of the template's (a torso drawn with no height). */
const LEAST_LENGTH = 0.25;
/** The neck's width, as a frame's fit takes it: shares of the jaw's corners apart or the shoulders. */
const NECK_WIDTH = 0.42;
const NECK_SHOULDERS = 0.2;

/**
 * The fit and the art of sheet mapping `m` (checked by `sheetMappingProblem`) on template `t`, over
 * the sheet's `regions`. Refused, with the reason, when the joints do not span a part or the fitted
 * template does not hold. `fitLayers: false` checks the layers' names but fits in the template's
 * order, leaving the depth controls to the caller (🔄 Update rig, the 🗺 Edit mapping preview).
 */
export function sheetRig(
	t: RigTemplate,
	regions: readonly TemplateRegion[],
	m: SheetMapping,
	{ fitLayers = true }: { fitLayers?: boolean } = {},
): LayersFitted<SheetRig> {
	const no = (problem: string): Fitted<never> => ({ ok: false, problem });
	const bad = sheetMappingProblem(t, regions, m);
	if (bad) return no(bad);
	const regionOf = new Map(regions.map((r) => [r.name, r]));
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const W0 = boneWorld(t.bones);
	const mapped = Object.entries(m.parts).map(([part, map]) => {
		const info = partOf(t, part);
		const r = regionOf.get(map.region)!;
		const q = (j: string) => imagePoint(r, map.joints[j]);
		return { part, map, r, q, ...info };
	});
	const sided = (name: string, s: 'l' | 'r' | null) => name.replace(/_s$/, `_${s ?? 'l'}`);
	/** The template's bones a kind's drawn length is the offsets of (those it has). */
	const lengthOf = (kind: SheetKind, s: 'l' | 'r' | null) =>
		(LENGTH[kind] ?? []).flatMap((n) => byName.get(sided(n, s)) ?? []);

	// The scale: the torso's shoulders, else the limbs' drawn lengths against the template's.
	const torso = mapped.find((x) => x.kind === 'torso' && x.main);
	const tplShoulders =
		byName.has('upper_arm_l') && byName.has('upper_arm_r')
			? sub(W0.get('upper_arm_r')!, W0.get('upper_arm_l')!)
			: null;
	let k = m.scale;
	if (k === undefined && torso && tplShoulders) {
		const drawn = len(sub(torso.q('shoulder_r'), torso.q('shoulder_l')));
		if (drawn > 1e-6) k = len(tplShoulders) / drawn;
	}
	if (k === undefined) {
		const ratios: number[] = [];
		for (const x of mapped) {
			const tl = lengthOf(x.kind, x.side).reduce((s, b) => s + Math.hypot(b.x, b.y), 0);
			const [j0, j1] = SHEET_JOINTS[x.kind];
			const drawn = j1 ? len(sub(x.q(j1), x.q(j0))) : 0;
			if (x.main && tl > 0 && drawn > 1e-6) ratios.push(tl / drawn);
		}
		ratios.sort((a, b) => a - b);
		k = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
	}
	if (!(k > 0 && Number.isFinite(k))) return no('the sheet has no scale: map the torso');

	// The lengths, each along the template's direction.
	const bones: RigFit['bones'] = {};
	const setLength = (name: string, l: number, what: string): string | null => {
		const b = byName.get(name);
		if (!b) return null;
		const tl = Math.hypot(b.x, b.y);
		if (!(tl > 0)) return null;
		if (!(l > 1e-3)) return `the joints of ${what} are on top of each other`;
		if (Math.abs(l - tl) > 1e-6) bones[name] = { x: (b.x / tl) * l, y: (b.y / tl) * l };
		return null;
	};
	for (const x of mapped) {
		if (!x.main) continue;
		const lb = lengthOf(x.kind, x.side);
		const [j0, j1 = j0] = SHEET_JOINTS[x.kind];
		const tl = lb.reduce((s, b) => s + Math.hypot(b.x, b.y), 0);
		for (const b of lb) {
			const share = tl > 0 ? Math.hypot(b.x, b.y) / tl : 1 / lb.length;
			const problem = setLength(b.name, len(sub(x.q(j1), x.q(j0))) * k * share, x.part);
			if (problem) return no(problem);
		}
	}
	const chest = byName.get('chest');
	if (torso && chest && tplShoulders && W0.has('chest')) {
		// The shoulders sit as high above the hips as the torso draws them: the chest takes the rest.
		const across = sub(torso.q('shoulder_r'), torso.q('shoulder_l'));
		const up: P = [-across[1] / len(across), across[0] / len(across)];
		const rise = sub(mid(torso.q('shoulder_l'), torso.q('shoulder_r')), torso.q('hips'));
		const drawn = (rise[0] * up[0] + rise[1] * up[1]) * k;
		const tplRise = (W0.get('upper_arm_l')![1] + W0.get('upper_arm_r')![1]) / 2;
		const tl = Math.hypot(chest.x, chest.y);
		const problem = setLength('chest', Math.max(LEAST_LENGTH * tl, tl + drawn - tplRise), 'torso');
		if (problem) return no(problem);
	}

	// Where each drawing sits on the fitted skeleton, at rest. The torso stands on its shoulders, and
	// its collar is where the neck sits on the chest: the neck takes that height (a drawn neck then
	// meets the body where the torso draws it).
	let W = frameWorld(fitTemplate(t, { bones }).bones);
	const at = (n: string): P | null => {
		const a = W.get(n);
		return a ? [a[4], a[5]] : null;
	};
	const onShoulders = (x: (typeof mapped)[number]): Affine => {
		const [ql, qr] = [x.q('shoulder_l'), x.q('shoulder_r')];
		const [wl, wr] = [at('upper_arm_l')!, at('upper_arm_r')!];
		return placed(mid(ql, qr), sub(qr, ql), mid(wl, wr), sub(wr, wl), k);
	};
	const neck = byName.get('neck');
	if (torso && tplShoulders && neck?.parent && at(neck.parent)) {
		const collar = sub(apply(onShoulders(torso), torso.q('neck')), at(neck.parent)!);
		const tl = Math.hypot(neck.x, neck.y);
		const along = (collar[0] * neck.x + collar[1] * neck.y) / tl;
		const problem = setLength('neck', Math.max(LEAST_LENGTH * tl, along), 'torso');
		if (problem) return no(problem);
		W = frameWorld(fitTemplate(t, { bones }).bones);
	}
	const rest = new Map<string, Affine>();
	for (const x of mapped) {
		const on = ON[x.kind];
		const [j0, j1 = j0] = SHEET_JOINTS[x.kind];
		const home = at(x.slot.bone)!;
		let matrix: Affine;
		if (x.kind === 'torso' && tplShoulders) matrix = onShoulders(x);
		else if (on && at(sided(on[0], x.side))) {
			const wa = at(sided(on[0], x.side))!;
			const next = at(sided(on[1], x.side));
			// A hand with no fingers carries on along its forearm; a head with no face stands up.
			const before = x.kind === 'hand' ? at(sided('lower_arm_s', x.side)) : null;
			const wd: P = next ? sub(next, wa) : before ? sub(wa, before) : [0, 1];
			matrix = placed(x.q(j0), sub(x.q(j1), x.q(j0)), wa, wd, k);
		} else matrix = placed(x.q(j0), [0, 1], home, [0, 1], k);
		rest.set(x.part, matrix);
	}

	// Arranged: the canvas is the frame. Each arranged drawing sits where the canvas puts it, the
	// canvas placed so the torso turns about the spine's start (or the first part arranged about its
	// first bone's); each chain bone is turned to lie as its drawing does, the spine and the chest
	// with the torso, and every other part rides its bone into that pose.
	let frame: RigFit['frame'];
	let origin: P = [0, 0];
	const placedAt = new Map<string, Affine>();
	const arranged = mapped.filter((x) => x.main && m.arrange?.[x.part]);
	if (arranged.length) {
		const torsoArranged = arranged.find((x) => x.kind === 'torso');
		const anchor = torsoArranged ?? arranged[0];
		const first = ON[anchor.kind];
		const pivot =
			(anchor.kind === 'torso' ? at('spine') : first ? at(sided(first[0], anchor.side)) : null) ??
			at(anchor.slot.bone)!;
		const onSheet = (x: (typeof mapped)[number]) => onCanvas(m.arrange![x.part]);
		const c = apply(onSheet(anchor), apply(invert(rest.get(anchor.part)!), pivot));
		origin = [c[0] - pivot[0] / k, c[1] + pivot[1] / k];
		const toWorld = canvasToWorld(k, origin);
		for (const x of arranged) placedAt.set(x.part, compose(toWorld, onSheet(x)));
		const J: Record<string, P> = {};
		const aims: Record<string, string> = {};
		if (torsoArranged) {
			const withTorso = compose(
				placedAt.get(torsoArranged.part)!,
				invert(rest.get(torsoArranged.part)!),
			);
			const chain = ['spine', 'chest', 'neck'].filter((n) => at(n));
			chain.forEach((n, i) => {
				J[n] = apply(withTorso, at(n)!);
				if (i) aims[chain[i - 1]] = n;
			});
		}
		const boneAt = new Map(t.bones.map((b, i) => [b.name, i]));
		const limbs = arranged
			.filter((x) => ON[x.kind])
			.map((x) => ({ x, on: ON[x.kind]!.map((n) => sided(n, x.side)) }))
			.filter(({ on }) => on.every((n) => byName.has(n)))
			.sort((a, b) => boneAt.get(a.on[0])! - boneAt.get(b.on[0])!);
		for (const { x, on } of limbs) {
			const [j0, j1 = j0] = SHEET_JOINTS[x.kind];
			const A = placedAt.get(x.part)!;
			const [from, to] = [apply(A, x.q(j0)), apply(A, x.q(j1))];
			J[on[0]] ??= from;
			J[on[1]] = add(J[on[0]], sub(to, from));
			aims[on[0]] = on[1];
		}
		const turned = turnedAtSetup(t, Object.keys(aims));
		if (turned.length)
			return no(
				`the template's ${turned.join(', ')} are turned or scaled at setup: it cannot be arranged`,
			);
		frame = fitFromJoints(fitTemplate(t, { bones }), J, aims, []).frame;
	}
	const posedW = frame ? frameWorld(fitTemplate(t, { bones }).bones, frame) : W;
	const art: Record<string, TemplateArt> = {};
	for (const x of mapped) {
		const bone = x.slot.bone;
		const matrix =
			placedAt.get(x.part) ??
			(frame
				? compose(posedW.get(bone)!, compose(invert(W.get(bone)!), rest.get(x.part)!))
				: rest.get(x.part)!);
		art[x.part] = { region: x.map.region, matrix };
	}
	// A mouth drawn both as shapes and as its parts: the shapes win (the Mouth control swaps them),
	// and the jointed parts (the template's optional mouth slots) are made with their slots empty.
	const shapes = mapped.some((x) => x.slot.name === MOUTH_SLOT);
	const hidden = shapes ? mapped.filter((x) => x.slot.optional).map((x) => x.part) : [];
	for (const part of hidden) art[part].hidden = true;

	// The face on a drawn head, where the tracker found it; else the head's middle on the face.
	const drawnHead = mapped.find((x) => x.kind === 'head' && x.main);
	const head = drawnHead?.map.face ? drawnHead : undefined;
	const faceWorld = head
		? head.map.face!.map((p) => apply(art[head.part].matrix, imagePoint(head.r, p)))
		: null;
	const lengthened: RigFit = { bones, ...(frame ? { frame } : {}) };
	// The optional bones the mapped parts ride (a jointed mouth's upper teeth) are placed with the face.
	const ridden = new Set(mapped.map((x) => x.slot.bone));
	const optional = new Set(
		t.bones.filter((b) => b.optional && ridden.has(b.name)).map((b) => b.name),
	);
	const found = faceWorld ? frameFace(t, lengthened, faceWorld, optional) : null;
	const drawn =
		found ??
		(drawnHead
			? apartFace(
					t,
					lengthened,
					inkBox(drawnHead.r).map((p) => apply(art[drawnHead.part].matrix, p)),
					optional,
				)
			: null);

	// The head turn (§13.1g): the drawn head weighted in a dome about the face, its face, its ring and
	// what it wears at depths, so a 3D turn or nod and the head controls turn it round.
	const onFace = faceBones(t.bones, true);
	const turned =
		drawn && drawnHead
			? headTurn({
					t,
					fit: { ...lengthened, features: drawn.features },
					outline: inkBox(drawnHead.r).map((p) => apply(art[drawnHead.part].matrix, p)),
					spots: drawn.spots,
					apart: !found,
					features: mapped
						.filter((x) => onFace.has(x.slot.bone))
						.flatMap((x) => inkBox(x.r).map((p) => apply(art[x.part].matrix, p))),
					strength: m.turn ?? HEAD_TURN_DEFAULT,
				})
			: null;
	const features =
		drawn && turned
			? { ...drawn.features, scale: { ...drawn.features.scale, face: turned.face } }
			: drawn?.features;

	// Props: a bone of their own where they sit on their host's drawing (on the skeleton with the
	// face's bones where the drawn face has them), turned against it as they say, their slots where
	// `sheetPropPlaces` draws them; the author's layers then order every slot the mapping draws. One
	// worn on the head's drawing hangs from the head itself at its depth when the head turns.
	const Wf = features ? frameWorld(fitTemplate(t, { bones, features }).bones, frame) : posedW;
	const slots = t.slots.map((s) => s.name);
	const hostOf = (part: string) => {
		const x = mapped.find((y) => y.part === part)!;
		return { slot: x.slot.name, region: x.map.region };
	};
	const props: RigFitProp[] = [];
	const propDepths: Record<string, number> = {};
	const behind = new Map<string, boolean>();
	const layers = m.layers ?? [];
	for (const { prop: p, before, after } of sheetPropPlaces(slots, m.props, hostOf)) {
		const host = mapped.find((x) => x.part === p.host)!;
		const pivot = imagePoint(host.r, p.at);
		const where = apply(art[host.part].matrix, pivot);
		const next = (before ?? after)!;
		const headSlot = drawnHead?.slot.name;
		const back =
			headSlot !== undefined && layers.includes(p.name) && layers.includes(headSlot)
				? layers.indexOf(p.name) > layers.indexOf(headSlot)
				: (behind.get(next) ??
					(headSlot !== undefined &&
						(before !== undefined
							? slots.indexOf(next) <= slots.indexOf(headSlot)
							: slots.indexOf(next) < slots.indexOf(headSlot))));
		behind.set(p.name, back);
		if (turned && p.host === drawnHead?.part && p.bone === drawnHead.slot.bone) {
			const worn = turned.propAt(where, back);
			props.push({
				name: p.name,
				bone: turned.head,
				...(before ? { before } : { after: after! }),
				at: worn.at,
			});
			propDepths[p.name] = worn.depth;
		} else {
			const bw = Wf.get(p.bone)!;
			const det = bw[0] * bw[3] - bw[1] * bw[2];
			const [dx, dy] = [where[0] - bw[4], where[1] - bw[5]];
			const local: P = [(bw[3] * dx - bw[1] * dy) / det, (bw[0] * dy - bw[2] * dx) / det];
			const at: P = [Math.round(local[0] * 1e4) / 1e4, Math.round(local[1] * 1e4) / 1e4];
			props.push({ name: p.name, bone: p.bone, ...(before ? { before } : { after: after! }), at });
		}
		art[p.name] = {
			region: p.region,
			matrix: compose(
				art[host.part].matrix,
				p.turn ? turnedAt(p.turn, pivot) : [1, 0, 0, 1, ...pivot],
			),
		};
	}

	// Every body part skinned across its joints with the parts beside it, posed as the frame (at rest
	// without an arrangement).
	const turnDepths = { ...turned?.turn.depths, ...propDepths };
	const fit: RigFit = {
		bones,
		...(frame ? { frame } : {}),
		...(features ? { features } : {}),
		...(props.length ? { props } : {}),
		...(turned
			? {
					turn: {
						bones: turned.turn.bones,
						...(Object.keys(turnDepths).length ? { depths: turnDepths } : {}),
					},
				}
			: {}),
		...(m.layers && fitLayers ? { order: [...m.layers].reverse() } : {}),
	};
	// Judged by the rig's names for its slots (its regions'), as the Layers list shows them.
	const names = sheetSlotNames(t, m);
	const against = layersAgainstDepth(t, { ...fit, slots: names });
	if (against) return layersRefused(against);
	const mains = mapped.filter((x) => x.main).map((x) => x.part);
	const posed = framePose(t, fit, mains);
	if (!posed.ok) return posed;
	const sw = tplShoulders ? len(tplShoulders) : 0;
	const jaw = faceWorld && faceWorld.length >= 468 ? len(sub(faceWorld[397], faceWorld[172])) : 0;
	const neckWidth = 2 * Math.max(NECK_WIDTH * jaw, NECK_SHOULDERS * sw);
	const bends = skinBends(
		t,
		posed.value.skel,
		{},
		mains,
		neckWidth,
		turned?.spots ?? drawn?.spots,
		true,
	);
	// A drawing by angle or a hand pose bends as its slot's main drawing does; a drawing lying down
	// takes its grid's lines along its length.
	for (const x of mapped) {
		if (x.main || bends[x.part]) continue;
		const main = mapped.find((y) => y.main && y.slot.name === x.slot.name && bends[y.part]);
		if (main) bends[x.part] = structuredClone(bends[main.part]);
	}
	for (const x of mapped) {
		const b = bends[x.part];
		const [w, h] = [x.r.origW ?? x.r.w, x.r.origH ?? x.r.h];
		if (b?.grid && w > h && b.grid[0] < b.grid[1]) b.grid = [b.grid[1], b.grid[0]];
	}
	if (Object.keys(bends).length) fit.bends = bends;
	// One slot per region, named as the region is (§13.1h): the fit names the roles, and this the rig's.
	fit.slots = names;
	// Only the bones the mapping needs (§13.1i): each drawing's, what ends its length, what its limb
	// moves by, what the author keeps, and the bones above them.
	const ends = mapped
		.filter((x) => x.main)
		.flatMap((x) => lengthOf(x.kind, x.side).map((b) => b.name));
	const skeleton = sheetBones(t, fit, ends, m.keep ?? []);
	if (skeleton.leftOut.length) fit.leftOut = skeleton.leftOut;
	const problem = templateFitProblem(t, fit);
	if (problem) return no(problem);
	return {
		ok: true,
		value: {
			fit,
			art,
			scale: k,
			face: [
				found ? faceNote(found.moves) : drawn ? APART_FACE : '',
				turned ? headTurnNote(turned.depth) : '',
			]
				.filter(Boolean)
				.join(' '),
			origin,
			hidden,
			skeleton: skeleton.bones,
		},
	};
}

/** A fit, or why not: `layers` when it is the author's Layers a depth control cannot stand with. */
export type LayersFitted<T> = Fitted<T> | { ok: false; problem: string; layers: true };
const layersRefused = (problem: string) => ({ ok: false as const, problem, layers: true as const });

/**
 * Why the author's layers (`RigFit.order`) cannot stand with the template's depth controls, or null:
 * a control such as Arm depth moves its limb from in front of a slot (the head, the torso) to just
 * behind it, so the limb must be drawn in front of that slot at setup.
 */
function layersAgainstDepth(t: RigTemplate, fit: RigFit): string | null {
	if (!fit.order) return null;
	const ft = fitTemplate(t, fit);
	return slotsAgainstDepth(
		ft.channels,
		ft.slots.map((s) => s.name),
	);
}

/**
 * Why a draw order (`slots`, back to front: a fitted template's, or a rig's) cannot stand with the
 * depth controls among `channels`, or null (`layersAgainstDepth`). A slot it lacks is not judged;
 * every slot a depth control steps is one the Layers list draws (one slot per region, §13.1h).
 */
function slotsAgainstDepth(
	channels: readonly RigTemplateChannel[],
	slots: readonly string[],
): string | null {
	const at = new Map(slots.map((n, i) => [n, i]));
	for (const c of channels) {
		if (!c.order) continue;
		const own = c.order.slots.filter((n) => at.has(n));
		if (!own.length) continue;
		const back = own.reduce((a, b) => (at.get(b)! < at.get(a)! ? b : a));
		for (const st of c.order.steps) {
			if (!at.has(st.behind) || at.get(st.behind)! < at.get(back)!) continue;
			const moves = `the control "${c.label}" moves it from in front of "${st.behind}" to behind it`;
			return `the Layers draw "${back}" behind "${st.behind}", but ${moves}: keep ${back} in front of ${st.behind}`;
		}
	}
	return null;
}

/**
 * The slots mapping `m` draws in, back to front, as its Layers list orders them (`sheetLayerList`),
 * by the names `fit` gives them in the rig (§13.1h).
 */
function sheetLayerOrder(t: RigTemplate, m: SheetMapping, fit: RigFit): string[] {
	const slotOf = (part: string) => t.parts.find((p) => p.name === part)?.slot ?? part;
	return sheetLayerList(
		t.slots.map((s) => s.name),
		slotOf,
		m,
	)
		.reverse()
		.map((n) => fit.slots?.[n] ?? n);
}

/**
 * Whether 🔄 Update rig holds mapping `m`'s Layers to the depth controls on the open rig (its slots
 * `had`, back to front, made from a mapping whose layers were `was`; `fit` is `m`'s): when the list
 * changed since and moves a slot the rig had, or draws a slot new to it that a depth control steps
 * (a prop worn on an arm). A prop worn elsewhere, the rig's own order otherwise, is not judged.
 */
function layersJudged(
	t: RigTemplate,
	fit: RigFit,
	m: SheetMapping,
	was: readonly string[] | undefined,
	had: readonly string[],
): boolean {
	if (JSON.stringify(m.layers ?? null) === JSON.stringify(was ?? null)) return false;
	const want = sheetLayerOrder(t, m, fit);
	if (inDrawOrder(had, want).some((n, i) => n !== had[i])) return true;
	const have = new Set(had);
	const stepped = new Set(fitTemplate(t, fit).channels.flatMap((c) => c.order?.slots ?? []));
	return want.some((n) => !have.has(n) && stepped.has(n));
}

/**
 * The draw order 🔄 Update rig gives the rig merged from mapping `m` (its slots `merged`, back to
 * front, as the merge leaves them; `had` the open rig's, made from a mapping whose layers were `was`;
 * `fit` is `m`'s): the Layers list's when the author changed it and it moves a slot, else null (the
 * rig's own order stays, a Setup reorder too). Refused when held to the depth controls
 * (`layersJudged`) and they cannot stand with it. The 🗺 Edit mapping preview warns by this too.
 */
export function sheetLayersApplied(
	t: RigTemplate,
	fit: RigFit,
	m: SheetMapping,
	was: readonly string[] | undefined,
	had: readonly string[],
	merged: readonly string[],
): LayersFitted<string[] | null> {
	if (JSON.stringify(m.layers ?? null) === JSON.stringify(was ?? null))
		return { ok: true, value: null };
	const want = sheetLayerOrder(t, m, fit);
	const now = inDrawOrder(merged, want);
	if (now.every((n, i) => n === merged[i])) return { ok: true, value: null };
	const against =
		layersJudged(t, fit, m, was, had) && slotsAgainstDepth(fitTemplate(t, fit).channels, now);
	return against ? layersRefused(against) : { ok: true, value: now };
}

/** What the 🗺 dialog's ◧ Arranged view draws: the rig a sheet makes, as `sheetRig` places it. */
export interface SheetPreview {
	/** Rig units per sheet pixel, and the arrange canvas pixel at the rig's origin (`SheetRig`). */
	scale: number;
	origin: P;
	/**
	 * Each mapped part's and prop's drawing in the rig's world (`TemplateArt`), in the `frame` pose
	 * when arranged, else at rest: back to front, as the rig draws them.
	 */
	art: { name: string; region: string; matrix: Affine }[];
	/** Where each bone starts in that pose (rig units, y up). */
	bones: Record<string, P>;
	/** Whether the rig has a `frame` clip (the sheet is arranged). */
	frame: boolean;
	/** The template's bones, made or left out, and why (`sheetBones`): the dialog's 🦴 Bones list. */
	skeleton: SheetBone[];
}

/**
 * `sheetRig`'s placements, for the page to draw without fitting anything itself: the layers refused
 * as 🦴 Create rig refuses them, or with `edit` (🗺 Edit mapping) drawn unjudged, for the caller to
 * judge them as 🔄 Update rig does (`sheetEditPreview`).
 */
export function sheetPreview(
	t: RigTemplate,
	regions: readonly TemplateRegion[],
	m: SheetMapping,
	{ edit = false }: { edit?: boolean } = {},
): LayersFitted<SheetPreview> {
	const made = sheetRig(t, regions, m, { fitLayers: !edit });
	if (!made.ok) return made;
	const { fit, art, scale, origin, skeleton } = made.value;
	const all = fitTemplate(t, fit);
	const ft = templateMade(
		all,
		new Set(Object.keys(art).map((n) => all.parts.find((p) => p.name === n)?.slot ?? n)),
	);
	const order = inDrawOrder(
		ft.slots.map((s) => s.name),
		m.layers ? sheetLayerOrder(t, m, fit) : [],
	);
	const slotAt = new Map(order.map((n, i) => [n, i]));
	const slotOf = (name: string) => ft.parts.find((p) => p.name === name)?.slot ?? name;
	const W = frameWorld(ft.bones, fit.frame);
	return {
		ok: true,
		value: {
			scale,
			origin,
			art: Object.entries(art)
				.map(([name, a]) => ({ name, region: a.region, matrix: a.matrix }))
				.sort((a, b) => (slotAt.get(slotOf(a.name)) ?? 0) - (slotAt.get(slotOf(b.name)) ?? 0)),
			bones: Object.fromEntries([...W].map(([n, w]): [string, P] => [n, [w[4], w[5]]])),
			frame: !!fit.frame,
			skeleton,
		},
	};
}
