<script lang="ts">
	/**
	 * Play an Invisible Cinematic in-game — the runtime twin of `/rigger`'s Cinematic mode.
	 * Plan: `docs/design/invisible-cinematic.md` · State: `docs/status/cinematic.md`.
	 *
	 * Mounts one `<SpineProvider>` per cast member (keyed by the rig's FOLDER, which is the spine
	 * bundle name the game registered — the export seeds those bundles into the shipped art, so a
	 * cast rig is always loadable) and drives them all from ONE clock through the shared
	 * `engine-cinematic` evaluator. Same evaluator the editor preview runs, so what an author
	 * scrubbed is what the game plays.
	 *
	 * Deliberately NOT a Scene: design §4.1 has a cinematic eventually binding tracks to an
	 * existing Scene's nodes, but Phase 1–3 cast rigs directly (`cast[].nodeId` is null), so this
	 * renders the cast itself. When the Scene binding lands, this component gains a branch; the
	 * doc format does not change.
	 */
	import { onDestroy } from 'svelte';
	import { getContextApp, SpineProvider } from 'pixi-svelte';
	import type { CinematicTrack } from 'engine-cinematic';
	import type { CinematicDoc } from './types';
	import CinematicActor from './CinematicActor.svelte';

	type Props = {
		doc: CinematicDoc;
		/** Start playing on mount. Off ⇒ the cinematic holds at `startTime` until `playing` flips. */
		playing?: boolean;
		/** Where the playhead starts (and where a `loop`ing cinematic returns to). */
		startTime?: number;
		loop?: boolean;
		/** Playback rate; 1 = authored speed. */
		speed?: number;
		/** Fired once when a non-looping cinematic reaches its end — the Flow `complete` seam. */
		oncomplete?: () => void;
	};
	const props: Props = $props();

	const appContext = getContextApp();

	let time = $state(props.startTime ?? 0);
	let done = false;

	const duration = $derived(Math.max(props.doc.duration || 0, 0));
	/** Cast in draw order — the same z the author saw on the /rigger stage. */
	const cast = $derived([...(props.doc.stage?.cast ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)));
	const tracksFor = (actorId: string): CinematicTrack[] =>
		(props.doc.tracks as CinematicTrack[]).filter((t) => t.actorId === actorId);

	/**
	 * Advance the playhead. Driven by the Pixi ticker rather than an internal rAF so the cinematic
	 * shares the game's clock — a paused/throttled game pauses the cinematic with it, and
	 * `deltaMS` already accounts for frame time.
	 */
	function tick() {
		if (!props.playing || duration <= 0 || done) return;
		time += (appContext.app.ticker.deltaMS / 1000) * (props.speed ?? 1);
		if (time < duration) return;
		if (props.loop) {
			time = duration > 0 ? time % duration : 0;
			return;
		}
		// Land exactly ON the last frame before reporting completion, so the final pose is the one
		// the author authored rather than whatever the overshoot happened to land on.
		time = duration;
		done = true;
		props.oncomplete?.();
	}

	appContext.app.ticker.add(tick);
	onDestroy(() => appContext.app.ticker.remove(tick));

	// Re-arm when the caller restarts it (a screen replayed, or a different cinematic mounted).
	$effect(() => {
		void props.doc.id;
		void props.startTime;
		time = props.startTime ?? 0;
		done = false;
	});
</script>

{#each cast as member (member.actorId)}
	{#if member.visible !== false && member.rigFolder}
		<SpineProvider key={member.rigFolder}>
			<CinematicActor cast={member} tracks={tracksFor(member.actorId)} {time} />
		</SpineProvider>
	{/if}
{/each}
