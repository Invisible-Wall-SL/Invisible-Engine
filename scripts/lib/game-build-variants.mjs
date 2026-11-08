// The four shapes a game build ships in, built from `apps/lines` the way each is really cut. Shared
// by the browser gates that boot them (`check-runtime-shell.mjs`, `check-ktx2-transcoder.mjs`), so
// `pnpm check:ktx2-transcoder --out <dir>` and `pnpm check:runtime-shell --skip-build --out <dir>`
// can share one set of builds.
//
//   runtime  the shared online runtime, as `runtime-release.yml` builds it: release env, a Sentry
//            DSN (a stand-in host, so the SDK chunk exists), `IE_SOURCEMAPS=hidden`, then
//            `sentry-sourcemaps.mjs runtime --strict` stages its maps and strips them.
//   arcade   the `arcade` runtime (release env, no hidden maps): its online code is a lazy chunk.
//   inline   a delivery built the default way (an `index.html` shell + `_app/`), with its own
//            profile (`delivery-profile.json` beside the builds): `rgs_url` may repoint it, so a
//            gate can serve its RGS without intercepting requests (interception turns off the
//            browser's HTTP cache, which is what `check-runtime-shell` measures).
//   embed    a `bundleStrategy: 'single'`, one-file delivery: `game.js` + `_app/` (`build-embed.mjs`).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A stand-in DSN: the SDK is compiled in and lazy-loaded, its reports go nowhere real. */
export const PROBE_DSN = 'https://public@sentry.invalid/1';

/** The inline delivery's profile: a real one's shape, but `?rgs_url=` may repoint it. */
const INLINE_PROFILE = {
	id: 'shell-probe',
	rgs: {
		baseUrl: 'https://rgs.invalid',
		endpoint: '/rgs/engine',
		withCredentials: false,
		simpleRequest: false,
		allowUrlOverride: true,
	},
	session: { param: 'sid', required: true },
};

export const VARIANTS = [
	{
		id: 'runtime',
		script: 'build',
		env: {
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILES: '*',
			PUBLIC_IE_FAMILIES: 'slot',
			PUBLIC_SENTRY_DSN: PROBE_DSN,
			IE_SOURCEMAPS: 'hidden',
		},
		sentry: true,
	},
	{
		id: 'arcade',
		script: 'build',
		env: {
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILES: '*',
			PUBLIC_IE_FAMILIES: 'arcade',
			PUBLIC_SENTRY_DSN: PROBE_DSN,
		},
	},
	{
		id: 'inline',
		script: 'build',
		env: (out) => ({
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILE: join(out, 'delivery-profile.json'),
			PUBLIC_SENTRY_DSN: PROBE_DSN,
		}),
	},
	{
		id: 'embed',
		script: 'build:embed',
		env: {
			PUBLIC_DELIVERY_EMBED: '1',
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILE: 'operator-embed',
		},
	},
];

const run = (cmd, args, env = {}) => {
	const r = spawnSync(cmd, args, {
		cwd: ROOT,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'inherit', 'inherit'],
		shell: process.platform === 'win32',
	});
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
};

/** A hidden-source-map build of the runtime outgrows Node's default heap on a 16 GB machine. */
const HEAP = /max-old-space-size/.test(process.env.NODE_OPTIONS ?? '')
	? {}
	: { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim() };

/** Build every variant into `out/<id>/`. */
export function buildVariants(out) {
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, 'delivery-profile.json'), JSON.stringify(INLINE_PROFILE, null, '\t'));
	run('pnpm', ['--filter', 'lines^...', 'build']);
	for (const { id, script, env, sentry } of VARIANTS) {
		rmSync(join(ROOT, 'apps/lines/build'), { recursive: true, force: true });
		run('pnpm', ['--filter', 'lines', script], {
			...HEAP,
			...(typeof env === 'function' ? env(out) : env),
		});
		rmSync(join(out, id), { recursive: true, force: true });
		cpSync(join(ROOT, 'apps/lines/build'), join(out, id), { recursive: true });
		if (sentry) {
			const staged = join(out, `${id}-sentry`);
			rmSync(staged, { recursive: true, force: true });
			run(process.execPath, [
				join(ROOT, 'scripts/sentry-sourcemaps.mjs'),
				'runtime',
				join(out, id),
				'--out',
				staged,
				'--strict',
			]);
		}
	}
}

/** Throw unless `out` holds every variant (a `--skip-build` run reuses a previous `--out`). */
export function assertVariants(out) {
	for (const { id } of VARIANTS) {
		if (!existsSync(join(out, id)))
			throw new Error(`no ${id} build in ${out} — run without --skip-build`);
	}
}
