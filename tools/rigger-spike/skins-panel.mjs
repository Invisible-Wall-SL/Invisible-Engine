// End-to-end browser gate for the /rigger SKINS — the Skin picker in the bottom bar, and the edits
// that write "into the active skin".
//
//   node tools/rigger-spike/skins-panel.mjs
//
// This drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium on a REAL
// shipped rig (`apps/lines/static/assets/spines/anticipation`), against a fake launcher API, the
// way an author works: ＋ Add skin, pick it in the Skin picker, ＋ add image… on a slot, rename it
// with ✎, delete it with 🗑, import a rig, click its skin in the skins list and add an image there.
// `linkedmesh.mjs` runs the same edits on the functions pulled out of the page; this is the half it
// cannot see — that the page's own wiring re-renders a real <select> (where a value no option
// carries reads back ""), that nothing the page sets fires the picker's `change`, and that the
// MINIFIED runtime puts the chosen skin on stage.
//
// The picker's options used to be built only when the rig opened, and the edits read the picker: in
// a skin added, renamed or imported since, it read "", ＋ add image wrote into the first skin, and
// every rebuild put the default skin back on stage.
//
// ＋ add image… in a skin other than default adds the image to that skin only: that skin's override
// of the name the slot shows, so every other skin draws what it drew. It used to make the new image
// the slot's setup attachment, which left the slot empty in default (and every skin without that
// name). The gate adds images in a new skin (twice on one slot, and on a slot with no setup
// attachment, where default must still draw nothing), in default, and in an imported skin that holds
// its own image; after each, the rig is read back through the loader and must draw the same, and
// 🗑 on the default skin must refuse.
//
// What it does NOT cover: R2, auth, saving.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_DIR = fileURLToPath(new URL('apps/lines/static/assets/spines/anticipation/', ROOT));

// ------------------------------------------------------------------ the fake launcher ----

const DIR_B64 = Buffer.from('anticipation', 'utf8').toString('base64url');
const rigJson = readFileSync(join(RIG_DIR, 'anticipation.json'), 'utf8');
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.atlas': 'text/plain',
	'.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], readFileSync(join(STATIC, 'rigger/view.html')));
		if (p === '/spine/skeletons')
			return jsonOut({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'anticipation',
						folder: 'anticipation',
						dir_b64: DIR_B64,
						skeleton_file: 'anticipation.json',
						atlas_file: 'anticipation.atlas',
						format: 'json',
						runtime: '4.2',
						version: '4.2',
						pma: false,
					},
				],
			});
		// The rig's `.atlas` names `anticipation.webp`, and the tool asks with `pp=1` (prefer PNG),
		// which the real server answers with the `.png` sibling — the bundle has both.
		if (p === '/spine/file') {
			const name = url.searchParams.get('name') ?? '';
			if (/^anticipation\.(json|atlas|png|webp)$/.test(name))
				return send(200, MIME[extname(name)], readFileSync(join(RIG_DIR, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		// The conditional .irig write reads the stored tag on open (`null` = no .irig yet).
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null });
		// ⤵ Import rig: the rig library's copy of this same rig, saved as "gem".
		if (p === '/api/rigger/rigs/get')
			return jsonOut({ name: 'gem', skeleton: JSON.parse(rigJson) });
		if (p === '/api/rigger/text') return send(404, 'text/plain', 'no text document');
		if (p.startsWith('/api/'))
			return jsonOut({ effects: [], atlases: [], rigs: [], animations: [] });
		// Everything else: the launcher's static tree (view.html's scripts + vendored runtimes).
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

// ------------------------------------------------------------------ CDP ----

const { evaluate, waitFor, pageLog, close: closeChrome } = await launchChrome({
	name: 'skins',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
	}
};

// ------------------------------------------------------------------ the author's actions ----

const q = JSON.stringify;
/** The picker's options and value, the skin the runtime has on stage, the skins-list highlight. */
const skinState = () =>
	evaluate(`(() => {
		const s = document.getElementById("skin");
		return {
			options: [...s.options].map((o) => o.value),
			value: s.value,
			stage: skeleton && skeleton.skin ? skeleton.skin.name : null,
			listed: [...document.querySelectorAll("#skinList .trow.sel")].map((r) => r.dataset.skin),
		};
	})()`);
/** The picker offers exactly `options`; it, the stage and the skins list all show `skin`. */
async function shows(what, options, skin) {
	const s = await skinState();
	ok(`${what}: the picker offers [${options}]`, q(s.options) === q(options), q(s.options));
	ok(
		`…and the picker, the stage and the skins list all show "${skin}"`,
		s.value === skin && s.stage === skin && s.listed.join() === skin,
		q(s),
	);
}
/** A pick in the Skin picker — only of a skin it offers, as a user can — firing `change`. */
const pick = (skin) =>
	evaluate(`(() => {
		const s = document.getElementById("skin");
		if (![...s.options].some((o) => o.value === ${q(skin)})) return false;
		s.value = ${q(skin)};
		s.dispatchEvent(new Event("change"));
		return true;
	})()`);
/** A click on a skin's row in the SKINS list — the other way to put a skin on stage. */
const clickSkin = (skin) =>
	evaluate(`(() => {
		const r = document.querySelector('#skinList .trow[data-skin=${q(skin)}]');
		if (r) r.click();
		return !!r;
	})()`);
/** ＋ add image… on the selected slot, the way the slot panel offers it. */
const addImage = (region) =>
	evaluate(`(() => {
		const s = [...document.querySelectorAll("#slotDetail select")]
			.find((x) => x.options[0] && x.options[0].textContent === "＋ add image…");
		if (!s) return false;
		s.value = ${q(region)};
		s.dispatchEvent(new Event("change"));
		return true;
	})()`);
/** Click a skin row's button (✎ rename skin · 🗑 delete skin). */
const skinButton = (skin, title) =>
	evaluate(`(() => {
		const b = document.querySelector('#skinList .trow[data-skin=${q(skin)}] button[title=${q(title)}]');
		if (b) b.click();
		return !!b;
	})()`);
/**
 * A slot's attachments in one skin (with each one's placement), what the runtime draws there and
 * where, the slot's attachment list, and every other skin, serialised.
 */
const slotState = (skin, slot) =>
	evaluate(`(() => {
		const sk = rawDoc.skins.find((s) => s.name === ${q(skin)});
		const bag = ((sk && sk.attachments) || {})[${q(slot)}] || {};
		const si = skeletonData.slots.findIndex((s) => s.name === ${q(slot)});
		const drawn = skeleton.slots[si].attachment;
		const place = (a) => [a.x ?? 0, a.y ?? 0, a.rotation ?? 0, a.scaleX ?? 1, a.scaleY ?? 1];
		return {
			names: Object.keys(bag),
			placed: Object.fromEntries(Object.entries(bag).map(([n, a]) => [n, place(a)])),
			drawn: drawn ? drawn.name : null,
			drawnAt: drawn ? place(drawn) : null,
			regionOf: drawn && drawn.region ? drawn.region.name : null,
			listed: slotAttachmentList(${q(slot)}).map((d) => d.skin + "›" + d.name),
			others: JSON.stringify(rawDoc.skins.filter((s) => s.name !== ${q(skin)})),
			setup: skeletonData.slots[si].attachmentName,
		};
	})()`);
/**
 * What each skin draws on `slot` in the setup pose — the attachment's name, its region and where —
 * on a fresh skeleton of the loaded data, or (`reparsed`) of the rig as a save writes it, read
 * back through the loader the tool opens rigs with.
 */
const drawnBySkin = (slot, reparsed = false) =>
	evaluate(`(() => {
		const keep = missingArt;
		try {
			const sd = ${reparsed}
				? new SPINE.SkeletonJson(makeAttachmentLoader(assetMgr.require(selected.atlas_file))).readSkeletonData(JSON.parse(JSON.stringify(rawDoc)))
				: skeletonData;
			const si = sd.slots.findIndex((s) => s.name === ${q(slot)}), sk = new SPINE.Skeleton(sd);
			return Object.fromEntries(sd.skins.map((skin) => {
				sk.setSkin(skin);
				sk.setSlotsToSetupPose();
				const a = sk.slots[si].attachment;
				return [skin.name, a ? [a.name, a.region ? a.region.name : null, a.x ?? 0, a.y ?? 0, a.rotation ?? 0, a.scaleX ?? 1, a.scaleY ?? 1] : null];
			}));
		} finally { missingArt = keep; }
	})()`);
/**
 * The rig still loads the way a save checks it, and read back it draws on `slot` in every skin
 * exactly what the tool draws.
 */
async function survivesSave(what, slot) {
	const problem = await evaluate('rigDocLoadProblem(rawDoc)');
	ok(`${what}: the rig loads as a save checks it`, problem === null, problem);
	const [live, back] = [await drawnBySkin(slot), await drawnBySkin(slot, true)];
	ok(
		`${what}: read back, every skin draws on ${slot} what the tool draws`,
		q(back) === q(live),
		`${q(back)} vs ${q(live)}`,
	);
}
/** Every skin but `skin` draws on `slot` what it drew in `before`. */
function othersDrawAsBefore(what, skin, slot, before, after) {
	const moved = Object.keys(before).filter((k) => k !== skin && q(after[k]) !== q(before[k]));
	ok(
		`${what} every other skin draws on ${slot} what it drew`,
		!moved.length,
		moved.map((k) => `"${k}": ${q(before[k])} → ${q(after[k])}`).join(', '),
	);
}

const SLOT = 'frame_radial1';
const REGION = 'dust1';

try {
	console.log('\n1. open the rig in Setup');
	{
		await waitFor('typeof skeletons !== "undefined" && skeletons.length > 0');
		await evaluate('selectSkeleton(skeletons[0])');
		await waitFor('!!rawDoc && !!skeletonData');
		await evaluate('setMode("setup")');
		await shows('the rig opens', ['default'], 'default');
		// Every `change` the picker fires from here on; only the one pick below may fire one.
		await evaluate(
			'window.__skinChanges = 0; document.getElementById("skin").addEventListener("change", () => window.__skinChanges++)',
		);
	}

	console.log('\n2. ＋ Add skin, then pick it in the Skin picker');
	{
		const clicked = await evaluate(`(() => {
			const b = [...document.querySelectorAll("#skinList button")].find((x) => x.textContent === "＋ Add skin");
			if (b) b.click();
			return !!b;
		})()`);
		ok('the skins panel has ＋ Add skin', clicked);
		await shows('＋ Add skin', ['default', 'skin1'], 'default');
		ok('"skin1" can be picked in the picker', await pick('skin1'));
		await shows('pick "skin1"', ['default', 'skin1'], 'skin1');
	}

	console.log(`\n3. ＋ add image… on ${SLOT}, in the new skin`);
	{
		// skin1 is empty, so the slot shows default's image — the one a new image takes its place
		// from, and the name it overrides in skin1 only
		const before = await slotState('skin1', SLOT);
		const drew = await drawnBySkin(SLOT);
		await evaluate(`selectSlot(${q(SLOT)})`);
		ok('the slot panel offers ＋ add image…', await addImage(REGION));
		const after = await slotState('skin1', SLOT);
		const name = before.setup;
		ok(
			`the image went into "skin1" as its own "${name}", the name the slot shows`,
			q(after.names) === q([name]),
			q(after.names),
		);
		ok('…the slot still shows that name in every skin', after.setup === name, after.setup);
		ok('…and no other skin changed', after.others === before.others);
		othersDrawAsBefore('…', 'skin1', SLOT, drew, await drawnBySkin(SLOT));
		ok(
			`…placed like the ${before.drawn} the slot showed`,
			q(after.placed[name]) === q(before.drawnAt),
			`${q(after.placed[name])} vs ${q(before.drawnAt)}`,
		);
		ok(
			'…and the minified runtime draws it from its own region',
			after.drawn === name && after.regionOf === REGION,
			`${after.drawn} · ${after.regionOf}`,
		);
		ok(`…and the slot lists it first`, after.listed[0] === `skin1›${name}`, q(after.listed));
		await shows('＋ add image…', ['default', 'skin1'], 'skin1');
		await survivesSave('＋ add image… in "skin1"', SLOT);

		// again in skin1: its own plain image under that name is replaced, placed where it was
		ok('＋ add image… again', await addImage('dust2'));
		const again = await slotState('skin1', SLOT);
		ok(
			`skin1's "${name}" now draws dust2, still its only image there`,
			q(again.names) === q([name]) && again.drawn === name && again.regionOf === 'dust2',
			q(again),
		);
		ok('…placed where it was', q(again.placed[name]) === q(after.placed[name]), q(again.placed));
		othersDrawAsBefore('…', 'skin1', SLOT, drew, await drawnBySkin(SLOT));
		await survivesSave('＋ add image… again in "skin1"', SLOT);

		// a slot with no setup attachment: default holds `payframe` there but draws nothing, and
		// still draws nothing after skin1 gets the same region
		const BARE = 'payframe';
		const bare = await slotState('skin1', BARE);
		const bareDrew = await drawnBySkin(BARE);
		ok(
			`${BARE} starts with no setup attachment`,
			bare.setup === null && bareDrew.default === null,
			q(bare),
		);
		await evaluate(`selectSlot(${q(BARE)})`);
		ok(`＋ add image… ${BARE} on ${BARE}`, await addImage(BARE));
		const bareAfter = await slotState('skin1', BARE);
		ok(
			`skin1 holds it under a name no skin holds there, which the slot now shows`,
			q(bareAfter.names) === q([BARE + '2']) && bareAfter.setup === BARE + '2',
			q(bareAfter),
		);
		ok(
			'…and the runtime draws it in skin1',
			bareAfter.drawn === BARE + '2' && bareAfter.regionOf === BARE,
			`${bareAfter.drawn} · ${bareAfter.regionOf}`,
		);
		othersDrawAsBefore('…', 'skin1', BARE, bareDrew, await drawnBySkin(BARE));
		await survivesSave(`＋ add image… on ${BARE} in "skin1"`, BARE);
		await shows(`＋ add image… on ${BARE}`, ['default', 'skin1'], 'skin1');
	}

	console.log('\n4. rename the skin with ✎, refuse 🗑 on default, then delete the skin with 🗑');
	{
		await evaluate(
			'window.prompt = () => "jade"; window.__confirms = 0; window.confirm = () => (window.__confirms++, true); window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m))',
		);
		ok('"skin1" has ✎', await skinButton('skin1', 'rename skin'));
		await shows('✎ "skin1" → "jade"', ['default', 'jade'], 'jade');
		const jade = await slotState('jade', SLOT);
		ok(
			'…and the image went with it',
			q(jade.names) === q(['radial1']) && jade.drawn === 'radial1' && jade.regionOf === 'dust2',
			q(jade),
		);
		const rig = await evaluate('JSON.stringify(rawDoc)');
		ok('"default" has 🗑 while another skin exists', await skinButton('default', 'delete skin'));
		const said = await evaluate('window.__alerts');
		ok(
			'…which refuses, saying a game that sets no skin draws default, without asking to confirm',
			said.length === 1 &&
				/sets no skin draws the default skin/.test(said[0]) &&
				(await evaluate('window.__confirms')) === 0,
			q(said),
		);
		ok('…and changes nothing', (await evaluate('JSON.stringify(rawDoc)')) === rig);
		await shows('🗑 "default"', ['default', 'jade'], 'jade');
		ok('"jade" has 🗑', await skinButton('jade', 'delete skin'));
		await shows('🗑 "jade"', ['default'], 'default');
	}

	console.log(`\n4b. ＋ add image… on ${SLOT}, in default`);
	{
		const before = await slotState('default', SLOT);
		await evaluate(`selectSlot(${q(SLOT)})`);
		ok('the slot panel offers ＋ add image…', await addImage('dust3'));
		const after = await slotState('default', SLOT);
		ok(
			'default gets a new image under its own name, which the slot now shows',
			q(after.names) === q([...before.names, 'dust3']) && after.setup === 'dust3',
			q(after),
		);
		ok(
			`…placed like the ${before.drawn} the slot showed`,
			q(after.placed.dust3) === q(before.drawnAt),
			`${q(after.placed.dust3)} vs ${q(before.drawnAt)}`,
		);
		ok(
			'…and the runtime draws it',
			after.drawn === 'dust3' && after.regionOf === 'dust3',
			q(after),
		);
		await survivesSave('＋ add image… in default', SLOT);
		await shows('＋ add image… in default', ['default'], 'default');
	}

	console.log('\n5. ⤵ import a rig, then work in its skin');
	{
		await evaluate('importRig("gem")');
		await shows('import "gem"', ['default', 'gem_default'], 'default');
		ok('"gem_default" has a row in the skins list', await clickSkin('gem_default'));
		await shows('click "gem_default"', ['default', 'gem_default'], 'gem_default');
		const slot = 'gem_' + SLOT;
		const before = await slotState('gem_default', slot);
		const drew = await drawnBySkin(slot);
		await evaluate(`selectSlot(${q(slot)})`);
		ok('the imported slot offers ＋ add image…', await addImage(REGION));
		const after = await slotState('gem_default', slot);
		// gem_default holds its own plain image under the name the slot shows: that one is replaced
		ok(
			`the image replaced "gem_default"'s own "${before.setup}"`,
			q(after.names) === q(before.names) &&
				after.setup === before.setup &&
				after.drawn === before.setup &&
				after.regionOf === REGION,
			q(after),
		);
		ok('…and no other skin changed', after.others === before.others);
		othersDrawAsBefore('…', 'gem_default', slot, drew, await drawnBySkin(slot));
		ok(
			`…placed like the ${before.drawn} the slot showed`,
			q(after.placed[before.setup]) === q(before.drawnAt),
			`${q(after.placed[before.setup])} vs ${q(before.drawnAt)}`,
		);
		await survivesSave('＋ add image… in "gem_default"', slot);
		await shows('＋ add image… in "gem_default"', ['default', 'gem_default'], 'gem_default');
	}

	console.log('\n6. nothing the page set fired the picker');
	{
		const n = await evaluate('window.__skinChanges');
		ok('the picker fired `change` for the one pick and nothing else', n === 1, n);
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	}
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await closeChrome();
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
