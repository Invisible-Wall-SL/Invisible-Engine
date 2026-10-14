/**
 * Upload a delivery build to the PARTNER's CDN bucket, through the portal.
 *
 *     node engine/scripts/upload-delivery.mjs <delivery folder> --alias BookOfBorut
 *                                             [--version v3] [--portal https://app.invisiblewall.org]
 *                                             [--json result.json]
 *
 * The folder is what `build-delivery.mjs` wrote (game.js, _app/, assets/, EMBED.md,
 * build-info.json). It lands at `{cdnUrl}/{brand}/games/{versionPath}/{alias}/` in the partner's
 * bucket — the URL their page composes — and the portal SEALS that folder once every file is there:
 * a delivered versionPath is never written again, so each upload is a new one and a rollback is the
 * partner pointing back at an old one. Omit `--version` and the portal suggests the next (`v1`,
 * `v2`, …).
 *
 * WHY THROUGH THE PORTAL. The bucket's key pair is the partner's and lives only in the launcher's
 * env (`DELIVERY_R2_*`, `docs/INFRA.md`); this script holds no credential but a portal sign-in with
 * the `gamePublish` capability. Sign in with `IE_PORTAL_EMAIL` / `IE_PORTAL_PASSWORD`, or answer
 * the prompt. The login token is short-lived, so a 401 mid-upload signs in again.
 *
 * Resumable: files already in an unsealed folder with the same MD5 are skipped, so re-running after
 * a dropped line sends only the rest. Like `build-delivery.mjs`, it needs nothing installed.
 *
 * See `docs/design/delivery-builds.md` §"Phase 5 — upload to the partner's CDN".
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const folder = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : '';
const alias = arg('--alias', '');
const portal = arg(
	'--portal',
	process.env.IE_PORTAL_URL || 'https://app.invisiblewall.org',
).replace(/\/+$/, '');
const jsonOut = arg('--json', '');
const CONCURRENCY = 4;

function fail(message) {
	console.error(`\n  upload-delivery: ${message}\n`);
	if (jsonOut)
		writeFileSync(jsonOut, `${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
	process.exit(1);
}

if (!folder || !alias) {
	fail(
		'usage: upload-delivery.mjs <delivery folder> --alias <gameAlias> [--version <versionPath>]',
	);
}
if (!existsSync(join(folder, 'game.js'))) {
	fail(`${folder} has no game.js — point this at the folder build-delivery.mjs wrote.`);
}

function ask(question, hidden) {
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	if (hidden) {
		rl._writeToOutput = (s) => {
			if (s.startsWith(question)) rl.output.write(question);
		};
	}
	return new Promise((done) =>
		rl.question(question, (answer) => {
			rl.close();
			if (hidden) process.stdout.write('\n');
			done(answer.trim());
		}),
	);
}

let credentials = null;
let token = '';

async function signIn() {
	credentials ??= {
		email: process.env.IE_PORTAL_EMAIL || (await ask('  Portal email: ')),
		password: process.env.IE_PORTAL_PASSWORD || (await ask('  Portal password: ', true)),
	};
	const res = await fetch(`${portal}/api/launcher/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(credentials),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.token) fail(`sign-in to ${portal} failed: ${body.error ?? res.status}`);
	token = body.token;
}

/** One portal call, signing in again once if the short-lived token has expired. */
async function call(method, query, body, contentType) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(
			`${portal}/api/launcher/delivery-upload?${new URLSearchParams(query)}`,
			{
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(contentType ? { 'content-type': contentType } : {}),
				},
				body,
			},
		);
		if (res.status === 401 && attempt === 0) {
			await signIn();
			continue;
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data.error ?? data.message ?? `${method} answered ${res.status}`);
		}
		return data;
	}
}

const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});

try {
	await signIn();

	const info = await call('GET', { alias });
	if (!info.configured) fail('the portal has no partner bucket configured (DELIVERY_R2_* env).');
	const version = arg('--version', info.suggestedVersion);
	if (info.delivered.includes(version)) {
		fail(`${alias} ${version} is already delivered and is never overwritten. Use a new --version.`);
	}

	const state = await call('GET', { alias, version });
	const remote = new Map((state.files ?? []).map((f) => [f.path, f.md5]));

	const files = walk(folder).map((full) => ({
		full,
		rel: relative(folder, full).split(sep).join('/'),
		size: statSync(full).size,
	}));
	const tooBig = files.filter((f) => f.size > info.maxFileBytes);
	if (tooBig.length) {
		fail(
			`over the portal's ${info.maxFileBytes}-byte per-file limit: ` +
				tooBig.map((f) => `${f.rel} (${f.size})`).join(', '),
		);
	}

	const todo = files.filter(
		(f) => remote.get(f.rel) !== createHash('md5').update(readFileSync(f.full)).digest('hex'),
	);
	console.info(
		`\n  Uploading ${alias} → ${state.folder}\n` +
			`    ${files.length} files, ${todo.length} to send` +
			(todo.length < files.length ? ` (${files.length - todo.length} already there)` : '') +
			'\n',
	);

	let sent = 0;
	const queue = [...todo];
	await Promise.all(
		Array.from({ length: CONCURRENCY }, async () => {
			for (let f = queue.shift(); f; f = queue.shift()) {
				await call(
					'PUT',
					{ alias, version, path: f.rel },
					readFileSync(f.full),
					'application/octet-stream',
				);
				sent++;
				if (sent % 25 === 0 || sent === todo.length) {
					console.info(`    ${sent}/${todo.length}`);
				}
			}
		}),
	);

	const buildInfo = join(folder, 'build-info.json');
	const build = existsSync(buildInfo) ? JSON.parse(readFileSync(buildInfo, 'utf8')) : null;
	const result = await call(
		'POST',
		{ alias, version },
		JSON.stringify({ files: files.map((f) => f.rel), build }),
		'application/json',
	);

	const { record, served, pruned } = result;
	const servedOk = served.status === 200;
	console.info(
		`\n  Delivered ${alias} as versionPath '${version}' (sealed${pruned ? `, ${pruned} stale file(s) pruned` : ''})\n` +
			`    ${record.url}\n\n` +
			`  Tell the partner: set versionPath = '${version}' for ${alias}.\n\n` +
			`  Served check: ${servedOk ? 'game.js answers 200' : `game.js answered ${served.status || served.error}`}` +
			(servedOk && !served.cors
				? `\n    WARNING: no Access-Control-Allow-Origin — their page loads the art cross-origin,\n` +
					`    and WebGL refuses textures without CORS. Add a CORS rule on the bucket.`
				: '') +
			'\n',
	);
	if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
