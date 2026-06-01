// Seed the Cloudflare-tunnel credentials bundle to R2 so the desktop Invisible
// Launcher can fetch it (authenticated, owner-only) and write ~/.cloudflared/ on
// a fresh machine. The OWNER runs this locally with R2_* env set; it reads the 3
// files from ~/.cloudflared/ and writes them as a SINGLE JSON object at
//   tools/invisible-launcher/cloudflared-bundle.json
// shaped { tunnel_id, config_yml, credentials_json, cert_pem }.
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node scripts/seed-tunnel-bundle.mjs [tunnelId] [cloudflaredDir]
//
// Defaults: tunnelId = 1e0057ee-6787-4bbc-a1af-936d7fe7603a (comfy-gualtiero),
//           cloudflaredDir = ~/.cloudflared
// Overridable also via env: TUNNEL_ID, CLOUDFLARED_DIR.
//
// These are SECRETS — they are never committed and never printed here.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUNDLE_KEY = 'tools/invisible-launcher/cloudflared-bundle.json';
const DEFAULT_TUNNEL_ID = '1e0057ee-6787-4bbc-a1af-936d7fe7603a';

const [argTunnelId, argDir] = process.argv.slice(2);
const tunnelId = argTunnelId ?? process.env.TUNNEL_ID ?? DEFAULT_TUNNEL_ID;
const cloudflaredDir = argDir ?? process.env.CLOUDFLARED_DIR ?? join(homedir(), '.cloudflared');

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

async function readText(name) {
	try {
		return await readFile(join(cloudflaredDir, name), 'utf8');
	} catch (e) {
		console.error(`Could not read ${name} from ${cloudflaredDir}: ${e.code ?? e.message}`);
		process.exit(1);
	}
}

const bundle = {
	tunnel_id: tunnelId,
	config_yml: await readText('config.yml'),
	credentials_json: await readText(`${tunnelId}.json`),
	cert_pem: await readText('cert.pem'),
};

// Sanity-check sizes only — never print the secret contents.
console.info(`Read from ${cloudflaredDir}:`);
console.info(`  config.yml          ${bundle.config_yml.length} chars`);
console.info(`  ${tunnelId}.json    ${bundle.credentials_json.length} chars`);
console.info(`  cert.pem            ${bundle.cert_pem.length} chars`);

const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({
	region: 'auto',
	endpoint,
	credentials: { accessKeyId, secretAccessKey },
});

await s3.send(
	new PutObjectCommand({
		Bucket: bucket,
		Key: BUNDLE_KEY,
		Body: JSON.stringify(bundle),
		ContentType: 'application/json',
	}),
);

console.info(`\nUploaded tunnel bundle to ${bucket}/${BUNDLE_KEY}`);
