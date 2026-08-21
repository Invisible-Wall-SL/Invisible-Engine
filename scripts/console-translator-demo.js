/**
 * Live translator demo — runs the rgs-translator-eagaming logic against the
 * REAL Hot Fruits backend, using the current tab's session.
 *
 * What this proves:
 *   - Our translator's outbound action builder produces requests the real
 *     server accepts.
 *   - Our session state (sid + seq + gid lifecycle) matches reality.
 *   - Our translateBetResponse reshapes real Play4Fun responses into the
 *     Invisible Engine format the games consume.
 *
 * Usage:
 *   1. Open https://eagaming.com/game/hot-fruits/?locale=en
 *   2. Wait for the game to load.
 *   3. F12 → Console tab → switch context dropdown from "top" to the
 *      iframe origin (the play4fun / brand iframe).
 *   4. If Chrome warns about pasting, type `allow pasting` first.
 *   5. Paste this entire file. You'll see: [translator] loaded.
 *   6. Run:  await translator.heartbeat()
 *           await translator.bet(2)            // betPerLine=2
 *           await translator.bet(2, { manual: true })
 *           await translator.collect()
 *   7. window.translator.history holds every result.
 *      Run:  copy(translator.history)   to copy and paste back to Claude.
 */

(function () {
	const sid = new URLSearchParams(location.search).get('sid')
		|| (window.gameConfig && window.gameConfig.sid)
		|| prompt('sid not auto-detected. Paste it here:');
	if (!sid) {
		console.error('[translator] no sid — aborting');
		return;
	}

	// ============================================================
	// Inlined copy of rgs-translator-eagaming (verbatim semantics).
	// We can't `import` from the package in a console paste, so the
	// implementation is duplicated here.  Keep in sync with:
	//   packages/rgs-translator-eagaming/src/{sessionState,translator,eagamingFetcher}.ts
	// ============================================================

	const createPlay4FunSessionState = (sid) => {
		let seq = 0;
		let gid = null;
		return {
			get sid() { return sid; },
			get seq() { return seq; },
			get gid() { return gid; },
			nextSeq() { const c = seq; seq = seq + 1; return c; },
			startRound() { seq = 0; gid = null; },
			bindRound(v) { gid = v; },
			endRound() { gid = null; },
			snapshot() { return { sid, seq, gid }; },
		};
	};

	const buildBetActions = ({ amount, betLinesOrConfig = 5, playContext = '' }) => {
		const betPerLine = Math.max(1, Math.round(amount / betLinesOrConfig));
		return [
			{ action: 'bet', context: [betLinesOrConfig, betPerLine] },
			{ action: 'play', context: playContext },
		];
	};
	const buildCollectAction = () => [{ action: 'collect' }];
	const buildHeartbeat = () => [];

	const computeFin = (events) => {
		let amount, payout, active = true;
		for (const e of events) {
			if (e.event === 'bet' && typeof e.context?.total === 'number') amount = e.context.total;
			if (e.event === 'gameEnd' && typeof e.context?.win === 'number') payout = e.context.win;
			if (e.event === 'gameRoundOver') active = false;
		}
		const payoutMultiplier = amount > 0 && payout != null ? payout / amount : undefined;
		return { amount, payout, payoutMultiplier, active };
	};

	const translateBetResponse = (raw, currency = 'USD') => {
		if (!raw) return { status: { statusCode: 'ERR_UE', statusMessage: 'no response' } };
		if (raw.error) return {
			status: { statusCode: raw.error.code ?? 'ERR_UE', statusMessage: raw.error.message },
			_raw: raw,
		};
		const fin = computeFin(raw.events ?? []);
		return {
			status: { statusCode: 'SUCCESS' },
			balance: { amount: raw.platform?.balance, currency },
			round: {
				roundID: raw.platform?.gameRound?.id,
				amount: fin.amount,
				payout: fin.payout,
				payoutMultiplier: fin.payoutMultiplier,
				active: raw.platform?.gameRound?.updating === true && fin.active,
				state: raw.events ?? [],
			},
			_raw: raw,
		};
	};

	const createPlay4FunFetcher = (config, session) => {
		const endpoint = config.endpoint ?? '/rgs/engine';
		return {
			post: async ({ body, seqOverride, gidOverride }) => {
				const seq = seqOverride ?? session.nextSeq();
				const gid = gidOverride === null ? null : (gidOverride ?? session.gid);
				const params = new URLSearchParams();
				params.set('sid', session.sid);
				params.set('seq', String(seq));
				if (gid) params.set('gid', gid);
				const url = `${config.baseUrl}${endpoint}?${params.toString()}`;
				const res = await fetch(url, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				const rawText = await res.text();
				let parsed = null;
				try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}
				const returnedGid = parsed?.platform?.gameRound?.id;
				if (returnedGid && returnedGid !== session.gid) session.bindRound(returnedGid);
				return {
					status: res.status,
					statusText: res.statusText,
					url,
					requestBody: body,
					requestSeq: seq,
					requestGid: gid,
					response: parsed,
					rawText,
				};
			},
		};
	};

	// ============================================================
	// Public API on window.translator
	// ============================================================

	const session = createPlay4FunSessionState(sid);
	const fetcher = createPlay4FunFetcher({ baseUrl: '', sid }, session);
	const history = [];

	const log = (label, postResult, translated) => {
		const entry = {
			label,
			ts: new Date().toISOString(),
			session: session.snapshot(),
			postResult,
			translated,
		};
		history.push(entry);

		const eventNames = (postResult.response?.events ?? []).map((e) => e.event).join(', ') || '(none)';
		const balance = postResult.response?.platform?.balance;
		const win = postResult.response?.events?.find((e) => e.event === 'gameEnd')?.context?.win;
		console.log(
			`[translator] ${label.padEnd(18)} status=${postResult.status} ` +
			`seq=${postResult.requestSeq} gid=${postResult.requestGid ?? '-'} ` +
			`events=[${eventNames}] balance=${balance ?? '?'} ${win != null ? `win=${win}` : ''}`,
		);
		console.log('  → translated:', translated);
		return entry;
	};

	window.translator = {
		session,
		fetcher,
		history,

		async heartbeat() {
			const r = await fetcher.post({ body: buildHeartbeat() });
			return log('heartbeat', r, translateBetResponse(r.response));
		},

		async bet(betPerLine = 2, { betLinesOrConfig = 5, manual = false } = {}) {
			session.startRound();
			const amount = betLinesOrConfig * betPerLine;
			const r = await fetcher.post({
				body: buildBetActions({
					amount,
					betLinesOrConfig,
					playContext: manual ? null : '',
				}),
			});
			const t = translateBetResponse(r.response);
			log(`bet(${betPerLine}${manual ? ',manual' : ''})`, r, t);
			if (!manual) session.endRound();
			return t;
		},

		async collect() {
			if (!session.gid) {
				console.warn('[translator] no active gid — was previous bet manual?');
				return null;
			}
			const r = await fetcher.post({ body: buildCollectAction() });
			const t = translateBetResponse(r.response);
			log('collect', r, t);
			session.endRound();
			return t;
		},

		clear() {
			history.length = 0;
			session.endRound();
			console.log('[translator] history cleared, session reset');
		},
	};

	console.log('[translator] loaded. sid=' + sid);
	console.log('[translator] try:');
	console.log('  await translator.heartbeat()');
	console.log('  await translator.bet(2)                 // auto-collect, betPerLine=2');
	console.log('  await translator.bet(2, {manual:true})  // leaves round open');
	console.log('  await translator.collect()              // closes manual round');
	console.log('  copy(translator.history)                // export results');
})();
