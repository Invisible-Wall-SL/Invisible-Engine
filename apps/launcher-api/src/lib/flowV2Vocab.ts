import {
	templateVocabulary,
	withAddOns,
	withOutcome,
	withSymbols,
	type FlowAddOns,
	type FlowOutcome,
	type TemplateVocabulary,
} from 'engine-flow-v2';
import {
	withCustomElementFxKinds,
	withCustomScreenTransitionKinds,
	withElementFxTargets,
} from './elementFxTargets';
import { withSceneCues } from './sceneCues';
import { withProjectSounds, type SoundOptions } from './soundOptions';

/** What a project adds to its kind's flow vocabulary. */
export interface FlowV2VocabInputs {
	/** The Game Config add-ons (`flowAddOnsOf`); absent ⇒ none. */
	addOns?: FlowAddOns;
	/** Who decides the rounds (`resolveOutcome` of the Game Config); absent ⇒ the vocabulary as is.
	 *  `rgs` drops the rules-only board actions (`withOutcome`). */
	outcome?: FlowOutcome;
	/** The project's symbols (`symbolsUsed` of its resolved config); empty ⇒ unknown. */
	symbols?: readonly string[];
	sounds: SoundOptions;
	/** Author-named cue signals harvested off the project's scenes and components. */
	sceneCues: string[];
	/** What a Flow `elementEffect` can aim at (`collectElementFxTargets`); absent ⇒ the reels only. */
	fxTargets?: readonly string[];
	/** The project's shader effects (`custom:<id>`) an `elementEffect` or a `screenTransition` can
	 *  play; absent ⇒ none. */
	customFxKinds?: readonly string[];
}

/**
 * The vocabulary a project's flow is authored and judged against: the kind's, less what its outcome
 * forbids, plus its Game Config add-ons, its symbols, its sounds, its scene cues, its Element FX
 * targets and its custom Element FX kinds (for `elementEffect` and `screenTransition`). ONE
 * function, so the `/flow-v2` editor and the publish gate (`validateFlowV2Against`) cannot compose
 * it differently. Each step returns its input unchanged when the project adds nothing. (The
 * stored-flow check before Publish's assemble passes no custom kinds; an enum value is judged as
 * text, so its verdict is the same.)
 */
export function composeFlowV2Vocab(
	templateId: string | undefined,
	{
		addOns,
		outcome,
		symbols = [],
		sounds,
		sceneCues,
		fxTargets = [],
		customFxKinds = [],
	}: FlowV2VocabInputs,
): TemplateVocabulary {
	return withCustomScreenTransitionKinds(
		withCustomElementFxKinds(
			withElementFxTargets(
				withSceneCues(
					withProjectSounds(
						withSymbols(
							withAddOns(withOutcome(templateVocabulary(templateId), outcome), addOns),
							symbols,
						),
						sounds,
					),
					sceneCues,
				),
				fxTargets,
			),
			customFxKinds,
		),
		customFxKinds,
	);
}
