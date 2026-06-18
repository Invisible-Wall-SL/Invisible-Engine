// Frames — the typed, first-class form of the legacy `Scene.space` enum. A frame
// is a named layout box; every scene on the same frame is reparented into ONE
// `<MainContainer>` (one resolved layout) so they move + resize as one. This
// module is the SINGLE place that maps a scene → its frame, called by both the
// runtime `<LayoutScene>` walk and the editor preview so framing never diverges.
// Pure TS (no Svelte / no live layout context) — see docs/design/invisible-editor.md §23.

import { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';

import type { Frame, LayoutDoc, LayoutType } from './types';

type SizesMap = Record<LayoutType, { width: number; height: number }>;

export type BuiltinFrameId = 'game' | 'standard' | 'canvas' | 'background';

/**
 * The four built-in frames — the typed form of today's `Scene.space` values.
 * `game` carries no `sizes`, so it inherits the doc's `mainSizesMap` (the play
 * area); `standard` pins the HUD design box. Resolving a legacy `space` scene
 * through these yields byte-identical framing to the pre-frames `<LayoutScene>`
 * switch (`main` → `<MainContainer>`, `standard` → `<MainContainer standard>`,
 * `canvas`/`background` → no wrapper).
 */
export const BUILTIN_FRAMES: Record<BuiltinFrameId, Frame> = {
	game: { id: 'game', name: 'Game', kind: 'main' },
	standard: {
		id: 'standard',
		name: 'Standard (HUD)',
		kind: 'main',
		sizes: STANDARD_MAIN_SIZES_MAP,
	},
	canvas: { id: 'canvas', name: 'Canvas', kind: 'canvas' },
	background: { id: 'background', name: 'Background', kind: 'background' },
};

export const isBuiltinFrameId = (id: string): id is BuiltinFrameId =>
	id === 'game' || id === 'standard' || id === 'canvas' || id === 'background';

/**
 * A scene's effective frame id: explicit `frame` wins, else the legacy `space`
 * (whose values ARE the built-in frame ids), else `game`. The narrow input type
 * (not the full `Scene`) keeps this callable from anywhere holding the two
 * fields.
 */
export const sceneFrameId = (scene: { frame?: string; space?: string }): string =>
	scene.frame ?? scene.space ?? 'game';

/**
 * Resolve the {@link Frame} a scene renders into. Built-in ids are reserved and
 * always win (a `doc.frames` entry can't shadow the core `game` frame); a custom
 * id resolves from `doc.frames`; an unknown id falls back to `game` so a dangling
 * reference can never break render. Pure + total — for any legacy scene (no
 * `frame`) this returns the exact frame matching today's wrapper, which is the
 * step-1 parity guarantee.
 */
export const resolveFrame = (
	doc: Pick<LayoutDoc, 'frames'>,
	scene: { frame?: string; space?: string },
): Frame => {
	const id = sceneFrameId(scene);
	if (isBuiltinFrameId(id)) return BUILTIN_FRAMES[id];
	const custom = doc.frames?.find((f) => f.id === id);
	if (custom) return custom;
	return BUILTIN_FRAMES.game;
};

/**
 * The per-`LayoutType` design box a `kind: 'main'` frame scales to: its own
 * `sizes` when set, else the doc's `mainSizesMap`. (Meaningless for
 * canvas/background frames — they don't use a `<MainContainer>` box.) This is the
 * seam step 2 feeds into a frame-parametrised `createMainLayout`.
 */
export const frameSizes = (frame: Frame, mainSizesMap: SizesMap): SizesMap =>
	frame.sizes ?? mainSizesMap;
