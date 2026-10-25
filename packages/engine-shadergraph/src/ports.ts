/**
 * DECLARED PORTS: the typed inputs and outputs an author declares, on a subgraph (`subgraph.ts`) and
 * on a Custom GLSL node (`customGlsl.ts`). One shape and one set of rules for both: a port is named
 * with a word, typed float to vec4, and may carry a default.
 */

import { DIMS, type PortDef } from './nodes';
import type { PortType, SubgraphPort } from './types';

/** A subgraph call's values name its subgraph by this key, so no port may take it. */
export const SUBGRAPH_CALL = 'subgraph';
/** A subgraph (or a Custom GLSL node) has at most this many inputs, and as many outputs. */
export const SUBGRAPH_PORTS_MAX = 32;
export const SUBGRAPH_PORT_TYPES: readonly PortType[] = ['float', 'vec2', 'vec3', 'vec4'];
const PORT_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** `text` quoted for a message, cut short: a stored doc's ids can be any length. */
export const quoted = (text: unknown): string => {
	const plain = String(text);
	return JSON.stringify(plain.length > 40 ? `${plain.slice(0, 40)}…` : plain);
};

/**
 * A word a port can be named: not `subgraph` (a call's values name its subgraph by it), nor a name
 * every object answers to (`constructor`, `toString`), which an unwired call would read as a value.
 */
export const isPortId = (id: unknown): id is string =>
	typeof id === 'string' && PORT_ID.test(id) && id !== SUBGRAPH_CALL && !(id in Object.prototype);

const isPort = (port: unknown): port is SubgraphPort =>
	isRecord(port) &&
	isPortId(port.id) &&
	(SUBGRAPH_PORT_TYPES as readonly unknown[]).includes(port.type);

/** The well-formed ports on one side, as many as a node can show. */
export const portsOf = (ports: unknown): SubgraphPort[] => {
	if (!Array.isArray(ports)) return [];
	const seen = new Set<string>();
	const kept: SubgraphPort[] = [];
	for (const p of ports) {
		if (kept.length === SUBGRAPH_PORTS_MAX) break;
		if (!isPort(p) || seen.has(p.id)) continue;
		seen.add(p.id);
		kept.push(p);
	}
	return kept;
};

/** Whether `value` is a number, or `type`'s width of them. */
export const fits = (value: unknown, type: PortType): value is number | number[] =>
	(typeof value === 'number' && Number.isFinite(value)) ||
	(Array.isArray(value) &&
		value.length === DIMS[type] &&
		value.every((v) => typeof v === 'number' && Number.isFinite(v)));

/** What a port reads unwired: its default, else 0. */
export const portDefault = (port: SubgraphPort): number | readonly number[] =>
	fits(port.default, port.type) ? port.default : 0;

export const portLabel = (port: SubgraphPort): string =>
	typeof port.label === 'string' && port.label.trim() ? port.label : port.id;

/** `port` as a node's port: `unwired`, it reads its default when nothing feeds it. */
export const portDef = (port: SubgraphPort, unwired: boolean): PortDef => ({
	id: port.id,
	label: portLabel(port),
	type: port.type,
	...(unwired ? { default: portDefault(port) } : {}),
});

/**
 * What is wrong with one side's declared ports (`side` names it in the messages): not a list, more
 * than {@link SUBGRAPH_PORTS_MAX}, a port not named with a word, two of one name, a type that is not
 * float to vec4, a default that does not fit the type.
 */
export function portSideIssues(side: 'input' | 'output', ports: unknown): string[] {
	if (!Array.isArray(ports)) return [`its ${side}s are not a list`];
	if (ports.length > SUBGRAPH_PORTS_MAX)
		return [`it has ${ports.length} ${side}s, more than ${SUBGRAPH_PORTS_MAX}`];
	const issues: string[] = [];
	const seen = new Set<string>();
	for (const port of ports) {
		const id = isRecord(port) ? port.id : undefined;
		if (!isRecord(port) || !isPortId(id)) {
			issues.push(
				`an ${side} is not named with a word of up to 32 letters, digits and _ (not "${SUBGRAPH_CALL}", nor a name every object has)`,
			);
			continue;
		}
		if (seen.has(id)) issues.push(`two ${side}s are "${id}"`);
		seen.add(id);
		if (!(SUBGRAPH_PORT_TYPES as readonly unknown[]).includes(port.type))
			issues.push(
				`${side} "${id}" is a ${quoted(port.type)}, not one of ${SUBGRAPH_PORT_TYPES.join(', ')}`,
			);
		else if (port.default !== undefined && !fits(port.default, port.type as PortType))
			issues.push(
				`${side} "${id}"'s default is not ${DIMS[port.type as PortType] === 1 ? 'a number' : `1 or ${DIMS[port.type as PortType]} numbers`}`,
			);
	}
	return issues;
}
