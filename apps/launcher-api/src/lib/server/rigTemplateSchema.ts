import { z } from 'zod';
import type { RigMotionMap } from '../rigMotion';
import type { RigTemplateChannel } from './rigTemplates';

/**
 * The strict shape of what 📐 Save as template posts (docs/design/rig-templates.md §7.5): the
 * controls, the motion map and the author's choices. Strict objects, so a stored template carries
 * exactly the fields `rigTemplateProblem` and the Rigger read — never an extra one a later reader
 * would trip on.
 */

const name = z.string().min(1).max(120);
const num = z.number().finite();
const ref = z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])]);

const drive = z
	.object({ bone: name, prop: z.enum(['x', 'y', 'rotate', 'scaleY']), per: num })
	.strict();
const swap = z.object({ at: num, part: name.nullable() }).strict();
const shapes = z
	.object({
		slot: name,
		jaw: name,
		rest: name,
		open: z.record(name, num),
		talk: z.array(name).max(64),
		lipsync: z.record(z.string(), name).optional(),
	})
	.strict();

export const channelSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.max(40)
			.regex(/^[a-z][a-z0-9_]*$/, 'a control id is lower-case letters, digits and _'),
		label: z.string().min(1).max(40),
		tip: z.string().max(200),
		min: num,
		max: num,
		rest: num,
		drives: z.array(drive).max(16).optional(),
		slot: name.optional(),
		swaps: z.array(swap).max(16).optional(),
		hides: z
			.array(z.object({ slot: name, part: name }).strict())
			.max(64)
			.optional(),
		sets: z
			.array(z.object({ channel: name, per: num }).strict())
			.max(32)
			.optional(),
		shapes: shapes.optional(),
	})
	.strict();

const faceEntry = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('blend'),
			channel: name,
			plus: z.array(name),
			minus: z.array(name).optional(),
			gain: num,
			offset: num.optional(),
			rest: z.enum(['zero', 'median']).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('angle'),
			channel: name,
			from: ref,
			to: ref,
			gain: num,
			rest: z.enum(['level', 'first']),
		})
		.strict(),
	z
		.object({
			kind: z.literal('offset'),
			channel: name,
			point: ref,
			between: z.tuple([ref, ref]),
			axis: z.enum(['x', 'y']),
			gain: num,
		})
		.strict(),
	z
		.object({
			kind: z.literal('shape'),
			channel: name,
			features: z.record(z.string(), z.array(name)),
			shapes: z.record(name, z.record(z.string(), num)),
			hold: num,
		})
		.strict(),
]);

const bodyEntry = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('bone'),
			channel: name,
			bone: name,
			from: ref,
			to: ref,
			rest: z.tuple([num, num]).optional(),
			minSpan: num.optional(),
		})
		.strict(),
	z
		.object({ kind: z.literal('root'), channel: name, point: ref, axis: z.enum(['x', 'y']) })
		.strict(),
]);

const side = z.enum(['l', 'r']);
const handPoint = z.number().int();
const handEntry = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('curl'),
			channel: name,
			side,
			joints: z.array(z.tuple([handPoint, handPoint, handPoint])).max(8),
			rest: num,
			full: num,
		})
		.strict(),
	z
		.object({
			kind: z.literal('spread'),
			channel: name,
			side,
			from: z.tuple([handPoint, handPoint]),
			to: z.tuple([handPoint, handPoint]),
			rest: num,
			full: num,
		})
		.strict(),
]);

export const motionSchema = z
	.object({
		face: z
			.object({ smooth: num, entries: z.array(faceEntry) })
			.strict()
			.optional(),
		body: z
			.object({
				smooth: num,
				minVisibility: num,
				scale: z.object({ from: ref, to: ref, rig: num }).strict(),
				entries: z.array(bodyEntry),
			})
			.strict()
			.optional(),
		hand: z
			.object({ smooth: num, entries: z.array(handEntry) })
			.strict()
			.optional(),
		cannot: z.array(z.string().max(300)).max(20),
	})
	.strict();

/** The author's choices: everything the rig itself does not say. */
export const templateSpecSchema = z
	.object({
		label: z.string().trim().min(1).max(60),
		/** Part names the template needs; every other part is optional. */
		required: z.array(name),
		channels: z.array(channelSchema).max(64),
		/** Animations of the rig kept as starter clips. */
		clips: z.array(name).max(64),
		motion: motionSchema.nullable(),
	})
	.strict();

export interface RigTemplateSpec {
	label: string;
	required: string[];
	channels: RigTemplateChannel[];
	clips: string[];
	motion: RigMotionMap | null;
}

/** The posted spec, or the first reason it is not one. */
export function parseTemplateSpec(v: unknown): RigTemplateSpec | string {
	const r = templateSpecSchema.safeParse(v);
	if (r.success) return r.data as RigTemplateSpec;
	const i = r.error.issues[0];
	return `${i.path.join('.') || 'template'}: ${i.message}`;
}
