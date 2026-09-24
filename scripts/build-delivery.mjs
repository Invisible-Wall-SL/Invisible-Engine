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
 *   PUBLIC_DELIVERY_EMBED=1     stop inlining the bundle into the page. A delivery ships game.js
 *                               plus a host page that includes it, not one inlined blob.
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

/**
 * The partner's own embed page, with our game swapped in for theirs.
 *
 * NOT A PAGE WE INVENTED, AND NOT ONE WE GENERATE. It is THEIR G-WAN template — `<?js ?>` blocks,
 * `gwan.getArg`, Redis session lookups, their tournament bundle — which they gave us. Everything a
 * delivery could want to vary is already a server-side expression in it (`<?=baseUrl?>`,
 * `<?=gameAlias?>`, the `config` their own RGS composes), so it is byte-identical for every game
 * and every profile. Generating it from the baked profile would add nothing and could only drift
 * from the file they actually run.
 *
 * So it is VENDORED at `scripts/templates/embed.html` and copied. Three edits mark themselves
 * `INVISIBLE ENGINE:` in the file; `diff` it against theirs and only the game-loading mechanism
 * moves.
 *
 * THE NAME IS THEIRS. It is `embed.html` because that is what they call it. A static `index.html`
 * of our own was shipped for one afternoon and removed: their server renders this page, and a
 * second page in the folder setting a placeholder session is the one most likely to get served by
 * accident. Not being `index.html` also means a bare folder URL does not hand it out.
 */
const HOST_PAGE_FILE = 'embed.html';

/** The vendored copy. Beside the script that ships it, not in `packages/`, because nothing imports
 *  it — it is an artifact to copy, not a module to build. */
const HOST_PAGE_TEMPLATE = resolve(ENGINE_ROOT, 'scripts/templates', HOST_PAGE_FILE);

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
 * Where `pnpm build` put its output.
 *
 * `build/` for every game the scaffolder makes, but NOT a given: the desktop launcher reads each
 * project's `publish.build_out`, which merely defaults to that. Hardcoding it here would have the
 * launcher compress one folder and the packager hand over another, with nothing noticing until the
 * missing `game.js` at the end.
 */
const buildDir = resolve(gameRoot, arg('--build', 'build'));

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

/** Quote for the shell that will actually re-parse this: `cmd.exe` escapes an embedded quote by
 *  doubling it, POSIX shells by backslash. No caller passes a quoted argument today; getting it
 *  wrong only when one eventually does is the kind of latency this is not worth having. */
const quote = (value) =>
	/[\s"]/.test(value)
		? `"${value.replace(/"/g, process.platform === 'win32' ? '""' : '\\"')}"`
		: value;

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

/** Every file under `dir`, absolute. Hoisted out of `measure` because the delivery is walked
 *  twice — once to size it, once to refuse anything that is source. */
const walkFiles = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		return entry.isDirectory() ? walkFiles(full) : [full];
	});

/** How many files are under `dir`, and how many bytes they come to. */
const measure = (dir) => {
	const files = walkFiles(dir);
	return {
		fileCount: files.length,
		bytes: files.reduce((total, file) => total + statSync(file).size, 0),
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
		'**Two destinations, and they are not the same server.** This folder is the CDN upload; the',
		`\`${HOST_PAGE_FILE}\` beside it (at the root of the zip, OUTSIDE this folder) belongs on your`,
		'application server, where your session API already serves it from `/webnode/views/eanew/`.',
		'It is deliberately not inside the upload: a CDN does not execute `<?js ?>`, so serving it',
		'from there would publish your own session, Redis and admin code as plain text.',
		'',
		`The game is \`${ENTRY_FILE}\`. \`${HOST_PAGE_FILE}\` is **your own embed template with our`,
		'game in place of the one it used to load** — three edits, each marked',
		'`INVISIBLE ENGINE:` in the file. Diff it against the copy on your server and only the',
		'game-loading mechanism moves; every `<?js ?>` block, the session lookup, the adapter and',
		'custom-JS includes and the tournament bundle are byte-identical.',
		'',
		'**The three edits:**',
		'',
		'| # | Was | Is |',
		'| --- | --- | --- |',
		`| 1 | — | a \`<div id="${CONTAINER_ID}">\` beside your \`<canvas>\` |`,
		'| 2 | `BaseGameLoader.InitGame(params, "Slot", "Hyper")` | removed — our game boots itself |',
		`| 3 | \`<script src=…/shared/play4fun-js-min.js>\` | \`<script src="<?=baseUrl?><?=gameAlias?>/${ENTRY_FILE}">\` |`,
		'',
		'Why the `<div>`: our renderer builds its **own** canvas and needs an element to build into,',
		'so it cannot mount into `GameCanvas`. Yours is left in the page untouched in case your',
		'adapter or tournament scripts reference it — it is unused by us and yours to remove.',
		'',
		'`params` is unchanged, and we read only `GameSettings` out of it. Every other field',
		'(`UrlGame`, `UrlHistory`, `TournUrl`, `RemoteID`, …) is still there for your own scripts.',
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
		'## 2. The two lines that load the game',
		'',
		`Already applied in the \`${HOST_PAGE_FILE}\` at the zip root; repeated here because they are`,
		'the whole of the integration:',
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
		'## 3. What the page must set first',
		'',
		'`window.params`, before the script tag — **your template already does this**, and the shape',
		'below is the part of it we read:',
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
		'- **`config`** — what `Game.getConfigForGameClient` composes. Fields we do not recognise are',
		'  ignored, so adding one is safe. These are the ones this build **reads**:',
		'',
		'  | Key | Type | Effect |',
		'  | --- | --- | --- |',
		'  | `betMultipliers` | `number[]` | the bet ladder: total stake = `betOptions[x] × M` |',
		'  | `initialBetMultiplierIndex` | `number` | which rung the game opens on |',
		'  | `enableTurbo` | `boolean` | false disables turbo |',
		'  | `allowOutcomeBuy` | `boolean` | false hides the buy-feature button |',
		'  | `showTheoreticalPayback` | `boolean` | true displays RTP |',
		'  | `balanceUpdateInterval` | `number` | wallet re-poll in ms; clamped to 5000, absent = never |',
		'',
		'  A key you omit leaves our default alone — stating `false` is not the same as saying',
		'  nothing. Please re-confirm the stake identity above against your own figures before',
		'  launch: a per-line-vs-total misread gives a game that plays correctly with every number',
		'  wrong.',
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
		[resolve(ENGINE_ROOT, 'scripts/build-embed.mjs'), buildDir],
		{},
		{ shell: false },
	);

	// `--out` copies the result somewhere stable, because `build/` is what the NEXT ordinary build
	// overwrites — and a delivery folder you are about to hand over should not evaporate the next time
	// someone runs `pnpm build`.
	let final = buildDir;
	if (outDir) {
		final = resolve(gameRoot, outDir);
		// `rmSync(recursive)` below is why this is checked rather than trusted: `--out .` would
		// delete the game repo, and `--out build` would delete the very folder about to be copied.
		if (final === gameRoot || final === buildDir) {
			throw new Error(
				`--out ${outDir} resolves to ${final === gameRoot ? 'the repo root' : 'the build folder'}` +
					`, which is emptied before the copy. Pick a new directory, e.g. --out delivery.`,
			);
		}
		rmSync(final, { recursive: true, force: true });
		cpSync(buildDir, final, { recursive: true });
	}

	// The shell SvelteKit emits has now been read — `build-embed.mjs` generated `game.js` out of it —
	// and a delivery must not carry it onward. Embed mode only switches `bundleStrategy`, so the
	// shell still lands in the build folder, and it is a bundle loader that sets no `window.params`
	// at all: served on the partner's CDN it boots the game with no session and fails, which reads
	// as our bug. We overwrite that same name below with a host page that DOES set them.
	//
	// Still a delete rather than a plain overwrite, because the two files are unrelated and the
	// delete states that: whatever the shell contained is gone, not merged into ours.
	//
	// Removed from the DELIVERY copy, after the copy — never from the source build. Everything that
	// can still fail (the `game.js` check, the profile read, `EMBED.md`, the zip) runs below this
	// point, and taking the shell out of `build/` would leave that folder permanently unpackageable:
	// a `--skip-build` retry would then die claiming the build was never an embed build, which by
	// then is untrue and costs a five-minute rebuild to disprove.
	rmSync(resolve(final, 'index.html'), { force: true });

	// NOTHING THAT IS NOT THE GAME LEAVES WITH THE DELIVERY.
	//
	// `static/` is copied into a build wholesale, so the output carries things the running game
	// never touches. They are small, but "small" is not the test — a partner's CDN serves whatever
	// is in the folder, and every file in it is one we are implicitly saying belongs there.
	//
	//  - `assets/**/*.ts` — the R2 mirror's bundle manifests (`createAsset({img, rawAtlas, spines})`).
	//    The build COMPILES them into `bundle.js`; a browser cannot execute a `.ts`, so shipping
	//    them hands over source that does nothing. 28 of them in a real Borut delivery.
	//  - `favicon.svg`, `loader.gif` — reachable only from an `index.html` of ours, and a delivery
	//    has none: the partner's page owns the document head, and the boot splash is
	//    `BootSplashSequence` reading `deploy/_boot/`. Verified as 0 references in a real built
	//    bundle rather than assumed.
	//
	// STRIPPED, not tolerated. The first version of this guard merely exempted the manifests, which
	// stopped the build failing and left them in the zip — solving the error instead of the problem.
	//
	// Reported below rather than removed silently: a delete nobody sees is how a file that DID
	// matter goes missing without anyone connecting it to this list.
	const STRIP_NAMES = ['favicon.svg', 'loader.gif'];
	const stripped = walkFiles(final).filter((file) => {
		const rel = relative(final, file).split(sep).join('/');
		return rel.toLowerCase().endsWith('.ts') || STRIP_NAMES.includes(rel);
	});
	const strippedBytes = stripped.reduce((total, file) => total + statSync(file).size, 0);
	for (const file of stripped) rmSync(file, { force: true });

	if (!existsSync(resolve(final, ENTRY_FILE))) {
		throw new Error(
			`${final} has no ${ENTRY_FILE} — the embed build did not produce one. ` +
				`Was PUBLIC_DELIVERY_EMBED=1 honoured?`,
		);
	}

	const baked = readJson(profilePath);
	const docPath = resolve(final, 'EMBED.md');
	writeFileSync(docPath, embedDoc(baked), 'utf8');

	// Before `measure()` and before the zip, so the page is counted in the summary and actually
	// travels in the archive — the two ways a shipped file silently fails to be delivered.
	//
	// Checked rather than assumed: this is the one delivery file that is a COPY, so a rename or a
	// half-applied submodule update takes it away silently, and a handover missing the page that
	// boots the game is worth failing the build over.
	if (!existsSync(HOST_PAGE_TEMPLATE)) {
		throw new Error(
			`No host page template at ${HOST_PAGE_TEMPLATE} — the engine checkout is incomplete.`,
		);
	}
	// BESIDE the delivery folder, never inside it. `final/` is uploaded to the CDN wholesale, and a
	// CDN does not execute `<?js ?>` — it serves the bytes. Shipped inside, this template would
	// publish the partner's OWN server-side source (their session lookup, their Redis calls, their
	// admin launch branch) as plain text at a guessable URL. Their session API puts the real thing
	// at `/webnode/views/eanew/embed.html` on the application server, which is not the CDN at all.
	const hostPagePath = resolve(dirname(final), HOST_PAGE_FILE);
	cpSync(HOST_PAGE_TEMPLATE, hostPagePath);

	// NOTHING THAT IS SOURCE MAY LEAVE WITH THE UPLOAD.
	//
	// A delivery folder goes to a partner's CDN, which serves whatever is in it as bytes. The
	// partner's own `embed.html` was one instance of that hazard; this is the general guard, because
	// the next one will not arrive by the same route. `static/` is copied into a build wholesale, so
	// a stray `.ts` dropped there — a config kept "for reference", a scratch file — reaches the CDN
	// with no step in between that would notice.
	//
	// `.map` is in the list for the same reason and is the likelier accident: a sourcemap is the
	// whole of our source, `config-vite` disables it only for a non-dev build, and one env var set
	// the wrong way would publish the engine.
	//
	// A hard failure, not a warning. Everything else here refuses rather than repairs, and a
	// delivery is handed over once — a warning in a build log is read after the zip has gone.
	// One list, checked EVERYWHERE — the mirrored `assets/` tree included. It needed an exemption
	// only while its `index.ts` manifests were still being shipped; now that they are stripped
	// above, a `.ts` anywhere in a delivery is a file nobody put there on purpose.
	//
	// `.map` is the likeliest accident and the worst: a sourcemap is the whole of our source, and
	// `config-vite` disables it only for a non-dev build, so one env var set the wrong way would
	// publish the engine.
	const LEAKY = ['.ts', '.tsx', '.svelte', '.map', '.env'];

	const leaked = walkFiles(final).filter((file) =>
		LEAKY.some((ext) => relative(final, file).toLowerCase().endsWith(ext)),
	);

	if (leaked.length) {
		throw new Error(
			`${final} contains source files a CDN would serve verbatim:\n` +
				leaked.map((file) => `  ${relative(final, file).split(sep).join('/')}`).join('\n') +
				`\nA delivery is built output only. Move them out of the game's static/ folder.`,
		);
	}

	const { fileCount, bytes } = measure(final);

	let zip = null;
	if (wantZip) {
		const zipPath = resolve(dirname(final), `${alias}.zip`);
		const { files, bytes: zipBytes } = zipDir(final, zipPath, {
			root: alias,
			// At the archive ROOT, outside `alias/`, so the unzip shows what goes where: the
			// folder is the CDN upload, the page beside it is the app-server patch.
			extra: [{ name: HOST_PAGE_FILE, file: hostPagePath }],
		});
		zip = { path: zipPath, files, bytes: zipBytes };
	}

	// `--service` carries the BAKED endpoint into the preview. Without it `serve-embed.mjs` falls back
	// to its own default, so a profile pointing anywhere else would be exercised over a path the
	// delivery never uses — a preview that passes while the real thing 404s.
	const endpoint = baked.rgs?.endpoint ?? '';
	const serveArgs = [final, '--alias', alias];
	if (endpoint) serveArgs.push('--service', endpoint.replace(/^\//, ''));

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
					stripped: {
						files: stripped.length,
						bytes: strippedBytes,
						paths: stripped.map((file) => relative(final, file).split(sep).join('/')),
					},
					hostPage: hostPagePath,
					endpoint,
					fileCount,
					bytes,
					// Top-level entries, directories included — `measure()` returns files only, so
					// filtering its list showed `game.js` and hid `_app/` and `assets/`.
					contents: readdirSync(final).sort(),
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

	/**
	 * Warn about delivery output git does not ignore.
	 *
	 * The scaffolder only learned to ignore `/delivery` and `/*.zip` today, and nothing refreshes an
	 * existing repo's `.gitignore` — the same snapshot problem this script exists to sidestep. So an
	 * older game repo ends a delivery with tens of megabytes of artifact sitting in its working tree,
	 * one `git add -A` from being committed. Asking git is the only reliable answer (a repo may ignore
	 * these by another rule entirely); a git that will not run simply means no warning.
	 */
	const notIgnored = [final, zip?.path].filter(Boolean).filter((path) => {
		const probe = spawnSync('git', ['check-ignore', '-q', path], { cwd: gameRoot });
		return probe.error ? false : probe.status === 1;
	});

	const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
	console.info(
		`\n  Delivery build ready — profile '${profile}'\n` +
			`    ${final}\n` +
			`    ${fileCount} files, ${mb(bytes)}\n` +
			(stripped.length
				? `    stripped: ${stripped.length} build-time file${stripped.length === 1 ? '' : 's'}` +
					` (${mb(strippedBytes)}) the running game never loads\n`
				: '') +
			`    contract: ${docPath}\n` +
			`    page:     ${hostPagePath}  (their app server — NOT the CDN upload)\n` +
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
					`        or pass --alias — a mismatch is a 404 on their CDN.\n`) +
			(notIgnored.length
				? `\n  NOTE: git does not ignore this delivery output:\n` +
					notIgnored.map((path) => `        ${path}\n`).join('') +
					`        Add '/delivery' and '/*.zip' to .gitignore — it is build artifact, and\n` +
					`        a 'git add -A' would commit ${mb(bytes + (zip?.bytes ?? 0))} of it.\n`
				: ''),
	);
} catch (error) {
	fail(error);
}
