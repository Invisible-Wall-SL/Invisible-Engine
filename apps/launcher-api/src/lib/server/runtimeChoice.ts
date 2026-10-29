import { familyOfKind } from 'constants-shared/gameKinds';
import { FALLBACK_RUNTIME_ID, runtimeIdOfFamily, type RuntimeId } from 'constants-shared/runtimes';
import { resolveFamily, type GameConfigDoc } from 'game-config';

type Config = GameConfigDoc | null | undefined;

/**
 * The prebuilt runtime bundle id a game is served from (`test_server/_runtime/<id>/`): the runtime
 * of its config's family (`RUNTIMES` in `constants-shared/runtimes`, `docs/design/phase-11.md`
 * §2.3). Every runtime is the same `apps/lines` build, `runtime-release.yml` compiling in only the
 * families its id carries, so a slot game no longer downloads the arcade netcode or the card table.
 *
 * Every slot kind still shares ONE bundle, `lines`. That is a decision, not a gap: the build
 * ADAPTS to the config (its `winModel`, `activeWinModel()`, payline surfaces standing down for a
 * non-lines model), so a bundle per slot kind would buy nothing. The id stays `lines` because every
 * published manifest already names it; it means "the slot runtime", not "the lines game".
 *
 * The family is read from the config that ships, never from the project's kind alone: the config
 * is what the bundle plays. A publish where the two disagree is refused ({@link kindFamilyRefusal}).
 */
export const runtimeFor = (config: Config): RuntimeId => runtimeIdOfFamily(resolveFamily(config));

/** Why a project of kind `gameType` may not ship `config`, or `null`: their families disagree. */
export function kindFamilyRefusal(gameType: string, config: Config): string | null {
	const kind = familyOfKind(gameType);
	const family = resolveFamily(config);
	if (kind === family) return null;
	return (
		`This project is a ${gameType} game, but its Game Config is a ${family} game, so it is not ` +
		`published: the config would run on the ${runtimeIdOfFamily(family)} runtime, not the ` +
		`${runtimeIdOfFamily(kind)} one its kind plays on. Set the config's family to ${kind} in ` +
		"Invisible Game Config, or change the project's kind in /admin."
	);
}

/**
 * The runtime a publish of `config` points its game at, and that runtime's live pointer
 * (`pointerOf`, `runtimePointer` in production). A family runtime with no release is refused
 * (`unreleased`): since P11.1c `lines` is slot only, so there is nothing a non-slot game could fall
 * back to. `lines` with no pointer is the pre-pointer flat layout, which publishes as before.
 */
export async function chooseRuntime<P>(
	config: Config,
	pointerOf: (id: RuntimeId) => Promise<P | null>,
): Promise<{ id: RuntimeId; pointer: P | null; unreleased: boolean }> {
	const id = runtimeFor(config);
	const pointer = await pointerOf(id);
	return { id, pointer, unreleased: !pointer && id !== FALLBACK_RUNTIME_ID };
}
