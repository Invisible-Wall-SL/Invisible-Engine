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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as rig from 'engine-rig';
import { depthEffectOf, type FaceMotionEntry, type RigMotionMap } from '../src/lib/rigMotion.ts';
import { CONTROLS_SIDECAR, CONTROLS_VERSION, checkedControls } from '../src/lib/rigControls.ts';
import { ik3dProblems, pose3d, type Ik3d } from '../src/lib/rig2p5d.ts';
import {
	clipOf,
	rig3dDocProblems,
	rig3dIrigProblems,
	rigOf,
	type Rig3dDoc,
} from '../src/lib/rig3d.ts';
import { limb3dProblem, switchLimb3d, type Limb3d } from '../src/lib/rig3dIk.ts';
import { importClip3d, rebakeClip3d, type Template3d } from '../src/lib/rig3dImport.ts';
import { make3dFromTemplate } from '../src/lib/rig3dViews.ts';
import { irigDocProblem } from '../src/lib/server/riggerIrig.ts';
import { pairMark } from '../src/lib/server/riggerIrigWrite.ts';
import { newRigControls } from '../src/lib/server/riggerNewRig.ts';
import { controlChannel } from '../src/lib/server/rigTemplateControls.ts';
import { controlAnimation, rigTemplateSaveProblem } from '../src/lib/server/rigTemplateCheck.ts';
import { rigTemplateFromRig } from '../src/lib/server/rigTemplateFromRig.ts';
import {
	channelSchema,
	parseTemplateSpec,
	type RigTemplateSpec,
} from '../src/lib/server/rigTemplateSchema.ts';
import { faceBlock } from '../src/lib/server/rigTemplateFace.ts';
import {
	RIG_TEMPLATES,
	orderOffsets,
	rigTemplateById,
	rigTemplateFromSidecar,
	rigTemplateProblem,
	swapPart,
	templateRig,
	type RigTemplate,
	type RigTemplateChannel,
	type RigTemplatePart,
	type RigTemplateTimelines,
	type TemplateRegion,
} from '../src/lib/server/rigTemplates.ts';
import {
	boneWorld,
	fitTemplate,
	rigFitProblem,
	type RigFit,
} from '../src/lib/server/rigTemplateFit.ts';

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

for (const t of RIG_TEMPLATES) {
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
		/grid of 2 to 32/,
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
	[
		'a face-board box with two channels on one axis',
		withChannel('gaze_y', (c) => ({ ...c, ui: { box: 'gaze', axis: 'x' } })),
		/face-board box "gaze" needs one channel per axis/,
	],
	[
		'a face-board slider with no place',
		withChannel('jaw', (c) => ({ ...c, ui: { axis: 'y' } })),
		/channel "jaw" is on the face board with no place/,
	],
	[
		'a mouth-shape channel on the face board',
		withChannel('mouth', (c) => ({ ...c, ui: { at: [0.5, 0.8] } })),
		/channel "mouth" picks a mouth shape/,
	],
];
// The face board (rig-controls §6.1): a channel's place, and a box of the gaze pair, are accepted.
{
	const placed: RigTemplate = {
		...base,
		channels: base.channels.map((c) =>
			c.id === 'gaze_x'
				? { ...c, ui: { box: 'gaze', axis: 'x', at: [0.5, 0.3] } }
				: c.id === 'gaze_y'
					? { ...c, ui: { box: 'gaze', axis: 'y' } }
					: c.id === 'jaw'
						? { ...c, ui: { at: [0.5, 0.8], axis: 'y' } }
						: c,
		),
	};
	check(
		'a template with a face board passes',
		rigTemplateProblem(placed) === null,
		String(rigTemplateProblem(placed)),
	);
}
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
	'bust-face has the nine starter clips',
	base.clips.map((c) => c.name).join() ===
		'idle,blink,talk,happy,surprised,sad,angry,win_small,win_big',
);
check(
	'every face motion entry of bust-face names its gain group, or answers a depth strength',
	base.motion!.face!.entries.every((e) => e.group !== undefined || depthEffectOf(e) !== null) &&
		base.motion!.face!.entries.some((e) => depthEffectOf(e) === 'approach'),
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
	rigTemplateFromSidecar(`{"id":"full-body","version":${full?.version}}`)?.label === 'Full body',
);

// ── Half body: torso, arms, hands with every finger segment ────────────────────────────────────
const half = RIG_TEMPLATES.find((t) => t.id === 'half-body')!;
const FACE_BLOCK = faceBlock('head', { back: ['hair_back'], front: ['hair_front'] });
check('half-body is offered in New rig', !!half && half.label === 'Half body');
check(
	'template.json names half-body',
	rigTemplateFromSidecar(`{"id":"half-body","version":${half.version}}`)?.label === 'Half body',
);
const parentOf = (n: string) => half.bones.find((b) => b.name === n)?.parent ?? null;
const chainOf = (n: string): string[] => {
	const p = parentOf(n);
	return p ? [p, ...chainOf(p)] : [];
};
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGERS = DIGITS.slice(1);
check(
	'half-body: the spine chain is root → hip → spine → chest → neck → neck_upper → head',
	chainOf('head').join() === 'neck_upper,neck,chest,spine,hip,root',
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
	// The face board (`ui`) is the template's layout of the block's channels, not part of the block.
	const halfChannels = half.channels.map((c) => ({ ...c, ui: undefined }));
	const halfChanOf = (id: string) => halfChannels.find((c) => c.id === id);
	const same = (a: unknown[], b: unknown[]) =>
		b.every((x) => a.some((y) => JSON.stringify(y) === JSON.stringify(x)));
	check(
		'half-body carries the face block whole: every bone, slot, image and control',
		same(half.bones, FACE_BLOCK.bones) &&
			same(half.slots, FACE_BLOCK.slots) &&
			same(half.parts, FACE_BLOCK.parts) &&
			same(
				halfChannels.map((c) => JSON.parse(JSON.stringify(c))),
				FACE_BLOCK.channels,
			),
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
			JSON.stringify(JSON.parse(JSON.stringify(halfChanOf('head_tilt')))) ===
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
// Depth (§5.4): a draw-order control and each depth reading are refused by name when they could not
// key what they say.
type HalfOrder = NonNullable<RigTemplateChannel['order']>;
const withOrder = (id: string, f: (o: HalfOrder) => HalfOrder): RigTemplate =>
	withHalfChannel(id, (c) => ({ ...c, order: f(c.order!) }));
const swapDepth = (f: (e: BodyEntry) => BodyEntry) =>
	withBody((es) => es.map((e) => (e.channel === 'depth_l' ? f(e) : e)));
refused.push(
	[
		'a depth control reordering a missing slot',
		withOrder('depth_l', (o) => ({ ...o, slots: [...o.slots, 'tail'] })),
		/reorders a missing slot "tail"/,
	],
	[
		'a depth control reordering nothing',
		withOrder('depth_l', (o) => ({ ...o, slots: [] })),
		/reorders no slot/,
	],
	[
		'a depth control moving a slot twice',
		withOrder('depth_l', (o) => ({ ...o, slots: [...o.slots, o.slots[0]] })),
		/reorders a slot twice/,
	],
	[
		'a depth control behind a missing slot',
		withOrder('depth_l', (o) => ({ ...o, steps: [{ at: 1, behind: 'cape' }] })),
		/behind a missing slot "cape"/,
	],
	[
		'a depth control with no step',
		withOrder('depth_l', (o) => ({ ...o, steps: [] })),
		/at no step/,
	],
	[
		'a depth control putting its slots behind one drawn after them',
		withOrder('depth_l', (o) => ({ ...o, steps: [{ at: 1, behind: 'upper_arm_r' }] })),
		/behind "upper_arm_r", which is not drawn before them/,
	],
	[
		'a deeper depth step that is not further back',
		withOrder('depth_l', (o) => ({
			...o,
			steps: [
				{ at: 1, behind: 'torso' },
				{ at: 2, behind: 'head' },
			],
		})),
		/behind "head", which is not drawn before the step before/,
	],
	[
		'depth steps out of order',
		withOrder('depth_l', (o) => ({ ...o, steps: [...o.steps].reverse() })),
		/steps must rise in order/,
	],
	[
		'a depth control resting behind',
		withHalfChannel('depth_l', (c) => ({ ...c, rest: 1 })),
		/rests below its first step/,
	],
	[
		'two depth controls moving one slot',
		withOrder('depth_r', (o) => ({ ...o, slots: [...o.slots, 'upper_arm_l'] })),
		/both reorder "upper_arm_l"/,
	],
	[
		'a depth control that also moves a bone',
		withHalfChannel('depth_l', (c) => ({
			...c,
			drives: [{ bone: 'hair_back', prop: 'rotate', per: 1 }],
		})),
		/reorders slots, so it moves nothing else/,
	],
	[
		'a depth reading on a control that neither reorders nor swaps',
		swapDepth((e) => ({ ...e, channel: 'head_nod' })),
		/neither reorders nor swaps/,
	],
	[
		'a depth step outside its control’s range',
		swapDepth((e) =>
			e.kind === 'depth' ? { ...e, steps: [{ ...e.steps[0], at: 3 }, ...e.steps.slice(1)] } : e,
		),
		/steps to 3/,
	],
	[
		'a depth step with no margin',
		swapDepth((e) =>
			e.kind === 'depth'
				? { ...e, steps: [{ ...e.steps[0], margin: NaN }, ...e.steps.slice(1)] }
				: e,
		),
		/needs a depth margin/,
	],
	[
		'a depth point outside the pose points',
		swapDepth((e) => (e.kind === 'depth' ? { ...e, point: 40 } : e)),
		/names a pose point outside/,
	],
	[
		'a depth step behind a point outside the pose points',
		swapDepth((e) =>
			e.kind === 'depth'
				? { ...e, steps: [{ ...e.steps[0], behind: 40 }, ...e.steps.slice(1)] }
				: e,
		),
		/names a pose point outside/,
	],
	[
		'a depth step below a point outside the pose points',
		swapDepth((e) =>
			e.kind === 'depth' ? { ...e, steps: [{ ...e.steps[0], below: 33 }, ...e.steps.slice(1)] } : e,
		),
		/names a pose point outside/,
	],
	[
		'a draw-order control turned like a bone',
		swapDepth(() => ({
			kind: 'bone',
			channel: 'depth_l',
			bone: 'upper_arm_l',
			from: 12,
			to: 14,
		})),
		/number on a draw-order control/,
	],
	[
		'a shortening read onto a bone its control does not scale',
		withBody((es) =>
			es.map((e) => (e.channel === 'fore_lower_arm_l' ? { ...e, bone: 'lower_arm_l' } : e)),
		),
		/scales "lower_arm_l", which the channel does not scale/,
	],
	[
		'a shortening of a missing bone',
		withBody((es) =>
			es.map((e) => (e.channel === 'fore_lower_arm_l' ? { ...e, bone: 'tail_image' } : e)),
		),
		/scales a missing bone "tail_image"/,
	],
	[
		'a body turn with an unknown reading',
		withBody((es) =>
			es.map((e) => (e.channel === 'turn' ? ({ ...e, read: 'roll' } as BodyEntry) : e)),
		),
		/needs a turn reading/,
	],
	[
		'a distance reading no line',
		withBody((es) => es.map((e) => (e.channel === 'approach' ? { ...e, lines: [] } : e))),
		/reads no line/,
	],
	[
		'a head pose on an unknown axis',
		withFace((e) => (e.channel === 'head_turn' ? ({ ...e, axis: 'roll' } as FaceMotionEntry) : e)),
		/unknown head axis "roll"/,
	],
	[
		'two controls on one bone’s scale X',
		withHalfChannel('approach', (c) => ({
			...c,
			drives: [...c.drives!, { bone: 'torso_image', prop: 'scaleX', per: 0.1 }],
		})),
		/channels "approach" and "turn_width" both drive torso_image.scaleX|channels "turn_width" and "approach" both drive torso_image.scaleX/,
	],
);
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
	'template.json names a built-in at its version',
	RIG_TEMPLATES.every(
		(t) =>
			rigTemplateFromSidecar(JSON.stringify({ id: t.id, version: t.version }))?.channels.length ===
			t.channels.length,
	),
);
check(
	'a rig made from a version we no longer keep (or never had) has no template: it opens as a plain rig',
	[
		['bust-face', 1],
		['bust-face', 2],
		['half-body', 1],
		['full-body', 1],
		['bust-face', 9],
	].every(([id, version]) => rigTemplateFromSidecar(JSON.stringify({ id, version })) === null) &&
		rigTemplateById('half-body', 1) === undefined,
);
check(
	'by id alone, a built-in is its one version',
	RIG_TEMPLATES.every((t) => rigTemplateById(t.id) === t),
);
check(
	'template.json that is missing, broken or unknown reads as no template',
	[null, '{', '"x"', '{"id":"gone","version":1}', '{"id":3}'].every(
		(t) => rigTemplateFromSidecar(t) === null,
	),
);

// ── 📐 Save as template (T8, §7): a template derived from a rig ─────────────────────────────────
// A full-body rig (plain images, no bending meshes), plus a starter clip of its own, saved as a
// template: the derived skeleton, parts and controls are the original's, it passes the save check,
// and the rig it makes is the original's.
const plainArt = artFor(fullBody, false);
const plainRig = templateRig(fullBody, plainArt).skeleton;
const wave = {
	bones: { head: { rotate: [{ value: 0 }, { time: 0.5, value: 8 }, { time: 1, value: 0 }] } },
	slots: {
		hand_l: {
			attachment: [
				{ time: 0.2, name: 'hand_l_fist' },
				{ time: 0.8, name: 'hand_l_open' },
			],
		},
	},
};
/** A motion map without its 3D part. */
const twoD = (m: RigMotionMap): RigMotionMap => {
	const out = { ...m };
	delete out.bones3d;
	return out;
};
const specOf = (t: RigTemplate, clips: string[] = []): RigTemplateSpec => ({
	label: `My ${t.label}`,
	required: t.parts.filter((p) => p.required).map((p) => p.name),
	channels: t.channels,
	clips,
	// As the Rigger posts it: a template saved from a rig keeps the 2D motion map (no 3D setup).
	motion: t.motion ? twoD(t.motion) : null,
});
const derive = (doc: Record<string, unknown>, spec: RigTemplateSpec) => {
	const d = rigTemplateFromRig(doc, spec, 'my_bust', 1);
	if (typeof d === 'string') throw new Error(`derive refused: ${d}`);
	return d;
};
{
	const plain = fullBody;
	const d = derive({ ...plainRig, animations: { wave } }, specOf(plain, ['wave']));
	const t = d.template;
	// A rig has no links: a template saved from it is the one its bones make (`link` is a built-in's).
	const unlinked = plain.bones.map(({ link: _link, ...b }) => b);
	check(
		'derived: bones in order, with their setup places',
		JSON.stringify(t.bones) === JSON.stringify(unlinked),
		JSON.stringify(t.bones.slice(0, 3)),
	);
	check(
		'derived: slots in draw order with their setup images',
		JSON.stringify(t.slots) === JSON.stringify(plain.slots),
	);
	check(
		'derived: every image is a part of its slot, needed as marked, at its drawn size',
		JSON.stringify(t.parts.map((p) => [p.name, p.slot, p.required]).sort()) ===
			JSON.stringify(plain.parts.map((p) => [p.name, p.slot, p.required]).sort()),
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
	const again = templateRig(t, plainArt).skeleton;
	check(
		'a rig made from the saved template is the rig the original makes',
		JSON.stringify({ ...again, animations: {} }) === JSON.stringify(plainRig),
	);
	{
		const bust = derive(templateRig(base, artFor(base, false)).skeleton, specOf(base));
		const bent = base.parts.filter((p) => p.bend).map((p) => p.name);
		check(
			'a bust-face rig saved as a template passes the save check',
			rigTemplateSaveProblem(bust.template) === null,
			String(rigTemplateSaveProblem(bust.template)),
		);
		check(
			'…its bending images come back as image parts, each one named in a note',
			bent.length > 0 &&
				bent.every((n) => bust.template.parts.some((p) => p.name === n && !p.bend)) &&
				bent.every((n) => bust.notes.some((x) => x.startsWith(`"${n}" is a mesh here`))) &&
				bust.notes.length === bent.length,
			bust.notes.join(' | '),
		);
	}
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
		'the author is told about the mesh, the clipping, the duplicate and the skin',
		['mesh', 'not an image', 'in slots', 'winter'].every((w) => d.notes.some((n) => n.includes(w))),
		d.notes.join(' | '),
	);
	check(
		'the rig’s IK is carried as it is (rig-controls §6.1), with no note',
		JSON.stringify(t.constraints) === JSON.stringify({ ik: doc.ik }) &&
			!d.notes.some((n) => /constraint/.test(n)),
		JSON.stringify(t.constraints),
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
		[
			'an IK timeline of a constraint it lacks',
			{ ik: { reach: [{ time: 0 }] } },
			/ik constraint "reach" the template does not have/,
		],
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
		[
			'a face-board place off the board',
			{ ...ok, channels: [{ ...ok.channels[1], ui: { at: [0.5, 1.4] } }] },
			/1/,
		],
		[
			'a face-board field it does not have',
			{ ...ok, channels: [{ ...ok.channels[1], ui: { at: [0.5, 0.5], size: 3 } }] },
			/Unrecognized key/,
		],
	];
	const withUi = {
		...ok,
		channels: ok.channels.map((c, i) =>
			i === 1 ? { ...c, ui: { at: [0.5, 0.8], axis: 'y' } } : c,
		),
	};
	check(
		'a posted spec with a face-board place parses',
		typeof parseTemplateSpec(withUi) === 'object',
		String(parseTemplateSpec(withUi)),
	);
	for (const [label, v, want] of bad) {
		const r = parseTemplateSpec(v);
		check(
			`a posted spec with ${label} is refused`,
			typeof r === 'string' && want.test(r),
			String(r),
		);
	}
}

// The Rigger's browser twins, read off view.html and run in a VM with a time limit, so a loop that
// never ends fails the check instead of hanging it: rebuilding a draw-order key's full order (the
// Controls panel, the draw-order channel, a slot delete) and the image a swap control shows.
{
	const html = readFileSync(
		fileURLToPath(new URL('../static/rigger/view.html', import.meta.url)),
		'utf8',
	);
	const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
		.map((m) => m[1])
		.join('\n');
	const top = new Map<string, number>();
	for (const m of src.matchAll(/\nfunction ([A-Za-z_$][\w$]*)\(/g)) top.set(m[1], m.index);
	const body = (name: string): string => {
		const at = top.get(name);
		if (at === undefined) throw new Error(`view.html has no function ${name}`);
		let depth = 0;
		let j = src.indexOf('{', at);
		for (; j < src.length; j++) {
			if (src[j] === '{') depth++;
			else if (src[j] === '}' && --depth === 0) break;
		}
		return src.slice(at, j + 1);
	};
	const pulled: string[] = [];
	const seen = new Set<string>();
	const q = ['faceOrderOfKey', 'reconstructDrawOrder', 'dropSlotFromDrawOrderKey', 'faceSwapPart'];
	while (q.length) {
		const name = q.shift() as string;
		if (seen.has(name)) continue;
		seen.add(name);
		const fn = body(name);
		pulled.push(fn);
		for (const m of fn.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g))
			if (top.has(m[1]) && !seen.has(m[1])) q.push(m[1]);
	}
	const box = vm.createContext({ skeletonData: null, input: null });
	vm.runInContext(pulled.join('\n'), box, { filename: 'view.html' });
	const run = (code: string, input: unknown): unknown => {
		box.input = JSON.parse(JSON.stringify(input));
		try {
			const out = vm.runInContext(`JSON.stringify(${code})`, box, { timeout: 1000 });
			return out === undefined ? undefined : JSON.parse(out as string);
		} catch (e) {
			return e instanceof Error ? e : new Error(String(e));
		}
	};
	const isPermutation = (got: unknown, of: readonly unknown[]): boolean =>
		Array.isArray(got) &&
		got.length === of.length &&
		JSON.stringify([...got].map(String).sort()) === JSON.stringify([...of].map(String).sort());

	const setup = ['a', 'b', 'c', 'd', 'e'];
	const malformed: [string, { slot: string; offset: number }[]][] = [
		[
			'the same slot twice',
			[
				{ slot: 'c', offset: -2 },
				{ slot: 'c', offset: 1 },
			],
		],
		['an offset past the end', [{ slot: 'd', offset: 5 }]],
		['an offset before the start', [{ slot: 'b', offset: -4 }]],
		[
			'two slots moved to one place',
			[
				{ slot: 'a', offset: 2 },
				{ slot: 'b', offset: 1 },
			],
		],
	];
	for (const [label, offsets] of malformed) {
		const face = run('faceOrderOfKey(input.key, input.setup)', { key: { offsets }, setup });
		check(
			`faceOrderOfKey returns every slot once on a key with ${label}`,
			isPermutation(face, setup),
			String(face),
		);
		box.skeletonData = { slots: setup.map((name) => ({ name })) };
		const live = run('reconstructDrawOrder(input)', offsets);
		check(
			`reconstructDrawOrder returns every slot once on a key with ${label}`,
			isPermutation(live, [0, 1, 2, 3, 4]),
			String(live),
		);
		for (const gone of ['e', ...offsets.map((o) => o.slot)].filter(
			(n, i, a) => a.indexOf(n) === i,
		)) {
			const kept = setup.filter((n) => n !== gone);
			const dropped = run(
				'(() => { const f = { offsets: input.offsets }; dropSlotFromDrawOrderKey(f, input.setup, input.gone); return faceOrderOfKey(f, input.kept); })()',
				{ offsets, setup, kept, gone },
			);
			check(
				`dropSlotFromDrawOrderKey dropping ${gone} leaves a whole order on a key with ${label}`,
				isPermutation(dropped, kept),
				String(dropped),
			);
		}
	}
	check(
		'faceOrderOfKey keeps the first offset of a slot listed twice',
		JSON.stringify(
			run('faceOrderOfKey(input.key, input.setup)', { key: { offsets: malformed[0][1] }, setup }),
		) === JSON.stringify(['c', 'a', 'b', 'd', 'e']),
	);
	const moved = ['e', 'a', 'c', 'b', 'd'];
	const offsets = orderOffsets(setup, moved);
	check(
		'faceOrderOfKey rebuilds the order orderOffsets wrote',
		JSON.stringify(run('faceOrderOfKey(input.key, input.setup)', { key: { offsets }, setup })) ===
			JSON.stringify(moved),
	);
	const rt = new rig.SkeletonJson(new rig.AtlasAttachmentLoader(new rig.TextureAtlas('')));
	const runtime = rt.readSkeletonData({
		skeleton: { spine: '4.2.00' },
		bones: [{ name: 'root' }],
		slots: setup.map((name) => ({ name, bone: 'root' })),
		animations: { a: { drawOrder: [{ time: 0, offsets }] } },
	});
	const tl = runtime.animations[0].timelines[0] as rig.DrawOrderTimeline;
	const want = (tl.drawOrders[0] ?? []).map((i) => setup[i]);
	check(
		'faceOrderOfKey agrees with the runtime on a well-formed key',
		JSON.stringify(want) === JSON.stringify(moved),
		want.join(','),
	);

	// A swap control below its first step shows that step's image, not an empty slot (#1802): the
	// server's `swapPart` and the Rigger's `faceSwapPart` make the same choice.
	const brow: RigTemplateChannel = {
		id: 'brow',
		label: 'Brow',
		tip: 'brow mood',
		min: -1,
		max: 1,
		rest: 0,
		slot: 'brow',
		swaps: [
			{ at: -0.5, part: 'brow_sad' },
			{ at: 0, part: 'brow_neutral' },
			{ at: 0.5, part: 'brow_angry' },
		],
	};
	const all = ['brow_sad', 'brow_neutral', 'brow_angry'];
	for (const [label, have, part] of [
		['with every image', all, 'brow_sad'],
		['without that image', ['brow_neutral', 'brow_angry'], 'brow_neutral'],
	] as const) {
		check(
			`swapPart below the first step ${label} shows ${part}`,
			swapPart(brow, -1, (p) => (have as readonly string[]).includes(p)) === part,
		);
		const face = run('faceSwapPart(input.ch, -1, (slot, p) => input.have.includes(p))', {
			ch: brow,
			have,
		});
		check(`faceSwapPart below the first step ${label} shows ${part}`, face === part, String(face));
	}
}

/** Each template's starter clips as the page writes them (T12a's VM below), for T12b's gates. */
const STARTERS = new Map<string, Record<string, object>>();
// ── Template controls (rig-controls §6.1, T12a) ──────────────────────────────────────────────────
// Each built-in ships its control layer: a ring on every FK bone (keying one channel's property, held
// to its range), the face board, layers, sets, the mirror line and the picker; ＋ New rig writes it as
// the rig's `controls.json`; the validator refuses a control that would fight a channel; 📐 Save as
// template carries a rig's constraints and controls; and the Rigger's page keys a ringed bone's
// channel and lays the board out without overlaps.
{
	const html = readFileSync(
		fileURLToPath(new URL('../static/rigger/view.html', import.meta.url)),
		'utf8',
	);
	const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
		.map((m) => m[1])
		.join('\n');
	const fns = new Map<string, number>();
	for (const m of src.matchAll(/\nfunction ([A-Za-z_$][\w$]*)\(/g)) fns.set(m[1], m.index);
	const consts = new Map<string, string>();
	for (const m of src.matchAll(/\n(?:const) ([A-Za-z_$][\w$]*) = ([^\n]*;)(?=\n)/g))
		if (!m[2].trimEnd().endsWith('{;')) consts.set(m[1], `const ${m[1]} = ${m[2]}`);
	const fnBody = (name: string): string => {
		const at = fns.get(name) as number;
		let depth = 0;
		let j = src.indexOf('{', at);
		for (; j < src.length; j++) {
			if (src[j] === '{') depth++;
			else if (src[j] === '}' && --depth === 0) break;
		}
		return src.slice(at, j + 1);
	};
	const pulled: string[] = [];
	const seen = new Set<string>();
	const q = [
		'shapeChannelKeys',
		'faceChannelValue',
		'faceBoardItems',
		'faceBoardAspect',
		'pickerAutoItems',
		'faceAddStarterClips',
		'faceKeyChannel',
		'tplWithLimbBlends',
		'tplCleanChannel',
	];
	const STUBBED = new Set(['faceHas', 'faceSlotOrder']);
	while (q.length) {
		const name = q.shift() as string;
		if (seen.has(name) || STUBBED.has(name)) continue;
		seen.add(name);
		const code = fns.has(name) ? fnBody(name) : (consts.get(name) as string);
		pulled.push(code);
		for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g))
			if ((fns.has(m[1]) || consts.has(m[1])) && !seen.has(m[1])) q.push(m[1]);
	}
	// Consts first (a function may close over one), in the order the page declares them.
	pulled.sort((a, b) => Number(!a.startsWith('const ')) - Number(!b.startsWith('const ')));
	const box = vm.createContext({
		controlsDoc: null,
		rawDoc: null,
		rigTemplate: null,
		animTime: 0,
		input: null,
		faceHas: () => true,
		faceSlotOrder: () => [],
	});
	vm.runInContext(pulled.join('\n'), box, { filename: 'view.html' });
	const run = (code: string, input: unknown): unknown => {
		box.input = JSON.parse(JSON.stringify(input));
		try {
			const out = vm.runInContext(`JSON.stringify(${code})`, box, { timeout: 1000 });
			return out === undefined ? undefined : JSON.parse(out as string);
		} catch (e) {
			return e instanceof Error ? e : new Error(String(e));
		}
	};

	const FACE_IDS = faceBlock('head', { back: [], front: [] })
		.channels.filter((c) => !c.shapes)
		.map((c) => c.id);
	const BOARD: Record<string, string[]> = {
		'bust-face': [...FACE_IDS, 'head_nod'],
		'half-body': [...FACE_IDS, 'head_nod'],
		'full-body': [
			'hop',
			'move',
			'turn',
			'turn_width',
			'breath',
			'approach',
			'hand_l',
			'hand_r',
			'depth_l',
			'depth_r',
		],
	};
	const otherSide = (n: string) =>
		n.replace(/_([lr])(?=$|_)/, (_, s: string) => (s === 'l' ? '_r' : '_l'));
	for (const t of RIG_TEMPLATES) {
		const c = t.controls;
		check(`${t.id}: ships a control layer`, !!c?.bones && !!c.layers && !!c.picker?.items?.length);
		if (!c?.bones) continue;
		const layer = (n: string) => c.layers?.find((l) => l.name === n);
		const ik = Object.entries(c.bones).filter(([n]) => /_(ik|pole)_[lr]$/.test(n));
		check(
			`${t.id}: the IK controls are on the Body IK layer, shown (T12b)`,
			ik.every(([, b]) => b.layer === 'Body IK' && b.role === 'control') &&
				(ik.length === 0 || layer('Body IK')?.visible !== false),
			ik.map(([n, b]) => `${n}:${b.layer}`).join(','),
		);
		check(
			`${t.id}: image hinges and space bones are hidden helpers`,
			t.bones
				.filter((b) => /_image$|_ik_[lr]_(chest|world)$/.test(b.name))
				.every((b) => c.bones?.[b.name]?.layer === 'Helpers') &&
				layer('Helpers')?.visible === false,
		);
		const fk = Object.entries(c.bones).filter(([, b]) => b.shape === 'ring');
		check(`${t.id}: rings on its FK bones`, fk.length >= 5, String(fk.length));
		for (const [bone, b] of fk) {
			const own = controlChannel(bone, b, t.channels);
			const ch = 'channel' in own ? own.channel : null;
			const d = ch?.drives?.find((x) => x.bone === bone && x.prop === 'rotate');
			if (!ch || !d) {
				check(
					`${t.id}: the ${bone} ring turns a free bone, unlimited`,
					!b.limits,
					JSON.stringify(b),
				);
				continue;
			}
			const range = [ch.min * d.per, ch.max * d.per].sort((x, y) => x - y);
			check(
				`${t.id}: the ${bone} ring keys "${ch.id}" and is held to its range`,
				JSON.stringify(b.limits) === JSON.stringify({ rotate: range }),
				JSON.stringify(b.limits),
			);
		}
		const names = new Set(t.bones.map((b) => b.name));
		const sided = Object.keys(c.bones).filter((n) => /_[lr](?=$|_)/.test(n));
		check(
			`${t.id}: every sided control has its mirror pair`,
			sided.every((n) => names.has(otherSide(n)) && Object.hasOwn(c.bones ?? {}, otherSide(n))),
			sided.filter((n) => !Object.hasOwn(c.bones ?? {}, otherSide(n))).join(', '),
		);
		check(
			`${t.id}: the mirror line is a centre bone`,
			!!c.mirror?.line && names.has(c.mirror.line) && otherSide(c.mirror.line) === c.mirror.line,
		);
		const items = c.picker?.items ?? [];
		for (const it of items) {
			if (it.bone === undefined) continue;
			const mate = items.find((x) => x.bone === otherSide(it.bone as string));
			if (mate === it) continue;
			check(
				`${t.id}: the picker's ${it.bone} sits at the mirror of its pair`,
				!!mate && Math.abs(mate.at[0] - (1 - it.at[0])) < 1e-6 && mate.at[1] === it.at[1],
				JSON.stringify([it.at, mate?.at]),
			);
		}
		check(
			`${t.id}: the picker shows every ring and square, and no IK control yet`,
			JSON.stringify(
				Object.entries(c.bones)
					.filter(([, b]) => b.layer === 'Body FK')
					.map(([n]) => n)
					.sort(),
			) ===
				JSON.stringify(
					items
						.filter((x) => x.bone)
						.map((x) => x.bone)
						.sort(),
				),
		);
		// Buttons as the page draws them: 9px type, a glyph, 5px padding, 18px rows on a board the
		// automatic layout sizes (`pickerAutoItems`'s aspect).
		box.controlsDoc = c;
		const setup = new Map<string, [number, number]>();
		for (const b of t.bones) {
			const p = b.parent ? setup.get(b.parent) : [0, 0];
			setup.set(b.name, [(p?.[0] ?? 0) + b.x, (p?.[1] ?? 0) + b.y]);
		}
		const auto = run(
			'pickerAutoItems(input.doc, input.cdoc, (n) => ({ x: input.at[n][0], y: input.at[n][1] }), 248)',
			{ doc: { bones: t.bones }, cdoc: { ...c, picker: undefined }, at: Object.fromEntries(setup) },
		) as { aspect: number } | Error;
		const H = 248 * (auto instanceof Error ? 1 : auto.aspect);
		// A limb's switch also shows ⇄, its state with its space (“IK · chest”), ⤳ and ▾: 113px for
		// “arm L” as the page draws it.
		const w = (it: (typeof items)[number]) =>
			it.limb
				? 20 + 5 * (it.label ?? it.limb).length + 68
				: Math.min(110, 20 + 5 * (it.label ?? it.bone ?? it.set ?? '').length + (it.set ? 8 : 0));
		const clash: string[] = [];
		items.forEach((a, i) =>
			items.slice(i + 1).forEach((b) => {
				if (
					Math.abs(a.at[0] - b.at[0]) * 248 < (w(a) + w(b)) / 2 &&
					Math.abs(a.at[1] - b.at[1]) * H < 16
				)
					clash.push(`${a.label}/${b.label}`);
			}),
		);
		const off = items.filter(
			(it) =>
				it.at[0] * 248 < w(it) / 2 ||
				(1 - it.at[0]) * 248 < w(it) / 2 ||
				it.at[1] * H < 8 ||
				(1 - it.at[1]) * H < 8,
		);
		check(
			`${t.id}: no two picker buttons overlap, each whole on the board`,
			!(auto instanceof Error) && !clash.length && !off.length,
			auto instanceof Error
				? auto.message
				: [...clash, ...off.map((x) => `${x.label} off`)].join(', '),
		);

		// The face board: each of its channels placed, none overlapping, the board not too tall.
		const onBoard = t.channels.filter((x) => x.ui).map((x) => x.id);
		check(
			`${t.id}: the face board holds ${BOARD[t.id].length} channels`,
			JSON.stringify([...onBoard].sort()) === JSON.stringify([...BOARD[t.id]].sort()),
			onBoard.join(','),
		);
		const fb = run('faceBoardItems(input, 248)', t.channels) as
			{ items: { at: [number, number] }[] } | Error;
		const tall =
			fb instanceof Error
				? fb
				: run('faceBoardAspect(faceBoardItems(input, 248).items, 248)', t.channels);
		check(
			`${t.id}: the face board fits its items apart (a finite height under 3 widths)`,
			typeof tall === 'number' && tall >= 0.8 && tall < 3,
			String(tall),
		);
		// Apart as drawn: a slider is a 96-pixel track under its label, a box 64 square, each label 9px
		// type up to 110 wide; two items whose columns overlap are a row apart on the board's height.
		const drawn = run(
			'faceBoardItems(input, 248).items.map((it) => ({ at: it.at, kind: it.kind, label: it.kind === "box" ? it.x.label + " · " + it.y.label : it.ch.label }))',
			t.channels,
		) as { at: [number, number]; kind: string; label: string }[];
		const size = (it: (typeof drawn)[number]): [number, number] => {
			const lab = Math.min(110, 4.5 * it.label.length);
			return it.kind === 'box' ? [Math.max(64, lab), 78] : [Math.max(96, lab), 24];
		};
		const BH = 248 * (typeof tall === 'number' ? tall : 1);
		const near: string[] = [];
		drawn.forEach((a, i) =>
			drawn.slice(i + 1).forEach((b) => {
				const [wa, ha] = size(a);
				const [wb, hb] = size(b);
				if (
					Math.abs(a.at[0] - b.at[0]) * 248 < (wa + wb) / 2 &&
					Math.abs(a.at[1] - b.at[1]) * BH < (ha + hb) / 2
				)
					near.push(`${a.label}/${b.label}`);
			}),
		);
		check(`${t.id}: no two face-board items overlap as drawn`, !near.length, near.join(', '));

		// ＋ New rig: the rig's first controls.json is the template's, bound to the rig and marked as
		// written with the .irig the create claimed — so it opens as this rig's, valid and whole.
		const fit = templateRig(t, artFor(t, false));
		const text = JSON.stringify(fit.skeleton);
		const made = newRigControls(fit, 'hero', text);
		const doc = made ? (JSON.parse(made.text) as Record<string, unknown>) : null;
		const checked = doc ? checkedControls(doc, 'hero', fit.skeleton) : null;
		check(
			`${t.id}: ＋ New rig writes ${CONTROLS_SIDECAR}, valid against the rig it made`,
			made?.file === CONTROLS_SIDECAR && checked?.problems.length === 0 && doc?.rig === 'hero',
			JSON.stringify(checked?.problems),
		);
		check(`${t.id}: …marked as written with that .irig`, doc?.irig === pairMark(text));
		check(
			`${t.id}: …carrying the template's layer as it is`,
			JSON.stringify({ ...doc, controls: undefined, rig: undefined, irig: undefined }) ===
				JSON.stringify({ controls: undefined, rig: undefined, irig: undefined, ...c }),
		);
		// The control layer changes no pose: a rig made with it is the rig made without it, and every
		// control and starter clip poses through engine-rig (the save check).
		const bare: RigTemplate = {
			...t,
			controls: undefined,
			rig3d: t.rig3d && { ...t.rig3d, ik: undefined },
			channels: t.channels.map((x) => ({ ...x, ui: undefined })),
		};
		check(
			`${t.id}: the control layer changes no byte of the rig`,
			JSON.stringify(templateRig(bare, artFor(t, false)).skeleton) === text,
		);
		check(
			`${t.id}: every control and starter clip poses through engine-rig`,
			rigTemplateSaveProblem(t) === null,
			String(rigTemplateSaveProblem(t)),
		);
	}

	// The validator: a control keys one channel's bone properties, or none.
	const full = rigTemplateById('full-body') as RigTemplate;
	const withControl = (bone: string, ctl: Record<string, unknown>): RigTemplate => ({
		...full,
		controls: {
			...full.controls,
			bones: { ...full.controls?.bones, [bone]: ctl as never },
		},
	});
	for (const [label, bone, ctl, ok] of [
		['a ring on the spine (lean)', 'spine', { shape: 'ring' }, true],
		['a square on a bone no control drives', 'hip', { shape: 'square' }, true],
		[
			'a square on the upper arm (arm turns it, width moves it)',
			'upper_arm_l',
			{ shape: 'square', channels: ['translate', 'rotate'] },
			false,
		],
		[
			'a square moving the root (move and hop both own it)',
			'root',
			{ shape: 'square', channels: ['translate'] },
			false,
		],
		[
			'a hand control turning it and scaling (its shortening owns the scale)',
			'hand_l',
			{ shape: 'circle', channels: ['rotate', 'scale'] },
			false,
		],
		['a ring on a bone that is not there', 'tail', { shape: 'ring' }, false],
		['a control on a layer not listed', 'foot_l', { shape: 'ring', layer: 'Nope' }, false],
	] as const) {
		const problem = rigTemplateProblem(withControl(bone, ctl));
		check(
			`controls: ${label} is ${ok ? 'accepted' : 'refused'}`,
			ok
				? problem === null
				: (problem !== null && problem.startsWith('controls')) ||
						problem?.includes('the control on') === true,
			String(problem),
		);
	}
	check(
		'controls: a clash names both bone properties and their controls',
		String(
			rigTemplateProblem(
				withControl('upper_arm_l', { shape: 'square', channels: ['translate', 'rotate'] }),
			),
		).includes('"turn_width"') &&
			String(
				rigTemplateProblem(
					withControl('upper_arm_l', { shape: 'square', channels: ['translate', 'rotate'] }),
				),
			).includes('"arm_l"'),
	);

	// The page: a ring on a channel's bone keys the channel, so a lean moves the chest half as much
	// and the slider reads it; a ring on a free bone keys only itself.
	box.controlsDoc = full.controls;
	box.rigTemplate = { channels: full.channels };
	box.animTime = 0.5;
	const lean = run(
		'(() => { const a = { bones: { spine: { rotate: [{ time: 0.5, value: 10 }] } } }; const via = shapeChannelKeys(a, "spine", { rotate: true }, { rotation: 10, x: 0, y: 0, scaleX: 1, scaleY: 1 }, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }); return { via: via.map((c) => c.id), a, v: faceChannelValue(a, rigTemplate.channels.find((c) => c.id === "lean"), 0.5, () => null, rigTemplate.channels) }; })()',
		null,
	) as { via: string[]; a: { bones: Record<string, { rotate?: { value: number }[] }> }; v: number };
	check(
		'page: turning the spine ring keys Lean, the chest half as much, and the slider reads 10',
		JSON.stringify(lean.via) === '["lean"]' &&
			lean.a.bones.chest?.rotate?.[0]?.value === 5 &&
			lean.a.bones.spine?.rotate?.[0]?.value === 10 &&
			lean.v === 10,
		JSON.stringify(lean),
	);
	const far = run(
		'(() => { const a = { bones: { upper_arm_l: { rotate: [{ time: 0.5, value: -400 }] } } }; shapeChannelKeys(a, "upper_arm_l", { rotate: true }, { rotation: -400, x: 0, y: 0, scaleX: 1, scaleY: 1 }, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }); return a.bones.upper_arm_l.rotate[0].value; })()',
		null,
	);
	check("page: a ring keyed past its channel's range is held to it", far === -150, String(far));
	const free = run(
		'(() => { const a = { bones: { hand_l: { rotate: [{ time: 0.5, value: 30 }] } } }; return [shapeChannelKeys(a, "hand_l", { rotate: true }, { rotation: 30, x: 0, y: 0, scaleX: 1, scaleY: 1 }, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }).length, a]; })()',
		null,
	) as [number, { bones: Record<string, unknown> }];
	check(
		'page: a ring on a free bone keys only that bone',
		free[0] === 0 && Object.keys(free[1].bones).join() === 'hand_l',
		JSON.stringify(free),
	);
	box.controlsDoc = { ...full.controls, bones: {} };
	const plain = run(
		'shapeChannelKeys({ bones: {} }, "spine", { rotate: true }, { rotation: 10, x: 0, y: 0, scaleX: 1, scaleY: 1 }, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }).length',
		null,
	);
	check('page: a bone with no shape keys only itself', plain === 0, String(plain));

	// 📐 Save as template carries a rig's constraints and controls, and the rig it makes starts with them.
	const art = artFor(full, false);
	const rigDoc = {
		...templateRig(full, art).skeleton,
		ik: [{ name: 'arm_ik_l', bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 0 }],
		animations: {
			reach: {
				ik: {
					arm_ik_l: [{ mix: 0 }, { time: 0.5, mix: 1 }, { time: 1, mix: 0 }],
				},
			},
		},
	};
	const rigControls = {
		controls: CONTROLS_VERSION,
		rig: 'hero',
		irig: 'stale-mark',
		...full.controls,
		bones: { ...full.controls?.bones, gone_bone: { shape: 'ring' } },
		// The template's limbs, its left arm made a 2D one (a live IK of the rig).
		limbs: {
			...full.controls?.limbs,
			arm_l: { ik: 'arm_ik_l', fk: ['upper_arm_l', 'lower_arm_l'], control: 'hand_ik_l' },
		},
	};
	const flatLimbs = { arm_l: rigControls.limbs.arm_l };
	const saved = rigTemplateFromRig(
		rigDoc,
		{ ...specOf(full, ['reach']), motion: null },
		'my_body',
		1,
		rigControls,
	);
	const tpl = typeof saved === 'string' ? null : saved.template;
	check(
		'save as template: keeps the rig constraints',
		JSON.stringify(tpl?.constraints) ===
			JSON.stringify({ ik: rigDoc.ik, transform: full.constraints?.transform }),
		typeof saved === 'string' ? saved : JSON.stringify(tpl?.constraints),
	);
	check(
		'save as template: keeps the controls without their rig binding, the missing bone left out with a note',
		!!tpl?.controls &&
			!('rig' in tpl.controls) &&
			!('irig' in tpl.controls) &&
			!Object.hasOwn(tpl.controls.bones ?? {}, 'gone_bone') &&
			JSON.stringify(tpl.controls.limbs) === JSON.stringify(flatLimbs) &&
			typeof saved !== 'string' &&
			saved.notes.some((n) => n.includes('gone_bone')),
		typeof saved === 'string' ? saved : saved.notes.join(' | '),
	);
	check(
		'save as template: the limbs solved in 3D stay behind, with their switches, each with a note',
		!!tpl?.controls &&
			typeof saved !== 'string' &&
			['arm_r', 'leg_l', 'leg_r'].every((n) =>
				saved.notes.some((x) => x.includes(`limbs.${n} is solved in 3D`)),
			) &&
			JSON.stringify(
				(tpl.controls.picker?.items ?? []).filter((x) => x.limb).map((x) => x.limb),
			) === '["arm_l"]',
		typeof saved === 'string' ? saved : saved.notes.join(' | '),
	);
	check(
		'save as template: passes the save check, constraint clip and all',
		!!tpl && rigTemplateSaveProblem(tpl) === null,
		String(tpl && rigTemplateSaveProblem(tpl)),
	);
	if (tpl) {
		const again = templateRig(tpl, art);
		const again2 = newRigControls(again, 'next', JSON.stringify(again.skeleton));
		check(
			'save as template round trip: the new rig has the constraint and the controls',
			JSON.stringify((again.skeleton as { ik?: unknown }).ik) === JSON.stringify(rigDoc.ik) &&
				!!again2 &&
				checkedControls(JSON.parse(again2.text), 'next', again.skeleton).problems.length === 0 &&
				JSON.stringify(JSON.parse(again2.text).limbs) === JSON.stringify(flatLimbs),
		);
		check(
			'save as template round trip: the new rig loads under engine-rig',
			irigDocProblem(again.skeleton) === null,
			String(irigDocProblem(again.skeleton)),
		);
	}
	check(
		'save as template: unreadable controls are not carried, with a note',
		(() => {
			const d = rigTemplateFromRig(rigDoc, { ...specOf(full, ['reach']), motion: null }, 'x', 1, {
				controls: 9,
			});
			return (
				typeof d !== 'string' &&
				!d.template.controls &&
				d.notes.some((n) => n.includes('could not be read'))
			);
		})(),
	);
	check(
		'a template clip keying a constraint the template lacks is refused',
		rigTemplateProblem({
			...full,
			clips: [
				{
					name: 'x',
					length: 1,
					keys: [],
					animation: { ik: { nope: [{ mix: 1 }] } } as RigTemplateTimelines,
				},
			],
		}) !== null,
	);
	check(
		'a template constraint on a missing bone is refused',
		rigTemplateProblem({
			...full,
			constraints: { ik: [{ name: 'x', bones: ['tail'], target: 'hip' }] },
		}) !== null,
	);

	// T12b, the page: each template's starter clips as ＋ New rig writes them (the IK-off gates below
	// pose them), and a control blending an IK's mix.
	box.rawDoc = null;
	box.controlsDoc = null;
	for (const t of RIG_TEMPLATES) {
		const out = run(
			'(() => { const a = {}; faceAddStarterClips(a, input.tpl, () => true, input.setup); return a; })()',
			{ tpl: { channels: t.channels, clips: t.clips }, setup: t.slots.map((s) => s.name) },
		);
		const ok = !(out instanceof Error) && Object.keys(out as object).length === t.clips.length;
		if (ok) STARTERS.set(t.id, out as Record<string, object>);
		check(
			`${t.id}: the page writes its ${t.clips.length} starter clips`,
			ok,
			out instanceof Error ? out.message : Object.keys(out as object).join(','),
		);
	}
	box.rawDoc = { ik: [{ name: 'arm_ik', bendPositive: false, softness: 4, mix: 0 }] };
	const mixCh = { id: 'ik_arm', min: 0, max: 1, rest: 0, mixes: [{ ik: 'arm_ik', per: 1 }] };
	const blended = run(
		'(() => { const a = {}; const v0 = faceChannelValue(a, input, 0, () => null, [input]); faceKeyChannel(a, input, 0.5, 0.25, () => true); faceKeyChannel(a, input, 1.5, 0.75, () => true); return { a, v0, v: faceChannelValue(a, input, 0.5, () => null, [input]) }; })()',
		mixCh,
	) as { a: { ik?: Record<string, Record<string, unknown>[]> }; v0: number; v: number } | Error;
	check(
		"page: a control blending an IK keys its mix (held to 0…1), keeping the IK's bend and softness",
		!(blended instanceof Error) &&
			JSON.stringify(blended.a) ===
				JSON.stringify({
					ik: {
						arm_ik: [
							{ time: 0.25, mix: 0.5, softness: 4, bendPositive: false },
							{ time: 0.75, mix: 1, softness: 4, bendPositive: false },
						],
					},
				}),
		blended instanceof Error ? blended.message : JSON.stringify(blended.a),
	);
	check(
		'page: …and its slider reads the mix back (the setup mix before any key)',
		!(blended instanceof Error) && blended.v0 === 0 && Math.abs(blended.v - 0.75) < 1e-9,
		blended instanceof Error ? '' : JSON.stringify([blended.v0, blended.v]),
	);
	// The rig also has an IK constraint named as the 3D limb's IK (a clash rig3d.json reports): the 3D
	// limb is still no blend.
	box.rawDoc = {
		ik: [
			{ name: 'arm_ik', bendPositive: false, softness: 4, mix: 0 },
			{ name: 'leg_ik_l', mix: 0 },
		],
	};
	box.controlsDoc = {
		limbs: {
			arm_l: { ik: 'arm_ik', fk: ['upper_arm_l', 'lower_arm_l'], control: 'hand_ik_l' },
			leg_l: { ik: 'leg_ik_l', ik3d: true, fk: ['thigh_l', 'shin_l'], control: 'foot_ik_l' },
			gone: { ik: 'nope', fk: ['hip'], control: 'root' },
		},
	};
	const drafted = run('[tplWithLimbBlends([]), tplWithLimbBlends(input).length]', [mixCh]) as
		[RigTemplateChannel[], number] | Error;
	check(
		'page: 📐 Save as template drafts an FK / IK control per 2D limb, unless one blends its IK already',
		!(drafted instanceof Error) &&
			drafted[0].length === 1 &&
			drafted[0][0].id === 'ik_arm_l' &&
			JSON.stringify(drafted[0][0].mixes) === JSON.stringify([{ ik: 'arm_ik', per: 1 }]) &&
			drafted[1] === 1 &&
			rigTemplateProblem({
				...full,
				constraints: {
					...full.constraints,
					ik: [
						{ name: 'arm_ik', bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 0 },
					],
				},
				channels: [...full.channels, ...drafted[0]],
			}) === null,
		drafted instanceof Error ? drafted.message : JSON.stringify(drafted),
	);
	const cleaned = run('tplCleanChannel(input)', {
		...mixCh,
		label: 'IK arm',
		mixes: [{ ik: 'arm_ik', per: '1' }],
	}) as RigTemplateChannel | Error;
	check(
		"page: 📐 Save as template posts a control's blends",
		!(cleaned instanceof Error) && JSON.stringify(cleaned.mixes) === '[{"ik":"arm_ik","per":1}]',
		JSON.stringify(cleaned),
	);
	box.rawDoc = null;
	box.controlsDoc = null;
}

// ── Template IK (rig-controls §6.1, T12b) ────────────────────────────────────────────────────────
// Half body's arms and Full body's arms and legs are limbs solved in 3D: their IKs ride in the
// template's 3D setup, reach ＋ New rig's controls.json as limbs with their spaces and picker
// switches, and land in rig3d.json when the rig is made 3D. Every IK is at mix 0 and the spaces move
// only control bones, so every starter clip and every control poses as before — in 2D through
// engine-rig, and in 3D through the bake; switched to IK over a clip, the arm plays where FK put it.
{
	const TOL = 0.5; // rig units: the bake's tolerance (0.45) and the float32 the game reads
	const half3 = (deg: number) => (deg * Math.PI) / 360;
	const qz = (deg: number) => [Math.cos(half3(deg)), 0, 0, Math.sin(half3(deg))];
	const qy = (deg: number) => [Math.cos(half3(deg)), 0, Math.sin(half3(deg)), 0];
	type Json = Record<string, unknown>;
	type World = Map<string, number[]>;
	/** engine-rig playing clip `name` of `irig` as a game plays it (AnimationState), posed at `t`. */
	const player = (irig: Json, regions: TemplateRegion[], name: string) => {
		const atlas = new rig.TextureAtlas(atlasText(regions));
		for (const page of atlas.pages) page.setTexture(stubTexture as never);
		const data = new rig.SkeletonJson(new rig.AtlasAttachmentLoader(atlas)).readSkeletonData(
			structuredClone(irig),
		);
		const skel = new rig.Skeleton(data);
		const state = new rig.AnimationState(new rig.AnimationStateData(data));
		return (t: number): World => {
			skel.setToSetupPose();
			state.clearTracks();
			state.setAnimation(0, name, false);
			state.update(t);
			state.apply(skel);
			skel.updateWorldTransform(rig.Physics.update);
			return new Map(
				skel.bones.map((b) => [b.data.name, [b.worldX, b.worldY, b.a, b.b, b.c, b.d]]),
			);
		};
	};
	const apart = (a: World, b: World, names?: readonly string[]) => {
		let worst = 0;
		for (const n of names ?? [...a.keys()]) {
			const p = a.get(n);
			const q = b.get(n);
			if (!p || !q) return Infinity;
			for (let i = 0; i < (names ? 2 : 6); i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
		}
		return worst;
	};
	const LIMBS: Record<string, string[]> = {
		'half-body': ['arm_l', 'arm_r'],
		'full-body': ['arm_l', 'arm_r', 'leg_l', 'leg_r'],
	};
	// Each built-in, then Half body and Full body fitted to a character with shorter forearms and shins
	// (frame to rig, #1864): the fit keeps each control, pole and space bone on the joint it marks.
	const shorter = (t: RigTemplate): RigFit => ({
		bones: Object.fromEntries(
			t.bones
				.filter((b) => /^(lower_arm|hand|shin|foot)_[lr]$/.test(b.name))
				.map((b) => [b.name, { x: b.x * 0.8, y: b.y * 0.8 }]),
		),
	});
	const runs: [string, RigTemplate][] = RIG_TEMPLATES.map((t) => [t.id, t]);
	for (const id of ['half-body', 'full-body']) {
		const t = rigTemplateById(id) as RigTemplate;
		const fit = shorter(t);
		check(
			`${id}: a fit to shorter forearms and shins fits`,
			rigFitProblem(t, fit) === null,
			String(rigFitProblem(t, fit)),
		);
		runs.push([`${id} fitted`, fitTemplate(t, fit)]);
	}
	for (const [label, t] of runs) {
		const c = t.controls;
		const want = LIMBS[t.id] ?? [];
		check(
			`${label}: its limbs are ${want.join(', ') || 'none'}`,
			JSON.stringify(Object.keys(c?.limbs ?? {})) === JSON.stringify(want),
			JSON.stringify(Object.keys(c?.limbs ?? {})),
		);
		if (!want.length) {
			check(`${label}: no 3D IK`, !t.rig3d?.ik?.length && !t.constraints);
			continue;
		}
		const iks = t.rig3d?.ik ?? [];
		const transforms = (t.constraints?.transform ?? []) as Json[];
		check(
			`${label}: the Body IK layer is shown`,
			c?.layers?.some((l) => l.name === 'Body IK' && l.visible !== false) === true,
		);
		for (const name of want) {
			const limb = c?.limbs?.[name];
			const e = iks.find((x) => x.name === limb?.ik);
			const side = name.slice(-1);
			const arm = name.startsWith('arm');
			const [upper, lower, end] = arm
				? [`upper_arm_${side}`, `lower_arm_${side}`, `hand_${side}`]
				: [`thigh_${side}`, `shin_${side}`, `foot_${side}`];
			const [control, pole] = arm
				? [`hand_ik_${side}`, `elbow_pole_${side}`]
				: [`foot_ik_${side}`, `knee_pole_${side}`];
			check(
				`${label}: limb ${name} is a 3D IK from ${upper} through ${lower} to ${end}, reaching ${control}, bent toward ${pole}`,
				!!limb?.ik3d &&
					!!e &&
					JSON.stringify(e.bones) === JSON.stringify([upper, lower]) &&
					e.end === end &&
					e.target === control &&
					e.pole === pole &&
					limb.control === control &&
					limb.pole === pole &&
					JSON.stringify(limb.fk) === JSON.stringify([upper, lower]) &&
					(e as { mix?: number }).mix === undefined,
				JSON.stringify([limb, e]),
			);
			const spaces = Object.entries(limb?.spaces ?? {});
			const wantSpaces = arm ? ['chest', 'world'] : ['world'];
			const mixOf = (sp: { constraint: string }) =>
				transforms.find((x) => x.name === sp.constraint) as Json | undefined;
			check(
				`${label}: limb ${name}'s control follows ${wantSpaces.join(' or ')}, ${wantSpaces[0]} at setup`,
				JSON.stringify(spaces.map(([s]) => s)) === JSON.stringify(wantSpaces) &&
					spaces.every(([s, sp]) => {
						const tc = mixOf(sp);
						const on = s === wantSpaces[0] ? 1 : 0;
						return (
							sp.bone === `${control}_${s}` &&
							!!tc &&
							JSON.stringify(tc.bones) === JSON.stringify([control]) &&
							tc.target === sp.bone &&
							tc.mixRotate === on &&
							tc.mixX === on &&
							tc.mixY === on &&
							tc.mixScaleX === 0 &&
							tc.mixScaleY === 0 &&
							tc.mixShearY === 0
						);
					}),
				JSON.stringify(spaces.map(([, sp]) => mixOf(sp))),
			);
			const items = c?.picker?.items ?? [];
			const btn = items.find((x) => x.limb === name);
			const mate = items.find((x) => x.limb === name.replace(/_[lr]$/, side === 'l' ? '_r' : '_l'));
			check(
				`${label}: the picker switches limb ${name}, at the mirror of its pair`,
				!!btn &&
					!!mate &&
					Math.abs(btn.at[0] - (1 - mate.at[0])) < 1e-6 &&
					btn.at[1] === mate.at[1],
				JSON.stringify([btn, mate]),
			);
		}
		const world = boneWorld(t.bones);
		const near = (a: string, b: string) => {
			const [p, q] = [world.get(a), world.get(b)];
			return !!p && !!q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
		};
		check(
			`${label}: every IK control and its space bones sit on the wrist or ankle, every pole on the elbow or knee`,
			iks.every(
				(e) =>
					near(e.target, e.end) &&
					near(e.pole, e.bones[1]) &&
					Object.values(
						c?.limbs?.[Object.keys(c?.limbs ?? {}).find((l) => c?.limbs?.[l].ik === e.name) ?? '']
							?.spaces ?? {},
					).every((sp) => near(sp.bone, e.end)),
			),
		);
		check(
			`${label}: the transforms solve in their listed order, from 0`,
			transforms.every((x, i) => x.order === i),
		);

		// Made 3D, the rig's 3D data carries the IKs, every limb switchable.
		const art = artFor(t, false);
		const fit = templateRig(t, art);
		const irig = structuredClone(fit.skeleton) as Json;
		const doc = make3dFromTemplate('hero', irig, t.rig3d as Template3d);
		check(
			`${label}: 🧊 Make 3D writes the template's 3D IKs into rig3d.json`,
			JSON.stringify(doc.ik) === JSON.stringify(iks),
			JSON.stringify(doc.ik),
		);
		check(
			`${label}: …a rig3d.json valid on its own and against the rig`,
			rig3dDocProblems(doc).length === 0 && rig3dIrigProblems(doc, irig).length === 0,
			JSON.stringify([...rig3dDocProblems(doc), ...rig3dIrigProblems(doc, irig)]),
		);
		const r3 = rigOf(irig, doc);
		for (const e of iks)
			check(
				`${label}: 3D IK ${e.name} solves on the rig made 3D`,
				ik3dProblems(r3, e as Ik3d).length === 0,
				ik3dProblems(r3, e as Ik3d).join('; '),
			);
		const made = newRigControls(fit, 'hero', JSON.stringify(fit.skeleton));
		const controlsDoc = made ? (JSON.parse(made.text) as Json) : null;
		check(
			`${label}: ＋ New rig's controls.json is valid against the rig made 3D`,
			!!controlsDoc && checkedControls(controlsDoc, 'hero', irig).problems.length === 0,
		);
		for (const name of want) {
			const limb = c?.limbs?.[name] as Limb3d;
			check(
				`${label}: limb ${name} switches on the rig made 3D`,
				limb3dProblem(irig, doc, limb) === null,
				String(limb3dProblem(irig, doc, limb)),
			);
			check(
				`${label}: limb ${name} waits for 🧊 Make 3D on the 2D rig`,
				limb3dProblem(fit.skeleton, null, limb) !== null,
			);
		}
		check(
			`${label}: a rig with no ${iks[0].bones[0]} gets no IK on it`,
			(() => {
				const cut = structuredClone(fit.skeleton) as { bones: { name: string }[] };
				cut.bones = cut.bones.filter((b) => b.name !== iks[0].bones[0]);
				const d = make3dFromTemplate('hero', cut, t.rig3d as Template3d);
				return !d.ik?.some((x) => x.name === iks[0].name) && (d.ik?.length ?? 0) === iks.length - 1;
			})(),
		);

		check(
			`${label}: a rig with an IK constraint named ${iks[0].name} gets no 3D IK of that name`,
			(() => {
				const r = structuredClone(fit.skeleton) as Json;
				r.ik = [
					{ name: iks[0].name, order: 99, bones: [...iks[0].bones], target: iks[0].target, mix: 0 },
				];
				const d = make3dFromTemplate('hero', r, t.rig3d as Template3d);
				return (
					!d.ik?.some((x) => x.name === iks[0].name) &&
					(d.ik?.length ?? 0) === iks.length - 1 &&
					rig3dIrigProblems(d, r).length === 0
				);
			})(),
		);

		// IK off: every starter clip (as the page writes it) and every control poses as before in 2D —
		// the rig with its spaces and the rig without them, through engine-rig, every bone.
		const starters = STARTERS.get(t.id) ?? {};
		const animations: Record<string, object> = { ...starters };
		for (const ch of t.channels)
			animations[`control ${ch.id}`] = controlAnimation(
				ch,
				t.channels,
				(p) => art.some((r) => r.name === p),
				t.slots.map((s) => s.name),
			);
		const withIt = { ...fit.skeleton, animations } as Json;
		const without = { ...structuredClone(fit.skeleton), animations } as Json;
		delete without.transform;
		let worst2 = 0;
		let posed = 0;
		for (const [name, anim] of Object.entries(animations)) {
			const keyed = JSON.stringify(anim).match(/"time":([\d.]+)/g) ?? [];
			const end = Math.max(1, ...keyed.map((k) => Number(k.split(':')[1])));
			const a = player(withIt, art, name);
			const b = player(without, art, name);
			for (let i = 0; i <= 20; i++) {
				worst2 = Math.max(worst2, apart(a((end * i) / 20), b((end * i) / 20)));
				posed++;
			}
		}
		check(
			`${label}: IK off, ${Object.keys(starters).length} starter clips and ${t.channels.length} controls pose as before in 2D (every bone, ${posed} poses)`,
			Object.keys(starters).length === t.clips.length && worst2 < 1e-6,
			`${worst2} apart; starters ${Object.keys(starters).join(',')}`,
		);

		// …and in 3D: each starter clip made 3D, and a clip turning the limbs in 3D, bake byte for byte
		// as on the rig with no 3D IK.
		const REACH = 'reach';
		const k = (s: string) => (s === 'l' ? 1 : -1);
		const reachBones: Record<string, { orient: { time: number; value: number[] }[] }> = {
			chest: {
				orient: [
					{ time: 0, value: [1, 0, 0, 0] },
					{ time: 1, value: qy(25) },
					{ time: 2, value: qy(-15) },
				],
			},
		};
		for (const s of ['l', 'r']) {
			reachBones[`upper_arm_${s}`] = {
				orient: [
					{ time: 0, value: qz(15 * k(s)) },
					{ time: 1, value: qz(-25 * k(s)) },
					{ time: 2, value: qz(30 * k(s)) },
				],
			};
			reachBones[`lower_arm_${s}`] = {
				orient: [
					{ time: 0, value: qz(50 * k(s)) },
					{ time: 1, value: qz(80 * k(s)) },
					{ time: 2, value: qz(40 * k(s)) },
				],
			};
			if (want.includes(`leg_${s}`)) {
				reachBones[`thigh_${s}`] = {
					orient: [
						{ time: 0, value: qz(10 * k(s)) },
						{ time: 1, value: qz(-20 * k(s)) },
						{ time: 2, value: qz(5 * k(s)) },
					],
				};
				reachBones[`shin_${s}`] = {
					orient: [
						{ time: 0, value: qz(-35 * k(s)) },
						{ time: 1, value: qz(-60 * k(s)) },
						{ time: 2, value: qz(-30 * k(s)) },
					],
				};
			}
		}
		const irig3 = {
			...structuredClone(irig),
			animations: { ...structuredClone(starters), [REACH]: {} },
		};
		const doc3: Rig3dDoc = {
			...structuredClone(doc),
			clips: {
				...Object.fromEntries(Object.keys(starters).map((n) => [n, { bones: {} }])),
				[REACH]: { bones: structuredClone(reachBones), duration: 2 },
			},
		};
		const noIk: Rig3dDoc = { ...structuredClone(doc3) };
		delete noIk.ik;
		const same3: string[] = [];
		const baked: Record<string, ReturnType<typeof rebakeClip3d>> = {};
		for (const name of Object.keys(doc3.clips ?? {})) {
			const a = rebakeClip3d({ irig: irig3, doc: doc3, clip: name });
			const b = rebakeClip3d({ irig: irig3, doc: noIk, clip: name });
			baked[name] = a;
			if (
				JSON.stringify((a.irig.animations as Json)[name]) !==
				JSON.stringify((b.irig.animations as Json)[name])
			)
				same3.push(name);
		}
		check(
			`${label}: IK off, every starter clip made 3D and a 3D reach bake as with no 3D IK`,
			same3.length === 0,
			same3.join(', '),
		);
		// A 3D motion import (its first, so it makes the rig's 3D data from the template) bakes as on
		// the template with no 3D IK, and the data it made carries the IKs.
		const imported = (template: Template3d) =>
			importClip3d({
				irig: { ...structuredClone(fit.skeleton), animations: { moved: {} } },
				doc: null,
				stem: 'hero',
				template,
				clip: 'moved',
				animation: {},
				orient: {},
				keys: structuredClone(reachBones),
				at: 0,
				length: 2,
				replaced: [],
			});
		const withIk3 = imported(t.rig3d as Template3d);
		const noIk3 = imported({ ...(t.rig3d as Template3d), ik: undefined });
		check(
			`${label}: IK off, a 3D motion import bakes as with no 3D IK, its new 3D data carrying the IKs`,
			JSON.stringify((withIk3.irig.animations as Json).moved) ===
				JSON.stringify((noIk3.irig.animations as Json).moved) &&
				JSON.stringify(withIk3.doc.ik?.map((e) => e.name)) ===
					JSON.stringify(iks.map((e) => e.name)) &&
				!noIk3.doc.ik,
		);

		// ⇄ Match IK to FK over the clip, per limb: the control (and the pole) keyed on the FK pose at
		// every key, the mix at 1 — the end and the middle joint land where FK put them, in 3D and as
		// the game plays the bake; and back to FK over the clip, where they were.
		const fk = baked[REACH];
		const fkPlay = player(fk.irig, art, REACH);
		const at3 = (x: { irig: Json; doc: Rig3dDoc }) => {
			const r = rigOf(x.irig, x.doc);
			const plan = clipOf(r, x.irig, x.doc, REACH);
			return (time: number) => pose3d(r, plan.clip, time);
		};
		const fk3 = at3(fk);
		for (const name of want) {
			const limb = c?.limbs?.[name] as Limb3d;
			const e = iks.find((x) => x.name === limb.ik) as (typeof iks)[number];
			const joints = [e.bones[1], e.end];
			const toIk = switchLimb3d({
				irig: fk.irig,
				doc: fk.doc,
				clip: REACH,
				limb,
				to: 'ik',
				t0: 0,
				t1: 2,
			});
			if ('error' in toIk) {
				check(`${label}: ⇄ ${name} matched to IK over the clip`, false, toIk.error);
				continue;
			}
			const mixes = toIk.doc.clips?.[REACH]?.ik?.[e.name] ?? [];
			check(
				`${label}: ⇄ ${name} to IK over the clip keys its mix to 1 at every matched key (${toIk.times.join(', ')})`,
				toIk.times.length >= 3 &&
					toIk.times.every((time) =>
						mixes.some((m) => Math.abs((m.time ?? 0) - time) < 1e-4 && m.mix === 1),
					),
				JSON.stringify(mixes),
			);
			const ik = rebakeClip3d({ irig: fk.irig, doc: toIk.doc, clip: REACH });
			const ik3 = at3(ik);
			const ikPlay = player(ik.irig, art, REACH);
			let worst3 = 0;
			let worstGame = 0;
			for (const time of toIk.times) {
				const a = fk3(time);
				const b = ik3(time);
				for (const j of joints) {
					const p = a.get(j)?.o ?? [NaN, NaN, NaN];
					const q = b.get(j)?.o ?? [0, 0, 0];
					worst3 = Math.max(worst3, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
				}
				worstGame = Math.max(worstGame, apart(fkPlay(time), ikPlay(time), joints));
			}
			check(
				`${label}: ${name} in IK puts ${joints.join(' and ')} where FK did, at every matched key (3D)`,
				worst3 < 1e-4,
				worst3.toExponential(2),
			);
			check(
				`${label}: …and as the game plays the bake (within ${TOL})`,
				worstGame < TOL,
				worstGame.toFixed(4),
			);
			const back = switchLimb3d({
				irig: ik.irig,
				doc: ik.doc,
				clip: REACH,
				limb,
				to: 'fk',
				t0: 0,
				t1: 2,
			});
			if ('error' in back) {
				check(`${label}: ⇄ ${name} back to FK over the clip`, false, back.error);
				continue;
			}
			const fk2 = rebakeClip3d({ irig: ik.irig, doc: back.doc, clip: REACH });
			const fk2Play = player(fk2.irig, art, REACH);
			// Matched at keys: between them IK moves the control in a line where FK swings an arc, so To
			// FK keys the bones where IK was at each of its keys, and lands back on FK at FK's own.
			let worstBack = 0;
			for (const time of back.times)
				worstBack = Math.max(worstBack, apart(ikPlay(time), fk2Play(time), joints));
			let worstHome = 0;
			for (const time of toIk.times)
				worstHome = Math.max(worstHome, apart(fkPlay(time), fk2Play(time), joints));
			check(
				`${label}: ⇄ ${name} back to FK over the clip keys the bones where IK was, at its every key (within ${TOL}), the mix 0`,
				worstBack < TOL && (back.doc.clips?.[REACH]?.ik?.[e.name] ?? []).every((m) => m.mix === 0),
				worstBack.toFixed(4),
			);
			check(
				`${label}: …and lands on the first FK pose at its keys (within ${TOL})`,
				worstHome < TOL,
				worstHome.toFixed(4),
			);
		}
	}

	// The validator: a template's 3D IK is a chain of its bones reaching a control off the chain,
	// with its limb.
	const half = rigTemplateById('half-body') as RigTemplate;
	const withIk = (
		f: (e: NonNullable<NonNullable<RigTemplate['rig3d']>['ik']>[number]) => object,
	): RigTemplate => ({
		...half,
		rig3d: {
			...(half.rig3d as NonNullable<RigTemplate['rig3d']>),
			ik: (half.rig3d?.ik ?? []).map((e, i) => (i ? e : ({ ...e, ...f(e) } as typeof e))),
		},
	});
	const withLimb = (ik: object, limb: object): RigTemplate => {
		const t = withIk(() => ik);
		const limbs = t.controls?.limbs ?? {};
		return {
			...t,
			controls: { ...t.controls, limbs: { ...limbs, arm_l: { ...limbs.arm_l, ...limb } } },
		};
	};
	for (const [label, tpl, re] of [
		[
			'a 3D IK on a missing bone',
			withIk(() => ({ bones: ['tail', 'lower_arm_l'] })),
			/missing bone "tail"/,
		],
		[
			'a 3D IK whose lower bone is not under its upper',
			withIk(() => ({ bones: ['clavicle_l', 'lower_arm_l'] })),
			/not a child/,
		],
		[
			'a 3D IK whose end is not under its lower bone',
			withIk(() => ({ end: 'chest' })),
			/end "chest"/,
		],
		[
			'a 3D IK reaching a bone of its own chain',
			withLimb({ target: 'hand_l' }, { control: 'hand_l' }),
			/hangs from its own chain/,
		],
		[
			'a 3D IK whose limb lacks its chain on its FK side',
			withLimb({}, { fk: ['upper_arm_l'] }),
			/FK side misses its chain/,
		],
		[
			'a 3D IK with no limb',
			{
				...half,
				controls: {
					...half.controls,
					limbs: {},
					picker: { items: half.controls?.picker?.items?.filter((x) => !x.limb) },
				},
			},
			/has no limb/,
		],
		[
			'a 3D IK listed twice',
			{
				...half,
				rig3d: {
					...(half.rig3d as NonNullable<RigTemplate['rig3d']>),
					ik: [...(half.rig3d?.ik ?? []), (half.rig3d?.ik ?? [])[0]],
				},
			},
			/listed twice/,
		],
		[
			'a 3D IK named as a constraint',
			withIk(() => ({ name: 'hand_ik_l_in_chest' })),
			/name of a constraint/,
		],
	] as [string, RigTemplate, RegExp][])
		check(
			`3D IK: ${label} is refused`,
			re.test(String(rigTemplateProblem(tpl))),
			String(rigTemplateProblem(tpl)),
		);
	check(
		'3D IK: the built-ins pass the contract',
		RIG_TEMPLATES.every((x) => rigTemplateProblem(x) === null),
	);

	// A 2D template (📐 Save as template from a rig with a live IK): a control blending the IK's mix.
	const full = rigTemplateById('full-body') as RigTemplate;
	const ik2d = {
		name: 'arm_ik',
		order: 0,
		bones: ['upper_arm_l', 'lower_arm_l'],
		target: 'hand_ik_l',
		mix: 0,
		bendPositive: false,
	};
	const blend: RigTemplateChannel = {
		id: 'ik_arm',
		label: 'IK arm',
		tip: '0 FK … 1 IK.',
		min: 0,
		max: 1,
		rest: 0,
		mixes: [{ ik: 'arm_ik', per: 1 }],
	};
	const twoD = (chs: RigTemplateChannel[], ik: Json[] = [ik2d]): RigTemplate => ({
		...full,
		rig3d: undefined,
		motion: undefined,
		controls: {
			...full.controls,
			limbs: {},
			picker: { items: full.controls?.picker?.items?.filter((x) => !x.limb) },
		},
		constraints: { ...full.constraints, ik },
		channels: [...full.channels, ...chs],
	});
	check(
		'2D blend: a 0…1 control keying an IK of the template is accepted, and poses',
		rigTemplateSaveProblem(twoD([blend])) === null,
		String(rigTemplateSaveProblem(twoD([blend]))),
	);
	for (const [label, tpl, re] of [
		[
			'blending an IK the template lacks',
			twoD([{ ...blend, mixes: [{ ik: 'nope', per: 1 }] }]),
			/missing IK constraint "nope"/,
		],
		['blending past a mix of 1', twoD([{ ...blend, max: 2 }]), /outside its mix's 0…1/],
		[
			'blending by a per of 0',
			twoD([{ ...blend, mixes: [{ ik: 'arm_ik', per: 0 }] }]),
			/per that is not/,
		],
		[
			'two controls blending one IK',
			twoD([blend, { ...blend, id: 'ik_arm2' }]),
			/both blend "arm_ik"/,
		],
		[
			'a control that reorders and blends',
			twoD([{ ...blend, order: { slots: ['torso'], steps: [{ at: 1, behind: 'pelvis' }] } }]),
			/reorders slots, so it moves nothing else/,
		],
		[
			'a control that sets others and blends',
			twoD([{ ...blend, sets: [{ channel: 'lean', per: 1 }] }]),
			/moves nothing itself/,
		],
	] as [string, RigTemplate, RegExp][])
		check(
			`2D blend: ${label} is refused`,
			re.test(String(rigTemplateProblem(tpl))),
			String(rigTemplateProblem(tpl)),
		);
	check(
		'2D blend: the save check keys a blend at its min, rest and max',
		JSON.stringify((controlAnimation(blend, [blend], () => true, []) as { ik?: unknown }).ik) ===
			JSON.stringify({
				arm_ik: [
					{ time: 0, mix: 0 },
					{ time: 0.5, mix: 0 },
					{ time: 1, mix: 1 },
				],
			}),
	);
	check(
		'2D blend: the template spec carries a control that blends',
		channelSchema.safeParse(blend).success,
	);
}

if (failures) {
	console.error(`rig templates: ${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`rig templates: ${checks}/${checks} checks pass`);
