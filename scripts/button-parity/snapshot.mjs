// The button parity gate's two layout docs (Rive plan Phase 8d, `scripts/button-parity/run.mjs`):
// the `cg-lines` stand-in snapshot's bundle with its doc replaced by the `apps/lines` fallback shape —
// the parametric `HUD_BUTTON_INSTANCES` cluster — and the defs a publish would bake for it. `--images`
// gives every button `image*` state frames from the engine's own `reelsFrame` sheet (the spin button
// an asymmetric spinning frame, so its turn is in the pixels; no `imageDisabled`, so the grey is).
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/button-parity/snapshot.mjs \
//     --in <runtime.json> --out <runtime.json> [--images]

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { defaultLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';

const { values: opt } = parseArgs({
	options: {
		in: { type: 'string' },
		out: { type: 'string' },
		images: { type: 'boolean', default: false },
	},
});

/** Frames every `apps/lines` build loads (`reelsFrame`), one per state. */
const IMAGES = {
	image: 'Frame_FSCounter.png',
	imageHover: 'Frame_Multiplier.png',
	imagePressed: 'Frame_Tumble.png',
	imageSelected: 'Frame_TumbleWin.png',
};
const SPINNING = { imageSpinning: 'pressToContinueText_en.png' };

const withImages = (nodes) =>
	nodes.map((node) => {
		if (node.kind === 'container') return { ...node, children: withImages(node.children) };
		if (node.kind !== 'componentInstance' || node.componentId !== 'button') return node;
		const spin = node.params?.action === 'spin';
		return { ...node, params: { ...node.params, ...IMAGES, ...(spin ? SPINNING : {}) } };
	});

const bundle = JSON.parse(readFileSync(opt.in, 'utf8'));
const base = defaultLayout('lines', { buttons: true });
const doc = opt.images
	? { ...base, scenes: base.scenes.map((scene) => ({ ...scene, nodes: withImages(scene.nodes) })) }
	: base;
const builtins = Object.fromEntries(BUILTIN_COMPONENTS.map((def) => [def.id, def]));
const closure = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => builtins[id],
);
writeFileSync(
	opt.out,
	JSON.stringify({ ...bundle, doc, componentDefs: { ...bundle.componentDefs, ...closure } }),
);
