// The compiled Shader Graph effects the screen-transition variant of `run.mjs` ships in its
// bundles: a crossfade that reads both screens (Screens → From and To, mixed by progress), and the
// two halves of it on their own (From alone draws the frozen old screen, To alone the live new
// one), which give the variant its two screens at every captured frame. Run by `run.mjs` under
// `scripts/ts-loader.mjs`; prints the effects as JSON.

import { compileShaderEffect, graphBuilder } from '../../packages/engine-shadergraph/index.ts';

type Builder = ReturnType<typeof graphBuilder>;

const effect = (id: string, wire: (g: Builder, screens: string, output: string) => void) => {
	const g = graphBuilder({ id, name: id, phase: 'enter', durationMs: 1000 });
	const screens = g.node('screens');
	wire(g, screens, g.node('output'));
	const result = compileShaderEffect(g.doc());
	if (!result.ok) throw new Error(`${id}: ${result.issues.map((i) => i.message).join('; ')}`);
	return result.effect;
};

const effects = [
	effect('tp-crossfade', (g, screens, output) => {
		const mix = g.node('mix');
		g.wire(screens, 'from', mix, 'a');
		g.wire(screens, 'to', mix, 'b');
		g.wire(g.node('time'), 'progress', mix, 't');
		g.wire(mix, 'out', output, 'color');
	}),
	effect('tp-from', (g, screens, output) => g.wire(screens, 'from', output, 'color')),
	effect('tp-to', (g, screens, output) => g.wire(screens, 'to', output, 'color')),
];
process.stdout.write(JSON.stringify(effects));
