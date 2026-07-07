// Component entry: import via the `engine-layout/svelte` subpath. Consumers
// that need the runtime components (games via pixi-svelte) take this; the bare
// `engine-layout` import stays Svelte-free for type-only consumers.
import LayoutScene, { type Props as LayoutSceneProps } from './LayoutScene.svelte';
import LayoutNodeView, { type Props as LayoutNodeViewProps } from './LayoutNodeView.svelte';
import ComponentInstance, {
	type Props as ComponentInstanceProps,
} from './ComponentInstance.svelte';
import FlowMount, { type Props as FlowMountProps } from './FlowMount.svelte';
import FlowScreenMount, { type Props as FlowScreenMountProps } from './FlowScreenMount.svelte';
import FlowFade, {
	type Props as FlowFadeProps,
	type FlowEntranceTransition,
} from './FlowFade.svelte';
import FlowV2Mount, {
	type Props as FlowV2MountProps,
	type MountedContainerRef,
} from './FlowV2Mount.svelte';
import CatalogText, { type Props as CatalogTextProps } from './CatalogText.svelte';

export {
	LayoutScene,
	LayoutNodeView,
	ComponentInstance,
	FlowMount,
	FlowScreenMount,
	FlowFade,
	FlowV2Mount,
	CatalogText,
};
export type {
	LayoutSceneProps,
	LayoutNodeViewProps,
	ComponentInstanceProps,
	FlowMountProps,
	FlowScreenMountProps,
	FlowFadeProps,
	FlowEntranceTransition,
	FlowV2MountProps,
	MountedContainerRef,
	CatalogTextProps,
};

// Param context (§13.2) — Svelte-dependent, so it lives on the component entry
// (the bare `engine-layout` import stays Svelte-free). The editor canvas can
// reuse the same provider/reader when it threads instance params (B3).
export { setComponentParams, getComponentParams } from './componentParamsContext';
// Signal-anim context (§8.5, spine-only) — the signal sibling of the param
// context, likewise Svelte-dependent so it lives on the component entry.
export { setComponentSignalAnims, getComponentSignalAnims } from './componentSignalContext';
