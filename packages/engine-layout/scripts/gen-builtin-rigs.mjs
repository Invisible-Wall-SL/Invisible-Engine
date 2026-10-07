// Generate the BUILTIN rig metadata registry from the reference game's coded
// rig bundles (`apps/lines/static/assets/spines/*`).
//
// Why this exists: the Scene Editor's Properties panel renders a `spineAnimation`
// / `spineSlot` / `spineBone` param as a DROPDOWN only when it can enumerate the
// referenced rig's animation / slot / bone NAMES. Those names come from R2
// (project rigs) or a live canvas render. A builtin component's DEFAULT rig
// (`fsIntroNumber`, `bigwin`, …) is a CODED bundle shipped inside the game — it
// has no R2 presence and the editor can't render it, so every such field silently
// degraded to a free-text box (see EditorProperties `paramField`). This registry
// ships those coded bundles' names with the engine so the coded defaults get real
// pickers too, exactly like a custom project rig does.
//
//   node scripts/gen-builtin-rigs.mjs          # (re)write the generated registry
//   node scripts/gen-builtin-rigs.mjs --check  # exit 1 if the committed file is stale
//
// Automation: run by `pnpm --filter engine-layout build` (before `svelte-package`)
// and guarded by the pre-commit hook (`--check`) when a coded rig bundle is staged.
//
// No esbuild here (unlike gen-scene-sets): the bundle `index.ts` files import
// `.webp` / `.atlas?raw` / `pixi-svelte`, which Node can't load. We only need the
// rig NAME → skeleton-JSON mapping, so we parse the (well-formed, hand-written)
// `index.ts` with light regex and read the skeleton JSON directly.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The reference game whose coded bundles define the engine's rig-naming
// convention (the same source boundComponentCatalog references by name).
const RIGS_DIR = join(HERE, '..', '..', '..', 'apps', 'lines', 'static', 'assets', 'spines');
const OUT_FILE = join(HERE, '..', 'src', 'lib', 'builtinRigMeta.generated.ts');
const check = process.argv.includes('--check');

/** Map every `import IDENT from './FILE.json'` in a bundle index → { IDENT: 'FILE.json' }. */
function parseJsonImports(source) {
	const out = {};
	const re = /import\s+(\w+)\s+from\s+'\.\/([^']+\.json)'/g;
	let m;
	while ((m = re.exec(source))) out[m[1]] = m[2];
	return out;
}

/** Rig NAME → skeleton JSON file for one bundle index. Two shapes:
 *  - single: `createAsset({ …, spine })`    → name = bundle FOLDER, file = `spine` import
 *  - multi:  `spines: { name: ident, … }`   → each key is the rig name (shorthand: name === ident) */
function parseBundle(folder, source) {
	const imports = parseJsonImports(source);
	const rigsBlock = source.match(/spines:\s*\{([\s\S]*?)\}/);
	if (rigsBlock) {
		const out = {};
		// Entries are `name: ident` or shorthand `name` (ident === name), comma- or
		// newline-separated. Split on commas so the FINAL entry (no trailing comma) is
		// captured too — a trailing-comma-only regex silently dropped it.
		for (const seg of rigsBlock[1].split(',')) {
			const m = seg.match(/^\s*(\w+)\s*(?::\s*(\w+))?\s*$/);
			if (!m) continue;
			const name = m[1];
			const ident = m[2] ?? m[1];
			if (imports[ident]) out[name] = imports[ident];
		}
		return out;
	}
	// Single-rig bundle: the `spine` prop's import, keyed by the folder name.
	if (/\bspine\b/.test(source.replace(/rawAtlas|rigsBlock/g, '')) && imports.spine) {
		return { [folder]: imports.spine };
	}
	return {};
}

/** Extract the dropdown NAME lists the editor needs from a 4.x-format JSON skeleton. */
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
	const folders = (await readdir(RIGS_DIR, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	for (const folder of folders) {
		const indexPath = join(RIGS_DIR, folder, 'index.ts');
		if (!existsSync(indexPath)) continue;
		const source = await readFile(indexPath, 'utf8');
		const nameToFile = parseBundle(folder, source);
		for (const [name, file] of Object.entries(nameToFile)) {
			const jsonPath = join(RIGS_DIR, folder, file);
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
		`// GENERATED by scripts/gen-builtin-rigs.mjs — DO NOT EDIT BY HAND.\n` +
		`// Run \`pnpm --filter engine-layout gen:builtin-rigs\` to refresh after a coded\n` +
		`// rig bundle changes. See the script header for why this exists.\n` +
		`import type { RigBundleMeta } from './builtinRigMeta';\n\n` +
		`export const BUILTIN_RIG_META: Record<string, RigBundleMeta> = ${body};\n`
	);
}

const registry = await build();
const next = render(registry);

if (check) {
	const current = existsSync(OUT_FILE) ? await readFile(OUT_FILE, 'utf8') : '';
	if (current.trim() !== next.trim()) {
		console.error('✗ builtinRigMeta.generated.ts is STALE.');
		console.error('→ run `pnpm --filter engine-layout gen:builtin-rigs` and commit it.');
		process.exit(1);
	}
	console.info('✓ builtin rig metadata is up to date.');
} else {
	await writeFile(OUT_FILE, next, 'utf8');
	console.info(`✓ wrote builtinRigMeta.generated.ts (${Object.keys(registry).length} rigs)`);
}
