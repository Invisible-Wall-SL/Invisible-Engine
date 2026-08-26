/**
 * Offline fixture for SOUND BANKS — the resolution of a sound NAME to the audio that carries it, and
 * the routing of every play/stop/pause/volume call to that name's OWN `Howl`. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/utils-sound/banks.fixture.ts
 *
 * It drives the REAL `createPlayer` + `createPlayOnce` / `createPlayMusic` against fake howls, rather
 * than re-implementing the routing — a second copy of the rule is how the two come to disagree. Those
 * modules import only types, so nothing here pulls in howler, pixi-svelte, Svelte or state-shared.
 *
 * SEVEN claims, each of which is a way sound was broken or unauthorable before banks existed:
 *
 *  1. A NAME RESOLVES TO THE LAST BANK DECLARING IT. That is what makes an uploaded sound an
 *     OVERRIDE rather than a collision — the same last-wins rule `mergeBakedFontCatalog` uses.
 *  2. MEMBERSHIP IS BY `sprite`, NEVER BY `config`. `howl.play(name)` needs a region; a `config`
 *     entry carries only a base volume. Owning a name you cannot play routes it to a howl that
 *     declines it SILENTLY — the failure mode this whole feature exists to end.
 *  3. `load()` STILL TAKES A SINGLE `LoadedAudio`. Every existing caller passes one, and a bank list
 *     that broke them would make this change a migration instead of an addition.
 *  4. A PLAY REACHES ONE HOWL, NOT ALL OF THEM. The overridden built-in must not also fire — that
 *     would be two copies of one cue, which is what "unify the library" would sound like done wrong.
 *  5. A `soundId` IS ONLY UNIQUE WITHIN ITS OWN HOWL. Two banks both hand out id 100; stopping,
 *     fading or re-mixing a sound must address ITS howl with ITS id. Crossing them silently
 *     mis-targets, and howler reports nothing.
 *  6. THE BASE VOLUME COMES FROM THE OWNING BANK. An override brings its own mix; reading the
 *     built-in's `config` for a name the project replaced would apply the wrong level.
 *  7. AN UNPLAYABLE NAME LEAVES NO TRACE. It used to be written into the sound map as `playing` with
 *     a null id (howler's return for an unknown sprite), which never receives an `end` event — so the
 *     name was pinned for the session and could not play even once a bank carrying it loaded.
 *
 * NOT covered here: `createSound.load()`'s per-bank `Howl` construction and `destroy()`'s per-bank
 * `unload()`. That module is `$state`/`$effect`-bearing and imports howler directly, so it is not
 * tsx-runnable; those two lines are build- and review-checked only.
 */

import type { Howl } from 'howler';
import type { LoadedAudio } from 'pixi-svelte';

import { buildSoundBankIndex, toSoundBankList } from './src/banks';
import { createPlayer } from './src/createPlayer.svelte';
import { createPlayMusic } from './src/createPlayMusic.svelte';
import { createPlayOnce } from './src/createPlayOnce.svelte';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

type Call = { fn: string; args: unknown[] };

/**
 * A `Howl` stand-in that records every call and hands out ids from its OWN counter, both starting at
 * 100 — so a test that crosses banks produces a visibly wrong target rather than accidentally
 * working.
 */
const createFakeHowl = (sprite: Record<string, unknown>) => {
	const calls: Call[] = [];
	let nextId = 100;
	const record = (fn: string, ...args: unknown[]) => {
		calls.push({ fn, args });
	};
	return {
		calls,
		of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args),
		play: (arg?: string | number) => {
			record('play', arg);
			// Howler's own behaviour for an unknown sprite key: no sound, no error, `null`.
			if (typeof arg === 'string' && !(arg in sprite)) return null;
			return typeof arg === 'number' ? arg : nextId++;
		},
		stop: (id?: number) => record('stop', id),
		pause: (id?: number) => record('pause', id),
		volume: (v?: number, id?: number) => record('volume', v, id),
		fade: (from: number, to: number, duration: number, id?: number) =>
			record('fade', from, to, duration, id),
		rate: (rate: number, id?: number) => record('rate', rate, id),
		on: (event: string) => record('on', event),
		unload: () => record('unload'),
	};
};

type Audio = LoadedAudio<string>;

const BUILTIN: Audio = {
	src: 'builtin.mp3',
	sprite: { sfx_reel_stop_1: [0, 100], sfx_only_builtin: [100, 50], bgm_main: [150, 900, true] },
	config: {
		sfx_reel_stop_1: { volume: 0.4 },
		sfx_only_builtin: { volume: 1 },
		bgm_main: { volume: 1 },
	},
};

const PROJECT: Audio = {
	src: 'project.mp3',
	sprite: { sfx_reel_stop_1: [0, 120], sfx_uploaded: [120, 60], bgm_freespin: [180, 800, true] },
	config: {
		sfx_reel_stop_1: { volume: 0.9 },
		sfx_uploaded: { volume: 0.5 },
		bgm_freespin: { volume: 1 },
	},
};

/**
 * The wiring `createSound.load()` does, minus the real `Howl`. `hidden` lets a test make a name
 * temporarily unresolvable, which is how claim 7 distinguishes "played nothing this time" from
 * "pinned forever".
 */
const createRig = (audios: Audio[]) => {
	const howls = audios.map((audio) => createFakeHowl(audio.sprite));
	const index = buildSoundBankIndex<string>(audios);
	const hidden = new Set<string>();

	const bankFor = (name: string) => {
		if (hidden.has(name)) return undefined;
		const i = index[name];
		return i === undefined ? undefined : { audio: audios[i], howl: howls[i] };
	};

	const options = {
		howlFor: ((name: string) => bankFor(name)?.howl) as unknown as (n: string) => Howl | undefined,
		configFor: (name: string) => bankFor(name)?.audio.config?.[name] ?? { volume: 1 },
	};

	return {
		howls,
		index,
		hidden,
		once: createPlayer({ ...options, createPlay: createPlayOnce<string> }),
		music: createPlayer({ ...options, createPlay: createPlayMusic<string> }),
	};
};

console.log('\n1. a name resolves to the LAST bank declaring it');
{
	const index = buildSoundBankIndex<string>([BUILTIN, PROJECT]);
	check('an overridden name → the project bank', index['sfx_reel_stop_1'], 1);
	check('a built-in-only name → the built-in bank', index['sfx_only_builtin'], 0);
	check('an uploaded name → the project bank', index['sfx_uploaded'], 1);
	check('an unknown name → nothing', index['sfx_nope'], undefined);
	// Reversed, the built-in is the LAST bank — so it wins, and it now sits at index 1. Last, not
	// "built-in": nothing about a bank's contents decides this, only its position in the list.
	check('order matters — reversed, the built-in wins', buildSoundBankIndex<string>([PROJECT, BUILTIN])['sfx_reel_stop_1'], 1); // prettier-ignore
	check('one bank behaves like the old single sprite', buildSoundBankIndex<string>([BUILTIN])['sfx_reel_stop_1'], 0); // prettier-ignore
	check('no banks at all owns nothing', Object.keys(buildSoundBankIndex<string>([])).length, 0);
}

console.log('\n2. membership is by `sprite`, never by `config`');
{
	const ghost = { src: 'g.mp3', sprite: {}, config: { ghost: { volume: 1 } } } as unknown as Audio;
	const index = buildSoundBankIndex<string>([BUILTIN, ghost]);
	check('a config-only name is owned by nobody', index['ghost'] !== undefined, false);
	check('the ghost bank did not steal a real name', index['sfx_reel_stop_1'], 0);

	// The index is null-prototype because uploaded names are author-supplied. On a plain object these
	// would resolve to inherited members and route to a bank that never declared them — the same hole
	// the old `loadedAudio.sprite[name]` membership test had.
	const clean = buildSoundBankIndex<string>([BUILTIN]);
	check('`constructor` is not a sound', clean['constructor'], undefined);
	check('`toString` is not a sound', clean['toString'], undefined);
	check('`__proto__` is not a sound', clean['__proto__'], undefined);
}

console.log('\n3. `load()` still takes a single LoadedAudio');
{
	check('a lone audio becomes a one-bank list', toSoundBankList(BUILTIN).length, 1);
	check('an array passes through', toSoundBankList([BUILTIN, PROJECT]).length, 2);
	check('nothing loaded is no banks', toSoundBankList(undefined).length, 0);
	check('null is no banks', toSoundBankList(null).length, 0);
	check('a src-less bank is dropped', toSoundBankList([BUILTIN, { sprite: {}, config: {} } as unknown as Audio]).length, 1); // prettier-ignore
	check('order is preserved', toSoundBankList([BUILTIN, PROJECT]).map((a) => a.src), ['builtin.mp3', 'project.mp3']); // prettier-ignore
}

console.log('\n4. a play reaches ONE howl, not all of them');
{
	const rig = createRig([BUILTIN, PROJECT]);
	rig.once.play({ name: 'sfx_reel_stop_1' });
	check('the project bank played it', rig.howls[1].of('play'), [['sfx_reel_stop_1']]);
	check('the overridden built-in stayed silent', rig.howls[0].of('play'), []);

	rig.once.play({ name: 'sfx_only_builtin' });
	check('a built-in-only name plays on the built-in', rig.howls[0].of('play'), [['sfx_only_builtin']]); // prettier-ignore
	check('the project bank was not asked for it', rig.howls[1].of('play').length, 1);
}

console.log('\n5. a soundId is only unique within its OWN howl');
{
	const rig = createRig([BUILTIN, PROJECT]);
	rig.once.play({ name: 'sfx_only_builtin' }); // built-in bank → id 100
	rig.once.play({ name: 'sfx_uploaded' }); // project bank → ALSO id 100
	check('both banks handed out the same id', [rig.howls[0].of('volume')[0]?.[1], rig.howls[1].of('volume')[0]?.[1]], [100, 100]); // prettier-ignore

	rig.once.stop({ name: 'sfx_uploaded' });
	check('the stop went to the project bank', rig.howls[1].of('stop'), [[100]]);
	check('the built-in bank was not stopped', rig.howls[0].of('stop'), []);

	rig.once.rate({ name: 'sfx_only_builtin', rate: 2 });
	check('the rate went to the built-in bank', rig.howls[0].of('rate'), [[2, 100]]);
	check('the project bank kept its rate', rig.howls[1].of('rate'), []);

	rig.once.volume(0.5);
	check('the master re-mix reached only the still-playing sound', rig.howls[0].of('volume').at(-1), [0.5, 100]); // prettier-ignore
	check('the stopped sound was not re-mixed', rig.howls[1].of('volume').length, 1);
}

console.log('\n6. the base volume comes from the OWNING bank');
{
	const rig = createRig([BUILTIN, PROJECT]);
	rig.once.play({ name: 'sfx_reel_stop_1' });
	check("the override's 0.9 was applied, not the built-in's 0.4", rig.howls[1].of('volume'), [[0.9, 100]]); // prettier-ignore

	const solo = createRig([BUILTIN]);
	solo.once.play({ name: 'sfx_reel_stop_1' });
	check('with no override the built-in 0.4 still applies', solo.howls[0].of('volume'), [
		[0.4, 100],
	]);

	const bare = createRig([{ src: 'b.mp3', sprite: { hum: [0, 10] }, config: {} } as unknown as Audio]); // prettier-ignore
	bare.once.play({ name: 'hum' });
	check('a name with no config entry falls back to full volume', bare.howls[0].of('volume'), [[1, 100]]); // prettier-ignore
}

console.log('\n7. an unplayable name leaves no trace');
{
	const rig = createRig([BUILTIN, PROJECT]);
	rig.hidden.add('sfx_uploaded');
	rig.once.play({ name: 'sfx_uploaded' });
	rig.once.play({ name: 'sfx_uploaded' });
	check('nothing played while the bank was missing', rig.howls[1].of('play'), []);

	rig.hidden.delete('sfx_uploaded');
	rig.once.play({ name: 'sfx_uploaded' });
	check('it plays once its bank arrives — the map was not pinned', rig.howls[1].of('play'), [['sfx_uploaded']]); // prettier-ignore
}

console.log('\n8. music switches across banks, and an unknown track does not silence the game');
{
	const rig = createRig([BUILTIN, PROJECT]);
	rig.music.play({ name: 'bgm_main' }); // built-in bank
	check('the base track started', rig.howls[0].of('play'), [['bgm_main']]);

	rig.music.play({ name: 'bgm_freespin' }); // project bank
	check('the free-spin track started on the project bank', rig.howls[1].of('play'), [['bgm_freespin']]); // prettier-ignore
	check('the base track was paused on ITS OWN howl, by its own id', rig.howls[0].of('pause'), [[100]]); // prettier-ignore

	rig.music.play({ name: 'bgm_nope' });
	check('an unknown track played nothing', rig.howls[1].of('play').length, 1);
	check('…and did NOT pause the music that was playing', rig.howls[1].of('pause'), []);

	rig.music.play({ name: 'bgm_freespin' });
	check('re-asking for the playing track is a no-op', rig.howls[1].of('play').length, 1);
}

console.log(failures === 0 ? '\nAll bank claims hold.\n' : `\n${failures} FAILED bank claim(s).\n`);
process.exit(failures === 0 ? 0 : 1);
