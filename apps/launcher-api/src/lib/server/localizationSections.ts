import { docComponentInstanceNodes, flowUsesSpawn } from 'engine-flow-v2';
import {
	instanceDefResolver,
	projectFlowInstances,
	projectSpawnLayers,
} from '$lib/flowV2Projection';
import { loadAuthoredCinematics } from './cinematicExport';
import { listComponents, loadComponent } from './componentStorage';
import { loadDoc as loadEditorDoc } from './editorStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import { withPlacedComponentVersions } from './flowV2Validation';
import {
	harvestBetModeText,
	harvestCardText,
	harvestFlowInstanceText,
	harvestFlowMessages,
	harvestSceneText,
	harvestSymbolNames,
	harvestProjectWinText,
	harvestTimelineText,
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
 * Invisible Flow's `textMessage` node text (one "Flow messages" section), the strings cinematic
 * timelines switch text nodes to (one "Timelines" section), Invisible Game Config's
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
	const [editorDoc, winTextDoc, symbolsDoc, flowV2Doc, gameConfig, cinematics] = await Promise.all([
		loadEditorDoc(clientKey, projectKey),
		loadWinTextDoc(clientKey, projectKey),
		loadSymbolsDoc(clientKey, projectKey),
		loadFlowV2Doc(clientKey, projectKey),
		// The RESOLVED config (authored doc ◁ game-type template default) — the same precedence the
		// game runs on, so a project that never authored a config still lists the copy it renders.
		resolveGameConfig(clientKey, projectKey, gameType),
		// The cinematics that ship — the same set the export publishes — for their switch-key text.
		loadAuthoredCinematics(clientKey, projectKey),
	]);
	// The flow's placed-instance projection (Rive plan §6.2), for the keys it feeds `text` inputs —
	// only when the flow places an instance at all, so a project without one reads no components.
	let components: Promise<Awaited<ReturnType<typeof listComponents>>> | undefined;
	const projectComponents = () => (components ??= listComponents({ projectKey }));
	const instances =
		flowV2Doc && docComponentInstanceNodes(flowV2Doc).length
			? projectFlowInstances(
					flowV2Doc.containers,
					editorDoc.scenes ?? [],
					instanceDefResolver(
						await withPlacedComponentVersions(
							projectKey,
							editorDoc.scenes ?? [],
							await projectComponents(),
						),
					),
				)
			: undefined;
	// …and the spawn layers, for the keys an Instance ref feeds a spawnable's `text` inputs — only
	// when the flow spawns at all.
	const spawnLayers =
		flowV2Doc && flowUsesSpawn(flowV2Doc)
			? projectSpawnLayers(
					flowV2Doc.containers,
					editorDoc.scenes ?? [],
					instanceDefResolver(await projectComponents()),
				)
			: undefined;
	const sections = [
		...(await harvestSceneText(editorDoc, (id, version) => loadComponent(id, projectKey, version))),
		...harvestProjectWinText(winTextDoc, gameType, gameConfig.doc),
		...harvestSymbolNames(symbolsDoc),
		...harvestFlowMessages(flowV2Doc ?? undefined),
		...harvestFlowInstanceText(flowV2Doc ?? undefined, instances, spawnLayers),
		...harvestBetModeText(gameConfig.doc),
		...harvestCardText(gameConfig.doc),
		// The engine's own coded chrome (HUD captions, menus, modals, info-page rules) — the same
		// registry the runtime renders from, so the shipped UI is translatable per project instead of
		// being stuck on the two languages the code catalogs happen to ship.
		...harvestUiText(),
	];
	// Last, and only for keys no section above lists: `reconcileWithEditor` stamps each row with
	// the origin of the LAST section listing it, so a timeline must never take a row it shares.
	const owned = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
	return [...sections, ...harvestTimelineText(cinematics, editorDoc, owned)];
}
