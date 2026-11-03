import {
	containersMissingScene,
	type ContainerMountModel,
	type ContainerRef,
} from 'engine-flow-v2';

const screenLabel = (c: ContainerRef): string =>
	c.id === c.sceneId ? `"${c.id}"` : `"${c.id}" (scene "${c.sceneId}")`;

/**
 * Make a Flow that shows a screen the layout no longer has LOUD. Such a container still mounts, so
 * `<FlowV2Mount>` silently skips it, and a game waiting on that screen sits on whatever is already
 * drawn with nothing in the console. Logs the list of `used` ones once at boot, then once per
 * container id the first time it is shown or hidden. A missing container no node uses
 * (`usedContainerIds`) is only a stale declaration, so boot does not name it. Logging only: every
 * call reaches `mount` unchanged.
 *
 * A flow and layout that agree (or an unknown layout) get `mount` itself back and log nothing.
 */
export const withMissingScreenReport = (
	mount: ContainerMountModel,
	containers: readonly ContainerRef[],
	sceneIds: Iterable<string>,
	used: ReadonlySet<string>,
	log: (message: string) => void = console.error,
): ContainerMountModel => {
	const missing = containersMissingScene(containers, sceneIds);
	if (missing.length === 0) return mount;
	const named = missing.filter((c) => used.has(c.id));
	if (named.length > 0) {
		log(
			`[flow-v2] this game's Flow names ${named.length} screen(s) that are not in its layout ` +
				`(Scene Editor): ${named.map(screenLabel).join(', ')}. Nothing will draw for them, and ` +
				'any step waiting on one will never continue. Restore them in /editor (History…) or ' +
				'remove them from the Flow.',
		);
	}
	const unreported = new Map(missing.map((c) => [c.id, c]));
	const report = (id: string, verb: 'shows' | 'hides'): void => {
		const container = unreported.get(id);
		if (!container) return;
		unreported.delete(id);
		log(
			`[flow-v2] the Flow ${verb} screen ${screenLabel(container)}, which is not in this game's ` +
				'layout (Scene Editor). Nothing will draw for it, and any step waiting on it will never ' +
				'continue. Restore the screen in /editor (History…) or remove it from the Flow.',
		);
	};
	return {
		...mount,
		show: (id) => {
			report(id, 'shows');
			mount.show(id);
		},
		hide: (id) => {
			report(id, 'hides');
			mount.hide(id);
		},
	};
};
