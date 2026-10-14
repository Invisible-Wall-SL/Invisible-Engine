import { WIN_PRESENTATION_DEFAULTS } from 'engine-layout';

import { tierHasExit, type TierAnimationMap } from './winEscalation';
import type { WinLevelData } from './winLevelMap';

/**
 * WIN TIER PRESENTATION — which rig, slot and clips a tier plays, from the `win` component's
 * params. PURE: the coded `WinVisual` reads its live params through it, and the authored
 * presentation (Rive plan Phase 8b) generates its per-tier timelines from the same answer, so the
 * two can never name different clips.
 *
 * Per field: the PER-TIER value (`<alias>Spine` / `<alias>Slot` / `<alias>Intro|Idle|Outro`) ?? the
 * SHARED set (`winSpine` / `slotName` / `introAnimation` / `idleAnimation` / `exitAnimation`) ?? the
 * config / coded tier's own value (`spineKey`, `animation`). Every param empty ⇒ the coded value
 * (parity). A tier with no animation anywhere ⇒ `animationMap: undefined` (a small / medium tier
 * presents as a plain number).
 */
export type TierPresentation = {
	rigKey: string;
	slotName: string;
	animationMap?: TierAnimationMap;
};

export { WIN_PRESENTATION_DEFAULTS };

const stringParam = (params: Record<string, unknown>, key: string): string | undefined => {
	const value = params[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export function resolveTierPresentation(
	params: Record<string, unknown>,
	data: WinLevelData,
	defaults: { winSpine: string; slotName: string } = WIN_PRESENTATION_DEFAULTS,
): TierPresentation {
	const p = (key: string) => stringParam(params, key);
	const alias = data.alias;
	const conv = data.animation;
	const rig = p(`${alias}Spine`) ?? data.spineKey ?? p('winSpine') ?? defaults.winSpine;
	const slotName = p(`${alias}Slot`) ?? p('slotName') ?? defaults.slotName;
	const intro = p(`${alias}Intro`) ?? p('introAnimation') ?? conv?.intro;
	const idle = p(`${alias}Idle`) ?? p('idleAnimation') ?? conv?.idle;
	const outro = p(`${alias}Outro`) ?? p('exitAnimation') ?? conv?.outro;
	if (!intro && !idle && !outro) return { rigKey: rig, slotName };
	return {
		rigKey: rig,
		slotName,
		animationMap: { intro: intro ?? '', idle: idle ?? '', outro: outro ?? '' },
	};
}

/** One active big tier as the authored presentation needs it: its clips (the exit only when it IS one). */
export interface AuthoredWinTierClips {
	alias: string;
	rigKey: string;
	slotName: string;
	intro: string;
	idle: string;
	outro?: string;
}

/** The authored presentation's view of a tier, or `undefined` for a tier with no animation. */
export function authoredWinTierClips(
	params: Record<string, unknown>,
	data: WinLevelData,
): AuthoredWinTierClips | undefined {
	const pres = resolveTierPresentation(params, data);
	if (!pres.animationMap) return undefined;
	const map = pres.animationMap;
	return {
		alias: data.alias,
		rigKey: pres.rigKey,
		slotName: pres.slotName,
		intro: map.intro,
		idle: map.idle,
		...(tierHasExit(map) ? { outro: map.outro } : {}),
	};
}
