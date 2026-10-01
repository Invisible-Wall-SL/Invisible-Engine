<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Emblem from '$lib/Emblem.svelte';
	import { MIN_PASSWORD_LENGTH } from '$lib/passwordPolicy';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Change password — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<a class="ghost" href={resolve('/')}>‹ Launcher</a>
	</header>

	<h1>Change password</h1>
	<p class="lead">
		Signed in as <span class="mono">{data.user.email}</span>. Changing your password signs out every
		other browser and device; this one stays signed in.
	</p>

	<form method="POST" use:enhance class="card">
		<input type="email" autocomplete="username" value={data.user.email} hidden readonly />
		<label>
			Current password
			<input name="current" type="password" autocomplete="current-password" required />
		</label>
		<label>
			New password
			<input
				name="next"
				type="password"
				autocomplete="new-password"
				minlength={MIN_PASSWORD_LENGTH}
				required
			/>
			<span class="hint">
				At least {MIN_PASSWORD_LENGTH} characters, and not your email address. A long phrase is easier
				to remember than a short jumble.
			</span>
		</label>
		<label>
			Confirm new password
			<input
				name="confirm"
				type="password"
				autocomplete="new-password"
				minlength={MIN_PASSWORD_LENGTH}
				required
			/>
		</label>
		<button type="submit">Change password</button>

		{#if form?.error}
			<p class="error" role="alert">{form.error}</p>
		{:else if form?.ok}
			<p class="ok" role="status">{form.ok}</p>
		{/if}
	</form>
</div>

<style>
	.shell {
		max-width: 480px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 28px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
	}
	.ghost {
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
	}
	h1 {
		font-size: 26px;
		margin: 0 0 6px;
	}
	.lead {
		color: #b8b8c0;
		line-height: 1.5;
		margin: 0 0 20px;
	}
	.mono {
		font-family: ui-monospace, monospace;
		color: #e8e8ee;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 24px;
		border-radius: 14px;
		background: #16161c;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: #aaa;
	}
	input {
		padding: 11px 12px;
		border-radius: 8px;
		border: 1px solid #333;
		background: #0e0e12;
		color: #eee;
		font-size: 15px;
	}
	input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.hint {
		font-size: 12px;
		color: #777;
		line-height: 1.4;
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
	.error,
	.ok {
		margin: 0;
		font-size: 14px;
	}
	.error {
		color: #ff7b72;
	}
	.ok {
		color: #7ee0c0;
	}
</style>
