/**
 * Shared timelines (Rive plan Phase 9d, `docs/design/rive-style-editor.md` §3.3 item 3): a timeline
 * promoted to `_shared/cinematics/` that any project can place. Pure — the server storage
 * (`$lib/server/sharedCinematics.ts`), the Timeline panel and the gates all use it.
 *
 * - **Shared doc**: a portable timeline at `_shared/cinematics/<id>.json`, with a `version`; every
 *   version is also kept as `<id>.v<N>.json`. It has no host and no trigger: those belong to where
 *   it is placed. Node actors bind by node NAME, so it plays on any host with nodes of those names.
 * - **Link**: a project timeline whose `shared` field names a shared id and the version it pins. It
 *   stores only what belongs to the placement (its own id, name, host, `playOn`, reuse, `holdsCue`)
 *   and, in `shared.targets`, which host node each shared actor drives. Its content is read from
 *   the pinned version wherever it is opened or baked ({@link resolveLinked}), so the bundle ships
 *   a normal timeline and the game never sees a link.
 * - **Update available**: the shared doc's latest version is newer than the pin. *Update* re-pins;
 *   *Detach* copies the resolved content into the project and drops the link.
 * - **Starters** ({@link STARTER_TIMELINES}): built-in shared timelines at version 1, listed with
 *   the shared library. A promote under a starter's id would shadow it, so promotes never use one.
 */
import type { CinematicDoc } from 'engine-layout';

/** A project timeline's link to a shared one. */
export interface SharedTimelineLink {
	/** The shared timeline's id under `_shared/cinematics/`. */
	id: string;
	/** The version this placement plays. */
	version: number;
	/** Shared actor target → the host node it drives here. Absent ⇒ the shared names as they are. */
	targets?: Record<string, string>;
}

/** A shared timeline: a portable doc with a version. */
export type SharedTimelineDoc = CinematicDoc & { version: number; starter?: boolean };

export interface SharedTimelineSummary {
	id: string;
	name: string;
	version: number;
	duration: number;
	/** The node names its actors target (what a placement binds). */
	targets: string[];
	starter?: boolean;
	updatedAt: string | null;
}

/** The fields that belong to a placement, never to the shared content. */
const PLACEMENT_FIELDS = [
	'id',
	'name',
	'host',
	'playOn',
	'playOnComponents',
	'holdsCue',
	'shared',
] as const;

export const STARTER_PREFIX = 'starter_';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** A link's shape, or null (a doc with a malformed `shared` is treated as unlinked). */
export function linkOf(doc: { shared?: unknown } | null | undefined): SharedTimelineLink | null {
	const link = doc?.shared;
	if (!isRecord(link) || typeof link.id !== 'string' || !link.id) return null;
	if (typeof link.version !== 'number' || !Number.isInteger(link.version) || link.version < 1)
		return null;
	const out: SharedTimelineLink = { id: link.id, version: link.version };
	if (isRecord(link.targets)) {
		const targets: Record<string, string> = {};
		for (const [from, to] of Object.entries(link.targets))
			if (typeof to === 'string' && to) targets[from] = to;
		if (Object.keys(targets).length) out.targets = targets;
	}
	return out;
}

/** The node names a timeline's node actors target, in cast order. */
export function actorTargets(doc: CinematicDoc): string[] {
	const out: string[] = [];
	for (const cast of doc.stage?.cast ?? [])
		if (cast.kind === 'node' && cast.target && !out.includes(cast.target)) out.push(cast.target);
	return out;
}

/** A shared id from a name: lowercase slug, never a starter's. */
export function sharedTimelineId(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48);
	const id = slug || 'timeline';
	return id.startsWith(STARTER_PREFIX) ? `shared_${id}` : id;
}

/**
 * The content a promote writes: the doc without its placement fields, under the shared id and
 * name, at `version`. A promote from a link is refused by the caller (it would copy a copy).
 */
export function toSharedContent(
	doc: CinematicDoc,
	sharedId: string,
	name: string,
	version: number,
): SharedTimelineDoc {
	const out = structuredClone(doc) as unknown as Record<string, unknown>;
	for (const field of PLACEMENT_FIELDS) delete out[field];
	delete out.starter;
	return { ...(out as unknown as CinematicDoc), id: sharedId, name, version };
}

/** A doc's content (everything but its placement), as a string two docs can be compared by. */
export function contentKey(doc: CinematicDoc): string {
	const out = { ...doc } as Record<string, unknown>;
	for (const field of PLACEMENT_FIELDS) delete out[field];
	return JSON.stringify(out);
}

/** `content` (a {@link contentKey}) under `doc`'s placement fields: a link with its edits undone. */
export function withPlacement(content: string, doc: CinematicDoc): CinematicDoc {
	const out = JSON.parse(content) as Record<string, unknown>;
	for (const field of PLACEMENT_FIELDS) {
		const value = (doc as unknown as Record<string, unknown>)[field];
		if (value !== undefined) out[field] = structuredClone(value);
	}
	return out as unknown as CinematicDoc;
}

/**
 * The project doc a link is stored as: the placement's own fields and the link, with no content
 * (an empty cast and no tracks). `duration` and `fps` are kept so a listing reads sensibly.
 */
export function linkStub(placement: CinematicDoc, link: SharedTimelineLink): CinematicDoc {
	const stub: CinematicDoc = {
		schemaVersion: placement.schemaVersion ?? 1,
		id: placement.id,
		name: placement.name,
		duration: placement.duration,
		fps: placement.fps,
		stage: { sceneId: null, cast: [] },
		tracks: [],
		markers: [],
		shared: { ...link, ...(link.targets ? { targets: { ...link.targets } } : {}) },
	};
	for (const field of ['host', 'playOn', 'playOnComponents', 'holdsCue'] as const) {
		if (placement[field] !== undefined)
			(stub as unknown as Record<string, unknown>)[field] = structuredClone(placement[field]);
	}
	return stub;
}

/**
 * The timeline a link plays: the shared content at its version, under the placement's id, name,
 * host and trigger, each actor retargeted through `targets`. No `shared` field: this is what the
 * Timeline panel shows, what the bake ships, and what *Detach* saves as the project's own.
 */
export function resolveLinked(stub: CinematicDoc, shared: SharedTimelineDoc): CinematicDoc {
	const link = linkOf(stub);
	const content = structuredClone(shared) as unknown as Record<string, unknown>;
	for (const field of PLACEMENT_FIELDS) delete content[field];
	delete content.version;
	delete content.starter;
	const out = content as unknown as CinematicDoc;
	out.id = stub.id;
	out.name = stub.name;
	for (const field of ['host', 'playOn', 'playOnComponents', 'holdsCue'] as const) {
		if (stub[field] !== undefined)
			(out as unknown as Record<string, unknown>)[field] = structuredClone(stub[field]);
	}
	const targets = link?.targets ?? {};
	for (const cast of out.stage?.cast ?? []) {
		if (cast.kind === 'node' && cast.target && targets[cast.target])
			cast.target = targets[cast.target];
	}
	return out;
}

/** Whether the shared copy is newer than the version a link plays. */
export function updateAvailable(link: SharedTimelineLink | null, latest: number | null): boolean {
	return !!link && latest !== null && latest > link.version;
}

/** Whether a placed component instance pins an older version than its def's latest — shared or
 * the project's own: the canvas draws the pinned version, as the game does. */
export function componentUpdateAvailable(
	pinned: number | undefined,
	def: { version?: number } | undefined,
): boolean {
	return pinned !== undefined && typeof def?.version === 'number' && def.version > pinned;
}

// ---- starters -----------------------------------------------------------------------------------

/** The placeholder node name every starter animates; placing one binds it to a real node. */
export const STARTER_TARGET = 'Target';

const OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

function starter(
	id: string,
	name: string,
	duration: number,
	channels: Record<string, Array<{ time: number; value: number; ease?: unknown }>>,
	loop?: 'loop',
): SharedTimelineDoc {
	return {
		schemaVersion: 1,
		id: STARTER_PREFIX + id,
		name,
		version: 1,
		starter: true,
		duration,
		fps: 30,
		...(loop ? { loop } : {}),
		stage: {
			sceneId: null,
			cast: [
				{
					actorId: 'node_target',
					kind: 'node',
					target: STARTER_TARGET,
					place: { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 },
					z: 0,
				},
			],
		},
		tracks: [{ id: 'prop_target', actorId: 'node_target', kind: 'property', channels }],
		markers: [],
	};
}

/**
 * Built-in shared timelines (the old §17 presets, as real timelines). Keys are relative to the
 * node's Design pose, so each ends on the unchanged pose and plays on any node.
 */
export const STARTER_TIMELINES: readonly SharedTimelineDoc[] = [
	starter('fade_in', 'Fade in', 0.4, {
		alpha: [
			{ time: 0, value: 0, ease: 'ease' },
			{ time: 0.4, value: 1 },
		],
	}),
	starter('fade_out', 'Fade out', 0.3, {
		alpha: [
			{ time: 0, value: 1, ease: 'ease' },
			{ time: 0.3, value: 0 },
		],
	}),
	starter('pop_in', 'Pop in', 0.4, {
		scale: [
			{ time: 0, value: 0, ease: OUT },
			{ time: 0.25, value: 1.1, ease: 'ease' },
			{ time: 0.4, value: 1 },
		],
		alpha: [
			{ time: 0, value: 0, ease: 'linear' },
			{ time: 0.15, value: 1 },
		],
	}),
	starter('slide_up_in', 'Slide up in', 0.5, {
		y: [
			{ time: 0, value: 80, ease: OUT },
			{ time: 0.5, value: 0 },
		],
		alpha: [
			{ time: 0, value: 0, ease: 'linear' },
			{ time: 0.2, value: 1 },
		],
	}),
	starter(
		'pulse',
		'Pulse',
		0.6,
		{
			scale: [
				{ time: 0, value: 1, ease: 'ease' },
				{ time: 0.3, value: 1.08, ease: 'ease' },
				{ time: 0.6, value: 1 },
			],
		},
		'loop',
	),
];

/** A starter by id, at version 1 only. */
export function starterTimeline(id: string, version?: number): SharedTimelineDoc | null {
	if (version !== undefined && version !== 1) return null;
	const found = STARTER_TIMELINES.find((s) => s.id === id);
	return found ? structuredClone(found) : null;
}

export function summarizeShared(
	doc: SharedTimelineDoc,
	updatedAt: string | null,
): SharedTimelineSummary {
	return {
		id: doc.id,
		name: doc.name,
		version: doc.version,
		duration: doc.duration,
		targets: actorTargets(doc),
		...(doc.starter ? { starter: true } : {}),
		updatedAt,
	};
}
