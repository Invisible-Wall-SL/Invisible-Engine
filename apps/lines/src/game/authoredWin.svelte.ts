import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import {
	WIN_FADE_SIGNAL,
	WIN_HIDE_SIGNAL,
	WIN_PLAIN_SIGNAL,
	authoredWinStatus,
	registerGameTimelines,
	releaseCueHolds,
	winTierLoopSignal,
	winTierOutroSignal,
	winTierSignal,
	winTierTimelines,
	type AuthoredWinStatus,
	type AuthoredWinTier,
	type LayoutDoc,
	type ComponentDef,
	type SignalSource,
	type WinTierTimelineTier,
	winPresentationDef,
} from 'engine-layout';
import {
	authoredWinTierClips,
	eventSignal,
	manualSignal,
	type AuthoredWinTierClips,
	type ManualSignal,
	type WinLevelData,
	type WinWalkTier,
} from 'engine-game';

import { bakedCinematics } from '../editor-scenes';
import { boardWinText } from './boardWinText';
import {
	activeBigTiers,
	activeWinLevelByAlias,
	activeWinLevelChain,
	activeWinLevelData,
	winPresentationParams,
} from './gameConfig';
import { winState } from './winState.svelte';

/**
 * THE AUTHORED WIN, game side (Rive plan Phase 8b, `docs/design/rive-style-editor.md` §13.6): what
 * `apps/lines` feeds the pure engine pieces — the active big tiers as the authored presentation
 * sees them (the clips `resolveTierPresentation` picks off the published `win` params, the Win Text
 * caption), the per-tier signals the gate's conductor fires, and the per-tier timelines GENERATED
 * once the `bigwin` skeleton has loaded (clip lengths are read off it, never typed). Everything
 * here is inert until `Game.svelte` turns the path on for the boot (`authoredWinRuntime.on`).
 */

export const authoredWinRuntime = $state({
	/** The doc's flag resolved `ready` for this boot: the coded visual is retired, the conductor runs. */
	on: false,
	/** The generated timelines are registered (assets loaded), so the presentation may mount. */
	ready: false,
});

const captionFor = (alias: string): string | undefined => {
	const caption = boardWinText().winLevels[alias];
	return typeof caption === 'string' && caption.length > 0 ? caption : undefined;
};

/** Every active big tier that resolves to an animated presentation, with its clips and caption. */
export function authoredWinClips(): (AuthoredWinTierClips & { caption?: string })[] {
	const params = winPresentationParams();
	const out: (AuthoredWinTierClips & { caption?: string })[] = [];
	for (const { alias } of activeBigTiers()) {
		const data = activeWinLevelByAlias(alias);
		const clips = data ? authoredWinTierClips(params, data) : undefined;
		if (!clips) continue;
		const caption = captionFor(alias);
		out.push(caption ? { ...clips, caption } : clips);
	}
	return out;
}

/**
 * The `winPresentation` def for this boot — generated from the active big tiers (alias, name,
 * caption) exactly as the editor rebuilds `win` from the config's tiers, so the caption node's
 * `switchKeys` list every tier's Win Text key. Registered by the game only when the path is on.
 */
export function authoredWinDef(): ComponentDef {
	const names: Record<string, string> = Object.fromEntries(
		activeBigTiers().map((tier) => [tier.alias, tier.name]),
	);
	return winPresentationDef(
		authoredWinClips().map(({ alias, caption }) => ({
			alias,
			name: names[alias] ?? alias,
			...(caption ? { caption } : {}),
		})),
	);
}

/** The status rule's plain-data input: the tiers' rig, slot and caption. */
export function authoredWinTiers(): AuthoredWinTier[] {
	return authoredWinClips().map(({ alias, rigKey, slotName, caption }) => ({
		alias,
		rigKey,
		slotName,
		...(caption ? { caption } : {}),
	}));
}

/** What the flag does to this boot's doc — the ONE rule shared with the launcher. */
export function resolveAuthoredWinStatus(
	doc: Pick<LayoutDoc, 'scenes' | 'settings'>,
): AuthoredWinStatus {
	return authoredWinStatus({ doc, tiers: authoredWinTiers() });
}

// A plain record, not a Map: module state nothing renders from (the rune lint wants a SvelteMap
// for a Map in a `.svelte.ts` file, and reactivity here would be pure cost).
let signals: Record<string, ManualSignal> = {};

/**
 * The game-registered signals the conductor fires: `winTier.<alias>` / `winTierLoop.<alias>` /
 * `winTierOutro.<alias>` per active big tier, `winPlain`, `winFade` (the def's fade machine's show
 * trigger, fired by the gate where the coded container started its tween) and `winHide` off the
 * emitter event (the machine's hide trigger). The
 * tier signals SEED off `winState.authoredSignal` on subscribe, so a `winPresentation` instance that
 * mounts a frame after a fire plays the current phase.
 */
export function authoredWinSignals(
	subscribeWinHide: (run: () => void) => () => void,
): Record<string, SignalSource> {
	signals = {};
	const manual = (name: string): ManualSignal => {
		const signal = manualSignal(() => winState.authoredSignal === name);
		signals[name] = signal;
		return signal;
	};
	const out: Record<string, SignalSource> = {
		// Never seeded: a late subscriber plays its phase, not a fade already under way.
		[WIN_FADE_SIGNAL]: manualSignal(),
		[WIN_PLAIN_SIGNAL]: manual(WIN_PLAIN_SIGNAL),
		[WIN_HIDE_SIGNAL]: eventSignal((run) => subscribeWinHide(() => run())),
	};
	signals[WIN_FADE_SIGNAL] = out[WIN_FADE_SIGNAL] as ManualSignal;
	for (const { alias } of authoredWinClips()) {
		out[winTierSignal(alias)] = manual(winTierSignal(alias));
		out[winTierLoopSignal(alias)] = manual(winTierLoopSignal(alias));
		out[winTierOutroSignal(alias)] = manual(winTierOutroSignal(alias));
	}
	return out;
}

/** Fire a conductor signal: recorded as the current phase first, so a late subscriber is seeded. */
export function fireAuthoredWinSignal(signal: string): void {
	winState.authoredSignal = signal;
	signals[signal]?.fire();
}

/** The fade layer's show trigger (the def's `winFade` input); not a phase, never seeded. */
export function fireAuthoredWinFade(): void {
	signals[WIN_FADE_SIGNAL]?.fire();
}

/** The presentation is over (`winHide`): no phase is current. */
export function clearAuthoredWinSignal(): void {
	winState.authoredSignal = undefined;
}

type SkeletonDataLike = { animations?: { name: string; duration: number }[] };
const isSkeletonData = (v: unknown): v is SkeletonDataLike =>
	typeof v === 'object' && v !== null && Array.isArray((v as { animations?: unknown }).animations);
const rigBundleFolderOf = (key: string): string => {
	const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
	const m = trimmed.match(/(?:^|\/)spines\/(.+)$/);
	return m ? m[1] : trimmed;
};

/** Every clip of the loaded rig `assetKey`, name → ms — `rigClipMs`'s lookup, read whole. */
export function loadedRigClipMs(
	loaded: Record<string, unknown>,
	assetKey: string,
): Record<string, number> | undefined {
	let data: unknown = loaded[assetKey];
	if (!isSkeletonData(data)) {
		const hit = Object.keys(loaded).find((k) => rigBundleFolderOf(k) === assetKey);
		data = hit ? loaded[hit] : undefined;
	}
	if (!isSkeletonData(data)) return undefined;
	return Object.fromEntries(
		(data.animations ?? []).map((clip) => [clip.name, clip.duration * 1000]),
	);
}

/** The tiers as the generator takes them (alias, clips, caption). */
export function authoredWinTimelineTiers(): WinTierTimelineTier[] {
	return authoredWinClips().map(({ alias, intro, idle, outro, caption }) => ({
		alias,
		intro,
		idle,
		...(outro ? { outro } : {}),
		...(caption ? { caption } : {}),
	}));
}

/**
 * Generate and register the per-tier timelines from the loaded skeleton — built-ins, then these,
 * then the project's baked cinematics (a project timeline of the same id shadows a generated one).
 * Idempotent; `ready` flips once the rig the tiers play is loaded, and the presentation mounts then.
 */
export function registerAuthoredWinTimelines(loaded: Record<string, unknown>): void {
	if (authoredWinRuntime.ready) return;
	const tiers = authoredWinTimelineTiers();
	const rigKey = authoredWinClips()[0]?.rigKey;
	const clipMs = rigKey ? loadedRigClipMs(loaded, rigKey) : {};
	if (rigKey && !clipMs) {
		// Registered anyway, with no clip lengths: every walk is then length-less, holds nothing, and
		// the conductor falls through tier by tier (the no-art rule) instead of the presentation
		// never mounting and the gate waiting on a `ready` that never comes.
		console.warn(
			`[authoredWin] the tier rig "${rigKey}" is not among the loaded assets — the authored win ` +
				'presentation registers with no clip lengths; the tiers fall through and no rig is drawn.',
		);
	}
	registerGameTimelines(bakedCinematics(), winTierTimelines(tiers, clipMs ?? {}));
	authoredWinRuntime.ready = true;
}

/**
 * Drop every hold the presentation that just ended may have left: a `winHide` cuts a walk short
 * of its idle's end, and the hold it registered would otherwise sit in the map for the next win's
 * first read (and the probe's `holds`). The loop and plain signals hold nothing; released too, for
 * the shape to be total.
 */
export function releaseAuthoredWinHolds(): void {
	releaseCueHolds(WIN_PLAIN_SIGNAL);
	for (const { alias } of authoredWinClips()) {
		releaseCueHolds(winTierSignal(alias));
		releaseCueHolds(winTierLoopSignal(alias));
		releaseCueHolds(winTierOutroSignal(alias));
	}
}

/**
 * The walk for a winning `level`: the escalation chain when the config escalates (every tier with
 * an animated presentation, start → winning tier), else the single winning tier — or no tier at all
 * for a plain small / medium number. Mirrors `WinVisual`'s `escalationTiers` / `resolvedAnimationMap`.
 */
export function authoredWinWalkTiers(level: number): {
	tiers: WinWalkTier[];
	escalating: boolean;
} {
	const params = winPresentationParams();
	const toTier = (data: WinLevelData): WinWalkTier | undefined => {
		const clips = authoredWinTierClips(params, data);
		return clips
			? {
					alias: clips.alias,
					hasExit: !!clips.outro,
					boundaryAmount: (data.threshold ?? 0) * BOOK_AMOUNT_MULTIPLIER,
				}
			: undefined;
	};
	const chain = activeWinLevelChain(level);
	if (chain) {
		const tiers = chain.map(toTier).filter((tier): tier is WinWalkTier => !!tier);
		if (tiers.length) return { tiers, escalating: true };
	}
	const data = activeWinLevelData(level);
	const single = data ? toTier(data) : undefined;
	return { tiers: single ? [single] : [], escalating: false };
}
