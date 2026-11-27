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
 */
import type { SheetMapping, SheetProp } from '../rigSheetMap';
import {
	frameRigUpdate,
	keepDrawOrders,
	madeAttachments,
	madeParts,
	mergedSlots,
	type FrameUpdateInput,
	type FrameUpdateReport,
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
import { templateWithModules } from './rigTemplateModules';
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

export interface SheetUpdateResult {
	doc: Json;
	/**
	 * The depths the mapping's head turn gives its bones and what the head wears (z in the parent's
	 * frame, rig units): a rig with 3D data takes them into its `rig3d.json`.
	 */
	depths: Record<string, number>;
	report: Omit<FrameUpdateReport, 'handEdited'> & {
		handEdited: { part: string; kept: boolean; canKeep: boolean }[];
		frame: FrameClipChange;
		/** The slots the Layers list moved, when the author changed it: else the rig's order stays. */
		layered: string[];
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

/** What 🔄 Update rig merges into the open rig (`frameRigUpdate`), and the edited mapping's fit. */
export function merging(o: SheetUpdateInput): Fitted<{
	fit: RigFit;
	input: FrameUpdateInput;
	/** The kept mapping built today, when it still builds. */
	asMade: Json | null;
	sameRegion: (part: string) => boolean;
}> {
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
	const asMade = was.ok ? was.value.skeleton : o.current;
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
	return {
		ok: true,
		value: {
			fit,
			input: { current: o.current, fresh, freshBind, made, props, keep, links },
			asMade: was.ok ? asMade : null,
			sameRegion,
		},
	};
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
	const { fit, input, asMade, sameRegion } = merge.value;
	const { doc, report } = frameRigUpdate(input);
	const layers = sheetLayersApplied(
		asMapped(o.template, o.mapping),
		fit,
		o.mapping,
		o.was.layers,
		slotNames(o.current),
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
			depths: headTurnDepths(asMapped(o.template, o.mapping), fit),
			report: {
				...report,
				handEdited: report.handEdited.map((h) => ({ ...h, canKeep: sameRegion(h.part) })),
				frame,
				layered,
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
	const layers = sheetLayersApplied(
		asMapped(o.template, o.mapping),
		merge.value.fit,
		o.mapping,
		o.was.layers,
		o.rig.slots,
		mergedSlots(merge.value.input),
	);
	return layers.ok ? shown : layers;
}
