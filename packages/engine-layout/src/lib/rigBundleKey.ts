/**
 * Reduce a placed rig's `assetKey` to the key a rig-timeline manifest is keyed by — its bundle
 * FOLDER.
 *
 * Shared by every rig-timeline registry (`registerRigFx`, `registerRigFlipbooks`) because they all
 * face the SAME two callers with two different key shapes: `LayoutNodeView` passes the bare folder
 * (`resolveSpineKeysForGame` already rewrote an editor-placed spine node's `assetKey` down to it),
 * while a rig shipped through the Symbols State Machine may still carry the FULL R2 bundle prefix
 * (`<client>/<project>/spines/<folder>/`). Same precedent as `EffectLayer`'s `bundleFolderOf` for
 * `skeletonParticle.skeletonKey` (see invisible-fx.md §9).
 *
 * Strip a trailing slash + match `/spines/<folder>` → `<folder>`. A key with no `spines/` segment
 * returns unchanged.
 *
 * One definition rather than one per registry: a second copy that drifts would make a symbol's rig
 * resolve its effects and not its flipbooks (or the reverse), which reads as "the clip is broken"
 * rather than as a lookup fault.
 */
export const bundleFolderOf = (key: string): string => {
	const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
	const m = trimmed.match(/(?:^|\/)spines\/(.+)$/);
	return m ? m[1] : trimmed;
};
