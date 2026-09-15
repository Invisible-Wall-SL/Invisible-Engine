// Offline fixture for FLIPBOOK CLIP REACHABILITY in the editor-art export.
//
//   node scripts/verify-clip-reachability.mjs
//
// WHAT IT PROVES. `exportEditorArt` shipped a clip's atlas because the clip EXISTED, not
// because anything played it:
//
//     for (const clip of (await loadFlipbookDoc(...)).clips) {
//         for (const key of clipSheetKeys(clip)) refs.manifestKeys.add(key)
//
// So an orphaned clip dragged its whole sheet into every build. Measured on a real project:
// `F_Ocean` — 160 frames, referenced by NOTHING (scenes 0, componentDefs 0, flow 0) — shipped
// `S_Background` as an 8192×8192 page: an 80 MB PNG plus a 6.8 MB KTX2. And because 67 Mpix is
// ~6× the encoder's 11 Mpix cap, that page was downscaled to 40% linear, so the dead art also
// set the resolution ceiling for the shared page store it was deduplicated into.
//
// The walk is the load-bearing part, because a clip is named from at least four unrelated
// shapes and under-collecting drops art a game plays. Claims:
//
//   1. `collectClipIds` finds a clipId wherever it is nested — a layout node, a symbol CELL,
//      a symbol LAYER, an FX layer — because a per-schema reader is the copied-list mistake
//      this scaffold chain has already made twice.
//   2. An orphaned clip is NOT reachable, and a referenced one IS. This is the F_Ocean case.
//   3. Uncertainty never prunes: when reachability cannot be determined the export ships
//      every clip, because an unused clip costs bytes while a dropped one costs an animation.
//
// Asserted against the REAL source: `editorArtExport.ts` is a server module reaching R2 and a
// SvelteKit `$lib` alias, so it cannot be imported from plain Node. The walk itself is pure,
// so it is re-created here from the source text and exercised for real.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readLF(join(ROOT, 'apps/launcher-api/src/lib/server/editorArtExport.ts'));
const REACH = readLF(join(ROOT, 'apps/launcher-api/src/lib/server/clipReachability.ts'));
const CLIPS = readLF(join(ROOT, 'apps/launcher-api/src/lib/server/flipbookExport.ts'));

let checks = 0;
const fail = (m) => {
	console.error(`\n✗ ${m}\n`);
	process.exit(1);
};
const ok = (label, cond, detail = '') => {
	if (!cond) fail(`${label}${detail ? ` — ${detail}` : ''}`);
	checks++;
	console.log(`  ok ${label}`);
};

// The real `collectClipIds`, lifted from source and evaluated. Keeps the fixture honest: if
// the function is renamed or its shape changes, this fails rather than testing a stale copy.
const fnText = /export function collectClipIds\([\s\S]*?\n}/.exec(REACH);
ok('collectClipIds lives in the shared reachability module', Boolean(fnText));
const collectClipIds = new Function(
	`${fnText[0].replace(/^export /, '').replace(/: unknown|: Set<string>|: void|as Record<string, unknown>/g, '')}; return collectClipIds;`,
)();

console.log('1. the walk finds a clipId wherever it is nested');
const cases = [
	['a layout node', { scenes: [{ nodes: [{ type: 'flipbook', clipId: 'f_a' }] }] }, 'f_a'],
	['a symbol cell', { symbols: { M: { cells: [{ type: 'flipbook', clipId: 'f_b' }] } } }, 'f_b'],
	['a symbol layer', { symbols: { M: { layers: [{ clipId: 'f_c' }] } } }, 'f_c'],
	['an FX layer', { layers: [{ art: { clipId: 'f_d' } }] }, 'f_d'],
	['a flow node param', { nodes: [{ params: { clipId: 'f_e' } }] }, 'f_e'],
	['a RIG binding', { R_Lobster: [{ clipId: 'f_lobster', beat: 3 }] }, 'f_lobster'],
	['deep in an array-of-arrays', { a: [[[{ clipId: 'f_f' }]]] }, 'f_f'],
];
for (const [what, doc, expected] of cases) {
	const s = new Set();
	collectClipIds(doc, s);
	ok(`finds a clipId on ${what}`, s.has(expected), [...s].join(',') || '(none)');
}
const empty = new Set();
collectClipIds({ nothing: 'here', clip: 'not-a-clipId-field' }, empty);
ok('does not invent ids from a similarly-named field', empty.size === 0, [...empty].join(','));
collectClipIds(null, empty);
collectClipIds(undefined, empty);
ok('survives null/undefined', empty.size === 0);

console.log('2. the F_Ocean case: an orphaned clip is not reachable');
// Shaped like the real project: scenes reference OTHER background sheets, and the registry
// still holds a clip nothing plays.
const project = {
	doc: { scenes: [{ nodes: [{ clipId: 'f_used' }, { assetKey: '…/S_BackgroundWin.json' }] }] },
	defs: { c_x: { root: { assetKey: '…/S_Background3.json' } } },
	symbols: { symbols: { M: { cells: [{ type: 'sprite' }] } } },
};
const played = new Set();
for (const part of Object.values(project)) collectClipIds(part, played);
ok('the played clip is reachable', played.has('f_used'));
ok('the orphaned clip is NOT reachable', !played.has('f_ocean'), [...played].join(','));
ok('exactly one clip is reachable', played.size === 1, `${played.size}`);

console.log('3. the export prunes on reachability, and never on a guess');
ok(
	'the clip loop consults the reachable set',
	/const played = await collectPlayedClipIds\(/.test(SRC) &&
		/if \(played && !played\.has\(clip\.id\)\)/.test(SRC),
	'the loop must skip unreachable clips',
);
ok(
	'undetermined reachability returns null so everything ships',
	/return null;/.test(REACH) && /Promise<Set<string> \| null>/.test(REACH),
	'the uncertain case must not prune',
);
ok(
	'every authoring surface that can name a clip is walked',
	[
		'loadDoc',
		'listComponents',
		'loadSymbolsDoc',
		'listEffects',
		'loadFlowV2Doc',
		'exportRigFlipbooks',
	].every((s) => REACH.includes(s)),
	'missing one of: doc, defs, symbols, effects, flow, rig bindings — a rig can play a clip, ' +
		'and omitting it wrongly pruned f_lobster when this was run against a real project',
);
ok(
	'skipped clips are REPORTED, never silently dropped',
	/skipped \$\{skipped\.length\} unplayed flipbook clip/.test(SRC),
	'a silently smaller export is indistinguishable from a broken one',
);

console.log('4. BOTH exporters gate on it — the art and the registry must agree');
// THE claim this file exists for now. Gating the ART alone (#644) left a REGISTERED clip whose
// sheet was never exported, and the next bake refused exactly that: "1 flipbook clip(s) reference
// frames that NO shipped sheet packs". Gating one and not the other is worse than gating neither,
// because it turns a merely wasteful build into one that cannot be published at all.
ok(
	'the ART export consults reachability',
	/collectPlayedClipIds\(clientKey, projectKey, \{ doc, defs \}\)/.test(SRC),
	'editorArtExport must gate its sheets',
);
ok(
	'the CLIP REGISTRY export consults the same reachability',
	/collectPlayedClipIds\(clientKey, projectKey\)/.test(CLIPS) && /played\.has\(c\.id\)/.test(CLIPS),
	'flipbookExport must not ship a clip whose art the other exporter pruned',
);
ok(
	'both import the SAME module, so the two can never drift apart',
	SRC.includes("from './clipReachability'") && CLIPS.includes("from './clipReachability'"),
);
ok(
	'the registry export reports what it dropped too',
	/unplayed clip/.test(CLIPS),
	'a silently smaller registry is indistinguishable from a broken one',
);

console.log(`\nPASS — ${checks} checks.`);
