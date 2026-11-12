import { cueSoundOf, type SoundsDoc } from 'engine-layout';
import { flowSoundCueLabel, projectFlowSoundCues } from './flowSoundCues';

/**
 * THE USAGE INDEX — which sounds this project actually plays, and which it only stores.
 *
 * This is the half of Invisible Sound that earns it being a tool rather than a folder. The library
 * says what exists; nothing until now could say what is USED. That gap is how `tumble_win_1…5` sat
 * in the shipped audiosprite for the whole life of the fork, listed in the Flow editor's dropdown,
 * played by nothing (`docs/status/engine.md`, 2026-08-25).
 *
 * `/sound` builds the index from the choices on screen and the flow's cues, and reports:
 *
 *  - **Unbound** — a library sound the build does not ship, because nothing names it. The
 *    `tumble_win_*` class.
 *  - **Missing** — a binding naming a sound that neither the library nor the shipped audiosprite
 *    declares. Howler declines an unknown sprite key SILENTLY, so this is the only way a typo
 *    becomes visible before a player hears the gap.
 *  - **Unapproved but shipped** — a draft the build ships. The publish gate refuses exactly these
 *    (`soundPublishCheck.ts`); showing them here means the author is not first told at the moment
 *    they ship.
 *
 * READ-ONLY, deliberately. The bindings stay in the tool that owns the moment
 * (`docs/design/invisible-sound.md` §2.3), so each row links out rather than editing in place: a
 * slot's ladder semantics and a symbol's state machine are the context you need to change one
 * safely, and a stripped-down editor here would be a second, worse home for the same fact.
 */

export type SoundBindingSource = 'slot' | 'symbol' | 'anticipation' | 'winTier' | 'flow';

export interface SoundBinding {
	/** The sound NAME this binding asks for. */
	name: string;
	source: SoundBindingSource;
	/** What binds it, in the author's words — the row label. */
	where: string;
	/** The tool that owns it. */
	href: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every sound name a project's flow plays, with the node that plays it: the flow's own graph, each
 * mode's graph, every group body, and the shared library functions the flow calls. Which nodes
 * play which sound is `flowSoundCues.ts`'s answer, the same one the export ships by. A name only
 * known at run time (a wire, an accessor) binds nothing here.
 */
export function flowSoundBindings(flow: unknown, library?: unknown): SoundBinding[] {
	const out: SoundBinding[] = [];
	for (const cue of projectFlowSoundCues(flow, library)) {
		if (!cue.name) continue;
		out.push({ name: cue.name, source: 'flow', where: flowSoundCueLabel(cue), href: '/flow-v2' });
	}
	return out;
}

/**
 * Every name a `/sound` choices block holds, read the way the export reads that block: every string
 * value, a silenced slot's names included (`soundReachability.ts` `collectSoundNames`, which this
 * page cannot import from the server side). The page adds these, live, to what the export finds
 * everywhere else, so an unsaved choice counts at once. `check:sound-reachability` holds the two
 * readings equal.
 */
export function soundBindingNames(bindings: unknown): Set<string> {
	const names = new Set<string>();
	const walk = (value: unknown): void => {
		if (typeof value === 'string') {
			if (!value) return;
			names.add(value);
			const cue = cueSoundOf(value);
			if (cue) names.add(cue.name);
		} else if (Array.isArray(value)) {
			for (const v of value) walk(v);
		} else if (isRecord(value)) {
			for (const v of Object.values(value)) walk(v);
		}
	};
	walk(bindings);
	return names;
}

export interface SoundChecks {
	/** Library sounds nothing plays (with `ships`: that the build does not ship). */
	unbound: string[];
	/** Bound names that neither the library nor the audiosprite declares — an inaudible typo. */
	missing: string[];
	/** Library sounds that are played but still drafts (with `ships`: shipped drafts, the list the
	 *  publish gate refuses). */
	unapprovedBound: string[];
	/**
	 * Library sounds whose name matches a shipped audiosprite region. These are NOT unbound even
	 * when no doc names them: the engine plays that region from its own code, and an upload under
	 * the same name REPLACES it (`buildSoundBankIndex` is last-wins). Reporting them as unused would
	 * contradict the one feature that lets a project re-skin the default audio.
	 */
	overridesBuiltin: string[];
	/**
	 * Shipped sounds this project can NOT rebind — an audiosprite region that no slot, symbol, tier
	 * or flow cue names. Whatever plays them is a literal in engine source, so re-skinning them means
	 * uploading a sound under the same name (see {@link overridesBuiltin}) rather than authoring
	 * anything. Each is a candidate for promotion into `SOUND_SLOTS`.
	 *
	 * Derived, not scanned. An earlier cut of this searched engine sources for string literals and
	 * was wrong twice over: it counted the `SoundName` union's own declaration and the slot
	 * catalogue's defaults as "hardcoded", and it matched names inside comments. The set below asks
	 * the question that actually matters — "can I change this from a tool?" — and answers it exactly.
	 */
	notRebindable: string[];
}

/**
 * The three checks, plus the two derived lists that make them readable — run against the LIVE
 * library so the page's answer changes as you rename, add or remove a sound.
 *
 * `hasBinding` is a predicate rather than the map itself so a caller can pass a plain
 * `Record` across the wire without rebuilding a `Map` (`devalue` does not carry one).
 *
 * `ships`, when known, is the export's own answer for a library sound (`soundReachability.ts`);
 * `unbound` and `unapprovedBound` then follow it alone, so this page and the publish gate list the
 * same drafts. Until it is known they fall back to the bindings and the built-in overrides.
 */
export function checkSoundLibrary(
	library: SoundsDoc | null | undefined,
	hasBinding: (name: string) => boolean,
	boundNames: readonly string[],
	builtinNames: readonly string[],
	ships?: (name: string) => boolean,
): SoundChecks {
	const entries = library?.entries ?? [];
	const libraryNames = new Set(entries.map((e) => e.name));
	const builtin = new Set(builtinNames);

	const overridesBuiltin = entries.filter((e) => builtin.has(e.name)).map((e) => e.name);
	const overriding = new Set(overridesBuiltin);
	const played = ships ?? ((name: string) => hasBinding(name) || overriding.has(name));

	return {
		unbound: entries.filter((e) => !played(e.name)).map((e) => e.name),
		missing: boundNames.filter((n) => !libraryNames.has(n) && !builtin.has(n)).sort(),
		unapprovedBound: entries.filter((e) => e.status !== 'approved' && played(e.name)).map((e) => e.name), // prettier-ignore
		overridesBuiltin,
		notRebindable: [...builtin].filter((n) => !hasBinding(n)).sort(),
	};
}

/**
 * Licence strings that describe audio we may not ship in a commercial game.
 *
 * A HEURISTIC over free text, and treated as one: it produces a warning, never a block. Blocking a
 * publish on a substring match would eventually stop a legitimate release over the word "commercial"
 * appearing in a licence name, and a gate people learn to override is worse than a note they read.
 */
const NON_COMMERCIAL = /non-?commercial|\bCC[\s-]?BY[\s-]?NC\b|[\s-]NC[\s-]|research[\s-]only/i;

export interface SoundLicenceSummary {
	/** Project sounds that something plays — the only ones whose licence can matter. */
	bound: number;
	/** Bound sounds with no licence recorded at all. */
	missingLicence: string[];
	/** Bound sounds whose licence text reads as non-commercial. */
	nonCommercial: string[];
	/** Licence text → the bound sounds carrying it, for the "what are we shipping" line. */
	byLicence: { licence: string; names: string[] }[];
}

/**
 * What this publish is about to ship, licence-wise. Surfaced ONCE on the publish result rather than
 * nagging in the tool: the moment a build goes out is when "who owns this audio" stops being
 * paperwork, and it is the only moment at which everyone involved is looking.
 *
 * Only BOUND sounds count. An unplayed file in the library ships nothing and owes nobody.
 */
export function summariseSoundLicences(
	library: SoundsDoc | null | undefined,
	isPlayed: (name: string) => boolean,
): SoundLicenceSummary {
	const bound = (library?.entries ?? []).filter((e) => isPlayed(e.name));
	const byLicence = new Map<string, string[]>();
	for (const entry of bound) {
		const licence = entry.license?.trim();
		if (!licence) continue;
		byLicence.set(licence, [...(byLicence.get(licence) ?? []), entry.name]);
	}
	return {
		bound: bound.length,
		missingLicence: bound.filter((e) => !e.license?.trim()).map((e) => e.name),
		nonCommercial: bound.filter((e) => NON_COMMERCIAL.test(e.license ?? '')).map((e) => e.name),
		byLicence: [...byLicence.entries()].map(([licence, names]) => ({ licence, names })),
	};
}
