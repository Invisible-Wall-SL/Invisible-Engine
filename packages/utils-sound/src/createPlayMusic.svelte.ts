import type { Howl } from 'howler';

import type { PlayOptions, GetSound, GetSoundMap } from './types';

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
	const newMusic = (sound: Sound) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic();
		const soundId = howl.play(sound.soundName);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundId,
			soundState: 'playing',
		};
		options.initSoundVolume(sound.soundName);
	};

	const resumeMusic = (sound: Sound) => {
		const howl = options.howlFor(sound.soundName);
		if (!howl) return;

		pauseAllMusic();
		howl.play(sound.soundId);
		options.getSoundMap()[sound.soundName] = {
			...sound,
			soundState: 'playing',
		};
	};

	const soundPlayMap = {
		new: (sound: Sound) => newMusic(sound),
		paused: (sound: Sound) => resumeMusic(sound),
		playing: (_: Sound) => {
			// Do nothing
		},
	};

	const play = (playOptions: PlayOptions<TSoundName>) => {
		const existingSound = options.getSoundMap()[playOptions.name];
		const sound = existingSound ?? options.newSound(playOptions.name);
		soundPlayMap[sound.soundState](sound);
	};

	return {
		play,
	};
}
