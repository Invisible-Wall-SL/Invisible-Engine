<script lang="ts">
	/**
	 * The component's EVENTS (Rive plan Phase 6b, §6.1): what it tells Flow. Each is raised by a
	 * listener, a state being entered or an `event:<id>` timeline cue; Phase 7 projects each as an
	 * exec-out pin. An event's id is its wire contract, so renaming one is a replace (the page asks,
	 * listing what raises it) and removing one leaves its raises in place, flagged ⚠ — never dropped.
	 * A payload field is a number (`int` / `number` / `ms`), a bool or a text key (a localization
	 * key). Read-only while Inspecting a version.
	 */
	import { componentEvents, validateComponentEvents, type ComponentDef } from 'engine-layout';
	import {
		addPayloadField,
		PAYLOAD_TYPE_CHOICES,
		removePayloadField,
		setPayloadFieldOptional,
		setPayloadFieldType,
	} from '$lib/timeline/listenerEdit';

	interface Props {
		def: ComponentDef;
		readOnly?: boolean;
		onChanged: () => void;
		/** Ask and rename (the page lists what raises it). */
		onRename: (id: string) => void;
		/** Ask and remove. */
		onRemove: (id: string) => void;
		/** Ask (the first event re-routes the timelines' `event:` cues) and add: null when added,
		 *  else why not ('' when the author cancelled). */
		onAdd: (id: string) => Promise<string | null>;
	}
	let { def, readOnly = false, onChanged, onRename, onRemove, onAdd }: Props = $props();

	let version = $state(0);
	const events = $derived.by(() => {
		void version;
		return componentEvents(def);
	});
	const issues = $derived.by(() => {
		void version;
		return validateComponentEvents(def).filter((i) => i.code.startsWith('event-'));
	});
	let newEvent = $state('');
	let addError = $state('');
	let newField = $state<Record<string, string>>({});
	let open = $state<Record<string, boolean>>({});

	function edit(fn: () => void): void {
		if (readOnly) return;
		fn();
		version += 1;
		onChanged();
	}
	/** A check (the timelines' fetch, a confirm) is in flight: a second Add waits for it. */
	let adding = $state(false);
	async function add(): Promise<void> {
		const id = newEvent.trim();
		if (!id || readOnly || adding) return;
		adding = true;
		try {
			const refused = await onAdd(id);
			if (refused !== null) {
				addError = refused;
				return;
			}
			version += 1;
			open[id] = true;
			addError = '';
			if (newEvent.trim() === id) newEvent = '';
		} finally {
			adding = false;
		}
	}
	function addClicked(): void {
		void add();
	}
</script>

<div class="vars-head">
	<h4>Events</h4>
</div>
<p class="muted small">
	What this component tells the game — a press, a reveal finished. Raised by a node's
	<strong>Listeners</strong>, a state's <strong>On enter</strong> or a timeline cue
	<code>event:&lt;name&gt;</code>; Flow will wire each one.
</p>
<div class="add-param">
	<input
		type="text"
		placeholder="new event, e.g. pressed"
		disabled={readOnly}
		bind:value={newEvent}
		oninput={() => (addError = '')}
		onkeydown={(e) => {
			if (e.key === 'Enter') void add();
		}}
	/>
	<button type="button" disabled={readOnly || adding || !newEvent.trim()} onclick={addClicked}>
		Add
	</button>
</div>
{#if addError}<p class="add-error">{addError}</p>{/if}
{#if events.length}
	<ul class="var-rows">
		{#each events as ev (ev.id)}
			<li class="var-row">
				<div class="var-row-head">
					<span class="var-icon" aria-hidden="true">↗</span>
					<button
						type="button"
						class="var-name link"
						aria-expanded={!!open[ev.id]}
						title="Show its payload"
						onclick={() => (open[ev.id] = !open[ev.id])}>{ev.id}</button
					>
					<span class="opt-note"
						>{ev.payload?.length ? `${ev.payload.length} field(s)` : 'no payload'}</span
					>
					<button
						type="button"
						class="param-remove"
						title="Rename this event"
						disabled={readOnly}
						onclick={() => onRename(ev.id)}>✎</button
					>
					<button
						type="button"
						class="param-remove"
						title="Remove event"
						disabled={readOnly}
						onclick={() => onRemove(ev.id)}>×</button
					>
				</div>
				{#if open[ev.id]}
					<ul class="fields">
						{#each ev.payload ?? [] as f (f.name)}
							<li>
								<span class="fname">{f.name}</span>
								<select
									disabled={readOnly}
									value={f.type.t}
									onchange={(e) =>
										edit(() =>
											setPayloadFieldType(
												ev,
												f.name,
												e.currentTarget.value as (typeof PAYLOAD_TYPE_CHOICES)[number]['t'],
											),
										)}
								>
									{#each PAYLOAD_TYPE_CHOICES as c (c.t)}<option value={c.t}>{c.label}</option
										>{/each}
								</select>
								<label title="May be left empty by a raise"
									><input
										type="checkbox"
										disabled={readOnly}
										checked={!!f.optional}
										onchange={(e) =>
											edit(() => setPayloadFieldOptional(ev, f.name, e.currentTarget.checked))}
									/> optional</label
								>
								<button
									type="button"
									class="param-remove"
									title="Remove field"
									disabled={readOnly}
									onclick={() => edit(() => removePayloadField(ev, f.name))}>×</button
								>
							</li>
						{/each}
						<li class="add-field">
							<input
								type="text"
								placeholder="payload field, e.g. amount"
								disabled={readOnly}
								value={newField[ev.id] ?? ''}
								oninput={(e) => (newField[ev.id] = e.currentTarget.value)}
							/>
							<button
								type="button"
								disabled={readOnly || !(newField[ev.id] ?? '').trim()}
								onclick={() =>
									edit(() => {
										if (addPayloadField(ev, newField[ev.id] ?? '')) newField[ev.id] = '';
									})}>+ field</button
							>
						</li>
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{#if issues.length}
	<ul class="issues">
		{#each issues as i, n (n)}<li class={i.level}>⚠ {i.message}</li>{/each}
	</ul>
{/if}

<style>
	.vars-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 12px 0 4px;
	}
	.vars-head h4 {
		margin: 0;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.add-param,
	.add-field {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.add-param input,
	.add-field input {
		flex: 1;
		min-width: 0;
	}
	.var-rows {
		list-style: none;
		padding: 0;
		margin: 6px 0 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.var-row {
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 5px 7px;
		background: #18141f;
	}
	.var-row-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
	}
	.var-icon {
		color: #8a7aa8;
		font-size: 11px;
		width: 12px;
		text-align: center;
	}
	.var-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.opt-note {
		font-size: 10px;
		color: #666;
		white-space: nowrap;
	}
	.param-remove {
		width: 18px;
		height: 18px;
		line-height: 1;
		padding: 0;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #b06a6a;
		cursor: pointer;
	}
	.param-remove:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.fields {
		list-style: none;
		margin: 5px 0 0;
		padding: 0 0 0 20px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
	}
	.fields li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.fname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.add-error {
		margin: 4px 0 0;
		font-size: 11px;
		color: #ff9a9a;
	}
	.issues {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		font-size: 11px;
	}
	.issues .error {
		color: #ff9a9a;
	}
	.issues .warning {
		color: #d98a3a;
	}
</style>
