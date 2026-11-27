/**
 * Rig modules (docs/design/rig-modules.md): a template keeps one complete definition and declares the
 * pieces a rig may have one of several ways (hands with fingers, simple, none). A choice takes away
 * what its options name, and everything that names what it took follows — slots, parts, controls,
 * keys, motion, the 3D setup — in one generic pass, so a module never lists its consequences by hand.
 */
import type { RigTemplateControls } from './rigTemplateControls';
import type { RigTemplate, RigTemplateChannel } from './rigTemplates';

/** One way a module can be: what it takes away from the template's definition. */
export interface RigTemplateModuleOption {
	id: string;
	label: string;
	tip?: string;
	/** Taken away, with every bone that hangs from them. */
	bones?: string[];
	/**
	 * Kept, with nothing on them: their slots, their turns and scales, their 3D turn, control and
	 * picker button go; the moves placing them stay, so they still end their chain (a wrist ending
	 * the arm: its IK, its capture reach, its foreshortening).
	 */
	bare?: string[];
}

/** A piece of a template a rig may have one of several ways (`RigTemplate.modules`). */
export interface RigTemplateModule {
	id: string;
	label: string;
	tip: string;
	/** The option the definition is: a rig with no choice for this module has it. */
	default: string;
	options: RigTemplateModuleOption[];
}

/** A rig's module set: an option per module, those off their default (none = the definition). */
export type RigModuleChoice = Record<string, string>;

/** Why `choice` is not a module set of `t`, or null. */
export function moduleChoiceProblem(t: RigTemplate, choice: RigModuleChoice): string | null {
	for (const [id, opt] of Object.entries(choice)) {
		const m = t.modules?.find((x) => x.id === id);
		if (!m) return `the template "${t.label}" has no module "${id}"`;
		if (!m.options.some((o) => o.id === opt))
			return `the module "${m.label}" has no option "${opt}" (it has ${m.options.map((o) => o.id).join(', ')})`;
	}
	return null;
}

/** `choice` without the options that are their module's default (what a rig records). */
export function offDefault(t: RigTemplate, choice: RigModuleChoice): RigModuleChoice {
	return Object.fromEntries(
		Object.entries(choice).filter(
			([id, opt]) => t.modules?.find((m) => m.id === id)?.default !== opt,
		),
	);
}

/** A module set as sent or stored (an object of strings), or undefined; anything else is null. */
export function parseModuleChoice(v: unknown): RigModuleChoice | undefined | null {
	if (v === undefined) return undefined;
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const out: RigModuleChoice = {};
	for (const [k, x] of Object.entries(v)) {
		if (
			typeof x !== 'string' ||
			!/^[a-z][a-z0-9_]{0,31}$/.test(k) ||
			!/^[a-z][a-z0-9_]{0,31}$/.test(x)
		)
			return null;
		out[k] = x;
	}
	return out;
}

/**
 * Template `t` with the modules `choice` picks (its options off their default taking away what they
 * name): its `choice` records them. A choice of nothing off the definition is `t` itself. Throws on a
 * choice `t` does not have (`moduleChoiceProblem` says why first).
 */
export function templateWithModules(t: RigTemplate, choice: RigModuleChoice = {}): RigTemplate {
	const bad = moduleChoiceProblem(t, choice);
	if (bad) throw new Error(bad);
	const picked = offDefault(t, choice);
	const opts = Object.entries(picked).map(([id, opt]) =>
		t.modules!.find((m) => m.id === id)!.options.find((o) => o.id === opt)!,
	);
	if (!opts.length) return t;
	const out = withoutBones(
		t,
		opts.flatMap((o) => o.bones ?? []),
		opts.flatMap((o) => o.bare ?? []),
	);
	return { ...out, choice: picked };
}

/** What an option of a module takes from `t`: its parts and its bones (for a dialog to leave out). */
export function takenBy(
	t: RigTemplate,
	option: RigTemplateModuleOption,
): { parts: string[]; bones: string[] } {
	const left = withoutBones(t, option.bones ?? [], option.bare ?? []);
	const [parts, bones] = [left.parts, left.bones].map((xs) => new Set(xs.map((x) => x.name)));
	return {
		parts: t.parts.filter((p) => !parts.has(p.name)).map((p) => p.name),
		bones: t.bones.filter((b) => !bones.has(b.name)).map((b) => b.name),
	};
}

/**
 * Where each part of `whole` that `t` (`whole` with a module set) draws no image for is drawn
 * instead, when the art is cut from one picture (🎞 Frame to rig, docs/design/rig-modules.md §5):
 * into the part on the nearest bone at or above its own that `t` still draws on (a hand into its
 * forearm). A part drawn on an `<bone>_image` bone counts as drawn on `<bone>`.
 */
export function drawnInto(whole: RigTemplate, t: RigTemplate): Record<string, string> {
	const kept = new Set(t.parts.map((p) => p.name));
	const boneOf = new Map(whole.slots.map((s) => [s.name, s.bone]));
	const parentOf = new Map(whole.bones.map((b) => [b.name, b.parent]));
	const on = new Map<string, string>();
	for (const p of t.parts) {
		const bone = boneOf.get(p.slot);
		if (!bone) continue;
		const host = bone.endsWith('_image') ? parentOf.get(bone) : undefined;
		for (const b of host ? [bone, host] : [bone]) if (!on.has(b)) on.set(b, p.name);
	}
	const out: Record<string, string> = {};
	for (const p of whole.parts) {
		if (kept.has(p.name)) continue;
		for (let b = boneOf.get(p.slot); b; b = parentOf.get(b)) {
			const into = on.get(b);
			if (into) {
				out[p.name] = into;
				break;
			}
		}
	}
	return out;
}

const MOVES = new Set(['x', 'y']);

/**
 * Template `t` without the bones `bones` (and every bone hanging from them) and with the bones
 * `bare` stripped (`RigTemplateModuleOption.bare`), everything naming what went following it.
 */
export function withoutBones(
	t: RigTemplate,
	bones: readonly string[],
	bare: readonly string[] = [],
): RigTemplate {
	const gone = new Set(bones);
	for (const b of t.bones) if (b.parent && gone.has(b.parent)) gone.add(b.name);
	const stripped = new Set(bare.filter((b) => !gone.has(b)));
	const slotsGone = new Set(
		t.slots.filter((s) => gone.has(s.bone) || stripped.has(s.bone)).map((s) => s.name),
	);
	const slots = t.slots.filter((s) => !slotsGone.has(s.name));
	const parts = t.parts
		.filter((p) => !slotsGone.has(p.slot))
		.map((p) =>
			p.bend && p.bend.bones.some((b) => gone.has(b.bone))
				? (({ bend: _bend, ...rest }) => rest)(p)
				: p,
		);
	const partNames = new Set(parts.map((p) => p.name));
	const constraintsGone = new Set<string>();
	const constraints = t.constraints
		? Object.fromEntries(
				Object.entries(t.constraints).map(([kind, list]) => [
					kind,
					(list ?? []).filter((c) => {
						const named = [c.target, c.bone, ...(Array.isArray(c.bones) ? c.bones : [])];
						const off = named.some((n) => typeof n === 'string' && gone.has(n));
						if (off) constraintsGone.add(String(c.name));
						return !off;
					}),
				]),
			)
		: undefined;

	// Each control with what it no longer reaches taken off; one left reaching nothing goes, and with
	// it every control that only set it (curl → the finger curls), until none changes.
	const trimmed = t.channels.map((c): RigTemplateChannel => {
		const drives = c.drives?.filter(
			(d) => !gone.has(d.bone) && !(stripped.has(d.bone) && !MOVES.has(d.prop)),
		);
		const mixes = c.mixes?.filter((m) => !constraintsGone.has(m.ik));
		const swapped = c.slot !== undefined && !slotsGone.has(c.slot);
		const swaps = swapped
			? c.swaps?.filter((s) => s.part === null || partNames.has(s.part))
			: undefined;
		const hides = swapped ? c.hides?.filter((h) => !slotsGone.has(h.slot)) : undefined;
		const orderSlots = c.order?.slots.filter((s) => !slotsGone.has(s));
		const order =
			c.order && orderSlots?.length
				? { slots: orderSlots, steps: c.order.steps.filter((s) => !slotsGone.has(s.behind)) }
				: undefined;
		const shapes = c.shapes && !slotsGone.has(c.shapes.slot) ? c.shapes : undefined;
		const { drives: _d, mixes: _m, swaps: _s, hides: _h, order: _o, shapes: _p, slot, ...out } = c;
		return {
			...out,
			...(drives?.length ? { drives } : {}),
			...(mixes?.length ? { mixes } : {}),
			...(swapped ? { slot } : {}),
			...(swaps?.length ? { swaps } : {}),
			...(hides?.length ? { hides } : {}),
			...(order ? { order } : {}),
			...(shapes ? { shapes } : {}),
		};
	});
	const alive = new Set<string>();
	const reaches = (c: RigTemplateChannel) =>
		!!(c.drives?.length || c.mixes?.length || c.swaps?.length || c.order || c.shapes) ||
		!!c.sets?.some((s) => alive.has(s.channel));
	for (let changed = true; changed;) {
		changed = false;
		for (const c of trimmed)
			if (!alive.has(c.id) && reaches(c)) {
				alive.add(c.id);
				changed = true;
			}
	}
	const channels = trimmed
		.filter((c) => alive.has(c.id))
		.map((c) => (c.sets ? { ...c, sets: c.sets.filter((s) => alive.has(s.channel)) } : c));

	const clips = t.clips.map((c) => ({
		...c,
		keys: c.keys.filter((k) => alive.has(k[1])),
		...(c.animation
			? {
					animation: {
						...c.animation,
						...(c.animation.bones
							? {
									bones: Object.fromEntries(
										Object.entries(c.animation.bones).filter(([b]) => !gone.has(b)),
									),
								}
							: {}),
						...(c.animation.slots
							? {
									slots: Object.fromEntries(
										Object.entries(c.animation.slots).filter(([s]) => !slotsGone.has(s)),
									),
								}
							: {}),
					},
				}
			: {}),
	}));

	const out: RigTemplate = {
		...t,
		bones: t.bones.filter((b) => !gone.has(b.name)),
		slots,
		parts,
		channels,
		clips,
		...(constraints ? { constraints } : {}),
	};
	if (t.motion) out.motion = motionWithout(t.motion, gone, stripped, alive);
	if (t.rig3d) {
		const r = t.rig3d;
		out.rig3d = {
			...r,
			depths: Object.fromEntries(Object.entries(r.depths).filter(([b]) => !gone.has(b))),
			...(r.views
				? {
						views: Object.fromEntries(
							Object.entries(r.views)
								.filter(([s]) => !slotsGone.has(s))
								.map(([s, ds]) => [s, ds.filter((d) => partNames.has(d.attachment))]),
						),
					}
				: {}),
			...(r.layers
				? {
						layers: Object.fromEntries(
							Object.entries(r.layers)
								.map(([k, ss]): [string, string[]] => [k, ss.filter((s) => !slotsGone.has(s))])
								.filter(([, ss]) => ss.length),
						),
					}
				: {}),
			...(r.ik
				? {
						ik: r.ik.filter((k) => ![...k.bones, k.end, k.target, k.pole].some((b) => gone.has(b))),
					}
				: {}),
		};
	}
	if (t.controls) out.controls = controlsWithout(t.controls, gone, stripped, constraintsGone);
	return out;
}

/** The motion map with what names a bone gone (or stripped) or a control gone taken off. */
function motionWithout(
	m: NonNullable<RigTemplate['motion']>,
	gone: ReadonlySet<string>,
	stripped: ReadonlySet<string>,
	alive: ReadonlySet<string>,
): NonNullable<RigTemplate['motion']> {
	const live = <E extends { channel?: string }>(es: E[]) =>
		es.filter((e) => e.channel === undefined || alive.has(e.channel));
	const out = { ...m };
	for (const k of ['face', 'body', 'hand'] as const) {
		const sec = m[k];
		if (!sec) continue;
		const entries = live(sec.entries as { channel?: string }[]);
		if (entries.length) (out as Record<string, unknown>)[k] = { ...sec, entries };
		else delete out[k];
	}
	const b3 = m.bones3d;
	if (b3) {
		const off = (b: string) => gone.has(b) || stripped.has(b);
		const p = b3.positions;
		out.bones3d = {
			...b3,
			entries: b3.entries.filter((e) => !off(e.bone)),
			...(b3.fingers ? { fingers: b3.fingers.filter((f) => !gone.has(f.bone)) } : {}),
			...(p
				? {
						positions: {
							...p,
							root: { ...p.root, anchors: p.root.anchors.filter((a) => !gone.has(a.bone)) },
							limbs: p.limbs.filter(
								(l) => ![l.upper, l.lower, l.end, l.pole].some((b) => gone.has(b)),
							),
							...(p.neck
								? {
										neck: {
											...p.neck,
											bones: p.neck.bones.filter((b) => !gone.has(b)),
											marks: p.neck.marks.filter((x) => !gone.has(x.bone)),
										},
									}
								: {}),
						},
					}
				: {}),
			replaces: b3.replaces.filter((c) => alive.has(c)),
		};
		if (out.bones3d.fingers && !out.bones3d.fingers.length) delete out.bones3d.fingers;
	}
	return out;
}

/** The control layer with what names a bone gone (or stripped) or a constraint gone taken off. */
function controlsWithout(
	c: RigTemplateControls,
	gone: ReadonlySet<string>,
	stripped: ReadonlySet<string>,
	constraintsGone: ReadonlySet<string>,
): RigTemplateControls {
	const off = (b: string) => gone.has(b) || stripped.has(b);
	const sets = c.sets
		? Object.fromEntries(
				Object.entries(c.sets)
					.map(([k, v]): [string, string[]] => [k, v.filter((b) => !off(b))])
					.filter(([, v]) => v.length),
			)
		: undefined;
	const limbs = c.limbs
		? Object.fromEntries(
				Object.entries(c.limbs).filter(([, l]) => {
					const named = [
						...(l.fk ?? []),
						l.control,
						l.pole,
						...Object.values(l.spaces ?? {}).map((s) => s.bone),
					];
					const cons = [l.ik, ...Object.values(l.spaces ?? {}).map((s) => s.constraint)];
					return (
						!named.some((b) => typeof b === 'string' && gone.has(b)) &&
						!cons.some((x) => typeof x === 'string' && constraintsGone.has(x))
					);
				}),
			)
		: undefined;
	return {
		...c,
		...(c.bones
			? { bones: Object.fromEntries(Object.entries(c.bones).filter(([b]) => !off(b))) }
			: {}),
		...(sets ? { sets } : {}),
		...(limbs ? { limbs } : {}),
		...(c.picker?.items
			? {
					picker: {
						...c.picker,
						items: c.picker.items.filter(
							(i) =>
								!(i.bone && off(i.bone)) &&
								!(i.set && !sets?.[i.set]) &&
								!(i.limb && !limbs?.[i.limb]),
						),
					},
				}
			: {}),
	};
}
