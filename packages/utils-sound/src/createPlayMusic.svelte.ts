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

	/**
	 * Pause every bed but `keep`. With `fade` (ms) a PLAYING bed fades out first and pauses at the
	 * end, unless something resumed it meanwhile; its map entry is `paused` at once either way, so a
	 * replay during the fade takes the resume branch. The fade is the crossfade a timeline's `music:`
	 * cue asks for; no other caller passes one.
	 */
	/** Per bed, the number of its latest fade-out (not reactive state: a timer's guard). */
	const fadeOuts: Partial<Record<TSoundName, number>> = {};
	const pauseAllMusic = (keep?: TSoundName, fade?: number) => {
		(Object.values(options.getSoundMap()) as Sound[]).forEach((existingSound) => {
			if (existingSound.soundName === keep) return;
			const howl = options.howlFor(existingSound.soundName);
			const { soundId } = existingSound;
			if (fade && existingSound.soundState === 'playing' && howl) {
				howl.fade(howl.volume(soundId) as number, 0, fade, soundId);
				// Only the LATEST fade-out of this bed may pause it: a resume and a second fade-out
				// before this one ends must not have the first's timer cut the second short.
				const token = (fadeOuts[existingSound.soundName] ?? 0) + 1;
				fadeOuts[existingSound.soundName] = token;
				setTimeout(() => {
					if (fadeOuts[existingSound.soundName] !== token) return;
					if (options.getSoundMap()[existingSound.soundName]?.soundState !== 'paused') return;
					howl.pause(soundId);
					options.initSoundVolume(existingSound.soundName);
				}, fade);
			} else howl?.pause(soundId);
			options.getSoundMap()[existingSound.soundName] = {
				...existingSound,
				soundState: 'paused',
			};
		});
	};

	/** Fade the bed now starting up from silence to its level over `fade` ms. */
	const fadeIn = (soundName: TSoundName, soundId: number, fade?: number) => {
		const howl = options.howlFor(soundName);
		if (!fade || !howl) return;
		const to = howl.volume(soundId) as number;
		howl.fade(0, to, fade, soundId);
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
	const newMusic = (sound: Sound, level: number, fade?: number) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic(sound.soundName, fade);
		const soundId = howl.play(sound.soundName);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundId,
			soundState: 'playing',
			soundVolume: level,
		};
		options.initSoundVolume(sound.soundName);
		fadeIn(sound.soundName, soundId, fade);
	};

	// A resume re-applies the level too. Without this, firing the base music back after a big win
	// would keep whatever level it was paused at — and music PAUSES rather than stops, so the resume
	// branch is the one every restore actually takes.
	const resumeMusic = (sound: Sound, level: number, fade?: number) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic(sound.soundName, fade);
		howl.play(sound.soundId);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundState: 'playing',
			soundVolume: level,
		};
		options.initSoundVolume(sound.soundName);
		fadeIn(sound.soundName, sound.soundId, fade);
	};

	const soundPlayMap = {
		new: (sound: Sound, level: number, fade?: number) => newMusic(sound, level, fade),
		paused: (sound: Sound, level: number, fade?: number) => resumeMusic(sound, level, fade),
		playing: (sound: Sound, level: number) => {
			// Already playing: the track is NOT restarted (that is the whole point of the music
			// player), but a different level still lands — otherwise the only way to re-mix a bed
			// mid-play would be to stop and restart it.
			if (level === sound.soundVolume) return;
			options.getSoundMap()[sound.soundName] = { ...sound, soundVolume: level };
			options.initSoundVolume(sound.soundName);
		},
	};

	/** `fade` (ms): crossfade from the current bed instead of cutting to this one. */
	const play = (playOptions: PlayOptions<TSoundName> & { volume?: number; fade?: number }) => {
		const existingSound = options.getSoundMap()[playOptions.name];
		const sound = existingSound ?? options.newSound(playOptions.name);
		const fade =
			typeof playOptions.fade === 'number' && playOptions.fade > 0 ? playOptions.fade : undefined;
		soundPlayMap[sound.soundState](sound, usablePlayVolume(playOptions.volume) ?? 1, fade);
	};

	return {
		play,
	};
}
