import { familyOfKind } from 'constants-shared/gameKinds';
import { DRIVEN_SEED_FALLBACKS, DRIVEN_SEEDS } from './drivenSeed';

/**
 * Whether a stored flow's `templateId` belongs to another family than `gameType` — what a kind
 * change leaves behind (a Book-of flow in an arcade project). `false` unless both are built-in: an
 * author-created kind or an unregistered template proves nothing. A slot flow in another slot kind
 * is not one: a `cluster`/`scatter`/`holdAndWin` project scaffolded before its kind had a starter
 * still runs the Book-of flow it was given (`docs/status/flow.md`), and it is the author's work.
 */
export function flowTemplateMismatch(
	templateId: string | undefined,
	gameType: string | undefined,
): boolean {
	if (!templateId || !gameType || !Object.hasOwn(DRIVEN_SEEDS, templateId)) return false;
	const builtIn =
		Object.hasOwn(DRIVEN_SEEDS, gameType) || Object.hasOwn(DRIVEN_SEED_FALLBACKS, gameType);
	return builtIn && familyOfKind(templateId) !== familyOfKind(gameType);
}
