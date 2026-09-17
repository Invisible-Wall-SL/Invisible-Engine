/**
 * WHERE A BUILD'S APPLICATION SOURCE LIVES — the one answer, shared by the SvelteKit config that
 * compiles it and the build scripts that write generated files next to it.
 *
 * Node builtins ONLY, and that is load-bearing: `bake-editor-doc.mjs` imports this by relative
 * path from inside a standalone game repo, where the engine submodule's `node_modules` is never
 * installed (the game's own root install flattens `engine/packages/*` instead). Importing
 * `config-svelte` proper would drag in `@sveltejs/adapter-static` and fail there, which is why the
 * rule lives in its own leaf module rather than in `index.js`.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The engine checkout this module is being loaded FROM. In the monorepo that's the repo root; in a
 * standalone game repo it's the vendored `engine/` submodule, because the game's
 * `pnpm-workspace.yaml` globs `engine/packages/*` and resolves this package out of there.
 */
export const ENGINE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/**
 * The ONE application source every game is built from — the same directory `runtime-release.yml`
 * builds the shared online bundle from, and the same one `publishGame.ts`'s `runtimeFor()` points
 * every online game at. The name is historical: it means "the shared engine game layer", not "the
 * lines game" (the config states the `winModel`, and the payline-specific surfaces stand down for
 * a game that declares another one).
 */
export const ENGINE_APP_SRC = resolve(ENGINE_ROOT, 'apps/lines/src');

/** True when `dir` is the engine checkout itself or anything under it. */
const insideEngine = (dir) => {
	const rel = relative(ENGINE_ROOT, dir);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * True when this build is a STANDALONE game repo (`docs/design/games-deploy.md`) rather than one
 * of the engine's own apps. A game repo vendors the engine at `engine/` and builds from the game's
 * working directory, which is OUTSIDE the engine checkout; an engine app builds from inside it.
 * That difference is the whole signal — nothing to opt into, nothing to keep in step.
 */
export const isStandaloneGame = () => !insideEngine(process.cwd());

/** The `src` directory the build actually compiles: the engine's for a game repo, its own for an
 * engine app. */
export const appSrcDir = () =>
	isStandaloneGame() ? ENGINE_APP_SRC : resolve(process.cwd(), 'src');
