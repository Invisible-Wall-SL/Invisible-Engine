/**
 * Contract check for rig templates (docs/design/rig-templates.md, T1–T3 + T7 full body):
 *   pnpm --filter launcher-api check:rig-templates
 *
 * Every template is well-formed, and a rig made from it — with all of its art, and with only the
 * required parts — passes the save validator AND loads, poses and measures under the game's rig
 * runtime with an atlas holding only the art's regions. That second half is the safety claim: the
 * runtime throws on an attachment whose region is missing, so a template rig over incomplete art
 * must leave the missing parts out rather than name them.
 */
import * as rig from 'engine-rig';
import type { FaceMotionEntry } from '../src/lib/rigMotion.ts';
import { irigDocProblem } from '../src/lib/server/riggerIrig.ts';
import { rigTemplateSaveProblem } from '../src/lib/server/rigTemplateCheck.ts';
import { rigTemplateFromRig } from '../src/lib/server/rigTemplateFromRig.ts';
import { parseTemplateSpec, type RigTemplateSpec } from '../src/lib/server/rigTemplateSchema.ts';
import { faceBlock } from '../src/lib/server/rigTemplateFace.ts';
import {
	BUST_FACE_V1,
	RIG_TEMPLATES,
	RIG_TEMPLATE_VERSIONS,
	rigTemplateById,
	rigTemplateFromSidecar,
	rigTemplateProblem,
	templateRig,
	type RigTemplate,
	type RigTemplateChannel,
	type RigTemplatePart,
	type RigTemplateTimelines,
	type TemplateRegion,
} from '../src/lib/server/rigTemplates.ts';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

const stubTexture = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};

/** A one-page atlas with these regions laid in a row; a few are trimmed, as packers do. */
function atlasText(regions: readonly TemplateRegion[]): string {
	const lines = ['page.png', 'size:4096,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		if (r.origW !== undefined) lines.push(`offsets:2,2,${r.origW},${r.origH}`);
		x += r.w;
	}
	return lines.join('\n') + '\n';
}

function artFor(t: RigTemplate, onlyRequired: boolean): TemplateRegion[] {
	return t.parts
		.filter((p) => !onlyRequired || p.required)
		.map((p, i) =>
			i % 3 === 0
				? { name: p.name, w: p.size[0] - 4, h: p.size[1] - 4, origW: p.size[0], origH: p.size[1] }
				: { name: p.name, w: p.size[0] + 10, h: p.size[1] + 10 },
		);
}

/** Every attachment name the rig uses: its skin's keys and each slot's setup attachment. */
function attachmentNames(skeleton: Record<string, unknown>): Set<string> {
	const out = new Set<string>();
	for (const skin of skeleton.skins as { attachments: Record<string, Record<string, unknown>> }[])
		for (const slot of Object.values(skin.attachments))
			for (const name of Object.keys(slot)) out.add(name);
	for (const s of skeleton.slots as { attachment?: string }[])
		if (s.attachment !== undefined) out.add(s.attachment);
	return out;
}

function loads(label: string, skeleton: Record<string, unknown>, regions: TemplateRegion[]): void {
	try {
		const atlas = new rig.TextureAtlas(atlasText(regions));
		for (const page of atlas.pages) page.setTexture(stubTexture as never);
		const data = new rig.SkeletonJson(new rig.AtlasAttachmentLoader(atlas)).readSkeletonData(
			skeleton,
		);
		const skel = new rig.Skeleton(data);
		skel.setToSetupPose();
		skel.updateWorldTransform(rig.Physics.update);
		const off = new rig.Vector2();
		const size = new rig.Vector2();
		skel.getBounds(off, size, []);
		if (regions.length)
			check(`${label}: measures a real extent`, size.x > 0 && size.y > 0, `${size.x}×${size.y}`);
		else checks++;
	} catch (e) {
		check(
			`${label}: loads under the rig runtime`,
			false,
			e instanceof Error ? e.message : String(e),
		);
	}
}

for (const t of RIG_TEMPLATE_VERSIONS) {
	check(
		`${t.id} v${t.version}: well-formed`,
		rigTemplateProblem(t) === null,
		String(rigTemplateProblem(t)),
	);

	const full = artFor(t, false);
	const all = templateRig(t, full);
	check(
		`${t.id} full art: valid irig`,
		irigDocProblem(all.skeleton) === null,
		String(irigDocProblem(all.skeleton)),
	);
	check(`${t.id} full art: nothing missing`, all.missing.length === 0, all.missing.join(', '));
	check(
		`${t.id} full art: remembers the template`,
		all.ref.id === t.id && all.ref.version === t.version,
	);
	loads(`${t.id} full art`, all.skeleton, full);

	const skin = (
		all.skeleton.skins as {
			attachments: Record<string, Record<string, { width: number; height: number }>>;
		}[]
	)[0];
	const trimmed = full[0];
	const att = skin.attachments[t.parts[0].slot]?.[trimmed.name];
	check(
		`${t.id}: a trimmed part is drawn at its untrimmed size`,
		att?.width === trimmed.origW && att?.height === trimmed.origH,
		JSON.stringify(att),
	);
	const untrimmed = full[1];
	const att2 = skin.attachments[t.parts[1].slot]?.[untrimmed.name];
	check(
		`${t.id}: an untrimmed part is drawn at its region size`,
		att2?.width === untrimmed.w && att2?.height === untrimmed.h,
		JSON.stringify(att2),
	);

	const required = artFor(t, true);
	const some = templateRig(t, required);
	const optional = t.parts.filter((p) => !p.required).map((p) => p.name);
	check(
		`${t.id} required art: valid irig`,
		irigDocProblem(some.skeleton) === null,
		String(irigDocProblem(some.skeleton)),
	);
	check(
		`${t.id} required art: lists every optional part as missing`,
		JSON.stringify(some.missing) === JSON.stringify(optional),
	);
	check(`${t.id} required art: nothing required missing`, some.missingRequired.length === 0);
	const used = attachmentNames(some.skeleton);
	check(
		`${t.id} required art: the rig uses exactly the parts the art has`,
		JSON.stringify([...used].sort()) === JSON.stringify(required.map((r) => r.name).sort()),
		[...used].join(', '),
	);
	loads(`${t.id} required art`, some.skeleton, required);

	const none = templateRig(t, []);
	check(
		`${t.id} no art: every required part reported`,
		JSON.stringify(none.missingRequired) ===
			JSON.stringify(t.parts.filter((p) => p.required).map((p) => p.name)),
	);
	check(
		`${t.id} no art: every slot starts empty`,
		(none.skeleton.slots as { attachment?: string }[]).every((s) => s.attachment === undefined),
	);
	loads(`${t.id} no art`, none.skeleton, []);
}

const broken: RigTemplate = {
	...RIG_TEMPLATES[0],
	slots: [...RIG_TEMPLATES[0].slots, { name: 'ghost', bone: 'nope' }],
};
check('a slot on a missing bone is refused', rigTemplateProblem(broken) !== null);
let threw = false;
try {
	templateRig(broken, []);
} catch {
	threw = true;
}
check('a broken template makes no rig', threw);
check(
	'a bone before its parent is refused',
	rigTemplateProblem({ ...RIG_TEMPLATES[0], bones: [...RIG_TEMPLATES[0].bones].reverse() }) !==
		null,
);
check(
	'a setup part from another slot is refused',
	rigTemplateProblem({
		...RIG_TEMPLATES[0],
		slots: RIG_TEMPLATES[0].slots.map((s) => (s.name === 'mouth' ? { ...s, setup: 'nose' } : s)),
	}) !== null,
);

// Face channels (T2): each kind of bad channel is refused by name.
const base = RIG_TEMPLATES[0];
const withChannel = (
	id: string,
	f: (c: RigTemplateChannel) => RigTemplateChannel,
): RigTemplate => ({
	...base,
	channels: base.channels.map((c) => (c.id === id ? f(c) : c)),
});
const withPart = (name: string, f: (p: RigTemplatePart) => RigTemplatePart): RigTemplate => ({
	...base,
	parts: base.parts.map((p) => (p.name === name ? f(p) : p)),
});
const withFace = (f: (e: FaceMotionEntry) => FaceMotionEntry): RigTemplate => ({
	...base,
	motion: {
		...base.motion!,
		face: { ...base.motion!.face!, entries: base.motion!.face!.entries.map(f) },
	},
});
const refused: [string, RigTemplate, RegExp][] = [
	[
		'a bending image on a missing bone',
		withPart('mouth_A', (p) => ({
			...p,
			bend: { grid: [3, 3], bones: [{ bone: 'chin', at: [0.5, 1] }] },
		})),
		/part "mouth_A" bends on a missing bone "chin"/,
	],
	[
		'a bending image on a one-row grid',
		withPart('brow_l_up', (p) => ({ ...p, bend: { ...p.bend!, grid: [5, 1] } })),
		/grid of 2 to 16/,
	],
	[
		'a bending image placing a bone off the image',
		withPart('brow_l_up', (p) => ({
			...p,
			bend: { ...p.bend!, bones: [{ bone: 'brow_in_l', at: [1.5, 0.5] }] },
		})),
		/places "brow_in_l" off the image/,
	],
	[
		'a bending image on a bone turned in the setup pose',
		{
			...base,
			bones: base.bones.map((b) => (b.name === 'brow_l' ? { ...b, rotation: 5 } : b)),
		},
		/bends on "brow_l", which is turned/,
	],
	[
		'a mouth shape posing a control that does not exist',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, pose: { mouth_O: { pout: 1 } } },
		})),
		/poses "pout", which is not a control/,
	],
	[
		'a mouth shape posing the jaw (the jaw opens by `open`)',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, pose: { mouth_O: { jaw: 1 } } },
		})),
		/poses "jaw", which is not a control/,
	],
	[
		'a mouth shape posing a control past its range',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, pose: { mouth_O: { smile_l: 2 } } },
		})),
		/poses "smile_l" to 2, outside -1…1/,
	],
	[
		'a pose for a part of another slot',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, pose: { nose: { smile_l: 1 } } },
		})),
		/poses "nose", not a part of "mouth"/,
	],
	[
		'a face motion entry in an unknown gain group',
		withFace((e) =>
			e.channel === 'jaw' ? ({ ...e, group: 'chin' } as unknown as FaceMotionEntry) : e,
		),
		/unknown group "chin"/,
	],
	[
		'a face filter with a negative follow',
		{
			...base,
			motion: { ...base.motion!, face: { ...base.motion!.face!, follow: -1 } },
		},
		/smoothing time and follow of 0 or more/,
	],
	[
		'a drive on a missing bone',
		withChannel('jaw', (c) => ({ ...c, drives: [{ bone: 'chin', prop: 'y', per: 1 }] })),
		/drives a missing bone "chin"/,
	],
	[
		'swaps out of order',
		withChannel('blink_l', (c) => ({ ...c, swaps: [...(c.swaps ?? [])].reverse() })),
		/rise in order|swap from its min/,
	],
	[
		'a swap to another slot’s part',
		withChannel('blink_l', (c) => ({
			...c,
			swaps: (c.swaps ?? []).map((w, i) => (i === 2 ? { ...w, part: 'eyelid_r_closed' } : w)),
		})),
		/not a part of "eyelid_l"/,
	],
	[
		'a talk shape from another slot',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, talk: [...c.shapes.talk, 'nose'] },
		})),
		/names "nose"/,
	],
	[
		'a lip-sync shape mapped to another slot’s part',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, lipsync: { ...c.shapes.lipsync, D: 'nose' } },
		})),
		/names "nose"/,
	],
	[
		'a lip-sync map missing a shape',
		withChannel('mouth', (c) => {
			const { X: _x, ...rest } = c.shapes?.lipsync ?? {};
			return { ...c, shapes: c.shapes && { ...c.shapes, lipsync: rest } };
		}),
		/no part for shape "X"/,
	],
	[
		'a lip-sync map naming an unknown shape',
		withChannel('mouth', (c) => ({
			...c,
			shapes: c.shapes && { ...c.shapes, lipsync: { ...c.shapes.lipsync, Q: 'mouth_A' } },
		})),
		/unknown shape "Q"/,
	],
	[
		'a mouth whose jaw channel is gone',
		{ ...base, channels: base.channels.filter((c) => c.id !== 'jaw') },
		/missing jaw channel "jaw"/,
	],
	[
		'two channels driving one bone property',
		withChannel('head_turn', (c) => ({ ...c, drives: [{ bone: 'head', prop: 'rotate', per: 1 }] })),
		/channels "head_tilt" and "head_turn" both drive head.rotate/,
	],
	[
		'a channel that moves nothing',
		withChannel('breath', (c) => ({ ...c, drives: [] })),
		/moves nothing/,
	],
	['rest outside the range', withChannel('breath', (c) => ({ ...c, rest: 2 })), /rest between/],
	...(
		[
			['a clip keying a missing channel', [0.5, 'wink', 1], /missing channel "wink"/],
			['a clip key out of range', [0.5, 'breath', 3], /not one of its values/],
			['a clip shape from another slot', [0.5, 'mouth', 'nose'], /not one of its values/],
			['a clip key past its end', [9, 'breath', 1], /outside 0/],
		] as const
	).map(([label, key, want]): [string, RigTemplate, RegExp] => [
		label,
		{
			...base,
			clips: base.clips.map((c, i) => (i === 0 ? { ...c, keys: [...c.keys, [...key]] } : c)),
		},
		want,
	]),
	[
		'two clips with one name',
		{ ...base, clips: [...base.clips, base.clips[0]] },
		/clip "idle" is listed twice/,
	],
	...(
		[
			[
				'motion on a missing channel',
				{ kind: 'blend', channel: 'wink', plus: ['jawOpen'], gain: 1 },
				/missing channel "wink"/,
			],
			[
				'motion reading an unknown blendshape',
				{ kind: 'blend', channel: 'breath', plus: ['jawOpne'], gain: 1 },
				/unknown blendshape "jawOpne"/,
			],
			[
				'motion keying the jaw twice',
				{ kind: 'blend', channel: 'jaw', plus: ['jawOpen'], gain: 1 },
				/channel "jaw" twice/,
			],
			[
				'motion setting a number on the mouth',
				{ kind: 'blend', channel: 'mouth', plus: ['jawOpen'], gain: 1 },
				/number on a shapes channel/,
			],
			[
				'motion naming a face point past 477',
				{ kind: 'angle', channel: 'breath', from: 33, to: 478, gain: 1, rest: 'level' },
				/face point outside/,
			],
			[
				'motion picking shapes on a number channel',
				{
					kind: 'shape',
					channel: 'breath',
					hold: 0.1,
					features: { open: ['jawOpen'] },
					shapes: {},
				},
				/channel has none/,
			],
		] as const
	).map(([label, entry, want]): [string, RigTemplate, RegExp] => [
		label,
		{
			...base,
			motion: {
				...base.motion!,
				face: {
					...base.motion!.face!,
					// The entry replaces the channel's own one, except where the case is the duplicate.
					entries: [
						...base.motion!.face!.entries.filter(
							(e) => /twice/.test(label) || e.channel !== entry.channel,
						),
						entry as FaceEntry,
					],
				},
			},
		},
		want,
	]),
	[
		'motion choosing a mouth image of another slot',
		{
			...base,
			motion: {
				...base.motion!,
				face: {
					...base.motion!.face!,
					entries: base.motion!.face!.entries.map((e) =>
						e.kind === 'shape' ? { ...e, shapes: { ...e.shapes, nose: {} } } : e,
					),
				},
			},
		},
		/names "nose", not a part of "mouth"/,
	],
];
type FaceEntry = NonNullable<NonNullable<RigTemplate['motion']>['face']>['entries'][number];
type BodyEntry = NonNullable<NonNullable<RigTemplate['motion']>['body']>['entries'][number];
const fullBody = RIG_TEMPLATES.find((t) => t.id === 'full-body')!;
const withBody = (f: (e: BodyEntry[]) => BodyEntry[]): RigTemplate => ({
	...fullBody,
	motion: {
		...fullBody.motion!,
		body: { ...fullBody.motion!.body!, entries: f(fullBody.motion!.body!.entries) },
	},
});
refused.push(
	[
		'a forearm solved before its upper arm',
		withBody((es) => {
			const i = es.findIndex((e) => e.channel === 'arm_l');
			const j = es.findIndex((e) => e.channel === 'elbow_l');
			const out = [...es];
			[out[i], out[j]] = [out[j], out[i]];
			return out;
		}),
		/turns "upper_arm_l" after its child "lower_arm_l"/,
	],
	[
		'motion turning a bone its channel does not rotate',
		withBody((es) => es.map((e) => (e.channel === 'knee_l' ? { ...e, bone: 'thigh_r' } : e))),
		/turns "thigh_r", which the channel does not rotate/,
	],
	[
		'motion turning a missing bone',
		withBody((es) => es.map((e) => (e.channel === 'knee_l' ? { ...e, bone: 'toe_l' } : e))),
		/missing bone "toe_l"/,
	],
	[
		'motion moving the root on an axis its channel does not drive',
		withBody((es) =>
			es.map((e) => (e.channel === 'hop' && e.kind === 'root' ? { ...e, axis: 'x' as const } : e)),
		),
		/moves the root on x/,
	],
	[
		'motion naming a pose point past 32',
		withBody((es) =>
			es.map((e) => (e.channel === 'arm_l' && e.kind === 'bone' ? { ...e, to: 33 } : e)),
		),
		/pose point outside/,
	],
	[
		'a minimum span past the whole body',
		withBody((es) =>
			es.map((e) => (e.channel === 'head_tilt' && e.kind === 'bone' ? { ...e, minSpan: 1.5 } : e)),
		),
		/minimum span between 0 and 1/,
	],
	[
		'a body scale with no rig length',
		{
			...fullBody,
			motion: {
				...fullBody.motion!,
				body: { ...fullBody.motion!.body!, scale: { ...fullBody.motion!.body!.scale, rig: 0 } },
			},
		},
		/rig length/,
	],
);
check(
	'bust-face maps the face, full-body the body',
	!!base.motion?.face && !base.motion?.body && !!fullBody.motion?.body && !fullBody.motion?.face,
);
check(
	'every face channel of bust-face but the nod and breath is driven by motion',
	base.channels
		.map((c) => c.id)
		.filter((id) => !base.motion!.face!.entries.some((e) => e.channel === id))
		.join() === 'head_nod,breath',
);
check(
	'bust-face v2 has the nine starter clips',
	base.clips.map((c) => c.name).join() ===
		'idle,blink,talk,happy,surprised,sad,angry,win_small,win_big',
);
check(
	'bust-face v1 keeps its seven starter clips',
	BUST_FACE_V1.clips.map((c) => c.name).join() ===
		'idle,blink,talk,happy,surprised,win_small,win_big',
);
check(
	'every face channel of bust-face v1 but the nod and breath is driven by motion',
	BUST_FACE_V1.channels
		.map((c) => c.id)
		.filter((id) => !BUST_FACE_V1.motion!.face!.entries.some((e) => e.channel === id))
		.join() === 'head_nod,breath',
);
check(
	'bust-face v2 keeps every bone of v1 where v1 has it',
	BUST_FACE_V1.bones.every((b) =>
		base.bones.some(
			(n) => n.name === b.name && n.parent === b.parent && n.x === b.x && n.y === b.y,
		),
	),
	BUST_FACE_V1.bones
		.filter((b) => !base.bones.some((n) => JSON.stringify(n) === JSON.stringify(b)))
		.map((b) => b.name)
		.join(),
);
check(
	'bust-face v2 keeps every control, part and slot of v1',
	BUST_FACE_V1.channels.every((c) => base.channels.some((n) => n.id === c.id)) &&
		BUST_FACE_V1.parts.every((p) =>
			base.parts.some((n) => n.name === p.name && n.slot === p.slot),
		) &&
		BUST_FACE_V1.slots.every((s) => base.slots.some((n) => n.name === s.name && n.bone === s.bone)),
);
check(
	'every face motion entry of bust-face v2 names its gain group',
	base.motion!.face!.entries.every((e) => e.group !== undefined),
);
const full = RIG_TEMPLATES.find((t) => t.id === 'full-body');
check('full-body is offered in New rig', !!full);
check(
	'full-body has the five starter clips',
	full?.clips.map((c) => c.name).join() === 'idle,celebrate,win_small,win_big,walk',
);
check(
	'full-body: every hand pose is a part of its hand slot, the open one needed',
	['l', 'r'].every((s) =>
		['open', 'fist', 'point'].every((h) =>
			full?.parts.some(
				(p) =>
					p.name === `hand_${s}_${h}` && p.slot === `hand_${s}` && p.required === (h === 'open'),
			),
		),
	),
);
check(
	'full-body: the legs carry no IK (the channels key their rotations)',
	!('ik' in (templateRig(full ?? base, []).skeleton as object)),
);
check(
	'template.json names full-body',
	rigTemplateFromSidecar('{"id":"full-body","version":1}')?.label === 'Full body',
);

// ── Half body: torso, arms, hands with every finger segment ────────────────────────────────────
const half = RIG_TEMPLATES.find((t) => t.id === 'half-body')!;
const FACE_BLOCK = faceBlock('head');
check('half-body is offered in New rig', !!half && half.label === 'Half body');
check(
	'template.json names half-body',
	rigTemplateFromSidecar('{"id":"half-body","version":1}')?.label === 'Half body',
);
const parentOf = (n: string) => half.bones.find((b) => b.name === n)?.parent ?? null;
const chainOf = (n: string): string[] => {
	const p = parentOf(n);
	return p ? [p, ...chainOf(p)] : [];
};
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGERS = DIGITS.slice(1);
check(
	'half-body: the spine chain is root → hip → spine → chest → neck → head',
	chainOf('head').join() === 'neck,chest,spine,hip,root',
	chainOf('head').join(),
);
for (const s of ['l', 'r']) {
	check(
		`half-body: the ${s} arm hangs clavicle → upper arm → forearm → hand off the chest`,
		chainOf(`hand_${s}`).join() ===
			`lower_arm_${s},upper_arm_${s},clavicle_${s},chest,spine,hip,root`,
		chainOf(`hand_${s}`).join(),
	);
	for (const d of DIGITS)
		check(
			`half-body: ${d} ${s} has three joints off the hand, each with its own image`,
			chainOf(`${d}_3_${s}`).slice(0, 3).join() === `${d}_2_${s},${d}_1_${s},hand_${s}` &&
				[1, 2, 3].every((n) =>
					half.parts.some(
						(p) => p.name === `${d}_${n}_${s}` && p.slot === `${d}_${n}_${s}` && !p.required,
					),
				),
		);
	check(
		`half-body: the ${s} hand poses are images of its hand slot, only the hand itself needed`,
		['', '_open', '_fist', '_point', '_thumbs_up'].every((v) =>
			half.parts.some(
				(p) => p.name === `hand_${s}${v}` && p.slot === `hand_${s}` && p.required === (v === ''),
			),
		),
	);
}
check(
	'half-body: torso, head, both arms, both hands and the face’s own needs are needed; nothing else',
	half.parts
		.filter((p) => p.required)
		.map((p) => p.name)
		.sort()
		.join() ===
		[
			'torso',
			'head',
			...['l', 'r'].flatMap((s) => [`upper_arm_${s}`, `lower_arm_${s}`, `hand_${s}`]),
			...FACE_BLOCK.parts.filter((p) => p.required).map((p) => p.name),
		]
			.sort()
			.join(),
);
// The face is the shared block, whole and unchanged, on the head; it draws over the head and ears
// and under both arms.
{
	const halfChanOf = (id: string) => half.channels.find((c) => c.id === id);
	const same = (a: unknown[], b: unknown[]) =>
		b.every((x) => a.some((y) => JSON.stringify(y) === JSON.stringify(x)));
	check(
		'half-body carries the face block whole: every bone, slot, image and control',
		same(half.bones, FACE_BLOCK.bones) &&
			same(half.slots, FACE_BLOCK.slots) &&
			same(half.parts, FACE_BLOCK.parts) &&
			same(half.channels, FACE_BLOCK.channels),
	);
	check(
		'half-body: the face hangs on the head bone',
		half.bones.find((b) => b.name === 'face')?.parent === 'head',
	);
	const at = (n: string) => half.slots.findIndex((x) => x.name === n);
	const faceSlots = FACE_BLOCK.slots.map((x) => at(x.name));
	check(
		'half-body: the face draws after the head and ears, as one run, before both arms',
		Math.min(...faceSlots) > Math.max(at('head'), at('ear_l'), at('ear_r')) &&
			Math.max(...faceSlots) - Math.min(...faceSlots) === faceSlots.length - 1 &&
			Math.max(...faceSlots) < Math.min(at('shoulder_l'), at('upper_arm_l'), at('shoulder_r')),
		faceSlots.join(),
	);
	check(
		'half-body: one head tilt (the face block’s), keeping its own nod and breath',
		half.channels
			.filter((c) => c.drives?.some((d) => d.bone === 'head'))
			.map((c) => c.id)
			.join() === 'head_tilt' &&
			JSON.stringify(halfChanOf('head_tilt')) ===
				JSON.stringify(FACE_BLOCK.channels.find((c) => c.id === 'head_tilt')) &&
			halfChanOf('head_nod')?.drives?.[0]?.bone === 'neck' &&
			halfChanOf('breath')?.drives?.[0]?.bone === 'chest',
	);
}
const halfChan = (id: string) => half.channels.find((c) => c.id === id);
check(
	'half-body: the body, arm, wrist, hand and finger controls are all there',
	[
		'lean',
		'twist',
		'breath',
		'head_tilt',
		'head_nod',
		...['l', 'r'].flatMap((s) => [
			`shrug_${s}`,
			`arm_${s}`,
			`reach_${s}`,
			`elbow_${s}`,
			`wrist_${s}`,
			`hand_${s}`,
			`curl_${s}`,
			`thumb_${s}`,
			`spread_${s}`,
			...FINGERS.map((f) => `curl_${f}_${s}`),
		]),
	].every((id) => !!halfChan(id)),
	half.channels.map((c) => c.id).join(),
);
check(
	'half-body: curling a hand sets its four fingers and its thumb',
	halfChan('curl_l')
		?.sets?.map((x) => x.channel)
		.join() === [...FINGERS.map((f) => `curl_${f}_l`), 'thumb_l'].join(),
);
check(
	'half-body: a drawn hand pose hides exactly that hand’s fifteen finger images',
	halfChan('hand_r')
		?.hides?.map((h) => h.slot)
		.sort()
		.join() ===
		DIGITS.flatMap((d) => [1, 2, 3].map((n) => `${d}_${n}_r`))
			.sort()
			.join() && !!halfChan('hand_r')?.hides?.every((h) => h.part === h.slot),
);
check(
	'half-body has the eight starter clips',
	half.clips.map((c) => c.name).join() ===
		'idle,wave,point,thumbs_up,fist_pump,celebrate,win_small,win_big',
	half.clips.map((c) => c.name).join(),
);
const restOf = (t: RigTemplate, id: string) => {
	const c = t.channels.find((x) => x.id === id);
	return c?.shapes ? c.shapes.rest : c?.rest;
};
for (const t of RIG_TEMPLATES)
	for (const c of t.clips) {
		const off = [...new Set(c.keys.map((k) => k[1]))].filter(
			(id) =>
				![0, c.length].every((at) =>
					c.keys.some((k) => k[1] === id && Math.abs(k[0] - at) < 1e-9 && k[2] === restOf(t, id)),
				),
		);
		check(
			`${t.id} ${c.name}: every control it keys starts and ends at rest`,
			!off.length,
			off.join(),
		);
	}
for (const t of RIG_TEMPLATES)
	check(
		`${t.id}: passes the save check (every control poses at min, rest and max)`,
		rigTemplateSaveProblem(t) === null,
		String(rigTemplateSaveProblem(t)),
	);
check(
	'half-body maps the face (the face block’s map, whole), the body and the hands',
	JSON.stringify(half.motion?.face) === JSON.stringify(FACE_BLOCK.motion) &&
		!!half.motion?.body &&
		!!half.motion?.hand,
);
check(
	'half-body: head tilt is read from the face, not from the body too',
	!half.motion?.body?.entries.some((e) => e.channel === 'head_tilt') &&
		!!half.motion?.face?.entries.some((e) => e.channel === 'head_tilt'),
);
check(
	'half-body: every starter clip moves the face as well as the body',
	half.clips.every((c) =>
		c.keys.some((k) => FACE_BLOCK.channels.some((f) => f.id === k[1] && f.id !== 'head_tilt')),
	),
	half.clips
		.filter(
			(c) =>
				!c.keys.some((k) => FACE_BLOCK.channels.some((f) => f.id === k[1] && f.id !== 'head_tilt')),
		)
		.map((c) => c.name)
		.join(),
);
check(
	'half-body: every finger curl, thumb and spread is tracked from the hands',
	['l', 'r'].every((s) =>
		[...FINGERS.map((f) => `curl_${f}_${s}`), `thumb_${s}`, `spread_${s}`].every((id) =>
			half.motion?.hand?.entries.some((e) => e.channel === id && e.side === s),
		),
	),
);
check(
	'half-body: shrug, arm, elbow and wrist are tracked from the body',
	['l', 'r'].every((s) =>
		['shrug', 'arm', 'elbow', 'wrist'].every((c) =>
			half.motion?.body?.entries.some((e) => e.channel === `${c}_${s}`),
		),
	),
);
type HandEntry = NonNullable<NonNullable<RigTemplate['motion']>['hand']>['entries'][number];
const withHalfChannel = (
	id: string,
	f: (c: RigTemplateChannel) => RigTemplateChannel,
): RigTemplate => ({ ...half, channels: half.channels.map((c) => (c.id === id ? f(c) : c)) });
const withHand = (f: (e: HandEntry[]) => HandEntry[]): RigTemplate => ({
	...half,
	motion: {
		...half.motion!,
		hand: { ...half.motion!.hand!, entries: f(half.motion!.hand!.entries) },
	},
});
const onHand = (id: string, f: (e: HandEntry) => HandEntry) =>
	withHand((es) => es.map((e) => (e.channel === id ? f(e) : e)));
refused.push(
	[
		'a curl setting a missing control',
		withHalfChannel('curl_l', (c) => ({ ...c, sets: [{ channel: 'curl_toe_l', per: 1 }] })),
		/sets a missing channel "curl_toe_l"/,
	],
	[
		'a curl setting itself',
		withHalfChannel('curl_l', (c) => ({ ...c, sets: [{ channel: 'curl_l', per: 1 }] })),
		/sets a missing channel "curl_l"/,
	],
	[
		'a curl setting another setting control',
		withHalfChannel('curl_l', (c) => ({ ...c, sets: [{ channel: 'curl_r', per: 1 }] })),
		/sets "curl_r", which is not a number/,
	],
	[
		'a curl setting one finger twice',
		withHalfChannel('curl_l', (c) => ({ ...c, sets: [...c.sets!, c.sets![0]] })),
		/sets "curl_index_l" twice/,
	],
	[
		'a setting control that also moves a bone',
		withHalfChannel('curl_l', (c) => ({
			...c,
			drives: [{ bone: 'hand_l', prop: 'x', per: 1 }],
		})),
		/sets other channels, so it moves nothing itself/,
	],
	[
		'a pose that hides slots but swaps none',
		withHalfChannel('wrist_l', (c) => ({
			...c,
			hides: [{ slot: 'index_1_l', part: 'index_1_l' }],
		})),
		/hides slots but swaps none/,
	],
	[
		'a pose hiding a missing slot',
		withHalfChannel('hand_l', (c) => ({ ...c, hides: [{ slot: 'toe_1_l', part: 'toe_1_l' }] })),
		/hides a missing slot "toe_1_l"/,
	],
	[
		'a pose restoring another slot’s image',
		withHalfChannel('hand_l', (c) => ({ ...c, hides: [{ slot: 'index_1_l', part: 'index_2_l' }] })),
		/shows "index_2_l" in "index_1_l"/,
	],
	[
		'a pose hiding its own slot',
		withHalfChannel('hand_l', (c) => ({ ...c, hides: [{ slot: 'hand_l', part: 'hand_l' }] })),
		/hides its own slot/,
	],
	[
		'two poses hiding one finger',
		withHalfChannel('hand_r', (c) => ({ ...c, hides: [{ slot: 'index_1_l', part: 'index_1_l' }] })),
		/channels "hand_l" and "hand_r" both key the image of "index_1_l"/,
	],
	[
		'a clip keying a hand curl and one of its fingers',
		{
			...half,
			clips: half.clips.map((c) =>
				c.name === 'fist_pump' ? { ...c, keys: [...c.keys, [0.5, 'curl_index_r', 0.5]] } : c,
			),
		},
		/keys both "curl_r" and "curl_index_r"/,
	],
	[
		'motion on the hand curl (it only sets others)',
		withHand((es) => [
			...es,
			{ kind: 'curl', channel: 'curl_l', side: 'l', joints: [[0, 5, 6]], rest: 0, full: 90 },
		]),
		/"curl_l", which only sets other channels/,
	],
	[
		'motion naming a hand point past 20',
		onHand('curl_index_l', (e) => (e.kind === 'curl' ? { ...e, joints: [[0, 5, 21]] } : e)),
		/hand point outside 0…20/,
	],
	[
		'motion on a hand side that is neither',
		onHand('spread_r', (e) => ({ ...e, side: 'x' as 'l' })),
		/hand side l or r/,
	],
	[
		'a curl reading no joint',
		onHand('thumb_l', (e) => (e.kind === 'curl' ? { ...e, joints: [] } : e)),
		/reads no joint/,
	],
	[
		'a spread whose full angle is its rest',
		onHand('spread_l', (e) => ({ ...e, full: e.rest })),
		/full angle apart from its rest/,
	],
	[
		'hand motion on a missing control',
		onHand('spread_l', (e) => ({ ...e, channel: 'splay_l' })),
		/missing channel "splay_l"/,
	],
	[
		'hand motion driving a control the body already drives',
		onHand('spread_l', (e) => ({ ...e, channel: 'wrist_l' })),
		/channel "wrist_l" twice/,
	],
	[
		'hand motion setting a number on the mouth',
		{
			...base,
			motion: {
				...base.motion!,
				face: {
					...base.motion!.face!,
					entries: base.motion!.face!.entries.filter((e) => e.channel !== 'mouth'),
				},
				hand: {
					smooth: 0,
					entries: [
						{ kind: 'curl', channel: 'mouth', side: 'l', joints: [[0, 5, 6]], rest: 0, full: 90 },
					],
				},
			},
		},
		/number on a shapes channel/,
	],
);
{
	// The pose check keys a hand curl through the fingers it sets: one set far past what poses
	// passes the contract (a set has no range of its own) but not the save.
	const wild = withHalfChannel('curl_l', (c) => ({
		...c,
		sets: c.sets!.map((s, i) => (i === 0 ? { ...s, per: 1e308 } : s)),
	}));
	check(
		'a hand curl that would fold a finger past posing is refused by the save check',
		rigTemplateProblem(wild) === null &&
			/control "curl_l" does not pose/.test(String(rigTemplateSaveProblem(wild))),
		String(rigTemplateSaveProblem(wild)),
	);
}
for (const [label, t, want] of refused) {
	const problem = rigTemplateProblem(t);
	check(`a template with ${label} is refused`, !!problem && want.test(problem), String(problem));
	// What a save runs: the same reason, answered (never thrown by the rig it would make).
	let saved: string | null;
	try {
		saved = rigTemplateSaveProblem(t);
	} catch (e) {
		saved = `threw: ${e instanceof Error ? e.message : e}`;
	}
	check(`…and a save of it is refused for the same reason`, saved === problem, String(saved));
}

check(
	'template.json names a template we have, at the version the rig was made from',
	rigTemplateFromSidecar('{"id":"bust-face","version":1}')?.version === 1 &&
		rigTemplateFromSidecar('{"id":"bust-face","version":1}')?.channels.length ===
			BUST_FACE_V1.channels.length &&
		rigTemplateFromSidecar('{"id":"bust-face","version":2}')?.channels.length ===
			base.channels.length,
);
check(
	'a built-in version we do not have reads as the newest; no version reads as the newest too',
	rigTemplateById('bust-face', 9)?.version === base.version &&
		rigTemplateById('bust-face')?.version === base.version &&
		RIG_TEMPLATES.every((t) => rigTemplateById(t.id)?.version === t.version),
);
check(
	'template.json that is missing, broken or unknown reads as no template',
	[null, '{', '"x"', '{"id":"gone","version":1}', '{"id":3}'].every(
		(t) => rigTemplateFromSidecar(t) === null,
	),
);

// ── 📐 Save as template (T8, §7): a template derived from a rig ─────────────────────────────────
// A bust-face rig, plus a starter clip of its own, saved as a template: the derived skeleton, parts
// and controls are the original's, it passes the save check, and the rig it makes is the original's.
const bustArt = artFor(BUST_FACE_V1, false);
const bustRig = templateRig(BUST_FACE_V1, bustArt).skeleton;
const wave = {
	bones: { head: { rotate: [{ value: 0 }, { time: 0.5, value: 8 }, { time: 1, value: 0 }] } },
	slots: {
		mouth: {
			attachment: [
				{ time: 0.2, name: 'mouth_O' },
				{ time: 0.8, name: 'mouth_rest' },
			],
		},
	},
};
const specOf = (t: RigTemplate, clips: string[] = []): RigTemplateSpec => ({
	label: `My ${t.label}`,
	required: t.parts.filter((p) => p.required).map((p) => p.name),
	channels: t.channels,
	clips,
	motion: t.motion ?? null,
});
const derive = (doc: Record<string, unknown>, spec: RigTemplateSpec) => {
	const d = rigTemplateFromRig(doc, spec, 'my_bust', 1);
	if (typeof d === 'string') throw new Error(`derive refused: ${d}`);
	return d;
};
{
	const v1 = BUST_FACE_V1;
	const d = derive({ ...bustRig, animations: { wave } }, specOf(v1, ['wave']));
	const t = d.template;
	check(
		'derived: bones in order, with their setup places',
		JSON.stringify(t.bones) === JSON.stringify(v1.bones),
		JSON.stringify(t.bones.slice(0, 3)),
	);
	check(
		'derived: slots in draw order with their setup images',
		JSON.stringify(t.slots) === JSON.stringify(v1.slots),
	);
	check(
		'derived: every image is a part of its slot, needed as marked, at its drawn size',
		JSON.stringify(t.parts.map((p) => [p.name, p.slot, p.required]).sort()) ===
			JSON.stringify(v1.parts.map((p) => [p.name, p.slot, p.required]).sort()),
	);
	check('derived: no notes for a plain template rig', d.notes.length === 0, d.notes.join(' | '));
	check(
		'derived: the clip is kept as its timelines, with its length',
		t.clips.length === 1 &&
			t.clips[0].length === 1 &&
			JSON.stringify(t.clips[0].animation) === JSON.stringify(wave) &&
			t.clips[0].keys.length === 0,
	);
	check(
		'derived: passes the save check (contract + pose)',
		rigTemplateSaveProblem(t) === null,
		String(rigTemplateSaveProblem(t)),
	);
	const again = templateRig(t, bustArt).skeleton;
	check(
		'a rig made from the saved template is the rig the original makes',
		JSON.stringify({ ...again, animations: {} }) === JSON.stringify(bustRig),
	);
	{
		const v2 = derive(templateRig(base, artFor(base, false)).skeleton, specOf(base));
		const bent = base.parts.filter((p) => p.bend).map((p) => p.name);
		check(
			'a bust-face v2 rig saved as a template passes the save check',
			rigTemplateSaveProblem(v2.template) === null,
			String(rigTemplateSaveProblem(v2.template)),
		);
		check(
			'…its bending images come back as image parts, each one named in a note',
			bent.length > 0 &&
				bent.every((n) => v2.template.parts.some((p) => p.name === n && !p.bend)) &&
				bent.every((n) => v2.notes.some((x) => x.startsWith(`"${n}" is a mesh here`))) &&
				v2.notes.length === bent.length,
			v2.notes.join(' | '),
		);
	}
	check(
		'a full-body rig saved as a template passes too',
		rigTemplateSaveProblem(
			derive(templateRig(fullBody, artFor(fullBody, false)).skeleton, specOf(fullBody)).template,
		) === null,
	);
	const halfSaved = derive(templateRig(half, artFor(half, false)).skeleton, specOf(half)).template;
	check(
		'a half-body rig saved as a template passes, keeping its hand curls, poses and hand tracking',
		rigTemplateSaveProblem(halfSaved) === null &&
			JSON.stringify(halfSaved.channels) === JSON.stringify(half.channels) &&
			JSON.stringify(halfSaved.motion?.hand) === JSON.stringify(half.motion?.hand),
		String(rigTemplateSaveProblem(halfSaved)),
	);
}
const sorted = (o: object) => JSON.stringify(Object.entries(o).sort());
// Placement, meshes and what is left out.
{
	const doc = {
		irig: 1,
		skeleton: {},
		bones: [
			{ name: 'root' },
			{ name: 'arm', parent: 'root', x: 10, y: 20, rotation: -90, length: 50, scaleX: 1.5 },
		],
		slots: [
			{ name: 'arm', bone: 'arm', attachment: 'arm', blend: 'additive', color: 'ff0000ff' },
			{ name: 'cape', bone: 'root', attachment: 'cape' },
			{ name: 'clip', bone: 'root', attachment: 'clipper' },
			{ name: 'arm2', bone: 'arm' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					arm: { arm: { x: 25, y: -4, rotation: 90, width: 40, height: 100 } },
					cape: {
						cape: {
							type: 'mesh',
							uvs: [0, 0, 1, 0, 1, 1, 0, 1],
							vertices: [-10, 0, 30, 0, 30, 60, -10, 60],
							triangles: [0, 1, 2, 2, 3, 0],
							hull: 4,
						},
					},
					clip: {
						clipper: { type: 'clipping', end: 'arm', vertexCount: 3, vertices: [0, 0, 1, 0, 0, 1] },
					},
					arm2: { arm: { width: 10, height: 10 } },
				},
			},
			{ name: 'winter', attachments: {} },
		],
		ik: [{ name: 'reach', bones: ['arm'], target: 'root' }],
		animations: {},
	};
	const d = derive(doc, { label: 'Arm', required: ['arm'], channels: [], clips: [], motion: null });
	const t = d.template;
	check(
		'a turned, sized bone keeps its setup rotation, length and scale',
		JSON.stringify(t.bones[1]) ===
			JSON.stringify({
				name: 'arm',
				parent: 'root',
				x: 10,
				y: 20,
				rotation: -90,
				length: 50,
				scaleX: 1.5,
			}),
		JSON.stringify(t.bones[1]),
	);
	check(
		'a slot keeps its blend and colour',
		t.slots[0].blend === 'additive' && t.slots[0].color === 'ff0000ff',
	);
	const arm = t.parts.find((p) => p.name === 'arm');
	check(
		'an image keeps where it sits on its bone',
		JSON.stringify(arm?.at) === JSON.stringify({ x: 25, y: -4, rotation: 90 }) &&
			JSON.stringify(arm?.size) === '[40,100]',
		JSON.stringify(arm),
	);
	const cape = t.parts.find((p) => p.name === 'cape');
	check(
		'a mesh becomes an image part over its vertices’ box',
		JSON.stringify(cape?.size) === '[40,60]' && JSON.stringify(cape?.at) === '{"x":10,"y":30}',
		JSON.stringify(cape),
	);
	check('a clipping attachment is left out', !t.parts.some((p) => p.name === 'clipper'));
	check(
		'an image in two slots is one part (the first)',
		t.parts.filter((p) => p.name === 'arm').length === 1 && arm?.slot === 'arm',
	);
	check(
		'the author is told about the mesh, the clipping, the duplicate, the skin and the IK',
		['mesh', 'not an image', 'in slots', 'winter', 'ik constraints'].every((w) =>
			d.notes.some((n) => n.includes(w)),
		),
		d.notes.join(' | '),
	);
	const made = templateRig(t, [
		{ name: 'arm', w: 40, h: 100 },
		{ name: 'cape', w: 40, h: 60 },
	]).skeleton as {
		bones: Record<string, unknown>[];
		slots: Record<string, unknown>[];
		skins: { attachments: Record<string, Record<string, Record<string, unknown>>> }[];
	};
	check(
		'a rig made from it puts the bone, the slot and the image where the original had them',
		sorted(made.bones[1]) === sorted(doc.bones[1]) &&
			made.slots[0].blend === 'additive' &&
			made.slots[0].color === 'ff0000ff' &&
			JSON.stringify(made.skins[0].attachments.arm.arm) ===
				JSON.stringify({ x: 25, y: -4, rotation: 90, width: 40, height: 100 }),
		JSON.stringify(made.skins[0].attachments.arm),
	);
	check(
		'…and it passes the save check',
		rigTemplateSaveProblem(t) === null,
		String(rigTemplateSaveProblem(t)),
	);
	check(
		'an unknown needed part is refused by name',
		rigTemplateFromRig(
			doc,
			{ label: 'A', required: ['leg'], channels: [], clips: [], motion: null },
			'a',
			1,
		) === '"leg" is marked needed but is not an image of this rig',
	);
	check(
		'a template with no needed part is refused',
		/at least one part/.test(
			String(
				rigTemplateFromRig(
					doc,
					{ label: 'A', required: [], channels: [], clips: [], motion: null },
					'a',
					1,
				),
			),
		),
	);
	check(
		'a starter clip the rig does not have is refused',
		/no animation "jump"/.test(
			String(
				rigTemplateFromRig(
					doc,
					{ label: 'A', required: ['arm'], channels: [], clips: ['jump'], motion: null },
					'a',
					1,
				),
			),
		),
	);
}
// A timeline clip may only play what a template rig has.
{
	const withClip = (animation: Record<string, unknown>): RigTemplate => ({
		...base,
		clips: [{ name: 'own', length: 1, keys: [], animation: animation as RigTemplateTimelines }],
	});
	const clipRefused: [string, Record<string, unknown>, RegExp][] = [
		['a deform (mesh) timeline', { attachments: { default: {} } }, /"attachments" timelines/],
		['an IK timeline', { ik: { reach: [{ time: 0 }] } }, /"ik" timelines/],
		['an event timeline', { events: [{ time: 0, name: 'x' }] }, /"events" timelines/],
		['a bone the template lacks', { bones: { tail: { rotate: [{ value: 1 }] } } }, /bone "tail"/],
		['a slot the template lacks', { slots: { hat: { alpha: [{ value: 1 }] } } }, /slot "hat"/],
		[
			'a part of another slot',
			{ slots: { mouth: { attachment: [{ name: 'nose' }] } } },
			/"nose" in slot "mouth"/,
		],
		[
			'an inherit timeline',
			{ bones: { head: { inherit: [{ inherit: 'noScale' }] } } },
			/"inherit" timeline/,
		],
		['a key past its end', { bones: { head: { rotate: [{ time: 3, value: 1 }] } } }, /outside 0/],
		['an empty timeline', { bones: { head: { rotate: [] } } }, /empty/],
		[
			'a reorder of a missing slot',
			{ drawOrder: [{ time: 0, offsets: [{ slot: 'hat', offset: 1 }] }] },
			/reorders a slot "hat"/,
		],
	];
	for (const [label, a, want] of clipRefused) {
		const p = rigTemplateProblem(withClip(a));
		check(`a timeline clip with ${label} is refused`, !!p && want.test(p), String(p));
	}
	const both: RigTemplate = {
		...base,
		clips: [{ name: 'own', length: 1, keys: [[0, 'breath', 0]], animation: {} }],
	};
	check(
		'a clip with keys and timelines is refused',
		/both channel keys and timelines/.test(String(rigTemplateProblem(both))),
	);
	const bad = withClip({ bones: { head: { rotate: [{ time: 0, value: 'lots' }] } } });
	check(
		'a clip whose values would not load passes the contract but fails the save check',
		rigTemplateProblem(bad) === null && /would not save/.test(String(rigTemplateSaveProblem(bad))),
		String(rigTemplateSaveProblem(bad)),
	);
	const missingSetup: RigTemplate = {
		...base,
		parts: base.parts.map((p) =>
			p.name === 'head' ? { ...p, size: [0, 0] as [number, number] } : p,
		),
	};
	check(
		'the save check passes a zero-size part (it draws nothing)',
		rigTemplateSaveProblem(missingSetup) === null,
		String(rigTemplateSaveProblem(missingSetup)),
	);
}
// A carried body map on a bone turned in the setup pose has no picture direction to read.
{
	const turned: RigTemplate = {
		...fullBody,
		bones: fullBody.bones.map((b) => (b.name === 'thigh_l' ? { ...b, rotation: 10 } : b)),
	};
	check(
		'body motion on a bone turned in the setup pose is refused unless it says its rest',
		/"thigh_l" is turned/.test(String(rigTemplateProblem(turned))),
		String(rigTemplateProblem(turned)),
	);
}
// The strict shape of what the page posts.
{
	const ok = specOf(base);
	check(
		'the posted spec of bust-face parses',
		typeof parseTemplateSpec(ok) === 'object',
		String(parseTemplateSpec(ok)),
	);
	const okHalf = specOf(half);
	const parsedHalf = parseTemplateSpec(okHalf);
	// The schema writes each object's keys in its own order, so compare them sorted.
	const canon = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(canon)
			: v && typeof v === 'object'
				? Object.fromEntries(
						Object.keys(v)
							.sort()
							.map((k) => [k, canon((v as Record<string, unknown>)[k])]),
					)
				: v;
	check(
		'the posted spec of half-body parses, whole',
		typeof parsedHalf === 'object' &&
			JSON.stringify(canon(parsedHalf)) === JSON.stringify(canon(okHalf)),
		String(typeof parsedHalf === 'string' ? parsedHalf : 'changed by the parse'),
	);
	const curlAt = okHalf.channels.findIndex((c) => c.id === 'curl_l');
	const poseAt = okHalf.channels.findIndex((c) => c.id === 'hand_l');
	const halfBad: [string, unknown, RegExp][] = [
		[
			'a set with a field it does not have',
			{
				...okHalf,
				channels: okHalf.channels.map((c, i) =>
					i === curlAt ? { ...c, sets: [{ ...c.sets![0], mix: 1 }] } : c,
				),
			},
			/Unrecognized key/,
		],
		[
			'a hidden slot with a field it does not have',
			{
				...okHalf,
				channels: okHalf.channels.map((c, i) =>
					i === poseAt ? { ...c, hides: [{ ...c.hides![0], fade: 1 }] } : c,
				),
			},
			/Unrecognized key/,
		],
		[
			'a hand entry with a field it does not have',
			{
				...okHalf,
				motion: {
					...okHalf.motion,
					hand: {
						...okHalf.motion!.hand,
						entries: [{ ...okHalf.motion!.hand!.entries[0], wobble: 2 }],
					},
				},
			},
			/Unrecognized key/,
		],
		[
			'a hand entry of an unknown kind',
			{
				...okHalf,
				motion: { ...okHalf.motion, hand: { smooth: 0, entries: [{ kind: 'wiggle' }] } },
			},
			/kind/,
		],
	];
	for (const [label, v, want] of halfBad) {
		const r = parseTemplateSpec(v);
		check(
			`a posted spec with ${label} is refused`,
			typeof r === 'string' && want.test(r),
			String(r),
		);
	}
	const bad: [string, unknown, RegExp][] = [
		['an unknown field', { ...ok, extra: 1 }, /Unrecognized key/],
		[
			'a control field the Rigger does not read',
			{ ...ok, channels: [{ ...ok.channels[1], colour: 'red' }] },
			/Unrecognized key/,
		],
		[
			'a control id with a space',
			{ ...ok, channels: [{ ...ok.channels[1], id: 'jaw open' }] },
			/lower-case/,
		],
		[
			'a drive on an unknown property',
			{ ...ok, channels: [{ ...ok.channels[1], drives: [{ bone: 'jaw', prop: 'z', per: 1 }] }] },
			/prop/,
		],
		[
			'a range that is not a number',
			{ ...ok, channels: [{ ...ok.channels[1], max: 'high' }] },
			/max/,
		],
		['a blank label', { ...ok, label: '  ' }, /label/],
		[
			'a motion entry of an unknown kind',
			{
				...ok,
				motion: { cannot: [], face: { smooth: 0, entries: [{ kind: 'wiggle', channel: 'jaw' }] } },
			},
			/kind/,
		],
		[
			'a motion map with a field it does not have',
			{ ...ok, motion: { ...ok.motion, hands: {} } },
			/Unrecognized key/,
		],
		[
			'a motion entry with a field it does not have',
			{
				...ok,
				motion: {
					...ok.motion,
					face: {
						smooth: 0,
						entries: [{ kind: 'blend', channel: 'jaw', plus: ['jawOpen'], gain: 1, wobble: 2 }],
					},
				},
			},
			/Unrecognized key/,
		],
	];
	for (const [label, v, want] of bad) {
		const r = parseTemplateSpec(v);
		check(
			`a posted spec with ${label} is refused`,
			typeof r === 'string' && want.test(r),
			String(r),
		);
	}
}

if (failures) {
	console.error(`rig templates: ${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`rig templates: ${checks}/${checks} checks pass`);
