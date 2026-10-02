/**
 * THE OPERATOR PLATFORM JACKPOT, for any mock RGS (design `docs/design/hold-and-win.md` §7 11c).
 *
 * The partner's platform carries a progressive jackpot ABOVE the game: `platform.jackpots[]
 * {id, name, value, minValue, maxValue}` on every answer (the balance heartbeat included), and on a
 * win `platform.gameRound.jackpot {winJackpotId, win}`, already inside `platform.balance`
 * (`docs/reference/play4fun-protocol.md` § "The operator platform jackpot" — read off their client,
 * owed a live confirmation). It belongs to no game kind, so it is not part of any mock: this wraps a
 * mock's `handle` and adds it on the way out. A mock without the wrapper answers byte-identically.
 *
 * Per session, like everything else on the mocks: a pool per tier that every bet grows by its
 * `contribution` (a share of the stake) and a slow drift grows between rounds (`perSecond`, the
 * other players a real operator pool has — what makes a heartbeat refresh visible). A hit pays the
 * pool, credits it to the session and starts the tier again from its seed. Hits are FORCED only:
 * `play.context = "force:platformJackpot:<tier>"`, or `…/platformJackpot?sid=&hit=<tier>` held for
 * the session's next `play` (`&when=feature` — the next `play` that is not a round's opening one,
 * i.e. inside free spins or a respin feature).
 *
 * A REPLAY (the client resending a position the inner mock already dealt, which answers it with the
 * same events) neither grows the pools again nor pays again: it is answered with the hit the first
 * answer carried. The inner mock's own balance never moves — a per-session ledger of what this paid
 * is added to every `platform.balance` passed through, refusals included.
 */

import { Readable } from 'node:stream';

/** Money is in the wire's integer credits (cents), like `platform.balance`. */
export const DEFAULT_PLATFORM_TIERS = [
	{ id: 1, name: 'Mini', seed: 1_000, contribution: 0.005, perSecond: 1, max: 5_000 },
	{ id: 2, name: 'Minor', seed: 5_000, contribution: 0.003, perSecond: 2, max: 25_000 },
	{ id: 3, name: 'Major', seed: 50_000, contribution: 0.002, perSecond: 5, max: 250_000 },
	{ id: 4, name: 'Grand', seed: 500_000, contribution: 0.001, perSecond: 10, max: 2_500_000 },
];

const FORCE_PREFIX = 'force:platformJackpot:';

/**
 * @param {{ tiers?: typeof DEFAULT_PLATFORM_TIERS, allowForce?: boolean, now?: () => number }} [opts]
 */
export function createPlatformJackpot(opts = {}) {
	const tiers = (opts.tiers ?? DEFAULT_PLATFORM_TIERS).map((t) => ({ ...t }));
	const allowForce = opts.allowForce !== false;
	const now = opts.now ?? Date.now;
	const sessions = new Map();

	const sessionFor = (sid) => {
		if (!sessions.has(sid)) {
			sessions.set(sid, {
				pools: Object.fromEntries(tiers.map((t) => [t.name, t.seed])),
				ledger: 0,
				hit: null,
				at: now(),
			});
		}
		const s = sessions.get(sid);
		const elapsed = Math.max(0, (now() - s.at) / 1000);
		s.at = now();
		for (const t of tiers)
			s.pools[t.name] = Math.min(t.max, s.pools[t.name] + t.perSecond * elapsed);
		return s;
	};
	const tierNamed = (name) =>
		tiers.find((t) => t.name.toLowerCase() === String(name ?? '').toLowerCase());
	const jackpotsOf = (s) =>
		tiers.map((t) => ({
			id: t.id,
			name: t.name,
			value: Math.floor(s.pools[t.name]),
			minValue: t.seed,
			maxValue: t.max,
		}));

	/** The mocks' own CORS answer: a credentialed request needs its origin echoed, not `*`. */
	const corsHeaders = (req) =>
		req.headers.origin
			? {
					'Access-Control-Allow-Origin': req.headers.origin,
					'Access-Control-Allow-Credentials': 'true',
					Vary: 'Origin',
				}
			: { 'Access-Control-Allow-Origin': '*' };
	const json = (req, res, status, body) => {
		const text = JSON.stringify(body);
		res.writeHead(status, {
			'Content-Type': 'application/json',
			...corsHeaders(req),
			'Content-Length': Buffer.byteLength(text),
		});
		res.end(text);
	};
	/** The hit each dealt answer carried, by session + position + what was dealt — a replay (the same
	 *  position answered with the same events, whatever `gid` it was resent under) finds it here. */
	const dealt = new Map();

	/** `…/platformJackpot?sid=&hit=<tier>[&when=feature]` — hold a hit for the session (`hit=` clears). */
	const handleHit = (req, res, url) => {
		const sid = url.searchParams.get('sid');
		if (!sid) return json(req, res, 400, { error: 'missing sid' });
		if (!allowForce)
			return json(req, res, 403, { ok: false, errors: ['forcing is off on this mock'] });
		const s = sessionFor(sid);
		const name = url.searchParams.get('hit') ?? '';
		if (!name) {
			s.hit = null;
			return json(req, res, 200, { ok: true, sid, hit: null, jackpots: jackpotsOf(s) });
		}
		const tier = tierNamed(name);
		if (!tier)
			return json(req, res, 400, { ok: false, errors: [`"${name}" is not a platform tier`] });
		s.hit = { tier: tier.name, inFeature: url.searchParams.get('when') === 'feature' };
		return json(req, res, 200, { ok: true, sid, hit: s.hit, jackpots: jackpotsOf(s) });
	};

	/** Run `inner` against `body`, capturing its answer instead of sending it. */
	const callInner = (inner, req, url, body) =>
		new Promise((resolve) => {
			const fakeReq = Readable.from([Buffer.from(body, 'utf8')]);
			Object.assign(fakeReq, { method: req.method, url: req.url, headers: req.headers });
			let status = 200;
			let headers = {};
			const fakeRes = {
				writeHead: (s, h) => {
					status = s;
					headers = h ?? {};
					return fakeRes;
				},
				setHeader: (k, v) => (headers[k] = v),
				end: (text) => resolve({ status, headers, text: text == null ? '' : String(text) }),
			};
			Promise.resolve(inner(fakeReq, fakeRes, url)).catch(() =>
				resolve({ status: 500, headers, text: '' }),
			);
		});

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
			req.on('error', reject);
		});

	/** The wrapped mock's `handle`. */
	const handle = async (req, res, url, inner) => {
		if (
			(req.method === 'POST' || req.method === 'GET') &&
			/\/platformJackpot\/?$/.test(url.pathname)
		) {
			return handleHit(req, res, url);
		}
		if (req.method !== 'POST' || !/\/rgs\/engine\/?$/.test(url.pathname))
			return inner(req, res, url);
		const sid = url.searchParams.get('sid');
		const raw = await readBody(req);
		let actions = null;
		try {
			actions = raw ? JSON.parse(raw) : [];
		} catch {
			/* the inner mock refuses it */
		}
		if (!sid || !Array.isArray(actions)) {
			const answer = await callInner(inner, req, url, raw);
			res.writeHead(answer.status, answer.headers);
			return res.end(answer.text);
		}
		const s = sessionFor(sid);
		// A forced hit rides `play.context`; the inner mock never sees the token.
		let forced = null;
		const sent = actions.map((a) => {
			if (
				a?.action === 'play' &&
				typeof a.context === 'string' &&
				a.context.startsWith(FORCE_PREFIX)
			) {
				forced = a.context.slice(FORCE_PREFIX.length);
				// `''` is what the facade sends with a play: the round closes itself as an unforced one.
				return { ...a, context: '' };
			}
			return a;
		});
		if (forced !== null && !allowForce) {
			return json(req, res, 200, {
				error: 'forcing is off on this mock',
				errorCode: 101,
				platform: {},
			});
		}
		if (forced !== null && !tierNamed(forced)) {
			return json(req, res, 200, {
				error: `force: "${forced}" is not a platform tier`,
				errorCode: 101,
				platform: {},
			});
		}
		const answer = await callInner(inner, req, url, JSON.stringify(sent));
		let body = null;
		try {
			body = answer.text ? JSON.parse(answer.text) : null;
		} catch {
			/* passed through as it came */
		}
		const accepted = answer.status === 200 && body && !body.error && body.platform;
		if (!accepted) {
			if (body?.platform && typeof body.platform.balance === 'number') {
				body.platform.balance += s.ledger;
				const text = JSON.stringify(body);
				res.writeHead(answer.status, {
					...answer.headers,
					'Content-Length': Buffer.byteLength(text),
				});
				return res.end(text);
			}
			res.writeHead(answer.status, answer.headers);
			return res.end(answer.text);
		}

		const events = Array.isArray(body.events) ? body.events : [];
		const key = [sid, url.searchParams.get('seq'), JSON.stringify(events)].join('|');
		const replay = dealt.has(key);
		const bet = events.find((e) => e.event === 'bet')?.context;
		const opens = sent.some((a) => a?.action === 'bet');
		if (!replay && opens && typeof bet?.total === 'number') {
			for (const t of tiers) {
				s.pools[t.name] = Math.min(t.max, s.pools[t.name] + bet.total * t.contribution);
			}
		}
		const plays = sent.some((a) => a?.action === 'play');
		const held = s.hit && plays && (!s.hit.inFeature || !opens) ? s.hit.tier : null;
		const tier = replay ? null : tierNamed(forced ?? held);
		let jackpot = replay ? dealt.get(key) : null;
		if (tier && plays) {
			const win = Math.floor(s.pools[tier.name]);
			s.pools[tier.name] = tier.seed;
			s.ledger += win;
			if (held) s.hit = null;
			jackpot = { winJackpotId: tier.id, win };
		}
		if (!replay) {
			dealt.set(key, jackpot);
			if (dealt.size > 2000) dealt.delete(dealt.keys().next().value);
		}
		if (jackpot) body.platform.gameRound = { ...(body.platform.gameRound ?? {}), jackpot };
		if (typeof body.platform.balance === 'number') body.platform.balance += s.ledger;
		body.platform.jackpots = jackpotsOf(s);
		const text = JSON.stringify(body);
		res.writeHead(200, { ...answer.headers, 'Content-Length': Buffer.byteLength(text) });
		return res.end(text);
	};

	return { handle, sessions, tiers };
}
