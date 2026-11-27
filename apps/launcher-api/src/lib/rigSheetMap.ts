/**
 * 🗺 From my sheet (docs/design/frame-to-rig.md §13): an artist's own sheet, its regions named and
 * drawn as the artist drew them, mapped to a rig template's parts. Pure, so the Rigger page (through
 * `vendor/rigger-motion.js`) and the launcher (`server/rigSheetFit.ts`) read one definition:
 *
 * - **Joints.** Each part is placed on its bones by its joints on the drawing: a limb by the start
 *   and end of its bone (shoulder and elbow), the torso by its hips, its collar and its shoulders, the
 *   head by where it turns on the neck and the face's middle, anything else by one pivot on its bone.
 *   Two drawings that meet share a bone there (the arm's shoulder is the torso's), so they meet in
 *   the rig.
 * - **Names.** A region's name is read as words (`L_arm_upper`, `arm_upper_left`, `ArmL1`,
 *   `head_front`) and matched to the template's parts; an exact name wins.
 * - **Guesses.** A part's joints are guessed from its drawing's shape (a limb's long axis, the
 *   head's bottom middle), and from the face the tracker finds on a drawn head.
 * - **Arranged.** The drawings put together on a canvas into the character as drawn (`arrange`),
 *   each part's first joint snapping to the one it meets on the part it hangs from: the rig is
 *   bound in that pose, as a frame's is.
 */

import { armTail, inDrawOrder, withSlotPlaces, type SlotPlace } from './rigSlotOrder';

export type P = [number, number];

/** A template part mapped to a region: its joints in the region's pixels (y down, untrimmed). */
export interface SheetPartMap {
	region: string;
	joints: Record<string, P>;
	/** The face mesh the tracker found on a drawn head (478 points, region pixels). */
	face?: P[];
}

/**
 * A region worn as a prop: on `host`'s drawing with its middle at `at` (host pixels), on `bone`;
 * `turn`, degrees clockwise on the page against its host's drawing (none: turned as its host).
 * `custom`: a part the template does not have (＋ Custom part), named freely (`CUSTOM_NAME`): a new
 * bone of its own under `bone`, placed and drawn as a prop is.
 */
export interface SheetProp {
	name: string;
	region: string;
	host: string;
	bone: string;
	at: P;
	turn?: number;
	custom?: true;
}

/** A custom part's name: a lowercase letter, then up to 40 lowercase letters, digits or _. */
export const CUSTOM_NAME = /^[a-z][a-z0-9_]{0,40}$/;

/**
 * A custom part's name from its region's, past a Photoshop layer's file and index
 * (`Nelly_0008_HoodBack` → `hood_back`).
 */
export function customName(region: string): string {
	const base = nameWords(layerName(region)).join('_').slice(0, 41);
	return /^[a-z]/.test(base) ? base : `part_${base}`.slice(0, 41);
}

/** A region's own name past a Photoshop Export Layers file and index (`Nelly_0002s_0000_Glasses` → `Glasses`). */
export function layerName(region: string): string {
	return /(?:^|_)(?:\d{4}s_)*\d{4}_(.+)$/.exec(region)?.[1] ?? region;
}

/**
 * A drawing put on the arrange canvas (sheet pixels, y down): its middle (of the untrimmed region)
 * at `at`, turned `turn` degrees clockwise on the page.
 */
export interface SheetPlace {
	at: P;
	turn: number;
}

/** What a rig made from a sheet keeps in its bundle's `sheet.json`, and what a create sends. */
export interface SheetMapping {
	sheet: 1;
	manifestKey: string;
	/** `modules`: the template's modules off their default (docs/design/rig-modules.md). */
	template: { id: string; version: number; modules?: Record<string, string> };
	parts: Record<string, SheetPartMap>;
	props: SheetProp[];
	/** Rig units per sheet pixel, set by hand; none = the torso's shoulders against the template's. */
	scale?: number;
	/**
	 * The main drawings arranged into the character as the artist drew it, by part: the rig's
	 * `frame` clip is that pose, and every part is bound there. None: each drawing turned onto its
	 * bones at rest.
	 */
	arrange?: Record<string, SheetPlace>;
	/**
	 * The sheet names sides as the character's own left and right (`UpperArmL`, the arm on the
	 * picture's right of a character facing the viewer), the template's `_l` being the picture's
	 * left: its names are read mirrored. None: as the template's.
	 */
	swapSides?: true;
	/**
	 * The author's layers: the slots the mapping draws in (each mapped part's, each prop's), FRONT to
	 * back, drawn in that order in the places they hold between them (`sheetSlotOrder`). None: the
	 * template's order, each prop over its part (or behind it where the artist's file says so).
	 */
	layers?: string[];
	/**
	 * The head turn's strength (`rigHeadTurn.ts`): the drawn head turns round with a 3D capture's
	 * yaw and nod and with the Head turn and Head up / down controls, 1 as round as the template's
	 * head, 0 off (the face slides alone over a still head). None: 1.
	 */
	turn?: number;
}

export const SHEET_SIDECAR = 'sheet.json';

/** The kinds of part, by how they sit on their bones, and each one's joints in order. */
export const SHEET_JOINTS = {
	torso: ['hips', 'neck', 'shoulder_l', 'shoulder_r'],
	neck: ['base', 'top'],
	head: ['neck', 'face'],
	upper_arm: ['shoulder', 'elbow'],
	lower_arm: ['elbow', 'wrist'],
	hand: ['wrist', 'knuckle'],
	thigh: ['hip', 'knee'],
	shin: ['knee', 'ankle'],
	pivot: ['pivot'],
} as const satisfies Record<string, readonly string[]>;
export type SheetKind = keyof typeof SHEET_JOINTS;

/** What each kind's joints are, for their dots' tooltips. */
export const SHEET_JOINT_LABELS: Record<SheetKind, Record<string, string>> = {
	torso: {
		hips: 'the hips’ middle',
		neck: 'where the neck meets the body (the collar’s middle)',
		shoulder_l: 'the shoulder on the picture’s left',
		shoulder_r: 'the shoulder on the picture’s right',
	},
	neck: { base: 'where the neck meets the body', top: 'where the head turns (the jaw’s middle)' },
	head: {
		neck: 'where the head turns on the neck (the jaw’s middle)',
		face: 'the face’s middle, a little under the eyes',
	},
	upper_arm: { shoulder: 'the shoulder', elbow: 'the elbow' },
	lower_arm: { elbow: 'the elbow', wrist: 'the wrist' },
	hand: { wrist: 'the wrist', knuckle: 'the middle finger’s knuckle' },
	thigh: { hip: 'the hip', knee: 'the knee' },
	shin: { knee: 'the knee', ankle: 'the ankle' },
	pivot: { pivot: 'where it sits on its bone' },
};

/**
 * The kind of a template part, by the slot it is drawn in: a hand pose or a drawing by angle sits
 * in its main part's slot (`hand_l_fist` and `hand_l_3q_l` in `hand_l`), so it is placed as that is.
 */
export function sheetKind(slot: string): SheetKind {
	const base = slot.replace(/_[lr]$/, '');
	return base in SHEET_JOINTS && base !== 'pivot' ? (base as SheetKind) : 'pivot';
}

/** The body side of a slot (`_l`, the picture's left), or null. */
export const sheetSide = (slot: string): 'l' | 'r' | null =>
	(/_([lr])$/.exec(slot)?.[1] as 'l' | 'r' | undefined) ?? null;

/**
 * A part's or bone's name mirrored, every side in it the other way round (`upper_arm_l` ↔
 * `upper_arm_r`, `hand_l_3q_r` ↔ `hand_r_3q_l`), or null for a name with no side.
 */
export function mirroredName(name: string): string | null {
	const words = name.split('_');
	const out = words.map((w) => (w === 'l' ? 'r' : w === 'r' ? 'l' : w));
	return out.some((w, i) => w !== words[i]) ? out.join('_') : null;
}

/**
 * Where a part's first joint meets the part it hangs from, by kind (`_s` its side): the joints it
 * snaps to on the arrange canvas, the first mapped one taken (a head on the drawn neck's top, else
 * on the torso's collar).
 */
const SHEET_SNAP: Partial<Record<SheetKind, [string, string][]>> = {
	neck: [['torso', 'neck']],
	head: [
		['neck', 'top'],
		['torso', 'neck'],
	],
	upper_arm: [['torso', 'shoulder_s']],
	lower_arm: [['upper_arm_s', 'elbow']],
	hand: [['lower_arm_s', 'wrist']],
	shin: [['thigh_s', 'knee']],
};

/** The parts and joints a part's first joint snaps to on the arrange canvas, nearest first. */
export function sheetSnapTargets(kind: SheetKind, side: 'l' | 'r' | null): [string, string][] {
	const s = side ?? 'l';
	return (SHEET_SNAP[kind] ?? []).map(([part, joint]) => [
		part.replace(/_s$/, `_${s}`),
		joint.replace(/_s$/, `_${s}`),
	]);
}

// ---- names -----------------------------------------------------------------------------------------

/** A word an artist may write, as the word the template's names use. */
const SYNONYMS: Record<string, string[]> = {
	left: ['l'],
	lft: ['l'],
	lt: ['l'],
	izq: ['l'],
	izquierda: ['l'],
	izquierdo: ['l'],
	sx: ['l'],
	right: ['r'],
	rgt: ['r'],
	rt: ['r'],
	der: ['r'],
	derecha: ['r'],
	derecho: ['r'],
	dx: ['r'],
	arms: ['arm'],
	brazo: ['arm'],
	up: ['upper'],
	top: ['upper'],
	bicep: ['arm', 'upper'],
	biceps: ['arm', 'upper'],
	humerus: ['arm', 'upper'],
	upperarm: ['arm', 'upper'],
	low: ['lower'],
	bottom: ['lower'],
	bot: ['lower'],
	fore: ['lower'],
	forearm: ['arm', 'lower'],
	lowerarm: ['arm', 'lower'],
	antebrazo: ['arm', 'lower'],
	hands: ['hand'],
	palm: ['hand'],
	mano: ['hand'],
	legs: ['leg'],
	pierna: ['leg'],
	thigh: ['leg', 'upper'],
	femur: ['leg', 'upper'],
	upperleg: ['leg', 'upper'],
	muslo: ['leg', 'upper'],
	shin: ['leg', 'lower'],
	calf: ['leg', 'lower'],
	lowerleg: ['leg', 'lower'],
	feet: ['foot'],
	shoe: ['foot'],
	boot: ['foot'],
	pie: ['foot'],
	skull: ['head'],
	cabeza: ['head'],
	cuello: ['neck'],
	body: ['torso'],
	chest: ['torso'],
	trunk: ['torso'],
	ribcage: ['torso'],
	shirt: ['torso'],
	cuerpo: ['torso'],
	tronco: ['torso'],
	hip: ['pelvis'],
	hips: ['pelvis'],
	waist: ['pelvis'],
	belt: ['pelvis'],
	cadera: ['pelvis'],
	ears: ['ear'],
	oreja: ['ear'],
	eyes: ['eye'],
	eyeball: ['eye', 'white'],
	sclera: ['eye', 'white'],
	iris: ['pupil'],
	eyebrow: ['brow'],
	eyebrows: ['brow'],
	brows: ['brow'],
	ceja: ['brow'],
	eyelid: ['lid'],
	lids: ['lid'],
	lips: ['mouth'],
	boca: ['mouth'],
	under: ['lower'],
	labio: ['lip'],
	tooth: ['teeth'],
	diente: ['teeth'],
	dientes: ['teeth'],
	lengua: ['tongue'],
	superior: ['upper'],
	inferior: ['lower'],
	arriba: ['upper'],
	abajo: ['lower'],
	nariz: ['nose'],
	fringe: ['hair', 'front'],
	bangs: ['hair', 'front'],
	behind: ['back'],
	rear: ['back'],
	pad: ['shoulder'],
	hombro: ['shoulder'],
	thumbs: ['thumbs'],
	profile: ['side'],
	threequarter: ['3q'],
};
/** The template's words for a limb's segments, which `1` and `2` stand for after it. */
const SEGMENTED: Record<string, [string, string]> = {
	arm: ['upper', 'lower'],
	leg: ['upper', 'lower'],
};
/** The template's own names for a leg's segments, as the words above read them. */
const PART_WORDS: Record<string, string[]> = {
	thigh: ['leg', 'upper'],
	shin: ['leg', 'lower'],
	foot: ['foot'],
};
/**
 * Words that say what a drawing is (a body part, a pose, an angle): a region's word of these the
 * part does not have counts against it (a `hand_fist` is not `hand_l`'s main drawing).
 */
const MEANINGFUL = new Set([
	'arm',
	'upper',
	'lower',
	'hand',
	'leg',
	'foot',
	'head',
	'neck',
	'torso',
	'pelvis',
	'hair',
	'back',
	'front',
	'ear',
	'eye',
	'white',
	'pupil',
	'brow',
	'lid',
	'mouth',
	'nose',
	'cheek',
	'shoulder',
	'eyelid',
	'lip',
	'teeth',
	'tongue',
	'fist',
	'point',
	'open',
	'thumbs',
	'3q',
	'side',
	'closed',
	'angry',
	'sad',
	'neutral',
	'thumb',
	'index',
	'middle',
	'ring',
	'pinky',
]);
/** The words that name what a part is: a region must have its part's. */
const KINDS = [
	'arm',
	'hand',
	'leg',
	'foot',
	'head',
	'neck',
	'torso',
	'pelvis',
	'hair',
	'ear',
	'eye',
	'pupil',
	'brow',
	'lid',
	'mouth',
	'lip',
	'teeth',
	'tongue',
	'nose',
	'cheek',
	'shoulder',
	'thumb',
	'index',
	'middle',
	'ring',
	'pinky',
];

/** The side a word names (`l`, `left`, `izq`, `sx` …), as the template's, or null. */
function sideOf(word: string): 'l' | 'r' | null {
	if (word === 'l' || word === 'r') return word;
	const c = SYNONYMS[word];
	return c?.length === 1 && (c[0] === 'l' || c[0] === 'r') ? c[0] : null;
}
/**
 * A name's words with its sides the other way round when `swap` (a sheet naming the character's
 * own): `l` and `r`, `left` and `right`, any other side word as the other side's letter.
 */
function sidesRead(words: string[], swap: boolean): string[] {
	if (!swap) return words;
	const other: Record<string, string> = { l: 'r', r: 'l', left: 'right', right: 'left' };
	return words.map((w) => other[w] ?? (sideOf(w) === 'l' ? 'r' : sideOf(w) === 'r' ? 'l' : w));
}

/** A name as its words: `L_armUpper2` → l, arm, upper, 2. */
export function nameWords(name: string): string[] {
	return name
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Za-z])(\d)/g, '$1 $2')
		.replace(/(\d)([A-Za-z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/**
 * A name's words as the template's: synonyms read, `arm 1` (`ArmL1`, `brazo_izq_2`) a segment, its
 * sides the other way round with `swap`.
 */
export function canonicalWords(name: string, swap = false): Set<string> {
	const out = new Set<string>();
	const words = sidesRead(nameWords(name), swap);
	for (const w of words) for (const c of PART_WORDS[w] ?? SYNONYMS[w] ?? [w]) out.add(c);
	const limb = Object.keys(SEGMENTED).filter((k) => out.has(k));
	const digit = words.find((w) => w === '1' || w === '2');
	if (limb.length === 1 && digit && !out.has('upper') && !out.has('lower'))
		out.add(SEGMENTED[limb[0]][Number(digit) - 1]);
	// Teeth named alone are the upper ones, the row a closed mouth shows.
	if (out.has('teeth') && !out.has('upper') && !out.has('lower')) out.add('upper');
	// An eye named alone is its white: the drawing the pupil and the lids sit on.
	if (out.has('eye') && !['white', 'pupil', 'lid', 'brow'].some((w) => out.has(w)))
		out.add('white');
	// `3 q` (from `3q`) is one word in the template's names.
	if (words.some((w, i) => w === '3' && words[i + 1] === 'q')) out.add('3q');
	return out;
}

const plain = (name: string, swap = false) => sidesRead(nameWords(name), swap).join('_');

/**
 * How well a region's name fits a template part's, 0 for not at all: the part's kind word must be
 * there, its side must not be the other one, and every word that says what the part is must match.
 * An exact name (any case, any separators) beats every other. With `swap` the region's sides are
 * read the other way round (`SheetMapping.swapSides`).
 */
export function nameScore(part: string, region: string, swap = false): number {
	if (plain(part) === plain(region, swap)) return 10;
	const want = canonicalWords(part);
	const have = canonicalWords(region, swap);
	const kind = KINDS.find((k) => want.has(k));
	if (!kind || !have.has(kind)) return 0;
	const side = want.has('l') ? 'l' : want.has('r') ? 'r' : null;
	const other = side === 'l' ? 'r' : side === 'r' ? 'l' : null;
	if (other && have.has(other) && !have.has(side!)) return 0;
	let got = 0;
	let need = 0;
	for (const w of want) {
		if (w === 'l' || w === 'r') continue;
		need++;
		if (have.has(w)) got++;
		else if (MEANINGFUL.has(w)) return 0;
	}
	let score = need ? got / need : 0;
	if (side && !have.has(side)) score *= 0.5;
	for (const w of have) if (MEANINGFUL.has(w) && !want.has(w)) score -= 0.15;
	return Math.max(0, score);
}

/**
 * Each template part's best region by name, one region to one part: the pairs are taken best first.
 * `parts` in the template's order; a part no region fits is left out. `swap`: the regions name
 * the character's own sides (`nameScore`).
 */
export function suggestSheetMap(
	parts: readonly string[],
	regions: readonly string[],
	swap = false,
): Record<string, string> {
	const pairs: { part: string; region: string; score: number; at: number }[] = [];
	parts.forEach((part, at) => {
		for (const region of regions) {
			const score = nameScore(part, region, swap);
			if (score > 0.3) pairs.push({ part, region, score, at });
		}
	});
	pairs.sort((a, b) => b.score - a.score || a.at - b.at || a.region.localeCompare(b.region));
	const out: Record<string, string> = {};
	const taken = new Set<string>();
	for (const p of pairs) {
		if (out[p.part] || taken.has(p.region)) continue;
		out[p.part] = p.region;
		taken.add(p.region);
	}
	return out;
}

/** Words naming a worn thing, and the part it is worn on (`_s` the side the name says, else `l`). */
const PROP_HOSTS: [string[], string][] = [
	[['hat', 'cap', 'helmet', 'crown', 'glasses', 'sunglasses', 'earring', 'mask'], 'head'],
	// A hood is a hoodie's, worn down over the shoulders (one worn up is moved to the head in Props).
	[['chain', 'necklace', 'pendant', 'scarf', 'tie', 'badge', 'medal', 'hood'], 'torso'],
	[['watch', 'bracelet', 'bangle', 'cuff'], 'lower_arm_s'],
	[['sword', 'weapon', 'gun', 'staff', 'wand', 'shield', 'ring', 'cup', 'flag', 'axe'], 'hand_s'],
];

/**
 * The 🗺 dialog's first guess for a sheet: each template part's region by name (`suggestSheetMap`),
 * each other region named like a worn thing as a prop on its part (`suggestProp`), and the regions
 * left, which the dialog offers as ＋ Custom parts.
 */
export function suggestSheet(
	parts: readonly string[],
	regions: readonly string[],
	swap = false,
): {
	parts: Record<string, string>;
	props: { region: string; name: string; host: string }[];
	left: string[];
} {
	const got = suggestSheetMap(parts, regions, swap);
	const taken = new Set(Object.values(got));
	const mapped = new Set(Object.keys(got));
	const props: { region: string; name: string; host: string }[] = [];
	const left: string[] = [];
	for (const region of regions) {
		if (taken.has(region)) continue;
		const p = suggestProp(region, mapped, swap);
		if (p) props.push({ region, ...p });
		else left.push(region);
	}
	return { parts: got, props, left };
}

/**
 * A region named like a worn thing (`Hat_01`, `sword_R`): its prop name and the part it is on (its
 * side read the other way round with `swap`).
 */
export function suggestProp(
	region: string,
	mapped: ReadonlySet<string>,
	swap = false,
): { name: string; host: string } | null {
	const words = canonicalWords(region, swap);
	const side = words.has('r') ? 'r' : 'l';
	const host = PROP_HOSTS.find(([names]) => names.some((n) => words.has(n)))?.[1];
	if (!host) return null;
	// On the side the name says, else on the other one if only that one is mapped.
	const on = [host.replace(/_s$/, `_${side}`), host.replace(/_s$/, `_${side === 'l' ? 'r' : 'l'}`)];
	const part = on.find((p) => mapped.has(p));
	return part ? { name: propName(region), host: part } : null;
}

/** A prop's name from its region's (`prop_` and up to 40 lowercase letters, digits and _). */
export function propName(region: string): string {
	const base =
		nameWords(layerName(region))
			.join('_')
			.replace(/^prop_?/, '')
			.slice(0, 40) || 'item';
	return `prop_${base}`;
}

// ---- the draw order ----------------------------------------------------------------------------

/**
 * The layer a region was exported from by Photoshop's Export Layers (`<file>_0002s_0003s_0001_Lid`:
 * the third set's fourth set's second layer), each index counted from the top of the layers panel,
 * so a lower one is drawn in front. Sets (`0002s`) and layers (`0002`) are counted apart, so only
 * two layers of one set compare; null for a name that is not one.
 */
export function psdLayer(name: string): string[] | null {
	const m = /(?:^|_)((?:\d{4}s_)*\d{4})_./.exec(name);
	return m ? m[1].split('_') : null;
}

/**
 * Whether the artist's file draws region `a` behind region `b`: known only for two layers of one
 * set (or both at the top), whose indices are counted together; null otherwise.
 */
export function psdBehind(a: string, b: string): boolean | null {
	const [pa, pb] = [psdLayer(a), psdLayer(b)];
	if (!pa || !pb || pa.length !== pb.length || pa.join() === pb.join()) return null;
	const last = pa.length - 1;
	if (pa.slice(0, last).join() !== pb.slice(0, last).join()) return null;
	return parseInt(pa[last], 10) > parseInt(pb[last], 10);
}

/**
 * `list` with the layers of each set put back to front among the places they hold (`psdBehind`);
 * anything the file does not order keeps its place.
 */
function psdOrdered<T>(list: readonly T[], region: (x: T) => string): T[] {
	const out = [...list];
	const sets = new Map<string, number[]>();
	list.forEach((x, i) => {
		const layer = psdLayer(region(x));
		if (!layer) return;
		const set = `${layer.length}:${layer.slice(0, -1).join('_')}`;
		sets.set(set, [...(sets.get(set) ?? []), i]);
	});
	const index = (x: T) => parseInt(psdLayer(region(x))!.at(-1)!, 10);
	for (const at of sets.values()) {
		const backToFront = at.map((i) => list[i]).sort((a, b) => index(b) - index(a));
		at.forEach((i, k) => (out[i] = backToFront[k]));
	}
	return out;
}

/** A prop's slot drawn just before or after the slot it names, in the order they are inserted. */
export type SheetPropPlace = SlotPlace & { prop: SheetProp };

/** Worn over the hair, not under it: a prop on the head named so is drawn over `hair_front`. */
const OVER_HAIR = new Set(['hat', 'cap', 'helmet', 'crown']);

/**
 * Where each prop's slot goes among the template's `slots` (back to front), in the order they are
 * inserted: just over its host's slot (after an arm's last slot, so a watch covers the fingers'
 * seam; on the head over every face part — eye whites, pupils, lids, brows, nose, mouth — and under
 * the front hair, so glasses sit over the eyes, or over the hair for a hat), or just behind it where
 * the artist's file draws it behind its part (`psdBehind`); the props on one part keep the file's
 * order among themselves. `host` gives a mapped part's slot and region.
 */
export function sheetPropPlaces(
	slots: readonly string[],
	props: readonly SheetProp[],
	host: (part: string) => { slot: string; region: string },
): SheetPropPlace[] {
	const behind = (p: SheetProp) => psdBehind(p.region, host(p.host).region) === true;
	const backToFront = psdOrdered(props, (p) => p.region);
	const after = new Map<string, string>();
	const out: SheetPropPlace[] = [];
	for (const prop of [
		...backToFront.filter((q) => !behind(q)),
		...backToFront.filter(behind).reverse(),
	]) {
		const slot = host(prop.host).slot;
		const side = /^(hand|lower_arm)_([lr])$/.exec(slot)?.[2];
		const onFace = slot === 'head' && slots.includes('hair_front');
		const overHair = onFace && [...canonicalWords(prop.region)].some((w) => OVER_HAIR.has(w));
		const beside = side ? armTail(slots, side) : overHair ? 'hair_front' : slot;
		if (behind(prop)) {
			const key = `-${slot}`;
			out.push({ prop, name: prop.name, before: after.get(key) ?? slot });
			after.set(key, prop.name);
		} else if (onFace && !overHair) {
			out.push({ prop, name: prop.name, before: 'hair_front' });
		} else {
			out.push({ prop, name: prop.name, after: after.get(beside) ?? beside });
			after.set(beside, prop.name);
		}
	}
	return out;
}

/**
 * The slots a mapping makes, back to front: the template's `slots`, each prop's slot where
 * `sheetPropPlaces` puts it, then the author's `layers` (front to back) drawn in that order in the
 * places they hold. `slotOf` gives a template part's slot.
 */
export function sheetSlotOrder(
	slots: readonly string[],
	slotOf: (part: string) => string,
	m: Pick<SheetMapping, 'parts' | 'props' | 'layers'>,
): string[] {
	const host = (part: string) => ({ slot: slotOf(part), region: m.parts[part]?.region ?? '' });
	const made = withSlotPlaces(slots, sheetPropPlaces(slots, m.props, host));
	return m.layers ? inDrawOrder(made, [...m.layers].reverse()) : made;
}

/**
 * The slots a mapping draws in (each mapped part's, each prop's), FRONT to back as the 🗺 dialog's
 * Layers list shows them: the order the rig is made with (`sheetSlotOrder`).
 */
export function sheetLayerList(
	slots: readonly string[],
	slotOf: (part: string) => string,
	m: Pick<SheetMapping, 'parts' | 'props' | 'layers'>,
): string[] {
	const drawn = new Set([...Object.keys(m.parts).map(slotOf), ...m.props.map((p) => p.name)]);
	return sheetSlotOrder(slots, slotOf, m)
		.filter((n) => drawn.has(n))
		.reverse();
}

// ---- joints from a drawing's shape ---------------------------------------------------------------

/** A drawing's opaque pixels, as the guesses read it. */
export interface SheetMask {
	w: number;
	h: number;
	/** Alpha per pixel, row by row. */
	alpha: ArrayLike<number>;
}

const OPAQUE = 96;

/** The opaque pixels' middle and long axis, and how far they reach along and across it. */
function shapeOf(m: SheetMask) {
	let n = 0;
	let sx = 0;
	let sy = 0;
	for (let y = 0; y < m.h; y++)
		for (let x = 0; x < m.w; x++)
			if (m.alpha[y * m.w + x] >= OPAQUE) {
				n++;
				sx += x + 0.5;
				sy += y + 0.5;
			}
	if (!n) return null;
	const c: P = [sx / n, sy / n];
	let xx = 0;
	let yy = 0;
	let xy = 0;
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;
	for (let y = 0; y < m.h; y++)
		for (let x = 0; x < m.w; x++)
			if (m.alpha[y * m.w + x] >= OPAQUE) {
				const [dx, dy] = [x + 0.5 - c[0], y + 0.5 - c[1]];
				xx += dx * dx;
				yy += dy * dy;
				xy += dx * dy;
				top = Math.min(top, y);
				bottom = Math.max(bottom, y + 1);
				left = Math.min(left, x);
				right = Math.max(right, x + 1);
			}
	const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
	const axis: P = [Math.cos(angle), Math.sin(angle)];
	const across: P = [-axis[1], axis[0]];
	// Each opaque pixel by its place along the axis, in bins: how far across it reaches there.
	const along = (x: number, y: number) => (x - c[0]) * axis[0] + (y - c[1]) * axis[1];
	const side = (x: number, y: number) => (x - c[0]) * across[0] + (y - c[1]) * across[1];
	let lo = Infinity;
	let hi = -Infinity;
	for (let y = 0; y < m.h; y++)
		for (let x = 0; x < m.w; x++)
			if (m.alpha[y * m.w + x] >= OPAQUE) {
				const t = along(x + 0.5, y + 0.5);
				lo = Math.min(lo, t);
				hi = Math.max(hi, t);
			}
	const BINS = 24;
	const span = Math.max(hi - lo, 1e-6);
	const minS = new Array<number>(BINS).fill(Infinity);
	const maxS = new Array<number>(BINS).fill(-Infinity);
	for (let y = 0; y < m.h; y++)
		for (let x = 0; x < m.w; x++)
			if (m.alpha[y * m.w + x] >= OPAQUE) {
				const t = along(x + 0.5, y + 0.5);
				const b = Math.min(BINS - 1, Math.floor(((t - lo) / span) * BINS));
				const s = side(x + 0.5, y + 0.5);
				minS[b] = Math.min(minS[b], s);
				maxS[b] = Math.max(maxS[b], s);
			}
	/** Across the shape at `f` of the way along it (0 at `lo`): its width and its middle. */
	const slice = (f: number) => {
		const b = Math.min(BINS - 1, Math.max(0, Math.floor(f * BINS)));
		for (let k = 0; k < BINS; k++)
			for (const j of [b - k, b + k])
				if (j >= 0 && j < BINS && minS[j] <= maxS[j])
					return { width: maxS[j] - minS[j], mid: (maxS[j] + minS[j]) / 2 };
		return { width: 0, mid: 0 };
	};
	const point = (t: number, s: number): P => [
		c[0] + axis[0] * t + across[0] * s,
		c[1] + axis[1] * t + across[1] * s,
	];
	return { c, axis, lo, hi, span, slice, point, box: { top, bottom, left, right } };
}

/**
 * A limb's ends along its long axis: the middle of each end's round cap, and the far end's tip; the
 * start is the end nearer the body.
 */
function limbEnds(m: SheetMask, side: 'l' | 'r' | null): { start: P; end: P; tip: P } | null {
	const s = shapeOf(m);
	if (!s) return null;
	const cap = (first: boolean) => {
		const cut = s.slice(first ? 0.08 : 0.92);
		const inset = Math.min(cut.width / 2, 0.2 * s.span);
		return {
			cap: s.point(first ? s.lo + inset : s.hi - inset, cut.mid),
			tip: s.point(first ? s.lo : s.hi, cut.mid),
		};
	};
	const [a, b] = [cap(true), cap(false)];
	// Drawn standing up, the start is the top end; lying down, it is the end nearer the body: the
	// right end of a limb on the picture's left.
	const upright = Math.abs(s.axis[1]) >= Math.abs(s.axis[0]);
	const aFirst = upright
		? a.cap[1] <= b.cap[1]
		: side === 'r'
			? a.cap[0] <= b.cap[0]
			: a.cap[0] >= b.cap[0];
	const [start, far] = aFirst ? [a, b] : [b, a];
	return { start: start.cap, end: far.cap, tip: far.tip };
}

/** A hand's knuckles lie this share of the way from its wrist to its fingertips. */
const KNUCKLE_SHARE = 0.55;
const HIPS_UP = 0.04;
const SHOULDER_DOWN = 0.1;
const SHOULDER_IN = 0.05;
const COLLAR_DOWN = 0.06;
const JAW_UP = 0.07;
const FACE_UP = 0.4;
/** A drawn neck runs under the chin and into the collar: its joints lie these shares in. */
const NECK_TOP = 0.2;
const NECK_BASE = 0.6;

/**
 * A part's joints guessed from its drawing (region pixels, y down): a limb along its long axis, the
 * start at the end nearer the body; the hand's knuckle half way along it; the torso's hips at its
 * bottom middle and its shoulders in from its top corners; the neck's ends; the head turning at its
 * bottom middle, its face a little under half way up; else one pivot at the drawing's middle.
 */
export function guessSheetJoints(
	kind: SheetKind,
	side: 'l' | 'r' | null,
	m: SheetMask,
): Record<string, P> {
	const centre: P = [m.w / 2, m.h / 2];
	const s = shapeOf(m);
	if (!s) return Object.fromEntries(SHEET_JOINTS[kind].map((j) => [j, centre]));
	const { top, bottom, left, right } = s.box;
	const bh = bottom - top;
	const r = (p: P): P => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
	/** The middle of the opaque pixels on row `y`, or the box's middle. */
	const rowMid = (y: number): number => {
		const row = Math.min(m.h - 1, Math.max(0, Math.round(y)));
		let a = Infinity;
		let b = -Infinity;
		for (let x = 0; x < m.w; x++)
			if (m.alpha[row * m.w + x] >= OPAQUE) {
				a = Math.min(a, x);
				b = Math.max(b, x + 1);
			}
		return a <= b ? (a + b) / 2 : (left + right) / 2;
	};
	/** The opaque pixels' reach on row `y`. */
	const rowSpan = (y: number): [number, number] => {
		const row = Math.min(m.h - 1, Math.max(0, Math.round(y)));
		let a = Infinity;
		let b = -Infinity;
		for (let x = 0; x < m.w; x++)
			if (m.alpha[row * m.w + x] >= OPAQUE) {
				a = Math.min(a, x);
				b = Math.max(b, x + 1);
			}
		return a <= b ? [a, b] : [left, right];
	};
	switch (kind) {
		case 'upper_arm':
		case 'lower_arm':
		case 'thigh':
		case 'shin': {
			const e = limbEnds(m, side);
			const [j0, j1] = SHEET_JOINTS[kind];
			return { [j0]: r(e?.start ?? centre), [j1]: r(e?.end ?? centre) };
		}
		case 'hand': {
			const e = limbEnds(m, side);
			if (!e) return { wrist: centre, knuckle: centre };
			const k: P = [
				e.start[0] + (e.tip[0] - e.start[0]) * KNUCKLE_SHARE,
				e.start[1] + (e.tip[1] - e.start[1]) * KNUCKLE_SHARE,
			];
			return { wrist: r(e.start), knuckle: r(k) };
		}
		case 'torso': {
			const y = top + SHOULDER_DOWN * bh;
			const [a, b] = rowSpan(y);
			const inset = SHOULDER_IN * (b - a);
			const hipsY = bottom - HIPS_UP * bh;
			// The collar between the shoulders: a row's ink there may reach out to a drawn shoulder.
			return {
				hips: r([rowMid(hipsY), hipsY]),
				neck: r([(a + b) / 2, top + COLLAR_DOWN * bh]),
				shoulder_l: r([a + inset, y]),
				shoulder_r: r([b - inset, y]),
			};
		}
		case 'neck': {
			const [yb, yt] = [top + NECK_BASE * bh, top + NECK_TOP * bh];
			return { base: r([rowMid(yb), yb]), top: r([rowMid(yt), yt]) };
		}
		case 'head': {
			const yn = bottom - JAW_UP * bh;
			const x = rowMid(yn);
			return { neck: r([x, yn]), face: r([x, yn - FACE_UP * bh]) };
		}
		default:
			return { pivot: r([(left + right) / 2, (top + bottom) / 2]) };
	}
}

/** The face mesh points the head's joints are read from: each eye's corners, the jaw and the chin. */
const EYE_L = [33, 133];
const EYE_R = [263, 362];
const JAW = [172, 397, 152];
/** The template's face bone sits this share of the eyes' distance below the eyes (20 of 90). */
const FACE_BELOW_EYES = 20 / 90;

/**
 * A drawn head's joints from the face the tracker found on it (region pixels): its face bone sits
 * under the eyes as the template's does (scaled to the drawn eyes), and it turns on the jaw's middle
 * taken along the face's own up through the face bone (frame-to-rig §12 F2e).
 */
export function faceJoints(face: readonly P[]): { neck: P; face: P } | null {
	if (face.length < 468) return null;
	const mean = (ks: number[]): P => [
		ks.reduce((s, k) => s + face[k][0], 0) / ks.length,
		ks.reduce((s, k) => s + face[k][1], 0) / ks.length,
	];
	const [l, rr] = [mean(EYE_L), mean(EYE_R)];
	const eyes: P = [(l[0] + rr[0]) / 2, (l[1] + rr[1]) / 2];
	const d: P = [rr[0] - l[0], rr[1] - l[1]];
	const apart = Math.hypot(d[0], d[1]);
	if (!(apart > 1e-6)) return null;
	// Down the face: the eyes' line turned a quarter (y is down in the picture).
	const down: P = [-d[1] / apart, d[0] / apart];
	const jaw = mean(JAW);
	const f: P = [
		eyes[0] + down[0] * FACE_BELOW_EYES * apart,
		eyes[1] + down[1] * FACE_BELOW_EYES * apart,
	];
	const drop = (jaw[0] - f[0]) * down[0] + (jaw[1] - f[1]) * down[1];
	if (drop <= 0) return null;
	const r = (p: P): P => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
	return { neck: r([f[0] + down[0] * drop, f[1] + down[1] * drop]), face: r(f) };
}
