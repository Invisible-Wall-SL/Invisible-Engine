"""Offline fixtures for the Settings-panel model dropdowns (no ComfyUI, no R2).

Run:  py test_comfy_catalog.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

What these guard is a failure that was SILENT for months. `_control_html` has
always been able to render a model field as a `<select>` — it just asked
`batch_atlas._available()`, which returns `None` the instant `_comfy_alive()`
fails. The hosted tool runs `COMFY_TRANSPORT=serverless` (a RunPod job queue, no
long-lived HTTP server) with a blank `comfy_host`, so `COMFY_BASE` never answers
and all 16 model fields degraded to free-text boxes with no explanation.

So the assertions below are about the three-tier precedence that replaced it —
live `/object_info` > the persisted catalog > a static enum seed — and, above
all, about the guarantee that must survive all three: a value the user already
has configured is NEVER dropped or silently rewritten, whichever tier answered.

Everything is injected: the storage module, the `batch_atlas` module (its two
probes + COMFY_BASE/CF_HEADERS) and the HTTP getter are all replaced with
doubles, so nothing here touches the network or R2.
"""
from __future__ import annotations

import json
import sys

import comfy_catalog as cc
import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []


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


def check_not_in(label: str, needle: str, haystack: str) -> None:
    ok = needle not in haystack
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        print(f"       {needle!r} unexpectedly found in:\n       {haystack!r}")


# --------------------------------------------------------------------------
# Doubles
# --------------------------------------------------------------------------
class FakeStorage:
    """A one-key R2. `raw` lets a test plant bytes that aren't valid JSON;
    `read_raises` / `write_raises` stand for an R2 that is simply down."""

    def __init__(self, doc: dict | None = None, *, key: str | None = None,
                 raw: bytes | None = None,
                 read_raises: bool = False, write_raises: bool = False):
        self.objects: dict[str, bytes] = {}
        k = key or cc.CATALOG_KEY
        if raw is not None:
            self.objects[k] = raw
        elif doc is not None:
            self.objects[k] = json.dumps(doc).encode()
        self.read_raises = read_raises
        self.write_raises = write_raises
        self.puts: list[str] = []

    def get(self, key: str) -> bytes | None:
        if self.read_raises:
            raise RuntimeError("R2 unreachable")
        return self.objects.get(key)

    def put(self, key: str, body: bytes, content_type: str | None = None) -> None:
        if self.write_raises:
            raise RuntimeError("R2 unreachable")
        self.puts.append(key)
        self.objects[key] = body

    def doc(self, key: str | None = None) -> dict:
        raw = self.objects.get(key or cc.CATALOG_KEY)
        return json.loads(raw.decode()) if raw else {}


class FakeBatch:
    """Stands in for the `batch_atlas` module inside comfy_catalog: the two
    ComfyUI probes plus the endpoint constants `refresh()` reads."""

    COMFY_BASE = "http://comfy.test"
    CF_HEADERS = {"User-Agent": "InvisibleAtlas/1.0"}

    def __init__(self, *, alive: bool = False,
                 lists: dict[tuple[str, str], list[str]] | None = None):
        self.alive = alive
        self.lists = lists or {}
        self.available_calls: list[tuple[str, str]] = []

    def _comfy_alive(self) -> bool:
        return self.alive

    def _available(self, node: str, field: str) -> list[str] | None:
        self.available_calls.append((node, field))
        return self.lists.get((node, field)) if self.alive else None


def install(storage: FakeStorage, batch: FakeBatch) -> None:
    """Point the module under test at the doubles and clear every in-process
    cache, so each case starts from a known world."""
    cc.storage = storage           # type: ignore[assignment]
    cc.batch_atlas = batch         # type: ignore[assignment]
    for slot in cc._cache.values():
        slot["doc"] = None
        slot["t"] = 0.0
    cc._pending.clear()
    cc._last_write = 0.0


_REAL_STORAGE = cc.storage
_REAL_BATCH = cc.batch_atlas

# The checkpoint dropdown is the canonical case: ui_server maps it to
# (CheckpointLoaderSimple, ckpt_name) and it has NO static seed, so it is
# live-or-catalog-or-nothing.
CKPT = ("CheckpointLoaderSimple", "ckpt_name")
CKPT_KEY = cc.field_key(*CKPT)


# --------------------------------------------------------------------------
# 1. Precedence: live > catalog > static seed
# --------------------------------------------------------------------------
def test_live_wins_over_catalog_and_seed() -> None:
    # A live ComfyUI that offers a sampler the static seed has never heard of.
    live = ["euler", "dpmpp_2m", "brand_new_sampler"]
    st = FakeStorage({"fetchedAt": 1.0, "source": "old",
                      "fields": {"KSampler|sampler_name": ["stale_only"]}})
    install(st, FakeBatch(alive=True, lists={("KSampler", "sampler_name"): live}))
    check("live list wins for flux_sampler",
          u._options_for("flux_sampler", {}), (live, "(not in ComfyUI)"))
    check("live checkpoint list wins",
          cc.options(*CKPT, available=lambda n, f: ["a.safetensors"]),
          ["a.safetensors"])
    check("live read is not an R2 write", st.puts, [])


def test_catalog_used_when_live_returns_none() -> None:
    stored = ["cat_a.safetensors", "cat_b.safetensors"]
    st = FakeStorage({"fetchedAt": 100.0, "source": "http://comfy.test",
                      "fields": {CKPT_KEY: stored}})
    install(st, FakeBatch(alive=False))
    check("dead ComfyUI falls back to the catalog",
          u._options_for("checkpoint", {}), (stored, "(not in ComfyUI)"))
    check("catalog read wrote nothing", st.puts, [])
    # And the field really renders as a <select>, not the old text input.
    html_out = u._control_html("checkpoint", "text", "cat_a.safetensors", {})
    check_in("checkpoint renders a <select> from the catalog",
             '<select data-cfg="checkpoint"', html_out)
    check_in("catalog value is selected",
             '<option value="cat_a.safetensors" selected>', html_out)


def test_static_seed_when_live_and_catalog_are_empty() -> None:
    install(FakeStorage(), FakeBatch(alive=False))
    vals, marker = u._options_for("flux_sampler", {})
    check("seed used when nothing answers", vals, u.ENUM_FIELDS["flux_sampler"])
    check("an unlisted value on a seed reads '(custom)', not '(not in ComfyUI)'",
          marker, "(custom)")
    # The seed-only fields have no (node, field) at all — pure offline enums.
    for key in ("gpt_image_model", "gpt_image_size", "gpt_image_quality",
                "gpt_image_background", "gpt_image_rembg", "atlas_format"):
        out = u._control_html(key, "text", u.ENUM_FIELDS[key][0], {})
        check_in(f"{key} renders a <select>", f'<select data-cfg="{key}"', out)
    check("a field with neither list nor seed stays free-text",
          u._options_for("comfy_host", {}), (None, ""))
    check_in("and really renders an <input>", '<input data-cfg="comfy_host"',
             u._control_html("comfy_host", "text", "127.0.0.1:8188", {}))


# --------------------------------------------------------------------------
# 2. A configured value is never silently rewritten
# --------------------------------------------------------------------------
def test_configured_value_survives_every_tier() -> None:
    # (a) live list that doesn't carry it
    install(FakeStorage(),
            FakeBatch(alive=True, lists={CKPT: ["other.safetensors"]}))
    out = u._control_html("checkpoint", "text", "mine.safetensors", {})
    check_in("live: unlisted value kept",
             '<option value="mine.safetensors" selected>mine.safetensors '
             '(not in ComfyUI)</option>', out)
    # (b) catalog list that doesn't carry it
    install(FakeStorage({"fetchedAt": 5.0, "source": "s",
                         "fields": {CKPT_KEY: ["other.safetensors"]}}),
            FakeBatch(alive=False))
    out = u._control_html("checkpoint", "text", "mine.safetensors", {})
    check_in("catalog: unlisted value kept",
             '<option value="mine.safetensors" selected>', out)
    # (c) static seed that doesn't carry it — marked "(custom)" because ComfyUI
    # was never asked, so "not in ComfyUI" would be a claim we can't make.
    install(FakeStorage(), FakeBatch(alive=False))
    out = u._control_html("gpt_image_quality", "text", "ultra", {})
    check_in("seed: unlisted value kept and marked (custom)",
             '<option value="ultra" selected>ultra (custom)</option>', out)
    check_in("seed: the known values are still offered",
             '<option value="high">high</option>', out)
    # (d) a per-atlas override keeps its "(inherit global)" blank choice.
    out = u._control_html("ipadapter_weight_type", "text", "", {},
                          allow_blank=True,
                          blank_label="(inherit global: style transfer)")
    check_in("per-atlas blank choice preserved",
             '<option value="" selected>(inherit global: style transfer)'
             '</option>', out)


# --------------------------------------------------------------------------
# 3. refresh()
# --------------------------------------------------------------------------
def test_refresh_with_nothing_reachable_keeps_the_catalog() -> None:
    good = {"fetchedAt": 42.0, "source": "http://comfy.test",
            "fields": {CKPT_KEY: ["keepme.safetensors"]}}
    st = FakeStorage(good)
    install(st, FakeBatch(alive=False))
    cc.os.environ.pop("COMFY_CATALOG_URL", None)

    def dead(url: str, headers: dict) -> dict:
        raise OSError("connection refused")

    res = cc.refresh([CKPT], http_get=dead)
    check("refresh reports failure", res["ok"], False)
    check("failure names no source", res["source"], "")
    check("failure still reports what is stored", res["fields"], 1)
    check_in("failure note is readable", "didn't answer", res["note"])
    check("a failed refresh never PUTs", st.puts, [])
    check("the good catalog is untouched", st.doc(), good)
    check("and still serves the dropdown",
          cc.stored_options(*CKPT), ["keepme.safetensors"])


def test_refresh_reads_the_configured_catalog_url() -> None:
    # COMFY_CATALOG_URL is the POD target's only source. COMFY_BASE is alive
    # here on purpose — it is the user's own machine, and a pod refresh must
    # never read it.
    POD = cc.CATALOG_KEYS["pod"]
    st = FakeStorage()
    install(st, FakeBatch(alive=True, lists={CKPT: ["local-only.safetensors"]}))
    cc.os.environ["COMFY_CATALOG_URL"] = "http://volume-pod:8188/"
    seen: list[str] = []
    sent_headers: list[dict] = []

    def answer(url: str, headers: dict) -> dict:
        seen.append(url)
        sent_headers.append(headers)
        if url.endswith("/system_stats"):
            return {"system": {}}
        node = url.rsplit("/", 1)[-1]
        return {node: {"input": {"required": {
            "ckpt_name": [["one.safetensors", "two.safetensors"]],
        }}}}

    try:
        res = cc.refresh([CKPT], target="pod", http_get=answer)
    finally:
        cc.os.environ.pop("COMFY_CATALOG_URL", None)
    check("refresh succeeded", res["ok"], True)
    check("refresh names its target", res["target"], "pod")
    check("trailing slash trimmed from the source",
          res["source"], "http://volume-pod:8188")
    check("one list, two values", (res["fields"], res["values"]), (1, 2))
    check("probe hit /system_stats then /object_info", seen, [
        "http://volume-pod:8188/system_stats",
        "http://volume-pod:8188/object_info/CheckpointLoaderSimple"])
    check("pod catalog stored under the pod key", st.doc(POD)["fields"][CKPT_KEY],
          ["one.safetensors", "two.safetensors"])
    check("the local catalog was not written", cc.CATALOG_KEY in st.objects, False)
    check("and the pod dropdown reads it, not COMFY_BASE",
          u._options_for("checkpoint", {}, "pod"),
          (["one.safetensors", "two.safetensors"], "(not in ComfyUI)"))
    # A source that lacks a node must not DELETE a list we already had — the
    # probe answers "what I have", not "what exists".
    st2 = FakeStorage({"fetchedAt": 3.0, "source": "old",
                       "fields": {"RMBG|model": ["rmbg-2.0"]}}, key=POD)
    install(st2, FakeBatch(alive=False))
    cc.os.environ["COMFY_CATALOG_URL"] = "http://volume-pod:8188"
    try:
        cc.refresh([CKPT], target="pod", http_get=answer)
    finally:
        cc.os.environ.pop("COMFY_CATALOG_URL", None)
    check("an unprobed list is merged forward, not dropped",
          sorted(st2.doc(POD)["fields"]), sorted([CKPT_KEY, "RMBG|model"]))
    # The CF Access / User-Agent headers must ride along or Cloudflare 403s the
    # request as `Python-urllib` — the trap that cost hours once already.
    check("every probe carried the CF headers",
          all(h == FakeBatch.CF_HEADERS for h in sent_headers), True)


def test_refresh_answering_but_listing_nothing_keeps_the_catalog() -> None:
    good = {"fetchedAt": 7.0, "source": "old", "fields": {CKPT_KEY: ["keep"]}}
    st = FakeStorage(good)
    install(st, FakeBatch(alive=True))

    def empty(url: str, headers: dict) -> dict:
        return {}  # answers, but has no such node

    res = cc.refresh([CKPT], http_get=empty)
    check("no enums found = not ok", res["ok"], False)
    check("catalog untouched", st.doc(), good)


# --------------------------------------------------------------------------
# 3b. Two targets, two sources — never each other's
# --------------------------------------------------------------------------
def test_targets_never_substitute_for_each_other() -> None:
    POD = cc.CATALOG_KEYS["pod"]
    # A live COMFY_BASE (the user's machine) AND a stored pod catalog.
    st = FakeStorage({"fetchedAt": 1.0, "source": "http://volume-pod:8188",
                      "fields": {CKPT_KEY: ["pod.safetensors"]}}, key=POD)
    batch = FakeBatch(alive=True, lists={CKPT: ["mine.safetensors"]})
    install(st, batch)
    check("pod dropdown = the pod catalog",
          u._options_for("checkpoint", {}, "pod"),
          (["pod.safetensors"], "(not in ComfyUI)"))
    check("…and COMFY_BASE was never asked", batch.available_calls, [])
    check("pod is never 'live'", cc.status("pod")["live"], False)
    out = u._model_status_html("pod")
    check_in("pod strip says RunPod", "RunPod", out)
    check_in("pod strip says cached", "cached", out)
    check_not_in("pod strip never claims live", "live from", out)
    check("local dropdown = the live list",
          u._options_for("checkpoint", {}, "local"),
          (["mine.safetensors"], "(not in ComfyUI)"))
    # No pod catalog at all → the pod strip says what to set.
    install(FakeStorage(), batch)
    out = u._model_status_html("pod")
    check_in("no pod catalog: unavailable", "Model lists unavailable", out)
    check_in("no pod catalog: names the env var", "COMFY_CATALOG_URL", out)
    # A LOCAL refresh ignores COMFY_CATALOG_URL even when it is set and
    # COMFY_BASE is down — the pod's files are not the user's files.
    st = FakeStorage()
    install(st, FakeBatch(alive=False))
    cc.os.environ["COMFY_CATALOG_URL"] = "http://volume-pod:8188"
    seen: list[str] = []

    def answer(url: str, headers: dict) -> dict:
        seen.append(url)
        return {"system": {}}

    try:
        res = cc.refresh([CKPT], target="local", http_get=answer)
    finally:
        cc.os.environ.pop("COMFY_CATALOG_URL", None)
    check("local refresh with COMFY_BASE down fails", res["ok"], False)
    check("…without touching COMFY_CATALOG_URL", seen, [])
    check_in("…and says which machine", "Your ComfyUI didn't answer", res["note"])
    # A POD refresh with nothing configured says exactly what to set.
    res = cc.refresh([CKPT], target="pod", http_get=answer)
    check("pod refresh with nothing configured fails", res["ok"], False)
    check_in("…and names COMFY_CATALOG_URL", "COMFY_CATALOG_URL", res["note"])
    check("…without a PUT", st.puts, [])


def test_run_on_setting_maps_to_the_render_env() -> None:
    saved = cc.os.environ.get("COMFY_TRANSPORT")
    try:
        cc.os.environ["COMFY_TRANSPORT"] = "serverless"
        check("blank + serverless env = pod",
              u.effective_run_on({"run_on": ""}), "pod")
        check("explicit local beats the env",
              u.effective_run_on({"run_on": "local"}), "local")
        check("an unknown value falls back to the env",
              u.effective_run_on({"run_on": "gpu"}), "pod")
        cc.os.environ["COMFY_TRANSPORT"] = "http"
        check("blank + http env = local", u.effective_run_on({}), "local")
        check("explicit pod beats the env",
              u.effective_run_on({"run_on": "pod"}), "pod")
        check("pod renders through the serverless transport",
              u.run_on_env("pod"), {"COMFY_TRANSPORT": "serverless"})
        check("local renders through http (the tunnel)",
              u.run_on_env("local"), {"COMFY_TRANSPORT": "http"})
        out = u._control_html("run_on", "text", "local", {})
        check_in("run_on is a <select>", '<select data-cfg="run_on"', out)
        check_in("current choice selected", '<option value="local" selected>', out)
        check_in("blank names the service default", "(service default: ", out)
        out = u._control_html("run_on", "text", "gpu", {})
        check_in("unknown stored value kept and marked",
                 '<option value="gpu" selected>gpu (custom)</option>', out)
    finally:
        if saved is None:
            cc.os.environ.pop("COMFY_TRANSPORT", None)
        else:
            cc.os.environ["COMFY_TRANSPORT"] = saved


# --------------------------------------------------------------------------
# 4. load() is fail-safe
# --------------------------------------------------------------------------
def test_load_survives_a_broken_or_absent_catalog() -> None:
    install(FakeStorage(), FakeBatch(alive=False))
    check("absent object -> {}", cc.load(), {})
    install(FakeStorage(raw=b"{not json at all"), FakeBatch(alive=False))
    check("malformed JSON -> {}", cc.load(), {})
    install(FakeStorage(raw=b'["a","list","not","an","object"]'),
            FakeBatch(alive=False))
    check("wrong JSON shape -> {}", cc.load(), {})
    install(FakeStorage({"fetchedAt": "nope", "fields": {"A|b": "not a list"}}),
            FakeBatch(alive=False))
    check("junk field values are dropped, not crashed on",
          cc.load().get("fields"), {})
    install(FakeStorage(read_raises=True), FakeBatch(alive=False))
    check("dead R2 -> {}", cc.load(), {})
    check("and the dropdown just falls through",
          u._options_for("checkpoint", {}), (None, ""))
    # The Settings status strip must render in every one of those worlds.
    check_in("status strip renders with no catalog",
             "Model lists unavailable", u._model_status_html())


# --------------------------------------------------------------------------
# 5. The render path never costs an R2 PUT unless something really changed
# --------------------------------------------------------------------------
def test_commit_live_is_content_gated() -> None:
    stored = {"fetchedAt": 9.0, "source": "http://comfy.test",
              "fields": {CKPT_KEY: ["same.safetensors"]}}
    st = FakeStorage(stored)
    install(st, FakeBatch(alive=True, lists={CKPT: ["same.safetensors"]}))
    cc.options(*CKPT)
    check("identical live list writes nothing", cc.commit_live(), False)
    check("really nothing", st.puts, [])

    install(st, FakeBatch(alive=True, lists={CKPT: ["new.safetensors"]}))
    cc.options(*CKPT)
    check("a genuinely changed list is stored once", cc.commit_live(), True)
    check("exactly one PUT", st.puts, [cc.CATALOG_KEY])
    check("second commit in the cooldown does nothing", cc.commit_live(), False)
    check("still one PUT", st.puts, [cc.CATALOG_KEY])


def test_status_reports_the_right_tier() -> None:
    install(FakeStorage(), FakeBatch(alive=True))
    check_in("live reads 'live from your ComfyUI'", "live from your ComfyUI",
             u._model_status_html())
    install(FakeStorage({"fetchedAt": 1.0, "source": "http://volume-pod:8188",
                         "fields": {CKPT_KEY: ["a"]}}), FakeBatch(alive=False))
    out = u._model_status_html()
    check_in("cached names its source", "http://volume-pod:8188", out)
    check_in("cached says ComfyUI isn't answering",
             "ComfyUI isn't answering right now", out)
    check_not_in("cached is not shown as live", "live from your ComfyUI", out)
    check_in("every state offers the refresh button",
             "⟳ Refresh model lists", out)


if __name__ == "__main__":
    try:
        for fn in (test_live_wins_over_catalog_and_seed,
                   test_catalog_used_when_live_returns_none,
                   test_static_seed_when_live_and_catalog_are_empty,
                   test_configured_value_survives_every_tier,
                   test_refresh_with_nothing_reachable_keeps_the_catalog,
                   test_refresh_reads_the_configured_catalog_url,
                   test_refresh_answering_but_listing_nothing_keeps_the_catalog,
                   test_targets_never_substitute_for_each_other,
                   test_run_on_setting_maps_to_the_render_env,
                   test_load_survives_a_broken_or_absent_catalog,
                   test_commit_live_is_content_gated,
                   test_status_reports_the_right_tier):
            print(f"\n-- {fn.__name__}")
            fn()
    finally:
        cc.storage = _REAL_STORAGE
        cc.batch_atlas = _REAL_BATCH
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
