/**
 * Play a DELIVERY build locally, the way the partner's page will load it.
 *
 * WHY THIS HAS TO EXIST. A delivery build cannot be opened. It is not a site: there is no
 * `index.html` for it, only a `game.js` a partner's server-rendered page includes — and it reads the
 * session and the RGS path out of `window.params.GameSettings`, which only their page provides. Open
 * the folder directly and it refuses to boot, correctly, because `session.required` is true.
 *
 * So without this, the only way to find out whether a delivery works is to hand it to the operator
 * and wait. That is the wrong order: we would be shipping a bundle nobody has ever seen run.
 *
 * WHAT IT DOES. Serves the built folder at a CDN-shaped path and a fake operator page at a
 * completely different one:
 *
 *     http://localhost:4599/operator/                                  ← the page (their half)
 *     http://localhost:4599/cdn/<brand>/games/<version>/<alias>/…      ← the game (ours)
 *
 * The two paths deliberately share nothing. A document-relative URL — the failure this whole build
 * mode exists to avoid — cannot pass by accident here, because "relative to the page" and "relative
 * to the bundle" resolve somewhere different. That is exactly how the two asset paths that were
 * never script-relative (`srcBase()` and the audiosprite's own `src` list) were caught.
 *
 * It also PROXIES the RGS, because that is the other half of being an operator. A delivery reaches
 * its RGS same-origin (`rgs.source: 'host'`) — the operator's own infrastructure puts it behind the
 * same host as the page. `--rgs https://gs.2-complex.science` makes this server do the same, so a
 * delivery build is not merely loadable here but fully playable against a real node. Without it the
 * game boots and 404s at the first request, which is a useful check of its own.
 *
 * USAGE
 *
 *     node scripts/serve-embed.mjs <build-dir> [--port 4599] [--sid S0001e]
 *                                  [--service webnode/engine] [--alias MyGame]
 *                                  [--rgs https://gs.2-complex.science]
 *
 * `--sid` is the session token the fake page hands over. Point it at a REAL session on the partner
 * node, pass `--rgs`, and the game plays for real.
 *
 * See `docs/design/delivery-builds.md`.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const buildDir = resolve(process.argv[2] ?? 'build');
const port = Number(arg('--port', '4599'));
const sid = arg('--sid', '');
const service = arg('--service', 'webnode/engine');
const alias = arg('--alias', 'DeliveryGame');
const brand = arg('--brand', 'eanew');
const version = arg('--version', 'v1.0');

const rgsOrigin = arg('--rgs', '').replace(/\/+$/, '');

const PREFIX = `/cdn/${brand}/games/${version}/${alias}/`;
const PAGE_PATH = '/operator/';

/**
 * Forward one request to the partner's RGS and pipe the answer back verbatim.
 *
 * Headers are NOT copied through. The browser's own are meaningless to the RGS once this is a
 * server-to-server call (and `origin`/`referer` would be actively misleading), and the response's
 * CORS headers are irrelevant because the game now sees a same-origin reply — which is the whole
 * point of the arrangement being modelled. Content type is forced to the `text/plain` their client
 * uses, so this proxy cannot accidentally make the request look more acceptable than the real one.
 */
const proxyToRgs = (req, res, path) => {
	const target = `${rgsOrigin}${path}${new URL(req.url, 'http://localhost').search}`;
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', async () => {
		const body = Buffer.concat(chunks);
		try {
			const upstream = await fetch(target, {
				method: req.method,
				headers: { 'content-type': 'text/plain;charset=UTF-8' },
				body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
			});
			const text = await upstream.text();
			console.log(`  ${upstream.status}  ${req.method} ${path} -> ${rgsOrigin}`);
			res.writeHead(upstream.status, {
				'content-type': upstream.headers.get('content-type') ?? 'application/json',
				'cache-control': 'no-store',
			});
			res.end(text);
		} catch (error) {
			console.log(`  502  ${req.method} ${path} -> ${rgsOrigin} — ${error.message}`);
			res.writeHead(502, { 'content-type': 'text/plain' });
			res.end('rgs proxy failed');
		}
	});
};

try {
	statSync(join(buildDir, 'game.js'));
} catch {
	throw new Error(
		`No game.js in ${buildDir}.\n` +
			`A delivery build is produced with PUBLIC_DELIVERY_EMBED=1 plus scripts/build-embed.mjs — ` +
			`in the monorepo that is \`pnpm --filter lines build:embed\`.`,
	);
}

const TYPES = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.html': 'text/html',
	'.json': 'application/json',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.gif': 'image/gif',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.m4a': 'audio/mp4',
	'.ac3': 'audio/ac3',
	'.wav': 'audio/wav',
	'.atlas': 'text/plain',
	'.xml': 'text/xml',
	'.fnt': 'text/xml',
	'.ktx2': 'application/octet-stream',
	'.skel': 'application/octet-stream',
};

/**
 * Stands in for the partner's server-rendered wrapper. Deliberately minimal: everything here is
 * something their page really provides, and nothing here is something we get to assume.
 */
const page = () => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Operator page (fake) — ${alias}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style>
			html, body { margin: 0; padding: 0; background: #101014; height: 100%; }
			#game { position: fixed; inset: 0; }
		</style>
		<script>
			// Their <?= ?> block resolves this server-side. GameAPI is what their own client consumes
			// whole; we rebuild the same URL from service + token, so both are provided here.
			window.params = {
				GameAPI: ${JSON.stringify(`/${service}?sid=${sid}`)},
				GameSettings: {
					token: ${JSON.stringify(sid)},
					service: ${JSON.stringify(service)},
					config: {
						balanceUpdateInterval: 30000,
						enableTurbo: true,
						allowAutoplay: true,
						allowOutcomeBuy: true,
						showTheoreticalPayback: true,
						currencySymbol: '€',
						versionPath: ${JSON.stringify(version)}
					}
				}
			};
		</script>
	</head>
	<body>
		<div id="game"></div>
		<script src="${PREFIX}game.js"></script>
	</body>
</html>
`;

createServer((req, res) => {
	const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

	if (path === PAGE_PATH || path === PAGE_PATH.slice(0, -1)) {
		res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
		res.end(page());
		return;
	}

	// The operator's other job: the RGS lives behind the same origin as the page. Everything that is
	// neither the page nor the game folder is forwarded there, which is what makes `rgs.source:
	// 'host'` playable at all — the game posts a relative path and something has to answer it.
	if (rgsOrigin && !path.startsWith(PREFIX)) {
		proxyToRgs(req, res, path);
		return;
	}

	if (!path.startsWith(PREFIX)) {
		// Loud on purpose: anything asked for outside the two known roots is a URL that resolved
		// against the wrong thing, which is the bug class this harness exists to surface.
		console.log(`  404  ${path}   <- resolved outside the game folder`);
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
		return;
	}

	const rel = normalize(path.slice(PREFIX.length)).replace(/^(\.\.[\\/])+/, '');
	const file = join(buildDir, rel || 'game.js');
	try {
		if (!statSync(file).isFile()) throw new Error('not a file');
	} catch {
		console.log(`  404  ${path}`);
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
		return;
	}

	res.writeHead(200, {
		'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
		'cache-control': 'no-store',
	});
	createReadStream(file).pipe(res);
}).listen(port, () => {
	console.info(
		`\n  Delivery build: ${buildDir}\n` +
			`  Operator page:  http://localhost:${port}${PAGE_PATH}\n` +
			`  Served at:      ${PREFIX}\n` +
			(sid
				? `  Session:        ${sid}\n`
				: `  Session:        (none — the game will refuse to boot, which is correct)\n`) +
			(rgsOrigin
				? `  RGS proxy:      * -> ${rgsOrigin}\n`
				: `  RGS proxy:      (none — pass --rgs <origin> to play for real)\n`) +
			`\n  Any 404 logged below is a URL that resolved against the page instead of the bundle.\n`,
	);
});
