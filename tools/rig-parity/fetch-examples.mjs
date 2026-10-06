// Downloads Esoteric's public Spine 4.2 example exports (JSON + binary + atlas) into a temp folder,
// for a wider parity run than the repo's own rigs:
//
//   node tools/rig-parity/fetch-examples.mjs        → prints the folder
//   node tools/rig-parity/parity.mjs --dir <folder>
//
// They are fetched at run time, not committed: they are Esoteric's assets, used here only as test data.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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

for (const [folder, name] of Object.entries(RIGS)) {
	if (existsSync(join(dir, `${name}.atlas`))) continue;
	const skel = await get(`${folder}/export/${name}.skel`);
	const json = await get(`${folder}/export/${name}.json`);
	let atlas = null;
	for (const candidate of [folder, `${folder}-pma`, name]) if ((atlas = await get(`${folder}/export/${candidate}.atlas`))) break;
	if (!skel || !json || !atlas) {
		console.error(`skipped ${name} (not all files found)`);
		continue;
	}
	writeFileSync(join(dir, `${name}.skel`), skel);
	writeFileSync(join(dir, `${name}.json`), json);
	writeFileSync(join(dir, `${name}.atlas`), atlas);
}
console.log(dir);
