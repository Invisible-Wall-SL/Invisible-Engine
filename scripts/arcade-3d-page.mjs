// Builds the self-contained page that runs the 3D determinism scenario in a browser (Chrome, iOS
// Safari): motion3d.js and scripts/arcade-3d-scenario.mjs inlined into one HTML file with the
// committed replay as the expectation. The page runs the scenario three times (the later runs on
// optimised code), shows every checkpoint hash, and says MATCH or DIFFERS against Node's fixture.
// Open it on a phone and read back the verdict and the 8-character code.
//
// It ships as a launcher static file, https://app.invisiblewall.org/spikes/arcade-3d.html, so a
// phone opens it with no sign-in; check:arcade-3d fails when the committed copy is stale.
//
// Run: node scripts/arcade-3d-page.mjs            (rewrites the committed page)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARCADE3D_PAGE = join(ROOT, 'apps/launcher-api/static/spikes/arcade-3d.html');

const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const inline = (file) =>
	read(file)
		.replace(/^import[\s\S]*?from '[^']+';\n/m, '')
		.replace(/^export /gm, '');
export function buildArcade3dPage() {
	const expected = read('packages/engine-mechanics/fixtures/arcade-3d-replay.json');
	const code = [
		inline('packages/engine-mechanics/src/motion3d.js'),
		inline('scripts/arcade-3d-scenario.mjs'),
	].join('\n');
	if (/^\s*import /m.test(code)) throw new Error('arcade-3d-page: an import survived inlining');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Invisible 3D Determinism</title>
<style>
:root { --bg: #f6f7f9; --fg: #15171c; --muted: #5d6470; --ok: #127a3a; --bad: #b3261e; --card: #fff; --line: #dde1e7; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111318; --fg: #e8eaee; --muted: #9aa1ad; --ok: #4cc27a; --bad: #ff7b72; --card: #1a1d24; --line: #2b2f38; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #111318; --fg: #e8eaee; --muted: #9aa1ad; --ok: #4cc27a; --bad: #ff7b72; --card: #1a1d24; --line: #2b2f38; color-scheme: dark; }
body { margin: 0; padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
main { max-width: 640px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
p { color: var(--muted); margin: 0 0 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.verdict { font-size: 28px; font-weight: 700; }
.ok { color: var(--ok); } .bad { color: var(--bad); }
.code { font: 700 32px/1.2 ui-monospace, Menlo, monospace; letter-spacing: 2px; }
table { width: 100%; border-collapse: collapse; font: 13px ui-monospace, Menlo, monospace; }
td { padding: 2px 4px; border-bottom: 1px solid var(--line); }
.small { font-size: 12px; color: var(--muted); word-break: break-all; }
</style>
</head>
<body>
<main>
<h1>Invisible 3D Determinism</h1>
<p>Six bodies, 12 000 steps of the 3D motion step. Every hash must equal Node's.</p>
<div class="card"><div id="verdict" class="verdict">Running…</div><div>Code <span id="code" class="code">—</span></div><div id="runs" class="small"></div></div>
<div class="card"><table id="table"></table></div>
<div class="card small" id="ua"></div>
</main>
<script>
${code}
const EXPECTED = ${expected.trim()};
const runs = [];
let all = true;
for (let i = 0; i < 3; i++) {
	const t0 = performance.now();
	const r = runScenario3d();
	runs.push({ r, ms: performance.now() - t0 });
	if (JSON.stringify(r) !== JSON.stringify(EXPECTED)) all = false;
}
const first = runs[0].r;
const verdict = document.getElementById('verdict');
verdict.textContent = all ? 'MATCH' : 'DIFFERS';
verdict.className = 'verdict ' + (all ? 'ok' : 'bad');
document.getElementById('code').textContent = first.code;
document.getElementById('runs').textContent = 'runs: ' + runs.map((x) => x.r.code + ' in ' + x.ms.toFixed(0) + ' ms').join(' · ') + ' · expected ' + EXPECTED.code;
const rows = first.checkpoints.map((h, i) => {
	const want = EXPECTED.checkpoints[i];
	return '<tr><td>' + (i + 1) * first.every + '</td><td class="' + (h === want ? 'ok' : 'bad') + '">' + h + '</td><td>' + (h === want ? '' : 'want ' + want) + '</td></tr>';
});
document.getElementById('table').innerHTML = rows.join('');
document.getElementById('ua').textContent = navigator.userAgent;
window.__ARCADE3D__ = { match: all, code: first.code, checkpoints: first.checkpoints, last: first.last, runs: runs.map((x) => x.r.code) };
</script>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	mkdirSync(dirname(ARCADE3D_PAGE), { recursive: true });
	writeFileSync(ARCADE3D_PAGE, buildArcade3dPage());
	console.log(`arcade-3d-page: wrote ${ARCADE3D_PAGE}`);
}
