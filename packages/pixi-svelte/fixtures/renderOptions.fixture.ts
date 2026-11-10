/**
 * Offline fixture for how the renderer is set up (`renderOptions.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/renderOptions.fixture.ts
 *
 * Pins: the test switches parse to exactly the one thing each names; the content scan finds a
 * backdrop-reading blend wherever it is stored (layout node, symbol layer, particle behaviour,
 * effect group, an array, an old numeric enum) and none in GPU-native modes, non-blend keys or a
 * cinematic track's animation `blend`; the back buffer stays on unless the content is known not to
 * need it AND the auto default is on, and a switch beats both; the canvas goes opaque only with a
 * solid backdrop and content known not to blend with it, cleared to that colour; the backdrop is the first opaque
 * ancestor colour, refused past an image or a translucent colour; an opaque canvas is refused when
 * anything but its ancestors is painted under it.
 */

import {
	AUTO_BACK_BUFFER,
	AUTO_OPAQUE,
	needsBackdropBlend,
	onlyAncestorsBelow,
	parseCssColor,
	readRenderSwitches,
	resolveRenderOptions,
	solidBackdrop,
} from '../src/lib/renderOptions.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Switches.
check('no query, no switches', same(readRenderSwitches(''), {}));
check(
	'each switch is read on its own',
	same(readRenderSwitches('?backbuffer=0&aa=1&opaque=1&fx=0&lazyresolve=0'), {
		backBuffer: false,
		antialias: true,
		opaque: true,
		elementFxFilters: false,
		lazyResolve: false,
	}),
);
check(
	'?fx=1 and ?lazyresolve=1 are not switches (on is the default)',
	same(readRenderSwitches('?fx=1&lazyresolve=1'), {}),
);
check('an unreadable value is ignored', same(readRenderSwitches('?backbuffer=maybe&aa='), {}));

// The content scan.
const node = (blendMode: unknown) => ({
	doc: { scenes: [{ nodes: [{ kind: 'sprite', blendMode }] }] },
});
check(
	'no blend anywhere',
	!needsBackdropBlend({ doc: { scenes: [{ nodes: [{ kind: 'sprite' }] }] } }),
);
for (const mode of ['normal', 'add', 'multiply', 'screen', 'ADD', 'additive', 0, 1, 2, 3])
	check(`GPU-native ${JSON.stringify(mode)} needs no backdrop`, !needsBackdropBlend(node(mode)));
for (const mode of ['overlay', 'lighten', 'soft-light', 'color-dodge', 'something-new', 6])
	check(`${JSON.stringify(mode)} needs the backdrop`, needsBackdropBlend(node(mode)));
check(
	'a symbol layer deep in the bundle',
	needsBackdropBlend({
		symbols: { WILD: { states: { win: { layers: [{ kind: 'fx', blendMode: 'overlay' }] } } } },
	}),
);
check(
	"a particle behaviour's config",
	needsBackdropBlend({
		effects: [
			{
				layers: [
					{ config: { behaviors: [{ type: 'blendMode', config: { blendMode: 'lighten' } }] } },
				],
			},
		],
	}),
);
check(
	'an effect blend group',
	!needsBackdropBlend({
		effects: [{ bake: { groups: [{ blendMode: 'add' }, { blendMode: 'normal' }] } }],
	}),
);
check('an array of modes', needsBackdropBlend({ blendModes: ['add', 'overlay'] }));
check(
	'a mode named as a string under another key is not a blend',
	!needsBackdropBlend({ category: 'overlay', name: 'lighten', kind: 'overlay' }),
);
check(
	"a cinematic track's animation blend is not a render blend",
	!needsBackdropBlend({
		cinematics: [{ tracks: [{ blend: 'replace', blendIn: 0, blendOut: 250 }] }],
	}),
);
const loop: Record<string, unknown> = { blendMode: 'add' };
loop.self = loop;
check('a cycle ends', !needsBackdropBlend(loop));

// The decision.
const base = { tierAntialias: true, switches: {}, needs: {} };
const o = (extra: object) => resolveRenderOptions({ ...base, ...extra });
check('unknown content keeps the back buffer', o({}).useBackBuffer);
check(
	'content that blends with the backdrop keeps it, even with the auto default',
	o({ needs: { backdropBlend: true }, autoBackBuffer: true }).useBackBuffer,
);
check(
	'known-clean content drops it only with the auto default',
	!o({ needs: { backdropBlend: false }, autoBackBuffer: true }).useBackBuffer &&
		o({ needs: { backdropBlend: false }, autoBackBuffer: false }).useBackBuffer,
);
check(
	`the shipped default leaves it ${AUTO_BACK_BUFFER ? 'off' : 'on'} for known-clean content`,
	o({ needs: { backdropBlend: false } }).useBackBuffer === !AUTO_BACK_BUFFER,
);
check(
	'?backbuffer= beats the content both ways',
	!o({ switches: { backBuffer: false }, needs: { backdropBlend: true } }).useBackBuffer &&
		o({ switches: { backBuffer: true }, needs: { backdropBlend: false }, autoBackBuffer: true })
			.useBackBuffer,
);
check('MSAA follows the tier', o({}).antialias && !o({ tierAntialias: false }).antialias);
check(
	'?aa= beats the tier and changes nothing else',
	!o({ switches: { antialias: false } }).antialias &&
		o({ switches: { antialias: false } }).useBackBuffer === o({}).useBackBuffer &&
		o({ tierAntialias: false, switches: { antialias: true } }).antialias,
);
check('transparent by default', !o({ backdrop: '#000000' }).opaque);
check(
	`the shipped default is ${AUTO_OPAQUE ? 'opaque on a solid backdrop' : 'transparent'}`,
	o({ backdrop: '#000000', needs: { backdropBlend: false }, autoBackBuffer: true }).opaque ===
		AUTO_OPAQUE,
);
check(
	'auto opaque needs a solid backdrop and content known not to blend with it',
	o({ backdrop: '#000000', needs: { backdropBlend: false }, autoOpaque: true }).opaque &&
		!o({ needs: { backdropBlend: false }, autoOpaque: true }).opaque &&
		!o({ backdrop: '#000000', autoOpaque: true }).opaque &&
		!o({ backdrop: '#000000', needs: { backdropBlend: true }, autoOpaque: true }).opaque,
);
check(
	'auto opaque is independent of the back buffer',
	o({ backdrop: '#000000', needs: { backdropBlend: false }, autoOpaque: true }).useBackBuffer &&
		o({
			backdrop: '#000000',
			needs: { backdropBlend: false },
			autoOpaque: true,
			autoBackBuffer: true,
		}).opaque,
);
const opaque = o({
	backdrop: '#102030',
	needs: { backdropBlend: false },
	autoBackBuffer: true,
	autoOpaque: true,
});
check(
	'an opaque canvas clears to the backdrop',
	opaque.background === '#102030',
	JSON.stringify(opaque),
);
check(
	'?opaque=1 with no known backdrop clears to black; ?opaque=0 refuses',
	o({ switches: { opaque: true } }).background === '#000000' &&
		!o({ switches: { opaque: false }, backdrop: '#000000', autoOpaque: true }).opaque,
);
check('a transparent canvas has no background', o({}).background === undefined);

// The backdrop.
check('rgb', same(parseCssColor('rgb(1, 2, 3)'), [1, 2, 3, 1]));
check('rgba', same(parseCssColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]));
check('space syntax', same(parseCssColor('rgb(1 2 3 / 50%)'), [1, 2, 3, 0.5]));
check('transparent', same(parseCssColor('transparent'), [0, 0, 0, 0]));
check('anything else is unknown', parseCssColor('color(display-p3 1 0 0)') === undefined);
const clear = { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none' };
check(
	'our shell: clear divs over a black body',
	solidBackdrop([
		clear,
		clear,
		{ backgroundColor: 'rgb(0, 0, 0)', backgroundImage: 'none' },
		clear,
	]) === '#000000',
);
check(
	'the nearest opaque colour wins',
	solidBackdrop([
		clear,
		{ backgroundColor: 'rgb(255, 128, 0)', backgroundImage: 'none' },
		{ backgroundColor: 'rgb(0, 0, 0)', backgroundImage: 'none' },
	]) === '#ff8000',
);
check(
	'an image on the way refuses',
	solidBackdrop([clear, { backgroundColor: 'rgb(0, 0, 0)', backgroundImage: 'url(a.png)' }]) ===
		undefined,
);
check(
	'a translucent colour refuses',
	solidBackdrop([{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backgroundImage: 'none' }]) === undefined,
);
check(
	'no colour at all refuses (the browser default shows)',
	solidBackdrop([clear, clear]) === undefined,
);

const canvas = {};
const wrap = {};
const body = {};
const html = {};
const theirs = {};
const hud = {};
const ancestors = new Set([wrap, body, html]);
check(
	'only ancestors under the canvas, a HUD over it',
	onlyAncestorsBelow(
		[
			[hud, canvas, wrap, body, html],
			[canvas, body, html],
		],
		canvas,
		ancestors,
	),
);
check(
	"an embedding page's canvas under ours refuses",
	!onlyAncestorsBelow([[canvas, theirs, body, html]], canvas, ancestors),
);
check(
	'a point where the canvas is not hit refuses',
	!onlyAncestorsBelow([[hud, body]], canvas, ancestors),
);

if (failures) throw new Error(`renderOptions fixture: ${failures} check(s) FAILED`);
console.log('\nrenderOptions fixture: ok');
