"""iw_common.splash — the shared CRT boot splash (instant first byte).

Extracted from the Atlas Maker's ``ui_server.py`` so every "Invisible …" tool
gets the same boot experience. The contract:

  - The tool serves ``splash_html(...)`` for ``GET /`` when ``fast=1`` is NOT
    in the query — IMMEDIATELY, before any slow startup work (R2 hydration,
    heavy index render). The splash is a tiny static page → instant first byte.
  - The splash JS background-fetches the real UI at ``?fast=1`` (built from
    ``location.search`` so client/project params and cookies ride along,
    ``credentials:'same-origin'``) while a CRT typewriter plays. ONE real
    render total.
  - ``ready()`` = (uiHtml||uiErr) && elapsed >= MIN_SPLASH_MS (1400 ms floor
    so the logo still plays on warm loads). When ready, the fetched HTML is
    swapped in via ``document.open()/write()/close()`` — no second navigation.
  - ``history.replaceState(null,'',target)`` puts ``?fast=1`` in the address
    bar first, so any later ``location.reload()`` in the real UI keeps
    ``fast=1`` and skips the splash, and Back never lands on the splash.
  - Fetch failure → FATAL screen; empty body → error.

Authoring gotchas (do not regress):
  - The template is a PLAIN Python string — never run ``.format()`` on it
    (the JS body is full of single braces). Substitution is targeted
    ``str.replace()`` on ``__IW_*__`` tokens only.
  - NO bare apostrophes inside single-quoted JS strings (a known bug class:
    Python source escapes eat the backslash). Injected text is therefore
    emitted via ``json.dumps`` (double-quoted, fully escaped).

This module imports nothing from the tools — stdlib only.
"""
from __future__ import annotations

import html as _html
import json as _json

# Default WORK pool — the original Atlas Maker phrases, so the Atlas tool's
# splash behavior is unchanged when no pool is passed. Lines are typed as
# "> <phrase> ....... [ OK ]". Keep them apostrophe-free.
DEFAULT_PHRASES = [
    "Heating cathode-ray tube",
    "Allocating phosphor buffer",
    "Calibrating scanlines",
    "Reading atlas_config.json",
    "Resolving active project",
    "Negotiating with ComfyUI",
    "Walking manifest directory",
    "Parsing region geometry",
    "Indexing prior variants",
    "Verifying seed integrity",
    "Cross-checking shape references",
    "Probing GPU memory",
    "Warming up Stable Diffusion",
    "Linking IPAdapter weights",
    "Aligning rim-light vectors",
    "Polishing 3D fruit shaders",
    "Loading LoRA: gameIconInstitute3d",
    "Loading LoRA: Y2K TYPEFACE FLUX",
    "Reticulating splines",
    "Hydrating UI state",
    "Refreshing comfy.org credit chip",
    "Composing region grid",
    "Defragmenting pixel cache",
    "Tuning mascot: watermelon (shades)",
    "Tuning mascot: orange (bow tie)",
    "Brewing fresh phosphor green",
    "Sharpening Canny edges",
    "Computing optimal seed lattice",
    "Sweeping ControlNet latent space",
    "Inflating PNG decompressor",
    "Greasing the atlas packer",
    "Lighting up neon-purple frame",
    "Asking the slot machine for luck",
    "Waking subprocess.Popen",
    "Annealing the random generator",
]


# PLAIN string template (no .format()!). Substituted tokens:
#   __IW_TITLE__     — HTML-escaped <title> text
#   __IW_WORDMARK__  — JSON string literal: the LOGO wordmark line
#   __IW_WORK__      — the WORK array entries (one {pre,tail} object per line)
_TEMPLATE = """<!doctype html><html><head><meta charset="utf-8">
<title>__IW_TITLE__</title>
<style>
 html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
 body{font-family:'Consolas','Courier New','Lucida Console',monospace;
      color:#33ff66;font-size:15px;line-height:1.45;
      text-shadow:0 0 1px #33ff66,0 0 6px rgba(51,255,102,.55)}
 .crt{position:relative;width:100%;height:100%;padding:36px 44px;box-sizing:border-box;
      overflow:hidden}
 /* phosphor scanlines */
 .crt::before{content:"";position:absolute;inset:0;pointer-events:none;
   background:repeating-linear-gradient(0deg,
     rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,
     rgba(0,0,0,.18) 3px,rgba(0,0,0,.18) 4px);
   mix-blend-mode:multiply;z-index:2}
 /* vignette + curvature hint */
 .crt::after{content:"";position:absolute;inset:0;pointer-events:none;
   background:radial-gradient(ellipse at center,
     rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%);z-index:3}
 .scr{position:relative;z-index:1;white-space:pre-wrap;word-break:break-word}
 .ttl{font-size:18px;font-weight:bold;letter-spacing:2px}
 .dim{opacity:.55}
 .ok{color:#9cff9c}
 .err{color:#ff6e6e;text-shadow:0 0 6px rgba(255,80,80,.6)}
 .cur{display:inline-block;width:.55em;height:1em;vertical-align:-2px;
      background:#33ff66;box-shadow:0 0 6px #33ff66;
      animation:blink 1s steps(1) infinite}
 @keyframes blink{50%{opacity:0}}
 /* subtle CRT power-on flash */
 @keyframes power{0%{opacity:0;transform:scaleY(.02)}
                  40%{opacity:1;transform:scaleY(1)}
                  100%{opacity:1;transform:scaleY(1)}}
 .crt{animation:power .55s ease-out 1}
</style></head>
<body><div class="crt"><pre class="scr" id="scr"></pre></div>
<script>
(function(){
 const scr=document.getElementById('scr');

 // ASCII logo — mirrors the Invisible Wall corner-bracket emblem
 // (heavy box-drawing ┏━ / ┃) with the wordmark inset. Revealed line by
 // line at startup, then the typewriter runs underneath it.
 const LOGO=[
  "",
  "   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "   ┃",
  "   ┃    I N V I S I B L E   W A L L   S L",
  "   ┃    ─────────────────────────────────────",
  __IW_WORDMARK__,
  "   ┃",
  ""
 ];

 // Brief intro + dateline. Always plays in full.
 const INTRO=[
  {pre:"BIOS POST 1981  ·  640K base  ·  64512K extended free", cls:"dim"},
  {pre:"(c) Invisible Wall SL  ·  terminal mode",               cls:"dim"},
  {pre:""}
 ];
 // Looping pool. Typed in sequence, restarts at the top if the real UI
 // hasn't arrived yet — so the screen stays alive however long the boot
 // takes. Mix of real-ish probes, tool-themed work, and BBS-era flavor.
 const WORK=[
__IW_WORK__
 ];

 // Fetch the real UI in the background while the splash types — ONE
 // server-side render total. (The old readiness probe fetched the heavy
 // page AND then navigated to it, so every cold start rendered it twice;
 // the fixed-timer replacement then froze the splash during the slow
 // navigation. This does neither: fetch once, swap the document in.)
 const _qp=new URLSearchParams(location.search);
 _qp.set('fast','1');
 const target='?'+_qp.toString();
 const MIN_SPLASH_MS=1400;   // hard floor so the logo still plays on warm loads
 const splashStart=Date.now();
 let uiHtml=null;
 let uiErr=null;
 fetch(target,{credentials:'same-origin'})
   .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
   .then(t=>{ if(!t) throw new Error('empty UI response'); uiHtml=t; })
   .catch(e=>{ uiErr=String(e&&e.message||e); });
 const ready=()=>(uiHtml!==null||uiErr!==null)&&(Date.now()-splashStart)>=MIN_SPLASH_MS;

 const CURSOR='<span class="cur"></span>';
 const FILL=44;        // column at which [ OK ] right-aligns
 const TICK_MIN=28,TICK_MAX=46;  // jittered per char so it feels human
 const DOT=14;
 const PAUSE_MIN=120,PAUSE_MAX=260;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const jitter=(lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
 const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

 // Render = committed lines + the live in-progress line + cursor.
 const lines=[];
 let live='';
 // Auto-scroll the screen as content grows past one viewport.
 function paint(){
  scr.innerHTML=lines.join('\\n')+(lines.length?'\\n':'')+live+CURSOR;
  window.scrollTo(0,document.body.scrollHeight);
 }

 // (ready() is defined up top — true once the background fetch has
 // settled AND MIN_SPLASH_MS has elapsed. typeLine() / run() consult it
 // to bail out of typing as soon as we can swap the real UI in, so the
 // splash never overstays its welcome.)

 async function typeLine(p){
  const text=p.pre||'';
  const cls=p.cls||'';
  const open=cls?'<span class="'+cls+'">':'';
  const close=cls?'</span>':'';
  live='';
  for(let i=0;i<text.length;i++){
   if(ready()){ // commit what's typed so far, bail.
    if(i>0){ lines.push(open+esc(text.slice(0,i))+close); }
    live=''; paint(); return;
   }
   live=open+esc(text.slice(0,i+1))+close;
   paint();
   await sleep(jitter(TICK_MIN,TICK_MAX));
  }
  if(typeof p.tail!=='undefined'){
   const pad=Math.max(3,FILL-text.length);
   let dots='';
   for(let i=0;i<pad;i++){
    if(ready()){
     lines.push(open+esc(text)+close+dots);
     live=''; paint(); return;
    }
    dots+='.';
    live=open+esc(text)+close+dots;
    paint();
    await sleep(DOT);
   }
   if(p.tail){
    live=open+esc(text)+close+dots+' [ <span class="ok">'+esc(p.tail)+'</span> ]';
    paint();
   }
  }
  lines.push(live);
  live='';
  paint();
  // Inter-line pause is the *worst* place to be slow once fetch is in —
  // skip the pause entirely when ready.
  if(!ready()) await sleep(jitter(PAUSE_MIN,PAUSE_MAX));
 }

 // Pool iterator that yields lines indefinitely, shuffling each cycle so a
 // long boot doesn't show the exact same sequence twice.
 function* poolForever(arr){
  const a=arr.slice();
  while(true){
   for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
   }
   for(const x of a) yield x;
  }
 }

 (async function run(){
  // Reveal the ASCII logo line by line — fast, no typewriter (block chars
  // would look noisy typed). Brief stagger so it draws in like a CRT
  // refresh sweep rather than blinking in all at once. Skip the per-line
  // pause once the fetch is in, so we never linger.
  for(const ln of LOGO){
   lines.push('<span class="ttl">'+esc(ln)+'</span>');
   paint();
   if(ready()) break;
   await sleep(55);
  }
  if(!ready()){
   for(const p of INTRO){ if(ready()) break; await typeLine(p); }
  }
  if(!ready()){
   const gen=poolForever(WORK);
   while(!ready()){
    const {value}=gen.next();
    await typeLine(value);
   }
  }
  if(uiErr){
   lines.push('');
   lines.push('<span class="err">&gt; FATAL: '+esc(uiErr)+'</span>');
   lines.push('<span class="dim">Check the launcher console and retry.</span>');
   paint();
   return;
  }
  // Swap the already-fetched UI HTML into this document — no second
  // navigation, no second server render. The page was fetched with
  // `?fast=1` (in the background, up top); history.replaceState puts that
  // URL in the address bar so any subsequent location.reload() in the UI
  // (e.g. Save Settings) keeps fast=1 and skips the splash, and the splash
  // never sits in history (Back button skips it). `target` preserves the
  // existing query params (home, sibling, and the editor deep-link's
  // atlas/region) so the real UI still sees them.
  history.replaceState(null,'',target);
  document.open(); document.write(uiHtml); document.close();
 })();
})();
</script></body></html>"""


def splash_html(tool_name: str, *, version: str = "v1.0",
                phrases: list[str] | None = None) -> str:
    """Render the CRT boot splash for one tool.

    ``tool_name`` — e.g. ``"ATLAS MAKER"``; letter-spaced into the wordmark
    (``A T L A S   M A K E R``) and title-cased into the ``<title>``.
    ``phrases`` — the WORK pool (plain phrase strings, no ``"> "`` prefix);
    defaults to the Atlas Maker pool. All injected text is escaped for its
    context (json.dumps for JS, html.escape for the title) even though it is
    authored constants.
    """
    name = " ".join((tool_name or "").split()).upper()
    if not name:
        raise ValueError("tool_name must be a non-empty string")
    pool = [str(p) for p in (DEFAULT_PHRASES if phrases is None else phrases)]
    if not pool:
        raise ValueError("phrases must be non-empty when given")

    def _js(s: str) -> str:
        # JSON-escape for a JS string context; also break "</" so an authored
        # value can never terminate the inline <script> block.
        return _json.dumps(s, ensure_ascii=False).replace("</", "<\\/")

    spaced = "   ".join(" ".join(word) for word in name.split(" "))
    wordmark = f"   ┃    {spaced}     ·     {version}"
    title = f"Invisible {name.title()} — booting…"
    work = ",\n".join(
        "  {pre:" + _js("> " + p) + ", tail:\"OK\"}"
        for p in pool)

    return (_TEMPLATE
            .replace("__IW_TITLE__", _html.escape(title))
            .replace("__IW_WORDMARK__", _js(wordmark))
            .replace("__IW_WORK__", work))
