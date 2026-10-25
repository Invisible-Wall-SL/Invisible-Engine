<script lang="ts">
	import { untrack } from 'svelte';
	import GlslCodeEditor from './GlslCodeEditor.svelte';
	import PortListEditor from './PortListEditor.svelte';
	import {
		CUSTOM_GLSL_HELP,
		CUSTOM_GLSL_LOCKED,
		CUSTOM_GLSL_PORTS_MAX,
		codeMarks,
		glslOf,
		glslPortNameRefusal,
		type CodeIssue,
		type GlslPortGesture,
		type PortSide,
	} from './shaderEditor';
	import { CUSTOM_GLSL_BUILTINS, customGlslLibrary, type GraphNode } from 'engine-shadergraph';

	// Below the selected node's settings when it is Custom GLSL: its code, what is wrong with it (the
	// compiler's checker, then what the WebGL1 and WebGL2 drivers said when the page test-compiled
	// it), what the code may use, and its declared inputs and outputs. Only a holder of
	// `shaderCustomGlsl` changes the code or the ports; anyone else reads them (and may still move,
	// wire or delete the node).
	interface Props {
		node: GraphNode;
		/** May change the code and the ports: holds the capability, and the graph is not read-only. */
		editable: boolean;
		/** Holds the capability (read-only then only while another author holds the graph). */
		holder: boolean;
		issues: readonly CodeIssue[];
		/** What the driver test-compile says now: checking, passed, or why it could not run. */
		driverStatus: string;
		/** The doc takes `code` for this node. Bound when the panel is made: it outlives a change of
		 *  selection, so a draft still waiting lands on the node it was typed into. */
		onCode: (code: string) => void;
		onPorts: (gesture: GlslPortGesture) => void;
	}
	let { node, editable, holder, issues, driverStatus, onCode, onPorts }: Props = $props();

	const commit = untrack(() => onCode);
	const LIBRARY = customGlslLibrary();
	const glsl = $derived(glslOf(node));
	const marks = $derived(codeMarks(issues));
	let editor: GlslCodeEditor | undefined = $state();

	const SIDES: { side: PortSide; title: string; noun: 'input' | 'output'; min: number }[] = [
		{ side: 'inputs', title: 'Inputs', noun: 'input', min: 0 },
		{ side: 'outputs', title: 'Outputs', noun: 'output', min: 1 },
	];
</script>

<section class="glsl-props">
	<h4>Code <span class="badge" aria-hidden="true">&lt;/&gt;</span></h4>
	{#if !holder}
		<p class="locked">{CUSTOM_GLSL_LOCKED}</p>
	{/if}
	<GlslCodeEditor
		bind:this={editor}
		code={glsl.code}
		readOnly={!editable}
		{marks}
		label="GLSL code of {node.id}"
		onCommit={commit}
	/>
	{#if issues.length}
		<ul class="issues">
			{#each issues as issue, i (i)}
				<li>
					{#if issue.line !== null}
						<button
							type="button"
							class="line"
							title="Show line {issue.line}"
							onclick={() => editor?.reveal(issue.line as number)}>line {issue.line}</button
						>
					{/if}
					<span class="source">{issue.source}</span>
					{issue.message}
				</li>
			{/each}
		</ul>
	{/if}
	{#if driverStatus}
		<p class="hint">{driverStatus}</p>
	{/if}
	<details class="help">
		<summary>What the code may use</summary>
		<ul>
			{#each CUSTOM_GLSL_HELP as line, i (i)}
				<li>{line}</li>
			{/each}
		</ul>
		<details class="names">
			<summary>The efx… library ({LIBRARY.length})</summary>
			<ul class="code">
				{#each LIBRARY as signature (signature)}
					<li>{signature}</li>
				{/each}
			</ul>
		</details>
		<details class="names">
			<summary>GLSL’s built-in functions ({CUSTOM_GLSL_BUILTINS.length})</summary>
			<p class="code">{CUSTOM_GLSL_BUILTINS.join(', ')}</p>
		</details>
	</details>

	{#each SIDES as { side, title, noun, min } (side)}
		<h4>{title}</h4>
		<PortListEditor
			ports={glsl[side]}
			{noun}
			max={CUSTOM_GLSL_PORTS_MAX}
			{min}
			disabled={!editable}
			onAdd={() => onPorts({ kind: 'add', side })}
			onPatch={(port, patch) => onPorts({ kind: 'patch', side, port, patch })}
			onRemove={(port) => onPorts({ kind: 'remove', side, port })}
			onRename={(port, next) => {
				const refusal = glslPortNameRefusal(glsl, side, port, next);
				if (!refusal) onPorts({ kind: 'rename', side, port, next });
				return refusal;
			}}
		/>
	{/each}
</section>

<style>
	.glsl-props {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	h4 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #fcd34d;
	}
	.badge {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10px;
		text-transform: none;
		color: #0b0e13;
		background: #fcd34d;
		border-radius: 3px;
		padding: 0 4px;
	}
	.locked {
		margin: 0;
		padding: 4px 8px;
		border-radius: 4px;
		background: #1f2937;
		color: #fcd34d;
	}
	.issues {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
		color: #fca5a5;
		font-size: 11px;
	}
	.issues li {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}
	.line {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10px;
		padding: 0 4px;
		color: #fecaca;
		background: #7f1d1d;
		border: 0;
		border-radius: 3px;
		cursor: pointer;
	}
	.source {
		font-size: 10px;
		color: #94a3b8;
	}
	.hint {
		margin: 0;
		color: #94a3b8;
		font-size: 11px;
	}
	.help {
		color: #94a3b8;
		font-size: 11px;
	}
	.help summary {
		cursor: pointer;
	}
	.help ul {
		margin: 4px 0 0;
		padding-left: 16px;
	}
	.names {
		margin: 4px 0 0 16px;
	}
	.names .code {
		max-height: 160px;
		overflow: auto;
		margin: 4px 0 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10px;
		color: #cbd5e1;
	}
</style>
