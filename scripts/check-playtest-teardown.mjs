// A playtest must stop the test server it started. `startTestServer`
// (`scripts/current-games/lib/serve.mjs`) returns `{ origin, port, log, stop }`, with no `close`, so
// `await server.close?.()` is a silent no-op and the test-server process outlives the script. Nine
// playtests shipped that way (the #1799 review). `serveSnapshot` returns `{ close }`: closing a
// snapshot is right and is not flagged.
//
// Fails when a `scripts/playtest/*.mjs`:
//  - calls `.close` on a name bound to `startTestServer(…)`'s result;
//  - does a bare `server.close?.()` (the leaking shape, whatever `server` is bound to).
//
// Run: node scripts/check-playtest-teardown.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'scripts', 'playtest');

const BINDING = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?startTestServer\s*\(/g;
const BARE_OPTIONAL_CLOSE = /\bserver\s*\.\s*close\s*\?\.\s*\(/;

/** Every `line: problem` in `source`. */
export function teardownProblems(source) {
	const names = new Set([...source.matchAll(BINDING)].map((m) => m[1]));
	const problems = [];
	source.split('\n').forEach((line, i) => {
		if (BARE_OPTIONAL_CLOSE.test(line))
			problems.push(`${i + 1}: \`server.close?.()\` — a startTestServer result has \`stop()\``);
		else
			for (const name of names)
				if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.|\\.)\\s*close\\b`).test(line))
					problems.push(
						`${i + 1}: \`${name}.close\` on a startTestServer result — call \`stop()\``,
					);
	});
	return problems;
}

const fixtures = [
	[
		'old: optional close',
		'const server = await startTestServer(t, {});\nawait server.close?.();',
		1,
	],
	['old: plain close', 'const srv = await startTestServer(t, {});\nsrv.close();', 1],
	['let binding', 'let s;\ns = await startTestServer(t, {});\nawait s?.close();', 1],
	['stop', 'const server = await startTestServer(t, {});\nserver.stop();', 0],
	['snapshot close', 'const snap = await serveSnapshot({});\nawait snap.close?.();', 0],
	['other http server', 'const server = createServer();\nserver.close();', 0],
];
let failed = 0;
for (const [name, source, want] of fixtures) {
	const got = teardownProblems(source).length;
	if (got !== want) {
		console.error(`✗ self-test "${name}": ${got} problem(s), want ${want}`);
		failed++;
	}
}

for (const file of readdirSync(DIR)
	.filter((f) => f.endsWith('.mjs'))
	.sort()) {
	for (const problem of teardownProblems(readFileSync(join(DIR, file), 'utf8'))) {
		console.error(`✗ scripts/playtest/${file}:${problem}`);
		failed++;
	}
}

if (failed) {
	console.error(`\nplaytest teardown: ${failed} problem(s)`);
	process.exit(1);
}
console.log('✓ every playtest stops the test server it started');
