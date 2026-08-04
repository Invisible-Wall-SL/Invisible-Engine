<script lang="ts">
	/**
	 * Shared save-status pill (multi-user-concurrency Phase 2a) — the ONE render of the
	 * near-identical status pill the Scene Editor and Flow v2 (doc + library) each drew
	 * by hand. Driven entirely by a {@link SaveState}'s exposed state; it renders nothing
	 * bespoke, so a tool with extra states (the editor's cross-type / preview banners, a
	 * tool's `confirm()`-based conflict) keeps those separately and only routes the common
	 * saving / saved / dirty / error / conflict / scope-mismatch pill through here.
	 *
	 * Appearance is preserved via props where consumers' pills drift: `okAccent` (Flow's "Saved"
	 * is green), `savingLabel`, per-state `titles`, and the `*Label` overrides. The pill chrome
	 * itself (`.save-pill` + status modifiers) is single-sourced here. (The Scene Editor keeps a
	 * BESPOKE pill driven off the same `SaveState` — its error state is a span + separate Retry
	 * button and its saved state carries a relative-time label, neither of which this models.)
	 */
	import type { SaveState } from './saveState.svelte';

	interface Props {
		/** The state machine driving the pill. */
		state: SaveState;
		/** Label for the in-flight state (Flow's library uses "Library…"). */
		savingLabel?: string;
		/** Label for the clean/saved state (e.g. `Saved`, `Saved 3s ago`). */
		savedLabel?: string;
		/** Label for the unsaved state. */
		dirtyLabel?: string;
		/** Shown instead of `dirtyLabel` when dirty AND `showDirty` — some tools gate it. */
		conflictLabel?: string;
		scopeMismatchLabel?: string;
		/** Per-display-state tooltips (Flow's library stamps "Shared function library" etc.).
		 *  For conflict/scope the live `state.message` wins when present. */
		titles?: {
			saving?: string;
			dirty?: string;
			saved?: string;
			conflict?: string;
			scopeMismatch?: string;
		};
		/** Flow's "Saved" is green (`true`); a grey default otherwise. */
		okAccent?: boolean;
		/** Whether a conflict offers an in-pill "Overwrite with mine" (Flow: yes). Tools
		 *  whose overwrite lives in a `confirm()` pass `false` + omit `onOverwrite`. */
		overwritable?: boolean;
		/** Render the dirty pill (some tools show only saved/saving/error). */
		showDirty?: boolean;
		/** Actions. Omit any to hide its button. */
		onSave?: () => void;
		onRetry?: () => void;
		onReloadTheirs?: () => void;
		onOverwrite?: () => void;
	}

	let {
		state,
		savingLabel = 'Saving…',
		savedLabel = 'Saved',
		dirtyLabel = 'Unsaved changes',
		conflictLabel = '⚠ Someone else saved this',
		scopeMismatchLabel = '⚠ Wrong project — not saved',
		titles = {},
		okAccent = false,
		overwritable = false,
		showDirty = true,
		onSave,
		onRetry,
		onReloadTheirs,
		onOverwrite,
	}: Props = $props();

	const status = $derived(state.status);
	const dirty = $derived(state.dirty);
	const message = $derived(state.message);
</script>

{#if status === 'saving'}
	<span class="save-pill busy" title={titles.saving}>{savingLabel}</span>
{:else if status === 'scope-mismatch'}
	<!-- No "overwrite": the target is a DIFFERENT project's doc; overwriting it is never
	     the author's to choose. Reload against the current active project. -->
	<span class="save-pill error" title={message || titles.scopeMismatch}>{scopeMismatchLabel}</span>
	{#if onReloadTheirs}
		<button class="save-pill" type="button" onclick={onReloadTheirs}>Reload</button>
	{/if}
{:else if status === 'conflict'}
	<span class="save-pill error" title={message || titles.conflict}>{conflictLabel}</span>
	{#if onReloadTheirs}
		<button
			class="save-pill"
			type="button"
			title="Discard YOUR changes and load their version."
			onclick={onReloadTheirs}>Reload theirs</button
		>
	{/if}
	{#if overwritable && onOverwrite}
		<button
			class="save-pill"
			type="button"
			title="Overwrite THEIR version with yours. Their changes since you loaded will be lost."
			onclick={onOverwrite}>Overwrite with mine</button
		>
	{/if}
{:else if status === 'error'}
	{#if onRetry}
		<button class="save-pill error" type="button" onclick={onRetry}
			>Save failed — retry</button
		>
	{:else}
		<span class="save-pill error" title={message}>Save failed</span>
	{/if}
{:else if dirty && showDirty}
	<span class="save-pill dirty" title={titles.dirty}>{dirtyLabel}</span>
	{#if onSave}
		<button class="save-pill" type="button" onclick={onSave}>Save</button>
	{/if}
{:else}
	<span class="save-pill ok" class:accent={okAccent} title={titles.saved}>{savedLabel}</span>
{/if}

<style>
	.save-pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #1f2937;
		background: #16161c;
		color: #888;
		letter-spacing: 0.02em;
	}
	button.save-pill {
		cursor: pointer;
		font: inherit;
	}
	.save-pill.busy {
		color: #7ee0c0;
		border-color: #234038;
	}
	.save-pill.dirty {
		color: #f0c878;
		border-color: #3a3020;
	}
	.save-pill.error {
		color: #ff9a9a;
		border-color: #4a2a30;
	}
	.save-pill.ok {
		color: #888;
	}
	.save-pill.ok.accent {
		color: #86efac;
	}
</style>
