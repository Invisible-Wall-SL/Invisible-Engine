// Generate the canonical editor scene-set JSON from the TS reference layouts.
//
// This is the SINGLE SOURCE the per-project seed
// (`apps/launcher-api/scripts/seed-game-editor.mjs`) reads, so the scene set
// can't drift between the TS generators (`referenceLayouts/*`, consumed by the
// editor + the game fallback) and the seed (consumed by R2). Previously the
// seed hand-duplicated the scene list + an inlined `hudScenes()` copy, which is
// exactly what drifted (missing `loading` scene, mismatched `space:'canvas'`).
//
//   node scripts/gen-scene-sets.mjs            # (re)write scenes/<gameType>.json
//   node scripts/gen-scene-sets.mjs --check    # exit 1 if a committed JSON is stale
//
// Automation (so it's never forgotten): run by `pnpm --filter engine-layout build`
// (before `svelte-package`) AND guarded by the repo pre-commit hook (`--check`)
// whenever a reference/template/seed file is staged.
//
// Why esbuild: the monorepo consumes packages as raw TS source (no dist), and
// there's no runtime TS loader, so plain Node can't `import` the generators.
// esbuild (a build-time devDep, already in the tree via Vite) bundles the
// pure-data reference graph — which has NO `.svelte` imports — into one ESM file
// Node can execute. Deterministic: the generators use fixed `updatedAt` literals.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES_DIR = join(HERE, '..', 'scenes');
const check = process.argv.includes('--check');

// Bundle the reference-layout generators (pure data, no `.svelte`) so Node can
// call them. `resolveDir` = this scripts dir, so the relative import + the
// workspace `constants-shared` import both resolve through normal Node resolution.
const bundled = await esbuild.build({
	stdin: {
		contents: `export { bookofReferenceLayout } from '../src/lib/referenceLayouts/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'gen-scene-sets.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `engine-layout-scenes-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

/** gameType key (the seed's `scenes/<key>.json`) → the `LayoutDoc` it consumes. */
const SETS = {
	bookof: () => mod.bookofReferenceLayout(),
};

let stale = false;
for (const [name, build] of Object.entries(SETS)) {
	const doc = build();
	const file = join(SCENES_DIR, `${name}.json`);
	if (check) {
		// Structural compare (parse both, re-stringify compact) so it's robust to
		// whitespace / Prettier reformatting of the committed file.
		const current = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
		if (JSON.stringify(current) !== JSON.stringify(doc)) {
			console.error(`✗ scenes/${name}.json is STALE.`);
			stale = true;
		}
	} else {
		await mkdir(SCENES_DIR, { recursive: true });
		await writeFile(file, JSON.stringify(doc, null, '\t') + '\n', 'utf8');
		console.info(`✓ wrote scenes/${name}.json (${doc.scenes.length} scenes)`);
	}
}

if (check) {
	if (stale) {
		console.error('→ run `pnpm --filter engine-layout gen:scenes` and commit packages/engine-layout/scenes.');
		process.exit(1);
	}
	console.info('✓ scene-set JSON is up to date.');
}
