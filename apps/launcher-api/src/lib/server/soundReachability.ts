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
import { SOUND_NAMES, TEMPLATE_VOCABULARIES } from 'engine-flow-v2';
import {
	STOCK_SOUND_REACH_VERSION,
	collectComponentPins,
	cueSoundOf,
	type SoundBindings,
	type StockSoundReach,
} from 'engine-layout';
import { SOUND_SLOTS } from 'game-config';
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

const SOUND_ENUMS = new Set(['SoundName', 'SoundEffectName', 'MusicName']);

/** Node `ref` → its data-ins that take a sound name, over every template's vocabulary, so a sound
 *  cue or action a template adds is covered without touching this file. */
const SOUND_INPUTS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
	const out = new Map<string, Set<string>>();
	for (const vocab of Object.values(TEMPLATE_VOCABULARIES)) {
		const decls = [
			...vocab.cues.map((c) => ({ name: c.name, params: c.payload })),
			...vocab.actions.map((a) => ({ name: a.name, params: a.params })),
		];
		for (const { name, params } of decls) {
			for (const param of params) {
				if (param.type.t !== 'enum' || !SOUND_ENUMS.has(param.type.name)) continue;
				const pins = out.get(name) ?? new Set<string>();
				pins.add(param.name);
				out.set(name, pins);
			}
		}
	}
	return out;
})();

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether a flow plays a sound whose name only exists at run time: a sound-taking data-in fed by a
 * wire or an accessor rather than a literal. Every graph is checked — the flow's own, each mode's,
 * a group's body and a library function's — because each is a `{ nodes, data }` pair.
 */
export function namesSoundAtRunTime(flow: unknown): boolean {
	let found = false;
	const visit = (value: unknown): void => {
		if (found) return;
		if (Array.isArray(value)) {
			for (const v of value) visit(v);
			return;
		}
		if (!isRecord(value)) return;
		if (Array.isArray(value.nodes)) {
			const fed = new Set<string>();
			for (const edge of Array.isArray(value.data) ? value.data : []) {
				const to = isRecord(edge) && isRecord(edge.to) ? edge.to : undefined;
				if (to) fed.add(`${String(to.node)}\u0000${String(to.pin)}`);
			}
			for (const node of value.nodes) {
				if (!isRecord(node) || typeof node.ref !== 'string') continue;
				const pins = SOUND_INPUTS.get(node.ref);
				if (!pins) continue;
				const inputs = isRecord(node.inputs) ? node.inputs : {};
				for (const pin of pins) {
					const source = inputs[pin];
					const nonLiteral = isRecord(source) && source.kind !== 'literal';
					if (nonLiteral || fed.has(`${String(node.id)}\u0000${pin}`)) {
						found = true;
						return;
					}
				}
			}
		}
		for (const v of Object.values(value)) visit(v);
	};
	visit(flow);
	return found;
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

/** The names the game's DATA can play, or `null` when a flow builds one at run time. */
export function namedSoundNames(sources: SoundSources): Set<string> | null {
	if (namesSoundAtRunTime(sources.flow) || namesSoundAtRunTime(sources.flowLibrary)) return null;
	const names = new Set<string>();
	collectSoundNames(Object.values(sources), names);
	return names;
}

/** The names the game can play: what its data names, and every engine name. `null` as above. */
export function playedSoundNames(sources: SoundSources): Set<string> | null {
	const named = namedSoundNames(sources);
	return named && withEngineNames(named);
}

/** `named` plus every name the engine's own code may play. */
export const withEngineNames = (named: ReadonlySet<string>): Set<string> =>
	new Set([...ENGINE_SOUND_NAMES, ...named]);

/**
 * The engine's stock sounds the game's data names, for the catalog (`SoundCatalog.stock`): the
 * runtime loads a stock bank only when this list, its own code or a slot default reaches it.
 * `null` in, nothing out: the runtime then loads every bank.
 */
export function stockSoundReach(named: ReadonlySet<string> | null): StockSoundReach | undefined {
	if (!named) return undefined;
	return {
		version: STOCK_SOUND_REACH_VERSION,
		names: SOUND_NAMES.filter((name) => named.has(name)).sort(),
	};
}

/** The entries to ship: those the game can play, or all of them when that is unknown. */
export function shippedSoundEntries<T extends { name: string }>(
	entries: readonly T[],
	played: ReadonlySet<string> | null,
): T[] {
	return played ? entries.filter((entry) => played.has(entry.name)) : [...entries];
}

/**
 * Load every source and answer {@link namedSoundNames}, or `null` when any source cannot be read
 * (a throw, or a cinematic the listing could not load) — the caller then ships every sound.
 *
 * `bindings` is the export's own resolution, passed in so the legacy fallback is read once.
 * `cinematics` is the runtime assemble's shared load (`ExportPass.cinematics`); a route call, which
 * has no pass, loads its own.
 */
export async function collectNamedSoundNames(
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
		return namedSoundNames({
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

/** {@link collectNamedSoundNames} plus every engine name: what the export ships, or `null`. */
export async function collectPlayedSoundNames(
	clientKey: string,
	projectKey: string,
	preloaded: { bindings?: SoundBindings; cinematics?: Promise<AuthoredCinematics> } = {},
): Promise<Set<string> | null> {
	const named = await collectNamedSoundNames(clientKey, projectKey, preloaded);
	return named && withEngineNames(named);
}
