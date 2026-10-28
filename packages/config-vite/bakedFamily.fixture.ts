/**
 * The baked-config family default (`families.js`, `docs/design/phase-11.md` §2.4): that its copy of
 * the family rule and of the app `src/` rule match `game-config` and `config-svelte`, which it may
 * not import, and what each kind of bundle compiles.
 *
 *     pnpm check:all --only bakedFamily
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error plain JS, no declarations
import { appSrcDir } from '../config-svelte/appSrc.js';
import { normalizeFamily, resolveFamily } from '../game-config/src/family';
// @ts-expect-error plain JS, no declarations
import { bakedBundlePath, buildFamilies, familyOfConfig } from './families.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};
const same = (name: string, got: unknown, want: unknown) =>
	check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const ALL = ['slot', 'match3', 'arcade', 'card'];
const HERE = dirname(fileURLToPath(import.meta.url));
const LINES = resolve(HERE, '../../apps/lines');

for (const raw of [undefined, null, 'slot', 'match3', 'arcade', 'card', 'Match3', 'cards', 7, {}]) {
	const config = { family: raw };
	same(
		`family ${JSON.stringify(raw)}: the copy matches resolveFamily(normalizeFamily())`,
		familyOfConfig(config),
		resolveFamily({ family: normalizeFamily(raw) }),
	);
}
same('no config ⇒ slot, as resolveFamily', familyOfConfig(null), resolveFamily(null));

const cwd = process.cwd();
try {
	for (const dir of [LINES, resolve(LINES, '../..'), tmpdir()]) {
		process.chdir(dir);
		same(`bundle path from ${dir} matches appSrcDir()`, dirname(bakedBundlePath()), appSrcDir());
	}
} finally {
	process.chdir(cwd);
}

const dir = mkdtempSync(join(tmpdir(), 'ie-baked-family-'));
const bundle = (name: string, body: unknown) => {
	const path = join(dir, `${name}.json`);
	writeFileSync(path, JSON.stringify(body));
	return path;
};
try {
	const placeholder = bundle('placeholder', {
		doc: null,
		componentDefaults: {},
		componentDefs: {},
	});
	const at = (bundlePath: string, value?: string, dev = false) =>
		buildFamilies({ value, bundlePath, dev });

	const fallback = at(placeholder);
	same('the placeholder (no config key) ⇒ every family', fallback.list, ALL);
	check('… with a warning', typeof fallback.warning === 'string' && fallback.warning.length > 0);
	same('no bundle ⇒ every family', at(join(dir, 'missing.json')).list, ALL);
	same('a slot config ⇒ slot only', at(bundle('slot', { config: { reels: 5 } })).list, ['slot']);
	same('config: null ⇒ slot only', at(bundle('null', { config: null })).list, ['slot']);
	for (const family of ['match3', 'arcade', 'card']) {
		const path = bundle(family, { config: { family } });
		same(`family '${family}' ⇒ slot + ${family}`, at(path).list, ['slot', family]);
		check('… with no warning', at(path).warning === null);
	}
	const card = bundle('card2', { config: { family: 'card' } });
	same('PUBLIC_IE_FAMILIES wins over the bundle', at(card, 'arcade').list, ['slot', 'arcade']);
	same('an empty PUBLIC_IE_FAMILIES still reads the bundle', at(card, ' ').list, ['slot', 'card']);
	same('a dev server never infers', at(card, undefined, true).list, ALL);

	process.chdir(LINES);
	try {
		same(
			"apps/lines' checked-in bundle (the release build) ⇒ every family",
			buildFamilies({ value: '' }).list,
			ALL,
		);
	} finally {
		process.chdir(cwd);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} baked-family check(s) failed`);
	process.exit(1);
}
console.log('\nbaked family default ok');
