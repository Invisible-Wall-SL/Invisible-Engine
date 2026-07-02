<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { FlowPin } from 'engine-flow';

	// A screen node: its name + a thumbnail-less list of derived pins (design doc §12 —
	// a name + handle list suffices, no live Pixi inside the node). The four dynamic-pin
	// classes plus the fixed structural pins each render as a typed Svelte Flow handle.
	type Data = {
		label: string;
		pins: FlowPin[];
		orphanCount: number;
		initial: boolean;
		// Computed, read-only: the screen has no outgoing `complete` edge, so it PERSISTS in the
		// active set (never removes itself) — the base game's defining property (design doc
		// active-SET model). Not a schema field; derived from the transitions by the page.
		persistent?: boolean;
		// The resolved intent host (design doc §8.6) — this screen carries the game's intent INPUT
		// pins (Spin, …). Set by the page from the model; drives the "intents" badge.
		intentHost?: boolean;
		invalid?: boolean;
	};
	let { data, selected }: NodeProps = $props();
	const d = data as Data;

	// The full binding behind a pin, for the hover tooltip — the label truncates in the
	// handle row, so the title surfaces the role + binding key the wire actually points at.
	const pinTitle = (pin: FlowPin): string => {
		if (pin.role === 'complete' && d.persistent) {
			return "Complete — unused: this screen is persistent (no outgoing handoff), so it never fires Complete. Wire FROM here to make it hand off (that clears 'persistent').";
		}
		const role = pin.role.charAt(0).toUpperCase() + pin.role.slice(1);
		const tail = pin.orphaned ? ' (orphaned — backing component deleted)' : '';
		return `${role}: ${pin.label}${tail}`;
	};

	// The `complete` OUTPUT pin is meaningless on a PERSISTENT screen (it never hands off), so it's
	// dimmed to signal "unused" — but kept visible + connectable (wiring from it is exactly what
	// makes the screen non-persistent, so hiding it would be a chicken-and-egg trap). Only the
	// complete pin dims; a persistent HUD's real action outputs stay full-strength.
	const isDimmed = (pin: FlowPin): boolean => pin.role === 'complete' && !!d.persistent;

	// Inputs on the LEFT, outputs on the RIGHT, state pins shown inline (no handle —
	// `active` is a status, not a wire endpoint).
	const inputs = $derived(d.pins.filter((p) => p.direction === 'in'));
	const outputs = $derived(d.pins.filter((p) => p.direction === 'out'));
	const stateP = $derived(d.pins.filter((p) => p.direction === 'state'));

	const roleColor: Record<string, string> = {
		value: '#3b82f6',
		signal: '#a855f7',
		action: '#f59e0b',
		gate: '#10b981',
		// Intent input pins (design doc §8) share the action hue's family — a deeper amber — so an
		// author reads "this wires to an action output" at a glance while staying distinct.
		intent: '#d97706',
		enter: '#64748b',
		complete: '#64748b',
		active: '#64748b',
	};
</script>

<div class="screen-node" class:initial={d.initial} class:invalid={d.invalid} class:selected>
	<header>
		<span class="title" title={d.label}>{d.label}</span>
		{#if d.initial}<span class="badge">start</span>{/if}
		{#if d.persistent}<span
				class="badge persistent"
				title="Persistent (base) — no outgoing 'on complete' edge, so this screen never removes itself: overlays layer over it and it stays active underneath."
				>persistent</span
			>{/if}
		{#if d.intentHost}<span
				class="badge intent"
				title="Gameplay host — exposes the game's intent input pins (Spin, …); a button's action output wires into these."
				>intents</span
			>{/if}
		{#if d.orphanCount > 0}<span class="badge warn" title="{d.orphanCount} orphaned pin(s)"
				>⚠ {d.orphanCount}</span
			>{/if}
	</header>

	<div class="pins">
		<ul class="col in">
			{#each inputs as pin (pin.id)}
				<li class:orphaned={pin.orphaned} title={pinTitle(pin)}>
					<Handle
						type="target"
						position={Position.Left}
						id={pin.id}
						style="background:{roleColor[pin.role]}"
					/>
					<span class="dot" style="background:{roleColor[pin.role]}"></span>
					<span class="label">{pin.label}</span>
				</li>
			{/each}
		</ul>
		<ul class="col out">
			{#each outputs as pin (pin.id)}
				<li class:orphaned={pin.orphaned} class:dimmed={isDimmed(pin)} title={pinTitle(pin)}>
					<span class="label">{pin.label}</span>
					<span class="dot" style="background:{roleColor[pin.role]}"></span>
					<Handle
						type="source"
						position={Position.Right}
						id={pin.id}
						style="background:{roleColor[pin.role]}"
					/>
				</li>
			{/each}
		</ul>
	</div>

	{#if stateP.length}
		<footer>
			{#each stateP as pin (pin.id)}
				<span class="state-pin" title={pinTitle(pin)}>{pin.label}</span>
			{/each}
		</footer>
	{/if}
</div>

<style>
	.screen-node {
		min-width: 220px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 8px;
		color: #e2e8f0;
		font-size: 12px;
		overflow: hidden;
	}
	.screen-node.initial {
		border-color: #3b82f6;
	}
	/* A node flagged by validation (unreachable / dead-end / orphaned pins) — an amber
	   inline marker, consistent with the validation panel's warning palette. */
	.screen-node.invalid {
		border-color: #b45309;
		box-shadow: 0 0 0 1px #b4530933;
	}
	/* Canvas selection: an accent ring + lift so the picked node reads at a glance,
	   not just via the properties panel. Placed last so it wins over initial/invalid. */
	.screen-node.selected {
		border-color: #2563eb;
		box-shadow:
			0 0 0 2px #2563eb66,
			0 6px 18px #00000066;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		background: #1b212b;
		border-bottom: 1px solid #2a323d;
		font-weight: 600;
	}
	.title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 999px;
		background: #1d3a6b;
		color: #bfdbfe;
	}
	.badge.warn {
		background: #5b2a18;
		color: #fed7aa;
	}
	/* The persistent (base) badge — a calm teal, distinct from the blue "start" and amber
	   "warn", signalling "this screen stays active under overlays" (the active-SET base). */
	.badge.persistent {
		background: #10362f;
		color: #6ee7b7;
	}
	/* The intent-host badge — a deep amber, kin to the `action`/`intent` pin hue, so "this node
	   owns the game intents (Spin, …)" reads at a glance next to the persistent/start badges. */
	.badge.intent {
		background: #422006;
		color: #fcd34d;
	}
	.pins {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
	}
	.col {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.col li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 11px;
	}
	.col.out li {
		justify-content: flex-end;
	}
	.col li.orphaned .label {
		color: #fca5a5;
		text-decoration: line-through;
	}
	/* The `complete` output on a persistent screen — dimmed to read as "unused" (the screen never
	   hands off), while staying visible + connectable so it can still be wired (which is what makes
	   the screen non-persistent). Opacity doesn't block pointer events, so the handle stays grabbable
	   even dimmed; on node hover it lifts back so wiring it is easy. */
	.col.out li.dimmed {
		opacity: 0.35;
	}
	.screen-node:hover .col.out li.dimmed {
		opacity: 0.75;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
	footer {
		padding: 5px 10px;
		border-top: 1px solid #2a323d;
		background: #11161d;
		display: flex;
		gap: 6px;
	}
	.state-pin {
		font-size: 10px;
		color: #94a3b8;
		padding: 1px 6px;
		border-radius: 4px;
		background: #1b212b;
	}
</style>
