import {
	CONSTRAINT_KINDS,
	controlsForTemplate,
	type RigTemplateConstraints,
} from './rigTemplateControls';
import type { RigTemplateSpec } from './rigTemplateSchema';
import type {
	RigTemplate,
	RigTemplateBone,
	RigTemplateClip,
	RigTemplatePart,
	RigTemplatePlacement,
	RigTemplateSlot,
	RigTemplateTimelines,
} from './rigTemplates';

/**
 * A rig template derived from an open rig (docs/design/rig-templates.md §7.2): the skeleton, the
 * draw order and the default skin's images come from the rig, so what is stored is what the rig
 * really has; the author's spec adds what the rig cannot say (needed parts, controls, which
 * animations are starter clips, the motion map). The rig's native constraints and its control layer
 * (`controls.json`, rig-controls §6.1) come along, so a rig made from the template starts with both.
 * Pure: the save route and the gates call it alike.
 */

export interface DerivedTemplate {
	template: RigTemplate;
	/** What the rig has that the template does not carry, said to the author. */
	notes: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const BLENDS = ['normal', 'additive', 'multiply', 'screen'] as const;
const SLOT_COLOR = /^[0-9a-f]{8}$/i;

/** The default skin's attachments, from either skin layout the rig format allows. */
function defaultSkin(doc: Obj, notes: string[]): Record<string, Record<string, Obj>> {
	const skins = Array.isArray(doc.skins)
		? (doc.skins as Obj[])
		: isObj(doc.skins)
			? Object.entries(doc.skins).map(([name, attachments]) => ({ name, attachments }))
			: [];
	const others = skins.filter((s) => s?.name !== 'default').map((s) => String(s?.name));
	if (others.length)
		notes.push(`Skins other than "default" are not carried: ${others.join(', ')}.`);
	const def = skins.find((s) => s?.name === 'default');
	return isObj(def?.attachments) ? (def.attachments as Record<string, Record<string, Obj>>) : {};
}

/** A mesh's box on its bone: the unweighted vertices' bounds, else only its drawn size. */
function meshBox(a: Obj): { size: [number, number]; at?: RigTemplatePlacement } | null {
	const v = Array.isArray(a.vertices) ? (a.vertices as unknown[]) : [];
	const uvs = Array.isArray(a.uvs) ? (a.uvs as unknown[]) : [];
	if (v.length && v.length === uvs.length && v.every((x) => typeof x === 'number')) {
		const xs = (v as number[]).filter((_, i) => i % 2 === 0);
		const ys = (v as number[]).filter((_, i) => i % 2 === 1);
		const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		if (x1 > x0 && y1 > y0)
			return { size: [x1 - x0, y1 - y0], at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
	}
	const w = num(a.width);
	const h = num(a.height);
	return w && h ? { size: [w, h] } : null;
}

function placement(a: Obj): RigTemplatePlacement | undefined {
	const at: RigTemplatePlacement = {};
	for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) {
		const v = num(a[k]);
		if (v !== undefined && v !== (k.startsWith('scale') ? 1 : 0)) at[k] = v;
	}
	return Object.keys(at).length ? at : undefined;
}

/** The last key time of an animation's timelines (bones, slots, draw order, constraints). */
function lastKeyTime(a: Obj): number {
	let end = 0;
	const scan = (keys: unknown) => {
		if (!Array.isArray(keys)) return;
		for (const k of keys) end = Math.max(end, num((k as Obj)?.time) ?? 0);
	};
	for (const group of ['bones', 'slots'] as const)
		if (isObj(a[group]))
			for (const tls of Object.values(a[group] as Obj))
				if (isObj(tls)) for (const keys of Object.values(tls)) scan(keys);
	scan(a.drawOrder);
	for (const k of CONSTRAINT_KINDS)
		if (isObj(a[k]))
			for (const tls of Object.values(a[k] as Obj))
				if (Array.isArray(tls)) scan(tls);
				else if (isObj(tls)) for (const keys of Object.values(tls)) scan(keys);
	return end;
}

/** The template a rig makes, with its `controls.json` when it has one, or the first reason it makes none. */
export function rigTemplateFromRig(
	doc: Obj,
	spec: RigTemplateSpec,
	id: string,
	version: number,
	controlsDoc?: unknown,
): DerivedTemplate | string {
	const notes: string[] = [];
	const bones: RigTemplateBone[] = [];
	for (const b of Array.isArray(doc.bones) ? (doc.bones as Obj[]) : []) {
		if (typeof b?.name !== 'string') return 'the rig has a bone with no name';
		const bone: RigTemplateBone = {
			name: b.name,
			...(typeof b.parent === 'string' ? { parent: b.parent } : {}),
			x: num(b.x) ?? 0,
			y: num(b.y) ?? 0,
		};
		for (const k of ['rotation', 'length', 'scaleX', 'scaleY'] as const) {
			const v = num(b[k]);
			if (v !== undefined && v !== (k.startsWith('scale') ? 1 : 0)) bone[k] = v;
		}
		if ((num(b.shearX) ?? 0) || (num(b.shearY) ?? 0) || (b.inherit ?? 'normal') !== 'normal')
			notes.push(`Bone "${b.name}": its shear and inherit mode are not carried.`);
		bones.push(bone);
	}
	if (!bones.length) return 'the rig has no bones';

	const skin = defaultSkin(doc, notes);
	const slots: RigTemplateSlot[] = [];
	const parts: RigTemplatePart[] = [];
	const partSlot = new Map<string, string>();
	const required = new Set(spec.required);
	for (const s of Array.isArray(doc.slots) ? (doc.slots as Obj[]) : []) {
		if (typeof s?.name !== 'string' || typeof s.bone !== 'string')
			return 'the rig has a slot with no name or bone';
		const slot: RigTemplateSlot = { name: s.name, bone: s.bone };
		const blend = BLENDS.find((x) => x === s.blend);
		if (blend && blend !== 'normal') slot.blend = blend;
		if (typeof s.color === 'string' && SLOT_COLOR.test(s.color) && s.color !== 'ffffffff')
			slot.color = s.color.toLowerCase();
		for (const [att, a] of Object.entries(skin[s.name] ?? {})) {
			const type = typeof a?.type === 'string' ? a.type : 'region';
			let size: [number, number] | null = null;
			let at = placement(a ?? {});
			if (type === 'region') {
				const w = num(a.width);
				const h = num(a.height);
				size = w && h ? [w, h] : null;
			} else if (type === 'mesh' || type === 'linkedmesh') {
				const box = meshBox(a);
				if (box) {
					size = box.size;
					at = box.at;
					notes.push(
						`"${att}" is a mesh here and becomes an image part: convert it to a mesh again on new art.`,
					);
				}
			} else {
				notes.push(`"${att}" (${type}) in slot "${s.name}" is not an image and is left out.`);
				continue;
			}
			if (!size) {
				notes.push(`"${att}" in slot "${s.name}" has no size and is left out.`);
				continue;
			}
			const owner = partSlot.get(att);
			if (owner !== undefined) {
				notes.push(
					`"${att}" is in slots "${owner}" and "${s.name}"; an image name is one part, so the second is left out.`,
				);
				continue;
			}
			if (typeof a.path === 'string' && a.path !== att)
				notes.push(`"${att}" draws the image "${a.path}"; new art names it "${att}".`);
			partSlot.set(att, s.name);
			parts.push({
				name: att,
				slot: s.name,
				required: required.has(att),
				size: [Math.round(size[0] * 100) / 100, Math.round(size[1] * 100) / 100],
				...(at ? { at } : {}),
			});
		}
		if (typeof s.attachment === 'string' && partSlot.get(s.attachment) === s.name)
			slot.setup = s.attachment;
		slots.push(slot);
	}
	const unknown = spec.required.find((p) => !partSlot.has(p));
	if (unknown !== undefined) return `"${unknown}" is marked needed but is not an image of this rig`;
	if (!required.size) return 'mark at least one part as needed';

	const constraints: RigTemplateConstraints = {};
	for (const k of CONSTRAINT_KINDS)
		if (Array.isArray(doc[k]) && (doc[k] as unknown[]).length)
			constraints[k] = JSON.parse(JSON.stringify(doc[k])) as Obj[];
	const controls = controlsForTemplate(controlsDoc, doc);
	if (controls.unreadable)
		notes.push("The rig's controls (controls.json) could not be read, so they are not carried.");
	for (const d of controls.dropped) notes.push(`Controls: ${d}, so it is left out.`);
	if (isObj(doc.events) && Object.keys(doc.events).length) notes.push('Events are not carried.');

	const anims = isObj(doc.animations) ? doc.animations : {};
	const clips: RigTemplateClip[] = [];
	for (const name of spec.clips) {
		const a = anims[name];
		if (!isObj(a)) return `the rig has no animation "${name}"`;
		clips.push({
			name,
			length: Math.max(Math.round(lastKeyTime(a) * 1e4) / 1e4, 1 / 30),
			keys: [],
			animation: JSON.parse(JSON.stringify(a)) as RigTemplateTimelines,
		});
	}

	return {
		template: {
			id,
			version,
			label: spec.label,
			bones,
			slots,
			parts,
			channels: spec.channels,
			clips,
			...(spec.motion ? { motion: spec.motion } : {}),
			...(Object.keys(constraints).length ? { constraints } : {}),
			...(controls.controls ? { controls: controls.controls } : {}),
		},
		notes,
	};
}
