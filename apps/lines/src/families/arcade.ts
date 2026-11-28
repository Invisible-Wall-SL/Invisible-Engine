/**
 * The arcade seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the arcade
 * family — the play field and the online room it may join (`engine-rooms`, with `@colyseus/sdk`) —
 * and the only way it reaches that code. A build that leaves arcade out (`PUBLIC_IE_FAMILIES`,
 * `config-vite`) resolves this module to `off/arcade.ts` instead.
 */
import { ARCADE_LOOP_ACTIONS, ARCADE_VOCAB, type TemplateVocabulary } from 'engine-flow-v2';
import { registerBoundComponents, type BoundComponent } from 'engine-layout';
import { IsoWorld, PropGraphic, registerProjectedWorld } from 'engine-layout/svelte';
import { normalizeGameConfigDoc, usesSalmonsArt } from 'game-config';

import { bakedGameConfig, setRoomDocChange } from '../editor-scenes';
import { withZoneArt } from '../game/zoneArt';

// A world screen with `projection: 'isometric'` (P11.4) is drawn by the family's isometric world.
registerProjectedWorld(IsoWorld);
// A prop's vector art (`propGraphic.ts`): a bound part only an arcade game's props draw with.
registerBoundComponents({ PropGraphic: PropGraphic as unknown as BoundComponent });
// The config's zone art on its own zones (`game/zoneArt.ts`); a room whose generator makes its field
// replaces this change with its own, and its art draws the stamps.
setRoomDocChange(withZoneArt);

export { default as ArcadeStage } from '../components/ArcadeStage.svelte';
export { default as ArcadeBackdrop } from '../components/ArcadeBackdrop.svelte';
export { joinOnlineRoom } from '../game/online';

/** Whether this game's rooms draw their own backdrop (`ArcadeBackdrop.svelte`) in place of the slot
 *  sample's background: a generator with art (Salmons, `game-config` `usesSalmonsArt`). */
export const drawsOwnBackdrop = (): boolean =>
	usesSalmonsArt(normalizeGameConfigDoc(bakedGameConfig()) ?? null);

/** The family's Flow vocabulary, keyed by `templateId` (`flowV2Runtime`'s registry). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[ARCADE_VOCAB.templateId]: ARCADE_VOCAB,
};
/** The Flow actions the family's mechanic backs (`flowV2Runtime`'s coverage guard). */
export const flowBoardActions: readonly string[] = ARCADE_LOOP_ACTIONS;
