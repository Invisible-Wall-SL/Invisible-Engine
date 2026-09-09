"""Publishing a blueprint can SELECT it, and one input never takes two roles.

Run:  py test_blueprint_publish.py   (from services/atlas-tool, PYTHONPATH=../_shared)

Two traps that cost a real session, both silent:

1. **Publishing does not select.** It only adds the blueprint to the shared
   library. The atlas keeps rendering with the pipeline it already had, and the
   untouched default is `sdxl` — the built-in TEXT-TO-IMAGE path. So a
   background-removal blueprint was published, the next render went through SDXL,
   and the artwork came back regenerated from the region prompt instead of
   processed. Nothing in the flow connected the two steps. `use_for_atlas` now
   writes the pipeline server-side, which is the only place that knows the
   slugged id.

2. **A blueprint's `base` is inert.** It is validated, stored and shown, and
   NOTHING dispatches on it — but it offers `sdxl / flux / gpt_image`, the same
   three words as the built-in pipelines, so it reads as "this is what will run".
   Pinned here so a future change that starts dispatching on it has to say so.

The ref-role half of the fix (one input, one role) lives in the modal's
`buildBpBindings` and is covered by the page-JS suite plus the browser check.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

_STAGING = tempfile.mkdtemp(prefix="bp-publish-")
os.environ["ATLAS_STAGING"] = _STAGING

import blueprints  # noqa: E402
import storage  # noqa: E402
import ui_server  # noqa: E402

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


GRAPH = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "in.png", "upload": "image"}},
    "2": {"class_type": "RembgNode", "inputs": {"image": ["1", 0], "model": "u2net"}},
    "3": {"class_type": "SaveImage",
          "inputs": {"filename_prefix": "IW", "images": ["2", 0]}},
}


class FakeHandler:
    """Just enough of the request object for _uploadblueprint: the publish
    capability, and _saveconfig bound to the real implementation (which reads
    module-level config/manifest helpers, not request state)."""

    can_publish = True

    def _saveconfig(self, edits: dict) -> str:
        return ui_server.Handler._saveconfig(self, edits)

    def _publish_author(self) -> str:
        return ui_server.Handler._publish_author(self)

    def _ensure_region(self, m, name):  # only reached by region edits
        raise AssertionError("not expected for a pipeline-only save")


def publish(name: str, use_for_atlas: bool) -> str:
    payload = {
        "name": name,
        "description": "",
        "kind": "image",
        "base": "sdxl",
        "workflow_text": json.dumps(GRAPH),
        "bindings": {"output": {"node": "3"}, "style_ref": {"node": "1", "field": "image"}},
        "params": [],
        "overwrite": True,
        "use_for_atlas": use_for_atlas,
    }
    return ui_server.Handler._uploadblueprint(FakeHandler(), payload)


def pipeline_now() -> str:
    return str(ui_server.load_config().get("pipeline", ""))


def main() -> int:
    # R2 is not reachable offline and a put() raising is a hard publish failure,
    # so stand in for the bucket. Staging is a real temp tree.
    put_calls: list[str] = []
    storage.put = lambda key, data, **kw: put_calls.append(key)  # type: ignore[assignment]

    print("\n-- the atlas starts on the built-in text-to-image pipeline")
    ui_server.save_config({**ui_server.load_config(), "pipeline": "sdxl"})
    check("default pipeline", pipeline_now(), "sdxl")

    print("\n-- publishing WITHOUT the opt-in leaves the pipeline alone")
    msg = publish("Leave It Alone", use_for_atlas=False)
    check("published", msg.startswith("✓"), True)
    check("pipeline untouched", pipeline_now(), "sdxl")
    check("...and the message says it will not run yet",
          "Settings → Pipeline" in msg, True)

    print("\n-- publishing WITH the opt-in selects it (the reported bug)")
    msg = publish("Remove Background", use_for_atlas=True)
    check("published", msg.startswith("✓"), True)
    check("pipeline is now the blueprint", pipeline_now(), "remove_background")
    check("...and the message says so", "selected it" in msg, True)
    check("the blueprint really loads under that id",
          blueprints.get_blueprint("remove_background") is not None, True)
    check("so the render dispatches to the blueprint, not a built-in",
          pipeline_now() in ("sdxl", "flux", "gpt_image"), False)

    print("\n-- `base` is inert: it is stored, and nothing dispatches on it")
    bp = blueprints.get_blueprint("remove_background")
    stored_base = (bp.get("meta") or {}).get("base")
    check("base stored on the blueprint's meta", stored_base, "sdxl")
    check("base is not what dispatch reads", pipeline_now() == stored_base, False)

    check("both publishes reached the bucket", len(put_calls) >= 4, True)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all blueprint-publish fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
