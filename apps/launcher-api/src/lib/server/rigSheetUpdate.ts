/**
 * 🔄 Update rig for a rig 🗺 From my sheet made (docs/design/frame-to-rig.md §13.1b): its sheet mapped
 * or arranged again, merged into the open rig by frame to rig's merge (`frameRigUpdate`, §12 F2j), so
 * the rig keeps its skeleton (every bone the author added or moved), every animation and key, its
 * constraints, controls and 3D data. Pure (no I/O): the route reads the kept mapping and the sheet.
 *
 * - **Built as 🦴 Create rig builds** the edited mapping (`sheetRig`, `templateRig`): a re-mapped part
 *   draws its new region, a prop added gets its bone and slot, one taken off goes with what names it.
 * - **As made** is today's build of the mapping the rig keeps (`sheet.json`): a part whose attachment
 *   hashes otherwise was edited by hand, and may be kept while it still draws the same region.
 * - **The `frame` clip** (the arrangement) is the new build's, unless the author keyed it themselves
 *   since: then theirs stays and the report says so. A drawing re-arranged moves with it.
 * - **The layers**: the rig keeps its own draw order (a Setup reorder too, even one a depth control
 *   would refuse from the list) unless the author changed the mapping's Layers list since and it
 *   moves a slot; then the slots it lists take its order, held to the depth controls as a create's.
 * - **One slot per region** (§13.1h): each slot a region is drawn in takes the region's name with
 *   its keys (a rig made before: its template slots renamed, a prop named past the Photoshop file
 *   renamed with its bone), a region newly mapped gets its own slot, and a template slot left empty
 *   goes with its keys, every draw-order key still drawing what it drew.
 */
import { propName, rawPropName, type SheetMapping, type SheetProp } from '../rigSheetMap';
import {
	changeModules,
	frameRigUpdate,
	keepDrawOrders,
	madeAttachments,
	madeParts,
	mergedSlots,
	type FrameUpdateInput,
	type FrameUpdateReport,
	type ModuleChangeReport,
} from './rigFrameUpdate';
import type { Fitted } from './rigFrameFit';
import {
	sheetLayersApplied,
	sheetPreview,
	sheetRig,
	type LayersFitted,
	type SheetPreview,
} from './rigSheetFit';
import { HEAD_TURN_BONES, fitTemplate, frameWorld, type RigFit } from './rigTemplateFit';
import type { RigTemplateControls } from './rigTemplateControls';
import { templateWithModules } from './rigTemplateModules';
import { renameInRig } from './rigRename';
import {
	templateWithLinks,
	templateRig,
	type RigTemplate,
	type TemplateRegion,
} from './rigTemplates';

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SheetUpdateInput {
	/** The template whole: each mapping is built with its own modules (`asMapped`). */
	template: RigTemplate;
	/** The sheet's regions (the rig's own sheet: an update never changes it). */
	regions: readonly TemplateRegion[];
	/** The mapping the rig keeps: what it was made, or last updated, from. */
	was: SheetMapping;
	/** The mapping as the author edited it. */
	mapping: SheetMapping;
	/** The rig as the page holds it (irig v1). */
	current: Json;
	/** Parts whose hand-edited mesh the author keeps. */
	keep?: ReadonlySet<string>;
}

/** What happened to the `frame` clip. */
export type FrameClipChange = 'unchanged' | 'replaced' | 'added' | 'removed' | 'kept';

/** What 🔄 Update rig renamed and took out to give the rig one slot per region (§13.1h). */
export interface SlotMigration {
	/** Slots renamed, old → new: a slot to its region's name, a prop's to its name past the file's. */
	slots: Record<string, string>;
	/** Bones renamed, old → new: a renamed prop's own. */
	bones: Record<string, string>;
	/** Template slots no region is drawn in any more, empty: taken out with their keys. */
	dropped: string[];
}

export interface SheetUpdateResult {
	doc: Json;
	/** The edited mapping as kept: its props renamed past the Photoshop file's name (`renamed`). */
	mapping: SheetMapping;
	/**
	 * The depths the mapping's head turn gives its bones and what the head wears (z in the parent's
	 * frame, rig units): a rig with 3D data takes them into its `rig3d.json`.
	 */
	depths: Record<string, number>;
	/** When the modules changed: the new set's control layer, for the rig's own to take what came. */
	controls?: RigTemplateControls;
	report: Omit<FrameUpdateReport, 'handEdited'> & {
		handEdited: { part: string; kept: boolean; canKeep: boolean }[];
		frame: FrameClipChange;
		/** The slots the Layers list moved, when the author changed it: else the rig's order stays. */
		layered: string[];
		/** The template's modules changed with the mapping: what went and what came (`changeModules`). */
		modules?: ModuleChangeReport;
		/** Renamed and taken out for one slot per region: the rig's 3D data and controls follow. */
		renamed: SlotMigration;
	};
}

/** Each key of a clip's bone timelines as numbers, a default left out of the file read as written. */
function keyValues(anim: unknown): Map<string, number[]> {
	const out = new Map<string, number[]>();
	const bones = isRecord(anim) && isRecord(anim.bones) ? anim.bones : {};
	for (const [bone, tls] of Object.entries(bones)) {
		if (!isRecord(tls)) continue;
		for (const [tl, keys] of Object.entries(tls)) {
			if (!Array.isArray(keys)) continue;
			const rest = tl === 'scale' ? 1 : 0;
			const n = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
			out.set(
				`${bone}.${tl}`,
				keys.flatMap((key: unknown) => {
					const k = isRecord(key) ? key : {};
					return tl === 'rotate'
						? [n(k.time, 0), n(k.value, 0)]
						: [n(k.time, 0), n(k.x, rest), n(k.y, rest)];
				}),
			);
		}
	}
	return out;
}

/** Whether two clips key the same values (within 1e-4), however the file spells their defaults. */
export function sameKeys(a: unknown, b: unknown): boolean {
	const [ka, kb] = [keyValues(a), keyValues(b)];
	const names = new Set([...ka.keys(), ...kb.keys()]);
	for (const n of names) {
		const [x, y] = [ka.get(n) ?? [], kb.get(n) ?? []];
		if (x.length !== y.length || x.some((v, i) => Math.abs(v - y[i]) > 1e-4)) return false;
	}
	return true;
}

/**
 * The rig a mapping builds, as 🦴 Create rig builds it but in the template's order: the layers are
 * applied to the merged rig, and held to the depth controls only as `sheetLayersApplied` says.
 */
function build(t: RigTemplate, regions: readonly TemplateRegion[], m: SheetMapping) {
	const fitted = sheetRig(t, regions, m, { fitLayers: false });
	if (!fitted.ok) return fitted;
	const { fit, art } = fitted.value;
	return {
		ok: true as const,
		value: { fit, skeleton: templateRig(t, regions, fit, art).skeleton },
	};
}

/** Template `t` (whole) with the modules mapping `m` was made with (docs/design/rig-modules.md). */
export const asMapped = (t: RigTemplate, m: SheetMapping): RigTemplate =>
	templateWithModules(t, m.template.modules);

/**
 * What 🔄 Update rig merges into the open rig (`frameRigUpdate`), and the edited mapping's fit: its
 * mappings' props named past the Photoshop file's name, the rig given one slot per region (`current`,
 * the open rig or its outline, renamed; `renamed`), each slot it lacks put in by the merge.
 */
export function merging(given: SheetUpdateInput): Fitted<{
	fit: RigFit;
	input: FrameUpdateInput;
	/** The kept mapping built today, when it still builds. */
	asMade: Json | null;
	sameRegion: (part: string) => boolean;
	/** The kept and the edited mapping, their props renamed past the Photoshop file's name. */
	was: SheetMapping;
	mapping: SheetMapping;
	/** Renamed, and the empty template slots no mapping draws in taken out, before the merge. */
	renamed: SlotMigration;
	/** The template slots the rig may draw nothing in once merged: those left empty go. */
	stale: Set<string>;
	/** Each template slot's name in the rig, as the kept mapping and the edited one name it. */
	names: { was: Record<string, string>; now: Record<string, string> };
}> {
	const propsRenamed = cleanPropNames(given.template, [given.was, given.mapping]);
	const o = {
		...given,
		was: withPropNames(given.was, propsRenamed),
		mapping: withPropNames(given.mapping, propsRenamed),
	};
	const tNow = asMapped(o.template, o.mapping);
	const now = build(tNow, o.regions, o.mapping);
	if (!now.ok) return now;
	const { skeleton: fresh, fit } = now.value;
	const freshBind = frameWorld(fitTemplate(tNow, fit).bones, fit.frame);
	// As made: the kept mapping built today (a rig made before the head turn, none of its bones, built
	// without one; before a link of the template, without it); a kept mapping that no longer builds
	// takes the rig's own attachments as made, so nothing reads as edited by hand.
	const bones = ((o.current.bones ?? []) as { name?: unknown }[]).map((b) => String(b.name));
	const turnedBefore = bones.some((b) => (HEAD_TURN_BONES as readonly string[]).includes(b));
	const keptAs = turnedBefore || o.was.turn !== undefined ? o.was : { ...o.was, turn: 0 };
	const was = build(
		templateWithLinks(asMapped(o.template, o.was), new Set(bones)),
		o.regions,
		keptAs,
	);
	const wasNames = was.ok ? (was.value.fit.slots ?? {}) : {};
	const nowNames = fit.slots ?? {};
	const migrated = regionSlots(o.current, o.template, propsRenamed, wasNames, nowNames);
	const asMade = was.ok ? was.value.skeleton : migrated.doc;
	const names = was.ok
		? madeAttachments(asMade).map((m) => m.name)
		: [...Object.keys(o.was.parts), ...o.was.props.map((p) => p.name)];
	// Each prop's bone as its build hangs it (one worn on the head hangs from the head when it turns).
	const boneOf = (built: RigFit | undefined, p: SheetProp) =>
		built?.props?.find((x) => x.name === p.name)?.bone ?? p.bone;
	const made = {
		parts: madeParts(asMade, names),
		props: o.was.props.map((p) => ({
			name: p.name,
			take: true,
			motion: 'rides',
			bone: boneOf(was.ok ? was.value.fit : undefined, p),
		})),
	};
	const props = o.mapping.props.map((p) => ({
		name: p.name,
		motion: 'rides',
		bone: boneOf(fit, p),
	}));
	// A hand-edited mesh may stay while its part draws the region it drew.
	const sameRegion = (part: string) =>
		[o.was.parts[part]?.region, o.was.props.find((p) => p.name === part)?.region].some(
			(r) =>
				r !== undefined &&
				r ===
					(o.mapping.parts[part]?.region ?? o.mapping.props.find((p) => p.name === part)?.region),
		);
	const keep = new Set([...(o.keep ?? [])].filter(sameRegion));
	const links = tNow.bones.filter((b) => b.link).map((b) => b.name);
	const has = new Set(slotNames(migrated.doc));
	const newSlots = new Set(Object.values(nowNames).filter((n) => !has.has(n)));
	const drawn = new Set([...Object.values(nowNames), ...o.mapping.props.map((p) => p.name)]);
	const stale = new Set(
		[...o.template.slots.map((s) => s.name), ...Object.values(wasNames)].filter(
			(n) => !drawn.has(n),
		),
	);
	return {
		ok: true,
		value: {
			fit,
			input: {
				current: migrated.doc,
				fresh,
				freshBind,
				made,
				props,
				keep,
				links,
				...(newSlots.size ? { newSlots } : {}),
			},
			asMade: was.ok ? asMade : null,
			sameRegion,
			was: o.was,
			mapping: o.mapping,
			renamed: migrated.renamed,
			stale,
			names: { was: wasNames, now: nowNames },
		},
	};
}

/**
 * The prop names in mappings `ms` that `propName` gave before it read past a Photoshop file's name
 * (`prop_nelly_asset_breakdown_1_0003_chain`), each to its name now (`prop_chain`), clear of every
 * other name; a custom part, named by its author, keeps its own.
 */
function cleanPropNames(t: RigTemplate, ms: readonly SheetMapping[]): Map<string, string> {
	const out = new Map<string, string>();
	const all = ms.flatMap((m) => m.props);
	const taken = new Set([
		...t.slots.map((s) => s.name),
		...t.parts.map((p) => p.name),
		...t.bones.map((b) => b.name),
		...all.map((p) => p.name),
	]);
	for (const p of all) {
		if (p.custom || out.has(p.name) || p.name !== rawPropName(p.region)) continue;
		const base = propName(p.region);
		if (base === p.name) continue;
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 43)}_${n}`;
		taken.add(name);
		out.set(p.name, name);
	}
	return out;
}

/** Mapping `m` with its props (and its layers naming them) renamed as `names` says. */
function withPropNames(m: SheetMapping, names: ReadonlyMap<string, string>): SheetMapping {
	if (!names.size) return m;
	return {
		...m,
		props: m.props.map((p) => ({ ...p, name: names.get(p.name) ?? p.name })),
		...(m.layers ? { layers: m.layers.map((n) => names.get(n) ?? n) } : {}),
	};
}

/**
 * Rig `current` (or its outline) with one slot per region (§13.1h): each prop `props` renames, its
 * slot, its attachment and its own bone; each template slot to its region's name — the edited
 * mapping's (`now`), else the kept one's (`was`, so the merge finds a part no longer mapped and takes
 * it off) — found under the name the rig was made with, or under the template's on a rig made
 * before. A template slot no mapping draws in that draws nothing goes first (`dropped`), so a region
 * may take its name. A name another slot keeps is not taken. Not modified.
 */
function regionSlots(
	current: Json,
	t: RigTemplate,
	props: ReadonlyMap<string, string>,
	was: Readonly<Record<string, string>>,
	now: Readonly<Record<string, string>>,
): { doc: Json; renamed: SlotMigration } {
	const doc = structuredClone(current);
	const roles = t.slots.map((s) => s.name);
	const drawn = (role: string) => (now[role] ?? was[role]) !== undefined;
	/** The slot the rig draws `role` in: under the name it was made with, else the template's. */
	const sourceOf = (role: string, have: readonly string[]) =>
		[was[role], role].find((n) => n !== undefined && have.includes(n));
	const sources = new Set(roles.filter(drawn).map((r) => sourceOf(r, slotNames(doc))));
	const dropped = emptySlots(doc, new Set(roles.filter((r) => !drawn(r) && !sources.has(r))));
	dropSlots(doc, dropped);
	const have = slotNames(doc);
	const bones = new Set(((doc.bones ?? []) as { name?: unknown }[]).map((b) => String(b.name)));
	const slots = new Map<string, string>();
	for (const [from, to] of props) if (have.includes(from)) slots.set(from, to);
	for (const role of roles) {
		const to = now[role] ?? was[role];
		const from = sourceOf(role, have);
		if (to !== undefined && from !== undefined && from !== to && !slots.has(from))
			slots.set(from, to);
	}
	// A name a slot that stays keeps is not taken, and two renames never land on one name.
	for (let clash = true; clash;) {
		clash = false;
		const final = have.map((n) => slots.get(n) ?? n);
		for (const [from, to] of slots)
			if (final.filter((n) => n === to).length > 1) {
				slots.delete(from);
				clash = true;
				break;
			}
	}
	const moved = [...props].filter(([from]) => slots.has(from));
	const propBones = new Map(moved.filter(([from]) => bones.has(from)));
	const attachments = new Map(moved.map(([from, to]) => [from, new Map([[from, to]])]));
	renameInRig(doc, { slots, bones: propBones, attachments });
	return {
		doc,
		renamed: { slots: Object.fromEntries(slots), bones: Object.fromEntries(propBones), dropped },
	};
}

/**
 * The slots of `stale` that `doc` draws nothing in but attachments `gone` names (none: nothing at
 * all), and no path follows.
 */
function emptySlots(
	doc: Json,
	stale: ReadonlySet<string>,
	gone: ReadonlySet<string> = new Set(),
): string[] {
	const skins = (Array.isArray(doc.skins) ? doc.skins : []) as {
		attachments?: Record<string, Record<string, unknown>>;
	}[];
	const followed = new Set(((doc.path ?? []) as { target?: unknown }[]).map((c) => c.target));
	return slotNames(doc).filter(
		(n) =>
			stale.has(n) &&
			!followed.has(n) &&
			skins.every((sk) => Object.keys(sk.attachments?.[n] ?? {}).every((a) => gone.has(a))),
	);
}

/** Take slots `names` (drawing nothing) out of `doc` with their keys, every draw-order key kept. */
function dropSlots(doc: Json, names: readonly string[]): void {
	if (!names.length) return;
	const off = new Set(names);
	const back = keepDrawOrders(doc as Parameters<typeof keepDrawOrders>[0]);
	doc.slots = ((doc.slots ?? []) as { name: string }[]).filter((s) => !off.has(s.name));
	for (const sk of (Array.isArray(doc.skins) ? doc.skins : []) as { attachments?: Json }[])
		for (const n of off) delete sk.attachments?.[n];
	for (const a of Object.values((doc.animations ?? {}) as Json)) {
		if (!isRecord(a)) continue;
		if (isRecord(a.slots)) for (const n of off) delete a.slots[n];
		for (const key of ['attachments', 'deform'] as const)
			if (isRecord(a[key]))
				for (const bySlot of Object.values(a[key] as Json))
					if (isRecord(bySlot)) for (const n of off) delete bySlot[n];
	}
	back();
}

/**
 * The depths a sheet's fit gives the head (z in the parent's frame): the face's, which the head turn
 * sets, its ring's and those it sets (`RigFit.turn`); none for a template with no 3D setup.
 */
export function headTurnDepths(t: RigTemplate, fit: RigFit): Record<string, number> {
	const depths = fitTemplate(t, fit).rig3d?.depths;
	if (!depths) return {};
	const named = [
		'face',
		...(fit.turn?.bones ?? []).map((b) => b.name),
		...Object.keys(fit.turn?.depths ?? {}),
	];
	return Object.fromEntries(named.map((b) => [b, depths[b] ?? 0]));
}

const slotNames = (doc: Json) => ((doc.slots ?? []) as { name: string }[]).map((s) => s.name);

/** The open rig with the edited mapping's parts in it, and what changed; refused when it does not fit. */
export function updateSheetRig(o: SheetUpdateInput): Fitted<SheetUpdateResult> {
	const merge = merging(o);
	if (!merge.ok) return merge;
	const { fit, input, asMade, sameRegion, was, mapping, renamed, stale, names } = merge.value;
	// The mapping changed the template's modules (docs/design/rig-modules.md §4): the rig takes out
	// what the new set lacks and gets what it adds, then the parts merge as ever.
	let modules: ModuleChangeReport | undefined;
	let current = input.current;
	if (
		JSON.stringify(was.template.modules ?? {}) !== JSON.stringify(mapping.template.modules ?? {})
	) {
		// The two sets' slots by the rig's names for them (each role's, §13.1h).
		const named = (t: RigTemplate, name: (role: string) => string) => ({
			bones: t.bones,
			slots: t.slots.map((s) => ({ name: name(s.name) })),
		});
		const changed = changeModules(
			current,
			named(asMapped(o.template, was), (r) => names.now[r] ?? names.was[r] ?? r),
			named(asMapped(o.template, mapping), (r) => names.now[r] ?? r),
			input.fresh,
		);
		if (!changed.ok) return { ok: false, problem: changed.problem };
		({ doc: current, report: modules } = changed);
	}
	const { doc, report } = frameRigUpdate({ ...input, current });
	// A template slot no region is drawn in any more goes when it draws nothing (one per region).
	const dropped = emptySlots(doc, stale);
	dropSlots(doc, dropped);
	const layers = sheetLayersApplied(
		asMapped(o.template, mapping),
		fit,
		mapping,
		was.layers,
		slotNames(input.current),
		slotNames(doc),
	);
	if (!layers.ok) return layers;

	// The arrangement: the new build's `frame` clip, unless the author keyed theirs since.
	doc.animations ??= {};
	const animations = doc.animations as Json;
	const [cur, old, neu] = [
		animations.frame,
		(asMade?.animations as Json | undefined)?.frame,
		(input.fresh.animations as Json | undefined)?.frame,
	];
	let frame: FrameClipChange = 'unchanged';
	if (!sameKeys(neu, old)) {
		if (cur !== undefined && !(asMade && sameKeys(cur, old))) frame = 'kept';
		else if (neu === undefined) {
			delete animations.frame;
			frame = 'removed';
		} else {
			frame = cur === undefined ? 'added' : 'replaced';
			animations.frame = structuredClone(neu);
		}
	}
	// The layers: the edited list's order when the author changed it and it moves a slot, every
	// draw-order key still drawing what it drew; else the rig's own order stays.
	const layered: string[] = [];
	if (layers.value) {
		const now = layers.value;
		const slots = (doc.slots ?? []) as { name: string }[];
		const byName = new Map(slots.map((s) => [s.name, s]));
		const was = slots.map((s) => s.name);
		const back = keepDrawOrders(doc as Parameters<typeof keepDrawOrders>[0]);
		doc.slots = now.map((n) => byName.get(n)!);
		back();
		layered.push(...now.filter((n, i) => n !== was[i]));
	}
	return {
		ok: true,
		value: {
			doc,
			mapping,
			depths: headTurnDepths(asMapped(o.template, mapping), fit),
			...(modules && asMapped(o.template, mapping).controls
				? { controls: asMapped(o.template, mapping).controls }
				: {}),
			report: {
				...report,
				handEdited: report.handEdited.map((h) => ({ ...h, canKeep: sameRegion(h.part) })),
				frame,
				layered,
				...(modules ? { modules } : {}),
				renamed: { ...renamed, dropped: [...renamed.dropped, ...dropped] },
			},
		},
	};
}

/** The open rig as the 🗺 Edit mapping preview sends it: its slots, back to front, and its skin. */
export interface SheetRigOutline {
	slots: readonly string[];
	/**
	 * The skin `madeParts` reads (`default`, else the first; none when the rig has no skin): its
	 * attachment names, by slot.
	 */
	skins: readonly { name: string; attachments: Readonly<Record<string, readonly string[]>> }[];
}

/** An outline as a rig document `merging` reads: its slots, and its skin's attachments by name. */
export function outlineDoc(rig: SheetRigOutline): Json {
	return {
		bones: [],
		slots: rig.slots.map((name) => ({ name })),
		skins: rig.skins.map((s) => ({
			name: s.name,
			attachments: Object.fromEntries(
				Object.entries(s.attachments).map(([slot, names]) => [
					slot,
					Object.fromEntries(names.map((n) => [n, {}])),
				]),
			),
		})),
	};
}

/**
 * The 🗺 Edit mapping preview of mapping `mapping` over the open rig (`rig`, which keeps mapping
 * `was`): `sheetPreview` with its layers drawn unjudged, refused when 🔄 Update rig would refuse them
 * (`sheetLayersApplied`, on the slots the update's merge leaves the rig, `mergedSlots`).
 */
export function sheetEditPreview(
	o: Pick<SheetUpdateInput, 'template' | 'regions' | 'was' | 'mapping'> & { rig: SheetRigOutline },
): LayersFitted<SheetPreview> {
	const shown = sheetPreview(asMapped(o.template, o.mapping), o.regions, o.mapping, { edit: true });
	if (!shown.ok) return shown;
	const merge = merging({ ...o, current: outlineDoc(o.rig) });
	if (!merge.ok) return merge;
	const { fit, input, was, mapping, stale } = merge.value;
	// The attachments the merge takes off: what the kept mapping made that the edited one does not.
	const made = new Set(madeAttachments(input.fresh).map((m) => m.name));
	const gone = new Set(Object.keys(input.made.parts).filter((n) => !made.has(n)));
	const empty = new Set(emptySlots(input.current, stale, gone));
	const layers = sheetLayersApplied(
		asMapped(o.template, mapping),
		fit,
		mapping,
		was.layers,
		slotNames(input.current),
		mergedSlots(input).filter((n) => !empty.has(n)),
	);
	return layers.ok ? shown : layers;
}
