import type { Howl } from 'howler';

import type { PlayOptions, GetSound, GetSoundMap } from './types';
import { usablePlayVolume } from './volume';

export function createPlayLoop<TSoundName extends string>(options: {
	howlFor: (soundName: TSoundName) => Howl | undefined;
	newSound: (value: TSoundName) => GetSound<TSoundName>;
	getSoundMap: () => GetSoundMap<TSoundName>;
	initSoundVolume: (soundName: TSoundName) => void;
}) {
	type Sound = GetSound<TSoundName>;

	// `volume` is the per-play level, as `createPlayOnce` takes one; absent ⇒ the sound's existing
	// `soundVolume` (1 for a fresh play), so every existing caller is unchanged.
	const playLoop = (sound: Sound, volume?: number) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		const soundId = howl.play(sound.soundName);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundId,
			soundState: 'playing',
			soundVolume: volume ?? sound.soundVolume,
		};

		options.initSoundVolume(sound.soundName);
	};

	const soundPlayMap = {
		new: (sound: Sound, volume?: number) => playLoop(sound, volume),
		paused: (sound: Sound, volume?: number) => playLoop(sound, volume),
		playing: () => {
			// Do nothing
		},
	};

	const play = (playOptions: PlayOptions<TSoundName> & { volume?: number }) => {
		const existingSound = options.getSoundMap()[playOptions.name];
		const sound = existingSound ?? options.newSound(playOptions.name);
		soundPlayMap[sound.soundState](sound, usablePlayVolume(playOptions.volume));
	};

	return {
		play,
	};
}
