"""Offline fixtures for runpod/push-models.py (no R2, no boto3, no pod).

Run:  py test_push_models.py   (from services/atlas-tool)

push-models.py is the ONLY script that writes UP into the shared model mirror
from a pod volume, and it rewrites the manifest the launcher serves to every
desktop. So the assertions below are mostly about what it must NOT do:

  * never publish junk — a placeholder, a half-finished `.part`, a stray `.json`
    would all land in the manifest and then get pulled onto every machine;
  * never haul a 35 GB public checkpoint through R2 by accident — the cap is the
    whole reason this script targets the small private artifact (a trained LoRA);
  * never re-upload what is already there at the same size;
  * never WIPE a desktop-seeded manifest entry. That failure is silent: the file
    stays in R2, but Sync models stops offering it and nothing errors;
  * never write anything at all unless `--apply` was passed.

The last test is a real round trip: it pushes a fake volume tree, then runs
`pull-models.py`'s own main() against the manifest that produced, and checks the
files land back at the same relative paths. That is what pins the `{key, dir,
name}` shape across the two scripts.

Everything is injected: a stub S3 client stands in for R2 (and for boto3 itself
when pull-models.py is exercised), so nothing here touches the network.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import types
from contextlib import redirect_stdout
from pathlib import Path

FAILED: list[str] = []
PASSED: list[str] = []

R2_ENVS = ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


def _load(name: str, filename: str):
	"""Both scripts are hyphenated (runpod/pull-models.py), so a plain import
	can't reach them."""
	path = Path(__file__).resolve().parent / "runpod" / filename
	spec = importlib.util.spec_from_file_location(name, path)
	mod = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(mod)
	return mod


pm = _load("push_models", "push-models.py")
pull = _load("pull_models", "pull-models.py")

MAX = int(5 * 1e9)


def check(label: str, got, want) -> None:
	ok = got == want
	print(f"{'ok  ' if ok else 'FAIL'} {label}")
	(PASSED if ok else FAILED).append(label)
	if not ok:
		print(f"       got  {got!r}\n       want {want!r}")


def check_in(label: str, needle: str, haystack: str) -> None:
	ok = needle in haystack
	print(f"{'ok  ' if ok else 'FAIL'} {label}")
	(PASSED if ok else FAILED).append(label)
	if not ok:
		print(f"       {needle!r} not found in:\n       {haystack!r}")


# --------------------------------------------------------------------------
# Doubles
# --------------------------------------------------------------------------
class FakeS3:
	"""A one-bucket R2. `objects` maps key -> size; `manifest` is the parsed
	models manifest (None = never seeded)."""

	def __init__(self, objects: dict[str, int] | None = None, manifest: dict | None = None):
		self.objects: dict[str, int] = dict(objects or {})
		self.manifest = manifest
		self.uploads: list[str] = []
		self.puts: list[str] = []
		self.downloads: list[str] = []

	def head_object(self, Bucket, Key):
		if Key not in self.objects:
			raise KeyError(f"NoSuchKey {Key}")
		return {"ContentLength": self.objects[Key]}

	def get_object(self, Bucket, Key):
		if Key == pm.MANIFEST_KEY and self.manifest is not None:
			return {"Body": io.BytesIO(json.dumps(self.manifest).encode("utf-8"))}
		raise KeyError(f"NoSuchKey {Key}")

	def put_object(self, Bucket, Key, Body, ContentType=None):
		self.puts.append(Key)
		if Key == pm.MANIFEST_KEY:
			self.manifest = json.loads(Body)

	def upload_file(self, Filename, Bucket, Key, ExtraArgs=None):
		self.uploads.append(Key)
		self.objects[Key] = os.path.getsize(Filename)

	def download_file(self, Bucket, Key, Filename):
		self.downloads.append(Key)
		Path(Filename).write_bytes(b"m" * self.objects.get(Key, 0))

	def delete_object(self, **kwargs):
		raise AssertionError("push-models must never delete from R2")


def _tree(root: Path, files: dict[str, int]) -> None:
	for rel, size in files.items():
		p = root / rel
		p.parent.mkdir(parents=True, exist_ok=True)
		p.write_bytes(b"m" * size)


def _run(fake: FakeS3, src: Path, **kw):
	"""run() with its chatter captured; returns (summary, printed output)."""
	buf = io.StringIO()
	with redirect_stdout(buf):
		summary = pm.run(fake, "invisibleassets", src=str(src), **kw)
	return summary, buf.getvalue()


def _plan(files, *, in_r2=None, prior=None, **kw):
	sizes = dict(in_r2 or {})
	return pm.plan_uploads(sorted(files.items()), prefix="comfyui-models",
	                       prior=prior or {}, in_r2=lambda k: sizes.get(k),
	                       max_bytes=kw.pop("max_bytes", MAX), **kw)


def _rels(items) -> list[str]:
	return sorted(i["rel"] for i in items)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------
def test_junk_and_extension_filter():
	plan = _plan({
		"loras/comic-style-lora-000002.safetensors": 150_000_000,
		"checkpoints/put_checkpoints_here": 0,
		"loras/put_loras_here": 12,
		"loras/.gitkeep": 3,
		"loras/.hidden.safetensors": 400,
		"checkpoints/sdxl.safetensors.part": 900_000,
		"checkpoints/half.safetensors.tmp": 900_000,
		"checkpoints/other.safetensors.download": 900_000,
		"loras/__pycache__/helper.cpython-311.pyc": 500,
		"loras/notes.json": 500,
		"loras/readme.txt": 500,
		"vae/empty.safetensors": 0,
		"vae/sdxl-vae.pt": 300_000,
		"unet/flux.gguf": 500_000,
	})
	check("only the real models survive the filter",
	      _rels(plan["upload"]),
	      ["loras/comic-style-lora-000002.safetensors", "unet/flux.gguf", "vae/sdxl-vae.pt"])
	check("everything else is counted as junk", len(plan["junk"]), 11)

	why = dict(plan["junk"])
	check("placeholder named as such", why["loras/put_loras_here"], "ComfyUI folder placeholder")
	check("dotfile named as such", why["loras/.gitkeep"], "dotfile")
	check("a hidden model file is still a dotfile",
	      why["loras/.hidden.safetensors"], "dotfile")
	check("partial download named as such",
	      why["checkpoints/sdxl.safetensors.part"], "partial/temp download")
	check("temp download named as such",
	      why["checkpoints/half.safetensors.tmp"], "partial/temp download")
	check("__pycache__ named as such",
	      why["loras/__pycache__/helper.cpython-311.pyc"], "under __pycache__/")
	check("a non-model extension is named as such", why["loras/notes.json"], "not a model file")
	check("a zero-byte model is junk", why["vae/empty.safetensors"], "empty file")


def test_size_cap_and_include_large():
	files = {
		"loras/comic-style-lora-000002.safetensors": 150_000_000,
		"checkpoints/flux2-dev.safetensors": int(35 * 1e9),
	}
	plan = _plan(files)
	check("the LoRA is planned", _rels(plan["upload"]),
	      ["loras/comic-style-lora-000002.safetensors"])
	check("the 35 GB checkpoint is skipped", len(plan["large"]), 1)
	check("and it is NAMED, not just counted",
	      plan["large"][0][0], "checkpoints/flux2-dev.safetensors")

	plan = _plan(files, include_large=True)
	check("--include-large takes it anyway", len(plan["upload"]), 2)
	check("nothing is left in the large bucket", plan["large"], [])


def test_skip_when_present_at_same_size_unless_forced():
	rel = "loras/comic-style-lora-000002.safetensors"
	key = f"comfyui-models/{rel}"
	prior = {key: {"key": key, "dir": "loras", "name": "comic-style-lora-000002.safetensors",
	               "size": 150_000_000, "sha256": "abc123"}}

	plan = _plan({rel: 150_000_000}, in_r2={key: 150_000_000}, prior=prior)
	check("same size in R2 and in the manifest -> nothing to do", plan["upload"], [])
	check("counted as already present", len(plan["present"]), 1)
	check("its sha is reused, not recomputed", plan["present"][0]["sha"], "abc123")

	plan = _plan({rel: 150_000_000}, in_r2={key: 150_000_000}, prior=prior, force=True)
	check("--force re-uploads it regardless", _rels(plan["upload"]), [rel])

	plan = _plan({rel: 150_000_001}, in_r2={key: 150_000_000}, prior=prior)
	check("a DIFFERENT size in R2 is re-uploaded", _rels(plan["upload"]), [rel])

	plan = _plan({rel: 150_000_000}, in_r2={key: 150_000_000}, prior={})
	check("in R2 but not in the manifest -> re-indexed, not re-uploaded",
	      (plan["upload"], _rels(plan["reindex"])), ([], [rel]))


def test_manifest_merge_keeps_the_desktop_seeded_entry():
	desktop = {"key": "comfyui-models/checkpoints/sdxl.safetensors", "dir": "checkpoints",
	           "name": "sdxl.safetensors", "size": 6_900_000_000, "sha256": "deadbeef"}
	prior = {"version": 1, "base_prefix": "comfyui-models", "models": [desktop]}

	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, {"loras/comic-style-lora-000002.safetensors": 4096})
		fake = FakeS3(manifest=prior)
		summary, out = _run(fake, src, apply=True)

	models = fake.manifest["models"]
	check("the manifest was written", fake.puts, [pm.MANIFEST_KEY])
	check("the LoRA was uploaded",
	      fake.uploads, ["comfyui-models/loras/comic-style-lora-000002.safetensors"])
	check("the desktop-seeded checkpoint is STILL in the manifest",
	      [m for m in models if m["key"] == desktop["key"]], [desktop])
	check("the pod's LoRA was added alongside it", len(models), 2)
	check("version is preserved", fake.manifest["version"], 1)
	check("base_prefix is preserved", fake.manifest["base_prefix"], "comfyui-models")
	check("the new entry has the seeder's shape",
	      sorted(models[1].keys()), ["dir", "key", "name", "sha256", "size"])
	check("its sha256 was really computed", len(models[1]["sha256"]), 64)
	check_in("the summary points at Sync models", "Sync models", out)

	# Re-running must not disturb anything: same size in R2, entry now present.
	fake.puts.clear()
	fake.uploads.clear()
	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, {"loras/comic-style-lora-000002.safetensors": 4096})
		summary, _ = _run(fake, src, apply=True)
	check("a second --apply uploads nothing", fake.uploads, [])
	check("and does not rewrite the manifest", fake.puts, [])
	check("it reports the file as already present", summary["present"], 1)


def test_updating_an_entry_replaces_only_that_one():
	old = {"key": "comfyui-models/loras/style.safetensors", "dir": "loras",
	       "name": "style.safetensors", "size": 10, "sha256": "old"}
	other = {"key": "comfyui-models/vae/sdxl-vae.pt", "dir": "vae",
	         "name": "sdxl-vae.pt", "size": 99, "sha256": "keepme"}
	merged = pm.merge_manifest({"version": 1, "base_prefix": "comfyui-models",
	                            "models": [old, other]},
	                           [{**old, "size": 20, "sha256": "new"}], "comfyui-models")
	check("the changed entry is updated in place",
	      [m["sha256"] for m in merged["models"]], ["new", "keepme"])
	check("no entry is duplicated", len(merged["models"]), 2)

	fresh = pm.merge_manifest({}, [other], "comfyui-models")
	check("an absent manifest starts at version 1", fresh["version"], 1)
	check("and takes the prefix as base_prefix", fresh["base_prefix"], "comfyui-models")


def test_dry_run_writes_nothing():
	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, {"loras/comic-style-lora-000002.safetensors": 4096,
		            "checkpoints/sdxl.safetensors": 8192})
		fake = FakeS3(manifest={"version": 1, "base_prefix": "comfyui-models", "models": []})
		summary, out = _run(fake, src)

	check("no uploads", fake.uploads, [])
	check("no manifest write", fake.puts, [])
	check("the summary reports the manifest untouched", summary["wrote_manifest"], False)
	check("but it still counted the work", summary["uploaded"], 2)
	check_in("it says DRY RUN up front", "DRY RUN", out)
	check_in("and tells you how to perform it", "--apply", out)


def test_dir_scoping():
	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, {"loras/a.safetensors": 16, "checkpoints/b.safetensors": 16})
		fake = FakeS3()
		summary, _ = _run(fake, src, dirs=["loras"], apply=True)
	check("--dir loras uploads only the LoRA",
	      fake.uploads, ["comfyui-models/loras/a.safetensors"])
	check("the checkpoint isn't even counted", summary["uploaded"], 1)


def test_prefix_must_match_the_manifest_base_prefix():
	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, {"loras/a.safetensors": 16})
		fake = FakeS3(manifest={"version": 1, "base_prefix": "comfyui-models", "models": []})
		try:
			with redirect_stdout(io.StringIO()):
				pm.run(fake, "invisibleassets", src=str(src), prefix="elsewhere", apply=True)
			check("a mismatched --prefix is refused", "no error", "SystemExit")
		except SystemExit as e:
			check_in("a mismatched --prefix is refused", "base_prefix", str(e))
	check("and it refused BEFORE writing anything", (fake.uploads, fake.puts), ([], []))


def test_round_trip_to_pull_models():
	"""push -> manifest -> pull-models.py restores the same tree."""
	files = {
		"loras/comic-style-lora-000002.safetensors": 4096,
		"checkpoints/sdxl/base.safetensors": 2048,
		"root-level.safetensors": 512,
	}
	fake = FakeS3()
	with tempfile.TemporaryDirectory() as tmp:
		src = Path(tmp)
		_tree(src, files)
		_run(fake, src, apply=True)

	entry = next(m for m in fake.manifest["models"] if m["name"].startswith("comic"))
	check("dir is the POSIX relative parent", entry["dir"], "loras")
	check("name is the filename", entry["name"], "comic-style-lora-000002.safetensors")
	check("key is prefix + relpath",
	      entry["key"], "comfyui-models/loras/comic-style-lora-000002.safetensors")
	check("a nested dir keeps both segments",
	      next(m for m in fake.manifest["models"] if m["name"] == "base.safetensors")["dir"],
	      "checkpoints/sdxl")
	check("a root-level file gets an empty dir",
	      next(m for m in fake.manifest["models"] if m["name"] == "root-level.safetensors")["dir"],
	      "")

	with tempfile.TemporaryDirectory() as tmp:
		dest = Path(tmp)
		_run_pull(fake, dest)
		landed = {p.relative_to(dest).as_posix(): p.stat().st_size
		          for p in dest.rglob("*") if p.is_file()}
	check("pull-models.py rebuilds the identical tree", sorted(landed), sorted(files))
	check("every file came back at its original size", landed, files)


def _run_pull(fake: FakeS3, dest: Path) -> None:
	"""Run pull-models.py's real main() against the stub client."""
	stub = types.ModuleType("boto3")
	stub.client = lambda *a, **k: fake
	saved_mod = sys.modules.get("boto3")
	saved_argv = sys.argv
	saved_env = {k: os.environ.get(k) for k in R2_ENVS}
	try:
		sys.modules["boto3"] = stub
		for k in R2_ENVS:
			os.environ[k] = "test"
		sys.argv = ["pull-models.py", "--dest", str(dest)]
		with redirect_stdout(io.StringIO()):
			pull.main()
	finally:
		sys.argv = saved_argv
		if saved_mod is None:
			sys.modules.pop("boto3", None)
		else:
			sys.modules["boto3"] = saved_mod
		for k, v in saved_env.items():
			if v is None:
				os.environ.pop(k, None)
			else:
				os.environ[k] = v


if __name__ == "__main__":
	for fn in (test_junk_and_extension_filter,
	           test_size_cap_and_include_large,
	           test_skip_when_present_at_same_size_unless_forced,
	           test_manifest_merge_keeps_the_desktop_seeded_entry,
	           test_updating_an_entry_replaces_only_that_one,
	           test_dry_run_writes_nothing,
	           test_dir_scoping,
	           test_prefix_must_match_the_manifest_base_prefix,
	           test_round_trip_to_pull_models):
		print(f"\n-- {fn.__name__}")
		fn()
	print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
	sys.exit(1 if FAILED else 0)
