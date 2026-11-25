/**
 * A rig's control layer, `controls.json` (docs/design/rig-controls.md §5.7): what makes a bone a
 * control — its role, shape, colour, size, display, channel locks and limits — plus hidden and
 * locked bones, layers, selection sets, limbs (FK / IK and their spaces), the constraint presets,
 * mirror pairs, the picker's layout and the Slots list's own slot groups. Pure (no R2, no DOM), so the save path and the Rigger page
 * run the same code. No game, export or runtime reads it: the control BONES and constraints are in
 * the irig, and deleting the sidecar loses the shapes, never a pose.
 *
 * Strict on write (`controlsDocProblems`, `controlsIrigProblems`), lenient on read (`fitControls`
 * drops what names a bone, constraint or slot the irig no longer has, with a notice). A rename in the
 * irig follows into it (`renamesBetween` + `renameControls`).
 */

export const CONTROLS_SIDECAR = 'controls.json';
export const CONTROLS_VERSION = 1;

export const CONTROL_ROLES = ['deform', 'control', 'helper'] as const;
export const CONTROL_SHAPES = [
	'circle',
	'ring',
	'square',
	'diamond',
	'arrow',
	'cross',
	'box',
	'polyline',
] as const;
/** The channels a control may key; tilt, twist and depth are a 3D rig's (2.5D P3b). */
export const CONTROL_CHANNELS = ['translate', 'rotate', 'scale', 'tilt', 'twist', 'depth'] as const;
export const CONTROL_DISPLAYS = ['stage', 'picker', 'both'] as const;
/** A limit per channel the gizmo keys; translate and scale per axis. */
export const CONTROL_LIMITS = [
	'rotate',
	'x',
	'y',
	'scaleX',
	'scaleY',
	'tilt',
	'twist',
	'depth',
] as const;
/** §4.4: each preset writes one native constraint, of this kind. */
export const CONSTRAINT_PRESETS = {
	aim: 'ik',
	look: 'transform',
	orient: 'transform',
	copyLocation: 'transform',
	copyScale: 'transform',
	childOf: 'transform',
	twoBoneIk: 'ik',
	splineIk: 'path',
	jiggle: 'physics',
} as const;

export type ControlRole = (typeof CONTROL_ROLES)[number];
export type ControlShape = (typeof CONTROL_SHAPES)[number];
export type ControlChannel = (typeof CONTROL_CHANNELS)[number];
export type ControlLimit = (typeof CONTROL_LIMITS)[number];
export type ConstraintPreset = keyof typeof CONSTRAINT_PRESETS;
export type ConstraintKind = 'ik' | 'transform' | 'path' | 'physics';

export interface ControlBone {
	/** Absent = `deform` (art hangs on it). An FK control is a deform bone with a shape. */
	role?: ControlRole;
	shape?: ControlShape;
	/** An arrow's ways: 1, 2 or 4. */
	ways?: 1 | 2 | 4;
	/** A box's axes: a 1D or a 2D slider (a face board). */
	axes?: 1 | 2;
	/** A polyline's points, in the bone's frame. */
	points?: [number, number][];
	/** `#rrggbb`. A bone's editor colour stays the irig's; this is the shape's. */
	colour?: string;
	size?: number;
	/** `screen` pixels (like the bone handles; the default) or `rig` units. */
	sizeIn?: 'screen' | 'rig';
	lineWidth?: number;
	filled?: boolean;
	/** The shape's offset and turn (degrees) from the bone. */
	offset?: [number, number];
	turn?: number;
	/**
	 * Where the control shows: on the stage and as a picker button (absent, or `both`), on the stage
	 * only, or in the picker only (a switch with no place on the body).
	 */
	display?: (typeof CONTROL_DISPLAYS)[number];
	/** The channels the gizmo may key; the rest are locked. Absent = all. */
	channels?: ControlChannel[];
	/** [min, max] per channel, clamping what a drag keys. Nothing limits at runtime. */
	limits?: Partial<Record<ControlLimit, [number, number]>>;
	hidden?: boolean;
	/** Not selectable on the stage. */
	locked?: boolean;
	/** One of `layers`. */
	layer?: string;
}

export interface ControlLayer {
	name: string;
	visible?: boolean;
	locked?: boolean;
}

/** One space a limb's control can follow (§4.5): a hidden space bone and its transform. */
export interface ControlSpace {
	bone: string;
	constraint: string;
}

/** A limb's FK / IK switch (§4.3): its IK, its FK bones, its control, pole and spaces. */
export interface ControlLimb {
	ik: string;
	/**
	 * Its IK is one of `rig3d.json`'s `ik` (solved in 3D by the bake, §6.2), not an IK constraint of
	 * the irig: the 3D data owns that name.
	 */
	ik3d?: boolean;
	fk: string[];
	control?: string;
	pole?: string;
	spaces?: Record<string, ControlSpace>;
}

/** A picker button: a bone, a selection set, or a limb's switch, at a place in [0, 1]². */
export interface ControlPickerItem {
	bone?: string;
	set?: string;
	limb?: string;
	at: [number, number];
	label?: string;
}

export interface ControlsDoc {
	controls: number;
	/** The stem of the `.irig` in this folder that the sidecar belongs to. */
	rig: string;
	/** The mark of the `.irig` text it was written with (set by the save, `pairMark`). */
	irig?: string;
	/** Per bone that is not a plain deform bone. */
	bones?: Record<string, ControlBone>;
	layers?: ControlLayer[];
	/** Selection sets: name → bones. */
	sets?: Record<string, string[]>;
	limbs?: Record<string, ControlLimb>;
	/** Constraint name → the preset that made it (§4.4); the preset names its kind. */
	presets?: Record<string, ConstraintPreset>;
	/** The mirror line (a bone; the root's x = 0 when absent) and overrides of the name rule. */
	mirror?: { line?: string; pairs?: Record<string, string> };
	picker?: { items?: ControlPickerItem[] };
	/** The Slots list's groups an author made: name → slots (each group's eye and view opacity). */
	slotGroups?: Record<string, string[]>;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── Schema ──────────────────────────────────────────────────────────────────────────────────────

type Check = (v: unknown, at: string, out: string[]) => void;

const num =
	(least?: number, above = false): Check =>
	(v, at, out) => {
		if (!finite(v)) out.push(`${at} must be a number`);
		else if (least !== undefined && (above ? v <= least : v < least))
			out.push(`${at} must be ${above ? 'above' : 'at least'} ${least}`);
	};
const name: Check = (v, at, out) => {
	if (typeof v !== 'string' || !v) out.push(`${at} must be a name`);
};
const text: Check = (v, at, out) => {
	if (typeof v !== 'string') out.push(`${at} must be text`);
};
const bool: Check = (v, at, out) => {
	if (typeof v !== 'boolean') out.push(`${at} must be true or false`);
};
const one =
	(...values: readonly (string | number)[]): Check =>
	(v, at, out) => {
		if (!values.includes(v as string | number))
			out.push(
				`${at} must be ${values.map((x) => (typeof x === 'string' ? `'${x}'` : x)).join(' or ')}`,
			);
	};
const list =
	(item: Check, least = 0): Check =>
	(v, at, out) => {
		if (!Array.isArray(v)) out.push(`${at} must be a list`);
		else if (v.length < least) out.push(`${at} must list at least ${least}`);
		else v.forEach((x, i) => item(x, `${at}[${i}]`, out));
	};
/** A list whose entries are all different. */
const names =
	(least = 0): Check =>
	(v, at, out) => {
		const before = out.length;
		list(name, least)(v, at, out);
		if (out.length === before && new Set(v as string[]).size !== (v as string[]).length)
			out.push(`${at} lists a name twice`);
	};
const map =
	(item: Check): Check =>
	(v, at, out) => {
		if (!isObj(v)) out.push(`${at} must be an object`);
		else for (const [k, x] of Object.entries(v)) item(x, `${at}.${k}`, out);
	};
const obj =
	(fields: Record<string, Check>, required: string[] = []): Check =>
	(v, at, out) => {
		if (!isObj(v)) {
			out.push(`${at} must be an object`);
			return;
		}
		for (const k of required) if (!Object.hasOwn(v, k)) out.push(`${at}.${k} is missing`);
		for (const [k, x] of Object.entries(v)) {
			const field = Object.hasOwn(fields, k) ? fields[k] : undefined;
			if (field) field(x, `${at}.${k}`, out);
			else out.push(`${at}.${k} is not a controls field`);
		}
	};
const xy: Check = (v, at, out) => {
	if (!(Array.isArray(v) && v.length === 2 && v.every(finite)))
		out.push(`${at} must be a pair of numbers [x, y]`);
};
const range: Check = (v, at, out) => {
	if (!(Array.isArray(v) && v.length === 2 && v.every(finite)))
		out.push(`${at} must be a range [min, max]`);
	else if (v[0] > v[1]) out.push(`${at} must not end before it starts`);
};
const unitXy: Check = (v, at, out) => {
	if (!(Array.isArray(v) && v.length === 2 && v.every((n) => finite(n) && n >= 0 && n <= 1)))
		out.push(`${at} must be a place [x, y] in 0…1`);
};
const colour: Check = (v, at, out) => {
	if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))
		out.push(`${at} must be a #rrggbb colour`);
};
const channels: Check = (v, at, out) => {
	const before = out.length;
	list(one(...CONTROL_CHANNELS))(v, at, out);
	if (out.length === before && new Set(v as string[]).size !== (v as string[]).length)
		out.push(`${at} lists a channel twice`);
};

const BONE = obj({
	role: one(...CONTROL_ROLES),
	shape: one(...CONTROL_SHAPES),
	ways: one(1, 2, 4),
	axes: one(1, 2),
	points: list(xy, 2),
	colour,
	size: num(0, true),
	sizeIn: one('screen', 'rig'),
	lineWidth: num(0, true),
	filled: bool,
	offset: xy,
	turn: num(),
	display: one(...CONTROL_DISPLAYS),
	channels,
	limits: obj(Object.fromEntries(CONTROL_LIMITS.map((l) => [l, range]))),
	hidden: bool,
	locked: bool,
	layer: name,
});
const SIDECAR = obj(
	{
		controls: num(),
		rig: name,
		irig: name,
		bones: map(BONE),
		layers: list(obj({ name, visible: bool, locked: bool }, ['name'])),
		sets: map(names()),
		limbs: map(
			obj(
				{
					ik: name,
					ik3d: bool,
					fk: names(1),
					control: name,
					pole: name,
					spaces: map(obj({ bone: name, constraint: name }, ['bone', 'constraint'])),
				},
				['ik', 'fk'],
			),
		),
		presets: map(one(...Object.keys(CONSTRAINT_PRESETS))),
		mirror: obj({ line: name, pairs: map(name) }),
		picker: obj({
			items: list(obj({ bone: name, set: name, limb: name, at: unitXy, label: text }, ['at'])),
		}),
		slotGroups: map(names(1)),
	},
	['controls', 'rig'],
);

/** The rules between fields, on a doc whose every field is known and well typed. */
function crossProblems(doc: ControlsDoc): string[] {
	const out: string[] = [];
	const at = `${CONTROLS_SIDECAR}`;
	const layers = new Set<string>();
	for (const [i, l] of (doc.layers ?? []).entries()) {
		if (layers.has(l.name)) out.push(`${at}.layers[${i}] names layer "${l.name}" twice`);
		layers.add(l.name);
	}
	const SHAPED = { ways: 'arrow', axes: 'box', points: 'polyline' } as const;
	for (const [b, c] of Object.entries(doc.bones ?? {})) {
		for (const [field, shape] of Object.entries(SHAPED))
			if (Object.hasOwn(c, field) && c.shape !== shape)
				out.push(`${at}.bones.${b}.${field} is only for a ${shape}`);
		if (c.shape === 'polyline' && !c.points)
			out.push(`${at}.bones.${b}.points is missing (a polyline draws its points)`);
		if (c.layer !== undefined && !layers.has(c.layer))
			out.push(`${at}.bones.${b}.layer "${c.layer}" is not one of the layers`);
	}
	const paired = new Set<string>();
	for (const [a, b] of Object.entries(doc.mirror?.pairs ?? {}))
		for (const n of a === b ? [a] : [a, b]) {
			if (paired.has(n)) out.push(`${at}.mirror.pairs pairs bone "${n}" twice`);
			paired.add(n);
		}
	for (const [i, item] of (doc.picker?.items ?? []).entries()) {
		const where = `${at}.picker.items[${i}]`;
		const what = (['bone', 'set', 'limb'] as const).filter((k) => item[k] !== undefined);
		if (what.length !== 1) out.push(`${where} must name one bone, set or limb`);
		if (item.set !== undefined && !Object.hasOwn(doc.sets ?? {}, item.set))
			out.push(`${where}.set "${item.set}" is not one of the sets`);
		if (item.limb !== undefined && !Object.hasOwn(doc.limbs ?? {}, item.limb))
			out.push(`${where}.limb "${item.limb}" is not one of the limbs`);
	}
	return out;
}

/** Why `value` is not a `controls.json` this launcher reads, or `[]`. */
export function controlsDocProblems(value: unknown): string[] {
	// A newer version is named as such, not by the fields this launcher does not know.
	const v = isObj(value) ? value.controls : undefined;
	if (finite(v) && v > CONTROLS_VERSION)
		return [
			`${CONTROLS_SIDECAR} is version ${v}, newer than this launcher reads (${CONTROLS_VERSION})`,
		];
	const out: string[] = [];
	SIDECAR(value, CONTROLS_SIDECAR, out);
	if (out.length) return out;
	if (v !== CONTROLS_VERSION) return [`${CONTROLS_SIDECAR}.controls must be ${CONTROLS_VERSION}`];
	return crossProblems(value as ControlsDoc);
}

// ── Against the irig: every name it uses, rewritten or dropped ──────────────────────────────────

export type RefKind = 'bone' | 'slot' | ConstraintKind;
const KINDS: ConstraintKind[] = ['ik', 'transform', 'path', 'physics'];

/** What a name maps to: itself, another name (a rename), or null (the irig no longer has it). */
type RefMap = (kind: RefKind, name: string) => string | null;

interface DroppedRef {
	/** Where in the sidecar, e.g. `limbs.arm_l` or `sets.hands[1]`. */
	at: string;
	kind: RefKind;
	name: string;
}

const describe = (d: DroppedRef) =>
	`${d.at} names ${d.kind === 'bone' || d.kind === 'slot' ? d.kind : `${d.kind} constraint`} "${d.name}", which is not in the rig`;

/**
 * `doc` with every bone and constraint name passed through `to`. An entry naming one that maps to
 * null goes, as little as possible with it: a control, a set member, a preset, a mirror pair, a
 * picker button, a limb's control, pole or space, a slot group's member — a whole limb only when
 * its IK or an FK bone goes, a slot group when no member is left. Every name that mapped to null is listed, even in an entry already going.
 */
function mapRefs(doc: ControlsDoc, to: RefMap): { doc: ControlsDoc; dropped: DroppedRef[] } {
	const dropped: DroppedRef[] = [];
	const ref = (kind: RefKind, n: string, at: string): string | null => {
		const out = to(kind, n);
		if (out === null) dropped.push({ at, kind, name: n });
		return out;
	};
	const next: ControlsDoc = { ...doc };

	if (doc.bones) {
		const bones: Record<string, ControlBone> = {};
		const entries = Object.entries(doc.bones).map(
			([b, c]) => [b, ref('bone', b, `bones.${b}`), c] as const,
		);
		// A renamed control wins over a stale entry already under its new name.
		const renamedTo = new Set(entries.filter(([b, n]) => n !== null && n !== b).map(([, n]) => n));
		for (const [b, n, c] of entries)
			if (n !== null && !(n === b && renamedTo.has(b))) bones[n] = structuredClone(c);
		next.bones = bones;
	}
	if (doc.sets) {
		next.sets = Object.fromEntries(
			Object.entries(doc.sets).map(([s, members]) => [
				s,
				unique(
					members.flatMap((m, i) => {
						const n = ref('bone', m, `sets.${s}[${i}]`);
						return n === null ? [] : [n];
					}),
				),
			]),
		);
	}
	if (doc.limbs) {
		const limbs: Record<string, ControlLimb> = {};
		for (const [l, limb] of Object.entries(doc.limbs)) {
			const at = `limbs.${l}`;
			const ik = limb.ik3d ? limb.ik : ref('ik', limb.ik, `${at}.ik`);
			const fk = limb.fk.map((b, i) => ref('bone', b, `${at}.fk[${i}]`));
			const control =
				limb.control === undefined ? undefined : ref('bone', limb.control, `${at}.control`);
			const pole = limb.pole === undefined ? undefined : ref('bone', limb.pole, `${at}.pole`);
			const spaces: Record<string, ControlSpace> = {};
			for (const [s, sp] of Object.entries(limb.spaces ?? {})) {
				const bone = ref('bone', sp.bone, `${at}.spaces.${s}.bone`);
				const constraint = ref('transform', sp.constraint, `${at}.spaces.${s}.constraint`);
				if (bone !== null && constraint !== null) spaces[s] = { bone, constraint };
			}
			if (ik === null || fk.some((b) => b === null)) continue;
			limbs[l] = {
				ik,
				...(limb.ik3d ? { ik3d: true } : {}),
				fk: unique(fk as string[]),
				...(control ? { control } : {}),
				...(pole ? { pole } : {}),
				...(limb.spaces ? { spaces } : {}),
			};
		}
		next.limbs = limbs;
	}
	if (doc.presets) {
		const presets: Record<string, ConstraintPreset> = {};
		for (const [c, preset] of Object.entries(doc.presets)) {
			const n = ref(CONSTRAINT_PRESETS[preset], c, `presets.${c}`);
			if (n !== null) presets[n] = preset;
		}
		next.presets = presets;
	}
	if (doc.mirror) {
		const mirror: NonNullable<ControlsDoc['mirror']> = {};
		const line =
			doc.mirror.line === undefined ? undefined : ref('bone', doc.mirror.line, 'mirror.line');
		if (line) mirror.line = line;
		if (doc.mirror.pairs) {
			const pairs: Record<string, string> = {};
			const taken = new Set<string>();
			for (const [a, b] of Object.entries(doc.mirror.pairs)) {
				const na = ref('bone', a, `mirror.pairs.${a}`);
				const nb = ref('bone', b, `mirror.pairs.${a}`);
				if (na === null || nb === null || taken.has(na) || taken.has(nb)) continue;
				pairs[na] = nb;
				taken.add(na).add(nb);
			}
			mirror.pairs = pairs;
		}
		next.mirror = mirror;
	}
	if (doc.picker?.items) {
		const items: ControlPickerItem[] = [];
		for (const [i, item] of doc.picker.items.entries()) {
			// A button for a limb that went goes with it (the limb's own names are listed).
			if (item.limb !== undefined && !Object.hasOwn(next.limbs ?? {}, item.limb)) continue;
			if (item.bone === undefined) {
				items.push(structuredClone(item));
				continue;
			}
			const n = ref('bone', item.bone, `picker.items[${i}].bone`);
			if (n !== null) items.push({ ...structuredClone(item), bone: n });
		}
		next.picker = { ...doc.picker, items };
	}
	if (doc.slotGroups) {
		const groups: Record<string, string[]> = {};
		for (const [g, members] of Object.entries(doc.slotGroups)) {
			const kept = unique(
				members.flatMap((m, i) => {
					const n = ref('slot', m, `slotGroups.${g}[${i}]`);
					return n === null ? [] : [n];
				}),
			);
			if (kept.length) groups[g] = kept;
		}
		next.slotGroups = groups;
	}
	return { doc: next, dropped };
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

/** The bone, slot and constraint names an irig has, by kind. */
function namesOf(irig: Json): Record<RefKind, Set<string>> {
	const of = (v: unknown, field = 'name') =>
		new Set(
			(Array.isArray(v) ? v : [])
				.map((x: unknown) => (isObj(x) ? x[field] : undefined))
				.filter((n): n is string => typeof n === 'string'),
		);
	return {
		bone: of(irig.bones),
		slot: of(irig.slots),
		ik: of(irig.ik),
		transform: of(irig.transform),
		path: of(irig.path),
		physics: of(irig.physics),
	};
}

/** Why `doc` does not fit the rig beside it (names it uses that the irig lacks), or `[]`. */
export function controlsIrigProblems(doc: ControlsDoc, irig: Json): string[] {
	const has = namesOf(irig);
	return mapRefs(doc, (kind, n) => (has[kind].has(n) ? n : null)).dropped.map(describe);
}

/**
 * The lenient read: `doc` without what names a bone or constraint the irig no longer has, and a
 * notice per name dropped. The sidecar changes no playback, so a rig edited outside the Rigger is
 * opened, not refused.
 */
export function fitControls(doc: ControlsDoc, irig: Json): { doc: ControlsDoc; dropped: string[] } {
	const has = namesOf(irig);
	const fit = mapRefs(doc, (kind, n) => (has[kind].has(n) ? n : null));
	return { doc: fit.doc, dropped: fit.dropped.map(describe) };
}

/** Names the irig changed, old → new, per kind. */
export type RigRenames = Record<RefKind, Map<string, string>>;

/** `doc` with the irig's renames followed. */
export function renameControls(doc: ControlsDoc, renames: RigRenames): ControlsDoc {
	return mapRefs(doc, (kind, n) => renames[kind].get(n) ?? n).doc;
}

/**
 * The renames between two versions of an irig, as the Rigger makes them: a rename keeps the bone
 * (or slot, or constraint) where it is in its list and changes nothing else about what it hangs from
 * or acts on. Names both versions have are anchors; between two anchors, a run of names that went
 * and a run as long that came are paired in order, each pair only when its parent (a bone), its bone
 * (a slot) or the bones it acts on and its target (a constraint), renamed alike, are the same. Anything else — a delete, an
 * add, a rename that also moved a bone — is no rename, and what named the old name is dropped.
 */
export function renamesBetween(before: Json, after: Json): RigRenames {
	const out: RigRenames = {
		bone: new Map(),
		slot: new Map(),
		ik: new Map(),
		transform: new Map(),
		path: new Map(),
		physics: new Map(),
	};
	const bone = (n: unknown) => (typeof n === 'string' ? (out.bone.get(n) ?? n) : n);
	const entries = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
	const byName = (v: unknown) => new Map(entries(v).map((x) => [x.name as string, x]));
	const list = (v: unknown) =>
		entries(v)
			.map((x) => x.name)
			.filter((n): n is string => typeof n === 'string');

	const parents = [byName(before.bones), byName(after.bones)];
	pairInPlace(
		list(before.bones),
		list(after.bones),
		out.bone,
		(a, b) => bone(parents[0].get(a)?.parent) === parents[1].get(b)?.parent,
	);
	const slotBones = [byName(before.slots), byName(after.slots)];
	pairInPlace(
		list(before.slots),
		list(after.slots),
		out.slot,
		(a, b) => bone(slotBones[0].get(a)?.bone) === slotBones[1].get(b)?.bone,
	);
	for (const kind of KINDS) {
		const [was, now] = [byName(before[kind]), byName(after[kind])];
		const acts = (c: Json | undefined, renamed: boolean) => {
			const m = renamed ? bone : (n: unknown) => n;
			const bones = kind === 'physics' ? [c?.bone] : Array.isArray(c?.bones) ? c.bones : [];
			const target = kind === 'ik' || kind === 'transform' ? c?.target : undefined;
			return JSON.stringify([bones.map(m), m(target)]);
		};
		pairInPlace(
			list(before[kind]),
			list(after[kind]),
			out[kind],
			(a, b) => acts(was.get(a), true) === acts(now.get(b), false),
		);
	}
	return out;
}

/** Pair the runs that went with the runs that came between `a` and `b`'s common anchors. */
function pairInPlace(
	a: string[],
	b: string[],
	out: Map<string, string>,
	same: (from: string, to: string) => boolean,
) {
	const inA = new Set(a);
	const inB = new Set(b);
	const anchors = longestCommon(
		a.filter((n) => inB.has(n)),
		b.filter((n) => inA.has(n)),
	);
	let ia = 0;
	let ib = 0;
	for (const anchor of [...anchors, null]) {
		const ja = anchor === null ? a.length : a.indexOf(anchor, ia);
		const jb = anchor === null ? b.length : b.indexOf(anchor, ib);
		const went = a.slice(ia, ja).filter((n) => !inB.has(n));
		const came = b.slice(ib, jb).filter((n) => !inA.has(n));
		if (went.length === came.length)
			went.forEach((n, i) => {
				if (same(n, came[i])) out.set(n, came[i]);
			});
		ia = ja + 1;
		ib = jb + 1;
	}
}

/** The longest common subsequence of two name lists. */
function longestCommon(a: string[], b: string[]): string[] {
	const w = b.length + 1;
	const len = new Uint32Array((a.length + 1) * w);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			len[i * w + j] =
				a[i] === b[j]
					? len[(i + 1) * w + j + 1] + 1
					: Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
	const out: string[] = [];
	for (let i = 0, j = 0; i < a.length && j < b.length;)
		if (a[i] === b[j]) {
			out.push(a[i]);
			i++;
			j++;
		} else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
		else j++;
	return out;
}

/**
 * A client's whole `controls.json`, bound to `rig` (its pair mark is the save's, so the client's is
 * dropped) and checked strictly: well formed, and every name it uses in `irig`.
 */
export function checkedControls(
	value: unknown,
	rig: string,
	irig: Json,
): { doc: ControlsDoc; problems: [] } | { doc: null; problems: string[] } {
	const doc = isObj(value) ? { ...value, rig } : value;
	if (isObj(doc)) delete doc.irig;
	const problems = controlsDocProblems(doc);
	if (problems.length) return { doc: null, problems };
	const misfit = controlsIrigProblems(doc as ControlsDoc, irig);
	return misfit.length
		? { doc: null, problems: misfit }
		: { doc: doc as ControlsDoc, problems: [] };
}
