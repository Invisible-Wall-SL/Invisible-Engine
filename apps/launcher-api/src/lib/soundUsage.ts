import { SOUND_SLOTS, resolveSounds, type GameConfigDoc } from 'game-config';
import type { SoundsDoc } from 'engine-layout';

/**
 * THE USAGE INDEX — which sounds this project actually plays, and which it only stores.
 *
 * This is the half of Invisible Sound that earns it being a tool rather than a folder. The library
 * says what exists; nothing until now could say what is USED. That gap is how `tumble_win_1…5` sat
 * in the shipped audiosprite for the whole life of the fork, listed in the Flow editor's dropdown,
 * played by nothing (`docs/status/engine.md`, 2026-08-25).
 *
 * It reads every surface that can bind a sound and reports three checks:
 *
 *  - **Unbound** — a library sound no binding names. The `tumble_win_*` class.
 *  - **Missing** — a binding naming a sound that neither the library nor the shipped audiosprite
 *    declares. Howler declines an unknown sprite key SILENTLY, so this is the only way a typo
 *    becomes visible before a player hears the gap.
 *  - **Unapproved but bound** — a draft that something plays. The publish gate (S8) will refuse
 *    these; showing them here means the author is not first told at the moment they ship.
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

/** Sound-typed enums a flow literal may carry. A cue's `name` input is `enumLit('SoundEffectName',
 *  …)` / `enumLit('MusicName', …)`, so the ENUM is what identifies a sound — not the node's `ref`,
 *  which would tie this to today's cue list and miss any node kind added later. */
const SOUND_ENUMS = new Set(['SoundName', 'SoundEffectName', 'MusicName']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every sound name a flow graph plays, with the node that plays it.
 *
 * Walks each node's `inputs` for a literal whose declared type is a sound enum, rather than looking
 * for `ref === 'soundOnce'`. Shape-agnostic on purpose: a new cue, an action, or a function call
 * that takes a sound is found without touching this.
 */
export function flowSoundBindings(flow: unknown): SoundBinding[] {
	const nodes = isRecord(flow) && Array.isArray(flow.nodes) ? flow.nodes : [];
	const out: SoundBinding[] = [];
	for (const node of nodes) {
		if (!isRecord(node) || !isRecord(node.inputs)) continue;
		for (const source of Object.values(node.inputs)) {
			if (!isRecord(source) || source.kind !== 'literal') continue;
			const type = source.type;
			if (!isRecord(type) || type.t !== 'enum' || !SOUND_ENUMS.has(String(type.name))) continue;
			if (typeof source.value !== 'string' || !source.value) continue;
			const ref = typeof node.ref === 'string' ? node.ref : String(node.kind ?? 'node');
			out.push({
				name: source.value,
				source: 'flow',
				where: `${ref} · ${String(node.id ?? '?')}`,
				href: '/flow-v2',
			});
		}
	}
	return out;
}

/** The game-wide SLOT bindings, resolved through the catalogue so an un-authored slot reports the
 *  default it actually plays rather than looking empty. */
export function slotSoundBindings(config: GameConfigDoc | null | undefined): SoundBinding[] {
	const resolved = resolveSounds(config ?? undefined);
	const out: SoundBinding[] = [];
	for (const slot of SOUND_SLOTS) {
		const { names, enabled } = resolved.slot(slot.id);
		// A silenced slot binds nothing — it is the one gesture that means "play no sound here", so
		// counting its names would report sounds the game will never ask for.
		if (!enabled) continue;
		names.forEach((name, i) => {
			out.push({
				name,
				source: 'slot',
				where: names.length > 1 ? `${slot.label} · rung ${i + 1}` : slot.label,
				href: '/config',
			});
		});
	}
	return out;
}

/** Win-tier cues — a tier's one-shot and its music bed. */
export function winTierSoundBindings(config: GameConfigDoc | null | undefined): SoundBinding[] {
	const out: SoundBinding[] = [];
	for (const tier of config?.winLevels ?? []) {
		const alias = tier?.alias ?? tier?.name ?? 'tier';
		for (const [field, name] of [
			['sfx', tier?.sound?.sfx],
			['bgm', tier?.sound?.bgm],
		] as const) {
			if (typeof name === 'string' && name) {
				out.push({ name, source: 'winTier', where: `${alias} · ${field}`, href: '/config' });
			}
		}
	}
	return out;
}

/** Per-symbol × state cues and the anticipation pair, both authored in Invisible Symbols. */
export function symbolSoundBindings(symbols: unknown): SoundBinding[] {
	const out: SoundBinding[] = [];
	if (!isRecord(symbols)) return out;

	const perSymbol = symbols.symbolSounds;
	if (isRecord(perSymbol)) {
		for (const [symbol, states] of Object.entries(perSymbol)) {
			if (!isRecord(states)) continue;
			for (const [state, name] of Object.entries(states)) {
				if (typeof name === 'string' && name) {
					out.push({ name, source: 'symbol', where: `${symbol} · ${state}`, href: '/symbols' });
				}
			}
		}
	}

	const anticipation = symbols.anticipation;
	if (isRecord(anticipation)) {
		for (const [field, label] of [
			['activationSound', 'Anticipation · activation'],
			['loopSound', 'Anticipation · loop'],
		] as const) {
			const name = anticipation[field];
			if (typeof name === 'string' && name) {
				out.push({ name, source: 'anticipation', where: label, href: '/symbols' });
			}
		}
	}
	return out;
}

/**
 * Every binding this project has, keyed by the sound name it asks for.
 *
 * Computed once, server-side: the config / symbols / flow docs are not editable from `/sound`, so
 * they cannot change while the page is open. The LIBRARY can — which is why the checks below are a
 * separate function the page re-runs on every edit. Splitting them is what keeps the index honest
 * as you rename a sound rather than only until you touch something.
 */
export function collectSoundBindings(input: {
	config: GameConfigDoc | null | undefined;
	symbols: unknown;
	flow: unknown;
}): Map<string, SoundBinding[]> {
	const bindings = [
		...slotSoundBindings(input.config),
		...winTierSoundBindings(input.config),
		...symbolSoundBindings(input.symbols),
		...flowSoundBindings(input.flow),
	];
	const byName = new Map<string, SoundBinding[]>();
	for (const binding of bindings) {
		const list = byName.get(binding.name) ?? [];
		list.push(binding);
		byName.set(binding.name, list);
	}
	return byName;
}

export interface SoundUsageInput {
	library: SoundsDoc | null | undefined;
	config: GameConfigDoc | null | undefined;
	symbols: unknown;
	flow: unknown;
	/** Names the shipped audiosprite declares — the sounds a game has without uploading anything. */
	builtinNames: readonly string[];
}

export interface SoundChecks {
	/** Library sounds nothing plays. */
	unbound: string[];
	/** Bound names that neither the library nor the audiosprite declares — an inaudible typo. */
	missing: string[];
	/** Library sounds that are bound but still drafts. */
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
 */
export function checkSoundLibrary(
	library: SoundsDoc | null | undefined,
	hasBinding: (name: string) => boolean,
	boundNames: readonly string[],
	builtinNames: readonly string[],
): SoundChecks {
	const entries = library?.entries ?? [];
	const libraryNames = new Set(entries.map((e) => e.name));
	const builtin = new Set(builtinNames);

	const overridesBuiltin = entries.filter((e) => builtin.has(e.name)).map((e) => e.name);
	const overriding = new Set(overridesBuiltin);
	const played = (name: string) => hasBinding(name) || overriding.has(name);

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

/** Bindings + checks in one call — the whole analysis, for a caller holding every doc at once. */
export function analyseSoundUsage(input: SoundUsageInput): SoundChecks & {
	byName: Map<string, SoundBinding[]>;
} {
	const byName = collectSoundBindings(input);
	const checks = checkSoundLibrary(
		input.library,
		(name) => byName.has(name),
		[...byName.keys()],
		input.builtinNames,
	);
	return { byName, ...checks };
}
