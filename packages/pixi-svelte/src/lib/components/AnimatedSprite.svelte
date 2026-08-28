<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	import type { OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<PIXI.AnimatedSpriteOptions> & {
		animationSpeed?: PIXI.AnimatedSprite['animationSpeed'];
		loop?: PIXI.AnimatedSprite['loop'];
		play?: boolean;
		/** Mirror horizontally / vertically about the sprite's own anchor. Applied as the SIGN of
		 * `scale`, never as a `scale` prop — see the effect below. */
		flipX?: boolean;
		flipY?: boolean;
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

	propsSyncEffect({
		props,
		target: animatedSprite,
		ignore: ['play', 'textures', 'flipX', 'flipY'],
	});

	/**
	 * Mirroring, applied as the SIGN of `scale` rather than as a `scale` value.
	 *
	 * `scale`, `width` and `height` are all legitimate sizing props here and they FIGHT: PIXI's
	 * `width` setter is `scale.x = value / localWidth * sign` — it preserves whatever sign the
	 * scale already has — while assigning `scale` outright replaces it. So a flip written as
	 * `scale={{x: -1}}` is either the size or the mirror depending on which prop `propsSyncEffect`
	 * happens to assign last.
	 *
	 * Taking the sign of the CURRENT scale sidesteps the ordering entirely: whichever runs first,
	 * `abs(scale) * sign` keeps the magnitude the sizing props chose and the direction this one
	 * did. It re-reads every prop for the same reason `propsSyncEffect` does — that effect
	 * re-assigns everything (`scale` included) whenever ANY prop changes, so the sign has to be
	 * re-stamped after it. Declared AFTER it so it runs after it in the same flush.
	 */
	$effect(() => {
		for (const key of Object.keys(props) as (keyof Props)[]) void props[key];
		const scale = animatedSprite.scale;
		scale.x = Math.abs(scale.x) * (props.flipX ? -1 : 1);
		scale.y = Math.abs(scale.y) * (props.flipY ? -1 : 1);
	});

	$effect(() => {
		if (props.play) {
			animatedSprite.gotoAndPlay(0);
		} else {
			animatedSprite.gotoAndStop(0);
		}
	});

	parentContext.addToParent(animatedSprite);
</script>
