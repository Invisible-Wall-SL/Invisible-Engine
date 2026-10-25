/**
 * Why a game config may not be built for delivery, or `null`. Every delivery profile carries a
 * real-money RGS, so only a slot is deliverable (`docs/design/game-families.md` §2.3, §6.3, §9 #2),
 * whatever the online publish allows:
 * - a rules-decided game has no wallet and must never reach a real-money session (its runtime also
 *   refuses a delivery profile at boot, the second wall);
 * - an RGS-decided match-3 game waits on a real provider's match-3 wire: ours is a mock extension;
 * - any other family (arcade, and any added later) has no real-money path at all.
 *
 * Fails closed: only a config with no family, or `slot`, passes. No override. Plain JS over the
 * stored fields (`family`, `outcome`) because `build-delivery.mjs` runs from a game repo's engine
 * submodule with no TypeScript loader.
 */
export const deliveryFamilyRefusal = (config) => {
	const family = config?.family;
	if (family == null || family === 'slot') return null;
	const name = family === 'match3' ? 'a match-3' : family === 'arcade' ? 'an arcade' : 'a non-slot';
	if (config.outcome === 'rules')
		return (
			`This game's config is ${name} free-play game. ` +
			'It has no wallet, so it is never built for a real-money delivery. Publish it to the test ' +
			'server from Game Maker instead.'
		);
	if (family === 'match3')
		return (
			"This game's config is a real-money match-3 game. Its wire is our test server's mock, and " +
			"live real money waits on a real provider's match-3 wire, so it is not built for delivery."
		);
	return `This game's config is ${name} game, which is never built for a real-money delivery.`;
};
