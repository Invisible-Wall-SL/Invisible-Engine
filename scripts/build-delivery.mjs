/**
 * Build a game for a PARTNER to host, from any game repo, with no per-repo wiring.
 *
 *     node engine/scripts/build-delivery.mjs [--profile operator-embed] [--out delivery]
 *
 * WHY IT LIVES IN THE ENGINE AND TAKES NO SETUP. `scripts/new-game.mjs` writes a repo's scripts
 * ONCE, at scaffold time, and nothing ever refreshes them — the same snapshot problem that had every
 * scaffolded game building a months-old `src/` until `config-svelte` started pointing at the
 * engine's. A delivery build added only to the scaffold would work for games created after today and
 * for no existing one, including the only game we actually owe a delivery. Run from the engine
 * submodule instead, it reaches every repo the moment its submodule advances.
 *
 * WHAT A DELIVERY BUILD IS, AND HOW IT DIFFERS FROM `pnpm build`:
 *
 *   PUBLIC_DELIVERY_EMBED=1     stop inlining the bundle into an index.html. A delivery has no
 *                               index.html — their server-rendered page includes our `game.js`.
 *   PUBLIC_DELIVERY_PROFILE     bake which RGS this build belongs to. `operator-embed` names no host
 *                               at all, because the operator's own page is the origin.
 *   PUBLIC_RGS_TRANSPORT        the Play4Fun facade instead of the stock transport.
 *
 * then `build-embed.mjs` writes the `game.js` their page loads.
 *
 * The game's own `pnpm build` still runs in the middle of that, so the editor bake, the R2 asset
 * pull and the symbol publish all happen exactly as they do for any other build. This only changes
 * the SHAPE of the output, never its content.
 *
 * See `docs/design/delivery-builds.md`.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { isStandaloneGame } from '../packages/config-svelte/appSrc.js';

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const ENGINE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const gameRoot = process.cwd();
const profile = arg('--profile', 'operator-embed');
const outDir = arg('--out', '');

// A game repo, not the engine itself. `isStandaloneGame()` is the engine's own answer to that
// question — the one `config-svelte` uses to decide whether to redirect `kit.files` — so this cannot
// drift from it. Without the check, running here from the engine checkout would `pnpm build` the
// entire monorepo before failing, which is a slow way to learn you were in the wrong directory.
if (!isStandaloneGame()) {
	throw new Error(
		`This is the engine checkout, not a game repo.\n` +
			`Run it from the game's root (the repo that vendors this engine at ./engine), or build an\n` +
			`engine app with: pnpm --filter <app> build:embed`,
	);
}

const pkgPath = resolve(gameRoot, 'package.json');
if (!existsSync(pkgPath)) {
	throw new Error(`No package.json in ${gameRoot} — run this from a game repo's root.`);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts?.build) {
	throw new Error(`${pkg.name ?? gameRoot} has no \`build\` script — is this a game repo?`);
}

const profileFile = resolve(ENGINE_ROOT, 'packages/delivery-profile/profiles', `${profile}.json`);
if (!existsSync(profileFile) && !profile.includes('/') && !profile.endsWith('.json')) {
	throw new Error(
		`No delivery profile '${profile}'. Available:\n` +
			`  ${ENGINE_ROOT}/packages/delivery-profile/profiles/\n` +
			`Or pass a path to a JSON file.`,
	);
}

const run = (command, args, env) => {
	console.info(`\n$ ${command} ${args.join(' ')}\n`);
	const result = spawnSync(command, args, {
		cwd: gameRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, ...env },
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
	}
};

run('pnpm', ['build'], {
	PUBLIC_DELIVERY_EMBED: '1',
	PUBLIC_RGS_TRANSPORT: 'play4fun',
	PUBLIC_DELIVERY_PROFILE: profile,
});

run('node', [resolve(ENGINE_ROOT, 'scripts/build-embed.mjs'), 'build'], {});

// `--out` copies the result somewhere stable, because `build/` is what the NEXT ordinary build
// overwrites — and a delivery folder you are about to hand over should not evaporate the next time
// someone runs `pnpm build`.
let final = resolve(gameRoot, 'build');
if (outDir) {
	final = resolve(gameRoot, outDir);
	rmSync(final, { recursive: true, force: true });
	cpSync(resolve(gameRoot, 'build'), final, { recursive: true });
}

console.info(
	`\n  Delivery build ready — profile '${profile}'\n` +
		`    ${final}\n\n` +
		`  Play it the way their page will:\n` +
		`    node ${resolve(ENGINE_ROOT, 'scripts/serve-embed.mjs')} "${final}" --sid <token> --rgs <origin>\n\n` +
		`  Then give the partner that folder, to serve at {cdn}/{brand}/games/{versionPath}/{gameAlias}/,\n` +
		`  and these two lines for their page:\n\n` +
		`    <div id="game"></div>\n` +
		`    <script src="<?=baseUrl?><?=gameAlias?>/game.js"></script>\n`,
);
