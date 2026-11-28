<script lang="ts">
	/**
	 * The open component's PROP block (`docs/design/arcade-prop-components.md` §7 P7): what zone it
	 * stands on, the zone it previews on, and its collider — the snap, the two ramps and the height
	 * (each a number or a param), the hole, the side exit and the solids. Its problems are the
	 * compile's own (`propShapeErrors`), read live. Edits the draft in place (`propEdit.ts`).
	 */
	import type { ComponentDef, PropCollider } from 'engine-layout';
	import {
		PROP_HOLES,
		PROP_SOLID_SIDES,
		PROP_ZONE_KINDS,
		propShapeErrors,
	} from 'engine-mechanics/src/propShape.js';

	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import {
		makeProp,
		propLengthIsParam,
		propLengthValue,
		removePropSolid,
		setPropHole,
		setPropLength,
		setPropPreview,
		setPropSideExit,
		setPropSnap,
		setPropSolid,
		setPropSolidBox,
		setPropZoneKind,
		togglePropLengthParam,
		unmakeProp,
		type PropLengthField,
	} from '$lib/editor/propEdit';

	interface Props {
		def: ComponentDef;
		/** Bumped by the page on every edit, so the card reads the draft again. */
		version: number;
		readOnly?: boolean;
		onChanged: () => void;
	}
	let { def, version, readOnly = false, onChanged }: Props = $props();

	let local = $state(0);
	const prop = $derived.by(() => {
		void version;
		void local;
		return def.prop ? { ...def.prop } : undefined;
	});
	const errors = $derived.by(() => {
		void prop;
		return def.prop ? propShapeErrors(def) : [];
	});
	/** Each length field's value and whether it follows a param, read again on every edit. */
	const lengths = $derived.by(() => {
		void prop;
		const fields: PropLengthField[] = ['near', 'far', 'height'];
		return Object.fromEntries(
			fields.map((f) => [f, { value: propLengthValue(def, f), param: propLengthIsParam(def, f) }]),
		) as Record<PropLengthField, { value: number; param: boolean }>;
	});

	function edit(fn: () => boolean): void {
		if (readOnly || !fn()) return;
		local += 1;
		onChanged();
	}
	const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

	const LENGTHS: { field: PropLengthField; label: string; tip: string }[] = [
		{
			field: 'near',
			label: 'Near ramp',
			tip: 'Cells the slope runs from the deck’s first cell down to the bank. The param toggle makes it a param of this component.',
		},
		{
			field: 'far',
			label: 'Far ramp',
			tip: 'Cells the slope runs from the deck’s last cell down to the far bank.',
		},
		{
			field: 'height',
			label: 'Height',
			tip: 'The deck’s height, cells. With the param on it follows the zone’s height (the level’s), previewed at the value here.',
		},
	];
</script>

<SectionCard scope="editor" id="prop" title="Prop">
	{#snippet info()}
		Scenery the game places on every zone of one family (Game Config → Zone art → Component), with a
		collider the rules play: who it carries, how they get on, how high they stand. Its pieces are
		its root children, each in its band (Depth, on a selected node).
	{/snippet}
	{#snippet actions()}
		{#if prop}
			<IconButton
				icon="trash"
				label="Stop being a prop (its params and inputs stay)"
				danger
				disabled={readOnly}
				onclick={() => edit(() => unmakeProp(def))}
			/>
		{:else}
			<IconButton
				icon="plus"
				label="Make a prop: a bridge with today's collider"
				disabled={readOnly}
				onclick={() => edit(() => makeProp(def))}
			/>
		{/if}
	{/snippet}
	{#if !prop}
		<p class="muted small">Not a prop.</p>
	{:else}
		{@const c = prop.collider as PropCollider}
		<div class="grid">
			<label class="field">
				<span>Zone kind</span>
				<select
					value={prop.zoneKind}
					disabled={readOnly}
					onchange={(e) => edit(() => setPropZoneKind(def, e.currentTarget.value))}
				>
					{#each PROP_ZONE_KINDS as kind (kind)}
						<option value={kind}>{kind}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Preview length <InfoTip>Cells of the zone the stage previews it on.</InfoTip></span>
				<input
					type="number"
					min="1"
					step="1"
					value={prop.preview?.length ?? 6}
					disabled={readOnly}
					onchange={(e) => edit(() => setPropPreview(def, 'length', num(e)))}
				/>
			</label>
			<label class="field">
				<span>Preview height</span>
				<input
					type="number"
					min="1"
					step="1"
					value={prop.preview?.height ?? 6}
					disabled={readOnly}
					onchange={(e) => edit(() => setPropPreview(def, 'height', num(e)))}
				/>
			</label>
			<label class="field">
				<span
					>Snap <InfoTip
						>Cells either side of the deck’s row within which a character is put on the deck (at
						most 1).</InfoTip
					></span
				>
				<input
					type="number"
					min="0.05"
					max="1"
					step="0.05"
					value={c.snap}
					disabled={readOnly}
					onchange={(e) => edit(() => setPropSnap(def, num(e)))}
				/>
			</label>
			{#each LENGTHS as row (row.field)}
				<div class="field">
					<span>{row.label} <InfoTip>{row.tip}</InfoTip></span>
					<div class="with-toggle">
						<input
							type="number"
							min={row.field === 'height' ? 0.5 : 1}
							step={row.field === 'height' ? 0.5 : 1}
							value={lengths[row.field].value}
							disabled={readOnly}
							aria-label={row.label}
							onchange={(e) => edit(() => setPropLength(def, row.field, num(e)))}
						/>
						<label class="toggle" title="Follow a param instead of a number">
							<input
								type="checkbox"
								checked={lengths[row.field].param}
								disabled={readOnly}
								onchange={() => edit(() => togglePropLengthParam(def, row.field))}
							/>
							param
						</label>
					</div>
				</div>
			{/each}
			<label class="field">
				<span
					>Hole <InfoTip>Where the water under it opens to the characters it carries.</InfoTip
					></span
				>
				<select
					value={c.hole}
					disabled={readOnly}
					onchange={(e) =>
						edit(() => setPropHole(def, e.currentTarget.value as PropCollider['hole']))}
				>
					{#each PROP_HOLES as hole (hole)}
						<option value={hole}>{hole === 'deckAndRamps' ? 'deck and ramps' : hole}</option>
					{/each}
				</select>
			</label>
			<label class="check">
				<input
					type="checkbox"
					checked={c.sideExit === true}
					disabled={readOnly}
					onchange={(e) => edit(() => setPropSideExit(def, e.currentTarget.checked))}
				/>
				Side exit
				<InfoTip
					>Off: a character on the deck is held on its row. On: one walking across the row steps off
					the side, unless a solid (a railing) stops it.</InfoTip
				>
			</label>
		</div>
		{#if c.solids?.length}
			<ul class="solids" aria-label="Solids">
				{#each c.solids as s, i (i)}
					<li>
						<span class="muted small">Solid {i + 1}</span>
						{#each ['x', 'y', 'w', 'h'] as const as k (k)}
							<input
								type="number"
								step="0.1"
								value={s[k]}
								aria-label={`Solid ${i + 1} ${k}`}
								disabled={readOnly}
								onchange={(e) => edit(() => setPropSolidBox(def, i, { ...s, [k]: num(e) }))}
							/>
						{/each}
						<select
							value={s.collide === 'oneWay' ? (s.side ?? 'below') : 'solid'}
							aria-label={`Solid ${i + 1} stops`}
							disabled={readOnly}
							onchange={(e) => {
								const v = e.currentTarget.value;
								edit(() =>
									setPropSolid(
										def,
										i,
										v === 'solid'
											? { collide: 'solid' }
											: { collide: 'oneWay', side: v as (typeof PROP_SOLID_SIDES)[number] },
									),
								);
							}}
						>
							<option value="solid">every side</option>
							{#each PROP_SOLID_SIDES as side (side)}
								<option value={side}>from {side}</option>
							{/each}
						</select>
						<IconButton
							icon="trash"
							label={`Remove solid ${i + 1}`}
							danger
							disabled={readOnly}
							onclick={() => edit(() => removePropSolid(def, i))}
						/>
					</li>
				{/each}
			</ul>
		{/if}
		{#if errors.length}
			<ul class="errors" aria-label="Collider problems">
				{#each errors as error (error)}
					<li>⚠ {error}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</SectionCard>

<style>
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		min-width: 0;
	}
	.field input,
	.field select {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
	}
	.with-toggle input {
		flex: 1;
	}
	.with-toggle {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.toggle,
	.check {
		display: flex;
		gap: 4px;
		align-items: center;
		font-size: 12px;
		white-space: nowrap;
	}
	.check {
		grid-column: span 2;
	}
	.solids {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.solids li {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}
	.solids input {
		width: 52px;
	}
	.errors {
		margin: 8px 0 0;
		padding: 6px 8px;
		list-style: none;
		background: #2a1a12;
		border: 1px solid #6a3a1a;
		border-radius: 6px;
		color: #f0c090;
		font-size: 12px;
	}
	.muted {
		opacity: 0.7;
	}
	.small {
		font-size: 12px;
	}
</style>
