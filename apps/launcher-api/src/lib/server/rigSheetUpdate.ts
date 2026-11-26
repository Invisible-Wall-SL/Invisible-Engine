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
import type { SheetMapping } from '../rigSheetMap';
import { sheetLayerList } from '../rigSheetMap';
import { inDrawOrder } from '../rigSlotOrder';
import {
	frameRigUpdate,
	keepDrawOrders,
	madeAttachments,
	madeParts,
	type FrameUpdateReport,
} from './rigFrameUpdate';
import type { Fitted } from './rigFrameFit';
import { sheetMappingProblem, sheetRig, slotsAgainstDepth } from './rigSheetFit';
import { fitTemplate, frameWorld } from './rigTemplateFit';
import { templateRig, type RigTemplate, type TemplateRegion } from './rigTemplates';

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SheetUpdateInput {
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
 * applied to the merged rig, and held to the depth controls only when they move a slot it had.
 */
function build(t: RigTemplate, regions: readonly TemplateRegion[], m: SheetMapping) {
	const bad = sheetMappingProblem(t, regions, m);
	if (bad) return { ok: false as const, problem: bad };
	const fitted = sheetRig(t, regions, { ...m, layers: undefined });
	if (!fitted.ok) return fitted;
	const { fit, art } = fitted.value;
	return {
		ok: true as const,
		value: { fit, skeleton: templateRig(t, regions, fit, art).skeleton },
	};
}

/** The open rig with the edited mapping's parts in it, and what changed; refused when it does not fit. */
export function updateSheetRig(o: SheetUpdateInput): Fitted<SheetUpdateResult> {
	const now = build(o.template, o.regions, o.mapping);
	if (!now.ok) return now;
	const { skeleton: fresh, fit } = now.value;
	const freshBind = frameWorld(fitTemplate(o.template, fit).bones, fit.frame);
	// As made: the kept mapping built today; a kept mapping that no longer builds takes the rig's own
	// attachments as made, so nothing reads as edited by hand.
	const was = build(o.template, o.regions, o.was);
	const asMade = was.ok ? was.value.skeleton : o.current;
	const names = was.ok
		? madeAttachments(asMade).map((m) => m.name)
		: [...Object.keys(o.was.parts), ...o.was.props.map((p) => p.name)];
	const made = {
		parts: madeParts(asMade, names),
		props: o.was.props.map((p) => ({ name: p.name, take: true, motion: 'rides', bone: p.bone })),
	};
	const props = o.mapping.props.map((p) => ({ name: p.name, motion: 'rides', bone: p.bone }));
	// A hand-edited mesh may stay while its part draws the region it drew.
	const sameRegion = (part: string) =>
		[o.was.parts[part]?.region, o.was.props.find((p) => p.name === part)?.region].some(
			(r) =>
				r !== undefined &&
				r ===
					(o.mapping.parts[part]?.region ?? o.mapping.props.find((p) => p.name === part)?.region),
		);
	const keep = new Set([...(o.keep ?? [])].filter(sameRegion));
	const { doc, report } = frameRigUpdate({
		current: o.current,
		fresh,
		freshBind,
		made,
		props,
		keep,
	});

	// The arrangement: the new build's `frame` clip, unless the author keyed theirs since.
	doc.animations ??= {};
	const animations = doc.animations as Json;
	const [cur, old, neu] = [
		animations.frame,
		was.ok ? (asMade.animations as Json | undefined)?.frame : undefined,
		(fresh.animations as Json | undefined)?.frame,
	];
	let frame: FrameClipChange = 'unchanged';
	if (!sameKeys(neu, old)) {
		if (cur !== undefined && !(was.ok && sameKeys(cur, old))) frame = 'kept';
		else if (neu === undefined) {
			delete animations.frame;
			frame = 'removed';
		} else {
			frame = cur === undefined ? 'added' : 'replaced';
			animations.frame = structuredClone(neu);
		}
	}
	// The layers: the edited list's order when the author changed it and it moves a slot, every
	// draw-order key still drawing what it drew; else the rig's own order stays (a Setup reorder
	// included, even one a depth control would refuse from the list). The order applied is held to
	// the depth controls when the list moves a slot the open rig had (as the page's preview judges).
	const layered: string[] = [];
	if (JSON.stringify(o.mapping.layers ?? null) !== JSON.stringify(o.was.layers ?? null)) {
		const slotOf = (part: string) => o.template.parts.find((p) => p.name === part)?.slot ?? part;
		const want = sheetLayerList(
			o.template.slots.map((s) => s.name),
			slotOf,
			o.mapping,
		).reverse();
		const slots = (doc.slots ?? []) as { name: string }[];
		const byName = new Map(slots.map((s) => [s.name, s]));
		const was = slots.map((s) => s.name);
		const now = inDrawOrder(was, want);
		if (now.some((n, i) => n !== was[i])) {
			const had = ((o.current.slots ?? []) as { name: string }[]).map((s) => s.name);
			const against =
				inDrawOrder(had, want).some((n, i) => n !== had[i]) &&
				slotsAgainstDepth(fitTemplate(o.template, fit).channels, now);
			if (against) return { ok: false, problem: against };
			const back = keepDrawOrders(doc as Parameters<typeof keepDrawOrders>[0]);
			doc.slots = now.map((n) => byName.get(n)!);
			back();
			layered.push(...now.filter((n, i) => n !== was[i]));
		}
	}
	return {
		ok: true,
		value: {
			doc,
			report: {
				...report,
				handEdited: report.handEdited.map((h) => ({ ...h, canKeep: sameRegion(h.part) })),
				frame,
				layered,
			},
		},
	};
}
