// GENERATED — do not edit. Source: services/_shared/iw_common/ask_ai.js
// Regenerate: node scripts/sync-ask-ai.mjs   (CI/gate check: --check)
// "Ask the AI" for the HTML tool-bar twins — the twin of the launcher's $lib/AskAiPanel.svelte
// (keep the two looking and behaving alike). `iwAskAi.mount(cfg)` adds the button before
// "Report bug" and opens a floating chat window: dragged by its title bar, put away only by its
// own Minimize / Close buttons. `cfg.endpoint` is where questions go: the Atlas and Sheet Maker
// post to their own `/ask-ai`, which relays them to the launcher (iw_common/ask_ai.py); the
// Rigger, served by the launcher, posts to `/api/ask-ai` directly (its copy is
// static/shared/ask-ai.js, from scripts/sync-ask-ai.mjs). Chat per tool in sessionStorage; the
// window's place in localStorage (per site, so the launcher and each tool remember it apart).
window.iwAskAi = (function () {
  var CSS =
    '.iw-ask{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border-radius:8px;border:1px solid #2a3150;background:none;color:#9ab8ff;font:inherit;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}' +
    '.iw-ask:hover,.iw-ask.on{background:#1a2038;border-color:#3b5290}' +
    '.iw-ask svg{width:16px;height:16px}' +
    '.iw-askw{position:fixed;z-index:9000;display:flex;flex-direction:column;width:min(400px,calc(100vw - 24px));height:min(540px,calc(100vh - 24px));border:1px solid #2c2c38;border-radius:10px;background:#121218;color:#e8e8ee;box-shadow:0 12px 40px rgba(0,0,0,.55);font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;text-align:left}' +
    '.iw-askw.min{height:auto}.iw-askw.min .iw-askb{display:none}' +
    '.iw-askw header{display:flex;align-items:center;gap:6px;flex:none;padding:8px 8px 8px 12px;background:#0f0f14;border-bottom:1px solid #1c1c24;cursor:move;user-select:none;touch-action:none}' +
    '.iw-askw .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#9ab8ff}' +
    '.iw-askw .t span{font-weight:600;color:#888}' +
    '.iw-askw header button{flex:none;padding:3px 8px;border-radius:6px;border:1px solid #2c2c38;background:#1b1b22;color:#b9b9c4;font:inherit;font-size:12px;cursor:pointer}' +
    '.iw-askw header button.i{width:26px;padding:3px 0}' +
    '.iw-askw header button:hover{color:#e8e8ee;border-color:#3a3a48}' +
    '.iw-askb{display:flex;flex-direction:column;flex:1;min-height:0}' +
    '.iw-askw .log{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}' +
    '.iw-askw .hint,.iw-askw .note{margin:0;color:#888;line-height:1.45}' +
    '.iw-askw .note{flex:none;padding:0 12px 8px;font-size:11px;color:#666}' +
    '.iw-askw .m{max-width:92%;padding:8px 11px;border-radius:9px;line-height:1.5;overflow-wrap:anywhere}' +
    '.iw-askw .m.u{align-self:flex-end;background:#1f2a44;white-space:pre-wrap}' +
    '.iw-askw .m.a{align-self:flex-start;background:#1b1b22}' +
    '.iw-askw .m.a p,.iw-askw .m.a ul,.iw-askw .m.a ol{margin:0 0 6px}' +
    '.iw-askw .m.a>:last-child{margin-bottom:0}' +
    '.iw-askw .m.a ul,.iw-askw .m.a ol{padding-left:20px}' +
    '.iw-askw .m.a code{font-family:ui-monospace,monospace;font-size:12px;background:#26262f;padding:1px 4px;border-radius:4px}' +
    '.iw-askw .m.a pre{overflow-x:auto;background:#26262f;padding:8px;border-radius:6px;margin:0 0 6px}' +
    '.iw-askw .m.a pre code{padding:0;background:none}' +
    '.iw-askw .m.a a{color:#7ee0c0}' +
    '.iw-askw .wait{color:#888}.iw-askw .fail{margin:0;color:#ff8a8a}' +
    '.iw-askw form{display:flex;gap:8px;flex:none;padding:10px 12px 6px;border-top:1px solid #1c1c24;margin:0}' +
    '.iw-askw textarea{flex:1;resize:none;padding:7px 9px;border-radius:8px;border:1px solid #2c2c38;background:#0f0f14;color:#e8e8ee;font:inherit}' +
    '.iw-askw textarea:focus{outline:none;border-color:#4a5f9a}' +
    '.iw-askw form button{flex:none;align-self:flex-end;padding:7px 12px;border-radius:8px;border:1px solid #2c2c38;background:#1b1b22;color:#e8e8ee;font:inherit;font-weight:600;cursor:pointer}' +
    '.iw-askw form button.s{background:#2a3b66;border-color:#3b5290}' +
    '.iw-askw form button:disabled{opacity:.5;cursor:default}';
  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4"/><path d="M12 14.2v.01"/></svg>';
  var MAX_CHARS = 8000;
  var MARGIN = 12;
  var PLACE_KEY = 'iw-ask-ai:place';

  function read(store, key) {
    try { var raw = window[store].getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function write(store, key, value) {
    try { window[store].setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
  }
  // The longest alternating question/answer run that ends on an answer: a chat closed mid-answer
  // must not keep its unanswered question, or the next one is refused (turns must alternate).
  function settled(list) {
    var out = [];
    (Array.isArray(list) ? list : []).every(function (m, i) {
      var ok = m && typeof m.content === 'string' && m.role === (i % 2 ? 'assistant' : 'user');
      if (ok) out.push({ role: m.role, content: m.content });
      return ok;
    });
    if (out.length % 2) out.pop();
    return out;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A small Markdown subset (what the answers use: paragraphs, lists, headings, code, bold,
  // italics, links). Everything is escaped first, so the model's text is never markup.
  function inline(text, launcher) {
    var codes = [];
    var s = esc(text).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\uE000' + (codes.length - 1) + '\uE000'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (all, label, href) {
      href = href.replace(/&amp;/g, '&');
      if (/^\/(?!\/)/.test(href)) href = launcher + href;
      else if (!/^https?:\/\//.test(href)) return label;
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return s.replace(/\uE000(\d+)\uE000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }
  function render(md, launcher) {
    var out = [];
    var parts = md.split(/^```[^\n]*\n?/m);
    parts.forEach(function (part, n) {
      if (n % 2) { out.push('<pre><code>' + esc(part.replace(/\n$/, '')) + '</code></pre>'); return; }
      var list = null, para = [];
      function flushPara() { if (para.length) out.push('<p>' + para.join('<br>') + '</p>'); para = []; }
      function flushList() { if (list) out.push('<' + list.tag + '>' + list.items.join('') + '</' + list.tag + '>'); list = null; }
      part.split('\n').forEach(function (line) {
        var m;
        if (!line.trim()) { flushPara(); flushList(); return; }
        if ((m = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line))) {
          var tag = /\d/.test(m[1]) ? 'ol' : 'ul';
          flushPara();
          if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
          list.items.push('<li>' + inline(m[2], launcher) + '</li>');
          return;
        }
        flushList();
        if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { flushPara(); out.push('<p><strong>' + inline(m[1], launcher) + '</strong></p>'); return; }
        para.push(inline(line, launcher));
      });
      flushPara(); flushList();
    });
    return out.join('');
  }

  function mount(cfg) {
    var bar = document.querySelector('.iw-toolbar');
    if (!bar || document.getElementById('iw-ask')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'iw-ask';
    btn.className = 'iw-ask';
    btn.title = 'Ask the AI how to do something in ' + cfg.toolName;
    btn.innerHTML = ICON + '<span>Ask the AI</span>';
    bar.insertBefore(btn, document.getElementById('iw-report'));

    var chatKey = 'iw-ask-ai:chat:' + cfg.tool;
    var messages = settled(read('sessionStorage', chatKey));
    var win = null, els = {}, busy = false, pending = '', controller = null, chatId = 0;
    var place = read('localStorage', PLACE_KEY) || { x: window.innerWidth - 400 - MARGIN * 2, y: 72 };

    function clamp() {
      if (!win) return;
      var w = win.offsetWidth, h = els.head.offsetHeight;
      place.x = Math.min(Math.max(MARGIN, place.x), Math.max(MARGIN, window.innerWidth - w - MARGIN));
      place.y = Math.min(Math.max(MARGIN, place.y), Math.max(MARGIN, window.innerHeight - h - MARGIN));
      win.style.left = place.x + 'px';
      win.style.top = place.y + 'px';
    }

    function paint() {
      var html = '';
      if (!messages.length && !busy) {
        html += '<p class="hint">Ask how to do something in ' + esc(cfg.toolName) +
          ' — for example “How do I start?” or “What does this panel do?”. Answers come from the ' +
          esc(cfg.toolName) + ' guide.</p>';
      }
      messages.forEach(function (m) {
        html += m.role === 'user'
          ? '<div class="m u">' + esc(m.content) + '</div>'
          : '<div class="m a">' + render(m.content, cfg.launcher) + '</div>';
      });
      if (busy) html += '<div class="m a">' + (pending ? render(pending, cfg.launcher) : '<span class="wait">Thinking…</span>') + '</div>';
      if (els.failure) html += '<p class="fail">' + esc(els.failure) + '</p>';
      els.log.innerHTML = html;
      els.log.scrollTop = els.log.scrollHeight;
      els.newChat.hidden = !messages.length;
      els.send.textContent = busy ? 'Stop' : 'Send';
      els.send.className = busy ? '' : 's';
      els.send.disabled = !busy && !els.input.value.trim();
    }

    function save() { write('sessionStorage', chatKey, messages); }

    function send() {
      var question = els.input.value.trim();
      if (!question || busy) return;
      els.input.value = '';
      els.failure = '';
      messages.push({ role: 'user', content: question });
      busy = true;
      pending = '';
      var thisChat = chatId;
      controller = new AbortController();
      paint();
      fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: cfg.tool, messages: messages }),
        signal: controller.signal,
      }).then(function (res) {
        if (!res.ok || !res.body) {
          return res.json().catch(function () { return null; }).then(function (b) {
            throw new Error((b && b.message) || 'The AI could not answer (' + res.status + ').');
          });
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buffer += decoder.decode(r.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            lines.forEach(function (line) {
              if (!line) return;
              var ev = JSON.parse(line);
              if (ev.t === 'text') pending += ev.v;
              else if (ev.t === 'error') throw new Error(ev.v);
            });
            if (thisChat === chatId) paint();
            return pump();
          });
        }
        return pump();
      }).catch(function (err) {
        if (!controller || !controller.signal.aborted) els.failure = err && err.message ? err.message : 'The AI could not answer.';
      }).then(function () {
        if (thisChat === chatId) {
          if (pending.trim()) messages.push({ role: 'assistant', content: pending });
          else {
            // Nothing came back: take the question off the log and give it back to edit.
            messages.pop();
            if (!els.input.value) els.input.value = question;
          }
          save();
        }
        pending = '';
        busy = false;
        controller = null;
        paint();
        els.input.focus();
      });
      save();
    }

    function open() {
      btn.classList.add('on');
      if (win) return;
      win = document.createElement('section');
      win.className = 'iw-askw';
      win.setAttribute('role', 'dialog');
      win.setAttribute('aria-label', 'Ask the AI about ' + cfg.toolName);
      win.innerHTML =
        '<header><span class="t">Ask the AI <span>· ' + esc(cfg.toolName) + '</span></span>' +
        '<button type="button" data-a="new" title="Start a new chat">New chat</button>' +
        '<button type="button" class="i" data-a="min" title="Minimize" aria-label="Minimize">–</button>' +
        '<button type="button" class="i" data-a="close" title="Close" aria-label="Close">×</button></header>' +
        '<div class="iw-askb"><div class="log"></div>' +
        '<form><textarea rows="2" maxlength="' + MAX_CHARS + '" placeholder="Ask about ' + esc(cfg.toolName) + '…"></textarea>' +
        '<button type="submit" class="s">Send</button></form>' +
        '<p class="note">AI answers can be wrong — the guide is the reference.</p></div>';
      document.body.appendChild(win);
      els.head = win.querySelector('header');
      els.log = win.querySelector('.log');
      els.input = win.querySelector('textarea');
      els.send = win.querySelector('form button');
      els.newChat = win.querySelector('[data-a=new]');
      els.min = win.querySelector('[data-a=min]');

      els.head.addEventListener('pointerdown', startDrag);
      els.head.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('button') && e.target.closest('button').getAttribute('data-a');
        if (a === 'close') close();
        else if (a === 'new') { chatId++; if (controller) controller.abort(); messages = []; els.failure = ''; save(); paint(); els.input.focus(); }
        else if (a === 'min') {
          var min = win.classList.toggle('min');
          els.min.textContent = min ? '▢' : '–';
          els.min.title = min ? 'Restore' : 'Minimize';
          els.min.setAttribute('aria-label', els.min.title);
          clamp();
        }
      });
      win.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) { if (controller) controller.abort(); } else send();
      });
      els.input.addEventListener('input', function () { if (!busy) els.send.disabled = !els.input.value.trim(); });
      els.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      });
      window.addEventListener('resize', clamp);
      clamp();
      paint();
      els.input.focus();
    }

    function close() {
      chatId++;
      if (controller) controller.abort();
      if (busy) {
        if (pending.trim()) messages.push({ role: 'assistant', content: pending });
        messages = settled(messages);
        save();
      }
      busy = false;
      pending = '';
      window.removeEventListener('resize', clamp);
      win.remove();
      win = null;
      btn.classList.remove('on');
    }

    // Capture-phase window listeners while a drag is on, so neither a fast pointer leaving the
    // title bar nor a canvas that stops pointer events can strand the window.
    function startDrag(e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
      e.preventDefault();
      var id = e.pointerId, dx = e.clientX - place.x, dy = e.clientY - place.y;
      function move(ev) {
        if (ev.pointerId !== id) return;
        place.x = ev.clientX - dx;
        place.y = ev.clientY - dy;
        clamp();
      }
      function end(ev) {
        if (ev.pointerId !== id) return;
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        write('localStorage', PLACE_KEY, place);
      }
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    }

    btn.addEventListener('click', open);
  }

  return { mount: mount, render: render };
})();
