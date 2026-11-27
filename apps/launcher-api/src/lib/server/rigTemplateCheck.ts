import * as rig from 'engine-rig';
import { irigDocProblem } from './riggerIrig';
import {
	orderAt,
	orderOffsets,
	rigTemplateProblem,
	swapPart,
	templateRig,
	type RigTemplate,
	type RigTemplateChannel,
	type TemplateRegion,
} from './rigTemplates';

/**
 * The pose check a template must pass before it is stored (docs/design/rig-templates.md §7.5): a rig
 * made from it over placeholder art — every part, then only the needed ones — passes the `.irig`
 * save validator and loads under engine-rig with the game's atlas loader, and every control at its
 * min, rest and max and every starter clip at its start, middle and end poses to finite transforms.
 * A template that fails would break every ＋ New rig made from it.
 */

const stubTexture = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};

function atlasText(regions: readonly TemplateRegion[]): string {
	const lines = ['page.png', 'size:8192,2048', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(
			r.name,
			`bounds:${x},0,${Math.max(1, Math.round(r.w))},${Math.max(1, Math.round(r.h))}`,
		);
		x += Math.max(1, Math.round(r.w));
	}
	return lines.join('\n') + '\n';
}

const TIMELINE = {
	x: 'translate',
	y: 'translate',
	rotate: 'rotate',
	scaleX: 'scale',
	scaleY: 'scale',
} as const;
type Key = { time: number } & Record<string, number>;

/**
 * A control keyed at min (t 0), rest (t 0.5) and max (t 1), as the Controls section keys it; a
 * control that sets others keys each of them at its value × per.
 */
export function controlAnimation(
	ch: RigTemplateChannel,
	channels: RigTemplateChannel[],
	has: (part: string) => boolean,
	slotNames: string[],
): object {
	const bones: Record<string, Record<string, Key[]>> = {};
	const slots: Record<string, { attachment: { time: number; name?: string }[] }> = {};
	const points: [number, number][] = [
		[0, ch.min],
		[0.5, ch.rest],
		[1, ch.max],
	];
	const drives = ch.sets
		? ch.sets.flatMap((s) =>
				(channels.find((c) => c.id === s.channel)?.drives ?? []).map((d) => ({
					...d,
					per: d.per * s.per,
				})),
			)
		: (ch.drives ?? []);
	for (const d of drives) {
		const tl = ((bones[d.bone] ??= {})[TIMELINE[d.prop]] ??= points.map(([time]) => ({ time })));
		points.forEach(([, v], i) => {
			const k = tl[i];
			if (d.prop === 'rotate') k.value = v * d.per;
			else if (d.prop === 'scaleX') Object.assign(k, { x: 1 + v * d.per, y: k.y ?? 1 });
			else if (d.prop === 'scaleY') Object.assign(k, { x: k.x ?? 1, y: 1 + v * d.per });
			else Object.assign(k, { x: k.x ?? 0, y: k.y ?? 0, [d.prop]: v * d.per });
		});
	}
	if (ch.swaps && ch.slot) {
		slots[ch.slot] = {
			attachment: points.map(([time, v]) => {
				const part = swapPart(ch, v, has);
				return part ? { time, name: part } : { time };
			}),
		};
	}
	const ik = Object.fromEntries(
		(ch.mixes ?? []).map((m) => [m.ik, points.map(([time, v]) => ({ time, mix: v * m.per }))]),
	);
	const order = ch.order;
	if (order)
		return {
			bones,
			slots,
			drawOrder: points.map(([time, value]) => ({
				time,
				offsets: orderOffsets(slotNames, orderAt(slotNames, [{ order, value }])),
			})),
		};
	if (ch.shapes) {
		const shown = [ch.shapes.rest, ...Object.keys(ch.shapes.open)].filter(has);
		slots[ch.shapes.slot] = {
			attachment: shown.map((name, i) => ({ time: i / Math.max(1, shown.length - 1), name })),
		};
	}
	return ch.mixes?.length ? { bones, slots, ik } : { bones, slots };
}

function finitePose(skel: InstanceType<typeof rig.Skeleton>): boolean {
	skel.updateWorldTransform(rig.Physics.update);
	for (const b of skel.bones)
		if (![b.worldX, b.worldY, b.a, b.b, b.c, b.d].every(Number.isFinite)) return false;
	const off = new rig.Vector2();
	const size = new rig.Vector2();
	skel.getBounds(off, size, []);
	return [off.x, off.y, size.x, size.y].every(Number.isFinite);
}

/** One rig over `regions`: why it does not load or pose, or null. */
function poseProblem(t: RigTemplate, regions: TemplateRegion[], label: string): string | null {
	const { skeleton } = templateRig(t, regions);
	const names = new Set(regions.map((r) => r.name));
	const animations: Record<string, object> = {};
	const plays: [string, string, number[]][] = [];
	for (const ch of t.channels) {
		animations[`control ${ch.id}`] = controlAnimation(
			ch,
			t.channels,
			(p) => names.has(p),
			(skeleton.slots as { name: string }[]).map((s) => s.name),
		);
		plays.push([`control ${ch.id}`, `control "${ch.id}"`, [0, 0.5, 1]]);
	}
	for (const c of t.clips)
		if (c.animation) {
			animations[`clip ${c.name}`] = c.animation;
			plays.push([`clip ${c.name}`, `clip "${c.name}"`, [0, c.length / 2, c.length]]);
		}
	const doc = { ...skeleton, animations };
	const invalid = irigDocProblem(doc);
	if (invalid) return `a rig made from it (${label}) would not save: ${invalid}`;
	try {
		const atlas = new rig.TextureAtlas(atlasText(regions));
		for (const page of atlas.pages) page.setTexture(stubTexture as never);
		const data = new rig.SkeletonJson(new rig.AtlasAttachmentLoader(atlas)).readSkeletonData(
			JSON.parse(JSON.stringify(doc)),
		);
		const skel = new rig.Skeleton(data);
		skel.setToSetupPose();
		if (!finitePose(skel)) return `a rig made from it (${label}) does not pose in its setup pose`;
		for (const [name, what, times] of plays) {
			const anim = data.findAnimation(name);
			if (!anim) return `a rig made from it (${label}) lost the animation "${name}"`;
			for (const time of times) {
				skel.setToSetupPose();
				anim.apply(skel, 0, time, false, [], 1, rig.MixBlend.setup, rig.MixDirection.mixIn);
				if (!finitePose(skel)) return `${what} does not pose at ${time}s (${label})`;
			}
		}
	} catch (e) {
		return `a rig made from it (${label}) does not load: ${e instanceof Error ? e.message : String(e)}`;
	}
	return null;
}

/** Why a template must not be stored, or null: the contract, then the rigs it makes (§7.5). */
export function rigTemplateSaveProblem(t: RigTemplate): string | null {
	const contract = rigTemplateProblem(t);
	if (contract) return contract;
	const all = t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	return (
		poseProblem(t, all, 'with every part') ??
		poseProblem(
			t,
			all.filter((r) => t.parts.find((p) => p.name === r.name)?.required),
			'with only the needed parts',
		)
	);
}
