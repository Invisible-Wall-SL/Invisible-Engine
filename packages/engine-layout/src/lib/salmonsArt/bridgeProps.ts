import { bridgeOccupancy, occupancySteps } from 'engine-mechanics';

import { clearSpawnProps, setSpawnProps } from '../arcadeProps.svelte';
import { RUNTIME_BUILTIN_TIMELINES } from '../builtinTimelines';
import { registerComponentTimelines } from '../componentTimelines';
import { PROP_COMPONENTS, PROP_TIMELINES } from '../propComponents';
import type { PropZone } from '../propPieces';
import { emitComponentSignal } from '../registerComponentSignals';
import { registerComponentValues, type ValueSource } from '../registerComponentValues';
import { registerComponents } from '../registerComponents';
import type { CinematicDoc, ComponentDef } from '../types';
import { placeSalmonsBridges } from './propPlacement';

/**
 * A ROOM'S BRIDGES AS PROP COMPONENTS (`docs/design/arcade-prop-components.md` §4–§5), from the
 * art's lazy chunk so no runtime's main bundle carries the prop defs: the pieces of each
 * `bridge<i>` zone published for the play field's spawn layer (the river draws their water and
 * behind pieces, `<SpawnProps>` stands the deck cells among the players), and their inputs fed from
 * the room's state.
 */

/** A room's bridge zones: `bridge<i>`. */
const BRIDGE_ZONE = /^bridge\d+$/;

/** A number a placed prop's input follows (`registerComponentValues`), told to its subscribers. */
type NumberSource = ValueSource & { set: (value: number) => void };
function numberSource(): NumberSource {
	let value = 0;
	const runs = new Set<(value: number) => void>();
	return {
		subscribe(run) {
			runs.add(run);
			run(value);
			return () => void runs.delete(run);
		},
		set(next) {
			if (next === value) return;
			value = next;
			for (const run of [...runs]) run(value);
		},
	};
}

/** The value source a bridge zone's `occupied` input follows. */
const occupiedSource = (zone: string) => `prop.${zone}.occupied`;

/** What a room's state says of a player, as the inputs read it. */
export type BridgePlayer = { x: number; y: number; z?: number; character: string };
/** What of a room's game the inputs read: its zones and their rules (`RulesGame`). */
export type BridgeGame = Parameters<typeof bridgeOccupancy>[0];

/** A room's bridges drawn: feed them a state, read what they did (the probe's), let them go. */
export type SalmonsBridges = {
	inputs: (players: Iterable<BridgePlayer>, step: number) => void;
	probe: () => {
		occupied: Record<string, number>;
		fired: { zone: string; signal: 'stepOn' | 'stepOff'; step: number }[];
		pieces: number;
	};
	drop: () => void;
};

/** How many triggers the probe keeps. */
const FIRED_KEPT = 32;

let registered = false;
/** The prop built-ins, once a page: the defs as built-ins (a project's own shadows one), their
 *  timelines between the engine's and the project's (a registration replaces the last one). */
function registerProps(projectTimelines: readonly CinematicDoc[]) {
	if (registered) return;
	registered = true;
	registerComponents(
		Object.fromEntries(PROP_COMPONENTS.map((def): [string, ComponentDef] => [def.id, def])),
		{ builtin: true },
	);
	registerComponentTimelines([
		...RUNTIME_BUILTIN_TIMELINES,
		...PROP_TIMELINES,
		...projectTimelines,
	]);
}

/**
 * Publish the bridges of `game` for spawn layer `layer`, each on the ground `groundAt(y)` raises
 * under its row, with `def` (the seed `bridgeProp` until zone art names another). On every state,
 * {@link SalmonsBridges.inputs}: each zone's `occupied` (`engine-mechanics` `bridgeOccupancy`, from
 * the synced `x y z`) as the value source `prop.<zone>.occupied` its pieces follow, and `stepOn` /
 * `stepOff` fired scoped to the zone when that goes from 0 to more or back.
 */
export function showSalmonsBridges(
	def: ComponentDef,
	game: BridgeGame & { zones: readonly PropZone[] },
	layer: string,
	groundAt: (y: number) => number,
	projectTimelines: readonly CinematicDoc[],
): SalmonsBridges {
	registerProps(projectTimelines);
	const zones = game.zones.filter((zone) => BRIDGE_ZONE.test(zone.id));
	const occupied = new Map(zones.map((zone) => [zone.id, numberSource()]));
	const pieces = placeSalmonsBridges(def, zones, groundAt).map((piece) => {
		const zone = String(piece.params?.zone ?? '');
		return occupied.has(zone)
			? { ...piece, inputSources: { ...piece.inputSources, occupied: occupiedSource(zone) } }
			: piece;
	});
	const unregister = registerComponentValues(
		Object.fromEntries([...occupied].map(([zone, source]) => [occupiedSource(zone), source])),
	);
	setSpawnProps(layer, pieces);
	let counts: ReadonlyMap<string, number> | undefined;
	const fired: ReturnType<SalmonsBridges['probe']>['fired'] = [];
	return {
		inputs(players, step) {
			const now = bridgeOccupancy(
				game,
				[...players].map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, character: p.character })),
			);
			for (const [zone, n] of now) occupied.get(zone)?.set(n);
			const steps = occupancySteps(counts, now);
			for (const [signal, list] of [
				['stepOn', steps.on],
				['stepOff', steps.off],
			] as const)
				for (const zone of list) {
					fired.push({ zone, signal, step });
					emitComponentSignal(signal, zone);
				}
			fired.splice(0, fired.length - FIRED_KEPT);
			counts = now;
		},
		probe: () => ({
			occupied: Object.fromEntries(counts ?? []),
			fired: [...fired],
			pieces: pieces.length,
		}),
		drop() {
			unregister();
			clearSpawnProps();
		},
	};
}
