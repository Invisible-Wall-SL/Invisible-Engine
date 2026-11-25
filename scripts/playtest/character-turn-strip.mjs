// LOOKS at the smooth turn of a character sheet (`view.turn`, docs/design/character-pipeline.md
// §13): the game's own animator and looks draw a bear-like, eight-facing rig (one animation a
// facing, each with its own parts, as the published Salmons bear has) walking a slow circle and
// turning about, and every frame around each change of picture is painted into one strip.
//
// A case with a `sweep` draws one cell a heading instead and prints the lean drawn at each against
// sample B's (`frac × most`, docs/design/character-pipeline.md §13).
//
// It CHECKS NOTHING: a gate cannot say whether a turn looks right. Open the strips and look, before
// and after any change to the turn. That is the lesson of PR 1891, which passed 53 checks on boxes
// of one colour and tipped the owner's bear over.
//
//   node scripts/playtest/character-turn-strip.mjs --out <dir> [--chrome <exe>]
//
// Writes one PNG a case into <dir> (do not commit them) and prints each change it drew.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const arg = (name) => {
	const i = args.indexOf(name);
	return i < 0 ? undefined : args[i + 1];
};
const out = arg('--out');
if (!out) throw new Error('usage: character-turn-strip.mjs --out <dir> [--chrome <exe>]');
mkdirSync(out, { recursive: true });

const layout = createRequire(join(here, '../../packages/engine-layout/package.json'));
const { build } = layout('esbuild');
const bundle = await build({
	entryPoints: [join(here, 'character-turn-strip/page.ts')],
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'browser',
	absWorkingDir: join(here, '../../packages/engine-layout'),
	nodePaths: [join(here, '../../packages/engine-layout/node_modules')],
	alias: { 'pixi-svelte': join(here, 'character-turn-strip/pixiSvelteStub.ts') },
	logLevel: 'error',
});

/** The cases looked at: the owner's bear as saved, and each thing the option can be set to. */
const CASES = (await import('./character-turn-strip/cases.mjs')).default;

const { chromium } = createRequire(import.meta.url)('playwright');
const chrome = arg('--chrome');
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
try {
	for (const [name, request] of Object.entries(CASES)) {
		const page = await browser.newPage({
			viewport: { width: 1460, height: 900 },
			deviceScaleFactor: 2,
		});
		page.on('pageerror', (error) => console.error(`[${name}]`, error.message));
		page.on('console', (m) => m.type() === 'error' && console.error(`[${name}]`, m.text()));
		await page.setContent('<!doctype html><body style="margin:0;background:#222"></body>');
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const drawn = await page.evaluate((r) => window.strip(r), request);
		await page.locator('#strip').screenshot({ path: join(out, `${name}.png`) });
		console.log(`${name}: ${drawn.cells} frames\n  ${drawn.events.join('\n  ')}`);
		if (drawn.sweep) {
			// Sample B's tilt at each heading: `frac × most`, frac the heading's share of the half
			// sector from the facing nearest it (the switch at the halfway point).
			const most = request.view.turn?.lean ?? 8;
			let worst = 0;
			for (const cell of drawn.sweep) {
				const step = Math.round(cell.heading / 45);
				const want = ((cell.heading - step * 45) / 22.5) * most;
				const lean = (cell.lean * 180) / Math.PI;
				worst = Math.max(worst, Math.abs(lean - want));
				console.log(
					`  ${String(cell.heading).padStart(5)}° ${cell.facing.padEnd(2)}${cell.flipX ? ' mirrored' : '         '} drawn ${lean.toFixed(3)}°  sample ${want.toFixed(3)}°`,
				);
			}
			console.log(`  worst difference from the sample: ${worst.toFixed(4)}°`);
		}
		await page.close();
	}
} finally {
	await browser.close();
}
