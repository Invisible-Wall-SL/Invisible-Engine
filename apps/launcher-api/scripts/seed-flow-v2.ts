// Seed a project's Invisible Flow **v2** document into R2 (`<client>/<project>/editor/flow-v2.json`),
// the SAME per-project source the bake pipeline reads (`flowV2Storage` / `exportEditorFlowV2`). Use it
// to activate the committed reference flow (`LINES_FLOW_V2_DOC`) for an online game WITHOUT authoring
// it in the /flow-v2 editor first — a deliberate, reviewable one-off (not an ad-hoc raw write).
//
// It VALIDATES the doc against BOOK_OF_VOCAB and REFUSES to upload if it has any issue, so a broken
// flow can never reach a live game. Reversible: delete the object to fall back to the coded path.
//
//   # from apps/launcher-api (R2 creds in .env):
//   set -a; . .env; set +a
//   npx tsx scripts/seed-flow-v2.ts <client> <project>
//   # e.g. npx tsx scripts/seed-flow-v2.ts borut book_of_borut_redux
//
// Then do a runtime release + refresh so the live engine has the v2 runtime + the game re-fetches:
//   see reference_runtime_release / docs (publish-runtime-bundle.mjs + POST /refresh).

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	BOOK_OF_VOCAB,
	validateFlowDoc,
} from 'engine-flow-v2';
// The committed reference flow lives in the game package; import it directly (workspace-resolved).
import { LINES_FLOW_V2_DOC, LINES_FLOW_V2_LIBRARY } from '../../lines/src/game/flowV2Doc';

const [client, project] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!client || !project) {
	console.error('Usage: tsx scripts/seed-flow-v2.ts <client> <project>');
	process.exit(1);
}

const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	console.error('Source the creds first:  set -a; . .env; set +a');
	process.exit(1);
}

// Guard: never upload a flow that would not validate against the template contract. The
// container-event surface (the buy subgraph's fused repeater/confirm pins) is supplied so those
// exec/data edges resolve as real endpoints — the editor derives the equivalent from the scenes.
const issues = validateFlowDoc(
	LINES_FLOW_V2_DOC,
	BOOK_OF_VOCAB,
	LINES_FLOW_V2_LIBRARY,
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
);
if (issues.length) {
	console.error('REFUSING to seed — the flow has validation issues:');
	for (const i of issues) console.error(`  ${i.code}: ${i.message}`);
	process.exit(1);
}

const key = `${client}/${project}/editor/flow-v2.json`;
const events = LINES_FLOW_V2_DOC.graph.nodes.filter((n) => n.kind === 'event').map((n) => n.ref);

const s3 = new S3Client({
	region: 'auto',
	endpoint: R2_ENDPOINT,
	credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

await s3.send(
	new PutObjectCommand({
		Bucket: R2_BUCKET,
		Key: key,
		Body: JSON.stringify(LINES_FLOW_V2_DOC, null, '\t'),
		ContentType: 'application/json',
	}),
);

console.log(`Seeded ${key}`);
console.log(
	`  ${LINES_FLOW_V2_DOC.graph.nodes.length} nodes, ${events.length} events: ${events.join(', ')}`,
);
console.log(
	'Next: runtime release (publish-runtime-bundle.mjs lines) + POST /refresh, then hard-refresh the game.',
);
