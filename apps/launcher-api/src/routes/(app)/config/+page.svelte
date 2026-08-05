<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import {
		normalizeGameConfigDoc,
		resolveBetModes,
		resolveWinLevels,
		symbolFrequencies,
		symbolsInPlay,
		validateGameConfigDoc,
		type BetModeKind,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The live config. A DENSE doc — the whole config or nothing — so it is seeded from the resolved
	 * doc (authored if present, else the template default) and PUT back whole. Everything the tool
	 * shows derives from `game-config`, the SAME package the game resolves with, so the grid can't
	 * drift from what ships.
	 */
	const initial = (data.doc ?? data.templateDefault) as GameConfigDoc;
	let doc = $state<GameConfigDoc>(structuredClone(initial));

	/** Where the loaded doc came from — the page says so, so "edit yours" vs "adopt the template" is
	 *  never ambiguous. Flips to 'authored' once a save lands. */
	let source = $state<'authored' | 'template'>(data.source);
	let savedAt = $state<string | null>(null);

	/** `$state.snapshot` because a raw `structuredClone` of a `$state` proxy throws DataCloneError. */
	let baseline = $state(JSON.stringify(initial));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);

	const snapshot = $derived($state.snapshot(doc) as GameConfigDoc);

	/** THE GATE, live: what the strips actually deal. Every "is X in play?" the page asks reads this,
	 *  never the dictionary — the one rule the whole tool exists to hold. */
	const inPlay = $derived(new Set(symbolsInPlay(snapshot)));
	const frequencies = $derived(symbolFrequencies(snapshot));
	const issues = $derived(validateGameConfigDoc(snapshot));
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(issues.filter((i) => i.severity === 'warning'));

	/** Issues whose path starts with a given prefix — lets each panel show its own problems inline. */
	const issuesFor = (prefix: string): GameConfigIssue[] =>
		issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));

	const symbolNames = $derived(Object.keys(doc.symbols));
	const gameTypes = $derived(Object.keys(doc.paddingReels));
	const maxRows = $derived(Math.max(...doc.numRows, 1));

	// ── Grid ────────────────────────────────────────────────────────────────────
	// Reel count is the spine of the config: paylines and strips are indexed by it. Changing it
	// re-shapes `numRows` (pad with the first reel's height / truncate) AND auto-GROWS the strips and
	// paylines to match, so widening the grid fills the new reels for you — no per-cell clicking, no
	// dead-end error. Only growth is automatic (see `growGridToWidth`); shrinking would drop authored
	// reels and the input fires per keystroke, so trimming stays on the explicit "Match grid" button.
	function setNumReels(n: number) {
		const next = Math.max(1, Math.floor(n) || 1);
		const fill = doc.numRows[0] ?? 3;
		doc.numReels = next;
		doc.numRows = Array.from({ length: next }, (_, i) => doc.numRows[i] ?? fill);
		growGridToWidth();
	}
	function setRows(reel: number, rows: number) {
		doc.numRows[reel] = Math.max(1, Math.floor(rows) || 1);
	}
	/** Apply one row count to every reel — the common case (a rectangular board). */
	function setAllRows(rows: number) {
		const r = Math.max(1, Math.floor(rows) || 1);
		doc.numRows = doc.numRows.map(() => r);
	}

	/**
	 * Pad every strip set and payline UP TO `numReels` — never truncates, so it is always safe to run
	 * (including on every keystroke of the reel input, where "10" passes through "1"). A new reel's
	 * strip CLONES the last existing reel (keeps the same in-play symbols) and a new payline cell
	 * REPEATS the line's last row (a straight line stays straight, rather than jagging to the top).
	 */
	function growGridToWidth() {
		const n = doc.numReels;
		for (const key of Object.keys(doc.paddingReels)) {
			const strips = doc.paddingReels[key];
			const template = strips[strips.length - 1] ?? [];
			while (strips.length < n) strips.push(template.map((cell) => ({ ...cell })));
		}
		for (const id of Object.keys(doc.paylines)) {
			const line = doc.paylines[id];
			while (line.length < n) line.push(line[line.length - 1] ?? 0);
		}
	}

	/**
	 * Any strip set or payline whose width still doesn't match `numReels` — only ever true after a
	 * SHRINK (auto-grow already handles widening) or a raw-JSON paste that arrived mismatched. Drives
	 * the "Match grid" button, the deliberate one-click fix for those, since trimming reels is real
	 * data loss the author should trigger rather than have happen mid-type.
	 */
	const gridMismatch = $derived(
		gameTypes.some((g) => (doc.paddingReels[g]?.length ?? 0) !== doc.numReels) ||
			Object.keys(doc.paylines).some((id) => doc.paylines[id].length !== doc.numReels),
	);

	/**
	 * Make every strip set and payline EXACTLY `numReels` — grow (as above) then TRUNCATE the extra
	 * reels. The explicit fix for a still-mismatched grid; unlike {@link growGridToWidth} it drops
	 * reels, which is why it is a button press and not automatic.
	 */
	function matchGridWidth() {
		growGridToWidth();
		const n = doc.numReels;
		for (const key of Object.keys(doc.paddingReels)) doc.paddingReels[key].length = n;
		for (const id of Object.keys(doc.paylines)) doc.paylines[id].length = n;
	}

	// ── Bet modes ────────────────────────────────────────────────────────────────
	// A mode has TWO halves: the math (`betModes[key]` — cost/feature/buyBonus/rtp/max_win, the
	// Stake-export shape) and the OPTIONAL presentation (`betModePresentation[key]` — kind/order/copy,
	// an Invisible-Engine extension). The presentation is stored SPARSELY, exactly like payline
	// colours: an unset field has no entry, so a config with no authored presentation is byte-identical
	// to a math-only paste-in. `resolveBetModes` folds the two into the ordered menu the game renders.
	let newBetMode = $state('');
	function addBetMode() {
		const key = newBetMode.trim();
		if (!key || doc.betModes[key]) return;
		doc.betModes[key] = { cost: 1, feature: false, buyBonus: false, rtp: doc.rtp, max_win: 5000 };
		newBetMode = '';
	}
	function removeBetMode(key: string) {
		delete doc.betModes[key];
		// Drop the presentation with it, and the whole map when it empties — the removePayline/colour
		// pattern, so a removed mode leaves nothing sparse behind.
		if (doc.betModePresentation) {
			delete doc.betModePresentation[key];
			if (!Object.keys(doc.betModePresentation).length) delete doc.betModePresentation;
		}
	}

	/** The resolved, ORDERED menu the game will build — math + presentation folded with every default
	 *  applied. Drives the read-only preview so the author sees order + derived kinds + default copy. */
	const resolvedBetModes = $derived(resolveBetModes(snapshot));

	/** The kind a mode gets when Kind is left on "auto" — mirrors `resolveBetModes` (buyBonus ⇒ buy). */
	function derivedKind(key: string): BetModeKind {
		return doc.betModes[key]?.buyBonus ? 'buy' : 'base';
	}
	/** The default button verb for a mode's effective kind — shown as the Button field's placeholder. */
	function defaultButtonHint(key: string): string {
		const kind = betModeKindValue(key) || derivedKind(key);
		return kind === 'buy' ? 'BUY' : kind === 'ante' ? 'ACTIVATE' : 'PLAY';
	}

	type BetModeTextField = 'title' | 'description' | 'button' | 'dialog' | 'betAmountLabel';

	/** The presentation entry for a mode, created on demand for a write. */
	function ensurePresentation(key: string) {
		const map = (doc.betModePresentation ??= {});
		return (map[key] ??= {});
	}
	/** Drop empty presentation state so the doc stays sparse: an entry with no kind/order/text goes,
	 *  and the map goes when it empties — keeps the live doc byte-identical to what a save persists. */
	function prunePresentation(key: string) {
		const map = doc.betModePresentation;
		if (!map) return;
		const entry = map[key];
		if (entry) {
			if (entry.text && !Object.keys(entry.text).length) delete entry.text;
			if (entry.cardParams && !Object.keys(entry.cardParams).length) delete entry.cardParams;
			if (
				!entry.kind &&
				entry.order === undefined &&
				!entry.text &&
				!entry.card &&
				!entry.cardParams
			)
				delete map[key];
		}
		if (!Object.keys(map).length) delete doc.betModePresentation;
	}

	function betModeKindValue(key: string): BetModeKind | '' {
		return doc.betModePresentation?.[key]?.kind ?? '';
	}
	function setBetModeKind(key: string, value: string) {
		if (value === 'base' || value === 'ante' || value === 'buy')
			ensurePresentation(key).kind = value;
		else {
			const entry = doc.betModePresentation?.[key];
			if (entry) delete entry.kind;
			prunePresentation(key);
		}
	}

	function betModeOrderValue(key: string): number | '' {
		return doc.betModePresentation?.[key]?.order ?? '';
	}
	function setBetModeOrder(key: string, value: string) {
		const n = value.trim() === '' ? undefined : Number(value);
		if (n !== undefined && Number.isFinite(n)) ensurePresentation(key).order = n;
		else {
			const entry = doc.betModePresentation?.[key];
			if (entry) delete entry.order;
			prunePresentation(key);
		}
	}

	/** The component id this mode's buy-feature card renders — `''` (unset) ⇒ runtime falls back to
	 *  the default `featureCard`. The palette comes from the SAME source the Scene Editor lists
	 *  (`data.components`), so a chosen id is always one a scene can actually mount. */
	function betModeCardValue(key: string): string {
		return doc.betModePresentation?.[key]?.card ?? '';
	}
	function setBetModeCard(key: string, value: string) {
		if (value) ensurePresentation(key).card = value;
		else {
			const entry = doc.betModePresentation?.[key];
			if (entry) delete entry.card;
			prunePresentation(key);
		}
	}

	// ── Per-mode card param overrides ──────────────────────────────────────────────
	// The buy-feature repeater feeds each card instance its per-mode values; `cardParams` lets a mode
	// override ANY of its card component's authored params (panel/icon/button frames, spine, tints, …),
	// so ONE shared card renders visually-distinct per mode. The editor resolves the mode's card def
	// (its picked `card`, else the default `featureCard`) and renders a typed input per AUTHORABLE param
	// (engine-fed values like title/price/icon are excluded — those aren't graphics to override here).
	const DEFAULT_CARD_ID = 'featureCard';

	/** The mode's card component def (its picked `card`, else the default `featureCard`), from the SAME
	 *  palette the picker uses — so the params shown are exactly the ones that card actually draws. */
	function cardComponentFor(key: string) {
		const id = betModeCardValue(key) || DEFAULT_CARD_ID;
		return data.components.find((c) => c.id === id);
	}
	/** The card's AUTHORABLE params — everything the source feeds (`engineProvided`) is excluded. */
	function cardAuthorableParams(key: string) {
		return (cardComponentFor(key)?.params ?? []).filter((p) => !p.engineProvided);
	}

	function betModeCardParamValue(
		key: string,
		paramKey: string,
	): string | number | boolean | undefined {
		return doc.betModePresentation?.[key]?.cardParams?.[paramKey];
	}
	/** Write (or clear) one card-param override. An empty string / undefined / NaN CLEARS it, so the
	 *  param falls back to the card's authored default (parity); numbers and booleans (incl. 0/false)
	 *  are kept as meaningful overrides. Keeps the presentation sparse via `prunePresentation`. */
	function setBetModeCardParam(
		key: string,
		paramKey: string,
		value: string | number | boolean | undefined,
	) {
		const drop =
			value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
		if (!drop) {
			const entry = ensurePresentation(key);
			(entry.cardParams ??= {})[paramKey] = value as string | number | boolean;
		} else {
			const cardParams = doc.betModePresentation?.[key]?.cardParams;
			if (cardParams) delete cardParams[paramKey];
			prunePresentation(key);
		}
	}

	/** A `color`-kind param stores a NUMBER (e.g. 0xffffff); `<input type="color">` speaks `#rrggbb`. */
	function toColorInput(value: string | number | boolean | undefined, fallback: number): string {
		const n = typeof value === 'number' ? value : fallback;
		return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
	}
	function fromColorInput(hex: string): number {
		return parseInt(hex.slice(1), 16);
	}

	function betModeTextValue(key: string, field: BetModeTextField): string {
		return doc.betModePresentation?.[key]?.text?.[field] ?? '';
	}
	function setBetModeText(key: string, field: BetModeTextField, value: string) {
		if (value) {
			const entry = ensurePresentation(key);
			(entry.text ??= {})[field] = value;
		} else {
			const text = doc.betModePresentation?.[key]?.text;
			if (text) delete text[field];
			prunePresentation(key);
		}
	}

	// ── Symbols ──────────────────────────────────────────────────────────────────
	let newSymbol = $state('');
	function addSymbol() {
		const name = newSymbol.trim();
		if (!name || doc.symbols[name]) return;
		doc.symbols[name] = {};
		newSymbol = '';
	}
	function removeSymbol(name: string) {
		delete doc.symbols[name];
	}
	function setProperties(name: string, value: string) {
		const props = value
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean);
		if (props.length) doc.symbols[name].special_properties = props;
		else delete doc.symbols[name].special_properties;
	}
	/** The paytable as an editable "count:pay, count:pay" string — the compact shape a math export
	 *  reads in, and far quicker to edit than a row-per-input grid. Parsed back to the canonical
	 *  single-entry rows on the way out. */
	function paytableText(name: string): string {
		return (doc.symbols[name].paytable ?? [])
			.map((row) => {
				const [count, pay] = Object.entries(row)[0];
				return `${count}:${pay}`;
			})
			.join(', ');
	}
	function setPaytable(name: string, value: string) {
		const rows = value
			.split(',')
			.map((pair) => pair.trim())
			.filter(Boolean)
			.flatMap((pair) => {
				const [count, pay] = pair.split(':').map((s) => s.trim());
				const c = Number(count);
				const p = Number(pay);
				return Number.isFinite(c) && c > 0 && Number.isFinite(p) ? [{ [String(c)]: p }] : [];
			});
		if (rows.length) doc.symbols[name].paytable = rows;
		else delete doc.symbols[name].paytable;
	}

	// ── Paylines ─────────────────────────────────────────────────────────────────
	let newPayline = $state('');
	function addPayline() {
		const id = newPayline.trim() || String(Object.keys(doc.paylines).length + 1);
		if (doc.paylines[id]) return;
		doc.paylines[id] = Array.from({ length: doc.numReels }, () => 0);
		newPayline = '';
	}
	function removePayline(id: string) {
		delete doc.paylines[id];
		clearPaylineColor(id);
	}

	// ── Payline colours ────────────────────────────────────────────────────────────
	// OPTIONAL per-line colour (an Invisible-Engine extension of the Stake config). When a line has
	// one, the game draws its win line in that colour AND broadcasts it so assets shown on the win can
	// tint to match — see `paylineColor()` / `stateGame.winLineColor` in the engine. Stored sparsely:
	// a line with no colour has no entry, so an un-coloured config is byte-identical to a Stake export.
	const DEFAULT_PAYLINE_COLOR = '#7ee0c0';
	function hasPaylineColor(id: string): boolean {
		return Boolean(doc.paylineColors?.[id]);
	}
	function paylineColorValue(id: string): string {
		return doc.paylineColors?.[id] ?? DEFAULT_PAYLINE_COLOR;
	}
	function setPaylineColor(id: string, value: string) {
		(doc.paylineColors ??= {})[id] = value;
	}
	function clearPaylineColor(id: string) {
		if (!doc.paylineColors) return;
		delete doc.paylineColors[id];
		if (!Object.keys(doc.paylineColors).length) delete doc.paylineColors;
	}
	/** Click a cell in the visual editor: set this line's row on this reel. The whole point of the
	 *  panel — a payline is row-indices-per-reel, unreadable as raw JSON. */
	function setPaylineCell(id: string, reel: number, row: number) {
		// A line shorter/longer than the grid (e.g. after a reel-count change) is repaired to
		// numReels so the click lands where the author sees it, keeping index and column aligned.
		const line = doc.paylines[id];
		while (line.length < doc.numReels) line.push(0);
		line.length = doc.numReels;
		line[reel] = row;
	}

	// ── Reel strips ──────────────────────────────────────────────────────────────
	// A strip is edited as free text — names separated by any whitespace or commas — because it is
	// the most data-heavy field and paste-in from the math export is the real workflow. Parsed to
	// the canonical `{ name }[]` on input.
	function stripText(gameType: string, reel: number): string {
		return (doc.paddingReels[gameType]?.[reel] ?? []).map((c) => c.name).join(' ');
	}
	function setStrip(gameType: string, reel: number, value: string) {
		const cells = value
			.split(/[\s,]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((name) => ({ name }));
		const strips = (doc.paddingReels[gameType] ??= []);
		while (strips.length <= reel) strips.push([]);
		strips[reel] = cells;
	}
	let newGameType = $state('');
	function addGameType() {
		const key = newGameType.trim();
		if (!key || doc.paddingReels[key]) return;
		doc.paddingReels[key] = Array.from({ length: doc.numReels }, () => []);
		newGameType = '';
	}
	function removeGameType(key: string) {
		delete doc.paddingReels[key];
	}

	// ── Win tiers (big-win levels) ─────────────────────────────────────────────────
	// OPTIONAL config-authored win tiers (an Invisible-Engine extension, not part of the Stake export).
	// The owner sets the COUNT, names each tier, its amount THRESHOLD (win as a multiple of the total
	// bet), its type, and — for a big tier — its intro/idle/outro spine animation. Stored SPARSELY like
	// the payline colours: the whole `winLevels` block (and the escalation flags) exist ONLY once a
	// tier is added, so an un-authored config is byte-identical to a paste-in and keeps the coded
	// win-level table + facade ladder. `resolveWinLevels` assigns each tier its 1-based level.
	let newWinTier = $state('');
	const resolvedWinTiers = $derived(resolveWinLevels(snapshot) ?? []);

	// The panel authors ONLY the big-win celebrations. The small/medium "bands" (the floor that makes
	// modest wins present as a plain count-up number) are engine plumbing an author never tunes — they
	// stay in the saved doc so the ladder is valid, but are HIDDEN here and MANAGED automatically from
	// the game type's template default.
	const defaultWinTiers = $derived(data.templateDefault?.winLevels ?? []);
	const floorBands = $derived(defaultWinTiers.filter((t) => t.type !== 'big'));
	// The big tiers, each with its REAL index into doc.winLevels, so edits address the right entry
	// past the hidden floor bands.
	const bigTierEntries = $derived(
		(doc.winLevels ?? [])
			.map((tier, index) => ({ tier, index }))
			.filter((entry) => entry.tier.type === 'big'),
	);
	const bigTierAliases = $derived(bigTierEntries.map((entry) => entry.tier.alias));
	const bigResolved = $derived(resolvedWinTiers.filter((t) => t.type === 'big'));
	const managedFloorCount = $derived((doc.winLevels ?? []).filter((t) => t.type !== 'big').length);

	/** Ensure the managed floor bands (from the template default) are present before a big tier is
	 *  added — without a low floor a modest win falls through to the first big tier and wrongly fires a
	 *  celebration. Idempotent: only prepends bands not already present, keeping them ahead of the big
	 *  tiers. */
	function ensureFloorBands() {
		if (!floorBands.length) return;
		const tiers = (doc.winLevels ??= []);
		const have = new Set(tiers.map((t) => t.alias));
		const missing = floorBands.filter((t) => !have.has(t.alias));
		if (missing.length) doc.winLevels = [...structuredClone($state.snapshot(missing)), ...tiers];
	}

	/** Add a big-win tier (the managed floor is ensured first). */
	function addBigTier() {
		ensureFloorBands();
		const tiers = (doc.winLevels ??= []);
		const alias = newWinTier.trim() || `big${bigTierEntries.length + 1}`;
		if (tiers.some((t) => t.alias === alias)) return;
		const previous = tiers[tiers.length - 1];
		tiers.push({
			alias,
			name: alias.toUpperCase(),
			threshold: previous ? previous.threshold + 10 : 10,
			type: 'big',
		});
		newWinTier = '';
	}

	/** Seed the whole default ladder (managed floor + the template's big tiers) so the author starts
	 *  from this game type's current behaviour and edits the big tiers down. */
	function loadDefaultWinTiers() {
		if (doc.winLevels?.length || !defaultWinTiers.length) return;
		doc.winLevels = structuredClone($state.snapshot(defaultWinTiers));
	}

	function removeBigTier(index: number) {
		if (!doc.winLevels) return;
		doc.winLevels.splice(index, 1);
		// No big tiers left ⇒ nothing to celebrate; drop the whole block (+ escalation) so the game
		// reverts to its default ladder rather than shipping a floor-only config.
		if (!doc.winLevels.some((t) => t.type === 'big')) {
			delete doc.winLevels;
			delete doc.escalateTiers;
			delete doc.escalateFrom;
		}
	}

	/** Reorder a big tier, skipping the hidden floor bands so only big tiers swap. */
	function moveBigTier(index: number, dir: -1 | 1) {
		const tiers = doc.winLevels;
		if (!tiers) return;
		let j = index + dir;
		while (j >= 0 && j < tiers.length && tiers[j].type !== 'big') j += dir;
		if (j < 0 || j >= tiers.length) return;
		[tiers[index], tiers[j]] = [tiers[j], tiers[index]];
	}

	// NOTE: a tier's PRESENTATION — spine bundle, intro/idle/outro animations, duration, sfx/bgm — is
	// no longer authored here. It moved to the `win` COMPONENT in the Scene Editor (spine picker +
	// animation dropdowns + duration + sound per tier), which reads these tiers by alias so the two
	// stay in sync (`docs/tools/component-editor.md`). The schema fields
	// (`animation`/`spineKey`/`durationMs`/`sound`) survive as the coded FALLBACK — an un-authored
	// component still renders byte-identically — they're just not edited from this panel.

	// Sequential escalation — a win on tier N plays each tier from the start up to N. Stored sparsely:
	// the flags only exist while escalation is on / a start is chosen.
	function setEscalate(on: boolean) {
		if (on) doc.escalateTiers = true;
		else delete doc.escalateTiers;
	}
	function setEscalateFrom(value: string) {
		if (value) doc.escalateFrom = value;
		else delete doc.escalateFrom;
	}

	// ── Raw JSON escape hatch ─────────────────────────────────────────────────────
	// A Stake config arrives as JSON from the math team; this is how it comes in and how a power
	// user checks the exact shape. "Apply" runs the SAME normalizer the server and game run, so what
	// applies here is what would save — no second interpretation.
	let rawOpen = $state(false);
	let rawText = $state('');
	let rawError = $state<string | null>(null);
	function openRaw() {
		rawText = JSON.stringify($state.snapshot(doc), null, 2);
		rawError = null;
		rawOpen = true;
	}
	function applyRaw() {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch (e) {
			rawError = `Not valid JSON: ${e instanceof Error ? e.message : e}`;
			return;
		}
		const next = normalizeGameConfigDoc(parsed);
		if (!next) {
			rawError = 'This does not describe a game — it needs a symbol dictionary and reel strips.';
			return;
		}
		doc = structuredClone(next);
		rawError = null;
		rawOpen = false;
	}

	function resetToTemplate() {
		if (!data.templateDefault) return;
		doc = structuredClone(data.templateDefault as GameConfigDoc);
	}

	/**
	 * Persist the config, conditional on the loaded ETag. `force` drops the precondition — the
	 * explicit "overwrite with mine" after a conflict; it NEVER reloads or discards local edits.
	 *
	 * A 400 carries the issue list (the config can't ship — an off-grid payline, a strip dealing a
	 * symbol with no dictionary entry); those are already shown inline, so the save button just
	 * reports the count. A clean save adopts the server's normalized doc so the baseline matches
	 * exactly what persisted.
	 */
	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save (no autosave); the
	 * transport owns the request + the caller-side create encoding (JSON `null` baseEtag). A
	 * 400 issue-list rejection maps to `reason:'error'` (shown in the meta), a 409 to
	 * `conflict` (the in-body banner); `force` drops the precondition. The transport adopts
	 * the server's normalized doc so the baseline matches exactly what persisted.
	 */
	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c) over this project's game-config doc
	 * (`docKey:'gameConfig'`). When another author holds it, `lease.readOnly` gates the doc
	 * `saveState` (its `blockWhen`) so a not-held tab can't save, the Save button hides behind
	 * `<PresenceBanner>`, and Take over is always reachable. The `If-Match` CAS stays the floor.
	 */
	const lease = new LeaseState({
		toolId: 'gameConfig',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'gameConfig',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this config while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/game-config?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: $state.snapshot(doc), baseEtag, force }),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (res.status === 400) {
				const c = (await res.json()) as { issues?: GameConfigIssue[] };
				const n = c.issues?.length ?? 0;
				return {
					ok: false,
					reason: 'error',
					message: n
						? `Can't save: ${n} blocking ${n === 1 ? 'issue' : 'issues'} — see the highlighted panels.`
						: "This config can't be saved.",
				};
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			const saved = (await res.json()) as { doc: GameConfigDoc; etag: string | null };
			doc = structuredClone(saved.doc);
			baseline = JSON.stringify(saved.doc);
			source = 'authored';
			savedAt = new Date().toLocaleTimeString();
			return { ok: true, etag: saved.etag };
		},
	});
	const save = (force = false) => void saveState.save({ force });

	onMount(() => {
		void lease.start();
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			lease.release();
		};
	});
</script>

<svelte:head><title>Invisible Game Config — {data.projectKey}</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="gameConfig"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<!-- Another author (or your own other tab) holds the edit lease → read-only here.
				     The doc saveState refuses to save (its blockWhen); Take over is always offered. -->
				<PresenceBanner {lease} />
			{:else}
				{#if errors.length}<span class="pill err"
						>{errors.length} error{errors.length === 1 ? '' : 's'}</span
					>{/if}
				{#if saveState.status === 'error'}<span class="err">{saveState.message}</span>{/if}
				{#if dirty}<span class="pill dirty">Unsaved</span>{:else if savedAt}<span class="pill"
						>Saved {savedAt}</span
					>{/if}
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={lease.readOnly || saveState.busy || !dirty || errors.length > 0}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
				<p class="conflict-sub">
					Your edits are still on this page — nothing has been lost. Reload to take their version
					(your unsaved edits go), or overwrite with yours.
				</p>
				<div class="conflict-actions">
					<button onclick={() => location.reload()}>Reload theirs</button>
					<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
				</div>
			</div>
		{/if}

		<p class="intro">
			What this game <em>plays</em> — its symbol dictionary and payouts, paylines, grid, bet modes,
			and the reel strips that decide which symbols reach the board. This is the frontend's contract
			with the math, not the math itself: the server stays the authority on outcomes. A config
			arriving from the math team pastes straight in via
			<button class="linkish" onclick={openRaw}>raw JSON</button>.
		</p>

		<div class="banner {source}">
			{#if source === 'template'}
				This project has <strong>not authored a config</strong> — you're looking at the
				<strong>{data.gameType} template default</strong>. Save to make it this project's own.
			{:else}
				Editing this project's <strong>authored config</strong>.
			{/if}
			{#if data.templateDefault}
				<button class="linkish" onclick={resetToTemplate}>Reset to template default</button>
			{/if}
		</div>

		{#if errors.length}
			<div class="warn err-box">
				<strong>{errors.length} blocking {errors.length === 1 ? 'issue' : 'issues'}</strong> — the
				config can't be saved until fixed:
				<ul>
					{#each errors as issue (issue.path + issue.message)}
						<li><code>{issue.path}</code> — {issue.message}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if warnings.length}
			<div class="warn">
				<strong>{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</strong> — the
				config saves, but:
				<ul>
					{#each warnings as issue (issue.path + issue.message)}
						<li><code>{issue.path}</code> — {issue.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Identity ---------------------------------------------------------------->
		<section>
			<h2>Identity</h2>
			<p class="hint">Shown on the info page and used in the RGS handshake.</p>
			<div class="fields">
				<label><span>Provider</span><input bind:value={doc.providerName} /></label>
				<label><span>Game name</span><input bind:value={doc.gameName} /></label>
				<label><span>Game ID</span><input bind:value={doc.gameID} /></label>
				<label
					><span>RTP</span><input
						type="number"
						step="0.001"
						min="0"
						max="1"
						bind:value={doc.rtp}
					/></label
				>
			</div>
		</section>

		<!-- Grid ------------------------------------------------------------------->
		<section>
			<h2>Grid</h2>
			<p class="hint">
				Reels and visible rows. <strong>Widening</strong> the grid auto-fills the new reels — strips
				clone the last reel and paylines keep their shape — so you never re-enter them by hand.
				<strong>Shrinking</strong> leaves the extra reels in place (trimming loses authored strips);
				use <strong>Match grid</strong> to drop them down to the new count.
			</p>
			<div class="fields">
				<label
					><span>Reels</span><input
						type="number"
						min="1"
						value={doc.numReels}
						oninput={(e) => setNumReels(Number(e.currentTarget.value))}
					/></label
				>
				<label
					><span>Rows (all reels)</span><input
						type="number"
						min="1"
						value={maxRows}
						oninput={(e) => setAllRows(Number(e.currentTarget.value))}
					/></label
				>
			</div>
			<div class="rows-per-reel">
				{#each doc.numRows as rows, reel (reel)}
					<label class="mini"
						><span>R{reel + 1}</span><input
							type="number"
							min="1"
							value={rows}
							oninput={(e) => setRows(reel, Number(e.currentTarget.value))}
						/></label
					>
				{/each}
			</div>
			{#if gridMismatch}
				<div class="grid-fix">
					<span
						>Strips or paylines don't match the {doc.numReels}-reel grid — the config can't ship
						until they line up.</span
					>
					<button onclick={matchGridWidth}>Match grid ({doc.numReels} reels)</button>
				</div>
			{/if}
		</section>

		<!-- Bet modes -------------------------------------------------------------->
		<section>
			<h2>Bet modes</h2>
			<p class="hint">
				Each entry in the bet selector / buy-bonus menu. The <strong>math</strong> (cost × the base
				bet, RTP, max win, and whether the mode has the feature / is a bought bonus) is the Stake
				export shape. The <strong>presentation</strong> is ours: <strong>Kind</strong> —
				<code>base</code>, a persistent <code>ante</code>, or a one-shot <code>buy</code> (leave on
				<em>auto</em> to derive it from the math) — a menu <strong>Order</strong>, the
				<strong>Card</strong> component this mode's buy-feature card renders (blank ⇒ the default
				<code>featureCard</code>), and the <strong>copy</strong> the card shows. Copy is authored
				here as source text and translated in the <strong>Invisible Localization</strong> tool.
			</p>

			{#if resolvedBetModes.length}
				<div class="menu-preview" aria-label="Resolved menu order">
					{#each resolvedBetModes as m (m.mode)}
						<span class="mp-chip mp-{m.kind}" title="{m.kind} · {m.costMultiplier}× bet"
							>{m.title}<b>{m.costMultiplier}×</b></span
						>
					{/each}
				</div>
			{/if}

			<div class="betmodes">
				{#each Object.keys(doc.betModes) as key (key)}
					<div class="betmode">
						<div class="betmode-head">
							<span class="betmode-key">{key}</span>
							<button class="del" title="Remove" onclick={() => removeBetMode(key)}>×</button>
						</div>

						<div class="betmode-row">
							<label class="mini"
								><span>Cost ×</span><input
									type="number"
									step="0.01"
									bind:value={doc.betModes[key].cost}
								/></label
							>
							<label class="mini"
								><span>RTP</span><input
									type="number"
									step="0.001"
									bind:value={doc.betModes[key].rtp}
								/></label
							>
							<label class="mini"
								><span>Max win ×</span><input
									type="number"
									step="1"
									bind:value={doc.betModes[key].max_win}
								/></label
							>
							<label class="check"
								><input type="checkbox" bind:checked={doc.betModes[key].feature} /><span
									>Feature</span
								></label
							>
							<label class="check"
								><input type="checkbox" bind:checked={doc.betModes[key].buyBonus} /><span
									>Buy bonus</span
								></label
							>
							<label class="mini"
								><span>Kind</span><select
									value={betModeKindValue(key)}
									onchange={(e) => setBetModeKind(key, e.currentTarget.value)}
								>
									<option value="">auto → {derivedKind(key)}</option>
									<option value="base">base</option>
									<option value="ante">ante</option>
									<option value="buy">buy</option>
								</select></label
							>
							<label class="mini"
								><span>Order</span><input
									type="number"
									step="1"
									placeholder="auto"
									value={betModeOrderValue(key)}
									oninput={(e) => setBetModeOrder(key, e.currentTarget.value)}
								/></label
							>
							<label class="mini card-pick"
								><span>Card</span><select
									value={betModeCardValue(key)}
									onchange={(e) => setBetModeCard(key, e.currentTarget.value)}
								>
									<option value="">(default)</option>
									{#each data.components as c (c.id)}
										<option value={c.id}>{c.name} · {c.id}</option>
									{/each}
								</select></label
							>
						</div>

						<div class="betmode-text">
							<label
								><span>Title</span><input
									value={betModeTextValue(key, 'title')}
									placeholder={key.toUpperCase()}
									oninput={(e) => setBetModeText(key, 'title', e.currentTarget.value)}
								/></label
							>
							<label
								><span>Button</span><input
									value={betModeTextValue(key, 'button')}
									placeholder={defaultButtonHint(key)}
									oninput={(e) => setBetModeText(key, 'button', e.currentTarget.value)}
								/></label
							>
							<label
								><span>Bet label</span><input
									value={betModeTextValue(key, 'betAmountLabel')}
									placeholder="HUD “BET”"
									oninput={(e) => setBetModeText(key, 'betAmountLabel', e.currentTarget.value)}
								/></label
							>
							<label class="wide"
								><span>Description</span><textarea
									rows="2"
									value={betModeTextValue(key, 'description')}
									oninput={(e) => setBetModeText(key, 'description', e.currentTarget.value)}
								></textarea></label
							>
							<label class="wide"
								><span>Dialog</span><textarea
									rows="3"
									value={betModeTextValue(key, 'dialog')}
									oninput={(e) => setBetModeText(key, 'dialog', e.currentTarget.value)}
								></textarea></label
							>
						</div>

						{#if cardAuthorableParams(key).length}
							<div class="betmode-cardparams">
								<div class="cardparams-head">
									Card graphics
									<span class="hint-sm"
										>override the <code>{betModeCardValue(key) || DEFAULT_CARD_ID}</code> card's look
										for this mode — blank inherits the card's authored default</span
									>
								</div>
								<div class="cardparams-grid">
									{#each cardAuthorableParams(key) as p (p.key)}
										<label class="mini cardparam" class:check={p.kind === 'boolean'}>
											<span
												>{p.label ?? p.key}{#if p.group}<em> · {p.group}</em>{/if}</span
											>
											{#if p.kind === 'color'}
												<input
													type="color"
													value={toColorInput(
														betModeCardParamValue(key, p.key),
														typeof p.default === 'number' ? p.default : 0xffffff,
													)}
													oninput={(e) =>
														setBetModeCardParam(key, p.key, fromColorInput(e.currentTarget.value))}
												/>
											{:else if p.kind === 'number'}
												<input
													type="number"
													value={(betModeCardParamValue(key, p.key) as number | undefined) ?? ''}
													oninput={(e) =>
														setBetModeCardParam(
															key,
															p.key,
															e.currentTarget.value === ''
																? undefined
																: Number(e.currentTarget.value),
														)}
												/>
											{:else if p.kind === 'boolean'}
												<input
													type="checkbox"
													checked={(betModeCardParamValue(key, p.key) ?? p.default) === true}
													onchange={(e) => setBetModeCardParam(key, p.key, e.currentTarget.checked)}
												/>
											{:else}
												<input
													type="text"
													placeholder={p.kind === 'image'
														? 'art frame key'
														: p.kind === 'spine'
															? 'spine bundle'
															: ''}
													value={(betModeCardParamValue(key, p.key) as string | undefined) ?? ''}
													oninput={(e) => setBetModeCardParam(key, p.key, e.currentTarget.value)}
												/>
											{/if}
										</label>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="add">
				<input placeholder="new mode key (e.g. base)" bind:value={newBetMode} />
				<button onclick={addBetMode} disabled={!newBetMode.trim()}>Add mode</button>
			</div>
			{#each issuesFor('betModes') as issue (issue.message)}
				<p class="inline-issue {issue.severity}">{issue.message}</p>
			{/each}
			{#each issuesFor('betModePresentation') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Symbols ---------------------------------------------------------------->
		<section>
			<h2>Symbols</h2>
			<p class="hint">
				The symbol <strong>dictionary</strong> — art, properties, payouts. The
				<span class="badge in">in play</span>
				badge means the symbol appears on a reel strip and so can actually reach the board; a
				<span class="badge out">unused</span> symbol is defined here but dealt by no strip (a payout
				no one can win). Paytable is <code>count:multiplier</code> pairs, e.g.
				<code>5:20, 4:10, 3:5</code>.
			</p>
			<div class="grid-wrap">
				<table class="grid">
					<thead>
						<tr>
							<th>Symbol</th>
							<th></th>
							<th>Special properties</th>
							<th>Paytable (count:×)</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each symbolNames as name (name)}
							<tr>
								<th class="row-head">{name}</th>
								<td class="center">
									{#if inPlay.has(name)}<span class="badge in">in play</span>{:else}<span
											class="badge out">unused</span
										>{/if}
								</td>
								<td
									><input
										value={(doc.symbols[name].special_properties ?? []).join(', ')}
										placeholder="scatter, wild…"
										oninput={(e) => setProperties(name, e.currentTarget.value)}
									/></td
								>
								<td
									><input
										value={paytableText(name)}
										placeholder="5:20, 4:10, 3:5"
										oninput={(e) => setPaytable(name, e.currentTarget.value)}
									/></td
								>
								<td class="center"
									><button class="del" title="Remove" onclick={() => removeSymbol(name)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="add">
				<input placeholder="new symbol id (e.g. H1)" bind:value={newSymbol} />
				<button onclick={addSymbol} disabled={!newSymbol.trim()}>Add symbol</button>
			</div>
			{#each issuesFor('symbols') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Paylines --------------------------------------------------------------->
		<section>
			<h2>Paylines</h2>
			<p class="hint">
				Each line is one cell per reel. Click a cell to move the line through that reel's rows. The
				swatch sets an optional <strong>line colour</strong>: the game draws that line's win in this
				colour and broadcasts it so assets shown on the win can pick it up (leave it unset to use
				the single default from the Symbols tool).
			</p>
			<div class="paylines">
				{#each Object.keys(doc.paylines) as id (id)}
					{@const tint = hasPaylineColor(id) ? paylineColorValue(id) : null}
					<div class="payline">
						<div class="payline-head">
							<span class="payline-id" style={tint ? `color:${tint}` : ''}>Line {id}</span>
							<div class="payline-tools">
								<input
									class="swatch"
									type="color"
									value={paylineColorValue(id)}
									oninput={(e) => setPaylineColor(id, e.currentTarget.value)}
									title="Line colour"
								/>
								{#if tint}
									<button class="del" title="Clear colour" onclick={() => clearPaylineColor(id)}
										>⌫</button
									>
								{/if}
								<button class="del" title="Remove" onclick={() => removePayline(id)}>×</button>
							</div>
						</div>
						<div class="payline-grid" style="grid-template-columns: repeat({doc.numReels}, 1fr);">
							{#each Array(doc.numReels) as _, reel (reel)}
								<div class="reel-col">
									{#each Array(doc.numRows[reel] ?? maxRows) as _, row (row)}
										{@const on = doc.paylines[id][reel] === row}
										<button
											class="cell"
											class:on
											style={on && tint ? `background:${tint};border-color:${tint}` : ''}
											aria-label="Line {id} reel {reel + 1} row {row + 1}"
											onclick={() => setPaylineCell(id, reel, row)}
										></button>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="add">
				<input placeholder="line id (auto if blank)" bind:value={newPayline} />
				<button onclick={addPayline}>Add line</button>
			</div>
			{#each issuesFor('paylines') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Reel strips ------------------------------------------------------------>
		<section>
			<h2>Reel strips</h2>
			<p class="hint">
				The cosmetic strips the reels cycle through — and the one statement of which symbols reach
				the board. Not the real weighted math strips (the math team owns those); a symbol's count
				here is only how often it flickers past. One reel per box; separate names with spaces,
				commas or newlines.
			</p>
			{#each gameTypes as gameType (gameType)}
				<div class="strips">
					<div class="strips-head">
						<span class="game-type">{gameType}</span>
						<button class="del" title="Remove game type" onclick={() => removeGameType(gameType)}
							>×</button
						>
					</div>
					<div class="strip-cols">
						{#each Array(doc.numReels) as _, reel (reel)}
							<div class="strip-col">
								<div class="strip-label">Reel {reel + 1}</div>
								<textarea
									value={stripText(gameType, reel)}
									oninput={(e) => setStrip(gameType, reel, e.currentTarget.value)}
									spellcheck="false"
								></textarea>
								<div class="freq">
									{#each Object.entries(frequencies[gameType]?.[reel] ?? {}).sort((a, b) => b[1] - a[1]) as [name, count] (name)}
										<span class="chip" class:out={!inPlay.has(name)}>{name}<b>{count}</b></span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
			<div class="add">
				<input placeholder="new game type (e.g. freegame)" bind:value={newGameType} />
				<button onclick={addGameType} disabled={!newGameType.trim()}>Add game type</button>
			</div>
			{#each issuesFor('paddingReels') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Big win tiers ------------------------------------------------------------>
		<section>
			<h2>Big win tiers</h2>
			<p class="hint">
				The big-win celebrations, in ascending order. Each tier has a <strong>name</strong> and an
				amount <strong>threshold</strong> (the win as a multiple of the total bet). Its
				<strong>presentation</strong> — spine bundle, intro/idle/outro animations, duration and
				sound — is authored on the <strong>Win Overlay</strong> component in the Scene Editor, which
				reads these tiers by alias so the two stay in sync. Smaller wins are handled automatically and
				aren't shown here. Leave this empty to keep the game's built-in tiers (byte-identical).
			</p>

			{#if bigResolved.length}
				<div class="menu-preview" aria-label="Big-win tiers">
					{#each bigResolved as t (t.alias)}
						<span class="mp-chip mp-big" title="≥ {t.threshold}× bet"
							>{t.name}<b>≥{t.threshold}×</b></span
						>
					{/each}
				</div>
			{:else if defaultWinTiers.length}
				<div class="tier-seed">
					<button type="button" onclick={loadDefaultWinTiers}>Load default big wins</button>
					<span class="hint"
						>Seeds the <strong>{data.gameType}</strong> template's tiers so you can rename, trim, or
						retune them. Or add one below.</span
					>
				</div>
			{/if}

			<div class="betmodes">
				{#each bigTierEntries as { tier, index } (tier.alias)}
					<div class="betmode">
						<div class="betmode-head">
							<span class="betmode-key">{tier.alias}</span>
							<span class="tier-move">
								<button
									title="Move up"
									disabled={index === bigTierEntries[0].index}
									onclick={() => moveBigTier(index, -1)}>↑</button
								>
								<button
									title="Move down"
									disabled={index === bigTierEntries[bigTierEntries.length - 1].index}
									onclick={() => moveBigTier(index, 1)}>↓</button
								>
							</span>
							<button class="del" title="Remove" onclick={() => removeBigTier(index)}>×</button>
						</div>

						<div class="betmode-row">
							<label class="mini"
								><span>Name</span><input bind:value={tier.name} placeholder={tier.alias} /></label
							>
							<label class="mini"
								><span>Threshold ×</span><input
									type="number"
									step="0.5"
									bind:value={tier.threshold}
								/></label
							>
						</div>
					</div>
				{/each}
			</div>

			<div class="add">
				<input placeholder="new tier alias (e.g. mega)" bind:value={newWinTier} />
				<button onclick={addBigTier}>Add big win</button>
			</div>

			{#if managedFloorCount}
				<p class="hint managed-note">
					+ {managedFloorCount} smaller win band{managedFloorCount === 1 ? '' : 's'} managed automatically
					(wins below the first big tier present as a plain count-up number).
				</p>
			{/if}

			{#if bigTierEntries.length}
				<div class="escalate">
					<label class="check"
						><input
							type="checkbox"
							checked={doc.escalateTiers === true}
							onchange={(e) => setEscalate(e.currentTarget.checked)}
						/><span>Sequential escalation — play each tier up to the winning one</span></label
					>
					<label class="mini"
						><span>Start from</span><select
							value={doc.escalateFrom ?? ''}
							onchange={(e) => setEscalateFrom(e.currentTarget.value)}
						>
							<option value="">first big tier</option>
							{#each bigTierAliases as alias (alias)}
								<option value={alias}>{alias}</option>
							{/each}
						</select></label
					>
				</div>
			{/if}

			{#each issuesFor('winLevels') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
			{#each issuesFor('escalateFrom') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
			{#each issuesFor('escalateTiers') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>
	</div>

	{#if rawOpen}
		<div class="modal-backdrop" onclick={() => (rawOpen = false)} role="presentation">
			<div class="modal" onclick={(e) => e.stopPropagation()} role="presentation">
				<h2>Raw JSON</h2>
				<p class="hint">
					Paste a Stake-shaped config from the math team, or edit the whole doc directly. Apply runs
					the same validation a save does.
				</p>
				<textarea class="raw" bind:value={rawText} spellcheck="false"></textarea>
				{#if rawError}<p class="inline-issue error">{rawError}</p>{/if}
				<div class="modal-actions">
					<button onclick={() => (rawOpen = false)}>Cancel</button>
					<button class="primary" onclick={applyRaw}>Apply</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #e8e8ee;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 24px;
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
	}
	.intro {
		margin: 0 0 16px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
		max-width: 900px;
	}
	.banner {
		margin: 0 0 20px;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 12px;
		line-height: 1.5;
		border: 1px solid #2a2438;
		background: #14121c;
		color: #b9b3c8;
		display: flex;
		gap: 14px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.banner.template {
		border-color: #4a3f1e;
		background: #1a1710;
		color: #d3b483;
	}
	section {
		margin-bottom: 34px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.warn {
		margin: 0 0 16px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.warn.err-box {
		border-color: #6a2727;
		background: #1e1112;
		color: #e0a0a0;
	}
	.warn ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	.fields {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	label.mini {
		font-size: 10px;
	}
	input,
	textarea {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 7px 9px;
		font-size: 13px;
		font-family: inherit;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	label input {
		width: 180px;
	}
	label.mini input {
		width: 52px;
		text-align: center;
	}
	.rows-per-reel {
		display: flex;
		gap: 8px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.grid-fix {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 14px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.5;
		flex-wrap: wrap;
	}
	.grid-fix button {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 6px 14px;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
	}
	.grid-wrap {
		overflow-x: auto;
		border: 1px solid #1c1c24;
		border-radius: 10px;
	}
	.grid {
		border-collapse: collapse;
		width: 100%;
	}
	.grid th {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 9px 10px;
		text-align: left;
		background: #101017;
		border-bottom: 1px solid #1c1c24;
		white-space: nowrap;
	}
	.grid td {
		padding: 5px 8px;
		border-bottom: 1px solid #16161d;
	}
	.grid td.center {
		text-align: center;
	}
	.grid td input:not([type='checkbox']) {
		width: 100%;
		min-width: 90px;
	}
	.row-head {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		background: #101017;
		border-right: 1px solid #1c1c24;
		text-align: left;
		padding: 5px 10px;
	}
	.badge {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.badge.in {
		background: #123324;
		color: #7ee0c0;
	}
	.badge.out {
		background: #33231a;
		color: #d39b6f;
	}
	/* Bet modes: the resolved-menu preview + per-mode cards. */
	.menu-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}
	.mp-chip {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #26262f;
		background: #14141b;
		color: #b9b9c4;
		display: inline-flex;
		gap: 6px;
		align-items: baseline;
	}
	.mp-chip b {
		color: #7ee0c0;
		font-size: 10px;
	}
	.mp-chip.mp-buy {
		border-color: #4a3a1e;
		background: #1c1710;
		color: #e0b878;
	}
	.mp-chip.mp-ante {
		border-color: #2f4a3f;
		background: #101c17;
		color: #7ee0c0;
	}
	.mp-chip.mp-big {
		border-color: #4a3a1e;
		background: #1c1710;
		color: #e0b878;
	}
	.mp-chip.mp-medium {
		border-color: #2f3a4a;
		background: #10141c;
		color: #9cc0e0;
	}
	.tier-move {
		display: inline-flex;
		gap: 4px;
		margin-left: auto;
		margin-right: 8px;
	}
	.tier-move button {
		padding: 2px 8px;
		font-size: 12px;
	}
	.tier-move button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.escalate {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 20px;
		align-items: center;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #1c1c24;
	}
	.tier-seed {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		align-items: center;
		margin-bottom: 12px;
	}
	.tier-seed .hint {
		flex: 1 1 240px;
		margin: 0;
	}
	.managed-note {
		margin-top: 10px;
		opacity: 0.75;
		font-style: italic;
	}
	.betmodes {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.betmode {
		border: 1px solid #1c1c24;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
	}
	.betmode-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.betmode-key {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		font-size: 13px;
	}
	.betmode-row {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 16px;
		align-items: flex-end;
		margin-bottom: 12px;
	}
	.betmode-row select {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 7px 9px;
		font-size: 13px;
		font-family: inherit;
	}
	.betmode-row select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	/* The card picker holds component names, so it needs more room than the fixed-width mini inputs. */
	.betmode-row label.card-pick select {
		width: 180px;
		max-width: 220px;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: #b9b9c4;
	}
	.betmode-text {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 14px;
	}
	.betmode-text label {
		flex: 1;
		min-width: 150px;
	}
	.betmode-text label.wide {
		flex-basis: 100%;
	}
	.betmode-text input,
	.betmode-text textarea {
		width: 100%;
	}
	.betmode-text textarea {
		resize: vertical;
		line-height: 1.5;
	}
	.betmode-cardparams {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #1c1c24;
	}
	.cardparams-head {
		font-size: 12px;
		color: #b9b9c4;
		margin-bottom: 8px;
	}
	.cardparams-head .hint-sm {
		display: block;
		margin-top: 2px;
		opacity: 0.65;
		font-size: 11px;
	}
	.cardparams-head code,
	.hint-sm code {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
	}
	.cardparams-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 14px;
	}
	.cardparam {
		min-width: 140px;
	}
	.cardparam em {
		opacity: 0.55;
		font-style: normal;
	}
	.cardparam input[type='text'],
	.cardparam input[type='number'] {
		width: 100%;
	}
	.cardparam input[type='color'] {
		width: 100%;
		height: 30px;
		padding: 2px;
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
	}
	.add {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.add input {
		width: 240px;
	}
	.add button,
	.modal-actions button,
	.conflict-actions button {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 7px 14px;
		font-size: 12px;
		cursor: pointer;
	}
	.add button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.del {
		background: none;
		border: none;
		color: #8b6b6b;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
	}
	.del:hover {
		color: #e07070;
	}
	.inline-issue {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #e09090;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
	.paylines {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.payline {
		border: 1px solid #1c1c24;
		border-radius: 8px;
		padding: 8px;
		background: #0e0e14;
	}
	.payline-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.payline-id {
		font-size: 11px;
		color: #8b8b98;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.payline-tools {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.swatch {
		width: 22px;
		height: 18px;
		padding: 0;
		border: 1px solid #26262f;
		border-radius: 4px;
		background: none;
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 2px;
	}
	.swatch::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
	.payline-grid {
		display: grid;
		gap: 3px;
	}
	.reel-col {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.cell {
		width: 22px;
		height: 16px;
		border: 1px solid #26262f;
		border-radius: 3px;
		background: #14141b;
		cursor: pointer;
		padding: 0;
	}
	.cell.on {
		background: #7ee0c0;
		border-color: #7ee0c0;
	}
	.strips {
		border: 1px solid #1c1c24;
		border-radius: 10px;
		padding: 12px;
		margin-bottom: 14px;
		background: #0e0e14;
	}
	.strips-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.game-type {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		font-size: 13px;
	}
	.strip-cols {
		display: flex;
		gap: 10px;
		overflow-x: auto;
	}
	.strip-col {
		flex: 1;
		min-width: 130px;
	}
	.strip-label {
		font-size: 11px;
		color: #8b8b98;
		margin-bottom: 4px;
	}
	.strip-col textarea {
		width: 100%;
		height: 160px;
		resize: vertical;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.5;
	}
	.freq {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		margin-top: 6px;
	}
	.chip {
		font-size: 10px;
		font-family: ui-monospace, monospace;
		background: #16161d;
		color: #9a9aa8;
		padding: 1px 4px;
		border-radius: 3px;
	}
	.chip.out {
		background: #33231a;
		color: #d39b6f;
	}
	.chip b {
		margin-left: 3px;
		color: #7ee0c0;
	}
	.chip.out b {
		color: #d39b6f;
	}
	.linkish {
		background: none;
		border: none;
		color: #7ee0c0;
		cursor: pointer;
		font: inherit;
		padding: 0;
		text-decoration: underline;
	}
	.pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		background: #1a1a22;
		color: #8b8b98;
	}
	.pill.dirty {
		background: #33231a;
		color: #e0b070;
	}
	.pill.err {
		background: #2a1414;
		color: #e08080;
	}
	.err {
		color: #e08080;
		font-size: 12px;
	}
	.save {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 6px 16px;
		font-size: 12px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.conflict {
		border: 1px solid #6a2727;
		background: #1e1112;
		border-radius: 8px;
		padding: 14px;
		margin-bottom: 20px;
	}
	.conflict-sub {
		font-size: 12px;
		color: #b98b8b;
	}
	.conflict-actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
	.conflict-actions .danger {
		background: #2a1414;
		border-color: #6a2727;
		color: #e08080;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}
	.modal {
		background: #0e0e14;
		border: 1px solid #26262f;
		border-radius: 12px;
		padding: 20px;
		width: min(760px, 90vw);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
	}
	.raw {
		flex: 1;
		min-height: 340px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.5;
		resize: vertical;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
	.modal-actions .primary {
		background: #1b2a24;
		border-color: #2f4a3f;
	}
</style>
