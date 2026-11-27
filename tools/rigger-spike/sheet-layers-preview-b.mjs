// 🗺 From my sheet — `sheet-layers-preview.mjs`'s second half (docs/design/frame-to-rig.md §13.1e): its
// cases with a forearm prop, a finger or a prop placed anew, and their planted mutants, on the same
// fixture and shipped code. A check of its own so each half stays well inside check:all's five
// minutes; the guard, the cases and the mutants are written there.
//   node tools/rigger-spike/sheet-layers-preview-b.mjs [--no-mutants]
process.argv.push('--part', 'b');
await import('./sheet-layers-preview.mjs');
