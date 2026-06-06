<script lang="ts">
	import { enhance } from '$app/forms';
	import Emblem from '$lib/Emblem.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// --- Tabs ---
	type TabId = 'users' | 'roles' | 'tools' | 'projects' | 'clients' | 'games' | 'sessions';
	const TABS: { id: TabId; label: string }[] = [
		{ id: 'users', label: 'Users' },
		{ id: 'roles', label: 'Roles' },
		{ id: 'tools', label: 'Tools' },
		{ id: 'projects', label: 'Projects' },
		{ id: 'clients', label: 'Clients' },
		{ id: 'games', label: 'Games' },
		{ id: 'sessions', label: 'Sessions' },
	];
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
				rows: data.tools.filter((t) => t.kind === 'online').map((t) => ({ key: t.id, name: t.name })),
			},
			{
				id: 'local',
				label: 'Local tools',
				rows: data.tools.filter((t) => t.kind === 'local').map((t) => ({ key: t.id, name: t.name })),
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
						<span class="role">{u.role}</span>
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
							{#each data.roles as r (r)}<option value={r}>{r}</option>{/each}
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
								{#each data.roles as r (r)}<option value={r}>{r}</option>{/each}
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
						<span class="rm-role">{role}</span>
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
															aria-label={`${role} — ${cap.name}`}
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
				</button> tab and the per-user panel in <button
					type="button"
					class="link"
					onclick={() => (tab = 'users')}
				>
					Users
				</button>.
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
					<input name="key" type="text" placeholder="key (e.g. borut)" autocomplete="off" required />
					<input name="name" type="text" placeholder="Display name" autocomplete="off" required />
					<select name="clientKey">
						<option value="">— unassigned —</option>
						{#each data.clients as c (c.key)}
							<option value={c.key}>{c.name}</option>
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
					<input name="key" type="text" placeholder="key (e.g. borut)" autocomplete="off" required />
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
				<em>Global</em> to show it on every selection. The launch URL gets the active project appended
				(<code>?project=…</code>). Games will live on a future dedicated game server.
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
							<input name="url" type="text" value={g.url} placeholder="https://…" autocomplete="off" />
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
					<input name="key" type="text" placeholder="key (e.g. lines)" autocomplete="off" required />
					<input name="name" type="text" placeholder="Display name" autocomplete="off" required />
					<input name="url" type="text" placeholder="https://… (optional)" autocomplete="off" />
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
				</button> tab, then load their active sessions there to revoke individual or all sessions. The session
				list shows a colour + icon badge per state (active, expiring, expired).
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
		overflow: hidden;
		background: #121218;
	}
	.rm-row {
		display: grid;
		grid-template-columns: minmax(220px, 2fr) repeat(var(--role-cols, 4), minmax(140px, 1fr));
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
	.project-row.create {
		border-top: 1px solid #1d1d24;
		padding-top: 12px;
		margin-top: 4px;
	}
	.project-row.create input {
		flex: 1;
	}
</style>
