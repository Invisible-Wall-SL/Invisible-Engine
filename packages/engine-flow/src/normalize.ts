/**
 * FlowDoc normalization — the single serialize/deserialize contract for the authored
 * document (design doc `invisible-flow.md` §7/§12). Pure + dependency-free, so the same
 * coercion runs in the launcher save endpoint AND headlessly (the round-trip spike).
 *
 * It coerces arbitrary parsed/posted data into a valid {@link FlowDoc}, dropping unknown
 * fields rather than trusting them — the FlowDoc is sparse and override-friendly, so an
 * empty/invalid doc normalizes to a no-transitions doc that falls through to coded
 * behaviour (parity rule §7). Choreography sub-graphs are preserved structurally
 * (validated by node `kind`) without re-validating each leaf — the executor is the source
 * of truth for per-kind semantics, mirroring `editorStorage.normalizeNode`'s discipline.
 *
 * Round-trip invariant: `normalizeFlowDoc(normalizeFlowDoc(x)) === normalizeFlowDoc(x)`
 * structurally (idempotent), and a doc the editor produced survives save → reload byte
 * for byte modulo the stamped `updatedAt`.
 */

import type {
	ChoreographyNode,
	EventChoreography,
	FlowAccessor,
	FlowDoc,
	FlowGuard,
	FlowPayload,
	FlowPredicate,
	FlowScreen,
	FlowTransition,
	FlowTransitionEffect,
	FlowTrigger,
	FlowValue,
	ScreenChoreography,
} from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const COMPARATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']);
const CHOREO_KINDS = new Set([
	'sequence',
	'parallel',
	'broadcast',
	'delay',
	'forEach',
	'branch',
	'effect',
]);

const normalizeAccessor = (input: unknown): FlowAccessor | null => {
	if (!isRecord(input)) return null;
	switch (input.kind) {
		case 'literal':
			return { kind: 'literal', value: input.value as FlowValue };
		case 'trigger':
			return typeof input.path === 'string' ? { kind: 'trigger', path: input.path } : null;
		case 'item':
			return typeof input.path === 'string' ? { kind: 'item', path: input.path } : null;
		case 'context':
			return typeof input.path === 'string' ? { kind: 'context', path: input.path } : null;
		case 'engine':
			return typeof input.key === 'string' ? { kind: 'engine', key: input.key } : null;
		default:
			return null;
	}
};

const normalizePredicate = (input: unknown): FlowPredicate | null => {
	if (!isRecord(input)) return null;
	const left = normalizeAccessor(input.left);
	const right = normalizeAccessor(input.right);
	const op = input.op;
	if (!left || !right || typeof op !== 'string' || !COMPARATORS.has(op)) return null;
	return { left, op: op as FlowPredicate['op'], right };
};

const normalizeGuard = (input: unknown): FlowGuard | undefined => {
	if (!isRecord(input) || !Array.isArray(input.all)) return undefined;
	const all = input.all.map(normalizePredicate).filter((p): p is FlowPredicate => p !== null);
	return all.length > 0 ? { all } : undefined;
};

const normalizePayload = (input: unknown): FlowPayload | undefined => {
	if (!isRecord(input)) return undefined;
	const out: FlowPayload = {};
	for (const [key, value] of Object.entries(input)) {
		const accessor = normalizeAccessor(value);
		if (accessor) out[key] = accessor;
	}
	return Object.keys(out).length > 0 ? out : undefined;
};

const normalizeChoreography = (input: unknown): ChoreographyNode | undefined => {
	if (!isRecord(input) || typeof input.kind !== 'string' || !CHOREO_KINDS.has(input.kind)) {
		return undefined;
	}
	switch (input.kind) {
		case 'sequence':
		case 'parallel': {
			const children = Array.isArray(input.children)
				? input.children
						.map(normalizeChoreography)
						.filter((n): n is ChoreographyNode => n !== undefined)
				: [];
			return { kind: input.kind, children };
		}
		case 'broadcast': {
			if (typeof input.event !== 'string') return undefined;
			const node: Extract<ChoreographyNode, { kind: 'broadcast' }> = {
				kind: 'broadcast',
				event: input.event,
			};
			const payload = normalizePayload(input.payload);
			if (payload) node.payload = payload;
			if (typeof input.async === 'boolean') node.async = input.async;
			if (typeof input.await === 'boolean') node.await = input.await;
			return node;
		}
		case 'delay':
			return typeof input.ms === 'number' && Number.isFinite(input.ms)
				? { kind: 'delay', ms: input.ms }
				: undefined;
		case 'forEach': {
			const list = normalizeAccessor(input.list);
			const body = normalizeChoreography(input.body);
			const mode = input.mode === 'parallel' ? 'parallel' : 'sequence';
			if (!list || !body) return undefined;
			return { kind: 'forEach', list, mode, body };
		}
		case 'branch': {
			const guard = normalizeGuard(input.guard);
			const then = normalizeChoreography(input.then);
			if (!guard || !then) return undefined;
			const node: Extract<ChoreographyNode, { kind: 'branch' }> = { kind: 'branch', guard, then };
			const otherwise = normalizeChoreography(input.otherwise);
			if (otherwise) node.otherwise = otherwise;
			return node;
		}
		case 'effect': {
			if (typeof input.name !== 'string' || !input.name) return undefined;
			const node: Extract<ChoreographyNode, { kind: 'effect' }> = {
				kind: 'effect',
				name: input.name,
			};
			const payload = normalizePayload(input.payload);
			if (payload) node.payload = payload;
			return node;
		}
		default:
			return undefined;
	}
};

const normalizeScreenChoreography = (input: unknown): ScreenChoreography | undefined => {
	if (!isRecord(input)) return undefined;
	const out: ScreenChoreography = {};
	const enter = normalizeChoreography(input.enter);
	const whileNode = normalizeChoreography(input.while);
	const exit = normalizeChoreography(input.exit);
	if (enter) out.enter = enter;
	if (whileNode) out.while = whileNode;
	if (exit) out.exit = exit;
	return Object.keys(out).length > 0 ? out : undefined;
};

const normalizeScreen = (input: unknown): FlowScreen | null => {
	if (!isRecord(input)) return null;
	const id = typeof input.id === 'string' && input.id ? input.id : null;
	if (!id) return null;
	const screen: FlowScreen = { id };
	if (typeof input.label === 'string') screen.label = input.label;
	if (isRecord(input.position)) {
		const x = typeof input.position.x === 'number' ? input.position.x : 0;
		const y = typeof input.position.y === 'number' ? input.position.y : 0;
		screen.position = { x, y };
	}
	if (input.initial === true) screen.initial = true;
	if (input.gameplayHost === true) screen.gameplayHost = true;
	const choreography = normalizeScreenChoreography(input.choreography);
	if (choreography) screen.choreography = choreography;
	return screen;
};

const normalizeTrigger = (input: unknown): FlowTrigger | null => {
	if (!isRecord(input)) return null;
	switch (input.kind) {
		case 'bookEvent':
			return typeof input.event === 'string' ? { kind: 'bookEvent', event: input.event } : null;
		case 'complete':
			return { kind: 'complete' };
		case 'condition':
			return { kind: 'condition' };
		case 'signal':
			return typeof input.signal === 'string' && input.signal
				? { kind: 'signal', signal: input.signal }
				: null;
		case 'action':
			// An `action → intent` edge (design doc §8): both `pin` (source action key) and `intent`
			// (target intent key) are required — a partial edge is dropped, not stored (parity §8.8).
			return typeof input.pin === 'string' &&
				input.pin &&
				typeof input.intent === 'string' &&
				input.intent
				? { kind: 'action', pin: input.pin, intent: input.intent }
				: null;
		default:
			return null;
	}
};

const EASINGS = new Set(['linear', 'easeOut', 'easeInOut']);

/** Coerce an entrance transition — only `fade` is known; clamp `ms` ≥ 0; default easing to
 *  `linear`. Absent/invalid ⇒ `undefined` (a hard cut, parity §7). */
const normalizeTransitionEffect = (input: unknown): FlowTransitionEffect | undefined => {
	if (!isRecord(input) || input.kind !== 'fade') return undefined;
	if (typeof input.ms !== 'number' || !Number.isFinite(input.ms)) return undefined;
	const effect: FlowTransitionEffect = { kind: 'fade', ms: Math.max(0, input.ms) };
	if (typeof input.easing === 'string' && EASINGS.has(input.easing)) {
		effect.easing = input.easing as FlowTransitionEffect['easing'];
	} else {
		effect.easing = 'linear';
	}
	return effect;
};

const normalizeTransition = (input: unknown): FlowTransition | null => {
	if (!isRecord(input)) return null;
	const id = typeof input.id === 'string' && input.id ? input.id : null;
	const from = typeof input.from === 'string' && input.from ? input.from : null;
	const to = typeof input.to === 'string' && input.to ? input.to : null;
	const trigger = normalizeTrigger(input.trigger);
	if (!id || !from || !to || !trigger) return null;
	const transition: FlowTransition = { id, from, to, trigger };
	const guard = normalizeGuard(input.guard);
	if (guard) transition.guard = guard;
	if (typeof input.delayMs === 'number' && Number.isFinite(input.delayMs)) {
		transition.delayMs = input.delayMs;
	}
	if (typeof input.order === 'number' && Number.isFinite(input.order)) {
		transition.order = input.order;
	}
	const effect = normalizeTransitionEffect(input.transition);
	if (effect) transition.transition = effect;
	return transition;
};

const normalizeEvents = (input: unknown): EventChoreography[] | undefined => {
	if (!Array.isArray(input)) return undefined;
	const out: EventChoreography[] = [];
	for (const entry of input) {
		if (!isRecord(entry) || typeof entry.event !== 'string') continue;
		const choreography = normalizeChoreography(entry.choreography);
		if (choreography) out.push({ event: entry.event, choreography });
	}
	return out.length > 0 ? out : undefined;
};

/**
 * Coerce arbitrary parsed/posted data into a valid {@link FlowDoc}. Unknown fields are
 * dropped; invalid screens/transitions are skipped (never silently corrupting the doc).
 * `fallbackProjectKey` is stamped when the input carries none.
 */
export const normalizeFlowDoc = (input: unknown, fallbackProjectKey = ''): FlowDoc => {
	const obj = isRecord(input) ? input : {};
	const projectKey =
		typeof obj.projectKey === 'string' && obj.projectKey ? obj.projectKey : fallbackProjectKey;
	const screens = Array.isArray(obj.screens)
		? obj.screens.map(normalizeScreen).filter((s): s is FlowScreen => s !== null)
		: [];
	const transitions = Array.isArray(obj.transitions)
		? obj.transitions.map(normalizeTransition).filter((t): t is FlowTransition => t !== null)
		: [];
	const doc: FlowDoc = { version: 1, screens, transitions };
	if (projectKey) doc.projectKey = projectKey;
	const events = normalizeEvents(obj.events);
	if (events) doc.events = events;
	if (typeof obj.updatedAt === 'string' && obj.updatedAt) doc.updatedAt = obj.updatedAt;
	return doc;
};

/**
 * The SINGLE definition of "this FlowDoc carries authored work the interpreter can run":
 * at least one screen (mountable) or one event choreography. A doc with neither — including
 * a transitions-only doc, whose edges reference screens that don't exist — is degenerate:
 * the interpreter is inert and nothing mounts. So both the interpreter's `isActive` gate AND
 * every export/bake gate key on THIS predicate, so an un-authored project bakes no `flow`
 * slot and the game stays byte-identical to the coded path (parity §7). `transitions` is
 * deliberately excluded — counting it diverged the ship gate from `isActive` (a transitions-
 * only doc baked a slot yet ran inert). `bake-editor-doc.mjs` keeps a hand-rolled copy (it
 * can't import TS); it MUST stay in sync with this.
 */
export const isAuthoredFlow = (flow: FlowDoc | undefined | null): boolean =>
	!!flow && ((flow.screens?.length ?? 0) > 0 || (flow.events?.length ?? 0) > 0);
