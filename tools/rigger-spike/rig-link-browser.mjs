// Browser gate for the Rigger's link by bundle name: `/rigger?rig=<bundle>` → `view.html#rig=<bundle>`
// (`apps/launcher-api/src/lib/riggerLinks.ts`, used by Invisible Characters' rig picker).
//
//   node tools/rigger-spike/rig-link-browser.mjs
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher that lists two rigs, and checks that
//   - `#rig=<folder>` opens that rig (not the first of the list), and the hash is taken off the URL
//     with the page's query kept;
//   - a name the project has not opens the list with a note that names it, and no rig;
//   - no hash opens no rig, as before;
//   - the page throws nothing.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));

let html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8').replace(/\r\n/g, '\n');
if (process.env.RIG_LINK_MUTANT === 'no-hash') {
	const from = '  const rig = h.get("rig");\n';
	if (!html.includes(from)) { console.log('the mutant no longer applies'); process.exit(2); }
	html = html.replace(from, '  const rig = null;\n');
}

const doc = readFileSync(join(RIG_ASSETS, 'anticipation', 'anticipation.json'), 'utf8');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const entry = (id, folder) => ({ id, name: folder, folder, dir_b64: b64(folder), skeleton_file: `${folder}.json`, atlas_file: 'anticipation.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false });
const ENTRIES = [entry(0, 'bear'), entry(1, 'salmon')];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/rigger/view.html') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (name.endsWith('.json')) return send(200, MIME['.json'], doc);
			if (['anticipation.atlas', 'anticipation.png', 'anticipation.webp'].includes(name)) return send(200, MIME[extname(name)], readFileSync(join(RIG_ASSETS, 'anticipation', name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) return jsonOut({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) { send(500, 'text/plain', String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/rigger/view.html?home=x&v=1`;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`); } return cond; };

/** Open the page at `hash` and say what it opened, once it has settled. */
async function open(label, hash) {
	const browser = await launchChrome({ name: 'rig-link', url: base + hash, args: ['--window-size=1600,1000'] });
	try {
		await browser.waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await browser.waitFor('!!selected || document.getElementById("err").style.display === "block" || performance.now() > 4000', 30000);
		await browser.waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
		const seen = await browser.evaluate(`({
			selected: selected ? selected.folder : null,
			doc: typeof rawDoc !== "undefined" && !!rawDoc,
			note: document.getElementById("err").style.display === "block" ? document.getElementById("err").textContent : "",
			hash: location.hash,
			search: location.search,
		})`);
		const thrown = browser.pageLog.filter((l) => l.startsWith('[uncaught]') || l.startsWith('[error]'));
		ok(`${label}: the page throws nothing`, thrown.length === 0, thrown.slice(0, 3).join(' | '));
		return seen;
	} finally {
		await browser.close();
	}
}

try {
	console.log('\n1. #rig=<folder> opens that rig');
	const second = await open('a rig by name', '#rig=salmon');
	ok('the rig named is the one open, not the first listed', second.selected === 'salmon' && second.doc, JSON.stringify(second));
	ok('no note', second.note === '', second.note);
	ok('the hash is taken off the URL and the query kept', second.hash === '' && second.search.includes('v=1'), `${second.search}${second.hash}`);

	console.log('\n2. a name the project has not');
	const unknown = await open('an unknown name', '#rig=' + encodeURIComponent('no such/rig'));
	ok('no rig is open', unknown.selected === null && !unknown.doc, JSON.stringify(unknown));
	ok('a note names it', unknown.note.includes('no such/rig') && unknown.note.includes('no rig named'), unknown.note);

	console.log('\n3. no hash');
	const plain = await open('no hash', '');
	ok('no rig is open and nothing is said', plain.selected === null && plain.note === '', JSON.stringify(plain));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	server.close();
}
console.log(`\n${fail ? '✗ FAIL' : '✅ PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
