// Generate the BUILTIN spine metadata registry from the reference game's coded
// spine bundles (`apps/lines/static/assets/spines/*`).
//
// Why this exists: the Scene Editor's Properties panel renders a `spineAnimation`
// / `spineSlot` / `spineBone` param as a DROPDOWN only when it can enumerate the
// referenced spine's animation / slot / bone NAMES. Those names come from R2
// (project spines) or a live canvas render. A builtin component's DEFAULT spine
// (`fsIntroNumber`, `bigwin`, …) is a CODED bundle shipped inside the game — it
// has no R2 presence and the editor can't render it, so every such field silently
// degraded to a free-text box (see EditorProperties `paramField`). This registry
// ships those coded bundles' names with the engine so the coded defaults get real
// pickers too, exactly like a custom project rig does.
//
//   node scripts/gen-builtin-spines.mjs          # (re)write the generated registry
//   node scripts/gen-builtin-spines.mjs --check  # exit 1 if the committed file is stale
//
// Automation: run by `pnpm --filter engine-layout build` (before `svelte-package`)
// and guarded by the pre-commit hook (`--check`) when a coded spine bundle is staged.
//
// No esbuild here (unlike gen-scene-sets): the bundle `index.ts` files import
// `.webp` / `.atlas?raw` / `pixi-svelte`, which Node can't load. We only need the
// spine NAME → skeleton-JSON mapping, so we parse the (well-formed, hand-written)
// `index.ts` with light regex and read the skeleton JSON directly.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The reference game whose coded bundles define the engine's spine-naming
// convention (the same source boundComponentCatalog references by name).
const SPINES_DIR = join(HERE, '..', '..', '..', 'apps', 'lines', 'static', 'assets', 'spines');
const OUT_FILE = join(HERE, '..', 'src', 'lib', 'builtinSpineMeta.generated.ts');
const check = process.argv.includes('--check');

/** Map every `import IDENT from './FILE.json'` in a bundle index → { IDENT: 'FILE.json' }. */
function parseJsonImports(source) {
	const out = {};
	const re = /import\s+(\w+)\s+from\s+'\.\/([^']+\.json)'/g;
	let m;
	while ((m = re.exec(source))) out[m[1]] = m[2];
	return out;
}

/** Spine NAME → skeleton JSON file for one bundle index. Two shapes:
 *  - single: `createAsset({ …, spine })`      → name = bundle FOLDER, file = `spine` import
 *  - multi:  `spines: { name: ident, … }`     → each key is the spine name (shorthand: name === ident) */
function parseBundle(folder, source) {
	const imports = parseJsonImports(source);
	const spinesBlock = source.match(/spines:\s*\{([\s\S]*?)\}/);
	if (spinesBlock) {
		const out = {};
		// Entries are `name: ident` or shorthand `name` (ident === name), comma- or
		// newline-separated. Split on commas so the FINAL entry (no trailing comma) is
		// captured too — a trailing-comma-only regex silently dropped it.
		for (const seg of spinesBlock[1].split(',')) {
			const m = seg.match(/^\s*(\w+)\s*(?::\s*(\w+))?\s*$/);
			if (!m) continue;
			const name = m[1];
			const ident = m[2] ?? m[1];
			if (imports[ident]) out[name] = imports[ident];
		}
		return out;
	}
	// Single-spine bundle: the `spine` prop's import, keyed by the folder name.
	if (/\bspine\b/.test(source.replace(/rawAtlas|spinesBlock/g, '')) && imports.spine) {
		return { [folder]: imports.spine };
	}
	return {};
}

/** Extract the dropdown NAME lists the editor needs from a Spine 4.x JSON skeleton. */
function metaFromSkeleton(json) {
	const named = (v) =>
		Array.isArray(v)
			? v.map((e) => e?.name).filter((n) => typeof n === 'string')
			: Object.keys(v ?? {});
	return {
		animations: Object.keys(json.animations ?? {}),
		skins: named(json.skins),
		slots: named(json.slots),
		bones: named(json.bones),
	};
}

async function build() {
	const registry = {};
	const folders = (await readdir(SPINES_DIR, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	for (const folder of folders) {
		const indexPath = join(SPINES_DIR, folder, 'index.ts');
		if (!existsSync(indexPath)) continue;
		const source = await readFile(indexPath, 'utf8');
		const nameToFile = parseBundle(folder, source);
		for (const [name, file] of Object.entries(nameToFile)) {
			const jsonPath = join(SPINES_DIR, folder, file);
			if (!existsSync(jsonPath)) continue;
			let json;
			try {
				json = JSON.parse(await readFile(jsonPath, 'utf8'));
			} catch {
				continue; // a binary .skel dressed as .json, or malformed — skip, never throw
			}
			registry[name] = metaFromSkeleton(json);
		}
	}
	return registry;
}

function render(registry) {
	// Sort keys for a stable diff; JSON.stringify with tabs matches Prettier's tab style.
	const sorted = Object.fromEntries(
		Object.keys(registry)
			.sort()
			.map((k) => [k, registry[k]]),
	);
	const body = JSON.stringify(sorted, null, '\t').replace(/\n/g, '\n\t');
	return (
		`// GENERATED by scripts/gen-builtin-spines.mjs — DO NOT EDIT BY HAND.\n` +
		`// Run \`pnpm --filter engine-layout gen:builtin-spines\` to refresh after a coded\n` +
		`// spine bundle changes. See the script header for why this exists.\n` +
		`import type { SpineBundleMeta } from './builtinSpineMeta';\n\n` +
		`export const BUILTIN_SPINE_META: Record<string, SpineBundleMeta> = ${body};\n`
	);
}

const registry = await build();
const next = render(registry);

if (check) {
	const current = existsSync(OUT_FILE) ? await readFile(OUT_FILE, 'utf8') : '';
	if (current.trim() !== next.trim()) {
		console.error('✗ builtinSpineMeta.generated.ts is STALE.');
		console.error('→ run `pnpm --filter engine-layout gen:builtin-spines` and commit it.');
		process.exit(1);
	}
	console.info('✓ builtin spine metadata is up to date.');
} else {
	await writeFile(OUT_FILE, next, 'utf8');
	console.info(`✓ wrote builtinSpineMeta.generated.ts (${Object.keys(registry).length} spines)`);
}
