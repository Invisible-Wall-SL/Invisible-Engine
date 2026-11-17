/**
 * Contract check for rig templates (docs/design/rig-templates.md, T1):
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
	rigTemplateProblem,
	templateRig,
	type RigTemplate,
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

if (failures) {
	console.error(`rig templates: ${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`rig templates: ${checks}/${checks} checks pass`);
