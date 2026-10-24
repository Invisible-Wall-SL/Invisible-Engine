import {
	ELEMENT_FX_KIND_ENUM,
	ELEMENT_FX_TARGET_ENUM,
	type TemplateVocabulary,
} from 'engine-flow-v2';
import {
	ELEMENT_FX_REELS_TARGET,
	elementFxScreenTarget,
	readElementFxEntries,
} from 'constants-shared/elementFx';
import type { ComponentDef, LayoutNode, Scene } from 'engine-layout';

/**
 * What a Flow `elementEffect` can aim at in this project: the reels, every screen, and every node
 * the game registers an anchor for — a group, a component placement, a coded mount, and any node
 * that carries Element FX of its own (inside a component too, given its defs). The order is the
 * dropdown's: reels, screens in doc order, then node ids sorted.
 */
export function collectElementFxTargets(
	scenes: readonly Scene[],
	components: readonly ComponentDef[] = [],
): string[] {
	const nodes = new Set<string>();
	const entered = new Set<string>();
	const defs = new Map<string, ComponentDef[]>();
	for (const def of components) defs.set(def.id, [...(defs.get(def.id) ?? []), def]);
	const walk = (list: readonly LayoutNode[], inComponent: boolean): void => {
		for (const node of list) {
			const anchored =
				!inComponent &&
				(node.kind === 'container' || node.kind === 'componentInstance' || !!node.bind);
			if (node.kind !== 'reelGrid' && (anchored || readElementFxEntries(node.elementFx).length)) {
				nodes.add(node.id);
			}
			if (node.kind === 'container') walk(node.children ?? [], inComponent);
			if (node.kind === 'componentInstance' && !entered.has(node.componentId)) {
				entered.add(node.componentId);
				for (const def of defs.get(node.componentId) ?? []) walk(def.root.children ?? [], true);
			}
		}
	};
	for (const scene of scenes) walk(scene.nodes ?? [], false);
	return [
		ELEMENT_FX_REELS_TARGET,
		...scenes.map((scene) => elementFxScreenTarget(scene.id)),
		...[...nodes].sort(),
	];
}

/** The vocabulary with enum `name` widened to `values`; the same object when nothing is added. */
function widenEnum(
	vocab: TemplateVocabulary,
	name: string,
	values: readonly string[],
): TemplateVocabulary {
	const decl = vocab.enums.find((e) => e.name === name);
	if (!decl) return vocab;
	const added = values.filter((v) => !decl.values.includes(v));
	if (!added.length) return vocab;
	return {
		...vocab,
		enums: vocab.enums.map((e) =>
			e === decl ? { ...e, values: [...new Set([...e.values, ...added])] } : e,
		),
	};
}

/** The vocabulary with its `ElementFxTarget` enum widened to `targets`. */
export const withElementFxTargets = (
	vocab: TemplateVocabulary,
	targets: readonly string[],
): TemplateVocabulary => widenEnum(vocab, ELEMENT_FX_TARGET_ENUM, targets);

/** The vocabulary with its `ElementFxKind` enum widened to the project's custom kinds. */
export const withCustomElementFxKinds = (
	vocab: TemplateVocabulary,
	kinds: readonly string[],
): TemplateVocabulary => widenEnum(vocab, ELEMENT_FX_KIND_ENUM, kinds);
