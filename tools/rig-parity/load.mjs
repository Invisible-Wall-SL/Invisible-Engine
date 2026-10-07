// Loads the Invisible rig runtime (packages/engine-rig, TypeScript) for node: esbuild bundles it to
// one ESM file under the OS temp dir, which is then imported.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from '../rigger-spike/esbuild.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadRig(entry = 'packages/engine-rig/index.ts') {
	const esbuild = await import(ESBUILD);
	const out = await esbuild.build({
		entryPoints: [join(ROOT, entry)],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		write: false,
		logLevel: 'silent',
	});
	const dir = mkdtempSync(join(tmpdir(), 'engine-rig-'));
	const file = join(dir, 'engine-rig.mjs');
	writeFileSync(file, out.outputFiles[0].text);
	return import(pathToFileURL(file).href);
}

export { ROOT };
