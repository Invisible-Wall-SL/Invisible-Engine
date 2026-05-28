<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Sign in — Invisible Wall</title></svelte:head>

<div class="card">
	<h1>Invisible Wall</h1>
	<p class="muted">Sign in to the launcher.</p>

	<form method="POST" use:enhance>
		<input
			type="email"
			name="email"
			placeholder="you@invisiblewall.org"
			autocomplete="email"
			value={form?.email ?? ''}
			required
		/>
		<input
			type="password"
			name="password"
			placeholder="Password"
			autocomplete="current-password"
			required
		/>
		<label class="remember">
			<input type="checkbox" name="remember" checked />
			Remember me
		</label>
		<button type="submit">Sign in</button>
	</form>

	{#if form?.error}
		<p class="error">{form.error}</p>
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
	input[type='email'],
	input[type='password'] {
		padding: 12px;
		border-radius: 8px;
		border: 1px solid #333;
		background: #0e0e12;
		color: #eee;
		font-size: 15px;
	}
	.remember {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: #aaa;
	}
	.remember input {
		width: 16px;
		height: 16px;
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
	.error {
		color: #ff7b72;
		font-size: 14px;
	}
</style>
