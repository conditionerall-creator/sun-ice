/* Sun-ice — наявність товарів з 1С: кнопка в ряду кнопок рядка прайсу → плавно розкрита КОРОТКА панель (основні склади,
   де товар є) → кнопка «Повна інформація» з усіма складами, фільтрами й нульовими залишками.
   Підвантажується з index.html ДИНАМІЧНО і лише адмінам (regional_admin/super_admin) — звичайні користувачі й гості цей
   файл не завантажують. План і рішення: claude/stock-1c/00-ПЛАН-І-СТАТУС.md.

   ДАНІ: RPC get_stock() (SQL claude/sql/2026-10-02-stock-1c.sql + 2026-10-05-stock-all-warehouses.sql). З 2026-10-05 усі
   підтверджені адміни бачать УСІ склади; склад має kind = 'main' (основний) | 'additional' (додатковий) і назву регіону.
   Короткі підсумки («Вільно: …», колір кнопки) рахуються ЛИШЕ по основних складах; додаткові — у повній інформації.

   ЗІСТАВЛЕННЯ «ЗА ОСНОВОЮ» (рішення власника 2026-10-02): ключ = назва без пробілів, верхній регістр, кирилічні «двійники»
   → латиниця. ОСНОВА = маркування до першого -W/-S включно; показуємо ВСІ позиції 1С, що починаються з основи (SRC35ZS-W,
   -W1, -W2 …); маркування без -W/-S — лише точний збіг. Для аксесуарів у прайсі маркування — текст ДО першої коми
   («RC-E5, дротовий пульт…» → RC-E5). normKey ДОСЛІВНО дублює parse.ts (claude/edge-functions/stock-sync/).

   «НАЗАД» ЗАКРИВАЄ ПАНЕЛЬ/ВІКНО: відкритий шар додає запис в історію (pushState з тим самим URL), а в index.html у
   обробнику popstate стоїть один рядок `Stock.onBack(...)`. Одночасно відкрита лише одна панель.

   Чиста логіка (normKey … fullView) відділена від DOM і тестується в Node: claude/stock-1c/tests/stock.test.mjs.
   Глобали з index.html (sb, sheetsData, DIAG_CHECKS, DIAG_AREA, diagIssue) — лише всередині функцій. */
(function (root) {
  'use strict';

  /* ---------------- ЧИСТА ЛОГІКА ---------------- */

  const HOMO = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
                 'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O', 'р': 'P', 'с': 'C', 'т': 'T', 'х': 'X' };

  function normKey(s) {
    return String(s == null ? '' : s)
      .replace(/[\s ]+/g, '')
      .replace(/[АВЕКМНОРСТХавекмнорстх]/g, function (ch) { return HOMO[ch] || ch; })
      .toUpperCase();
  }

  /* Основа маркування: до першого -W/-S включно; null — основи нема (тоді лише точний збіг). */
  function baseOf(key) {
    const m = /-[WS]/.exec(key);
    return m ? key.slice(0, m.index + 2) : null;
  }

  /* Маркування в рядку прайсу = текст до першої коми/нового рядка («RC-E5, дротовий пульт…» → «RC-E5»). */
  function leadOf(s) { return String(s == null ? '' : s).split(/[,\n]/)[0].trim(); }

  const isMain = function (w) { return w.kind !== 'additional'; };
  const sum = function (arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); };
  const qty = function (v, code, field) { return v.wh[code] ? v.wh[code][field] : 0; };

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

  /* Підсумок по частинах рядка (внутр./зовн. блок). P/A — лише ОСНОВНІ склади (від них колір і «Вільно: …»);
     PX/AX — додаткові склади окремо. found — чи є позиція в 1С взагалі (на будь-якому складі). */
  function summarizeParts(parts, index, data) {
    const whs = data.warehouses || [];
    const main = whs.filter(isMain).map(function (w) { return w.code; });
    const extra = whs.filter(function (w) { return !isMain(w); }).map(function (w) { return w.code; });
    const res = parts.map(function (p) {
      const variants = matchVariants(index, p.m);
      const tot = function (codes, field) { return sum(variants, function (v) { return sum(codes, function (c) { return qty(v, c, field); }); }); };
      return { marking: p.m, role: p.role || null, variants: variants, found: variants.length > 0,
               P: tot(main, 'p'), A: tot(main, 'a'), PX: tot(extra, 'p'), AX: tot(extra, 'a') };
    });
    const any = res.some(function (r) { return r.found; });
    const minA = res.length ? Math.min.apply(null, res.map(function (r) { return r.A; })) : 0;
    const low = Number(data.low_threshold);
    const status = minA <= 0 ? 'out' : (minA <= (isFinite(low) ? low : 2) ? 'low' : 'ok');
    return { parts: res, any: any, minA: minA, status: status };
  }

  /* Комплектів з ОДНОГО складу: min(внутр., зовн.) по складу; whs — перелік складів, що враховуємо. */
  function kitFor(summary, whs) {
    const ind = summary.parts.filter(function (p) { return p.role === 'indoor'; })[0];
    const out = summary.parts.filter(function (p) { return p.role === 'outdoor'; })[0];
    if (!ind || !out) return null;
    const perWh = whs.map(function (w) {
      const a = sum(ind.variants, function (v) { return qty(v, w.code, 'a'); });
      const b = sum(out.variants, function (v) { return qty(v, w.code, 'a'); });
      return { code: w.code, name: w.name, kind: w.kind, kits: Math.min(a, b) };
    });
    return { perWh: perWh, total: sum(perWh, function (x) { return x.kits; }) };
  }

  /* Частини рядка прайсу: [{m: маркування, role: 'indoor'|'outdoor'|null}]. list — увесь список плитки (для братів). */
  function partsFor(it, listKey, list) {
    if (!it || !it.model) return [];
    const model = leadOf(it.model);
    if (!model) return [];
    const isSplit = listKey === 'split_mhi' || listKey === 'split_gal';
    if (it.unitType === 'outdoor') return [{ m: model, role: 'outdoor' }];
    if (isSplit) {
      if (it.unitType !== 'indoor') return [{ m: model, role: null }];
      const parts = [{ m: model, role: 'indoor' }];
      let out = it.splitOutdoor || null;
      if (!out && list) {
        // Кольорові варіанти (-WT/-WB) зовнішнього рядка в прайсі не мають — беремо зовнішній «брата» з тією ж основою.
        const base = baseOf(normKey(model));
        const sib = base && list.filter(function (x) { return x.splitOutdoor && x.unitType === 'indoor' && baseOf(normKey(x.model)) === base; })[0];
        if (sib) out = sib.splitOutdoor;
      }
      if (out) parts.push({ m: out, role: 'outdoor' });
      return parts;
    }
    if (listKey === 'semi_gal') {
      const parts = [{ m: model, role: 'indoor' }];
      if (it.outdoorModel) parts.push({ m: it.outdoorModel, role: 'outdoor' });
      return parts;
    }
    if (listKey === 'semi_mhi' && model.indexOf('+') !== -1) {
      const bits = model.split('+').map(function (s) { return s.trim(); }).filter(Boolean);
      return bits.map(function (b, i) { return { m: b, role: i === 0 ? 'indoor' : (i === bits.length - 1 ? 'outdoor' : null) }; });
    }
    return [{ m: model, role: it.unitType || null }];
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

  /* КОРОТКА панель: основні склади, де товар є (всього > 0), одним рядком на склад; варіанти за основою складаються.
     extra — що є на додаткових складах (лише підсумок, деталі — у повній інформації). */
  function compactView(parts, index, data) {
    const summary = summarizeParts(parts, index, data);
    const whs = data.warehouses || [];
    const rows = whs.filter(isMain).map(function (w) {
      return { code: w.code, name: w.name, vals: summary.parts.map(function (p) {
        return { p: sum(p.variants, function (v) { return qty(v, w.code, 'p'); }), a: sum(p.variants, function (v) { return qty(v, w.code, 'a'); }) };
      }) };
    }).filter(function (r) { return r.vals.some(function (x) { return x.p > 0; }); });
    const exVals = summary.parts.map(function (p) { return { p: p.PX, a: p.AX }; });
    const similar = sum(summary.parts, function (p) { return p.variants.filter(function (v) { return !v.exact; }).length; });
    return { summary: summary, rows: rows, extra: { vals: exVals, any: exVals.some(function (x) { return x.p > 0; }) }, similar: similar };
  }

  /* Фільтр складів: kind 'all'|'main'|'additional'; region 'all'|назва регіону. */
  function applyFilter(whs, f) {
    return whs.filter(function (w) {
      if (f.kind === 'main' && !isMain(w)) return false;
      if (f.kind === 'additional' && isMain(w)) return false;
      if (f.region && f.region !== 'all' && w.region !== f.region) return false;
      return true;
    });
  }

  /* ПОВНА інформація: усі склади (за фільтром), навіть із нулями; f.only — лише де є (всього > 0). */
  function fullView(parts, index, data, f) {
    f = f || { kind: 'all', region: 'all', only: false };
    const summary = summarizeParts(parts, index, data);
    const whs = applyFilter(data.warehouses || [], f);
    const kit = kitFor(summary, whs);
    if (kit && f.only) { kit.perWh = kit.perWh.filter(function (x) { return x.kits > 0; }); kit.total = sum(kit.perWh, function (x) { return x.kits; }); }
    return {
      summary: summary,
      parts: summary.parts.map(function (p) {
        return {
          marking: p.marking, role: p.role, found: p.found,
          variants: p.variants.map(function (v) {
            let rows = whs.map(function (w) { return { code: w.code, name: w.name, kind: w.kind, region: w.region, p: qty(v, w.code, 'p'), a: qty(v, w.code, 'a') }; });
            if (f.only) rows = rows.filter(function (r) { return r.p > 0; });
            return { name: v.n, exact: v.exact, rows: rows, P: sum(rows, function (r) { return r.p; }), A: sum(rows, function (r) { return r.a; }) };
          })
        };
      }),
      kit: kit
    };
  }

  const api = { normKey: normKey, baseOf: baseOf, leadOf: leadOf, buildIndex: buildIndex, matchVariants: matchVariants, summarizeParts: summarizeParts,
                kitFor: kitFor, partsFor: partsFor, freshness: freshness, fmtAge: fmtAge, fmtQty: fmtQty,
                compactView: compactView, applyFilter: applyFilter, fullView: fullView };

  if (typeof document === 'undefined') { // Node (тести): лише чиста логіка
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  /* ---------------- БРАУЗЕР: стан, кнопка, панель, вікно, історія, діагностика ---------------- */

  const TTL_MS = 5 * 60 * 1000; // на пристрої тримаємо зріз не довше 5 хв (кеш лише в пам'яті — на спільних пристроях нічого не лишається)
  let data = null, index = null, fetchedAt = 0, loading = null;
  let filt = { kind: 'all', region: 'all', only: false }; // фільтри вікна «Повна інформація» (живуть до перезавантаження сторінки)

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
    '.stock-sum{display:flex;align-items:center;flex-wrap:wrap;gap:2px 6px;font-weight:700;font-size:13.5px;margin:0 0 2px}' +
    '.stock-sum::before{content:"";flex:0 0 9px;width:9px;height:9px;border-radius:50%;background:var(--stock-c,#8B8682)}' +
    '.stock-sum small{font-weight:500;color:var(--text-secondary);font-size:12px}' +
    '.stock-note{font-size:12px;color:var(--text-secondary);margin:4px 0 0;line-height:1.45}' +
    '.stock-warn{background:var(--accent-bg);border-radius:10px;padding:7px 10px;color:var(--text);font-size:12.5px;margin:6px 0 8px}' +
    '.stock-wl{margin-top:6px}' +
    '.stock-more{margin-top:10px;width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font:600 13px/1.2 inherit;font-family:inherit;cursor:pointer}' +
    '.stock-more:active{background:var(--accent-bg)}' +
    '.stock-part{margin-bottom:10px}' +
    '.stock-part-h{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);margin:0 0 6px}' +
    '.stock-var{border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--bg)}' +
    '.stock-var-n{font-weight:600;font-size:13.5px;display:flex;justify-content:space-between;gap:8px}' +
    '.stock-var-n em{font-style:normal;font-weight:500;font-size:11px;color:var(--text-secondary)}' +
    '.stock-grp{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);margin:6px 0 1px}' +
    '.stock-line{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:2px 0}' +
    '.stock-line span:last-child{white-space:nowrap}' +
    '.stock-line.zero{color:var(--text-secondary)}' +
    '.stock-line.total{border-top:1px dashed var(--border);margin-top:3px;padding-top:4px;font-weight:600}' +
    '.stock-kit{border-top:1px solid var(--border);padding-top:10px;margin-top:4px}' +
    '.stock-none{font-size:13px;color:var(--text-secondary)}' +
    '.stock-filters{padding:10px 16px 2px;border-bottom:1px solid var(--border)}' +
    '.stock-chips{display:flex;gap:6px;overflow-x:auto;padding:0 0 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}' +
    '.stock-chips::-webkit-scrollbar{display:none}' +
    '.stock-chip{flex:0 0 auto;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:999px;padding:5px 11px;font:600 12px/1.2 inherit;font-family:inherit;cursor:pointer}' +
    '.stock-chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}';

  function ensureCss() {
    if (document.getElementById('stock-css')) return;
    const st = document.createElement('style'); st.id = 'stock-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function listFor(listKey) { return (typeof sheetsData !== 'undefined' && sheetsData[listKey]) || []; }

  /* ---- «Назад» закриває шари (панель, вікно) ---- */
  const layers = []; // {type:'panel'|'sheet', row?, close(), alive()}
  let swallow = 0;   // скільки найближчих popstate викликані НАМИ (history.go) і не мають закривати ще один шар

  function histDepth() { return (history.state && history.state.stockLayer) || 0; }

  function reconcileHistory() { // прибрати наші зайві записи історії, якщо шарів стало менше
    const extra = histDepth() - layers.length;
    if (extra > 0) { swallow++; history.go(-extra); }
  }

  function pushLayer(layer) {
    layers.push(layer);
    try { history.pushState(Object.assign({}, history.state || {}, { stockLayer: layers.length }), '', location.href); } catch (e) { /* без історії — «Назад» просто піде як завжди */ }
  }

  function popLayerUi() { // шар закрито кнопкою/кліком, а не «Назад»
    const l = layers.pop();
    if (!l) return;
    l.close();
    reconcileHistory();
  }

  function syncLayers() { // після перемальовування списку: прибрати шари, чиї елементи зникли з DOM
    for (let i = layers.length - 1; i >= 0; i--) if (!layers[i].alive()) layers.splice(i, 1);
    reconcileHistory();
  }

  /* Викликається з обробника popstate в index.html. true → «Назад» поглинуто (app нічого більше не робить). */
  function onBack() {
    if (swallow > 0) { swallow--; return true; }
    while (layers.length) {
      const l = layers.pop();
      if (l.alive()) { l.close(); return true; }
    }
    return false;
  }

  /* ---- кнопка в рядку ---- */
  function slotHtml(it, listKey) {
    let parts;
    try { parts = partsFor(it, listKey, listFor(listKey)); } catch (e) { parts = []; }
    if (!parts.length) return '';
    return '<span class="stock-slot" data-stock-parts="' + esc(encodeURIComponent(JSON.stringify(parts))) + '"></span>';
  }

  function partsOf(slot) { try { return JSON.parse(decodeURIComponent(slot.getAttribute('data-stock-parts'))); } catch (e) { return null; } }
  const joinQ = function (vals, f) { return vals.map(function (x) { return fmtQty(x[f]); }).join(' + '); };

  /* ---- КОРОТКА панель ---- */
  function panelHtml(parts) {
    const v = compactView(parts, index, data);
    const s = v.summary;
    const pair = s.parts.length > 1;
    const fr = freshness(data, fetchedAt, Date.now());
    let h = '<div class="stock-' + s.status + '"><p class="stock-sum">Вільно: ' + joinQ(s.parts, 'A') + (pair ? ' <small>(внутр. + зовн.)</small>' : '') +
      ' <small>· всього ' + joinQ(s.parts, 'P') + '</small></p></div>';
    h += fr.state === 'stale'
      ? '<div class="stock-warn">Дані про залишки можуть бути неактуальними — востаннє підтверджено ' + esc(fmtAge(fr.ageMin)) + '.</div>'
      : '<p class="stock-note">Основні склади · оновлено ' + esc(fmtAge(fr.ageMin)) + '</p>';
    h += '<div class="stock-wl">';
    if (v.rows.length) {
      v.rows.forEach(function (r) {
        h += '<div class="stock-line"><span>' + esc(r.name) + '</span><span>вільно ' + joinQ(r.vals, 'a') + ' · всього ' + joinQ(r.vals, 'p') + '</span></div>';
      });
    } else h += '<div class="stock-none">На основних складах немає.</div>';
    h += '</div>';
    s.parts.filter(function (p) { return !p.found; }).forEach(function (p) { h += '<p class="stock-note">У 1С не знайдено: ' + esc(p.marking) + '</p>'; });
    if (v.extra.any) h += '<p class="stock-note">На додаткових складах: вільно ' + joinQ(v.extra.vals, 'a') + ' · всього ' + joinQ(v.extra.vals, 'p') + '</p>';
    if (v.similar) h += '<p class="stock-note">Враховано також схожі позиції 1С (-W1, -W2 …): ' + v.similar + '</p>';
    h += '<button type="button" class="stock-more">Повна інформація</button>';
    return h;
  }

  function fillPanel(panel, parts) { panel.querySelector('.stock-panel-in').innerHTML = panelHtml(parts); }

  function closePanelEl(panel) {
    panel.classList.remove('open');
    const row = panel.closest('.row'), b = row && row.querySelector('.stock-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

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
      if (!sm || !sm.any) { if (panel) panel.remove(); return; } // у 1С такої позиції нема взагалі — кнопки нема
      const open = !!(panel && panel.classList.contains('open'));
      const stale = fr.state === 'stale';
      slot.innerHTML = '<button type="button" class="stock-btn stock-' + sm.status + (stale ? ' stock-stale' : '') + '" aria-expanded="' + open + '" aria-label="Наявність по складах" title="Вільно (основні склади): ' +
        esc(joinQ(sm.parts, 'A')) + (stale ? ' — дані можуть бути неактуальними' : '') + '">' + ICON + '<i class="stock-dot"></i></button>';
      slot.classList.add('has');
      if (panel) fillPanel(panel, parts); // дані оновились, поки панель відкрита — перемальовуємо її вміст
    });
    syncLayers();
    if (document.getElementById('stock-sheet') && document.getElementById('stock-sheet').classList.contains('show')) renderSheet();
    if (Date.now() - fetchedAt > TTL_MS && data) refresh(); // тихо оновлюємо, якщо дані застарілі на пристрої
  }

  /* Розкриття/згортання панелі під рядком (плавно: grid-template-rows 0fr↔1fr). Одночасно відкрита лише одна. */
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
    if (panel.classList.contains('open')) { // згорнути
      const top = layers[layers.length - 1];
      if (top && top.type === 'panel' && top.row === row) popLayerUi(); else closePanelEl(panel);
      return;
    }
    document.querySelectorAll('.stock-panel.open').forEach(function (p) { if (p !== panel) closePanelEl(p); }); // акордеон
    fillPanel(panel, parts);
    panel.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const layer = { type: 'panel', row: row, close: function () { closePanelEl(panel); }, alive: function () { return document.body.contains(panel); } };
    const idx = layers.map(function (l) { return l.type; }).lastIndexOf('panel');
    if (idx >= 0) layers[idx] = layer; // замінили відкриту панель іншою — запис історії той самий
    else pushLayer(layer);
  }

  /* ---- ВІКНО «Повна інформація» (низ екрана, стиль info-sheet) ---- */
  let sheetParts = null;

  function ensureSheet() {
    let el = document.getElementById('stock-sheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'stock-sheet'; el.className = 'info-sheet-overlay';
    el.innerHTML = '<div class="info-sheet-backdrop"></div><div class="info-sheet-panel"><div class="info-sheet-header"><div class="info-sheet-title" id="stock-sheet-title"></div>' +
      '<button type="button" class="info-sheet-close" aria-label="Закрити">✕</button></div><div class="stock-filters" id="stock-sheet-filters"></div>' +
      '<div class="info-sheet-body stock-sheet-body" id="stock-sheet-body" style="white-space:normal"></div></div>';
    document.body.appendChild(el);
    const closeUi = function () { const t = layers[layers.length - 1]; if (t && t.type === 'sheet') popLayerUi(); else el.classList.remove('show'); };
    el.querySelector('.info-sheet-backdrop').addEventListener('click', closeUi);
    el.querySelector('.info-sheet-close').addEventListener('click', closeUi);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const t = layers[layers.length - 1]; if (t) popLayerUi(); } });
    return el;
  }

  const ROLE_LABEL = { indoor: 'Внутрішній блок', outdoor: 'Зовнішній блок' };

  function chipsHtml(group, items, current) {
    return '<div class="stock-chips">' + items.map(function (it) {
      return '<button type="button" class="stock-chip" data-fg="' + group + '" data-fv="' + esc(it[0]) + '" aria-pressed="' + (String(current) === String(it[0])) + '">' + esc(it[1]) + '</button>';
    }).join('') + '</div>';
  }

  function filtersHtml() {
    const regions = []; (data.warehouses || []).forEach(function (w) { if (w.region && regions.indexOf(w.region) === -1) regions.push(w.region); });
    return chipsHtml('kind', [['all', 'Усі склади'], ['main', 'Основні'], ['additional', 'Додаткові']], filt.kind) +
      chipsHtml('region', [['all', 'Усі регіони']].concat(regions.map(function (r) { return [r, r]; })), filt.region) +
      '<div class="stock-chips"><button type="button" class="stock-chip" data-fg="only" data-fv="toggle" aria-pressed="' + filt.only + '">Лише де є в наявності</button></div>';
  }

  function lineHtml(r) {
    return '<div class="stock-line' + (r.p <= 0 && r.a <= 0 ? ' zero' : '') + '"><span>' + esc(r.name) + '</span><span>всього ' + fmtQty(r.p) + ' · вільно ' + fmtQty(r.a) + '</span></div>';
  }

  function variantRowsHtml(rows) {
    const main = rows.filter(function (r) { return r.kind !== 'additional'; }), add = rows.filter(function (r) { return r.kind === 'additional'; });
    let h = '';
    if (main.length) { if (add.length) h += '<div class="stock-grp">Основні склади</div>'; h += main.map(lineHtml).join(''); }
    if (add.length) { h += '<div class="stock-grp">Додаткові склади</div>' + add.map(lineHtml).join(''); }
    return h;
  }

  function renderSheet() {
    if (!sheetParts || !data || !index) return;
    const el = ensureSheet();
    const m = fullView(sheetParts, index, data, filt);
    const fr = freshness(data, fetchedAt, Date.now());
    el.querySelector('#stock-sheet-title').textContent = sheetParts.map(function (p) { return p.m; }).join(' + ');
    el.querySelector('#stock-sheet-filters').innerHTML = filtersHtml();
    let h = fr.state === 'stale'
      ? '<div class="stock-warn">Дані про залишки можуть бути неактуальними — востаннє підтверджено ' + esc(fmtAge(fr.ageMin)) + '.</div>'
      : '<p class="stock-note" style="margin:0 0 10px">Оновлено ' + esc(fmtAge(fr.ageMin)) + '</p>';
    m.parts.forEach(function (p) {
      h += '<div class="stock-part">';
      const label = ROLE_LABEL[p.role] || (m.parts.length > 1 ? 'Позиція' : '');
      h += '<p class="stock-part-h">' + esc(label ? label + ' · ' + p.marking : p.marking) + '</p>';
      if (!p.found) h += '<div class="stock-none">У 1С такої позиції не знайдено.</div>';
      p.variants.forEach(function (v) {
        h += '<div class="stock-var"><div class="stock-var-n"><span>' + esc(v.name) + '</span><em>' + (v.exact ? 'точний збіг' : 'схожа позиція') + '</em></div>';
        h += v.rows.length ? variantRowsHtml(v.rows) : '<div class="stock-none">На вибраних складах немає.</div>';
        if (v.rows.length > 1) h += '<div class="stock-line total"><span>Разом</span><span>всього ' + fmtQty(v.P) + ' · вільно ' + fmtQty(v.A) + '</span></div>';
        h += '</div>';
      });
      h += '</div>';
    });
    if (m.kit) {
      h += '<div class="stock-kit"><p class="stock-part-h">Комплектів можна зібрати (з одного складу)</p>';
      h += m.kit.perWh.length ? m.kit.perWh.map(function (w) { return '<div class="stock-line' + (w.kits <= 0 ? ' zero' : '') + '"><span>' + esc(w.name) + '</span><span>' + fmtQty(w.kits) + '</span></div>'; }).join('') : '<div class="stock-none">На вибраних складах немає.</div>';
      h += '<div class="stock-line total"><span>Разом</span><span>' + fmtQty(m.kit.total) + '</span></div></div>';
    }
    if (m.parts.some(function (p) { return p.variants.some(function (v) { return !v.exact; }); })) {
      h += '<p class="stock-note">Показано всі позиції 1С з тим самим початком маркування (до «-W»/«-S»). Яку брати — вирішуйте самі.</p>';
    }
    el.querySelector('#stock-sheet-body').innerHTML = h;
  }

  function openSheet(parts) {
    if (!data || !index) return;
    ensureCss();
    sheetParts = parts;
    const el = ensureSheet();
    renderSheet();
    el.querySelector('#stock-sheet-body').scrollTop = 0;
    if (!el.classList.contains('show')) {
      el.classList.add('show');
      pushLayer({ type: 'sheet', close: function () { el.classList.remove('show'); }, alive: function () { return el.classList.contains('show'); } });
    }
  }

  /* ---- кліки ---- */
  document.addEventListener('click', function (e) {
    const t = e.target; if (!t || !t.closest) return;
    const b = t.closest('.stock-btn');
    if (b) { e.preventDefault(); e.stopPropagation(); toggle(b); return; }
    const more = t.closest('.stock-more');
    if (more) {
      e.preventDefault(); e.stopPropagation();
      const row = more.closest('.row'), slot = row && row.querySelector('.stock-slot'), parts = slot && partsOf(slot);
      if (parts) openSheet(parts);
      return;
    }
    const chip = t.closest('.stock-chip');
    if (chip) {
      e.preventDefault(); e.stopPropagation();
      const g = chip.getAttribute('data-fg'), v = chip.getAttribute('data-fv');
      if (g === 'only') filt.only = !filt.only; else filt[g] = v;
      renderSheet();
    }
  });

  /* ---- завантаження ---- */
  function refresh() {
    if (typeof sb === 'undefined') return Promise.resolve(null);
    if (loading) return loading;
    loading = sb.rpc('get_stock').then(function (r) {
      if (r.error || !r.data) { data = null; index = null; } // немає доступу чи збій — просто без кнопок
      else { data = r.data; index = buildIndex(data.rows); fetchedAt = Date.now(); }
      paint(document);
      return data;
    }).catch(function () { data = null; index = null; paint(document); return null; })
      .then(function (d) { loading = null; return d; });
    return loading;
  }

  function reset() {
    data = null; index = null; fetchedAt = 0;
    layers.length = 0;
    document.querySelectorAll('.stock-panel').forEach(function (p) { p.remove(); });
    document.querySelectorAll('.stock-slot').forEach(function (sl) { sl.classList.remove('has'); sl.innerHTML = ''; });
    const sh = document.getElementById('stock-sheet'); if (sh) sh.classList.remove('show');
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

    // Покриття: скільки позицій прайсу мають збіг у 1С; без збігу — не обов'язково помилка (немає в 1С, інша назва).
    if (fr.state !== 'none') {
      const data0 = (ctx && ctx.data) || (typeof sheetsData !== 'undefined' ? sheetsData : {});
      let total = 0, matched = 0; const lines = [];
      TILE_LISTS.forEach(function (tl) {
        const list = data0[tl[0]] || [];
        list.forEach(function (it) {
          const sm = summarizeParts(partsFor(it, tl[0], list), index, data);
          total++;
          if (sm.any) matched++; else lines.push(tl[1] + ': ' + leadOf(it.model));
        });
      });
      if (lines.length) out.issues.push(diagIssue(area, 'coverage', 'info', 'Позиції прайсу без жодного збігу в 1С: ' + lines.length + ' із ' + total,
        ['Це моделі/аксесуари, яких немає у звіті 1С (або названі там інакше).'].concat(lines), tgt));
      out.checked.push({ area: area, sub: 'coverage', label: 'Зіставлення позицій прайсу з 1С (Спліт/Мульти/Напівпром, разом з аксесуарами)', detail: matched + ' із ' + total + ' мають збіг' });
    }
    return out;
  }

  if (typeof DIAG_AREA !== 'undefined') DIAG_AREA.stock = DIAG_AREA.stock || 'Залишки з 1С';
  if (typeof DIAG_CHECKS !== 'undefined' && !DIAG_CHECKS.some(function (c) { return c.id === 'stock'; })) {
    DIAG_CHECKS.push({ id: 'stock', label: 'Залишки з 1С', run: function (ctx) { return diagCheck(ctx); } });
  }

    /* panelHtml відкрито назовні 2026-10-09: панель товару показує наявність ВСЕРЕДИНІ
     себе, окремою вкладкою. Без цього довелось би або дублювати тут усю верстку
     залишків, або закривати панель і відкривати повноекранний лист — а тоді
     зникали б кнопки меню, на що власник і поскаржився. */
  root.Stock = Object.assign({ slotHtml: slotHtml, paint: paint, refresh: refresh, reset: reset, toggle: toggle, openSheet: openSheet, onBack: onBack, diagCheck: diagCheck, panelHtml: panelHtml, hasData: function () { return !!(data && index); } }, api);
})(typeof window !== 'undefined' ? window : globalThis);
