/**
 * The rules for reading a spine node's `assetKey` as an R2 bundle ADDRESS.
 *
 * Dependency-free on purpose (type-only imports, erased at runtime) so
 * `spineBundleKey.fixture.ts` can run these assertions under plain `node` — this app's
 * `build` is a bare `vite build` that strips types without checking them, so a green build
 * proves nothing here (same reasoning as `pickSheets.fixture.ts`).
 *
 * What it pins is the invariant behind "the free-spin cage is missing": a shared component
 * def held `invisible_wall/bookofborutremake/spines/R_Cage_Freespin/`, and a shared def is
 * resolved by EVERY project. `bundleFromAssetKey` answers "which bundle of MINE is this", so
 * for every other project that key is `null` — `exportSpineBundle` copies nothing into
 * `deploy/` while `resolveSpineKeysForGame`, skipping on the SAME condition, leaves the
 * prefix in the doc as the runtime lookup key. Export nothing, look up something.
 */
import type { ComponentParam, LayoutNode } from 'engine-layout';

/**
 * One path segment of a spine bundle folder. Bundles can be NESTED (`loader/sub`), and folder
 * names are legitimately camelCase (`foregroundAnimation`, `fsIntro`). Exported so
 * `projectPaths.ts#assertBundle` — which writes the paths this module reads back — validates
 * against the SAME rule rather than a second copy of it; the two are inverses, and the one
 * lesson this repo keeps re-learning is that a duplicated allowlist drifts in silence.
 *
 * It is also what keeps a FILE path from parsing as a bundle address: no segment may contain a
 * dot, so `…/spines/R_Plus/R_Plus.atlas` is rejected while `…/spines/loader/sub/` is not.
 */
export const BUNDLE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A spine `assetKey` that ADDRESSES an R2 bundle, parsed into its owner + bundle name. */
export interface SpineBundleRef {
	/** The cross-project `_shared/spines/` library rather than one project's root. */
	shared: boolean;
	/** R2 client/project path segments — absent for a shared bundle. */
	client?: string;
	project?: string;
	bundle: string;
}

/**
 * Parse a spine `assetKey` that is an R2 bundle PREFIX, whoever owns it — the inverse of
 * `SUB.spines` / `sharedSpinesPrefix`, and deliberately wider than `bundleFromAssetKey`,
 * which can only name a bundle the READING project can resolve.
 *
 * That difference is the whole point: a key this parses but `bundleFromAssetKey` rejects is
 * a reference into someone else's project — never a coded/game-bundled key like `bigwin`,
 * which has no `spines/` path at all. So it is exactly the set the export must report as
 * stranded and the authoring side must not persist.
 */
export function parseSpineBundleKey(assetKey: string): SpineBundleRef | null {
	const trimmed = assetKey.endsWith('/') ? assetKey.slice(0, -1) : assetKey;
	const match = /^(?:_shared|([^/]+)\/([^/]+))\/spines\/(.+)$/.exec(trimmed);
	if (!match) return null;
	const [, client, project, bundle] = match;
	if (!bundle.split('/').every((segment) => BUNDLE_SEGMENT_RE.test(segment))) return null;
	return client ? { shared: false, client, project, bundle } : { shared: true, bundle };
}

/**
 * Whether a spine node's STATIC `assetKey` can ever be the key the game looks up.
 *
 * `LayoutNodeView` prefers the value of the param the node binds `assetKey` to and falls back
 * to the static key only when that value is empty — and `resolveComponentParams` seeds every
 * param from its def default, so a binding whose param declares a non-empty default makes the
 * static key UNREACHABLE. That is not a nicety: `Button_Square`'s pinned v11 snapshot is
 * immutable and still carries a foreign prefix on a node bound to `rspinbuttonnewSpine`
 * (default `R_SpinButtonNew`), so reporting it would warn on every publish about art that is
 * never requested. A binding with NO default is the opposite case — any instance that leaves
 * the param unset really does fall through to the static key, so it stays reportable.
 */
export function staticSpineKeyIsReachable(
	node: LayoutNode,
	params: readonly ComponentParam[] | undefined,
): boolean {
	if (node.kind !== 'spine') return false;
	const boundParam = node.paramBindings?.assetKey;
	if (!boundParam) return true;
	return !(params ?? []).some(
		(p) => p.key === boundParam && typeof p.default === 'string' && p.default !== '',
	);
}

/** A spine node whose `assetKey` addresses a bundle outside `own` and outside `_shared/`. */
export interface ForeignSpineRef {
	nodeId: string;
	assetKey: string;
	/** Bundle name, for looking it up in the shared library. */
	bundle: string;
	/** `assetKey` is driven by a `spine`-kind param, so the static key is only a fallback. */
	bound: boolean;
}

/**
 * Every spine node in `root` whose `assetKey` names a bundle under a project other than
 * `own`. `_shared/spines/` is never foreign — that IS the supported way to borrow a bundle
 * across projects, and what `sharedSpinePromote` copies into. A bare/coded key parses to
 * nothing and is left alone.
 *
 * `own` is `undefined` for a SHARED-scope def, which owns no project root, so every
 * project-rooted key is foreign to it. Both segments are compared because `SUB.spines` roots
 * at `<client>/<project>`: matching on the project alone would pass
 * `otherclient/<sameproject>/spines/x/`, which `bundleFromAssetKey` still cannot resolve.
 */
export function foreignSpineRefs(
	root: LayoutNode,
	own: { client: string; project: string } | undefined,
): ForeignSpineRef[] {
	const out: ForeignSpineRef[] = [];
	const visit = (node: LayoutNode): void => {
		if (node.kind === 'spine' && typeof node.assetKey === 'string' && node.assetKey) {
			const ref = parseSpineBundleKey(node.assetKey);
			const isOwn = own && ref?.client === own.client && ref?.project === own.project;
			if (ref && !ref.shared && !isOwn) {
				out.push({
					nodeId: node.id,
					assetKey: node.assetKey,
					bundle: ref.bundle,
					bound: Boolean(node.paramBindings?.assetKey),
				});
			}
		}
		if (node.kind === 'container') for (const child of node.children) visit(child);
	};
	visit(root);
	return out;
}
