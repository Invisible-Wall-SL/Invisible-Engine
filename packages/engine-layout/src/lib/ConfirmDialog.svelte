<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = {
		/**
		 * Whether the dialog is showing. State-agnostic: a game resolves the boolean at the call
		 * site (e.g. `stateModal.modal?.name === 'buyBonusConfirm'`), so `engine-layout` never reads
		 * game state. Off ⇒ nothing renders (the takeover is fully unmounted).
		 */
		open: boolean;
		/** The `engineProvided` param values for the single `confirmDialog` instance (title/message/
		 * confirmLabel/cancelLabel/imageKey). Threaded into the instance via the binding context. */
		values: Record<string, unknown>;
		/** Confirm-button press — the game runs its "yes" side effect. */
		onConfirm: () => void;
		/** Cancel-button OR backdrop-tap press — the game runs its "back / dismiss" side effect. */
		onCancel: () => void;
		/** The takeover z-band (games pass the shared `LAYER_BAND_TAKEOVER`). */
		zIndex: number;
		/**
		 * The scene to render. Games with an editor doc pass their authored/fallback `buyConfirm`
		 * scene; omit it to render the engine default (`defaultConfirmScene`), so a game with no
		 * layout doc still gets a working dialog with zero scene wiring.
		 */
		scene?: Scene;
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { OnPressFullScreen } from 'components-layout';

	import LayoutScene from './LayoutScene.svelte';
	import { defaultConfirmScene, CONFIRM_DIALOG_COMPONENT_ID } from './confirmScene';
	import { setInstanceBindings } from './instanceBindingContext';

	const { open, values, onConfirm, onCancel, zIndex, scene }: Props = $props();

	const resolvedScene = $derived(scene ?? defaultConfirmScene());

	// Inject the mount's per-instance values + button callbacks into the scene's `confirmDialog`
	// instance — a scene node can't carry runtime callbacks, so the MOUNT supplies them (the single-
	// instance sibling of `<Repeater>`'s per-item props). Set once at init; the `engineValues` getter
	// re-reads the reactive `values` prop, so a later change (a different mode picked ⇒ new title/
	// message) threads through without re-mounting. The `confirm`/`cancel` actions route the two
	// `pressAction` buttons back to the game's handlers.
	setInstanceBindings({
		[CONFIRM_DIALOG_COMPONENT_ID]: {
			get engineValues() {
				return values;
			},
			actions: { confirm: () => onConfirm(), cancel: () => onCancel() },
		},
	});
</script>

{#if open}
	<Container {zIndex}>
		<OnPressFullScreen onpress={onCancel} />
		<LayoutScene scene={resolvedScene} />
	</Container>
{/if}
