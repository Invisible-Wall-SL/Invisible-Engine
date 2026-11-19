// Browser gate for the Face section's lip-sync (rig templates T4), on the SHIPPED view.html in a real
// Chromium against a fake launcher API, with a real `bust-face` rig built by the server's
// `templateRig`. Checked:
//  - 🎤 Lip-sync opens the panel and lists the project's voice lines;
//  - an upload asks for a presigned URL with the file's name and size, PUTs the bytes there with
//    the content type it was given (never through the launcher), and selects the new line;
//  - 🎤 Key at playhead sends the line, the words and the recognizer, and keys the answer at the
//    playhead through the template's lip-sync map, replacing the mouth keys under the line;
//  - the whole line is ONE undo step: one undo gives back exactly the document before it;
//  - 🔊 Play with voice plays the clip from where the line was keyed, with that line's audio.
// What it does NOT cover: R2, auth, atlas-tool and Rhubarb (test_lipsync.py and face-channels.mjs).
//   node tools/rigger-spike/face-lipsync-browser.mjs
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'face-lipsync-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { BUST_FACE, templateRig, rigTemplateFromSidecar } = await import(pathToFileURL(out).href);

// The art: every template part, packed in rows on one blank page.
const PAGE_W = 1024;
let x = 0,
	y = 0,
	rowH = 0;
const atlasLines = [];
const regions = BUST_FACE.parts.map((p) => {
	const [w, h] = p.size;
	if (x + w > PAGE_W) {
		x = 0;
		y += rowH;
		rowH = 0;
	}
	atlasLines.push(p.name, `bounds:${x},${y},${w},${h}`);
	const r = { name: p.name, w, h };
	x += w;
	rowH = Math.max(rowH, h);
	return r;
});
const PAGE_H = y + rowH;
const ATLAS = ['face.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...atlasLines].join(
	'\n',
);
function png(w, h) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc((w * 4 + 1) * h, 0x80);
	for (let r = 0; r < h; r++) raw[r * (w * 4 + 1)] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
const PNG = png(PAGE_W, PAGE_H);
const RIG = templateRig(BUST_FACE, regions).skeleton;
RIG.animations = { talk_line: { slots: { mouth: { attachment: [] } } } };
const TEMPLATE = rigTemplateFromSidecar(
	JSON.stringify({ id: BUST_FACE.id, version: BUST_FACE.version }),
);
const DIR = Buffer.from('face', 'utf8').toString('base64url');

// The answer atlas-tool would give: Rhubarb's real cues for the first words of a line.
const CUES = [
	{ start: 0, end: 0.22, value: 'X' },
	{ start: 0.22, end: 0.28, value: 'F' },
	{ start: 0.28, end: 0.62, value: 'C' },
	{ start: 0.62, end: 0.75, value: 'A' },
	{ start: 0.75, end: 1.02, value: 'D' },
	{ start: 1.02, end: 1.2, value: 'X' },
];
const seen = { voicePosts: [], puts: [], lipsync: [] };
const voices = [{ file: 'hello-0a1b2c3d.wav', size: 1000, modified: 1 }];

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
};
const readBody = (req) =>
	new Promise((r) => {
		const parts = [];
		req.on('data', (c) => parts.push(c));
		req.on('end', () => r(Buffer.concat(parts)));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const json = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'face',
						folder: 'face',
						dir_b64: DIR,
						skeleton_file: 'face.irig',
						atlas_file: 'face.atlas',
						format: 'json',
						runtime: '4.2',
						version: '4.2',
						pma: false,
					},
				],
			});
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name');
			if (name === 'face.irig') return json(RIG);
			if (name === 'face.atlas') return send(200, 'text/plain', ATLAS);
			if (name === 'face.png') return send(200, 'image/png', PNG);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: TEMPLATE });
		if (p === '/api/rigger/voice' && req.method === 'POST') {
			const body = JSON.parse((await readBody(req)).toString());
			seen.voicePosts.push(body);
			const file = 'take_2-deadbeef.mp3';
			return json({
				file,
				url: `http://127.0.0.1:${PORT}/r2/${file}?sig=x`,
				contentType: 'audio/mpeg',
			});
		}
		if (p === '/api/rigger/voice') {
			if (url.searchParams.get('file')) return send(200, 'audio/wav', Buffer.alloc(64));
			return json({ voices });
		}
		if (p.startsWith('/r2/') && req.method === 'PUT') {
			const bytes = await readBody(req);
			seen.puts.push({ path: p, type: req.headers['content-type'], size: bytes.length });
			voices.unshift({ file: p.slice(4), size: bytes.length, modified: 2 });
			return send(200, 'text/plain', '');
		}
		if (p === '/api/rigger/lipsync') {
			seen.lipsync.push(JSON.parse((await readBody(req)).toString()));
			return json({ duration: 1.2, cues: CUES });
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/'))
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await launchChrome({
	name: 'face-lipsync',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--autoplay-policy=no-user-gesture-required'],
});
const { evaluate, waitFor, pageLog } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(
		`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`,
	);
	return cond;
};
const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("loadRigBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = () => true;
		window.prompt = () => "x";
		document.getElementById("loadRigBtn").click();
		return true;
	})()`);
	await waitFor(
		'[...document.querySelectorAll("#list .item .nm")].some((n) => n.textContent === "face")',
		30000,
	);
	await evaluate(`(() => {
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "face");
		row.click();
		return true;
	})()`);
	await waitFor('!!skeleton && !!rigTemplate', 30000);
	await evaluate(
		`(() => { document.querySelector('#modeSeg button[data-mode="animate"]').click(); return true; })()`,
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate('curAnim = "talk_line"; true');
	ok(
		'a template rig shows the Face section in Animate',
		await evaluate('document.getElementById("secFace").style.display !== "none"'),
	);

	const lipBtn = `[...document.querySelectorAll("#faceList button")].find((b) => b.textContent.includes("Lip-sync"))`;
	ok('the Face section has 🎤 Lip-sync', await evaluate(`!!${lipBtn}`));
	await evaluate(`${lipBtn}.click(); true`);
	await waitFor(
		'!!document.querySelector("#faceList .faceLip select") && faceVoices !== null',
		10000,
	);
	await evaluate('true');
	await wait(100);
	const options = await evaluate(
		`[...document.querySelector("#faceList .faceLip select").options].map((o) => o.textContent)`,
	);
	ok(
		'the panel lists the project voice lines by their readable name, plus upload',
		options.includes('hello.wav') && options.some((o) => o.includes('Upload')),
		q(options),
	);

	// Upload: the file input gets a real File, as a pick does.
	await evaluate(`(() => {
		const input = document.querySelector("#faceList .faceLip input[type=file]");
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array(3000)], "take 2.mp3", { type: "audio/mp3" }));
		input.files = dt.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
	await waitFor('faceVoice === "take_2-deadbeef.mp3"', 10000);
	ok(
		'the upload asks for a URL with the name and size',
		q(seen.voicePosts[0]) === q({ name: 'take 2.mp3', bytes: 3000 }),
		q(seen.voicePosts),
	);
	ok(
		'the bytes are PUT to the presigned URL with its content type',
		seen.puts.length === 1 && seen.puts[0].type === 'audio/mpeg' && seen.puts[0].size === 3000,
		q(seen.puts),
	);
	ok(
		'the uploaded line is selected',
		(await evaluate('document.querySelector("#faceList .faceLip select").value')) ===
			'take_2-deadbeef.mp3',
	);

	// Key at 0.5 s over talk keys the line must replace, and one after it that must stay.
	const before = await evaluate(`(() => {
		const a = rawDoc.animations.talk_line, mouth = rigTemplate.channels.find((c) => c.shapes);
		historyStep(() => {
			faceKeyTalk(a, mouth, 0.4, 1, rigTemplate.channels, faceHas);
			faceKeyShape(a, mouth, "mouth_smile", 3, rigTemplate.channels, faceHas);
			markDirty();
		});
		animTime = 0.5; playing = false;
		document.querySelector("#faceList .faceLip input[type=text]").value = "Welcome back";
		return JSON.stringify(rawDoc);
	})()`);
	await evaluate(
		`[...document.querySelectorAll("#faceList .faceLip button")].find((b) => b.textContent.includes("Key at playhead")).click(); true`,
	);
	await waitFor('!!faceLine', 10000);
	ok(
		'the line, its words and the recognizer are sent',
		q(seen.lipsync[0]) ===
			q({ file: 'take_2-deadbeef.mp3', dialog: 'Welcome back', recognizer: 'pocketSphinx' }),
		q(seen.lipsync),
	);
	const keys = await evaluate(
		'rawDoc.animations.talk_line.slots.mouth.attachment.map((k) => k.time + ":" + (k.name || "-")).join(" ")',
	);
	ok(
		'the cues are keyed at the playhead through the lip-sync map, talk keys under it replaced',
		keys ===
			'0.4:mouth_A 0.5:mouth_rest 0.72:mouth_U 0.78:mouth_E 1.12:mouth_MBP 1.25:mouth_A 1.52:mouth_rest 3:mouth_smile',
		keys,
	);
	const jaw = await evaluate(
		'rawDoc.animations.talk_line.bones.jaw.translate.map((k) => k.time + ":" + k.y).join(" ")',
	);
	// Each key's jaw is its shape's opening × the jaw's travel, from the template.
	const mouth = BUST_FACE.channels.find((c) => c.shapes);
	const per = BUST_FACE.channels.find((c) => c.id === 'jaw').drives[0].per;
	const want = keys
		.split(' ')
		.map((k) => {
			const [t, name] = k.split(':');
			return `${t}:${Math.round(per * (mouth.shapes.open[name] ?? 0) * 100) / 100}`;
		})
		.join(' ');
	ok('the jaw opens per shape on the same keys', jaw === want, `${jaw} for ${want}`);
	const corner = await evaluate(
		'rawDoc.animations.talk_line.bones.mouth_corner_l.translate.map((k) => k.time + ":" + k.y).join(" ")',
	);
	const smile = mouth.shapes.pose.mouth_smile.smile_l;
	const cornerPer = BUST_FACE.channels.find((c) => c.id === 'smile_l').drives[0].per;
	ok(
		'the corners follow the shapes on the same keys (the smile lifts them, the rest drops them)',
		corner.split(' ').length === keys.split(' ').length &&
			corner.endsWith(`3:${Math.round(smile * cornerPer * 100) / 100}`) &&
			corner.startsWith('0.4:0'),
		corner,
	);
	await evaluate('document.getElementById("undoBtn").click(); true');
	ok(
		'one undo gives back exactly the document before the line',
		(await evaluate('JSON.stringify(rawDoc)')) === before,
	);
	await evaluate('document.getElementById("redoBtn").click(); true');
	ok(
		'redo puts the line back',
		(await evaluate(
			'rawDoc.animations.talk_line.slots.mouth.attachment.map((k) => k.time + ":" + (k.name || "-")).join(" ")',
		)) === keys,
	);

	await evaluate('animTime = 2; true');
	await evaluate(
		`[...document.querySelectorAll("#faceList .faceLip button")].find((b) => b.textContent.includes("Play with voice")).click(); true`,
	);
	const playback = await evaluate('({ playing, at: animTime, src: faceAudio && faceAudio.src })');
	ok(
		'🔊 plays the clip from the keyed line with its audio',
		playback.playing &&
			playback.at >= 0.5 &&
			playback.at < 1 &&
			playback.src.endsWith('/api/rigger/voice?file=take_2-deadbeef.mp3'),
		q(playback),
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
	console.log(
		await evaluate(
			'JSON.stringify({ raw: !!rawDoc, tpl: typeof rigTemplate !== "undefined" && !!rigTemplate, sel: !!selected, face: document.getElementById("secFace").style.display, hint: document.getElementById("hint").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — face lip-sync ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
