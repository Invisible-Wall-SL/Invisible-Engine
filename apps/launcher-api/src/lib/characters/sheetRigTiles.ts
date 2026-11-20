import {
	resolveSheetRig,
	sheetDraw,
	sheetFacings,
	type ClipFacing,
	type ResolvedSheetRig,
	type SheetRigFrame,
} from 'engine-layout';
import { characterActionPlay, type CharacterSheet } from 'game-config';

import { rigSourceOf, type RigFactsByName } from './rigFacts';

/** One facing of the preview: what the game's resolver finds for it, or nothing. */
export interface SheetRigTile {
	facing: ClipFacing;
	found: ResolvedSheetRig | undefined;
	/** The animation's length; 0 for a pose of one key. */
	durationMs: number;
}

/** How long a one-shot rests on its last pose before the preview plays it again. */
export const RIG_REPLAY_REST_MS = 700;
/** How long an animation of no length is held when played once (the game's `CLIP_ONE_SHOT_MS`). */
const NO_LENGTH_MS = 1000;

/**
 * A sheet's action in every facing its view draws, clockwise from north, each through the game's
 * own resolver (`resolveSheetRig`) over the rigs the page has read: the rig, the animation, the
 * mirror and the skin are the game's answer, not the page's.
 */
export function sheetRigTiles(
	sheet: CharacterSheet,
	actionId: string,
	statuses: readonly string[],
	rigs: RigFactsByName,
): SheetRigTile[] {
	const source = rigSourceOf(rigs);
	return sheetFacings(sheet).map((facing) => {
		const found = resolveSheetRig(sheet, actionId, facing, statuses, source);
		return {
			facing,
			found,
			durationMs: found ? (source.durationMs(found.rig, found.animation) ?? 0) : 0,
		};
	});
}

/** Whether the preview loops `actionId`: an action played once is played, rested and replayed. */
export function sheetRigLoops(sheet: CharacterSheet, actionId: string): boolean {
	const action = sheet.actions?.find((a) => a.id === actionId);
	return !action || action.when === undefined || characterActionPlay(action) === 'loop';
}

/**
 * The frame a tile draws at `atMs` on the preview's clock, as the game's animator hands one to a
 * look: `play` counts the times a one-shot has started, so the look plays it again after its
 * length and a rest.
 */
export function sheetRigFrameAt(tile: SheetRigTile, loop: boolean, atMs: number): SheetRigFrame {
	const found = tile.found as ResolvedSheetRig;
	const turn = (tile.durationMs || NO_LENGTH_MS) + RIG_REPLAY_REST_MS;
	return {
		rig: found.rig,
		animation: found.animation,
		skin: found.skin,
		flipX: found.flipX,
		loop,
		play: loop ? 0 : Math.floor(Math.max(0, atMs) / turn),
		action: found.action,
		variant: found.variant,
	};
}

/** What a tile says under its facing. */
export function sheetRigCaption(tile: SheetRigTile, actionId: string): string {
	const { found, facing } = tile;
	if (!found) return '—';
	const standIn = found.action !== actionId ? `, standing in for ${actionId}` : '';
	const from = found.facing !== facing ? `, the ${found.facing} one` : '';
	return `${found.rig}: ${found.animation}${found.flipX ? ', mirrored' : ''}${from}${standIn}`;
}

/** The size of one tile: the sheet's box at `zoom`, with room around it for art that reaches
 *  outside, and where the character's place is in it. `aspect` is the rig box's height over its
 *  width (1 until a rig is loaded). */
export function sheetRigTileBox(
	sheet: CharacterSheet,
	zoom: number,
	aspect: number,
): { width: number; height: number; placeX: number; placeY: number } {
	const MAX = 420;
	const PAD = 10;
	const { width, anchorY } = sheetDraw(sheet);
	const w = Math.max(24, width * zoom);
	const h = w * (aspect > 0 ? aspect : 1);
	const tileW = Math.min(MAX, Math.ceil(w * 1.5) + PAD * 2);
	const tileH = Math.min(MAX, Math.ceil(h * 1.25) + PAD * 2);
	return {
		width: tileW,
		height: tileH,
		placeX: tileW / 2,
		placeY: Math.min(tileH - PAD, Math.round((tileH - h) / 2 + anchorY * h)),
	};
}
