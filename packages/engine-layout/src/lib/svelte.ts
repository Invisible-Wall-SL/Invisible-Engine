// Component entry: import via the `engine-layout/svelte` subpath. Consumers
// that need the runtime components (games via pixi-svelte) take this; the bare
// `engine-layout` import stays Svelte-free for type-only consumers.
import LayoutScene, { type Props as LayoutSceneProps } from './LayoutScene.svelte';
import LayoutNodeView, { type Props as LayoutNodeViewProps } from './LayoutNodeView.svelte';
import ComponentInstance, {
	type Props as ComponentInstanceProps,
} from './ComponentInstance.svelte';

export { LayoutScene, LayoutNodeView, ComponentInstance };
export type { LayoutSceneProps, LayoutNodeViewProps, ComponentInstanceProps };
