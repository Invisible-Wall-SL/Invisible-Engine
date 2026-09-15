<script lang="ts" module>
	import { sound, type MusicName, type SoundEffectName, type SoundName } from '../game/sound';

	export type EmitterEventSound =
		// `volume` is the PER-PLAY level, 0..1, folded into `playerVolume × volume × the library
		// entry's own volume` — so it scales with the player's music slider rather than fighting it.
		// Absent ⇒ the entry's authored level, which is the common case.
		| { type: 'soundMusic'; name: MusicName; volume?: number }
		| { type: 'soundOnce'; name: SoundEffectName; forcePlay?: boolean; volume?: number }
		| { type: 'soundLoop'; name: SoundEffectName }
		| { type: 'soundStop'; name: SoundName }
		| { type: 'soundFade'; name: SoundName; from: number; to: number; duration: number }
		| { type: 'soundScatterCounterIncrease' }
		| { type: 'soundScatterCounterClear' };
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { waitForTimeout } from 'utils-shared/wait';
	import { SECOND } from 'constants-shared/time';
	import { stateBet } from 'state-shared';
	import type { MusicSlotId } from 'game-config';

	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
	import { musicCue } from '../game/soundBindings';

	const context = getContext();

	/**
	 * Play one of the project's MUSIC BEDS. The two sites below used to name `bgm_main` /
	 * `bgm_freespin` outright; they ask the slot now, so a game whose theme is its own upload is
	 * heard here too. Resolved rather than broadcast — this component is the only subscriber to
	 * `soundMusic`, so raising the event to catch it here would be a round trip through itself.
	 * A silenced slot resolves to `undefined` and plays nothing, which is the authored answer.
	 */
	const playMusicSlot = (slot: MusicSlotId): void => {
		const cue = musicCue(slot);
		if (cue) sound.players.music.play({ name: cue.name, volume: cue.volume });
	};

	context.eventEmitter.subscribeOnMount({
		// ui
		soundBetMode: async ({ betModeKey }) => {
			if (betModeKey === 'SUPERSPIN') {
				// check if SUPERSPIN, when changing the bet mode.
				sound.players.once.play({ name: 'sfx_winlevel_end' });
				await waitForTimeout(SECOND);
				playMusicSlot('freeSpinMusic');
			} else {
				playMusicSlot('baseMusic');
			}
		},
		soundPressGeneral: () => sound.players.once.play({ name: 'sfx_btn_general' }),
		soundPressBet: () => sound.players.once.play({ name: 'sfx_btn_spin' }),
		// The SLAM press. `sfx_btn_stop` is a STAND-IN region (see docs/status/engine.md): it points at
		// the same short UI click as `sfx_btn_general`, chosen because it is a real press cue, is
		// unmistakably not the 1s spin whoosh, and won't muddy the `sfx_reel_stop_*` thunks a slam fires
		// right after. A game whose audiosprite predates the region falls back to the spin cue rather
		// than going silent (howler declines an unknown sprite key without erroring).
		soundPressStop: () =>
			sound.players.once.play({
				name: sound.hasSound('sfx_btn_stop') ? 'sfx_btn_stop' : 'sfx_btn_spin',
			}),
		// scatterCounter
		soundScatterCounterIncrease: () => (context.stateGame.scatterCounter = context.stateGame.scatterCounter + 1), // prettier-ignore
		soundScatterCounterClear: () => (context.stateGame.scatterCounter = 0),
		// game
		soundMusic: ({ name, volume }) => sound.players.music.play({ name, volume }),
		soundLoop: ({ name }) => sound.players.loop.play({ name }),
		soundOnce: ({ name, forcePlay, volume }) =>
			sound.players.once.play({ name, forcePlay, volume }),
		soundStop: ({ name }) => sound.stop({ name }),
		soundFade: async ({ name, duration, from, to }) => await sound.fade({ name, duration, from, to }), // prettier-ignore
	});

	onMount(() => {
		if (stateBet.activeBetModeKey === 'SUPERSPIN') {
			// check if SUPERSPIN, when resume bet and the bet is a super spin.
			playMusicSlot('freeSpinMusic');
		} else if (!flowV2DrivesScreens()) {
			// Under a v2 flow that DRIVES the loading→game screens, the music start is FLOW-AUTHORED
			// (the Game Signals `onTapToStart` pin → `soundMusic(bgm_main)`), so it must NOT auto-play at
			// boot — auto-playing here is what let `bgm_main` sound before the tap-to-start. When no v2
			// flow drives screens (coded/v1 games, or a book-events-only v2 flow) this is byte-identical
			// to the previous unconditional boot autoplay (parity).
			playMusicSlot('baseMusic');

			//How to control volume per soundfile(use fade)
			// sound.players.music.fade({ name: 'bgm_main', from: 0, to: 1, duration: 2000 });

			//How to control rate per soundfile
			// sound.players.music.rate({ rate: 2, name: 'bgm_main'}); // change play back rate(1: default, 0: slow, 1+ fasterm and higher pitch )
		}
	});
</script>
