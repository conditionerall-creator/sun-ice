/* Sun-ice — наявність товарів з 1С: кнопка в ряду кнопок рядка прайсу → плавно розкрита КОРОТКА панель (основні склади,
   де товар є) → кнопка «Повна інформація» з усіма складами, фільтрами й нульовими залишками.
   Підвантажується ДИНАМІЧНО всім, хто бачить ЦІНИ (hasFullAccess) — гості файл не завантажують узагалі.
   План і рішення: claude/stock-1c/00-ПЛАН-І-СТАТУС.md.

   ДВА РЕЖИМИ (з 2026-10-16, рішення власника). Сервер сам вирішує, що віддати, і повертає це в data.mode:
     'user'  — ДИЛЕР: лише основні склади СВОГО регіону (profiles.region_id) + data.elsewhere (перелік маркувань,
               доступних на інших складах, БЕЗ цифр і назв складів). Бачить ТІЛЬКИ позначку в рядку прайсу:
               «>5 шт.» / «<5 шт.» / «0». Ні кнопки, ні панелі, ні назв складів.
     'admin' — усе, як раніше: кнопка → панель → «Повна інформація». Плюс та сама позначка по своєму регіону.
   Фільтрує САМЕ СЕРВЕР (get_stock), а не цей файл: інакше залишки чужих складів лежали б у браузері.

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

  /* Індекс з рядків get_stock: key → { n: назва 1С, wh: { код_складу: {p, a} }, from: [склеєні назви] }

     СКЛЕЄНІ НАЗВИ (знайдено власником 2026-10-16). У 1С частина комплектів заведена одним рядком
     через скісну риску: «SRK50HE-S1/SRC50HE-S1». Це не окремий товар, а два маркування того самого
     комплекту. Раніше такий рядок не збігався з жодним маркуванням прайсу й потрапляв у «схожі
     позиції», а дилер бачив «0» на товар, якого насправді 14 штук.
     Тепер склеєний рядок РОЗКЛАДАЄТЬСЯ на обидві частини, кількості додаються до кожної, а сам
     склеєний ключ в індексі не лишається (інакше ті самі штуки рахувалися б двічі). Початкова
     назва зберігається в `from`, щоб адмін бачив, звідки взялись числа. */
  function buildIndex(rows) {
    const byKey = new Map();
    const add = function (key, name, w, p, a, src) {
      let e = byKey.get(key);
      if (!e) { e = { k: key, n: name, wh: {}, from: [] }; byKey.set(key, e); }
      const cur = e.wh[w] || (e.wh[w] = { p: 0, a: 0 });
      cur.p += p; cur.a += a;
      if (src && e.from.indexOf(src) === -1) e.from.push(src);
    };
    (rows || []).forEach(function (r) {
      const p = Number(r.p) || 0, a = Number(r.a) || 0;
      const parts = String(r.k == null ? '' : r.k).split('/').map(function (x) { return x.trim(); }).filter(Boolean);
      if (parts.length > 1) parts.forEach(function (pk) { add(pk, pk, r.w, p, a, r.n); });
      else add(r.k, r.n, r.w, p, a, null);
    });
    return { byKey: byKey, keys: Array.from(byKey.keys()).sort() };
  }

  /* Маркування, яких у МОЄМУ регіоні немає, але вони є на інших основних складах.
     Дилеру цей перелік дає сервер (кількостей і назв складів він не отримує). АДМІНУ сервер віддає
     всі склади, тож список для нього порожній — рахуємо тут із тих самих рядків. Без цього будь-який
     нуль у свого адміна ставав ЧЕРВОНИМ «немає ніде», хоча товар лежав у Києві (знайдено власником). */
  function elsewhereSet(data, whs) {
    const set = Object.create(null);
    const add = function (k) {
      if (!k) return;
      set[k] = 1;
      String(k).split('/').forEach(function (p) { const t = p.trim(); if (t) set[t] = 1; });
    };
    (data.elsewhere || []).forEach(add);
    if (data.mode === 'admin') {
      const mine = Object.create(null);
      whs.forEach(function (w) { mine[w.code] = 1; });
      const outside = Object.create(null);
      (data.warehouses || []).forEach(function (w) { if (isMain(w) && !mine[w.code]) outside[w.code] = 1; });
      /* За ЗАГАЛЬНИМ залишком, а не за вільним: якщо на складі 4 штуки й усі зарезервовані,
         товар фізично є — менеджер може домовитись. Казати «немає ніде» в такому разі неправда. */
      (data.rows || []).forEach(function (r) { if (outside[r.w] && (Number(r.p) || 0) > 0) add(r.k); });
    }
    return set;
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
        out.push({ k: key, n: e.n, exact: key === k, wh: e.wh, from: e.from || [] });
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

  /* КОРОТКА панель (адміни): ТІЛЬКИ ТОЧНИЙ ЗБІГ по основних складах, де товар є.
     З 2026-10-16 схожі позиції сюди НЕ потрапляють (рішення власника): коротка панель має давати
     однозначну відповідь, а різні -W1/-W2 — це вибір, який робить людина у «Повній інформації».
     extra — що є на додаткових складах (лише підсумок). similar — скільки схожих позицій сховано. */
  function compactView(parts, index, data) {
    const summary = summarizeParts(parts, index, data);
    const whs = data.warehouses || [];
    const exact = function (p) { return p.variants.filter(function (v) { return v.exact; }); };
    const rows = whs.filter(isMain).map(function (w) {
      return { code: w.code, name: w.name, vals: summary.parts.map(function (p) {
        return { p: sum(exact(p), function (v) { return qty(v, w.code, 'p'); }), a: sum(exact(p), function (v) { return qty(v, w.code, 'a'); }) };
      }) };
    }).filter(function (r) { return r.vals.some(function (x) { return x.p > 0; }); });
    const extraCodes = whs.filter(function (w) { return !isMain(w); }).map(function (w) { return w.code; });
    const exVals = summary.parts.map(function (p) {
      return { p: sum(exact(p), function (v) { return sum(extraCodes, function (c) { return qty(v, c, 'p'); }); }),
               a: sum(exact(p), function (v) { return sum(extraCodes, function (c) { return qty(v, c, 'a'); }); }) };
    });
    const totals = summary.parts.map(function (p) {
      const mainCodes = whs.filter(isMain).map(function (w) { return w.code; });
      return { p: sum(exact(p), function (v) { return sum(mainCodes, function (c) { return qty(v, c, 'p'); }); }),
               a: sum(exact(p), function (v) { return sum(mainCodes, function (c) { return qty(v, c, 'a'); }); }) };
    });
    return { summary: summary, rows: rows, totals: totals,
             hasExact: summary.parts.every(function (p) { return exact(p).length > 0; }),
             extra: { vals: exVals, any: exVals.some(function (x) { return x.p > 0; }) },
             similar: sum(summary.parts, function (p) { return p.variants.filter(function (v) { return !v.exact; }).length; }) };
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
            return { name: v.n, exact: v.exact, from: v.from || [], rows: rows, P: sum(rows, function (r) { return r.p; }), A: sum(rows, function (r) { return r.a; }) };
          })
        };
      }),
      kit: kit
    };
  }

  /* ---------------- ПОЗНАЧКА В РЯДКУ ПРАЙСУ (рішення власника 2026-10-16) ----------------

     КІЛЬКІСТЬ рахуємо від ЗАГАЛЬНОГО залишку, КОЛІР — від ВІЛЬНОГО. Приклад власника: на складі 80,
     вільних 3 → показуємо «>5 шт.», але ЖОВТИМ. Зелений означає «вільного стільки ж, скільки обіцяє цифра».

     ТІЛЬКИ ТОЧНИЙ ЗБІГ. Схожі позиції (-W1, -W2, кольорові -WT/-WB) — це інший товар; обіцяти ними
     наявність не можна. Вони лишаються в адмінських панелях, де рішення приймає людина.

     КОМПЛЕКТ = min(внутр., зовн.) У МЕЖАХ ОДНОГО СКЛАДУ, і вже ці числа сумуються по складах регіону.
     Інакше можна пообіцяти комплект, якого фізично ніде не зібрати. */

  function regionWarehouses(data) {
    const whs = (data && data.warehouses) || [];
    if (!data) return [];
    if (data.mode !== 'admin') return whs.filter(isMain); // сервер уже віддав лише свій регіон
    if (data.region_id == null) return [];                // адмін без регіону — позначку рахувати нема від чого
    return whs.filter(function (w) { return isMain(w) && w.region_id === data.region_id; });
  }

  function exactOf(index, marking) {
    const k = normKey(leadOf(marking));
    const e = k ? index.byKey.get(k) : null;
    return e ? { k: k, n: e.n, wh: e.wh } : null;
  }

  const bucketOf = function (v, t) { return v <= 0 ? 0 : (v < t ? 1 : 2); };

  function badgeFor(parts, index, data) {
    if (!parts || !parts.length || !index || !data) return null;
    const whs = regionWarehouses(data);
    if (!whs.length) return null;
    const els = elsewhereSet(data, whs);
    /* У дилера index містить ЛИШЕ склади його регіону. Позиція, якої тут немає, але яка є деінде,
       у index не потрапляє зовсім — вона приходить окремим списком data.elsewhere (самі маркування).
       Для регіонів це найчастіший випадок (200–300 позицій), тому обробляємо його нарівні. */
    const ex = parts.map(function (p) {
      const k = normKey(leadOf(p.m));
      if (!k) return null;
      const e = index.byKey.get(k);
      if (e) return { k: k, wh: e.wh };
      if (els[k]) return { k: k, wh: {} };                  // у регіоні немає, але десь є
      return null;                                          // у 1С немає взагалі
    });
    // Жодної частини в 1С немає → позначки немає (нічого не вигадуємо).
    // Комплект знайдено наполовину → теж немає: «є внутрішній, нема зовнішнього» — це не наявність.
    if (ex.some(function (e) { return !e; })) return null;
    const perWh = whs.map(function (w) {
      return { p: Math.min.apply(null, ex.map(function (e) { return e.wh[w.code] ? e.wh[w.code].p : 0; })),
               a: Math.min.apply(null, ex.map(function (e) { return e.wh[w.code] ? e.wh[w.code].a : 0; })) };
    });
    const P = sum(perWh, function (x) { return x.p; });
    const A = sum(perWh, function (x) { return x.a; });
    const t = Number(data.badge_threshold) > 0 ? Number(data.badge_threshold) : 5;
    /* «Є на інших складах» для КОМПЛЕКТУ: кожна частина або ФІЗИЧНО є тут, або доступна деінде.
       Саме фізично, а не вільно (виправлено 2026-10-16 після перепису по каталогу): інакше комплект,
       у якого внутрішній блок лежить у дилера в резерві, а зовнішній треба привезти, ставав червоним
       «немає на жодному складі». Такий блок у список «деінде» не потрапляє саме тому, що він ТУТ. */
    const elsewhere = ex.every(function (e) {
      const hereP = sum(whs, function (w) { return e.wh[w.code] ? e.wh[w.code].p : 0; });
      return hereP > 0 || !!els[e.k];
    });
    const bP = bucketOf(P, t), bA = bucketOf(A, t);
    let tone, note;
    if (bP === 0) { tone = elsewhere ? 'warn' : 'out'; note = elsewhere ? 'elsewhere' : 'nowhere'; }
    else if (bA === bP) { tone = 'ok'; note = null; }
    else { tone = 'warn'; note = 'reserved'; }
    /* Підпис навмисно без «шт.» (рішення власника 2026-10-16): у рядку прайсу поруч із ціною
       кожен зайвий символ розтягує праву колонку. «<5» читається так само однозначно. */
    return { label: bP === 0 ? '0' : (bP === 1 ? '<' + t : '>' + t),
             tone: tone, note: note, P: P, A: A, threshold: t,
             region: (whs[0] && whs[0].region) || '' };
  }

  /* Підпис під позначкою. З'являється на дотик і ТІЛЬКИ коли позначка не зелена (вимога власника). */
  function badgeNote(b) {
    if (!b || !b.note) return '';
    const where = b.region ? 'У вашому регіоні (' + b.region + ')' : 'У вашому регіоні';
    if (b.note === 'elsewhere') return where + ' цього товару немає, але він є на інших складах. Доставка перевізником зазвичай 2–3 дні — зв\'яжіться зі своїм менеджером.';
    if (b.note === 'nowhere') return 'Немає на жодному складі. Щодо строків постачання зв\'яжіться зі своїм менеджером.';
    return 'Товар на складі є, але частину зарезервовано під інші замовлення. Вільних менше, ніж показує позначка — уточніть у свого менеджера.';
  }

  const api = { normKey: normKey, baseOf: baseOf, leadOf: leadOf, buildIndex: buildIndex, matchVariants: matchVariants, summarizeParts: summarizeParts,
                kitFor: kitFor, partsFor: partsFor, freshness: freshness, fmtAge: fmtAge, fmtQty: fmtQty,
                compactView: compactView, applyFilter: applyFilter, fullView: fullView,
                regionWarehouses: regionWarehouses, exactOf: exactOf, badgeFor: badgeFor, badgeNote: badgeNote,
                elsewhereSet: elsewhereSet };

  if (typeof document === 'undefined') { // Node (тести): лише чиста логіка
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  /* ---------------- БРАУЗЕР: стан, кнопка, панель, вікно, історія, діагностика ---------------- */

  const TTL_MS = 5 * 60 * 1000; // на пристрої тримаємо зріз не довше 5 хв (кеш лише в пам'яті — на спільних пристроях нічого не лишається)
  let data = null, index = null, fetchedAt = 0, loading = null;
  /* Фільтри вікна «Повна інформація». Стан за замовчуванням (рішення власника 2026-10-16):
     усі склади · усі регіони · ЛИШЕ ДЕ Є В НАЯВНОСТІ. Скидається при КОЖНОМУ відкритті вікна —
     адмін завжди починає з однакової картини, а не з фільтрів, виставлених для попереднього товару.
     Змінені фільтри живуть, поки вікно відкрите. */
  const FILT_DEFAULT = { kind: 'all', region: 'all', only: true };
  let filt = Object.assign({}, FILT_DEFAULT);

  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* Lucide «package» — у вшитому спрайті index.html такого гліфа нема, тож малюємо тут (штрих currentColor, як решта іконок). */
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
    '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

  const ICON_CLOCK = '<svg class="sb-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  const CSS = '' +
    '.stock-slot{display:none}.stock-slot.has{display:flex;align-items:center;gap:6px;line-height:0}' +
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
    /* Підписи «точний збіг» / «схожа позиція» — маленькі чіпи. Було дрібним сірим курсивом і
       губилось; тепер видно з відстані, але вага та сама, що в решти службових підписів. */
    '.stock-var-n em{font-style:normal;font-weight:700;font-size:10px;line-height:1;letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:var(--border);color:var(--text-secondary);white-space:nowrap;align-self:flex-start;flex:0 0 auto}' +
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
    '.stock-chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}' +
    /* --- позначка наявності в рядку прайсу (бачать усі, хто бачить ціни) ---
       Рішення власника 2026-10-16: НЕ кнопка й не пігулка, а просто напис — кольором відрізняється
       сам текст. Рамка з підложкою з'їдали ширину поруч із ціною й виглядали як ще одна кнопка. */
    '.stock-badge{display:inline-flex;align-items:center;gap:3px;min-height:26px;padding:0 1px;border:0;border-radius:0;background:transparent;font:800 13.5px/1 inherit;font-family:inherit;white-space:nowrap;-webkit-appearance:none;color:inherit}' +
    '.stock-badge.sb-ok{color:#2F6B3C}' +
    '.stock-badge.sb-warn{color:#8A6104}' +
    '.stock-badge.sb-out{color:var(--danger)}' +
    '.stock-badge.sb-stale{color:var(--text-secondary)}' +
    'button.stock-badge{cursor:pointer}button.stock-badge:active{opacity:.55}' +
    '.stock-badge .sb-i{display:inline-flex;width:13px;height:13px;border-radius:50%;border:1.2px solid currentColor;align-items:center;justify-content:center;font-size:9px;font-weight:800;line-height:1;flex:0 0 13px;opacity:.9}' +
    '.stock-badge .sb-clock{width:12px;height:12px;flex:0 0 12px;opacity:.85}' +
    '.stock-note-big{margin:0;font-size:13px;line-height:1.5;color:var(--text)}' +
    '.stock-note-big b{font-weight:700}' +
    /* --- акцент на точному збігу у «Повній інформації» --- */
    '.stock-var.sv-exact{border-color:var(--accent);background:var(--accent-bg)}' +
    '.stock-var.sv-exact .stock-var-n em{background:var(--accent);color:#fff}' +
    '.stock-var.sv-sim{opacity:.7}' +
    '.stock-badge-line{display:flex;align-items:center;gap:7px;margin:0 0 8px}' +
    '.stock-badge-line small{color:var(--text-secondary);font-size:11.5px;font-weight:500}' +
    '.stock-exact-h{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin:0 0 4px}';

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
  /* КОРОТКА панель (адміни). З 2026-10-16 показує ТІЛЬКИ ТОЧНИЙ ЗБІГ: одна цифра — одна відповідь.
     Схожі позиції не зникли, але живуть у «Повній інформації», де видно, яка саме це позиція. */
  function panelHtml(parts) {
    const v = compactView(parts, index, data);
    const s = v.summary;
    const pair = s.parts.length > 1;
    const fr = freshness(data, fetchedAt, Date.now());
    const bdg = badgeFor(parts, index, data);
    const minA = v.totals.length ? Math.min.apply(null, v.totals.map(function (x) { return x.a; })) : 0;
    const low = Number(data.low_threshold);
    const status = minA <= 0 ? 'out' : (minA <= (isFinite(low) ? low : 2) ? 'low' : 'ok');
    let h = '';
    if (bdg) h += '<p class="stock-badge-line"><span class="stock-badge sb-' + bdg.tone + '">' + esc(bdg.label) + '</span>' +
      '<small>' + esc(bdg.region ? 'ваш регіон: ' + bdg.region : 'ваш регіон') + '</small></p>';
    h += '<p class="stock-exact-h">Точний збіг</p>';
    h += v.hasExact
      ? '<div class="stock-' + status + '"><p class="stock-sum">Вільно: ' + joinQ(v.totals, 'a') + (pair ? ' <small>(внутр. + зовн.)</small>' : '') +
        ' <small>· всього ' + joinQ(v.totals, 'p') + '</small></p></div>'
      : '<div class="stock-none">Точного збігу в 1С немає — дивіться схожі позиції в повній інформації.</div>';
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
    if (v.similar) h += '<p class="stock-note">Схожих позицій (-W1, -W2 …): ' + v.similar + ' — у повній інформації.</p>';
    h += '<button type="button" class="stock-more">Повна інформація</button>';
    return h;
  }

  function fillPanel(panel, parts) { panel.querySelector('.stock-panel-in').innerHTML = panelHtml(parts); }

  function closePanelEl(panel) {
    panel.classList.remove('open');
    const row = panel.closest('.row');
    if (row) row.querySelectorAll('.stock-btn, button.stock-badge').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
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
      const badge = (data && index && fr.state !== 'none' && parts) ? badgeFor(parts, index, data) : null;
      const isAdmin = !!(data && data.mode === 'admin');
      const hasBtn = !!(isAdmin && sm && sm.any);
      if (!hasBtn && !badge) { if (panel) panel.remove(); return; } // нема ні позначки, ні кнопки — слот порожній
      const open = !!(panel && panel.classList.contains('open'));
      const stale = fr.state === 'stale';
      let html = '';
      if (badge) {
        /* Застарілі дані показуємо сірим і з годинником (рішення власника 2026-10-16): ховати позначку
           не можна — дилер вирішив би, що наявності немає взагалі. */
        const cls = 'stock-badge sb-' + (stale ? 'stale' : badge.tone);
        const clock = stale ? ICON_CLOCK : '';
        const lbl = esc(badge.label) + clock;
        html += badge.note
          ? '<button type="button" class="' + cls + '" data-sb-note="' + esc(badge.note) + '" data-sb-region="' + esc(badge.region) +
            '" aria-expanded="false" aria-label="Наявність: ' + esc(badge.label) + '. Натисніть, щоб побачити пояснення">' + lbl + '<span class="sb-i" aria-hidden="true">i</span></button>'
          : '<span class="' + cls + '" aria-label="Наявність: ' + esc(badge.label) + '">' + lbl + '</span>';
      }
      if (hasBtn) {
        html += '<button type="button" class="stock-btn stock-' + sm.status + (stale ? ' stock-stale' : '') + '" aria-expanded="' + open + '" aria-label="Наявність по складах" title="Вільно (основні склади): ' +
          esc(joinQ(sm.parts, 'A')) + (stale ? ' — дані можуть бути неактуальними' : '') + '">' + ICON + '<i class="stock-dot"></i></button>';
      } else if (panel) panel.remove();
      slot.innerHTML = html;
      slot.classList.add('has');
      if (panel) fillPanel(panel, parts); // дані оновились, поки панель відкрита — перемальовуємо її вміст
    });
    syncLayers();
    if (document.getElementById('stock-sheet') && document.getElementById('stock-sheet').classList.contains('show')) renderSheet();
    if (Date.now() - fetchedAt > TTL_MS && data) refresh(); // тихо оновлюємо, якщо дані застарілі на пристрої
  }

  /* Розкриття/згортання панелі під рядком (плавно: grid-template-rows 0fr↔1fr). Одночасно відкрита лише одна.
     Один механізм на два випадки: адмінська панель складів і підказка під позначкою дилера — щоб «Назад»,
     акордеон і робота з історією були однакові (інакше легко отримати зайвий запис в історії, див. CLAUDE.md). */
  function panelToggle(trigger, row, fill) {
    if (!row) return;
    let panel = row.querySelector(':scope > .stock-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'stock-panel';
      panel.innerHTML = '<div class="stock-panel-clip"><div class="stock-panel-in"></div></div>';
      const top = row.querySelector(':scope > .row-top');
      (top || row.firstElementChild).insertAdjacentElement('afterend', panel);
      fill(panel);
      void panel.offsetHeight; // зафіксувати стартовий стан, щоб перехід відпрацював
    }
    if (panel.classList.contains('open')) { // згорнути
      const top = layers[layers.length - 1];
      if (top && top.type === 'panel' && top.row === row) popLayerUi(); else closePanelEl(panel);
      return;
    }
    document.querySelectorAll('.stock-panel.open').forEach(function (p) { if (p !== panel) closePanelEl(p); }); // акордеон
    fill(panel);
    panel.classList.add('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const layer = { type: 'panel', row: row, close: function () { closePanelEl(panel); }, alive: function () { return document.body.contains(panel); } };
    const idx = layers.map(function (l) { return l.type; }).lastIndexOf('panel');
    if (idx >= 0) layers[idx] = layer; // замінили відкриту панель іншою — запис історії той самий
    else pushLayer(layer);
  }

  function toggle(btn) {
    const slot = btn.closest('.stock-slot'), row = btn.closest('.row');
    if (!slot || !row || !data || !index) return;
    const parts = partsOf(slot); if (!parts) return;
    panelToggle(btn, row, function (panel) { fillPanel(panel, parts); });
  }

  /* Дотик по НЕзеленій позначці → під рядком розкривається людський підпис, що робити далі. */
  function toggleNote(badge) {
    const row = badge.closest('.row');
    const b = { note: badge.getAttribute('data-sb-note'), region: badge.getAttribute('data-sb-region') };
    panelToggle(badge, row, function (panel) {
      panel.querySelector('.stock-panel-in').innerHTML = '<p class="stock-note-big">' + esc(badgeNote(b)) + '</p>';
    });
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
      /* Точний збіг — окремим акцентованим блоком і завжди першим; схожі позиції — нижче й тьмяніше
         (рішення власника 2026-10-16). Раніше вони йшли суцільним списком і різниця читалась лише
         дрібним підписом праворуч. */
      const exact = p.variants.filter(function (v) { return v.exact; });
      const similar = p.variants.filter(function (v) { return !v.exact; });
      const block = function (v, cls) {
        let b = '<div class="stock-var ' + cls + '"><div class="stock-var-n"><span>' + esc(v.name) + '</span><em>' + (v.exact ? 'точний збіг' : 'схожа позиція') + '</em></div>';
        if (v.from && v.from.length) b += '<p class="stock-note" style="margin:2px 0 4px">Разом із комплектами 1С: ' + esc(v.from.join(', ')) + '</p>';
        b += v.rows.length ? variantRowsHtml(v.rows) : '<div class="stock-none">На вибраних складах немає.</div>';
        if (v.rows.length > 1) b += '<div class="stock-line total"><span>Разом</span><span>всього ' + fmtQty(v.P) + ' · вільно ' + fmtQty(v.A) + '</span></div>';
        return b + '</div>';
      };
      exact.forEach(function (v) { h += block(v, 'sv-exact'); });
      if (similar.length) {
        h += '<p class="stock-grp">Схожі позиції — ' + similar.length + '</p>';
        similar.forEach(function (v) { h += block(v, 'sv-sim'); });
      }
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
    filt = Object.assign({}, FILT_DEFAULT); // кожне відкриття — з чистого аркуша
    sheetParts = parts;
    const el = ensureSheet();
    renderSheet();
    el.querySelector('#stock-sheet-body').scrollTop = 0;
    /* Листи цього меню розкриваються вище, коли в них прокручують (клас 'sheet-tall',
       обробник у js/13-start.js). Це вікно створюється динамічно, тому спостерігач
       index.html його не бачить — скидаємо розмір тут, при кожному відкритті. */
    el.classList.remove('sheet-tall');
    if (!el.classList.contains('show')) {
      el.classList.add('show');
      pushLayer({ type: 'sheet', close: function () { el.classList.remove('show'); }, alive: function () { return el.classList.contains('show'); } });
    }
  }

  /* ---- кліки ---- */
  document.addEventListener('click', function (e) {
    const t = e.target; if (!t || !t.closest) return;
    const bdg = t.closest('button.stock-badge');
    if (bdg && bdg.getAttribute('data-sb-note')) { e.preventDefault(); e.stopPropagation(); toggleNote(bdg); return; }
    const b = t.closest('.stock-btn');
    if (b) { e.preventDefault(); e.stopPropagation(); toggle(b); return; }
    const more = t.closest('.stock-more');
    if (more) {
      e.preventDefault(); e.stopPropagation();
      const row = more.closest('.row'), slot = row && row.querySelector('.stock-slot');
      /* Другий шлях — панель товару: у ній рядка прайсу (.row) немає, і до 2026-10-09
         кнопка «Повна інформація» там мовчки нічого не робила (знайдено власником).
         Дані лежать на обгортці .ps-stock-wrap у тому самому data-stock-parts. */
      const host = slot || more.closest('[data-stock-parts]');
      const parts = host && partsOf(host);
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

    /* ---- Позначки наявності в рядках прайсу (з 2026-10-16) ----
       Ловить три речі, які інакше видно лише очима дилера з іншого регіону:
       сервер віддав не ті склади; жодна позиція не отримала позначки; позначка обіцяє
       більше, ніж є вільного (цифра від загального, колір від вільного — легко переплутати). */
    if (fr.state !== 'none') {
      const whs = regionWarehouses(data);
      const mode = data.mode === 'admin' ? 'адмін (усі склади, позначка по своєму регіону)' : 'дилер (лише свій регіон)';
      if (!whs.length) {
        out.issues.push(diagIssue(area, 'badges', 'warning', 'Позначки наявності не показуються: не визначено склади вашого регіону',
          ['Перевірте, що в профілі вказано регіон, а в таблиці stock_warehouses у складів цього регіону стоїть region_id і kind = main.'], tgt));
      } else if (data.mode !== 'admin' && (data.warehouses || []).some(function (w) { return w.kind === 'additional' || w.region_id !== data.region_id; })) {
        out.issues.push(diagIssue(area, 'badges', 'error', 'Сервер віддав дилеру склади поза його регіоном',
          ['get_stock() має віддавати звичайному користувачеві лише основні склади його регіону. Звірте SQL: claude/sql/2026-10-16-get-stock-for-users.sql.'], tgt));
      } else {
        const data0 = (ctx && ctx.data) || (typeof sheetsData !== 'undefined' ? sheetsData : {});
        const cnt = { ok: 0, warn: 0, out: 0, none: 0 };
        const wrong = [];
        TILE_LISTS.forEach(function (tl) {
          const list = data0[tl[0]] || [];
          list.forEach(function (it) {
            const b = badgeFor(partsFor(it, tl[0], list), index, data);
            if (!b) { cnt.none++; return; }
            cnt[b.tone]++;
            // Зелена позначка обіцяє, що вільного стільки ж, скільки показує цифра.
            const t = b.threshold;
            const okGreen = b.tone !== 'ok' || (b.A > 0 && ((b.P >= t && b.A >= t) || (b.P < t && b.A < t && b.A > 0)));
            if (!okGreen && wrong.length < 10) wrong.push(tl[1] + ': ' + leadOf(it.model) + ' — ' + b.label + ', всього ' + b.P + ', вільно ' + b.A);
          });
        });
        if (wrong.length) out.issues.push(diagIssue(area, 'badges', 'error', 'Зелена позначка не підтверджується вільним залишком: ' + wrong.length,
          ['Кількість рахується від загального залишку, колір — від вільного. Зелений дозволено лише коли вільного не менше, ніж обіцяє цифра.'].concat(wrong), tgt));
        if (cnt.ok + cnt.warn + cnt.out === 0) out.issues.push(diagIssue(area, 'badges', 'warning', 'Жодна позиція прайсу не отримала позначки наявності',
          ['Схоже, маркування прайсу не збігаються з назвами 1С, або зріз порожній.'], tgt));
        out.checked.push({ area: area, sub: 'badges', label: 'Позначки наявності в рядках прайсу · режим: ' + mode,
          detail: 'склади регіону: ' + whs.length + ' · зелених ' + cnt.ok + ', жовтих ' + cnt.warn + ', червоних ' + cnt.out + ', без позначки ' + cnt.none });
      }
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
  root.Stock = Object.assign({ slotHtml: slotHtml, paint: paint, refresh: refresh, reset: reset, toggle: toggle, openSheet: openSheet, onBack: onBack, diagCheck: diagCheck, panelHtml: panelHtml,
    hasData: function () { return !!(data && index); }, isAdminMode: function () { return !!(data && data.mode === 'admin'); } }, api);
})(typeof window !== 'undefined' ? window : globalThis);
