/**
 * Read-only audit: what the Flow publish gate says about EVERY project's stored v2 flow.
 *
 *   # from apps/launcher-api, with the launcher's DB + R2 env loaded:
 *   set -a; . .env; set +a
 *   npx svelte-kit sync && npx tsx --tsconfig tsconfig.scripts.json scripts/audit-flow-v2.ts
 *
 * Prints one line per project — `valid`, `absent` (no stored flow: plays without the flow's
 * screens) or `INVALID` with its errors — through `checkFlowV2ForPublish`, the function Publish and
 * the desktop bake call. Run it before tightening the validator, so a rule that would suddenly
 * refuse existing games is known up front rather than discovered at someone's next publish.
 */
import { checkFlowV2ForPublish, describeFlowErrors } from '../src/lib/server/flowV2Validation';
import { UNASSIGNED_CLIENT } from '../src/lib/server/projectPaths';
import { listProjects } from '../src/lib/server/projects';

const projects = await listProjects();
const counts = { valid: 0, absent: 0, invalid: 0 };
for (const p of projects) {
	const client = p.clientKey ?? UNASSIGNED_CLIENT;
	const check = await checkFlowV2ForPublish(client, p.key);
	counts[check.status]++;
	if (check.status === 'invalid') {
		console.log(`INVALID  ${client}/${p.key} (${p.gameType})`);
		for (const line of describeFlowErrors(check.errors, 20)) console.log(`           - ${line}`);
	} else {
		console.log(`${check.status.padEnd(8)} ${client}/${p.key} (${p.gameType})`);
	}
}
console.log(
	`\n${projects.length} projects: ${counts.valid} valid, ${counts.absent} absent, ${counts.invalid} invalid`,
);
process.exit(0);
