// 🗺 From my sheet — the gate's second check (docs/design/frame-to-rig.md §13): `sheet-rig.mjs`'s
// guards for the sheet arranged on the canvas as the F2 fixture's frame (arrange, frame joints) and for
// the owner's sheet shape (partialface, proportions, headturn, faceturn, draworder), each with its
// planted mutants, on the same fixture and shipped code. Split from `sheet-rig.mjs` so each check
// stays well inside CI's 300 s; the guards, the fixture and the mutants are written there.
//   node tools/rigger-spike/sheet-rig-arranged.mjs [--only <guard>] [--no-mutants] [--mutants <guard>]
process.argv.push('--part', 'arranged');
await import('./sheet-rig.mjs');
