// Publish a game's coded `SYMBOL_INFO_MAP` to R2 at build time, so the Invisible
// Symbols State Machine tool drives its grid from THIS project's symbol set
// instead of the committed `lines.json` fallback. The deploy-token-gated
// `PUT /api/editor/symbol-defaults` stores it at `symbols/defaults.json` in R2;
// the tool's `+page.server.ts` reads it per-project (falling back to the coded
// `lines` set when un-published). Mirrors bake-editor-doc.mjs's transport.
//
// The published set is filtered to the symbols the game actually PLAYS: a symbol
// must be in the `symbols` dictionary AND appear on the `paddingReels` strips.
// `SYMBOL_INFO_MAP` holds visual defaults for every symbol the engine *can*
// render (e.g. an unused H5); the dictionary alone is not enough either, since it
// legitimately describes symbols a given game never deals (the Stake sample's `W`
// wild, which no RGS here emits). The STRIPS are what reaches the board, so the
// tool grid mirrors the built game. Disable with --no-config-filter.
//
// The gate reads the AUTHORED game config (Invisible Game Config) when the project
// has one — fetched from `GET /api/game-config/doc`, the same doc the game runs —
// so the grid mirrors what actually ships, not the compiled template. It falls
// back to the local compiled module (`--config`, default ./src/game/config.ts)
// when the project has authored no config, or the launcher can't be reached, or no
// token is available (dry runs). Same shape either way, so one gate, two sources.
// See docs/design/invisible-symbols-state-machine.md + invisible-game-config.md.
//
// HTTP only: no R2 creds, no aws-sdk. A build runner needs the shared token +
// network access to app.invisiblewall.org.
//
//   EDITOR_DOC_SECRET=... node --experimental-strip-types \
//     <engine>/apps/launcher-api/scripts/publish-symbol-defaults.mjs \
//     --project <projectKey> [--symbols ./src/game/constants.ts]
//
// NOTE: --project is the BARE launcher project key (e.g. `bookofborut`), NOT
// `<client>/<project>` — the endpoint DB-resolves the client from the key (same
// as bake-editor-doc.mjs / /api/editor/doc).
//
// The symbol-map module is TypeScript with computed numeric expressions (e.g.
// `0.5 * 0.9`), so it must be imported under Node type-stripping: invoke with
// `node --experimental-strip-types`. This script assumes that flag is present
// and `import()`s the module directly.
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   EDITOR_DOC_SECRET=... node --experimental-strip-types \
//     ./engine/apps/launcher-api/scripts/publish-symbol-defaults.mjs --project bookofborut
//
//   # Preview without posting (resolves + prints the doc):
//   node --experimental-strip-types \
//     ./engine/apps/launcher-api/scripts/publish-symbol-defaults.mjs \
//     --project bookofborut --token <t> --dry-run

import { register } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve TypeScript-style relative imports that Node's ESM resolver leaves
// unresolved. A game's `constants.ts` (the symbol map we import below) routinely
// pulls in siblings with NO file extension — `import config from './config'` —
// or with a `.js` extension that actually points at a `.ts` source. Node's
// type-stripping runs the file but does NOT rewrite those specifiers, so the
// import throws `ERR_MODULE_NOT_FOUND` and the whole publish bails (silently,
// under --optional → the tool grid keeps a STALE published set forever). This
// hook retries a failed RELATIVE resolution against the on-disk `.ts` sibling so
// any standard game module graph imports cleanly. Self-contained configs (e.g.
// apps/lines) never hit it — it only fires on a resolution failure.
register(
	'data:text/javascript,' +
		encodeURIComponent(`
		import { existsSync } from 'node:fs';
		import { fileURLToPath } from 'node:url';
		const APPEND = ['.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx'];
		const SWAP = { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts', '.jsx': '.tsx' };
		const onDisk = (spec, parentURL) => {
			try { return existsSync(fileURLToPath(new URL(spec, parentURL))); }
			catch { return false; }
		};
		export async function resolve(spec, ctx, next) {
			try { return await next(spec, ctx); }
			catch (err) {
				const rel = spec.startsWith('./') || spec.startsWith('../');
				if (!rel || !ctx.parentURL) throw err;
				const dot = spec.lastIndexOf('.');
				const ext = dot > spec.lastIndexOf('/') ? spec.slice(dot) : '';
				const candidates = ext in SWAP
					? [spec.slice(0, dot) + SWAP[ext]]
					: APPEND.map((e) => spec + e);
				for (const cand of candidates) {
					if (onDisk(cand, ctx.parentURL)) return next(cand, ctx);
				}
				throw err;
			}
		}
	`),
	import.meta.url,
);

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const DEFAULT_BASE = 'https://app.invisiblewall.org';
const DEFAULT_SYMBOLS = './src/game/constants.ts';
const DEFAULT_EXPORT = 'SYMBOL_INFO_MAP';
const DEFAULT_CONFIG = './src/game/config.ts';

const USAGE =
	'Usage: node --experimental-strip-types publish-symbol-defaults.mjs --project <projectKey> \\\n' +
	'         [--symbols <path>] [--export <name>] [--config <path>] [--game-type <type>] \\\n' +
	'         [--base <url>] [--token <t>] [--dry-run] [--optional]\n' +
	'\n' +
	'  --project <projectKey>        bare launcher project key, e.g. bookofborut\n' +
	'                                (NOT <client>/<project>). Required.\n' +
	`  --symbols <path>              the game's symbol-map module (default ${DEFAULT_SYMBOLS})\n` +
	'  --assets <path>               the game asset registry for spine previewKeys\n' +
	'                                (default ./src/game/assets.ts)\n' +
	`  --export <name>               named export to read (default ${DEFAULT_EXPORT})\n` +
	`  --config <path>               FALLBACK game config module, used only when the\n` +
	`                                project has authored no config in the launcher;\n` +
	`                                its \`symbols\`/\`paddingReels\` gate the in-play set\n` +
	`                                (default ${DEFAULT_CONFIG})\n` +
	'  --no-config-filter            publish every symbol in the map, unfiltered\n' +
	'  --game-type <type>            informational gameType to stamp (default the project key)\n' +
	`  --base <url>                  launcher base (default ${DEFAULT_BASE})\n` +
	'  --token <t>                   shared deploy token; defaults to env\n' +
	'                                EDITOR_DOC_SECRET or LIVE_ASSETS_TOKEN\n' +
	'  --dry-run                     print the resolved doc, post nothing\n' +
	'  --optional                    on missing module / token / unreachable endpoint,\n' +
	'                                warn loudly and exit 0 (keep the build green)';

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

const symbolsArg = getFlag('symbols') || DEFAULT_SYMBOLS;
const symbolsPath = isAbsolute(symbolsArg) ? symbolsArg : resolve(process.cwd(), symbolsArg);
const assetsArg = getFlag('assets') || './src/game/assets.ts';
const assetsPath = isAbsolute(assetsArg) ? assetsArg : resolve(process.cwd(), assetsArg);
const configArg = getFlag('config') || DEFAULT_CONFIG;
const configPath = isAbsolute(configArg) ? configArg : resolve(process.cwd(), configArg);
const configFilter = !hasFlag('no-config-filter');
const exportName = getFlag('export') || DEFAULT_EXPORT;
const gameType = getFlag('game-type') || project;
const base = (getFlag('base') || DEFAULT_BASE).replace(/\/+$/, '');
const token = getFlag('token') || process.env.EDITOR_DOC_SECRET || process.env.LIVE_ASSETS_TOKEN;
const dryRun = hasFlag('dry-run');
const optional = hasFlag('optional');

// In `--optional` mode a missing module / token / unreachable endpoint is not
// fatal: warn loudly and exit 0 so a game build stays green (matching the other
// build steps). Otherwise it's a hard failure so CI never silently ships stale.
//
// We set `process.exitCode` and unwind rather than calling `process.exit()`: on
// Windows, calling process.exit() while undici (global `fetch`) still has a
// socket closing trips a libuv assertion and crashes with exit 0xC0000409 —
// which would fail the build even in --optional mode. Letting the loop drain
// avoids it (same reason as bake-editor-doc.mjs).
class PublishBail {}
function bail(message) {
	if (optional) {
		console.warn(`⚠ publish-symbols: ${message}`);
		console.warn('⚠ publish-symbols: skipping (--optional). Tool grid may be STALE.');
		process.exitCode = 0;
	} else {
		console.error(message);
		process.exitCode = 1;
	}
	throw new PublishBail();
}

async function bodySnippet(res) {
	try {
		return (await res.text()).slice(0, 300);
	} catch {
		return '';
	}
}

/**
 * Attach a `previewKey` to each spine cell, resolved from the game's `assets.ts`
 * (the assetKey → { atlas, skeleton } registry). `previewKey` is `<folder>/<stem>`
 * (e.g. `symbols/h1`) — the same shape as a `skeletons.json` entry name — so the
 * launcher can preview the SPECIFIC skeleton of a shared-atlas symbol bundle. The
 * paths in assets.ts are `new URL('../../assets/spines/<folder>/<file>', …).href`,
 * so we read the `spines/<folder>/` segment + the skeleton stem out of the URL.
 */
async function enrichSpinePreviewKeys(symbols) {
	let assetMap;
	try {
		const mod = await import(pathToFileURL(assetsPath).href);
		assetMap = mod?.default ?? mod;
	} catch {
		return; // no assets module → leave spine defaults as chips
	}
	if (!assetMap || typeof assetMap !== 'object') return;

	const previewKeyFor = (asset) => {
		if (!asset || asset.type !== 'spine' || !asset.src) return undefined;
		const folder = String(asset.src.atlas ?? '').match(/\/spines\/([^/]+)\//);
		const stem = String(asset.src.skeleton ?? '').match(/\/([^/]+)\.[^./]+$/);
		return folder && stem ? `${folder[1]}/${stem[1]}` : undefined;
	};

	for (const states of Object.values(symbols)) {
		for (const cell of Object.values(states)) {
			if (cell?.type !== 'spine' || !cell.assetKey) continue;
			const pk = previewKeyFor(assetMap[cell.assetKey]);
			if (pk) cell.previewKey = pk;
		}
	}
}

/**
 * Every symbol name appearing on a config's reel strips — what the game can
 * actually DEAL. Returns null when the config has no usable strips, so the
 * caller falls back to the dictionary rather than dropping everything.
 */
function symbolsOnReels(cfg) {
	const strips = cfg?.paddingReels;
	if (!strips || typeof strips !== 'object') return null;
	const names = new Set();
	for (const reels of Object.values(strips)) {
		for (const reel of Array.isArray(reels) ? reels : []) {
			for (const symbol of Array.isArray(reel) ? reel : []) {
				if (symbol && typeof symbol.name === 'string') names.add(symbol.name);
			}
		}
	}
	return names.size > 0 ? names : null;
}

/**
 * The game config to gate on — the AUTHORED doc when the project has one, else the
 * local compiled module. Returns `{ cfg, source }`, or null when neither is usable.
 *
 * Authored-first is the point of Phase 5 (`invisible-game-config.md`): the game runs
 * the authored config, so the tool grid must too, or a symbol the project ADDED (or
 * removed) would be missing from (or dead in) the grid. The fetch is the token-gated
 * `GET /api/game-config/doc`, the SAME endpoint the bake reads. A null `doc` there
 * means "never authored" — not an error — so we quietly fall back to the module.
 *
 * The two configs are the same shape, so everything downstream (`symbolsOnReels`,
 * the dictionary gate) is source-agnostic — one gate, two sources, no second answer.
 */
async function loadGateConfig() {
	if (token && base) {
		try {
			const url =
				`${base}/api/game-config/doc?project=${encodeURIComponent(project)}` +
				`&k=${encodeURIComponent(token)}`;
			const res = await fetch(url);
			if (res.ok) {
				const body = await res.json();
				if (body?.doc && typeof body.doc === 'object') {
					return { cfg: body.doc, source: 'authored game config' };
				}
			} else {
				console.warn(
					`⚠ publish-symbols: game-config fetch HTTP ${res.status} — falling back to ${configPath}.`,
				);
			}
		} catch (err) {
			console.warn(
				`⚠ publish-symbols: could not fetch the authored game config (${err instanceof Error ? err.message : err})` +
					` — falling back to ${configPath}.`,
			);
		}
	}
	try {
		const mod = await import(pathToFileURL(configPath).href);
		return { cfg: mod?.default ?? mod, source: `compiled ${configPath}` };
	} catch {
		return null;
	}
}

/**
 * Restrict the published symbol set to the symbols the game actually PLAYS, so
 * the Symbols tool grid mirrors the game instead of showing dead rows.
 *
 * Two gates, both from the game config (authored doc first, else compiled module):
 *  - `symbols` is the DICTIONARY — art, properties, payouts. Necessary but not
 *    sufficient: it legitimately describes symbols a given game never deals.
 *  - `paddingReels` are the REEL STRIPS — the one client-side statement of what
 *    reaches the board. This is the real in-play set.
 *
 * The dictionary alone was the wrong gate: the upstream Stake sample declares a
 * `W` wild+multiplier that neither RGS the engine talks to ever emits, so the
 * grid offered a W row (dynamite art) for a symbol that could never land — the
 * same stale-sample leak that put W on the spinning reels and in the paytable.
 * Self-maintaining: a game whose math DOES deal a wild has it in its strips, and
 * the row comes back with no code change.
 *
 * Mutates `symbols` in place, preserving `SYMBOL_INFO_MAP`'s ordering (only
 * dropping keys absent from the config). Best-effort: a missing/odd config,
 * an empty `symbols` map, or `--no-config-filter` leaves the full set (prior
 * behaviour) so a build never loses symbols to a config it couldn't read. A
 * config with no readable strips falls back to the dictionary gate alone.
 */
async function filterToGameConfig(symbols) {
	if (!configFilter) {
		console.info('Config filter disabled (--no-config-filter) — publishing every symbol.');
		return;
	}
	const gate = await loadGateConfig();
	if (!gate) {
		console.warn(
			`⚠ publish-symbols: could not read a game config (no authored doc, and ${configPath} failed` +
				' to import) — publishing every symbol. Pass --config <path> or --no-config-filter to silence.',
		);
		return;
	}
	const { cfg, source } = gate;
	const used = cfg?.symbols;
	console.info(`Config filter: gating on the ${source}.`);
	if (!used || typeof used !== 'object' || Object.keys(used).length === 0) {
		console.warn(
			`⚠ publish-symbols: the ${source} has no \`symbols\` map — publishing` +
				' every symbol (no config filter).',
		);
		return;
	}

	const onReels = symbolsOnReels(cfg);
	if (!onReels) {
		console.warn(
			`⚠ publish-symbols: the ${source} has no readable reel strips` +
				' (`paddingReels`) — filtering by the symbol dictionary alone, which can keep a row' +
				' for a symbol the game never deals.',
		);
	}
	const inPlay = new Set(Object.keys(used).filter((name) => !onReels || onReels.has(name)));
	const dropped = Object.keys(symbols).filter((name) => !inPlay.has(name));
	for (const name of dropped) delete symbols[name];

	// A config symbol with no visual map can't be rendered — flag it (no silent gaps).
	const missingArt = [...inPlay].filter((name) => !(name in symbols));

	if (dropped.length) {
		console.info(
			`Config filter: dropped ${dropped.length} unused symbol(s) not in the ${source} — ` +
				`${dropped.join(', ')}.`,
		);
	} else {
		console.info(`Config filter: all mapped symbols are in play per the ${source}.`);
	}
	if (missingArt.length) {
		console.warn(
			`⚠ publish-symbols: ${missingArt.length} config symbol(s) have no entry in the symbol` +
				` map (no visual default) — ${missingArt.join(', ')}.`,
		);
	}
}

// The fields the server's symbol-defaults schema accepts on a cell. A game's
// coded `SYMBOL_INFO_MAP` may carry extra engine-only fields the tool doesn't
// model (e.g. Book of Borut's `winFrame`); the server cell schema would reject
// the whole payload, so strip each cell down to the known keys before sending.
// `previewKey` is the tool-only enrichment added above — kept here.
const ALLOWED_CELL_KEYS = ['type', 'assetKey', 'animationName', 'previewKey', 'sizeRatios'];

/** Drop any cell field outside {@link ALLOWED_CELL_KEYS} so a game-specific extra
 *  field never trips the server schema. Mutates `symbols` in place. */
function sanitizeCells(symbols) {
	for (const states of Object.values(symbols)) {
		for (const [state, cell] of Object.entries(states)) {
			if (!cell || typeof cell !== 'object') continue;
			const clean = {};
			for (const key of ALLOWED_CELL_KEYS) if (key in cell) clean[key] = cell[key];
			states[state] = clean;
		}
	}
}

async function main() {
	let mod;
	try {
		mod = await import(pathToFileURL(symbolsPath).href);
	} catch (err) {
		bail(`Could not import ${symbolsPath} — ${err instanceof Error ? err.message : err}`);
	}

	const map = mod?.[exportName];
	if (!map || typeof map !== 'object') {
		bail(`Export "${exportName}" not found (or not an object) in ${symbolsPath}.`);
	}

	// Strip `as const` readonly + clone to a plain JSON-safe object.
	const symbols = JSON.parse(JSON.stringify(map));
	// Tool-only enrichment: give each spine cell a `previewKey` (`<folder>/<stem>`,
	// e.g. `symbols/h1`) resolved from the game's assets.ts, so the Symbols tool can
	// preview a DEFAULT spine whose coded `assetKey` (`H1`) is a short engine key, not
	// an R2 bundle prefix. Best-effort — a missing/odd assets module just leaves spine
	// defaults as chips (prior behaviour). `previewKey` is display/preview-only; it is
	// never written into a saved override (applyDraft rebuilds the cell from scratch).
	await enrichSpinePreviewKeys(symbols);
	// Restrict to the symbols the game config marks as in-play, so the tool grid
	// mirrors the built game (drops e.g. an unused H5). Best-effort — see helper.
	await filterToGameConfig(symbols);
	// Drop game-specific extra cell fields the tool schema doesn't model (e.g. winFrame).
	sanitizeCells(symbols);
	const doc = { version: 1, gameType, symbols };
	const symbolNames = Object.keys(symbols);

	if (dryRun) {
		console.info(
			`(dry run) resolved ${symbolNames.length} symbols from ${exportName} in ${symbolsPath}` +
				` (gameType=${gameType}):`,
		);
		console.info(JSON.stringify(doc, null, '\t'));
		console.info(
			`\n(dry run) would PUT → ${base}/api/editor/symbol-defaults?project=${project}` +
				` (${symbolNames.length} symbols).`,
		);
		return;
	}

	if (!token) {
		console.error(USAGE);
		bail('Missing token — pass --token or set EDITOR_DOC_SECRET / LIVE_ASSETS_TOKEN in the env.');
	}

	const putUrl =
		`${base}/api/editor/symbol-defaults?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;

	console.info(
		`Publishing ${symbolNames.length} symbols → ${base}/api/editor/symbol-defaults [${project}]`,
	);

	let res;
	try {
		res = await fetch(putUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(doc),
		});
	} catch (err) {
		bail(
			`Could not reach ${base}/api/editor/symbol-defaults — ${err instanceof Error ? err.message : err}`,
		);
	}
	if (!res.ok) {
		bail(`Publish failed: HTTP ${res.status} — ${await bodySnippet(res)}`);
	}

	const out = await res.json();
	console.info(
		`\nPublished ${out?.symbols ?? symbolNames.length} symbols to ` +
			`${out?.clientKey}/${out?.projectKey}/symbols/defaults.json.`,
	);
}

try {
	await main();
} catch (err) {
	if (!(err instanceof PublishBail)) {
		console.error(err);
		process.exitCode = 1;
	}
}
