<script lang="ts">
	/**
	 * The engine-drawn board under a base-game screen timeline (Rive plan Phase 3). Keys on the
	 * `reelGrid` node move, scale, turn, fade and hide what this wraps — the reels and their coded
	 * overlays — about the node's position (`boardDriveTransform`), as the Scene Editor previews the
	 * placeholder. Only the drawing moves: the board's layout (`boardLayout()`), and so anything
	 * placed from it outside this wrapper, stays where the node is authored. No timeline keying the
	 * node ⇒ an identity container, the board exactly as before.
	 */
	import { untrack, type Snippet } from 'svelte';
	import { Container } from 'pixi-svelte';
	import { resolveTransform, type LayoutType, type ReelGridNode } from 'engine-layout';
	import type { ScreenNodeDrive } from 'engine-layout/svelte';

	import { BOARD_UNDRIVEN, boardDriveTransform } from '../game/boardDrive';

	type Props = {
		/** The screen timeline driving the base game, if one is. */
		drive: ScreenNodeDrive | undefined;
		/** The base game's `reelGrid` node, the board's placeholder. */
		node: ReelGridNode | undefined;
		layoutType: LayoutType;
		children: Snippet;
	};
	const props: Props = $props();

	// Asked once per play, as a node view asks once per mount: which channels a timeline keys is fixed.
	const nodeDrive = $derived.by(() => {
		const { drive, node } = props;
		return drive && node ? untrack(() => drive.driver(node.id)) : undefined;
	});
	const transform = $derived(
		nodeDrive && props.node
			? boardDriveTransform(
					nodeDrive.channels,
					nodeDrive.sample(),
					resolveTransform(props.node, props.layoutType),
				)
			: BOARD_UNDRIVEN,
	);
</script>

<Container
	x={transform.x}
	y={transform.y}
	pivot={transform.pivot}
	scale={transform.scale}
	rotation={transform.rotation}
	alpha={transform.alpha}
	visible={transform.visible}
>
	{@render props.children()}
</Container>
