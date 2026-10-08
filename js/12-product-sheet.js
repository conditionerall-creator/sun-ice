/* Sun-ice — панель товару (П-9)
   Частина переробки інтерфейсу 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* Панель відкривається дотиком по ПОРОЖНЬОМУ місцю рядка прайсу. Дотик по самому
   маркуванню, як і раніше, веде на картку sun-ice.com.ua — рішення власника 2026-10-08.
   Сюди ж переїжджають кнопки, які раніше тіснились у рядку (П-10): розрахунок,
   «поділитися», наявність з 1С. У рядку лишається тільки «Додати». */

/* Характеристики беруться з data/specs-<розділ>.json — файли готує офлайн-скрипт
   claude/site-catalog/build_specs.py, бо сайт не віддає CORS. Вантажимо ЛИШЕ коли
   людина вперше відкрила панель у цьому розділі: на всі 286 карток вийшло б ~1.3 МБ,
   і класти це в стартове завантаження не можна. */
const SPECS_FILES = {
  split_gal: 'data/specs-split-gal.json?v=2026-10-08.1'
};
const specsCache = {};      // cfgKey -> { slug: {основні, додаткові} }
const specsLoading = {};    // cfgKey -> Promise

function loadSpecs(cfgKey) {
  if (specsCache[cfgKey]) return Promise.resolve(specsCache[cfgKey]);
  if (!SPECS_FILES[cfgKey]) return Promise.resolve(null);
  if (specsLoading[cfgKey]) return specsLoading[cfgKey];
  specsLoading[cfgKey] = fetch(SPECS_FILES[cfgKey])
    .then(r => r.ok ? r.json() : null)
    .then(j => { specsCache[cfgKey] = (j && j.specs) || {}; return specsCache[cfgKey]; })
    .catch(() => { specsCache[cfgKey] = {}; return specsCache[cfgKey]; });
  return specsLoading[cfgKey];
}

/* «Головні шість» — РІЗНІ за типом блока (рішення, записане в 01-РІШЕННЯ-ВЛАСНИКА):
   для настінного важить шум, для канального — напір, для касетного — розмір під стелею.
   Один список на все дав би зверху марні числа в половині розділів.
   Шукаємо за початком назви параметра, у порядку пріоритету; беремо перші 6, що є. */
const SPEC_PRIORITY_DEFAULT = [
  'Холодопродуктивн', 'Теплопродуктивн', 'Рекомендована площа',
  'Клас енергоефективності охолодження', 'Внутрішній блок, охолодження',
  'Розмір внутрішнього блоку', 'Тип фреону'
];

function pickKeySpecs(spec) {
  const flat = [];
  (spec['основні'] || []).forEach(g => g.rows.forEach(r => flat.push(r)));
  const out = [];
  SPEC_PRIORITY_DEFAULT.forEach(pat => {
    if (out.length >= 6) return;
    const hit = flat.find(r => r[0].indexOf(pat) === 0 && !out.includes(r));
    if (hit) out.push(hit);
  });
  return out;
}

function specsTotalCount(spec) {
  let n = 0;
  ['основні', 'додаткові'].forEach(p => (spec[p] || []).forEach(g => { n += g.rows.length; }));
  return n;
}

function specRowsHtml(rows) {
  return rows.map(r =>
    `<div class="ps-spec-row"><span class="ps-spec-name">${escapeHtml(r[0])}</span><span class="ps-spec-val">${escapeHtml(r[1])}</span></div>`
  ).join('');
}

/* Варіант А (обраний власником): головні числа одразу, повний список — на дотик,
   усередині аккордеон по тих самих групах, які робить сам сайт. */
function specsHtml(spec) {
  if (!spec) return '';
  const key = pickKeySpecs(spec);
  const total = specsTotalCount(spec);
  const groups = [];
  ['основні', 'додаткові'].forEach(part => {
    (spec[part] || []).forEach(g => {
      if (!g.rows.length) return;
      const label = g.g || (part === 'основні' ? 'Основні характеристики' : 'Додаткові характеристики');
      groups.push(`
        <details class="ps-group">
          <summary>${escapeHtml(label)}<span class="ps-group-n">${g.rows.length}</span></summary>
          ${specRowsHtml(g.rows)}
        </details>`);
    });
  });
  return `
    <div class="ps-section">
      <div class="ps-section-title">Характеристики</div>
      ${key.length ? specRowsHtml(key) : ''}
      <details class="ps-all">
        <summary>Показати всі ${total}</summary>
        <div class="ps-all-body">${groups.join('')}</div>
      </details>
    </div>`;
}

/* Знаходить товар у вже розібраному прайсі за маркуванням — панель відкривають із
   рядка, а рядок знає лише свою модель. */
function findPriceItem(cfgKey, model) {
  const list = (sheetsData && sheetsData[cfgKey]) || [];
  return list.find(it => it.model === model) || null;
}

function openProductSheet(cfgKey, model, tileLabel) {
  const it = findPriceItem(cfgKey, model);
  if (!it) return;
  document.getElementById('product-sheet-title').textContent = it.model;
  const body = document.getElementById('product-sheet-body');

  const locked = !hasFullAccess;
  const priceHtml = locked
    ? `<div class="ps-price ps-price-locked">${ic('lock', '—')}<span>Ціна доступна після входу</span></div>`
    : `<div class="ps-price">${escapeHtml(formatListPrice(it))}</div>`;

  const siteUrl = (typeof siteLinks === 'object' && siteLinks && siteLinks.links && siteLinks.links[cfgKey])
    ? siteLinks.links[cfgKey][siteLinkKey(it)] : null;
  const siteHtml = siteUrl
    ? `<a class="ps-site-link" href="${escapeHtml((siteLinks.base || 'https://sun-ice.com.ua/') + siteUrl)}" target="_blank" rel="noopener">Відкрити картку на сайті ↗</a>`
    : '';

  /* Кнопки, що переїхали з рядка (П-10). Кольори різні свідомо: головна дія —
     акцентна, довідкові — спокійні, щоб у панелі одразу було видно головне. */
  const actions = locked ? '' : `
    <div class="ps-actions">
      <button type="button" class="ps-btn ps-btn-main" data-ps-act="calc">${ic('calculator', '')}<span>Розрахувати</span></button>
      <button type="button" class="ps-btn" data-ps-act="share">${ic('share-2', '')}<span>Поділитися</span></button>
      ${window.Stock ? `<button type="button" class="ps-btn" data-ps-act="stock">${ic('factory', '')}<span>Наявність</span></button>` : ''}
    </div>`;

  body.innerHTML = priceHtml + actions + '<div id="ps-specs"><div class="ps-loading">Завантажуємо характеристики…</div></div>' + siteHtml;
  body.setAttribute('data-ps-cfg', cfgKey);
  body.setAttribute('data-ps-model', model);
  body.setAttribute('data-ps-tile', tileLabel || '');
  document.getElementById('product-sheet-overlay').classList.add('show');
  history.pushState({ tab: currentTab, tile: activeTile, sheet: 'product' }, '', location.hash);

  const holder = document.getElementById('ps-specs');
  if (!SPECS_FILES[cfgKey]) {
    holder.innerHTML = '<div class="ps-empty">Характеристики для цього розділу ще не зібрані.</div>';
    return;
  }
  loadSpecs(cfgKey).then(specs => {
    if (!document.getElementById('product-sheet-overlay').classList.contains('show')) return;
    if (body.getAttribute('data-ps-model') !== model) return; // встигли відкрити інший товар
    const spec = specs && siteUrl ? specs[siteUrl] : null;
    holder.innerHTML = spec
      ? specsHtml(spec)
      : '<div class="ps-empty">Для цієї моделі характеристик на сайті не знайшлось.</div>';
  });
}

function closeProductSheet() {
  document.getElementById('product-sheet-overlay').classList.remove('show');
}
