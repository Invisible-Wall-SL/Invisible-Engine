"""diag_catalog.py — Invisible Atlas Maker diagnostic catalog.

Tool-specific, owner-facing copy for every structured failure the Atlas Maker
can surface. The framework (severity / format / emit / parse) lives in
``iw_common.diagnostics``; this file is ONLY the text.

Each entry: {severity, title, explain, fix}. All three text fields are
``str.format``-able templates — diagnostic call sites pass context as
keyword args (e.g. ``diag("ATLAS_GEOMETRY_MISSING", CATALOG, ref=...)``).
Missing keys never raise (see iw_common.diagnostics._safe_format).

explain = WHY it happened. fix = HOW to fix it (explain-only — no buttons).
"""
from __future__ import annotations

CATALOG = {
    # --- Missing files ------------------------------------------------------
    "ATLAS_GEOMETRY_MISSING": {
        "severity": "error",
        "title": "Atlas geometry not found in R2",
        "explain": (
            "The manifest's atlas points at '{ref}', but that .atlas file "
            "isn't in this project's R2 staging mirror. This usually means "
            "the manifest was authored offline and still references a "
            "local/Windows path, or R2 was changed without restarting."
        ),
        "fix": (
            "Upload the .atlas (and its source page) with the 'Upload .atlas' "
            "button on the region card, which repoints the manifest to a "
            "staging-relative path. Or re-seed R2 and restart / Refresh the "
            "service so the file hydrates into staging."
        ),
    },
    "OUTPUT_OVERRIDE_FILE_MISSING": {
        "severity": "warn",
        "title": "Region '{name}' override image is missing",
        "explain": (
            "Region '{name}' is flagged 'use my image', but the file it "
            "points at is gone ({path}). The region will fall back to normal "
            "AI generation instead of your image."
        ),
        "fix": (
            "Click ✕ revert on region '{name}' to regenerate it, or re-set the "
            "image with 'use my image' so the override points at a file that "
            "actually exists."
        ),
    },
    "NO_REFERENCE_IMAGE": {
        "severity": "error",
        "title": "Region '{name}' has no reference image",
        "explain": (
            "Region '{name}' needs a reference image for this action, but none "
            "is set."
        ),
        "fix": (
            "Pick a reference image for region '{name}' (drag one onto the "
            "card or use 'Pick from R2') before retrying."
        ),
    },
    "ATLAS_EMPTY": {
        "severity": "error",
        "title": "Atlas is empty",
        "explain": (
            "The composed atlas has no placed regions, so there is nothing to "
            "slice or deploy."
        ),
        "fix": (
            "Generate the regions (or set their images), then click "
            "'Create Atlas' to compose before slicing."
        ),
    },
    "SOURCE_IMAGE_INVALID": {
        "severity": "error",
        "title": "Could not read that image",
        "explain": (
            "The uploaded image could not be decoded as a valid image file "
            "({err})."
        ),
        "fix": (
            "Re-export it as a standard PNG or JPEG and upload again. Check "
            "the file isn't truncated or actually a different format."
        ),
    },

    # --- Wrong settings -----------------------------------------------------
    "ALL_REGIONS_OVERRIDDEN": {
        "severity": "warn",
        "title": "Nothing to generate — every region uses your own image",
        "explain": (
            "EVERY selected region is set to 'use my own image', so AI "
            "generation has nothing to do. Generation only renders the AI "
            "regions — it never builds the atlas itself."
        ),
        "fix": (
            "Either click ✕ revert on the regions you want the AI to "
            "generate, OR — if you intend to keep your own images — click "
            "'Create Atlas' to compose them. Generation alone never builds "
            "the atlas."
        ),
    },
    "SOME_REGIONS_OVERRIDDEN": {
        "severity": "info",
        "title": "Skipping {count} region(s) that use your own image",
        "explain": (
            "{count} region(s) are set to 'use my own image' and will be left "
            "untouched by generation: {names}."
        ),
        "fix": (
            "This is expected. If you want the AI to generate any of these, "
            "click ✕ revert on that region first."
        ),
    },
    "FX_LAYERS_SKIPPED": {
        "severity": "info",
        "title": (
            "{count} FX layer(s) skipped — derived from their base, not "
            "AI-generated"
        ),
        "explain": (
            "These regions ({names}) are glow/shadow/shine FX layers of a "
            "base element (named '<base>_glow' / '_shadow' / '_shine' / "
            "'_blur' / '_zoom'). The AI generator leaves them alone on "
            "purpose: they're built LOCALLY from the base image (no prompt and "
            "no reference needed), not generated by Stable Diffusion. Once "
            "built they carry an output_override, which is why generation "
            "skips them."
        ),
        "fix": (
            "Two options. (a) Keep them as FX of the base: regenerate the "
            "base, then for each layer set its mode to glow / shadow / shine "
            "and click '⚙ build', then 'Create Atlas'. (b) AI-generate them "
            "independently instead: switch each layer's mode to 'AI' (this "
            "clears the override), then click 'Render'."
        ),
    },
    "NO_REGIONS_SELECTED": {
        "severity": "warn",
        "title": "No regions selected",
        "explain": (
            "No regions matched the current selection / filter, so there is "
            "nothing to do."
        ),
        "fix": (
            "Select at least one region (or clear the 'only' filter / include "
            "hidden regions) and retry."
        ),
    },
    "LOCKED_ALREADY_GENERATED": {
        "severity": "info",
        "title": "Skipping {count} locked region(s) already generated",
        "explain": (
            "{count} locked region(s) already have a matching variant, so "
            "they were skipped: {names}."
        ),
        "fix": (
            "This is expected. To regenerate them anyway, use Force / "
            "regenerate."
        ),
    },
    "HALO_BAD_SUFFIX": {
        "severity": "error",
        "title": "Region '{name}' can't take a glow/halo",
        "explain": (
            "Region '{name}' doesn't follow the naming convention this "
            "glow/halo effect needs (the expected suffix is missing)."
        ),
        "fix": (
            "Rename the region to the expected '<base>_glow' / '<base>_halo' "
            "form, or pick a region that already has the matching base."
        ),
    },
    "NO_BASE_REGION": {
        "severity": "error",
        "title": "No base region for '{name}'",
        "explain": (
            "The glow/halo for '{name}' needs a base region '{base_name}', "
            "but that base region doesn't exist."
        ),
        "fix": (
            "Add the base region '{base_name}' (or rename '{name}' so its base "
            "matches an existing region) and retry."
        ),
    },
    "NOTHING_TO_PASTE": {
        "severity": "warn",
        "title": "Nothing to paste",
        "explain": (
            "There is no copied image in the buffer to paste into this region."
        ),
        "fix": (
            "Copy an image from a source region first, then paste it here."
        ),
    },
    "NO_ATLAS_RECIPE": {
        "severity": "info",
        "title": "No Atlas Maker recipe found for '{atlas}'",
        "explain": (
            "The editor asked to open '{atlas}' here, but no Atlas Maker "
            "generation manifest in this project deploys to that atlas. It was "
            "likely built directly in the Sheet Maker (packed sprites), not "
            "generated as regions here."
        ),
        "fix": (
            "Open it via the Sheet Maker's Import browser instead. (Your "
            "account doesn't have the Sheet Maker linked, so there's no direct "
            "jump from here.)"
        ),
    },
    "ATLAS_IMPORT_FAILED": {
        "severity": "error",
        "title": "Couldn't import '{atlas}' into the Atlas Maker",
        "explain": (
            "The editor asked to open '{atlas}' here, so the Atlas Maker tried "
            "to auto-import the existing sheet into a new generation manifest "
            "— but it couldn't read the sheet's geometry or its page image from "
            "this project's R2 staging. The source sheet (and its page PNG) may "
            "not be hydrated, or the file isn't a TexturePacker / editor sheet."
        ),
        "fix": (
            "Make sure '{atlas}' and its sibling page image exist in this "
            "project's R2 (manifests/ prefix), then click ↻ Refresh from R2 "
            "(or restart the service) and open it again."
        ),
    },
    "REGION_NOT_FOUND": {
        "severity": "error",
        "title": "Region '{name}' not found",
        "explain": (
            "No region named '{name}' exists in the current manifest. It may "
            "have been renamed or removed."
        ),
        "fix": (
            "Reload the manifest and pick a region that still exists, then "
            "retry."
        ),
    },
    "MISSING_IMAGE_DATA": {
        "severity": "error",
        "title": "No image data received",
        "explain": (
            "The request didn't include any image data, so there was nothing "
            "to save."
        ),
        "fix": (
            "Re-select the image and try again. If you dragged a file, make "
            "sure it finished uploading before submitting."
        ),
    },

    # --- External service (ComfyUI / paid APIs / R2) ------------------------
    "COMFY_AUTH": {
        "severity": "error",
        "title": "ComfyUI rejected the job (not authorized)",
        "explain": (
            "The ComfyUI browser login does NOT apply to this tool's headless "
            "jobs, so the job was rejected as unauthorized. No credits were "
            "charged."
        ),
        "fix": (
            "Generate a comfy.org API key (platform.comfy.org -> API Keys) "
            "and set it as 'comfy.org API key' in Settings (or the "
            "COMFY_ORG_API_KEY env var), then retry."
        ),
    },
    "COMFY_PAYMENT": {
        "severity": "error",
        "title": "Paid image API has no credit balance",
        "explain": (
            "The paid image API (e.g. OpenAI GPT-Image) used by region "
            "'{name}' has no credit balance. No credits were charged for this "
            "attempt."
        ),
        "fix": (
            "Either top up that account, or switch region '{name}' off the "
            "paid pipeline (set its manifest 'pipeline' to sdxl/flux to render "
            "locally for free), then retry."
        ),
    },
    "COMFY_NODE_FAILED": {
        "severity": "error",
        "title": "ComfyUI failed while rendering '{name}'",
        "explain": (
            "ComfyUI hit an execution error on region '{name}' at node "
            "{node}: {msg}"
        ),
        "fix": (
            "Check the ComfyUI node/model for region '{name}' (a missing "
            "model, a bad input, or out-of-memory are common causes), then "
            "retry. The full message is above."
        ),
    },
    "COMFY_TIMEOUT": {
        "severity": "error",
        "title": "ComfyUI timed out on '{name}'",
        "explain": (
            "Region '{name}' did not finish within 20 minutes. The remote "
            "ComfyUI may be overloaded, stalled, or the tunnel dropped."
        ),
        "fix": (
            "Confirm the ComfyUI tunnel is up (comfy.invisiblewall.org) and "
            "the machine isn't busy with another job, then retry. Reducing "
            "variant count or image size can also help."
        ),
    },
    "SLICE_FAILED": {
        "severity": "error",
        "title": "Slicing failed",
        "explain": (
            "The atlas could not be sliced into reference images ({err})."
        ),
        "fix": (
            "Make sure the atlas has been composed (Create Atlas) and its "
            ".atlas geometry is present in R2, then retry the slice."
        ),
    },
    "DEPLOY_FAILED": {
        "severity": "error",
        "title": "Deploy to R2 failed",
        "explain": (
            "Could not copy '{src}' to R2 key '{key}' ({err})."
        ),
        "fix": (
            "Check R2 credentials/connectivity and that the source file "
            "exists in staging, then retry the deploy."
        ),
    },
    "GLOW_FAILED": {
        "severity": "error",
        "title": "Glow/halo build failed",
        "explain": (
            "The glow/halo effect could not be generated ({err})."
        ),
        "fix": (
            "Confirm the base region and its image exist, then retry. If it "
            "persists, check the source image is a valid RGBA PNG."
        ),
    },
    "FX_BUILD_FAILED": {
        "severity": "error",
        "title": "Effect build failed ({mode})",
        "explain": (
            "The '{mode}' effect could not be built ({err})."
        ),
        "fix": (
            "Check the inputs for the '{mode}' effect (region image present "
            "and valid) and retry."
        ),
    },
}
