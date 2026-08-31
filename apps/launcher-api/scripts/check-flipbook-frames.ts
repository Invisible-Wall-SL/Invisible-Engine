/**
 * Guard the launcher preview's clip frame GEOMETRY, offline.
 *
 * Run: `pnpm --filter launcher-api run check:flipbook-frames`
 *
 * WHY. `clipToTextures` is the one place a rig-bound flipbook's pixels are CUT rather than looked
 * up: the game resolves frames out of `loadedAssets` (textures the loader already built), while the
 * Rigger/Symbols overlay has an atlas page plus a list of rects. Every geometry rule the loader
 * applies has to be re-applied here, and each has a silent failure mode:
 *
 *  - **atlas rotation** — a frame packed sideways drawn upright is 90° wrong, once, mid-animation;
 *  - **trim** — frames of one animation are trimmed to DIFFERENT rects, so a dropped trim offset
 *    makes the art jump around its own origin frame to frame;
 *  - **the clip's box** — what stops it changing scale between frames at all;
 *  - **the direction walk** — the preview showing a different frame than the game at the same beat.
 *
 * None of those throw. They just look slightly wrong in a preview nobody diffs against the game,
 * which is why they are asserted here rather than left to be noticed.
 *
 * The page image is never fetched: the `sourceCache` is pre-seeded with the page URL, so
 * `loadPageSource` returns the stub and the whole thing runs headless.
 */
import { Rectangle, TextureSource, type Texture } from 'pixi.js';

import { clipToTextures, type OverlayClip } from '../src/lib/fx/flipbookFrames.client';
import type { ResolvedArt } from '../src/lib/fx/effectEmitter.client';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const rect = (r: Rectangle | null | undefined): string =>
	r ? `${r.x},${r.y},${r.width},${r.height}` : 'none';
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(`${name} (got ${JSON.stringify(actual)})`, actual === expected);

const PAGE = 'client/project/sheets/a.json';
const PAGE_URL = `/api/editor/asset?key=${encodeURIComponent('page.png')}`;

/** Two sheets, so the multi-sheet (`<assetKey>::<region>`) path is exercised too. */
const SHEETS: Record<string, ResolvedArt> = {
	[PAGE]: {
		pageUrl: PAGE_URL,
		pageWidth: 512,
		pageHeight: 512,
		regions: [
			// Plain: untrimmed, unrotated.
			{ name: 'f0', x: 10, y: 20, w: 40, h: 30 },
			// ROTATED: `w`/`h` are the UPRIGHT size, so the on-page rect is (h × w).
			{ name: 'f1', x: 100, y: 200, w: 40, h: 30, rotated: true },
			// TRIMMED: the art is 40×30 sitting at (5,7) inside a declared 60×50 box.
			{ name: 'f2', x: 0, y: 0, w: 40, h: 30, offX: 5, offY: 7, origW: 60, origH: 50 },
		] as ResolvedArt['regions'],
	},
	'client/project/sheets/b.json': {
		pageUrl: PAGE_URL,
		pageWidth: 256,
		pageHeight: 256,
		regions: [{ name: 'f0', x: 1, y: 2, w: 8, h: 9 }] as ResolvedArt['regions'],
	},
};

const resolveArt = async (key: string): Promise<ResolvedArt | null> => SHEETS[key] ?? null;
const cache = new Map<string, TextureSource>([[PAGE_URL, new TextureSource()]]);

const cut = (clip: Partial<OverlayClip> & { frames: string[] }): Promise<Texture[]> =>
	clipToTextures({ id: 'c', assetKey: PAGE, ...clip } as OverlayClip, resolveArt, cache);

const run = async (): Promise<void> => {
	// ── 1. an unrotated, untrimmed frame is its own rect ─────────────────────────────────────────
	const [plain] = await cut({ frames: ['f0'] });
	eq('plain: page frame is the rect as packed', rect(plain?.frame), '10,20,40,30');
	eq('plain: rotate 0', plain?.rotate, 0);
	eq('plain: orig is the upright size', rect(plain?.orig), '0,0,40,30');
	eq('plain: trim covers the whole box', rect(plain?.trim), '0,0,40,30');

	// ── 2. a ROTATED frame: swapped page rect + PIXI's groupD8 90° ───────────────────────────────
	const [rot] = await cut({ frames: ['f1'] });
	// The single assertion that catches a sideways frame: on-page is (h × w), not (w × h).
	eq('rotated: page frame is swapped to (h × w)', rect(rot?.frame), '100,200,30,40');
	eq('rotated: rotate 2 (the TexturePacker 90°)', rot?.rotate, 2);
	eq('rotated: orig stays UPRIGHT', rect(rot?.orig), '0,0,40,30');

	// ── 3. a TRIMMED frame keeps its offset inside its declared box ──────────────────────────────
	const [trimmed] = await cut({ frames: ['f2'] });
	eq('trimmed: orig is the DECLARED box', rect(trimmed?.orig), '0,0,60,50');
	eq('trimmed: trim is the art at its offset', rect(trimmed?.trim), '5,7,40,30');

	// ── 4. the clip's BOX re-states every frame, so a clip stops changing size between frames ────
	// `applyClipBounds`: the box becomes `orig`, and the art is re-based from the frame's own centre
	// onto the box's top-left. For `f2` (box 60×50, art 40×30 at (5,7)) with a centred 100×100 clip
	// box (`x = -50`), the art lands at (5 − 30 + 50, 7 − 25 + 50) = (25, 32).
	const [boxed] = await cut({ frames: ['f2'], bounds: { x: -50, y: -50, w: 100, h: 100 } });
	eq('boxed: orig IS the clip box', rect(boxed?.orig), '0,0,100,100');
	eq('boxed: art re-based onto the box', rect(boxed?.trim), '25,32,40,30');
	// Two differently-packed frames under one box must report the SAME size — that is the whole
	// point of a box, and the thing a per-frame fit gets wrong.
	const sized = await cut({ frames: ['f0', 'f2'], bounds: { x: -50, y: -50, w: 100, h: 100 } });
	check(
		'boxed: every frame reports one size',
		sized.length === 2 && sized.every((t) => t.width === 100 && t.height === 100),
	);

	// ── 5. the direction WALK — the texture array IS the playback order ──────────────────────────
	const fwd = await cut({ frames: ['f0', 'f1', 'f2'] });
	eq('forward: 3 frames', fwd.length, 3);
	eq('forward: in authored order', fwd.map((t) => t.label).join(','), 'f0,f1,f2');
	const rev = await cut({ frames: ['f0', 'f1', 'f2'], direction: 'reverse' });
	eq('reverse: walked backwards', rev.map((t) => t.label).join(','), 'f2,f1,f0');
	const ping = await cut({ frames: ['f0', 'f1', 'f2'], direction: 'pingpong' });
	// 2n−2 frames, and the turnaround frames are NOT repeated.
	eq('pingpong: 2n−2 frames', ping.length, 4);
	eq(
		'pingpong: comes back through the interior',
		ping.map((t) => t.label).join(','),
		'f0,f1,f2,f1',
	);
	// Resolution runs once per AUTHORED frame, so a ping-pong reuses the texture object.
	check('pingpong: reuses the texture object', ping[1] === ping[3]);

	// ── 6. multi-sheet clips + honest gaps ───────────────────────────────────────────────────────
	// A real multipacked export interleaves one animation across pages, so a scoped frame must
	// resolve against ITS OWN sheet — not the clip's primary, where the same bare name exists.
	const spanning = await cut({ frames: ['f0', 'client/project/sheets/b.json::f0'] });
	eq('multi-sheet: both frames resolve', spanning.length, 2);
	eq('multi-sheet: the scoped frame came from ITS sheet', rect(spanning[1]?.frame), '1,2,8,9');
	// A missing frame is DROPPED, never substituted — there is no whole-sheet fallback, because for
	// an ordered animation that renders a scramble of unrelated art instead of an honest gap.
	const gappy = await cut({ frames: ['f0', 'nope', 'f2'] });
	eq('missing frame is dropped, not substituted', gappy.length, 2);
	eq('unknown sheet resolves nothing', (await cut({ frames: ['x/y.json::f0'] })).length, 0);
	eq('an empty clip cuts nothing', (await cut({ frames: [] })).length, 0);

	if (fails > 0) {
		console.error(`\n${fails} check(s) failed.`);
		process.exit(1);
	}
	console.log('flipbook frames: all checks passed');
};

void run();
