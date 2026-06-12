// Freeze a project's editor LayoutDoc + its referenced ComponentDefs into a game
// repo at build time, so the shipped game renders the authored layout WITHOUT a
// runtime fetch and WITHOUT depending on the launcher being up — and so custom
// component defs (which otherwise live only in R2 and are never registered at
// game runtime) actually reach the bundle.
// See docs/design/live-assets.md → "Layout-doc bake (build-time freeze)".
//
// HTTP only: it talks to the launcher's `GET /api/editor/doc?...&components=1`
// (gated by the shared `EDITOR_DOC_SECRET` token) — NO R2 creds, no aws-sdk. A
// build runner only needs the token + network access to app.invisiblewall.org.
//
//   EDITOR_DOC_SECRET=... node apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project <projectKey> --dest <gameRepo>/src/baked-editor-bundle.json
//
// NOTE: --project is the BARE launcher project key (e.g. `bookofborut`), NOT
// `<client>/<project>`. /api/editor/doc DB-resolves the client from the key, so
// passing `borut/bookofborut` here resolves to no project and silently bails.
// (This differs from pull-project-assets.mjs / /api/deploy, which DO want
// `<client>/<project>`.) See scripts/new-game.mjs for the split.
//
// The written file is the SAME shape the game's editor-scenes.ts imports:
//   { doc: LayoutDoc, componentDefaults: {...}, componentDefs: { <id>: ComponentDef } }
// A non-null `doc` flips the game to the baked path (live fetch skipped); the
// checked-in placeholder has `doc: null`, so an un-baked repo keeps fetching live.
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   EDITOR_DOC_SECRET=... node <engine>/apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project bookofborut --dest ./src/baked-editor-bundle.json
//
//   # Preview without writing:
//   node <engine>/apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project bookofborut --dest ./src/baked-editor-bundle.json --token <t> --dry-run

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const DEFAULT_BASE = 'https://app.invisiblewall.org';

const USAGE =
	'Usage: node bake-editor-doc.mjs --project <projectKey> --dest <out.json> \\\n' +
	'         [--base <url>] [--token <t>] [--dry-run] [--optional]\n' +
	'\n' +
	'  --project <projectKey>        bare launcher project key, e.g. bookofborut\n' +
	'                                (NOT <client>/<project> — the client is\n' +
	'                                DB-resolved). Required.\n' +
	'  --dest <path>                 output JSON file to write (required)\n' +
	`  --base <url>                  launcher base (default ${DEFAULT_BASE})\n` +
	'  --token <t>                   shared read token; defaults to env\n' +
	'                                EDITOR_DOC_SECRET or LIVE_ASSETS_TOKEN\n' +
	'  --dry-run                     print a summary, write nothing\n' +
	'  --optional                    on missing token / unreachable endpoint / no doc,\n' +
	'                                warn loudly and keep the checked-in bundle (exit 0)\n' +
	'                                instead of failing the build';

if (args.length === 0 || hasFlag('help') || hasFlag('h')) {
	console.info(USAGE);
	process.exit(args.length === 0 ? 1 : 0);
}

const project = getFlag('project');
if (!project) {
	console.error(USAGE);
	console.error('Missing --project (the bare launcher project key, e.g. bookofborut).');
	process.exit(1);
}

const destArg = getFlag('dest');
if (!destArg) {
	console.error(USAGE);
	console.error(
		'Missing --dest (the game repo JSON file to write, e.g. src/baked-editor-bundle.json).',
	);
	process.exit(1);
}
const dest = isAbsolute(destArg) ? destArg : resolve(process.cwd(), destArg);

const base = (getFlag('base') || DEFAULT_BASE).replace(/\/+$/, '');
const token = getFlag('token') || process.env.EDITOR_DOC_SECRET || process.env.LIVE_ASSETS_TOKEN;
const dryRun = hasFlag('dry-run');
const optional = hasFlag('optional');

// In `--optional` mode a missing token / unreachable endpoint / no authored doc is
// not fatal: warn loudly and keep the checked-in bundle so the build proceeds.
// Otherwise it's a hard failure so CI never silently ships a stale/empty layout.
//
// We set `process.exitCode` and unwind rather than calling `process.exit()`: on
// Windows, calling process.exit() while undici (the global `fetch`) still has a
// socket closing trips a libuv assertion (`UV_HANDLE_CLOSING`, src/win/async.c)
// and crashes the process with exit 0xC0000409 (3221226505) — which would fail
// the build even in --optional mode. Letting the event loop drain avoids it.
class BakeBail {}
function bail(message) {
	if (optional) {
		console.warn(`⚠ bake-doc: ${message}`);
		console.warn('⚠ bake-doc: keeping checked-in bundle (--optional). Layout may be STALE.');
		process.exitCode = 0;
	} else {
		console.error(message);
		process.exitCode = 1;
	}
	throw new BakeBail();
}

async function bodySnippet(res) {
	try {
		return (await res.text()).slice(0, 300);
	} catch {
		return '';
	}
}

async function main() {
	if (!token) {
		if (!optional) console.error(USAGE);
		bail('Missing token — pass --token or set EDITOR_DOC_SECRET / LIVE_ASSETS_TOKEN in the env.');
	}

	const docUrl =
		`${base}/api/editor/doc?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}&components=1`;

	console.info(
		`Baking ${base}/api/editor/doc [${project}] → ${dest}${dryRun ? '  (dry run)' : ''}`,
	);

	let res;
	try {
		res = await fetch(docUrl);
	} catch (err) {
		bail(`Could not reach ${base}/api/editor/doc — ${err instanceof Error ? err.message : err}`);
	}
	if (!res.ok) {
		bail(`Doc fetch failed: HTTP ${res.status} — ${await bodySnippet(res)}`);
	}

	const data = await res.json();
	const doc = data?.doc;
	if (!doc || !Array.isArray(doc.scenes) || doc.scenes.length === 0) {
		bail(`no authored doc for ${project} — has the project been opened + saved in the editor?`);
	}

	// Export the art the doc references into R2 `deploy/editor-art/` (spritesheet
	// JSON + page per referenced atlas) so the deploy mirror that runs next in the
	// game build pulls it, and embed the index so the game registers the sheets.
	// This is what makes editor-placed sprites/images reach the shipped game
	// automatically — without it they render as empty textures.
	let editorArt = { sheets: [], images: [] };
	const artUrl =
		`${base}/api/editor/export-art?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the editor-art export — it writes to R2 deploy/.');
	} else
		try {
			const artRes = await fetch(artUrl, { method: 'POST' });
			if (!artRes.ok) {
				bail(`Editor-art export failed: HTTP ${artRes.status} — ${await bodySnippet(artRes)}`);
			}
			const art = await artRes.json();
			editorArt = {
				sheets: Array.isArray(art?.sheets) ? art.sheets : [],
				images: Array.isArray(art?.images) ? art.images : [],
			};
			// Loud (non-fatal) warning when two referenced sheets share a region name.
			// Rendering is correct (each sheet is scoped by its manifest), but it
			// usually means a superseded sheet is still referenced — name the overlap
			// so the author can retire the dead one.
			const collisions = Array.isArray(art?.collisions) ? art.collisions : [];
			for (const c of collisions) {
				console.warn(
					`⚠ bake-doc: region "${c.region}" exists in ${c.sheets.length} sheets ` +
						`(${c.sheets.join(', ')})${c.used ? ' — PLACED in the layout' : ''}. ` +
						'Scoped per manifest, so it renders correctly; retire the stale sheet if unused.',
				);
			}
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-art — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Export the project's fonts (Font Maker output) into R2 `deploy/editor-fonts/`
	// so the deploy mirror that runs next pulls them, and embed the catalog so the
	// game registers each bitmap font (pixi installs the `BitmapFont` under its
	// face) and routes its family to `<BitmapText>`. Without this a font made in
	// the Font Maker shows in the editor but is MISSING from the shipped game.
	let fonts = { catalog: { prefix: 'editor-fonts', fonts: [] } };
	const fontsUrl =
		`${base}/api/editor/export-fonts?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the font export — it writes to R2 deploy/.');
	} else
		try {
			const fontRes = await fetch(fontsUrl, { method: 'POST' });
			if (!fontRes.ok) {
				bail(`Font export failed: HTTP ${fontRes.status} — ${await bodySnippet(fontRes)}`);
			}
			const f = await fontRes.json();
			if (f?.catalog && Array.isArray(f.catalog.fonts)) fonts = { catalog: f.catalog };
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-fonts — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Localization-tool strings (reviewed translations + source text), merged into
	// the game's Lingui catalog at boot so editor-authored localization keys (e.g.
	// a textBox's `text` param) resolve in the shipped game. Absent/empty doc is
	// normal (not every project localizes) — never fatal, just an empty map.
	let localization = { sourceLang: 'en', messages: {} };
	if (!dryRun) {
		try {
			const locRes = await fetch(
				`${base}/api/localization/strings?project=${encodeURIComponent(project)}` +
					`&k=${encodeURIComponent(token)}`,
			);
			if (locRes.ok) {
				const loc = await locRes.json();
				localization = {
					sourceLang: typeof loc?.sourceLang === 'string' ? loc.sourceLang : 'en',
					messages: loc?.messages && typeof loc.messages === 'object' ? loc.messages : {},
				};
			} else {
				console.warn(
					`⚠ bake-doc: localization fetch HTTP ${locRes.status} — baking without strings.`,
				);
			}
		} catch (err) {
			console.warn(
				`⚠ bake-doc: localization fetch failed (${err instanceof Error ? err.message : err}) — baking without strings.`,
			);
		}
	}

	const bundle = {
		doc,
		componentDefaults: data.componentDefaults ?? {},
		componentDefs: data.componentDefs ?? {},
		editorArt,
		fonts,
		localization,
	};

	const sceneCount = doc.scenes.length;
	const defCount = Object.keys(bundle.componentDefs).length;
	const defaultCount = Object.keys(bundle.componentDefaults).length;
	const artCount = editorArt.sheets.length + editorArt.images.length;
	const fontCount = fonts.catalog.fonts.length;
	const localeCount = Object.keys(localization.messages).length;
	const json = `${JSON.stringify(bundle, null, '\t')}\n`;

	if (dryRun) {
		console.info(
			`\nWould write ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
				` (${sceneCount} scenes, ${defCount} component defs, ${defaultCount} default sets,` +
				` ${artCount} editor-art sheets, ${fontCount} fonts).`,
		);
		return;
	}

	await mkdir(dirname(dest), { recursive: true });
	await writeFile(dest, json);
	console.info(
		`\nBaked ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
			` (${sceneCount} scenes, ${defCount} component defs, ${defaultCount} default sets,` +
			` ${artCount} editor-art sheets, ${fontCount} fonts, ${localeCount} locales).`,
	);
}

try {
	await main();
} catch (err) {
	if (!(err instanceof BakeBail)) {
		console.error(err);
		process.exitCode = 1;
	}
}
