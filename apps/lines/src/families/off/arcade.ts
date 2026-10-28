import type * as Arcade from '../arcade';
import { refuseOnlineBoot } from '../../editor-scenes';
import Off from './Off.svelte';

/** The arcade seam in a build without arcade (`config-vite` `PUBLIC_IE_FAMILIES`): inert. The boot
 *  refuses an arcade config first (`game/runtimeFamilies.ts`), so none of it is reached. */
export const ArcadeStage: typeof Arcade.ArcadeStage = Off;
export const joinOnlineRoom: typeof Arcade.joinOnlineRoom = () =>
	refuseOnlineBoot('this runtime does not play arcade games');
