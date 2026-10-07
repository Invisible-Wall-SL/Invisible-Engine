// Where every Rigger spike gets the rig runtime: `packages/engine-rig`, the one the games, the
// editor and the Rigger itself run (held to the 4.2-format reference by `tools/rig-parity`).
// esbuild bundles its TypeScript into a single ESM file per process, which the spike imports:
//
//   import { RIG_CORE } from './rig.mjs';
//   const { SkeletonJson, … } = await import(RIG_CORE);
//
// `rigPixi()` bundles the Pixi side (`engine-rig/pixi`) with `pixi.js` left external, and
// re-exports pixi's `Ticker` from that same import, so a spike's ticker is the one a `RigView` uses.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';

const RIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'engine-rig');
// Under the package's node_modules so a bundle importing `pixi.js` resolves the package's copy.
const OUT = join(RIG, 'node_modules', '.spike', String(process.pid));
mkdirSync(OUT, { recursive: true });
process.on('exit', () => rmSync(OUT, { recursive: true, force: true }));

const esbuild = await import(ESBUILD);

async function bundle(file, contents) {
	const outfile = join(OUT, file);
	const result = await esbuild.build({
		stdin: { contents, resolveDir: RIG, loader: 'ts', sourcefile: file },
		bundle: true,
		format: 'esm',
		platform: 'node',
		external: ['pixi.js'],
		keepNames: true,
		write: false,
		logLevel: 'error',
	});
	writeFileSync(outfile, result.outputFiles[0].text);
	return pathToFileURL(outfile).href;
}

/** The renderer-free runtime (`engine-rig`), as a file URL for `import()`. */
export const RIG_CORE = await bundle('rig-core.mjs', "export * from './index.ts';");

/** The Pixi runtime (`engine-rig/pixi`) plus pixi's `Ticker`, as a file URL for `import()`. */
export const rigPixi = () =>
	bundle('rig-pixi.mjs', "export * from './pixi.ts';\nexport { Ticker } from 'pixi.js';");
