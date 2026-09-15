import type { Howl } from 'howler';

import type { PlayOptions, GetSound, GetSoundMap } from './types';
import { usablePlayVolume } from './volume';

export function createPlayOnce<TSoundName extends string>(options: {
	howlFor: (soundName: TSoundName) => Howl | undefined;
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
		// A name no bank declares leaves the map UNTOUCHED. It used to be written as `playing` with a
		// null id (howler returns null for an unknown sprite), which never receives an `end` event — so
		// the name was pinned 'playing' for the session and could never play again, even once a bank
		// carrying it loaded.
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

		howl.on('end', (soundIdOnEnd) => {
			if (soundIdOnEnd === soundId) {
				howl.stop(soundId);
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
			// Out of range is DISCARDED rather than passed through — see `usablePlayVolume`. It
			// matters here now that a flow node can author this number with no range on the input.
			volume: usablePlayVolume(playOptions.volume),
		});
	};

	return {
		play,
	};
}
