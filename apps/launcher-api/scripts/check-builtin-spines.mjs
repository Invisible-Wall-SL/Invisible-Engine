/**
 * Guard that every BUILT-IN spine (`static/builtin/spines/*`) loads, poses and measures under the
 * rig runtime (`packages/engine-rig`) — the one the editor previews with and the game runs.
 *
 * Run: `pnpm --filter launcher-api run check:builtin-spines`
 *
 * WHY. The built-ins are Spine 4.1 exports, and one runtime reads every skeleton (4.1 and 4.2 data
 * alike). That is safe exactly as long as what is asserted here stays true: each built-in parses,
 * poses through `Physics.update`, and measures a positive extent. Add a built-in, and this is the
 * check that says whether it may ship.
 *
 * Uses the rig runtime with a stub texture, so it runs headless in Node (under tsx, which loads the
 * runtime's TypeScript).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as spine from 'engine-rig';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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
			`ok ${dir.name}: exported ${json.skeleton?.spine}, ${data.bones.length} bones, ${data.animations.length} animations pose`,
		);
	} catch (e) {
		console.error(`FAIL ${dir.name}: ${e instanceof Error ? e.message : e}`);
		fails++;
	}
}
if (fails) {
	console.error(`${fails} built-in spine(s) do not load under the rig runtime`);
	process.exit(1);
}
console.log('builtin spines: all load under the rig runtime');
