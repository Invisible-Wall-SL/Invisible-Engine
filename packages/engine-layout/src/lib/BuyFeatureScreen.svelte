<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = {
		/**
		 * Whether the SELECT menu is showing. Games pass this DIRECTLY off the modal state
		 * (`stateModal.modal?.name === 'buyBonus'`) — engine-layout stays state-agnostic, so the
		 * boolean is resolved at the call site. A card press advances the modal to `buyBonusConfirm`,
		 * so `open` flips false and the HTML confirm dialog takes over without a redirect hack.
		 */
		open: boolean;
		/** Tap-the-backdrop dismiss — games clear the modal (`stateModal.modal = null`). */
		onDismiss: () => void;
		/** The takeover z-band (games pass the shared `LAYER_BAND_TAKEOVER`). */
		zIndex: number;
		/**
		 * The scene to render. Games with an editor doc pass their authored/fallback `buyFeature`
		 * scene; omit it to render the engine default (`defaultBuyFeatureScene`), so a game with no
		 * layout doc still gets a working menu with zero scene wiring.
		 */
		scene?: Scene;
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { OnPressFullScreen } from 'components-layout';

	import LayoutScene from './LayoutScene.svelte';
	import { defaultBuyFeatureScene } from './buyFeatureScene';

	const { open, onDismiss, zIndex, scene }: Props = $props();

	const resolvedScene = $derived(scene ?? defaultBuyFeatureScene());
</script>

{#if open}
	<Container {zIndex}>
		<OnPressFullScreen onpress={onDismiss} />
		<LayoutScene scene={resolvedScene} />
	</Container>
{/if}
