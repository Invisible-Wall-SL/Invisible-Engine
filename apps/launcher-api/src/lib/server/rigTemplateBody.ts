import { part } from './rigTemplateFace';
import type {
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplatePart,
	RigTemplateSlot,
} from './rigTemplates';

/**
 * The pieces the built-in templates are made of (docs/design/rig-modules.md §5): each defined once,
 * sized by the template that has it. A template lists its pieces in its own order — bones parents
 * first, slots back to front, controls as the Controls section shows them — so writing a built-in
 * from pieces changes none of it (`rig-template-presets.mjs` holds every built-in to its snapshot).
 */

/** The neck's bones, base first: what a turn of the neck is shared by. */
export const NECK_BONES = ['neck', 'neck_upper'] as const;

/**
 * The neck (§3.6): `neck` on the chest at the collar (`at` up the chest bone), `neck_upper` halfway
 * up its `length`, the head on that. A turn of the neck is shared by the two, so it bends rather than
 * swinging stiff from the collar, and its drawing is skinned across both. `neck_upper` came later: a
 * `link`.
 */
export function neck(
	at: number,
	length: number,
	size: [number, number],
): { bones: RigTemplateBone[]; slot: RigTemplateSlot; part: RigTemplatePart } {
	return {
		bones: [
			{ name: 'neck', parent: 'chest', x: 0, y: at },
			{ name: 'neck_upper', parent: 'neck', x: 0, y: length / 2, link: true },
			{ name: 'head', parent: 'neck_upper', x: 0, y: length / 2 },
		],
		slot: { name: 'neck', bone: 'neck', setup: 'neck' },
		part: part('neck', 'neck', size),
	};
}

/** The Head nod control: degrees, the neck's turn shared by its bones. */
export const HEAD_NOD: RigTemplateChannel = {
	id: 'head_nod',
	label: 'Head nod',
	tip: 'Degrees, turned along the neck.',
	min: -10,
	max: 10,
	rest: 0,
	drives: NECK_BONES.map((bone) => ({ bone, prop: 'rotate' as const, per: 1 / NECK_BONES.length })),
};
