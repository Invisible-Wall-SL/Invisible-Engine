<script lang="ts">
	/**
	 * Pick one of the project's rigs by its bundle name (the name a character sheet and a rig node
	 * store): the project's own, then the shared library's, each marked. A stored name the project
	 * does not have stays selected and is marked so. See `docs/ui-inventory.md` §1.
	 */
	interface Props {
		/** The project's rigs (`GET /api/characters/whole` `rigs`). */
		rigs: readonly { name: string; shared: boolean }[];
		/** The rig picked; `''` for none. */
		value: string;
		/** What the empty choice says; without it there is none once a rig is picked. */
		blank?: string;
		label: string;
		disabled?: boolean;
		/** Told the rig picked, `''` for the empty choice. */
		onPick: (rig: string) => void;
	}
	let { rigs, value, blank, label, disabled = false, onPick }: Props = $props();
	const known = $derived(rigs.some((rig) => rig.name === value));
</script>

<select
	data-rig-select
	aria-label={label}
	{value}
	{disabled}
	onchange={(e) => {
		const picked = e.currentTarget.value;
		onPick(picked);
		// The host decides: show what it stored, which is `value` again when it refused.
		if (e.currentTarget.value !== value) e.currentTarget.value = value;
	}}
>
	{#if blank !== undefined || !value}
		<option value="">{blank ?? 'Pick a rig…'}</option>
	{/if}
	{#if value && !known}<option {value}>{value} (not in this project)</option>{/if}
	{#each rigs as rig (rig.name)}
		<option value={rig.name}>{rig.name}{rig.shared ? ' (shared)' : ''}</option>
	{/each}
</select>
