"""Make a LOCAL ComfyUI install carry the same custom nodes as the R&D pod image, pinned
to the same commit SHAs.

WHY THIS EXISTS
`../nodes.json` is the authoritative list of what the pod image carries (and, filtered by
`prod: true`, what the serverless worker carries), each entry pinned to a 12-char commit
SHA. But ComfyUI also runs LOCALLY on the artist's Windows box, driven from the Atlas Maker
over the Cloudflare tunnel (gear menu -> "Run generation on: my computer"). That install
drifted: a blueprint authored against the pod (`characterdesignertest3`) came back
`missing_node_type: PulidModelLoader`, because the local box has no `PuLID_ComfyUI` at all.
Verified on the artist's machine (2026-09-07): `/object_info/PulidModelLoader` answers `{}`,
and `C:\\Invisible Wall SL\\ComfyUI\\Shared\\Custom_Nodes` holds 14 hand-installed packs,
none of them PuLID. A blueprint that runs on the pod must run on the laptop; today "which
backend am I on" silently changes which nodes exist.

The fix is NOT to install each missing pack through ComfyUI-Manager as its error shows up.
Manager installs at TIP. Tip is exactly the drift the SHA pinning of 2026-08-19 exists to
prevent (see docs/design/comfyui-node-manager.md, design decision 3: "a node pinned to a
branch is how silent drift comes back"), and the same doc's Phase 5 records that the
"install it for me" button was deliberately NOT shipped. The fix is one command that makes
local == image, pinned identically, from the file that already answers "what is on the
image".

WHAT IT WILL NOT DO
Destroy work. A local pack that is not a git checkout of ours, or has uncommitted changes,
or sits on a different remote, is REPORTED and left alone -- never `reset --hard`, never
deleted. And it never clones a second copy of a pack the box already has under a
registry-style name (`comfyui_ipadapter_plus` vs our `ComfyUI_IPAdapter_plus`): two copies
of one pack registering the same node classes is a worse failure than the missing one, and
it is silent.

Usage (from anywhere -- paths are resolved off this file's location):

    py services/atlas-comfy-pod/tools/sync-local-nodes.py --dry-run \\
        --comfy-root "C:\\Invisible Wall SL\\ComfyUI"

    py services/atlas-comfy-pod/tools/sync-local-nodes.py \\
        --custom-nodes "C:\\Invisible Wall SL\\ComfyUI\\Shared\\Custom_Nodes" \\
        --python "C:\\Invisible Wall SL\\ComfyUI\\ComfyUI_windows_portable\\python_embeded\\python.exe"

Stdlib only, Python 3.9+, and every subprocess call passes an argument LIST (never
`shell=True`) so paths with spaces survive on Windows. Runs under the portable embedded
python and under a system python alike.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

POD_DIR = Path(__file__).resolve().parent.parent
NODES_JSON = POD_DIR / "nodes.json"
CONSTRAINTS = POD_DIR / "constraints.txt"
VENDORED_SRC = POD_DIR / "custom_nodes"

# Dropped from the generated constraints file. See build_constraints().
TORCH_PINS = {"torch", "torchvision", "torchaudio"}

# Folders never descended into when hunting for `custom_nodes` under --comfy-root. `models`
# and `python_embeded` are the ones that matter: walking either costs minutes.
NOISY_DIRS = {
	"models", "output", "input", "temp", "user", "web", "comfy", "comfy_extras",
	"python_embeded", "python_embedded", "venv", ".venv", "site-packages",
	"node_modules", "__pycache__", ".git", "dlls", "lib", "libs",
}

# Untracked paths that must NOT make a checkout read as "dirty". A pack we cloned ourselves
# grows `__pycache__` the first time ComfyUI imports it, and plenty of node repos forget to
# .gitignore it -- treating that as local work would make the tool refuse to update its own
# clones a day after making them. Tracked modifications always count.
JUNK_UNTRACKED = ("__pycache__", ".pyc", ".pyo", ".ds_store", "thumbs.db")


def out(line: str = "") -> None:
	"""print() that survives a legacy Windows console.

	Notes in nodes.json contain em dashes; a cp437/cp1252 stdout would raise on one and
	abort a run that had already cloned half the list.
	"""
	try:
		print(line, flush=True)
	except UnicodeEncodeError:
		enc = sys.stdout.encoding or "ascii"
		print(line.encode(enc, "replace").decode(enc, "replace"), flush=True)


# nodes.json notes are prose and carry em dashes / curly quotes. `out()` keeps those from
# raising, but a cp437 console still renders them as noise, so fold them to ASCII on the way
# out -- the note is the justification for a pin and it has to be readable where it is read.
ASCII_FOLD = {"—": "--", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "..."}


def note_block(text: str) -> None:
	if not text:
		return
	for bad, good in ASCII_FOLD.items():
		text = text.replace(bad, good)
	for chunk in textwrap.wrap(text, width=92):
		out("     " + chunk)


def die(msg: str) -> None:
	out("!! " + msg)
	sys.exit(2)


# --- name matching ------------------------------------------------------------------
def norm_pack(name: str) -> str:
	"""Fold a pack folder name to what it actually IS, ignoring how it was installed.

	The registry/Manager installs on the artist's box name the same packs differently from
	nodes.json: `comfyui_ipadapter_plus` vs `ComfyUI_IPAdapter_plus`, `comfyui-rmbg` vs
	`ComfyUI-RMBG`. On Windows the first pair even resolves to the same directory, so a
	naive `exists()` check is right there by accident and wrong on Linux. Fold case,
	unify the separators, drop a leading `comfyui`, and the two spellings meet.
	"""
	s = name.strip().lower().replace("-", "_").replace(".", "_")
	s = re.sub(r"[^a-z0-9_]+", "_", s)
	if s.startswith("comfyui"):
		s = s[len("comfyui"):]
	return s.strip("_")


def norm_url(url: str) -> str:
	u = url.strip().lower()
	u = re.sub(r"^git\+", "", u)
	u = re.sub(r"^git@([^:]+):", r"https://\1/", u)
	u = re.sub(r"^ssh://git@", "https://", u)
	u = re.sub(r"^http://", "https://", u)
	u = u.rstrip("/")
	if u.endswith(".git"):
		u = u[:-4]
	return u


# --- locating the target folder -------------------------------------------------------
def child_dirs(path: Path) -> list:
	try:
		return [p for p in path.iterdir() if p.is_dir()]
	except OSError:
		return []


def find_custom_nodes(root: Path, max_depth: int = 3) -> list:
	"""Bounded, case-insensitive hunt for a `custom_nodes` folder under a ComfyUI base dir.

	Not a plain `root / "custom_nodes"`: the artist launches with `--base-directory`, so
	their real folder is `<root>\\Shared\\Custom_Nodes` -- capital C, underscore, one level
	deeper than a stock install. A portable install keeps a second (usually empty) one at
	`<root>\\ComfyUI_windows_portable\\ComfyUI\\custom_nodes`, which is why the ranking
	prefers the POPULATED candidate and the choice is always printed.
	"""
	found = []

	def walk(d: Path, depth: int) -> None:
		for p in child_dirs(d):
			if p.name.lower().replace("-", " ").replace("_", " ") == "custom nodes":
				found.append((depth, p))
				continue
			if depth < max_depth and p.name.lower() not in NOISY_DIRS and not p.name.startswith("."):
				walk(p, depth + 1)

	walk(root, 1)
	found.sort(key=lambda item: (-len(child_dirs(item[1])), item[0], len(str(item[1]))))
	return [p for _, p in found]


# --- git helpers ----------------------------------------------------------------------
def git(args: list, cwd: "Path | None" = None) -> subprocess.CompletedProcess:
	return subprocess.run(
		["git"] + args,
		cwd=str(cwd) if cwd else None,
		stdout=subprocess.PIPE,
		stderr=subprocess.STDOUT,
		text=True,
		errors="replace",
	)


def git_out(args: list, cwd: "Path | None" = None) -> "str | None":
	res = git(args, cwd)
	return res.stdout.strip() if res.returncode == 0 else None


def is_repo(path: Path) -> bool:
	return (path / ".git").exists() and git_out(["rev-parse", "--git-dir"], path) is not None


def real_dirty(path: Path) -> list:
	"""`git status --porcelain`, minus untracked build junk. Empty list == safe to move.

	Deliberately NOT via git_out(): that strips the whole output, and porcelain's first
	column IS a space for an unstaged change (` M pulid.py`), so stripping shifts every
	field left by one. Deliberately not via `not raw` either -- a git that FAILS must read
	as dirty, never as clean, because clean is the answer that lets us check out over it.
	"""
	res = git(["status", "--porcelain"], path)
	if res.returncode != 0:
		return ["?? git status failed: " + res.stdout.strip()[:120]]
	dirty = []
	for line in res.stdout.splitlines():
		if len(line) < 4:
			continue
		state, rel = line[:2], line[3:].strip().strip('"')
		low = rel.lower()
		if state == "??" and any(j in low for j in JUNK_UNTRACKED):
			continue
		dirty.append(state + " " + rel)
	return dirty


# --- constraints ----------------------------------------------------------------------
def build_constraints(dest_dir: Path) -> "Path | None":
	"""Derive a LOCAL pip constraints file from the pod's constraints.txt.

	Torch is REMOVED, the floors are KEPT, and the split is the whole point:

	  * `torch==2.11.0` + torchvision/torchaudio in the pod file are the Blackwell (sm_120)
	    cu128 build the RTX PRO pods must have. The artist's box is a laptop RTX 4070
	    already running 2.11.0+cu130. Handing pip the pod's pin as a constraint invites it
	    to re-resolve a 3 GB wheel and can leave a working local CUDA install broken -- a
	    far bigger outage than the missing node this script came to fix.
	  * `numpy>=2`, `ml_dtypes>=0.5.4`, `onnx>=1.22` are universally right, and they are
	    the reason this function exists at all rather than just skipping constraints.
	    `ComfyUI-PuLID-Flux2` pins `ml_dtypes==0.3.2` -- a numpy-1.x-ABI C extension that
	    resolves clean, ships, and leaves the whole face stack un-importable (2026-08-20).
	    A node's stale pin must fail ITS OWN install, not quietly rewrite a shared package.
	"""
	if not CONSTRAINTS.exists():
		return None
	kept, dropped = [], []
	for line in CONSTRAINTS.read_text(encoding="utf-8").splitlines():
		stripped = line.strip()
		if not stripped or stripped.startswith("#"):
			continue
		pkg = re.split(r"[=<>!~;\[ ]", stripped, maxsplit=1)[0].strip().lower().replace("_", "-")
		if pkg in TORCH_PINS:
			dropped.append(stripped)
		else:
			kept.append(stripped)
	dest = dest_dir / "constraints-local.txt"
	header = [
		"# GENERATED by services/atlas-comfy-pod/tools/sync-local-nodes.py -- do not edit.",
		"# Derived from services/atlas-comfy-pod/constraints.txt with the torch pins removed:",
		"# those are the pods' Blackwell (sm_120) cu128 build, and re-resolving torch on a",
		"# working local install is a bigger failure than any node dependency.",
		"# Dropped: " + (", ".join(dropped) if dropped else "(none)"),
		"# Kept below: the floors that stop a node's stale pin rewriting a shared package.",
		"",
	]
	dest.write_text("\n".join(header + kept) + "\n", encoding="utf-8")
	return dest


# --- python / pip ---------------------------------------------------------------------
def probe_python(py: Path) -> "tuple[str, bool]":
	"""Return (version, has_pip). Raises SystemExit on an interpreter that will not run."""
	res = subprocess.run(
		[str(py), "-c", "import sys;print(sys.version.split()[0])"],
		stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
	)
	if res.returncode != 0:
		die("--python did not run: %s\n   %s" % (py, res.stdout.strip()))
	version = res.stdout.strip().splitlines()[-1]
	pip = subprocess.run(
		[str(py), "-m", "pip", "--version"],
		stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
	)
	return version, pip.returncode == 0


def pip_install(py: Path, req: Path, constraints: "Path | None") -> bool:
	env = os.environ.copy()
	env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
	if constraints:
		env["PIP_CONSTRAINT"] = str(constraints)
	else:
		env.pop("PIP_CONSTRAINT", None)
	res = subprocess.run([str(py), "-m", "pip", "install", "-r", str(req)], env=env)
	return res.returncode == 0


# --- the sync -------------------------------------------------------------------------
class Result:
	def __init__(self, name: str, verb: str, folder: "Path | None" = None, manage: bool = False):
		self.name = name
		self.verb = verb
		self.folder = folder
		self.manage = manage  # may we install this one's requirements?


def sync_entry(entry: dict, target: Path, index: dict, dry_run: bool) -> Result:
	name = entry["name"]
	key = norm_pack(name)
	existing = index.get(key)

	# --- already there under ANY spelling -------------------------------------------
	if existing is not None and existing.name != name:
		twins = sorted(
			d.name for k, d in index.items()
			if k != key and (k.startswith(key + "_") or key.startswith(k + "_"))
		)
		verb = "already present as %s (not pinned by us)" % existing.name
		if twins:
			verb += " -- near-duplicates on disk: " + ", ".join(twins)
		return Result(name, verb, existing)

	# --- vendored: copied from this repo, never cloned --------------------------------
	if entry.get("vendored"):
		src = VENDORED_SRC / name
		dest = target / name
		if existing is not None:
			return Result(name, "already present as %s (vendored -- NOT overwritten)" % existing.name, existing)
		if not src.is_dir():
			return Result(name, "error: vendored source missing at %s" % src)
		if dry_run:
			return Result(name, "would copy (vendored) from %s" % src, dest, manage=True)
		try:
			shutil.copytree(
				src, dest,
				ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo", ".git"),
			)
		except OSError as exc:
			return Result(name, "error: copy failed -- %s" % exc)
		return Result(name, "copied (vendored) from %s" % src, dest, manage=True)

	url, sha = entry.get("url"), entry.get("sha")
	if not url or not sha:
		return Result(name, "error: entry has neither `vendored` nor `url` + `sha`")

	dest = target / name

	# --- fresh clone ------------------------------------------------------------------
	if existing is None:
		if dry_run:
			return Result(name, "would clone %s @ %s" % (url, sha), dest, manage=True)
		res = git(["clone", "--quiet", url, name], cwd=target)
		if res.returncode != 0:
			return Result(name, "error: clone failed -- %s" % res.stdout.strip()[:400])
		res = git(["checkout", "--quiet", sha], cwd=dest)
		if res.returncode != 0:
			return Result(
				name,
				"error: cloned but checkout %s failed -- %s" % (sha, res.stdout.strip()[:400]),
				dest,
			)
		return Result(name, "cloned %s @ %s" % (url, sha), dest, manage=True)

	# --- present under our exact name: pin it, but never at the cost of local work -----
	if not is_repo(existing):
		return Result(name, "skipped (dirty / not ours: no git repo in %s)" % existing.name, existing)

	head = git_out(["rev-parse", "HEAD"], existing) or ""
	if head.startswith(sha):
		suffix = " (with local edits)" if real_dirty(existing) else ""
		return Result(name, "already at %s%s" % (sha, suffix), existing, manage=True)

	remote = git_out(["remote", "get-url", "origin"], existing)
	if remote is None or norm_url(remote) != norm_url(url):
		return Result(name, "skipped (dirty / not ours: origin is %s)" % (remote or "unset"), existing)

	dirty = real_dirty(existing)
	if dirty:
		return Result(
			name,
			"skipped (dirty: %d change%s, e.g. %s)" % (len(dirty), "" if len(dirty) == 1 else "s", dirty[0]),
			existing,
		)

	if dry_run:
		return Result(name, "would update %s -> %s" % (head[:12], sha), existing, manage=True)
	res = git(["fetch", "--quiet", "origin"], existing)
	if res.returncode != 0:
		out("     fetch warning: " + res.stdout.strip()[:200])
	res = git(["checkout", "--quiet", sha], existing)
	if res.returncode != 0:
		return Result(name, "error: checkout %s failed -- %s" % (sha, res.stdout.strip()[:400]), existing)
	return Result(name, "updated %s -> %s" % (head[:12], sha), existing, manage=True)


def main() -> int:
	ap = argparse.ArgumentParser(
		prog="sync-local-nodes.py",
		description=(
			"Make a local ComfyUI custom_nodes folder match services/atlas-comfy-pod/nodes.json "
			"at the same pinned commit SHAs. Never destroys local work."
		),
		formatter_class=argparse.RawDescriptionHelpFormatter,
		epilog=(
			"examples:\n"
			"  --dry-run --comfy-root \"C:\\Invisible Wall SL\\ComfyUI\"\n"
			"  --custom-nodes \"C:\\Invisible Wall SL\\ComfyUI\\Shared\\Custom_Nodes\" \\\n"
			"      --python \"C:\\Invisible Wall SL\\ComfyUI\\ComfyUI_windows_portable\\python_embeded\\python.exe\"\n"
		),
	)
	ap.add_argument("--comfy-root", help="a ComfyUI base dir; its custom_nodes is found under it")
	ap.add_argument("--custom-nodes", help="the target folder itself (wins over --comfy-root)")
	ap.add_argument("--python", help="interpreter to install node requirements INTO (omit to skip deps)")
	ap.add_argument("--only", action="append", default=[], metavar="NAME", help="sync just this entry (repeatable)")
	ap.add_argument("--prod-only", action="store_true", help="only entries flagged prod: true")
	ap.add_argument("--dry-run", action="store_true", help="print the plan, touch nothing")
	ap.add_argument("--no-deps", action="store_true", help="clone/checkout only, install nothing")
	args = ap.parse_args()

	if not NODES_JSON.is_file():
		die("no nodes.json at %s -- run this script from its place in the repo checkout." % NODES_JSON)
	try:
		data = json.loads(NODES_JSON.read_text(encoding="utf-8"))
	except (OSError, ValueError) as exc:
		die("could not read %s -- %s" % (NODES_JSON, exc))
	nodes = data.get("nodes") or []
	skip_requirements = {norm_pack(n) for n in data.get("skipRequirements", [])}

	# --- target folder ----------------------------------------------------------------
	alternatives = []
	if args.custom_nodes:
		target = Path(args.custom_nodes).expanduser()
		if not target.is_dir():
			die("--custom-nodes is not a folder: %s" % target)
	elif args.comfy_root:
		root = Path(args.comfy_root).expanduser()
		if not root.is_dir():
			die("--comfy-root is not a folder: %s" % root)
		candidates = find_custom_nodes(root)
		if not candidates:
			die(
				"no custom_nodes folder found under %s (looked 3 levels deep).\n"
				"   Pass it directly with --custom-nodes." % root
			)
		target = candidates[0]
		alternatives = candidates[1:]
	else:
		die("give me --comfy-root or --custom-nodes. Nothing to sync without a target folder.")
	target = target.resolve()

	# --- selection --------------------------------------------------------------------
	selected = list(nodes)
	if args.prod_only:
		selected = [n for n in selected if n.get("prod")]
	if args.only:
		wanted = {norm_pack(n) for n in args.only}
		selected = [n for n in selected if norm_pack(n["name"]) in wanted]
		unknown = wanted - {norm_pack(n["name"]) for n in nodes}
		if unknown:
			die("--only names nothing in nodes.json: %s" % ", ".join(sorted(unknown)))
	if not selected:
		die("no entries selected -- --prod-only / --only filtered everything out.")

	needs_git = any(not n.get("vendored") for n in selected)
	if needs_git and shutil.which("git") is None:
		die("git is not on PATH, and %d selected entries are git clones." % sum(1 for n in selected if not n.get("vendored")))

	# --- python ----------------------------------------------------------------------
	py, py_desc, deps_on = None, "", False
	if args.python:
		py = Path(args.python).expanduser()
		if not py.is_file():
			die("--python is not a file: %s" % py)
		version, has_pip = probe_python(py)
		py_desc = "%s (Python %s)" % (py, version)
		if not has_pip:
			py_desc += "  -- NO pip in this interpreter, dependency installs SKIPPED"
		deps_on = has_pip and not args.no_deps
	else:
		py_desc = "(none given -- dependency installs SKIPPED)"

	out("== sync-local-nodes: local ComfyUI  <-  services/atlas-comfy-pod/nodes.json")
	out("   nodes.json   : %s" % NODES_JSON)
	out("   custom_nodes : %s" % target)
	for other in alternatives:
		out("                  (also found %s -- override with --custom-nodes)" % other)
	out("   python       : %s" % py_desc)
	out("   mode         : %s%s%s" % (
		"DRY RUN (nothing will be touched)" if args.dry_run else "apply",
		"  |  deps: off" if (args.no_deps or not deps_on) else "  |  deps: on",
		"  |  prod-only" if args.prod_only else "",
	))
	out()

	index = {}
	for d in child_dirs(target):
		index.setdefault(norm_pack(d.name), d)

	results = []
	for entry in selected:
		res = sync_entry(entry, target, index, args.dry_run)
		results.append(res)
		out("-- %-28s %s" % (entry["name"], res.verb))
		# The justification is supposed to travel with the pin, so print it whenever the
		# reader has something to decide. Suppressed only for the boring steady state.
		if not res.verb.startswith("already at"):
			note_block(entry.get("note", ""))
		if res.folder is not None and not args.dry_run:
			index.setdefault(norm_pack(res.folder.name), res.folder)

	# --- dependencies -----------------------------------------------------------------
	dep_failures = []
	dep_skipped_deliberately = []
	if deps_on and not args.dry_run:
		tmpdir = Path(tempfile.mkdtemp(prefix="sync-local-nodes-"))
		constraints = build_constraints(tmpdir)
		out()
		out("== dependencies")
		out("   PIP_CONSTRAINT: %s" % (constraints or "(constraints.txt missing -- running UNCONSTRAINED)"))
		for entry, res in zip(selected, results):
			if not res.manage or res.folder is None:
				continue
			req = res.folder / "requirements.txt"
			if not req.is_file():
				continue
			if norm_pack(entry["name"]) in skip_requirements:
				# Deliberate, so an EXPECTED failure never trains anyone to scroll past `!!`.
				dep_skipped_deliberately.append(entry["name"])
				out("-- skip deps: %s (nodes.json skipRequirements)" % entry["name"])
				continue
			out("-- deps: %s" % req)
			if not pip_install(py, req, constraints):
				dep_failures.append(entry["name"])
	elif args.dry_run and deps_on:
		out()
		out("== dependencies (dry run)")
		out("   PIP_CONSTRAINT would be generated from constraints.txt with the torch pins")
		out("   dropped and the numpy / ml_dtypes / onnx floors kept (see build_constraints).")
		for entry, res in zip(selected, results):
			if res.manage and res.folder is not None:
				marker = " [skipRequirements]" if norm_pack(entry["name"]) in skip_requirements else ""
				out("   would pip install -r %s/requirements.txt if present%s" % (res.folder.name, marker))

	# --- summary ----------------------------------------------------------------------
	def count(prefix) -> int:
		return sum(1 for r in results if r.verb.startswith(prefix))

	acted = count("cloned") + count("updated") + count("copied")
	out()
	out("== summary")
	out("   cloned %d | updated %d | already pinned %d | vendored copies %d" % (
		count("cloned"), count("updated"), count("already at"), count("copied")))
	out("   present but not ours %d | skipped %d | errors %d | of %d selected" % (
		count("already present as"), count("skipped"), count("error"), len(results)))

	errors = [r for r in results if r.verb.startswith("error")]
	if errors:
		out()
		out("!! entries that FAILED:")
		for r in errors:
			out("!!   %-28s %s" % (r.name, r.verb))
	if dep_failures:
		out()
		out("!! requirements FAILED: " + ", ".join(dep_failures))
		out("!! Usually a pin that contradicts the generated constraints (the numpy / ml_dtypes /")
		out("!! onnx floors). Your shared dep base is intact -- that is what the constraint is")
		out("!! for -- but those packs may be short a dependency and can fail at IMPORT.")
	if dep_skipped_deliberately:
		out("   deps deliberately not installed: " + ", ".join(dep_skipped_deliberately))
	if not args.python:
		out()
		out("!! NO --python was given, so NOTHING was installed. A freshly cloned pack whose")
		out("!! requirements are missing fails at import and never registers its nodes.")
		out("!! Re-run with the interpreter that RUNS your ComfyUI, e.g.")
		out("!!   --python \"<ComfyUI>\\ComfyUI_windows_portable\\python_embeded\\python.exe\"")
		out("!! Installing into the wrong interpreter is worse than not installing at all.")

	if not args.dry_run and acted:
		out()
		out(">> RESTART ComfyUI. Custom nodes are imported once at startup, so a pack cloned")
		out(">> just now does not exist to a running server -- /object_info will keep saying")
		out(">> the node type is missing until you restart.")
	out()
	out(">> MODELS are a separate problem this script does not touch. It installs no weights:")
	out(">> PuLID needs its SDXL ip-adapter (models/pulid) and the InsightFace antelopev2 set")
	out(">> (models/insightface/models) before PulidModelLoader can load anything, and those")
	out(">> come from upstream by hand. tools/fetch-models.py covers the RunPod volume ONLY.")
	return 0


if __name__ == "__main__":
	sys.exit(main())
