<script lang="ts">
	import { enhance } from '$app/forms';
	import Emblem from '$lib/Emblem.svelte';
	import LayoutProfileEditor from '$lib/LayoutProfileEditor.svelte';
	import { roleLabel } from '$lib/roles';
	import type { LayoutProfile } from 'engine-layout';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Editable working copy of the pipeline-wide layout-profile default (deep-cloned so
	// edits don't mutate the loaded data until saved).
	let layoutProfile = $state<LayoutProfile>(
		structuredClone(data.layoutProfile.profile) as LayoutProfile,
	);

	// --- Tabs ---
	type TabId =
		| 'users'
		| 'roles'
		| 'tools'
		| 'projects'
		| 'clients'
		| 'games'
		| 'sessions'
		| 'costs'
		| 'settings';
	const TABS: { id: TabId; label: string }[] = [
		{ id: 'users', label: 'Users' },
		{ id: 'roles', label: 'Roles' },
		{ id: 'tools', label: 'Tools' },
		{ id: 'projects', label: 'Projects' },
		{ id: 'clients', label: 'Clients' },
		{ id: 'games', label: 'Games' },
		{ id: 'sessions', label: 'Sessions' },
		{ id: 'costs', label: 'Costs' },
		{ id: 'settings', label: 'Settings' },
	];

	// --- Costs formatting -------------------------------------------------------
	// A gap renders as an em dash, never as $0.00 — "we don't know" and "it's zero"
	// are different answers on a billing page and must not look alike.
	function usd(amount: number | null | undefined): string {
		if (amount == null || !Number.isFinite(amount)) return '—';
		return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	}

	/**
	 * The same amount in euros, for the secondary line. Returns '' when there's no
	 * amount or no rate — the euro figure then simply doesn't render, rather than
	 * showing a converted-at-nothing zero.
	 */
	function eur(amount: number | null | undefined, rate: number | null | undefined): string {
		if (amount == null || !Number.isFinite(amount) || !rate) return '';
		return (amount * rate).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
	}

	const PROVIDER_LABELS: Record<string, string> = {
		runpod: 'RunPod',
		railway: 'Railway',
		r2: 'Cloudflare R2',
		openai: 'OpenAI',
		anthropic: 'Anthropic',
	};

	/** Today as `YYYY-MM-DD`, for the top-up date input's default. */
	const today = new Date().toISOString().slice(0, 10);
	let tab = $state<TabId>('users');

	// Keyboard nav for the tablist (left/right/home/end), per WAI-ARIA tabs pattern.
	function onTabKeydown(e: KeyboardEvent) {
		const i = TABS.findIndex((t) => t.id === tab);
		let next = i;
		if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = TABS.length - 1;
		else return;
		e.preventDefault();
		tab = TABS[next].id;
		document.getElementById(`tab-${TABS[next].id}`)?.focus();
	}

	let selectedId = $state<string | null>(null);
	const selected = $derived(data.users.find((u) => u.id === selectedId) ?? null);

	const loadedSessions = $derived(
		form?.action === 'loadSessions' && form.userId === selectedId ? form.sessions : null,
	);

	function fmtDate(d: string | Date | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString();
	}

	function fmtDatetimeLocal(d: string | Date | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		const off = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - off).toISOString().slice(0, 16);
	}

	function isExpired(d: string | Date | null): boolean {
		if (!d) return false;
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.getTime() < Date.now();
	}

	// Visual state of a session, scannable by colour + icon + label (never
	// colour-only, for accessibility). Revoked sessions are deleted server-side
	// so they don't appear in this list, but the state is mapped for parity with
	// any future revoked-but-retained display.
	type SessionState = 'active' | 'expiring' | 'expired' | 'revoked';
	const SESSION_STATE_META: Record<
		SessionState,
		{ label: string; icon: string; className: string }
	> = {
		active: { label: 'Active', icon: '●', className: 'active' },
		expiring: { label: 'Expiring soon', icon: '◐', className: 'expiring' },
		expired: { label: 'Expired', icon: '◷', className: 'expired' },
		revoked: { label: 'Revoked', icon: '⊘', className: 'revoked' },
	};
	const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;
	function sessionState(expiresAt: string | Date | null): SessionState {
		if (!expiresAt) return 'active';
		const ms = (typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt).getTime();
		const remaining = ms - Date.now();
		if (remaining <= 0) return 'expired';
		if (remaining <= EXPIRING_SOON_MS) return 'expiring';
		return 'active';
	}

	function overrideMode(userId: string, toolId: string): 'grant' | 'revoke' | 'default' {
		const ov = data.overrides[userId];
		if (!ov || !(toolId in ov)) return 'default';
		return ov[toolId] ? 'grant' : 'revoke';
	}

	function roleHasByDefault(role: string, toolId: string): boolean {
		return (data.roleTools[role as keyof typeof data.roleTools] ?? []).includes(toolId);
	}

	// --- Roles matrix (role × tool/capability overrides) ---

	function capDefault(role: string, key: string): boolean {
		return data.capabilityDefaults[role]?.[key] ?? false;
	}

	/** Baseline (no overrides) for a role + tool/capability column. */
	function cellDefault(role: string, key: string): boolean {
		const tool = data.tools.find((t) => t.id === key);
		return tool ? roleHasByDefault(role, key) : capDefault(role, key);
	}

	/** Current override mode for a role × column cell. */
	function roleOverrideMode(role: string, key: string): 'grant' | 'revoke' | 'default' {
		const ov = data.roleOverrides[role as keyof typeof data.roleOverrides];
		if (!ov || !(key in ov)) return 'default';
		return ov[key] ? 'grant' : 'revoke';
	}

	/** The admin role's admin-panel cell is locked on (can never be revoked). */
	function isLocked(role: string, key: string): boolean {
		return role === 'admin' && key === data.adminPanelCapability;
	}

	// --- Roles editor: grouped, searchable, collapsible capability matrix ---
	// Capabilities (rows) come from two sources in the existing load: managed
	// capabilities (`data.capabilities`, e.g. adminPanel) and tools (`data.tools`,
	// grouped by kind). We turn them into a single categorised list of rows; the
	// roles are the columns. Each cell reuses the existing `setRoleToolAccess`
	// action — this is purely a UI layer over the same DB-backed overrides.
	type CapRow = { key: string; name: string };
	type CapGroup = { id: string; label: string; rows: CapRow[] };

	const capGroups = $derived.by<CapGroup[]>(() => {
		const groups: CapGroup[] = [
			{ id: 'admin', label: 'Admin capabilities', rows: data.capabilities },
			{
				id: 'online',
				label: 'Online tools',
				rows: data.tools
					.filter((t) => t.kind === 'online')
					.map((t) => ({ key: t.id, name: t.name })),
			},
			{
				id: 'local',
				label: 'Local tools',
				rows: data.tools
					.filter((t) => t.kind === 'local')
					.map((t) => ({ key: t.id, name: t.name })),
			},
		];
		return groups.filter((g) => g.rows.length > 0);
	});

	let roleSearch = $state('');
	// Collapsed group ids. Default: everything expanded.
	let collapsed = $state<Record<string, boolean>>({});
	function toggleGroup(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
	}

	// Rows that survive the search filter (matches name or key, case-insensitive).
	function filterRows(rows: CapRow[]): CapRow[] {
		const q = roleSearch.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
	}

	// A user's project access for the UI: admins implicitly get every project;
	// everyone always has the default; access comes from user_project_access OR
	// an owning-client grant (user_client_access).
	function projectState(
		userId: string,
		role: string,
		projectKey: string,
	): 'implicit' | 'granted' | 'via-client' | 'none' {
		if (role === 'admin') return 'implicit';
		if (projectKey === data.defaultProjectKey) return 'implicit';
		if ((data.projectAccess[userId] ?? []).includes(projectKey)) return 'granted';
		const project = data.projects.find((p) => p.key === projectKey);
		if (project?.clientKey && (data.clientAccess[userId] ?? []).includes(project.clientKey)) {
			return 'via-client';
		}
		return 'none';
	}

	function clientGranted(userId: string, clientKey: string): boolean {
		return (data.clientAccess[userId] ?? []).includes(clientKey);
	}

	function clientNameFor(clientKey: string | null): string {
		if (!clientKey) return '—';
		return data.clients.find((c) => c.key === clientKey)?.name ?? clientKey;
	}

	// --- Settings: deploy token ---
	// The revealed secret only ever arrives via a reveal/set/rotate action result;
	// it lives in `form`, not `data`, so a plain page navigation re-masks it.
	const revealedDeployToken = $derived(
		form?.action === 'revealDeployToken' ||
			form?.action === 'setDeployToken' ||
			form?.action === 'rotateDeployToken'
			? (form.deployToken ?? null)
			: null,
	);

	// --- Settings: ComfyUI R&D pod fleet ---
	// Editable working copy of the admin-managed pod list. The URL is derived from the
	// id (`https://<id>-8188.proxy.runpod.net`) server-side, so only id + label are here.
	let runpodPods = $state(data.runpod.storedPods.map((p) => ({ id: p.id, label: p.label })));
	function addRunpodPod(): void {
		runpodPods = [...runpodPods, { id: '', label: '' }];
	}
	function removeRunpodPod(i: number): void {
		runpodPods = runpodPods.filter((_, idx) => idx !== i);
	}
	/** Live status for a pod id, if the effective fleet was probed on load. */
	function runpodStatusOf(id: string) {
		return data.runpod.pods.find((p) => p.id === id) ?? null;
	}
</script>

<svelte:head><title>Admin — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL · ADMIN</div>
		<a class="ghost" href="/">← Launcher</a>
	</header>

	{#if form?.error}
		<p class="banner error">{form.error}</p>
	{:else if form?.ok}
		<p class="banner ok">{form.ok}</p>
	{/if}

	<div class="tabs" role="tablist" aria-label="Admin sections" onkeydown={onTabKeydown}>
		{#each TABS as t (t.id)}
			<button
				id={`tab-${t.id}`}
				class="tab"
				class:active={tab === t.id}
				role="tab"
				type="button"
				aria-selected={tab === t.id}
				aria-controls={`panel-${t.id}`}
				tabindex={tab === t.id ? 0 : -1}
				onclick={() => (tab = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- USERS -->
	<div
		id="panel-users"
		role="tabpanel"
		aria-labelledby="tab-users"
		hidden={tab !== 'users'}
		tabindex="0"
	>
		<section>
			<h2>Users</h2>
			<div class="table">
				<div class="row head">
					<span>Email</span>
					<span>Role</span>
					<span>Status</span>
					<span>Login expiry</span>
					<span>Created</span>
					<span>Last activity</span>
					<span>Sessions</span>
				</div>
				{#each data.users as u (u.id)}
					<button
						class="row"
						class:selected={u.id === selectedId}
						onclick={() => (selectedId = u.id === selectedId ? null : u.id)}
					>
						<span class="email">
							{u.email}
							{#if u.id === data.currentUserId}<em class="you">you</em>{/if}
						</span>
						<span class="role">{roleLabel(u.role)}</span>
						<span class={u.active ? 'pill on' : 'pill off'}>
							{u.active ? 'enabled' : 'disabled'}
						</span>
						<span class={isExpired(u.expiresAt) ? 'warn' : ''}>{fmtDate(u.expiresAt)}</span>
						<span>{fmtDate(u.createdAt)}</span>
						<span>{fmtDate(u.lastSeenAt)}</span>
						<span>{u.sessionCount}</span>
					</button>
				{/each}
			</div>
		</section>

		<section class="cols">
			<div class="card">
				<h3>Create user</h3>
				<form method="POST" action="?/createUser" use:enhance class="stack">
					<label>Email<input name="email" type="email" autocomplete="off" required /></label>
					<label>Name (optional)<input name="name" type="text" autocomplete="off" /></label>
					<label>
						Role
						<select name="role">
							{#each data.roles as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
						</select>
					</label>
					<label>
						Initial password
						<input name="password" type="password" autocomplete="new-password" required />
					</label>
					<button type="submit">Create</button>
				</form>
			</div>

			{#if selected}
				<div class="card">
					<h3>Manage <span class="mono">{selected.email}</span></h3>

					<form method="POST" action="?/setRole" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<label class="grow">
							Role
							<select name="role" value={selected.role}>
								{#each data.roles as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
							</select>
						</label>
						<button type="submit">Save role</button>
					</form>

					<form method="POST" action="?/setActive" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<input type="hidden" name="active" value={(!selected.active).toString()} />
						<button type="submit" class={selected.active ? 'danger' : ''}>
							{selected.active ? 'Disable user' : 'Enable user'}
						</button>
					</form>

					<form method="POST" action="?/setExpiry" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<label class="grow">
							Login expires at
							<input
								name="expiresAt"
								type="datetime-local"
								value={fmtDatetimeLocal(selected.expiresAt)}
							/>
						</label>
						<button type="submit">Set / clear</button>
					</form>

					<form method="POST" action="?/resetPassword" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<label class="grow">
							New password
							<input name="password" type="password" autocomplete="new-password" />
						</label>
						<button type="submit">Reset</button>
					</form>

					<h4>Tool access</h4>
					<div class="tools">
						{#each data.tools as tool (tool.id)}
							{@const mode = overrideMode(selected.id, tool.id)}
							{@const def = roleHasByDefault(selected.role, tool.id)}
							<form method="POST" action="?/setToolAccess" use:enhance class="tool-row">
								<input type="hidden" name="userId" value={selected.id} />
								<input type="hidden" name="toolKey" value={tool.id} />
								<span class="tool-name">
									{tool.name}
									<em class="muted">{def ? 'role: granted' : 'role: none'}</em>
								</span>
								<select name="mode" value={mode}>
									<option value="default">Role default ({def ? 'on' : 'off'})</option>
									<option value="grant">Force grant</option>
									<option value="revoke">Force revoke</option>
								</select>
								<button type="submit">Apply</button>
							</form>
						{/each}
					</div>

					<h4>Sessions</h4>
					<form method="POST" action="?/loadSessions" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<button type="submit">Load active sessions</button>
					</form>
					{#if loadedSessions}
						{#if loadedSessions.length === 0}
							<p class="muted">No active sessions.</p>
						{:else}
							<div class="sessions">
								{#each loadedSessions as s (s.id)}
									{@const state = sessionState(s.expiresAt)}
									{@const meta = SESSION_STATE_META[state]}
									<div class="session">
										<span class={`status ${meta.className}`}>
											<span class="dot" aria-hidden="true">{meta.icon}</span>
											{meta.label}
										</span>
										<span class="mono">{s.id.slice(0, 12)}…</span>
										<span class="muted">created {fmtDate(s.createdAt)}</span>
										<span class="muted">expires {fmtDate(s.expiresAt)}</span>
										<form method="POST" action="?/revokeSession" use:enhance>
											<input type="hidden" name="sessionId" value={s.id} />
											<button type="submit" class="danger small">Revoke</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}
						<form method="POST" action="?/revokeAllSessions" use:enhance class="inline">
							<input type="hidden" name="userId" value={selected.id} />
							<button type="submit" class="danger">Revoke all sessions</button>
						</form>
					{/if}

					<h4>Client access</h4>
					{#if selected.role === 'admin'}
						<p class="muted">Admins can access every client and project.</p>
					{:else if data.clients.length === 0}
						<p class="muted">No clients yet.</p>
					{:else}
						<div class="tools">
							{#each data.clients as c (c.key)}
								{@const granted = clientGranted(selected.id, c.key)}
								<div class="tool-row">
									<span class="tool-name">
										{c.name}
										<em class="muted">{c.key}</em>
									</span>
									<span class={granted ? 'pill on' : 'muted'}>
										{granted ? 'granted' : 'no access'}
									</span>
									<form method="POST" action="?/setClientAccess" use:enhance>
										<input type="hidden" name="userId" value={selected.id} />
										<input type="hidden" name="clientKey" value={c.key} />
										<input type="hidden" name="grant" value={(!granted).toString()} />
										<button type="submit" class={granted ? 'danger' : ''}>
											{granted ? 'Revoke' : 'Grant'}
										</button>
									</form>
								</div>
							{/each}
						</div>
					{/if}

					<h4>Project access</h4>
					{#if selected.role === 'admin'}
						<p class="muted">Admins can access every project.</p>
					{:else}
						<div class="tools">
							{#each data.projects as p (p.key)}
								{@const state = projectState(selected.id, selected.role, p.key)}
								<div class="tool-row">
									<span class="tool-name">
										{p.name}
										<em class="muted">{p.key} · {clientNameFor(p.clientKey)}</em>
									</span>
									{#if state === 'implicit'}
										<span class="muted">always available</span>
										<span></span>
									{:else if state === 'via-client'}
										<span class="pill on">via client</span>
										<span></span>
									{:else}
										<span class={state === 'granted' ? 'pill on' : 'muted'}>
											{state === 'granted' ? 'granted' : 'no access'}
										</span>
										<form method="POST" action="?/setProjectAccess" use:enhance>
											<input type="hidden" name="userId" value={selected.id} />
											<input type="hidden" name="projectKey" value={p.key} />
											<input type="hidden" name="grant" value={(state !== 'granted').toString()} />
											<button type="submit" class={state === 'granted' ? 'danger' : ''}>
												{state === 'granted' ? 'Revoke' : 'Grant'}
											</button>
										</form>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if selected.id !== data.currentUserId}
						<h4>Danger zone</h4>
						<form method="POST" action="?/deleteUser" use:enhance class="inline">
							<input type="hidden" name="userId" value={selected.id} />
							<button type="submit" class="danger">
								Delete user (cascades sessions + access)
							</button>
						</form>
					{/if}
				</div>
			{:else}
				<div class="card muted center">Select a user above to manage them.</div>
			{/if}
		</section>
	</div>

	<!-- ROLES -->
	<div
		id="panel-roles"
		role="tabpanel"
		aria-labelledby="tab-roles"
		hidden={tab !== 'roles'}
		tabindex="0"
	>
		<section>
			<h2>Roles</h2>
			<p class="muted hint">
				Per-role defaults from the tool registry, overridable here. <strong>Grant</strong> forces a
				capability on, <strong>Revoke</strong> forces it off, <strong>Default</strong> reverts to the
				baseline. User-level overrides (per user) still win on top of these. Capabilities are grouped
				and searchable so the matrix stays readable as more are added.
			</p>

			<div class="roles-toolbar">
				<input
					class="search"
					type="search"
					placeholder="Filter capabilities…"
					bind:value={roleSearch}
					autocomplete="off"
					aria-label="Filter capabilities"
				/>
			</div>

			<div class="role-matrix" style={`--role-cols: ${data.roles.length}`}>
				<div class="rm-row rm-head">
					<span class="rm-cap">Capability</span>
					{#each data.roles as role (role)}
						<span class="rm-role">{roleLabel(role)}</span>
					{/each}
				</div>

				{#each capGroups as group (group.id)}
					{@const rows = filterRows(group.rows)}
					{#if rows.length > 0}
						<div class="rm-group">
							<button
								type="button"
								class="rm-group-head"
								aria-expanded={!collapsed[group.id]}
								onclick={() => toggleGroup(group.id)}
							>
								<span class="caret" aria-hidden="true">{collapsed[group.id] ? '▸' : '▾'}</span>
								{group.label}
								<span class="rm-count">{rows.length}</span>
							</button>
							{#if !collapsed[group.id]}
								{#each rows as cap (cap.key)}
									<div class="rm-row">
										<span class="rm-cap" title={cap.key}>
											{cap.name}
											<em class="rm-key">{cap.key}</em>
										</span>
										{#each data.roles as role (role)}
											{@const def = cellDefault(role, cap.key)}
											{@const mode = roleOverrideMode(role, cap.key)}
											{@const locked = isLocked(role, cap.key)}
											<span class="rm-cell">
												{#if locked}
													<span class="pill on locked">always on</span>
												{:else}
													<form method="POST" action="?/setRoleToolAccess" use:enhance>
														<input type="hidden" name="role" value={role} />
														<input type="hidden" name="toolKey" value={cap.key} />
														<select
															name="mode"
															class={`tri ${mode}`}
															value={mode}
															aria-label={`${roleLabel(role)} — ${cap.name}`}
															onchange={(e) => e.currentTarget.form?.requestSubmit()}
														>
															<option value="default">Default ({def ? 'on' : 'off'})</option>
															<option value="grant">Grant</option>
															<option value="revoke">Revoke</option>
														</select>
													</form>
												{/if}
											</span>
										{/each}
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	</div>

	<!-- TOOLS -->
	<div
		id="panel-tools"
		role="tabpanel"
		aria-labelledby="tab-tools"
		hidden={tab !== 'tools'}
		tabindex="0"
	>
		<section>
			<h2>Tools</h2>
			<p class="muted hint">
				The platform tool registry (read-only here). Each tool's per-role and per-user availability
				is managed in the <button type="button" class="link" onclick={() => (tab = 'roles')}>
					Roles
				</button>
				tab and the per-user panel in
				<button type="button" class="link" onclick={() => (tab = 'users')}> Users </button>.
			</p>
			<div class="table tools-table">
				<div class="row head tools-head">
					<span>Tool</span>
					<span>Key</span>
					<span>Kind</span>
				</div>
				{#each data.tools as tool (tool.id)}
					<div class="row tools-row">
						<span>{tool.name}</span>
						<span class="mono">{tool.id}</span>
						<span class={tool.kind === 'online' ? 'pill on' : 'pill cap'}>{tool.kind}</span>
					</div>
				{/each}
			</div>
		</section>
	</div>

	<!-- PROJECTS -->
	<div
		id="panel-projects"
		role="tabpanel"
		aria-labelledby="tab-projects"
		hidden={tab !== 'projects'}
		tabindex="0"
	>
		<section>
			<h2>Projects</h2>
			<div class="projects">
				{#each data.projects as p (p.key)}
					<div class="project-row">
						<span class="mono key">{p.key}</span>
						<form method="POST" action="?/renameProject" use:enhance class="rename">
							<input type="hidden" name="key" value={p.key} />
							<input name="name" type="text" value={p.name} autocomplete="off" />
							<button type="submit">Rename</button>
						</form>
						<form method="POST" action="?/assignProjectClient" use:enhance class="assign">
							<input type="hidden" name="projectKey" value={p.key} />
							<select
								name="clientKey"
								value={p.clientKey ?? ''}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							>
								<option value="">— no client —</option>
								{#each data.clients as c (c.key)}
									<option value={c.key}>{c.name}</option>
								{/each}
							</select>
						</form>
						<form
							method="POST"
							action="?/setProjectGameType"
							use:enhance
							class="gametype"
							title="Game kind — picks the editor template + scaffold"
						>
							<input type="hidden" name="key" value={p.key} />
							<select
								name="gameType"
								value={p.gameType ?? ''}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							>
								<option value="" disabled>— kind —</option>
								{#each data.gameKinds as gk (gk.id)}
									<option value={gk.id}>{gk.name}</option>
								{/each}
							</select>
						</form>
						<form method="POST" action="?/rescaffoldProject" use:enhance>
							<input type="hidden" name="key" value={p.key} />
							<button type="submit" class="small">Rescaffold</button>
						</form>
						{#if p.key === data.defaultProjectKey}
							<span class="pill on">default</span>
						{:else}
							<form method="POST" action="?/deleteProject" use:enhance>
								<input type="hidden" name="key" value={p.key} />
								<button type="submit" class="danger small">Delete</button>
							</form>
						{/if}
					</div>
				{/each}
				<form method="POST" action="?/createProject" use:enhance class="project-row create">
					<input
						name="key"
						type="text"
						placeholder="key (e.g. borut)"
						autocomplete="off"
						required
					/>
					<input name="name" type="text" placeholder="Display name" autocomplete="off" required />
					<select name="clientKey">
						<option value="">— unassigned —</option>
						{#each data.clients as c (c.key)}
							<option value={c.key}>{c.name}</option>
						{/each}
					</select>
					<select name="gameType" title="Game kind">
						{#each data.gameKinds as gk (gk.id)}
							<option value={gk.id}>{gk.name}</option>
						{/each}
					</select>
					<button type="submit">Create project</button>
				</form>
			</div>
		</section>
	</div>

	<!-- CLIENTS -->
	<div
		id="panel-clients"
		role="tabpanel"
		aria-labelledby="tab-clients"
		hidden={tab !== 'clients'}
		tabindex="0"
	>
		<section>
			<h2>Clients</h2>
			<p class="muted hint">
				Clients group projects. Granting a user a client (in the per-user panel under Users) grants
				access to every project owned by that client.
			</p>
			<div class="projects">
				{#each data.clients as c (c.key)}
					<div class="project-row">
						<span class="mono key">{c.key}</span>
						<form method="POST" action="?/renameClient" use:enhance class="rename">
							<input type="hidden" name="key" value={c.key} />
							<input name="name" type="text" value={c.name} autocomplete="off" />
							<button type="submit">Rename</button>
						</form>
						<form method="POST" action="?/deleteClient" use:enhance>
							<input type="hidden" name="key" value={c.key} />
							<button type="submit" class="danger small">Delete</button>
						</form>
					</div>
				{:else}
					<p class="muted">No clients yet.</p>
				{/each}
				<form method="POST" action="?/createClient" use:enhance class="project-row create">
					<input
						name="key"
						type="text"
						placeholder="key (e.g. borut)"
						autocomplete="off"
						required
					/>
					<input name="name" type="text" placeholder="Display name" autocomplete="off" required />
					<button type="submit">Create client</button>
				</form>
			</div>
		</section>
	</div>

	<!-- GAMES -->
	<div
		id="panel-games"
		role="tabpanel"
		aria-labelledby="tab-games"
		hidden={tab !== 'games'}
		tabindex="0"
	>
		<section>
			<h2>Games</h2>
			<p class="muted hint">
				Each game has its own name + launch URL, and is scoped to a project: it appears on the home
				Games grid only when that project (or its client) is selected. Leave the project as
				<em>Global</em> to show it on every selection. The launch URL gets the active project
				appended (<code>?project=…</code>). Games will live on a future dedicated game server.
				<strong>Leave the URL blank when creating</strong> and it auto-fills the standard
				test-server URL for the key (<code
					>{data.gamesBaseUrl}/&lt;key&gt;/?sessionID=demo&amp;rgs_url=…/api/&lt;key&gt;&amp;lang=en</code
				>); enter a URL only for games hosted elsewhere. The game still has to be published to that
				path to actually load.
			</p>
			<div class="projects">
				{#each data.games as g (g.key)}
					<div class="project-row">
						<span class="mono key">{g.key}</span>
						<form method="POST" action="?/renameGame" use:enhance class="rename">
							<input type="hidden" name="key" value={g.key} />
							<input name="name" type="text" value={g.name} autocomplete="off" />
							<button type="submit">Rename</button>
						</form>
						<form method="POST" action="?/setGameUrl" use:enhance class="rename">
							<input type="hidden" name="key" value={g.key} />
							<input
								name="url"
								type="text"
								value={g.url}
								placeholder="https://…"
								autocomplete="off"
							/>
							<button type="submit">Save URL</button>
						</form>
						<form method="POST" action="?/setGameProject" use:enhance class="rename">
							<input type="hidden" name="key" value={g.key} />
							<select name="project">
								<option value="" selected={!g.projectKey}>Global (all projects)</option>
								{#each data.projects as p (p.key)}
									<option value={p.key} selected={g.projectKey === p.key}>{p.name}</option>
								{/each}
							</select>
							<button type="submit">Save scope</button>
						</form>
						<form method="POST" action="?/deleteGame" use:enhance>
							<input type="hidden" name="key" value={g.key} />
							<button type="submit" class="danger small">Delete</button>
						</form>
					</div>
				{:else}
					<p class="muted">No games yet.</p>
				{/each}
				<form method="POST" action="?/createGame" use:enhance class="project-row create">
					<input
						name="key"
						type="text"
						placeholder="key (e.g. lines)"
						autocomplete="off"
						required
					/>
					<input name="name" type="text" placeholder="Display name" autocomplete="off" required />
					<input
						name="url"
						type="text"
						placeholder="https://… (blank = auto test-server URL)"
						autocomplete="off"
					/>
					<select name="project">
						<option value="">Global (all projects)</option>
						{#each data.projects as p (p.key)}
							<option value={p.key} selected={p.key === data.activeProjectKey}>{p.name}</option>
						{/each}
					</select>
					<button type="submit">Create game</button>
				</form>
			</div>
		</section>
	</div>

	<!-- SESSIONS -->
	<div
		id="panel-sessions"
		role="tabpanel"
		aria-labelledby="tab-sessions"
		hidden={tab !== 'sessions'}
		tabindex="0"
	>
		<section>
			<h2>Sessions</h2>
			<p class="muted hint">
				Select a user in the <button type="button" class="link" onclick={() => (tab = 'users')}>
					Users
				</button> tab, then load their active sessions there to revoke individual or all sessions. The
				session list shows a colour + icon badge per state (active, expiring, expired).
			</p>
			{#if selected}
				<div class="card">
					<h3>Sessions for <span class="mono">{selected.email}</span></h3>
					<form method="POST" action="?/loadSessions" use:enhance class="inline">
						<input type="hidden" name="userId" value={selected.id} />
						<button type="submit">Load active sessions</button>
					</form>
					{#if loadedSessions}
						{#if loadedSessions.length === 0}
							<p class="muted">No active sessions.</p>
						{:else}
							<div class="sessions">
								{#each loadedSessions as s (s.id)}
									{@const state = sessionState(s.expiresAt)}
									{@const meta = SESSION_STATE_META[state]}
									<div class="session">
										<span class={`status ${meta.className}`}>
											<span class="dot" aria-hidden="true">{meta.icon}</span>
											{meta.label}
										</span>
										<span class="mono">{s.id.slice(0, 12)}…</span>
										<span class="muted">created {fmtDate(s.createdAt)}</span>
										<span class="muted">expires {fmtDate(s.expiresAt)}</span>
										<form method="POST" action="?/revokeSession" use:enhance>
											<input type="hidden" name="sessionId" value={s.id} />
											<button type="submit" class="danger small">Revoke</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}
						<form method="POST" action="?/revokeAllSessions" use:enhance class="inline">
							<input type="hidden" name="userId" value={selected.id} />
							<button type="submit" class="danger">Revoke all sessions</button>
						</form>
					{/if}
				</div>
			{:else}
				<div class="card muted center">Select a user in the Users tab first.</div>
			{/if}
		</section>
	</div>

	<!-- COSTS -->
	<div
		id="panel-costs"
		role="tabpanel"
		aria-labelledby="tab-costs"
		hidden={tab !== 'costs'}
		tabindex="0"
	>
		<section>
			<h2>Costs</h2>
			<p class="muted hint">
				What the pipeline is spending, per provider. Figures come straight from each provider's own
				API and are cached for ten minutes — hit <strong>Refresh</strong> to re-read them now.
				Anything marked <span class="pill est">estimate</span> is our arithmetic over usage counters
				rather than a billed figure, so reconcile against the provider's invoice, not against this page.
			</p>

			{#await data.costs}
				<p class="muted">Reading provider costs…</p>
			{:then costs}
				{@const known = costs.providers.filter((p) => p.ok && p.spendUsd != null)}
				{@const total = known.reduce((sum, p) => sum + (p.spendUsd ?? 0), 0)}

				<div class="cost-top">
					<div class="cost-total">
						<span class="muted">Measured spend</span>
						<strong>{usd(known.length ? total : null)}</strong>
						{#if known.length && costs.fx}
							<span class="muted eur-total">{eur(total, costs.fx.rate)}</span>
						{/if}
						<span class="muted hint">
							{#if known.length}
								across {known.length} of {costs.providers.length} providers · windows differ per provider
							{:else}
								no provider is reporting spend yet
							{/if}
						</span>
					</div>
					<form method="POST" action="?/refreshCosts" use:enhance>
						<button type="submit" class="ghost-btn">Refresh</button>
					</form>
				</div>

				<div class="cost-grid">
					{#each costs.providers as provider (provider.id)}
						{@const credit = costs.credits[provider.id]}
						<div class="card cost-card" class:unset={!provider.configured}>
							<div class="cost-head">
								<h3>{provider.label}</h3>
								{#if !provider.configured}
									<span class="pill off">not configured</span>
								{:else if !provider.ok}
									<span class="pill err">unavailable</span>
								{:else if provider.estimated}
									<span class="pill est">estimate</span>
								{:else}
									<span class="pill on">live</span>
								{/if}
							</div>

							{#if provider.configured && provider.ok}
								<div class="cost-figures">
									{#if provider.balanceUsd != null}
										<div class="figure">
											<span class="muted">Balance</span>
											<strong>{usd(provider.balanceUsd)}</strong>
											{#if costs.fx}
												<span class="muted eur">{eur(provider.balanceUsd, costs.fx.rate)}</span>
											{/if}
										</div>
									{/if}
									{#if provider.spendUsd != null}
										<div class="figure">
											<span class="muted">Spend ({provider.spendWindow ?? 'window'})</span>
											<strong>{usd(provider.spendUsd)}</strong>
											{#if costs.fx}
												<span class="muted eur">{eur(provider.spendUsd, costs.fx.rate)}</span>
											{/if}
										</div>
									{/if}
									{#if provider.ratePerHourUsd != null}
										<div class="figure">
											<span class="muted">Burn rate</span>
											<strong>{usd(provider.ratePerHourUsd)}<span class="muted">/hr</span></strong>
										</div>
									{/if}
									{#if credit?.remainingUsd != null}
										<div class="figure">
											<span class="muted">Credit left (est.)</span>
											<strong>{usd(credit.remainingUsd)}</strong>
											{#if costs.fx}
												<span class="muted eur">{eur(credit.remainingUsd, costs.fx.rate)}</span>
											{/if}
										</div>
									{:else if credit && credit.toppedUpUsd > 0}
										<div class="figure">
											<span class="muted">Recorded top-ups</span>
											<strong>{usd(credit.toppedUpUsd)}</strong>
										</div>
									{/if}
								</div>
							{/if}

							{#if provider.reason}
								<p class="muted hint cost-reason">{provider.reason}</p>
							{/if}

							{#if provider.requires && provider.requires.length > 0}
								{@const required = provider.requires}
								<p class="muted hint">
									Set
									{#each required as name, i (name)}
										<span class="mono">{name}</span>{i < required.length - 1 ? ', ' : ''}
									{/each}
									on the launcher service, then Apply changes / Deploy in Railway.
								</p>
							{/if}

							{#if provider.lines.length}
								<div class="cost-lines">
									{#each provider.lines as line (line.label)}
										<div class="cost-line">
											<span class="cost-line-label">{line.label}</span>
											{#if line.detail}
												<span class="muted cost-line-detail">{line.detail}</span>
											{/if}
											<span class="cost-line-amount mono">{usd(line.amountUsd)}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<div class="card">
					<h3>Prepaid top-ups</h3>
					<p class="muted hint">
						Only RunPod publishes a real balance. Anthropic reports spend but never a remaining
						balance, and Railway and R2 have no prepaid concept at all — so for those, record what
						you added here and the page derives
						<strong>credit left ≈ recorded top-ups − measured spend since your first entry</strong>.
						That derived figure is only as good as this ledger: it assumes the balance started at
						zero and that every top-up is recorded.
					</p>

					<form method="POST" action="?/addCostTopUp" use:enhance class="inline topup-form">
						<label>
							Provider
							<select name="provider">
								{#each data.costProviders as id (id)}
									<option value={id}>{PROVIDER_LABELS[id] ?? id}</option>
								{/each}
							</select>
						</label>
						<label>
							Amount (USD)
							<input name="amountUsd" type="text" inputmode="decimal" placeholder="200" />
						</label>
						<label>
							Date
							<input name="occurredAt" type="date" value={today} />
						</label>
						<label class="grow">
							Note
							<input name="note" type="text" placeholder="optional — invoice ref, who paid" />
						</label>
						<button type="submit">Record</button>
					</form>

					{#if costs.topUps.length}
						<div class="table topup-table">
							<div class="row head">
								<span>Provider</span>
								<span>Amount</span>
								<span>Date</span>
								<span>Note</span>
								<span></span>
							</div>
							{#each costs.topUps as entry (entry.id)}
								<div class="row">
									<span>{PROVIDER_LABELS[entry.provider] ?? entry.provider}</span>
									<span class="mono">{usd(entry.amountUsd)}</span>
									<span class="muted">{fmtDate(entry.occurredAt)}</span>
									<span class="muted">{entry.note ?? '—'}</span>
									<form method="POST" action="?/deleteCostTopUp" use:enhance>
										<input type="hidden" name="id" value={entry.id} />
										<button type="submit" class="ghost-btn small">Remove</button>
									</form>
								</div>
							{/each}
						</div>
					{:else}
						<p class="muted">No top-ups recorded yet.</p>
					{/if}
				</div>

				<p class="muted hint">
					Snapshot taken {fmtDate(costs.fetchedAt)}{costs.cached ? ' (cached)' : ''}.
					{#if costs.fx}
						Every provider bills in USD; euro figures convert at
						<strong>{costs.fx.rate.toFixed(4)}</strong> USD→EUR ({costs.fx.source}, published
						{costs.fx.date}). ECB publishes once per working day, so that date is often yesterday
						and holds over a weekend.
					{:else}
						Euro conversion unavailable — showing USD only rather than converting at a stale rate.
					{/if}
				</p>
			{/await}
		</section>
	</div>

	<!-- SETTINGS -->
	<div
		id="panel-settings"
		role="tabpanel"
		aria-labelledby="tab-settings"
		hidden={tab !== 'settings'}
		tabindex="0"
	>
		<section>
			<h2>Settings</h2>
			<p class="muted hint">
				Build &amp; deploy secrets managed in the database (overriding any Railway env-var
				bootstrap). Only admins can view, set, or rotate these. Values are masked by default.
			</p>

			<div class="card">
				<h3>Deploy token</h3>
				<p class="muted hint">
					The shared token the desktop launcher fetches (<span class="mono"
						>GET /api/launcher/deploy-token</span
					>) and injects into game builds so <span class="mono">bake:doc</span>,
					<span class="mono">pull:assets</span>, and the editor exports run authenticated. The
					launcher endpoint requires the <strong>Build &amp; publish games</strong> capability
					(grant it per role or per user under
					<button type="button" class="link" onclick={() => (tab = 'roles')}>Roles</button>).
					Rotating requires game rebuilds to pick up the new token; already-deployed (baked) games
					are unaffected since they don't use it at runtime.
				</p>

				<div class="token-status">
					<span class="muted">Current</span>
					{#if data.deployToken.configured}
						<span class="mono token-masked">{data.deployToken.masked}</span>
						<span class="pill on">configured</span>
					{:else}
						<span class="mono muted">— not configured —</span>
						<span class="pill off">unset</span>
					{/if}
				</div>

				{#if revealedDeployToken}
					<div class="token-reveal">
						<label for="revealed-token">Revealed token (copy now — it re-masks on reload)</label>
						<input
							id="revealed-token"
							class="mono"
							type="text"
							readonly
							value={revealedDeployToken}
							onfocus={(e) => e.currentTarget.select()}
						/>
					</div>
				{/if}

				<div class="token-actions">
					<form method="POST" action="?/revealDeployToken" use:enhance>
						<button type="submit" class="ghost-btn">Reveal current</button>
					</form>
					<form method="POST" action="?/rotateDeployToken" use:enhance>
						<button type="submit">Rotate (generate new)</button>
					</form>
				</div>

				<form method="POST" action="?/setDeployToken" use:enhance class="inline token-set">
					<label class="grow">
						Set token (typed value)
						<input
							name="token"
							type="text"
							autocomplete="off"
							placeholder="paste or type a token"
						/>
					</label>
					<button type="submit">Save</button>
				</form>
			</div>

			<div class="card">
				<h3>Layout profile (pipeline default)</h3>
				<p class="muted hint">
					The default set of layout buckets — each with a design resolution/aspect and the window
					rule that selects it — seeded into <strong>every</strong> project that hasn't authored its
					own (Scene Editor → Game Settings → Layout). Changing this reshapes the editor preview
					frame + HUD box and the runtime bucket selection for all such games.
					{#if data.layoutProfile.custom}
						<span class="pill on">custom default set</span>
					{:else}
						<span class="pill off">using built-in default</span>
					{/if}
				</p>

				<LayoutProfileEditor bind:profile={layoutProfile} />

				<div class="token-actions">
					<form
						method="POST"
						action="?/saveLayoutProfile"
						use:enhance
						onsubmit={(e) => {
							const el = e.currentTarget.querySelector<HTMLInputElement>('input[name=profile]');
							if (el) el.value = JSON.stringify(layoutProfile);
						}}
					>
						<input type="hidden" name="profile" value="" />
						<button type="submit">Save pipeline default</button>
					</form>
					{#if data.layoutProfile.custom}
						<form
							method="POST"
							action="?/resetLayoutProfile"
							use:enhance={() => {
								return async ({ update }) => {
									await update();
									layoutProfile = structuredClone(data.layoutProfile.profile) as LayoutProfile;
								};
							}}
						>
							<button type="submit" class="ghost-btn">Revert to built-in</button>
						</form>
					{/if}
				</div>
			</div>

			<div class="card">
				<h3>Edge cache &amp; build</h3>
				<p class="muted hint">
					Force Cloudflare to drop its cached copies for the
					<span class="mono">invisiblewall.org</span> zone — a manual lever for when the
					<strong>game</strong> host (<span class="mono">games.invisiblewall.org</span>) is
					suspected of serving a stale file. Safe: game assets are
					<span class="mono">no-store</span> or content-hashed, so a purge only forces a re-fetch.
					Note: <span class="mono">app.invisiblewall.org</span> (this launcher + the tool pages) is
					DNS-only, <strong>not</strong> behind Cloudflare — those refresh via content-hashing and
					the per-deploy <span class="mono">?v=</span> bust, so this button does not affect them.
				</p>

				<div class="token-status">
					<span class="muted">Running build</span>
					<span class="mono token-masked">{data.buildId}</span>
					{#if data.cfConfigured}
						<span class="pill on">CF purge ready</span>
					{:else}
						<span class="pill off">CF not configured</span>
					{/if}
				</div>

				<div class="token-actions">
					<form method="POST" action="?/purgeCache" use:enhance>
						<button type="submit" disabled={!data.cfConfigured}
							>Purge edge cache (whole zone)</button
						>
					</form>
				</div>
			</div>

			<div class="card">
				<h3>ComfyUI R&amp;D pod fleet</h3>
				<p class="muted hint">
					The on-demand RunPod GPUs behind the <a class="link" href="/comfyui">ComfyUI</a> tool.
					Artists pick a card and start it (if it's out of free GPUs they try the next); pods
					auto-stop after an idle window so the GPU only bills while work is happening. A non-empty
					ComfyUI render queue counts as activity, so a running render is never interrupted. Each
					pod's ComfyUI URL is derived from its id (<span class="mono"
						>https://&lt;id&gt;-8188.proxy.runpod.net</span
					>).
					{#if !data.runpod.configured}
						<br /><strong>Not configured</strong> — set
						<span class="mono">RUNPOD_API_KEY</span> in the launcher environment and add at least
						one pod below (a legacy <span class="mono">RUNPOD_POD_ID</span> env still works as a single
						"Default" pod).
					{/if}
				</p>

				<form method="POST" action="?/setRunpodPods" use:enhance class="runpod-fleet">
					{#each runpodPods as pod, i (i)}
						{@const live = runpodStatusOf(pod.id)}
						<div class="pod-edit">
							<label class="grow">
								Pod id
								<input
									name="podId"
									type="text"
									autocomplete="off"
									bind:value={pod.id}
									placeholder="runpod pod id"
								/>
							</label>
							<label class="grow">
								Label
								<input
									name="podLabel"
									type="text"
									autocomplete="off"
									bind:value={pod.label}
									placeholder="e.g. RTX 4090"
								/>
							</label>
							<div class="pod-live">
								{#if live}
									{#if live.status === 'running'}
										<span class="pill on">{live.ready ? 'running' : 'warming'}</span>
									{:else if live.status === 'starting'}
										<span class="pill off">starting</span>
									{:else if live.status === 'stopped'}
										<span class="pill off">stopped</span>
									{:else}
										<span class="pill off">unknown</span>
									{/if}
								{:else}
									<span class="pill off">—</span>
								{/if}
							</div>
							<button type="button" class="ghost-btn" onclick={() => removeRunpodPod(i)}
								>Remove</button
							>
						</div>
					{/each}
					<div class="token-actions">
						<button type="button" class="ghost-btn" onclick={addRunpodPod}>+ Add pod</button>
						<button type="submit">Save fleet</button>
					</div>
				</form>

				<form method="POST" action="?/setRunpodIdle" use:enhance class="runpod-idle">
					<label class="check">
						<input type="checkbox" name="enabled" value="true" checked={data.runpod.idleEnabled} />
						Enable idle auto-stop
					</label>
					<label class="minutes">
						Idle minutes
						<input
							name="minutes"
							type="number"
							min="1"
							step="1"
							value={data.runpod.idleMinutes}
							placeholder={String(data.runpod.idleDefaultMinutes)}
						/>
					</label>
					<button type="submit">Save idle settings</button>
				</form>

				{#if data.runpod.configured && data.runpod.pods.length}
					<div class="pod-stops">
						<span class="muted hint">Manual stop:</span>
						{#each data.runpod.pods as p (p.id)}
							<form method="POST" action="?/stopRunpodPod" use:enhance>
								<input type="hidden" name="podId" value={p.id} />
								<button type="submit" class="ghost-btn">Stop {p.label}</button>
							</form>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		padding: 32px clamp(24px, 4vw, 64px) 64px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
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
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 13px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 24px;
		padding: 4px;
		background: #121218;
		border: 1px solid #222;
		border-radius: 12px;
		width: fit-content;
		max-width: 100%;
	}
	.tab {
		background: transparent;
		border: none;
		color: #999;
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		letter-spacing: 0.03em;
	}
	.tab:hover {
		color: #ddd;
		background: #181820;
	}
	.tab.active {
		background: #6b5bff;
		color: #fff;
	}
	.tab:focus-visible {
		outline: 2px solid #6b5bff;
		outline-offset: 2px;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	h3 {
		font-size: 15px;
		margin: 0 0 14px;
	}
	h4 {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 20px 0 8px;
	}
	.banner {
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
	}
	.banner.error {
		background: #2c1618;
		color: #ff9d9d;
	}
	.banner.ok {
		background: #16291f;
		color: #7ee0c0;
	}
	.muted {
		color: #888;
	}
	.center {
		text-align: center;
		padding: 40px;
	}
	.mono {
		font-family: ui-monospace, monospace;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: #8ab4ff;
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}
	.table {
		display: flex;
		flex-direction: column;
		border: 1px solid #222;
		border-radius: 10px;
		overflow: hidden;
		font-size: 13px;
	}
	.row {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr 1.6fr 1.6fr 1.6fr 0.7fr;
		gap: 8px;
		align-items: center;
		padding: 10px 14px;
		text-align: left;
		background: #121218;
		border: none;
		border-top: 1px solid #1d1d24;
		color: #ddd;
		cursor: pointer;
		font: inherit;
	}
	.row.head {
		background: #0e0e13;
		color: #777;
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 0.04em;
		cursor: default;
	}
	.row:not(.head):hover {
		background: #181820;
	}
	.row.selected {
		background: #1c1830;
	}
	.tools-table .tools-head,
	.tools-table .tools-row {
		grid-template-columns: 2fr 1.5fr 1fr;
		cursor: default;
	}
	.email {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.you {
		font-style: normal;
		font-size: 10px;
		background: #2a2440;
		color: #c8a3ff;
		padding: 1px 6px;
		border-radius: 999px;
	}
	.role {
		text-transform: capitalize;
		color: #c8a3ff;
	}
	.pill {
		justify-self: start;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
	}
	.pill.on {
		background: #16291f;
		color: #7ee787;
	}
	.pill.off {
		background: #2c1618;
		color: #ff9d9d;
	}
	.pill.cap {
		background: #2a2430;
		color: #c8a3ff;
	}
	.warn {
		color: #ffb86b;
	}
	.cols {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 16px;
		margin-top: 24px;
		align-items: start;
	}
	.card {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 18px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
	}
	input,
	select {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		text-transform: none;
		letter-spacing: normal;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	button {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 9px 14px;
		color: #fff;
		font-size: 13px;
		cursor: pointer;
		white-space: nowrap;
	}
	button.danger {
		background: #7a2230;
	}
	button.small {
		padding: 5px 10px;
		font-size: 12px;
	}
	.inline {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 12px;
	}
	.grow {
		flex: 1;
	}
	.tools,
	.sessions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tool-row {
		display: grid;
		grid-template-columns: 1fr 180px auto;
		gap: 10px;
		align-items: center;
	}
	.tool-name {
		display: flex;
		flex-direction: column;
		font-size: 13px;
	}
	.tool-name em {
		font-style: normal;
		font-size: 11px;
	}
	.session {
		display: grid;
		grid-template-columns: 130px 1fr 1.4fr 1.4fr auto;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		padding: 8px 10px;
		background: #0f0f14;
		border-radius: 8px;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.status .dot {
		font-size: 10px;
		line-height: 1;
	}
	.status.active {
		background: #16271c;
		color: #7ee787;
	}
	.status.expiring {
		background: #2c2614;
		color: #ffd479;
	}
	.status.expired {
		background: #2a2117;
		color: #f0a868;
	}
	.status.revoked {
		background: #2c1719;
		color: #ff8b8b;
	}
	.hint {
		font-size: 12px;
		margin: 0 0 12px;
	}

	/* --- Roles editor --- */
	.roles-toolbar {
		display: flex;
		gap: 10px;
		margin-bottom: 12px;
	}
	.search {
		flex: 1;
		max-width: 360px;
	}
	.role-matrix {
		display: flex;
		flex-direction: column;
		border: 1px solid #222;
		border-radius: 10px;
		/* The grid keeps a min width per role column, so with many roles the rows
		   are wider than the panel — scroll instead of clipping them. */
		overflow-x: auto;
		overflow-y: hidden;
		background: #121218;
	}
	.rm-row {
		display: grid;
		grid-template-columns: minmax(220px, 2fr) repeat(var(--role-cols, 4), minmax(140px, 1fr));
		min-width: max-content;
		gap: 10px;
		align-items: center;
		padding: 9px 14px;
		border-top: 1px solid #1d1d24;
	}
	.rm-head {
		background: #0e0e13;
		color: #777;
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 0.04em;
		border-top: none;
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.rm-role {
		text-transform: capitalize;
		color: #c8a3ff;
		font-weight: 600;
	}
	.rm-cap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
		color: #ddd;
	}
	.rm-key {
		font-style: normal;
		font-size: 11px;
		color: #777;
		font-family: ui-monospace, monospace;
	}
	.rm-group-head {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #15151c;
		border: none;
		border-top: 1px solid #1d1d24;
		color: #aaa;
		text-align: left;
		padding: 9px 14px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		border-radius: 0;
	}
	.rm-group-head:hover {
		background: #1a1a22;
	}
	.rm-group-head .caret {
		font-size: 10px;
		color: #777;
	}
	.rm-count {
		margin-left: auto;
		background: #23232c;
		color: #999;
		border-radius: 999px;
		padding: 1px 8px;
		font-size: 10px;
	}
	.rm-cell form {
		margin: 0;
	}
	.rm-cell select.tri {
		width: 100%;
	}
	.rm-cell select.tri.grant {
		border-color: #2f6b46;
		color: #7ee787;
	}
	.rm-cell select.tri.revoke {
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.pill.locked {
		justify-self: stretch;
		text-align: center;
		padding: 6px 8px;
	}
	.projects {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border: 1px solid #222;
		border-radius: 10px;
		padding: 12px;
		background: #121218;
	}
	.project-row {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.project-row .key {
		min-width: 120px;
		color: #c8a3ff;
	}
	.rename {
		display: flex;
		gap: 8px;
		flex: 1;
	}
	.rename input {
		flex: 1;
	}
	.assign select {
		min-width: 160px;
	}
	.gametype select {
		min-width: 110px;
	}
	.project-row.create {
		border-top: 1px solid #1d1d24;
		padding-top: 12px;
		margin-top: 4px;
	}
	.project-row.create input {
		flex: 1;
	}

	/* --- Settings: deploy token --- */
	.token-status {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 4px 0 16px;
		font-size: 13px;
	}
	.token-masked {
		color: #c8a3ff;
	}
	.token-reveal {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 16px;
	}
	.token-reveal input {
		width: 100%;
		box-sizing: border-box;
	}
	.token-actions {
		display: flex;
		gap: 10px;
		margin-bottom: 16px;
	}
	.token-actions form {
		margin: 0;
	}
	button.ghost-btn {
		background: transparent;
		border: 1px solid #2a2a33;
		color: #ccc;
	}
	.token-set {
		margin-bottom: 0;
	}
	.runpod-idle {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-end;
		margin: 12px 0 16px;
	}
	.runpod-idle .check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.runpod-idle .check input {
		width: auto;
	}
	.runpod-idle .minutes {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.runpod-idle .minutes input {
		width: 90px;
	}
	.runpod-fleet {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 12px 0 16px;
	}
	.pod-edit {
		display: flex;
		gap: 10px;
		align-items: flex-end;
	}
	.pod-edit .grow {
		font-size: 12px;
	}
	.pod-live {
		display: flex;
		align-items: center;
		padding-bottom: 6px;
	}
	.pod-stops {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}
	.pod-stops form {
		margin: 0;
	}

	/* --- Costs ------------------------------------------------------------- */
	.pill.err {
		background: #2c1618;
		color: #ff9d9d;
	}
	/* Amber, deliberately NOT the green "live" pill — an estimate should not read as
	   a measured figure at a glance. */
	.pill.est {
		background: #2e2415;
		color: #ffb86b;
	}
	.cost-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		margin: 16px 0;
	}
	.cost-top form {
		margin: 0;
	}
	.cost-total {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cost-total strong {
		font-size: 26px;
		color: #7ee0c0;
	}
	/* Euros are a derived view of a USD figure, so they read as secondary — same
	   line, smaller, muted. Never the same weight as the billed number. */
	.eur-total {
		font-size: 14px;
	}
	.eur {
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.cost-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 16px;
		margin-bottom: 24px;
	}
	.cost-card.unset {
		opacity: 0.72;
	}
	.cost-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.cost-head h3 {
		margin: 0;
	}
	.cost-figures {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		margin: 14px 0 10px;
	}
	.figure {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.figure strong {
		font-size: 18px;
		text-transform: none;
		letter-spacing: 0;
		color: #ddd;
	}
	.figure strong .muted {
		font-size: 12px;
	}
	.cost-reason {
		margin: 8px 0 0;
	}
	.cost-lines {
		display: flex;
		flex-direction: column;
		margin-top: 12px;
		border-top: 1px solid #222;
		font-size: 12px;
	}
	.cost-line {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 10px;
		align-items: baseline;
		padding: 7px 0;
		border-bottom: 1px solid #1d1d24;
	}
	.cost-line:last-child {
		border-bottom: none;
	}
	.cost-line-label {
		color: #ccc;
	}
	.cost-line-detail {
		font-size: 11px;
	}
	.cost-line-amount {
		min-width: 72px;
		text-align: right;
	}
	.topup-form {
		flex-wrap: wrap;
	}
	/* The shared `.row` grid is shaped for the 7-column users table; the ledger has
	   its own column set, so override rather than inherit a mismatched track list. */
	.topup-table .row {
		grid-template-columns: 1fr 1fr 1fr 2fr auto;
		cursor: default;
	}
	.topup-table form {
		margin: 0;
		justify-self: end;
	}
	.topup-table button {
		color: #ff9d9d;
	}
</style>
