<script lang="ts" module>
	import { SvelteSet } from 'svelte/reactivity';

	/** Containers the author folded, by node id — kept across screen switches (the Outline remounts
	 *  per screen). Editor view state, never written to the doc. */
	const collapsed = new SvelteSet<string>();
</script>

<script lang="ts">
	import { componentUpdateAvailable } from '$lib/timeline/sharedTimelines';
	import type { GameTemplate, LayoutNode, Scene } from 'engine-layout';
	import { tick } from 'svelte';
	import {
		ancestorIds,
		canDrop,
		dropZoneAt,
		lockedInTree,
		type DropZone,
	} from '$lib/editor/hierarchy';

	const DRAG_TYPE = 'application/x-iw-outline-node';

	interface Props {
		scene: Scene | undefined;
		template: GameTemplate | undefined;
		/** The primary (last-picked) selected id — drives the strong highlight. */
		selectedId: string | null;
		/** The full multi-selection (Shift = range, Ctrl/Cmd = toggle). Every member
		 * gets a highlight; the primary gets the strong one. */
		selectedIds?: string[];
		/** Select a row. The MouseEvent carries the Shift/Ctrl/Cmd modifiers so the
		 * page can do range / toggle selection. */
		onSelect: (id: string, e?: MouseEvent) => void;
		/** Fill a slot by dropping a Library asset onto its row (drag-to-slot). */
		onFillSlot?: (sceneId: string, sceneName: string, slotId: string, payload: unknown) => void;
		/** Materialise an engine `mount` anchor for an empty mount slot, so it shows
		 * as a draggable box on the canvas (mount slots take no asset). */
		onAddAnchor?: (sceneId: string, sceneName: string, slotId: string) => void;
		/** Rename a node (its outline `label`). Double-click a row to edit it inline. */
		onRename?: (id: string, label: string) => void;
		/** Rive plan Phase 9a — the row hover controls. Lock is the node's own `locked`; Hide and
		 *  Isolate are editor-only view state the host keeps (`hiddenIds`, `isolatedId`), and
		 *  `stageHidden` is what the stage skips because of them (rows draw dimmed). */
		onToggleLock?: (id: string) => void;
		hiddenIds?: ReadonlySet<string>;
		onToggleHide?: (id: string) => void;
		isolatedId?: string | null;
		onToggleIsolate?: (id: string) => void;
		stageHidden?: ReadonlySet<string>;
		/** Drag a row onto another: before / after it (z-order), or inside a container (re-parent). */
		onMove?: (dragId: string, overId: string, zone: DropZone) => void;
		/** `X` on the stage: expand the containers above `id` and scroll its row into view. */
		revealRequest?: { id: string; seq: number } | null;
		/** The row context menu's actions; an absent one is left out of the menu. */
		onCopy?: (id: string) => void;
		onPaste?: () => void;
		onDelete?: (id: string) => void;
		onCreateComponent?: (id: string) => void;
		onShowInFlow?: (id: string) => void;
		/** Resolved component defs by id: a placed component pinned below its latest version shows an
		 *  "update available" badge on its row (Rive plan Phase 9d). */
		componentMap?: ReadonlyMap<string, { version?: number }>;
	}
	let {
		scene,
		template,
		selectedId,
		selectedIds = [],
		onSelect,
		onFillSlot,
		onAddAnchor,
		onRename,
		onToggleLock,
		hiddenIds = new Set<string>(),
		onToggleHide,
		isolatedId = null,
		onToggleIsolate,
		stageHidden = new Set<string>(),
		onMove,
		revealRequest = null,
		onCopy,
		onPaste,
		onDelete,
		onCreateComponent,
		onShowInFlow,
		componentMap,
	}: Props = $props();

	/** The newer version a placed component could update to, or null. */
	function updateOf(node: LayoutNode): number | null {
		if (node.kind !== 'componentInstance') return null;
		const def = componentMap?.get(node.componentId);
		return componentUpdateAvailable(node.componentVersion, def) ? (def?.version ?? null) : null;
	}

	let treeEl = $state<HTMLUListElement | undefined>();

	function hasChildren(node: LayoutNode): boolean {
		return node.kind === 'container' && node.children.length > 0;
	}

	function toggleCollapsed(id: string): void {
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
	}

	let handledReveal = -1;
	$effect(() => {
		const req = revealRequest;
		if (!req || req.seq === handledReveal || !scene) return;
		handledReveal = req.seq;
		for (const id of ancestorIds(scene.nodes, req.id) ?? []) collapsed.delete(id);
		void tick().then(() =>
			treeEl
				?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(req.id)}"]`)
				?.scrollIntoView({ block: 'nearest' }),
		);
	});

	// ---- drag a row to reorder / re-parent ----
	let draggingId = $state<string | null>(null);
	let dropHint = $state<{ id: string; zone: DropZone } | null>(null);

	function onRowDragStart(e: DragEvent, node: LayoutNode): void {
		if (!onMove || !e.dataTransfer) return;
		if (scene && lockedInTree(scene.nodes, node.id)) {
			e.preventDefault();
			return;
		}
		draggingId = node.id;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(DRAG_TYPE, node.id);
	}
	function rowZone(e: DragEvent, node: LayoutNode): DropZone | null {
		if (!scene || !draggingId || !e.dataTransfer?.types.includes(DRAG_TYPE)) return null;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const zone = dropZoneAt(e.clientY - rect.top, rect.height, node.kind === 'container');
		return canDrop(scene.nodes, draggingId, node.id, zone) ? zone : null;
	}
	function onRowDragOver(e: DragEvent, node: LayoutNode): void {
		const zone = rowZone(e, node);
		if (!zone) {
			if (dropHint?.id === node.id) dropHint = null;
			return;
		}
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		dropHint = { id: node.id, zone };
	}
	function onRowDrop(e: DragEvent, node: LayoutNode): void {
		const zone = rowZone(e, node);
		const dragId = draggingId;
		endDrag();
		if (!zone || !dragId) return;
		e.preventDefault();
		onMove?.(dragId, node.id, zone);
	}
	function endDrag(): void {
		draggingId = null;
		dropHint = null;
	}

	// ---- the row context menu ----
	let menu = $state<{ x: number; y: number; node: LayoutNode } | null>(null);
	let menuEl = $state<HTMLDivElement | undefined>();
	/** The menu's largest size, to keep it on screen near the window's right and bottom edges. */
	const MENU_W = 200;
	const MENU_H = 320;
	function openMenu(e: MouseEvent, node: LayoutNode): void {
		e.preventDefault();
		menu = {
			x: Math.min(e.clientX, window.innerWidth - MENU_W),
			y: Math.min(e.clientY, window.innerHeight - MENU_H),
			node,
		};
	}
	function closeMenu(e?: Event): void {
		if (e && menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
		menu = null;
	}
	function runMenu(action: ((id: string) => void) | undefined, id: string): void {
		menu = null;
		action?.(id);
	}
	$effect(() => {
		if (!menu) return;
		// Any key closes it; Esc is the menu's alone (captured and stopped), so it never also walks
		// the stage selection or leaves a Components level.
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
			}
			closeMenu();
		};
		const onBlur = (): void => closeMenu();
		window.addEventListener('mousedown', closeMenu);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('mousedown', closeMenu);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('blur', onBlur);
		};
	});

	/** `slotId` of the slot row a Library asset is hovering over. */
	let dragSlotId = $state<string | null>(null);

	/** Inline-rename state: the node id being edited + its draft label. */
	let renamingId = $state<string | null>(null);
	let draftLabel = $state('');

	function startRename(node: LayoutNode): void {
		if (!onRename) return;
		renamingId = node.id;
		draftLabel = node.label ?? '';
	}
	function commitRename(): void {
		if (renamingId === null) return;
		const id = renamingId;
		const label = draftLabel.trim();
		renamingId = null;
		// Empty label clears back to the node id fallback — pass '' and let the parent decide.
		onRename?.(id, label);
	}
	function cancelRename(): void {
		renamingId = null;
	}

	/** `mount` slots are engine-owned anchors, not asset targets — not droppable. */
	function isDroppable(kind: string): boolean {
		return kind !== 'mount';
	}

	function onSlotDragOver(e: DragEvent, slotId: string, kind: string): void {
		if (!e.dataTransfer || !isDroppable(kind)) return;
		if (!Array.from(e.dataTransfer.types).includes('application/x-iw-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dragSlotId = slotId;
	}

	function onSlotDrop(e: DragEvent, slotId: string, kind: string): void {
		dragSlotId = null;
		if (!scene || !e.dataTransfer || !isDroppable(kind)) return;
		const raw = e.dataTransfer.getData('application/x-iw-asset');
		if (!raw) return;
		e.preventDefault();
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		onFillSlot?.(scene.id, scene.name, slotId, payload);
	}

	function kindGlyph(kind: LayoutNode['kind']): string {
		switch (kind) {
			case 'sprite':
				return '■';
			case 'spine':
				return '◆';
			case 'text':
				return 'T';
			case 'container':
				return '▦';
			case 'componentInstance':
				return '◇';
			case 'reelGrid':
				return '⊞';
			case 'repeater':
				return '⧉';
			case 'spawnLayer':
				return '⊕';
			case 'flipbook':
				return '🎞';
			case 'effect':
				return '✨';
			case 'rect':
				return '▬';
		}
	}

	/** `slotId`s any node in the active scene fills (recursing into containers). */
	function filledSlotIds(nodes: LayoutNode[], into: Set<string>): Set<string> {
		for (const node of nodes) {
			if (node.slotId) into.add(node.slotId);
			if (node.kind === 'container') filledSlotIds(node.children, into);
		}
		return into;
	}

	const slots = $derived(template?.scenes.find((s) => s.id === scene?.id)?.slots ?? []);
	const filled = $derived(scene ? filledSlotIds(scene.nodes, new Set()) : new Set<string>());
</script>

{#snippet row(node: LayoutNode, depth: number)}
	{@const locked = node.locked === true}
	{@const inheritedLock = !locked && !!scene && lockedInTree(scene.nodes, node.id)}
	{@const hidden = hiddenIds.has(node.id)}
	{@const isolated = isolatedId === node.id}
	{@const folded = collapsed.has(node.id)}
	<li>
		{#if renamingId === node.id}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="rename"
				style:padding-left="{8 + depth * 14}px"
				bind:value={draftLabel}
				autofocus
				onblur={commitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') commitRename();
					else if (e.key === 'Escape') cancelRename();
				}}
			/>
		{:else}
			<div
				class="row"
				class:selected={selectedId === node.id}
				class:multi={selectedId !== node.id && selectedIds.includes(node.id)}
				class:dim={stageHidden.has(node.id)}
				class:dragging={draggingId === node.id}
				class:drop-before={dropHint?.id === node.id && dropHint.zone === 'before'}
				class:drop-after={dropHint?.id === node.id && dropHint.zone === 'after'}
				class:drop-inside={dropHint?.id === node.id && dropHint.zone === 'inside'}
				style:padding-left="{2 + depth * 14}px"
				data-node-id={node.id}
				draggable={onMove ? 'true' : undefined}
				role="treeitem"
				aria-selected={selectedIds.includes(node.id)}
				aria-expanded={hasChildren(node) ? !folded : undefined}
				tabindex="-1"
				ondragstart={(e) => onRowDragStart(e, node)}
				ondragover={(e) => onRowDragOver(e, node)}
				ondragleave={() => {
					if (dropHint?.id === node.id) dropHint = null;
				}}
				ondrop={(e) => onRowDrop(e, node)}
				ondragend={endDrag}
				oncontextmenu={(e) => openMenu(e, node)}
			>
				{#if hasChildren(node)}
					<button
						type="button"
						class="twisty"
						aria-label={folded ? 'Expand' : 'Collapse'}
						onclick={() => toggleCollapsed(node.id)}
					>
						{folded ? '▸' : '▾'}
					</button>
				{:else}
					<span class="twisty"></span>
				{/if}
				<button
					type="button"
					class="main"
					onclick={(e) => onSelect(node.id, e)}
					ondblclick={() => startRename(node)}
					title={onRename
						? 'Shift/Ctrl-click to multi-select · double-click to rename · drag to reorder or move into a container · right-click for more'
						: undefined}
				>
					<span class="glyph">{kindGlyph(node.kind)}</span>
					<span class="label">{node.label ?? node.id}</span>
					{#if updateOf(node) !== null}
						<span
							class="upd"
							title="The component has a newer version (v{updateOf(
								node,
							)}). This placement draws the version it pins, here and in the game: select it and use Update to latest in Properties."
							>↑ v{updateOf(node)}</span
						>
					{/if}
					<span class="kind">{node.kind}</span>
				</button>
				<span class="ctl">
					{#if onToggleLock}
						<button
							type="button"
							class:on={locked}
							class:inherited={inheritedLock}
							title={locked
								? 'Unlock'
								: inheritedLock
									? 'Locked by a container above'
									: 'Lock — the stage clicks through it and it cannot move'}
							aria-label={locked ? 'Unlock' : 'Lock'}
							aria-pressed={locked}
							onclick={() => onToggleLock(node.id)}
						>
							{locked || inheritedLock ? '🔒' : '🔓'}
						</button>
					{:else if locked}
						<span class="lock" title="Locked">🔒</span>
					{/if}
					{#if onToggleIsolate}
						<button
							type="button"
							class:on={isolated}
							title={isolated
								? 'Exit isolate'
								: 'Isolate — show only this (editor only, never saved)'}
							aria-label={isolated ? 'Exit isolate' : 'Isolate'}
							aria-pressed={isolated}
							onclick={() => onToggleIsolate(node.id)}
						>
							◎
						</button>
					{/if}
					{#if onToggleHide}
						<button
							type="button"
							class:on={hidden}
							title={hidden
								? 'Show on the stage'
								: 'Hide on the stage (editor only — the game still draws it)'}
							aria-label={hidden ? 'Show' : 'Hide'}
							aria-pressed={hidden}
							onclick={() => onToggleHide(node.id)}
						>
							{hidden ? '⦸' : '👁'}
						</button>
					{/if}
				</span>
			</div>
		{/if}
		{#if hasChildren(node) && node.kind === 'container' && !folded}
			<ul class="children" role="group">
				{#each node.children as child (child.id)}
					{@render row(child, depth + 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#if slots.length > 0}
	<section class="slots">
		<h4>Slots</h4>
		<ul class="slot-list">
			{#each slots as slot (slot.slotId)}
				{@const isFilled = filled.has(slot.slotId)}
				{@const missing = !isFilled && slot.required}
				{@const addable = slot.kind === 'mount' && !isFilled}
				<li>
					<button
						type="button"
						class="slot"
						class:missing
						class:addable
						class:dropping={dragSlotId === slot.slotId}
						class:droppable={isDroppable(slot.kind)}
						title={addable
							? `Add the ${slot.name} anchor to the canvas so you can position it`
							: isDroppable(slot.kind)
								? `Drag a Library asset here to fill ${slot.name}`
								: `${slot.name} is a mount slot (engine-owned anchor)`}
						onclick={addable && scene
							? () => onAddAnchor?.(scene.id, scene.name, slot.slotId)
							: undefined}
						ondragover={(e) => onSlotDragOver(e, slot.slotId, slot.kind)}
						ondragleave={() => (dragSlotId = null)}
						ondrop={(e) => onSlotDrop(e, slot.slotId, slot.kind)}
					>
						<span class="dot" class:filled={isFilled}></span>
						<span class="label">{slot.name}</span>
						<span class="kind">{slot.kind}</span>
						<span class="status" class:missing>
							{isFilled ? 'filled' : addable ? '+ add' : 'empty'}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if !scene || scene.nodes.length === 0}
	<p class="muted">No nodes yet. Drag assets from the Library into the canvas.</p>
{:else}
	<p class="hint">
		Order mirrors the canvas paint order — top row is rendered first (lowest layer).
	</p>
	{#if isolatedId && onToggleIsolate && ancestorIds(scene.nodes, isolatedId)}
		{@const isoId = isolatedId}
		<div class="isolating">
			<span>◎ Isolated — the rest is hidden on the stage</span>
			<button type="button" onclick={() => onToggleIsolate(isoId)}>Exit</button>
		</div>
	{/if}
	<ul class="tree" role="tree" bind:this={treeEl}>
		{#each scene.nodes as node (node.id)}
			{@render row(node, 0)}
		{/each}
	</ul>
{/if}

{#if menu}
	{@const m = menu.node}
	{@const mLocked = !!scene && lockedInTree(scene.nodes, m.id)}
	<div
		bind:this={menuEl}
		data-esc-owner
		class="menu"
		style="left:{menu.x}px; top:{menu.y}px"
		role="menu"
		aria-label="Outline row"
	>
		<div class="menu-title">{m.label?.trim() || m.id}</div>
		{#if onCopy}
			<button type="button" role="menuitem" onclick={() => runMenu(onCopy, m.id)}>Copy</button>
		{/if}
		{#if onPaste}
			<button type="button" role="menuitem" onclick={() => runMenu(() => onPaste(), m.id)}>
				Paste
			</button>
		{/if}
		{#if onDelete}
			<button
				type="button"
				role="menuitem"
				disabled={mLocked}
				title={mLocked ? 'Unlock it first' : undefined}
				onclick={() => runMenu(onDelete, m.id)}
			>
				Delete
			</button>
		{/if}
		{#if onCopy || onPaste || onDelete}<hr />{/if}
		{#if onToggleLock}
			<button type="button" role="menuitem" onclick={() => runMenu(onToggleLock, m.id)}>
				{m.locked ? 'Unlock' : 'Lock'}
			</button>
		{/if}
		{#if onToggleHide}
			<button type="button" role="menuitem" onclick={() => runMenu(onToggleHide, m.id)}>
				{hiddenIds.has(m.id) ? 'Show' : 'Hide'}
			</button>
		{/if}
		{#if onToggleIsolate}
			<button type="button" role="menuitem" onclick={() => runMenu(onToggleIsolate, m.id)}>
				{isolatedId === m.id ? 'Exit isolate' : 'Isolate'}
			</button>
		{/if}
		{#if (onCreateComponent && m.kind === 'container') || (onShowInFlow && m.kind === 'componentInstance')}
			<hr />
		{/if}
		{#if onCreateComponent && m.kind === 'container'}
			<button type="button" role="menuitem" onclick={() => runMenu(onCreateComponent, m.id)}>
				◇ Create component
			</button>
		{/if}
		{#if onShowInFlow && m.kind === 'componentInstance'}
			<button
				type="button"
				role="menuitem"
				disabled={!m.label?.trim()}
				title={m.label?.trim()
					? 'Open Invisible Flow on the node that names this placement'
					: 'Name the instance first — Flow lists named placements only'}
				onclick={() => runMenu(onShowInFlow, m.id)}
			>
				↗ Show in Flow
			</button>
		{/if}
	</div>
{/if}

<style>
	.tree,
	.children {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
		width: 100%;
		box-sizing: border-box;
		padding-right: 4px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: #c8c8d0;
		font-size: 12px;
	}
	.row:hover {
		background: #16161c;
		border-color: #1f1f28;
	}
	.row.dim .main {
		opacity: 0.45;
	}
	.row.dragging {
		opacity: 0.5;
	}
	.row.drop-before {
		box-shadow: inset 0 2px 0 #7ee0c0;
	}
	.row.drop-after {
		box-shadow: inset 0 -2px 0 #7ee0c0;
	}
	.row.drop-inside {
		border-color: #7ee0c0;
		background: #14201c;
	}
	.twisty {
		flex: none;
		width: 16px;
		padding: 0;
		background: none;
		border: none;
		color: #777;
		font-size: 10px;
		cursor: pointer;
	}
	.main {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 4px;
		background: transparent;
		border: none;
		color: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
	}
	.ctl {
		display: flex;
		gap: 1px;
		flex: none;
	}
	.ctl button {
		width: 20px;
		height: 20px;
		padding: 0;
		background: none;
		border: 1px solid transparent;
		border-radius: 4px;
		color: #8a8a96;
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		visibility: hidden;
	}
	.row:hover .ctl button,
	.row:focus-within .ctl button,
	.ctl button.on,
	.ctl button.inherited {
		visibility: visible;
	}
	.ctl button:hover {
		border-color: #3a3a48;
		color: #e8e8ee;
	}
	.ctl button.on {
		color: #f0c878;
	}
	.ctl button.inherited {
		opacity: 0.45;
	}
	.isolating {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 0 0 8px;
		padding: 5px 8px;
		border: 1px solid #5a4a20;
		border-radius: 6px;
		background: #1f1a10;
		color: #f0c878;
		font-size: 11px;
	}
	.isolating button,
	.menu button {
		font-family: inherit;
	}
	.isolating button {
		background: none;
		border: 1px solid #5a4a20;
		border-radius: 4px;
		color: #f0c878;
		font-size: 11px;
		cursor: pointer;
	}
	.menu {
		position: fixed;
		z-index: 5000;
		min-width: 170px;
		padding: 4px;
		background: #15151c;
		border: 1px solid #2a2a36;
		border-radius: 6px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
	}
	.menu-title {
		padding: 4px 8px 6px;
		color: #888;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 240px;
	}
	.menu button {
		text-align: left;
		padding: 5px 8px;
		background: none;
		border: none;
		border-radius: 4px;
		color: #d8d8e0;
		font-size: 12px;
		cursor: pointer;
	}
	.menu button:hover:not(:disabled) {
		background: #1f2a38;
	}
	.menu button:disabled {
		color: #555;
		cursor: default;
	}
	.menu hr {
		border: none;
		border-top: 1px solid #24242e;
		margin: 4px 2px;
	}
	.row.selected {
		background: #1a1a22;
		border-color: #5db0ff;
		color: #e8e8ee;
	}
	.row.multi {
		background: #14202c;
		border-color: #2f5d7a;
		color: #e8e8ee;
	}
	.rename {
		display: flex;
		width: 100%;
		padding: 6px 8px;
		background: #0e0e14;
		border: 1px solid #5db0ff;
		border-radius: 6px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		box-sizing: border-box;
	}
	.glyph {
		color: #c8a3ff;
		font-size: 11px;
		width: 12px;
		text-align: center;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.lock {
		font-size: 10px;
		line-height: 1;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.hint {
		color: #666;
		font-size: 11px;
		margin: 0 0 10px;
	}
	.slots {
		margin: 0 0 14px;
		padding: 0 0 12px;
		border-bottom: 1px solid #1c1c24;
	}
	h4 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 0 0 6px;
	}
	.slot-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: #c8c8d0;
		font-family: inherit;
		cursor: default;
	}
	.slot.droppable {
		cursor: copy;
	}
	.slot.dropping {
		border-color: #7ee0c0;
		background: #14201c;
		color: #cffaec;
	}
	.slot.addable {
		cursor: pointer;
	}
	.slot.addable:hover {
		border-color: #3a5a7a;
		background: #141a22;
		color: #cfe6ff;
	}
	.slot.addable .status {
		color: #6aa0d0;
	}
	.slot.missing {
		border-color: #4a2a30;
		background: #1f1418;
		color: #ff9a9a;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: 1px solid #444;
		flex: none;
	}
	.dot.filled {
		background: #7ee0c0;
		border-color: #234038;
	}
	.status {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.status.missing {
		color: #ff9a9a;
	}
	.upd {
		flex: none;
		padding: 0 4px;
		border-radius: 3px;
		font-size: 9px;
		color: #0c0f14;
		background: #ffd24a;
	}
</style>
