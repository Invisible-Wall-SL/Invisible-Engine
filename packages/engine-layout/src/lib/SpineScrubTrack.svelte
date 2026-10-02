<script lang="ts" module>
	export type Props = {
		/** The animation scrubbed. Missing from the skeleton ⇒ nothing plays (warned once). */
		animation: string;
		/** Its own track, above the resting animation's track 0, so the two layer. */
		track: number;
		/** Where it is held: 0 = first frame, 1 = last. */
		time: number;
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getContextSpine } from 'pixi-svelte';

	/**
	 * A spine `animTime` value binding (Phase 12b): hold one animation at a point set by a number — a
	 * pot's "fill" animation at the pot's level. The entry plays at `timeScale` 0, so the runtime's
	 * own clock never moves it, and the binding writes its `trackTime` (as a share of the animation's
	 * length). On its own track, so the resting / cued animation on track 0 keeps playing underneath
	 * and only the channels this one keys are held. Cleared on unmount.
	 */
	const props: Props = $props();
	const spine = getContextSpine();

	let entry = $state<ReturnType<typeof spine.state.setAnimation> | undefined>(undefined);
	let duration = 0;

	$effect(() => {
		const data = spine.skeleton.data.findAnimation(props.animation);
		if (!data) {
			console.warn(
				`[engine-layout] value binding scrubs "${props.animation}", which this skeleton does not have.`,
			);
			entry = undefined;
			return;
		}
		duration = data.duration;
		const next = spine.state.setAnimation(props.track, props.animation, false);
		next.timeScale = 0;
		next.mixDuration = 0;
		entry = next;
	});

	$effect(() => {
		if (!entry) return;
		entry.trackTime = Math.min(1, Math.max(0, props.time)) * duration;
	});

	onDestroy(() => {
		spine.state.setEmptyAnimation(props.track, 0);
	});
</script>
