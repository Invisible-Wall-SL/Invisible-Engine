// Parity gate for the Frames step-1 shim (docs/design/invisible-editor.md §23.5).
// Proves `resolveFrame` reproduces today's `<LayoutScene>` `space` switch exactly,
// so every existing doc renders into the identical wrapper. Bundles the pure
// resolver with esbuild (a devDep) and asserts. Run: `node scripts/check-frames.mjs`
// (or `pnpm --filter engine-layout check:frames`).

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'lib', 'resolveFrame.ts');

const result = await build({
	entryPoints: [entry],
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});
const out = join(tmpdir(), `frames-check-${process.pid}.mjs`);
writeFileSync(out, result.outputFiles[0].text);

try {
	const { resolveFrame, frameSizes, BUILTIN_FRAMES } = await import(pathToFileURL(out).href);

	const MAIN = {
		desktop: { width: 1280, height: 720 },
		tablet: { width: 1280, height: 1280 },
		landscape: { width: 1280, height: 720 },
		portrait: { width: 720, height: 1280 },
	};
	const STANDARD = BUILTIN_FRAMES.standard.sizes;

	// Each row mirrors a branch of today's <LayoutScene> switch: a legacy scene
	// (only `space`, never `frame`) must resolve to the matching wrapper.
	// kind 'main' + sizes === MAIN  → <MainContainer>            (game)
	// kind 'main' + sizes === STANDARD → <MainContainer standard> (standard)
	// kind 'canvas' / 'background'  → no wrapper
	const legacy = [
		{ scene: {}, kind: 'main', box: MAIN, note: 'frame+space unset ⇒ game' },
		{ scene: { space: 'game' }, kind: 'main', box: MAIN, note: 'space:game' },
		{ scene: { space: 'standard' }, kind: 'main', box: STANDARD, note: 'space:standard' },
		{ scene: { space: 'canvas' }, kind: 'canvas', box: MAIN, note: 'space:canvas' },
		{ scene: { space: 'background' }, kind: 'background', box: MAIN, note: 'space:background' },
	];
	for (const { scene, kind, box, note } of legacy) {
		const f = resolveFrame({}, scene);
		assert.equal(f.kind, kind, `kind for ${note}`);
		assert.deepEqual(frameSizes(f, MAIN), box, `effective sizes for ${note}`);
	}

	// `frame` supersedes legacy `space`.
	assert.equal(resolveFrame({}, { frame: 'standard', space: 'game' }).id, 'standard', 'frame wins');

	// Custom frame resolves from doc.frames; its own sizes scale on its own curve.
	const overlay = { id: 'overlay', name: 'Overlay', kind: 'main', sizes: STANDARD };
	const doc = { frames: [overlay] };
	assert.deepEqual(resolveFrame(doc, { frame: 'overlay' }), overlay, 'custom frame resolves');
	assert.deepEqual(
		frameSizes(resolveFrame(doc, { frame: 'overlay' }), MAIN),
		STANDARD,
		'custom sizes win over mainSizesMap',
	);

	// Built-in ids are reserved — a doc.frames entry can't shadow `game`.
	const shadow = { frames: [{ id: 'game', name: 'Hijack', kind: 'main', sizes: STANDARD }] };
	assert.equal(resolveFrame(shadow, { space: 'game' }).sizes, undefined, 'game not shadowable');

	// Custom main frame with NO sizes inherits the doc's mainSizesMap (locked to game curve).
	const inherit = { frames: [{ id: 'twin', name: 'Twin', kind: 'main' }] };
	assert.deepEqual(
		frameSizes(resolveFrame(inherit, { frame: 'twin' }), MAIN),
		MAIN,
		'sizeless custom frame inherits mainSizesMap',
	);

	// Unknown id falls back to game (a dangling ref can't break render).
	assert.equal(resolveFrame({}, { frame: 'nope' }).id, 'game', 'unknown id ⇒ game fallback');

	console.log('✓ frames parity: resolveFrame reproduces the <LayoutScene> space switch');
} finally {
	rmSync(out, { force: true });
}
