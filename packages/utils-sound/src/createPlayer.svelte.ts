import type { Howl } from 'howler';

import type {
	StopOptions,
	FadeOptions,
	GetSound,
	GetSoundMap,
	RateOptions,
	SoundConfig,
} from './types';

/**
 * `howlFor` / `configFor` replace what used to be a single `howl` + the one `LoadedAudio` this player
 * closed over. A sound's name decides which bank — and therefore which `Howl` — it belongs to, and
 * that lookup is deterministic, so nothing here needs to remember it per sound. See `banks.ts`.
 */
function createPlayer<TSoundName extends string, TPlay extends Function>(playerOptions: {
	howlFor: (soundName: TSoundName) => Howl | undefined;
	configFor: (soundName: TSoundName) => SoundConfig;
	createPlay: (options: {
		howlFor: (soundName: TSoundName) => Howl | undefined;
		newSound: (value: TSoundName) => GetSound<TSoundName>;
		getSoundMap: () => GetSoundMap<TSoundName>;
		initSoundVolume: (soundName: TSoundName) => void;
	}) => { play: TPlay };
}) {
	type Sound = GetSound<TSoundName>;

	type SoundMap = Record<TSoundName, Sound>;

	let soundMap = {} as SoundMap;
	let playerVolume = 1;

	const newSound = (soundName: TSoundName) =>
		({
			soundName,
			soundId: 0,
			soundState: 'new',
			soundConfig: playerOptions.configFor(soundName),
			soundVolume: 1,
		}) as Sound;

	const initSoundVolume = (soundName: TSoundName) => {
		const existingSound = soundMap[soundName];
		if (existingSound) {
			playerOptions
				.howlFor(existingSound.soundName)
				?.volume(
					playerVolume * existingSound.soundVolume * existingSound.soundConfig.volume,
					existingSound.soundId,
				);
		}
	};

	const { play } = playerOptions.createPlay({
		howlFor: playerOptions.howlFor,
		newSound,
		getSoundMap: () => soundMap,
		initSoundVolume: (soundName: TSoundName) => initSoundVolume(soundName),
	});

	const stop = (stopOptions: StopOptions<TSoundName>) => {
		const existingSound = soundMap[stopOptions.name];
		if (existingSound) {
			playerOptions.howlFor(existingSound.soundName)?.stop(existingSound.soundId);
			delete soundMap[existingSound.soundName];
		}
	};

	const fade = async (fadeOptions: FadeOptions<TSoundName>) => {
		const existingSound = soundMap[fadeOptions.name];
		if (existingSound) {
			existingSound.soundVolume = fadeOptions.to;

			//Adjust the whole player volume	howl
			playerOptions
				.howlFor(existingSound.soundName)
				?.fade(
					fadeOptions.from * playerVolume * existingSound.soundConfig.volume,
					fadeOptions.to * playerVolume * existingSound.soundConfig.volume,
					fadeOptions.duration,
					existingSound.soundId,
				);
		}
	};

	const rate = (rateOptions: RateOptions<TSoundName>) => {
		const existingSound = soundMap[rateOptions.name];
		if (existingSound) {
			playerOptions.howlFor(existingSound.soundName)?.rate(rateOptions.rate, existingSound.soundId);
		}
	};

	const volume = (volume: number) => {
		playerVolume = volume;

		//Adjust the whole player volume
		// howl.volume(playerVolume);

		//adjust volume per sound
		(Object.values(soundMap) as Sound[]).forEach((sound) => {
			playerOptions
				.howlFor(sound.soundName)
				?.volume(playerVolume * sound.soundVolume * sound.soundConfig.volume, sound.soundId);
		});
	};

	const debug = () => {
		console.log($state.snapshot(soundMap));
	};

	return {
		play,
		stop,
		fade,
		volume,
		rate,
		debug,
	};
}

export type Player<TSoundName extends string, TPlay extends Function> = ReturnType<
	typeof createPlayer<TSoundName, TPlay>
>;

export { createPlayer };
