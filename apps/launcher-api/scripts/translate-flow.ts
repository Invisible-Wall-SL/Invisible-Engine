// Convert a project's authored Invisible Flow **v1** doc into a **v2** doc — the cutover pipeline step
// (the translator lives in `engine-flow-migrate`). Reads R2 `<client>/<project>/editor/flow.json`,
// translates against the reference vocabulary, validates, and either writes the v2 doc to a LOCAL file
// for review (default) or SEEDS it to R2 `<client>/<project>/editor/flow-v2.json` with `--seed` (so the
// game's runtime bundle picks it up). REFUSES to seed if the translation has any validation error.
//
//   # from apps/launcher-api (R2 creds in .env):
//   set -a; . .env; set +a
//   npx tsx scripts/translate-flow.ts <client> <project> [--out <path>] [--seed]
//   # review:  npx tsx scripts/translate-flow.ts invisible_wall bookofborutremake --out /tmp/x.json
//   # seed:    npx tsx scripts/translate-flow.ts invisible_wall bookofborutremake --seed
//
// After --seed: runtime release + POST /refresh so the live engine has the v2 runtime + the game
// re-fetches (see reference_runtime_release). Reversible: delete the R2 flow-v2.json → coded/v1 path.

import { writeFileSync } from 'node:fs';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { FlowDoc as FlowDocV1 } from 'engine-flow';
import { translateFlowDoc } from 'engine-flow-migrate';
import { BOOK_OF_VOCAB, validateFlowDoc } from 'engine-flow-v2';

const args = process.argv.slice(2);
const [client, project] = args.filter((a) => !a.startsWith('--'));
const seed = args.includes('--seed');
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;

if (!client || !project) {
	console.error('Usage: tsx scripts/translate-flow.ts <client> <project> [--out <path>] [--seed]');
	process.exit(1);
}

const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	console.error('Missing R2_* creds. Source them first:  set -a; . .env; set +a');
	process.exit(1);
}

const s3 = new S3Client({
	region: 'auto',
	endpoint: R2_ENDPOINT,
	credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const v1Key = `${client}/${project}/editor/flow.json`;
const v2Key = `${client}/${project}/editor/flow-v2.json`;

const main = async () => {
	// 1. Read the v1 flow.
	const raw = await s3
		.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: v1Key }))
		.then((r) => r.Body!.transformToString())
		.catch(() => null);
	if (!raw) {
		console.error(`No v1 flow at ${v1Key} — nothing to translate.`);
		process.exit(1);
	}
	const v1 = JSON.parse(raw) as FlowDocV1;
	console.log(
		`v1 ${v1Key}: ${v1.screens.length} screens, ${v1.transitions.length} transitions, ${(v1.events ?? []).length} event choreographies`,
	);

	// 2. Translate + validate.
	const v2 = translateFlowDoc(v1, BOOK_OF_VOCAB);
	const issues = validateFlowDoc(v2, BOOK_OF_VOCAB, { version: 2, functions: [] });
	const errors = issues.filter((i) => i.severity === 'error');
	const warnings = issues.filter((i) => i.severity === 'warning');
	console.log(
		`v2: ${v2.graph.nodes.length} nodes, ${v2.containers.length} containers — ${errors.length} ERRORS, ${warnings.length} warnings (unknown-event warnings are expected — the game dispatches those)`,
	);
	for (const e of errors) console.error(`  ERROR ${e.code}: ${e.message}`);
	if (errors.length) {
		console.error('\nTranslation has ERRORS — refusing to write. Fix the translator/vocab first.');
		process.exit(1);
	}

	const json = JSON.stringify(v2, null, '\t');

	// 3. Write — locally for review (default) or seed to R2 (--seed).
	if (seed) {
		await s3.send(
			new PutObjectCommand({
				Bucket: R2_BUCKET,
				Key: v2Key,
				Body: json,
				ContentType: 'application/json',
			}),
		);
		console.log(
			`\nSEEDED ${v2Key} — the game will run this v2 flow (after a runtime release + /refresh).`,
		);
	} else {
		const path = outPath ?? `${project}-flow-v2.json`;
		writeFileSync(path, json);
		console.log(`\nWrote ${path} for review. Re-run with --seed to publish it to R2 (${v2Key}).`);
	}
};

void main().catch((e) => {
	console.error('ERR', e instanceof Error ? e.message : e);
	process.exit(1);
});
