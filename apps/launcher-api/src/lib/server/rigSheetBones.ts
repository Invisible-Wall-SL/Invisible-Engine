/**
 * 🗺 From my sheet's skeleton (docs/design/frame-to-rig.md §13.1i): the bones a sheet's mapping
 * needs, drawn from the template (its modules chosen) as from a library of bones. A rig made from a
 * sheet has
 * - each bone a region is drawn on (its slot's), and each bone a prop or ＋ Custom part hangs from;
 * - each bone a drawing's mesh is weighted to, and each bone that ends a drawing's length (the elbow
 *   under an upper arm, the wrist under a forearm);
 * - what a limb that is there needs to move: its IK target and pole, its FK/IK control and spaces,
 *   the bone ending its chain; the marks a kept neck bends to under a capture (the eyes, the mouth's
 *   corners), and the root's anchors when none of them is otherwise kept;
 * - each bone the author keeps (`SheetMapping.keep`);
 * - the bones above all of those, to the root.
 * Every other bone of the template is left out (`RigFit.leftOut`) with everything naming it: legs on
 * a sheet with none, ears and cheeks with no region, the fingers of a hand drawn as one picture, the
 * brows nobody drew. The face's own controls stay for the features that are there: the jaw under a
 * lower lip, the lid's follow bone above a lid, the mouth's corners a lip's mesh bends on.
 */
import { bendBones, type RigFit } from './rigTemplateFit';
import type { RigTemplate } from './rigTemplates';

/**
 * Why a template bone is in the rig, the first of these that holds: a region is `drawn` on it, a
 * `prop` hangs from it, a `mesh` is weighted to it, a drawing `ends` on it, a limb's `control`, the
 * author `kept` it, or it is `above` one of those; `none`: left out.
 */
export type SheetBoneWhy =
	'drawn' | 'prop' | 'mesh' | 'ends' | 'control' | 'kept' | 'above' | 'none';

export interface SheetBone {
	name: string;
	parent?: string;
	why: SheetBoneWhy;
	/** The template's slots on it (their template names): what a region mapped there would fill. */
	slots: string[];
}

export interface SheetBones {
	/** Every bone of the template, in its order, and why it is made or left out. */
	bones: SheetBone[];
	/** The bones left out, in the template's order (`RigFit.leftOut`). */
	leftOut: string[];
}

/** What a limb needs once the bones it moves are all there: the rest of the bones it names. */
interface Helper {
	moves: readonly (string | undefined)[];
	ends?: readonly (string | undefined)[];
	needs: readonly (string | undefined)[];
}

/** A template's limbs, IK chains and constraints, as what each moves and what it needs then. */
function helpers(t: RigTemplate): Helper[] {
	const out: Helper[] = [];
	for (const l of Object.values(t.controls?.limbs ?? {}))
		out.push({
			moves: l.fk ?? [],
			needs: [l.control, l.pole, ...Object.values(l.spaces ?? {}).map((s) => s.bone)],
		});
	for (const k of t.rig3d?.ik ?? [])
		out.push({ moves: k.bones, ends: [k.end], needs: [k.target, k.pole] });
	const positions = t.motion?.bones3d?.positions;
	for (const l of positions?.limbs ?? [])
		out.push({ moves: [l.upper, l.lower], ends: [l.end], needs: [l.pole] });
	// 📍 Follow positions bends the neck to its marks (the eyes, the mouth's corners).
	if (positions?.neck)
		out.push({ moves: positions.neck.bones, needs: positions.neck.marks.map((m) => m.bone) });
	for (const list of Object.values(t.constraints ?? {}))
		for (const c of list ?? []) {
			const moves: unknown[] = Array.isArray(c.bones) ? c.bones : [c.bone];
			out.push({
				moves: moves.map((b) => (typeof b === 'string' ? b : undefined)),
				needs: typeof c.target === 'string' ? [c.target] : [],
			});
		}
	return out;
}

/**
 * The skeleton a sheet's `fit` (its slots, props and bends as `sheetRig` makes them) needs of
 * template `t`: `ends`, the bones whose offsets are a drawing's length; `keep`, the bones the author
 * keeps with nothing drawn on them yet.
 */
export function sheetBones(
	t: RigTemplate,
	fit: RigFit,
	ends: readonly string[],
	keep: readonly string[],
): SheetBones {
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const why = new Map<string, SheetBoneWhy>();
	const mark = (b: string | undefined, w: SheetBoneWhy) => {
		if (b !== undefined && byName.has(b) && !why.has(b)) why.set(b, w);
	};
	const slotBone = new Map(t.slots.map((s) => [s.name, s.bone]));
	const drawn = new Set(Object.keys(fit.slots ?? {}));
	for (const s of drawn) mark(slotBone.get(s), 'drawn');
	for (const p of fit.props ?? []) mark(p.bone, 'prop');
	for (const p of t.parts) {
		const bend = drawn.has(p.slot) ? (fit.bends?.[p.name] ?? p.bend) : undefined;
		if (bend) for (const b of bendBones(bend)) mark(b, 'mesh');
	}
	for (const b of ends) mark(b, 'ends');
	for (const b of keep) mark(b, 'kept');
	const above = () => {
		for (const b of [...t.bones].reverse())
			if (why.has(b.name) && b.parent !== undefined) mark(b.parent, 'above');
	};
	const limbs = helpers(t);
	const grow = () => {
		for (let grew = true; grew;) {
			const had = why.size;
			above();
			for (const h of limbs)
				if (h.moves.length && h.moves.every((b) => b !== undefined && why.has(b))) {
					for (const b of h.ends ?? []) mark(b, 'ends');
					for (const b of h.needs) mark(b, 'control');
				}
			grew = why.size !== had;
		}
	};
	grow();
	// 📍 Follow positions places the root on the anchors it keeps (Full body with no leg drawn: on the
	// shoulders alone); with none of them left, on all of them.
	const root = t.motion?.bones3d?.positions?.root;
	if (root && !root.anchors.some((a) => why.has(a.bone))) {
		for (const a of root.anchors) mark(a.bone, 'control');
		grow();
	}
	const bones = t.bones.map((b): SheetBone => ({
		name: b.name,
		...(b.parent !== undefined ? { parent: b.parent } : {}),
		why: why.get(b.name) ?? 'none',
		slots: t.slots.filter((s) => s.bone === b.name).map((s) => s.name),
	}));
	return { bones, leftOut: bones.filter((b) => b.why === 'none').map((b) => b.name) };
}
