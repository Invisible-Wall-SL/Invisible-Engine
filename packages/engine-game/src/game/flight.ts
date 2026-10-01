/**
 * Flights — a head that travels from a board cell to a named target (design §4.4 of
 * `docs/design/hold-and-win.md`). `flightArrive` is the cue a flight broadcasts on IMPACT, so a pot
 * bump, a level up or a number increment lands when the head does rather than when it was fired.
 * `flight` is the flight kind (`toMeter:<id>`, `toCollector`, `toTotal`, `boostBeam`), `target` the
 * layout node it flew to, `index` its place in a staggered volley.
 */
export type EmitterEventFlight = {
	type: 'flightArrive';
	flight: string;
	target: string;
	index: number;
};
