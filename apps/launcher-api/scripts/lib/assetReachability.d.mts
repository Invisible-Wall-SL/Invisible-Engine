/** The paths outside the generated subtrees a scan found named: whole files, and folders. */
export interface AssetRefs {
	files: Set<string>;
	dirs: Set<string>;
}
export declare function emptyRefs(): AssetRefs;
/** Whether `rel` sits in one of the subtrees the exports write whole. */
export declare function isGenerated(rel: string): boolean;
export declare function collectRefs(
	refs: AssetRefs,
	text: string,
	options?: { json?: boolean; markup?: boolean; tops?: readonly string[] },
): AssetRefs;
export declare function isReachable(rel: string, refs: AssetRefs): boolean;
/**
 * The files of a `deploy/` listing a published version freezes: the generated subtrees whole, plus
 * every other file or folder `bundle` names, and what a kept descriptor among those names in turn.
 */
export declare function versionFiles(
	rels: readonly string[],
	bundle: unknown,
	readText: (rel: string) => Promise<string | null>,
): Promise<string[]>;
