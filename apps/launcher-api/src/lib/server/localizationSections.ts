import { loadComponent } from './componentStorage';
import { loadDoc as loadEditorDoc } from './editorStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import {
	harvestBetModeText,
	harvestFlowMessages,
	harvestSceneText,
	harvestSymbolNames,
	harvestProjectWinText,
	harvestUiText,
	type HarvestSection,
} from './localizationHarvest';
import { projectGameType } from './projects';
import { loadSymbolsDoc } from './symbolsStorage';
import { loadWinTextDoc } from './winTextStorage';

/**
 * The project's auto-collected text, as read-only sections owned by the tool that authored them:
 * the Scene Editor's text nodes (grouped by scene), Invisible Win Text's templates (one "Win text"
 * section), the Invisible Symbols State Machine's display names (one "Symbol names" section),
 * Invisible Flow's `textMessage` node text (one "Flow messages" section), Invisible Game Config's
 * bet-mode copy (one "Bet modes" section — the buy-feature cards, which live in the config and so
 * are invisible to the scene walk), and the engine's own coded UI strings (one "Game UI" section,
 * project-independent). A missing doc on any side harvests nothing.
 *
 * One function for every reader that folds them into the stored doc with `reconcileWithEditor`:
 * the Localization page and Invisible Director's `localization.*` adapters.
 */
export async function harvestProjectSections(
	clientKey: string,
	projectKey: string,
): Promise<HarvestSection[]> {
	const gameType = await projectGameType(projectKey);
	const [editorDoc, winTextDoc, symbolsDoc, flowV2Doc, gameConfig] = await Promise.all([
		loadEditorDoc(clientKey, projectKey),
		loadWinTextDoc(clientKey, projectKey),
		loadSymbolsDoc(clientKey, projectKey),
		loadFlowV2Doc(clientKey, projectKey),
		// The RESOLVED config (authored doc ◁ game-type template default) — the same precedence the
		// game runs on, so a project that never authored a config still lists the copy it renders.
		resolveGameConfig(clientKey, projectKey, gameType),
	]);
	return [
		...(await harvestSceneText(editorDoc, (id, version) => loadComponent(id, projectKey, version))),
		...harvestProjectWinText(winTextDoc, gameType, gameConfig.doc),
		...harvestSymbolNames(symbolsDoc),
		...harvestFlowMessages(flowV2Doc ?? undefined),
		...harvestBetModeText(gameConfig.doc),
		// The engine's own coded chrome (HUD captions, menus, modals, info-page rules) — the same
		// registry the runtime renders from, so the shipped UI is translatable per project instead of
		// being stuck on the two languages the code catalogs happen to ship.
		...harvestUiText(),
	];
}
