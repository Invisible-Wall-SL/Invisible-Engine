<script lang="ts">
	/**
	 * The payload of one RAISE (Rive plan Phase 6b) — a node listener's, or a state's on-enter row:
	 * one control per field the event declares, filled with a number, a bool, the current value of
	 * a bool or number input, a localization key (plan §8: never free text that skips the
	 * localization stack — a key is its source text, and the harvest collects it), or — on a
	 * listener's raise (`pointer`) — a reading of the pointer. An empty field arrives empty in Flow.
	 */
	import {
		isLocalizationKey,
		type ComponentEvent,
		POINTER_PAYLOAD_FIELDS,
		type ComponentInput,
		type EventPayloadValue,
		type PointerPayloadField,
		type RaiseEventAction,
	} from 'engine-layout';
	import { setRaisePayload } from '$lib/timeline/listenerEdit';

	interface Props {
		action: RaiseEventAction;
		event: ComponentEvent | undefined;
		inputs: ComponentInput[];
		readOnly?: boolean;
		/** A listener's raise: a number field may read the pointer. */
		pointer?: boolean;
		onChanged: () => void;
	}
	let { action, event, inputs, readOnly = false, pointer = false, onChanged }: Props = $props();

	const isNumeric = (t: string): boolean => t === 'int' || t === 'float' || t === 'ms';
	/** Field name → why its last typed key was refused (the field keeps its previous value). */
	let keyErrors = $state<Record<string, string>>({});
	$effect.pre(() => {
		void action.event;
		keyErrors = {};
	});

	const POINTER_LABELS: Record<PointerPayloadField, string> = {
		x: 'pointer x',
		y: 'pointer y',
		dx: 'pointer dx (from the press)',
		dy: 'pointer dy (from the press)',
	};
	/** What a field's select shows: '' empty, 'value' a literal, 'true'/'false', '@<input>',
	 *  '^<reading>' the pointer. */
	function mode(value: EventPayloadValue | undefined): string {
		if (value === undefined) return '';
		if (typeof value === 'boolean') return String(value);
		if (typeof value === 'number') return 'value';
		if ('input' in value) return `@${value.input}`;
		if ('pointer' in value) return `^${value.pointer}`;
		return 'key';
	}
	function pick(name: string, t: string, choice: string): void {
		if (readOnly) return;
		const value: EventPayloadValue | undefined =
			choice === ''
				? undefined
				: choice === 'true' || choice === 'false'
					? choice === 'true'
					: choice === 'value'
						? 0
						: choice.startsWith('@')
							? { input: choice.slice(1) }
							: choice.startsWith('^')
								? { pointer: choice.slice(1) as PointerPayloadField }
								: undefined;
		if (choice === 'value' && !isNumeric(t)) return;
		setRaisePayload(action, name, value);
		onChanged();
	}
	/** An `int` / `ms` field holds a whole number: a fraction is rounded as it is typed. */
	function setNumber(name: string, t: string, input: HTMLInputElement): void {
		if (readOnly) return;
		const n = Number(input.value);
		const value = Number.isFinite(n) ? (t === 'float' ? n : Math.round(n)) : 0;
		input.value = String(value);
		setRaisePayload(action, name, value);
		onChanged();
	}
	/** A key is its source text and must have a letter (the harvest's rule): anything else would be
	 *  dropped by the save, so it is refused here and the field keeps what it had. */
	function setKey(name: string, input: HTMLInputElement, previous: string): void {
		if (readOnly) return;
		const key = input.value.trim();
		if (key && !isLocalizationKey(key)) {
			keyErrors[name] =
				'A text key needs at least one letter — it is the text as the game shows it.';
			input.value = previous;
			return;
		}
		delete keyErrors[name];
		input.value = key;
		setRaisePayload(action, name, key ? { key } : undefined);
		onChanged();
	}
</script>

{#if event?.payload?.length}
	<ul class="payload">
		{#each event.payload as field (field.name)}
			{@const value = action.payload?.[field.name]}
			{@const t = field.type.t}
			<li>
				<span class="fname" title={field.description ?? undefined}
					>{field.name}<span class="ftype">{t === 'string' ? 'key' : t}</span></span
				>
				{#if t === 'string'}
					{@const key = value && typeof value === 'object' && 'key' in value ? value.key : ''}
					<input
						type="text"
						placeholder={field.optional ? 'empty' : 'localization key'}
						title="A localization key — the text as it is written in the game; it is translated like any text"
						disabled={readOnly}
						value={key}
						onchange={(e) => setKey(field.name, e.currentTarget, key)}
					/>
				{:else}
					<select
						disabled={readOnly}
						value={mode(value)}
						onchange={(e) => pick(field.name, t, e.currentTarget.value)}
					>
						<option value="">{field.optional ? '— empty —' : '— empty (!) —'}</option>
						{#if isNumeric(t)}
							<option value="value">value…</option>
						{:else}
							<option value="true">true</option>
							<option value="false">false</option>
						{/if}
						{#each inputs.filter( (i) => (isNumeric(t) ? i.kind === 'number' : i.kind === 'bool') ) as i (i.id)}
							<option value={`@${i.id}`}>input {i.id}</option>
						{/each}
						{#if isNumeric(t) && (pointer || mode(value).startsWith('^'))}
							{#each POINTER_PAYLOAD_FIELDS as f (f)}
								<option value={`^${f}`}>{POINTER_LABELS[f]}</option>
							{/each}
						{/if}
					</select>
					{#if typeof value === 'number'}
						<input
							type="number"
							step={t === 'float' ? 'any' : '1'}
							disabled={readOnly}
							{value}
							onchange={(e) => setNumber(field.name, t, e.currentTarget)}
						/>
					{/if}
				{/if}
			</li>
			{#if keyErrors[field.name]}<li class="key-error">{keyErrors[field.name]}</li>{/if}
		{/each}
	</ul>
{/if}

<style>
	.payload {
		list-style: none;
		margin: 4px 0 0;
		padding: 0 0 0 14px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}
	.key-error {
		color: #ff9a9a;
		padding-left: 96px;
	}
	.fname {
		width: 90px;
		flex: none;
		color: #b8b8c4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ftype {
		margin-left: 4px;
		font-size: 9px;
		color: #777;
		text-transform: uppercase;
	}
	select,
	input {
		min-width: 0;
		flex: 1;
		font-size: 11px;
	}
	input[type='number'] {
		width: 64px;
		flex: none;
	}
</style>
