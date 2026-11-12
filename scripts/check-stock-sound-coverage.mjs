// Every place the runtime sources write a STOCK SOUND name must be accounted for in the stock-sound
// table (`apps/lines/src/game/stockSoundRules.ts` `STOCK_SOUND_CONSUMERS`), and the banks must hold
// every stock sound exactly once, with every file they name on disk.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-stock-sound-coverage.mjs
//
// Why: a game loads a stock bank only when its data names a sound in it, a slot resolves to one, or
// the engine's own code plays one (`CODED_STOCK_SOUNDS`, the table's `always` rows). A coded play
// added later that the table does not know would leave its bank unloaded, and howler declines an
// unknown sprite key in silence. So every string literal in `apps/lines/src` and `packages/*/src`
// that names a stock sound must sit in the table under a rule, and every row must still be found,
// so the table cannot rot into a list of guesses.
//
// Scope: string literals only, comments stripped. A template's `${…}` reads as `*`, so a name built
// from a prefix (`bgm_winlevel_${alias}`) matches every stock sound it could build.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	CODED_STOCK_SOUNDS,
	STOCK_SOUND_CONSUMERS,
	STOCK_SOUND_RULES,
} from '../apps/lines/src/game/stockSoundRules.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = join(ROOT, 'apps/lines/static/assets/audio');

/** The table itself, and tests. */
const EXCLUDED = new Set(['apps/lines/src/game/stockSoundRules.ts']);
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'dist', 'build', 'stories']);
const isTest = (file) => /\.(stories|fixture|test|spec)\.[^/]+$/.test(file);

function walk(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|mts|js|mjs|svelte)$/.test(entry)) out.push(full);
	}
	return out;
}

const problems = [];

// The banks: every stock sound in exactly one, every file a bank names on disk.
const manifest = JSON.parse(readFileSync(join(AUDIO, 'sounds.json'), 'utf8'));
const owner = new Map();
for (const bank of manifest.banks ?? []) {
	for (const name of Object.keys(bank.sprite)) {
		if (owner.has(name))
			problems.push(`'${name}' is in two banks: ${owner.get(name)} and ${bank.id}`);
		owner.set(name, bank.id);
	}
	for (const [ext, file] of Object.entries(bank.files)) {
		if (!existsSync(join(AUDIO, file.src)))
			problems.push(`${bank.id}.${ext}: ${file.src} is missing`);
	}
}
const NAMES = [...owner.keys()];
if (NAMES.length < 50) problems.push(`read only ${NAMES.length} stock sound(s) off the banks`);

const files = walk(join(ROOT, 'apps/lines/src'), []);
for (const pkg of readdirSync(join(ROOT, 'packages')))
	walk(join(ROOT, 'packages', pkg, 'src'), files);

const stripComments = (source) =>
	source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `literal` (a `*` for each run-time part) can be `name`. */
const canBe = (literal, name) =>
	literal.includes('*')
		? new RegExp(`^${literal.split('*').map(escapeRegExp).join('.*')}$`).test(name)
		: literal === name;

/** `file` → the stock sound names its string literals write. */
const found = new Map();
for (const full of files) {
	const file = relative(ROOT, full).split('\\').join('/');
	if (EXCLUDED.has(file) || isTest(file)) continue;
	const source = stripComments(readFileSync(full, 'utf8'));
	for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
		const literal = (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, '*');
		// A bare `*` would match everything; only a literal with a real prefix or suffix is a name.
		if (literal.replace(/\*/g, '').length < 4) continue;
		for (const name of NAMES) {
			if (!canBe(literal, name)) continue;
			if (!found.has(file)) found.set(file, new Set());
			found.get(file).add(name);
		}
	}
}

const listed = new Map();
for (const { file, names, rule } of STOCK_SOUND_CONSUMERS) {
	if (!STOCK_SOUND_RULES.includes(rule)) problems.push(`${file}: unknown rule '${rule}'`);
	if (!listed.has(file)) listed.set(file, new Set());
	for (const name of names) {
		if (!owner.has(name)) problems.push(`${file}: '${name}' (${rule}) is not a stock sound`);
		listed.get(file).add(name);
	}
}
for (const [file, names] of found) {
	for (const name of names) {
		if (!listed.get(file)?.has(name)) {
			problems.push(
				`${file} writes the stock sound '${name}', which the stock-sound table does not list — ` +
					'list it in STOCK_SOUND_CONSUMERS (stockSoundRules.ts); if the engine plays it from ' +
					'code, under `always`, or its bank will not load for a game whose data never names it',
			);
		}
	}
}
for (const [file, names] of listed) {
	for (const name of names) {
		if (!found.get(file)?.has(name))
			problems.push(
				`${file}: '${name}' is listed in STOCK_SOUND_CONSUMERS but no longer written there`,
			);
	}
}
for (const name of CODED_STOCK_SOUNDS) {
	if (!owner.has(name)) problems.push(`CODED_STOCK_SOUNDS has '${name}', which no bank holds`);
}

if (problems.length) {
	console.error(`check-stock-sound-coverage: ${problems.length} problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
const pairs = [...found.values()].reduce((sum, names) => sum + names.size, 0);
console.log(
	`check-stock-sound-coverage: ${pairs} stock sound name(s) in ${found.size} file(s), every one ` +
		`listed; ${manifest.banks.length} banks hold the ${NAMES.length} stock sounds once each.`,
);
