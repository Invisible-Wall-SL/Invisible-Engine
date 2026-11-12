// The engine's stock audio in a STANDALONE build (a game repo that vendors the engine):
//
//   node apps/launcher-api/scripts/check-stock-audio-build.mjs
//
// A game repo's `static/` is a scaffold-time copy of `apps/lines/static`, so the split stock banks
// reach its build only because the pull brings the repo's copy up to the engine's
// (`lib/stockAudioRefresh.mjs`), and the opt-in `--optimize` pass then trims each bank's containers
// (`optimize-build-assets.mjs`). Claims, each over the real module, and each fails on a planted
// mutant of its source (a guard that can't fail proves nothing):
//
//  R1. The old engine sprite is replaced by the banks: its media gone, the engine's manifest and
//      bank files in place.
//  R2. Older banks are replaced whole: a bank the engine no longer ships leaves.
//  R3. A sprite carrying a sound the engine never shipped is the game's own and is left alone.
//  R4. A dry run says what it would do and writes nothing.
//  O1. `--optimize` keeps the requested containers of every bank, listed in the requested order
//      (the runtime plays the first it can, and the launcher drops every non-mp3 file after this),
//      deletes the others' files and drops them from the manifest; a second run does nothing.
//  O2. A bank with none of the requested containers keeps them all.
//  O3. An old single-sprite manifest is still trimmed by its `src`.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'stock-audio-build-'));
let checks = 0;
let failures = 0;
const check = (label, actual, expected) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
};

const put = (path, text) => {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, text);
};
const files = (dir) =>
	existsSync(dir)
		? readdirSync(dir, { recursive: true, withFileTypes: true })
				.filter((e) => e.isFile())
				.map((e) => join(e.parentPath ?? e.path, e.name).slice(dir.length + 1))
				.sort()
		: [];
const bank = (id, names, exts) => ({
	id,
	files: Object.fromEntries(exts.map((ext) => [ext, { src: `stock/${id}.${ext}`, lead: -1 }])),
	sprite: Object.fromEntries(names.map((n) => [n, [250, 1000]])),
	config: Object.fromEntries(names.map((n) => [n, { volume: 1 }])),
});
const ALL = ['ogg', 'm4a', 'mp3', 'ac3'];

/** A fresh engine audio dir: two banks, every container. */
function engine() {
	const dir = mkdtempSync(join(work, 'engine-'));
	const manifest = { version: 2, src: [], sprite: {}, banks: [bank('bgm_main', ['bgm_main'], ALL), bank('buttons', ['sfx_btn_general', 'sfx_btn_spin'], ALL)] }; // prettier-ignore
	put(join(dir, 'sounds.json'), JSON.stringify(manifest));
	for (const b of manifest.banks)
		for (const f of Object.values(b.files)) put(join(dir, f.src), b.id);
	return dir;
}
const legacyRepo = (names) => {
	const dir = mkdtempSync(join(work, 'repo-'));
	put(join(dir, 'sounds.json'), JSON.stringify({ src: ['./assets/audio/sounds.ogg'], sprite: Object.fromEntries(names.map((n) => [n, [0, 1]])) })); // prettier-ignore
	for (const ext of ALL) put(join(dir, `sounds.${ext}`), 'old');
	return dir;
};

async function refreshClaims(refreshStockAudio) {
	const failed = [];
	const expect = (label, ok) => ok || failed.push(label);
	{
		const eng = engine();
		const repo = legacyRepo(['bgm_main', 'sfx_btn_spin']);
		const r = await refreshStockAudio(eng, repo);
		expect('R1. the old engine sprite is refreshed', r.refreshed === true);
		expect('R1. its media are gone and the banks are in place', JSON.stringify(files(repo)) === JSON.stringify(files(eng))); // prettier-ignore
		expect('R1. the manifest is the engine’s', readFileSync(join(repo, 'sounds.json'), 'utf8') === readFileSync(join(eng, 'sounds.json'), 'utf8')); // prettier-ignore
	}
	{
		const eng = engine();
		const repo = mkdtempSync(join(work, 'repo-'));
		put(join(repo, 'sounds.json'), JSON.stringify({ version: 2, src: [], sprite: {}, banks: [bank('retired', ['x'], ['ogg'])] })); // prettier-ignore
		put(join(repo, 'stock/retired.ogg'), 'x');
		await refreshStockAudio(eng, repo);
		expect(
			'R2. a bank the engine no longer ships leaves',
			!existsSync(join(repo, 'stock/retired.ogg')),
		);
		expect(
			'R2. the engine’s banks arrive',
			JSON.stringify(files(repo)) === JSON.stringify(files(eng)),
		);
	}
	{
		const eng = engine();
		const repo = legacyRepo(['bgm_main', 'my_own_theme']);
		const before = files(repo);
		const r = await refreshStockAudio(eng, repo);
		expect('R3. a sprite with a sound of its own is left alone', r.refreshed === false && JSON.stringify(files(repo)) === JSON.stringify(before)); // prettier-ignore
	}
	{
		const eng = engine();
		const repo = legacyRepo(['bgm_main']);
		const before = files(repo);
		const r = await refreshStockAudio(eng, repo, { dryRun: true });
		expect('R4. a dry run reports and writes nothing', r.refreshed === true && JSON.stringify(r.removed) === JSON.stringify(['sounds.ogg', 'sounds.m4a', 'sounds.mp3', 'sounds.ac3']) && JSON.stringify(files(repo)) === JSON.stringify(before)); // prettier-ignore
	}
	return failed;
}

async function optimizeClaims(optimizeBuildAssets) {
	const failed = [];
	const expect = (label, ok) => ok || failed.push(label);
	const dir = mkdtempSync(join(work, 'assets-'));
	const manifest = { version: 2, src: [], sprite: {}, banks: [bank('a', ['a'], ALL), bank('b', ['b'], ['m4a', 'ac3'])] }; // prettier-ignore
	put(join(dir, 'audio/sounds.json'), JSON.stringify(manifest));
	for (const b of manifest.banks)
		for (const f of Object.values(b.files)) put(join(dir, 'audio', f.src), b.id);
	put(join(dir, 'old/sounds.json'), JSON.stringify({ src: ['./assets/old/sounds.ogg', './assets/old/sounds.m4a'], sprite: {} })); // prettier-ignore
	put(join(dir, 'old/sounds.ogg'), 'o');
	put(join(dir, 'old/sounds.m4a'), 'o');
	await optimizeBuildAssets({ dir, audioFormats: ['mp3', 'ogg'] });
	const after = JSON.parse(readFileSync(join(dir, 'audio/sounds.json'), 'utf8'));
	expect('O1. the requested containers stay, in the requested order', JSON.stringify(Object.keys(after.banks[0].files)) === '["mp3","ogg"]' && existsSync(join(dir, 'audio/stock/a.ogg')) && existsSync(join(dir, 'audio/stock/a.mp3'))); // prettier-ignore
	expect('O1. the others are deleted', !existsSync(join(dir, 'audio/stock/a.m4a')) && !existsSync(join(dir, 'audio/stock/a.ac3'))); // prettier-ignore
	expect('O2. a bank with none of them keeps all', JSON.stringify(Object.keys(after.banks[1].files).sort()) === '["ac3","m4a"]' && existsSync(join(dir, 'audio/stock/b.m4a'))); // prettier-ignore
	expect('O3. an old sprite is trimmed by its src', !existsSync(join(dir, 'old/sounds.m4a')) && existsSync(join(dir, 'old/sounds.ogg'))); // prettier-ignore
	const again = await optimizeBuildAssets({ dir, audioFormats: ['mp3', 'ogg'] });
	expect('O1. a second run does nothing', again.audioDeleted.length === 0 && again.manifestsRewritten.length === 0); // prettier-ignore
	return failed;
}

/** `file`'s source with `from` replaced by `to`, imported from a temp copy (builtins only). */
async function mutant(file, from, to) {
	const source = readFileSync(join(HERE, file), 'utf8');
	if (!source.includes(from)) throw new Error(`the mutant no longer applies to ${file}: ${from}`);
	const copy = join(mkdtempSync(join(work, 'mutant-')), file.split('/').pop());
	writeFileSync(copy, source.replace(from, to));
	return import(pathToFileURL(copy).href);
}
const caught = async (claims, mod) => {
	try {
		return (await claims(mod)).length > 0;
	} catch {
		return true;
	}
};

try {
	const refresh = await import('./lib/stockAudioRefresh.mjs');
	const optimize = await import('./optimize-build-assets.mjs');
	check('refresh: the real module passes every claim', await refreshClaims(refresh.refreshStockAudio), []); // prettier-ignore
	check('optimize: the real module passes every claim', await optimizeClaims(optimize.optimizeBuildAssets), []); // prettier-ignore
	const REFRESH_MUTANTS = {
		'refreshes a sprite of the game’s own': ['if (own.length)', 'if (false)'],
		'leaves the old media': [
			'for (const name of removed) await rm',
			'for (const name of []) await rm',
		],
		'keeps stale banks': [
			"await rm(join(repoDir, 'stock'), { recursive: true, force: true });",
			'',
		],
		'writes on a dry run': ['if (!dryRun) {', 'if (true) {'],
	};
	for (const [name, [from, to]] of Object.entries(REFRESH_MUTANTS)) {
		const mod = await mutant('lib/stockAudioRefresh.mjs', from, to);
		check(`refresh mutant "${name}" is caught`, await caught(refreshClaims, mod.refreshStockAudio), true); // prettier-ignore
	}
	const OPTIMIZE_MUTANTS = {
		'banks ignored': ['if (Array.isArray(doc.banks)) {', 'if (false) {'],
		'the manifest keeps the dropped files': ['bank.files = Object.fromEntries(kept.map((f) => [f, files[f]]));', ''], // prettier-ignore
		'the bank keeps its own order': ['kept.map((f) => [f, files[f]])', 'present.filter((f) => kept.includes(f)).map((f) => [f, files[f]])'], // prettier-ignore
		'a bank with none of them is trimmed anyway': ['if (!kept.length) {', 'if (false) {'],
	};
	for (const [name, [from, to]] of Object.entries(OPTIMIZE_MUTANTS)) {
		const mod = await mutant('optimize-build-assets.mjs', from, to);
		check(`optimize mutant "${name}" is caught`, await caught(optimizeClaims, mod.optimizeBuildAssets), true); // prettier-ignore
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}
console.log(`${checks - failures}/${checks} stock audio build claims hold.`);
if (failures) process.exit(1);
