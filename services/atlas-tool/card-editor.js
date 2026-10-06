/* Blueprint cards (ADR-0008 §2) — the ✎ Card editor, the Card section of the
   ＋ New blueprint modal, and the state chips in 🗑 Manage blueprints.

   A separate file for the same reason as doc-guard.js: no brace doubling, no
   Python eating its escapes. Injected as a PAGE.format() VALUE slot and run
   after the page script, whose globals it uses at call time (BP_CAN_PUBLISH,
   CARD_CAN_REVIEW, collectBpParams, the #bpBindings selects).

   A save is a compare-and-swap: opening a card puts `card:<id>` into
   window.IW_DOCS, doc-guard.js sends it as the base and adopts the version
   the save hands back; a conflict is its reload / overwrite prompt. */
/* global CARD_CAN_REVIEW, collectBpParams */
(function () {
	var INPUTS = ['prompt', 'negative', 'reference', 'shape', 'sourceImage', 'mask', 'layer'];
	var INPUT_VALUES = ['required', 'optional', 'none'];
	var FIELD =
		'background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px 7px;font-size:12px';
	var CHIP = {
		reviewed: ['reviewed', '#1f3d22', '#7fd88a'],
		draft: ['draft', '#3a3320', '#e2c46a'],
		stale: ['stale', '#40221f', '#f19a8e'],
		none: ['no card', '#2a2a2e', '#999'],
	};

	function el(tag, css, text) {
		var e = document.createElement(tag);
		if (css) e.style.cssText = css;
		if (text != null) e.textContent = text;
		return e;
	}

	// CARD_CAN_REVIEW is a page-script `const`: shared by every script, never on window.
	function canReview() {
		return typeof CARD_CAN_REVIEW !== 'undefined' && !!CARD_CAN_REVIEW;
	}

	function chip(status) {
		var c = CHIP[status] || CHIP.none;
		var s = el(
			'span',
			'font-size:11px;padding:1px 7px;border-radius:9px;background:' + c[1] + ';color:' + c[2],
			c[0],
		);
		s.title =
			status === 'stale'
				? 'Reviewed against a graph or mapping the library no longer holds: counts as draft until re-reviewed.'
				: status === 'reviewed'
					? 'Offered to agents.'
					: 'Not offered to agents until the owner reviews it.';
		return s;
	}
	window.cardChip = chip;

	function lines(text) {
		return String(text || '')
			.split('\n')
			.map(function (s) {
				return s.trim();
			})
			.filter(Boolean);
	}

	function commas(text) {
		return String(text || '')
			.split(',')
			.map(function (s) {
				return s.trim();
			})
			.filter(Boolean);
	}

	// A typed value: the param's own type when known, else true/false and
	// numbers are read as such and anything else stays text.
	function value(text, type) {
		var t = String(text).trim();
		if (type === 'text' || type === 'select') return t;
		if (t === 'true' || t === 'false') return t === 'true';
		if (t !== '' && !isNaN(Number(t))) return Number(t);
		return t;
	}

	function show(v) {
		return v == null ? '' : String(v);
	}

	function input(val, ph, width) {
		var i = el('input', FIELD + (width ? ';width:' + width : ''));
		i.value = show(val);
		if (ph) i.placeholder = ph;
		return i;
	}

	function select(options, val) {
		var s = el('select', FIELD);
		options.forEach(function (o) {
			var v = Array.isArray(o) ? o[0] : o;
			var opt = el('option', null, Array.isArray(o) ? o[1] : o);
			opt.value = v;
			s.appendChild(opt);
		});
		s.value = show(val);
		return s;
	}

	function area(list, rows) {
		var a = el('textarea', FIELD + ';resize:vertical;width:100%;box-sizing:border-box');
		a.rows = rows || 2;
		a.value = (list || []).join('\n');
		return a;
	}

	function labelled(text, ctl, note) {
		var l = el(
			'label',
			'display:flex;flex-direction:column;gap:3px;color:#aaa;font-size:12px',
			text,
		);
		l.appendChild(ctl);
		if (note) l.appendChild(el('span', 'color:#666;font-size:11px', note));
		return l;
	}

	function heading(text) {
		return el('div', 'color:#aaa;font-weight:600;margin-top:6px', text);
	}

	function row() {
		return el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center');
	}

	function num(v) {
		var t = String(v).trim();
		return t === '' || isNaN(Number(t)) ? undefined : Number(t);
	}

	// The card form, shared by the editor and the New blueprint modal.
	// ctx: {card, kind, keys: [{key, scope, param}], readOnly}. Returns {collect}.
	function buildForm(host, ctx) {
		host.innerHTML = '';
		var card = ctx.card || {};
		var wrap = el('div', 'display:flex;flex-direction:column;gap:9px');
		host.appendChild(wrap);

		var purpose = input(card.purpose, 'One line: what this pipeline is for');
		wrap.appendChild(labelled('Purpose', purpose));
		var use = area(card.whenToUse, 3);
		var notUse = area(card.whenNotToUse, 3);
		wrap.appendChild(labelled('When to use (one per line)', use));
		wrap.appendChild(labelled('When NOT to use (one per line)', notUse));

		wrap.appendChild(heading('Inputs'));
		var inGrid = el('div', 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px');
		var ins = {};
		INPUTS.forEach(function (k) {
			ins[k] = select(INPUT_VALUES, (card.inputs || {})[k] || 'none');
			inGrid.appendChild(labelled(k, ins[k]));
		});
		wrap.appendChild(inGrid);

		wrap.appendChild(heading('Outputs'));
		var out = card.outputs || {};
		var r = row();
		r.appendChild(
			el('span', 'color:#888;font-size:12px', 'kind: ' + (ctx.kind || out.kind || 'image')),
		);
		var alpha = el('input');
		alpha.type = 'checkbox';
		alpha.checked = !!out.alpha;
		var al = el('label', 'color:#aaa;font-size:12px;display:flex;gap:4px;align-items:center');
		al.appendChild(alpha);
		al.appendChild(document.createTextNode('alpha'));
		r.appendChild(al);
		var count = input(out.count == null ? 1 : out.count, 'count', '60px');
		r.appendChild(el('span', 'color:#888;font-size:12px', 'count'));
		r.appendChild(count);
		var sizeRule = input(out.sizeRule, 'size rule (e.g. source size)', '200px');
		r.appendChild(sizeRule);
		wrap.appendChild(r);

		wrap.appendChild(heading('Settings'));
		wrap.appendChild(
			el(
				'div',
				'color:#888;font-size:11px',
				ctx.builtin
					? 'Per-atlas (scope atlas) or per-region (scope region) Settings keys only — global-only keys are not agent-settable.'
					: "This blueprint's exposed settings. Ranges must sit inside the setting's own min/max.",
			),
		);
		var setBox = el('div', 'display:flex;flex-direction:column;gap:5px');
		wrap.appendChild(setBox);
		var keyOpts = (ctx.keys || []).map(function (k) {
			return k.key;
		});
		function paramOf(key) {
			var hit = (ctx.keys || []).filter(function (k) {
				return k.key === key;
			})[0];
			return hit && hit.param;
		}
		function addSetting(s) {
			s = s || {};
			var line = row();
			line.className = 'cardset';
			var opts = keyOpts.slice();
			if (s.key && opts.indexOf(s.key) < 0) opts.unshift(s.key);
			if (!s.key) opts.unshift('');
			var key = select(opts, s.key || '');
			var scope = select(
				[
					['', 'scope: atlas'],
					['atlas', 'atlas'],
					['region', 'region'],
				],
				s.scope || '',
			);
			var f = {};
			['default', 'min', 'max', 'draft', 'final'].forEach(function (n) {
				f[n] = input(s[n], n, '62px');
			});
			var optsIn = input((s.options || []).join(', '), 'options (a, b)', '120px');
			var note = input(s.note, 'note', '160px');
			var rm = el('button', 'font-size:11px;padding:2px 7px', '✕');
			rm.type = 'button';
			rm.onclick = function () {
				line.remove();
			};
			[key, scope, f.default, f.min, f.max, f.draft, f.final, optsIn, note, rm].forEach(
				function (c) {
					line.appendChild(c);
				},
			);
			line._collect = function () {
				if (!key.value) return null;
				var p = paramOf(key.value);
				var type = p && p.type;
				var o = { key: key.value };
				if (scope.value) o.scope = scope.value;
				if (f.default.value.trim() !== '') o.default = value(f.default.value, type);
				['min', 'max', 'draft', 'final'].forEach(function (n) {
					var v = num(f[n].value);
					if (v !== undefined) o[n] = v;
				});
				var ol = commas(optsIn.value);
				if (ol.length)
					o.options = ol.map(function (x) {
						return value(x, type);
					});
				if (note.value.trim()) o.note = note.value.trim();
				return o;
			};
			setBox.appendChild(line);
		}
		(card.settings || []).forEach(addSetting);
		var addSet = el(
			'button',
			'font-size:11px;padding:3px 8px;align-self:flex-start',
			'＋ Add setting',
		);
		addSet.type = 'button';
		addSet.onclick = function () {
			addSetting();
		};
		wrap.appendChild(addSet);

		wrap.appendChild(heading('Chain'));
		var ch = card.chain || {};
		var r2 = row();
		var position = select(['generate', 'process', 'extract'], ch.position || 'generate');
		var follows = input((ch.follows || []).join(', '), 'follows (ids, comma separated)', '200px');
		var precedes = input(
			(ch.precedes || []).join(', '),
			'precedes (ids, comma separated)',
			'200px',
		);
		[position, follows, precedes].forEach(function (c) {
			r2.appendChild(c);
		});
		wrap.appendChild(r2);

		wrap.appendChild(heading('Variants, billing, licence'));
		var va = card.variants || {};
		var r3 = row();
		var vd = input(va.draft == null ? 1 : va.draft, 'draft', '56px');
		var vf = input(va.final == null ? 1 : va.final, 'final', '56px');
		var vm = input(va.max == null ? 1 : va.max, 'max', '56px');
		var billing = select(['gpu', 'credits'], card.billing || 'gpu');
		var licence = select(['ok', 'conditional', 'blocked'], card.licence || 'conditional');
		[
			el('span', 'color:#888;font-size:12px', 'drafts'),
			vd,
			el('span', 'color:#888;font-size:12px', 'finals'),
			vf,
			el('span', 'color:#888;font-size:12px', 'max'),
			vm,
			el('span', 'color:#888;font-size:12px', 'billing'),
			billing,
			el('span', 'color:#888;font-size:12px', 'licence'),
			licence,
		].forEach(function (c) {
			r3.appendChild(c);
		});
		wrap.appendChild(r3);

		wrap.appendChild(heading('GPU seconds per image'));
		var gpu = card.gpu || {};
		wrap.appendChild(
			el(
				'div',
				'color:#888;font-size:11px',
				'Warm execution seconds for one image at each size (source: ' +
					(gpu.source || 'guess') +
					'). The cold start is paid by the first job of a batch.',
			),
		);
		var gpuBox = el('div', 'display:flex;flex-direction:column;gap:4px');
		wrap.appendChild(gpuBox);
		function addGpu(px, secs) {
			var line = row();
			line.className = 'cardgpu';
			var p = input(px, 'px', '70px');
			var s = input(secs, 'seconds', '70px');
			var rm = el('button', 'font-size:11px;padding:2px 7px', '✕');
			rm.type = 'button';
			rm.onclick = function () {
				line.remove();
			};
			line.appendChild(p);
			line.appendChild(el('span', 'color:#888', '='));
			line.appendChild(s);
			line.appendChild(el('span', 'color:#888;font-size:12px', 's'));
			line.appendChild(rm);
			line._collect = function () {
				var k = String(p.value).trim();
				var v = num(s.value);
				return k && v !== undefined ? [k, v] : null;
			};
			gpuBox.appendChild(line);
		}
		Object.keys(gpu.secondsPerImage || {}).forEach(function (px) {
			addGpu(px, gpu.secondsPerImage[px]);
		});
		var r4 = row();
		var addG = el('button', 'font-size:11px;padding:3px 8px', '＋ Add size');
		addG.type = 'button';
		addG.onclick = function () {
			addGpu('', '');
		};
		var cold = input(gpu.coldStart == null ? 0 : gpu.coldStart, 'cold start s', '70px');
		r4.appendChild(addG);
		r4.appendChild(el('span', 'color:#888;font-size:12px', 'cold start'));
		r4.appendChild(cold);
		r4.appendChild(el('span', 'color:#888;font-size:12px', 's'));
		wrap.appendChild(r4);
		wrap.appendChild(
			el(
				'div',
				'color:#777;font-size:11px;font-style:italic',
				'Measured: No measurements yet — filled from billed renders in a later release.',
			),
		);

		var gotchas = area(card.gotchas, 3);
		wrap.appendChild(labelled('Gotchas (one per line)', gotchas));

		if (ctx.readOnly) {
			wrap.querySelectorAll('input,select,textarea,button').forEach(function (c) {
				c.disabled = true;
			});
		}

		return {
			purposeFilled: function () {
				return !!purpose.value.trim();
			},
			collect: function () {
				var settings = [];
				setBox.querySelectorAll('.cardset').forEach(function (l) {
					var s = l._collect();
					if (s) settings.push(s);
				});
				var spi = {};
				gpuBox.querySelectorAll('.cardgpu').forEach(function (l) {
					var kv = l._collect();
					if (kv) spi[kv[0]] = kv[1];
				});
				// Keys the form does not show (fixedPx, frames, apiWallSeconds, …)
				// ride through untouched.
				var outputs = Object.assign({}, card.outputs || {}, {
					kind: ctx.kind || (card.outputs || {}).kind || 'image',
					alpha: alpha.checked,
					count: num(count.value) == null ? 1 : num(count.value),
				});
				if (sizeRule.value.trim()) outputs.sizeRule = sizeRule.value.trim();
				else delete outputs.sizeRule;
				var gpuOut = Object.assign({}, card.gpu || {}, {
					secondsPerImage: spi,
					coldStart: num(cold.value) == null ? 0 : num(cold.value),
				});
				delete gpuOut.source;
				var inputs = {};
				INPUTS.forEach(function (k) {
					inputs[k] = ins[k].value;
				});
				return {
					purpose: purpose.value.trim(),
					whenToUse: lines(use.value),
					whenNotToUse: lines(notUse.value),
					inputs: inputs,
					outputs: outputs,
					settings: settings,
					chain: {
						position: position.value,
						follows: commas(follows.value),
						precedes: commas(precedes.value),
					},
					gpu: gpuOut,
					variants: { draft: num(vd.value), final: num(vf.value), max: num(vm.value) },
					billing: billing.value,
					licence: licence.value,
					gotchas: lines(gotchas.value),
				};
			},
		};
	}

	function keysOf(bp) {
		if (bp.builtin) {
			var sk = bp.settingsKeys || {};
			var out = [];
			(sk.atlas || []).forEach(function (k) {
				out.push({ key: k });
			});
			(sk.region || []).forEach(function (k) {
				if ((sk.atlas || []).indexOf(k) < 0) out.push({ key: k });
			});
			return out;
		}
		return (bp.params || []).map(function (p) {
			return { key: p.key, param: p };
		});
	}

	async function postCard(id, card, review) {
		var r = await fetch('/card/save', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: id, card: card, review: !!review }),
		});
		var text = await r.text();
		try {
			return JSON.parse(text);
		} catch {
			return { ok: false, error: text || 'HTTP ' + r.status };
		}
	}

	function failText(res) {
		if (res.errors && res.errors.length) return '✖ Not saved:\n• ' + res.errors.join('\n• ');
		return '✖ ' + (res.error || 'Not saved.');
	}

	// --- ✎ Card editor -----------------------------------------------------
	var editor = { id: '', form: null, view: null };

	function cstat(msg) {
		var s = document.getElementById('cardStat');
		if (s) s.textContent = msg || '';
	}

	function list(title, items, color) {
		var box = el('div', 'font-size:12px;color:' + color);
		if (!items || !items.length) return box;
		box.appendChild(el('div', 'font-weight:600', title));
		var ul = el('ul', 'margin:3px 0 0 18px;padding:0');
		items.forEach(function (t) {
			ul.appendChild(el('li', null, t));
		});
		box.appendChild(ul);
		return box;
	}

	function renderHistory(host, id, history) {
		host.innerHTML = '';
		host.appendChild(heading('History'));
		if (!history || !history.length) {
			host.appendChild(el('div', 'color:#888;font-size:12px', 'No versions yet.'));
			return;
		}
		var pre = el(
			'pre',
			'display:none;max-height:260px;overflow:auto;background:#111;color:#ccc;border:1px solid #333;border-radius:4px;padding:8px;font-size:11px',
		);
		history.forEach(function (h, i) {
			var who = (h.savedBy && (h.savedBy.name || h.savedBy.tool)) || 'unstamped';
			// Older versions are listed by rev only; clicking reads that one.
			var text =
				h.loaded === false
					? 'rev ' + h.rev + ' · click to view'
					: 'rev ' +
						h.rev +
						' · ' +
						h.status +
						' · ' +
						who +
						(h.savedBy && h.savedBy.at ? ' · ' + h.savedBy.at : '') +
						(h.reviewedBy ? ' · reviewed by ' + h.reviewedBy : '') +
						(h.resetReason ? ' · ' + h.resetReason : '') +
						(i === 0 ? ' (current)' : '');
			var line = el('div', 'font-size:12px;color:#bbb;cursor:pointer;padding:2px 0', text);
			line.title = 'View this version (read-only)';
			line.onclick = async function () {
				if (i === 0) {
					pre.textContent = JSON.stringify(editor.view.card, null, 2);
				} else {
					var r = await fetch('/card/history?id=' + encodeURIComponent(id) + '&rev=' + h.rev);
					var j = await r.json();
					pre.textContent = j.card ? JSON.stringify(j.card, null, 2) : j.error || 'not found';
				}
				pre.style.display = '';
			};
			host.appendChild(line);
		});
		host.appendChild(pre);
	}

	window.openCardEditor = async function (id) {
		var modal = document.getElementById('cardModal');
		if (!modal) return;
		editor = { id: id, form: null, view: null };
		document.getElementById('cardTitle').textContent = 'Card — ' + id;
		document.getElementById('cardHead').innerHTML = '';
		document.getElementById('cardForm').innerHTML = '';
		document.getElementById('cardHistory').innerHTML = '';
		cstat('Loading…');
		modal.classList.add('open');
		var v;
		try {
			var r = await fetch('/card?id=' + encodeURIComponent(id));
			v = await r.json();
			if (!r.ok) throw new Error(v.error || 'HTTP ' + r.status);
		} catch (e) {
			cstat('✖ ' + e.message);
			return;
		}
		editor.view = v;
		window.IW_DOCS = window.IW_DOCS || {};
		window.IW_DOCS['card:' + v.id] = v.version || { etag: '', rev: '' };
		var head = document.getElementById('cardHead');
		var top = row();
		top.appendChild(chip(v.status));
		var c = v.card;
		top.appendChild(
			el(
				'span',
				'color:#999;font-size:12px',
				c
					? 'rev ' +
							c.rev +
							(c.saved_by
								? ' · saved by ' +
									(c.saved_by.name || c.saved_by.sub || '?') +
									' at ' +
									c.saved_by.at
								: ' · never edited in the tool') +
							(c.reviewedBy ? ' · reviewed by ' + c.reviewedBy + ' at ' + c.reviewedAt : '')
					: 'No card yet — prefilled from the graph. Nothing is saved until you press Save.',
			),
		);
		head.appendChild(top);
		if (c && c.resetReason)
			head.appendChild(
				el('div', 'color:#e2c46a;font-size:12px', '↺ Back to draft: ' + c.resetReason),
			);
		head.appendChild(list('Problems against the live blueprint', v.problems, '#f19a8e'));
		head.appendChild(list('Blocks review', v.reviewProblems, '#e2c46a'));
		if (v.reviewNeedsRelaunch)
			head.appendChild(
				el(
					'div',
					'color:#e2c46a;font-size:12px',
					'To mark this card reviewed, open the Atlas Maker again from the launcher: a review is accepted only within 30 minutes of a launch, so a revoked permission cannot linger.',
				),
			);
		if (!v.canEdit)
			head.appendChild(
				el(
					'div',
					'color:#888;font-size:12px',
					'Read-only: editing cards needs the “Publish blueprints” permission.',
				),
			);
		editor.form = buildForm(document.getElementById('cardForm'), {
			card: c || v.prefill,
			kind: v.blueprint.kind,
			builtin: v.blueprint.builtin,
			keys: keysOf(v.blueprint),
			readOnly: !v.canEdit,
		});
		renderHistory(document.getElementById('cardHistory'), v.id, v.history);
		document.getElementById('cardSaveDraft').style.display = v.canEdit ? '' : 'none';
		document.getElementById('cardSaveReview').style.display = v.canReview ? '' : 'none';
		cstat('');
	};

	window.closeCardEditor = function () {
		var m = document.getElementById('cardModal');
		if (m) m.classList.remove('open');
	};

	window.cardEditorSave = async function (review) {
		if (!editor.form || !editor.view) return;
		cstat(review ? '⬆ Saving and marking reviewed…' : '⬆ Saving draft…');
		var res;
		try {
			res = await postCard(editor.view.id, editor.form.collect(), review);
		} catch (e) {
			res = { ok: false, error: String(e) };
		}
		if (!res.ok) {
			cstat(failText(res));
			return;
		}
		cstat('✓ Saved rev ' + res.card.rev + ' as ' + res.card.status + '.');
		await window.openCardEditor(editor.view.id);
		cstat('✓ Saved rev ' + res.card.rev + ' as ' + res.card.status + '.');
		window.cardDecorateManage();
	};

	// --- 🗑 Manage blueprints: state chips, ✎ Card, built-in rows ---------
	window.cardDecorateManage = async function () {
		var box = document.getElementById('bpManageList');
		if (!box) return;
		var data;
		try {
			var r = await fetch('/blueprints?all=1');
			data = await r.json();
			if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
		} catch {
			box.querySelectorAll('[data-card-chip]').forEach(function (s) {
				s.textContent = 'card state unreadable';
			});
			return;
		}
		box.querySelectorAll('.cardbuiltin').forEach(function (n) {
			n.remove();
		});
		var first = box.firstChild;
		(data.blueprints || []).forEach(function (bp) {
			var slot = box.querySelector('[data-card-chip="' + bp.id + '"]');
			if (slot) {
				slot.innerHTML = '';
				slot.appendChild(chip(bp.status));
				return;
			}
			if (!bp.builtin) return;
			var line = el(
				'div',
				'display:flex;align-items:center;gap:8px;border:1px solid #2a2a2e;border-radius:5px;padding:7px 9px',
			);
			line.className = 'cardbuiltin';
			line.appendChild(el('span', 'flex:1;color:#ddd', bp.name + ' (' + bp.id + ')'));
			line.appendChild(chip(bp.status));
			var b = el('button', 'font-size:11px;padding:4px 9px', '✎ Card');
			b.type = 'button';
			b.onclick = function () {
				window.openCardEditor(bp.id);
			};
			line.appendChild(b);
			box.insertBefore(line, first);
		});
	};

	// --- ＋ New blueprint: the Card section --------------------------------
	var newForm = null;

	function modalBindings() {
		var roles = {};
		document.querySelectorAll('#bpBindings [data-bprole]').forEach(function (s) {
			if (s.value) roles[s.dataset.bprole] = true;
		});
		return roles;
	}

	function prefillFromModal() {
		var roles = modalBindings();
		var params = typeof collectBpParams === 'function' ? collectBpParams() : [];
		var kind = (document.getElementById('bpKind') || {}).value || 'image';
		var inputs = {};
		INPUTS.forEach(function (k) {
			inputs[k] = 'none';
		});
		if (roles.positive) inputs.prompt = 'required';
		if (roles.negative) inputs.negative = 'optional';
		if (roles.style_ref) {
			if (roles.positive) inputs.reference = 'optional';
			else inputs.sourceImage = 'required';
		}
		if (roles.shape_ref) inputs.shape = 'optional';
		return {
			card: {
				purpose: '',
				inputs: inputs,
				outputs: { kind: kind, alpha: false, count: 1 },
				settings: params.map(function (p) {
					var s = { key: p.key };
					['default', 'min', 'max', 'options'].forEach(function (k) {
						if (p[k] != null) s[k] = p[k];
					});
					return s;
				}),
				chain: { position: roles.positive ? 'generate' : 'process', follows: [], precedes: [] },
				gpu: { secondsPerImage: {}, coldStart: 0, source: 'guess' },
				variants: { draft: 1, final: 1, max: 1 },
				billing: 'gpu',
				licence: 'conditional',
				gotchas: [],
			},
			kind: kind,
			keys: params.map(function (p) {
				return { key: p.key, param: p };
			}),
		};
	}

	window.bpCardPrefill = function () {
		var host = document.getElementById('bpCardForm');
		if (!host) return;
		var p = prefillFromModal();
		newForm = buildForm(host, { card: p.card, kind: p.kind, keys: p.keys });
		var rv = document.getElementById('bpCardReviewRow');
		if (rv) rv.style.display = canReview() ? '' : 'none';
	};

	window.bpCardToggle = function (details) {
		if (details.open && !newForm) window.bpCardPrefill();
	};

	window.bpCardReset = function () {
		newForm = null;
		var host = document.getElementById('bpCardForm');
		if (host) host.innerHTML = '';
		var d = document.getElementById('bpCardSec');
		if (d) d.open = false;
		var cb = document.getElementById('bpCardReview');
		if (cb) cb.checked = false;
	};

	// After a successful publish: save the Card section when it was filled in.
	// A create (base etag ""), so an existing card is never replaced unasked —
	// doc-guard.js offers "Replace it?". Returns a status line, or '' when the
	// section was left empty. `id` is the server's own slug of the blueprint
	// (the publish reply's X-IW-Blueprint-Id), never re-derived here.
	window.cardAfterPublish = async function (id) {
		if (!newForm || !newForm.purposeFilled()) return '';
		if (!id)
			return ' ⚠ The blueprint is published, but the server did not name its id, so the card was not saved — open 🗑 Manage blueprints → ✎ Card.';
		window.IW_DOCS = window.IW_DOCS || {};
		window.IW_DOCS['card:' + id] = { etag: '', rev: '' };
		var review = !!(canReview() && (document.getElementById('bpCardReview') || {}).checked);
		var res;
		try {
			res = await postCard(id, newForm.collect(), review);
		} catch (e) {
			res = { ok: false, error: String(e) };
		}
		if (res.ok) return ' ✓ Card saved as ' + res.card.status + '.';
		return (
			' ⚠ The blueprint is published, but its card was not saved — open 🗑 Manage blueprints → ✎ Card. ' +
			failText(res)
		);
	};
})();
