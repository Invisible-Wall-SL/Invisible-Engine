import {
	authoredWinStatus,
	resolveAuthoredOverlays,
	resolveWinText,
	transitionCueStatus,
	winTierModeCaptions,
	type AuthoredFreeSpinsStatus,
	type AuthoredTransitionStatus,
	type AuthoredWinStatus,
	type AuthoredWinTier,
	type LayoutDoc,
	type LayoutNode,
	type TransitionCueStatus,
} from 'engine-layout';
import type { CustomElementFxKind } from 'constants-shared/elementFx';
import type { WinTextDoc } from 'engine-layout';
// Deep imports of engine-game's PURE tier modules: its index re-exports Svelte components, which
// the launcher's server must not load. Both files are Svelte- and Pixi-free.
import { authoredWinTierClips } from 'engine-game/src/game/winPresentation';
import { winLevelMap, type WinLevelData } from 'engine-game/src/game/winLevelMap';
import { resolveWinLevels, type GameConfigDoc } from 'game-config';

/**
 * THE AUTHORED WIN'S TIERS, launcher side (Rive plan Phase 8b): the plain-data input of
 * `authoredWinStatus` — the ONE rule the game's flip and the Game Maker chips share — built here
 * from what the game builds it from at boot (`apps/lines/src/game/authoredWin.svelte.ts`
 * `authoredWinTiers`), through the same pure engine functions:
 *  - the active big tiers: the config's `winLevels` big rows when it authors tiers
 *    (`resolveWinLevels`, as the engine's `activeBigTiers`), else the coded `winLevelMap` ladder,
 *    ascending by threshold; a tier that resolves to no animation presents as a plain number and is
 *    not a tier of the presentation (`authoredWinTierClips` ⇒ undefined), on both sides;
 *  - the rig and count slot each tier resolves to: the placed `win` instance's params — the first
 *    `componentInstance(win)` of the layout doc, scenes then container children, as
 *    `bakedWinPresentationParams` finds it — through `resolveTierPresentation`'s precedence;
 *  - the caption: the base game's Win Text `winLevels.<alias>` through `resolveWinText`, and every
 *    spins mode's own where it differs (`winTierModeCaptions`), as the coded caption follows the
 *    mode on top.
 */

/** The published `win` instance params: the first placed instance's, `{}` when none is placed. */
export function winPresentationParamsOf(doc: Pick<LayoutDoc, 'scenes'>): Record<string, unknown> {
	const find = (nodes: readonly LayoutNode[]): Record<string, unknown> | undefined => {
		for (const node of nodes) {
			if (node.kind === 'componentInstance' && node.componentId === 'win') return node.params ?? {};
			if (node.kind === 'container') {
				const hit = find(node.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	for (const scene of doc.scenes) {
		const hit = find(scene.nodes);
		if (hit) return hit;
	}
	return {};
}

/** The big tiers as the engine presents them: the authored ladder's, else the coded table's. */
function activeBigTierData(config: GameConfigDoc | null): WinLevelData[] {
	const authored = config ? resolveWinLevels(config) : undefined;
	const data: WinLevelData[] = authored
		? authored
				.filter((tier) => tier.type === 'big')
				.map((tier) => ({
					level: tier.level,
					alias: tier.alias,
					type: tier.type,
					threshold: tier.threshold,
					text: tier.name || null,
					presentDuration: tier.durationMs ?? 0,
					sound: { sfx: tier.sound?.sfx, bgm: tier.sound?.bgm },
					animation: tier.animation,
					spineKey: tier.spineKey,
				}))
		: Object.values(winLevelMap).filter((tier) => tier.type === 'big');
	return data.slice().sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));
}

export function authoredWinTiersFor(input: {
	config: GameConfigDoc | null;
	layout: Pick<LayoutDoc, 'scenes'>;
	winText: WinTextDoc | undefined;
}): AuthoredWinTier[] {
	const params = winPresentationParamsOf(input.layout);
	const captions = resolveWinText(input.winText).winLevels;
	const out: AuthoredWinTier[] = [];
	for (const data of activeBigTierData(input.config)) {
		const clips = authoredWinTierClips(params, data);
		if (!clips) continue;
		const caption = captions[clips.alias];
		const modeCaptions = winTierModeCaptions(input.winText, clips.alias);
		out.push({
			alias: clips.alias,
			rigKey: clips.rigKey,
			slotName: clips.slotName,
			...(typeof caption === 'string' && caption.length > 0 ? { caption } : {}),
			...(modeCaptions ? { modeCaptions } : {}),
		});
	}
	return out;
}

/**
 * The authored-overlay chips' statuses for a project, read by the SAME resolution the game boots
 * with (`resolveAuthoredOverlays`: Transition, then the Win, then the free spins, each on the doc
 * the swaps before it produced), so a chip never reports a status read on a different doc. The
 * `transition` cue's row (Invisible Shader Graph 8e) is judged by the game's rule against the
 * project's compiled shader effects (`registered`); none given ⇒ every custom kind is unregistered.
 */
export function authoredOverlayChips(
	layout: LayoutDoc,
	config: GameConfigDoc | null,
	winText: WinTextDoc | undefined,
	registered: (kind: CustomElementFxKind) => boolean = () => false,
): {
	authoredTransition: AuthoredTransitionStatus;
	transitionCue: TransitionCueStatus;
	authoredWin: AuthoredWinStatus;
	authoredFreeSpins: AuthoredFreeSpinsStatus;
} {
	const tiers = authoredWinTiersFor({ config, layout, winText });
	const resolved = resolveAuthoredOverlays(layout, {
		status: (doc) => authoredWinStatus({ doc, tiers }),
		transitionCue: transitionCueStatus(layout, registered),
	});
	return {
		authoredTransition: resolved.transition,
		transitionCue: resolved.transitionCue,
		authoredWin: resolved.win,
		authoredFreeSpins: resolved.freeSpins,
	};
}
