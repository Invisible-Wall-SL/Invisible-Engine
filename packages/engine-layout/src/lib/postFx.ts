import {
	STAGE_FX_LIMITS,
	STAGE_FX_TRIGGERS,
	readElementFxEntries,
	type ElementFxEntry,
	type ElementFxKindId,
} from 'constants-shared/elementFx';

/**
 * What the stage knows of a kind (the Element FX runtime's `stageFxRefusal` / `stageFxFilterCount`),
 * passed in so this reader stays free of Pixi. Either answers `undefined` for a kind it does not
 * know yet (a custom effect not registered): the runtime decides that one when it starts.
 */
export interface PostFxJudge {
	refusal(kind: ElementFxKindId): string | undefined;
	filters(kind: ElementFxKindId): number | undefined;
}

const settingOf = (settings: unknown, key: string): unknown =>
	settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[key] : undefined;

/**
 * `settings.postFx` as the game plays it (`shader-graph-screens.md` §8, §10): read as any Element FX
 * list, then, in order, an entry is dropped with a warning when its trigger is neither `always` nor
 * `cue`, when the stage refuses its kind, or when it would pass {@link STAGE_FX_LIMITS} (two entries,
 * four filters). A disabled entry is dropped and counts for nothing.
 */
export function readPostFx(settings: unknown, judge?: PostFxJudge): ElementFxEntry[] {
	const out: ElementFxEntry[] = [];
	let filters = 0;
	const drop = (entry: ElementFxEntry, why: string): void =>
		console.warn(`Post FX: "${entry.id}" (${entry.kind}) does not play: ${why}.`);
	for (const entry of readElementFxEntries(settingOf(settings, 'postFx'))) {
		if (entry.disabled) continue;
		if (!(STAGE_FX_TRIGGERS as readonly string[]).includes(entry.trigger)) {
			drop(entry, `a post FX plays always or on a cue, not "${entry.trigger}"`);
			continue;
		}
		const refusal = judge?.refusal(entry.kind);
		if (refusal) {
			drop(entry, refusal);
			continue;
		}
		if (out.length >= STAGE_FX_LIMITS.entries) {
			drop(entry, `at most ${STAGE_FX_LIMITS.entries} post FX play`);
			continue;
		}
		const drawn = judge?.filters(entry.kind) ?? 0;
		if (filters + drawn > STAGE_FX_LIMITS.filters) {
			drop(entry, `post FX draw at most ${STAGE_FX_LIMITS.filters} filters in all`);
			continue;
		}
		filters += drawn;
		out.push(entry);
	}
	return out;
}

/** `settings.stageFxAntialias`: on only when it is `true`. */
export const readStageFxAntialias = (settings: unknown): boolean =>
	settingOf(settings, 'stageFxAntialias') === true;
