import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { rgsFetcher } from 'rgs-fetcher';

export * from './types';

export const requestAuthenticate = async (options: {
	sessionID: string;
	rgsUrl: string;
	language: string;
}) => {
	const data = await rgsFetcher.post({
		rgsUrl: options.rgsUrl,
		url: '/wallet/authenticate',
		variables: {
			sessionID: options.sessionID,
			language: options.language,
		},
	});

	return data;
};

/**
 * The stock RGS protocol has no balance endpoint — balance only ever arrives alongside a wallet
 * call. Declared so the poller can be written once against one surface; returning undefined is what
 * makes it stand down for this transport rather than inventing a request.
 */
export const requestBalance = async (_options: { sessionID: string; rgsUrl: string }) => {
	void _options;
	return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };
};

/**
 * A match-3 `move` belongs to the Play4Fun facade's match-3 wire (`docs/reference/match3-wire.md`);
 * the stock RGS protocol has no such request. Declared so a match-3 game can be written once against
 * one surface; it answers with an error, without a request, rather than inventing one.
 */
export const requestMove = async (_options: {
	sessionID: string;
	rgsUrl: string;
	from: { reel: number; row: number };
	to: { reel: number; row: number };
}) => {
	void _options;
	const text = 'this RGS protocol has no match-3 move';
	return {
		status: { statusCode: 'ERR_UNSUPPORTED' as const, statusMessage: text },
		round: undefined,
		balance: undefined,
		error: text,
		message: text,
	};
};

export const requestEndRound = async (options: { sessionID: string; rgsUrl: string }) => {
	const data = await rgsFetcher.post({
		rgsUrl: options.rgsUrl,
		url: '/wallet/end-round',
		variables: {
			sessionID: options.sessionID,
		},
	});

	return data;
};

export const requestEndEvent = async (options: {
	sessionID: string;
	eventIndex: number;
	rgsUrl: string;
}) => {
	const data = await rgsFetcher.post({
		rgsUrl: options.rgsUrl,
		url: '/bet/event',
		variables: {
			sessionID: options.sessionID,
			event: `${options.eventIndex}`,
		},
	});

	return data;
};

export const requestBet = async (options: {
	sessionID: string;
	currency: string;
	amount: number;
	mode: string;
	rgsUrl: string;
}) => {
	const data = await rgsFetcher.post({
		rgsUrl: options.rgsUrl,
		url: '/wallet/play',
		variables: {
			mode: options.mode,
			currency: options.currency,
			sessionID: options.sessionID,
			amount: options.amount * API_AMOUNT_MULTIPLIER,
		},
	});

	return data;
};

export const requestReplay = async (options: {
	game: string;
	version: string;
	mode: string;
	event: string;
	rgsUrl: string;
}) => {
	const data = await rgsFetcher.get({
		rgsUrl: options.rgsUrl,
		// @ts-ignore TODO: update the schema.ts
		url: `/bet/replay/${options.game}/${options.version}/${options.mode}/${options.event}`,
	});

	return data;
};
