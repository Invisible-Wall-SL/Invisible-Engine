import type { WinTextPlacedFeatureField } from 'engine-layout';
import { showMessage } from 'state-shared';

import { bakedWinText } from '../editor-scenes';
import { showHoldAndWinBanner, type HoldAndWinBannerView } from './holdAndWinBanner.svelte';

/**
 * Announce a Hold and Win feature line where the project placed it (Win Text `featurePlacement`):
 * the board banner, the info bar, both, or neither. Returns the banner's id for
 * `hideHoldAndWinBanner`, 0 when no banner went up, so a beat that holds on its banner falls back to
 * its plain wait, as it does for a line left empty.
 */
export const announceFeatureLine = (
	field: WinTextPlacedFeatureField,
	banner: Omit<HoldAndWinBannerView, 'id'>,
): number => {
	if (!banner.title) return 0;
	const placement = bakedWinText().featurePlacement[field];
	if (placement === 'infoBar' || placement === 'both') {
		showMessage(banner.detail ? `${banner.title}  ${banner.detail}` : banner.title, {
			kind: 'info',
		});
	}
	return placement === 'banner' || placement === 'both' ? showHoldAndWinBanner(banner) : 0;
};
