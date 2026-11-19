// Builds the self-contained page that makes the generated Crash arena in a browser: motion3d.js,
// levelNav3d.js, crashArena.js and scripts/arena-3d-scenario.mjs inlined into one HTML file with
// the committed fixture as the expectation. The page makes seeds 0..31 and walks seed 5's replay
// three times (the later runs on optimised code) and says MATCH or DIFFERS against Node's codes;
// `window.__ARENA3D__` holds the result for a driver (`scripts/arena-3d-browsers.mjs`).
//
// Run: node scripts/arena-3d-page.mjs <out.html>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const inline = (file) =>
	read(file)
		.replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
		.replace(/^export /gm, '');

/** `{ html, code }`: the page, and the inlined script alone (the gate runs it in Node). */
export function buildArena3dPage(fixture) {
	const code = [
		'packages/engine-mechanics/src/motion3d.js',
		'packages/engine-mechanics/src/levelNav3d.js',
		'packages/engine-mechanics/src/crashArena.js',
		'scripts/arena-3d-scenario.mjs',
	]
		.map(inline)
		.join('\n');
	if (/^\s*import /m.test(code)) throw new Error('arena-3d-page: an import survived inlining');
	const expected = JSON.stringify({ seeds: fixture.seeds.code, replay: fixture.replay.code });
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invisible Arena Determinism</title>
<style>
:root { --bg: #f6f7f9; --fg: #15171c; --ok: #127a3a; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111318; --fg: #e8eaee; --ok: #4cc27a; --bad: #ff7b72; } }
:root[data-theme="dark"] { --bg: #111318; --fg: #e8eaee; --ok: #4cc27a; --bad: #ff7b72; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
.ok { color: var(--ok); } .bad { color: var(--bad); }
#verdict { font-size: 28px; font-weight: 700; }
code { font: 13px ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
<h1>Invisible Arena Determinism</h1>
<p>The Crash arena of seeds 0–31 and seed 5's walk to the pit. Every code must equal Node's.</p>
<div id="verdict">Running…</div>
<pre id="runs"></pre>
<script>
${code}
const EXPECTED = ${expected};
const runs = [];
for (let k = 0; k < 3; k++) {
	const t = performance.now();
	runs.push({ seeds: arenaSeedsCode().code, replay: walkArenaRoutes(5).code, ms: Math.round(performance.now() - t) });
}
const ok = runs.every((r) => r.seeds === EXPECTED.seeds && r.replay === EXPECTED.replay);
window.__ARENA3D__ = { ok, runs, expected: EXPECTED, userAgent: navigator.userAgent };
const verdict = document.getElementById('verdict');
verdict.textContent = ok ? 'MATCH ' + EXPECTED.seeds + ' / ' + EXPECTED.replay : 'DIFFERS';
verdict.className = ok ? 'ok' : 'bad';
document.getElementById('runs').textContent = runs.map((r) => r.seeds + ' ' + r.replay + ' ' + r.ms + ' ms').join('\\n');
</script>
</body>
</html>
`;
	return { html, code };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = process.argv[2];
	if (!out) throw new Error('usage: node scripts/arena-3d-page.mjs <out.html>');
	const fixture = JSON.parse(read('packages/engine-mechanics/fixtures/arena-3d.json'));
	writeFileSync(out, buildArena3dPage(fixture).html);
	console.log(`wrote ${out}`);
}
