import {
	describePaytableDrift,
	partnerPaytableDrift,
	symbolsInPlay,
	type GameConfigDoc,
} from 'game-config';

/**
 * Where a project's authored paytable disagrees with the partner paytable it captured — one line per
 * row, empty when it has no reference or agrees. The gate behind the online Publish and the bake's
 * game-config export (desktop publish and delivery): a game must not ship quoting prices the
 * partner's server will not pay without someone deciding it should.
 */
export const paytableDriftDetails = (doc: GameConfigDoc | null): string[] =>
	doc
		? partnerPaytableDrift(doc.symbols, symbolsInPlay(doc), doc.partnerPaytable).map(
				describePaytableDrift,
			)
		: [];

/**
 * The doc as it ships to players: without the partner reference. The game never reads it, and it is
 * the partner's table plus whatever the author typed as its source — nothing a public bundle needs.
 */
export const withoutPartnerPaytable = (doc: GameConfigDoc): GameConfigDoc => {
	const { partnerPaytable: _partner, ...shipped } = doc;
	return shipped;
};

export const paytableDriftMessage = (details: string[]): string =>
	`The paytable in Invisible Game Config disagrees with the partner paytable captured for this ` +
	`game in ${details.length} row${details.length === 1 ? '' : 's'}, so the game would quote prices ` +
	`the server does not pay. Import the capture in /config, or correct the capture.`;
