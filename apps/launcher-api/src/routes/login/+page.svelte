<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in — Invisible Wall</title></svelte:head>

<div class="card">
	<h1>Invisible Wall</h1>
	<p class="muted">Sign in to the launcher.</p>

	{#if form?.sent}
		<p class="success">If <strong>{form.email}</strong> has access, a sign-in link is on its way. Check your inbox.</p>
	{:else}
		<form method="POST" use:enhance>
			<input
				type="email"
				name="email"
				placeholder="you@invisiblewall.org"
				autocomplete="email"
				required
			/>
			<button type="submit">Send sign-in link</button>
		</form>
		{#if form?.invalid}
			<p class="error">Please enter a valid email address.</p>
		{:else if data.error === 'invalid'}
			<p class="error">That link is invalid or has expired. Request a new one.</p>
		{:else if data.error === 'missing'}
			<p class="error">No token in the link. Request a new one.</p>
		{/if}
	{/if}
</div>

<style>
	.card {
		max-width: 360px;
		margin: 12vh auto;
		padding: 32px;
		border-radius: 16px;
		background: #16161c;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 22px;
	}
	.muted {
		color: #888;
		margin-top: 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 20px;
	}
	input {
		padding: 12px;
		border-radius: 8px;
		border: 1px solid #333;
		background: #0e0e12;
		color: #eee;
		font-size: 15px;
	}
	button {
		padding: 12px;
		border-radius: 8px;
		border: none;
		background: #6b5bff;
		color: #fff;
		font-size: 15px;
		cursor: pointer;
	}
	.success {
		color: #7ee787;
	}
	.error {
		color: #ff7b72;
		font-size: 14px;
	}
</style>
