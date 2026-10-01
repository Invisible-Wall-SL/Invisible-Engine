/**
 * Invisible Flow v2 — the canvas type palette. Maps a `TypeRef` to a stable color +
 * a short human label, so a data pin's dot AND the data edge feeding it read the same
 * color (the type is legible from the wire alone). Mirrors the spike's type palette:
 * scalars get flat hues, `enum`/`struct` get nominal-distinct hues, `list<T>` inherits
 * its element color (a collection of the same thing).
 */

import type { NodeKind, TypeRef } from 'engine-flow-v2';

/**
 * Presentation LEAF node kinds an author drops directly. Unlike `showContainer`/`hideContainer`
 * (which reference a Scene-Editor scene projected from `doc.containers`) or the vocab-derived
 * event/action/cue entries, these carry their OWN content — so they have no ref and can't be
 * projected from anything; they're a fixed, hand-declared group like `CONTROL`. Kept here (beside
 * the type palette) so `AddNodePalette` renders the group from ONE list and a future presentation
 * kind is a single-line addition. Rendered right after the Containers section (their kin group).
 */
export const PRESENTATION_NODES: { kind: NodeKind; label: string }[] = [
	{ kind: 'textMessage', label: 'Text Message' },
	{ kind: 'playCinematic', label: 'Play Cinematic' },
];

/** The game-mode node kinds (`docs/design/hold-and-win.md` §4.5), the palette's Modes group. */
export const MODE_NODES: { kind: NodeKind; label: string }[] = [
	{ kind: 'modeTrigger', label: 'Mode trigger' },
	{ kind: 'allModesFinished', label: 'On all modes finished' },
	{ kind: 'enterMode', label: 'Enter mode' },
	{ kind: 'exitMode', label: 'Exit mode' },
];

/**
 * The mode id a mode node dropped into a section starts with: a Mode trigger and an Exit mode name
 * the open mode tab's own mode; Enter mode starts blank (entering the mode already playing merges
 * into it, so the author picks the next one).
 */
export const modeNodeRef = (kind: NodeKind, modeId: string | null): string | undefined =>
	modeId && (kind === 'modeTrigger' || kind === 'exitMode') ? modeId : undefined;

/** Whether `kind` may be offered in a section: `allModesFinished` never fires in a mode tab but the
 *  base game's (the validator's `mode-entry-scope`), so it is not offered there. */
export const offeredInSection = (kind: NodeKind, modeId: string | null): boolean =>
	kind !== 'allModesFinished' || modeId === null || modeId === 'basegame';

const SCALAR_COLOR: Record<string, string> = {
	int: '#38bdf8', // sky — a plain integer.
	ms: '#22d3ee', // cyan — milliseconds (kin to int, distinct so timing reads).
	float: '#818cf8', // indigo — a real number.
	bool: '#f472b6', // pink — a flag.
	string: '#a3e635', // lime — text.
	enum: '#fbbf24', // amber — a template enum (SymbolName).
	struct: '#fb923c', // orange — a template struct (Reel, Slot).
};

/** The wire/dot color for a data type. `list<T>` inherits its element type's color. */
export const typeColor = (t: TypeRef): string => {
	if (t.t === 'list') return typeColor(t.of);
	return SCALAR_COLOR[t.t] ?? '#94a3b8';
};

/** A short human label for a `TypeRef` (mirrors the validator's `typeName`). */
export const typeLabel = (t: TypeRef): string => {
	switch (t.t) {
		case 'enum':
			return t.name;
		case 'struct':
			return t.name;
		case 'list':
			return `${typeLabel(t.of)}[]`;
		default:
			return t.t;
	}
};
