// Offline fixture: the Scene Editor's spine dropdowns follow the ACTIVE ratio's component params.
//
//   node scripts/verify-editor-ratio-spine-params.mjs
//
// A placed component's effective params in a ratio are its base `params` with
// `overrides[layoutType].params` on top — the canvas draws that (`resolveLayoutInstanceParams`).
// The Properties panel picks the rig whose animation / skin / slot / bone names its dropdowns list
// through three resolvers (`primarySpineBundle`, `effectiveSpineBundle`, `instanceSpineBoundName`).
// When they read the BASE `params` only, an author who swapped the rig for portrait and switched the
// canvas to portrait was offered the landscape rig's animations — a name the portrait rig may not
// have, which then plays nothing. The panel's own `instanceParamValue` already answers "what does
// this ratio set"; these checks hold the resolvers to it.
//
// HOW IT RUNS THE REAL SOURCE. `EditorProperties.svelte` is a runes component Node cannot import, so
// the four functions are SLICED out of its `<script>` by brace balance and compiled with the panel
// state they close over (`node`, `instanceComponent`, `isOverrideMode`, `layoutType`) as stubs. The
// stub set is type-checked before compiling (`stub-set-guard.mjs`), so a resolver that grows a new
// free name fails here by name instead of passing on a `ReferenceError` nobody reaches.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';
import { lfReaderFrom } from './lib/read-lf.mjs';
import { assertStubSetIsComplete } from './lib/stub-set-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'apps/launcher-api/src/routes/(app)/editor/EditorProperties.svelte';
const src = lfReaderFrom(ROOT)(SOURCE);

/** Index of the closer matching the opener at `open`. */
const matching = (text, open, opener, closer) => {
	let depth = 0;
	for (let i = open; i < text.length; i += 1) {
		if (text[i] === opener) depth += 1;
		else if (text[i] === closer && --depth === 0) return i;
	}
	throw new Error(`${SOURCE}: unbalanced ${opener}${closer}`);
};

/** `function <name>(…) { … }` from the component's script, as plain JS. */
const sliceFunction = (name) => {
	const start = src.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`${SOURCE} no longer defines ${name}()`);
	const open = src.indexOf('(', start);
	const close = matching(src, open, '(', ')');
	const bodyStart = src.indexOf('{', close);
	const bodyEnd = matching(src, bodyStart, '{', '}');
	return stripSliceTypes(`${SOURCE}#${name}`, src.slice(start, bodyEnd + 1));
};

const STUBS = ['node', 'instanceComponent', 'isOverrideMode', 'layoutType'];
const body = [
	...[
		'instanceParamValue',
		'primarySpineBundle',
		'effectiveSpineBundle',
		'instanceSpineBoundName',
	].map(sliceFunction),
	'return { primarySpineBundle, effectiveSpineBundle, instanceSpineBoundName };',
].join('\n');
assertStubSetIsComplete({ what: 'verify-editor-ratio-spine-params', body, stubNames: STUBS });
const compiled = compileSlice({
	what: 'verify-editor-ratio-spine-params / EditorProperties.svelte spine resolvers',
	names: STUBS,
	body,
});
/** The resolvers as the panel runs them with `node` selected on the canvas's `layoutType`. */
const panel = (node, def, layoutType) => compiled(node, def, layoutType !== 'desktop', layoutType);

let checks = 0;
let failures = 0;
const same = (label, got, want) => {
	checks += 1;
	if (got === want) return;
	failures += 1;
	console.log(`FAIL  ${label}  got=${got}  want=${want}`);
};

const rigDef = {
	params: [
		{ key: 'rig', kind: 'spine', default: 'defaultRig' },
		{ key: 'rigAnim', kind: 'spineAnimation', spineParam: 'rig' },
	],
};
const exposed = { kind: 'spine', id: 'sp', assetKey: 'static', paramBindings: { assetKey: 'rig' } };
const placed = {
	kind: 'componentInstance',
	id: 'i',
	componentId: 'c',
	params: { rig: 'landRig' },
	overrides: { portrait: { params: { rig: 'portRig' } }, tablet: { x: 4 } },
};
const resolved = (node, def, layoutType) => {
	const r = panel(node, def, layoutType);
	return [
		r.primarySpineBundle(),
		r.effectiveSpineBundle(def.params[1]),
		r.instanceSpineBoundName(exposed),
	];
};

for (const [layoutType, want, why] of [
	['desktop', 'landRig', 'the base ratio reads the base params'],
	['portrait', 'portRig', 'a ratio that swaps the rig lists the swapped rig'],
	['tablet', 'landRig', 'a ratio that patches other fields falls through to the base'],
	['landscape', 'landRig', 'a ratio with no patch at all falls through to the base'],
]) {
	const [primary, sibling, bound] = resolved(placed, rigDef, layoutType);
	same(`${layoutType}: ${why} — primarySpineBundle`, primary, want);
	same(`${layoutType}: ${why} — effectiveSpineBundle`, sibling, want);
	same(`${layoutType}: ${why} — instanceSpineBoundName`, bound, want);
}
same(
	'portrait: an unset rig still falls back to the def default',
	resolved({ ...placed, params: {}, overrides: {} }, rigDef, 'portrait')[1],
	'defaultRig',
);

// The win overlay's shape: a default-less per-tier spine falls back to the FIRST spine param, and
// that fallback must be the ratio's too.
const tierDef = {
	params: [
		{ key: 'winSpine', kind: 'spine' },
		{ key: 'tierSpine', kind: 'spine' },
		{ key: 'tierAnim', kind: 'spineAnimation', spineParam: 'tierSpine' },
	],
};
const overlay = {
	...placed,
	params: { winSpine: 'landWin' },
	overrides: { portrait: { params: { winSpine: 'portWin' } } },
};
same(
	'portrait: a default-less tier falls back to the ratio’s first spine',
	panel(overlay, tierDef, 'portrait').effectiveSpineBundle(tierDef.params[2]),
	'portWin',
);

console.log(
	failures === 0
		? `PASS — ${checks} checks: the spine dropdowns list the rig the active ratio renders.`
		: `${failures} of ${checks} checks FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
