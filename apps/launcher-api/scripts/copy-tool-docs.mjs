// Mirror the in-repo tool guides (`docs/tools/*.md`, at the repo root — two
// levels above this app) into the app tree so Vite can `import.meta.glob` them
// at build time. The docs live OUTSIDE the app and would not otherwise survive
// the adapter-node server bundle (and reaching outside the app root trips
// Vite's `server.fs` boundary). Run before `build`/`dev` (see package.json).
//
// The destination (`src/lib/tool-docs/`) is generated + gitignored; the source
// of truth stays under the repo `docs/`. Any present-or-future `*.md` is copied
// verbatim — no per-doc wiring.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const srcDir = join(appRoot, '..', '..', 'docs', 'tools');
const destDir = join(appRoot, 'src', 'lib', 'tool-docs');

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });

let names = [];
try {
	names = (await readdir(srcDir)).filter((n) => n.toLowerCase().endsWith('.md'));
} catch {
	console.warn(`[copy-tool-docs] no docs found at ${srcDir} — skipping.`);
	process.exit(0);
}

for (const name of names) {
	await cp(join(srcDir, name), join(destDir, name));
}

console.log(`[copy-tool-docs] copied ${names.length} guide(s) → src/lib/tool-docs/`);
