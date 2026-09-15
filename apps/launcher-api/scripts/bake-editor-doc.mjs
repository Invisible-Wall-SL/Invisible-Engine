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
				// Placed regions no shipped atlas packs — carried so the game warns at boot.
				missing: Array.isArray(art?.missing) ? art.missing : [],
			};
			// FATAL, unlike every other dangling report here. A dangling sprite region renders an
			// invisible node — obvious on screen. A dangling CLIP frame silently SHORTENS an
			// animation that still plays and still looks plausible, so it can pass review and ship
			// wrong. Refuse the bake and name each clip + its missing frames.
			const clipMissing = Array.isArray(art?.clipMissing) ? art.clipMissing : [];
			if (clipMissing.length) {
				const detail = clipMissing
					.map((c) => `  • clip "${c.clipId}" is missing: ${c.frames.join(', ')}`)
					.join('\n');
				bail(
					`${clipMissing.length} flipbook clip(s) reference frames that NO shipped sheet packs.\n` +
						`${detail}\n` +
						'A missing clip frame does not fail loudly — it silently SHORTENS the animation, ' +
						'which still plays and still looks right. Re-pick the frames in /flipbook, or ' +
						're-pack the sheet so it contains them, then bake again.',
				);
			}
			// Loud (non-fatal) warning when two referenced sheets share a region name.
			// Rendering is correct (each sheet is scoped by its manifest), but it
			// usually means a superseded sheet is still referenced — name the overlap
			// so the author can retire the dead one.
			// Dangling-binding guard: a placed region no shipped atlas packs renders
			// blank in-game ("… is not found in the loadedAssets"). Warn loudly so a
			// re-authored atlas that dropped/renamed the region is caught at publish.
			const artMissing = Array.isArray(art?.missing) ? art.missing : [];
			if (artMissing.length) {
				console.warn(
					`⚠ bake-doc: ${artMissing.length} PLACED region(s) are in NO shipped atlas and will ` +
						`render BLANK in-game: ${artMissing.join(', ')}. Re-pack the atlas so it contains ` +
						'them, or re-pick the frame in the Scene Editor.',
				);
			}
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

	// Export the project's sound library (Invisible Sound) into R2 `deploy/sounds/` so the
	// deploy mirror that runs next pulls the audio files, and embed the catalog so the game
	// loads each one as an extra audio bank. Without this an uploaded sound auditions in the
	// tool and is MISSING from the shipped game — the same gap the font export closed.
	let sounds = { catalog: { prefix: 'sounds', sounds: [] } };
	const soundsUrl =
		`${base}/api/editor/export-sounds?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the sound export — it writes to R2 deploy/.');
	} else
		try {
			const soundRes = await fetchRetry(soundsUrl, { method: 'POST' }, 'sound export');
			if (!soundRes.ok) {
				bail(`Sound export failed: HTTP ${soundRes.status} — ${await bodySnippet(soundRes)}`);
			}
			const s = await soundRes.json();
			if (s?.catalog && Array.isArray(s.catalog.sounds)) sounds = { catalog: s.catalog };
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-sounds — ${err instanceof Error ? err.message : err}`,
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
		names: undefined,
		symbolSounds: undefined,
		highlight: undefined,
		boardGlow: undefined,
		winLine: undefined,
		winCycle: undefined,
		winExplode: undefined,
		winBeat: undefined,
		arrivalRelease: undefined,
		bookVfx: undefined,
		transition: undefined,
		tumblePattern: undefined,
		anticipation: undefined,
		stacked: undefined,
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
							// MULTIPLY tint the frame applies to the symbols it loops over — carried through
							// only when authored, so an untouched project ships no tint and renders untinted.
							...(s.highlight.tintMode === 'fixed' || s.highlight.tintMode === 'winLine'
								? { tintMode: s.highlight.tintMode }
								: {}),
							...(typeof s.highlight.tintColor === 'string'
								? { tintColor: s.highlight.tintColor }
								: {}),
						}
					: undefined;
			// The free-spin board glow (absent → game keeps its coded `reelhouse` spine). Like
			// `highlight`, `assetKey` is the full R2 spine-bundle prefix already in `index.spines`.
			// `animations`/`sizeRatios` are sparse overrides — carried through only when present, so
			// an untouched project ships no `boardGlow` and renders byte-identical.
			const boardGlow =
				s?.boardGlow && typeof s.boardGlow === 'object' && typeof s.boardGlow.assetKey === 'string'
					? {
							assetKey: s.boardGlow.assetKey,
							...(s.boardGlow.animations &&
							typeof s.boardGlow.animations === 'object' &&
							Object.keys(s.boardGlow.animations).length
								? { animations: s.boardGlow.animations }
								: {}),
							...(s.boardGlow.sizeRatios &&
							typeof s.boardGlow.sizeRatios === 'object' &&
							typeof s.boardGlow.sizeRatios.width === 'number' &&
							typeof s.boardGlow.sizeRatios.height === 'number'
								? { sizeRatios: s.boardGlow.sizeRatios }
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
			// The resting-board win-symbol replay — assetless config, sparse, forwarded verbatim like
			// `winLine`. It was MISSING from this whitelist while the runtime-bundle path carried it, so
			// a `/symbols` project that turned the replay off or retuned its delay silently shipped the
			// coded default through the bake path (the "must reach BOTH bundle paths" rule).
			const winCycle = (() => {
				const c = s?.winCycle;
				if (!c || typeof c !== 'object') return undefined;
				const out = {};
				if (c.enabled === false) out.enabled = false;
				if (typeof c.delay === 'number') out.delay = c.delay;
				// `showLine`/`showText` default ON, so ONLY the off-state persists (matching the
				// exporter's sparse doc + `bakedWinCycleConfig`'s `?? true`). The prior `=== true`
				// tests were inverted for the default-ON flip and silently dropped the OFF state,
				// re-enabling the line replay through a bake.
				if (c.showLine === false) out.showLine = false;
				if (c.showText === false) out.showText = false;
				// `showMessage` INVERTS the default: it is OFF unless authored, so ONLY the ON state
				// persists (matching the exporter's sparse doc + `bakedWinCycleConfig`'s `?? false`).
				if (c.showMessage === true) out.showMessage = true;
				// `dimNonWinning` also defaults OFF, so ONLY the ON state persists (same as
				// `showMessage`; `bakedWinCycleConfig`'s `?? false`).
				if (c.dimNonWinning === true) out.dimNonWinning = true;
				// `holdAfterBigWin` — same default-OFF inversion: only the ON state persists
				// (`bakedWinCycleConfig`'s `?? false`). Without this line a project that authored the
				// between-spins hold would ship WITHOUT it through the bake path while the runtime
				// bundle carried it — the exact "must reach BOTH bundle paths" bug fixed above.
				if (c.holdAfterBigWin === true) out.holdAfterBigWin = true;
				return Object.keys(out).length ? out : undefined;
			})();
			// The win-explosion pop — one switch that defaults OFF, so ONLY the ON state persists. Must
			// reach BOTH bundle paths (this + the runtime `SymbolExportResult`): omit it here and a
			// project that turned the pop on would ship without it through the bake path.
			const winExplode = s?.winExplode?.enabled === true ? { enabled: true } : undefined;
			// The win-beat CEILING — one number in milliseconds, assetless. Must reach BOTH bundle paths
			// for the same reason as the pop above: omit it here and a project that shortened its win
			// beats would keep shipping the long ones through the bake path. Rebuilt rather than
			// forwarded so a hand-edited doc cannot smuggle a non-number into a `setTimeout`; the RANGE
			// is deliberately not re-stated here (this script imports nothing from the workspace, so a
			// bound copied into it is a bound that drifts) — Zod owns it at save, and the engine's own
			// runaway guard still ends any beat this fails to shorten.
			const winBeat =
				Number.isFinite(s?.winBeat?.maxMs) && s.winBeat.maxMs > 0
					? { maxMs: Math.round(s.winBeat.maxMs) }
					: undefined;
			// The arrival release — the emerge intro stops GATING the round (it still plays). One
			// switch that defaults OFF, so ONLY the ON state persists, and it has to reach BOTH bundle
			// paths for the third time in a row: omit it here and a project that asked for the shorter
			// wait would keep sitting out the intro through the bake path while the live one did not.
			const arrivalRelease = s?.arrivalRelease?.enabled === true ? { enabled: true } : undefined;
			// Symbol DISPLAY NAMES (`H1` → "Banana"), pure text. Invisible Win Text reads these as
			// `{symbolName}`, so without them here every baked win sentence would name the raw id.
			const bookVfx = (() => {
				const b = s?.bookVfx;
				if (!b || typeof b !== 'object') return undefined;
				const out = {};
				if (b.background && typeof b.background === 'object') out.background = b.background;
				if (b.foreground && typeof b.foreground === 'object') out.foreground = b.foreground;
				return Object.keys(out).length ? out : undefined;
			})();
			// The explosion → intro transition — one kind-tagged layer + `delayMs`, on the same defensive
			// shape as a book-VFX layer. MUST reach BOTH bundle paths (this + the runtime
			// `SymbolExportResult`, which passes `transition` verbatim): omit it here and the live game
			// would bridge the seam while the baked one cut.
			const transition =
				s?.transition && typeof s.transition === 'object' && typeof s.transition.kind === 'string'
					? s.transition
					: undefined;
			// The cascade EXPLOSION PATTERN — a pattern name + a millisecond gap, assetless. MUST reach
			// BOTH bundle paths for the same reason the transition above must: omit it here and a
			// project would explode in waves on the live runtime bundle and in one frame on the baked
			// one. Rebuilt field-by-field rather than forwarded whole so a hand-edited doc cannot
			// smuggle a non-numeric step into a `setTimeout`; the server already pruned the defaults, so
			// a project on "all at once" arrives here as `undefined` and bakes no field at all.
			//
			// The NAME is checked for shape, not membership, and deliberately: this script imports
			// nothing from the workspace (it runs standalone inside a game build), so an allowlist here
			// would be a hand-copied `TUMBLE_PATTERNS` — the drift trap the rest of this feature avoids
			// by having exactly one list. Membership is enforced where that list lives: Zod on save,
			// and `tumbleExplosionDelays`, which answers "one frame" for a name it does not know rather
			// than throwing inside the explode step.
			const tumblePattern = (() => {
				const t = s?.tumblePattern;
				if (!t || typeof t !== 'object') return undefined;
				if (typeof t.pattern !== 'string' || t.pattern === 'all') return undefined;
				const out = { pattern: t.pattern };
				if (Number.isFinite(t.stepMs)) out.stepMs = t.stepMs;
				return out;
			})();
			const names =
				s?.names && typeof s.names === 'object' && Object.keys(s.names).length
					? s.names
					: undefined;
			/**
			 * The per-symbol sound cues (`symbolSounds[name][state]`). Carried for the SAME
			 * "must reach both bundle paths" reason as the fields above, but it is a FALLBACK here,
			 * not the primary carrier: the sound export folds these into `catalog.bindings.symbols`,
			 * which `bakedSymbolSounds` consults first. That fold is what the runtime path already
			 * had underneath it (`SymbolExportResult` passes `symbolSounds` verbatim) and the bake
			 * path did not — so a bundle built by each route answered differently the moment the
			 * bindings block was absent.
			 */
			const symbolSounds =
				s?.symbolSounds && typeof s.symbolSounds === 'object' && Object.keys(s.symbolSounds).length
					? s.symbolSounds
					: undefined;
			// The reel-anticipation presentation FX (per-tier escalation + optional overlay `spineKey`).
			// Pure config apart from the spine (already in `index.spines` if swapped). Rebuilt sparse so an
			// untouched project ships no `anticipation` and the mode stays byte-identical to Phase 4 — the
			// engine's `resolveTierFx`/`resolveAnticipationSpineKey` fill every omitted field from the coded
			// `ANTICIPATION_TIER_FX`. MUST reach BOTH bundle paths (this + the runtime `SymbolExportResult`).
			const anticipation = (() => {
				const a = s?.anticipation;
				if (!a || typeof a !== 'object') return undefined;
				const out = {};
				if (typeof a.spineKey === 'string' && a.spineKey) out.spineKey = a.spineKey;
				// GLOBAL authored sound names (one activation sting + one loop). Enumerated here or this
				// bake path would ship the swapped spine/tiers while silently dropping the sounds — the
				// field-allowlist trap. Unset ⇒ the engine's resolvers fill the coded names (byte-parity).
				if (typeof a.activationSound === 'string' && a.activationSound)
					out.activationSound = a.activationSound;
				if (typeof a.loopSound === 'string' && a.loopSound) out.loopSound = a.loopSound;
				if (a.tiers && typeof a.tiers === 'object') {
					// Alias-keyed dynamic record: one entry per configured big-win tier, not a fixed
					// big/mega/massive triple. Copy every non-empty tier verbatim (sparse) — so a per-tier
					// field like `stingVolume` rides along without a hand-copied allowlist here.
					const tiers = {};
					for (const [alias, fx] of Object.entries(a.tiers)) {
						if (fx && typeof fx === 'object' && Object.keys(fx).length) tiers[alias] = fx;
					}
					if (Object.keys(tiers).length) out.tiers = tiers;
				}
				return Object.keys(out).length ? out : undefined;
			})();
			// The stacked-picture config (`bundle.symbols.stacked = { symbols: [{ name, height, art }] }`).
			// The exporter already gates on the master toggle + ships each tall `art` asset via
			// `index.spines`/`index.sheets`, so this is a defensive rebuild: keep only well-formed entries
			// (name + finite height + non-empty `art.assetKey`) and only the art's contract fields. Absent /
			// empty stays `undefined` so a disabled/un-authored project bakes byte-identical. MUST reach BOTH
			// bundle paths (this + the runtime `SymbolExportResult`, which passes `stacked` verbatim).
			const stacked = (() => {
				const st = s?.stacked;
				if (!st || typeof st !== 'object' || !Array.isArray(st.symbols)) return undefined;
				// One picture slot → its contract fields, or undefined when nothing is bound. Shared by the
				// resting `art` and the optional winning `winArt` so neither can drift from the other.
				const artOf = (art) => {
					if (!art || typeof art !== 'object' || typeof art.assetKey !== 'string' || !art.assetKey)
						return undefined;
					const out = { type: art.type, assetKey: art.assetKey };
					if (typeof art.animationName === 'string' && art.animationName)
						out.animationName = art.animationName;
					if (typeof art.clipId === 'string' && art.clipId) out.clipId = art.clipId;
					return out;
				};
				const out = [];
				for (const sym of st.symbols) {
					if (!sym || typeof sym !== 'object') continue;
					if (typeof sym.name !== 'string' || !sym.name) continue;
					if (typeof sym.height !== 'number' || !Number.isFinite(sym.height)) continue;
					const artOut = artOf(sym.art);
					if (!artOut) continue;
					// The WIN picture is optional — a symbol without one keeps showing `art` while it pays.
					const winArtOut = artOf(sym.winArt);
					out.push({
						name: sym.name,
						height: sym.height,
						art: artOut,
						...(winArtOut ? { winArt: winArtOut } : {}),
					});
				}
				return out.length
					? {
							symbols: out,
							...(st.fullHeightOnly === true ? { fullHeightOnly: true } : {}),
							// Was silently dropped here while the exporter emitted it, so a baked bundle lost the
							// edge cut-offs the project had authored.
							...(st.edgeCutoffs === true ? { edgeCutoffs: true } : {}),
							...(typeof st.winHoldMs === 'number' && Number.isFinite(st.winHoldMs)
								? { winHoldMs: st.winHoldMs }
								: {}),
						}
					: undefined;
			})();
			symbols = {
				map: s?.map && typeof s.map === 'object' ? s.map : {},
				index: {
					sheets: Array.isArray(s?.index?.sheets) ? s.index.sheets : [],
					images: Array.isArray(s?.index?.images) ? s.index.images : [],
					spines: Array.isArray(s?.index?.spines) ? s.index.spines : [],
					collisions: Array.isArray(s?.index?.collisions) ? s.index.collisions : [],
					// Bound frames no shipped atlas packs — carried so the game warns at boot.
					missing: Array.isArray(s?.index?.missing) ? s.index.missing : [],
				},
				names,
				symbolSounds,
				highlight,
				boardGlow,
				winLine,
				winCycle,
				winExplode,
				winBeat,
				arrivalRelease,
				bookVfx,
				transition,
				tumblePattern,
				anticipation,
				stacked,
			};
			// Dangling-binding guard: a bound sprite frame no shipped atlas packs renders
			// blank in-game ("… is not found in the loadedAssets"). Warn loudly so a
			// re-authored atlas that dropped/renamed the frame is caught at publish.
			const symMissing = Array.isArray(symbols.index.missing) ? symbols.index.missing : [];
			if (symMissing.length) {
				console.warn(
					`⚠ bake-doc: ${symMissing.length} bound symbol frame(s) are in NO shipped atlas and will ` +
						`render BLANK in-game: ${symMissing.join(', ')}. Re-pack the atlas so it contains them, ` +
						'or re-bind the symbol in the Invisible Symbols State Machine.',
				);
			}
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
	// Invisible Flow v2 — the same endpoint returns `flowV2` + `flowV2Library` (the v2
	// graph + its shared function library) alongside the v1 `flow`. A flow-v2 game reads
	// these via `bakedFlowV2Doc()` / `bakedFlowV2Library()`; without them a v2-authored
	// game bakes inert and renders static scene-editor placement with no flow driving —
	// the exact "flow was never built" symptom. The endpoint self-gates on authored, so
	// they're present only for a real v2 flow (parity for v1/coded games).
	let flowV2;
	let flowV2Library;
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
			// v2 is authored-gated server-side (exportEditorFlowV2 returns {} otherwise), so
			// a present `flowV2` object is already a real graph — embed it + its library.
			if (f?.flowV2 && typeof f.flowV2 === 'object') {
				flowV2 = f.flowV2;
				if (f.flowV2Library && typeof f.flowV2Library === 'object') {
					flowV2Library = f.flowV2Library;
				}
			}
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-flow — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Invisible Cinematic — export the project's cinematics into `deploy/cinematics/` and embed
	// them so `bakedCinematics()` resolves in a standalone build. Like a FlowDoc, a cinematic
	// carries no binary assets of its own; the RIGS it casts ride the editor-art export (seeded
	// with their bundle names server-side), so nothing extra is mirrored here. A project with no
	// cinematics leaves this undefined ⇒ the bundle omits it ⇒ `bakedCinematics()` is [] (parity).
	let cinematics;
	const cinematicsUrl =
		`${base}/api/editor/export-cinematics?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the cinematic export — it writes to R2 deploy/.');
	} else
		try {
			const res = await fetchRetry(cinematicsUrl, { method: 'POST' }, 'cinematic export');
			// Best-effort, deliberately NOT a bail: cinematics are additive, and a launcher that
			// predates this endpoint answers 404. Failing the whole bake over it would break every
			// existing game's build for a feature they do not use.
			if (res.ok) {
				const c = await res.json();
				if (Array.isArray(c?.cinematics) && c.cinematics.length) cinematics = c.cinematics;
			} else if (res.status !== 404) {
				console.warn(`  cinematic export returned HTTP ${res.status} — continuing without it.`);
			}
		} catch (err) {
			console.warn(
				`  could not reach ${base}/api/editor/export-cinematics — continuing without it (${err instanceof Error ? err.message : err}).`,
			);
		}

	// Export the project's Invisible FX effects (the authored particle effects) into R2
	// `deploy/effects/` and embed the returned `EffectDoc[]` so the game's `bakedEffects()`
	// registers them. Unlike the art/font/symbol exports an EffectDoc carries NO binary
	// assets of its own — its particle art is an atlas the editor-art export above already
	// ships — so `deploy/effects/` is pure JSON, mirrored by `pull-project-assets.mjs` like
	// the rest of deploy/. Absent / un-authored ⇒ `effects` stays undefined ⇒ the game has
	// no effects, byte-identical to current `main` (parity, §8). The dangling-assetKey guard
	// (below) verifies each effect's `art.assetKey` resolves to a SHIPPED atlas — a key the
	// editor-art export didn't ship = an invisible effect (§8), so warn loudly.
	let effects;
	let effectAssetKeys = [];
	let effectSkeletonKeys = [];
	// Rig-timeline direct FX bindings (a rig's own animation events → effects, read from the rig
	// `.irig`/`.json`; keyed by the rig's runtime assetKey = its bundle folder). Rides the same FX
	// export trigger — it ships no new assets. Absent / no bound events ⇒ stays undefined ⇒ the game's
	// `resolveRigFx()` returns [] and nothing new mounts (parity).
	let rigFx;
	const effectsUrl =
		`${base}/api/editor/export-effects?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the effects export — it writes to R2 deploy/.');
	} else
		try {
			const fxRes = await fetchRetry(effectsUrl, { method: 'POST' }, 'effects export');
			if (!fxRes.ok) {
				bail(`Effects export failed: HTTP ${fxRes.status} — ${await bodySnippet(fxRes)}`);
			}
			const fx = await fxRes.json();
			const list = Array.isArray(fx?.effects) ? fx.effects : [];
			// Only embed when the project authored at least one effect, keeping the bundle
			// byte-identical for every game with no FX work (parity, §8).
			if (list.length > 0) effects = list;
			effectAssetKeys = Array.isArray(fx?.referencedAssetKeys) ? fx.referencedAssetKeys : [];
			effectSkeletonKeys = Array.isArray(fx?.referencedSkeletonKeys)
				? fx.referencedSkeletonKeys
				: [];
			// Only embed when at least one rig has a bound event, keeping the bundle byte-identical
			// for every game with no rig-FX bindings (parity).
			if (fx?.rigFx && typeof fx.rigFx === 'object' && Object.keys(fx.rigFx).length > 0) {
				rigFx = fx.rigFx;
			}
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-effects — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Export the project's Invisible Flipbook clips into R2 `deploy/clips/` so the deploy mirror
	// pulls them, and embed them so the game registers each clip (`registerFlipbooks`). A clip
	// ships no new assets — its frames are regions of an atlas the editor-art export already
	// ships. Unlike effects, clips are NOT reachability-pruned — a filter is buildable now that
	// consumers exist, but it would have to walk all four referrers incl. the rig manifest below
	// (see flipbookExport.ts's header).
	let flipbooks;
	// Rig-timeline direct CLIP bindings (a rig's own animation events → flipbook clips, read from the
	// rig `.irig`/`.json`; keyed by the rig's runtime assetKey = its bundle folder). Rides the same
	// clips export trigger — it ships no new assets, only a `clipId` into the clips above. Absent /
	// no bound events ⇒ stays undefined ⇒ the game's `resolveRigFlipbooks()` returns [] (parity).
	let rigFlipbooks;
	const clipsUrl =
		`${base}/api/editor/export-clips?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;
	if (dryRun) {
		console.info('(dry run) skipping the clips export — it writes to R2 deploy/.');
	} else
		try {
			const clipRes = await fetchRetry(clipsUrl, { method: 'POST' }, 'clips export');
			if (!clipRes.ok) {
				bail(`Clips export failed: HTTP ${clipRes.status} — ${await bodySnippet(clipRes)}`);
			}
			const cl = await clipRes.json();
			const list = Array.isArray(cl?.clips) ? cl.clips : [];
			// Only embed when the project authored at least one clip, keeping the bundle
			// byte-identical for every game with no flipbook work (parity).
			if (list.length > 0) flipbooks = list;
			// Only embed when at least one rig has a bound event, keeping the bundle byte-identical
			// for every game with no rig-flipbook bindings (parity).
			if (cl?.rigFlipbooks && typeof cl.rigFlipbooks === 'object') {
				const bound = cl.rigFlipbooks;
				if (Object.keys(bound).length > 0) rigFlipbooks = bound;
				// A binding whose clip was deleted in /flipbook renders NOTHING at that beat, which
				// reads on screen as "the rig animation is broken" rather than as a dangling id. Warn
				// loudly (non-fatal — the rest of the rig still plays, unlike a short clip, which is
				// why the clipMissing guard above bails and this does not).
				const shipped = new Set(list.map((c) => c && c.id));
				const dangling = [
					...new Set(
						Object.values(bound)
							.flat()
							.map((b) => b && b.clipId)
							.filter((id) => id && !shipped.has(id)),
					),
				];
				for (const id of dangling) {
					console.warn(
						`WARNING: a rig animation event binds flipbook clip "${id}", which no shipped ` +
							'clip provides. That beat will render nothing in game. Re-pick the clip in ' +
							'/rigger, or re-create it in /flipbook.',
					);
				}
			}
		} catch (err) {
			if (err instanceof BakeBail) throw err;
			bail(
				`Could not reach ${base}/api/editor/export-clips — ${err instanceof Error ? err.message : err}`,
			);
		}

	// Dangling-assetKey guard (§8 — the particle analogue of the geometry-less-manifest
	// gotcha): each effect layer references its particle art by `art.assetKey`, an atlas
	// MANIFEST key the editor-art export ships as a sheet (`editorArt.sheets[].key`). The
	// editor-art export now AUTO-SHIPS every effect atlas (`exportEditorArt` walks the project's
	// effects), so this should be empty in the normal case — if it STILL fires, the atlas failed
	// to export (e.g. its manifest has no packed page or no regions), and the effect will render
	// INVISIBLE (textureless particles). Non-fatal. Empty/no effects ⇒ no check.
	if (effectAssetKeys.length > 0) {
		const shipped = new Set(editorArt.sheets.map((s) => s.key));
		for (const k of editorArt.images) shipped.add(k.key);
		const dangling = effectAssetKeys.filter((k) => !shipped.has(k));
		for (const k of dangling) {
			console.warn(
				`⚠ bake-doc: FX effect references art.assetKey "${k}" which is NOT among the ` +
					`shipped atlases (editor-art sheets) even though effect atlases auto-ship — its ` +
					`manifest likely has no packed page or no regions, so the effect will render ` +
					'INVISIBLE (textureless particles). Re-check that atlas in the Atlas/Sheet Maker.',
			);
		}
	}

	// Dangling-skeletonKey guard (§8 — the spine analogue of the dangling-assetKey guard above):
	// a Tier-C (`particleKind:'spine'`) layer references a Spine bundle by `spineParticle.skeletonKey`,
	// which `/fx` authors as the CANONICAL bundle `folder` (the value the runtime registers the spine
	// under in `loadedAssets`). That bundle reaches the game's `loadedAssets` only if it's among the
	// SHIPPED spines — i.e. it was placed in the layout (`editorArt.spines[].key`, already the bundle
	// folder) or bound to a symbol/highlight (`symbols.index.spines[].key`, a FULL R2 bundle prefix
	// `<…>/spines/<folder>/`). To compare apples-to-apples we reduce every shipped key to its bundle
	// folder. A skeletonKey NOT in that set never loads ⇒ the spine particles have no skeleton ⇒ the
	// effect renders INVISIBLE. FX never re-packs spines, so warn loudly (non-fatal: the author may
	// wire the spine into the layout/symbols before shipping). No spine particles ⇒ no check.
	if (effectSkeletonKeys.length > 0) {
		// `<client>/<project>/spines/<folder>/` → `<folder>`; an already-bare folder key is unchanged.
		const bundleFolder = (key) => {
			const trimmed = key.replace(/\/$/, '');
			const m = trimmed.match(/(?:^|\/)spines\/(.+)$/);
			return m ? m[1] : trimmed;
		};
		const shippedSpines = new Set(editorArt.spines.map((s) => bundleFolder(s.key)));
		for (const s of symbols.index.spines) shippedSpines.add(bundleFolder(s.key));
		const dangling = effectSkeletonKeys.filter((k) => !shippedSpines.has(k));
		for (const k of dangling) {
			console.warn(
				`⚠ bake-doc: FX effect references spineParticle.skeletonKey "${k}" which is NOT among ` +
					`the shipped Spine bundles (editor-art spines / symbol spines). The skeleton only ` +
					`ships if the layout or a symbol ALSO uses it — these spine-clip particles will render ` +
					'INVISIBLE. Place the Spine in the Scene Editor (or remove the effect) before shipping.',
			);
		}
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

	// Invisible Win Text templates (what the game says about a win). Pure config, no assets — so
	// like `symbols.winLine` it travels verbatim with no export/pull step. The doc holds SOURCE
	// templates; their translations ride `localization.messages` above (a template IS its catalog
	// key), and the engine resolves template → translation → interpolation at render.
	// Absent/unauthored is normal and stays `undefined` so the bundle is byte-identical for every
	// project with no win-text work (`bakedWinText()` then yields the coded defaults — parity).
	let winText;
	if (!dryRun) {
		try {
			const wtRes = await fetchRetry(
				`${base}/api/win-text/doc?project=${encodeURIComponent(project)}` +
					`&k=${encodeURIComponent(token)}`,
				undefined,
				'win-text fetch',
			);
			if (wtRes.ok) {
				const wt = await wtRes.json();
				// Only ship a doc that actually authors something: the endpoint returns `{version:1}`
				// for a never-authored project, which would otherwise add a no-op key to the bundle.
				const authored =
					wt?.doc && Object.keys(wt.doc).some((k) => k !== 'version' && k !== 'updatedAt');
				if (authored) winText = wt.doc;
			} else {
				console.warn(`⚠ bake-doc: win-text fetch HTTP ${wtRes.status} — baking without win text.`);
			}
		} catch (err) {
			console.warn(
				`⚠ bake-doc: win-text fetch failed (${err instanceof Error ? err.message : err}) — baking without win text.`,
			);
		}
	}

	// Invisible Game Config — the project's own math contract (symbol dictionary + paytable,
	// paylines, grid, bet modes, cosmetic reel strips). Pure config, no assets, so like win text it
	// travels verbatim with no export/pull step. Absent/unauthored stays `undefined`, which is what
	// keeps an un-authored project byte-identical: `bakedGameConfig()` is then undefined and the game
	// runs its compiled `game/config.ts`. Deliberately NOT seeded from the game-type template default
	// — see the endpoint header. Mirrors the live path in `lib/server/runtimeBundle.ts`.
	let gameConfig;
	if (!dryRun) {
		try {
			const gcRes = await fetchRetry(
				`${base}/api/game-config/doc?project=${encodeURIComponent(project)}` +
					`&k=${encodeURIComponent(token)}`,
				undefined,
				'game-config fetch',
			);
			if (gcRes.ok) {
				const gc = await gcRes.json();
				if (gc?.doc) gameConfig = gc.doc;
			} else {
				console.warn(
					`⚠ bake-doc: game-config fetch HTTP ${gcRes.status} — baking without a game config.`,
				);
			}
		} catch (err) {
			console.warn(
				`⚠ bake-doc: game-config fetch failed (${err instanceof Error ? err.message : err}) — baking without a game config.`,
			);
		}
	}

	// Ship only REACHABLE effects — an orphan/scratch effect that nothing mounts must not reach the
	// game. Keep in sync with apps/launcher-api/src/lib/server/effectReachability.ts
	// (`pruneUnreachableEffects`, the runtime-bundle path) and the render-time guardrail in
	// apps/lines/src/components/Effects.svelte (`isEventReachable`). An effect is REACHABLE iff it is
	// PLACED (a kind:'effect' node's effectId in the scenes, incl. nested in containers + component
	// instances — every referenced ComponentDef is walked, since componentDefs is the transitively-
	// referenced closure), RIG-BOUND (referenced by a rigFx binding), or EVENT-TRIGGERED (a layer with
	// trigger.on==='event' && trigger.eventType). The editor still reads ALL effects from R2; only this
	// embedded bundle list is pruned. Conservative: when uncertain, KEEP.
	if (effects) {
		const collectEffectNodeIds = (nodes, ids) => {
			if (!Array.isArray(nodes)) return;
			for (const n of nodes) {
				if (n.kind === 'effect' && typeof n.effectId === 'string' && n.effectId)
					ids.add(n.effectId);
				else if (n.kind === 'container') collectEffectNodeIds(n.children, ids);
			}
		};
		const placed = new Set();
		for (const sc of Array.isArray(doc.scenes) ? doc.scenes : [])
			collectEffectNodeIds(sc.nodes, placed);
		const defs = [
			...Object.values(data.componentDefs ?? {}),
			...(Array.isArray(data.componentVersions) ? data.componentVersions : []),
		];
		for (const def of defs) collectEffectNodeIds(def?.root?.children, placed);
		const rigBound = new Set();
		for (const binds of Object.values(rigFx ?? {})) {
			for (const b of binds) if (b?.effectId) rigBound.add(b.effectId);
		}
		// A Book-symbol VFX layer of kind 'fx' — and the explosion transition, when it is one — references
		// an effect by `effectId`: a FOURTH reachability source (alongside placed / rig-bound /
		// event-triggered), so the effect must NOT be pruned as an orphan. The runtime path does the same
		// via `pruneUnreachableEffects`'s `extraReachable` arg (effectReachability.ts + runtimeBundle.ts)
		// — keep the two keep-sets in sync.
		const symbolDocBound = new Set();
		for (const slot of ['background', 'foreground']) {
			const layer = symbols.bookVfx?.[slot];
			if (layer && layer.kind === 'fx' && typeof layer.effectId === 'string' && layer.effectId) {
				symbolDocBound.add(layer.effectId);
			}
		}
		const transitionLayer = symbols.transition;
		if (
			transitionLayer &&
			transitionLayer.kind === 'fx' &&
			typeof transitionLayer.effectId === 'string' &&
			transitionLayer.effectId
		) {
			symbolDocBound.add(transitionLayer.effectId);
		}
		const isEventReachable = (d) =>
			Array.isArray(d.layers) &&
			d.layers.some((l) => l.trigger?.on === 'event' && !!l.trigger?.eventType);
		const prunedIds = [];
		effects = effects.filter((d) => {
			const keep =
				placed.has(d.id) || rigBound.has(d.id) || symbolDocBound.has(d.id) || isEventReachable(d);
			if (!keep) prunedIds.push(d.id);
			return keep;
		});
		if (prunedIds.length) {
			console.info(
				`[bake] pruned ${prunedIds.length} unreachable effect(s): [${prunedIds.join(', ')}]`,
			);
		}
		// All effects pruned ⇒ omit the key entirely so the bundle stays byte-identical to a no-FX game.
		if (effects.length === 0) effects = undefined;
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
		// The project's own sound library (Invisible Sound). Always present, like `fonts`: an empty
		// catalog costs ~30 bytes and `bakedSoundBanks` turns it into no banks at all, so a project
		// with no sounds of its own behaves exactly as before (parity).
		sounds,
		// The authored win-text templates (Invisible Win Text). Omitted unless the project
		// authored something, keeping the bundle byte-identical for every game with no win-text
		// work — `bakedWinText()` applies the coded defaults when absent (parity).
		...(winText ? { winText } : {}),
		// The authored game config (Invisible Game Config). Omitted unless the project authored one,
		// keeping the bundle byte-identical for every game that hasn't — `bakedGameConfig()` is then
		// undefined and the game runs its compiled `game/config.ts` (parity).
		...(gameConfig ? { config: gameConfig } : {}),
		// The authored presentation graph (Invisible Flow). Omitted unless the project
		// authored a non-empty flow, keeping the bundle byte-identical for every game
		// with no flow work — the §7 fall-through (absent ⇒ interpreter inert).
		...(flow ? { flow } : {}),
		// The authored Invisible Flow **v2** graph + its shared function library. Omitted
		// unless the project authored a non-empty v2 flow — absent ⇒ v2 stays inert and the
		// v1/coded path owns (parity). This is what a flow-v2 game needs to drive its
		// screens; matches the online runtime bundle (`runtimeBundle.ts`).
		...(flowV2 ? { flowV2 } : {}),
		...(flowV2 && flowV2Library ? { flowV2Library } : {}),
		...(cinematics ? { cinematics } : {}),
		// The authored particle effects (Invisible FX). Omitted unless the project
		// authored ≥1 effect, keeping the bundle byte-identical for every game with no
		// FX work — `bakedEffects()` returns [] when absent (parity, §8).
		...(effects ? { effects } : {}),
		// Rig-timeline direct FX bindings (a rig's own animation events → effects). Omitted unless a
		// rig has ≥1 bound event — `bakedRigFx()` returns {} when absent, so `resolveRigFx()` yields
		// [] and nothing new mounts (parity).
		...(rigFx ? { rigFx } : {}),
		// The authored frame animations (Invisible Flipbook). Omitted unless the project authored
		// ≥1 clip, keeping the bundle byte-identical for every game with no flipbook work —
		// `bakedFlipbooks()` returns [] when absent (parity).
		...(flipbooks ? { flipbooks } : {}),
		// Rig-timeline direct CLIP bindings — the frame-animation twin of `rigFx`, on the same
		// omit-when-empty rule: `bakedRigFlipbooks()` returns {} when absent, so
		// `resolveRigFlipbooks()` yields [] and nothing new mounts (parity).
		...(rigFlipbooks ? { rigFlipbooks } : {}),
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
	const flowV2Note = flowV2
		? ` flowV2={${flowV2.nodes?.length ?? Object.keys(flowV2.nodes ?? {}).length ?? 0} nodes${flowV2Library ? `, lib ${flowV2Library.functions?.length ?? 0} fns` : ''}},`
		: '';
	const effectsNote = effects ? ` effects={${effects.length}},` : '';
	const flipbooksNote = flipbooks ? ` flipbooks={${flipbooks.length}},` : '';
	const highlightNote = symbols.highlight
		? ` highlight=${symbols.highlight.assetKey}/${symbols.highlight.animationName ?? '(first)'},`
		: '';
	const winLineNote = symbols.winLine
		? symbols.winLine.enabled === false
			? ' winLines=OFF,'
			: ' winLines=styled,'
		: '';
	const stackedNote = symbols.stacked
		? ` stacked={${symbols.stacked.symbols.map((s) => `${s.name}×${s.height}`).join('/')}},`
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
				`${highlightNote}${winLineNote}${stackedNote}${settingsNote}${flowNote}${flowV2Note}${effectsNote}${flipbooksNote} ${symbolCount} symbol overrides / ${symbolAssetCount} symbol assets).`,
		);
		return;
	}

	await mkdir(dirname(dest), { recursive: true });
	await writeFile(dest, json);
	console.info(
		`\nBaked ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
			` (${sceneCount} scenes, ${defCount} component defs${pinnedNote}, ${defaultCount} default sets,` +
			` ${artCount} editor-art sheets, ${fontCount} fonts, ${localeCount} locales,` +
			`${highlightNote}${winLineNote}${stackedNote}${settingsNote}${flowNote}${flowV2Note} ${symbolCount} symbol overrides / ${symbolAssetCount} symbol assets).`,
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
