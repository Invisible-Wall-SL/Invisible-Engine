import { MUSIC_NAMES, SOUND_EFFECT_NAMES } from 'engine-flow-v2';
import {
	SOUND_NAME_PATTERN,
	findSoundByName,
	type SoundBindings,
	type SoundSlotChoice,
	type SoundsDoc,
} from 'engine-layout';
import { soundMoments, type SoundMoment } from '../../../soundMoments';
import { soundOptionsFor } from '../../../soundOptions';
import { loadGameConfigDoc } from '../../gameConfigStorage';
import { soundsDocKey } from '../../projectPaths';
import { resolveSoundBindings } from '../../soundLegacy';
import { loadSoundsDocWithEtag, saveSoundsDoc } from '../../soundsStorage';
import { AdapterError, defineOp } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf, validated } from './docs';

/**
 * Invisible Sound adapters (ADR-0011 §1), through `soundsStorage.ts`: the tool's own load and
 * `saveSoundsDoc` (one `If-Match` on the whole doc). The builder re-points the cues a template
 * already has at sounds people approved. It adds no slot, symbol row or tier, never approves a
 * sound and never un-silences a slot. The doc keeps no backup and carries no `saved_by`, so a write
 * answers with `before` and `director_ops` keeps it.
 */

const MAX_LADDER = 16;

async function loadSounds(clientKey: string, projectKey: string) {
	const loaded = await loadSoundsDocWithEtag(clientKey, projectKey);
	if (loaded.corrupt) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			"The project's sounds doc is unreadable. A person must repair it in Invisible Sound.",
		);
	}
	return loaded;
}

interface LibraryRow {
	name: string;
	kind: string;
	status: string;
	origin: string;
	loop: boolean;
}

interface MomentRow extends SoundMoment {
	/** A person silenced this slot; the agent does not undo it. */
	silenced?: true;
}

export const getDoc = defineOp<
	Record<string, never>,
	{
		library: LibraryRow[];
		builtin: { music: string[]; sfx: string[] };
		moments: MomentRow[];
		bindings: SoundBindings;
		migrated: boolean;
		baseEtag: string;
	}
>({
	tool: 'sound',
	name: 'get_doc',
	description:
		"The project's sounds: the library (name, kind, status, origin, loop), the names a cue may take (`builtin`), the moments Invisible Sound offers (`moments`: path, single or ladder, music or sfx, the defaults, and `silenced` where a person turned a slot off), the effective choices (`bindings`) and whether they are already saved in the sounds doc (`migrated`). Plus the baseEtag to hand back to sound.set_cues.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['builder'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag } = await loadSounds(clientKey, projectKey);
		const [config, bindings] = await Promise.all([
			loadGameConfigDoc(clientKey, projectKey),
			resolveSoundBindings(clientKey, projectKey, doc),
		]);
		const options = soundOptionsFor(doc);
		const effective = bindings ?? {};
		return {
			library: (doc.entries ?? []).map((e) => ({
				name: e.name,
				kind: e.kind,
				status: e.status,
				origin: e.origin,
				loop: e.loop === true,
			})),
			builtin: { music: options.music, sfx: options.sfx },
			moments: soundMoments(config).map((m): MomentRow => {
				const id = m.path.startsWith('slots.') ? m.path.slice('slots.'.length) : null;
				return id && effective.slots?.[id]?.enabled === false ? { ...m, silenced: true } : m;
			}),
			bindings: effective,
			migrated: doc.bindings !== undefined,
			baseEtag: baseOf(etag),
		};
	},
});

export interface CueChange {
	path: string;
	names: string[];
}

interface Refused {
	path: string;
	reason: string;
}

/** Why `name` may not be bound at a moment that takes music (or sfx), or `null` when it may. */
function nameProblem(doc: SoundsDoc, name: string, music: boolean): string | null {
	const entry = findSoundByName(doc, name);
	if (entry) {
		if (entry.status !== 'approved') {
			return `"${name}" is a draft; only a person approves a sound in Invisible Sound`;
		}
		return (entry.kind === 'music') === music
			? null
			: `"${name}" is ${entry.kind === 'music' ? 'music' : 'a sound effect'}, and this takes ${music ? 'music' : 'a sound effect'}`;
	}
	const sameKind: readonly string[] = music ? MUSIC_NAMES : SOUND_EFFECT_NAMES;
	if (sameKind.includes(name)) return null;
	const otherKind: readonly string[] = music ? SOUND_EFFECT_NAMES : MUSIC_NAMES;
	return otherKind.includes(name)
		? `"${name}" is ${music ? 'a sound effect' : 'music'}, and this takes ${music ? 'music' : 'a sound effect'}`
		: `"${name}" is in neither the library nor the built-in sounds`;
}

const sameNames = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((n, i) => n === b[i]);

type Before = { path: string; names: string[] | null };

/** Apply one validated cue to `bindings` in place; the old stored value, and whether it changed. */
function applyCue(
	bindings: SoundBindings,
	moment: SoundMoment,
	names: string[],
): { before: string[] | null; changed: boolean } {
	const [section, ...rest] = moment.path.split('.');
	if (section === 'slots') {
		const id = rest[0];
		const slots = (bindings.slots ??= {});
		const choice: SoundSlotChoice = { ...slots[id] };
		const before = choice.names ? [...choice.names] : null;
		if (sameNames(choice.names ?? moment.defaults ?? [], names)) return { before, changed: false };
		if (sameNames(moment.defaults ?? [], names)) delete choice.names;
		else choice.names = names;
		if (Object.keys(choice).length) slots[id] = choice;
		else delete slots[id];
		return { before, changed: true };
	}
	const name = names[0];
	if (section === 'symbols') {
		const row = ((bindings.symbols ??= {})[rest[0]] ??= {});
		const before = row[rest[1]] === undefined ? null : [row[rest[1]]];
		if (row[rest[1]] === name) return { before, changed: false };
		row[rest[1]] = name;
		return { before, changed: true };
	}
	if (section === 'anticipation') {
		const anticipation = (bindings.anticipation ??= {});
		const key = rest[0] as 'activation' | 'loop';
		const before = anticipation[key] === undefined ? null : [anticipation[key]];
		if (anticipation[key] === name) return { before, changed: false };
		anticipation[key] = name;
		return { before, changed: true };
	}
	const tier = ((bindings.winTiers ??= {})[rest[0]] ??= {});
	const key = rest[1] as 'sfx' | 'bgm';
	const before = tier[key] === undefined ? null : [tier[key]];
	if (tier[key] === name) return { before, changed: false };
	tier[key] = name;
	return { before, changed: true };
}

export const setCues = defineOp<
	{ cues: CueChange[]; baseEtag: string },
	{
		applied: CueChange[];
		unchanged: string[];
		refused: Refused[];
		before: Before[];
		migrated: boolean;
		baseEtag: string;
	}
>({
	tool: 'sound',
	name: 'set_cues',
	description:
		'Point cues that Invisible Sound already offers at approved library sounds or built-ins: `slots.<slotId>`, `symbols.<symbol>.<state or token moment>`, `anticipation.activation|loop`, `winTiers.<alias>.sfx|bgm` (all as sound.get_doc lists them). A single slot and every other path take exactly 1 name, a ladder 1 to 16; the two music beds and `winTiers.*.bgm` take music, the rest sound effects. A draft sound, a silenced slot, a path that is not a listed moment and a wrong name count are refused and listed in `refused`; the rest are saved together. `before` holds the old value at each changed path.',
	inputSchema: {
		type: 'object',
		properties: {
			cues: {
				type: 'array',
				maxItems: 64,
				items: {
					type: 'object',
					properties: {
						path: { type: 'string', minLength: 1, maxLength: 160 },
						names: {
							type: 'array',
							maxItems: MAX_LADDER,
							items: { type: 'string', pattern: SOUND_NAME_PATTERN.source },
						},
					},
					required: ['path', 'names'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['cues', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (_input, scope) => [soundsDocKey(scope.clientKey, scope.projectKey)],
	handler: async (ctx, { cues, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc } = await loadSounds(clientKey, projectKey);
		const config = await loadGameConfigDoc(clientKey, projectKey);
		const moments = new Map(soundMoments(config).map((m) => [m.path, m]));

		// Until the doc holds its own block, the legacy homes are the answer; a first save must carry
		// them over or it would silence every choice they hold.
		const migrated = doc.bindings === undefined;
		const bindings: SoundBindings = structuredClone(
			(await resolveSoundBindings(clientKey, projectKey, doc)) ?? {},
		);
		const silenced = (path: string) =>
			path.startsWith('slots.') && bindings.slots?.[path.slice('slots.'.length)]?.enabled === false;

		const applied: CueChange[] = [];
		const unchanged: string[] = [];
		const refused: Refused[] = [];
		const before: Before[] = [];
		const seen = new Set<string>();
		for (const cue of cues) {
			const refuse = (reason: string) => refused.push({ path: cue.path, reason });
			const moment = moments.get(cue.path);
			if (!moment) {
				refuse('it is not a moment Invisible Sound offers for this project (see sound.get_doc)');
				continue;
			}
			if (seen.has(cue.path)) {
				refuse('it is listed twice');
				continue;
			}
			seen.add(cue.path);
			if (silenced(cue.path)) {
				refuse('a person silenced this slot in Invisible Sound; an agent does not turn it back on');
				continue;
			}
			const [min, max] = moment.kind === 'ladder' ? [1, MAX_LADDER] : [1, 1];
			if (cue.names.length < min || cue.names.length > max) {
				refuse(
					`it takes ${min === max ? `exactly ${min} name` : `${min} to ${max} names`}, not ${cue.names.length}`,
				);
				continue;
			}
			const problem = cue.names
				.map((name) => nameProblem(doc, name, moment.music))
				.find((p) => p !== null);
			if (problem) {
				refuse(problem);
				continue;
			}
			const result = applyCue(bindings, moment, cue.names);
			if (!result.changed) {
				unchanged.push(cue.path);
				continue;
			}
			applied.push({ path: cue.path, names: cue.names });
			before.push({ path: cue.path, names: result.before });
		}
		if (applied.length === 0) {
			return { applied, unchanged, refused, before, migrated: false, baseEtag };
		}
		const saved = await validated(() =>
			saveSoundsDoc(clientKey, projectKey, { ...doc, bindings }, preconditionOf(baseEtag)),
		);
		return { applied, unchanged, refused, before, migrated, baseEtag: baseOf(saved.etag) };
	},
});

export const SOUND_OPS = [getDoc, setCues];
