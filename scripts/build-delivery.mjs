/**
 * Build a game for a PARTNER to host, from any game repo, with no per-repo wiring.
 *
 *     node engine/scripts/build-delivery.mjs [--profile operator-embed] [--out delivery]
 *                                            [--alias BookOfBorut] [--zip] [--json result.json]
 *     node engine/scripts/build-delivery.mjs --list-profiles     # for a UI's profile picker
 *     node engine/scripts/build-delivery.mjs --print-env         # env a caller's own build must set
 *     node engine/scripts/build-delivery.mjs --skip-build …      # package a build it already made
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
 * WHY IT ALSO WRITES A CONTRACT, A ZIP AND A JSON RESULT. The folder is only half a handover: the
 * partner also needs the two lines for their page and the two values that CANNOT vary per game
 * (the container id and the filename), and those were previously only ever said out loud. `EMBED.md`
 * is generated from the profile actually baked, so it cannot describe a build we did not make.
 * `--json` exists because a UI drives this — the desktop launcher's "Build for delivery" button —
 * and scraping a human summary out of interleaved `pnpm build` logs is how a button gets brittle.
 *
 * See `docs/design/delivery-builds.md`.
 */
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { isStandaloneGame } from '../packages/config-svelte/appSrc.js';
import { zipDir } from './zip-dir.mjs';

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const ENGINE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PROFILE_DIR = resolve(ENGINE_ROOT, 'packages/delivery-profile/profiles');
const SERVE_SCRIPT = resolve(ENGINE_ROOT, 'scripts/serve-embed.mjs');

/** The default profile, named once: it is both the `--profile` fallback and what `--list-profiles`
 *  marks so a dropdown can preselect without a second copy of this string in the UI. */
const DEFAULT_PROFILE = 'operator-embed';

/** The container id and filename the partner's page hard-codes. Fixed, not configurable: one page
 *  serves every game and composes the script URL server-side, so neither can vary per game. */
const CONTAINER_ID = 'game';
const ENTRY_FILE = 'game.js';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Every profile a delivery can be baked with.
 *
 * `name` is what `--profile` takes (the FILE stem) and is NOT the profile's own `id` — `2complex.json`
 * declares `2complex-bookof`. A dropdown that sent the id back would fail to resolve, so both are
 * reported and the distinction is not left to be rediscovered.
 */
const listProfiles = () =>
	readdirSync(PROFILE_DIR)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => {
			const name = file.slice(0, -'.json'.length);
			const profile = readJson(resolve(PROFILE_DIR, file));
			return {
				name,
				id: typeof profile.id === 'string' ? profile.id : name,
				default: name === DEFAULT_PROFILE,
				description: typeof profile._comment === 'string' ? profile._comment : '',
			};
		});

// Answered BEFORE the game-repo check below, deliberately: a UI populates its profile dropdown with
// no game selected, and from wherever it happens to be standing.
if (flag('--list-profiles')) {
	console.log(JSON.stringify(listProfiles(), null, 2));
	process.exit(0);
}

const gameRoot = process.cwd();
const profile = arg('--profile', DEFAULT_PROFILE);
const outDir = arg('--out', '');
const wantZip = flag('--zip');
const jsonOut = arg('--json', '');

/**
 * The env that makes `pnpm build` produce an embeddable bundle rather than a droppable site.
 *
 * Exported through `--print-env` as well as used directly, because a caller that runs the build
 * ITSELF still has to set exactly these. The desktop launcher is that caller: its own build runner
 * handles a `vite build` that finishes its output and then never exits (an open sass/esbuild handle
 * keeps Node alive), which `spawnSync` here cannot — it would wait forever. So the launcher builds,
 * then calls back with `--skip-build` to package. One definition, both paths.
 */
const DELIVERY_ENV = {
	PUBLIC_DELIVERY_EMBED: '1',
	PUBLIC_RGS_TRANSPORT: 'play4fun',
	PUBLIC_DELIVERY_PROFILE: profile,
};

/** Package an existing `build/` — the caller ran `pnpm build` with `--print-env`'s variables set.
 *  `build-embed.mjs` still runs, and refuses loudly if that build was not an embed build. */
const skipBuild = flag('--skip-build');

if (flag('--print-env')) {
	console.log(JSON.stringify(DELIVERY_ENV, null, 2));
	process.exit(0);
}

/**
 * Fail with a reason a UI can show, not just a non-zero exit — otherwise the button says "it broke".
 *
 * Declared here, above the validation rather than beside the build, so that EVERY refusal reaches
 * the result file. Being told the profile name was wrong is more useful than being told nothing,
 * and a caller that had to treat "no JSON" as its own third outcome would be the more brittle for it.
 */
const fail = (error) => {
	if (jsonOut) {
		writeFileSync(
			resolve(gameRoot, jsonOut),
			`${JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2)}\n`,
			'utf8',
		);
	}
	throw error;
};

// A game repo, not the engine itself. `isStandaloneGame()` is the engine's own answer to that
// question — the one `config-svelte` uses to decide whether to redirect `kit.files` — so this cannot
// drift from it. Without the check, running here from the engine checkout would `pnpm build` the
// entire monorepo before failing, which is a slow way to learn you were in the wrong directory.
if (!isStandaloneGame()) {
	fail(
		new Error(
			`This is the engine checkout, not a game repo.\n` +
				`Run it from the game's root (the repo that vendors this engine at ./engine), or build an\n` +
				`engine app with: pnpm --filter <app> build:embed`,
		),
	);
}

const pkgPath = resolve(gameRoot, 'package.json');
if (!existsSync(pkgPath)) {
	fail(new Error(`No package.json in ${gameRoot} — run this from a game repo's root.`));
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts?.build) {
	fail(new Error(`${pkg.name ?? gameRoot} has no \`build\` script — is this a game repo?`));
}

const profileFile = resolve(PROFILE_DIR, `${profile}.json`);
const profilePath = existsSync(profileFile) ? profileFile : resolve(gameRoot, profile);
// The RESOLVED file, not the name's shape. Checking the shape let `--profile missing.json`
// through, because it looked like a path — and the miss then surfaced either as a vite error
// three minutes into a build or, under `--skip-build`, as a bare ENOENT with no profile named.
if (!existsSync(profilePath)) {
	fail(
		new Error(
			`No delivery profile '${profile}'. Available:\n` +
				`  ${listProfiles()
					.map((p) => `${p.name}${p.default ? '  (default)' : ''}`)
					.join('\n  ')}\n` +
				`Or pass a path to a JSON file.`,
		),
	);
}

/**
 * The partner's `gameAlias` — the CDN folder this build is served from, and so the zip's root.
 *
 * Their convention is the game's DISPLAY name with spaces removed (`"Book Of Bet Options"` →
 * `BookOfBetOptions`), which a repo does not store; `new-game.mjs` keeps only the slug. Capitalising
 * each slug segment reproduces it whenever the display name title-cases every word, and quietly
 * differs when it does not (`"Book of Foo"` → we guess `BookOfFoo`, they compose `BookofFoo`). A
 * wrong alias is a 404 on their CDN, so the guess is stated in `EMBED.md` and in the summary rather
 * than left to be discovered — and `--alias` overrides it.
 */
const aliasFromPackage = (name) =>
	String(name ?? 'DeliveryGame')
		.replace(/^@[^/]+\//, '')
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('') || 'DeliveryGame';

const aliasGiven = arg('--alias', '');
const alias = aliasGiven || aliasFromPackage(pkg.name);

const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);

/**
 * Run a build step, inheriting stdio so its output is the user's.
 *
 * `shell` defaults to true on Windows because `pnpm` is a `.cmd` shim there and cannot be spawned
 * directly — but a shell means the arguments are re-parsed as a COMMAND LINE, and `spawnSync` joins
 * them unquoted. Any argument holding a space is then split, which is not hypothetical: the engine
 * lives at `C:\Invisible Wall SL\…` on the machine that builds the deliveries, so passing
 * `build-embed.mjs`'s absolute path through a shell had `cmd.exe` look for `C:\Invisible`. Hence
 * both halves below — quote when a shell is unavoidable, and avoid the shell when it is not.
 *
 * Under a shell the whole thing goes as ONE pre-quoted command string rather than an args array,
 * which is both the documented way to do this and the only way to stop Node warning (DEP0190) that
 * it is concatenating rather than escaping — a warning that was describing a real defect here.
 */
const run = (command, args, env, { shell = process.platform === 'win32' } = {}) => {
	console.info(`\n$ ${command} ${args.join(' ')}\n`);
	const options = {
		cwd: gameRoot,
		stdio: 'inherit',
		shell,
		env: { ...process.env, ...env },
	};
	const result = shell
		? spawnSync([command, ...args].map(quote).join(' '), options)
		: spawnSync(command, args, options);
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
	}
};

/** Every file under `dir`, relative and `/`-separated, with the total byte count. */
const measure = (dir) => {
	const walk = (current) =>
		readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
			const full = join(current, entry.name);
			return entry.isDirectory() ? walk(full) : [full];
		});
	const files = walk(dir);
	return {
		fileCount: files.length,
		bytes: files.reduce((total, file) => total + statSync(file).size, 0),
		names: files.map((file) => relative(dir, file).split(sep).join('/')),
	};
};

/**
 * The handover contract, generated from the profile actually baked.
 *
 * Partner-facing: no internal paths, no engine commands, and none of the profile's own `_comment`,
 * which is written for us and names our test nodes. Everything here is something their integrator
 * has to act on.
 */
const embedDoc = (baked) => {
	const rgs = baked.rgs ?? {};
	const session = baked.session ?? {};
	const endpoint = typeof rgs.endpoint === 'string' ? rgs.endpoint : '/webnode/engine';
	const param = typeof session.param === 'string' ? session.param : 'sid';

	const reach =
		rgs.source === 'host'
			? [
					`The game POSTs to **your page's own origin** — it never names a host:`,
					'',
					'```',
					`POST <your origin>${endpoint}?${param}=<token>`,
					'```',
					'',
					`The path comes from \`GameSettings.service\`; \`${endpoint}\` is the fallback when your`,
					'page states none. Because it is same-origin there is **no CORS** — no preflight per',
					'spin, and no `Access-Control-Allow-Origin` to maintain for a growing set of domains.',
				]
			: [
					`The game POSTs to \`${rgs.baseUrl || '(same origin)'}${endpoint}\`, cross-origin.`,
					'',
					`That host must answer \`Access-Control-Allow-Origin: *\`. Requests are sent`,
					`**uncredentialed** (no cookies) — the \`${param}\` token in the query string is the`,
					'credential, and credentialed CORS forbids a wildcard origin.',
				];

	return [
		`# ${alias} — delivery build`,
		'',
		`Invisible Engine · profile \`${baked.id ?? profile}\` · built ${new Date().toISOString().slice(0, 10)}`,
		'',
		'This folder is **not a website**. There is no `index.html`: your page includes',
		`\`${ENTRY_FILE}\` and the game mounts into a container you provide. Opening the folder`,
		'directly will not boot it — that is deliberate, not a fault.',
		'',
		'## 1. Where the folder goes',
		'',
		'Serve its contents at:',
		'',
		'```',
		'{cdn}/{brand}/games/{versionPath}/{gameAlias}/',
		'```',
		'',
		`This build assumes **\`gameAlias\` = \`${alias}\`**${
			aliasGiven ? '' : ' (derived from the repository name — please confirm)'
		}. It must match the alias your page composes, or the script tag 404s.`,
		'',
		'Serve it as a directory (with the trailing slash). Assets resolve relative to',
		`\`${ENTRY_FILE}\`'s own URL, so the whole folder can move per release — which is what makes`,
		'`versionPath` work as your cache-buster.',
		'',
		'## 2. The two lines for your page',
		'',
		'```html',
		`<div id="${CONTAINER_ID}"></div>`,
		`<script src="<?=baseUrl?><?=gameAlias?>/${ENTRY_FILE}"></script>`,
		'```',
		'',
		'Two values are **fixed** and cannot vary per game, because one page serves every game and',
		'composes that URL server-side:',
		'',
		'| Fixed | Value | Why it cannot vary |',
		'| --- | --- | --- |',
		`| container id | \`${CONTAINER_ID}\` | your page has no per-game id to pass us |`,
		`| filename | \`${ENTRY_FILE}\` | your server composes the URL, so it cannot know a content hash; \`versionPath\` is the cache-buster instead |`,
		'',
		'Include it as a plain `<script src>` — **not** `type="module"`.',
		'',
		'## 3. What your page must set first',
		'',
		'`window.params`, before the script tag:',
		'',
		'```js',
		'var params = {',
		'  GameSettings: {',
		'    token:   "<session token>",',
		`    service: "${endpoint.replace(/^\//, '')}",`,
		'    config:  { /* your brand settings */ }',
		'  }',
		'};',
		'```',
		'',
		`- **\`token\`** — the session.${
			session.required
				? ' **Required.** With no token the game refuses to boot and shows an error, rather than a demo wallet that would take spins against a session you never issued.'
				: ''
		}`,
		'- **`service`** — the RGS path, resolved against your page. It must be a **path**: anything',
		`  carrying a scheme or a \`//host\` is refused and \`${endpoint}\` is used instead.`,
		'- **`config`** — your brand settings (bet ladder, currency, jurisdiction flags). Fields we do',
		'  not recognise are ignored, so adding one is safe.',
		'',
		'`params` is read from this window and, failing that, from the parent — so the client may run',
		'inside a frame your page hosts.',
		'',
		'## 4. How it reaches the RGS',
		'',
		...reach,
		'',
	].join('\n');
};

try {
	if (skipBuild) {
		console.info(`\n(--skip-build: packaging the existing build/ as '${profile}')\n`);
	} else {
		run('pnpm', ['build'], DELIVERY_ENV);
	}

	// `process.execPath`, no shell: the same Node that is running this, spawned directly, so an
	// engine path containing spaces is never handed to a command-line parser at all.
	run(
		process.execPath,
		[resolve(ENGINE_ROOT, 'scripts/build-embed.mjs'), 'build'],
		{},
		{ shell: false },
	);

	// The shell SvelteKit emits has now been read — `build-embed.mjs` generated `game.js` out of it —
	// and a delivery must not carry it onward. Embed mode only switches `bundleStrategy`, so the
	// `index.html` still lands in `build/`, and shipping it would contradict the one thing a partner
	// is told about this folder: that it is not a site. Left in place it is a URL on their CDN that
	// loads our game outside their page, fails the session check and looks like our bug.
	rmSync(resolve(gameRoot, 'build/index.html'), { force: true });

	// `--out` copies the result somewhere stable, because `build/` is what the NEXT ordinary build
	// overwrites — and a delivery folder you are about to hand over should not evaporate the next time
	// someone runs `pnpm build`.
	let final = resolve(gameRoot, 'build');
	if (outDir) {
		final = resolve(gameRoot, outDir);
		rmSync(final, { recursive: true, force: true });
		cpSync(resolve(gameRoot, 'build'), final, { recursive: true });
	}

	if (!existsSync(resolve(final, ENTRY_FILE))) {
		throw new Error(
			`${final} has no ${ENTRY_FILE} — the embed build did not produce one. ` +
				`Was PUBLIC_DELIVERY_EMBED=1 honoured?`,
		);
	}

	const baked = readJson(profilePath);
	const docPath = resolve(final, 'EMBED.md');
	writeFileSync(docPath, embedDoc(baked), 'utf8');

	const { fileCount, bytes, names } = measure(final);

	let zip = null;
	if (wantZip) {
		const zipPath = resolve(dirname(final), `${alias}.zip`);
		const { files, bytes: zipBytes } = zipDir(final, zipPath, { root: alias });
		zip = { path: zipPath, files, bytes: zipBytes };
	}

	const serveArgs = [final, '--alias', alias];
	if (jsonOut) {
		writeFileSync(
			resolve(gameRoot, jsonOut),
			`${JSON.stringify(
				{
					ok: true,
					profile: { name: profile, id: baked.id ?? profile, file: profilePath },
					alias,
					aliasDerived: !aliasGiven,
					outDir: final,
					entry: ENTRY_FILE,
					containerId: CONTAINER_ID,
					embedDoc: docPath,
					fileCount,
					bytes,
					contents: names.filter((name) => !name.includes('/')).sort(),
					zip,
					// The "play it" half, so a UI never has to hardcode where the engine lives.
					serve: { script: SERVE_SCRIPT, args: serveArgs },
				},
				null,
				2,
			)}\n`,
			'utf8',
		);
	}

	const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
	console.info(
		`\n  Delivery build ready — profile '${profile}'\n` +
			`    ${final}\n` +
			`    ${fileCount} files, ${mb(bytes)}\n` +
			`    contract: ${docPath}\n` +
			(zip ? `    zip:      ${zip.path}  (${mb(zip.bytes)})\n` : '') +
			(jsonOut ? `    result:   ${resolve(gameRoot, jsonOut)}\n` : '') +
			`\n  Play it the way their page will:\n` +
			`    node ${SERVE_SCRIPT} "${final}" --sid <token> --rgs <origin>\n\n` +
			`  Then give the partner that folder, to serve at\n` +
			`  {cdn}/{brand}/games/{versionPath}/${alias}/, and these two lines for their page:\n\n` +
			`    <div id="${CONTAINER_ID}"></div>\n` +
			`    <script src="<?=baseUrl?><?=gameAlias?>/${ENTRY_FILE}"></script>\n` +
			(aliasGiven
				? ''
				: `\n  NOTE: '${alias}' was derived from the repo name. Confirm it matches their gameAlias,\n` +
					`        or pass --alias — a mismatch is a 404 on their CDN.\n`),
	);
} catch (error) {
	fail(error);
}
