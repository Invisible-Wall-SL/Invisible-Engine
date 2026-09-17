#!/usr/bin/env node
/**
 * Scaffold a new STANDALONE game repo that consumes this engine as a submodule.
 *
 * This is the "spin one up" automation for the games-deploy model documented in
 * docs/design/games-deploy.md: shipped games live in their OWN repo + deploy on
 * their OWN cadence, pinning a known-good engine commit via a git submodule.
 *
 * Usage:
 *   node scripts/new-game.mjs --name "Book of Foo" [--slug book-of-foo] \
 *        [--dir "C:/Invisible Wall SL/Projects/iGaming/<client>"] [--port 3003] \
 *        [--client <launcherClientKey>]
 *
 * What it does (all mechanical, all reversible — it only writes a fresh dir):
 *   1. mkdir <dir>/<slug>, git init (on `main`)
 *   2. add this engine as the `engine/` submodule (Invisible-Engine, branch main)
 *   3. write the engine-consumption wiring (pnpm-workspace, package.json with
 *      workspace:* engine deps, svelte/vite config extending the engine configs,
 *      tsconfig, .gitignore)
 *   4. seed `static/` from `apps/lines` — the default audio + bitmap fonts a game
 *      boots with before `pull:assets` mirrors the project's own over the top
 *   5. print the next steps (pnpm install, add the GitHub remote, deploy)
 *
 * THE REPO HAS NO `src/`, AND THAT IS THE POINT. It used to get a full copy of
 * `apps/lines/src`, so that it would build a real game rather than the placeholder
 * route the first version wrote. But a copy is a snapshot: the desktop launcher
 * advances `engine/` to `origin/main` before every build, so `packages/*` stayed
 * current while the game layer stayed frozen at scaffold day — and 53 of the last 60
 * engine commits touch `apps/lines/src`. Every scaffolded game silently shipped a
 * months-old engine. Now `config-svelte` points `kit.files` straight at the
 * submodule's `apps/lines/src` (see `packages/config-svelte/appSrc.js`), so the game
 * layer is the engine's, current by construction, and a desktop build and the shared
 * online runtime bundle are once again the same code.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_URL = 'https://github.com/Invisible-Wall-SL/Invisible-Engine.git';
const DEFAULT_PARENT = 'C:/Invisible Wall SL/Projects/iGaming';
const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The app a new game is BUILT FROM — ALWAYS `lines`, for EVERY game kind, and that is a
 * decision rather than a gap. Same reasoning `runtimeFor()` encodes in
 * `apps/launcher-api/src/lib/server/publishGame.ts`: `apps/ways`, `apps/cluster` and
 * `apps/scatter` are still the vanilla upstream samples — no flow-v2 interpreter, no editor
 * scenes, no symbols registry, no game-config resolver — so seeding a ways game from
 * `apps/ways` would not give you a ways game, it would give you a broken one. `apps/lines`
 * carries the whole engine and ADAPTS: the config states its `winModel`, payline-specific
 * surfaces stand down for a non-lines model, and a Book-of game is `apps/lines` plus a
 * bookOf scene set.
 *
 * Keep in lock-step with `runtimeFor` AND with `config-svelte/appSrc.js`, which is what
 * actually points a game repo's build at `apps/<SEED_APP>/src`. A standalone build and the
 * shared runtime bundle must be the SAME code, or "publish it online" and "publish a fixed
 * build" stop being two views of one game — which is the entire premise of having both.
 */
const SEED_APP = 'lines';

/**
 * Copied wholesale from the seed app. `static/` carries the default audio + bitmap fonts the
 * game boots with before `pull:assets` mirrors the project's own over the top, and it is the
 * ONLY thing copied: `src/` is read live from the submodule (see the header note), and the
 * configs (`vite.config.js`, `svelte.config.js`, `tsconfig.json`, `package.json`) reach the
 * engine by monorepo-relative paths (`../../packages/…`) whereas a standalone repo vendors it
 * at `./engine/` — the scaffolder writes its own and they must win.
 */
const SEED_DIRS = ['static'];

function arg(flag, fallback) {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const name = arg('--name');
if (!name) {
	console.error(
		'Usage: node scripts/new-game.mjs --name "Book of Foo" [--slug ...] [--dir ...]\n' +
			'       [--port 3003] [--client <launcherClientKey>]',
	);
	process.exit(1);
}
const slug = arg(
	'--slug',
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, ''),
);
const parent = arg('--dir', DEFAULT_PARENT);
const port = arg('--port', '3003');
const dest = join(parent, slug);
// The launcher CLIENT this project belongs to. `pull:assets` and `publish:storybook` hit
// /api/deploy, which is keyed `<client>/<project>` — and this defaulted to `${slug}/${slug}`
// with a comment saying to change it. Nothing ever did, so a scaffolded game asked the deploy
// endpoint for a client that does not exist and the publish died on "no deploy assets for
// <slug>/<slug> — has the atlas been deployed?". The caller knows the client; let it say so.
const client = arg('--client', slug);

if (existsSync(dest)) {
	console.error(`✗ ${dest} already exists — choose another --slug or --dir.`);
	process.exit(1);
}

/**
 * The new game's dependencies are DERIVED from the seed app's package.json, never
 * hand-listed here. Two hardcoded arrays used to live at this spot and both rotted: they
 * still named `config-ts` months after #533 deleted it (so `pnpm install` refused the whole
 * workspace), and they never gained `engine-game` or `game-config` (so the seeded game
 * failed to resolve its own imports at build time). A copied list of another package's
 * dependencies has no way to notice the original changed.
 *
 * Taking `apps/<SEED_APP>/package.json` wholesale — workspace deps at `workspace:*`, external
 * deps at the versions that app pins — is what makes "this repo builds the same game" true by
 * construction rather than by vigilance. It is the same rule the launcher applies elsewhere:
 * derive the list from the ONE place that owns it.
 */
function seedAppManifest() {
	const p = join(ENGINE_ROOT, 'apps', SEED_APP, 'package.json');
	if (!existsSync(p)) {
		console.error(`✗ cannot read ${p} — the scaffolder needs it to know what a game depends on.`);
		process.exit(1);
	}
	return JSON.parse(readFileSync(p, 'utf8'));
}

const seedPkg = seedAppManifest();
const SEED_DEPS = seedPkg.dependencies ?? {};
const SEED_DEV_DEPS = seedPkg.devDependencies ?? {};

const files = {
	'.gitignore': `node_modules\n/build\n/.svelte-kit\n/dist\n.env\n.env.*\n!.env.example\n`,

	'pnpm-workspace.yaml': `packages:\n  - "engine/packages/*"\n  - "."\n`,

	'package.json':
		JSON.stringify(
			{
				name: slug,
				version: '0.0.0',
				private: true,
				license: 'MIT',
				type: 'module',
				scripts: {
					dev: `vite dev --host --port ${port}`,
					// Engine packages (pixi-svelte, engine-layout) are consumed via their
					// gitignored, pre-built dist/, which `vite build` never rebuilds — so
					// engine SOURCE changes wouldn't reach this game's bundle. build:engine
					// recompiles the game's workspace deps (topological; only the ~2 that
					// emit a dist) first. See docs/design/live-assets.md + the
					// gotcha-game-build-stale-engine-dist memo.
					// `build` chains the full editor pipeline below. Every step is a SAFE
					// NO-OP until the project has data + EDITOR_DOC_SECRET in the build env
					// (the `--optional` flags warn loudly and keep the checked-in copies
					// instead of failing the build) — so a brand-new game builds green, and
					// each capability "just works" the moment its data exists, with no
					// per-game wiring to remember. Set EDITOR_DOC_SECRET in the build env to
					// activate them. ⚠ The two endpoints take DIFFERENT project keys:
					//   • pull:assets → /api/deploy wants `<client>/<project>` (defaults to
					//     `${client}/${slug}`, from --client; defaults to the slug when not given).
					//   • bake:doc → /api/editor/doc wants the bare `<projectKey>` (the
					//     launcher DB-resolves the client), defaults to `${slug}`.
					// Set both to your real launcher project key (e.g. client `borut`,
					// project `bookofborut` → `borut/bookofborut` for pull, `bookofborut`
					// for bake).
					//   build:engine — rebuild engine workspace dists so engine SOURCE
					//                  changes reach this bundle (gotcha-game-build-stale-engine-dist)
					//   bake:doc     — freeze the editor layout + custom component defs into
					//                  baked-editor-bundle.json beside the app source the build
					//                  compiles (no runtime fetch) AND export the doc-referenced
					//                  art + project fonts into R2 deploy/. No --dest: the script
					//                  puts it where editor-scenes.ts imports it from.
					//   pull:assets  — mirror the R2 deploy/ art + fonts into static/assets/
					//                  (live-assets.md). MUST run AFTER bake:doc — the export it
					//                  triggers is what populates deploy/ for this same build.
					//   publish:symbols — publish this game's coded SYMBOL_INFO_MAP to R2 so the
					//                  Invisible Symbols State Machine tool drives its grid from
					//                  THIS project's symbols (not the committed lines fallback).
					//                  Independent of bake/pull; safe no-op without a token
					//                  (--optional). Runs under `node --experimental-strip-types`
					//                  because it imports the game's TS symbol-map module.
					'build:engine': `pnpm --filter "${slug}^..." run build`,
					'pull:assets': `node ./engine/apps/launcher-api/scripts/pull-project-assets.mjs --project ${client}/${slug} --dest ./static/assets`,
					'bake:doc': `node ./engine/apps/launcher-api/scripts/bake-editor-doc.mjs --project ${slug}`,
					'publish:symbols': `node --experimental-strip-types ./engine/apps/launcher-api/scripts/publish-symbol-defaults.mjs --project ${slug}`,
					// publish:storybook — upload an already-built storybook-static/ to
					// `<client>/<project>/storybook/` so the launcher's Invisible Storybook
					// tool serves it. NOT runnable out of the box: the scaffold writes no
					// .storybook/ config (build the storybook here once you add one, or
					// build it elsewhere and pass --dir), and the publish script needs
					// @aws-sdk/client-s3 resolvable from this repo (pnpm add -D
					// @aws-sdk/client-s3) — the engine submodule never installs
					// apps/launcher-api's deps. Needs R2_* creds in the env and, like
					// pull:assets, the launcher project key `<client>/<project>` (defaults
					// to `${client}/${slug}`, same as pull:assets). See the README.
					'publish:storybook': `node ./engine/apps/launcher-api/scripts/publish-storybook.mjs --project ${client}/${slug} --dir storybook-static`,
					build:
						'pnpm build:engine && pnpm bake:doc --optional && pnpm pull:assets --optional && pnpm publish:symbols --optional && vite build',
					// A build for a PARTNER to host (docs/design/delivery-builds.md). Both of these are
					// thin aliases for engine scripts, deliberately: a repo scaffolded today keeps
					// whatever these lines said today, so any real logic here would be frozen at
					// scaffold time. Living in the engine, they reach every game the moment its
					// submodule advances — and a repo scaffolded BEFORE they existed can run the same
					// scripts by path, with no package.json change at all.
					'build:delivery': 'node ./engine/scripts/build-delivery.mjs',
					// Play that delivery build the way the partner's page will load it — there is no
					// other way to open one, since it reads its session from `window.params`. Pass
					// --sid <token> --rgs <origin> to play against a real node.
					'serve:delivery': 'node ./engine/scripts/serve-embed.mjs build',
					preview: 'vite preview',
					format: 'prettier --write --ignore-path=./engine/.prettierignore .',
				},
				devDependencies: { ...SEED_DEV_DEPS },
				dependencies: {
					// Match the engine packages (they all declare 5.35.1) and therefore the
					// pnpm.overrides below — svelte and its parser/printer are ONE set. A stale
					// 5.20.5 here paired with the engine's esrap fails on kit's own error.svelte
					// with "Not implemented: Program".
					...SEED_DEPS,
				},
				// Svelte depends on its parser/printer through CARET ranges, and a brand-new
				// standalone repo has no lockfile — so a fresh install floats them to the
				// newest release while the engine monorepo stays on what its committed
				// lockfile resolved. That drift is not cosmetic: esrap 2.3.0 prints the
				// TypeScript optional-parameter marker into compiled JS (`function f(x?)`),
				// which is invalid JavaScript, and rollup dies with "Expected ',', got '?'"
				// on any component using a typed snippet parameter. Pin them to the versions
				// the engine builds against; re-check these when bumping svelte.
				pnpm: {
					overrides: {
						esrap: '2.0.1',
						acorn: '8.15.0',
						'@sveltejs/acorn-typescript': '1.0.5',
					},
				},
			},
			null,
			'\t',
		) + '\n',

	'svelte.config.js': `// @ts-ignore\nimport config from 'config-svelte';\n\nexport default config();\n`,

	// REQUIRED, not optional: `config-vite` always registers the lingui() plugin, which
	// aborts the build with "No Lingui config found" when this file is absent. Same
	// one-liner every shipped game uses.
	'lingui.config.ts': `import config from 'config-lingui';\n\nexport default config;\n`,

	'vite.config.js': `// Don't convert this to a .ts file (https://github.com/vitejs/vite/issues/5370)
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import baseConfig from 'config-vite';
import { defineConfig, mergeConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
	const cfg = baseConfig();

	// Engine packages live under engine/ (the submodule) and resolve some
	// transitive deps through engine's own pnpm store, outside this project root —
	// open Vite's fs.allow to engine/ so it can serve them.
	const overrides = {
		server: { fs: { allow: [here, resolve(here, 'engine')] } },
		// Invisible Debug build switch (docs/design/invisible-debug-framework.md).
		// On during dev + when PUBLIC_IE_DEBUG=1 (debug publish); a static false
		// otherwise, so the debug framework + tools tree-shake out of player builds.
		define: {
			__IE_DEBUG__: JSON.stringify(
				mode !== 'production' || process.env.PUBLIC_IE_DEBUG === '1',
			),
		},
	};

	// Optional Play4Fun transport, same switch the engine games use.
	if (process.env.PUBLIC_RGS_TRANSPORT === 'play4fun') {
		overrides.resolve = {
			alias: {
				'rgs-requests': resolve(here, './engine/packages/rgs-translator-eagaming/engine-facade.ts'),
			},
		};
	}

	return mergeConfig(cfg, overrides);
});
`,

	// Extend the engine's ROOT TS base by relative path. This used to resolve
	// `config-ts/base.json` by package name, which stopped existing when #533 deleted that
	// package precisely so the shared options would need no dependency edge. The base sets
	// no `baseUrl` and declares no `paths`, so reaching it from one level above the engine
	// resolves exactly as `apps/lines`'s `../../tsconfig.base.json` does.
	//
	// It must be a path that RESOLVES: vite:esbuild fails the build outright on an
	// unresolvable `extends`, which is how the old package-name form turned a deleted
	// package into a broken build rather than a warning.
	'tsconfig.json':
		JSON.stringify(
			{
				extends: './engine/tsconfig.base.json',
				include: ['.'],
				exclude: ['dist', 'build', 'node_modules'],
			},
			null,
			'\t',
		) + '\n',

	'.env.example': `# Copy to .env. Point at your RGS / mock as needed.\n# PUBLIC_RGS_TRANSPORT=play4fun\n`,

	'README.md': `# ${name}

Standalone game. The Invisible engine is vendored as the \`engine/\` git submodule
— see \`docs/design/games-deploy.md\` in the engine.

**This repo has no \`src/\`.** The game layer is read from
\`engine/apps/lines/src\` at build time (\`config-svelte\` points SvelteKit's
\`kit.files\` there), so a build is always on the engine the submodule is at — it
cannot fall behind. What this repo owns is the project's identity, its
\`static/\` boot assets and the lockfile; the game itself is authored online
(scenes, flow, symbols, sounds, config) and baked in at build time.

## Setup
\`\`\`bash
git clone --recurse-submodules <this repo url>
# or, after a plain clone:
git submodule update --init --recursive
pnpm install
pnpm dev          # http://localhost:${port}
\`\`\`

## Move the engine pin
The desktop launcher's publish advances the submodule to \`origin/main\` before
every build, so a published build is always current without this. Use it to move
the COMMITTED pin (what a plain \`git clone\` + \`pnpm build\` here gets).

This repo's \`pnpm-workspace.yaml\` globs \`engine/packages/*\`, so the root
\`pnpm-lock.yaml\` pins the engine packages' deps. The pin and the lockfile MUST
move together — bumping the pin alone breaks the launcher's frozen install
(\`ERR_PNPM_OUTDATED_LOCKFILE\`). Use the engine's helper, which does both atomically:
\`\`\`bash
node engine/scripts/bump-game-engine.mjs        # advances engine + refreshes lockfile, one commit
git push origin main
\`\`\`

## Build / deploy
\`\`\`bash
pnpm build        # -> build/  (deploy this; its own target, own cadence)
\`\`\`

## Storybook publishing (optional)
\`pnpm publish:storybook\` uploads a built \`storybook-static/\` to the launcher's
Invisible Storybook tool. It needs (a) a \`.storybook/\` config in this repo to
produce the build (or build elsewhere and pass \`--dir <path>\`), and (b)
\`pnpm add -D @aws-sdk/client-s3\` here, since the engine submodule does not
install the publish script's own deps. R2_* creds in the env, as with assets.
`,
};

console.log(`Scaffolding "${name}" → ${dest}`);
mkdirSync(dest, { recursive: true });

const run = (cmd) => execSync(cmd, { cwd: dest, stdio: 'inherit' });
// `-b main` explicitly: a bare `git init` takes the branch from the MACHINE's
// `init.defaultBranch`, which is unset by default and makes git fall back to `master`.
// The repo `gh repo create --push` then publishes is a `master` repo, and every desktop
// launcher build of it died on `fatal: couldn't find remote ref main` — the whole toolchain
// downstream (the launcher's presync, this file's own `git submodule add -b main`) assumes
// `main`. The scaffolder is the one place that can make that true instead of hoping for it.
run('git init -q -b main');
console.log('Adding engine submodule (this clones the engine — may take a minute)…');
run(`git submodule add -b main ${ENGINE_URL} engine`);

for (const [rel, content] of Object.entries(files)) {
	const p = join(dest, rel);
	mkdirSync(join(p, '..'), { recursive: true });
	writeFileSync(p, content);
}

// Seed the BOOT ASSETS. Only `static/` is copied — the application source is read live from
// the submodule (see the header note), so there is nothing here that can go stale. The
// standalone wiring is never at risk either: every standalone-specific file the scaffolder
// writes (package.json, vite/svelte/tsconfig, pnpm-workspace) sits at the repo ROOT.
const seedFrom = join(ENGINE_ROOT, 'apps', SEED_APP);
if (!existsSync(seedFrom)) {
	console.error(`✗ cannot seed boot assets: ${seedFrom} is missing.`);
	process.exit(1);
}
for (const dir of SEED_DIRS) {
	const src = join(seedFrom, dir);
	if (!existsSync(src)) continue;
	cpSync(src, join(dest, dir), { recursive: true });
}
console.log(
	`✓ Seeded ${SEED_DIRS.join(' + ')}/ from apps/${SEED_APP}.\n` +
		`  The game layer itself is read from engine/apps/${SEED_APP}/src at build time, so this ` +
		`repo\n  cannot fall behind the engine.`,
);

console.log(`
✓ Scaffolded ${slug} at:
    ${dest}

Next steps:
  1. cd "${dest}"
  2. pnpm install
  3. pnpm dev            # http://localhost:${port}
  4. Create the GitHub repo and push:
       gh repo create Invisible-Wall-SL/${slug} --private --source . --remote origin
       git add -A && git commit -m "games: scaffold ${slug} (engine submodule)"
       git push -u origin main
  5. Point a deploy target (Railway/static host) at this repo's build/.

This repo has no src/ — the game layer is read from engine/apps/lines/src at build
time, so it can never fall behind the engine. Author the game online (scenes, flow,
symbols, sounds, config); the build bakes that in and pulls its art from R2.
`);
