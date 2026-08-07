import type { Howl } from 'howler';

import type { PlayOptions, GetSound, GetSoundMap } from './types';

export function createPlayOnce<TSoundName extends string>(options: {
	howl: Howl;
	newSound: (value: TSoundName) => GetSound<TSoundName>;
	getSoundMap: () => GetSoundMap<TSoundName>;
	initSoundVolume: (soundName: TSoundName) => void;
}) {
	type Sound = GetSound<TSoundName>;

	// Per-play volume is stored on the sound's `soundVolume` BEFORE `initSoundVolume`, which folds it
	// into `playerVolume * soundVolume * soundConfig.volume` — so it scales WITH the master SFX volume
	// (the user's mixer setting still applies) rather than overriding it. `undefined` ⇒ keep the sound's
	// existing `soundVolume` (1 for a fresh play), so a `soundOnce` without `volume` is byte-identical.
	const playOnce = (sound: Sound, volume?: number) => {
		const soundId = options.howl.play(sound.soundName);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundId,
			soundState: 'playing',
			soundVolume: volume ?? sound.soundVolume,
		};

		options.initSoundVolume(sound.soundName);

		options.howl.on('end', (soundIdOnEnd) => {
			if (soundIdOnEnd === soundId) {
				options.howl.stop(soundId);
				delete options.getSoundMap()[sound.soundName];
			}
		});
	};

	const soundPlayMap = {
		new: (sound: Sound, options: { forcePlay?: boolean; volume?: number }) =>
			playOnce(sound, options.volume),
		paused: (sound: Sound, options: { forcePlay?: boolean; volume?: number }) =>
			playOnce(sound, options.volume),
		playing: (sound: Sound, options: { forcePlay?: boolean; volume?: number }) => {
			if (options.forcePlay) playOnce(sound, options.volume);
		},
	};

	const play = (
		playOptions: PlayOptions<TSoundName> & { forcePlay?: boolean; volume?: number },
	) => {
		const existingSound = options.getSoundMap()[playOptions.name];
		const sound = existingSound ?? options.newSound(playOptions.name);
		soundPlayMap[sound.soundState](sound, {
			forcePlay: playOptions.forcePlay,
			volume: playOptions.volume,
		});
	};

	return {
		play,
	};
}
