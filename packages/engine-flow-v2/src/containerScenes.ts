import type { ContainerRef } from './types';

/**
 * The flow's containers whose backing scene is NOT in the layout: screens the flow can show that
 * draw nothing. A Scene-Editor screen deleted after the flow synced it (or lost to a bad save)
 * stays in `FlowDoc.containers`, so `showContainer` still mounts it, nothing renders, and a hold or
 * tap waiting on it never releases. One home for the rule, read by the game at boot and by the
 * launcher at publish and at the runtime-bundle assembly.
 *
 * An EMPTY scene list is an unknown layout (an unsaved project, a boot with no doc), not a layout
 * with no screens, so it reports nothing rather than every container. Doc order is kept; `[]` means
 * the flow and the layout agree.
 */
export const containersMissingScene = (
	containers: readonly ContainerRef[],
	sceneIds: Iterable<string>,
): ContainerRef[] => {
	const known = new Set(sceneIds);
	if (known.size === 0) return [];
	return containers.filter((c) => !known.has(c.sceneId));
};
