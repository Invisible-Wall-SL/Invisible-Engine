import { summariseSoundLicences, type SoundLicenceSummary } from '../soundUsage';
import { resolveSoundBindings } from './soundLegacy';
import { collectPlayedSoundNames, shippedSoundEntries } from './soundReachability';
import { loadSoundsDoc } from './soundsStorage';

/**
 * THE PUBLISH GATE for sound — the one place approval means anything.
 *
 * A draft plays everywhere: in the game, in a test build, in the tool. Approval gates the RELEASE,
 * not the playback, and that is inverted from Invisible Localization on purpose. An unreviewed
 * string falls back to visible English; an unapproved sound would fall back to SILENCE, which
 * howler produces without an error and nobody notices in QA. So the check happens loudly at the
 * moment of shipping instead of quietly removing audio (`docs/design/invisible-sound.md` §6).
 *
 * A draft blocks exactly when the build SHIPS it: the gate asks `soundReachability.ts` the question
 * `exportProjectSounds` asks, with the same resolved choices. So every place the export finds a
 * name counts — the `/sound` choices, a cinematic cue and its `pick` alternates, a timeline, a
 * component, the flow — and so does a draft named after an engine sound, which the export ships
 * because it replaces one the engine's own code plays. An unapproved file nothing names ships
 * nothing and stops nothing — that is what a library is for.
 */

export interface SoundPublishCheck {
	/** Shipped sounds still marked draft. Non-empty ⇒ the publish is refused unless overridden. */
	unapproved: string[];
	/** What this publish is about to ship, licence-wise. Informational, never blocking. */
	licences: SoundLicenceSummary;
}

/**
 * Report what would block a publish: the drafts among the library sounds the export would ship.
 *
 * When unsure, the gate answers what the export would do, so the two never disagree:
 *  - the sounds doc cannot be read ⇒ the export ships no library sound, so nothing blocks;
 *  - any other source cannot be read, or a flow cue builds its sound's name at run time ⇒ the
 *    export ships every sound, so every draft blocks. A name built at run time can be any of them,
 *    and an unreadable document may name any of them; a transient read failure costs a retry or a
 *    "publish anyway", where staying quiet would let an unreviewed sound out unnoticed.
 */
export async function checkSoundsForPublish(
	clientKey: string,
	projectKey: string,
): Promise<SoundPublishCheck> {
	const empty: SoundPublishCheck = {
		unapproved: [],
		licences: { bound: 0, missingLicence: [], nonCommercial: [], byLicence: [] },
	};

	let library;
	try {
		library = await loadSoundsDoc(clientKey, projectKey);
	} catch {
		return empty;
	}

	// A project with no library of its own can neither block nor owe anyone: every sound it plays is
	// the engine's. Short-circuit so the common case costs nothing.
	const entries = library?.entries ?? [];
	if (!entries.length) return empty;

	const bindings = await resolveSoundBindings(clientKey, projectKey, library);
	const played = await collectPlayedSoundNames(clientKey, projectKey, { bindings });
	const shipped = new Set(shippedSoundEntries(entries, played).map((entry) => entry.name));
	const ships = (name: string) => shipped.has(name);

	return {
		unapproved: entries.filter((e) => e.status !== 'approved' && ships(e.name)).map((e) => e.name),
		licences: summariseSoundLicences(library, ships),
	};
}
