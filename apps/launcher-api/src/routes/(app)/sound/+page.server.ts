import { error, redirect } from '@sveltejs/kit';
import { MUSIC_NAMES, SOUND_EFFECT_NAMES } from 'engine-flow-v2';
import { roleHasTool } from '$lib/roles';
import { collectSoundBindings } from '$lib/soundUsage';
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
 * Invisible Sound (`/sound`) — the project's SOUND LIBRARY: which sounds it owns, who made them,
 * and whether they are approved to ship.
 *
 * It does NOT author bindings. Which cue plays at which moment stays in the tool that owns the
 * moment — `/config` for the game-wide slots, `/symbols` for a per-symbol cue, `/flow-v2` for a
 * graph cue — because a binding belongs beside the thing it describes, and a second home for it is
 * how the two drift. See `docs/design/invisible-sound.md` §2.3.
 *
 * Granted by default to `audio` — the role this tool exists for, and which until now had no audio
 * tool at all — plus `developer`, `artist` and `pipelineTester`.
 */
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

	// The BINDINGS only — the checks run on the page, against the live library, so the index stays
	// right as the author renames or removes a sound rather than only until they touch something.
	// None of these three docs is editable from here, so they cannot go stale while the page is open.
	const byName = collectSoundBindings({ config, symbols, flow });

	return {
		clientKey,
		projectKey,
		projectName: await projectName(projectKey),
		tools,
		doc,
		// The precondition the page sends back on save, so a second author can't silently clobber the
		// whole library. `null` = "there was no doc when I loaded".
		etag,
		/** Sound name → what plays it. A plain object, not a `Map` — `devalue` does not carry one. */
		bindings: Object.fromEntries(byName),
		/**
		 * The shipped audiosprite's own names. Sourced from the generated flow enums because that is
		 * the list the launcher already trusts for its sound pickers; when S9 retires it this reads
		 * the project's own catalogue instead and nothing else changes.
		 */
		builtinNames: [...MUSIC_NAMES, ...SOUND_EFFECT_NAMES],
	};
};
