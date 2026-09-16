/**
 * Invisible Engine — Live Protocol Demo Overlay
 * by Invisible Wall SL
 *
 * Paste this into the browser console of a live Play4Fun-backed game tab
 * (e.g. https://eagaming.com/game/hot-fruits/) to inject a polished
 * presentation panel that shows the live protocol traffic side-by-side
 * with our Invisible Engine translation.
 *
 * Two views:
 *   - Executive: friendly summary of bet → server reply → engine state
 *   - Engineer: full JSON in three columns (outgoing, raw response, translated)
 *
 * Two modes:
 *   - Live   : same-origin POSTs to the real /rgs/engine endpoint
 *   - Mock   : POSTs to http://localhost:7777/rgs/engine (start mock first
 *              with: node scripts/mock-rgs-server.mjs)
 *
 * Capture sources:
 *   - Game-driven  : fetch/XHR sniffer captures spins triggered by clicking
 *                    Spin in the actual game (Live mode only)
 *   - Panel-driven : "Bet" / "Heartbeat" / "Collect" buttons inside the panel
 *
 * Usage:
 *   1. F12 → Console
 *   2. Switch the context dropdown to the game iframe origin (not "top")
 *   3. If Chrome warns: type `allow pasting`
 *   4. Paste this entire file
 *   5. Drag the panel where it suits your demo, present!
 */

(function () {
	if (window.__invisibleEngineDemo) {
		console.warn('[Invisible Engine] already loaded — toggling visibility');
		window.__invisibleEngineDemo.toggle();
		return;
	}

	// ============================================================
	// Detect session
	// ============================================================
	const sid =
		new URLSearchParams(location.search).get('sid') ||
		(window.gameConfig && window.gameConfig.sid) ||
		prompt('Could not auto-detect sid. Paste it here:');
	if (!sid) {
		console.error('[Invisible Engine] no sid — aborting');
		return;
	}

	// ============================================================
	// Translator (inlined — keep in sync with packages/rgs-translator-eagaming)
	// ============================================================
	const createSession = (sid) => {
		let seq = 0, gid = null;
		return {
			get sid() { return sid; }, get seq() { return seq; }, get gid() { return gid; },
			// seq = POSITION in the round's stored action array, so it advances by the number of
			// stored actions posted (a `bet+play` moves it by two). Keep in sync with sessionState.ts.
			takeSeq(storedActions) { const c = seq; if (storedActions > 0) seq = seq + storedActions; return c; },
			startRound() { seq = 0; gid = null; },
			bindRound(v) { gid = v; },
			endRound() { gid = null; },
		};
	};
	const buildBet = ({ betPerLine = 2, lines = 5, autoCollect = true }) => [
		{ action: 'bet', context: [lines, betPerLine] },
		{ action: 'play', context: autoCollect ? '' : null },
	];
	const buildHeartbeat = () => [];
	const buildCollect = () => [{ action: 'collect' }];

	const isError = (r) => !!r && typeof r.error === 'string' && typeof r.errorCode === 'number';
	const responseClosedRound = (r) =>
		!isError(r) && (r?.events ?? []).some((e) => e.event === 'gameRoundOver');

	const translate = (raw, currency = 'USD') => {
		if (!raw) return { status: { statusCode: 'ERR_UE', statusMessage: 'no response' } };
		if (isError(raw)) {
			return {
				status: { statusCode: `ERR_${raw.errorCode}`, statusMessage: raw.error },
				balance: typeof raw.platform?.balance === 'number'
					? { amount: raw.platform.balance, currency } : undefined,
				_raw: raw,
			};
		}
		let amount, payout, active = true;
		for (const e of raw.events ?? []) {
			if (e.event === 'bet' && typeof e.context?.total === 'number') amount = e.context.total;
			if (e.event === 'gameEnd' && typeof e.context?.win === 'number') payout = e.context.win;
			if (e.event === 'gameRoundOver') active = false;
		}
		const payoutMultiplier = amount > 0 && payout != null ? payout / amount : undefined;
		return {
			status: { statusCode: 'SUCCESS' },
			balance: { amount: raw.platform?.balance, currency },
			round: {
				roundID: raw.platform?.gameRound?.id, amount, payout, payoutMultiplier,
				active: raw.platform?.gameRound?.updating === true && active,
				state: raw.events ?? [],
			},
			_raw: raw,
		};
	};

	// ============================================================
	// State
	// ============================================================
	const state = {
		mode: 'live', // 'live' | 'mock'
		view: 'exec', // 'exec' | 'eng'
		paused: false,
		entries: [],
		session: createSession(sid),
		balance: null,
		roundCount: 0,
		mockBaseUrl: 'http://localhost:7777',
		manualMode: false,         // panel Bet uses null collect context (round stays open)
		ourActiveGid: null,        // gid of a round WE opened from the panel — Collect targets only this
		// Server returns integer credits (cents). UI dividend = display amount.
		// 100 matches what we observed: server "9990" = game UI "99.90".
		currencyDivisor: 100,
		currencyDecimals: 2,
		currencySymbol: '',        // could populate later from /authenticate response
	};

	const fmtMoney = (n) => {
		if (typeof n !== 'number') return '—';
		const v = (n / state.currencyDivisor).toLocaleString(undefined, {
			minimumFractionDigits: state.currencyDecimals,
			maximumFractionDigits: state.currencyDecimals,
		});
		return state.currencySymbol ? `${state.currencySymbol} ${v}` : v;
	};

	// ============================================================
	// Styles
	// ============================================================
	const css = `
		.ie-panel {
			position: fixed; top: 24px; right: 24px; z-index: 2147483647;
			width: 460px; max-width: calc(100vw - 48px);
			height: 640px; max-height: calc(100vh - 48px);
			background: linear-gradient(180deg, #0a0e1a 0%, #131826 100%);
			color: #e2e8f0;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
			font-size: 13px; line-height: 1.4;
			border-radius: 12px;
			border: 1px solid #1e293b;
			box-shadow: 0 30px 60px -15px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,158,255,0.08);
			display: flex; flex-direction: column; overflow: hidden;
			backdrop-filter: blur(20px);
			animation: ie-fadein 0.25s ease-out;
		}
		@keyframes ie-fadein { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
		@keyframes ie-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
		@keyframes ie-slide-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
		.ie-panel.minimized { height: 50px !important; }
		.ie-panel * { box-sizing: border-box; }

		.ie-header {
			padding: 10px 14px; display: flex; align-items: center; gap: 10px;
			background: rgba(255,255,255,0.02);
			border-bottom: 1px solid #1e293b; cursor: move; user-select: none;
			flex-shrink: 0;
		}
		.ie-brand { display: flex; flex-direction: column; flex: 1; min-width: 0; }
		.ie-brand-name {
			font-weight: 700; font-size: 13px; letter-spacing: 0.02em;
			background: linear-gradient(90deg, #4f9eff 0%, #c084fc 100%);
			-webkit-background-clip: text; background-clip: text; color: transparent;
			white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		}
		.ie-brand-sub { font-size: 10px; color: #64748b; letter-spacing: 0.05em; text-transform: uppercase; }
		.ie-icon-btn {
			background: none; border: 1px solid transparent; color: #64748b;
			width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
			display: inline-flex; align-items: center; justify-content: center;
			font-size: 14px; transition: all 0.15s;
		}
		.ie-icon-btn:hover { color: #e2e8f0; border-color: #334155; background: rgba(255,255,255,0.04); }

		.ie-statusbar {
			padding: 10px 14px; display: flex; align-items: center; gap: 14px;
			border-bottom: 1px solid #1e293b; flex-shrink: 0;
			background: rgba(0,0,0,0.2); font-size: 12px;
		}
		.ie-stat-block { display: flex; flex-direction: column; min-width: 0; }
		.ie-stat-label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
		.ie-stat-value { font-weight: 600; color: #e2e8f0; font-variant-numeric: tabular-nums; }
		.ie-stat-spacer { flex: 1; }
		.ie-rec {
			display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
			border-radius: 999px; background: rgba(255,92,92,0.1); border: 1px solid rgba(255,92,92,0.25);
			font-size: 10px; font-weight: 600; letter-spacing: 0.04em; color: #ff5c5c;
		}
		.ie-rec.paused { background: rgba(100,116,139,0.1); border-color: rgba(100,116,139,0.3); color: #94a3b8; }
		.ie-rec-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: ie-pulse 1.5s infinite; }
		.ie-rec.paused .ie-rec-dot { animation: none; }

		.ie-modeswitch {
			display: inline-flex; padding: 2px; background: #0a0e1a; border-radius: 7px; border: 1px solid #1e293b;
			font-size: 10px; font-weight: 600;
		}
		.ie-modeswitch button {
			background: none; border: none; color: #64748b; padding: 4px 9px;
			border-radius: 5px; cursor: pointer; letter-spacing: 0.04em; text-transform: uppercase;
		}
		.ie-modeswitch button.active { background: #1e293b; color: #e2e8f0; }
		.ie-modeswitch button.active.live-mode { background: rgba(255,92,92,0.15); color: #ff5c5c; }
		.ie-modeswitch button.active.mock-mode { background: rgba(80,216,144,0.15); color: #50d890; }

		.ie-toolbar {
			padding: 8px 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
			border-bottom: 1px solid #1e293b; flex-shrink: 0;
		}
		.ie-btn {
			padding: 6px 12px; border-radius: 6px; border: 1px solid #334155;
			background: linear-gradient(180deg, #1e293b 0%, #131826 100%);
			color: #e2e8f0; font-size: 12px; font-weight: 500;
			cursor: pointer; transition: all 0.15s;
		}
		.ie-btn:hover { border-color: #4f9eff; background: linear-gradient(180deg, #243246 0%, #1a2030 100%); }
		.ie-btn.primary { border-color: #4f9eff; background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%); color: white; }
		.ie-btn.primary:hover { background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%); }
		.ie-btn:disabled { opacity: 0.4; cursor: not-allowed; }

		.ie-input {
			background: #0a0e1a; border: 1px solid #1e293b; color: #e2e8f0;
			padding: 5px 8px; border-radius: 5px; font-size: 12px; width: 60px;
			font-family: ui-monospace, monospace;
		}
		.ie-input:focus { outline: none; border-color: #4f9eff; }
		.ie-check {
			display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
			color: #94a3b8; cursor: pointer; user-select: none;
		}
		.ie-check input { accent-color: #4f9eff; cursor: pointer; }
		.ie-check:has(input:checked) { color: #4f9eff; }

		.ie-viewswitch {
			margin-left: auto; display: inline-flex; padding: 2px;
			background: #0a0e1a; border-radius: 6px; border: 1px solid #1e293b;
			font-size: 11px;
		}
		.ie-viewswitch button {
			background: none; border: none; color: #64748b; padding: 4px 9px;
			border-radius: 4px; cursor: pointer;
		}
		.ie-viewswitch button.active { background: #1e293b; color: #e2e8f0; }

		.ie-body { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
		.ie-body::-webkit-scrollbar { width: 6px; }
		.ie-body::-webkit-scrollbar-track { background: transparent; }
		.ie-body::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

		.ie-empty {
			text-align: center; color: #64748b; padding: 40px 20px;
			font-style: italic; font-size: 12px;
		}
		.ie-empty kbd {
			display: inline-block; padding: 2px 6px; background: #1e293b; border-radius: 3px;
			border: 1px solid #334155; color: #e2e8f0; font-size: 11px; font-family: ui-monospace, monospace;
		}

		.ie-entry {
			background: #131826; border: 1px solid #1e293b; border-radius: 8px;
			margin-bottom: 8px; overflow: hidden;
			animation: ie-slide-in 0.2s ease-out;
		}
		.ie-entry.error { border-color: rgba(255,92,92,0.4); }
		.ie-entry.win { border-color: rgba(80,216,144,0.4); }

		.ie-entry-header {
			padding: 8px 12px; display: flex; align-items: center; gap: 10px;
			cursor: pointer; user-select: none; transition: background 0.1s;
		}
		.ie-entry-header:hover { background: rgba(255,255,255,0.02); }
		.ie-entry-tag {
			padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700;
			letter-spacing: 0.05em; text-transform: uppercase;
		}
		.ie-entry-tag.bet { background: rgba(79,158,255,0.15); color: #4f9eff; }
		.ie-entry-tag.heartbeat { background: rgba(100,116,139,0.15); color: #94a3b8; }
		.ie-entry-tag.collect { background: rgba(192,132,252,0.15); color: #c084fc; }
		.ie-entry-tag.error { background: rgba(255,92,92,0.15); color: #ff5c5c; }
		.ie-entry-tag.game { background: rgba(245,158,11,0.15); color: #f59e0b; }

		.ie-entry-summary { flex: 1; min-width: 0; font-size: 12px; }
		.ie-entry-summary .muted { color: #64748b; }
		.ie-entry-summary .win { color: #50d890; font-weight: 600; }
		.ie-entry-summary .loss { color: #94a3b8; }

		.ie-entry-time { font-size: 10px; color: #64748b; font-variant-numeric: tabular-nums; }

		.ie-entry-body { display: none; padding: 0; border-top: 1px solid #1e293b; }
		.ie-entry.expanded .ie-entry-body { display: block; }

		.ie-cols { display: grid; grid-template-columns: 1fr; gap: 0; }
		.ie-cols.eng { grid-template-columns: repeat(3, 1fr); }
		.ie-col {
			padding: 10px 12px; border-right: 1px solid #1e293b;
			display: flex; flex-direction: column; gap: 6px; min-width: 0;
		}
		.ie-col:last-child { border-right: none; }
		.ie-col-head {
			font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
			color: #64748b; display: flex; align-items: center; gap: 5px;
		}
		.ie-col-head .arrow { font-size: 12px; }
		.ie-col.outgoing .ie-col-head { color: #4f9eff; }
		.ie-col.raw .ie-col-head { color: #50d890; }
		.ie-col.translated .ie-col-head { color: #c084fc; }

		.ie-pre {
			background: #0a0e1a; border: 1px solid #1e293b; border-radius: 6px;
			padding: 8px; font-family: "JetBrains Mono", ui-monospace, monospace;
			font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
			max-height: 240px; overflow-y: auto; color: #cbd5e1;
		}
		.ie-pre::-webkit-scrollbar { width: 5px; }
		.ie-pre::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

		.ie-exec-row {
			display: flex; align-items: baseline; gap: 8px; padding: 4px 0;
			font-size: 12px; flex-wrap: wrap;
		}
		.ie-exec-row .label { font-size: 10px; color: #64748b; min-width: 90px; text-transform: uppercase; letter-spacing: 0.04em; }
		.ie-exec-row .value { font-family: ui-monospace, monospace; color: #e2e8f0; }
		.ie-exec-row .value.win { color: #50d890; font-weight: 600; }
		.ie-exec-row .value.bet { color: #4f9eff; font-weight: 600; }

		.ie-footer {
			padding: 8px 14px; border-top: 1px solid #1e293b; flex-shrink: 0;
			display: flex; align-items: center; gap: 8px;
			background: rgba(0,0,0,0.2);
		}
		.ie-hint { font-size: 10px; color: #64748b; flex: 1; }
		.ie-hint kbd { padding: 1px 5px; background: #1e293b; border-radius: 3px; border: 1px solid #334155; font-family: ui-monospace, monospace; font-size: 10px; }

		.ie-resize {
			position: absolute; bottom: 0; left: 0; width: 14px; height: 14px;
			cursor: nwse-resize;
			background: linear-gradient(225deg, transparent 50%, #334155 50%, #334155 60%, transparent 60%);
		}

		.ie-toast {
			position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
			background: #131826; border: 1px solid #4f9eff; color: #e2e8f0;
			padding: 8px 16px; border-radius: 6px; font-size: 12px; z-index: 2147483647;
			box-shadow: 0 10px 30px rgba(0,0,0,0.4);
			animation: ie-fadein 0.2s, ie-fadein 0.2s 1.5s reverse forwards;
		}
	`;

	const styleEl = document.createElement('style');
	styleEl.textContent = css;
	document.head.appendChild(styleEl);

	// ============================================================
	// DOM scaffold
	// ============================================================
	const panel = document.createElement('div');
	panel.className = 'ie-panel';
	panel.innerHTML = `
		<div class="ie-header" data-drag>
			<div class="ie-brand">
				<div class="ie-brand-name">⬡ INVISIBLE ENGINE</div>
				<div class="ie-brand-sub">Live Protocol Demo · Invisible Wall SL</div>
			</div>
			<button class="ie-icon-btn" data-action="minimize" title="Minimize">▭</button>
			<button class="ie-icon-btn" data-action="close" title="Close">✕</button>
		</div>

		<div class="ie-statusbar">
			<div class="ie-stat-block">
				<span class="ie-stat-label">Balance</span>
				<span class="ie-stat-value" data-stat="balance">—</span>
			</div>
			<div class="ie-stat-block">
				<span class="ie-stat-label">Round</span>
				<span class="ie-stat-value" data-stat="round">0</span>
			</div>
			<div class="ie-stat-block">
				<span class="ie-stat-label">SID</span>
				<span class="ie-stat-value" data-stat="sid" style="font-family: ui-monospace, monospace; font-size: 11px;">${sid.slice(0, 14)}</span>
			</div>
			<div class="ie-stat-spacer"></div>
			<div class="ie-rec" data-rec>
				<span class="ie-rec-dot"></span><span data-rec-label>REC</span>
			</div>
		</div>

		<div class="ie-toolbar">
			<div class="ie-modeswitch">
				<button data-mode="live" class="active live-mode">Live</button>
				<button data-mode="mock">Mock</button>
			</div>
			<button class="ie-btn primary" data-action="bet">Bet</button>
			<input class="ie-input" data-input="betPerLine" type="number" value="2" min="1" title="bet per line" />
			<label class="ie-check" title="Leave round open for separate Collect">
				<input type="checkbox" data-input="manual" /> manual
			</label>
			<button class="ie-btn" data-action="heartbeat">Heartbeat</button>
			<button class="ie-btn" data-action="collect" disabled>Collect</button>
			<div class="ie-viewswitch">
				<button data-view="exec" class="active">Executive</button>
				<button data-view="eng">Engineer</button>
			</div>
		</div>

		<div class="ie-body" data-body>
			<div class="ie-empty">
				No traffic yet. Click <kbd>Bet</kbd> in the panel,
				or click <strong>Spin</strong> in the game.
			</div>
		</div>

		<div class="ie-footer">
			<div class="ie-hint">
				<kbd>Space</kbd> pause/resume · <kbd>E</kbd> toggle view ·
				<kbd>Esc</kbd> close
			</div>
			<button class="ie-btn" data-action="export">Export</button>
			<button class="ie-btn" data-action="clear">Clear</button>
		</div>

		<div class="ie-resize" data-resize></div>
	`;
	document.body.appendChild(panel);

	const $ = (sel) => panel.querySelector(sel);
	const $$ = (sel) => Array.from(panel.querySelectorAll(sel));

	// ============================================================
	// Toast
	// ============================================================
	const toast = (msg) => {
		const t = document.createElement('div');
		t.className = 'ie-toast';
		t.textContent = msg;
		document.body.appendChild(t);
		setTimeout(() => t.remove(), 2000);
	};

	// ============================================================
	// HTTP transport (mode-aware)
	// ============================================================
	const baseFor = () => state.mode === 'mock' ? state.mockBaseUrl : '';
	const post = async (body) => {
		const seq = state.session.takeSeq(body.filter((e) => e.action !== 'config').length);
		const gid = state.session.gid;
		const params = new URLSearchParams();
		params.set('sid', sid);
		params.set('seq', String(seq));
		if (gid) params.set('gid', gid);
		const url = `${baseFor()}/rgs/engine?${params.toString()}`;
		const t0 = performance.now();

		const res = await fetch(url, {
			method: 'POST',
			credentials: state.mode === 'mock' ? 'omit' : 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		let parsed = null;
		try { parsed = text ? JSON.parse(text) : null; } catch {}

		const returnedGid = parsed?.platform?.gameRound?.id;
		if (returnedGid && returnedGid !== state.session.gid) {
			state.session.bindRound(returnedGid);
		}
		if (responseClosedRound(parsed)) {
			state.session.endRound();
		}

		return {
			source: 'panel',
			method: 'POST',
			url, status: res.status, statusText: res.statusText,
			requestBody: body, requestSeq: seq, requestGid: gid,
			ms: Math.round(performance.now() - t0),
			response: parsed, rawText: text, ts: Date.now(),
		};
	};

	// ============================================================
	// Sniffer (only active in Live mode)
	// ============================================================
	const captureXhr = (xhr, method, url, body, t0) => {
		if (state.paused) return;
		if (state.mode !== 'live') return;
		if (!url.includes('/rgs/engine') && !url.includes('/game/engine')) return;
		const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
		let parsed = null;
		try { parsed = text ? JSON.parse(text) : null; } catch {}

		let reqBody = null;
		try { reqBody = typeof body === 'string' ? JSON.parse(body) : body; } catch { reqBody = body; }

		ingest({
			source: 'game',
			method: String(method).toUpperCase(),
			url, status: xhr.status, statusText: xhr.statusText,
			requestBody: reqBody, requestSeq: extractParam(url, 'seq'), requestGid: extractParam(url, 'gid'),
			ms: Math.round(performance.now() - t0),
			response: parsed, rawText: text, ts: Date.now(),
		});
	};

	const extractParam = (url, key) => {
		try {
			const u = new URL(url, location.origin);
			return u.searchParams.get(key);
		} catch { return null; }
	};

	// fetch sniffer
	const origFetch = window.fetch.bind(window);
	window.fetch = async function (input, init = {}) {
		const url = typeof input === 'string' ? input : input.url;
		const method = (init.method || (input && input.method) || 'GET').toUpperCase();
		const reqBody = init.body ?? null;
		const t0 = performance.now();
		const res = await origFetch(input, init);
		try {
			if (state.mode === 'live' && !state.paused && method === 'POST'
				&& (url.includes('/rgs/engine') || url.includes('/game/engine'))) {
				const clone = res.clone();
				const text = await clone.text();
				let parsed = null;
				try { parsed = text ? JSON.parse(text) : null; } catch {}
				let body = null;
				try { body = typeof reqBody === 'string' ? JSON.parse(reqBody) : reqBody; } catch { body = reqBody; }
				ingest({
					source: 'game', method, url,
					status: res.status, statusText: res.statusText,
					requestBody: body, requestSeq: extractParam(url, 'seq'), requestGid: extractParam(url, 'gid'),
					ms: Math.round(performance.now() - t0),
					response: parsed, rawText: text, ts: Date.now(),
				});
			}
		} catch (e) { console.warn('[IE sniff fetch]', e); }
		return res;
	};

	// XHR sniffer
	const OrigXHR = window.XMLHttpRequest;
	function PatchedXHR() {
		const xhr = new OrigXHR();
		let _method = 'GET', _url = '', _body = null, _t0 = 0;
		const origOpen = xhr.open;
		xhr.open = function (m, u) { _method = m; _url = u; return origOpen.apply(xhr, arguments); };
		const origSend = xhr.send;
		xhr.send = function (b) {
			_body = b; _t0 = performance.now();
			xhr.addEventListener('loadend', () => captureXhr(xhr, _method, _url, _body, _t0));
			return origSend.apply(xhr, arguments);
		};
		return xhr;
	}
	PatchedXHR.prototype = OrigXHR.prototype;
	window.XMLHttpRequest = PatchedXHR;

	// ============================================================
	// Ingest + render
	// ============================================================
	const ingest = (entry) => {
		// Tag entry kind
		const body = Array.isArray(entry.requestBody) ? entry.requestBody : [];
		const isHb = body.length === 0;
		const hasBet = body.some((a) => a?.action === 'bet');
		const hasCollect = body.some((a) => a?.action === 'collect');
		const isErr = isError(entry.response);

		entry.kind = isErr ? 'error' : isHb ? 'heartbeat' : hasBet ? 'bet' : hasCollect ? 'collect' : 'game';
		entry.translated = translate(entry.response);

		if (entry.translated.balance) state.balance = entry.translated.balance.amount;
		if (hasBet) state.roundCount++;

		state.entries.unshift(entry);
		updateStatus();
		renderEntries();

		// Auto-bind/end round from sniffed game traffic too
		if (entry.source === 'game') {
			const returnedGid = entry.response?.platform?.gameRound?.id;
			if (returnedGid && returnedGid !== state.session.gid) state.session.bindRound(returnedGid);
			if (responseClosedRound(entry.response)) state.session.endRound();
		}

		// Update collect button — only enabled for rounds the panel opened.
		$('[data-action="collect"]').disabled = !state.ourActiveGid;
	};

	const fmtBalance = (n) => fmtMoney(n);
	const fmtTime = (ts) => new Date(ts).toLocaleTimeString();

	const updateStatus = () => {
		$('[data-stat="balance"]').textContent = fmtBalance(state.balance);
		$('[data-stat="round"]').textContent = String(state.roundCount);
		const rec = $('[data-rec]');
		const recLabel = $('[data-rec-label]');
		if (state.paused) { rec.classList.add('paused'); recLabel.textContent = 'PAUSED'; }
		else { rec.classList.remove('paused'); recLabel.textContent = 'REC'; }
	};

	const summaryFor = (entry) => {
		if (entry.kind === 'heartbeat') {
			return `<span class="muted">Heartbeat —</span> balance ${fmtMoney(entry.response?.platform?.balance)}`;
		}
		if (entry.kind === 'error') {
			return `<span style="color:#ff5c5c">${entry.response?.error ?? entry.statusText ?? 'error'}</span>`;
		}
		if (entry.kind === 'bet') {
			const bet = (entry.response?.events ?? []).find((e) => e.event === 'bet')?.context;
			const win = (entry.response?.events ?? []).find((e) => e.event === 'gameEnd')?.context?.win ?? 0;
			const total = bet?.total;
			const cls = win > 0 ? 'win' : 'loss';
			return `<span class="bet">Bet ${fmtMoney(total)}</span> · <span class="${cls}">Win ${fmtMoney(win)}</span>`;
		}
		if (entry.kind === 'collect') {
			const win = (entry.response?.events ?? []).find((e) => e.event === 'gameRoundOver')?.context?.win ?? 0;
			return `<span class="muted">Collect</span> · <span class="win">${fmtMoney(win)}</span>`;
		}
		return '<span class="muted">unknown</span>';
	};

	const renderExec = (entry) => {
		const lines = [];
		const t = entry.translated;
		const events = entry.response?.events ?? [];
		const winEv = events.find((e) => e.event === 'spinWin');
		const reels = events.find((e) => e.event === 'playedSpin')?.context;
		const bet = events.find((e) => e.event === 'bet')?.context;

		lines.push(`<div class="ie-exec-row"><span class="label">Source</span><span class="value">${entry.source === 'panel' ? 'Panel button' : 'Game (Spin)'}</span></div>`);
		lines.push(`<div class="ie-exec-row"><span class="label">Mode</span><span class="value">${state.mode === 'live' ? 'Live · ' + (location.host || 'same-origin') : 'Mock · localhost'}</span></div>`);
		if (bet) lines.push(`<div class="ie-exec-row"><span class="label">Player bet</span><span class="value bet">${fmtMoney(bet.total)} (${fmtMoney(bet.betPerLine)}/line × ${bet.paylines?.length ?? '?'} lines)</span></div>`);
		if (winEv) lines.push(`<div class="ie-exec-row"><span class="label">Server win</span><span class="value win">+${fmtMoney(winEv.context.pay)} on ${winEv.context.what} ×${winEv.context.occurs}</span></div>`);
		if (reels) lines.push(`<div class="ie-exec-row"><span class="label">Reels</span><span class="value">${reels.map((r) => r.join('·')).join(' | ')}</span></div>`);
		if (t.round) {
			lines.push(`<div class="ie-exec-row"><span class="label">Engine state</span><span class="value">${(t.round.state ?? []).length} book event(s)</span></div>`);
			if (t.round.roundID) lines.push(`<div class="ie-exec-row"><span class="label">Round ID</span><span class="value">${t.round.roundID}</span></div>`);
		}
		if (t.balance) lines.push(`<div class="ie-exec-row"><span class="label">New balance</span><span class="value">${fmtMoney(t.balance.amount)}</span></div>`);

		return `<div class="ie-cols"><div class="ie-col"><div class="ie-col-head">Translated for the operator → engine</div>${lines.join('')}</div></div>`;
	};

	const renderEng = (entry) => {
		const cols = [
			{
				cls: 'outgoing', head: '↑ Outgoing (engine intent)',
				body: JSON.stringify({
					url: entry.url,
					method: entry.method,
					seq: entry.requestSeq,
					gid: entry.requestGid,
					body: entry.requestBody,
				}, null, 2),
			},
			{
				cls: 'raw', head: '↓ Raw response (Play4Fun)',
				body: JSON.stringify(entry.response, null, 2) || entry.rawText || '(empty)',
			},
			{
				cls: 'translated', head: '⇄ Translated (engine shape)',
				body: JSON.stringify(entry.translated, null, 2),
			},
		];
		return `<div class="ie-cols eng">${cols
			.map((c) => `<div class="ie-col ${c.cls}"><div class="ie-col-head"><span class="arrow">${c.head[0]}</span> ${c.head.slice(2)}</div><pre class="ie-pre">${escapeHtml(c.body)}</pre></div>`)
			.join('')}</div>`;
	};

	const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

	const renderEntries = () => {
		const body = $('[data-body]');
		if (state.entries.length === 0) {
			body.innerHTML = `<div class="ie-empty">No traffic yet. Click <kbd>Bet</kbd> in the panel, or click <strong>Spin</strong> in the game.</div>`;
			return;
		}
		body.innerHTML = state.entries.map((e, i) => {
			const winClass = (e.response?.events ?? []).some((x) => x.event === 'spinWin') ? 'win' : '';
			const errClass = e.kind === 'error' ? 'error' : '';
			return `
				<div class="ie-entry ${winClass} ${errClass} ${e._expanded ? 'expanded' : ''}" data-idx="${i}">
					<div class="ie-entry-header">
						<span class="ie-entry-tag ${e.kind}">${e.kind}</span>
						<span class="ie-entry-summary">${summaryFor(e)}</span>
						<span class="ie-entry-time">${fmtTime(e.ts)} · ${e.ms}ms</span>
					</div>
					<div class="ie-entry-body">${state.view === 'exec' ? renderExec(e) : renderEng(e)}</div>
				</div>
			`;
		}).join('');
	};

	// Toggle entry expansion
	$('[data-body]').addEventListener('click', (ev) => {
		const header = ev.target.closest('.ie-entry-header');
		if (!header) return;
		const entry = header.closest('.ie-entry');
		const idx = Number(entry.dataset.idx);
		state.entries[idx]._expanded = !state.entries[idx]._expanded;
		renderEntries();
	});

	// ============================================================
	// Actions
	// ============================================================
	const doBet = async () => {
		const betPerLine = Math.max(1, Number($('[data-input="betPerLine"]').value) || 2);
		const manual = $('[data-input="manual"]').checked;
		state.session.startRound();
		state.ourActiveGid = null;
		try {
			const entry = await post(buildBet({ betPerLine, lines: 5, autoCollect: !manual }));
			// If the round stayed open (manual + win > 0), remember that WE opened it.
			const closed = responseClosedRound(entry.response);
			const newGid = entry.response?.platform?.gameRound?.id;
			if (manual && !closed && newGid) state.ourActiveGid = newGid;
			ingest(entry);
		} catch (err) {
			ingest({ source: 'panel', method: 'POST', url: '(error)', status: 0, statusText: String(err),
				requestBody: [], requestSeq: -1, requestGid: null, ms: 0, response: null, rawText: '', ts: Date.now() });
			toast('Bet failed: ' + err.message);
		}
	};

	const doHeartbeat = async () => {
		try {
			const entry = await post(buildHeartbeat());
			ingest(entry);
		} catch (err) { toast('Heartbeat failed: ' + err.message); }
	};

	const doCollect = async () => {
		if (!state.ourActiveGid) return toast('No round we opened — Collect only targets panel-opened rounds');
		try {
			const entry = await post(buildCollect());
			ingest(entry);
			if (responseClosedRound(entry.response) || isError(entry.response)) {
				state.ourActiveGid = null;
			}
		} catch (err) { toast('Collect failed: ' + err.message); }
	};

	$('[data-action="bet"]').addEventListener('click', doBet);
	$('[data-action="heartbeat"]').addEventListener('click', doHeartbeat);
	$('[data-action="collect"]').addEventListener('click', doCollect);
	$('[data-action="clear"]').addEventListener('click', () => {
		state.entries = []; state.roundCount = 0; state.session.endRound();
		state.ourActiveGid = null;
		$('[data-action="collect"]').disabled = true;
		updateStatus(); renderEntries(); toast('Cleared');
	});
	$('[data-action="export"]').addEventListener('click', () => {
		const data = JSON.stringify(state.entries, null, 2);
		navigator.clipboard?.writeText(data).then(() => toast('Copied to clipboard'));
	});
	$('[data-action="minimize"]').addEventListener('click', () => panel.classList.toggle('minimized'));
	$('[data-action="close"]').addEventListener('click', () => closePanel());

	// Mode switch
	$$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
		state.mode = b.dataset.mode;
		$$('[data-mode]').forEach((x) => {
			x.classList.toggle('active', x === b);
			x.classList.toggle('live-mode', x === b && state.mode === 'live');
			x.classList.toggle('mock-mode', x === b && state.mode === 'mock');
		});
		toast('Mode: ' + (state.mode === 'live' ? 'Live (real server)' : 'Mock (localhost:7777)'));
	}));

	// View switch
	$$('[data-view]').forEach((b) => b.addEventListener('click', () => {
		state.view = b.dataset.view;
		$$('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
		// expand all when switching to engineer view (more useful)
		state.entries.forEach((e) => { if (state.view === 'eng') e._expanded = true; });
		renderEntries();
	}));

	// ============================================================
	// Drag + resize
	// ============================================================
	let drag = null;
	$('[data-drag]').addEventListener('mousedown', (ev) => {
		const r = panel.getBoundingClientRect();
		drag = { ox: ev.clientX - r.left, oy: ev.clientY - r.top };
		ev.preventDefault();
	});
	let resizing = null;
	$('[data-resize]').addEventListener('mousedown', (ev) => {
		const r = panel.getBoundingClientRect();
		resizing = { sx: ev.clientX, sy: ev.clientY, sw: r.width, sh: r.height, sl: r.left, st: r.top };
		ev.preventDefault();
	});
	window.addEventListener('mousemove', (ev) => {
		if (drag) {
			panel.style.left = (ev.clientX - drag.ox) + 'px';
			panel.style.top = (ev.clientY - drag.oy) + 'px';
			panel.style.right = 'auto';
		}
		if (resizing) {
			const dx = resizing.sx - ev.clientX;
			const dy = ev.clientY - resizing.sy;
			panel.style.width = Math.max(360, resizing.sw + dx) + 'px';
			panel.style.height = Math.max(300, resizing.sh + dy) + 'px';
			panel.style.left = (resizing.sl - dx) + 'px';
			panel.style.right = 'auto';
		}
	});
	window.addEventListener('mouseup', () => { drag = null; resizing = null; });

	// ============================================================
	// Keyboard shortcuts
	// ============================================================
	const onKey = (ev) => {
		if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
		if (ev.code === 'Space') { state.paused = !state.paused; updateStatus(); ev.preventDefault(); }
		else if (ev.key.toLowerCase() === 'e') {
			const next = state.view === 'exec' ? 'eng' : 'exec';
			$$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === next));
			state.view = next;
			state.entries.forEach((e) => { if (state.view === 'eng') e._expanded = true; });
			renderEntries();
		}
		else if (ev.key === 'Escape') { closePanel(); }
	};
	window.addEventListener('keydown', onKey);

	// ============================================================
	// Lifecycle
	// ============================================================
	const closePanel = () => {
		panel.remove();
		styleEl.remove();
		window.fetch = origFetch;
		window.XMLHttpRequest = OrigXHR;
		window.removeEventListener('keydown', onKey);
		delete window.__invisibleEngineDemo;
	};

	window.__invisibleEngineDemo = {
		state,
		toggle: () => panel.style.display = panel.style.display === 'none' ? '' : 'none',
		close: closePanel,
	};

	updateStatus();
	console.log('%c⬡ INVISIBLE ENGINE  Live Protocol Demo loaded',
		'background:linear-gradient(90deg,#4f9eff,#c084fc);color:white;padding:6px 12px;border-radius:4px;font-weight:600');
})();
