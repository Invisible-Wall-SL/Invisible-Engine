<script lang="ts">
	import { resolveComponent, resolveFrameArt } from 'engine-layout';
	import { getComponentNestState, getComponentParams } from 'engine-layout/svelte';

	import { claimRespinLockedLook, insideRespinLockedCell } from '../game/stateRespinBoard.svelte';

	/**
	 * The `lockedRow` component's coded part. It draws nothing where it is placed: it hands its art —
	 * what every LOCKED cell of an expanding respin board shows — to the respin board
	 * (`respinLockedLook`), which stamps it at each locked cell's seat. Unmounted ⇒ the coded overlay.
	 *
	 * `lockedComponent` names a component every locked cell draws as instead of `lockedImage`. One
	 * that is not registered, or that names a component this one sits in, is ignored, so the cells keep
	 * `lockedImage`. Mounted inside a locked cell's own component, it publishes nothing.
	 */
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];
	const nest = getComponentNestState();
	const lockedComponent = (): string | undefined => {
		const value = param('lockedComponent');
		if (typeof value !== 'string' || !value || nest.visited.has(value)) return undefined;
		return resolveComponent(value).def ? value : undefined;
	};

	const HEX = /^#[0-9a-f]{6}$/i;
	const claim = insideRespinLockedCell() ? undefined : claimRespinLockedLook();

	$effect(() => {
		if (!claim) return;
		const tint = param('lockedTint');
		const component = lockedComponent();
		claim.set({
			art: resolveFrameArt(param('lockedImage')),
			tint: typeof tint === 'string' && HEX.test(tint) ? tint : undefined,
			...(component ? { component } : {}),
		});
	});
	$effect(() => claim?.release);
</script>
