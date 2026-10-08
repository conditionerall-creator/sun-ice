/* Sun-ice — Сумісність блоків MHI, коди помилок MHI
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Сумісність блоків MHI (розділ "Інфо", тільки для адмінів) ----------
   На відміну від видаленої раніше версії — тут НІЯКОГО розбору/зіставлення маркувань.
   Дані data/mhi-compat-tables.json — це просто вивантажені один-в-один таблиці з
   дилерських xlsx MHI (кожна колонка/рядок прайсу лишається такою, як у файлі), а
   інтерфейс — таблиця із закріпленими шапкою і першою колонкою (як "заморозка областей"
   в Excel), користувач сам гортає і дивиться потрібний перетин. Дані завантажуються
   (fetch) лише коли адмін відкриває цей розділ, на старт застосунку не впливають. */
function cleanCompatLabel(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

/* Переклад — лише текст, який реально читає людина (назви розділів, розгорнуті описи
   рядків "Compatibility for PAC", значення Yes/No/N/A, примітки виробника). Самі коди
   моделей (SRK…, RC-E3 тощо) — НЕ чіпаємо, це точні позначення з документації MHI, не
   слова. */
const COMPAT_GROUP_UA = {
  'Wired Remote Controller': 'Проводовий пульт керування',
  'Outdoor unit': 'Зовнішній блок',
  'Compatibility for PAC': 'Сумісність для PAC'
};
function translateCompatGroup(s) {
  const clean = cleanCompatLabel(s);
  return COMPAT_GROUP_UA[clean] || clean;
}
const COMPAT_CODE_UA = {
  'Plural use (twin, triple, double-twin) (same model, same capacity)':
    'Використання кількох блоків (twin, triple, double-twin) (однакова модель, однакова потужність)',
  'V-multi use (different model, different capacity )':
    'Використання V-multi (різна модель, різна потужність)',
  'SC-BIKN-E necessity (For connecting with RC-E3, E4, E5, RC-EX1)':
    'Потреба в SC-BIKN-E (для підключення з RC-E3, E4, E5, RC-EX1)',
  'SC-BIKN2-E necessity (For connecting with RC-E3, E4, E5, RC-EX1,EX1A,EX3,EX3A, EX3D, ES1)':
    'Потреба в SC-BIKN2-E (для підключення з RC-E3, E4, E5, RC-EX1, EX1A, EX3, EX3A, EX3D, ES1)',
  'SC-BIKN2-BL necessity (For connecting with RC-E3, E4, E5, RC-EX1)':
    'Потреба в SC-BIKN2-BL (для підключення з RC-E3, E4, E5, RC-EX1)',
  'SC-BIKN2-BL necessity (For connecting with RC-E3, E4, E5, RC-EX1,EX1A,EX3,EX3A, EX3D, ES1)':
    'Потреба в SC-BIKN2-BL (для підключення з RC-E3, E4, E5, RC-EX1, EX1A, EX3, EX3A, EX3D, ES1)'
};
function translateCompatCode(s) {
  const clean = cleanCompatLabel(s);
  return COMPAT_CODE_UA[clean] || clean;
}
const COMPAT_YESNO_UA = { 'Yes': 'Так', 'No': 'Ні', 'N/A': 'Н/Д' };
function translateCompatCell(v) {
  const s = cleanCompatLabel(v);
  const m = s.match(/^(Yes|No|N\/A)\b(.*)$/);
  return m ? COMPAT_YESNO_UA[m[1]] + m[2] : s;
}
const COMPAT_NOTES_UA = {
  '- Mixing old and new model indoor units in one system is prohibited. (Twin, Triple, Double twin, V-multi)':
    '- Змішувати старі та нові моделі внутрішніх блоків в одній системі заборонено. (Twin, Triple, Double twin, V-multi)',
  '- Capacity must be coincident between IU and OU.':
    '- Потужність внутрішнього (IU) і зовнішнього (OU) блоків повинна збігатися.',
  '*1： SC-BIKN-E is necessary for the use of wired remote controller.':
    '*1: для використання проводового пульта керування необхідний SC-BIKN-E.',
  '*2: Only SRK100ZR-S will be connectable with FDC200VSA. SC-BIKN-E is necessary for the use of wired remote controller.':
    '*2: з FDC200VSA можна з’єднати лише SRK100ZR-S. Для використання проводового пульта керування необхідний SC-BIKN-E.',
  '*3: No technical data. It may have risk of dew drop, or insufficient cooling/heating.':
    '*3: немає технічних даних. Можливий ризик випадання конденсату або недостатнього охолодження/обігріву.',
  '*R1 : Some new functions by RC-EX3 is not available.':
    '*R1: деякі нові функції RC-EX3 недоступні.',
  '*R2 : Some new functions by RC-EX3A or RC-ES1 (App ver 1.0.0) is not available.':
    '*R2: деякі нові функції RC-EX3A або RC-ES1 (версія застосунку 1.0.0) недоступні.',
  '*R3 : Draft prevention panel, motion sensor cannot be operated.':
    '*R3: панель захисту від протягів і датчик руху не можуть керуватись.',
  '*R4 : RC-EXZ3A can be used with only FDUM/FDU**VH/A model':
    '*R4: RC-EXZ3A можна використовувати лише з моделями FDUM/FDU**VH/A.',
  'FDUM/FDU**VH/A model can be used with below out door unit.':
    'Моделі FDUM/FDU**VH/A можна використовувати із зовнішніми блоками, переліченими нижче:',
  '*R5 : Some function for refrigerant leakage is not available.':
    '*R5: деякі функції для витоку хладагенту недоступні.',
  '*R6 : (For WF MODELS) compatabilityNot official but technically compatible':
    '*R6: для моделей WF сумісність неофіційна, але технічно можлива.',
  '*Note:For SRK71ZR-WF AND SRK100ZR-WF Wifi enabled models it is needed to':
    '*Примітка: для моделей SRK71ZR-WF і SRK100ZR-WF з увімкненим Wi-Fi потрібно відключити',
  'take off the Wifi connection to connect the wired remote controller.':
    'Wi-Fi-з’єднання, щоб підключити проводовий пульт керування.',
  '*R7 : Some new functions by RC-EX3D is not available.':
    '*R7: деякі нові функції RC-EX3D недоступні.'
};
function translateCompatNote(s) { return COMPAT_NOTES_UA[s] || s; }

async function loadMhiCompatTables() {
  if (mhiCompatData && mhiCompatData !== 'error') return mhiCompatData;
  mhiCompatData = 'loading';
  try {
    const resp = await fetch('data/mhi-compat-tables.json');
    if (!resp.ok) throw new Error('http ' + resp.status);
    mhiCompatData = await resp.json();
  } catch (e) {
    mhiCompatData = 'error';
  }
  return mhiCompatData;
}

async function renderMhiCompatFolders() {
  const title = document.getElementById('title');
  // Захист не лише на рівні пункту меню (renderInfoTab ховає його для звичайних
  // користувачів), а й тут — щоб пряме посилання-хеш на цей розділ теж нікуди не пускало.
  const role = await getCurrentProfileRole();
  if (role !== 'regional_admin' && role !== 'super_admin') {
    infoSection = null;
    history.replaceState({ tab: 'info', section: null, brand: null }, '', '#info');
    renderInfoTab();
    return;
  }

  if (!mhiCompatFolder) {
    title.textContent = 'Сумісність блоків MHI';
    renderInfoMenu(MHI_COMPAT_FOLDERS, (id) => {
      mhiCompatFolder = id;
      mhiCompatSheet = 'rac';
      history.pushState({ tab: 'info', section: 'mhi-compat', compatFolder: id, compatSheet: 'rac' }, '', '#info-mhi-compat-' + id);
      renderInfoTab();
    });
    return;
  }

  const folder = MHI_COMPAT_FOLDERS.find(f => f.id === mhiCompatFolder);
  title.textContent = folder ? folder.label : 'Сумісність блоків MHI';
  await renderMhiCompatTables();
}

function compatCellClass(v) {
  const s = cleanCompatLabel(v);
  if (!s || s === '-') return 'compat-cell compat-cell-no';
  if (s.charAt(0) === '◎') return 'compat-cell compat-cell-yes';
  if (s.charAt(0) === '〇') return 'compat-cell compat-cell-maybe';
  if (s.charAt(0) === 'X' || s.charAt(0) === '×') return 'compat-cell compat-cell-no2';
  return 'compat-cell';
}

const COMPAT_LEGEND_HTML =
  '<span class="compat-cell-yes">◎</span> — офіційно сумісно&nbsp;&nbsp;·&nbsp;&nbsp;' +
  '<span class="compat-cell-maybe">〇</span> — технічно сумісно (неофіційна комбінація)&nbsp;&nbsp;·&nbsp;&nbsp;' +
  '<span class="compat-cell-no2">X</span> / <span class="compat-cell-no">−</span> — несумісно або немає даних';

function renderCompatNotesHtml(notes) {
  if (!notes || !notes.length) return '';
  return `
    <div class="compat-notes-wrap">
      <button type="button" class="compat-notes-toggle" data-compat-notes-toggle>Примітки виробника (${notes.length}) ▾</button>
      <div class="compat-notes-body" data-compat-notes-body hidden>${notes.map(n => `<div>${escapeHtml(translateCompatNote(n))}</div>`).join('')}</div>
    </div>`;
}

/* Проста таблиця (один рядок шапки-колонок) — використовується для RAC і для FD.
   opts.rowGroupOf(row) повертає текст групи-розділювача для рядка (або '' — без групи). */
function renderSimpleCompatTableHtml(table, opts) {
  opts = opts || {};
  const colsHtml = table.cols.map((c, i) => `<th class="compat-colhead" data-col-idx="${i}">${escapeHtml(cleanCompatLabel(c))}</th>`).join('');
  let lastGroup = null;
  const rowsHtml = table.rows.map(r => {
    const groupLabel = opts.rowGroupOf ? cleanCompatLabel(opts.rowGroupOf(r)) : '';
    let groupHtml = '';
    if (groupLabel && groupLabel !== lastGroup) {
      lastGroup = groupLabel;
      groupHtml = `<tr class="compat-group-row"><td class="compat-group-cell" colspan="${table.cols.length + 1}">${escapeHtml(groupLabel)}</td></tr>`;
    } else if (!groupLabel) {
      lastGroup = null;
    }
    const cellsHtml = r.cells.map(v => `<td class="${compatCellClass(v)}">${escapeHtml(translateCompatCell(v))}</td>`).join('');
    return groupHtml + `<tr><td class="compat-rowhead">${escapeHtml(translateCompatCode(r.code))}</td>${cellsHtml}</tr>`;
  }).join('');
  return `
    <div class="compat-toolbar">
      <input type="text" class="compat-filter-input" placeholder="Пошук за маркуванням…">
      <button type="button" class="compat-clear-btn" data-compat-clear>Очистити</button>
    </div>
    <div class="compat-legend">${COMPAT_LEGEND_HTML}</div>
    <div class="compat-table-wrap">
      <table class="compat-table">
        <thead><tr><th class="compat-corner">Маркування</th>${colsHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${renderCompatNotesHtml(table.notes)}`;
}

/* RAC MULTI — двоярусна шапка колонок: верхній ряд — серія внутрішнього блока (з
   colspan на суміжні стовпці однієї серії), нижній — конкретний типорозмір. */
function renderMultiCompatTableHtml(table) {
  const cols = table.cols;
  const groupRuns = [];
  cols.forEach(c => {
    const last = groupRuns[groupRuns.length - 1];
    if (last && last.group === c.group) last.span++;
    else groupRuns.push({ group: c.group, span: 1, start: groupRuns.length ? groupRuns[groupRuns.length - 1].start + groupRuns[groupRuns.length - 1].span : 0 });
  });
  const groupRowHtml = groupRuns.map(g => `<th class="compat-colhead-group" colspan="${g.span}" data-col-start="${g.start}" data-col-span="${g.span}">${escapeHtml(cleanCompatLabel(g.group))}</th>`).join('');
  const sizeRowHtml = cols.map((c, i) => `<th class="compat-colhead-size" data-col-idx="${i}">${escapeHtml(cleanCompatLabel(c.size))}</th>`).join('');
  const rowsHtml = table.rows.map(r => {
    const cellsHtml = r.cells.map(v => `<td class="${compatCellClass(v)}">${escapeHtml(translateCompatCell(v))}</td>`).join('');
    return `<tr><td class="compat-rowhead">${escapeHtml(cleanCompatLabel(r.code))}</td>${cellsHtml}</tr>`;
  }).join('');
  return `
    <div class="compat-toolbar">
      <input type="text" class="compat-filter-input" placeholder="Пошук за маркуванням…">
      <button type="button" class="compat-clear-btn" data-compat-clear>Очистити</button>
    </div>
    <div class="compat-legend">${COMPAT_LEGEND_HTML}</div>
    <div class="compat-table-wrap compat-table-wrap-multi">
      <table class="compat-table compat-table-multi">
        <thead>
          <tr><th class="compat-corner" rowspan="2">Зовнішній блок</th>${groupRowHtml}</tr>
          <tr>${sizeRowHtml}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

/* "Виділити рядок/стовпчик" — кнопка у спливаючому вікні повної назви (openSeriesInfo).
   Рядок і стовпчик підсвічуються НЕЗАЛЕЖНО один від одного (виділення другої осі не
   скидає першу) — саме так користувач бачить перетин двох підсвічених смуг як "відповідь",
   не гортаючи весь час туди-сюди між закріпленими шапкою і колонкою. */
function highlightCompatRow(main, rowheadEl) {
  main.querySelectorAll('.compat-row-highlight').forEach(el => el.classList.remove('compat-row-highlight'));
  const tr = rowheadEl.closest('tr');
  if (!tr) return;
  Array.from(tr.children).forEach(td => td.classList.add('compat-row-highlight'));
}
function highlightCompatCol(main, startIdx, span) {
  const wrap = main.querySelector('.compat-table-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.compat-col-highlight').forEach(el => el.classList.remove('compat-col-highlight'));
  for (let i = startIdx; i < startIdx + span; i++) {
    wrap.querySelectorAll(`[data-col-idx="${i}"]`).forEach(el => el.classList.add('compat-col-highlight'));
    wrap.querySelectorAll('tbody tr:not(.compat-group-row)').forEach(tr => {
      const td = tr.children[i + 1];
      if (td) td.classList.add('compat-col-highlight');
    });
  }
}
function clearCompatHighlights(main) {
  main.querySelectorAll('.compat-row-highlight, .compat-col-highlight').forEach(el => {
    el.classList.remove('compat-row-highlight', 'compat-col-highlight');
  });
}

/* Пошук — навмисно НЕ розбір/зіставлення маркувань (саме це багатило видалену версію
   фічі), а звичайний пошук підрядка по тексту заголовків: підсвічує всі рядки/колонки,
   де знайдено збіг, і прокручує таблицю до першого з них. */
function attachCompatTableHandlers(main) {
  main.querySelectorAll('.compat-filter-input').forEach(input => {
    input.addEventListener('input', () => {
      const wrap = main.querySelector('.compat-table-wrap');
      if (!wrap) return;
      const q = norm(input.value.trim());
      wrap.querySelectorAll('.compat-match').forEach(el => el.classList.remove('compat-match'));
      if (!q) return;
      let firstRow = null, firstCol = null;
      wrap.querySelectorAll('.compat-rowhead').forEach(el => {
        if (norm(el.textContent).includes(q)) { el.classList.add('compat-match'); if (!firstRow) firstRow = el; }
      });
      wrap.querySelectorAll('.compat-colhead, .compat-colhead-group, .compat-colhead-size').forEach(el => {
        if (norm(el.textContent).includes(q)) { el.classList.add('compat-match'); if (!firstCol) firstCol = el; }
      });
      // Віднімаємо реальний розмір закріплених шапки/першої колонки (не фіксоване число) —
      // інакше знайдений збіг ховається ПІД закріпленою панеллю замість того, щоб опинитись
      // одразу після неї.
      if (firstRow) {
        const totalHeadH = Array.from(wrap.querySelectorAll('thead tr')).reduce((sum, tr) => sum + tr.getBoundingClientRect().height, 0);
        wrap.scrollTop = Math.max(0, firstRow.offsetTop - totalHeadH - 6);
      }
      if (firstCol) {
        const rowheadW = wrap.querySelector('.compat-rowhead').getBoundingClientRect().width;
        wrap.scrollLeft = Math.max(0, firstCol.offsetLeft - rowheadW - 6);
      }
    });
  });
  main.querySelectorAll('[data-compat-notes-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      if (!body) return;
      body.hidden = !body.hidden;
    });
  });
  main.querySelectorAll('[data-compat-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      main.querySelectorAll('.compat-filter-input').forEach(input => { input.value = ''; });
      main.querySelectorAll('.compat-match').forEach(el => el.classList.remove('compat-match'));
      clearCompatHighlights(main);
    });
  });
  // Заголовки колонок і перша колонка обрізані (щоб таблиця лишалась компактною) — тап
  // показує повний текст у вже наявному спливаючому вікні "детальніше", з кнопкою
  // "Виділити", яка підсвічує весь рядок/стовпчик — щоб легше знайти перетин.
  main.querySelectorAll('.compat-rowhead').forEach(el => {
    el.addEventListener('click', () => {
      openSeriesInfo('Маркування', el.textContent.trim(), {
        actionLabel: 'Виділити рядок',
        onAction: () => highlightCompatRow(main, el)
      });
    });
  });
  main.querySelectorAll('.compat-colhead, .compat-colhead-size').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-col-idx'), 10);
      openSeriesInfo('Маркування', el.textContent.trim(), {
        actionLabel: 'Виділити стовпчик',
        onAction: () => highlightCompatCol(main, idx, 1)
      });
    });
  });
  main.querySelectorAll('.compat-colhead-group').forEach(el => {
    el.addEventListener('click', () => {
      const start = parseInt(el.getAttribute('data-col-start'), 10);
      const span = parseInt(el.getAttribute('data-col-span'), 10) || 1;
      openSeriesInfo('Маркування', el.textContent.trim(), {
        actionLabel: 'Виділити стовпчики',
        onAction: () => highlightCompatCol(main, start, span)
      });
    });
  });
}

async function renderMhiCompatTables() {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження таблиці…</div>';
  const data = await loadMhiCompatTables();
  if (data === 'error') {
    main.innerHTML = '<div class="empty">Не вдалося завантажити таблицю сумісності. Перевірте з’єднання і спробуйте ще раз.</div>';
    return;
  }

  if (mhiCompatFolder === 'semi') {
    main.innerHTML = renderSimpleCompatTableHtml(data.fd, {
      rowGroupOf: r => r.sub ? (translateCompatGroup(r.group) + ' — ' + r.sub) : translateCompatGroup(r.group)
    });
    attachCompatTableHandlers(main);
    return;
  }

  const sheets = [{ key: 'rac', label: 'RAC (спліт)' }, { key: 'racMulti', label: 'RAC MULTI' }];
  const toggleHtml = `<div class="brand-toggle">${sheets.map(s =>
    `<button type="button" class="brand-toggle-btn${mhiCompatSheet === s.key ? ' active' : ''}" data-compat-sheet="${s.key}">${escapeHtml(s.label)}</button>`
  ).join('')}</div>`;
  const bodyHtml = mhiCompatSheet === 'racMulti'
    ? renderMultiCompatTableHtml(data.racMulti)
    : renderSimpleCompatTableHtml(data.rac, { rowGroupOf: r => translateCompatGroup(r.family) });
  main.innerHTML = toggleHtml + bodyHtml;
  main.querySelectorAll('[data-compat-sheet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-compat-sheet');
      if (key === mhiCompatSheet) return;
      mhiCompatSheet = key;
      history.replaceState({ tab: 'info', section: 'mhi-compat', compatFolder: mhiCompatFolder, compatSheet: key }, '', '#info-mhi-compat-' + mhiCompatFolder + '-' + key);
      renderMhiCompatTables();
    });
  });
  attachCompatTableHandlers(main);
}

/* ---------- Коди помилок Mitsubishi Heavy Industries (розділ "Інфо") ----------
   Дані — в таблиці Supabase public.mhi_error_codes (файл mhi-error-codes-setup.sql),
   редагується напряму в Supabase Table Editor — код індекс.html чіпати не потрібно.
   Два способи пошуку: за комбінацією RUN/TIMER (це завжди побутові/мультиспліт — у
   напівпрому код показується напряму на пульті, миготіння там не задіяне) і за самим
   кодом (шукає одразу серед ВСІХ типів обладнання — вибір типу заздалегідь не потрібен,
   тип показується в самому результаті). Джерело (таблиця "Джерела" у наданому файлі)
   навмисно НЕ виводиться окремим текстом у формі — назва помилки й рекомендовані дії в
   базі вже узяті з неї; сама назва джерела показується дрібним текстом унизу картки
   результату. */
let mhiResults = [];       // масив знайдених записів із mhi_error_codes (0, 1 або 2 — якщо
                            // код збігається і в побутових, і в напівпромі одночасно)
let mhiResultState = null; // null | 'notfound' | 'needinput'

const MHI_BLINK_OPTIONS = [
  'Не блимає', '1', '2', '3', '4', '5', '6', '7', 'Постійно блимає', 'Постійно світиться'
];

function renderMhiErrorsScreen() {
  const main = document.getElementById('main');
  const optHtml = MHI_BLINK_OPTIONS.map(v =>
    `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
  ).join('');

  main.innerHTML = `
    <div class="mhi-block">
      <div class="mhi-block-title">Пошук за індикацією</div>
      <div class="mhi-hint">Для побутових та мультиспліт систем — за кількістю миготінь RUN і TIMER на внутрішньому блоці.</div>
      <div class="mhi-field">
        <label class="mhi-label"><span class="mhi-dot mhi-dot-run"></span>Кількість миготінь RUN</label>
        <select class="mhi-select" id="mhi-run-select">
          <option value="">— оберіть —</option>${optHtml}
        </select>
      </div>
      <div class="mhi-field">
        <label class="mhi-label"><span class="mhi-dot mhi-dot-timer"></span>Кількість миготінь TIMER</label>
        <select class="mhi-select" id="mhi-timer-select">
          <option value="">— оберіть —</option>${optHtml}
        </select>
      </div>
      <button type="button" class="mhi-search-btn" id="mhi-blink-search-btn">Показати помилку</button>
    </div>
    <div class="mhi-block">
      <div class="mhi-block-title">Пошук за кодом</div>
      <div class="mhi-field">
        <input type="text" class="mhi-code-input" id="mhi-code-input" placeholder="Наприклад: E39">
        <div class="mhi-hint">Введіть код так, як він показаний на пульті чи блоці — можна набрати лише цифри (наприклад «39»), літеру E додамо автоматично.</div>
      </div>
      <div class="mhi-btn-row">
        <button type="button" class="mhi-search-btn" id="mhi-code-search-btn">Знайти</button>
        <button type="button" class="mhi-clear-btn" id="mhi-clear-btn">Очистити</button>
      </div>
    </div>
    <div id="mhi-result-slot">${renderMhiResultsHtml()}</div>
  `;
  attachMhiErrorsHandlers();
}

function renderMhiResultsHtml() {
  if (mhiResultState === 'needinput') {
    return '<div class="mhi-result mhi-result-empty">Оберіть кількість миготінь для RUN і TIMER.</div>';
  }
  if (mhiResultState === 'notfound') {
    return '<div class="mhi-result mhi-result-empty">Код не знайдено. Перевірте правильність підрахунку миготінь або введений код і спробуйте ще раз.</div>';
  }
  if (!mhiResults || !mhiResults.length) return '';
  return mhiResults.map(renderOneMhiResultHtml).join('');
}

function renderOneMhiResultHtml(r) {
  const isSemi = r.equipment_type === 'semi';
  const equipLabel = isSemi ? 'Напівпром MHI' : 'Побутові та мультиспліт-системи MHI';
  // Тип обладнання заздалегідь не обирається (див. коментар вище), тому картка сама прямо
  // каже, до якого обладнання належить знайдена помилка — це головне уточнення користувача.
  const scopeNote = isSemi
    ? 'Ця помилка стосується лише напівпрому MHI.'
    : 'Ця помилка стосується лише побутових та мультиспліт систем MHI.';
  const checksHtml = String(r.actions || '')
    .split(';')
    .map(s => s.trim().replace(/\.+$/, ''))
    .filter(Boolean)
    .map(s => '<li>' + escapeHtml(s) + '.</li>')
    .join('');
  return `
    <div class="mhi-result">
      <div class="mhi-result-scope">${escapeHtml(scopeNote)}</div>
      <div class="mhi-result-code">${escapeHtml(r.code)}</div>
      <div class="mhi-result-name">${escapeHtml(r.name_uk)}</div>
      <div class="mhi-result-section-title">Рекомендовані дії</div>
      <ul class="mhi-result-checks">${checksHtml}</ul>
      <div class="mhi-result-section-title">Застосування</div>
      <div class="mhi-result-equip">${escapeHtml(equipLabel)}</div>
      ${r.source ? '<div class="mhi-result-source">Джерело: ' + escapeHtml(r.source) + '</div>' : ''}
    </div>`;
}

function attachMhiErrorsHandlers() {
  const blinkBtn = document.getElementById('mhi-blink-search-btn');
  if (blinkBtn) blinkBtn.addEventListener('click', searchMhiByBlink);
  const codeBtn = document.getElementById('mhi-code-search-btn');
  if (codeBtn) codeBtn.addEventListener('click', searchMhiByCode);
  const clearBtn = document.getElementById('mhi-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearMhiSearch);
  const codeInput = document.getElementById('mhi-code-input');
  if (codeInput) codeInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') searchMhiByCode(); });
}

function clearMhiSearch() {
  mhiResults = [];
  mhiResultState = null;
  renderMhiErrorsScreen();
}

async function searchMhiByBlink() {
  const runSelect = document.getElementById('mhi-run-select');
  const timerSelect = document.getElementById('mhi-timer-select');
  const runVal = runSelect ? runSelect.value : '';
  const timerVal = timerSelect ? timerSelect.value : '';
  const slot = document.getElementById('mhi-result-slot');
  if (!runVal || !timerVal) {
    mhiResults = [];
    mhiResultState = 'needinput';
    if (slot) slot.innerHTML = renderMhiResultsHtml();
    return;
  }
  if (slot) slot.innerHTML = '<div class="mhi-result-loading">Пошук…</div>';
  try {
    const { data, error } = await sb.from('mhi_error_codes').select('*')
      .eq('equipment_type', 'household')
      .eq('run_value', runVal)
      .eq('timer_value', timerVal)
      .limit(1);
    if (error) throw error;
    mhiResults = data || [];
    mhiResultState = mhiResults.length ? null : 'notfound';
  } catch (e) {
    if (slot) slot.innerHTML = '<div class="mhi-result mhi-result-empty">Помилка з’єднання. Спробуйте ще раз.</div>';
    return;
  }
  if (slot) slot.innerHTML = renderMhiResultsHtml();
}

function normalizeMhiCode(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (/^\d+$/.test(s)) s = 'E' + s;
  return s;
}

async function searchMhiByCode() {
  const input = document.getElementById('mhi-code-input');
  const code = normalizeMhiCode(input ? input.value : '');
  const slot = document.getElementById('mhi-result-slot');
  if (!code) {
    mhiResults = [];
    mhiResultState = null;
    if (slot) slot.innerHTML = '';
    return;
  }
  if (slot) slot.innerHTML = '<div class="mhi-result-loading">Пошук…</div>';
  try {
    // Тип обладнання заздалегідь не обирається — шукаємо код одразу серед усіх типів;
    // якщо один код є і в побутових, і в напівпромі (з різним значенням) — прийдуть обидва
    // записи, і кожен покаже своє "Ця помилка стосується лише ..." окремою карткою.
    const { data, error } = await sb.from('mhi_error_codes').select('*')
      .ilike('code', code);
    if (error) throw error;
    mhiResults = data || [];
    mhiResultState = mhiResults.length ? null : 'notfound';
  } catch (e) {
    if (slot) slot.innerHTML = '<div class="mhi-result mhi-result-empty">Помилка з’єднання. Спробуйте ще раз.</div>';
    return;
  }
  if (slot) slot.innerHTML = renderMhiResultsHtml();
}

