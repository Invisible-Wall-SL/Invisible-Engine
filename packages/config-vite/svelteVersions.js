/**
 * Fail a build whose install would MIX Svelte versions, before a single component is compiled.
 *
 * A standalone game repo (`docs/design/games-deploy.md`) builds the engine's code with the engine's
 * config, but installs from its OWN root `package.json`, which `scripts/new-game.mjs` froze at
 * scaffold time. When the engine bumps Svelte and the game repo does not, pnpm installs both: the
 * engine packages' compiler emits code for the new runtime, and the app source (compiled from
 * `engine/apps/lines/src`, which sits outside the game's workspace) imports the game root's old
 * runtime. Nothing fails at build time. The bundle boots to a black screen — Book of Borut Remake
 * died on `TypeError: e.exclude.includes is not a function`, 5.57.1's compiler passing rest-props
 * exclusions as a `Set` to 5.35.1's runtime, which calls `.includes` on them.
 *
 * So the versions the BUILDING project resolves are compared, at config time, with the ones the
 * engine builds with (`apps/lines/package.json`, and for Svelte's parser/printer the engine's
 * `pnpm-lock.yaml`). In the engine's own builds they agree by construction.
 *
 * Node builtins ONLY, like `deliveryProfile.js` beside it: `svelteVersions.fixture.mjs` drives it
 * over fake installs, and `scripts/new-game.mjs` reads the parser pins from it.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Set to `1` to downgrade the error to a warning. */
export const ALLOW_ENV = 'IE_ALLOW_SVELTE_MISMATCH';

/** Svelte reaches these through caret ranges; a game repo pins them with `pnpm.overrides`. */
export const PARSER_PACKAGES = ['esrap', 'acorn', '@sveltejs/acorn-typescript'];

/** The engine checkout this module ships in — in a game repo, the `engine/` submodule. */
export const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const CONFIG_VITE_DIR = fileURLToPath(new URL('.', import.meta.url));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Node's bare-specifier lookup from `fromDir`, minus `exports`: the package dir (symlinks
 * resolved, so two pnpm store entries never look like one) and its version, or null. */
export const findPackage = (name, fromDir) => {
	let dir = resolve(fromDir);
	for (;;) {
		const base = basename(dir) === 'node_modules' ? dir : join(dir, 'node_modules');
		const manifest = join(base, name, 'package.json');
		if (existsSync(manifest)) {
			const real = realpathSync(dirname(manifest));
			return { dir: real, version: readJson(join(real, 'package.json')).version };
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

/** The Svelte + SvelteKit versions the engine builds with: what `apps/lines` pins. */
export const engineVersions = (engineRoot = ENGINE_ROOT) => {
	const file = join(engineRoot, 'apps', 'lines', 'package.json');
	const pkg = readJson(file);
	const deps = { ...pkg.devDependencies, ...pkg.dependencies };
	return { file, svelte: deps.svelte, kit: deps['@sveltejs/kit'] };
};

/**
 * The parser/printer versions `svelte@<version>` resolved to in a pnpm v9 lockfile (its
 * `snapshots:` entry), or null when the lockfile has no such entry.
 */
export const lockedParserVersions = (lockText, svelteVersion) => {
	const lines = lockText.split(/\r?\n/);
	const start = lines.indexOf('snapshots:');
	if (start < 0) return null;
	const head = new RegExp(`^ {2}svelte@${svelteVersion.replace(/\./g, '\\.')}(\\(.*\\))?:$`);
	const at = lines.findIndex((line, i) => i > start && head.test(line));
	if (at < 0) return null;

	const found = {};
	let inDeps = false;
	for (const line of lines.slice(at + 1)) {
		if (!line.startsWith('    ')) break;
		if (!line.startsWith('      ')) {
			inDeps = line.trim() === 'dependencies:';
			continue;
		}
		if (!inDeps) continue;
		const m = /^ {6}'?([^':]+)'?: ([^(\s]+)/.exec(line);
		if (m && PARSER_PACKAGES.includes(m[1])) found[m[1]] = m[2];
	}
	if (!PARSER_PACKAGES.every((name) => found[name])) return null;
	return Object.fromEntries(PARSER_PACKAGES.map((name) => [name, found[name]]));
};

/** `lockedParserVersions` for the engine's own lockfile. */
export const engineParserVersions = (engineRoot = ENGINE_ROOT, svelteVersion) => {
	const lockfile = join(engineRoot, 'pnpm-lock.yaml');
	if (!existsSync(lockfile)) return null;
	const version = svelteVersion ?? engineVersions(engineRoot).svelte;
	return lockedParserVersions(readFileSync(lockfile, 'utf8'), version);
};

/**
 * What the build would actually load. Three Svelte resolutions, because they are three different
 * importers: the project root (the app source and its `svelte/internal/*` imports resolve here in
 * a game repo), the engine packages (`config-vite`'s own dependency), and the compiler (the Svelte
 * `@sveltejs/vite-plugin-svelte` imports, reached through the kit `config-vite` loads).
 */
export const probeSvelteInstall = ({
	projectDir = process.cwd(),
	engineRoot = ENGINE_ROOT,
	engineFrom = CONFIG_VITE_DIR,
} = {}) => {
	const engine = engineVersions(engineRoot);
	const kit = findPackage('@sveltejs/kit', engineFrom);
	const plugin = kit && findPackage('@sveltejs/vite-plugin-svelte', kit.dir);
	const copies = [
		{ label: 'the project root', pkg: findPackage('svelte', projectDir) },
		{ label: 'the engine packages', pkg: findPackage('svelte', engineFrom) },
		{ label: 'the compiler', pkg: plugin && findPackage('svelte', plugin.dir) },
	]
		.filter((c) => c.pkg)
		.map(({ label, pkg }) => ({ label, ...pkg }));
	const parsers = [];
	for (const copy of copies.filter((c, i) => copies.findIndex((o) => o.dir === c.dir) === i)) {
		for (const name of PARSER_PACKAGES) {
			parsers.push({ of: copy, name, version: findPackage(name, copy.dir)?.version ?? null });
		}
	}
	return {
		projectDir: resolve(projectDir),
		engineRoot: resolve(engineRoot),
		engine: { ...engine, parsers: engineParserVersions(engineRoot, engine.svelte) },
		project: {
			svelte: findPackage('svelte', projectDir),
			kit: findPackage('@sveltejs/kit', projectDir),
		},
		copies,
		parsers,
	};
};

/** Every way the probed install departs from the engine's. Pure — the fixture drives it. */
export const svelteDriftProblems = ({ engine, project, copies, parsers }) => {
	const problems = [];
	if (project.svelte && project.svelte.version !== engine.svelte) {
		problems.push(
			`the project resolves svelte ${project.svelte.version}, the engine builds with ${engine.svelte}`,
		);
	}
	if (project.kit && project.kit.version !== engine.kit) {
		problems.push(
			`the project resolves @sveltejs/kit ${project.kit.version}, the engine builds with ${engine.kit}`,
		);
	}
	if (new Set(copies.map((c) => c.version)).size > 1) {
		const byDir = Map.groupBy(copies, (c) => c.dir);
		const listed = [...byDir].map(
			([dir, [first, ...rest]]) =>
				`${first.version} for ${[first, ...rest].map((c) => c.label).join(' and ')} (${dir})`,
		);
		problems.push(`two Svelte copies are installed: ${listed.join('; ')}`);
	}
	// The lockfile describes the engine's svelte only; another copy is already reported above.
	if (engine.parsers) {
		for (const { of, name, version } of parsers) {
			if (of.version !== engine.svelte) continue;
			if (version === null || version === engine.parsers[name]) continue;
			problems.push(
				`svelte ${of.version} (${of.label}) resolves ${name} ${version}, the engine's lockfile has ${name} ${engine.parsers[name]}`,
			);
		}
	}
	return problems;
};

/** The error text: what differs, and the exact edit that fixes it. */
export const svelteDriftMessage = (problems, { projectDir, engineRoot, engine }) => {
	const overrides = engine.parsers
		? Object.entries(engine.parsers)
				.map(([name, version]) => `"${name}": "${version}"`)
				.join(', ')
		: null;
	return [
		`[config-vite] This project's Svelte install does not match the engine's. A build mixing them ` +
			`compiles, then boots to a black screen (e.g. "TypeError: e.exclude.includes is not a function").`,
		...problems.map((p) => `  - ${p}`),
		`Fix: in ${join(projectDir, 'package.json')} (the game repo's root package.json), set`,
		`    "svelte": "${engine.svelte}" and "@sveltejs/kit": "${engine.kit}" wherever it declares them`,
		...(overrides ? [`    "pnpm": { "overrides": { ${overrides} } }`] : []),
		`  then run \`pnpm install\` and build again. These are the versions the engine at ` +
			`${engineRoot} builds with (apps/lines/package.json, pnpm-lock.yaml).`,
		`To build anyway, set ${ALLOW_ENV}=1 — the bundle will still be broken; never ship it.`,
	].join('\n');
};

/**
 * Throw on drift, or warn when `IE_ALLOW_SVELTE_MISMATCH=1`. Returns the problems found (empty when
 * the install matches).
 */
export const assertSvelteVersions = ({
	env = process.env,
	warn = console.warn,
	...probeOptions
} = {}) => {
	const state = probeSvelteInstall(probeOptions);
	const problems = svelteDriftProblems(state);
	if (!problems.length) return problems;
	const message = svelteDriftMessage(problems, state);
	if (env[ALLOW_ENV] === '1') {
		warn(`WARNING (${ALLOW_ENV}=1, continuing):\n${message}`);
		return problems;
	}
	throw new Error(message);
};
