import { MUSIC_NAMES, SOUND_EFFECT_NAMES } from 'engine-flow-v2';
import {
	checkSoundLibrary,
	collectSoundBindings,
	summariseSoundLicences,
	type SoundLicenceSummary,
} from '../soundUsage';
import { loadFlowV2Doc } from './flowV2Storage';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSoundsDoc } from './soundsStorage';
import { loadSymbolsDoc } from './symbolsStorage';

/**
 * THE PUBLISH GATE for sound — the one place approval means anything.
 *
 * A draft plays everywhere: in the game, in a test build, in the tool. Approval gates the RELEASE,
 * not the playback, and that is inverted from Invisible Localization on purpose. An unreviewed
 * string falls back to visible English; an unapproved sound would fall back to SILENCE, which
 * howler produces without an error and nobody notices in QA. So the check happens loudly at the
 * moment of shipping instead of quietly removing audio (`docs/design/invisible-sound.md` §6).
 *
 * Only a sound something PLAYS can block. An unapproved file sitting unused in the library ships
 * nothing and stops nothing — that is what a library is for.
 */

export interface SoundPublishCheck {
	/** Bound sounds still marked draft. Non-empty ⇒ the publish is refused unless overridden. */
	unapproved: string[];
	/** What this publish is about to ship, licence-wise. Informational, never blocking. */
	licences: SoundLicenceSummary;
}

/**
 * Read every doc that can bind a sound and report what would block a publish.
 *
 * Reads the SAME collectors the `/sound` usage index does, so the tool cannot show a green library
 * that publish then refuses — the list an author sees under "played but not approved" is literally
 * this list.
 *
 * A read failure degrades to "nothing to report" rather than throwing: this is a gate on a release,
 * and a transient R2 hiccup must not become a phantom licensing objection that blocks one.
 */
export async function checkSoundsForPublish(
	clientKey: string,
	projectKey: string,
): Promise<SoundPublishCheck> {
	const empty: SoundPublishCheck = {
		unapproved: [],
		licences: { bound: 0, missingLicence: [], nonCommercial: [], byLicence: [] },
	};

	let library, config, symbols, flow;
	try {
		[library, config, symbols, flow] = await Promise.all([
			loadSoundsDoc(clientKey, projectKey),
			loadGameConfigDoc(clientKey, projectKey),
			loadSymbolsDoc(clientKey, projectKey),
			loadFlowV2Doc(clientKey, projectKey),
		]);
	} catch {
		return empty;
	}

	// A project with no library of its own can neither block nor owe anyone: every sound it plays is
	// the engine's. Short-circuit so the common case costs nothing.
	if (!library?.entries?.length) return empty;

	const byName = collectSoundBindings({ config, symbols, flow });
	const hasBinding = (name: string) => byName.has(name);

	// The BUILT-IN names matter here, and getting this wrong would put a hole straight through the
	// gate: a sound named after a shipped audiosprite region REPLACES it, so the engine's own code
	// plays it even though no doc names it. Judged by bindings alone it would look unplayed, and an
	// unapproved re-skin of `sfx_btn_spin` would sail past the one check meant to catch it.
	const builtinNames = [...MUSIC_NAMES, ...SOUND_EFFECT_NAMES];
	const checks = checkSoundLibrary(library, hasBinding, [...byName.keys()], builtinNames);
	const overriding = new Set(checks.overridesBuiltin);
	const isPlayed = (name: string) => hasBinding(name) || overriding.has(name);

	return {
		unapproved: checks.unapprovedBound,
		// Licences follow the same rule: an override is shipped audio, so we owe whoever made it.
		licences: summariseSoundLicences(library, isPlayed),
	};
}
