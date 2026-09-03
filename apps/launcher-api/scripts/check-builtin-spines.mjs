/**
 * Guard that every BUILT-IN spine (`static/builtin/spines/*`) loads under the ONE runtime line the
 * editor previews with — 4.2, the line the game runs.
 *
 * Run: `pnpm --filter launcher-api run check:builtin-spines`
 *
 * WHY. The built-ins are Spine 4.1 exports. The editor used to load one vendored runtime per
 * requested line and let "the first to finish" own `window.spine`; a cold /symbols load requested
 * 4.1 (these) and 4.2 (a Rigger rig) at once, both scripts injected, and skeletons built by one
 * runtime were posed and drawn by the other — every 4.2 cell threw "physics is undefined" and stayed
 * blank until a reload reordered the scripts. `spineRuntime.client.ts` now loads 4.2 only, which is
 * safe exactly as long as what is asserted here stays true: each built-in parses, poses through
 * `Physics.update`, and measures a positive extent under a 4.2 reader. Add a built-in, and this is
 * the check that says whether it may ship.
 *
 * Uses `@esotericsoftware/spine-core` 4.2 (the same major.minor as the vendored `spine-webgl-4.2.js`)
 * with a stub texture, so it runs headless in Node.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const corePath = require.resolve('@esotericsoftware/spine-core', {
	paths: [join(appRoot, '..', '..', 'packages', 'pixi-svelte')],
});
const spine = await import(pathToFileURL(corePath).href);

const root = join(appRoot, 'static', 'builtin', 'spines');
const stubTexture = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};

let fails = 0;
for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
	const files = readdirSync(join(root, dir.name));
	const atlasFile = files.find((f) => f.endsWith('.atlas'));
	const jsonFile = files.find((f) => f.endsWith('.json'));
	if (!atlasFile || !jsonFile) {
		console.error(`FAIL ${dir.name}: needs one .atlas and one .json`);
		fails++;
		continue;
	}
	try {
		const json = JSON.parse(readFileSync(join(root, dir.name, jsonFile), 'utf8'));
		const atlas = new spine.TextureAtlas(readFileSync(join(root, dir.name, atlasFile), 'utf8'));
		for (const page of atlas.pages) page.setTexture(stubTexture);
		const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(
			json,
		);
		const skel = new spine.Skeleton(data);
		const state = new spine.AnimationState(new spine.AnimationStateData(data));
		let worst = Infinity;
		for (const anim of data.animations) {
			state.setAnimation(0, anim.name, false);
			state.update(anim.duration / 2);
			state.apply(skel);
			skel.updateWorldTransform(spine.Physics.update);
			const off = new spine.Vector2();
			const size = new spine.Vector2();
			skel.getBounds(off, size, []);
			worst = Math.min(worst, size.x, size.y);
		}
		if (!(worst > 0)) throw new Error('an animation measured a degenerate extent');
		console.log(
			`ok ${dir.name}: exported ${json.skeleton?.spine}, ${data.bones.length} bones, ${data.animations.length} animations pose under 4.2`,
		);
	} catch (e) {
		console.error(`FAIL ${dir.name}: ${e instanceof Error ? e.message : e}`);
		fails++;
	}
}
if (fails) {
	console.error(`${fails} built-in spine(s) do not load under the 4.2 runtime`);
	process.exit(1);
}
console.log('builtin spines: all load under the editor runtime (4.2)');
