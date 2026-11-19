import { z } from 'zod';
import { FACE_GROUPS, type RigMotionMap } from '../rigMotion';
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
		pose: z.record(name, z.record(name, num)).optional(),
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
		shapes: shapes.optional(),
	})
	.strict();

const group = z.enum(FACE_GROUPS).optional();
const faceEntry = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('blend'),
			channel: name,
			group,
			plus: z.array(name),
			minus: z.array(name).optional(),
			gain: num,
			offset: num.optional(),
			rest: z.enum(['zero', 'median', 'neutral']).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('angle'),
			channel: name,
			group,
			from: ref,
			to: ref,
			gain: num,
			rest: z.enum(['level', 'first', 'neutral']),
		})
		.strict(),
	z
		.object({
			kind: z.literal('offset'),
			channel: name,
			group,
			point: ref,
			between: z.tuple([ref, ref]),
			axis: z.enum(['x', 'y']),
			gain: num,
			rest: z.enum(['first', 'neutral']).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('shape'),
			channel: name,
			group,
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

export const motionSchema = z
	.object({
		face: z
			.object({ smooth: num, follow: num.optional(), entries: z.array(faceEntry) })
			.strict()
			.optional(),
		body: z
			.object({
				smooth: num,
				follow: num.optional(),
				minVisibility: num,
				scale: z.object({ from: ref, to: ref, rig: num }).strict(),
				entries: z.array(bodyEntry),
			})
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
