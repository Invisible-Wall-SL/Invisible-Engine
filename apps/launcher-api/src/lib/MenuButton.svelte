<script lang="ts" module>
	export interface MenuAction {
		label: string;
		/** Dim right-aligned text, e.g. a count. */
		hint?: string;
		title?: string;
		onSelect: () => void;
	}
	export interface MenuSubmenu {
		label: string;
		hint?: string;
		title?: string;
		items: MenuAction[];
	}
	export type MenuEntry = MenuAction | MenuSubmenu;
	export interface MenuGroup {
		heading?: string;
		items: MenuEntry[];
	}
</script>

<script lang="ts">
	import { tick, type Snippet } from 'svelte';

	interface Props {
		/** Groups with no items are left out, so a caller can list them unconditionally. */
		groups: MenuGroup[];
		/** The button's face. */
		children: Snippet;
		/** The menu's accessible name. */
		label: string;
		/** The button's accessible name, when its face is only a symbol. */
		buttonLabel?: string;
		title?: string;
		/** A small count on the button; hidden when 0 or absent. */
		badge?: number;
		badgeTitle?: string;
		class?: string;
	}

	let {
		groups,
		children,
		label,
		buttonLabel,
		title,
		badge,
		badgeTitle,
		class: className = '',
	}: Props = $props();

	const shown = $derived(groups.filter((g) => g.items.length > 0));
	const isSubmenu = (e: MenuEntry): e is MenuSubmenu => 'items' in e;

	let open = $state(false);
	/** The submenu entry that is open, as `group:item`. */
	let subKey = $state<string | null>(null);
	let buttonEl = $state<HTMLButtonElement | undefined>();
	let menuEl = $state<HTMLDivElement | undefined>();
	let subEl = $state<HTMLDivElement | undefined>();
	let menuStyle = $state('');
	let subStyle = $state('');
	const subParent = $derived.by(() => {
		if (!subKey) return null;
		const [gi, ii] = subKey.split(':').map(Number);
		const entry = shown[gi]?.items[ii];
		return entry && isSubmenu(entry) ? entry : null;
	});

	const GAP = 4;
	const MARGIN = 8;

	function placeMenu(): void {
		if (!buttonEl || !menuEl) return;
		const b = buttonEl.getBoundingClientRect();
		const m = menuEl.getBoundingClientRect();
		const left = Math.max(MARGIN, Math.min(b.left, window.innerWidth - m.width - MARGIN));
		const below = b.bottom + GAP;
		const top =
			below + m.height > window.innerHeight - MARGIN && b.top - GAP - m.height >= MARGIN
				? b.top - GAP - m.height
				: below;
		menuStyle = `left:${Math.round(left)}px;top:${Math.round(top)}px;min-width:${Math.round(b.width)}px;`;
		placeSubmenu();
	}

	function placeSubmenu(): void {
		if (!subKey || !subEl || !menuEl) return;
		const anchor = menuEl.querySelector<HTMLElement>(`[data-key="${subKey}"]`);
		if (!anchor) return;
		const a = anchor.getBoundingClientRect();
		const s = subEl.getBoundingClientRect();
		const right = a.right + GAP;
		const left = right + s.width > window.innerWidth - MARGIN ? a.left - GAP - s.width : right;
		const top = Math.max(MARGIN, Math.min(a.top - 4, window.innerHeight - s.height - MARGIN));
		subStyle = `left:${Math.round(Math.max(MARGIN, left))}px;top:${Math.round(top)}px;`;
	}

	function items(container: HTMLElement | undefined): HTMLElement[] {
		return container
			? Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
			: [];
	}

	async function openMenu(focus: 'first' | 'last' = 'first'): Promise<void> {
		open = true;
		subKey = null;
		await tick();
		placeMenu();
		const list = items(menuEl);
		(focus === 'first' ? list[0] : list[list.length - 1])?.focus();
	}

	function closeMenu(returnFocus: boolean): void {
		if (!open) return;
		open = false;
		subKey = null;
		if (returnFocus) buttonEl?.focus();
	}

	/** A keyboard press (Enter/Space reach `onclick` with `detail === 0`, or →) moves focus into the
	 * submenu; a pointer click or hover opens it in place. */
	async function openSubmenu(key: string, focusFirst: boolean): Promise<void> {
		subKey = key;
		await tick();
		placeSubmenu();
		if (focusFirst) items(subEl)[0]?.focus();
	}

	function closeSubmenu(): void {
		const key = subKey;
		subKey = null;
		if (key) menuEl?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
	}

	/** Hovering a plain item closes an open submenu; focus inside it follows the pointer, or the
	 * removed submenu would leave focus on <body> where the stage's arrow keys act again. */
	function hoverItem(item: HTMLElement): void {
		if (!subKey) return;
		const hadFocus = !!subEl && subEl.contains(document.activeElement);
		subKey = null;
		if (hadFocus) item.focus();
	}

	function choose(action: MenuAction): void {
		closeMenu(true);
		action.onSelect();
	}

	function move(container: HTMLElement | undefined, by: number | 'first' | 'last'): void {
		const list = items(container);
		if (list.length === 0) return;
		const at = list.indexOf(document.activeElement as HTMLElement);
		const next =
			by === 'first'
				? 0
				: by === 'last'
					? list.length - 1
					: (Math.max(at, by > 0 ? -1 : 0) + by + list.length) % list.length;
		list[next].focus();
	}

	function onButtonKey(e: KeyboardEvent): void {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		e.stopPropagation();
		void openMenu(e.key === 'ArrowDown' ? 'first' : 'last');
	}

	/** Every key in the menu is the menu's own: the stage listens on `window` for arrows (nudge),
	 * Delete and Escape, and must not also act on a press meant for the menu. */
	function onMenuKey(e: KeyboardEvent): void {
		const inSub = !!subEl && subEl.contains(e.target as Node);
		const container = inSub ? subEl : menuEl;
		const target = e.target as HTMLElement;
		if (e.key === 'Tab') {
			// Focus the trigger first so Tab's default moves on from it, not from the end of <body>.
			closeMenu(true);
			return;
		}
		e.stopPropagation();
		switch (e.key) {
			case 'ArrowDown':
				move(container, 1);
				break;
			case 'ArrowUp':
				move(container, -1);
				break;
			case 'Home':
				move(container, 'first');
				break;
			case 'End':
				move(container, 'last');
				break;
			case 'ArrowRight':
				if (!inSub && target.dataset.key) void openSubmenu(target.dataset.key, true);
				break;
			case 'ArrowLeft':
				if (inSub) closeSubmenu();
				break;
			case 'Escape':
				if (inSub) closeSubmenu();
				else closeMenu(true);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent): void => {
			const t = e.target as Node;
			if (menuEl?.contains(t) || subEl?.contains(t) || buttonEl?.contains(t)) return;
			closeMenu(false);
		};
		const onReflow = (): void => placeMenu();
		const onBlur = (): void => closeMenu(false);
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('resize', onReflow);
		window.addEventListener('scroll', onReflow, true);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('resize', onReflow);
			window.removeEventListener('scroll', onReflow, true);
			window.removeEventListener('blur', onBlur);
		};
	});

	// A body portal lets position:fixed escape the scrolling panel the button sits in.
	function portal(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<button
	bind:this={buttonEl}
	type="button"
	class="mb-button {className}"
	{title}
	aria-label={buttonLabel}
	aria-haspopup="menu"
	aria-expanded={open}
	onclick={() => (open ? closeMenu(true) : void openMenu())}
	onkeydown={onButtonKey}
>
	{@render children()}
	{#if badge}<span class="mb-badge" title={badgeTitle}>{badge}</span>{/if}
</button>

<!-- Each portalled element is the ONLY node of its {#if} branch: Svelte removes a branch by walking
     its nodes from first to last, which a portal that moved the first one away would break. -->
{#if open}
	<!-- `data-esc-owner`: this menu answers Escape itself, so a page-level Escape stands down. -->
	<div
		bind:this={menuEl}
		use:portal
		data-esc-owner
		class="mb-menu"
		style={menuStyle}
		role="menu"
		tabindex="-1"
		aria-label={label}
		onkeydown={onMenuKey}
	>
		{#each shown as group, gi (gi)}
			{#if gi > 0}<div class="mb-sep" role="separator"></div>{/if}
			{#if group.heading}<div class="mb-heading" aria-hidden="true">{group.heading}</div>{/if}
			{#each group.items as entry, ii (ii)}
				{@const key = `${gi}:${ii}`}
				{#if isSubmenu(entry)}
					<button
						type="button"
						role="menuitem"
						class="mb-item"
						class:mb-active={subKey === key}
						data-key={key}
						title={entry.title}
						aria-haspopup="menu"
						aria-expanded={subKey === key}
						onclick={(e) => void openSubmenu(key, e.detail === 0)}
						onpointerenter={() => subKey !== key && void openSubmenu(key, false)}
					>
						<span class="mb-label">{entry.label}</span>
						{#if entry.hint}<span class="mb-hint">{entry.hint}</span>{/if}
						<span class="mb-caret" aria-hidden="true">▸</span>
					</button>
				{:else}
					<button
						type="button"
						role="menuitem"
						class="mb-item"
						title={entry.title}
						onclick={() => choose(entry)}
						onpointerenter={(e) => hoverItem(e.currentTarget)}
					>
						<span class="mb-label">{entry.label}</span>
						{#if entry.hint}<span class="mb-hint">{entry.hint}</span>{/if}
					</button>
				{/if}
			{/each}
		{/each}
	</div>
{/if}
{#if open && subParent}
	<div
		bind:this={subEl}
		use:portal
		data-esc-owner
		class="mb-menu"
		style={subStyle}
		role="menu"
		tabindex="-1"
		aria-label={subParent.label}
		onkeydown={onMenuKey}
	>
		{#each subParent.items as action, si (si)}
			<button
				type="button"
				role="menuitem"
				class="mb-item"
				title={action.title}
				onclick={() => choose(action)}
			>
				<span class="mb-label">{action.label}</span>
				{#if action.hint}<span class="mb-hint">{action.hint}</span>{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.mb-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-family: inherit;
		cursor: pointer;
	}
	.mb-badge {
		min-width: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: #f0c878;
		color: #15151c;
		font-size: 10px;
		font-weight: 600;
		line-height: 16px;
	}
	.mb-menu {
		position: fixed;
		z-index: 5000;
		max-width: 280px;
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 4px;
		background: #15151c;
		border: 1px solid #2a2a36;
		border-radius: 6px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		outline: none;
	}
	.mb-heading {
		padding: 6px 8px 3px;
		color: #888;
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.mb-sep {
		border-top: 1px solid #24242e;
		margin: 4px 2px;
	}
	.mb-item {
		display: flex;
		align-items: center;
		gap: 10px;
		text-align: left;
		padding: 5px 8px;
		background: none;
		border: none;
		border-radius: 4px;
		color: #d8d8e0;
		font-family: inherit;
		font-size: 12px;
		white-space: nowrap;
		cursor: pointer;
	}
	.mb-item:hover,
	.mb-item:focus-visible,
	.mb-item.mb-active {
		background: #1f2a38;
		outline: none;
	}
	.mb-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mb-hint,
	.mb-caret {
		color: #888;
		font-size: 11px;
	}
</style>
