<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	import type { OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<PIXI.AnimatedSpriteOptions> & {
		animationSpeed?: PIXI.AnimatedSprite['animationSpeed'];
		loop?: PIXI.AnimatedSprite['loop'];
		play?: boolean;
	};
</script>

<script lang="ts">
	import { framesChanged } from '../animatedSpriteFrames';
	import { propsSyncEffect } from '../utils.svelte';
	import { getContextParent } from '../context.svelte';

	const props: Props = $props();

	const parentContext = getContextParent();
	const animatedSprite = new PIXI.AnimatedSprite(props.textures ?? []);

	/**
	 * `textures` is assigned OUTSIDE `propsSyncEffect`, and only when the frame list actually
	 * changes.
	 *
	 * That helper is ONE `$effect` that re-assigns EVERY prop whenever ANY tracked prop changes,
	 * and PIXI's `textures` setter ends in `gotoAndStop(0)`. So a single unrelated change — alpha,
	 * x, a window resize, a `loadedAssets` update — permanently froze playback on frame 0, while
	 * `play` stayed `true` and its effect (below) never re-ran to restart it. The symptom is a
	 * still frame that looks exactly like a one-frame clip, which is why it survived review.
	 *
	 * Confirmed live on `test6`: a placed background flipbook sat at `playing:false,
	 * currentFrame:0` with all 160 of its frames resolved, and re-assigning `textures` by hand
	 * flipped `playing` to `false` synchronously every time.
	 */
	let appliedTextures: Props['textures'] | undefined = props.textures;
	$effect(() => {
		const next = props.textures;
		if (!next || !framesChanged(appliedTextures, next)) return;
		// A genuinely new frame list restarts from 0 (PIXI rewinds anyway); carry playback across it
		// so a clip whose sheet finished loading keeps running instead of stopping on arrival.
		const resume = animatedSprite.playing || props.play === true;
		appliedTextures = next;
		animatedSprite.textures = next;
		if (resume) animatedSprite.gotoAndPlay(0);
	});

	propsSyncEffect({ props, target: animatedSprite, ignore: ['play', 'textures'] });

	$effect(() => {
		if (props.play) {
			animatedSprite.gotoAndPlay(0);
		} else {
			animatedSprite.gotoAndStop(0);
		}
	});

	parentContext.addToParent(animatedSprite);
</script>
