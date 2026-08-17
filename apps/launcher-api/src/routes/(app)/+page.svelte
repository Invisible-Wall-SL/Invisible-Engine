<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import Emblem from '$lib/Emblem.svelte';
	import { TOOL_STAGES, roleLabel, type ToolDef, type ToolStage } from '$lib/roles';
	import {
		LAUNCH_LOCALES,
		LAUNCH_CURRENCIES,
		DEFAULT_LAUNCH_LOCALE,
		DEFAULT_LAUNCH_CURRENCY,
		readStoredLocale,
		readStoredCurrency,
		localeLabel,
		storeLocale,
		storeCurrency,
		withLocale,
		withCurrency,
	} from '$lib/gameLaunch';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Locale + currency the launch links open the game in. Read from storage on mount
	// (not at init) so SSR and the first client render agree — otherwise the markup
	// mismatches.
	let launchLocale = $state(DEFAULT_LAUNCH_LOCALE);
	let launchCurrency = $state(DEFAULT_LAUNCH_CURRENCY);
	$effect(() => {
		launchLocale = readStoredLocale();
		launchCurrency = readStoredCurrency();
	});

	// Online tools are grouped into one section per game-making stage (`TOOL_STAGES`),
	// in declared order. A stage the user has no tools for is dropped; any online tool
	// not placed in a stage lands in a trailing "Other" bucket so it can never silently
	// disappear from the home grid. The colour-coded top-bar switcher reads off the same
	// source, so the two surfaces always agree.
	const availableOnline = $derived(
		new Map(data.tools.filter((t) => t.kind === 'online').map((t) => [t.id, t])),
	);
	const stageSections = $derived.by<(ToolStage & { items: ToolDef[] })[]>(() => {
		const placed = new Set<string>();
		const sections = TOOL_STAGES.map((s) => {
			const items = s.tools.map((id) => availableOnline.get(id)).filter((t): t is ToolDef => !!t);
			items.forEach((t) => placed.add(t.id));
			return { ...s, items };
		}).filter((s) => s.items.length > 0);
		const others = [...availableOnline.values()].filter((t) => !placed.has(t.id));
		if (others.length) {
			sections.push({ id: 'other', label: 'Other', accent: '#8a8a93', tools: [], items: others });
		}
		return sections;
	});
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));

	// A local tool is "configured" once the user has saved an install path for it.
	// The launcher can't see the user's disk, so a saved path is the best proxy —
	// the UI wording stays honest about that (it's a personal bookmark, not a probe).
	const isConfigured = (id: string) => !!data.installPaths[id]?.trim();

	// Games are DB rows without a ToolDef icon — a single launch/triangle mark.
	const GAME_ICON =
		'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
		'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<path d="M8 5.5v13l11-6.5z"/></svg>';

	// Games launch against their configured URL (managed in /admin; games live on a
	// future dedicated server). The active project rides along as `?project=<key>`.
	// Shown to every authed user for now — could be gated by a `games` capability later.
	const projectKey = $derived(data.activeProjectKey ?? 'cloud');
	const gameUrl = (url: string) => {
		const sep = url.includes('?') ? '&' : '?';
		let out = `${url}${sep}project=${encodeURIComponent(projectKey)}`;
		// This project's public read token, so the game can fetch its editor scenes at boot.
		if (data.gameReadToken) out += `&k=${encodeURIComponent(data.gameReadToken)}`;
		// Mark this as an AUTHORING boot: if the game can't reach its live authoring data and
		// falls back to the last baked snapshot, say so on screen instead of silently rendering
		// a stale game that looks fine. Only launcher links carry this — the published URL a
		// player loads does not, so players keep getting the silent (working) fallback.
		out += '&ie_authoring=1';
		// SET (not append) locale + currency: every generated game URL already carries
		// `lang=en&currency=USD` and the game reads the first occurrence, so appending
		// is a no-op.
		return withCurrency(withLocale(out, launchLocale), launchCurrency);
	};

	// Compact build stamp under a game name (e.g. `v13 · Jun 14, 14:32 🐞`). Built from
	// the publish-time metadata the desktop launcher POSTs; empty when none is present.
	const buildStamp = (game: (typeof data.games)[number]) => {
		const parts: string[] = [];
		if (game.version) parts.push(`v${game.version}`);
		if (game.builtAt) {
			const d = new Date(game.builtAt);
			parts.push(
				d.toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
				}),
			);
		}
		let out = parts.join(' · ');
		if (game.debug) out = out ? `${out} 🐞` : '🐞 debug';
		return out;
	};

	type SelectorProject = (typeof data.projects)[number];

	// Sentinel for "projects with no owning client" — the Client step always has
	// an entry to reach unassigned projects (e.g. the default `cloud`).
	const UNASSIGNED = '__unassigned__';

	// Distinct clients (alphabetical) plus the Unassigned bucket when any
	// accessible project has no client. Built from the projects the user can see.
	const clientOptions = $derived.by(() => {
		const byKey = new Map<string, string>();
		let hasUnassigned = false;
		for (const p of data.projects) {
			if (!p.clientKey) {
				hasUnassigned = true;
				continue;
			}
			byKey.set(p.clientKey, p.clientName ?? p.clientKey);
		}
		const clients = [...byKey.entries()]
			.map(([key, name]) => ({ key, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (hasUnassigned) clients.unshift({ key: UNASSIGNED, name: 'Unassigned' });
		return clients;
	});

	// --- Two-step selection (B23 rebuild) -------------------------------------
	// The COMMITTED active project is owned by the server (the session). Local
	// state here is purely the UI: CLIENT is a *filter* that never persists on its
	// own; only changing PROJECT commits (submits `?/setProject`). We re-seed from
	// the server ONLY when the active project actually changes (login / a committed
	// switch / another tab) — gated by `syncedActive` so an `invalidateAll` (which
	// re-runs `load` after every enhanced submit) can't clobber an in-progress pick.
	let selectedClient = $state(UNASSIGNED);
	let selectedProject = $state('');
	let syncedActive: string | null | undefined = undefined;

	$effect(() => {
		if (data.activeProjectKey === syncedActive) return;
		syncedActive = data.activeProjectKey;
		const active = data.projects.find((p) => p.key === data.activeProjectKey) ?? null;
		selectedClient = active?.clientKey ?? UNASSIGNED;
		selectedProject = data.activeProjectKey ?? '';
	});

	// Projects under the selected client (or the unassigned bucket), alphabetical.
	const clientProjects = $derived.by(() => {
		const wantUnassigned = selectedClient === UNASSIGNED;
		return data.projects
			.filter((p) => (wantUnassigned ? !p.clientKey : p.clientKey === selectedClient))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	// Changing CLIENT only re-filters the PROJECT list — it NEVER commits. Keep the
	// active project selected if it belongs to the chosen client; otherwise blank
	// the PROJECT select so the user must explicitly pick (and commit) one.
	function onClientChange(next: string) {
		selectedClient = next;
		const wantUnassigned = next === UNASSIGNED;
		const stillValid = data.projects.some(
			(p) => p.key === selectedProject && (wantUnassigned ? !p.clientKey : p.clientKey === next),
		);
		if (!stillValid) selectedProject = '';
	}

	// Changing PROJECT is the only commit. Submit on a real change.
	function onProjectChange(form: HTMLFormElement | null, next: string) {
		selectedProject = next;
		if (next && next !== data.activeProjectKey) form?.requestSubmit();
	}

	// --- Engine deploy status pill (bundle-vs-source axis) --------------------
	// Which engine commit the live shared runtime bundle was built from + whether a release is
	// building right now. Distinct from the per-game `engineStale` badge in Game Maker.
	const engine = $derived(data.engine);

	// "3 hours ago" / "just now" from an ISO timestamp; empty when absent/unparseable.
	function relativeTime(iso: string | undefined): string {
		if (!iso) return '';
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return '';
		const diff = Date.now() - ms;
		if (diff < 60_000) return 'just now';
		const mins = Math.floor(diff / 60_000);
		if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}

	// Absolute local timestamp for the pill's tooltip; empty when absent/unparseable.
	function absoluteTime(iso: string | undefined): string {
		if (!iso) return '';
		const ms = Date.parse(iso);
		return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '';
	}

	// True only when a source-compare actually ran AND found un-released engine changes. `pending`
	// is `undefined` when the compare was skipped (no token / GitHub hiccup) — that must never read
	// as "pending" NOR as "up to date"; we simply keep today's deployed appearance in that case.
	const isPending = $derived(engine.status === 'deployed' && engine.pending === true);
	const first7 = (sha: string | undefined) => (sha ? sha.slice(0, 7) : '');

	// CSS class drives the palette: a distinct non-pulsing amber for `pending` (vs the pulsing amber
	// `building`), otherwise the base per-status class.
	const engineClass = $derived(isPending ? 'engine-pending' : `engine-${engine.status}`);

	const engineLabel = $derived.by(() => {
		if (engine.status === 'building') return 'Releasing engine…';
		if (engine.status === 'deployed') {
			if (isPending) {
				const ahead = engine.aheadBy && engine.aheadBy > 0 ? ` · ${engine.aheadBy} ahead` : '';
				return `Release pending${ahead}`;
			}
			const rel = relativeTime(engine.builtAt);
			// Only claim "up to date" when a compare actually ran (pending === false). If the compare
			// was skipped (undefined), keep exactly today's label — don't imply we checked.
			const upToDate = engine.pending === false ? ' · up to date' : '';
			return ['Engine deployed', engine.shortCommit, rel].filter(Boolean).join(' · ') + upToDate;
		}
		return 'Engine status unknown';
	});

	const engineTitle = $derived.by(() => {
		if (engine.status === 'building') {
			const parts = ['A runtime release is currently building.'];
			if (engine.commit && engine.commit !== 'unknown') parts.push(`commit ${engine.commit}`);
			return parts.join(' ');
		}
		if (engine.status === 'deployed') {
			if (isPending) {
				return (
					'engine main has changes not in the live bundle — merge already auto-releases; this ' +
					`clears when the release finishes. deployed ${first7(engine.commit)} · ` +
					`main ${first7(engine.mainCommit)}`
				);
			}
			const parts: string[] = [];
			if (engine.commit && engine.commit !== 'unknown') parts.push(`commit ${engine.commit}`);
			const abs = absoluteTime(engine.builtAt);
			if (abs) parts.push(`built ${abs}`);
			return parts.length ? parts.join('\n') : 'Live engine runtime bundle.';
		}
		return 'No engine release stamp found for the live runtime bundle.';
	});
</script>

{#snippet projectSelector()}
	<!-- This is a selector, not a data-entry form: never let `enhance`'s default
	     success-reset fire. A native form reset reverts the <select>s to their
	     default DOM option, and Svelte only re-applies `value={…}` when the value
	     CHANGES — so switching to a project under the same client (client value
	     unchanged) would leave the Client dropdown stuck on the reset option.
	     `reset: false` keeps the UI; `update()` still invalidates so the $effect
	     re-seeds from the freshly committed active project. -->
	<form
		method="POST"
		action="?/setProject"
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
			}}
		class="project"
	>
		<div class="field">
			<label for="active-client">Client</label>
			<select
				id="active-client"
				value={selectedClient}
				onchange={(e) => onClientChange(e.currentTarget.value)}
			>
				{#each clientOptions as c (c.key)}
					<option value={c.key}>{c.name}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="active-project">Project</label>
			<select
				id="active-project"
				name="projectKey"
				value={selectedProject}
				onchange={(e) => onProjectChange(e.currentTarget.form, e.currentTarget.value)}
			>
				{#if !selectedProject}
					<option value="" disabled selected>— choose a project —</option>
				{/if}
				{#each clientProjects as p (p.key)}
					<option value={p.key}>{p.name}</option>
				{/each}
			</select>
		</div>
	</form>
{/snippet}

<svelte:head><title>Launcher — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand">
			<Emblem height={18} /> INVISIBLE WALL
			<span class="engine-pill {engineClass}" role="status" title={engineTitle}>
				<span class="engine-dot"></span>
				{engineLabel}
			</span>
		</div>
		<div class="user">
			{@render projectSelector()}
			<span
				>{data.user.name ?? data.user.email} ·
				<span class="role">{roleLabel(data.user.role)}</span></span
			>
			{#if data.canAdmin}
				<a class="ghost" href="/admin">Admin</a>
			{/if}
			<a class="ghost" href="/onboarding">Getting started</a>
			<form method="POST" action="/auth/logout">
				<button class="ghost" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	{#each stageSections as stage (stage.id)}
		<section class="sec sec-stage" style="--accent: {stage.accent}">
			<h2>{stage.label}</h2>
			<div class="grid">
				{#each stage.items as tool (tool.id)}
					<a class="tool" href={tool.url}>
						<span class="ico">{@html tool.icon ?? ''}</span>
						<strong>{tool.name}</strong>
						<span class="muted">{tool.description}</span>
						<span class="tag online">open</span>
					</a>
				{/each}
			</div>
		</section>
	{:else}
		<section class="sec sec-stage">
			<h2>Online tools</h2>
			<p class="muted">No online tools for your role.</p>
		</section>
	{/each}

	<section class="sec sec-games">
		<div class="sec-head">
			<h2>Games</h2>
			<div class="launch-picks">
				<label class="lang-pick">
					Language
					<select
						value={launchLocale}
						onchange={(e) => {
							launchLocale = e.currentTarget.value;
							storeLocale(launchLocale);
						}}
					>
						{#each LAUNCH_LOCALES as code (code)}
							<option value={code}>{localeLabel(code)}</option>
						{/each}
					</select>
				</label>
				<label class="lang-pick">
					Currency
					<select
						title="Currency every amount in the game is formatted with"
						value={launchCurrency}
						onchange={(e) => {
							launchCurrency = e.currentTarget.value;
							storeCurrency(launchCurrency);
						}}
					>
						{#each LAUNCH_CURRENCIES as code (code)}
							<option value={code}>{code}</option>
						{/each}
					</select>
				</label>
			</div>
		</div>
		<div class="grid">
			{#each data.games as game (game.key)}
				{@const stamp = buildStamp(game)}
				{#if game.url}
					<a class="tool" href={gameUrl(game.url)} target="_blank" rel="noopener">
						<span class="ico">{@html GAME_ICON}</span>
						<strong>{game.name}</strong>
						{#if stamp}<span class="muted build">{stamp}</span>{/if}
						<span class="muted">Launch for project '{projectKey}'</span>
						<span class="tag games">launch</span>
					</a>
				{:else}
					<div class="tool disabled">
						<span class="ico">{@html GAME_ICON}</span>
						<strong>{game.name}</strong>
						{#if stamp}<span class="muted build">{stamp}</span>{/if}
						<span class="muted">No URL set — configure in Admin.</span>
						<span class="tag games">launch</span>
					</div>
				{/if}
			{:else}
				<p class="muted">No games yet — add them in Admin.</p>
			{/each}
		</div>
	</section>

	<section class="sec sec-local">
		<h2>Local tools</h2>
		<p class="sechelp">
			Installed on <em>your</em> machine. The launcher can't see your disk — the path below is a personal
			bookmark of where you put the tool (for your own reference + the download flow), not something
			it verifies or runs.
		</p>
		<div class="grid wide">
			{#each local as tool (tool.id)}
				{@const configured = isConfigured(tool.id)}
				<div class="tool" class:configured>
					<span class="ico">{@html tool.icon ?? ''}</span>
					<strong>{tool.name}</strong>
					<span class="muted">{tool.description}</span>
					<span class="tag local">{configured ? 'configured' : 'install'}</span>

					{#if configured}
						<div class="pathline">
							<span class="pathval" title={data.installPaths[tool.id]}>
								{data.installPaths[tool.id]}
							</span>
						</div>
						{#if tool.install?.download}
							<a
								class="download muted-link"
								href={tool.install.download}
								target="_blank"
								rel="noopener"
							>
								Re-download installer →
							</a>
						{/if}
					{:else if tool.install?.download}
						<a class="download" href={tool.install.download} target="_blank" rel="noopener">
							Download installer →
						</a>
					{:else}
						<span class="download todo">Download link coming soon — ask an admin.</span>
					{/if}

					<form method="POST" action="?/saveInstallPath" use:enhance class="path">
						<input type="hidden" name="toolKey" value={tool.id} />
						<label for={`path-${tool.id}`}>
							{configured ? 'Edit install path on this machine' : 'Install path on this machine'}
						</label>
						<div class="row">
							<input
								id={`path-${tool.id}`}
								name="installPath"
								type="text"
								placeholder="e.g. C:\Tools\{tool.install?.package ?? tool.id}"
								value={data.installPaths[tool.id] ?? ''}
								autocomplete="off"
								spellcheck="false"
							/>
							<button type="submit">Save</button>
						</div>
						{#if form?.saved === tool.id}
							<span class="saved">Saved.</span>
						{/if}
					</form>
				</div>
			{:else}
				<p class="muted">No local tools for your role.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		padding: 32px clamp(24px, 4vw, 64px);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 32px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
	}
	/* Engine deploy status (bundle-vs-source axis). Reuses the game-maker .stale/.fresh
	   palette: green = deployed, amber (pulsing) = releasing, muted = unknown. */
	.engine-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: 4px;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		border: 1px solid transparent;
		cursor: default;
		white-space: nowrap;
	}
	.engine-dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: currentColor;
	}
	.engine-deployed {
		color: #6c8a7e;
		border-color: #2b3a30;
		background: #16211b;
	}
	.engine-building {
		color: #e2b23a;
		border-color: #6b5320;
		background: #251d0d;
	}
	.engine-building .engine-dot {
		box-shadow: 0 0 0 3px #e2b23a33;
		animation: engine-pulse 1.2s ease-in-out infinite;
	}
	/* Release pending (C2): amber like `building` but NON-pulsing — a steady "owed a release"
	   state, distinct from the in-flight pulse. */
	.engine-pending {
		color: #e2b23a;
		border-color: #6b5320;
		background: #251d0d;
	}
	.engine-unknown {
		color: #7a7a86;
		border-color: #26262f;
		background: #16161c;
	}
	@keyframes engine-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	.user {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
		color: #888;
	}
	.role {
		color: #6b5bff;
		text-transform: capitalize;
	}
	.project {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.project .field {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.project label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.project select {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 6px 9px;
		color: #e8e8ee;
		font-size: 13px;
	}
	.project select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 13px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
		text-decoration: none;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 0 0 12px;
	}
	/* Card-wrapped sections, each with a colour-coded accent (reusing the existing
	   palette: online=green, local=purple, games=teal). The accent drives the left
	   border, the header, and the per-card icon tint via currentColor. */
	.sec {
		margin-top: 20px;
		padding: 16px 18px 20px;
		border: 1px solid #1d1d24;
		border-left: 3px solid var(--accent);
		border-radius: 14px;
		background: #131318;
	}
	.sec-stage {
		--accent: #8a8a93;
	}
	.sec-local {
		--accent: #c8a3ff;
	}
	.sec-games {
		--accent: #7ee0c0;
	}
	.sec h2 {
		color: var(--accent);
	}
	/* Section heading + the launch-locale picker on one line. */
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	.launch-picks {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	.lang-pick {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8a8a93;
	}
	.lang-pick select {
		padding: 3px 6px;
		border: 1px solid #33333c;
		border-radius: 5px;
		background: #16161c;
		color: #e6e6ea;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.sechelp {
		margin: -4px 0 14px;
		font-size: 12px;
		color: #8a8a93;
		max-width: 70ch;
		line-height: 1.5;
	}
	.sechelp em {
		font-style: normal;
		color: #c8a3ff;
	}
	.ico {
		color: var(--accent);
		display: flex;
		margin-bottom: 2px;
	}
	.muted {
		color: #888;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.grid.wide {
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	}
	.tool {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-radius: 12px;
		background: #16161c;
		border: 1px solid #222;
		text-decoration: none;
		color: inherit;
		position: relative;
	}
	a.tool:hover {
		border-color: #6b5bff;
	}
	.tool.disabled {
		opacity: 0.55;
	}
	.tool strong {
		font-size: 15px;
	}
	.tool .muted {
		font-size: 13px;
	}
	.tool .build {
		font-size: 11px;
		letter-spacing: 0.02em;
		color: #6f6f78;
		margin-top: -2px;
	}
	.tag {
		position: absolute;
		top: 14px;
		right: 14px;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
	}
	.tag.online {
		background: #1f2d23;
		color: #7ee787;
	}
	.tag.local {
		background: #2a2430;
		color: #c8a3ff;
	}
	.tag.games {
		background: #16302a;
		color: #7ee0c0;
	}
	/* Configured local tool: a saved install path exists. Greener badge + the saved
	   path promoted to the primary line; download de-emphasized to "re-download". */
	.tool.configured .tag.local {
		background: #1f2d23;
		color: #7ee787;
	}
	.tool.configured {
		border-color: #2b3a30;
	}
	.pathline {
		margin-top: 4px;
	}
	.pathval {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #cfcfd6;
		word-break: break-all;
	}
	.download {
		margin-top: 4px;
		font-size: 13px;
		color: #5db0ff;
		text-decoration: none;
	}
	.download.muted-link {
		color: #6b6b73;
		font-size: 12px;
	}
	.download.todo {
		color: #777;
	}
	.path {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.path label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.path .row {
		display: flex;
		gap: 8px;
	}
	.path input {
		flex: 1;
		min-width: 0;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: ui-monospace, monospace;
	}
	.path input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.path button {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 8px 14px;
		color: #fff;
		font-size: 13px;
		cursor: pointer;
	}
	.saved {
		font-size: 12px;
		color: #7ee0c0;
	}
</style>
