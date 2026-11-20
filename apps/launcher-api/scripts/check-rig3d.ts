/**
 * The 2.5D rig's sidecar, `rig3d.json` (docs/design/rig-2p5d.md §3, P2), offline:
 *   pnpm --filter launcher-api check:rig3d
 *
 *  1. Its schema refuses what it does not know, or in the wrong shape.
 *  2. Read against its `.irig`: a name the irig lacks is refused; cards come from the art (regions
 *     and weighted mesh points); a follower carries no setup of its own and is listed after the
 *     bone it follows.
 *  3. The bake's input reads the irig's 2D keys only on the bones the bake hangs from (and the flat
 *     bones under them, 7), never the last bake's output, so a save that changed nothing bakes the
 *     same thing again; the bake goes back into the irig where it owns it and nowhere else (2D
 *     clips, slot colours, the root's walk and every other bone's setup stay as they were).
 *  4. What a bake owns compares equal across the Rigger's load (defaults filled in) and a writer
 *     that omits them, and a 2D edit is named.
 *  5. Parity: the `.irig` a save writes, ALONE — read by the strict irig reader and played by
 *     engine-rig as a game plays it, with no sidecar anywhere — poses the 3D clip within the bake's
 *     bound and shows the drawing the bake chose. The runtime needs nothing from `rig3d.json`.
 *  6. Baked transitions (P7): the schema refuses a malformed one; its input starts exactly on the
 *     from-clip's 3D pose at its time and ends on the to-clip's first, blends the 2D bones too, and
 *     changes only with the poses it joins; engine-rig plays its bake from the irig alone.
 *  7. Flat bones (P4, design §4.1, §4.4): a bone lying flat under a baked one keeps its 2D keys,
 *     which the bake reads as input (so the baked bone's error card covers where they take its
 *     art) and never writes; engine-rig draws that art within the tolerance of its 3D pose.
 *
 * The routes that read and write the pair are `check-rigger-writes.ts`'s.
 */
import {
	AnimationState,
	AnimationStateData,
	AtlasAttachmentLoader,
	Physics,
	Skeleton,
	SkeletonJson,
	TextureAtlas,
	readIrig,
} from 'engine-rig';
import {
	BAKE_DEFAULTS,
	bake2p5d,
	cornerError,
	pose3d,
	rig2p5dProblems,
	transition3d,
	type Frame3d,
} from '../src/lib/rig2p5d.ts';
import {
	bakedParts,
	canonicalJson,
	clipOf,
	followersOf,
	partsDiffer,
	rig3dDocProblems,
	rig3dIrigProblems,
	rigOf,
	withBake,
	type Rig3dDoc,
} from '../src/lib/rig3d.ts';
import {
	FINGER_CURL,
	REGIONS,
	asRiggerLoads,
	irigOf,
	sidecarOf,
	withDefaultsOmitted,
	withFinger,
	withTransition,
} from './lib/rig3dFixture.ts';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

type Json = Record<string, unknown>;
/** Set `value` at `path` inside a copy of `doc` (a missing `value` deletes the field). */
function edited<T>(doc: T, path: (string | number)[], ...value: unknown[]): T {
	const out = structuredClone(doc);
	let node = out as unknown as Json;
	for (const key of path.slice(0, -1)) node = node[key] as Json;
	const last = path[path.length - 1];
	if (value.length) node[last] = value[0];
	else delete node[last];
	return out;
}

// ── 1. The schema ───────────────────────────────────────────────────────────────────────────────
const good = sidecarOf('H');
check(
	'schema: the fixture sidecar is well formed',
	rig3dDocProblems(good).length === 0,
	rig3dDocProblems(good).join('; '),
);
const refuses = (label: string, doc: unknown, expect: RegExp) => {
	const p = rig3dDocProblems(doc);
	check(
		`schema refuses ${label}`,
		p.some((x) => expect.test(x)),
		p.join('; ') || 'no problem found',
	);
};
const ORIENT = ['clips', 'reach', 'bones', 'chest', 'orient', 1];
refuses(
	'a field it does not know',
	edited(good, ['name'], 'H'),
	/rig3d\.json\.name is not a rig3d field/,
);
refuses(
	'a 3D channel it does not know',
	edited(good, ['clips', 'reach', 'bones', 'chest', 'tilt'], []),
	/chest\.tilt is not a rig3d field/,
);
refuses('a missing rig', edited(good, ['rig']), /rig is missing/);
refuses('a newer version', edited(good, ['rig3d'], 2), /newer than this launcher reads/);
refuses('a zero tolerance', edited(good, ['tolerance'], 0), /tolerance must be above 0/);
refuses(
	'a tolerance that is not a number',
	edited(good, ['tolerance'], '0.45'),
	/tolerance must be a number/,
);
refuses('a negative hysteresis', edited(good, ['hysteresis'], -1), /hysteresis must be at least 0/);
refuses(
	'a turnaround that is not side or full',
	edited(good, ['turnaround'], 'back'),
	/'side' or 'full'/,
);
refuses(
	'a quaternion of three numbers',
	edited(good, [...ORIENT, 'value'], [1, 0, 0]),
	/must be a quaternion/,
);
refuses(
	'a zero quaternion',
	edited(good, [...ORIENT, 'value'], [0, 0, 0, 0]),
	/must be a quaternion/,
);
refuses('an orientation key with no value', edited(good, [...ORIENT, 'value']), /value is missing/);
refuses('a key before the clip', edited(good, [...ORIENT, 'time'], -1), /time must be at least 0/);
refuses(
	"a curve that is not 'stepped' or numbers",
	edited(good, [...ORIENT, 'curve'], 'linear'),
	/'stepped' or a list of numbers/,
);
refuses(
	'a drawing with no turn',
	edited(good, ['views', 'hand', 'drawings', 0, 'turn']),
	/turn is missing/,
);
refuses(
	'a follow with no name',
	edited(good, ['bones', 'hand_image', 'follow'], ''),
	/follow must be a name/,
);
refuses(
	'a bake record with no hash',
	edited(good, ['clips', 'reach', 'baked'], { input: 'x', bones: [], slots: [] }),
	/baked\.hash is missing/,
);
refuses('a list', [], /must be an object/);
refuses('null', null, /must be an object/);

// ── 2. Against the irig ─────────────────────────────────────────────────────────────────────────
const irig = irigOf();
check(
	'irig: the fixture sidecar fits its irig',
	rig3dIrigProblems(good, irig).length === 0,
	rig3dIrigProblems(good, irig).join('; '),
);
const misfits = (label: string, doc: Rig3dDoc, expect: RegExp) => {
	const p = rig3dIrigProblems(doc, irig);
	check(
		`irig: refuses ${label}`,
		p.some((x) => expect.test(x)),
		p.join('; ') || 'no problem found',
	);
};
misfits(
	'a 3D bone the rig lacks',
	edited(good, ['bones', 'ghost'], { depth: 1 }),
	/3D bone ghost is not a bone of the rig/,
);
misfits(
	'a follow the rig lacks',
	edited(good, ['bones', 'hand_image', 'follow'], 'ghost'),
	/follows ghost/,
);
misfits(
	'drawings on a slot the rig lacks',
	edited(good, ['views', 'ghost'], { drawings: [] }),
	/slot ghost has drawings/,
);
misfits(
	'a drawing that is not an attachment of its slot',
	edited(good, ['views', 'hand', 'drawings', 0, 'attachment'], 'hand_back'),
	/drawing hand_back is not one of its attachments/,
);
misfits(
	'a clip keying a bone the rig lacks',
	edited(good, ['clips', 'reach', 'bones', 'ghost'], {}),
	/keys bone ghost in 3D/,
);

const rig = rigOf(irig, good);
const bone = (n: string) => rig.bones.find((b) => b.name === n);
check(
	"rig: a card spans the bone's region and the weighted mesh points on it",
	same(bone('upper_arm')?.card, { x0: 0, x1: 130, h: 18 }) &&
		same(bone('forearm')?.card, { x0: 0, x1: 100, h: 15 }),
	JSON.stringify([bone('upper_arm')?.card, bone('forearm')?.card]),
);
check(
	'rig: the sidecar sets depth and follow',
	bone('forearm')?.depth === 3 && bone('hand_image')?.follow === 'hand',
);
const order = rig.bones.map((b) => b.name);
check(
	'rig: a follower is listed after the bone it follows',
	order.indexOf('hand_image') > order.indexOf('hand'),
	order.join(','),
);
const placed = edited(edited(irig, ['bones', 2, 'x'], 25), ['bones', 2, 'rotation'], 30);
const follower = rigOf(placed, good).bones.find((b) => b.name === 'hand_image') ?? {};
check(
	"rig: a follower's setup in the irig (the last bake's) is not read back",
	['x', 'y', 'rotate', 'scaleX', 'scaleY'].every((f) => !(f in follower)),
	JSON.stringify(follower),
);
check(
	'rig: the irig setup of every other bone is read',
	bone('upper_arm')?.rotate === -90 && bone('upper_arm')?.x === 80,
);
check('rig: the per-rig settings and turnaround come from the sidecar', rig.turnaround === 'side');

const ik = (mix: number) => ({
	...irig,
	ik: [{ name: 'reach', bones: ['forearm'], target: 'hand', mix }],
});
const ikProblems = (doc: Json) => {
	const r = rigOf(doc, good);
	return rig2p5dProblems(r, clipOf(r, doc, good, 'reach').clip);
};
check(
	'rig: an IK constraint on a baked bone is refused',
	ikProblems(ik(1)).some((p) => /constraint ik reach acts on forearm/.test(p)),
);
check(
	'rig: an IK constraint at mix 0 is not',
	ikProblems(ik(0)).length === 0,
	ikProblems(ik(0)).join('; '),
);
const ikKeyedOff = edited(ik(1), ['animations', 'reach', 'ik'], { reach: [{ time: 0, mix: 0 }] });
check(
	'rig: an IK constraint keyed to 0 for the clip is not',
	ikProblems(ikKeyedOff).length === 0,
	ikProblems(ikKeyedOff).join('; '),
);

// ── 3. The bake's input and where its output goes ───────────────────────────────────────────────
const plan = clipOf(rig, irig, good, 'reach');
check(
	'clip: the bake owns every 3D bone, what hangs from one and the follower — not the root',
	same(plan.owned, ['chest', 'upper_arm', 'forearm', 'hand', 'hand_image']) &&
		same(plan.slots, ['hand']),
	JSON.stringify([plan.owned, plan.slots]),
);
const anims = (d: Json) => d.animations as Record<string, Json>;
check(
	"clip: the root's 2D walk is read as the parent the arm hangs from",
	same(plan.clip.bones.root, (anims(irig).reach.bones as Json).root),
);
check("clip: its duration is the sidecar's", plan.clip.duration === 2);
check(
	'clip: the fixture bakes',
	rig2p5dProblems(rig, plan.clip).length === 0,
	rig2p5dProblems(rig, plan.clip).join('; '),
);
const garbage = edited(irig, ['animations', 'reach', 'bones', 'upper_arm'], {
	rotate: [{ time: 0.5, value: 999 }],
	shear: [{ time: 0, x: 9 }],
});
check(
	"clip: a baked bone's timelines in the irig are never read as input (they are the last bake's)",
	same(clipOf(rigOf(garbage, good), garbage, good, 'reach'), plan),
);
const sheared = edited(irig, ['animations', 'reach', 'bones', 'chest'], {
	shear: [{ time: 0, x: 4 }],
});
const notChest = edited(good, ['clips', 'reach', 'bones', 'chest']);
check(
	'clip: a bone the bake hangs from with 2D keys it cannot read is refused',
	clipOf(rigOf(sheared, notChest), sheared, notChest, 'reach').problems.some((p) =>
		/bone chest .* keys shear in 2D/.test(p),
	),
);

const t0 = performance.now();
const bake = bake2p5d(rig, plan.clip);
const bakeMs = performance.now() - t0;
const followers = followersOf(good);
const out = withBake(irig, 'reach', plan, bake, followers);
check('bake: a 2D clip of the rig is untouched', same(anims(out).idle, anims(irig).idle));
check(
	"bake: the 3D clip's slot colours and the root's walk stay as they were",
	same((anims(out).reach.slots as Json).torso, (anims(irig).reach.slots as Json).torso) &&
		same((anims(out).reach.bones as Json).root, (anims(irig).reach.bones as Json).root),
);
check(
	'bake: every owned bone that moves has baked timelines, and the drawing slot its drawing keys',
	['chest', 'upper_arm', 'forearm', 'hand', 'hand_image'].every((b) =>
		Boolean((anims(out).reach.bones as Json)[b]),
	) && Array.isArray(((anims(out).reach.slots as Json).hand as Json).attachment),
);
const setupOf = (d: Json, n: string) => (d.bones as Json[]).find((b) => b.name === n);
const derived = bake.setup.hand_image;
check(
	"bake: the follower's derived setup is written into the irig",
	setupOf(out, 'hand_image')?.x === derived.x &&
		setupOf(out, 'hand_image')?.rotation === derived.rotation,
	JSON.stringify([setupOf(out, 'hand_image'), derived]),
);
check(
	"bake: no other bone's setup changes",
	['root', 'chest', 'upper_arm', 'forearm', 'hand'].every((n) =>
		same(setupOf(out, n), setupOf(irig, n)),
	),
);
const again = clipOf(rigOf(out, good), out, good, 'reach');
check('bake: the baked irig gives the bake the same input again', same(again, plan));
const scope = { bones: plan.owned, slots: plan.slots };
const rebakeOut = withBake(out, 'reach', again, bake2p5d(rigOf(out, good), again.clip), followers);
check(
	'bake: baking it again writes the same parts',
	same(
		bakedParts(rebakeOut, 'reach', scope, followers),
		bakedParts(out, 'reach', scope, followers),
	),
);

// ── 4. Comparing what the bake owns ─────────────────────────────────────────────────────────────
const parts = bakedParts(out, 'reach', scope, followers);
check(
	'parts: equal after the Rigger loads the rig (defaults filled in)',
	same(bakedParts(asRiggerLoads(out), 'reach', scope, followers), parts),
);
check(
	'parts: equal from a writer that omits defaults',
	same(bakedParts(withDefaultsOmitted(out), 'reach', scope, followers), parts),
);
const keyed = edited(
	out,
	['animations', 'reach', 'bones', 'upper_arm', 'rotate', 1, 'value'],
	12.5,
);
check(
	'parts: a 2D key on a baked bone is named',
	same(partsDiffer(parts, bakedParts(keyed, 'reach', scope, followers)), ['upper_arm']),
);
const moved = structuredClone(out);
(setupOf(moved, 'hand_image') as Json).x = 999;
check(
	"parts: a follower's setup moved in 2D is named",
	same(partsDiffer(parts, bakedParts(moved, 'reach', scope, followers)), ["hand_image's setup"]),
);
const reordered = edited(
	out,
	['animations', 'reach', 'drawOrder'],
	[{ time: 0.5, offsets: [{ slot: 'torso', offset: 3 }] }],
);
check(
	'parts: a draw-order key is named',
	partsDiffer(parts, bakedParts(reordered, 'reach', scope, followers)).includes('draw order'),
);
check(
	'parts: a deleted clip is the whole clip',
	same(
		partsDiffer(parts, bakedParts(edited(out, ['animations', 'reach']), 'reach', scope, followers)),
		['the whole clip'],
	),
);
check(
	'parts: an edit the bake does not own changes nothing',
	same(
		bakedParts(
			edited(out, ['animations', 'idle', 'bones', 'chest', 'rotate', 1, 'value'], 9),
			'reach',
			scope,
			followers,
		),
		parts,
	),
);

// ── 5. Parity: the irig alone, played by engine-rig ─────────────────────────────────────────────
const text = JSON.stringify(out);
let strict = '';
try {
	readIrig(text);
} catch (e) {
	strict = (e as Error).message;
}
check(
	'parity: the baked irig is read by the strict irig reader (only irig fields)',
	strict === '',
	strict,
);
check(
	'parity: none of the sidecar rides in the irig',
	!/"(rig3d|orient|baked|depth|follow|views|drawings|turnaround)"\s*:/.test(text),
);

const atlas = new TextureAtlas(
	[
		'page.png',
		'size:1024,64',
		'filter:Linear,Linear',
		...REGIONS.flatMap((n, i) => [n, `bounds:${i * 64},0,64,64`]),
		'',
	].join('\n'),
);
atlas.setTextures(() => ({
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
}));
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(text));
const skel = new Skeleton(data);
const state = new AnimationState(new AnimationStateData(data));
state.setAnimation(0, 'reach', false);

const turnAt = (t: number) => {
	let turn = 0;
	for (const d of bake.drawings.hand) if (d.time <= t) turn = d.turn;
	return turn;
};
const drawingAt = (t: number) => {
	let a = '';
	for (const d of bake.drawings.hand) if (d.time <= t) a = d.attachment;
	return a;
};
const ry = (deg: number) => {
	const r = (deg * Math.PI) / 180;
	return [Math.cos(r), 0, Math.sin(r), 0, 1, 0, -Math.sin(r), 0, Math.cos(r)];
};
const mm = (p: number[], c: number[]) =>
	Array.from({ length: 9 }, (_, i) => {
		const r = (i / 3) | 0;
		const k = i % 3;
		return p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k];
	});
const projected = (f: Frame3d) => ({
	a: f.m[0],
	b: f.m[1],
	c: f.m[3],
	d: f.m[4],
	x: f.o[0],
	y: f.o[1],
});
const steps = [
	...bake.drawings.hand.map((d) => d.time),
	...Object.values(bake.report.flips).flat(),
];
let worst = 0;
let worstAt = '';
let shown = true;
let now = 0;
for (let i = 0; i <= 2000; i++) {
	const t = i / 1000;
	state.update(t - now);
	now = t;
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	if (steps.some((s) => Math.abs(s - t) < 2e-4)) continue;
	const ref = pose3d(rig, plan.clip, t);
	for (const name of plan.owned) {
		const b = skel.findBone(name);
		const card = bone(name)?.card;
		const f = name === 'hand_image' ? ref.get('hand') : ref.get(name);
		if (!b || !card || !f) continue;
		const target = name === 'hand_image' ? { m: mm(f.m, ry(turnAt(t))), o: f.o } : f;
		const e = cornerError(
			{ a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY },
			projected(target),
			card,
		);
		if (e > worst) [worst, worstAt] = [e, `${name} @ ${t.toFixed(3)} s`];
	}
	if (skel.findSlot('hand')?.getAttachment()?.name !== drawingAt(t)) shown = false;
}
check(
	`parity: engine-rig plays the irig alone within the bake's bound of the 3D pose (worst ${worst.toFixed(3)} rig units, ${worstAt})`,
	worst < 1,
);
check('parity: engine-rig shows the drawing the bake chose, all clip long', shown);
check(
	'parity: the hand turns through more than one drawing',
	new Set(bake.drawings.hand.map((d) => d.attachment)).size >= 3,
	JSON.stringify(bake.drawings.hand),
);

// ── 6. Baked transitions (P7) ───────────────────────────────────────────────────────────────────
const tdoc = withTransition(good);
const TR = ['clips', 'reach_to_wave'];
check(
	'transition: a sidecar declaring one is well formed',
	rig3dDocProblems(tdoc).length === 0,
	rig3dDocProblems(tdoc).join('; '),
);
refuses(
	'a transition not named for its two clips',
	edited(edited(tdoc, ['clips', 'wave_in'], tdoc.clips?.reach_to_wave), TR),
	/is named reach_to_wave, so games find it/,
);
refuses(
	'a transition keying bones of its own',
	edited(tdoc, [...TR, 'bones', 'chest'], { orient: [{ value: [1, 0, 0, 0] }] }),
	/keys no bones of its own/,
);
refuses(
	'a transition with a clip duration',
	edited(tdoc, [...TR, 'duration'], 1),
	/as long as its transition\.duration/,
);
refuses(
	'a transition from a clip that is not a 3D clip',
	edited(tdoc, [...TR, 'transition', 'from'], 'idle'),
	/idle is not a 3D clip of the rig/,
);
refuses(
	'a transition from a transition',
	edited(tdoc, ['clips', 'reach_to_wave_to_wave'], {
		bones: {},
		transition: { from: 'reach_to_wave', to: 'wave', duration: 0.2 },
	}),
	/reach_to_wave is a transition itself/,
);
refuses(
	'a transition with no duration',
	edited(tdoc, [...TR, 'transition', 'duration']),
	/transition\.duration is missing/,
);
refuses(
	'a transition of no length',
	edited(tdoc, [...TR, 'transition', 'duration'], 0),
	/transition\.duration must be above 0/,
);
refuses(
	'a transition starting before its clip',
	edited(tdoc, [...TR, 'transition', 'at'], -0.5),
	/transition\.at must be at least 0/,
);
refuses(
	'a transition field it does not know',
	edited(tdoc, [...TR, 'transition', 'curve'], 'ease'),
	/transition\.curve is not a rig3d field/,
);

const trRig = rigOf(irig, tdoc);
const trPlan = clipOf(trRig, irig, tdoc, 'reach_to_wave');
check(
	'transition: its clip is the transition, as long as declared, with no problems',
	trPlan.clip.name === 'reach_to_wave' &&
		trPlan.clip.duration === 0.3 &&
		trPlan.problems.length === 0 &&
		rig2p5dProblems(trRig, trPlan.clip).length === 0,
	[...trPlan.problems, ...rig2p5dProblems(trRig, trPlan.clip)].join('; '),
);
check(
	'transition: the bake owns every bone it moves — the 3D ones, the hinge, the follower and the 2D root',
	same(
		[...trPlan.owned].sort(),
		['chest', 'forearm', 'hand', 'hand_image', 'root', 'upper_arm'].sort(),
	) && same(trPlan.slots, ['hand']),
	JSON.stringify([trPlan.owned, trPlan.slots]),
);
const poseGap = (p: Map<string, Frame3d>, q: Map<string, Frame3d>) =>
	Math.max(
		...[...p].map(([n, f]) => {
			const g = q.get(n);
			return g
				? Math.max(
						...f.m.map((v, i) => Math.abs(v - g.m[i])),
						...f.o.map((v, i) => Math.abs(v - g.o[i])),
					)
				: Infinity;
		}),
	);
const reachClip = clipOf(trRig, irig, tdoc, 'reach').clip;
const waveClip = clipOf(trRig, irig, tdoc, 'wave').clip;
const startGap = poseGap(pose3d(trRig, trPlan.clip, 0), pose3d(trRig, reachClip, 1));
const endGap = poseGap(pose3d(trRig, trPlan.clip, 0.3), pose3d(trRig, waveClip, 0));
check(
	"transition: it starts on the reach's 3D pose at 1 s and ends on the wave's first",
	startGap < 1e-9 && endGap < 1e-9,
	`${startGap}, ${endGap}`,
);
const fromSetup = transition3d(trRig, reachClip, waveClip, 1, 0.3, 'x', { start: 'setup' });
check(
	"transition (mutation): one started from the setup misses the reach's pose",
	poseGap(pose3d(trRig, fromSetup, 0), pose3d(trRig, reachClip, 1)) > 1,
);
const quarter = pose3d(trRig, trPlan.clip, 0.075).get('upper_arm');
const lerped = transition3d(trRig, reachClip, waveClip, 1, 0.3, 'x', { spin: 'lerp' });
check(
	'transition (mutation): its turns are slerped — a lerp of the quaternions is elsewhere a quarter in',
	quarter !== undefined &&
		poseGap(new Map([['upper_arm', quarter]]), pose3d(trRig, lerped, 0.075)) > 1e-3,
);
check(
	"transition: the root's 2D walk is blended from the reach's at 1 s to the wave's setup",
	same(trPlan.clip.bones.root?.translate, [
		{ time: 0, x: 15, y: 0 },
		{ time: 0.3, x: 0, y: 0 },
	]),
	JSON.stringify(trPlan.clip.bones.root),
);
const fromEnd = clipOf(trRig, irig, withTransition(good, 'end'), 'reach_to_wave');
check(
	'transition: with no start time it leaves the reach at its end',
	fromEnd.clip.bones.root?.translate?.[0]?.x === 30,
	JSON.stringify(fromEnd.clip.bones.root),
);
const late = withTransition(good, 2.5);
check(
	'transition: one starting after its clip ends is refused',
	clipOf(rigOf(irig, late), irig, late, 'reach_to_wave').problems.some((p) =>
		/starts at 2\.5 s, after clip reach ends \(2 s\)/.test(p),
	),
);
const legged = structuredClone(irig);
(legged.bones as Json[]).push({ name: 'leg', parent: 'root', length: 60 });
((legged.animations as Record<string, Json>).reach.bones as Json).leg = {
	rotate: [
		{ time: 0, value: 0 },
		{ time: 2, value: 40 },
	],
};
const legPlan = clipOf(rigOf(legged, tdoc), legged, tdoc, 'reach_to_wave');
check(
	'transition: a bone the clip keys only in 2D (a leg) is blended too, the short way round',
	same(legPlan.clip.bones.leg?.rotate, [
		{ time: 0, value: 20 },
		{ time: 0.3, value: 0 },
	]) && legPlan.owned.includes('leg'),
	JSON.stringify(legPlan.clip.bones.leg),
);
(((legged.animations as Record<string, Json>).reach.bones as Json).leg as Json).shear = [
	{ time: 0, x: 5 },
];
check(
	'transition: …and one keying what a transition cannot blend (shear) is refused',
	clipOf(rigOf(legged, tdoc), legged, tdoc, 'reach_to_wave').problems.some((p) =>
		/bone leg keys shear in clip reach/.test(p),
	),
);
const laterKey = edited(
	tdoc,
	['clips', 'reach', 'bones', 'chest', 'orient', 2, 'value'],
	[0.9, 0, 0.4, 0],
);
const atKey = edited(
	tdoc,
	['clips', 'reach', 'bones', 'chest', 'orient', 1, 'value'],
	[0.9, 0, 0.4, 0],
);
check(
	'transition: editing the reach after its start leaves the transition as it was; at its start, not',
	same(clipOf(trRig, irig, laterKey, 'reach_to_wave'), trPlan) &&
		!same(clipOf(trRig, irig, atKey, 'reach_to_wave'), trPlan),
);

const trBake = bake2p5d(trRig, trPlan.clip);
const trOut = withBake(irig, 'reach_to_wave', trPlan, trBake, followers);
let trStrict = '';
try {
	readIrig(JSON.stringify(trOut));
} catch (e) {
	trStrict = (e as Error).message;
}
check(
	'transition: baked into the irig as an ordinary clip the strict reader accepts',
	trStrict === '',
	trStrict,
);
const trData = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(trOut);
const trSkel = new Skeleton(trData);
const trState = new AnimationState(new AnimationStateData(trData));
trState.setAnimation(0, 'reach_to_wave', false);
const trSteps = Object.values(trBake.report.flips).flat();
let trWorst = 0;
let trNow = 0;
for (let i = 0; i <= 300; i++) {
	const t = i / 1000;
	trState.update(t - trNow);
	trNow = t;
	trState.apply(trSkel);
	trSkel.updateWorldTransform(Physics.update);
	if (trSteps.some((s) => Math.abs(s - t) < 2e-4)) continue;
	const ref = pose3d(trRig, trPlan.clip, t);
	for (const name of ['chest', 'upper_arm', 'forearm', 'hand']) {
		const b = trSkel.findBone(name);
		const card = trRig.bones.find((x) => x.name === name)?.card;
		const f = ref.get(name);
		if (!b || !card || !f) continue;
		const e = cornerError(
			{ a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY },
			projected(f),
			card,
		);
		trWorst = Math.max(trWorst, e);
	}
}
check(
	`transition: engine-rig plays it from the irig alone within the bake's bound (worst ${trWorst.toFixed(3)})`,
	trWorst < 1,
);

// ── 7. Flat bones (P4): their 2D keys are the bake's input, and stay theirs ─────────────────────
const fingered = withFinger(irig);
const fRig = rigOf(fingered, good);
const fPlan = clipOf(fRig, fingered, good, 'reach');
check(
	"flat: a finger lying flat in the hand's card is not owned (the bake keys the same bones)",
	same(fPlan.owned, plan.owned) && same(fPlan.slots, plan.slots),
	JSON.stringify(fPlan.owned),
);
check(
	"flat: its 2D curl is the bake's input (the hand's error card covers where the curl takes it)",
	same(fPlan.clip.bones.finger, { rotate: FINGER_CURL }) && fPlan.problems.length === 0,
	JSON.stringify([fPlan.clip.bones.finger, fPlan.problems]),
);
const recurled = edited(
	fingered,
	['animations', 'reach', 'bones', 'finger', 'rotate', 1, 'value'],
	60,
);
check(
	"flat: re-keying the finger in 2D changes the bake's input, so the save bakes the clip again",
	!same(clipOf(rigOf(recurled, good), recurled, good, 'reach').clip, fPlan.clip),
);
const fShear = edited(
	fingered,
	['animations', 'reach', 'bones', 'finger', 'shear'],
	[{ time: 0, x: 5 }],
);
check(
	'flat: a flat bone keying what the bake cannot read (shear) is refused',
	clipOf(rigOf(fShear, good), fShear, good, 'reach').problems.some((p) =>
		/bone finger lies flat .* keys shear in 2D/.test(p),
	),
);
const fLegged = structuredClone(fingered);
(fLegged.bones as Json[]).push({ name: 'leg', parent: 'root', length: 60 });
((fLegged.animations as Record<string, Json>).reach.bones as Json).leg = {
	rotate: [{ time: 0, value: 20 }],
};
check(
	'flat: a bone keyed in 2D away from the 3D ones (a leg) is not read',
	!Object.hasOwn(clipOf(rigOf(fLegged, good), fLegged, good, 'reach').clip.bones, 'leg'),
);
const fBake = bake2p5d(fRig, fPlan.clip);
const fOut = withBake(fingered, 'reach', fPlan, fBake, followers);
check(
	"flat: the bake leaves the finger's 2D keys in the irig as they were",
	same((anims(fOut).reach.bones as Json).finger, (anims(fingered).reach.bones as Json).finger),
);
check(
	'flat: the baked irig gives the bake the same input again',
	same(clipOf(rigOf(fOut, good), fOut, good, 'reach'), fPlan),
);
/** The reach as the runtime plays it: the 3D keys, the root's walk and the finger's curl. */
const played = {
	...fPlan.clip,
	bones: { ...fPlan.clip.bones, finger: { rotate: structuredClone(FINGER_CURL) } },
};
const fingerCard = fRig.bones.find((b) => b.name === 'finger')?.card;
/** How far engine-rig, playing the irig a bake wrote, draws the finger's art from its 3D pose. */
const fingerMiss = (b: ReturnType<typeof bake2p5d>): number => {
	const d = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		withBake(fingered, 'reach', fPlan, b, followers),
	);
	const sk = new Skeleton(d);
	const st = new AnimationState(new AnimationStateData(d));
	st.setAnimation(0, 'reach', false);
	const skip = [...b.drawings.hand.map((x) => x.time), ...Object.values(b.report.flips).flat()];
	let miss = 0;
	let at = 0;
	for (let i = 0; i <= 2000; i++) {
		const t = i / 1000;
		st.update(t - at);
		at = t;
		st.apply(sk);
		sk.updateWorldTransform(Physics.update);
		if (skip.some((s) => Math.abs(s - t) < 2e-4)) continue;
		const f = pose3d(fRig, played, t).get('finger');
		const x = sk.findBone('finger');
		if (!f || !x || !fingerCard) return Infinity;
		const e = cornerError(
			{ a: x.a, b: x.b, c: x.c, d: x.d, x: x.worldX, y: x.worldY },
			projected(f),
			fingerCard,
		);
		miss = Math.max(miss, e);
	}
	return miss;
};
const fMiss = fingerMiss(fBake);
check(
	`flat: engine-rig draws the finger's art within the tolerance of its 3D pose (worst ${fMiss.toFixed(3)}, tolerance ${BAKE_DEFAULTS.tolerance})`,
	fMiss <= BAKE_DEFAULTS.tolerance,
);
const setupOnly = { ...played.bones };
delete setupOnly.finger;
const blindMiss = fingerMiss(bake2p5d(fRig, { ...played, bones: setupOnly }));
check(
	`flat (mutation): a bake that sees the finger only at its setup draws it past the tolerance (worst ${blindMiss.toFixed(3)})`,
	blindMiss > BAKE_DEFAULTS.tolerance,
);

console.log(
	`\n${failures ? `${failures} of ${checks} rig3d checks FAILED` : `all ${checks} rig3d checks pass`} (bake ${bakeMs.toFixed(0)} ms, worst ${worst.toFixed(3)})`,
);
process.exit(failures ? 1 : 0);
