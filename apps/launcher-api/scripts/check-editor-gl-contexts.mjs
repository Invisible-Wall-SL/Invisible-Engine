/**
 * Guard that nothing in the Scene Editor creates a WebGL context of its own.
 *
 * Run: `pnpm --filter launcher-api run check:editor-gl-contexts`
 *
 * WHY. The editor mounts a rig, a text and an FX overlay per screen, per depth segment and per
 * blend group, on both sides. With a context each, an ordinary project passed the browser's ~16
 * live contexts; the browser drops the oldest, and Chrome paints a dropped context's canvas opaque
 * white — the background and board screens vanished under a white sheet. Every overlay now draws
 * through the two shared contexts in `sharedGl.client.ts` and copies into a 2D canvas of its own.
 *
 * Fails on any other `.svelte` / `.ts` file under the editor route that opens a WebGL context or a
 * Pixi renderer, and on an overlay that stops drawing through the shared module.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const editorDir = join(appRoot, 'src/routes/(app)/editor');
const SHARED = 'sharedGl.client.ts';
const OVERLAYS = ['EditorRigLayer.svelte', 'EditorTextLayer.svelte', 'EditorEffectLayer.svelte'];

const OPENS_CONTEXT = [
	/getContext\(\s*['"`](?:webgl2?|experimental-webgl)['"`]/,
	/\bnew\s+Application\s*\(/,
	/\bautoDetectRenderer\s*\(/,
	/\bnew\s+(?:WebGL|WebGPU)Renderer\s*\(/,
];

function* sourceFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (/\.(svelte|ts)$/.test(entry.name)) yield path;
	}
}

const failures = [];
let sharedOpens = 0;
for (const file of sourceFiles(editorDir)) {
	const name = relative(editorDir, file);
	const lines = readFileSync(file, 'utf8').split(/\r?\n/);
	lines.forEach((text, i) => {
		if (!OPENS_CONTEXT.some((re) => re.test(text))) return;
		if (name === SHARED) sharedOpens++;
		else failures.push(`${name}:${i + 1} opens its own context: ${text.trim()}`);
	});
}
if (sharedOpens < 2) failures.push(`${SHARED} no longer opens the two shared contexts`);
for (const overlay of OVERLAYS) {
	const source = readFileSync(join(editorDir, overlay), 'utf8');
	if (!source.includes(`from './${SHARED.replace(/\.ts$/, '')}'`)) {
		failures.push(`${overlay} no longer draws through ${SHARED}`);
	}
}

if (failures.length > 0) {
	console.error('Scene Editor WebGL contexts:\n  ' + failures.join('\n  '));
	console.error(
		'\nDraw through sharedGl.client.ts (acquireRigGl / createPixiSurface): a context per overlay ' +
			'passes the browser cap and blanks the editor white.',
	);
	process.exit(1);
}
console.log(
	`✓ the Scene Editor's overlays draw through ${SHARED} — no other file opens a WebGL context`,
);
