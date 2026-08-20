<script lang="ts">
	import { Container, Sprite, getContextApp } from 'pixi-svelte';
	import { resolveButtonStateImage } from 'engine-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_SIZE } from '../constants';

	/** Spin-frame rotation rate while a single bet rolls (radians/second). */
	const SPIN_RADIANS_PER_SECOND = Math.PI * 2;

	/**
	 * Frame slice of the split `button` component (§16.2 "separate coded parts" —
	 * the button analogue of B5's `HudTicker`). Reproduces `UiButton`'s `UiSprite`
	 * tile: the variant dark/light background, the disabled grey override, the active
	 * border, all under the `tint` multiply — byte-identical to the coded button when
	 * the params carry their defaults.
	 *
	 * This part ALSO owns the hit area: a `static` `Container` whose `onpointerup`
	 * calls the action `onpress` exposed on the param context (the action feed). It
	 * also tracks `hovered`/`pressed` locally (mirroring the coded `Button.svelte`)
	 * to drive the state images below.
	 *
	 * STATE IMAGES (the def's `image*` instance params, atlas frame names): when the
	 * state's image is authored, the frame renders a real `<Sprite>` of that frame
	 * INSTEAD of the variant tile — resolution order spinning (`imageSpinning`, rotated) then disabled (`imageDisabled`, the
	 * downstate) → pressed (`imagePressed`, falls back to hover, then to selected
	 * while active) → hovered (`imageHover`, falls back to selected while active) →
	 * active (`imageSelected`) → resting (`image`). The coded painted states only
	 * apply where no image covers them: no `imageDisabled` ⇒ disabled greys (tile
	 * fill / sprite tint). The active BORDER is tile-only — once a resting `image`
	 * is authored, `imageSelected` is what makes the active state visible, so an
	 * image-skinned button should author both. No image params at all ⇒ the tile
	 * path is byte-identical.
	 *
	 * Editor-configurable via the shared `TILE_PARAMS` (the `ButtonFrame` entry in
	 * `BOUND_COMPONENT_PARAMS`): `texture`/`tint`/`borderColor`/`borderWidth`/
	 * `borderRadius` arrive on the node's `bind.props` (spread in here) as the RESTING
	 * look. `tint` on `bind.props` overrides the instance `tint` param.
	 * Reads the engine param context the `<ComponentInstance>` provides.
	 */
	interface Props {
		texture?: string;
		tint?: number;
		borderColor?: number;
		borderWidth?: number;
		borderRadius?: number;
	}
	const { texture, tint: tintProp, borderColor, borderWidth, borderRadius }: Props = $props();

	// Resolved ONCE at init: `getComponentParams()` is `getContext`, which throws
	// `lifecycle_outside_component` when called outside component initialisation — and
	// `onpress` below runs from a Pixi pointer callback, long after init. The instance
	// provides a stable object whose engine-provided keys are live getters, so holding
	// the reference keeps every read reactive.
	const params = getComponentParams();

	// Empty string normalizes to undefined: a cleared editor field must fall back
	// like an absent param (otherwise `''` defeats the painted disabled/active
	// fallbacks below while rendering nothing).
	const stringParam = (key: string): string | undefined => {
		const value = typeof params[key] === 'string' ? (params[key] as string) : undefined;
		return value === '' ? undefined : value;
	};
	const numberParam = (key: string): number | undefined =>
		typeof params[key] === 'number' ? (params[key] as number) : undefined;
	const boolParam = (key: string): boolean => params[key] === true;

	const variant = $derived(stringParam('variant') ?? 'dark');
	// Per-part tint (bind.props) overrides the instance `tint` param; else white.
	const tint = $derived(tintProp ?? numberParam('tint') ?? 0xffffff);
	const disabled = $derived(boolParam('disabled'));
	const active = $derived(boolParam('active'));
	// Round-in-progress flag (engine-provided): the spin button's reels are rolling.
	// Only spins the frame when an `imageSpinning` frame is actually authored —
	// rotating the resting art would be a surprise (absent ⇒ no swap, no rotation).
	const spinning = $derived(boolParam('spinning'));
	const hasSpinningImage = $derived(stringParam('imageSpinning') !== undefined);

	// Interaction state — same tracking + disabled-reset as the coded `Button.svelte`.
	let hovered = $state(false);
	let pressed = $state(false);
	$effect(() => {
		if (disabled) {
			hovered = false;
			pressed = false;
		}
	});

	// Authored per-state bg image (atlas frame name) for the CURRENT state — the
	// SHARED cascade (`engine-layout/buttonStateImage`, also used by the authored
	// art-button path in `<ComponentInstance>`); undefined ⇒ the state has no image
	// of its own.
	const stateImage = $derived(
		resolveButtonStateImage(params, {
			hovered,
			pressed,
			disabled,
			active,
			spinning,
		}),
	);

	// Continuous spin: while the round rolls AND a spin frame is authored, drive the
	// frame's rotation off the Pixi ticker (the engine's continuous-motion idiom —
	// see ParticleEmitter). Reset to upright and detach the moment it stops. The
	// effect re-runs when `spinning`/`hasSpinningImage` or the app appears, so it
	// self-attaches once the application is initialised.
	const appContext = getContextApp();
	let spinRotation = $state(0);
	$effect(() => {
		const ticker = appContext.stateApp.pixiApplication?.ticker;
		if (!spinning || !hasSpinningImage || !ticker) {
			spinRotation = 0;
			return;
		}
		const tick = () => {
			spinRotation =
				(spinRotation + (ticker.deltaMS / 1000) * SPIN_RADIANS_PER_SECOND) % (Math.PI * 2);
		};
		ticker.add(tick);
		return () => ticker.remove(tick);
	});
	const frameImage = $derived(stateImage ?? stringParam('image'));
	// Coded painted states apply only where no authored image covers them.
	const paintDisabled = $derived(disabled && stringParam('imageDisabled') === undefined);
	const paintActive = $derived(active && stringParam('imageSelected') === undefined);

	// The action handler arrives on the param context (same reactive trick as
	// `HudValue`'s `value`); undefined until the action feed registers it → no-op.
	const onpress = () => {
		if (disabled) return;
		const handler = params['onpress'];
		if (typeof handler === 'function') (handler as () => void)();
	};
</script>

<!-- `none` while DISABLED so an inert button does not SWALLOW the pointer — the press falls
	 through to the overlay beneath the chrome. See the note in `components-pixi/Button.svelte`. -->
<Container
	eventMode={disabled ? 'none' : 'static'}
	cursor={disabled ? 'not-allowed' : 'pointer'}
	onpointerover={() => {
		if (!disabled) hovered = true;
	}}
	onpointerout={() => {
		hovered = false;
		pressed = false;
	}}
	onpointerdown={() => {
		if (!disabled) pressed = true;
	}}
	onpointerup={() => {
		pressed = false;
		onpress();
	}}
>
	<Container {tint} rotation={spinRotation}>
		{#if frameImage}
			<Sprite
				key={frameImage}
				anchor={0.5}
				width={UI_BASE_SIZE}
				height={UI_BASE_SIZE}
				tint={paintDisabled ? 0xaaaaaa : 0xffffff}
			/>
		{:else}
			<UiSprite
				anchor={0.5}
				width={UI_BASE_SIZE}
				height={UI_BASE_SIZE}
				backgroundColor={variant === 'dark' ? 0x000000 : 0xffffff}
				{...texture ? { key: texture } : {}}
				{...borderRadius !== undefined ? { borderRadius } : {}}
				{...paintDisabled
					? {
							backgroundColor: 0xaaaaaa,
						}
					: {}}
				{...paintActive
					? {
							borderWidth: 10,
							borderColor: variant === 'dark' ? 0xffffff : 0x000000,
						}
					: borderWidth
						? {
								borderWidth,
								borderColor: borderColor ?? 0x000000,
							}
						: {}}
			/>
		{/if}
	</Container>
</Container>
