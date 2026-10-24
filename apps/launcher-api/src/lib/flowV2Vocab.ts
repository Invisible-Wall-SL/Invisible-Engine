import {
	templateVocabulary,
	withAddOns,
	withSymbols,
	type FlowAddOns,
	type TemplateVocabulary,
} from 'engine-flow-v2';
import { withCustomElementFxKinds, withElementFxTargets } from './elementFxTargets';
import { withSceneCues } from './sceneCues';
import { withProjectSounds, type SoundOptions } from './soundOptions';

/** What a project adds to its kind's flow vocabulary. */
export interface FlowV2VocabInputs {
	/** The Game Config add-ons (`flowAddOnsOf`); absent ⇒ none. */
	addOns?: FlowAddOns;
	/** The project's symbols (`symbolsUsed` of its resolved config); empty ⇒ unknown. */
	symbols?: readonly string[];
	sounds: SoundOptions;
	/** Author-named cue signals harvested off the project's scenes and components. */
	sceneCues: string[];
	/** What a Flow `elementEffect` can aim at (`collectElementFxTargets`); absent ⇒ the reels only. */
	fxTargets?: readonly string[];
	/** The project's shader effects (`custom:<id>`) an `elementEffect` can play; absent ⇒ none. */
	customFxKinds?: readonly string[];
}

/**
 * The vocabulary a project's flow is authored and judged against: the kind's, plus its Game Config
 * add-ons, its symbols, its sounds, its scene cues, its Element FX targets and its custom Element FX. ONE function, so the `/flow-v2` editor and the
 * publish gate (`validateFlowV2Against`) cannot compose it differently. Each step returns its input
 * unchanged when the project adds nothing.
 */
export function composeFlowV2Vocab(
	templateId: string | undefined,
	{
		addOns,
		symbols = [],
		sounds,
		sceneCues,
		fxTargets = [],
		customFxKinds = [],
	}: FlowV2VocabInputs,
): TemplateVocabulary {
	return withCustomElementFxKinds(
		withElementFxTargets(
			withSceneCues(
				withProjectSounds(
					withSymbols(withAddOns(templateVocabulary(templateId), addOns), symbols),
					sounds,
				),
				sceneCues,
			),
			fxTargets,
		),
		customFxKinds,
	);
}
