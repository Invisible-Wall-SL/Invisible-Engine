import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { ENGINE_APP_SRC, isStandaloneGame } from './appSrc.js';

/**
 * Say so when a game repo still carries the `src/` copy it was scaffolded with. It is now DEAD —
 * the build compiles the engine's — and a silently ignored directory full of plausible game code
 * is the one way this change could mislead someone: they would edit a component, rebuild, and see
 * nothing happen. Every repo scaffolded before this change has one, so this is a notice rather
 * than an error; `git rm -r src` is the whole migration.
 */
let noticed = false;
const warnAboutDeadSrc = () => {
	// SvelteKit loads this config several times per build (sync, build, prerender) and some of
	// those are child processes, so this collapses the repeats within a process but not across
	// them — measured at 3 notices for one build, down from 4. A process-wide latch (an env var
	// the children inherit) would get it to 1, but `turbo/no-undeclared-env-vars` rightly asks for
	// any env var to be declared in turbo.json, and declaring this one would record a build INPUT
	// that does not exist. A repeated note is the cheaper untruth — and it is transitional anyway,
	// since it stops the moment the repo drops its dead src/.
	if (noticed) return;
	const dead = resolve(process.cwd(), 'src/routes');
	if (!existsSync(dead)) return;
	noticed = true;
	console.info(
		`[config-svelte] NOTE: this repo's src/ is NOT built — the game layer is compiled from ` +
			`${ENGINE_APP_SRC}, so every build is on the engine the submodule is at. The leftover ` +
			`src/ is a scaffold-time copy and can be deleted (git rm -r src).`,
	);
};

/**
 * Shared SvelteKit config.
 *
 * WHY A GAME REPO'S `kit.files` POINTS AT THE ENGINE: a standalone game repo used to carry its OWN
 * copy of `apps/lines/src`, stamped into it by `scripts/new-game.mjs` at scaffold time. That copy
 * was a SNAPSHOT and nothing ever refreshed it — the desktop launcher's publish advances the
 * `engine/` submodule to `origin/main` before every build, so `packages/*` were current while the
 * game layer stayed frozen at whatever the engine looked like the day the repo was scaffolded. 53
 * of the last 60 engine commits touched `apps/lines/src`, so in practice "build from the desktop"
 * meant "ship a months-old game on a current set of packages", and the two publish paths — the
 * shared online runtime bundle and a desktop build — stopped being two views of one game, which is
 * the entire premise of having both.
 *
 * So a game repo no longer HAS application source. It contributes its identity (which portal
 * project, which client), its `static/` and its lockfile; the code is the engine's, read straight
 * out of the submodule the publish just advanced to `main`. Latest by construction, rather than
 * latest if somebody remembered to re-seed.
 *
 * It lives HERE rather than in each game's `svelte.config.js` for the reason `config-vite` states
 * about the delivery profile: anything a game has to opt into by hand is something a build can be
 * cut without. Every game repo's `svelte.config.js` is `import config from 'config-svelte'`, which
 * resolves THROUGH the submodule — so this reaches repos scaffolded long before it existed, with
 * no per-repo commit, no launcher release and no `.exe` rebuild.
 *
 * `files.assets` is deliberately NOT redirected: `static/` is the game's own, mirrored from R2 by
 * `pull:assets` (`docs/design/live-assets.md`).
 */
/**
 * HOW A GAME BUILD SHIPS: a small `index.html` SHELL plus `_app/immutable/bundle.<hash>.js`, an ES
 * module the shell imports, for every build.
 *
 * The shell is what changes on a release, and it is served `no-store`; the bundle and every chunk
 * beside it are content-hashed under `_app/immutable/`, served long-cached and immutable, so the
 * only code a repeat visit downloads is the shell. Until 2026-11 the default was 'inline', which
 * copied the whole bundle INTO the HTML: one droppable file, but ~700 KB gz re-downloaded on every
 * visit because the page itself cannot be cached.
 *
 * 'single' is SvelteKit's one-file bundle. `config-vite` (`lazyChunks.js`) lets its dynamic
 * imports become their own chunks for every build except an embed, so code a boot may never reach
 * (the error-reporting SDK, Pixi's fallback renderers) is fetched only when it is.
 *
 * Every URL is relative (`./_app/…`) and every chunk and asset resolves against `import.meta.url`,
 * so the build still works from any folder it is dropped in.
 *
 * EMBED mode (`PUBLIC_DELIVERY_EMBED=1`) is the build a partner's page loads with a `<script src>`.
 * It has no HTML of ours: their server-rendered page, already inside iframes they do not control,
 * includes `game.js` (`scripts/build-embed.mjs`, generated from the shell) and gives us a container
 * div. Its bundle stays ONE file, dynamic imports inlined: the partner uploads a folder per
 * `versionPath`, and one file is the contract we documented. Its assets follow `import.meta.url` to
 * `{cdn}/{brand}/games/{versionPath}/{gameAlias}/`, which is what makes their `versionPath`
 * cache-buster work. See `docs/design/delivery-builds.md`.
 */
export default () => {
	const kit = {
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter(),
		output: {
			bundleStrategy: 'single',
		},
	};

	const game = isStandaloneGame();
	if (game) warnAboutDeadSrc();

	return {
		// Consult https://kit.svelte.dev/docs/integrations#preprocessors
		// for more information about preprocessors
		preprocess: vitePreprocess(),
		kit: game
			? {
					...kit,
					files: {
						routes: `${ENGINE_APP_SRC}/routes`,
						appTemplate: `${ENGINE_APP_SRC}/app.html`,
						hooks: {
							server: `${ENGINE_APP_SRC}/hooks.server`,
							client: `${ENGINE_APP_SRC}/hooks.client`,
						},
					},
				}
			: kit,
	};
};
