import { ENV } from './env';
import { githubConfigured, githubError, githubFetch } from './github';

/**
 * The custom nodes baked into the R&D pod image, read and edited as DATA — Phase 2 of
 * `docs/design/comfyui-node-manager.md`.
 *
 * The list lives at `services/atlas-comfy-pod/nodes.json` **in git**, and every edit from
 * `/comfyui` is a real commit on `main` through the GitHub contents API. That is the whole
 * design decision: the alternative — a list in R2, or values passed as workflow inputs —
 * looks simpler and destroys reproducibility, because the image would then depend on state
 * nobody recorded and `git checkout <sha> && docker build` would stop reproducing what is
 * running. Here, an add is a diff with an author and a revert.
 *
 * A commit under `services/atlas-comfy-pod/**` also triggers the image build by itself, so
 * "add a node" is one action rather than two.
 */

const NODES_PATH = 'services/atlas-comfy-pod/nodes.json';

/** A node on the image. `url`+`sha` = cloned; `vendored` = COPY'd from the repo instead. */
export interface PodNode {
	name: string;
	url?: string;
	sha?: string;
	vendored?: boolean;
	/**
	 * Also baked into the SERVERLESS WORKER — the Atlas Maker's generation path. Most nodes are
	 * R&D-only and stay off it: some are licence-encumbered, most are simply not needed there.
	 * A blueprint using an unpromoted node will not run in the Atlas Maker, which is the whole
	 * reason this flag is visible in the panel rather than buried in a Dockerfile.
	 */
	prod?: boolean;
	/**
	 * The pack registers no NODE CLASSES (a frontend/UI extension). The panel checks each node
	 * against what a live pod loaded, and that check reads `/object_info` — which only ever
	 * sees packs that register classes. Without this flag such a pack reads "not seen" forever.
	 */
	noClasses?: boolean;
	note?: string;
}

interface NodesDoc {
	nodes: PodNode[];
	skipRequirements?: string[];
	[key: string]: unknown;
}

export interface NodeListState {
	configured: boolean;
	nodes?: PodNode[];
	skipRequirements?: string[];
	/** The blob sha the list was read at — the caller passes it back to detect a race. */
	revision?: string;
	error?: string;
	/**
	 * The WHOLE parsed file, so an edit can preserve every key it does not touch — `_readme`,
	 * `skipRequirements`, anything added later. Rebuilding the document from the fields this
	 * module happens to know about is how a comment block silently disappears. Not sent to the
	 * browser; the endpoint picks what it renders.
	 */
	doc?: NodesDoc;
}

/** Who a commit is attributed to. The launcher user, not a bot: this is their change. */
export interface CommitAuthor {
	name: string;
	email: string;
}

interface ContentsResponse {
	content?: string;
	sha?: string;
	encoding?: string;
}

function decode(res: ContentsResponse): NodesDoc | null {
	if (typeof res.content !== 'string') return null;
	try {
		return JSON.parse(Buffer.from(res.content, 'base64').toString('utf8')) as NodesDoc;
	} catch {
		return null;
	}
}

/**
 * Serialise back in the repo's own shape: tabs, trailing newline. Prettier formats JSON here
 * with `useTabs`, so writing anything else would make the next `pnpm format` show a diff
 * nobody made.
 */
function encode(doc: NodesDoc): string {
	return Buffer.from(`${JSON.stringify(doc, null, '\t')}\n`, 'utf8').toString('base64');
}

/** The current list, straight from `main`. */
export async function readNodeList(): Promise<NodeListState> {
	if (!githubConfigured()) return { configured: false };
	const res = await githubFetch(`/repos/${ENV.GITHUB_ENGINE_REPO}/contents/${NODES_PATH}?ref=main`);
	if (typeof res === 'string') return { configured: true, error: res };
	if (!res.ok) return { configured: true, error: await githubError(res) };

	const body = (await res.json().catch(() => null)) as ContentsResponse | null;
	const doc = body ? decode(body) : null;
	if (!doc || !Array.isArray(doc.nodes)) {
		return { configured: true, error: `${NODES_PATH} could not be read as a node list.` };
	}
	return {
		configured: true,
		nodes: doc.nodes,
		skipRequirements: doc.skipRequirements ?? [],
		revision: body?.sha,
		doc,
	};
}

/** A repo URL resolved to the exact commit an add would pin. */
export interface ResolvedNode {
	name: string;
	url: string;
	sha: string;
	/** Shown before committing, so nobody pins a ref they have not looked at. */
	subject?: string;
	date?: string;
}

/** `https://github.com/owner/repo(.git)(/…)` → `owner/repo`, or null if that is not one. */
export function parseRepo(url: string): string | null {
	const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(
		url.trim(),
	);
	if (!m) return null;
	return `${m[1]}/${m[2]}`;
}

/**
 * Resolve a repo URL to its tip commit.
 *
 * The UI never lets anyone TYPE a ref. A node pinned to a branch is how silent drift comes
 * back — it was the hole the 2026-08-19 pinning work closed, where a plain rebuild could
 * ship different node code against a frozen core with no commit of ours. So the form takes a
 * URL, this resolves it, and the panel shows the commit's subject and date before it is
 * written down.
 */
export async function resolveNode(url: string): Promise<{ node?: ResolvedNode; error?: string }> {
	const repo = parseRepo(url);
	if (!repo) return { error: 'Expected a GitHub repo URL, e.g. https://github.com/owner/repo' };

	const res = await githubFetch(`/repos/${repo}/commits/HEAD`);
	if (typeof res === 'string') return { error: res };
	if (!res.ok) return { error: await githubError(res) };

	const body = (await res.json().catch(() => null)) as {
		sha?: string;
		commit?: { message?: string; author?: { date?: string } };
	} | null;
	if (!body?.sha) return { error: 'GitHub did not return a commit for that repo.' };

	return {
		node: {
			name: repo.split('/')[1],
			url: `https://github.com/${repo}`,
			// 12 chars, not 40: the repo's secret scanner rejects a full hex sha in a commit.
			sha: body.sha.slice(0, 12),
			subject: body.commit?.message?.split('\n')[0],
			date: body.commit?.author?.date,
		},
	};
}

async function commitNodes(
	doc: NodesDoc,
	revision: string,
	message: string,
	author: CommitAuthor,
): Promise<{ ok: boolean; error?: string }> {
	const res = await githubFetch(`/repos/${ENV.GITHUB_ENGINE_REPO}/contents/${NODES_PATH}`, {
		method: 'PUT',
		body: JSON.stringify({
			message,
			content: encode(doc),
			// The blob sha we read. GitHub 409s if the file moved since — two admins editing
			// at once must not silently drop one of the changes.
			sha: revision,
			branch: 'main',
			committer: { name: author.name, email: author.email },
			author: { name: author.name, email: author.email },
		}),
	});
	if (typeof res === 'string') return { ok: false, error: res };
	if (!res.ok) {
		const error = await githubError(res);
		return {
			ok: false,
			error:
				res.status === 409
					? `${error} — the node list changed while you were editing. Reload and try again.`
					: error,
		};
	}
	return { ok: true };
}

/**
 * Add a node, pinned to the tip of its repo.
 *
 * Refuses a duplicate NAME rather than merging: two entries cloning into the same folder is
 * a build that fails halfway, and the second clone is the one that would lose.
 */
export async function addNode(
	url: string,
	note: string | undefined,
	author: CommitAuthor,
): Promise<{ ok: boolean; node?: ResolvedNode; error?: string }> {
	const list = await readNodeList();
	if (list.error || !list.nodes || !list.revision || !list.doc) {
		return { ok: false, error: list.error ?? 'Could not read the node list.' };
	}

	const resolved = await resolveNode(url);
	if (resolved.error || !resolved.node) return { ok: false, error: resolved.error };
	const node = resolved.node;

	if (list.nodes.some((n) => n.name.toLowerCase() === node.name.toLowerCase())) {
		return { ok: false, error: `${node.name} is already on the image.` };
	}

	// Cloned nodes go before the vendored ones, which is how the file reads today: the list
	// the Dockerfile iterates first, then the two it only COPYs.
	const cloned = list.nodes.filter((n) => !n.vendored);
	const vendored = list.nodes.filter((n) => n.vendored);
	const entry: PodNode = { name: node.name, url: node.url, sha: node.sha };
	if (note?.trim()) entry.note = note.trim();

	const doc: NodesDoc = { ...list.doc, nodes: [...cloned, entry, ...vendored] };
	const message = `infra(pod): add ${node.name} to the R&D image\n\nPinned to ${node.sha}${
		node.subject ? ` (${node.subject})` : ''
	}.\nAdded from /comfyui by ${author.name}.`;
	const commit = await commitNodes(doc, list.revision, message, author);
	return commit.ok ? { ok: true, node } : { ok: false, error: commit.error };
}

/** Remove a node by name. Vendored entries are refused — they are files, not a list entry. */
export async function removeNode(
	name: string,
	author: CommitAuthor,
): Promise<{ ok: boolean; error?: string }> {
	const list = await readNodeList();
	if (list.error || !list.nodes || !list.revision || !list.doc) {
		return { ok: false, error: list.error ?? 'Could not read the node list.' };
	}
	const target = list.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
	if (!target) return { ok: false, error: `${name} is not on the list.` };
	if (target.vendored) {
		return {
			ok: false,
			error: `${target.name} is vendored in the repo, not cloned — remove it in a PR, not from here.`,
		};
	}

	const doc: NodesDoc = { ...list.doc, nodes: list.nodes.filter((n) => n !== target) };
	const message = `infra(pod): drop ${target.name} from the R&D image\n\nRemoved from /comfyui by ${author.name}.`;
	return commitNodes(doc, list.revision, message, author);
}

/**
 * Promote a node to the serverless worker, or take it back off.
 *
 * Deliberately its own action rather than a side effect of adding: the worker is the PROD
 * generation path, and the standing rule is to promote only after a pod off the R&D image
 * has rendered clean. Flipping this triggers a prod worker rebuild all by itself, because
 * that image's workflow watches this file.
 */
export async function setNodeProd(
	name: string,
	prod: boolean,
	author: CommitAuthor,
): Promise<{ ok: boolean; error?: string }> {
	const list = await readNodeList();
	if (list.error || !list.nodes || !list.revision || !list.doc) {
		return { ok: false, error: list.error ?? 'Could not read the node list.' };
	}
	const target = list.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
	if (!target) return { ok: false, error: `${name} is not on the list.` };
	if (!!target.prod === prod) return { ok: true };

	const doc: NodesDoc = {
		...list.doc,
		nodes: list.nodes.map((n) => (n === target ? withProd(n, prod) : n)),
	};
	const message = prod
		? `infra(pod): promote ${target.name} to the serverless worker

Promoted from /comfyui by ${author.name}. Rebuilds the PROD generation image.`
		: `infra(pod): drop ${target.name} from the serverless worker

Demoted from /comfyui by ${author.name}. Rebuilds the PROD generation image.`;
	return commitNodes(doc, list.revision, message, author);
}

/**
 * Set or clear `prod` while keeping the field ORDER the file already uses (name → where →
 * pin → prod → …). Rewriting an entry as a fresh object would reshuffle its keys and turn a
 * one-flag change into a diff nobody can read.
 */
function withProd(node: PodNode, prod: boolean): PodNode {
	const out: PodNode = {} as PodNode;
	let placed = false;
	for (const [key, value] of Object.entries(node)) {
		if (key === 'prod') continue;
		(out as Record<string, unknown>)[key] = value;
		if (!placed && (key === 'sha' || key === 'vendored')) {
			if (prod) (out as Record<string, unknown>).prod = true;
			placed = true;
		}
	}
	if (prod && !placed) out.prod = true;
	return out;
}
