type Stacked = { id: string; z: number };

export type AheadMounts = {
	/** The containers to mount: the shown ones and those ahead that have never shown, by `z` (a tie
	 *  keeps the shown ones first, each list in its own order). */
	plan<C extends Stacked>(shown: readonly C[], ahead: readonly C[]): C[];
	/** Whether the container was mounted ahead and is still mounted: it keeps that mount. */
	mountedAhead(id: string): boolean;
};

/**
 * Which containers `<FlowV2Mount>` mounts AHEAD of their first show, and which of its mounts are
 * those. A container ahead is mounted (dormant) until the flow shows it, keeps that mount when it
 * shows, and is unmounted when the flow hides it. Once shown, a container is never mounted ahead
 * again: a later show mounts it as any show does.
 */
export function createAheadMounts(): AheadMounts {
	const shownOnce = new Set<string>();
	const ahead = new Set<string>();
	return {
		plan(shown, wanted) {
			const shownIds = new Set(shown.map((c) => c.id));
			for (const id of shownIds) shownOnce.add(id);
			const waiting = wanted.filter((c) => !shownOnce.has(c.id));
			const waitingIds = new Set(waiting.map((c) => c.id));
			for (const id of ahead) if (!shownIds.has(id) && !waitingIds.has(id)) ahead.delete(id);
			for (const id of waitingIds) ahead.add(id);
			return [...shown, ...waiting].sort((a, b) => a.z - b.z);
		},
		mountedAhead: (id) => ahead.has(id),
	};
}
