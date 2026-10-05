// The current-games harness never publishes a secret's value: not in the commit-status description,
// the step summary, nor the report artifact. GitHub masks secrets in job logs only; a status posted
// through the API once showed the raw value of a mis-set PIPELINE_GAMES_URL.
//
//   node scripts/current-games/redact.fixture.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listGames } from './lib/games.mjs';
import { assembleReport } from './lib/assemble.mjs';
import { writeReport } from './lib/report.mjs';
import { MASK, redactText, SECRET_ENV } from './lib/redact.mjs';

const hex = (seed, n) =>
	Array.from({ length: n }, (_, i) => ((seed * 7 + i * 13) % 16).toString(16)).join('');
const SECRETS = {
	// The 2026-10-04 incident: a 64-hex token pasted into the URL secret.
	PIPELINE_GAMES_URL: hex(1, 64),
	PIPELINE_CI_TOKEN: hex(2, 64),
	CURRENT_GAMES_R2_ENDPOINT: `https://${hex(3, 32)}.r2.cloudflarestorage.com`,
	CURRENT_GAMES_R2_BUCKET: 'iw-games-fixture',
	CURRENT_GAMES_R2_ACCESS_KEY_ID: hex(4, 32),
	CURRENT_GAMES_R2_SECRET_ACCESS_KEY: hex(5, 64),
};
assert.deepEqual(
	Object.keys(SECRETS).sort(),
	[...SECRET_ENV].sort(),
	'the fixture covers every secret',
);
Object.assign(process.env, SECRETS);

/** The values, plus every 12-char slice of a long one: a partial leak is a leak. */
const leaks = (text) =>
	Object.entries(SECRETS).flatMap(([name, v]) => {
		const probes = v.length > 24 ? [v, v.slice(0, 12), v.slice(-12)] : [v];
		return probes.filter((p) => text.includes(p)).map((p) => `${name} (${p.length} chars)`);
	});
const clean = (text, where) => assert.deepEqual(leaks(text), [], `${where} leaks a secret`);

let failures = 0;
const test = async (name, fn) => {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}\n     ${e.message}`);
	}
};

const tmp = mkdtempSync(join(tmpdir(), 'cg-redact-'));
/** What the workflow posts: the summary line, cut at 139, after the CLI redaction pass. */
const postedDescription = (line, env = process.env) => {
	const r = spawnSync(process.execPath, [join(import.meta.dirname, 'lib/redact.mjs')], {
		input: line,
		env,
		encoding: 'utf8',
	});
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.slice(0, 139);
};

await test('a non-URL PIPELINE_GAMES_URL fails with a fixed message that never quotes it', async () => {
	await assert.rejects(listGames({}), (e) => {
		assert.equal(e.message, 'PIPELINE_GAMES_URL is not an absolute https URL');
		return true;
	});
	process.env.PIPELINE_GAMES_URL = 'http://launcher.example/api/pipeline/games';
	await assert.rejects(listGames({}), /not an absolute https URL/);
	process.env.PIPELINE_GAMES_URL = SECRETS.PIPELINE_GAMES_URL;
});

for (const [name, value] of Object.entries(SECRETS))
	await test(`an abort quoting ${name} posts a clean description and report`, () => {
		const out = join(tmp, name);
		mkdirSync(out, { recursive: true });
		const report = writeReport(out, {
			version: 1,
			aborted: `Failed to parse URL from ${value}`,
			games: [],
		});
		clean(report.summary.line, 'summary line');
		clean(postedDescription(report.summary.line), 'posted description');
		clean(readFileSync(join(out, 'report.json'), 'utf8'), 'report.json');
		clean(readFileSync(join(out, 'index.html'), 'utf8'), 'index.html');
		assert.ok(report.summary.line.includes(MASK), 'the mask marks where it was');
	});

await test('every free-text field of a game row is redacted; ids keep their hashes', () => {
	const all = Object.values(SECRETS).join(' | ');
	const sha = 'a'.repeat(40);
	const out = join(tmp, 'rows');
	mkdirSync(out, { recursive: true });
	const failure = { side: 'head', scenario: 's', error: all, errors: 1, stalls: 0, console: [all] };
	const report = writeReport(out, {
		version: 1,
		head: { sha, ref: 'b' },
		games: [
			{
				key: 'g',
				name: 'G',
				build: { status: 'fail', detail: all },
				tests: { status: 'fail', gates: [], smoke: { status: 'fail', failures: [failure] } },
				looks: {
					status: 'error',
					detail: `snapshot fetch failed: ${all}`,
					baseFailures: [failure],
				},
				screens: [{ screen: 'x', pass: false, reason: all, id: `${sha}:g:x:${'b'.repeat(16)}` }],
				notes: [all],
			},
		],
	});
	for (const file of ['report.json', 'index.html'])
		clean(readFileSync(join(out, file), 'utf8'), file);
	clean(report.summary.line, 'summary line');
	assert.equal(report.head.sha, sha, 'a SHA field is not masked by the backstop');
	assert.equal(report.games[0].screens[0].id, `${sha}:g:x:${'b'.repeat(16)}`);
});

await test('the compare job, which has no secrets, still masks a token-shaped value', () => {
	const saved = Object.fromEntries(SECRET_ENV.map((n) => [n, process.env[n]]));
	for (const n of SECRET_ENV) delete process.env[n];
	try {
		const report = assembleReport({
			plan: { aborted: `Failed to parse URL from ${SECRETS.PIPELINE_CI_TOKEN}`, games: [] },
			unitDirs: [],
			out: join(tmp, 'compared'),
			tolerance: {},
		});
		clean(report.summary.line, 'compared summary line');
		clean(
			postedDescription(
				`Failed to parse URL from ${SECRETS.CURRENT_GAMES_R2_SECRET_ACCESS_KEY}`,
				{},
			),
			'CLI without env',
		);
	} finally {
		Object.assign(process.env, saved);
	}
});

await test('the backstop leaves ordinary messages alone', () => {
	const msg =
		'game list: HTTP 503 from PIPELINE_GAMES_URL · scripts/current-games/runtimes/working-tree';
	assert.equal(redactText(msg, {}), msg);
});

rmSync(tmp, { recursive: true, force: true });
if (failures) {
	console.error(`${failures} failure(s)`);
	process.exit(1);
}
console.log('current-games redaction: all checks pass');
