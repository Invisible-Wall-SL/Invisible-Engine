import type { Howl } from 'howler';

import type {
	StopOptions,
	FadeOptions,
	GetSound,
	GetSoundMap,
	LoopOptions,
	PanOptions,
	RateOptions,
	SeekOptions,
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
	/** The name's region in its bank's file, `[start, duration]` in ms (howler seeks the file). */
	regionFor?: (soundName: TSoundName) => readonly [number, number] | undefined;
	createPlay: (options: {
		howlFor: (soundName: TSoundName) => Howl | undefined;
		newSound: (value: TSoundName) => GetSound<TSoundName>;
		getSoundMap: () => GetSoundMap<TSoundName>;
		initSoundVolume: (soundName: TSoundName) => void;
	}) => {
		play: TPlay;
		/** Ends `sound` itself, later (true), or leaves it to the player's own stop (false). */
		release?: (sound: GetSound<TSoundName>) => boolean;
	};
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

	const { play, release } = playerOptions.createPlay({
		howlFor: playerOptions.howlFor,
		newSound,
		getSoundMap: () => soundMap,
		initSoundVolume: (soundName: TSoundName) => initSoundVolume(soundName),
	});

	const stop = (stopOptions: StopOptions<TSoundName>) => {
		const existingSound = soundMap[stopOptions.name];
		if (existingSound) {
			if (!release?.(existingSound)) {
				playerOptions.howlFor(existingSound.soundName)?.stop(existingSound.soundId);
			}
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

		// Per sound, PLAYING ones only: howler's volume setter cancels a running fade, and a paused
		// sound (a music bed fading out under a crossfade) gets its level re-applied on resume.
		(Object.values(soundMap) as Sound[]).forEach((sound) => {
			if (sound.soundState === 'paused') return;
			playerOptions
				.howlFor(sound.soundName)
				?.volume(playerVolume * sound.soundVolume * sound.soundConfig.volume, sound.soundId);
		});
	};

	/** Stereo pan, −1 … 1. Howler applies it on Web Audio only. */
	const pan = (panOptions: PanOptions<TSoundName>) => {
		const existingSound = soundMap[panOptions.name];
		if (existingSound) {
			playerOptions.howlFor(existingSound.soundName)?.stereo(panOptions.pan, existingSound.soundId);
		}
	};

	/** Loop the playing sound (or stop looping it), whatever its region's own loop flag says. */
	const loop = (loopOptions: LoopOptions<TSoundName>) => {
		const existingSound = soundMap[loopOptions.name];
		if (existingSound) {
			playerOptions.howlFor(existingSound.soundName)?.loop(loopOptions.loop, existingSound.soundId);
		}
	};

	/** Jump the playing sound `offset` ms into its own region (not the bank's file). An offset at
	 *  or past the region's end is ignored: the seek would land in the next region's audio. */
	const seek = (seekOptions: SeekOptions<TSoundName>) => {
		const existingSound = soundMap[seekOptions.name];
		const region = playerOptions.regionFor?.(seekOptions.name);
		if (existingSound && region && seekOptions.offset >= 0 && seekOptions.offset < region[1]) {
			playerOptions
				.howlFor(existingSound.soundName)
				?.seek((region[0] + seekOptions.offset) / 1000, existingSound.soundId);
		}
	};

	/** The per-play level `soundName` sounds at while it is playing, else `undefined`. */
	const level = (soundName: TSoundName): number | undefined => {
		const existingSound = soundMap[soundName];
		if (existingSound?.soundState !== 'playing') return undefined;
		// Where a running fade has it NOW, read back off howler; the stored level is the fade's target.
		const scale = playerVolume * existingSound.soundConfig.volume;
		const live = playerOptions.howlFor(soundName)?.volume(existingSound.soundId);
		return scale > 0 && typeof live === 'number'
			? Math.min(live / scale, 1)
			: existingSound.soundVolume;
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
		pan,
		loop,
		seek,
		level,
		debug,
	};
}

export type Player<TSoundName extends string, TPlay extends Function> = ReturnType<
	typeof createPlayer<TSoundName, TPlay>
>;

export { createPlayer };
