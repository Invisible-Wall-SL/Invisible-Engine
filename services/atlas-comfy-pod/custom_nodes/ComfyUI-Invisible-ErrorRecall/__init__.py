"""Invisible Error Recall — a FRONTEND-ONLY ComfyUI extension (no nodes).

ComfyUI delivers `execution_error` over the /ws progress socket exactly once. If that
socket is down at that moment -- RunPod's proxy timing out an idle connection, a sleeping
laptop, a pod restart -- nothing ever replays it: you reconnect to a canvas that looks
fine, with no red node, even though the server recorded the error perfectly in /history.

This package ships no nodes. It exists purely to serve `web/errorRecall.js`, which goes
back to /history on reconnect (and on page load) and paints the error onto the node the
socket failed to deliver it to.

See docs/INFRA.md "Debugging \"ComfyUI disconnected\" on a pod" for the whole story, and
scripts/comfy-last-error.mjs for the terminal-side equivalent.
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Serves ./web at /extensions/ComfyUI-Invisible-ErrorRecall/ — ComfyUI auto-loads every
# .js in there as a frontend extension.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
