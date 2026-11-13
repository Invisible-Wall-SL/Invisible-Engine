import { summariseSoundLicences, type SoundLicenceSummary } from '../soundUsage';
import { resolveSoundBindings } from './soundLegacy';
import { collectPlayedSoundNames, shippedSoundEntries } from './soundReachability';
import { loadSoundsDoc } from './soundsStorage';

/**
 * THE PUBLISH CHECK for sound — which drafts a release ships.
 *
 * A draft plays everywhere: in the game, in a test build, in the tool, and it ships. Approval is
 * never a filter, and that is inverted from Invisible Localization on purpose. An unreviewed
 * string falls back to visible English; an unapproved sound would fall back to SILENCE, which
 * howler produces without an error and nobody notices in QA. So every publish path names the
 * drafts it ships, as a warning that never refuses (the owner's call, 2026-11-13;
 * `docs/design/invisible-sound.md` §6).
 *
 * A draft is listed exactly when the build SHIPS it: the check asks `soundReachability.ts` the
 * question `exportProjectSounds` asks, with the same resolved choices. So every place the export
 * finds a name counts — the `/sound` choices, a cinematic cue and its `pick` alternates, a
 * timeline, a component, the flow — and so does a draft named after an engine sound, which the
 * export ships because it replaces one the engine's own code plays. An unapproved file nothing names ships
 * nothing and is not listed — that is what a library is for.
 */

export interface SoundPublishCheck {
	/** Shipped sounds still marked draft. Reported with the publish, never refusing it. */
	unapproved: string[];
	/** What this publish is about to ship, licence-wise. Informational, never blocking. */
	licences: SoundLicenceSummary;
}

/**
 * Report the drafts among the library sounds the export would ship.
 *
 * When unsure, the check answers what the export would do, so the two never disagree:
 *  - the sounds doc cannot be read ⇒ the export ships no library sound, so none is listed;
 *  - any other source cannot be read, or a flow cue builds its sound's name at run time ⇒ the
 *    export ships every sound, so every draft is listed. A name built at run time can be any of
 *    them, and an unreadable document may name any of them; a transient read failure costs a
 *    longer warning, where staying quiet would let an unreviewed sound out unnoticed.
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

	// A project with no library of its own ships no draft and owes no one: every sound it plays is
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
