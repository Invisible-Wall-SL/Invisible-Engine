import { error, redirect } from '@sveltejs/kit';
import { MUSIC_NAMES, SOUND_EFFECT_NAMES } from 'engine-flow-v2';
import {
	SOUND_SLOTS,
	resolveCascade,
	resolveReelBehaviour,
	symbolsInPlay,
	type GameConfigDoc,
} from 'game-config';
import { SYMBOL_STATE_LABELS, effectiveSoundBindings, type SymbolStateName } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { flowSoundBindings } from '$lib/soundUsage';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadFlowV2Doc } from '$lib/server/flowV2Storage';
import { loadGameConfigDoc } from '$lib/server/gameConfigStorage';
import { projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadSoundsDocWithEtag } from '$lib/server/soundsStorage';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Sound (`/sound`) — every sound the game makes, in one place: the LIBRARY (what audio
 * this project owns, who made it, whether it is approved) and the CHOICES (what plays at each
 * named moment), authored together.
 *
 * The choices used to live in `/config`, `/symbols` and the Scene Editor. They moved here because
 * choosing a game's audio should not mean opening three tools and knowing which one owns which
 * moment. Flow cues are the one exception — a cue node has wires, conditions and a position, so it
 * stays in its graph and this page only lists it.
 *
 * Granted by default to `audio` — the role this tool exists for, and which until now had no audio
 * tool at all — plus `developer`, `artist` and `pipelineTester`.
 */
/**
 * The per-symbol cue states this project can actually hear, derived from its config.
 *
 * A function rather than an expression inline in the payload because it answers a question with
 * three inputs and one hard-won correction in it (see the field's doc): the state a beat plays and
 * the switch that turns that beat on are not the same fact, and `tumbleExplosion` shipped gated on
 * the wrong one.
 */
const symbolCueStates = (config: GameConfigDoc | undefined): readonly SymbolStateName[] => {
	const behaviour = resolveReelBehaviour(config);
	return [
		'land' as const,
		...(behaviour.swapInPlace && behaviour.swapStyle === 'emerge' ? (['intro'] as const) : []),
		...(resolveCascade(config) || behaviour.clearBoard ? (['tumbleExplosion'] as const) : []),
	];
};

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the symbols/win-text routes: the parent layout already resolved the
	// effective manifest, but re-check with overrides so a per-user revoke is honoured.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'sound', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Sound.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	// Every surface that can bind a sound, read together so the usage index can say which library
	// sounds are actually played. Read-only here — each row links to the tool that owns it.
	const [{ doc, etag }, config, symbols, flow] = await Promise.all([
		loadSoundsDocWithEtag(clientKey, projectKey),
		loadGameConfigDoc(clientKey, projectKey),
		loadSymbolsDoc(clientKey, projectKey),
		loadFlowV2Doc(clientKey, projectKey),
	]);

	/**
	 * The author's CHOICES, seeded from wherever they currently live.
	 *
	 * A project written before authoring moved here still has them in the config and symbols docs, so
	 * the page opens showing what the game actually plays rather than an empty form — and the first
	 * save migrates them into this doc. See `effectiveSoundBindings`.
	 */
	const bindings = effectiveSoundBindings(doc, {
		configSounds: config?.sounds,
		symbolSounds: (symbols as { symbolSounds?: unknown } | null)?.symbolSounds,
		anticipation: (symbols as { anticipation?: unknown } | null)?.anticipation,
		winLevels: config?.winLevels,
	});

	return {
		clientKey,
		projectKey,
		projectName: await projectName(projectKey),
		tools,
		doc,
		// The precondition the page sends back on save, so a second author can't silently clobber the
		// whole library. `null` = "there was no doc when I loaded".
		etag,
		/** The author's choices, already migrated-or-seeded. The page edits this and saves it. */
		bindings,
		/** Whether those choices still live in the OLD docs — the page says so, once, because the
		 *  first save moves them and that is worth knowing before you press it. */
		unmigrated: !doc?.bindings,
		/** The moments this game HAS, in the order the tool lists them. The catalogue is the engine's
		 *  contract (`game-config/sounds`), so the tool renders what the engine will actually fire
		 *  rather than a list of its own that could drift. */
		slots: SOUND_SLOTS.map((slot) => ({
			id: slot.id,
			label: slot.label,
			kind: slot.kind,
			description: slot.description,
			ladderIndex: slot.ladderIndex,
			defaults: slot.defaults,
		})),
		/** Symbol ids in play, so the per-symbol rows name this game's real symbols. */
		symbolIds: config ? symbolsInPlay(config) : [],
		/**
		 * ONLY the states the engine actually resolves a per-symbol cue on. Offering the others would
		 * let an author bind a cue nothing will ever play and be told nothing, which is precisely how
		 * `tumble_win_1…5` sat unheard in the audiosprite for the life of the fork.
		 *
		 * `land` always. `tumbleExplosion` whenever the project CASCADES OR CLEARS — two things play
		 * that state, not one, and gating it on the cascade alone hid it from exactly the projects
		 * authoring the second: a swap-in-place board with "Clear the board" ticked runs
		 * `clearOutgoingSymbols` on every single round. `intro` only under the `emerge` swap style,
		 * which is the only thing that fires it.
		 */
		symbolStates: symbolCueStates(config ?? undefined).map((state) => ({
			state,
			label: SYMBOL_STATE_LABELS[state],
		})),
		/** Win tiers, in threshold order, for the tier rows. */
		winTiers: (config?.winLevels ?? []).map((t) => ({ alias: t.alias, name: t.name })),
		/** Flow cues stay in the graph — listed here so the page can still show every sound the game
		 *  plays, with a link out rather than an editor. */
		flowCues: flowSoundBindings(flow).map((b) => ({ name: b.name, where: b.where })),
		/**
		 * The shipped audiosprite's own names. Sourced from the generated flow enums because that is
		 * the list the launcher already trusts for its sound pickers; when S9 retires it this reads
		 * the project's own catalogue instead and nothing else changes.
		 */
		builtinNames: [...MUSIC_NAMES, ...SOUND_EFFECT_NAMES],
	};
};
