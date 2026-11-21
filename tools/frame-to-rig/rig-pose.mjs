// Frame to rig, step 6 proof (docs/design/frame-to-rig.md): the shipped Half body template, built by
// the server's `templateRig` over the cut parts and posed by engine-rig, the loader every game runs.
//
//   node tools/frame-to-rig/rig-pose.mjs --geometry <out.json>
//     the template's setup pose: each bone's world place and each part's placeholder size.
//   node tools/frame-to-rig/rig-pose.mjs --fit <fit.json> <out.json>
//     fit.json = { regions: [{name, w, h}], bones: {name: {x, y}}, pose: {bone: {rotate?, scaleY?}} }
//     `bones` replaces setup offsets (the fitted skeleton); `pose` is keyed at t = 0 of an animation
//     `frame` (rotate relative to setup, as every channel keys). Writes each bone's world place and
//     each shown attachment's world quad, in setup and posed, for the compositor to draw.
// Not a gate: it measures the owner's frame, which is not in the repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from '../rigger-spike/esbuild.mjs';
import { RIG_CORE } from '../rigger-spike/rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const esbuild = await import(ESBUILD);
const {
	TextureAtlas,
	AtlasAttachmentLoader,
	SkeletonJson,
	Skeleton,
	AnimationState,
	AnimationStateData,
	Physics,
} = await import(RIG_CORE);

const out = join(mkdtempSync(join(tmpdir(), 'frame-to-rig-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { HALF_BODY, templateRig } = await import(pathToFileURL(out).href);

function load(regions, skeleton) {
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	const atlas = new TextureAtlas(`${lines.join('\n')}\n`);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(skeleton)),
	);
}

function dump(skel) {
	const bones = {};
	for (const b of skel.bones)
		bones[b.data.name] = {
			x: b.worldX,
			y: b.worldY,
			rotation: Math.atan2(b.c, b.a) * (180 / Math.PI),
			sx: Math.hypot(b.a, b.c),
			sy: Math.hypot(b.b, b.d),
		};
	const quads = [];
	for (const slot of skel.drawOrder) {
		const att = slot.getAttachment();
		if (!att || att.regionUVs || !att.computeWorldVertices) continue;
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		// Vertex order: the image's bottom-left, top-left, top-right, bottom-right (Spine 4.2 region).
		quads.push({ slot: slot.data.name, part: att.name, v: [...v] });
	}
	return { bones, quads };
}

const args = process.argv.slice(2);
if (args[0] === '--geometry') {
	const regions = HALF_BODY.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(HALF_BODY, regions);
	const skel = new Skeleton(load(regions, skeleton));
	skel.setToSetupPose();
	skel.updateWorldTransform(Physics.update);
	writeFileSync(
		args[1],
		JSON.stringify({
			id: HALF_BODY.id,
			version: HALF_BODY.version,
			parts: HALF_BODY.parts.map((p) => ({
				name: p.name,
				slot: p.slot,
				size: p.size,
				required: p.required,
			})),
			slots: HALF_BODY.slots,
			bonesTemplate: HALF_BODY.bones,
			...dump(skel),
		}),
	);
	console.log(`wrote ${args[1]}: ${skel.bones.length} bones, ${HALF_BODY.parts.length} parts`);
} else if (args[0] === '--fit') {
	const fit = JSON.parse(readFileSync(args[1], 'utf8'));
	const { skeleton, missing, missingRequired } = templateRig(HALF_BODY, fit.regions);
	for (const b of skeleton.bones) {
		const o = fit.bones?.[b.name];
		if (!o) continue;
		b.x = o.x;
		b.y = o.y;
	}
	// A prop (the chain, the glasses, a watch) is no template part: a slot of its own on the bone it
	// rides, drawn before or after the slot it names, its image centred on that bone.
	const skin = skeleton.skins[0].attachments;
	for (const prop of fit.props ?? []) {
		const r = fit.regions.find((x) => x.name === prop.name);
		if (!r) continue;
		const at = skeleton.slots.findIndex((s) => s.name === (prop.before ?? prop.after));
		if (at < 0) throw new Error(`prop ${prop.name}: no slot ${prop.before ?? prop.after}`);
		skeleton.slots.splice(prop.before ? at : at + 1, 0, {
			name: prop.name,
			bone: prop.bone,
			attachment: prop.name,
		});
		skin[prop.name] = { [prop.name]: { width: r.w, height: r.h } };
	}
	skeleton.animations = {};
	for (const [anim, pose] of Object.entries(fit.poses ?? {})) {
		const bones = {};
		for (const [name, p] of Object.entries(pose)) {
			const t = {};
			if (p.rotate !== undefined) t.rotate = [{ time: 0, value: p.rotate }];
			if (p.scaleY !== undefined) t.scale = [{ time: 0, x: 1, y: p.scaleY }];
			if (p.x !== undefined || p.y !== undefined)
				t.translate = [{ time: 0, x: p.x ?? 0, y: p.y ?? 0 }];
			bones[name] = t;
		}
		skeleton.animations[anim] = { bones };
	}
	const data = load(fit.regions, skeleton);
	const setup = new Skeleton(data);
	setup.setToSetupPose();
	setup.updateWorldTransform(Physics.update);
	const poses = {};
	for (const anim of Object.keys(skeleton.animations)) {
		const skel = new Skeleton(data);
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, anim, false);
		state.update(0);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		poses[anim] = dump(skel);
	}
	writeFileSync(
		args[2],
		JSON.stringify({ missing, missingRequired, setup: dump(setup), poses, skeleton }),
	);
	console.log(
		`wrote ${args[2]}: ${setup.drawOrder.filter((s) => s.getAttachment()).length} attachments shown, ` +
			`poses ${Object.keys(poses).join(', ')}, ${missing.length} parts missing ` +
			`(${missingRequired.length} needed: ${missingRequired.join(', ') || 'none'})`,
	);
} else {
	console.error('usage: rig-pose.mjs --geometry <out.json> | --fit <fit.json> <out.json>');
	process.exit(2);
}
