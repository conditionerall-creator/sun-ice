/* Sun-ice — Самодіагностика застосунку (DIAG_CHECKS, APP_BUILD)
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ==================== САМОДІАГНОСТИКА ЗАСТОСУНКУ (універсальна) ====================
   ОБОВ'ЯЗКОВА ВИМОГА ВЛАСНИКА (2026-10-02): будь-яка проблема застосунку має сама дійти до
   супер-адміна через картку «Самодіагностика» в Кабінеті (кнопка «Перевірити зараз») — із
   вказівкою, ДЕ проблема і КУДИ веде. Ціни й маркування мають ТОЧНО збігатися з Excel (жодних
   «незначних відхилень»); у перевірки входять також ролі, зображення/файли, посилання на сайт.
   Нова функція застосунку = нова перевірка тут (див. CLAUDE.md, розділ «Самодіагностика»).

   Як це влаштовано:
   • Перевірка — функція diagCheck*(ctx) → { issues: [...], checked: [...] }. issues — знайдені
     проблеми; checked — усе, що перевірено (і справне теж): за ним автоматично «гаситься» те,
     що виправлено, і будується звіт «що перевірено» в картці.
   • Реєстр DIAG_CHECKS. auto:true — ще й тихо після кожного розбору нового прайсу на будь-якому
     пристрої; решта — лише за кнопкою «Перевірити зараз» (мережа, зображення, ролі).
   • Зберігання — наявна таблиця price_issues через RPC report_price_issue / resolve_price_issue_if_ok
     без змін схеми. Унікальність там (version, tile_label, brand, kind) → ОДНА агрегована проблема
     на (область, підрозділ, тип) із переліком позицій у message. tile_label = область (DIAG_AREA),
     brand = підрозділ (ключ списку тощо).
   • message: перший рядок — заголовок, далі деталі, останній рядок «@@{json}» — «куди веде»
     (target: { app:{tile,brand,model}, site:url, excel:"аркуш, рядок", tab }). Старі записи без
     цього рядка показуються як є.
   • Типи: error — розбіжність/поломка; warning — підозріло; info — примітка/відоме правило
     (не рахується проблемою). */
const DIAG_MAX_LINES = 14;
const DIAG_AREA = {
  excel: 'Звірка з Excel',
  links: 'Посилання на сайт',
  files: 'Файли та зображення',
  roles: 'Ролі та доступи',
  rates: 'Курси валют',
  build: 'Версія застосунку',
  site: 'Сайт sun-ice.com.ua',
  modules: 'Модулі застосунку',
  specs: 'Характеристики товарів',
  search: 'Пошук по каталогу',
  groups: 'Групи прайсу',
  header: 'Шапка застосунку',
  push: 'Сповіщення (push)',
  pricePublish: 'Публікація прайсу',
  resilience: 'Поведінка при збоях'
};

/* Код застосунку живе в js/*.js з 2026-10-08. По одній «якірній» функції з кожного
   файлу: якщо модуль не завантажився, його якір буде undefined — і ми дізнаємось про
   це одразу, а не тоді, коли дилер натисне кнопку в непрацюючому розділі.
   12-start.js оголошень не має (він лише виконує), тому перевіряється за слідом
   роботи блоку старту — history.state.tab, який ставить саме він. */
const MODULE_ANCHORS = {
  '01-config.js': 'phoneToEmail',
  '02-price-parse.js': 'parseSheet',
  '03-diagnostics.js': 'runDiagnostics',
  '04-catalog.js': 'renderCatalogList',
  '04a-catalog-groups.js': 'cgBuildNodes',
  '05-catalog-custom.js': 'renderVrfList',
  '06-cart-promo.js': 'renderCartPanel',
  '07-access-info.js': 'ensureAccessFresh',
  '08-info-tables.js': 'searchMhiByCode',
  '09-cabinet.js': 'renderCabinetTab',
  '10-crmontage.js': 'renderInstallerTab',
  '11-shell.js': 'showInstallGate',
  '12-product-sheet.js': 'openProductSheet'
};
let lastDiagRun = null; // { at, checked, issues } — останній ручний прогін, для звіту в картці

function diagIssue(area, sub, kind, title, lines, target) {
  const all = lines || [];
  const body = [title].concat(all.slice(0, DIAG_MAX_LINES));
  if (all.length > DIAG_MAX_LINES) body.push('…та ще ' + (all.length - DIAG_MAX_LINES));
  let msg = body.join('\n');
  if (target) msg += '\n@@' + JSON.stringify(target);
  return { tile: area, brand: sub, kind: kind, message: msg };
}
function diagParseMessage(message) {
  const lines = String(message || '').split('\n');
  let target = null;
  if (lines.length && lines[lines.length - 1].indexOf('@@') === 0) {
    try { target = JSON.parse(lines.pop().slice(2)); } catch (e) { target = null; }
  }
  return { title: lines[0] || '', lines: lines.slice(1), target: target };
}
function diagFmt(n) { return Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 4 }); }

/* ---- 1. Ціни й маркування = Excel ---- */
/* Незалежна від parseSheet() друга проходка по сирих рядках аркуша: усі рядки, де в колонці ціни
   число, мають бути в застосунку з тим самим маркуванням і тією самою ціною. Геометрію (де заголовок
   ціни/моделі) шукаємо тими ж ключовими словами, але сам обхід, пропуски й множення — свої: так
   ловляться пропущені рядки, зсунуті колонки, зіпсовані ціни та застарілий кеш. */
function diagListGeometry(rows) {
  const ph = findPriceHeader(rows);
  if (!ph) return null;
  let priceCol = ph.col, dataStart = ph.row + 1;
  const nr = rows[ph.row + 1];
  if (nr) {
    for (let c = priceCol; c < nr.length; c++) {
      if (cellContainsAny(nr[c], totalSubKeywords)) { priceCol = c; dataStart = ph.row + 2; break; }
    }
  }
  const headerRow = rows[ph.row] || [], above = rows[ph.row - 1] || [];
  let modelCol = findColumnInRow(headerRow, modelKeywords);
  if (modelCol === -1) modelCol = findColumnInRow(above, modelKeywords);
  return {
    priceCol: priceCol, dataStart: dataStart, modelCol: modelCol,
    internalCol: findColumnInRow(headerRow, internalKeywords),
    externalCol: findColumnInRow(headerRow, externalKeywords),
    currency: detectCurrency(ph.text), headerText: String(ph.text || '').replace(/\s+/g, ' ').trim()
  };
}
function diagExpectedRows(rows, g, rowOffset) {
  const expected = [], noModel = [];
  for (let r = g.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const price = parseNumber(row[g.priceCol]);
    if (price === null) continue;
    let model = g.modelCol !== -1 ? String(row[g.modelCol] == null ? '' : row[g.modelCol]).trim() : '';
    if (!model && g.internalCol !== -1) {
      const parts = [row[g.internalCol], g.externalCol !== -1 ? row[g.externalCol] : ''].filter(v => v && String(v).trim());
      model = parts.map(v => String(v).trim()).join(' + ');
    }
    if (!model) noModel.push({ row: r + 1 + rowOffset, price: price });
    else expected.push({ row: r + 1 + rowOffset, model: model, price: price });
  }
  return { expected: expected, noModel: noModel };
}
function diagCompareItems(expected, items, factor, extraKey) {
  const r6 = n => Math.round(n * 1e6) / 1e6;
  const ek = it => (extraKey ? '\u0001' + (extraKey(it) || '') : '');
  const pool = new Map();
  expected.forEach(e => {
    const k = e.model + '\u0001' + r6(e.price * factor) + ek(e);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(e);
  });
  const appOnly = [];
  items.forEach(it => {
    const k = it.model + '\u0001' + r6(it.price) + ek(it);
    const arr = pool.get(k);
    if (arr && arr.length) arr.shift(); else appOnly.push(it);
  });
  const excelOnly = [];
  pool.forEach(arr => arr.forEach(e => excelOnly.push(e)));
  excelOnly.sort((a, b) => a.row - b.row);
  const priceDiff = [], missing = [];
  excelOnly.forEach(e => {
    const j = appOnly.findIndex(it => it.model === e.model);
    if (j >= 0) { priceDiff.push({ e: e, it: appOnly[j] }); appOnly.splice(j, 1); } else missing.push(e);
  });
  return { priceDiff: priceDiff, missing: missing, extra: appOnly };
}
/* Перевірка САМОГО ВІДОБРАЖЕННЯ: число, яке бачить користувач (formatListPriceNumber), не має
   відрізнятись від ціни з Excel більше ніж на 1 (правило власника про округлення, див. formatListPrice). */
function diagVerifyDisplay(items) {
  const bad = [];
  items.forEach(it => {
    if (it.priceText) return;
    const shown = Number(formatListPriceNumber(it).replace(/[\s  ]/g, '').replace(',', '.'));
    if (!(Math.abs(shown - it.price) <= 1)) bad.push(it.model + ': у списку «' + formatListPriceNumber(it) + '», у Excel ' + diagFmt(it.price) + ' — різниця понад 1');
  });
  return bad;
}
function diagSheetOffset(sheet) {
  return sheet && sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;
}
function diagReconcileList(out, label, listKey, sheetName, rows, rowOffset, g, items, factor, targetBase, ruleNote) {
  const area = DIAG_AREA.excel;
  const { expected, noModel } = diagExpectedRows(rows, g, rowOffset);
  const cmp = diagCompareItems(expected, items, factor);
  const bad = cmp.priceDiff.length + cmp.missing.length + cmp.extra.length;
  const where = row => 'аркуш «' + sheetName + '», рядок ' + row;
  const lines = [];
  cmp.priceDiff.forEach(d => lines.push('ЦІНА · ' + where(d.e.row) + ' · ' + d.e.model + ': у Excel ' + diagFmt(d.e.price) +
    (factor !== 1 ? ' (очікується ' + diagFmt(d.e.price * factor) + ')' : '') + ', у застосунку ' + diagFmt(d.it.price)));
  cmp.missing.forEach(e => lines.push('НЕМАЄ В ЗАСТОСУНКУ · ' + where(e.row) + ' · ' + e.model + ' · ' + diagFmt(e.price)));
  cmp.extra.forEach(it => lines.push('ЗАЙВЕ В ЗАСТОСУНКУ (у Excel такого рядка нема) · ' + it.model + ' · ' + diagFmt(it.price)));
  const first = cmp.priceDiff[0] ? cmp.priceDiff[0].e : (cmp.missing[0] || null);
  if (bad) {
    out.issues.push(diagIssue(area, listKey, 'error',
      label + ': розбіжностей з Excel — ' + bad + ' (ціни ' + cmp.priceDiff.length + ', немає в застосунку ' + cmp.missing.length + ', зайвих ' + cmp.extra.length + ')',
      lines, Object.assign({}, targetBase, first ? { excel: where(first.row), app: Object.assign({}, targetBase.app, { model: first.model }) } : {})));
  }
  const warn = [];
  if (noModel.length) {
    noModel.forEach(n => warn.push(where(n.row) + ': є ціна ' + diagFmt(n.price) + ', але немає маркування — рядок пропущено'));
  }
  if (!g.currency) warn.push('Не вдалося визначити валюту з заголовка колонки ціни «' + g.headerText + '»');
  else if (items.some(it => it.currency !== g.currency)) warn.push('Валюта позицій не збігається із заголовком колонки («' + g.headerText + '», ' + g.currency + ')');
  if (warn.length) out.issues.push(diagIssue(area, listKey, 'warning', label + ': підозрілі рядки в прайсі', warn, targetBase));
  const shown = diagVerifyDisplay(items);
  if (shown.length) out.issues.push(diagIssue(area, listKey, 'error', label + ': показана ціна не збігається з Excel — ' + shown.length, shown, targetBase));
  const notes = [];
  if (factor !== 1) notes.push(ruleNote || ('До цін Excel застосовується коефіцієнт ' + diagFmt(factor)));
  const rounded = items.filter(it => Math.abs(it.price - Math.round(it.price)) > 1e-9);
  if (rounded.length) {
    notes.push('Правило власника: ціни показуються цілими (округлення, якщо різниця ≤ 1). У ' + rounded.length + ' позицій це змінює число (напр. ' +
      rounded[0].model + ': ' + diagFmt(rounded[0].price) + ' → ' + Math.round(rounded[0].price) + ')');
  }
  if (notes.length) out.issues.push(diagIssue(area, listKey, 'info', label + ': правила відображення цін', notes, targetBase));
  out.checked.push({ area: area, sub: listKey, label: label,
    detail: expected.length + ' позицій у Excel · колонка ' + XLSX.utils.encode_col(g.priceCol) + ' «' + g.headerText + '»' });
}
function diagCheckExcel(ctx) {
  const out = { issues: [], checked: [] };
  const wb = ctx.wb;
  if (!wb) return out;
  const area = DIAG_AREA.excel;
  CATALOG_TILES.forEach(tile => {
    ['mhi', 'gal'].forEach(brand => {
      const cfg = tile[brand];
      if (!cfg) return;
      const label = tile.label + ' / ' + brand.toUpperCase();
      const sheet = wb.Sheets[cfg.sheet];
      if (!sheet) return; // відсутню вкладку вже репортить сам розбір (buildSheetsData)
      const all = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let rows = all;
      if (cfg.splitMarker) rows = sliceBySplitMarker(all, cfg.splitMarker, cfg.splitSide);
      const sliceOffset = (cfg.splitMarker && cfg.splitSide === 'after') ? all.length - rows.length : 0;
      const g = diagListGeometry(rows);
      const items = ctx.data[cfg.key] || [];
      const targetBase = { app: { tile: tile.id, brand: brand }, excel: 'аркуш «' + cfg.sheet + '»' };
      if (!g) {
        out.issues.push(diagIssue(area, cfg.key, 'error', label + ': у прайсі не знайдено колонку з ціною — звірити неможливо', [], targetBase));
        out.checked.push({ area: area, sub: cfg.key, label: label, detail: 'колонку ціни не знайдено' });
        return;
      }
      const factor = cfg.baseAdjustPct ? 1 - cfg.baseAdjustPct / 100 : 1;
      diagReconcileList(out, label, cfg.key, cfg.sheet, rows, diagSheetOffset(sheet) + sliceOffset, g, items, factor, targetBase,
        'Ціна в застосунку = Excel мінус ' + cfg.baseAdjustPct + ' % (правило власника, baseAdjustPct у CATALOG_TILES; у Excel — «' + g.headerText + '»)');
    });
  });
  // Плоскі списки "Артикул / Назва / Коментар / Роздрібна ціна": Systemair і FRICO
  [{ key: 'systemair', sheet: 'SYSTEMAIR', label: 'Вентиляційне обладнання / Systemair', app: { tile: 'ventilation', brand: 'systemair' } },
   { key: 'frico', sheet: 'FRICO', label: 'Повітряні завіси / FRICO', app: { tile: 'aircurtains', brand: 'mhi' } }].forEach(f => {
    const sheet = wb.Sheets[f.sheet];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const off = diagSheetOffset(sheet);
    const targetBase = { app: f.app, excel: 'аркуш «' + f.sheet + '»' };
    const head = rows[7] || [];
    const headOk = norm(head[0]).includes('артикул') && norm(head[1]).includes('назв') && norm(head[3]).includes('ціна');
    if (!headOk) {
      out.issues.push(diagIssue(area, f.key, 'error', f.label + ': структура аркуша змінилась — заголовок у рядку 8 має бути «Артикул / Назва / … / Роздрібна ціна»',
        ['Зараз у рядку 8: ' + head.slice(0, 5).map(v => '«' + String(v).trim() + '»').join(' ')], targetBase));
    }
    const expected = [];
    for (let r = 8; r < rows.length; r++) {
      const row = rows[r] || [];
      const model = String(row[1] == null ? '' : row[1]).trim();
      const price = parseNumber(row[3]);
      if (!model || price === null) continue;
      expected.push({ row: r + 1 + off, model: model, price: price, article: String(row[0] == null ? '' : row[0]).trim() });
    }
    const items = ctx.data[f.key] || [];
    const cmp = diagCompareItems(expected, items, 1, x => x.article);
    const bad = cmp.priceDiff.length + cmp.missing.length + cmp.extra.length;
    if (bad) {
      const lines = [];
      const where = row => 'аркуш «' + f.sheet + '», рядок ' + row;
      cmp.priceDiff.forEach(d => lines.push('ЦІНА/АРТИКУЛ · ' + where(d.e.row) + ' · ' + d.e.model + ': Excel ' + diagFmt(d.e.price) + ' (арт. ' + d.e.article + '), застосунок ' + diagFmt(d.it.price) + ' (арт. ' + (d.it.article || '') + ')'));
      cmp.missing.forEach(e => lines.push('НЕМАЄ В ЗАСТОСУНКУ · ' + where(e.row) + ' · ' + e.model + ' · ' + diagFmt(e.price)));
      cmp.extra.forEach(it => lines.push('ЗАЙВЕ В ЗАСТОСУНКУ · ' + it.model + ' · ' + diagFmt(it.price)));
      const first = cmp.priceDiff[0] ? cmp.priceDiff[0].e : cmp.missing[0];
      out.issues.push(diagIssue(area, f.key, 'error', f.label + ': розбіжностей з Excel — ' + bad, lines,
        Object.assign({}, targetBase, first ? { excel: where(first.row), app: Object.assign({}, f.app, { model: first.model }) } : {})));
    }
    const shownBad = diagVerifyDisplay(items);
    if (shownBad.length) out.issues.push(diagIssue(area, f.key, 'error', f.label + ': показана ціна не збігається з Excel — ' + shownBad.length, shownBad, targetBase));
    out.checked.push({ area: area, sub: f.key, label: f.label, detail: expected.length + ' позицій у Excel · колонка D «Роздрібна ціна, EUR»' });
  });
  return out;
}

/* ---- 2. Таблиця посилань на сайт (data/site-links.json) ---- */
async function diagCheckSiteLinks(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.links;
  const d = await loadSiteLinks();
  if (!d || !d.links) {
    out.issues.push(diagIssue(area, 'table', 'error', 'Файл посилань на сайт (data/site-links.json) не завантажився — у панелі товару немає кнопки «На сайт»',
      ['Перевірте, що файл залитий у папку data/ репозиторію і відкривається за адресою застосунку.'], { tab: 'catalog' }));
    out.checked.push({ area: area, sub: 'table', label: 'Файл посилань на сайт', detail: 'не завантажився' });
    return out;
  }
  const age = d.built ? Math.floor((Date.now() - new Date(d.built).getTime()) / 86400000) : null;
  out.checked.push({ area: area, sub: 'table', label: 'Файл посилань на сайт', detail: 'зібраний ' + (d.built || '?') + (age != null ? ' (' + age + ' дн. тому)' : '') });
  if (age != null && age > 45) {
    out.issues.push(diagIssue(area, 'table', 'warning', 'Таблицю посилань на сайт давно не оновлювали: ' + age + ' дн.',
      ['Нові/змінені картки на сайті в ній не відображені. Попросіть Claude перебудувати (claude/site-catalog/build_site_links.py).'], { tab: 'catalog' }));
  }
  CATALOG_TILES.forEach(tile => {
    ['mhi', 'gal'].forEach(brand => {
      const cfg = tile[brand];
      if (!cfg || !d.links[cfg.key]) return;
      const label = tile.label + ' / ' + brand.toUpperCase();
      const items = ctx.data[cfg.key] || [];
      const keys = new Set(items.map(siteLinkKey));
      const links = d.links[cfg.key], noCard = new Set((d.noCard && d.noCard[cfg.key]) || []);
      const stale = Object.keys(links).filter(k => !keys.has(k));
      const fresh = items.filter(it => { const k = siteLinkKey(it); return !links[k] && !noCard.has(k); });
      const target = { app: { tile: tile.id, brand: brand } };
      if (stale.length) {
        out.issues.push(diagIssue(area, cfg.key, 'warning', label + ': посилань на сайт, яким у прайсі більше нема маркування — ' + stale.length,
          stale.map(k => k + ' → ' + links[k]).concat(['Маркування в прайсі змінилось: тап по такій назві ніде не діє, а посилання зависло. Потрібна перебудова таблиці посилань.']), target));
      }
      if (fresh.length) {
        out.issues.push(diagIssue(area, cfg.key, 'warning', label + ': нові позиції прайсу без картки на сайті — ' + fresh.length,
          fresh.map(it => it.model + (it.outdoorModel ? ' + ' + it.outdoorModel : '')).concat(['Позицій не було, коли будували таблицю посилань: або картки ще нема на сайті, або таблицю треба перебудувати.']),
          Object.assign({}, target, { app: Object.assign({}, target.app, { model: fresh[0].model }) })));
      }
      const linked = items.filter(it => links[siteLinkKey(it)]).length;
      out.checked.push({ area: area, sub: cfg.key, label: label, detail: linked + ' з ' + items.length + ' позицій мають посилання' });
    });
  });
  return out;
}

/* ---- 3. Зображення та файли застосунку ---- */
/* Файли, на які посилається ЛИШЕ JavaScript і яких немає в розмітці на момент перевірки.
   Самодіагностика запускається з Кабінету, а логотипи брендів малюються тільки всередині
   розділу каталогу — без цього списку їх ніхто б не перевірив, і зникнення файлу
   виявилось би вже в дилера порожньою кнопкою. Білі версії поки не використовуються,
   але лежать поруч під темну тему — хай перевіряються разом. */
const DIAG_JS_ONLY_FILES = [
  'tile-images/brand-logo-mitsubishi.svg',
  'tile-images/brand-logo-galactic.svg',
  'tile-images/brand-logo-mitsubishi-white.svg',
  'tile-images/brand-logo-galactic-white.svg'
];
function diagReferencedFiles() {
  const text = document.documentElement.innerHTML;
  const found = new Set(DIAG_JS_ONLY_FILES);
  const re = /(?:tile-images\/[\w.\-]+\.(?:jpg|jpeg|png|webp|svg|gif)|data\/[\w\-]+\.json|(?:icon|apple-touch-icon)[\w\-]*\.png|manifest\.json)/g;
  let m;
  while ((m = re.exec(text))) found.add(m[0]);
  return Array.from(found).sort();
}
async function diagUrlStatus(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok ? 'ok' : 'http ' + r.status;
  } catch (e) {
    return 'network';
  }
}
function diagImageLoads(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
async function diagCheckFiles(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.files;
  const files = diagReferencedFiles();
  const bad = [];
  for (let i = 0; i < files.length; i += 8) {
    const batch = files.slice(i, i + 8);
    const res = await Promise.all(batch.map(f => diagUrlStatus(f)));
    res.forEach((s, j) => { if (s !== 'ok') bad.push(batch[j] + ' — ' + (s === 'network' ? 'не вдалося перевірити (мережа)' : 'не знайдено (' + s + ')')); });
  }
  if (bad.length) out.issues.push(diagIssue(area, 'app-files', 'error', 'Файли, на які посилається застосунок, недоступні — ' + bad.length, bad.concat(['Залийте/поверніть ці файли в репозиторій (tile-images/, data/ тощо).']), { tab: 'catalog' }));
  out.checked.push({ area: area, sub: 'app-files', label: 'Зображення плиток, іконки, довідкові файли застосунку', detail: files.length + ' файлів' });
  // Зображення акцій (Supabase Storage)
  try {
    const { data: promos, error } = await sb.from('promotions').select('id,title,image_url,pdf_url,is_active');
    if (error) throw error;
    const badPromo = [];
    let n = 0;
    for (const p of (promos || []).filter(p => p.is_active)) {
      for (const [field, url] of [['зображення', p.image_url], ['PDF', p.pdf_url]]) {
        if (!url) continue;
        n++;
        let ok = (await diagUrlStatus(url)) === 'ok';
        if (!ok && field === 'зображення') ok = await diagImageLoads(url);
        if (!ok) badPromo.push('«' + p.title + '»: ' + field + ' не відкривається (' + url + ')');
      }
    }
    if (badPromo.length) out.issues.push(diagIssue(area, 'promotions', 'error', 'Акції: файли, що не відкриваються — ' + badPromo.length, badPromo, { tab: 'promotions' }));
    out.checked.push({ area: area, sub: 'promotions', label: 'Зображення та PDF активних акцій', detail: n + ' файлів' });
  } catch (e) {
    out.issues.push(diagIssue(area, 'promotions', 'warning', 'Не вдалося перевірити файли акцій: ' + (e && e.message ? e.message : e), [], { tab: 'promotions' }));
  }
  return out;
}
/* Зображення серій, вбудовані в Excel (показуються у вікні ⓘ Спліт-систем). Базова лінія — кількість
   груп із фото, запам'ятана на пристрої супер-адміна: різке падіння = картинки зникли з Excel. */
async function diagCheckSeriesImages(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.files;
  try {
    const counts = {};
    for (const brand of ['mhi', 'gal']) {
      const sheetName = brand === 'mhi' ? 'ПОБУТОВІ' : 'GALACTIC';
      const rowGroupMap = await getRowGroupMapForSplitTile(brand);
      const map = await extractSeriesImages(sheetName, row => rowGroupMap[row]);
      counts[brand] = map.size;
    }
    let base = {};
    try { base = JSON.parse(localStorage.getItem('sunice_diag_series_images') || '{}'); } catch (e) { base = {}; }
    const lines = [];
    ['mhi', 'gal'].forEach(b => {
      if (counts[b] === 0) lines.push('Спліт-системи / ' + b.toUpperCase() + ': у Excel не знайдено жодного фото серій');
      else if (base[b] && counts[b] < base[b] * 0.7) lines.push('Спліт-системи / ' + b.toUpperCase() + ': груп із фото було ' + base[b] + ', стало ' + counts[b]);
    });
    if (lines.length) out.issues.push(diagIssue(area, 'series-images', 'warning', 'Фото серій у Excel: зникли або їх стало помітно менше', lines, { tab: 'catalog', app: { tile: 'split', brand: 'mhi' } }));
    else try { localStorage.setItem('sunice_diag_series_images', JSON.stringify(counts)); } catch (e) {}
    out.checked.push({ area: area, sub: 'series-images', label: 'Фото серій, вбудовані в Excel (Спліт-системи)', detail: 'MHI: ' + counts.mhi + ' груп, GAL: ' + counts.gal + ' груп із фото' });
  } catch (e) {
    out.issues.push(diagIssue(area, 'series-images', 'warning', 'Не вдалося перевірити фото серій: ' + (e && e.message ? e.message : e), []));
  }
  return out;
}

/* ---- 4. Ролі та доступи (тільки супер-адмін бачить усі профілі завдяки RLS) ---- */
async function diagCheckRoles(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.roles;
  const { data: profiles, error } = await sb.from('profiles').select('id,full_name,phone,role,status,region_id,created_at');
  if (error || !profiles) {
    out.issues.push(diagIssue(area, 'profiles', 'warning', 'Не вдалося прочитати профілі для перевірки ролей', [error && error.message ? error.message : 'порожня відповідь'], { tab: 'cabinet' }));
    return out;
  }
  const regions = await getRegions();
  const who = p => (p.full_name || '(без імені)') + ' ' + (p.phone || '');
  const issues = [];
  const supers = profiles.filter(p => p.role === 'super_admin' && p.status === 'approved');
  if (!supers.length) issues.push(['error', 'У системі немає жодного підтвердженого супер-адміна', []]);
  const admins = profiles.filter(p => p.role !== 'user');
  const noRegion = admins.filter(p => p.role === 'regional_admin' && !p.region_id);
  if (noRegion.length) issues.push(['error', 'Регіональні адміни без регіону — вони не бачать жодної заявки: ' + noRegion.length, noRegion.map(who)]);
  const inactive = admins.filter(p => p.status !== 'approved');
  if (inactive.length) issues.push(['warning', 'Адміністратори зі статусом не «підтверджено» — ' + inactive.length, inactive.map(p => who(p) + ' · ' + p.role + ' · ' + p.status)]);
  const orphanPending = profiles.filter(p => p.status === 'pending' && !p.region_id);
  if (orphanPending.length) issues.push(['warning', 'Заявки без регіону — їх бачить лише супер-адмін: ' + orphanPending.length, orphanPending.map(who)]);
  const uncovered = regions.filter(r => profiles.some(p => p.status === 'pending' && p.region_id === r.id) &&
    !profiles.some(p => p.role === 'regional_admin' && p.status === 'approved' && p.region_id === r.id));
  if (uncovered.length) issues.push(['warning', 'Є заявки в регіонах, де немає жодного підтвердженого регіонального адміна: ' + uncovered.length, uncovered.map(r => r.name)]);
  const stale = profiles.filter(p => p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 7 * 86400000);
  if (stale.length) issues.push(['info', 'Заявки, що чекають понад 7 днів: ' + stale.length, stale.map(who)]);
  issues.forEach((x, i) => out.issues.push(diagIssue(area, 'profiles', x[0], x[1], x[2], { tab: 'cabinet' })));
  out.checked.push({ area: area, sub: 'profiles', label: 'Ролі, статуси та регіони користувачів',
    detail: profiles.length + ' профілів · супер-адмінів ' + supers.length + ' · регіональних ' + profiles.filter(p => p.role === 'regional_admin').length });
  return out;
}

/* ---- 4а. Сповіщення (push) ----
   Додано 2026-10-16 після скарги «сповіщення приходять лише коли зайшов у застосунок».
   Розслідування показало, що функція відправки мовчки ковтала всі помилки й завжди
   звітувала «ок», а троє адмінів узагалі не мали підписки — і ніщо про це не казало.
   Тепер кожна відправка пишеться в push_log, а ця перевірка показує підсумок.
   Дані бере окрема RPC: push_subscriptions кожен бачить лише свої (RLS). */
async function diagCheckPush(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.push;
  const tgt = { tab: 'cabinet' };
  let data = null;
  try {
    const r = await sb.rpc('get_push_health');
    data = r && r.data;
  } catch (e) { /* нижче повідомимо */ }
  if (!data) {
    out.issues.push(diagIssue(area, 'access', 'info', 'Стан сповіщень недоступний',
      ['Зведення віддається лише супер-адміну. Якщо ви супер-адмін і бачите це повідомлення — у базі немає функції get_push_health.'], tgt));
    return out;
  }
  const noSubs = data.admins_no_subs || [];
  if (noSubs.length) {
    out.issues.push(diagIssue(area, 'subs', 'warning',
      'Адміністратори без підписки на сповіщення: ' + noSubs.length + ' із ' + data.admins,
      ['Їм push не надсилається взагалі — вони бачать заявки лише коли самі відкриють Кабінет.',
       'Лікується на їхньому пристрої: Кабінет → увімкнути сповіщення й дозволити їх у системі.']
      .concat(noSubs), tgt));
  }
  if (Number(data.failed7) > 0) {
    out.issues.push(diagIssue(area, 'errors', 'warning',
      'Невдалих відправок за 7 днів: ' + data.failed7,
      ['Коди відповіді від Google/Apple:'].concat(data.errors || []), tgt));
  }
  if (Number(data.subs) > 0 && Number(data.sent7) === 0 && Number(data.failed7) === 0) {
    out.issues.push(diagIssue(area, 'silence', 'info',
      'За 7 днів жодного сповіщення не надсилалось',
      ['Це нормально, якщо не було нових заявок і акцій.'], tgt));
  }
  out.checked.push({ area: area, sub: 'push', label: 'Підписки на сповіщення та доставка за 7 днів',
    detail: 'адмінів ' + data.admins + ' · підписок ' + data.subs + ' · надіслано ' + data.sent7 + ', помилок ' + data.failed7 });
  return out;
}

/* ---- 5. Курси валют ---- */
async function diagCheckRates(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.rates;
  const { data, error } = await sb.from('app_settings').select('usd_rate,eur_rate,rate_effective_date').eq('id', 1).single();
  if (error || !data) {
    out.issues.push(diagIssue(area, 'rates', 'warning', 'Не вдалося прочитати курси валют', [error && error.message ? error.message : ''], { tab: 'catalog' }));
    return out;
  }
  const lines = [];
  if (!data.usd_rate) lines.push(['error', 'Не встановлено курс долара — калькулятор не може перерахувати в гривню']);
  if (!data.eur_rate) lines.push(['warning', 'Не встановлено курс євро']);
  // Термінів давності для курсу НЕМАЄ (рішення власника 2026-10-02): адміни самі міняють його, коли він
  // змінюється. Перевіряємо лише, що курс і дата взагалі задані.
  if (!data.rate_effective_date) lines.push(['warning', 'Не вказано дату, від якої діє курс']);
  lines.forEach(l => out.issues.push(diagIssue(area, 'rates', l[0], l[1], [], { tab: 'catalog' })));
  out.checked.push({ area: area, sub: 'rates', label: 'Курси $ і €, дата курсу', detail: '$ ' + (data.usd_rate || '—') + ' · € ' + (data.eur_rate || '—') });
  return out;
}

/* ---- 6. Чи цей пристрій має найновішу версію застосунку ---- */
async function diagCheckBuild(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.build;
  try {
    // Accept: text/html — інакше service worker віддасть із кешу (для нього це "статика", кеш-спершу)
    // власну застарілу копію й перевірка нічого б не показала. З таким заголовком він іде в мережу.
    // З 2026-10-08 код живе в js/*.js, тож самого APP_BUILD в index.html уже немає — лишились
    // теги <script> з ?v=. Читаємо версію звідти: ?v= завжди дорівнює APP_BUILD, це стереже
    // перевірка «Модулі застосунку». Так само надійно й не вимагає тягнути ще один файл.
    const r = await fetch('index.html', { cache: 'no-store', headers: { Accept: 'text/html' } });
    const m = (await r.text()).match(/js\/01-config\.js\?v=([^"]+)"/);
    const live = m ? m[1] : null;
    out.checked.push({ area: area, sub: 'build', label: 'Версія застосунку на цьому пристрої й на сервері', detail: 'тут ' + APP_BUILD + ' · на сервері ' + (live || '?') });
    if (live && live !== APP_BUILD) {
      out.issues.push(diagIssue(area, 'build', 'warning', 'Цей пристрій працює на застарілій версії застосунку (' + APP_BUILD + '), на сервері ' + live,
        ['Закрийте застосунок повністю (прибрати зі списку запущених) і відкрийте знову; якщо не допомогло — очистіть дані сайту.'], { tab: 'catalog' }));
    }
  } catch (e) {
    out.issues.push(diagIssue(area, 'build', 'info', 'Не вдалося звірити версію застосунку з сервером', [e && e.message ? e.message : ''], null));
  }
  return out;
}

/* ---- Публікація прайсу (з 2026-10-18) ----
   Нова функція = нова перевірка (вимога CLAUDE.md, не обговорюється).
   Тут ловимо саме те, що здатне зламатись ТИХО:
     • серверна частина не розгорнута (RPC немає) — кабінет покаже кнопку, а публікація
       впаде аж у момент натискання;
     • опублікована версія розійшлась із тим, що показує застосунок — тобто дилери
       бачать не те, що опублікував адмін. Це головне, заради чого перевірка існує;
     • сам файл price-admin.js недосяжний або застарілої версії.
   Поки опублікованої версії ще немає (етапи A–C), це НЕ проблема: застосунок свідомо
   працює зі старого price.xlsx. Тому — примітка, а не помилка. */
async function diagCheckPricePublish(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.pricePublish;

  /* 0. ЧИ ЗАКРИТИЙ СТАРИЙ price.xlsx (етап E, з 2026-10-19).
     Питання не теоретичне: 2026-10-12 і 2026-10-19 файл справді віддавався будь-кому за
     прямим посиланням — тобто весь прайс із цінами качався без жодного входу, і ніякі
     гейти доступу в застосунку цього не міняли. Беремо ОДИН байт (Range), щоб перевірка
     не тягнула 10 МБ, і свідомо БЕЗ заголовків авторизації. */
  try {
    const probe = await fetch(PRICE_FILE_URL, { cache: 'no-store', headers: { Range: 'bytes=0-0' } });
    if (probe.ok || probe.status === 206) {
      out.issues.push(diagIssue(area, 'bucket', 'error',
        'Старий price.xlsx усе ще відкритий усім',
        ['Повний прайс із цінами качається за прямим посиланням без входу в застосунок.',
         'Закрити: claude/sql/2026-10-19-close-price-bucket.sql (спершу переконатись, що всі пристрої на новій версії).'],
        null));
    } else {
      out.checked.push({ area: area, sub: 'bucket', label: 'Старий price.xlsx закритий', detail: 'HTTP ' + probe.status + ' без авторизації' });
    }
  } catch (e) {
    out.checked.push({ area: area, sub: 'bucket', label: 'Старий price.xlsx недоступний ззовні', detail: 'запит не пройшов' });
  }

  // 1. Чи відповідає серверна частина
  let info = null;
  try {
    const res = await sb.rpc('get_price_version');
    if (res.error) throw res.error;
    info = res.data || null;
    out.checked.push({ area: area, sub: 'rpc', label: 'Серверна частина публікації відповідає',
      detail: info ? ('чинна версія №' + info.version_id) : 'опублікованої версії ще немає' });
  } catch (e) {
    out.issues.push(diagIssue(area, 'rpc', 'warning',
      'Серверна частина публікації прайсу не відповідає (get_price_version)',
      ['Міграція claude/sql/2026-10-18-price-publish.sql, найімовірніше, ще не застосована до цієї бази.',
       (e && e.message) || ''], { tab: 'cabinet' }));
    return out; // далі перевіряти нічого
  }

  /* 1b. ЯКИМ ШЛЯХОМ узято прайс на цьому пристрої (етап D).
     Головне, заради чого перевірка існує під час переїзду: якщо застосунок тихо
     працює на старому price.xlsx, усі переваги переїзду не діють, а бакет
     закривати не можна. Тому стан шляху — завжди на видноті. */
  if (priceSourceUsed === 'published') {
    out.checked.push({ area: area, sub: 'source', label: 'Звідки взято прайс на цьому пристрої',
      detail: 'опубліковані дані, версія №' + (publishedVersionId || '?') });
  } else if (priceSourceUsed === 'xlsx') {
    out.issues.push(diagIssue(area, 'source', 'warning',
      'Цей пристрій працює зі СТАРОГО price.xlsx, а не з опублікованих даних',
      ['Причина відкату: ' + (priceFallbackReason || 'не вказана') + '.',
       'Поки такі відкати трапляються, публічний бакет закривати не можна (етап E).'],
      { tab: 'cabinet' }));
  } else {
    out.checked.push({ area: area, sub: 'source', label: 'Звідки взято прайс на цьому пристрої',
      detail: 'прайс ще не завантажувався в цьому сеансі' });
  }

  /* 1c. ЧИ ПЕРЕНЕСЕНІ ФОТО СЕРІЙ (з 2026-10-19).
     Якщо опублікована версія без мапи фото, застосунок заради кожного дотику по ⓘ
     тягне весь 10-мегабайтний price.xlsx — і закрити публічний бакет не можна.
     Саме так і сталось: публікація того самого файлу вдруге мовчки повернула стару
     чернетку, фото вже лежали в сховищі, а мапа загубилась. Тепер це видно. */
  /* ⚠️ Питаємо СЕРВЕР (info.has_media), а не власну памʼять. Одразу після публікації
     застосунок ще тримає ПОПЕРЕДНЮ версію прайсу — і перевірка, дивлячись у памʼять,
     казала «фото немає» про версію, яка їх щойно отримала. Власник побачив саме це
     (2026-10-19). Памʼять тепер лише окремо згадуємо, якщо вона відстала. */
  if (info) {
    if (info.has_media) {
      out.checked.push({ area: area, sub: 'media', label: 'Фото серій в опублікованій версії',
        detail: 'перенесені в сховище' });
      if (priceSourceUsed === 'published' && publishedVersionId !== info.version_id) {
        out.issues.push(diagIssue(area, 'media', 'info',
          'Цей пристрій ще показує версію прайсу №' + publishedVersionId + ', опублікована вже №' + info.version_id,
          ['Так і буває одразу після публікації. Застосунок підхопить нову при наступному відкритті.'],
          { tab: 'catalog' }));
      }
    } else {
      out.issues.push(diagIssue(area, 'media', 'warning',
        'В опублікованій версії немає фото серій — застосунок тягне price.xlsx щоразу, коли хтось їх відкриває',
        ['Опублікуйте прайс ще раз: при публікації фото переносяться в окреме сховище.',
         'Доки мапи фото немає, публічний бакет закривати не можна.'], { tab: 'cabinet' }));
    }
  }

  // 2. Чи збігається опубліковане з тим, що зараз у застосунку
  if (!info) {
    out.issues.push(diagIssue(area, 'state', 'info',
      'Опублікованої версії прайсу ще немає — застосунок працює зі старого price.xlsx',
      ['Так і задумано, доки переїзд не завершено (claude/price-publish/00-ПЛАН-І-СТАТУС.md).'], null));
  } else {
    const shown = Object.keys(sheetsData || {}).reduce(function (n, k) {
      return n + (Array.isArray(sheetsData[k]) ? sheetsData[k].length : 0);
    }, 0);
    out.checked.push({ area: area, sub: 'count', label: 'Позицій у застосунку на цьому пристрої', detail: String(shown) });
    try {
      const pub = await sb.rpc('get_price');
      const total = pub && pub.data && pub.data.stats && pub.data.stats.total;
      if (typeof total === 'number') {
        out.checked.push({ area: area, sub: 'published', label: 'Позицій в опублікованій версії', detail: String(total) });
        if (shown > 0 && total !== shown) {
          out.issues.push(diagIssue(area, 'published', 'warning',
            'Опублікований прайс і те, що показує застосунок, розходяться: ' + total + ' проти ' + shown + ' позицій',
            ['Поки застосунок читає price.xlsx, а не опубліковані дані, розбіжність очікувана — але її варто розуміти.',
             'Якщо перехід уже зроблено — це справжня проблема: дилери бачать не те, що опубліковано.'], { tab: 'cabinet' }));
        }
      }
    } catch (e) { /* немає доступу до цін — не наша справа, це перевіряє інша частина */ }
  }

  // 3. Чи досяжний сам модуль кабінету
  try {
    const r = await fetch(PRICE_ADMIN_JS_FILE, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    out.checked.push({ area: area, sub: 'module', label: 'Файл price-admin.js на сервері', detail: 'є, версія ' + APP_BUILD });
  } catch (e) {
    out.issues.push(diagIssue(area, 'module', 'warning',
      'Файл price-admin.js не завантажується — розділ «Прайс» у кабінеті не відкриється',
      ['Найімовірніше, його не залили на GitHub разом з рештою файлів.',
       (e && e.message) || ''], { tab: 'cabinet' }));
  }

  return out;
}

/* ---- 10. Характеристики товарів (data/specs-*.json) ----
   Новий зовнішній джерело даних = нова перевірка (вимога CLAUDE.md). Характеристики
   беруться з сайту офлайн-скриптом, тож розійтися з дійсністю можуть тихо: на сайті
   з'явилась нова картка або змінилось маркування в прайсі — а файл лишився старим, і
   панель товару просто мовчки показує «характеристик не знайшлось».
   Перевіряємо три речі: файли взагалі вантажаться; чи не застаріли; скільки позицій
   прайсу мають картку на сайті, але не мають характеристик. */
async function diagCheckSpecs(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.specs;
  const FIX = 'Перезібрати: python claude/site-catalog/build_specs.py --group <розділ> --out data/specs-<розділ>.json';
  const links = await loadSiteLinks();
  if (!links || !links.links) {
    out.issues.push(diagIssue(area, 'specs', 'info', 'Таблиця посилань на сайт не завантажилась — перевірку характеристик пропущено', [], null));
    return out;
  }
  for (const key of Object.keys(SPECS_FILES)) {
    const label = DIAG_SUB_LABELS[key] || key;
    let specs = null;
    try { specs = await loadSpecs(key); } catch (e) { specs = null; }
    if (!specs || !Object.keys(specs).length) {
      out.issues.push(diagIssue(area, key, 'error', label + ': файл характеристик не завантажився',
        ['Панель товару в цьому розділі показуватиме порожні характеристики.', FIX], { app: { tile: key.split('_')[0], brand: key.split('_')[1] } }));
      continue;
    }
    const items = (ctx.data && ctx.data[key]) || (sheetsData && sheetsData[key]) || [];
    const map = links.links[key] || {};
    let withCard = 0, missing = [];
    items.forEach(it => {
      const slug = map[siteLinkKey(it)];
      if (!slug) return;
      withCard++;
      // шлях пошуку (index.php?...) — це не картка, характеристик для нього й не буває
      if (slug.indexOf('index.php') === 0) return;
      if (!specs[slug]) missing.push(it.model);
    });
    out.checked.push({ area: area, sub: key, label: label,
      detail: (withCard - missing.length) + ' з ' + withCard + ' позицій із карткою мають характеристики' });
    if (missing.length) {
      out.issues.push(diagIssue(area, key, 'warning',
        label + ': позицій із карткою на сайті, але без характеристик — ' + missing.length,
        missing.concat(['Картка на сайті є, а характеристик для неї не зібрано: або картка нова, або маркування в прайсі змінилось.', FIX]),
        { app: { tile: key.split('_')[0], brand: key.split('_')[1] } }));
    }
  }

  /* Фото карток (data/card-images.json, з 2026-10-09 — фото зверху характеристик).
     Те саме зовнішнє джерело й та сама тиха пастка: на сайті перейменували картинку
     або з'явилась нова картка — файл лишився старим, і панель показує характеристики
     без фото, нічого про це не сказавши. */
  const FIX_IMG = 'Перезібрати: python claude/site-catalog/build_card_images.py';
  let ci = null;
  try { ci = await loadCardImages(); } catch (e) { ci = null; }
  if (!ci || !ci.images || !Object.keys(ci.images).length) {
    out.issues.push(diagIssue(area, 'photos', 'error',
      'Файл фото карток (data/card-images.json) не завантажився',
      ['Панель товару показуватиме характеристики без фото з сайту.', FIX_IMG], null));
  } else {
    let total = 0;
    const noPhoto = [];
    for (const key of Object.keys(SPECS_FILES)) {
      const items = (ctx.data && ctx.data[key]) || (sheetsData && sheetsData[key]) || [];
      const map = links.links[key] || {};
      items.forEach(it => {
        const slug = map[siteLinkKey(it)];
        if (!slug || slug.indexOf('index.php') === 0) return;
        total++;
        if (!ci.images[slug]) noPhoto.push((DIAG_SUB_LABELS[key] || key) + ': ' + it.model);
      });
    }
    out.checked.push({ area: area, sub: 'photos', label: 'Фото карток товару з сайту',
      detail: (total - noPhoto.length) + ' з ' + total + ' позицій із карткою мають фото' });
    if (noPhoto.length) {
      out.issues.push(diagIssue(area, 'photos', 'warning',
        'Позицій із карткою на сайті, але без фото — ' + noPhoto.length,
        noPhoto.concat(['Фото беремо з картки сайту; якщо його немає — картка нова або картинку на сайті перейменували.', FIX_IMG]),
        null));
    }
  }
  return out;
}

/* ---- 9. Модулі застосунку (код у js/*.js) ----
   З 2026-10-08 код застосунку живе не всередині index.html, а в js/*.js. Три речі
   мусять збігатися ТОЧНО: теги <script> в index.html, список APP_SHELL у sw.js і
   APP_BUILD. Якщо розійдуться — телефон візьме суміш старих і нових файлів (і впаде
   непередбачувано) або застосунок не підніметься офлайн.
   Піднімати все разом однією командою:
       python claude/split-index/set-build.py РРРР-ММ-ДД.N  */
async function diagCheckModules(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.modules;
  const FIX = 'Залити разом index.html, усю папку js/ і sw.js, піднявши версію: python claude/split-index/set-build.py РРРР-ММ-ДД.N';

  // 1. Чи всі модулі справді завантажились
  const dead = Object.keys(MODULE_ANCHORS).filter(f => typeof window[MODULE_ANCHORS[f]] !== 'function');
  if (dead.length) {
    out.issues.push(diagIssue(area, 'modules', 'error',
      'Не завантажилось модулів застосунку: ' + dead.length,
      dead.map(f => 'js/' + f + ' — немає ' + MODULE_ANCHORS[f] + '()').concat([FIX]), null));
  }
  const started = !!(history.state && history.state.tab);
  if (!started) {
    out.issues.push(diagIssue(area, 'modules', 'error',
      'Не виконався блок старту (js/13-start.js)',
      ['Без нього не навішано жодного обробника — застосунок виглядає живим, але не реагує.', FIX], null));
  }
  out.checked.push({ area: area, sub: 'modules', label: 'Усі модулі коду завантажились',
    detail: (Object.keys(MODULE_ANCHORS).length + 1 - dead.length - (started ? 0 : 1)) + ' з ' + (Object.keys(MODULE_ANCHORS).length + 1) });

  // 2. Чи всі теги мають ту саму версію, що й APP_BUILD
  const tags = Array.from(document.querySelectorAll('script[src^="js/"]'))
    .map(s => s.getAttribute('src'));
  const bad = tags.filter(s => (s.split('?v=')[1] || '') !== APP_BUILD);
  if (bad.length) {
    out.issues.push(diagIssue(area, 'modules', 'error',
      'Версія в тегах <script> не дорівнює APP_BUILD (' + APP_BUILD + ')',
      bad.slice(0, 6).concat([FIX]), null));
  }
  out.checked.push({ area: area, sub: 'modules', label: 'Версія ?v= в усіх тегах = APP_BUILD',
    detail: tags.length + ' тегів · ' + APP_BUILD });

  // 3. Чи список у service worker збігається з тегами — від цього залежить офлайн
  try {
    const r = await fetch('sw.js', { cache: 'no-store', headers: { Accept: 'text/html' } });
    const sw = await r.text();
    /* Без мережі сюди приходить НЕ sw.js: service worker не знаходить його в кеші й
       віддає запасну сторінку (index.html). Якби ми розбирали це як sw.js, вийшло б
       «0 записів у APP_SHELL» і гучна фальшива тривога «офлайн не підніметься».
       Тому спершу переконуємось, що це справді sw.js. */
    if (sw.indexOf('CACHE_VERSION') < 0) {
      out.checked.push({ area: area, sub: 'modules', label: 'Список у sw.js = теги в index.html',
        detail: 'пропущено — немає зв\'язку' });
      return out;
    }
    const shell = (sw.match(/'js\/[^']+'/g) || []).map(s => s.slice(1, -1));
    const onlyTags = tags.filter(t => shell.indexOf(t) < 0);
    const onlyShell = shell.filter(s => tags.indexOf(s) < 0);
    /* ⚠️ ФАЛЬШИВА ТРИВОГА, на яку наступили 2026-10-19. Сторінка приходить із кеша
       service worker (тобто СТАРОЇ версії), а sw.js ми щойно взяли з мережі —
       тобто НОВИЙ. Списки, звісно, не збігаються, і перевірка кричала «застосунок
       не підніметься без інтернету», хоча на сервері все узгоджено, а пристрій
       просто ще не дооновився. Власник побачив саме це на телефоні.
       Відрізняємо за версією: якщо версія в sw.js інша, ніж у цього пристрою —
       це не поломка, а незавершене оновлення, і сказати треба саме так. */
    const swBuild = ((sw.match(/js\/01-config\.js\?v=([^']+)'/) || [])[1]) || null;
    const deviceIsStale = swBuild && swBuild !== APP_BUILD;
    if (deviceIsStale) {
      out.issues.push(diagIssue(area, 'modules', 'info',
        'Оновлення застосунку ще не завершилось: на пристрої ' + APP_BUILD + ', на сервері ' + swBuild,
        ['Це не поломка. Закрийте застосунок повністю (приберіть зі списку запущених) і відкрийте знову.',
         'Доти звірка списку модулів нічого не означає — сторінка стара, а sw.js уже новий.'],
        { tab: 'catalog' }));
    } else if (onlyTags.length || onlyShell.length) {
      out.issues.push(diagIssue(area, 'modules', 'error',
        'Список модулів у sw.js не збігається з тегами в index.html',
        onlyTags.map(t => 'є в index.html, немає в sw.js: ' + t)
          .concat(onlyShell.map(s => 'є в sw.js, немає в index.html: ' + s))
          .concat(['Через це застосунок не підніметься без інтернету.', FIX]), null));
    }
    out.checked.push({ area: area, sub: 'modules', label: 'Список у sw.js = теги в index.html',
      detail: shell.length + ' записів у APP_SHELL' });
  } catch (e) {
    out.issues.push(diagIssue(area, 'modules', 'info', 'Не вдалося прочитати sw.js для звірки списку модулів',
      [e && e.message ? e.message : ''], null));
  }
  return out;
}

/* ---- 7. Картки на sun-ice.com.ua ("наживо", з боку сервера) ----
   Браузер не може читати сторінки сайту (немає CORS), тому перевірку робить Edge Function
   check-site-links (claude/edge-functions/check-site-links). Вона повертає
   { checked, problems: [{ kind, title, line, url, list, marking }], newCards: [...], note }.
   Якщо функцію ще не задеплоєно — це не помилка, а примітка (info). */
async function diagCheckSiteLive(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.site;
  let res;
  try {
    const table = await loadSiteLinks();
    if (!table || !table.links) throw new Error('таблицю посилань (data/site-links.json) не завантажено');
    const r = await sb.functions.invoke('check-site-links', { body: { table: table } });
    if (r.error) throw r.error;
    res = r.data;
  } catch (e) {
    out.issues.push(diagIssue(area, 'live', 'info', 'Серверна перевірка карток на сайті не виконана',
      ['Edge Function check-site-links не задеплоєна або недоступна: ' + (e && e.message ? e.message : e) + '. Поки її нема, зникнення/перейменування карток на сайті застосунок не помічає.'], null));
    return out;
  }
  if (!res || !Array.isArray(res.problems)) {
    out.issues.push(diagIssue(area, 'live', 'warning', 'Edge Function check-site-links повернула неочікувану відповідь', [], null));
    return out;
  }
  const byKind = { error: [], warning: [], info: [] };
  res.problems.forEach(p => (byKind[p.kind] || byKind.warning).push(p));
  const mk = (kind, title) => {
    const arr = byKind[kind];
    if (!arr.length) return;
    out.issues.push(diagIssue(area, 'live', kind, title + ': ' + arr.length,
      arr.map(p => (p.list ? p.list + ' · ' : '') + (p.marking ? p.marking + ': ' : '') + p.line),
      { site: arr[0].url || 'https://sun-ice.com.ua/',
        app: arr[0].list && arr[0].marking ? { tile: String(arr[0].list).split('_')[0], brand: String(arr[0].list).split('_')[1], model: String(arr[0].marking).split(' + ')[0] } : undefined }));
  };
  mk('error', 'Картки на сайті, які зникли або змінились');
  mk('warning', 'Картки на сайті, що потребують уваги');
  mk('info', 'Примітки по сайту');
  out.checked.push({ area: area, sub: 'live', label: 'Картки товарів на sun-ice.com.ua (сервер)', detail: (res.checked || 0) + ' карток перевірено' + (res.note ? ' · ' + res.note : '') });
  return out;
}

/* ---- 11. Загальний пошук по каталогу (П-8) ----
   Нова функція = нова перевірка (вимога CLAUDE.md). Пошук може зламатись ТИХО, і це
   найгірший його сценарій: поле є, людина вводить маркування, а результатів немає —
   і вона робить висновок «такого товару в застосунку немає», замість того щоб шукати далі.
   Два способи зламатись, які ця перевірка й ловить:
   1) GLOBAL_SEARCH_TILES виводиться з CATALOG_TILES — якщо ключ плитки перейменують
      (а таке вже бувало), розділ мовчки випаде з пошуку;
   2) нормалізація/ранжування (normalizeSearchKey, buildSearchPattern) перестане знаходити
      навіть точне маркування — наприклад, після зміни правил для «+» чи пробілів.
   Тому перевіряємо не «чи є код», а наскрізний результат: беремо реальні маркування з
   прайсу і вимагаємо, щоб пошук знайшов їх саме в тому розділі, де вони лежать. */
async function diagCheckSearch(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.search;
  const SAMPLE = 3;   // трьох вистачає: ламається нормалізація цілком, а не для одного рядка
  for (const src of GLOBAL_SEARCH_TILES) {
    const label = DIAG_SUB_LABELS[src.key] || src.key;
    const items = (ctx.data && ctx.data[src.key]) || (sheetsData && sheetsData[src.key]) || [];
    if (!items.length) {
      out.issues.push(diagIssue(area, src.key, 'error', label + ': розділ не потрапляє в пошук',
        ['У пошуку по цьому розділу немає жодної позиції — найімовірніше змінився ключ плитки в CATALOG_TILES.',
         'Людина шукатиме товар цього розділу й вирішить, що його в застосунку немає.'],
        { app: { tile: src.tileId, brand: src.brand } }));
      continue;
    }
    /* Беремо позиції з РІЗНИХ кінців списку: якби вибірка завжди йшла з початку,
       поломка, що зачіпає лише довгі чи парні маркування (напівпром — це «A + B»),
       могла б не потрапити у вибірку взагалі. */
    const idxs = [0, Math.floor(items.length / 2), items.length - 1].slice(0, Math.min(SAMPLE, items.length));
    const failed = [];
    idxs.forEach(i => {
      const model = items[i].model;
      let hits = [];
      try { hits = computeGlobalSearchResults(model); } catch (e) { hits = []; }
      const ok = hits.some(h => h.item.model === model && h.tileId === src.tileId && h.brand === src.brand);
      if (!ok) failed.push(model);
    });
    if (failed.length) {
      out.issues.push(diagIssue(area, src.key, 'error',
        label + ': пошук не знаходить власні ж маркування — ' + failed.length + ' з ' + idxs.length,
        failed.concat(['Введене повністю маркування мусить знаходитись завжди. Дивитись normalizeSearchKey / buildSearchPattern у js/02-price-parse.js і computeGlobalSearchResults у js/04-catalog.js.']),
        { app: { tile: src.tileId, brand: src.brand } }));
    }
    out.checked.push({ area: area, sub: src.key, label: label,
      detail: items.length + ' позицій у пошуку · вибірку з ' + idxs.length + ' маркувань знайдено' });
  }
  return out;
}

/* ---------- ГРУПИ ПРАЙСУ (2026-10-19) ----------
   Спліт, Мульти спліт і Напівпром показуються згортними блоками серій (js/04a-catalog-groups.js).
   Дві речі тут ламаються ТИХО — людина просто не знайде товар:
   1. Позиція випала з дерева груп (чи з'явилась двічі, чи змінила місце) — у згорнутому
      блоці вона ніде не видна, і ніякої помилки немає.
   2. Серію не вдалось визначити (новий суфікс у Мульти GAL, нова настінна серія в Мульти MHI,
      позиція без групи) — позиція лишиться «голим» рядком посеред згорнутих блоків.
   Перевірка будує дерево з тих самих даних, що йдуть на екран, і звіряє з прайсом. */
async function diagCheckGroups(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.groups;
  const srcByKey = {};
  GLOBAL_SEARCH_TILES.forEach(s => { srcByKey[s.key] = s; });
  Object.keys(CG_RULES).forEach(key => {
    const label = DIAG_SUB_LABELS[key] || key;
    const items = (ctx.data && ctx.data[key]) || (sheetsData && sheetsData[key]) || [];
    if (!items.length) return;   // порожній аркуш — про це скаже звірка з Excel
    const src = srcByKey[key];
    const target = src ? { app: { tile: src.tileId, brand: src.brand } } : null;
    const mode = CG_RULES[key].mode;
    const nodes = cgBuildNodes(key, items);
    const flat = cgFlatIndexes(nodes);
    const intact = flat.length === items.length && flat.every((v, i) => v === i);
    if (!intact) {
      out.issues.push(diagIssue(area, key, 'error',
        label + ': у групах прайс не збігається з джерелом — ' + flat.length + ' з ' + items.length + ' позицій',
        ['Кожна позиція прайсу мусить потрапляти в групи рівно один раз і в тому самому порядку. Дивитись cgBuildNodes у js/04a-catalog-groups.js.'],
        target));
    }
    const groups = nodes.filter(n => n.type === 'group');
    const split = groups.filter(g => g.split);
    if (split.length) {
      out.issues.push(diagIssue(area, key, 'warning',
        label + ': одна серія стоїть у прайсі двома окремими шматками — ' + split.length,
        split.map(g => g.title), target));
    }
    /* Що саме лишилось «голим» рядком — залежить від правила: у Мульти MHI зовнішні блоки й
       аксесуари так і задумано, а ось внутрішній блок без типу чи настінний поза відомими
       серіями — ні. */
    const plain = nodes.filter(n => n.type === 'row').map(n => n.item);
    let stray = [];
    if (mode === 'labels' || mode === 'multi-gal') stray = plain;
    else if (mode === 'multi-mhi') stray = plain.filter(it => it.unitType === 'indoor');
    if (stray.length) {
      out.issues.push(diagIssue(area, key, 'warning',
        label + ': не вдалось віднести до групи — ' + stray.length + ' позицій',
        stray.map(it => it.model).concat([mode === 'multi-gal'
          ? 'Серія Мульти GAL визначається за суфіксом маркування (M-W, H-W, H-S) — див. CG_GAL_SERIES. Нова серія → додати в таблицю.'
          : 'Позиція лишається звичайним рядком між згорнутими блоками.']), target));
    }
    /* Маркування серії в назві блока — вимога власника (2026-10-19). Назви беруться з явної
       таблиці CG_TITLES; група, якої там немає, показується за прайсом без маркування. А якщо
       маркування в таблиці є, воно мусить бути в КОЖНІЙ моделі групи — інакше підпис бреше. */
    const unmarked = groups.filter(g => !g.marked && !g.exempt);
    if (unmarked.length) {
      out.issues.push(diagIssue(area, key, 'warning',
        label + ': у назві блока не вказано маркування серії — ' + unmarked.length,
        unmarked.map(g => g.title).concat(['Додати запис у CG_TITLES (js/04a-catalog-groups.js): назва з маркуванням серії й типом блока.']), target));
    }
    const lying = [];
    groups.forEach(g => {
      if (!g.codes || !g.codes.length) return;
      g.entries.forEach(e => {
        if (!cgCapacity(e.item.model)) return;       // аксесуари маркування серії не мають
        const up = String(e.item.model).toUpperCase();
        if (!g.codes.some(c => up.indexOf(c.toUpperCase()) >= 0)) lying.push(g.title + ': ' + e.item.model);
      });
    });
    if (lying.length) {
      out.issues.push(diagIssue(area, key, 'warning',
        label + ': маркування в назві не збігається з моделями групи — ' + lying.length,
        lying.concat(['Прайс змінився — звірити CG_TITLES (поле codes) у js/04a-catalog-groups.js.']), target));
    }
    if (mode === 'multi-mhi') {
      const wall = groups.filter(g => g.id === 'type-' + cgSlug('Настінний'));
      if (wall.length) {
        out.issues.push(diagIssue(area, key, 'warning',
          label + ': настінні внутрішні блоки поза відомими серіями (ZSP/ZS/ZSX/ZR)',
          wall.flatMap(g => g.entries.map(e => e.item.model)).concat(['Нова серія → додати в CG_MHI_WALL_SERIES (js/04a-catalog-groups.js).']), target));
      }
    }
    out.checked.push({ area: area, sub: key, label: label,
      detail: groups.length + ' груп · ' + items.length + ' позицій' + (intact ? ' — усі на місці, порядок прайсу' : ' — РОЗБІЖНІСТЬ') });
  });
  return out;
}

/* Реєстр перевірок. auto — ще й тихо після кожного розбору нового прайсу; manualOnly — лише за кнопкою. */
/* ---------- ШАПКА ЗАСТОСУНКУ (2026-10-12) ----------
   Шапку звели в один компактний ряд: [лупа 48×48] [курси + службові підписи] [↻].
   Дві речі тут ламаються ТИХО, і саме їх ловить ця перевірка.

   1. Вузли шапки. Перейменували id — пошук або курси просто перестають працювати, а
      на екрані це виглядає як «шапка порожня», без жодної помилки в консолі.
   2. Курси не вміщаються. Якщо тексту забагато, він не «вилазить» і не ламає верстку —
      його ріже трьома крапками, і дилер бачить «$ 44,90 ₴ € 51,…» як нормальний стан.
      Око такого не ловить, лінійка ловить. Міряємо справжню ширину тексту при
      поточному шрифті й порівнюємо з тим, що лишається центральній колонці на
      НАЙВУЖЧОМУ телефоні, який підтримуємо (360px) — тоді перевірка однаково чесна
      і на телефоні супер-адміна, і на його ж комп'ютері.

   Чого ця перевірка НЕ вміє: подивитись на шапку очима звичайного користувача.
   Вона бачить лише роль того, хто її запустив. Правило «службові підписи — лише
   адмінам» живе в renderRateRow() — якщо його колись зачеплять, тут буде тихо. */
const DIAG_HEADER_MIN_W = 360;   // найвужчий телефон, який тримаємо
function diagCheckHeader(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.header;
  const FIX = 'Дивитись <header> в index.html і renderRateRow() у js/04-catalog.js.';
  const headerEl = document.querySelector('header');
  const ids = ['header-main', 'header-search', 'header-search-btn', 'header-search-input',
    'header-search-clear', 'refresh-icon', 'rate-row', 'rate-view', 'rate-meta',
    'rate-meta-dates', 'rate-meta-who'];
  const missing = ids.filter(id => !document.getElementById(id));
  if (!headerEl || missing.length) {
    out.issues.push(diagIssue(area, 'markup', 'error',
      'У шапці бракує елементів: ' + (headerEl ? missing.join(', ') : '<header>'),
      ['Пошук, курси або кнопка оновлення в шапці не працюватимуть.', FIX], { tab: 'catalog' }));
    return out;
  }
  out.checked.push({ area: area, sub: 'markup', label: 'Розмітка шапки',
    detail: 'усі ' + ids.length + ' вузлів на місці' });

  /* Скільки лишається центральній колонці на 360px: ширина екрана мінус бічні
     відступи шапки, мінус лупа (48), мінус ↻ (22), мінус два проміжки ряду (2×10).
     Числа беремо з живого CSS там, де можемо, щоб перевірка не розійшлась зі стилями. */
  const cs = getComputedStyle(headerEl);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const searchW = document.getElementById('header-search').getBoundingClientRect().width || 48;
  const avail = DIAG_HEADER_MIN_W - pad - searchW - 22 - 20;

  function probe(cls, html) {
    const d = document.createElement('div');
    d.className = cls;
    d.style.cssText = 'position:absolute;left:-9999px;top:0;display:inline-block;width:auto;max-width:none;white-space:nowrap;visibility:hidden;';
    d.innerHTML = html;
    headerEl.appendChild(d);
    const w = d.getBoundingClientRect().width;
    headerEl.removeChild(d);
    return Math.ceil(w);
  }
  const rateW = probe('rate-line', document.getElementById('rate-view').innerHTML);
  out.checked.push({ area: area, sub: 'rates', label: 'Курси вміщаються в ряд',
    detail: 'потрібно ' + rateW + 'px, на екрані 360px лишається ' + Math.floor(avail) + 'px' });
  if (rateW > avail) {
    out.issues.push(diagIssue(area, 'rates', 'warning',
      'Курси не вміщаються в шапку на вузькому телефоні (360px)',
      ['Потрібно ' + rateW + 'px, лишається ' + Math.floor(avail) + 'px — текст обріжеться трьома крапками.',
       'Спершу зменшувати проміжки (.rate-line gap, .rate-label-eur margin), шрифт курсів — в останню чергу і не нижче 17px.',
       FIX], { tab: 'catalog' }));
  }
  /* Міряємо довший із двох службових рядків — ріжеться той, що не влізе. */
  const metaTexts = [document.getElementById('rate-meta-dates').textContent || '',
                     document.getElementById('rate-meta-who').textContent || ''];
  const datesText = metaTexts.sort((a, b) => b.length - a.length)[0];
  if (datesText) {
    const metaW = probe('rate-meta', '<span>' + escapeHtml(datesText) + '</span>');
    out.checked.push({ area: area, sub: 'meta', label: 'Службовий рядок вміщається',
      detail: 'потрібно ' + metaW + 'px, лишається ' + Math.floor(avail) + 'px' });
    if (metaW > avail) {
      out.issues.push(diagIssue(area, 'meta', 'warning',
        'Службовий рядок під курсами обрізається на вузькому телефоні (360px)',
        ['«' + datesText + '» — потрібно ' + metaW + 'px, лишається ' + Math.floor(avail) + 'px.',
         'Дати мають бути видні повністю; скорочувати сам текст, а не шрифт.', FIX], { tab: 'catalog' }));
    }
  }

  /* Ширше за екран шапка бути не може. Міряємо САМЕ ШАПКУ, а не всю сторінку:
     перехід «плитка → розділ» робить #main на 220 мс масштабованим (grow-fade), і в
     цей момент scrollWidth усього документа більший за екран — перевірка всієї
     сторінки давала б хибну тривогу. Шапка не анімується ніколи. */
  if (headerEl.scrollWidth > headerEl.clientWidth + 1) {
    out.issues.push(diagIssue(area, 'overflow', 'warning',
      'Вміст шапки ширший за екран',
      ['Потрібно ' + headerEl.scrollWidth + 'px при ширині ' + headerEl.clientWidth + 'px.',
       'Найімовірніше щось у ряду не стискається (загубився min-width: 0 у .header-center).', FIX], { tab: 'catalog' }));
  } else {
    out.checked.push({ area: area, sub: 'overflow', label: 'Шапка не ширша за екран',
      detail: 'екран ' + headerEl.clientWidth + 'px' });
  }
  return out;
}


/* ---- Поведінка при збоях мережі (2026-10-19, за підсумками зовнішнього аудиту).
   Перевіряє не «чи є інтернет», а чи на місці самі ЗАПОБІЖНИКИ — їх легко втратити
   при наступному рефакторингу, і зникнуть вони мовчки: на екрані все виглядає
   нормально, просто застосунок знову почне видавати долари за гривні, а збій мережі
   за «даних немає». Саме такі тихі втрати ми вже ловили (CLAUDE.md, пастки). ---- */
async function diagCheckResilience(ctx) {
  const out = { issues: [], checked: [] };
  const area = DIAG_AREA.resilience;
  const FIX = 'Виправляти в js/04-catalog.js (convertAmount), js/12-product-sheet.js, js/10-crmontage.js.';

  // 1. Без курсу конвертація мусить ВІДМОВИТИ, а не повернути ту саму суму в іншій валюті.
  const noRate = [convertAmount(100, '$', 'UAH', null), convertAmount(100, '$', 'UAH', 0),
                  convertAmount(100, 'UAH', '$', null)];
  if (noRate.some(v => v !== null)) {
    out.issues.push(diagIssue(area, 'currency', 'error',
      'Конвертація без курсу повертає число замість відмови',
      ['Доларова сума може бути показана й надіслана як гривнева.', FIX], { tab: 'catalog' }));
  } else {
    out.checked.push({ area: area, sub: 'currency', label: 'Без курсу валюта не підміняється', detail: 'convertAmount → null' });
  }
  // А з курсом — рахує як раніше (щоб «відмова» не зʼїла звичайний випадок).
  if (convertAmount(100, '$', 'UAH', 40) !== 4000) {
    out.issues.push(diagIssue(area, 'currency', 'error',
      'Конвертація з курсом рахує неправильно',
      ['100 $ за курсом 40 має давати 4000 ₴.', FIX], { tab: 'catalog' }));
  }

  // 2. Перевірка прайсу не повинна витрачатись на невдалу спробу.
  if (typeof PRICE_UPDATE_MIN_GAP_MS !== 'number' || !(PRICE_UPDATE_MIN_GAP_MS > 0) ||
      typeof priceUpdateCheckAt !== 'number') {
    out.issues.push(diagIssue(area, 'price-recheck', 'error',
      'Зник механізм повторної перевірки прайсу',
      ['Застосунок знову звірятиме прайс рівно раз за запуск, і невдала спроба буде останньою.', FIX], { tab: 'catalog' }));
  } else {
    out.checked.push({ area: area, sub: 'price-recheck', label: 'Прайс перевіряється повторно',
      detail: 'не частіше ніж раз на ' + Math.round(PRICE_UPDATE_MIN_GAP_MS / 60000) + ' хв' });
  }

  // 3. Списки CRМонтаж мусять відрізняти «порожньо» від «не завантажилось».
  if (typeof installerTasksFailed !== 'boolean' || typeof installerSuppliersFailed !== 'boolean') {
    out.issues.push(diagIssue(area, 'crm-lists', 'error',
      'Зник прапорець збою в списках CRМонтаж',
      ['Відсутність звʼязку знову виглядатиме як «монтажів не знайдено».', FIX], { tab: 'crmontage' }));
  } else {
    out.checked.push({ area: area, sub: 'crm-lists', label: 'Збій мережі ≠ «записів немає»', detail: 'монтажі й постачальники' });
  }

  // 3б. Підбірка мусить памʼятати, з якої версії прайсу її ціни.
  if (typeof cartPriceVersion !== 'function' || typeof cartIsStale !== 'function') {
    out.issues.push(diagIssue(area, 'cart-version', 'error',
      'Підбірка більше не памʼятає версію прайсу',
      ['Збережені ціни знову показуватимуться як поточні без жодної позначки.', FIX], { tab: 'catalog' }));
  } else {
    out.checked.push({ area: area, sub: 'cart-version', label: 'Підбірка знає свою версію прайсу',
      detail: cartIsStale() ? 'зараз позначена як застаріла' : 'ціни з поточного прайсу' });
  }

  // 3в. Ціни після входу мусять братись звідти ж, звідки на старті (опублікований прайс).
  if (typeof reloadPriceAfterAccessGranted === 'function' &&
      !/loadPublishedPrice/.test(String(reloadPriceAfterAccessGranted))) {
    out.issues.push(diagIssue(area, 'access-price', 'error',
      'Після входу прайс знову береться зі старого Excel',
      ['Телефон качатиме 10 МБ, а ціни можуть розійтися з рештою застосунку.',
       'Крім того, публічний бакет не можна буде закрити.', FIX], { tab: 'cabinet' }));
  } else if (typeof reloadPriceAfterAccessGranted === 'function') {
    out.checked.push({ area: area, sub: 'access-price', label: 'Після входу — опублікований прайс', detail: 'без завантаження Excel' });
  }

  /* 3г. Жодна картинка не повинна мати порожній src (2026-10-19).
     Порожній src="" браузер трактує як адресу поточної сторінки: він качає HTML
     застосунку як зображення, отримує ERR_FAILED і засмічує консоль. Саме це й
     ховало від нас інші помилки — у консолі завжди щось червоніло. Перевірка
     дешева (один запит до DOM) і ловить це одразу, у кого б воно не зʼявилось. */
  try {
    const emptySrc = Array.from(document.querySelectorAll('img'))
      .filter(i => i.hasAttribute('src') && !i.getAttribute('src').trim());
    if (emptySrc.length) {
      out.issues.push(diagIssue(area, 'empty-img', 'warning',
        'Є картинки з порожнім src (' + emptySrc.length + ')',
        ['Браузер качає сторінку застосунку як зображення: зайвий запит і помилка в консолі.',
         'Прибрати src із розмітки, а в коді — removeAttribute замість порожнього рядка.',
         emptySrc.map(i => i.id || i.className || 'без імені').slice(0, 5).join(', ')], null));
    } else {
      out.checked.push({ area: area, sub: 'empty-img', label: 'Немає картинок із порожнім src', detail: 'перевірено ' + document.querySelectorAll('img').length });
    }
  } catch (e) { /* DOM недоступний — не привід ламати перевірку */ }

  // 4. Характеристики: помилка не повинна лишатись у кеші як порожній результат.
  if (typeof psRetrySpecs !== 'function') {
    out.issues.push(diagIssue(area, 'specs-retry', 'error',
      'Зникла кнопка повтору для характеристик',
      ['Після збою мережі картка показуватиме «характеристик немає» до перезапуску.', FIX], { tab: 'catalog' }));
  } else {
    out.checked.push({ area: area, sub: 'specs-retry', label: 'Характеристики можна перезавантажити', detail: 'кнопка «Спробувати ще раз»' });
  }
  return out;
}

const DIAG_CHECKS = [
  { id: 'modules', label: 'Модулі застосунку', auto: true, run: ctx => diagCheckModules(ctx) },
  { id: 'specs', label: 'Характеристики товарів', run: ctx => diagCheckSpecs(ctx) },
  { id: 'search', label: 'Пошук по каталогу', auto: true, run: ctx => diagCheckSearch(ctx) },
  { id: 'groups', label: 'Групи прайсу', auto: true, run: ctx => diagCheckGroups(ctx) },
  { id: 'header', label: 'Шапка застосунку', run: ctx => diagCheckHeader(ctx) },
  { id: 'excel', label: 'Ціни й маркування = Excel', auto: true, run: ctx => diagCheckExcel(ctx) },
  { id: 'site-links', label: 'Таблиця посилань на сайт', auto: true, run: ctx => diagCheckSiteLinks(ctx) },
  { id: 'files', label: 'Зображення та файли застосунку', run: ctx => diagCheckFiles(ctx) },
  { id: 'series-images', label: 'Фото серій з Excel', run: ctx => diagCheckSeriesImages(ctx) },
  { id: 'roles', label: 'Ролі та доступи', run: ctx => diagCheckRoles(ctx) },
  { id: 'rates', label: 'Курси валют', run: ctx => diagCheckRates(ctx) },
  { id: 'push', label: 'Сповіщення (push)', run: ctx => diagCheckPush(ctx) },
  { id: 'price-publish', label: 'Публікація прайсу', run: ctx => diagCheckPricePublish(ctx) },
  { id: 'resilience', label: 'Поведінка при збоях', auto: true, run: ctx => diagCheckResilience(ctx) },
  { id: 'build', label: 'Версія застосунку', run: ctx => diagCheckBuild(ctx) },
  { id: 'site-live', label: 'Картки на сайті (сервер)', run: ctx => diagCheckSiteLive(ctx) }
];

/* Унікальність у БД — (version, tile_label, brand, kind): дві проблеми одного типу в одному підрозділі
   затерли б одна одну. Тому перед відправкою зливаємо їх в один запис: заголовки через « · », а деталі
   кожної — під своїм рядком «▸ заголовок». «Куди веде» береться від першої. */
function diagMergeIssues(issues) {
  const groups = new Map();
  issues.forEach(i => {
    const k = i.tile + '\u0001' + i.brand + '\u0001' + i.kind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const out = [];
  groups.forEach(arr => {
    if (arr.length === 1) { out.push(arr[0]); return; }
    const parsed = arr.map(i => diagParseMessage(i.message));
    const lines = [];
    parsed.forEach(p => { lines.push('▸ ' + p.title); p.lines.forEach(l => lines.push(l)); });
    const target = (parsed.find(p => p.target) || {}).target || null;
    let msg = parsed.map(p => p.title).join(' · ') + '\n' + lines.join('\n');
    if (target) msg += '\n@@' + JSON.stringify(target);
    out.push({ tile: arr[0].tile, brand: arr[0].brand, kind: arr[0].kind, message: msg });
  });
  return out;
}
async function diagReport(issues, checked, version) {
  try {
    const v = String(version != null ? version : '');
    const keys = new Set(checked.map(c => c.area + '\u0001' + c.sub));
    // спершу "гасимо" все по перевірених ключах, потім заново піднімаємо те, що знайдено зараз
    await Promise.all(Array.from(keys).map(k => {
      const p = k.split('\u0001');
      return sb.rpc('resolve_price_issue_if_ok', { p_tile_label: p[0], p_brand: p[1] });
    }));
    for (const it of issues) {
      await sb.rpc('report_price_issue', { p_version: v, p_tile_label: it.tile, p_brand: it.brand, p_kind: it.kind, p_message: it.message });
    }
  } catch (e) {
    // тиха відмова: самодіагностика ніколи не заважає роботі застосунку
  }
}
async function runDiagnostics(opts) {
  const ctx = { wb: opts.wb || null, data: opts.data || sheetsData, manual: !!opts.manual, version: opts.version != null ? opts.version : priceVersion };
  const issues = [], checked = [];
  /* Скільки перевірок реально виконається — потрібне смужці ходу в Кабінеті:
     у тихому (автоматичному) прогоні працюють лише ті, що з auto, і писати
     «3 з 14», коли їх насправді чотири, означало б брехати. */
  const plan = DIAG_CHECKS.filter(c => ctx.manual || c.auto);
  let idx = 0;
  for (const chk of plan) {
    if (opts.onProgress) opts.onProgress(chk.label, idx++, plan.length);
    try {
      const r = await chk.run(ctx);
      issues.push.apply(issues, r.issues);
      checked.push.apply(checked, r.checked);
    } catch (e) {
      issues.push(diagIssue('Самодіагностика', chk.id, 'error', 'Сама перевірка «' + chk.label + '» завершилась помилкою: ' + (e && e.message ? e.message : e), []));
      checked.push({ area: 'Самодіагностика', sub: chk.id, label: chk.label, detail: 'збій перевірки' });
    }
  }
  const merged = diagMergeIssues(issues);
  await diagReport(merged, checked, ctx.version);
  if (ctx.manual) lastDiagRun = { at: Date.now(), checked: checked, issues: merged };
  return { issues: merged, checked: checked };
}

/* Останній текст статусу прайсу. Потрібен окремо, бо на ГОЛОВНІЙ він більше не
   живе у власному рядку: за проханням користувача (2026-09-21) усі написи під
   курсами зведені в ОДИН рядок, і статус малюється всередині нього (renderRateRow).
   На внутрішніх екранах усе лишилось як було — свій рядок .status-row. */
let catalogStatusText = '';
/* quiet = «це звичайний щоденний стан» («Прайс від 11.09.2026»). Такий напис —
   службова довідка, і з 2026-10-12 його бачать лише адміністратори (макет власника:
   системні підписи — лише адмінові та суперадмінові).
   НЕтихі стани («Завантаження…», «Немає підключення», «щойно оновлено») показуємо
   всім: без них дилер із порожнім каталогом не мав би пояснення, що відбувається. */
let catalogStatusQuiet = false;
/* Малює статус там, де для нього місце на ПОТОЧНОМУ екрані. Винесено окремо від
   setCatalogStatus навмисно: статус приходить один раз (коли завантажився прайс, тобто
   зазвичай ще на головній), а показувати його треба й після переходу в категорію.
   Перша версія цього не враховувала — на головній рядок ховався, а при вході в
   категорію його ніхто не повертав, і «Прайс від 11.09.2026» зникав з усіх внутрішніх
   екранів. Тому renderCatalogView() викликає цю функцію при кожній зміні екрана. */
function applyCatalogStatusUi() {
  const row = document.getElementById('status-row');
  const el = document.getElementById('status-text');
  if (!row || !el) return;
  /* З 2026-10-12 курси (а з ними й службовий рядок) стоять у шапці на ВСІЙ вкладці
     «Каталог», тож і статус прайсу йде туди ж — окремого .status-row у розділі
     більше не потрібно. Поза каталогом (екран без доступу) усе як було. */
  const onCatalog = currentTab === 'catalog';
  if (onCatalog) { row.style.display = 'none'; renderRateRow(); return; }
  if (!catalogStatusText) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  el.textContent = catalogStatusText;
}
function setCatalogStatus(text, quiet) {
  catalogStatusText = text || '';
  catalogStatusQuiet = !!quiet;
  applyCatalogStatusUi();
}

