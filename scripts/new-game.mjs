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
 *        [--dir "C:/Invisible Wall SL/Projects/iGaming/<client>"] [--port 3003]
 *
 * What it does (all mechanical, all reversible — it only writes a fresh dir):
 *   1. mkdir <dir>/<slug>, git init
 *   2. add this engine as the `engine/` submodule (Invisible-Engine, branch main)
 *   3. write the engine-consumption wiring (pnpm-workspace, package.json with
 *      workspace:* engine deps, svelte/vite config extending the engine configs,
 *      tsconfig, .gitignore, app.html, a minimal runnable route)
 *   4. print the next steps (pnpm install, add the GitHub remote, deploy)
 *
 * It deliberately does NOT copy a full game's src/ — start from the minimal
 * route it writes, or copy src/ from an existing game once the repo is up.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_URL = 'https://github.com/Invisible-Wall-SL/Invisible-Engine.git';
const DEFAULT_PARENT = 'C:/Invisible Wall SL/Projects/iGaming';

function arg(flag, fallback) {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const name = arg('--name');
if (!name) {
	console.error(
		'Usage: node scripts/new-game.mjs --name "Book of Foo" [--slug ...] [--dir ...] [--port 3003]',
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

if (existsSync(dest)) {
	console.error(`✗ ${dest} already exists — choose another --slug or --dir.`);
	process.exit(1);
}

const ENGINE_PACKAGES = [
	'envs',
	'rgs-requests',
	'rgs-translator-eagaming',
	'engine-layout',
	'engine-flow',
	'engine-flow-v2',
	'engine-fx',
	'pixi-svelte',
	'state-shared',
	'constants-shared',
	'components-storybook',
	'components-shared',
	'components-layout',
	'components-ui-html',
	'components-pixi',
	'components-ui-pixi',
	'utils-event-emitter',
	'utils-shared',
	'utils-xstate',
	'utils-slots',
	'utils-book',
	'utils-bet',
	'utils-layout',
	'utils-sound',
];
const ENGINE_CONFIGS = [
	'eslint-config-custom',
	'config-ts',
	'config-vite',
	'config-svelte',
	'config-lingui',
	'config-storybook',
];

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
					//     `${slug}/${slug}` — change it if your launcher client ≠ slug).
					//   • bake:doc → /api/editor/doc wants the bare `<projectKey>` (the
					//     launcher DB-resolves the client), defaults to `${slug}`.
					// Set both to your real launcher project key (e.g. client `borut`,
					// project `bookofborut` → `borut/bookofborut` for pull, `bookofborut`
					// for bake).
					//   build:engine — rebuild engine workspace dists so engine SOURCE
					//                  changes reach this bundle (gotcha-game-build-stale-engine-dist)
					//   bake:doc     — freeze the editor layout + custom component defs into
					//                  src/baked-editor-bundle.json (no runtime fetch) AND export
					//                  the doc-referenced art + project fonts into R2 deploy/
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
					'pull:assets': `node ./engine/apps/launcher-api/scripts/pull-project-assets.mjs --project ${slug}/${slug} --dest ./static/assets`,
					'bake:doc': `node ./engine/apps/launcher-api/scripts/bake-editor-doc.mjs --project ${slug} --dest ./src/baked-editor-bundle.json`,
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
					// to `${slug}/${slug}` — fix it alongside pull:assets). See the README.
					'publish:storybook': `node ./engine/apps/launcher-api/scripts/publish-storybook.mjs --project ${slug}/${slug} --dir storybook-static`,
					build:
						'pnpm build:engine && pnpm bake:doc --optional && pnpm pull:assets --optional && pnpm publish:symbols --optional && vite build',
					preview: 'vite preview',
					lint: 'eslint "src"',
					format: 'prettier --write --ignore-path=./engine/.prettierignore .',
				},
				devDependencies: {
					eslint: '9.21.0',
					'@sveltejs/vite-plugin-svelte': '5.0.3',
					'cross-env': '7.0.3',
					...Object.fromEntries(ENGINE_CONFIGS.map((p) => [p, 'workspace:*'])),
				},
				dependencies: {
					// Match the engine packages (they all declare 5.35.1) and therefore the
					// pnpm.overrides below — svelte and its parser/printer are ONE set. A stale
					// 5.20.5 here paired with the engine's esrap fails on kit's own error.svelte
					// with "Not implemented: Program".
					svelte: '5.35.1',
					vite: '6.2.0',
					'@sveltejs/kit': '2.17.3',
					'@lingui/core': '5.2.0',
					...Object.fromEntries(ENGINE_PACKAGES.map((p) => [p, 'workspace:*'])),
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
				'rgs-requests': resolve(here, './engine/packages/rgs-translator-eagaming/stake-facade.ts'),
			},
		};
	}

	return mergeConfig(cfg, overrides);
});
`,

	// Resolve config-ts by PACKAGE NAME (it's a workspace dep), the same way every
	// shipped game does. A relative `./engine/packages/config-ts/svelte.json` path was
	// wrong twice over: that file does not exist (the package ships `base.json`), and
	// vite:esbuild fails the build outright on an unresolvable `extends`.
	'tsconfig.json':
		JSON.stringify(
			{
				extends: 'config-ts/base.json',
				include: ['.'],
				exclude: ['dist', 'build', 'node_modules'],
			},
			null,
			'\t',
		) + '\n',

	'.env.example': `# Copy to .env. Point at your RGS / mock as needed.\n# PUBLIC_RGS_TRANSPORT=play4fun\n`,

	'src/app.html': `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display:contents">%sveltekit.body%</div>
	</body>
</html>
`,

	'src/routes/+layout.svelte': `<script>\n\tlet { children } = $props();\n</script>\n\n{@render children()}\n`,

	// REQUIRED by adapter-static (config-svelte's adapter): without `prerender` the
	// build fails at the adapter step with "Encountered dynamic routes". `ssr = false`
	// because the game is a client-rendered pixi canvas. Same file every shipped game has.
	'src/routes/+layout.ts': `// Emit a static html file for the page.
// https://kit.svelte.dev/docs/page-options#prerender
export const prerender = true;

// The game is a client-side pixi canvas — there is nothing to server-render.
// https://kit.svelte.dev/docs/page-options#ssr
export const ssr = false;

// https://kit.svelte.dev/docs/page-options#trailingslash
export const trailingSlash = 'ignore';
`,

	'src/routes/+page.svelte': `<script>\n\t// Minimal placeholder. Replace with the game's root component, or copy\n\t// src/ from an existing game (e.g. Book of Borut) to start from real code.\n</script>\n\n<h1>${name}</h1>\n<p>Engine submodule wired. Fill in src/ to build the game.</p>\n`,

	'README.md': `# ${name}

Standalone game. The Invisible engine is vendored as the \`engine/\` git submodule
(pinned to a commit on \`main\`) — see \`docs/design/games-deploy.md\` in the engine.

## Setup
\`\`\`bash
git clone --recurse-submodules <this repo url>
# or, after a plain clone:
git submodule update --init --recursive
pnpm install
pnpm dev          # http://localhost:${port}
\`\`\`

## Bump the engine (when you choose to take new engine work)
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
run('git init -q');
console.log('Adding engine submodule (this clones the engine — may take a minute)…');
run(`git submodule add -b main ${ENGINE_URL} engine`);

for (const [rel, content] of Object.entries(files)) {
	const p = join(dest, rel);
	mkdirSync(join(p, '..'), { recursive: true });
	writeFileSync(p, content);
}

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

To start from real game code instead of the placeholder route, copy src/ from an
existing game (e.g. Book of Borut) and adjust package.json deps to match.
`);
