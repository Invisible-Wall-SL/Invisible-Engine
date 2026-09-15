import type { Howl } from 'howler';

import type { PlayOptions, GetSound, GetSoundMap } from './types';
import { usablePlayVolume } from './volume';

export function createPlayMusic<TSoundName extends string>(options: {
	howlFor: (soundName: TSoundName) => Howl | undefined;
	newSound: (value: TSoundName) => GetSound<TSoundName>;
	getSoundMap: () => GetSoundMap<TSoundName>;
	initSoundVolume: (soundName: TSoundName) => void;
}) {
	type Sound = GetSound<TSoundName>;

	const pauseAllMusic = () => {
		(Object.values(options.getSoundMap()) as Sound[]).forEach((existingSound) => {
			options.howlFor(existingSound.soundName)?.pause(existingSound.soundId);
			options.getSoundMap()[existingSound.soundName] = {
				...existingSound,
				soundState: 'paused',
			};
		});
	};

	// The howl is resolved BEFORE `pauseAllMusic`, so a track no bank declares leaves the current
	// music playing instead of stopping it to play nothing. Music is the one player where the old
	// order was audibly wrong: an unknown name silenced the game.
	/**
	 * THE LEVEL FOR THIS FIRING, and the one rule that matters about it: **it is not sticky.**
	 *
	 * It is stored on `soundVolume` before `initSoundVolume`, which folds it into
	 * `playerVolume * soundVolume * soundConfig.volume` — so it scales WITH the player's music
	 * slider rather than fighting it, exactly as `createPlayOnce` does for a one-shot.
	 *
	 * A firing that asks for nothing resets the multiplier to **1**, i.e. the level on the sound's
	 * own library row. It cannot inherit the previous firing's, and that is deliberate: unlike the
	 * one-shot player — whose map entry is deleted by its `end` handler, which is the only reason
	 * "absent ⇒ the row's level" is true there — a music entry LIVES FOREVER so the track can be
	 * paused and resumed. Carrying the last asked-for level forward would mean one
	 * `soundMusic(theme, 0.3)` anywhere in a flow quietly re-mixed every later restore of that
	 * track, including `winLevelSoundsStop`'s, for the rest of the session. A per-firing pin that
	 * outlives its firing is the kind of bug nobody hears until the whole game is mysteriously
	 * quiet.
	 *
	 * The cost, stated so nobody rediscovers it: a music track faded with `soundFade` and then
	 * re-fired comes back at its row level rather than the faded one. Re-asking for a track IS a
	 * request to play it, and the row is the answer to "how loud"; a fade is a transient effect. No
	 * music today is faded (the only `soundFade` in the engine targets the anticipation LOOP).
	 */
	const newMusic = (sound: Sound, level: number) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic();
		const soundId = howl.play(sound.soundName);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundId,
			soundState: 'playing',
			soundVolume: level,
		};
		options.initSoundVolume(sound.soundName);
	};

	// A resume re-applies the level too. Without this, firing the base music back after a big win
	// would keep whatever level it was paused at — and music PAUSES rather than stops, so the resume
	// branch is the one every restore actually takes.
	const resumeMusic = (sound: Sound, level: number) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic();
		howl.play(sound.soundId);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundState: 'playing',
			soundVolume: level,
		};
		options.initSoundVolume(sound.soundName);
	};

	const soundPlayMap = {
		new: (sound: Sound, level: number) => newMusic(sound, level),
		paused: (sound: Sound, level: number) => resumeMusic(sound, level),
		playing: (sound: Sound, level: number) => {
			// Already playing: the track is NOT restarted (that is the whole point of the music
			// player), but a different level still lands — otherwise the only way to re-mix a bed
			// mid-play would be to stop and restart it.
			if (level === sound.soundVolume) return;
			options.getSoundMap()[sound.soundName] = { ...sound, soundVolume: level };
			options.initSoundVolume(sound.soundName);
		},
	};

	const play = (playOptions: PlayOptions<TSoundName> & { volume?: number }) => {
		const existingSound = options.getSoundMap()[playOptions.name];
		const sound = existingSound ?? options.newSound(playOptions.name);
		soundPlayMap[sound.soundState](sound, usablePlayVolume(playOptions.volume) ?? 1);
	};

	return {
		play,
	};
}
