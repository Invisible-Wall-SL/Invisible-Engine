/**
 * One slot per region (docs/design/frame-to-rig.md §13.1h): a template fitted to an artist's sheet
 * names each slot the rig draws in as the rig does (its region's name, `sheetSlotNames`) and leaves
 * out every slot no region is drawn in, with everything that names a slot following — its parts,
 * the controls' swaps and hides, the depth controls, the starter clips, the 3D layers and views. So
 * the Rigger's Controls, a capture's keys and a 3D bake drive the rig's own slots by its own names.
 *
 * A control left reaching nothing goes (a hand pose with no hand drawn), and with it the keys and
 * the motion map entries naming it. The mouth's shapes stay when no mouth shape is drawn, marked
 * `drawn`: they still open the jaw and pose the corners and lips of a jointed or drawn mouth, and
 * key no image.
 */
import type { RigTemplate, RigTemplateChannel, RigTemplateTimelines } from './rigTemplates';
import { motionWithout } from './rigTemplateModules';
import { drawOrderOf, offsetsOf } from '../rigSlotOrder';

/**
 * Template `t` (fitted) with each slot `names` keys named as it says, the slots `keep` names (a
 * fit's props) kept as they are, and every other slot left out.
 */
export function withRegionSlots(
	t: RigTemplate,
	names: Readonly<Record<string, string>>,
	keep: readonly string[],
): RigTemplate {
	const kept = new Set(keep);
	const name = (slot: string): string | null =>
		Object.hasOwn(names, slot) ? names[slot] : kept.has(slot) ? slot : null;
	/** Slot names as the rig names them, those it does not make left out. */
	const named = (list: readonly string[]) => list.flatMap((s) => name(s) ?? []);
	/** Each item with the slot its field `key` names as the rig names it, those it does not make out. */
	const renamed = <K extends string, T extends Record<K, string>>(
		list: readonly T[],
		key: K,
	): T[] =>
		list.flatMap((x) => {
			const n = name(x[key]);
			return n === null ? [] : [{ ...x, [key]: n }];
		});

	const trimmed = t.channels.map((c): RigTemplateChannel => {
		const { slot, swaps, hides, order, shapes, ...rest } = c;
		const own = slot === undefined ? null : name(slot);
		const hid = own === null ? [] : renamed(hides ?? [], 'slot');
		const moved = order ? named(order.slots) : [];
		const steps = order ? renamed(order.steps, 'behind') : [];
		const shown = shapes && name(shapes.slot);
		return {
			...rest,
			...(own !== null ? { slot: own } : {}),
			...(own !== null && swaps ? { swaps } : {}),
			...(hid.length ? { hides: hid } : {}),
			...(moved.length && steps.length ? { order: { slots: moved, steps } } : {}),
			...(shapes
				? { shapes: shown ? { ...shapes, slot: shown } : { ...shapes, drawn: true as const } }
				: {}),
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

	const slots = renamed(t.slots, 'name');
	const before = t.slots.map((s) => s.name);
	const after = slots.map((s) => s.name);
	// A path constraint follows its slot: renamed with it, or gone with it (and its keys).
	const pathsGone = new Set<string>();
	const paths = t.constraints?.path?.flatMap((c) => {
		const target = typeof c.target === 'string' ? name(c.target) : null;
		if (target === null) pathsGone.add(String(c.name));
		return target === null ? [] : [{ ...c, target }];
	});
	const clips = t.clips.map((c) => ({
		...c,
		keys: c.keys.filter((k) => alive.has(k[1])),
		...(c.animation ? { animation: clipSlots(c.animation, name, before, after, pathsGone) } : {}),
	}));

	const out: RigTemplate = {
		...t,
		slots,
		parts: renamed(t.parts, 'slot'),
		channels,
		clips,
	};
	if (t.motion) out.motion = motionWithout(t.motion, new Set(), new Set(), alive);
	if (paths) out.constraints = { ...t.constraints, path: paths };
	if (t.rig3d) {
		const r = t.rig3d;
		out.rig3d = {
			...r,
			...(r.views
				? {
						views: Object.fromEntries(
							Object.entries(r.views).flatMap(([s, ds]) => {
								const n = name(s);
								return n === null ? [] : [[n, ds]];
							}),
						),
					}
				: {}),
			...(r.layers
				? {
						layers: Object.fromEntries(
							Object.entries(r.layers)
								.map(([k, ss]): [string, string[]] => [k, named(ss)])
								.filter(([, ss]) => ss.length),
						),
					}
				: {}),
		};
	}
	return out;
}

/**
 * A starter clip's slot timelines and draw-order keys over the slots as `name` names them, without
 * the keys of the path constraints `pathsGone`.
 */
function clipSlots(
	a: RigTemplateTimelines,
	name: (slot: string) => string | null,
	before: readonly string[],
	after: readonly string[],
	pathsGone: ReadonlySet<string>,
): RigTemplateTimelines {
	const out = { ...a };
	if (a.path && pathsGone.size)
		out.path = Object.fromEntries(Object.entries(a.path).filter(([c]) => !pathsGone.has(c)));
	if (a.slots)
		out.slots = Object.fromEntries(
			Object.entries(a.slots).flatMap(([s, tl]) => {
				const n = name(s);
				return n === null ? [] : [[n, tl]];
			}),
		);
	if (a.drawOrder)
		out.drawOrder = a.drawOrder.map((k) => {
			const order = drawOrderOf(before, k.offsets).flatMap((s) => name(s) ?? []);
			const offsets = offsetsOf(after, order);
			const { offsets: _o, ...rest } = k;
			return offsets.length ? { ...rest, offsets } : rest;
		});
	return out;
}
