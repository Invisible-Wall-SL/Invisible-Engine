/**
 * Offline fixture for which STOCK sound banks a game loads (`stockSounds.ts`), against the real
 * banks (`static/assets/audio/sounds.json`) and the real coded-sound table (`stockSoundRules.ts`).
 *
 *   pnpm check:all --only stockSounds
 *
 * Claims, each over the rule, so a planted mutant of the real source can fail them (a guard that
 * can't fail proves nothing):
 *  1. EVERY DOUBT LOADS EVERY BANK: a game repo's old single sprite (loaded as it is), no bundle,
 *     no stock list, a list of another version, a dev flow in place of the bundle's.
 *  2. WHAT CAN PLAY LOADS: a sound the data names; with an empty list, every sound the engine's
 *     code plays and every slot's default; a slot's authored name instead of its default, a
 *     silenced slot nothing, an unusable authored name its default again.
 *  3. MUSIC RETURNS: a game with its own track started from a flow cue but no `baseMusic` slot
 *     keeps `bgm_main` (the remake's return after a big win); one whose slot names its own track
 *     does not load it.
 *  4. A SHADOW: a stock sound the project uploads its own for is not loaded, unless a bank mate
 *     still can play (a ladder rung).
 *  5. THE FILE: the first container the bank lists that this browser plays (an Optimize build lists
 *     mp3 first), its lead added to every region; a loop stays a loop; never one it does not list.
 *  6. THE BANKS: every multi-sound bank is a slot ladder or wholly coded, so grouping never makes a
 *     game load a sound nothing in it can play beyond the bank's own.
 */

import { STOCK_SOUND_REACH_VERSION, type SoundCatalog } from 'engine-layout';
import { SOUND_SLOTS } from 'game-config';

import { CODED_STOCK_SOUNDS } from './stockSoundRules.ts';
import * as realModule from './stockSounds.ts';
import type { StockAudio, StockSoundInput, StockSoundPlan } from './stockSounds.ts';

/** Node's own modules, loaded by name: this file is type-checked with the app, which has no Node
 *  types. */
type NodeFs = {
	readFileSync(path: string, encoding: 'utf8'): string;
	writeFileSync(path: string, text: string): void;
	mkdtempSync(prefix: string): string;
	rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const nodeModule = (name: string): Promise<unknown> => import(name);

async function main(): Promise<void> {
	let failures = 0;
	let checks = 0;
	const check = (label: string, actual: unknown, expected: unknown): void => {
		checks += 1;
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a === e) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
	};

	const HERE = new URL('.', import.meta.url).pathname;
	const fs = (await nodeModule('node:fs')) as NodeFs;
	const { tmpdir } = (await nodeModule('node:os')) as { tmpdir(): string };
	const manifest = JSON.parse(
		fs.readFileSync(`${HERE}../../static/assets/audio/sounds.json`, 'utf8'),
	) as StockAudio;
	const banks = manifest.banks ?? [];
	const MANIFEST_URL = 'https://cdn.example/game/assets/audio/sounds.json';
	const bankOf = (name: string): string => banks.find((b) => name in b.sprite)?.id ?? '?';
	const ALL = banks.map((b) => b.id);

	type Module = { stockSoundBanks: (input: StockSoundInput) => StockSoundPlan };

	const catalog = (over: Partial<SoundCatalog> = {}): SoundCatalog => ({
		prefix: 'sounds',
		sounds: [],
		stock: { version: STOCK_SOUND_REACH_VERSION, names: [] },
		...over,
	});
	const input = (over: Partial<StockSoundInput> = {}): StockSoundInput => ({
		stock: manifest,
		manifestUrl: MANIFEST_URL,
		catalog: catalog(),
		flowOverridden: false,
		canPlay: (ext) => ext !== 'ac3',
		...over,
	});
	/** The bank ids a plan loads, read back off each bank's file name. */
	const loaded = (plan: StockSoundPlan): string[] =>
		plan.banks
			.map((b) =>
				String(b.src)
					.split('/')
					.pop()!
					.replace(/\.[a-z0-9]+$/, ''),
			)
			.sort();
	const has = (plan: StockSoundPlan, name: string) => loaded(plan).includes(bankOf(name));

	const CODED_BANKS = [...new Set(CODED_STOCK_SOUNDS.map(bankOf))].sort();
	const SLOT_DEFAULT_BANKS = [
		...new Set(SOUND_SLOTS.flatMap((s) => s.defaults).map(bankOf)),
	].sort();

	/** The claims over a module; returns the labels that failed. */
	function claims(mod: Module): string[] {
		const failed: string[] = [];
		const expect = (label: string, ok: boolean) => {
			if (!ok) failed.push(label);
		};
		const plan = (over: Partial<StockSoundInput> = {}) => mod.stockSoundBanks(input(over));

		// 1. Every doubt loads every bank.
		const legacy = { src: ['x/sounds.ogg'], sprite: { a: [0, 1] }, config: {} } as unknown as StockAudio; // prettier-ignore
		const legacyPlan = plan({ stock: legacy });
		expect('1. an old single sprite loads as it is', legacyPlan.banks.length === 1 && legacyPlan.banks[0] === legacy); // prettier-ignore
		expect('1. no bundle loads every bank', loaded(plan({ catalog: undefined })).length === ALL.length); // prettier-ignore
		expect('1. no stock list loads every bank', loaded(plan({ catalog: { prefix: 'sounds', sounds: [] } })).length === ALL.length); // prettier-ignore
		expect('1. a list of another version loads every bank', loaded(plan({ catalog: catalog({ stock: { version: STOCK_SOUND_REACH_VERSION + 1, names: [] } }) })).length === ALL.length); // prettier-ignore
		expect('1. a dev flow loads every bank', loaded(plan({ flowOverridden: true })).length === ALL.length); // prettier-ignore
		expect('1. every-bank plans say why', !!plan({ catalog: undefined }).loadedAllBecause);

		// 2. What can play loads.
		const empty = plan();
		expect('2. an empty list keeps every coded bank', CODED_BANKS.every((b) => loaded(empty).includes(b))); // prettier-ignore
		expect('2. an empty list keeps every slot default, no slots authored', SLOT_DEFAULT_BANKS.every((b) => loaded(empty).includes(b))); // prettier-ignore
		expect('2. an empty list loads nothing else', JSON.stringify(loaded(empty)) === JSON.stringify([...new Set([...CODED_BANKS, ...SLOT_DEFAULT_BANKS])].sort())); // prettier-ignore
		expect('2. a data-named sound loads', has(plan({ catalog: catalog({ stock: { version: STOCK_SOUND_REACH_VERSION, names: ['sfx_fs_respins'] } }) }), 'sfx_fs_respins')); // prettier-ignore
		expect('2. an unnamed data-only sound does not', !has(empty, 'sfx_fs_respins'));
		const slots = (s: Record<string, unknown>) => catalog({ bindings: { slots: s as never } });
		expect('2. a slot authored to its own sound drops its default', !has(plan({ catalog: slots({ reelStop: { names: ['own_stop'] } }) }), 'sfx_reel_stop_1')); // prettier-ignore
		expect('2. a silenced slot loads nothing', !has(plan({ catalog: slots({ reelStop: { enabled: false } }) }), 'sfx_reel_stop_1')); // prettier-ignore
		expect('2. an unusable authored name falls back to the default', has(plan({ catalog: slots({ reelStop: { names: [''] } }) }), 'sfx_reel_stop_1')); // prettier-ignore
		expect('2. an unauthored slot keeps its default beside authored ones', has(plan({ catalog: slots({ reelStop: { names: ['own_stop'] } }) }), 'sfx_wild_explode')); // prettier-ignore

		// 3. Music returns.
		const remake = catalog({
			sounds: [{ name: 'wild_west', file: 'snd_a.mp3', durationMs: 1000, loop: true }],
			bindings: { winTiers: { big: { bgm: 'bgm_winlevel_big' } } },
			stock: { version: STOCK_SOUND_REACH_VERSION, names: ['bgm_freespin', 'bgm_winlevel_big'] },
		});
		expect('3. a flow-started track with no baseMusic slot keeps bgm_main', has(plan({ catalog: remake }), 'bgm_main')); // prettier-ignore
		const buffalo = catalog({
			bindings: { slots: { baseMusic: { names: ['background_music'] } } },
		});
		expect('3. a baseMusic slot on its own track drops bgm_main', !has(plan({ catalog: buffalo }), 'bgm_main')); // prettier-ignore
		expect('3. …and keeps bgm_freespin, still the free-spin default', has(plan({ catalog: buffalo }), 'bgm_freespin')); // prettier-ignore

		// 4. A shadow.
		const shadow = (names: string[]) =>
			catalog({ sounds: names.map((name) => ({ name, file: `${name}.mp3`, durationMs: 100 })) });
		expect('4. a stock sound the project replaces is not loaded', !has(plan({ catalog: shadow(['bgm_freespin']) }), 'bgm_freespin')); // prettier-ignore
		expect('4. a replaced ladder rung keeps its bank for the others', has(plan({ catalog: shadow(['sfx_reel_stop_1']) }), 'sfx_reel_stop_2')); // prettier-ignore

		// 5. The file.
		const main = banks.find((b) => b.id === 'bgm_main')!;
		const mainOf = (p: StockSoundPlan) => p.banks.find((b) => String(b.src).includes('/bgm_main.'));
		const ogg = mainOf(plan());
		expect('5. the first playable container (ogg)', !!ogg && String(ogg.src) === new URL(main.files.ogg!.src, MANIFEST_URL).href && JSON.stringify(ogg.format) === '["ogg"]'); // prettier-ignore
		expect('5. its lead added to the region, still a loop', !!ogg && JSON.stringify(ogg.sprite.bgm_main) === JSON.stringify([main.sprite.bgm_main[0] + main.files.ogg!.lead, main.sprite.bgm_main[1], true])); // prettier-ignore
		const mp3 = mainOf(plan({ canPlay: (ext) => ext === 'mp3' }));
		expect('5. no ogg or m4a: the mp3, with the mp3 lead', !!mp3 && String(mp3.src).endsWith('/bgm_main.mp3') && mp3.sprite.bgm_main[0] === main.sprite.bgm_main[0] + main.files.mp3!.lead); // prettier-ignore
		const none = mainOf(plan({ canPlay: () => false }));
		expect('5. nothing playable: still the first file (howler reports it)', !!none && String(none.src).endsWith('/bgm_main.ogg')); // prettier-ignore
		const optimized = { ...manifest, banks: banks.map((b) => ({ ...b, files: { mp3: b.files.mp3, ogg: b.files.ogg } })) }; // prettier-ignore
		const first = mainOf(plan({ stock: optimized }));
		expect('5. a bank listing mp3 first (🗜 Optimize) plays mp3 where ogg plays too', !!first && String(first.src).endsWith('/bgm_main.mp3') && first.sprite.bgm_main[0] === main.sprite.bgm_main[0] + main.files.mp3!.lead); // prettier-ignore
		const mp3Only = { ...manifest, banks: banks.map((b) => ({ ...b, files: { mp3: b.files.mp3 } })) }; // prettier-ignore
		const only = mainOf(plan({ stock: mp3Only, canPlay: (ext) => ext !== 'mp3' }));
		expect('5. never a container the bank does not list', !!only && String(only.src).endsWith('/bgm_main.mp3')); // prettier-ignore
		return failed;
	}

	// ---------------------------------------------------------------------------------------------
	// 1–5 on the real module.
	check('claims: the real rule passes every claim', claims(realModule), []);

	// 6. The banks.
	const coded = new Set(CODED_STOCK_SOUNDS);
	const ladders = new Set(
		SOUND_SLOTS.filter((s) => s.kind === 'ladder').map((s) =>
			JSON.stringify([...s.defaults].sort()),
		),
	);
	for (const bank of banks) {
		const names = Object.keys(bank.sprite);
		if (names.length < 2) continue;
		check(
			`6. bank ${bank.id} is a slot ladder or wholly coded`,
			ladders.has(JSON.stringify([...names].sort())) || names.every((n) => coded.has(n)),
			true,
		);
	}

	// ---------------------------------------------------------------------------------------------
	// …and each claim set fails on a planted mutant of the real source.
	const SOURCE = fs.readFileSync(`${HERE}stockSounds.ts`, 'utf8');
	const ROOT = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');
	const absolute = (source: string) =>
		source
			.replace(`from 'engine-layout'`, `from '${ROOT}/packages/engine-layout/src/lib/index.ts'`)
			.replace(`from 'game-config'`, `from '${ROOT}/packages/game-config/index.ts'`)
			.replace(`from 'pixi-svelte'`, `from '${ROOT}/packages/pixi-svelte/src/lib/types.ts'`)
			.replace(`from './stockSoundRules'`, `from '${HERE}stockSoundRules.ts'`);
	const MUTANTS: Record<string, [string, string]> = {
		'no coded sounds': ['...CODED_STOCK_SOUNDS, ', ''],
		'no slot defaults': ['...slotStockSounds(input.catalog)', ''],
		'no catalog slots ⇒ no defaults': ['if (!slots) return SOUND_SLOTS.flatMap((slot) => [...slot.defaults]);', 'if (!slots) return [];'], // prettier-ignore
		'a silenced slot still loads': ['return enabled ? names : [];', 'return names;'],
		'the version is not checked': ['list.version !== STOCK_SOUND_REACH_VERSION || ', ''],
		'a dev flow is trusted': ["if (input.flowOverridden) return { loadAll: 'a flow other than the bundle’s is running' };", ''], // prettier-ignore
		'one shadowed sound drops its bank': ['.some((name) => decided.reach.has(name) && !shadowed.has(name))', '.some((name) => decided.reach.has(name)) && !Object.keys(bank.sprite).some((name) => shadowed.has(name))'], // prettier-ignore
		'the lead is not applied': ['[start + file.lead, length, true] : [start + file.lead, length]', '[start, length, true] : [start, length]'], // prettier-ignore
		'the browser is not asked': ['listed.find((e) => input.canPlay(e))', 'listed.find(() => true)'],
		'the engine’s order, not the bank’s': ['Object.keys(bank.files).filter', "['ogg', 'm4a', 'mp3', 'ac3'].filter"], // prettier-ignore
		'a single sprite is split anyway': ['if (!Array.isArray(stock.banks))', 'if (false)'],
	};
	const dir = fs.mkdtempSync(`${tmpdir()}/stock-sounds-mutant-`);
	try {
		for (const [name, [from, to]] of Object.entries(MUTANTS)) {
			if (!SOURCE.includes(from)) {
				check(`mutant "${name}" still applies to the source`, false, true);
				continue;
			}
			const file = `${dir}/${name.replace(/\W+/g, '_')}.ts`;
			fs.writeFileSync(file, absolute(SOURCE.replace(from, to)));
			// A mutant that throws is caught as surely as one that answers wrong; one that does not
			// load proves nothing, and fails this fixture.
			let mod: Module;
			try {
				mod = (await import(file)) as Module;
			} catch (error) {
				check(`mutant "${name}" loads`, String(error), 'it loads');
				continue;
			}
			let failed: string[];
			try {
				failed = claims(mod);
			} catch (error) {
				failed = [`it throws: ${error}`];
			}
			check(`mutant "${name}" is caught`, failed.length > 0, true);
			if (failed.length) console.log(`  mutant "${name}" caught by: ${failed[0]}`);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}

	console.log(`${checks - failures}/${checks} stock sound claims hold.`);
	if (failures) throw new Error(`${failures} stock sound claim(s) failed`);
}

void main();
