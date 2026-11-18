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
import { irigDocProblem } from '../src/lib/server/riggerIrig.ts';
import {
	RIG_TEMPLATES,
	rigTemplateFromSidecar,
	rigTemplateProblem,
	templateRig,
	type RigTemplate,
	type RigTemplateChannel,
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

for (const t of RIG_TEMPLATES) {
	check(`${t.id}: well-formed`, rigTemplateProblem(t) === null, String(rigTemplateProblem(t)));

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
const refused: [string, RigTemplate, RegExp][] = [
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
	'bust-face has the seven starter clips',
	base.clips.map((c) => c.name).join() === 'idle,blink,talk,happy,surprised,win_small,win_big',
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
for (const [label, t, want] of refused) {
	const problem = rigTemplateProblem(t);
	check(`a template with ${label} is refused`, !!problem && want.test(problem), String(problem));
}

check(
	'template.json names a template we have',
	rigTemplateFromSidecar('{"id":"bust-face","version":1}')?.channels.length ===
		base.channels.length,
);
check(
	'template.json that is missing, broken or unknown reads as no template',
	[null, '{', '"x"', '{"id":"gone","version":1}', '{"id":3}'].every(
		(t) => rigTemplateFromSidecar(t) === null,
	),
);

if (failures) {
	console.error(`rig templates: ${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`rig templates: ${checks}/${checks} checks pass`);
