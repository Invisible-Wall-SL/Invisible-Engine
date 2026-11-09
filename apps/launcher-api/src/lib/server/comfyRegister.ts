import { BlockList, isIP } from 'node:net';

/**
 * The tools whose holders may register a ComfyUI (`POST /api/comfy/register`): the Atlas Maker
 * renders on it, and the ComfyUI tool is where it is run from. Either one entitles.
 */
export const COMFY_REGISTER_TOOLS = ['atlasTool', 'comfyui'] as const;

const INVALID = 'A valid http(s) ComfyUI url is required';

/** Address ranges no registered ComfyUI may sit in: the atlas-tool would POST to them from
 *  inside Railway's network. Two lists, because a BlockList also matches an IPv4 address against
 *  its IPv6 rules (as ::ffff:a.b.c.d), which would put every IPv4 address under ::ffff:0:0/96. */
const PRIVATE_V4 = new BlockList();
const PRIVATE_V6 = new BlockList();
for (const [net, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] as const)
	PRIVATE_V4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
	// Unspecified, loopback and the deprecated IPv4-compatible block.
	['::', 96],
	// IPv4-mapped and NAT64: both can carry a private IPv4 address.
	['::ffff:0:0', 96],
	['64:ff9b::', 96],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
] as const)
	PRIVATE_V6.addSubnet(net, prefix, 'ipv6');

const PRIVATE_SUFFIXES = ['.localhost', '.internal', '.local'];

/**
 * Whether `hostname` (as `URL.hostname` gives it: lower-case, IPv4 already canonical, IPv6 in
 * brackets) names a loopback, private, link-local or internal address. A single-label name
 * (`localhost`, a bare service name) is private too: it resolves through the container's own DNS
 * search domains, never to a public tunnel.
 */
export function isPrivateComfyHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
	const kind = isIP(host);
	if (kind === 4) return PRIVATE_V4.check(host, 'ipv4');
	if (kind === 6) return PRIVATE_V6.check(host, 'ipv6');
	if (!host.includes('.')) return true;
	return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type ComfyUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * The ComfyUI base URL to store for `raw`, or why it is refused. The stored form is the WHATWG
 * serialization (origin + path), so the atlas-tool's own URL parser reads the host this one
 * checked rather than a differently-parsed one.
 */
export function checkComfyUrl(raw: string): ComfyUrlCheck {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!/^https?:\/\/.+/i.test(trimmed)) return { ok: false, error: INVALID };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { ok: false, error: INVALID };
	}
	if (parsed.username || parsed.password) {
		return { ok: false, error: 'A ComfyUI url cannot carry a user name or password.' };
	}
	if (parsed.search || parsed.hash) {
		return { ok: false, error: 'A ComfyUI url is a base address: drop the "?…" or "#…" part.' };
	}
	if (isPrivateComfyHost(parsed.hostname)) {
		return {
			ok: false,
			error:
				`"${parsed.hostname}" is a local or private network address, which the Atlas Maker ` +
				'cannot reach. Register the public tunnel address of your ComfyUI instead (the ' +
				"desktop launcher's quick tunnel, https://….trycloudflare.com, or your named tunnel).",
		};
	}
	return { ok: true, url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') };
}
