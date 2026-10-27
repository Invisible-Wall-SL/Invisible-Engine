/**
 * Offline fixture for SOUND BANKS — the resolution of a sound NAME to the audio that carries it, and
 * the routing of every play/stop/pause/volume call to that name's OWN `Howl`. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/utils-sound/banks.fixture.ts
 *
 * It drives the REAL `createPlayer` + `createPlayOnce` / `createPlayMusic` against fake howls, rather
 * than re-implementing the routing — a second copy of the rule is how the two come to disagree. Those
 * modules import only types, so nothing here pulls in howler, pixi-svelte, Svelte or state-shared.
 *
 * NINE sections, each a way sound was broken or unauthorable before banks existed — the last of
 * them the per-firing volume a flow cue can now carry (claim 9, added 2026-09-15):
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
 *  8. MUSIC SWITCHES ACROSS BANKS, and a track no bank declares does not silence the game.
 *  9. A PER-FIRING VOLUME DOES NOT OUTLIVE ITS FIRING. The music map entry lives forever so a track
 *     can be paused and resumed, so a level carried forward would mean one quiet cue re-mixing every
 *     later restore of that track — inaudibly, for the rest of the session.
 *
 * 10. A TIMELINE CUE'S OPTIONS REACH HOWLER (added 2026-10-27). `playCueSound` (engine-layout) over
 *     these real players: pan, loop, a start offset into the sound's OWN region (howler seeks the
 *     bank's file), a rate, a per-play level on the loop player, a music crossfade, and a plain cue
 *     making exactly the one call it always made.
 *
 * NOT covered here: `createSound.load()`'s per-bank `Howl` construction and `destroy()`'s per-bank
 * `unload()`. That module is `$state`/`$effect`-bearing and imports howler directly, so it is not
 * tsx-runnable; those two lines are build- and review-checked only.
 */

import type { Howl } from 'howler';
import { playCueSound } from '../engine-layout/src/lib/cueSound';
import type { LoadedAudio } from 'pixi-svelte';

import { buildSoundBankIndex, toSoundBankList } from './src/banks';
import { createPlayer } from './src/createPlayer.svelte';
import { createPlayLoop } from './src/createPlayLoop.svelte';
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
	const levels = new Map<number, number>();
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
		// One argument is howler's GETTER for that id's volume (unrecorded); two set it.
		volume: (v?: number, id?: number) => {
			if (id === undefined) return levels.get(v as number) ?? 1;
			levels.set(id, v as number);
			record('volume', v, id);
		},
		stereo: (pan: number, id?: number) => record('stereo', pan, id),
		loop: (loop: boolean, id?: number) => record('loop', loop, id),
		seek: (seconds: number, id?: number) => record('seek', seconds, id),
		// Howler starts a fade AT `from`; the stand-in never advances it.
		fade: (from: number, to: number, duration: number, id?: number) => {
			if (id !== undefined) levels.set(id, from);
			record('fade', from, to, duration, id);
		},
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
	sprite: {
		sfx_reel_stop_1: [0, 120],
		sfx_uploaded: [120, 60],
		bgm_freespin: [180, 800, true],
		// A bed mixed DOWN on its library row, so claim 9 can tell a per-play level that REPLACES
		// the entry's own from one that multiplies with it.
		bgm_quiet: [980, 700, true],
	},
	config: {
		sfx_reel_stop_1: { volume: 0.9 },
		sfx_uploaded: { volume: 0.5 },
		bgm_freespin: { volume: 1 },
		bgm_quiet: { volume: 0.5 },
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
		regionFor: (name: string) => {
			const region = bankFor(name)?.audio.sprite[name];
			return region ? ([region[0], region[1]] as const) : undefined;
		},
	};

	return {
		howls,
		index,
		hidden,
		once: createPlayer({ ...options, createPlay: createPlayOnce<string> }),
		music: createPlayer({ ...options, createPlay: createPlayMusic<string> }),
		loop: createPlayer({ ...options, createPlay: createPlayLoop<string> }),
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

console.log('\n9. a music bed takes a PER-FIRING volume that does not outlive the firing');
{
	const rig = createRig([BUILTIN, PROJECT]);

	// No volume asked for ⇒ the entry's own level, unchanged. This is every existing `soundMusic`.
	rig.music.play({ name: 'bgm_quiet' });
	check('unasked, the level is the entry’s own', rig.howls[1].of('volume'), [[0.5, 100]]);

	// Asked for ⇒ MULTIPLIED by the entry's level, not substituted for it: 0.4 × 0.5. A per-play
	// volume that replaced the row's would make a track mixed down on its row come back to full
	// the moment a flow node set a level.
	const rig2 = createRig([BUILTIN, PROJECT]);
	rig2.music.play({ name: 'bgm_quiet', volume: 0.4 });
	check('asked for, it multiplies with the entry’s', rig2.howls[1].of('volume'), [[0.2, 100]]);

	// The case that matters after a big win: the bed was PAUSED (not stopped), so re-firing it takes
	// the `paused` branch — which used to skip the volume entirely.
	const rig3 = createRig([BUILTIN, PROJECT]);
	rig3.music.play({ name: 'bgm_quiet' });
	rig3.music.play({ name: 'bgm_main' }); // pauses the bed
	rig3.music.play({ name: 'bgm_quiet', volume: 0.2 }); // …and back, quieter
	check('a resume replays the track by its id', rig3.howls[1].of('play'), [['bgm_quiet'], [100]]);
	check('…and the new level lands on the resume', rig3.howls[1].of('volume'), [
		[0.5, 100],
		[0.1, 100],
	]);

	// Already playing: the level changes without restarting the track.
	const rig4 = createRig([BUILTIN, PROJECT]);
	rig4.music.play({ name: 'bgm_quiet' });
	rig4.music.play({ name: 'bgm_quiet', volume: 0.6 });
	check('a level change does not restart the bed', rig4.howls[1].of('play').length, 1);
	check('…but it does re-mix it', rig4.howls[1].of('volume'), [
		[0.5, 100],
		[0.3, 100],
	]);

	// And the no-op stays a no-op — re-asking with nothing new must not re-mix.
	const rig5 = createRig([BUILTIN, PROJECT]);
	rig5.music.play({ name: 'bgm_quiet' });
	rig5.music.play({ name: 'bgm_quiet' });
	check('re-asking with no volume changes nothing', rig5.howls[1].of('volume'), [[0.5, 100]]);

	// A resume with no volume RE-APPLIES the row's level rather than trusting the howl to have kept
	// whatever it had. Same number here, so it is inaudible — but it is what makes the next claim
	// true, and a "redundant call" cleanup has to read this first.
	const rig6 = createRig([BUILTIN, PROJECT]);
	rig6.music.play({ name: 'bgm_quiet' });
	rig6.music.play({ name: 'bgm_main' });
	rig6.music.play({ name: 'bgm_quiet' });
	check('a plain resume re-applies the row’s level', rig6.howls[1].of('volume'), [
		[0.5, 100],
		[0.5, 100],
	]);

	// THE ONE THAT MATTERS: a per-firing level does NOT stick. The music map entry lives forever
	// (that is how a track can be paused and resumed), so carrying the last asked-for level forward
	// would mean one quiet cue anywhere in a flow re-mixed every later restore of that track — every
	// `winLevelSoundsStop`, for the rest of the session, inaudibly.
	const rig7 = createRig([BUILTIN, PROJECT]);
	rig7.music.play({ name: 'bgm_quiet', volume: 0.2 }); // 0.2 × 0.5 = 0.1
	rig7.music.play({ name: 'bgm_main' }); // the big win takes over
	rig7.music.play({ name: 'bgm_quiet' }); // …and the restore asks for nothing
	check('a per-firing level does not outlive its firing', rig7.howls[1].of('volume'), [
		[0.1, 100],
		[0.5, 100],
	]);

	// And the same for a track that never stopped playing: asking again with no level restores the
	// row's, rather than leaving the last cue's in place.
	const rig8 = createRig([BUILTIN, PROJECT]);
	rig8.music.play({ name: 'bgm_quiet', volume: 0.2 });
	rig8.music.play({ name: 'bgm_quiet' });
	check('…nor while it is still playing', rig8.howls[1].of('volume'), [
		[0.1, 100],
		[0.5, 100],
	]);

	// Out of range is DISCARDED, not clamped — the rule every authored volume path already applies,
	// and the flow's number input has no range on it. Howler IGNORES a volume outside 0..1, so
	// passing it through would be a silent no-op that also poisons the map for every later mix.
	const rig9 = createRig([BUILTIN, PROJECT]);
	rig9.music.play({ name: 'bgm_quiet', volume: 2 });
	check('an out-of-range level falls back to the row’s', rig9.howls[1].of('volume'), [[0.5, 100]]);
	const rig10 = createRig([BUILTIN, PROJECT]);
	rig10.once.play({ name: 'sfx_uploaded', volume: -1 });
	check('…on the one-shot player too', rig10.howls[1].of('volume'), [[0.5, 100]]);
}

console.log('\n10. a timeline cue’s options reach howler');
{
	const rig = createRig([BUILTIN, PROJECT]);
	const target = {
		hasSound: (name: string) => rig.index[name] !== undefined,
		players: { once: rig.once, loop: rig.loop, music: rig.music },
	};
	playCueSound(target, 'sfx:sfx_uploaded');
	check('a plain cue is one play at the row’s level', rig.howls[1].calls.map((c) => c.fn), ['play', 'volume', 'on']); // prettier-ignore

	const rig2 = createRig([BUILTIN, PROJECT]);
	const target2 = { ...target, hasSound: target.hasSound, players: { once: rig2.once, loop: rig2.loop, music: rig2.music } }; // prettier-ignore
	playCueSound(target2, 'sfx:sfx_uploaded', { volume: 0.5, rate: 1.5, pan: -1, offset: 30, loop: true }); // prettier-ignore
	const howl = rig2.howls[1];
	check('…with options: the LOOP player, at the asked level × the row', howl.of('volume'), [[0.25, 100]]); // prettier-ignore
	check('…looped whatever the region says', howl.of('loop'), [[true, 100]]);
	check('…30 ms into ITS region (it starts 120 ms into the file)', howl.of('seek'), [[0.15, 100]]);
	check('…at the asked rate', howl.of('rate'), [[1.5, 100]]);
	check('…panned', howl.of('stereo'), [[-1, 100]]);
	check('…and the player knows its level', rig2.loop.level('sfx_uploaded'), 0.5);

	playCueSound(target2, 'sfx:sfx_uploaded', { volume: 0.5, loop: true });
	check('a second loop cue does not start a second copy', howl.of('play').length, 1);
	playCueSound(target2, 'stop:sfx:sfx_uploaded');
	check('a stop cue ends it', howl.of('stop'), [[100]]);
	check('…and it is no longer playing', rig2.loop.level('sfx_uploaded'), undefined);

	const rig3 = createRig([BUILTIN, PROJECT]);
	const target3 = { ...target, players: { once: rig3.once, loop: rig3.loop, music: rig3.music } };
	playCueSound(target3, 'music:bgm_freespin');
	playCueSound(target3, 'music:bgm_quiet', { fadeIn: 500 });
	check('a crossfade fades the old bed out…', rig3.howls[1].of('fade')[0], [1, 0, 500, 100]);
	check('…and the new one in from silence to its level', rig3.howls[1].of('fade')[1], [0, 0.5, 500, 101]); // prettier-ignore
	check('…pausing the old bed only once the fade is over', rig3.howls[1].of('pause'), []);
	playCueSound(target3, 'music:bgm_freespin');
	check('a plain music cue still cuts', rig3.howls[1].of('pause'), [[101]]);

	// The crossfade's END: the faded bed pauses once its fade is over, back at its level.
	const rig4 = createRig([BUILTIN, PROJECT]);
	const target4 = { ...target, players: { once: rig4.once, loop: rig4.loop, music: rig4.music } };
	playCueSound(target4, 'music:bgm_freespin');
	playCueSound(target4, 'music:bgm_quiet', { fadeIn: 20 });
	await new Promise((done) => setTimeout(done, 40));
	check('after the crossfade the old bed is paused', rig4.howls[1].of('pause'), [[100]]);
	check('…and back at its level for its next resume', rig4.howls[1].of('volume').at(-1), [1, 100]);

	// Resumed during its fade-out, then faded out again: only the second fade's timer pauses it.
	const rig5 = createRig([BUILTIN, PROJECT]);
	const target5 = { ...target, players: { once: rig5.once, loop: rig5.loop, music: rig5.music } };
	playCueSound(target5, 'music:bgm_freespin');
	playCueSound(target5, 'music:bgm_quiet', { fadeIn: 30 });
	await new Promise((done) => setTimeout(done, 15));
	playCueSound(target5, 'music:bgm_freespin');
	playCueSound(target5, 'music:bgm_quiet', { fadeIn: 30 });
	await new Promise((done) => setTimeout(done, 20));
	check('a resumed bed’s stale fade timer pauses nothing', rig5.howls[1].of('pause'), [[101]]);
	await new Promise((done) => setTimeout(done, 20));
	check('…its latest fade’s timer does', rig5.howls[1].of('pause'), [[101], [100]]);

	// A stop cue with a fade-out ends the sound when the fade is over…
	const rig6 = createRig([BUILTIN, PROJECT]);
	const target6 = { ...target, players: { once: rig6.once, loop: rig6.loop, music: rig6.music } };
	playCueSound(target6, 'sfx:sfx_uploaded', { loop: true, volume: 0.8 });
	playCueSound(target6, 'stop:sfx:sfx_uploaded', { fadeOut: 20 });
	check('a stop fades the loop out from its level', rig6.howls[1].of('fade'), [[0.4, 0, 20, 100]]);
	await new Promise((done) => setTimeout(done, 40));
	check('…and stops it once the fade is over', rig6.howls[1].of('stop'), [[100]]);

	// …unless a play cue lands during the fade: that play starts clean and stays.
	const rig7 = createRig([BUILTIN, PROJECT]);
	const target7 = { ...target, players: { once: rig7.once, loop: rig7.loop, music: rig7.music } };
	playCueSound(target7, 'sfx:sfx_uploaded', { loop: true });
	playCueSound(target7, 'stop:sfx:sfx_uploaded', { fadeOut: 20 });
	playCueSound(target7, 'sfx:sfx_uploaded', { loop: true });
	await new Promise((done) => setTimeout(done, 40));
	check('a loop replayed during its fade-out restarts', rig7.howls[1].of('play').length, 2);
	check('…and the fade-out’s stop never ends the new copy', rig7.howls[1].of('stop'), [[100]]);
	check('…which plays at its own level', rig7.loop.level('sfx_uploaded'), 1);

	// A stop during a fade-in fades from where the fade has the sound NOW, not up from its target.
	const rig9 = createRig([BUILTIN, PROJECT]);
	const target9 = { ...target, players: { once: rig9.once, loop: rig9.loop, music: rig9.music } };
	playCueSound(target9, 'sfx:sfx_uploaded', { loop: true, volume: 0.8, fadeIn: 3000 });
	playCueSound(target9, 'stop:sfx:sfx_uploaded', { fadeOut: 20 });
	check('a stop mid-fade-in fades out from the live level', rig9.howls[1].of('fade').at(-1), [0, 0, 20, 100]); // prettier-ignore

	// A bed a crossfade paused is held; a stop cue drops it, so its next cue starts it over.
	const rig10 = createRig([BUILTIN, PROJECT]);
	const target10 = {
		...target,
		players: { once: rig10.once, loop: rig10.loop, music: rig10.music },
	};
	playCueSound(target10, 'music:bgm_freespin');
	playCueSound(target10, 'music:bgm_quiet');
	playCueSound(target10, 'stop:music:bgm_freespin');
	playCueSound(target10, 'music:bgm_freespin');
	check('a stopped paused bed starts over (a fresh play, not a resume)', rig10.howls[1].of('play').at(-1), ['bgm_freespin']); // prettier-ignore

	// An offset past the region's end is not a seek into the next region.
	const rig8 = createRig([BUILTIN, PROJECT]);
	const target8 = { ...target, players: { once: rig8.once, loop: rig8.loop, music: rig8.music } };
	playCueSound(target8, 'sfx:sfx_uploaded', { offset: 60 });
	check('an offset at the region’s end (60 ms long) seeks nowhere', rig8.howls[1].of('seek'), []);
}

console.log(failures === 0 ? '\nAll bank claims hold.\n' : `\n${failures} FAILED bank claim(s).\n`);
process.exit(failures === 0 ? 0 : 1);
