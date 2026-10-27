<script lang="ts">
	/**
	 * Invisible Flow v2 — the in-game CINEMATIC renderer. Mounts one `<Cinematic>` per cinematic the
	 * flow currently wants on screen, reading the interpreter's reactive `playingCinematics` map (a
	 * `SvelteMap`, so a `playCinematic` node's `play`/`stop` exec re-runs this render).
	 *
	 * The cinematic itself owns everything about its content — cast, strips, property and camera keys,
	 * all authored in `/rigger` — so this component only decides WHETHER one is on screen. When a
	 * non-looping cinematic reaches its end, `oncomplete` settles the promise an `awaitComplete` node
	 * is holding on and unmounts it, which is the whole "play a cinematic and wait for it" contract.
	 *
	 * Inert when no v2 flow is authored, when the flow authors no `playCinematic` node, or when the
	 * project shipped no cinematics — `bakedCinematic()` returns undefined and nothing renders
	 * (parity). The flow runtime skips a play naming a cinematic the game lacks, with a warning.
	 *
	 * A SCREEN timeline whose screen is up (`onStage`: shown by the flow, or the Pots screen the game
	 * mounts itself) moves that screen: its `<Cinematic>` draws no copy and hands its node driver to
	 * the flow, whose mount of the screen remounts with it. Off stage, it draws its own copy.
	 */
	import { MainContainer } from 'components-layout';
	import {
		cinematicSetSceneId,
		emitComponentSignal,
		playCueSound,
		screenCueSignal,
	} from 'engine-layout';
	import { Cinematic } from 'engine-layout/svelte';
	import { getContextEventEmitter } from 'utils-event-emitter';

	import { bakedCinematic } from '../editor-scenes';
	import { sound } from '../game/sound';
	import { stateLayoutDerived } from '../game/stateLayout';
	import type { LinesFlowV2 } from '../game/flowV2Runtime.svelte';

	const {
		flow,
		onStage,
	}: {
		flow: LinesFlowV2 | undefined;
		/** Is this screen up right now — shown by the flow, or mounted by the game? Reactive. */
		onStage?: (sceneId: string) => boolean;
	} = $props();

	const eventEmitter = getContextEventEmitter<{ type: string }>()?.eventEmitter;

	/**
	 * Route one cue fired by a cinematic. The cinematic only says WHEN — each namespace names
	 * something that lives in a different system, so this is where they land:
	 *
	 *  - `fx:` / `signal:` — broadcast on the shared event bus under the bare name. An FX layer (or
	 *    anything else) subscribed to that name reacts, which is the SAME seam a rig's timeline
	 *    events already use, so cinematic cues and rig events are indistinguishable downstream.
	 *    A SCREEN timeline's `signal:` cue (`onScreen`) also fires its name on the component-signal
	 *    bus (`screenCueSignal`), as a Flow `fireCue` does, so an _On cue_ Element FX plays on it.
	 *  - `sfx:` / `music:` — through the game's sound player with the key's `sound` options
	 *    (`playCueSound`, which a component timeline's cue goes through too). A plain cue is a
	 *    one-shot or a music bed, guarded by `hasSound`: howler silently declines an unknown sprite
	 *    key, so without the guard a cue naming a sound this game's audiosprite predates would be an
	 *    inaudible non-failure rather than a warning.
	 *
	 * An unknown namespace is broadcast verbatim rather than dropped — a cue we have not taught the
	 * game about yet is still a moment something may be listening for.
	 */
	function routeCue(cue: string, onScreen: boolean, options: unknown): void {
		const sep = cue.indexOf(':');
		const ns = sep > 0 ? cue.slice(0, sep) : '';
		const name = sep > 0 ? cue.slice(sep + 1) : cue;
		if (!name) return;
		if (ns === 'sfx' || ns === 'music') {
			playCueSound(sound, cue, options);
			return;
		}
		eventEmitter?.broadcast({ type: name });
		const signal = onScreen ? screenCueSignal(cue) : undefined;
		if (signal) emitComponentSignal(signal);
	}

	/** Only the entries whose cinematic actually shipped — an unknown id renders nothing. */
	const active = $derived(
		[...(flow?.playingCinematics?.entries() ?? [])]
			.map(([id, opts]) => {
				const doc = bakedCinematic(id);
				// `resolveScene` is the flow runtime's own scene lookup, so a cinematic set resolves
				// exactly like any flow screen — no second scene registry. A `screen`-hosted timeline's
				// set is its host screen, whose nodes its node actors drive.
				const sceneId = doc ? cinematicSetSceneId(doc) : null;
				const scene = sceneId ? flow?.resolveScene(sceneId) : undefined;
				const screen = doc?.host?.kind === 'screen' && scene ? scene.id : undefined;
				return { id, opts, doc, scene, screen, setMounted: !!screen && !!onStage?.(screen) };
			})
			.filter((entry) => !!entry.doc),
	);
</script>

{#if active.length}
	<MainContainer>
		{#each active as entry (entry.id)}
			<!--
				The SET (design §12.3): a cinematic can stage over a Scene, which owns what is on
				stage — sprites, text, FX and their per-ratio placement, authored in /editor. Handed
				to `<Cinematic>` rather than mounted beside it, because the set carries its own DEPTH
				(`stage.setZ`) on the cast's z line and the player is what knows the cast order. It
				used to be pinned behind every rig, which also pinned every `fx:` cue's effect there —
				a cue fires an effect node that lives in the set. A cinematic with no set (or naming
				one this project lacks) mounts nothing.
			-->
			<Cinematic
				doc={entry.doc!}
				scene={entry.scene}
				setMounted={entry.setMounted}
				ondriver={entry.screen
					? (driver) => flow?.driveScreen(entry.screen!, entry.id, driver)
					: undefined}
				playing
				playId={entry.opts.play}
				loop={entry.opts.loop}
				speed={entry.opts.speed}
				oncomplete={() => flow?.cinematicComplete(entry.id)}
				oncue={(cue, options) => routeCue(cue, entry.doc?.host?.kind === 'screen', options)}
				layoutType={stateLayoutDerived.layoutType}
			/>
		{/each}
	</MainContainer>
{/if}
