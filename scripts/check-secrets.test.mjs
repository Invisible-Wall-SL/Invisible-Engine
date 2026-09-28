#!/usr/bin/env node
/**
 * Fixtures for scripts/check-secrets.mjs. Run: node scripts/check-secrets.test.mjs
 *
 * Every fake credential is ASSEMBLED at runtime from a seeded generator, never written out
 * literally — so this file trips neither our own scanner nor GitHub push protection.
 */
import assert from 'node:assert/strict';
import { createDiffScanner, scanContent, scanLine } from './check-secrets.mjs';

let seed = 7;
function rand(n, alphabet) {
	let s = '';
	for (let i = 0; i < n; i++) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		s += alphabet[seed % alphabet.length];
	}
	return s;
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const URLSAFE = ALNUM + '_-';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';
const p = (...parts) => parts.join('');

const SHOULD_FLAG = [
	['Anthropic API key', p('ANTHROPIC_API_KEY=sk-', 'ant-api03-', rand(93, URLSAFE), 'AA')],
	['Anthropic API key', p('const k = "sk-', 'ant-admin01-', rand(80, URLSAFE), '";')],
	['OpenAI key', p('OPENAI_API_KEY=sk-', 'proj-', rand(74, URLSAFE), 'T3', rand(40, URLSAFE))],
	['OpenAI key', p("key: 'sk-", 'admin-', rand(60, URLSAFE), "'")],
	['OpenAI key', p('sk-', 'svcacct-', rand(64, URLSAFE))],
	['OpenAI key (legacy)', p('sk-', rand(48, ALNUM))],
	['GitHub token', p('token ghp', '_', rand(36, ALNUM))],
	['GitHub token', p('gho', '_', rand(36, ALNUM))],
	['GitHub token', p('GH_TOKEN=ghs', '_', rand(36, ALNUM))],
	['GitHub fine-grained PAT', p('github', '_pat_', rand(22, ALNUM), '_', rand(59, ALNUM))],
	['RunPod API key', p('RUNPOD_API_KEY=rpa', '_', rand(40, UPPER))],
	['Cloudflare API token', p('cf', 'ut_', rand(40, URLSAFE))],
	['Cloudflare API token/key env', p('CLOUDFLARE_API_TOKEN=', rand(40, URLSAFE))],
	['Cloudflare API token/key env', p('CF_API_TOKEN: "', rand(40, URLSAFE), '"')],
	['Cloudflare tunnel token', p('cloudflared tunnel run --token ey', 'J', rand(120, URLSAFE))],
	['CF Access client secret env', p('CF_ACCESS_CLIENT_SECRET=', rand(64, HEX))],
	['AWS/R2 access key id', p('AK', 'IA', rand(16, UPPER))],
	['AWS/R2 secret access key env', p('AWS_SECRET_ACCESS_KEY=', rand(40, ALNUM + '/+'))],
	['AWS/R2 secret access key env', p('R2_SECRET_ACCESS_KEY="', rand(64, HEX), '"')],
	['R2 access key id env', p('R2_ACCESS_KEY_ID=', rand(32, HEX))],
	['Slack token', p('xo', 'xb-', rand(12, '0123456789'), '-', rand(24, ALNUM))],
	[
		'Slack webhook',
		p(
			'https://hooks.slack',
			'.com/services/T',
			rand(9, UPPER),
			'/B',
			rand(9, UPPER),
			'/',
			rand(24, ALNUM),
		),
	],
	['Private key block', p('-----BEGIN ', 'RSA PRIVATE KEY-----')],
	['Private key block', p('-----BEGIN ', 'PRIVATE KEY-----')],
	['Private key block', p('-----BEGIN ', 'OPENSSH PRIVATE KEY-----')],
	['Private key block', p('-----BEGIN ', 'ENCRYPTED PRIVATE KEY-----')],
	['Private key block', p('-----BEGIN ', 'PGP PRIVATE KEY BLOCK-----')],
	['Google API key', p('AI', 'za', rand(35, URLSAFE))],
	['Stripe live key', p('sk', '_live_', rand(32, ALNUM))],
	['Hugging Face token', p('HF_TOKEN=hf', '_', rand(34, ALNUM))],
	['npm token', p('np', 'm_', rand(36, ALNUM))],
	['comfy.org API key', p('comfy', 'ui-', rand(64, HEX))],
	[
		'Database URL with password',
		p('DATABASE_URL=postgresql://postgres:', rand(24, ALNUM), '@db.internal:5432/app'),
	],
	[
		'Database URL with password',
		p('rediss://default:', rand(30, ALNUM), '@cache.example.net:6379'),
	],
	['Generic 40+ hex secret', rand(64, HEX)],
];

const SHOULD_PASS = [
	'const task-manager-for-long-identifiers = 1;',
	'.desk-top-container-with-a-long-class-name { color: red; }',
	'use the sk-ant-api03-… format for Anthropic keys',
	p('ANTHROPIC_API_KEY=sk-', 'ant-api03-', 'x'.repeat(90)),
	p('gh', 'p_', 'x'.repeat(36)),
	'GitHub tokens start with github_pat_ or ghp_',
	'DATABASE_URL=postgresql://user:password@localhost:5432/db',
	'DATABASE_URL=postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}/app',
	'redis://localhost:6379',
	p('AK', 'IAIOSFODNN7EXAMPLE'),
	'R2_SECRET_ACCESS_KEY=',
	'R2_SECRET_ACCESS_KEY=<your-secret>',
	'CLOUDFLARE_API_TOKEN=${{ secrets.CLOUDFLARE_API_TOKEN }}',
	'commit 845d124b fixed it',
	'id: 3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c',
	'rpa_ is the RunPod key prefix',
	'sk-proj-short',
	p('token = "gh', 'p_', rand(36, ALNUM), '" // pragma: allowlist secret'),
];

let failures = 0;
function check(name, fn) {
	try {
		fn();
	} catch (err) {
		failures++;
		console.error(`✖ ${name}\n  ${err.message.split('\n')[0]}`);
	}
}

for (const [label, line] of SHOULD_FLAG) {
	check(`flags ${label}: ${line.slice(0, 24)}…`, () => assert.equal(scanLine(line), label));
}
for (const line of SHOULD_PASS) {
	check(`passes: ${line.slice(0, 40)}`, () => assert.equal(scanLine(line), null));
}

check('scanContent reports 1-based lines and skips lockfiles', () => {
	const content = ['ok', p('gh', 'p_', rand(36, ALNUM)), 'ok'].join('\n');
	assert.deepEqual(scanContent('src/a.ts', content), [
		{ file: 'src/a.ts', line: 2, label: 'GitHub token' },
	]);
	assert.deepEqual(scanContent('pnpm-lock.yaml', content), []);
});

check('diff scanner reports added lines only, with commit, path and new line number', () => {
	const findings = [];
	const scan = createDiffScanner((f) => findings.push(f));
	const sha = 'a'.repeat(40);
	[
		`commit ${sha}`,
		'diff --git a/x.env b/x.env',
		'--- a/x.env',
		'+++ b/x.env',
		'@@ -3,2 +10,3 @@',
		p('-OLD=gh', 'p_', rand(36, ALNUM)),
		' context',
		'+fine',
		p('+NEW=rp', 'a_', rand(40, UPPER), '\r'),
		'diff --git a/gone.txt b/gone.txt',
		'--- a/gone.txt',
		'+++ /dev/null',
		'@@ -1 +0,0 @@',
		p('-rp', 'a_', rand(40, UPPER)),
	].forEach(scan);
	assert.deepEqual(findings, [{ commit: sha, file: 'x.env', line: 12, label: 'RunPod API key' }]);
});

if (failures) {
	console.error(`\n${failures} check-secrets fixture(s) failed`);
	process.exit(1);
}
console.log(`check-secrets: ${SHOULD_FLAG.length + SHOULD_PASS.length + 2} fixtures pass`);
