import { loadFlowV2Doc } from './flowV2Storage';
import { loadFlowV2Library } from './flowV2LibraryStorage';
import type { SymbolsDoc } from './symbolsStorage';

/**
 * The flow action that turns the reel anticipation on (`apps/lines` `flowEffects.ts`). The engine
 * starts with it off, so a project whose flow never fires it never teases — the game's stock-asset
 * walk drops the coded rig on the same test (`ANTICIPATION_SWITCHES`, `stockAssetRules.ts`).
 */
export const ANTICIPATION_SWITCH = 'enableAnticipationMode';

const MAX_DEPTH = 64;

/** Whether any string in `value` names the switch, bare or scoped (`…:enableAnticipationMode`). */
export function mentionsAnticipationSwitch(value: unknown, depth = 0): boolean {
	if (depth > MAX_DEPTH) return true;
	if (typeof value === 'string') {
		return value.slice(value.lastIndexOf(':') + 1) === ANTICIPATION_SWITCH;
	}
	if (Array.isArray(value))
		return value.some((item) => mentionsAnticipationSwitch(item, depth + 1));
	if (value && typeof value === 'object') {
		return Object.values(value).some((item) => mentionsAnticipationSwitch(item, depth + 1));
	}
	return false;
}

/**
 * Whether the project's flow can arm the reel anticipation. The game embeds the flow and the shared
 * function library only for an authored flow (`flowV2Export.ts`), so a project with none cannot.
 * The library is global, so a library function that arms it counts for every project: kept wide
 * on purpose, because a false "armed" only ships a rig and a false "unarmed" loses one.
 */
export async function flowArmsAnticipation(
	clientKey: string,
	projectKey: string,
): Promise<boolean> {
	let flow, library;
	try {
		[flow, library] = await Promise.all([
			loadFlowV2Doc(clientKey, projectKey),
			loadFlowV2Library(),
		]);
	} catch {
		// A failed read must not fail the symbols export or drop a rig the game may need.
		return true;
	}
	if (!flow) return false;
	return mentionsAnticipationSwitch(flow) || mentionsAnticipationSwitch(library);
}

/**
 * The doc as it ships: without its reel-anticipation block when no flow can arm the mode, so a
 * swapped overlay rig is neither collected nor carried. The SAME doc when there is nothing to drop.
 */
export function shipAnticipationOnlyWhenArmed(doc: SymbolsDoc, armed: boolean): SymbolsDoc {
	if (armed || !doc.anticipation) return doc;
	const shipped: SymbolsDoc = { ...doc };
	delete shipped.anticipation;
	return shipped;
}
