/* Sun-ice — наявність товарів з 1С (кнопка в ряду кнопок рядка прайсу + плавно розкрита панель «по складах»).
   Підвантажується з index.html ДИНАМІЧНО і лише адмінам (regional_admin/super_admin) — звичайні
   користувачі й гості цей файл не завантажують. Рішення й план: claude/stock-1c/00-ПЛАН-І-СТАТУС.md.

   Звідки дані: RPC get_stock() (SQL claude/sql/2026-10-02-stock-1c.sql) — сервер сам фільтрує склади
   за регіоном адміна (регіон + Київ; супер-адмін — усі), ніщо зайве сюди не доходить.

   Правило зіставлення «за основою» (рішення власника 2026-10-02): ключ = назва без пробілів, верхній регістр,
   кирилічні «двійники» → латиниця. ОСНОВА = маркування до першого -W/-S включно. Показуємо ВСІ позиції 1С, що
   починаються з основи (SRC35ZS-W, -W1, -W2 …), кожну окремо — що брати, вирішує людина. Маркування без -W/-S
   (пульти тощо) — лише точний збіг. normKey нижче ДОСЛІВНО дублює parse.ts (claude/edge-functions/stock-sync/).

   Чиста логіка (normKey … sheetModel) відділена від DOM і тестується в Node: claude/stock-1c/tests/stock.test.js.
   Глобали з index.html (sb, sheetsData, DIAG_CHECKS, DIAG_AREA, diagIssue) використовуються лише всередині функцій. */
(function (root) {
  'use strict';

  /* ---------------- ЧИСТА ЛОГІКА ---------------- */

  const HOMO = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
                 'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O', 'р': 'P', 'с': 'C', 'т': 'T', 'х': 'X' };

  function normKey(s) {
    return String(s == null ? '' : s)
      .replace(/[\s ]+/g, '')
      .replace(/[АВЕКМНОРСТХавекмнорстх]/g, function (ch) { return HOMO[ch] || ch; })
      .toUpperCase();
  }

  /* Основа маркування: до першого -W/-S включно; null — основи нема (тоді лише точний збіг). */
  function baseOf(key) {
    const m = /-[WS]/.exec(key);
    return m ? key.slice(0, m.index + 2) : null;
  }

  /* Індекс з рядків get_stock: key → { n: назва 1С, wh: { код_складу: {p, a} } } */
  function buildIndex(rows) {
    const byKey = new Map();
    (rows || []).forEach(function (r) {
      let e = byKey.get(r.k);
      if (!e) { e = { k: r.k, n: r.n, wh: {} }; byKey.set(r.k, e); }
      e.wh[r.w] = { p: Number(r.p) || 0, a: Number(r.a) || 0 };
    });
    return { byKey: byKey, keys: Array.from(byKey.keys()).sort() };
  }

  /* Усі позиції 1С, що підходять під маркування; точний збіг — першим. */
  function matchVariants(index, marking) {
    const k = normKey(marking);
    if (!k) return [];
    const base = baseOf(k);
    const out = [];
    index.keys.forEach(function (key) {
      if (base ? key.indexOf(base) === 0 : key === k) {
        const e = index.byKey.get(key);
        out.push({ k: key, n: e.n, exact: key === k, wh: e.wh });
      }
    });
    out.sort(function (a, b) { return (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
    return out;
  }

  const sum = function (arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); };

  /* Підсумок по частинах рядка (внутрішній/зовнішній блок): для кожної — варіанти, всього, вільно. */
  function summarizeParts(parts, index, data) {
    const codes = (data.warehouses || []).map(function (w) { return w.code; });
    const res = parts.map(function (p) {
      const variants = matchVariants(index, p.m);
      const P = sum(variants, function (v) { return sum(codes, function (c) { return v.wh[c] ? v.wh[c].p : 0; }); });
      const A = sum(variants, function (v) { return sum(codes, function (c) { return v.wh[c] ? v.wh[c].a : 0; }); });
      return { marking: p.m, role: p.role || null, variants: variants, found: variants.length > 0, P: P, A: A };
    });
    const any = res.some(function (r) { return r.found; });
    const minA = res.length ? Math.min.apply(null, res.map(function (r) { return r.A; })) : 0;
    const low = Number(data.low_threshold);
    const status = minA <= 0 ? 'out' : (minA <= (isFinite(low) ? low : 2) ? 'low' : 'ok');
    return { parts: res, any: any, minA: minA, status: status };
  }

  /* Комплектів, які можна зібрати з ОДНОГО складу: min(внутр., зовн.) по складу, далі сума по складах. */
  function kitByWarehouse(summary, data) {
    const ind = summary.parts.filter(function (p) { return p.role === 'indoor'; })[0];
    const out = summary.parts.filter(function (p) { return p.role === 'outdoor'; })[0];
    if (!ind || !out) return null;
    const perWh = (data.warehouses || []).map(function (w) {
      const a = sum(ind.variants, function (v) { return v.wh[w.code] ? v.wh[w.code].a : 0; });
      const b = sum(out.variants, function (v) { return v.wh[w.code] ? v.wh[w.code].a : 0; });
      return { code: w.code, name: w.name, kits: Math.min(a, b) };
    });
    return { perWh: perWh, total: sum(perWh, function (x) { return x.kits; }) };
  }

  /* Частини рядка прайсу: [{m: маркування, role: 'indoor'|'outdoor'|null}]. list — увесь список плитки (для братів). */
  function partsFor(it, listKey, list) {
    if (!it || !it.model) return [];
    const isSplit = listKey === 'split_mhi' || listKey === 'split_gal';
    if (it.unitType === 'outdoor') return [{ m: it.model, role: 'outdoor' }];
    if (isSplit) {
      if (it.unitType !== 'indoor') return [{ m: it.model, role: null }];
      const parts = [{ m: it.model, role: 'indoor' }];
      let out = it.splitOutdoor || null;
      if (!out && list) {
        // Кольорові варіанти (-WT/-WB) зовнішнього рядка в прайсі не мають — беремо зовнішній «брата» з тією ж основою.
        const base = baseOf(normKey(it.model));
        const sib = base && list.filter(function (x) { return x.splitOutdoor && x.unitType === 'indoor' && baseOf(normKey(x.model)) === base; })[0];
        if (sib) out = sib.splitOutdoor;
      }
      if (out) parts.push({ m: out, role: 'outdoor' });
      return parts;
    }
    if (listKey === 'semi_gal') {
      const parts = [{ m: it.model, role: 'indoor' }];
      if (it.outdoorModel) parts.push({ m: it.outdoorModel, role: 'outdoor' });
      return parts;
    }
    if (listKey === 'semi_mhi' && it.model.indexOf('+') !== -1) {
      const bits = it.model.split('+').map(function (s) { return s.trim(); }).filter(Boolean);
      return bits.map(function (b, i) { return { m: b, role: i === 0 ? 'indoor' : (i === bits.length - 1 ? 'outdoor' : null) }; });
    }
    return [{ m: it.model, role: it.unitType || null }];
  }

  /* Свіжість даних: вік від останньої УСПІШНОЇ синхронізації (годинник сервера + час, що минув після завантаження). */
  function freshness(data, fetchedAtMs, nowMs) {
    if (!data || !data.last_success_at) return { state: 'none', ageMin: null };
    const base = (Date.parse(data.server_now) - Date.parse(data.last_success_at)) / 60000;
    const ageMin = Math.max(0, base + (nowMs - fetchedAtMs) / 60000);
    const state = ageMin <= Number(data.fresh_minutes) ? 'fresh' : (ageMin <= Number(data.stale_minutes) ? 'aging' : 'stale');
    return { state: state, ageMin: ageMin };
  }

  function fmtAge(min) {
    if (min == null) return '';
    if (min < 1) return 'щойно';
    if (min < 60) return Math.round(min) + ' хв тому';
    if (min < 1440) return Math.round(min / 60) + ' год тому';
    return Math.round(min / 1440) + ' дн. тому';
  }

  function fmtQty(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return String(v).replace('.', ',');
  }

  /* Модель вікна «по складах» (без HTML): частини → варіанти → рядки по складах + комплекти. */
  function sheetModel(parts, index, data) {
    const summary = summarizeParts(parts, index, data);
    const whs = data.warehouses || [];
    return {
      summary: summary,
      parts: summary.parts.map(function (p) {
        return {
          marking: p.marking, role: p.role, found: p.found, P: p.P, A: p.A,
          variants: p.variants.map(function (v) {
            return {
              name: v.n, exact: v.exact,
              rows: whs.map(function (w) { const x = v.wh[w.code]; return { code: w.code, name: w.name, p: x ? x.p : 0, a: x ? x.a : 0 }; }),
              P: sum(whs, function (w) { return v.wh[w.code] ? v.wh[w.code].p : 0; }),
              A: sum(whs, function (w) { return v.wh[w.code] ? v.wh[w.code].a : 0; })
            };
          })
        };
      }),
      kit: kitByWarehouse(summary, data)
    };
  }

  const api = { normKey: normKey, baseOf: baseOf, buildIndex: buildIndex, matchVariants: matchVariants, summarizeParts: summarizeParts,
                kitByWarehouse: kitByWarehouse, partsFor: partsFor, freshness: freshness, fmtAge: fmtAge, fmtQty: fmtQty, sheetModel: sheetModel };

  if (typeof document === 'undefined') { // Node (тести): лише чиста логіка
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  /* ---------------- БРАУЗЕР: стан, бейдж, вікно, діагностика ---------------- */

  const TTL_MS = 5 * 60 * 1000; // на пристрої тримаємо зріз не довше 5 хв (кеш лише в пам'яті — на спільних пристроях нічого не лишається)
  let data = null, index = null, fetchedAt = 0, loading = null;

  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* Lucide «package» — у вшитому спрайті index.html такого гліфа нема, тож малюємо тут (штрих currentColor, як решта іконок). */
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
    '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

  const CSS = '' +
    '.stock-slot{display:none}.stock-slot.has{display:block;line-height:0}' +
    '.stock-btn{position:relative;width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);cursor:pointer;padding:0;flex-shrink:0;-webkit-appearance:none;transition:background-color .2s,border-color .2s,color .2s}' +
    '.stock-btn svg{width:17px;height:17px;display:block}' +
    '.stock-btn:active{background:var(--accent-bg)}' +
    '.stock-btn[aria-expanded="true"]{background:var(--accent-bg);border-color:var(--accent);color:var(--accent)}' +
    '.stock-dot{position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:50%;background:var(--stock-c,#8B8682);border:2px solid var(--card);box-sizing:border-box}' +
    '.stock-ok{--stock-c:#4F8A5B}.stock-low{--stock-c:#C08A1C}.stock-out{--stock-c:var(--danger)}' +
    '.stock-btn.stock-stale .stock-dot{background:var(--card);border-color:var(--stock-c)}' +
    '.stock-panel{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .28s ease,opacity .28s ease}' +
    '.stock-panel.open{grid-template-rows:1fr;opacity:1}' +
    '.stock-panel-clip{overflow:hidden;min-height:0}' +
    '.stock-panel-in{padding-top:10px;font-size:13px;line-height:1.5;color:var(--text)}' +
    '.stock-sum{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin:0 0 2px}' +
    '.stock-sum::before{content:"";flex:0 0 9px;width:9px;height:9px;border-radius:50%;background:var(--stock-c,#8B8682)}' +
    '.stock-sum small{font-weight:500;color:var(--text-secondary);font-size:12px}' +
    '.stock-note{font-size:12px;color:var(--text-secondary);margin:0 0 8px;line-height:1.45}' +
    '.stock-warn{background:var(--accent-bg);border-radius:10px;padding:7px 10px;color:var(--text);font-size:12.5px;margin:6px 0 8px}' +
    '.stock-part{margin-bottom:10px}' +
    '.stock-part-h{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);margin:0 0 6px}' +
    '.stock-var{border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--bg)}' +
    '.stock-var-n{font-weight:600;font-size:13.5px;display:flex;justify-content:space-between;gap:8px}' +
    '.stock-var-n em{font-style:normal;font-weight:500;font-size:11px;color:var(--text-secondary)}' +
    '.stock-line{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:2px 0}' +
    '.stock-line span:last-child{white-space:nowrap}' +
    '.stock-line.zero{color:var(--text-secondary)}' +
    '.stock-line.total{border-top:1px dashed var(--border);margin-top:3px;padding-top:4px;font-weight:600}' +
    '.stock-kit{border-top:1px solid var(--border);padding-top:10px;margin-top:4px}' +
    '.stock-none{font-size:13px;color:var(--text-secondary)}';

  function ensureCss() {
    if (document.getElementById('stock-css')) return;
    const st = document.createElement('style'); st.id = 'stock-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function listFor(listKey) { return (typeof sheetsData !== 'undefined' && sheetsData[listKey]) || []; }

  /* Місце для кнопки в ряду кнопок рядка прайсу (на початку .row-right; викликається з renderCatalogList). Порожнє, доки нема даних. */
  function slotHtml(it, listKey) {
    let parts;
    try { parts = partsFor(it, listKey, listFor(listKey)); } catch (e) { parts = []; }
    if (!parts.length) return '';
    return '<span class="stock-slot" data-stock-parts="' + esc(encodeURIComponent(JSON.stringify(parts))) + '"></span>';
  }

  const ROLE_LABEL = { indoor: 'Внутрішній блок', outdoor: 'Зовнішній блок' };

  function lineHtml(r) {
    return '<div class="stock-line' + (r.p <= 0 && r.a <= 0 ? ' zero' : '') + '"><span>' + esc(r.name) + '</span><span>всього ' + fmtQty(r.p) + ' · вільно ' + fmtQty(r.a) + '</span></div>';
  }

  /* Вміст розкритої панелі: підсумок «вільно», вік даних, по частинах (внутр./зовн.) → варіанти → склади, комплекти. */
  function panelHtml(parts) {
    const m = sheetModel(parts, index, data);
    const fr = freshness(data, fetchedAt, Date.now());
    let h = '<div class="stock-' + m.summary.status + '"><p class="stock-sum">Вільно: ' + m.parts.map(function (p) { return fmtQty(p.A); }).join(' + ') +
      ' <small>· всього ' + m.parts.map(function (p) { return fmtQty(p.P); }).join(' + ') + '</small></p></div>';
    if (fr.state === 'stale') h += '<div class="stock-warn">Дані про залишки можуть бути неактуальними — востаннє підтверджено ' + esc(fmtAge(fr.ageMin)) + '.</div>';
    else h += '<p class="stock-note">Оновлено ' + esc(fmtAge(fr.ageMin)) + '</p>';
    m.parts.forEach(function (p) {
      h += '<div class="stock-part">';
      const label = ROLE_LABEL[p.role] || (m.parts.length > 1 ? 'Позиція' : '');
      h += '<p class="stock-part-h">' + esc(label ? label + ' · ' + p.marking : p.marking) + '</p>';
      if (!p.found) h += '<div class="stock-none">У 1С такої позиції не знайдено.</div>';
      p.variants.forEach(function (v) {
        h += '<div class="stock-var"><div class="stock-var-n"><span>' + esc(v.name) + '</span><em>' + (v.exact ? 'точний збіг' : 'схожа позиція') + '</em></div>';
        v.rows.forEach(function (r) { h += lineHtml(r); });
        if (v.rows.length > 1) h += '<div class="stock-line total"><span>Разом</span><span>всього ' + fmtQty(v.P) + ' · вільно ' + fmtQty(v.A) + '</span></div>';
        h += '</div>';
      });
      h += '</div>';
    });
    if (m.kit) {
      h += '<div class="stock-kit"><p class="stock-part-h">Комплектів можна зібрати (з одного складу)</p>';
      m.kit.perWh.forEach(function (w) { h += '<div class="stock-line' + (w.kits <= 0 ? ' zero' : '') + '"><span>' + esc(w.name) + '</span><span>' + fmtQty(w.kits) + '</span></div>'; });
      h += '<div class="stock-line total"><span>Разом</span><span>' + fmtQty(m.kit.total) + '</span></div></div>';
    }
    if (m.parts.some(function (p) { return p.variants.some(function (v) { return !v.exact; }); })) {
      h += '<p class="stock-note">Показано всі позиції 1С з тим самим початком маркування (до «-W»/«-S»). Яку брати — вирішуйте самі.</p>';
    }
    return h;
  }

  function fillPanel(panel, parts) { panel.querySelector('.stock-panel-in').innerHTML = panelHtml(parts); }

  function partsOf(slot) { try { return JSON.parse(decodeURIComponent(slot.getAttribute('data-stock-parts'))); } catch (e) { return null; } }

  function paint(rootEl) {
    ensureCss();
    const scope = rootEl || document;
    const slots = scope.querySelectorAll ? scope.querySelectorAll('.stock-slot') : [];
    const fr = freshness(data, fetchedAt, Date.now());
    slots.forEach(function (slot) {
      const row = slot.closest('.row');
      const panel = row ? row.querySelector(':scope > .stock-panel') : null;
      slot.classList.remove('has'); slot.innerHTML = '';
      const parts = partsOf(slot);
      let sm = null;
      if (data && index && fr.state !== 'none' && parts) sm = summarizeParts(parts, index, data);
      if (!sm || !sm.any) { if (panel) panel.remove(); return; } // у 1С такої позиції нема взагалі (пульти, аксесуари…) — кнопки нема
      const open = !!(panel && panel.classList.contains('open'));
      const stale = fr.state === 'stale';
      slot.innerHTML = '<button type="button" class="stock-btn stock-' + sm.status + (stale ? ' stock-stale' : '') + '" aria-expanded="' + open + '" aria-label="Наявність по складах" title="Вільно: ' +
        esc(sm.parts.map(function (p) { return fmtQty(p.A); }).join(' + ')) + (stale ? ' (дані можуть бути неактуальними)' : '') + '">' + ICON + '<i class="stock-dot"></i></button>';
      slot.classList.add('has');
      if (panel) fillPanel(panel, parts); // дані оновились, поки панель відкрита — перемальовуємо її вміст
    });
    if (Date.now() - fetchedAt > TTL_MS && data) refresh(); // тихо оновлюємо, якщо дані застарілі на пристрої
  }

  /* Розкриття/згортання панелі під рядком (плавно: grid-template-rows 0fr↔1fr, як калькулятор). */
  function toggle(btn) {
    const slot = btn.closest('.stock-slot'), row = btn.closest('.row');
    if (!slot || !row || !data || !index) return;
    const parts = partsOf(slot); if (!parts) return;
    let panel = row.querySelector(':scope > .stock-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'stock-panel';
      panel.innerHTML = '<div class="stock-panel-clip"><div class="stock-panel-in"></div></div>';
      const top = row.querySelector(':scope > .row-top');
      (top || row.firstElementChild).insertAdjacentElement('afterend', panel);
      fillPanel(panel, parts);
      void panel.offsetHeight; // зафіксувати стартовий стан, щоб перехід відпрацював
    }
    const open = !panel.classList.contains('open');
    if (open) fillPanel(panel, parts);
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest && e.target.closest('.stock-btn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    toggle(b);
  });

  /* ---- завантаження ---- */
  function refresh() {
    if (typeof sb === 'undefined') return Promise.resolve(null);
    if (loading) return loading;
    loading = sb.rpc('get_stock').then(function (r) {
      if (r.error || !r.data) { data = null; index = null; } // немає доступу чи збій — просто без бейджів
      else { data = r.data; index = buildIndex(data.rows); fetchedAt = Date.now(); }
      paint(document);
      return data;
    }).catch(function () { data = null; index = null; paint(document); return null; })
      .then(function (d) { loading = null; return d; });
    return loading;
  }

  function reset() {
    data = null; index = null; fetchedAt = 0;
    document.querySelectorAll('.stock-panel').forEach(function (p) { p.remove(); });
    document.querySelectorAll('.stock-slot').forEach(function (sl) { sl.classList.remove('has'); sl.innerHTML = ''; });
  }

  /* ---- самодіагностика (CLAUDE.md: нова функція = нова перевірка) ---- */
  const TILE_LISTS = [['split_mhi', 'Спліт / MHI'], ['split_gal', 'Спліт / GAL'], ['multisplit_mhi', 'Мульти спліт / MHI'],
                      ['multisplit_gal', 'Мульти спліт / GAL'], ['semi_mhi', 'Напівпромислові / MHI'], ['semi_gal', 'Напівпромислові / GAL']];

  async function diagCheck(ctx) {
    const out = { issues: [], checked: [] };
    const area = DIAG_AREA.stock;
    const tgt = { tab: 'catalog' };
    await refresh();
    if (!data) { out.issues.push(diagIssue(area, 'access', 'warning', 'Не вдалося отримати залишки (get_stock)', ['Перевірте, що SQL залишків застосовано в Supabase і ваш профіль підтверджений адміном.'], tgt)); return out; }
    const fr = freshness(data, fetchedAt, Date.now());
    if (fr.state === 'none') {
      out.issues.push(diagIssue(area, 'sync', 'info', 'Синхронізація залишків з 1С ще жодного разу не приходила', [], tgt));
    } else if (fr.state === 'stale') {
      out.issues.push(diagIssue(area, 'sync', 'error', 'Залишки не оновлювались: останній успішний зріз ' + fmtAge(fr.ageMin), ['Перевірте регламентне завдання в 1С і журнал синхронізації.'], tgt));
    } else if (fr.state === 'aging') {
      out.issues.push(diagIssue(area, 'sync', 'warning', 'Залишки оновлювались ' + fmtAge(fr.ageMin) + ' — довше за норму', [], tgt));
    }
    out.checked.push({ area: area, sub: 'sync', label: 'Свіжість залишків з 1С', detail: fr.state === 'none' ? 'ще не було синхронізацій' : 'оновлено ' + fmtAge(fr.ageMin) });

    try {
      const r = await sb.rpc('get_stock_sync_log', { p_limit: 10 });
      const bad = r && r.data && r.data.log ? r.data.log.filter(function (l) { return l.status === 'rejected' || l.status === 'error'; }) : [];
      if (bad.length) out.issues.push(diagIssue(area, 'log', 'warning', 'Відхилені або помилкові синхронізації серед останніх 10',
        bad.slice(0, 5).map(function (l) { return String(l.started_at).slice(0, 16).replace('T', ' ') + ' — ' + l.status + ': ' + (l.reason || ''); }), tgt));
      out.checked.push({ area: area, sub: 'log', label: 'Журнал синхронізацій (останні 10)', detail: bad.length ? bad.length + ' відхилено/помилок' : 'без відхилень' });
    } catch (e) { /* журнал недоступний — не блокуємо інші перевірки */ }

    // Покриття: скільки позицій прайсу мають збіг у 1С; без збігу — не обов'язково помилка (пульти, нуль на складі).
    if (fr.state !== 'none') {
      const data0 = (ctx && ctx.data) || (typeof sheetsData !== 'undefined' ? sheetsData : {});
      let total = 0, matched = 0; const lines = [];
      TILE_LISTS.forEach(function (tl) {
        const list = data0[tl[0]] || [];
        list.forEach(function (it) {
          const sm = summarizeParts(partsFor(it, tl[0], list), index, data);
          total++;
          if (sm.any) matched++; else lines.push(tl[1] + ': ' + it.model);
        });
      });
      if (lines.length) out.issues.push(diagIssue(area, 'coverage', 'info', 'Позиції прайсу без жодного збігу в 1С: ' + lines.length + ' із ' + total,
        ['Зазвичай це пульти/аксесуари або моделі, яких немає в 1С у ваших складах.'].concat(lines), tgt));
      out.checked.push({ area: area, sub: 'coverage', label: 'Зіставлення позицій прайсу з 1С (Спліт/Мульти/Напівпром)', detail: matched + ' із ' + total + ' мають збіг' });
    }
    return out;
  }

  if (typeof DIAG_AREA !== 'undefined') DIAG_AREA.stock = DIAG_AREA.stock || 'Залишки з 1С';
  if (typeof DIAG_CHECKS !== 'undefined' && !DIAG_CHECKS.some(function (c) { return c.id === 'stock'; })) {
    DIAG_CHECKS.push({ id: 'stock', label: 'Залишки з 1С', run: function (ctx) { return diagCheck(ctx); } });
  }

  root.Stock = Object.assign({ slotHtml: slotHtml, paint: paint, refresh: refresh, reset: reset, toggle: toggle, diagCheck: diagCheck }, api);
})(typeof window !== 'undefined' ? window : globalThis);
