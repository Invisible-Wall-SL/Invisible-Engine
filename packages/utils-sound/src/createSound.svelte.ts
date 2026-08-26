import { Howl, Howler } from 'howler';

import { type LoadedAudio } from 'pixi-svelte';
import { stateSoundDerived } from 'state-shared';

import { buildSoundBankIndex, toSoundBankList, type SoundBankIndex } from './banks';
import { createPlayer, type Player } from './createPlayer.svelte';
import { createPlayMusic } from './createPlayMusic.svelte';
import { createPlayLoop } from './createPlayLoop.svelte';
import { createPlayOnce } from './createPlayOnce.svelte';
import type { FadeOptions, RateOptions, SoundConfig, StopOptions } from './types';

function createSound<TSoundName extends string>() {
	type PlayMusic = ReturnType<typeof createPlayMusic<TSoundName>>['play'];
	type PlayLoop = ReturnType<typeof createPlayLoop<TSoundName>>['play'];
	type PlayOnce = ReturnType<typeof createPlayOnce<TSoundName>>['play'];

	/** One loaded audio file and the `Howl` that plays it. See `banks.ts`. */
	type Bank = { audio: LoadedAudio<TSoundName>; howl: Howl };

	let banks: Bank[] = [];
	let bankIndex: SoundBankIndex<TSoundName> = Object.create(null);
	let audioContextState = $state<AudioContext['state']>('running');
	let visibilityState = $state<DocumentVisibilityState>('visible');
	let players: {
		music: Player<TSoundName, PlayMusic>;
		loop: Player<TSoundName, PlayLoop>;
		once: Player<TSoundName, PlayOnce>;
	};

	const bankFor = (soundName: TSoundName): Bank | undefined => {
		const index = bankIndex[soundName];
		return index === undefined ? undefined : banks[index];
	};

	/**
	 * The `Howl` a name plays on, or `undefined` when no bank declares it. Every play/stop/fade path
	 * routes through this rather than closing over a single howl, because a `soundId` is only unique
	 * WITHIN its own `Howl` — addressing bank A's id on bank B's howl would silently mis-target.
	 */
	const howlFor = (soundName: TSoundName): Howl | undefined => bankFor(soundName)?.howl;

	/** The name's base volume, from ITS OWN bank — an overriding bank brings its own mix. */
	const configFor = (soundName: TSoundName): SoundConfig =>
		bankFor(soundName)?.audio.config?.[soundName] ?? { volume: 1 };

	/**
	 * Load the game's audio. Takes a single `LoadedAudio` (every caller today) or an ordered list of
	 * banks, last-wins on name — the seam a project's own exported sounds arrive on.
	 */
	const load = (loadedAudioValue: LoadedAudio<TSoundName> | readonly LoadedAudio<TSoundName>[]) => {
		const audios = toSoundBankList(loadedAudioValue);
		banks = audios.map((audio) => ({
			audio,
			howl: new Howl({
				src: audio.src,
				sprite: audio.sprite,
				volume: 1,
				// Howler consults `format` BEFORE sniffing the URL. A bank that knows its own container
				// (an exported project sound — the catalog carries the filename) declares it rather than
				// asking howler to re-derive it from a URL. Absent for the shipped audiosprite, which
				// leaves howler's detection exactly as it was.
				...(audio.format ? { format: audio.format } : {}),
			}),
		}));
		bankIndex = buildSoundBankIndex<TSoundName>(audios);

		// players
		players = {
			music: createPlayer<TSoundName, PlayMusic>({ howlFor, configFor, createPlay: createPlayMusic<TSoundName> }), // prettier-ignore
			loop: createPlayer<TSoundName, PlayLoop>({ howlFor, configFor, createPlay: createPlayLoop<TSoundName> }), // prettier-ignore
			once: createPlayer<TSoundName, PlayOnce>({ howlFor, configFor, createPlay: createPlayOnce<TSoundName> }), //  prettier-ignore
		};

		// audioContextState and visibilityState
		const onAudioContextChange = () => (audioContextState = Howler.ctx.state);
		const onVisibilityStateChange = () => (visibilityState = document.visibilityState);

		Howler.ctx.addEventListener('statechange', onAudioContextChange);
		document.addEventListener('visibilitychange', onVisibilityStateChange);

		const destroy = () => {
			Howler.ctx.removeEventListener('statechange', onAudioContextChange);
			document.removeEventListener('visibilitychange', onVisibilityStateChange);

			// Once per BANK. This used to unload the three players' `howl`, which was the same object
			// three times; with banks that would leave every bank after the first loaded forever.
			banks.forEach((bank) => bank.howl.unload());
			banks = [];
			bankIndex = Object.create(null);
		};

		return {
			destroy,
		};
	};

	/**
	 * Whether any loaded bank carries a region for `soundName`. Lets a caller ask before playing a cue
	 * that a game's manifest may predate: howler silently declines to play an unknown sprite key, so
	 * without this a missing region is an inaudible non-failure. Also false before `load()`.
	 */
	const hasSound = (soundName: TSoundName) => bankIndex[soundName] !== undefined;

	const stop = (stopOptions: StopOptions<TSoundName>) => {
		if (players) {
			players.music.stop(stopOptions);
			players.loop.stop(stopOptions);
			players.once.stop(stopOptions);
		}
	};

	const fade = async (fadeOptions: FadeOptions<TSoundName>) => {
		if (players) {
			const getPromises = () => [
				players.music.fade(fadeOptions),
				players.loop.fade(fadeOptions),
				players.once.fade(fadeOptions),
			];

			await Promise.all(getPromises());
		}
	};

	const rate = (rateOptions: RateOptions<TSoundName>) => {
		if (players) {
			players.music.rate(rateOptions);
			players.loop.rate(rateOptions);
			players.once.rate(rateOptions);
		}
	};

	const disable = () => {
		Howler.volume(0);
		Howler.mute(true);
	};

	const enable = () => {
		Howler.volume(1);
		Howler.mute(false);
	};

	const enableEffect = () => {
		$effect(() => {
			if (audioContextState === 'running' && visibilityState === 'visible') {
				enable();
			} else {
				disable();
			}
		});
	};

	const volumeMusicEffect = () => {
		if (players) {
			players.music.volume(stateSoundDerived.volumeMusic());
		}
	};

	const volumeLoopEffect = () => {
		if (players) {
			players.loop.volume(stateSoundDerived.volumeSoundEffect());
		}
	};

	const volumeOnceEffect = () => {
		if (players) {
			players.once.volume(stateSoundDerived.volumeSoundEffect());
		}
	};

	const volumeEffect = () => {
		$effect(() => {
			volumeMusicEffect();
		});

		$effect(() => {
			volumeLoopEffect();
		});

		$effect(() => {
			volumeOnceEffect();
		});
	};

	return {
		load,
		hasSound,
		stop,
		fade,
		rate,
		volumeEffect,
		enableEffect,
		get players() {
			return players;
		},
	};
}

export { createSound };
