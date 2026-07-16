"""
Invisible Atlas Maker — in-app documentation page.

Renders a single self-contained HTML page (served at /docs by ui_server) that
covers what the tool does, how each piece of the UI works, and a short tutorial
per section. The per-setting and per-advanced-field reference tables are built
from the SAME dicts ui_server uses to draw tooltips (SETTING_HELP, ADV_TIPS,
CONFIG_FIELDS, ADV_FIELDS), so the docs auto-update when settings change.

Edit the narrative sections (overview, tutorials, gotchas) here. Edit a
setting's description in ui_server.SETTING_HELP / ADV_TIPS and it reflows here
on the next page load.
"""

from __future__ import annotations

import html


def _h(s: str) -> str:
    return html.escape(str(s))


def _settings_table(keys, labels, helps, pipe_group):
    """Build a reference table: key · label · pipeline · description."""
    rows = []
    for k in keys:
        if k not in labels:
            continue
        pipe = pipe_group.get(k, "all")
        pipe_lbl = {
            "all": "any",
            "both": "sdxl + flux",
            "sdxl": "SDXL only",
            "flux": "FLUX only",
            "gpt_image": "gpt_image only",
        }.get(pipe, pipe)
        desc = helps.get(k, "")
        # tooltip strings sometimes use {lora}/{ckpt}/{cn}/{rmbg} placeholders;
        # render them literally so the docs read cleanly.
        desc = desc.replace("{lora}", "<i>LoRA</i>").replace(
            "{ckpt}", "<i>checkpoint</i>").replace(
            "{cn}", "<i>ControlNet</i>").replace(
            "{rmbg}", "<i>RMBG model</i>")
        rows.append(
            f'<tr><td><code>{_h(k)}</code></td><td>{_h(labels[k])}</td>'
            f'<td class="pp">{_h(pipe_lbl)}</td><td>{desc}</td></tr>')
    return ("<table class=reftbl><thead><tr><th>Key</th><th>Label</th>"
            "<th>Pipeline</th><th>What it does</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def render_docs(ui_module) -> str:
    """Build the docs page. Pass the loaded ui_server module so we read its
    live dicts (no duplication, no drift)."""
    SETTING_HELP = ui_module.SETTING_HELP
    ADV_TIPS = ui_module.ADV_TIPS
    ADV_FIELDS = ui_module.ADV_FIELDS
    ADV_PIPE = ui_module.ADV_PIPE
    ADV_RANGES = ui_module.ADV_RANGES
    CONFIG_FIELDS = ui_module.CONFIG_FIELDS
    PIPE_GROUP = ui_module.PIPE_GROUP
    PER_ATLAS_KEYS = ui_module.PER_ATLAS_KEYS
    ATLAS_GEOM_FIELDS = ui_module.ATLAS_GEOM_FIELDS
    BUILD = getattr(ui_module, "BUILD", "")

    cfg_labels = {k: lbl for k, lbl, _ in CONFIG_FIELDS}
    geom_labels = {k: lbl for k, lbl, _, _ in ATLAS_GEOM_FIELDS}
    geom_keys = [k for k, _, _, _ in ATLAS_GEOM_FIELDS]

    # ----- generated tables ------------------------------------------------
    truly_global_keys = [k for k, _, _ in CONFIG_FIELDS if k not in PER_ATLAS_KEYS]
    per_atlas_keys = [k for k, _, _ in CONFIG_FIELDS if k in PER_ATLAS_KEYS]
    global_tbl = _settings_table(truly_global_keys, cfg_labels, SETTING_HELP, PIPE_GROUP)
    peratlas_tbl = _settings_table(per_atlas_keys, cfg_labels, SETTING_HELP, PIPE_GROUP)
    geom_tbl = _settings_table(geom_keys, geom_labels, SETTING_HELP,
                                {k: "all" for k in geom_keys})

    # advanced overrides: same structure, different source dict
    adv_rows = []
    for key, label, _ in ADV_FIELDS:
        pipe = ADV_PIPE.get(key, "all")
        pipe_lbl = {
            "all": "any", "both": "sdxl + flux", "sdxl": "SDXL only",
            "flux": "FLUX only", "gpt_image": "gpt_image only",
        }.get(pipe, pipe)
        rng = ADV_RANGES.get(key)
        rng_html = (f"<div class=rng>range {rng[0]} … {rng[1]} (step {rng[2]})</div>"
                    if rng else "")
        adv_rows.append(
            f'<tr><td><code>{_h(key)}</code></td><td>{_h(label)}</td>'
            f'<td class="pp">{_h(pipe_lbl)}</td>'
            f'<td>{_h(ADV_TIPS.get(key, ""))}{rng_html}</td></tr>')
    adv_tbl = ("<table class=reftbl><thead><tr><th>Key</th><th>Label</th>"
               "<th>Pipeline</th><th>What it does</th></tr></thead><tbody>"
               + "".join(adv_rows) + "</tbody></table>")

    # ----- page ------------------------------------------------------------
    return f"""<!doctype html><html lang=en><head><meta charset=utf-8>
<title>Invisible Atlas Maker — Documentation</title>
<style>
 :root {{ --bg:#1d1d22; --fg:#e8e8ea; --mut:#9aa; --card:#27272d;
         --bord:#36363d; --accent:#6fb0c8; --code:#1a1a1e; }}
 *{{box-sizing:border-box}}
 body{{font-family:system-ui,Arial;background:var(--bg);color:var(--fg);
       margin:0;padding:0;line-height:1.55;font-size:14.5px}}
 a{{color:var(--accent);text-decoration:none}} a:hover{{text-decoration:underline}}
 header.top{{display:flex;align-items:center;gap:14px;padding:14px 24px;
            border-bottom:1px solid #333;background:#17171b;
            position:sticky;top:0;z-index:10}}
 header.top .t{{font-size:17px;font-weight:600}}
 header.top .s{{font-size:12px;color:#888}}
 header.top a.back{{margin-left:auto;font-size:13px;background:#3f789e;
                    color:#fff;padding:7px 14px;border-radius:6px}}
 .wrap{{display:grid;grid-template-columns:240px 1fr;min-height:calc(100vh - 60px)}}
 nav.toc{{background:#17171b;border-right:1px solid #2a2a30;padding:16px 0;
         position:sticky;top:60px;align-self:start;max-height:calc(100vh - 60px);
         overflow:auto}}
 nav.toc h4{{font-size:11px;letter-spacing:.08em;text-transform:uppercase;
            color:#7c8a92;margin:14px 16px 4px}}
 nav.toc a{{display:block;padding:6px 16px;color:#cdd;font-size:13px;
           border-left:3px solid transparent}}
 nav.toc a:hover{{background:#1f1f25;text-decoration:none;color:#fff}}
 nav.toc a.act{{border-left-color:#3f789e;background:#1f242a;color:#fff}}
 main{{padding:24px 32px 80px;max-width:920px}}
 main h2{{margin:32px 0 10px;padding-top:14px;border-top:1px solid #2a2a30;
         font-size:22px}}
 main h2:first-of-type{{border-top:0;padding-top:0;margin-top:0}}
 main h3{{margin:22px 0 6px;font-size:16px;color:#e8e8ea}}
 main h4{{margin:18px 0 4px;font-size:14px;color:#cfd6da;font-weight:600}}
 main p, main li{{color:#d6d6da}}
 main ul, main ol{{padding-left:22px}}
 main li{{margin:3px 0}}
 code{{background:var(--code);color:#cfeede;padding:1px 6px;border-radius:4px;
       font-size:12.5px}}
 kbd{{background:#2a2a31;border:1px solid #444;border-bottom-width:2px;
       border-radius:4px;padding:1px 6px;font-size:11.5px;color:#ddd}}
 .card{{background:var(--card);border:1px solid var(--bord);border-radius:8px;
        padding:14px 18px;margin:14px 0}}
 .note{{background:#1f2630;border:1px solid #2b4358;border-left:4px solid #3f789e;
        border-radius:6px;padding:10px 14px;margin:14px 0;font-size:13.5px;color:#d8e3ea}}
 .warn{{background:#2c1f1f;border:1px solid #5a2f2f;border-left:4px solid #c66;
        border-radius:6px;padding:10px 14px;margin:14px 0;font-size:13.5px;color:#f0d8d8}}
 .ok{{background:#1f2c1f;border:1px solid #2f5a2f;border-left:4px solid #6c6;
      border-radius:6px;padding:10px 14px;margin:14px 0;font-size:13.5px;color:#d8f0d8}}
 ol.steps{{counter-reset:step;list-style:none;padding-left:0}}
 ol.steps li{{counter-increment:step;position:relative;padding:6px 0 6px 38px;margin:6px 0}}
 ol.steps li::before{{content:counter(step);position:absolute;left:0;top:6px;
   width:26px;height:26px;border-radius:50%;background:#3f789e;color:#fff;
   text-align:center;font-weight:700;line-height:26px;font-size:13px}}
 table.reftbl{{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:13px}}
 table.reftbl th, table.reftbl td{{padding:7px 9px;border-bottom:1px solid #2c2c33;
   vertical-align:top;text-align:left}}
 table.reftbl th{{background:#202026;color:#bbb;font-weight:600;
   font-size:12px;text-transform:uppercase;letter-spacing:.04em}}
 table.reftbl tr:hover td{{background:#212126}}
 table.reftbl code{{font-size:12px}}
 table.reftbl td.pp{{color:#9ad29a;font-family:monospace;font-size:12px;white-space:nowrap}}
 .rng{{color:#888;font-size:11px;margin-top:3px;font-family:monospace}}
 .pill{{display:inline-block;background:#2a2a31;color:#cdd;border:1px solid #444;
        border-radius:10px;padding:1px 9px;font-size:11px;margin:0 3px;
        font-family:monospace}}
 .pill.b{{background:#1f3a2a;color:#cfeede;border-color:#2e6b3e}}
 .pill.w{{background:#3a2a1f;color:#ffe2bd;border-color:#a4702f}}
 .pill.r{{background:#3a1f1f;color:#ffd5d5;border-color:#a44}}
 .legend{{font-size:12.5px;color:#aaa;margin:6px 0 14px}}
 .legend .pill{{margin-right:6px}}
 details.collapse{{background:#1f1f24;border:1px solid #2a2a30;border-radius:6px;
                   padding:8px 14px;margin:10px 0}}
 details.collapse summary{{cursor:pointer;font-weight:600;color:#cfd6da}}
</style></head><body>
<header class=top>
 <div><div class=t>📖 Invisible Atlas Maker — Documentation</div>
   <div class=s>by Invisible Wall SL · build {_h(BUILD)} · this page reflects the live tool</div></div>
 <a class=back href="/">← back to the tool</a>
</header>
<div class=wrap>
 <nav class=toc>
  <h4>Get started</h4>
  <a href="#overview">Overview</a>
  <a href="#quickstart">Quick start</a>
  <a href="#workflow">End-to-end workflow</a>
  <h4>UI tour</h4>
  <a href="#toolbar">Top toolbar</a>
  <a href="#globalsettings">Global settings</a>
  <a href="#atlassettings">Atlas settings</a>
  <a href="#atlasgeom">Atlas geometry</a>
  <a href="#atlasstyle">Atlas style (prompts)</a>
  <a href="#card">Region cards</a>
  <a href="#advanced">Advanced overrides</a>
  <a href="#variants">Variants modal</a>
  <a href="#modes">Region modes (AI / FX)</a>
  <a href="#shine">Local FX (shine, glow, …)</a>
  <h4>Reference</h4>
  <a href="#pipelines">Pipelines</a>
  <a href="#projects">Projects &amp; manifests</a>
  <a href="#tips">Tips &amp; gotchas</a>
  <a href="#troubleshooting">Troubleshooting</a>
 </nav>
 <main>

<h2 id=overview>Overview</h2>
<p><b>Invisible Atlas Maker</b> regenerates the per-region tiles of a game
sprite atlas with AI and composes them back into a single PNG/WebP atlas.
It is a project-agnostic tool: pick a launcher project (which decides which
ComfyUI instance and which output folders to use) and a manifest (which
defines the regions for one atlas), then generate region by region.</p>

<div class=card>
<h4 style="margin-top:0">What it can do</h4>
<ul>
 <li><b>Generate</b> every region of an atlas with SDXL, FLUX or GPT-Image-1
     (selectable per atlas, or per region).</li>
 <li><b>Steer the look</b> with style references (IPAdapter / FLUX Redux) and
     shape references (Canny ControlNet).</li>
 <li><b>Render N variants per region</b>, pick the best, lock its seed.</li>
 <li><b>Compose</b> the locked picks into the final atlas (instant, GPU-free).</li>
 <li><b>Substitute</b> any region with your own image (uploaded or referenced)
     verbatim, no AI pass.</li>
 <li><b>Build local FX</b> (shine, glow, shadow, blur, zoom, colour) directly
     from a region's source image — no ComfyUI, no credits.</li>
 <li><b>Slice</b> an existing atlas image into per-region reference crops in
     one click, to re-skin an atlas with the original art as the style guide.</li>
</ul>
</div>

<h2 id=quickstart>Quick start (5&nbsp;minutes)</h2>
<ol class=steps>
 <li>Open the <b>Invisible Launcher</b>, start ComfyUI for your target project,
     then start this tool (or run <code>run_ui.bat</code>) and open
     <a href="/">http://127.0.0.1:8765</a>.</li>
 <li>Open the <b>⚙ Global settings</b> panel, confirm the <b>Active project</b>
     and <b>Active manifest</b>. Changing project requires a
     <code>run_ui.bat</code> restart (paths resolve at startup).</li>
 <li>Pick a <b>pipeline</b> (<code>sdxl</code>, <code>flux</code> or
     <code>gpt_image</code>) and review the matching settings.</li>
 <li>In the region grid, tick the regions you want to render, set
     <b>variants/symbol</b>, and press <b>▶ Render selected</b>. Wait — the
     progress bar fills inside the button.</li>
 <li>Open <b>▦ variants</b> on each card, click the best one, then
     <b>🔒 lock this pick</b>.</li>
 <li>Click <b>🧩 Create Atlas</b>. The composed file appears in the active
     project's ComfyUI <code>output/&lt;prefix&gt;/atlas/</code> folder.</li>
</ol>
<div class=note><b>Tip.</b> You can swap any tile with your own image at any
time (<i>USE THIS IMAGE</i> on the reference, or the upload control under the
output thumbnail). The Atlas compose step picks the latest-locked variant or
your manual override automatically.</div>

<h2 id=workflow>End-to-end workflow</h2>
<ol>
 <li><b>Pick a project / manifest.</b> The manifest is the single source of
     creative truth for one atlas (region prompts, seeds, refs, overrides).</li>
 <li><b>Set the atlas style.</b> A shared positive prefix &amp; suffix wrap every
     region's prompt, and a shared SDXL negative is appended to each region.
     This is per-atlas — moving to a sibling manifest does not carry it.</li>
 <li><b>Optional: slice the original atlas → refs.</b> Lays the original art
     out into per-region style references, so the AI uses each tile's actual
     colours/finish as the style anchor.</li>
 <li><b>Generate.</b> Select regions, set variants/symbol, render. Each region
     gets N PNGs in the project's ComfyUI <code>output/&lt;prefix&gt;/</code>.</li>
 <li><b>Pick &amp; lock.</b> Open variants, click your favourite, lock. The lock
     freezes the seed (or the file id, for GPT) so re-renders are reproducible.</li>
 <li><b>Override per region (optional).</b> Replace any tile with your own
     image — uploaded or the existing reference, used verbatim.</li>
 <li><b>Create Atlas.</b> Compose the locked/latest picks into the final
     image — instant, no ComfyUI calls.</li>
 <li><b>Copy</b> the composed file into the game project's
     <code>static/assets/…</code> folder.</li>
</ol>

<!-- ---------------------------------------------------------------- TOOLBAR -->
<h2 id=toolbar>Top toolbar</h2>
<table class=reftbl><thead><tr><th>Control</th><th>What it does</th></tr></thead><tbody>
<tr><td><span class="pill b">◆ credits</span></td><td>Live comfy.org API-node
 balance (auto-refreshes). Click to open comfy.org and top up. Only relevant to
 the <code>gpt_image</code> pipeline; SDXL and FLUX run locally and cost nothing
 here.</td></tr>
<tr><td><b>▶ Render selected</b></td><td>Queue ComfyUI for every region whose
 checkbox is ticked. The button itself fills as progress advances and shows the
 current job count.</td></tr>
<tr><td><b>■ Stop</b></td><td>Cancel the active render. ComfyUI keeps running —
 only the queue from this tool is stopped.</td></tr>
<tr><td><b>variants/symbol</b></td><td>How many variants per region to generate
 in this run. Higher = more choice when picking, but proportionally more time
 and (for GPT) more credits.</td></tr>
<tr><td><b>🧩 Create Atlas</b></td><td>Compose-only pass: reads every region's
 locked / latest pick (or your override) and writes the final atlas. Instant,
 no GPU.</td></tr>
<tr><td><b>✂ Slice source → refs</b></td><td>Cuts the configured atlas source
 image into per-region crops and saves them as each region's IPAdapter / Redux
 style reference. Existing prompts &amp; seeds are kept.</td></tr>
<tr><td><b>🖼 View atlas</b></td><td>Opens the <b>Region Overlay Inspector</b>
 for the most recently composed atlas in a new tab: the page pixels with every
 manifest rect outlined (blue) and, over it, each region's <i>actual</i> art
 alpha bbox re-measured from those pixels (amber). Per region it reports the
 <b>fill ratio</b> and a verdict — <b>FILLS</b> (art reaches the rect edge on
 both axes) or <b>INSET n%</b> (art centred with a margin) — plus a summary
 counting each. Use it when the art looks different in the atlas than it did in
 the card: FILLS and INSET on one page means two composers with different rect
 conventions wrote it. Trimmed regions also show their untrimmed frame (mint,
 in the manifest's own Y-down convention). Wheel = zoom to cursor, drag = pan,
 <b>Fit</b> resets, the sidebar filters/jumps to a region and toggles each
 overlay layer.</td></tr>
<tr><td><b>💾 Save changes</b></td><td>Persists every card's prompt / seed /
 lock / negatives / replace-flags to the manifest. Generation auto-saves what
 it needs — use this for prompt edits etc.</td></tr>
<tr><td><b>Select all / none</b></td><td>Bulk-tick the per-card render
 checkboxes.</td></tr>
<tr><td><b>📖 Docs</b></td><td>This page.</td></tr>
</tbody></table>

<div class=note><b>Background concept — the lock.</b> A lock is an explicit
commitment. Browsing variants does <i>not</i> implicitly lock; you have to
click <b>🔒 lock this pick</b> (or tick the lock checkbox). When locked,
re-renders use exactly that seed (or that file id for GPT).</div>

<!-- ---------------------------------------------------------- GLOBAL CONFIG -->
<h2 id=globalsettings>Global settings <span class=pill>atlas_config.json</span></h2>
<p>The <b>⚙ Global settings</b> panel is the shared default for every atlas in
this tool. Anything you set here applies unless an atlas or a region
overrides it. Pipeline selection lives here too: changing the pipeline swaps
which group of model fields is visible.</p>

<div class=legend>
 <span class="pill">any</span> shown for every pipeline
 <span class="pill">sdxl + flux</span> local ComfyUI pipelines only
 <span class="pill">SDXL only</span> hidden in FLUX / GPT
 <span class="pill">FLUX only</span> hidden in SDXL / GPT
 <span class="pill">gpt_image only</span> only when GPT is selected
</div>

{global_tbl}

<h3 id=atlassettings>Per-atlas overrides</h3>
<p>The <b>🧩 Atlas settings</b> panel is the same fields, but the values are
saved inside the current manifest. <b>Blank&nbsp;=&nbsp;inherit the global
value.</b> Use this when one atlas (say, a UI sheet) needs a different
checkpoint, padding or sampler than the rest of the project.</p>

{peratlas_tbl}

<h3 id=atlasgeom>Atlas geometry</h3>
<p>Stored in the manifest's <code>atlas</code> block. When a Spine/libGDX
<code>.atlas</code> file is bound here, every region's geometry is read from
it and the cell-grid fields below are ignored.</p>

{geom_tbl}

<!-- ---------------------------------------------------------- ATLAS STYLE -->
<h2 id=atlasstyle>Atlas style — shared prompts</h2>
<p>This panel lives <i>inside the manifest</i> (key <code>style.*</code>),
so each atlas keeps its own prefix / suffix / negative. The final positive
prompt sent to ComfyUI is built as:</p>
<div class=card><code>style.positive_prefix + region.prompt + style.positive_suffix</code></div>
<p>The negative starts from <code>style.negative</code> and the per-region
negative is <b>appended</b> to it. You can also tick the per-card checkbox to
have a region's text <b>replace</b> the atlas-level positive or negative
instead of being combined.</p>
<div class=warn><b>FLUX ignores negatives.</b> The Atlas Style negative box
and the per-card negative are SDXL-only — when FLUX is the active pipeline,
both boxes are hidden.</div>

<!-- ---------------------------------------------------------------- CARDS -->
<h2 id=card>Region cards</h2>
<p>Every region in the manifest renders as a card. From left to right, top to
bottom, here's what each control does.</p>

<h3>Header row</h3>
<ul>
 <li><b>Checkbox</b> — include this region in the next <b>▶ Render selected</b>
     run. Use <i>Select all / none</i> to bulk-toggle.</li>
 <li><b>Region name</b> + <i>fruit</i> tag — what the manifest calls this
     region; the fruit/role is a hint, not used by the generator.</li>
 <li><b>⧉ copy</b> / <b>📥 paste</b> — copy this card's settings (prompt,
     advanced overrides, FX params) and paste them into another card. The
     reference image, seed and lock are <i>not</i> copied — they're per-tile.</li>
 <li><b>Mode selector</b> — see <a href="#modes">Region modes</a> below.</li>
</ul>

<h3>Output picture (left)</h3>
<ul>
 <li>The big tile is this region's <i>current</i> output: the locked variant,
     the latest variant, or your manual image override.</li>
 <li><b>Hover</b> to zoom (2.4×). The top &amp; bottom 20% are guard strips
     that don't zoom — that's how the <i>▦ variants</i> button stays clickable.</li>
 <li><b>▦ variants</b> — open the variants modal for this region (see
     <a href="#variants">Variants modal</a>).</li>
 <li><b>Caption</b> shows the seed embedded in the picked variant (or
     <i>★ your image · NOT processed</i> if you've manually overridden the
     tile).</li>
 <li><b>📁 file picker / ✕</b> below the output — pick a local image to use
     <i>as the final atlas tile, verbatim</i> (no AI, no RMBG). ✕ reverts the
     override so the region is generated again on the next run.</li>
</ul>

<h3>Reference picture (right)</h3>
<ul>
 <li>The reference is the region's IPAdapter (SDXL) / Redux (FLUX) style
     source, or — if a <code>shape_ref</code> is set — its Canny silhouette.
     The caption tells you which kind is in use.</li>
 <li><b>USE THIS IMAGE</b> (hover overlay) — adopt the reference itself as
     the final atlas tile, verbatim. Use this when you want to keep an existing
     piece of art unchanged.</li>
 <li><b>📁 file picker / ✕</b> below — replace the reference image (e.g. drop
     in a new style source) or clear it.</li>
</ul>

<h3>Seed row</h3>
<ul>
 <li><b>Current Seed</b> — the seed to use on the next render. Leave blank for
     a random one.</li>
 <li><b>lock</b> — when ticked, the seed is committed; re-renders use exactly
     this value. <i>Browsing</i> variants doesn't auto-lock; click
     <b>🔒 lock this pick</b> (appears next to the lock checkbox once you've
     chosen a variant) to commit it.</li>
 <li>For <b>gpt_image</b> there is no seed — the lock binds to the chosen
     variant's file id instead.</li>
</ul>

<h3>📝 Extra prompts</h3>
<ul>
 <li><b>Positive — region prompt</b>: the text spliced between the atlas
     prefix and suffix. Keep it specific to <i>this</i> tile; let the prefix
     handle shared style.</li>
 <li><b>Replace atlas positive</b>: ignore prefix/suffix for this region and
     use only the textbox above.</li>
 <li><b>Negative — region</b> (SDXL only): appended to the atlas-wide negative.</li>
 <li><b>Replace atlas negative</b>: use only the box above, ignore the atlas
     negative.</li>
 <li><b>GPT instruction</b> (gpt_image only): the edit instruction sent to
     GPT-Image, e.g. <i>"make the skin look like a watermelon"</i>.</li>
</ul>

<h3>⚙ advanced</h3>
<p>Opens the per-region override popup. Empty fields inherit the
global/per-atlas value. See the <a href="#advanced">full reference</a>.</p>

<!-- ------------------------------------------------------------ ADVANCED -->
<h2 id=advanced>Advanced overrides (per region)</h2>
<p>Anything you tweak here is stored on the region and overrides the
atlas/global defaults <i>just for that tile</i>. Same visibility rule as the
Settings panel: a field only shows when its pipeline group matches the
region's effective pipeline.</p>
{adv_tbl}

<!-- ------------------------------------------------------------ VARIANTS -->
<h2 id=variants>Variants modal</h2>
<p>Opens with <b>▦ variants</b> on a card. Lists every PNG ComfyUI has produced
for that region, newest first.</p>
<ul>
 <li><b>Click a thumbnail</b> — select it as this region's pick. Once committed
     (via <b>🔒 lock this pick</b>) the Atlas compose step will use exactly
     this image.</li>
 <li><b>Checkboxes</b> + <b>🗑 Delete checked</b> — remove unwanted variants
     from disk (cleans up the ComfyUI output folder).</li>
 <li>Each thumbnail shows its <b>seed</b> (read from the PNG metadata) so you
     know what to reproduce.</li>
</ul>

<!-- --------------------------------------------------------------- MODES -->
<h2 id=modes>Region modes — AI vs local FX</h2>
<p>Each card has a mode selector. The default is <b>AI gen</b> (uses the
pipeline). The other modes generate the tile <i>locally</i> from the region's
source image — no ComfyUI, no credits:</p>
<ul>
 <li><b>Colour</b> — recolour the source.</li>
 <li><b>Shadow</b> — soft silhouette blob (for drop-shadows under symbols).</li>
 <li><b>Shine</b> — extract the bright pixels into an additive highlight layer.</li>
 <li><b>Glow</b> — base glyph + tinted halo grown from its silhouette.</li>
 <li><b>Blur</b> — gaussian, horizontal, vertical or box softening.</li>
 <li><b>Zoom</b> — radial-burst around a centre point.</li>
</ul>

<h3 id=shine>Tuning FX</h3>
<p>When a card is in an FX mode, a slim row of controls replaces the prompt /
seed area:</p>
<ul>
 <li>Each parameter is a number / colour / dropdown with sensible defaults
     and a tooltip describing it.</li>
 <li><b>⚙ build <i>&lt;mode&gt;</i></b> rebuilds this region's tile from its
     source with the current settings. Re-runs are instant.</li>
 <li>FX cards do not consume the render queue and do not need ComfyUI to be
     running.</li>
</ul>

<!-- ------------------------------------------------------------ PIPELINES -->
<h2 id=pipelines>Pipelines</h2>
<div class=card>
<h4 style="margin-top:0">sdxl</h4>
<p>Local ComfyUI: SDXL checkpoint + LoRA + IPAdapter + ControlNet. The original
pipeline. Best when you have a strong LoRA for the project style. Supports
positive <i>and</i> negative prompts.</p>
</div>
<div class=card>
<h4 style="margin-top:0">flux</h4>
<p>Local ComfyUI: FLUX UNet/CLIP/VAE + FluxGuidance + FLUX LoRA + Redux
(FLUX's style-reference) + FLUX ControlNet. Strong prompt adherence and better
text/typography than SDXL. <b>Negatives are ignored.</b> Models are not
interchangeable with SDXL — use a FLUX checkpoint and a FLUX ControlNet/LoRA.</p>
</div>
<div class=card>
<h4 style="margin-top:0">gpt_image</h4>
<p>OpenAI <b>GPT-Image-1</b> via ComfyUI's API node. <b>Edits</b> a reference
image (the slot's style_ref) according to a natural-language instruction.
Excellent at typography and at preserving the input's composition. Costs
comfy.org credits and needs a comfy.org API key in Settings. Almost always
returns an opaque image — keep <b>RMBG</b> on so the tile composes with clean
alpha.</p>
</div>

<!-- ------------------------------------------------------- PROJECTS / MFST -->
<h2 id=projects>Projects &amp; manifests</h2>
<ul>
 <li>The <b>Active project</b> dropdown lists every entry in the Invisible
     Launcher's <code>comfyui_manager_config.json</code>. The selected project
     decides which ComfyUI host:port to talk to and where outputs / refs live.</li>
 <li>Switching project <b>requires a <code>run_ui.bat</code> restart</b> —
     paths resolve at server start.</li>
 <li>The <b>Active manifest</b> dropdown lists every
     <code>atlas_manifest_*.json</code> next to the tool, plus any
     <code>.atlas</code> file. Switching manifest reloads the cards live (no
     restart).</li>
 <li>When you pick a bare <code>.atlas</code>, the tool auto-creates a sibling
     JSON manifest to store creative edits (prompts/seeds/refs) so nothing is
     lost.</li>
</ul>

<!-- ----------------------------------------------------------- TIPS / GOT -->
<h2 id=tips>Tips &amp; hard-won gotchas</h2>
<ul>
 <li><b>SDXL is unreliable at digits/text.</b> Use a <code>shape_ref</code>
     (Canny) for 7s, badges, wordmarks; composite multipliers / scatter text
     in Photoshop afterwards with the project bitmap fonts.</li>
 <li><b>Negatives can "pink-elephant".</b> Saying <i>"NOT a plate"</i> can
     summon a plate. Prefer positive phrasing: <i>"single isolated subject on
     transparent background"</i>.</li>
 <li><b>Rigid shape_ref + tight prompt + high IPAdapter = low seed variance.</b>
     If every variant looks the same, lower <code>controlnet_strength</code>,
     drop the <code>shape_ref</code> for that region, or loosen
     <code>ipadapter_weight</code>.</li>
 <li><b>Lock is explicit.</b> Browsing variants never auto-locks. To freeze a
     pick: <b>🔒 lock this pick</b> or tick the lock box.</li>
 <li><b>Copy/paste settings</b> across cards with <b>⧉</b> / <b>📥</b>: prompt,
     advanced and FX values transfer; reference, seed and lock do not (those
     are tile-specific by design).</li>
 <li><b>Save changes</b> only persists the editable fields (prompt / seed /
     lock / negatives). Reference uploads, USE THIS IMAGE, the variants picker
     and FX builds save themselves immediately on click.</li>
 <li>Variant filenames look like <code>region_00012_.png</code>. Region names
     can contain underscores (<code>m1_2x</code>) — the tool parses the trailing
     digit group, not split('_')[1].</li>
</ul>

<!-- ---------------------------------------------------------- TROUBLESHOOT -->
<h2 id=troubleshooting>Troubleshooting</h2>
<details class=collapse><summary>"Cannot reach ComfyUI"</summary>
<p>ComfyUI isn't running on the host:port this tool resolved for the active
project. Open the Invisible Launcher and start the project's ComfyUI, or
check <code>comfy_host</code> in <b>⚙ Global settings</b>.</p>
</details>
<details class=collapse><summary>Credits chip is red / says "n/a"</summary>
<p>The comfy.org billing endpoint is unreachable or your API key is missing.
Only the <code>gpt_image</code> pipeline needs credits; SDXL and FLUX run
locally and ignore this.</p>
</details>
<details class=collapse><summary>I changed project, nothing updated</summary>
<p>Restart <code>run_ui.bat</code>. Paths to ComfyUI dirs are resolved when
the server starts.</p>
</details>
<details class=collapse><summary>"Slice endpoint missing — restart run_ui.bat"</summary>
<p>You opened the page against an older server process. Restart
<code>run_ui.bat</code> and reload.</p>
</details>
<details class=collapse><summary>Every variant looks identical</summary>
<p>You're over-constraining. Try (in order): drop <code>controlnet_strength</code>
to ~0.6, lower <code>ipadapter_weight</code> to ~0.4, clear the
<code>shape_ref</code> for that region, or widen the region prompt.</p>
</details>
<details class=collapse><summary>FLUX results ignore my negative prompt</summary>
<p>That's by design — FLUX has no classifier-free guidance in the SDXL sense
and ignores negatives. The atlas-style negative box is hidden when the active
pipeline is FLUX; if you see it, the pipeline is still SDXL.</p>
</details>
<details class=collapse><summary>I killed Python and ComfyUI died too</summary>
<p>ComfyUI shares the embedded Python process. To stop only this UI, close
its console window or kill port <code>8765</code> — never blanket-kill
<code>python.exe</code>.</p>
</details>

<p style="margin:36px 0 0;color:#888;font-size:12px">
 Per-setting descriptions on this page are pulled live from the same
 dictionaries the tool uses for its hover tooltips, so they stay in sync as
 the tool grows. Edit narrative sections in
 <code>tools/Invisible Atlas Maker/docs.py</code>; edit a setting's
 description in <code>ui_server.SETTING_HELP</code> /
 <code>ui_server.ADV_TIPS</code>.</p>

 </main>
</div>
<script>
 // Highlight the TOC entry whose section is closest to the top of the view.
 const sects = [...document.querySelectorAll('main h2, main h3[id]')];
 const links = [...document.querySelectorAll('nav.toc a')];
 const byHash = Object.fromEntries(links.map(a => [a.getAttribute('href').slice(1), a]));
 function onScroll() {{
   let top = window.scrollY + 90;
   let cur = sects[0]; for (const s of sects) {{ if (s.offsetTop <= top) cur = s; }}
   links.forEach(a => a.classList.remove('act'));
   const act = cur && byHash[cur.id]; if (act) act.classList.add('act');
 }}
 document.addEventListener('scroll', onScroll, {{ passive: true }});
 onScroll();
</script>
</body></html>"""
