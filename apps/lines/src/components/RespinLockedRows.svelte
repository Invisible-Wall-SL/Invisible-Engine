<script lang="ts">
	import { resolveFrameArt } from 'engine-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import { claimRespinLockedLook } from '../game/stateRespinBoard.svelte';

	/**
	 * The `lockedRow` component's coded part. It draws nothing where it is placed: it hands its art —
	 * what every LOCKED cell of an expanding respin board shows — to the respin board
	 * (`respinLockedLook`), which stamps it at each locked cell's seat. Unmounted ⇒ the coded overlay.
	 */
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];

	const HEX = /^#[0-9a-f]{6}$/i;
	const claim = claimRespinLockedLook();

	$effect(() => {
		const tint = param('lockedTint');
		claim.set({
			art: resolveFrameArt(param('lockedImage')),
			tint: typeof tint === 'string' && HEX.test(tint) ? tint : undefined,
		});
	});
	$effect(() => claim.release);
</script>
