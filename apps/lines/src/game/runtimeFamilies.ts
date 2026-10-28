import { CONFIG_FAMILIES, resolveFamily, type ConfigFamily } from 'game-config';

/**
 * The families this bundle carries (`config-vite` `__IE_FAMILIES__`, `docs/design/phase-11.md`
 * §2.2). Every family where it is not defined: Storybook and the Node fixtures compile the seams
 * as they are, with nothing aliased out.
 */
export const compiledFamilies = (): readonly ConfigFamily[] =>
	typeof __IE_FAMILIES__ === 'undefined' ? CONFIG_FAMILIES : __IE_FAMILIES__;

/**
 * Why this runtime refuses to boot the config, or `undefined` when it carries the config's family.
 * A left-out family's seam is an inert stub, so its game would otherwise draw as a slot or a blank
 * board.
 */
export const familyRefusal = (
	doc: Parameters<typeof resolveFamily>[0],
	compiled: readonly ConfigFamily[] = compiledFamilies(),
): string | undefined => {
	const family = resolveFamily(doc);
	return compiled.includes(family) ? undefined : `this runtime does not play ${family} games`;
};
