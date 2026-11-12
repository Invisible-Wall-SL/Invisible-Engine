/**
 * Which of a project's library sounds the game can PLAY — the rule `soundExport.ts` ships by, and
 * the sound sibling of `clipReachability.ts`.
 *
 * The export used to copy every library entry, drafts and unused takes included, into
 * `deploy/sounds/` and list it in the catalog. The game turns every catalogued sound into its own
 * bank at boot (`bakedSoundBanks` → one preloaded `Howl` each), so a sound nothing plays was
 * downloaded and decoded by every player.
 *
 * "Plays" is the build breakdown's "uses" (`buildBreakdown.ts`): the game data NAMES the sound.
 * Same indiscriminate walk over every string, so a name anywhere in the authored data keeps the
 * sound; over-collecting costs bytes, under-collecting costs a sound. Two additions, each a way the
 * game plays a sound that no string equals:
 *   - a timeline cue carries its sound inside the cue string (`sfx:<name>`, `music:<name>`, their
 *     `stop:` forms), read with `cueSoundOf`, the runtime's own parser;
 *   - the engine's own code plays the shipped audiosprite's names (`SOUND_NAMES`, the generated
 *     `SoundName` union every coded call site is typed against, plus the slot catalogue's
 *     defaults), and an upload under one of those names REPLACES that region with no doc naming it.
 *
 * SOURCES, each a document the runtime reads a sound name from:
 *   - the choices made in `/sound` (`SoundsDoc.bindings`, as the export resolves them — so a
 *     project that never saved there reads its legacy config and symbols choices);
 *   - the game config (legacy slots, `winLevels[].sound`, a mode's `music`) and the symbols doc
 *     (legacy `symbolSounds`, the anticipation pair), walked whole;
 *   - the layout doc (screen timelines' cues, the `win` instance's `<alias>Sfx` / `<alias>Bgm`
 *     params, a reel grid's anticipation `sound`);
 *   - every component def (built-in ◁ shared ◁ project, the latest of each) and the exact older
 *     versions the layout pins, plus the project's per-component param defaults;
 *   - the flow (its graph, its mode graphs and groups) and the shared function library;
 *   - the authored cinematics (their `sfx:` / `music:` cues and `pick` alternates).
 *
 * NOT sources, because no runtime path plays a sound from them: FX effects (an effect listens for
 * events and plays no audio), rig events (broadcast on the game bus by name; the one that sounds,
 * `wildExplode`, goes through its slot, and a skeleton event's own `audio` field is read by no
 * runtime code), win text, localization, fonts, shader graphs and art. Should one learn to play a
 * sound, it belongs in the list above — `check:sound-reachability` scans for the first two.
 *
 * UNCERTAINTY KEEPS. The answer is `null` — ship every sound — when a source cannot be read, or
 * when a flow sound cue takes its name from a wire or an accessor: a name built at run time, which
 * no walk of the data can resolve.
 */
import { SOUND_NAMES } from 'engine-flow-v2';
import { collectComponentPins, cueSoundOf, type SoundBindings } from 'engine-layout';
import { SOUND_SLOTS } from 'game-config';
import { flowSoundCues } from '../flowSoundCues';
import { loadAuthoredCinematics, type AuthoredCinematics } from './cinematicExport';
import { mapWithConcurrency } from './concurrency';
import { listComponentDefaults } from './componentDefaultsStorage';
import { listComponents, loadComponentForGame } from './componentStorage';
import { loadDoc } from './editorStorage';
import { loadFlowV2Library } from './flowV2LibraryStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSymbolsDoc } from './symbolsStorage';

/** Width for loading the pinned component versions — the same family of numbers as the clip
 *  walk's, so an assemble's in-flight request count stays something a person can reason about. */
const PIN_CONCURRENCY = 6;

/** Names the engine's own code can play with no document naming them. */
export const ENGINE_SOUND_NAMES: ReadonlySet<string> = new Set([
	...SOUND_NAMES,
	...SOUND_SLOTS.flatMap((slot) => slot.defaults),
]);

/** Each name a string can ask the sound player for: the string itself, and a cue's sound. */
export function soundNamesIn(value: string): string[] {
	const cue = cueSoundOf(value);
	return cue ? [value, cue.name] : [value];
}

/** Every sound name a value carries, however deeply nested (values only, never keys). */
export function collectSoundNames(value: unknown, into: Set<string>): void {
	if (typeof value === 'string') {
		if (value) for (const name of soundNamesIn(value)) into.add(name);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) collectSoundNames(v, into);
		return;
	}
	if (value && typeof value === 'object') {
		for (const v of Object.values(value as Record<string, unknown>)) collectSoundNames(v, into);
	}
}

/**
 * Whether a flow plays a sound whose name only exists at run time: a sound-taking data-in fed by a
 * wire, an accessor or a data edge rather than a literal. Every graph is checked (the flow's own,
 * each mode's, a group's body, a library function's) by the walk the usage index reads too.
 */
export function namesSoundAtRunTime(flow: unknown): boolean {
	return flowSoundCues(flow).some((cue) => cue.name === null);
}

/** Every document the game reads a sound name from — see the file header for why each is here. */
export interface SoundSources {
	/** `SoundsDoc.bindings`, as the export resolved it (`resolveSoundBindings`). */
	bindings?: SoundBindings;
	config?: unknown;
	symbols?: unknown;
	layout?: unknown;
	/** Every component def the game can mount, latest and pinned versions. */
	componentDefs?: readonly unknown[];
	componentDefaults?: unknown;
	flow?: unknown;
	flowLibrary?: unknown;
	cinematics?: readonly unknown[];
}

/** The names the game can play, or `null` when a flow builds one at run time (ship everything). */
export function playedSoundNames(sources: SoundSources): Set<string> | null {
	if (namesSoundAtRunTime(sources.flow) || namesSoundAtRunTime(sources.flowLibrary)) return null;
	const names = new Set(ENGINE_SOUND_NAMES);
	collectSoundNames(Object.values(sources), names);
	return names;
}

/** The entries to ship: those the game can play, or all of them when that is unknown. */
export function shippedSoundEntries<T extends { name: string }>(
	entries: readonly T[],
	played: ReadonlySet<string> | null,
): T[] {
	return played ? entries.filter((entry) => played.has(entry.name)) : [...entries];
}

/**
 * Load every source and answer {@link playedSoundNames}, or `null` when any source cannot be read
 * (a throw, or a cinematic the listing could not load) — the caller then ships every sound.
 *
 * `bindings` is the export's own resolution, passed in so the legacy fallback is read once.
 * `cinematics` is the runtime assemble's shared load (`ExportPass.cinematics`); a route call, which
 * has no pass, loads its own.
 */
export async function collectPlayedSoundNames(
	clientKey: string,
	projectKey: string,
	preloaded: { bindings?: SoundBindings; cinematics?: Promise<AuthoredCinematics> } = {},
): Promise<Set<string> | null> {
	try {
		const [layout, latestDefs, componentDefaults, config, symbols, flow, flowLibrary, cinematics] =
			await Promise.all([
				loadDoc(clientKey, projectKey),
				listComponents({ projectKey }),
				listComponentDefaults(projectKey),
				loadGameConfigDoc(clientKey, projectKey),
				loadSymbolsDoc(clientKey, projectKey),
				loadFlowV2Doc(clientKey, projectKey),
				loadFlowV2Library(),
				preloaded.cinematics ?? loadAuthoredCinematics(clientKey, projectKey),
			]);
		if (cinematics.partial) {
			console.log('[sounds] a cinematic could not be read — shipping every sound.');
			return null;
		}
		const pins = collectComponentPins(layout.scenes.flatMap((scene) => scene.nodes));
		const pinnedDefs = await mapWithConcurrency(pins, PIN_CONCURRENCY, (pin) =>
			loadComponentForGame(pin.id, projectKey, pin.version),
		);
		return playedSoundNames({
			bindings: preloaded.bindings,
			config,
			symbols,
			layout,
			componentDefs: [...latestDefs, ...pinnedDefs],
			componentDefaults,
			flow,
			flowLibrary,
			cinematics,
		});
	} catch (e) {
		console.log(`[sounds] reachability undetermined (${e}) — shipping every sound.`);
		return null;
	}
}
