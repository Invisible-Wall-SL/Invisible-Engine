// Downloads Esoteric's public Spine 4.2 example exports (JSON + binary + atlas) into a temp folder,
// for a wider parity run than the repo's own rigs:
//
//   node tools/rig-parity/fetch-examples.mjs        → prints the folder
//   node tools/rig-parity/parity.mjs --dir <folder>
//
// They are fetched at run time, not committed: they are Esoteric's assets, used here only as test data.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples';
const RIGS = {
	alien: 'alien-pro',
	'celestial-circus': 'celestial-circus-pro',
	'chibi-stickers': 'chibi-stickers',
	'cloud-pot': 'cloud-pot',
	coin: 'coin-pro',
	dragon: 'dragon-ess',
	goblins: 'goblins-pro',
	hero: 'hero-pro',
	'mix-and-match': 'mix-and-match-pro',
	owl: 'owl-pro',
	powerup: 'powerup-pro',
	raptor: 'raptor-pro',
	sack: 'sack-pro',
	snowglobe: 'snowglobe-pro',
	speedy: 'speedy-ess',
	spineboy: 'spineboy-pro',
	stretchyman: 'stretchyman-pro',
	tank: 'tank-pro',
	vine: 'vine-pro',
	windmill: 'windmill-ess',
};

const dir = join(tmpdir(), 'spine-examples-4.2');
mkdirSync(dir, { recursive: true });

async function get(path) {
	const res = await fetch(`${BASE}/${path}`);
	return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

/** Page image names: the first line of the atlas and each line after a blank one. */
function pageNames(atlas) {
	const lines = atlas.toString('utf8').split(/\r?\n/);
	const pages = [];
	let expectPage = true;
	for (const line of lines) {
		if (!line.trim()) {
			expectPage = true;
			continue;
		}
		if (expectPage && !line.includes(':')) pages.push(line.trim());
		expectPage = false;
	}
	return pages;
}

for (const [folder, name] of Object.entries(RIGS)) {
	if (existsSync(join(dir, `${name}.atlas`))) {
		const atlas = readFileSync(join(dir, `${name}.atlas`));
		for (const page of pageNames(atlas)) {
			if (existsSync(join(dir, page))) continue;
			const png = await get(`${folder}/export/${page}`);
			if (png) writeFileSync(join(dir, page), png);
		}
		continue;
	}
	const skel = await get(`${folder}/export/${name}.skel`);
	const json = await get(`${folder}/export/${name}.json`);
	let atlas = null;
	for (const candidate of [folder, `${folder}-pma`, name])
		if ((atlas = await get(`${folder}/export/${candidate}.atlas`))) break;
	if (!skel || !json || !atlas) {
		console.error(`skipped ${name} (not all files found)`);
		continue;
	}
	writeFileSync(join(dir, `${name}.skel`), skel);
	writeFileSync(join(dir, `${name}.json`), json);
	writeFileSync(join(dir, `${name}.atlas`), atlas);
	for (const page of pageNames(atlas)) {
		const png = await get(`${folder}/export/${page}`);
		if (png) writeFileSync(join(dir, page), png);
		else console.error(`missing page ${page} for ${name}`);
	}
}
console.log(dir);
