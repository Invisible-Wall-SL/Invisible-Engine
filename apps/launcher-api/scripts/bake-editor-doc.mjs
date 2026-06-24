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
	'  --optional                    NO-token build only: warn + keep the checked-in\n' +
	'                                bundle (exit 0). WITH a token (a real publish) a\n' +
	'                                fetch/export/empty-doc error is still a HARD failure\n' +
	'                                — it never silently ships the default layout.';

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

// `--optional` stays lenient ONLY when there's NO token — that's the intended dev /
// no-credentials build, which keeps the checked-in `doc:null` placeholder and proceeds
// (the game fetches the doc live, or is a reference app). When a TOKEN is present we are
// doing a REAL PUBLISH: a missing/unreachable endpoint, a failed art/font/symbol export,
// or an empty doc is exactly what silently ships the DEFAULT layout (old graphics,
// nothing the author placed, broken symbol art). So in that case FAIL LOUDLY even with
// `--optional` — a failed publish the author simply re-runs beats a published game that
// fell back to defaults. This is the guard against the "publish silently shipped
// defaults" class.
//
// We set `process.exitCode` and unwind rather than calling `process.exit()`: on
// Windows, calling process.exit() while undici (the global `fetch`) still has a
// socket closing trips a libuv assertion (`UV_HANDLE_CLOSING`, src/win/async.c)
// and crashes the process with exit 0xC0000409 (3221226505) — which would fail
// the build even in --optional mode. Letting the event loop drain avoids it.
class BakeBail {}
function bail(message) {
	const lenient = optional && !token;
	if (lenient) {
		console.warn(`⚠ bake-doc: ${message}`);
		console.warn('⚠ bake-doc: no token + --optional → keeping the checked-in bundle (dev build).');
		process.exitCode = 0;
	} else {
		console.error(`✖ bake-doc: ${message}`);
		if (optional) {
			console.error(
				'✖ bake-doc: a token WAS provided, so this is a PUBLISH — refusing to ship the default ' +
					'layout. Fix the error above and re-publish. (Guard against silently shipping defaults; ' +
					'pass no token for a deliberate dev build that keeps the placeholder.)',
			);
		}
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Transient statuses worth retrying. A 5xx (esp. a 502 "upstream error") from the
// launcher's heavy export endpoints is usually the container being OOM-killed /
// restarted mid-export — the memory-heavy R2 export bursts (full atlas pages +
// spine bundles) can take the process down, and a single call on a recovered
// container reliably succeeds. 4xx (401/400) are deterministic — never retried.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
// Spaced to straddle a Railway container restart (seconds to ~30s), so each retry
// lands on a recovered process rather than hammering a still-dying one.
const RETRY_DELAYS_MS = [5000, 15000, 30000];

// fetch with retry-on-transient-failure. Export POSTs are idempotent (they prune +
// rewrite deploy/), so retrying is safe. Returns the final Response — including a
// non-retryable non-OK one, which the caller's `!res.ok` path then bails on. Throws
// only when every attempt was a network-level failure (no Response), so the caller's
// existing try/catch bails with the "could not reach" message.
async function fetchRetry(url, init, label) {
	let lastErr = '';
	let lastRes = null;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		if (attempt > 0) {
			const delay = RETRY_DELAYS_MS[attempt - 1];
			console.warn(
				`⚠ bake-doc: ${label} — ${lastErr}; retrying in ${delay / 1000}s ` +
					`(attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})…`,
			);
			await sleep(delay);
		}
		try {
			const res = await fetch(url, init);
			if (res.ok || !RETRY_STATUSES.has(res.status)) return res;
			lastRes = res;
			lastErr = `HTTP ${res.status} — ${await bodySnippet(res)}`;
		} catch (err) {
			lastRes = null;
			lastErr = err instanceof Error ? err.message : String(err);
		}
	}
	if (lastRes) return lastRes;
	throw new Error(lastErr);
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
		res = await fetchRetry(docUrl, undefined, 'doc fetch');
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
	let editorArt = { sheets: [], images: [], spines: [] };
	const artUrl =
		`${base}/api/editor/export-art?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the editor-art export — it writes to R2 deploy/.');
	} else
		try {
			const artRes = await fetchRetry(artUrl, { method: 'POST' }, 'editor-art export');
			if (!artRes.ok) {
				bail(`Editor-art export failed: HTTP ${artRes.status} — ${await bodySnippet(artRes)}`);
			}
			const art = await artRes.json();
			editorArt = {
				sheets: Array.isArray(art?.sheets) ? art.sheets : [],
				images: Array.isArray(art?.images) ? art.images : [],
				spines: Array.isArray(art?.spines) ? art.spines : [],
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
			const fontRes = await fetchRetry(fontsUrl, { method: 'POST' }, 'font export');
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

	// Export the symbol→state asset bindings (Invisible Symbols State Machine) into
	// R2 `deploy/editor-symbols/` (sprite sheets keyed by their own frame names +
	// verbatim spine bundles) so the deploy mirror that runs next pulls them, and
	// embed the returned `{ map, index }` so the game merges the binding overrides
	// over its coded `SYMBOL_INFO_MAP` and registers the introduced assets. Without
	// this a rebound symbol shows in the tool preview but ships its old asset.
	let symbols = {
		map: {},
		index: { sheets: [], images: [], spines: [], collisions: [] },
		highlight: undefined,
		winLine: undefined,
	};
	const symbolsUrl =
		`${base}/api/editor/export-symbols?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the symbols export — it writes to R2 deploy/.');
	} else
		try {
			const symRes = await fetchRetry(symbolsUrl, { method: 'POST' }, 'symbols export');
			if (!symRes.ok) {
				bail(`Symbols export failed: HTTP ${symRes.status} — ${await bodySnippet(symRes)}`);
			}
			const s = await symRes.json();
			// The global win-frame highlight override (absent → game keeps its built-in
			// payframe). `assetKey` is the full R2 spine-bundle prefix, whose bundle is
			// already in `index.spines` (the exporter added it), so the game loads it the
			// same way as a per-symbol spine.
			const highlight =
				s?.highlight && typeof s.highlight === 'object' && typeof s.highlight.assetKey === 'string'
					? {
							assetKey: s.highlight.assetKey,
							...(typeof s.highlight.animationName === 'string'
								? { animationName: s.highlight.animationName }
								: {}),
						}
					: undefined;
			// The global win-line config — pure config (no asset): on/off + line + text
			// style. The exporter already forwards it sparse (only authored, non-default
			// fields), so embed it verbatim, keeping it sparse so an untouched project ships
			// no `winLine` and renders byte-identical. The game applies coded defaults for
			// every field the bundle omits.
			const winLine = (() => {
				const w = s?.winLine;
				if (!w || typeof w !== 'object') return undefined;
				const out = {};
				if (w.enabled === false) out.enabled = false;
				if (w.line && typeof w.line === 'object' && Object.keys(w.line).length) out.line = w.line;
				if (w.text && typeof w.text === 'object' && Object.keys(w.text).length) out.text = w.text;
				return Object.keys(out).length ? out : undefined;
			})();
			symbols = {
				map: s?.map && typeof s.map === 'object' ? s.map : {},
				index: {
					sheets: Array.isArray(s?.index?.sheets) ? s.index.sheets : [],
					images: Array.isArray(s?.index?.images) ? s.index.images : [],
					spines: Array.isArray(s?.index?.spines) ? s.index.spines : [],
					collisions: Array.isArray(s?.index?.collisions) ? s.index.collisions : [],
				},
				highlight,
				winLine,
			};
			// Loud (non-fatal) warning when a bound frame name lives in two sheets.
			// Symbol sheet frames register with NO namespace, so a colliding name is
			// ambiguous (last-loaded wins) — name the overlap so the author can retire
			// the stale sheet or rename the frame.
			for (const c of symbols.index.collisions) {
				console.warn(
					`⚠ bake-doc: symbol frame "${c.frame}" exists in ${c.sheets.length} sheets ` +
						`(${c.sheets.join(', ')}). Symbol frames are un-namespaced, so this is ` +
						'AMBIGUOUS — rename the frame or retire the stale sheet.',
				);
			}
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-symbols — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Export the project's Invisible Flow document (the authored presentation graph)
	// into R2 `deploy/flow.json` and embed the returned doc so the game's interpreter
	// runs the authored flow instead of its coded mounting + bookEventHandlerMap. The
	// FlowDoc carries NO binary assets (it references scenes the editor already
	// exported), so there is no deploy mirror for it — just the embedded doc. Absent /
	// un-authored ⇒ `flow` stays undefined ⇒ the interpreter is inert ⇒ the coded path
	// runs, byte-identical to today (design doc §7 fall-through, §10 pipeline).
	let flow;
	const flowUrl =
		`${base}/api/editor/export-flow?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the flow export — it writes to R2 deploy/.');
	} else
		try {
			const flowRes = await fetchRetry(flowUrl, { method: 'POST' }, 'flow export');
			if (!flowRes.ok) {
				bail(`Flow export failed: HTTP ${flowRes.status} — ${await bodySnippet(flowRes)}`);
			}
			const f = await flowRes.json();
			// Only embed an authored flow (≥1 screen or ≥1 event choreography). An un-
			// authored doc — including a transitions-only doc, whose edges reference screens
			// that don't exist ⇒ the interpreter is inert — leaves `flow` undefined so the
			// bundle omits it and the game stays byte-identical to current `main` (parity, §7).
			// Hand-rolled copy of engine-flow's `isAuthoredFlow` (this script can't import TS);
			// it MUST stay in sync — transitions deliberately excluded.
			const fd = f?.flow;
			const authored =
				fd &&
				typeof fd === 'object' &&
				((Array.isArray(fd.screens) && fd.screens.length > 0) ||
					(Array.isArray(fd.events) && fd.events.length > 0));
			if (authored) flow = fd;
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-flow — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Localization-tool strings (reviewed translations + source text), merged into
	// the game's Lingui catalog at boot so editor-authored localization keys (e.g.
	// a textBox's `text` param) resolve in the shipped game. Absent/empty doc is
	// normal (not every project localizes) — never fatal, just an empty map.
	let localization = { sourceLang: 'en', messages: {} };
	if (!dryRun) {
		try {
			const locRes = await fetchRetry(
				`${base}/api/localization/strings?project=${encodeURIComponent(project)}` +
					`&k=${encodeURIComponent(token)}`,
				undefined,
				'localization fetch',
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
		// Exact pinned non-latest ComponentDefs (§8.9 v2): the game registers these
		// before componentDefs so a pinned instance renders its authored version.
		// Omitted by the endpoint (and absent here) when no instance pins a non-latest
		// version, keeping the baked bundle byte-identical for unpinned games (parity).
		...(Array.isArray(data.componentVersions) && data.componentVersions.length
			? { componentVersions: data.componentVersions }
			: {}),
		editorArt,
		fonts,
		localization,
		symbols,
		// The authored presentation graph (Invisible Flow). Omitted unless the project
		// authored a non-empty flow, keeping the bundle byte-identical for every game
		// with no flow work — the §7 fall-through (absent ⇒ interpreter inert).
		...(flow ? { flow } : {}),
	};

	const sceneCount = doc.scenes.length;
	const defCount = Object.keys(bundle.componentDefs).length;
	const pinnedVersionCount = bundle.componentVersions?.length ?? 0;
	const pinnedNote = pinnedVersionCount ? ` (+${pinnedVersionCount} pinned versions)` : '';
	const defaultCount = Object.keys(bundle.componentDefaults).length;
	const artCount = editorArt.sheets.length + editorArt.images.length;
	const fontCount = fonts.catalog.fonts.length;
	const localeCount = Object.keys(localization.messages).length;
	const symbolCount = Object.keys(symbols.map).length;
	const symbolAssetCount =
		symbols.index.sheets.length + symbols.index.images.length + symbols.index.spines.length;
	const flowNote = flow
		? ` flow={${flow.screens?.length ?? 0} screens/${flow.transitions?.length ?? 0} transitions/${flow.events?.length ?? 0} events},`
		: '';
	const highlightNote = symbols.highlight
		? ` highlight=${symbols.highlight.assetKey}/${symbols.highlight.animationName ?? '(first)'},`
		: '';
	const winLineNote = symbols.winLine
		? symbols.winLine.enabled === false
			? ' winLines=OFF,'
			: ' winLines=styled,'
		: '';
	// `doc.settings` rides the bundle verbatim (embedded in `doc`); log it so a bake
	// surfaces the shipped jurisdiction / speed-feature toggles.
	const settingsNote = doc.settings
		? ` settings={${doc.settings.jurisdiction ?? 'default'}` +
			(doc.settings.features
				? `,features=${Object.entries(doc.settings.features)
						.map(([k, v]) => `${k}:${v ? 'on' : 'off'}`)
						.join('/')}`
				: '') +
			'},'
		: '';
	const json = `${JSON.stringify(bundle, null, '\t')}\n`;

	if (dryRun) {
		console.info(
			`\nWould write ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
				` (${sceneCount} scenes, ${defCount} component defs${pinnedNote}, ${defaultCount} default sets,` +
				` ${artCount} editor-art sheets, ${fontCount} fonts,` +
				`${highlightNote}${winLineNote}${settingsNote}${flowNote} ${symbolCount} symbol overrides / ${symbolAssetCount} symbol assets).`,
		);
		return;
	}

	await mkdir(dirname(dest), { recursive: true });
	await writeFile(dest, json);
	console.info(
		`\nBaked ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
			` (${sceneCount} scenes, ${defCount} component defs${pinnedNote}, ${defaultCount} default sets,` +
			` ${artCount} editor-art sheets, ${fontCount} fonts, ${localeCount} locales,` +
			`${highlightNote}${winLineNote}${settingsNote}${flowNote} ${symbolCount} symbol overrides / ${symbolAssetCount} symbol assets).`,
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
