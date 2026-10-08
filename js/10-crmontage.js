/* Sun-ice — CRМонтаж: список, .ics, друк/Excel, постачальники
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- CRМонтаж ----------
   Стаціонарний розділ для будь-якої ролі й будь-якого залогіненого користувача — раніше
   був окремою роллю "installer" (+ фіча "напарник"), обидві прибрані: розмежування за
   роллю не мало сенсу для інструменту, яким кожен веде свій особистий список монтажів.
   Єдина умова доступу — активна сесія (перевіряється тут напряму, а не лише переходом за
   вкладкою нав-бару, щоб прямий перехід за хешем #installer теж не пропускав гостя). Без
   сесії — перекидає на Кабінет, щоб увійти/зареєструватись. */
async function renderInstallerTab() {
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('title').textContent = 'CRМонтаж';
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження...</div>';

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;

  if (!session) {
    history.replaceState({ tab: 'cabinet' }, '', '#cabinet');
    switchTab('cabinet', false);
    renderCurrentTab();
    return;
  }

  taskQuickFilter = 'all';
  main.innerHTML = `
    <button type="button" class="primary-btn no-print" data-task-action="add" style="margin-bottom:12px;">+ Новий монтаж</button>
    <div class="task-toolbar-row no-print">
      <button type="button" data-task-action="print">${ic('printer', '🖨', 'ic-lead')}Друк</button>
      <button type="button" data-task-action="export-xlsx">${ic('file-spreadsheet', '📊', 'ic-lead')}Excel</button>
      <button type="button" data-task-action="suppliers">${ic('factory', '🏭', 'ic-lead')}Постачальники</button>
    </div>
    <div class="admin-filters no-print">
      <div class="admin-search"><input type="text" id="task-search" placeholder="Пошук за адресою чи клієнтом"></div>
      <div class="brand-toggle toggle-3way" id="task-quick-filter">
        <button type="button" class="brand-toggle-btn active" data-quick="all">Усі</button>
        <button type="button" class="brand-toggle-btn" data-quick="today">Сьогодні</button>
        <button type="button" class="brand-toggle-btn" data-quick="week">Цей тиждень</button>
      </div>
      <div class="admin-filter-row">
        <div><select id="task-status-filter">
          <option value="">Усі статуси</option>
          ${Object.keys(TASK_STATUS_LABELS).map(s => `<option value="${s}">${escapeHtml(TASK_STATUS_LABELS[s])}</option>`).join('')}
        </select></div>
        <div><select id="task-equipment-filter">
          <option value="">Усі види робіт</option>
          ${taskEquipmentOptionsHtml(null)}
        </select></div>
      </div>
    </div>
    <div id="installer-tasks-list"><div class="empty">Завантаження...</div></div>
  `;

  main.querySelectorAll('#task-quick-filter .brand-toggle-btn').forEach(qbtn => {
    qbtn.addEventListener('click', () => {
      taskQuickFilter = qbtn.getAttribute('data-quick');
      main.querySelectorAll('#task-quick-filter .brand-toggle-btn').forEach(b => b.classList.toggle('active', b === qbtn));
      renderInstallerTaskList();
    });
  });
  document.getElementById('task-search').addEventListener('input', renderInstallerTaskList);
  document.getElementById('task-status-filter').addEventListener('change', renderInstallerTaskList);
  document.getElementById('task-equipment-filter').addEventListener('change', renderInstallerTaskList);

  await loadInstallerTasks();
  renderInstallerTaskList();
}

/* ---------- CRМонтаж: список монтажів ----------
   Персональна таблиця public.installer_tasks, RLS обмежує кожного користувача лише
   власними рядками (installer_id = auth.uid()) — особистий список, не частина адмінки,
   доступний однаково будь-якій ролі. */
/* Було "тип обладнання" (Спліт-системи/Мульти спліт-системи/...) — на прохання
   користувача замінено на вид робіт (2026-09-10, CHANGELOG). Значення зберігаються
   в тій самій колонці equipment_type (без нової міграції), старі рядки з попередніми
   значеннями просто не збігаються з новим списком — при редагуванні підставиться
   перший пункт нового списку. */
const TASK_EQUIPMENT_TYPES = ['Монтаж', 'Демонтаж', 'Закладка', 'Навіска', 'Чистка', 'Сервіс'];
const TASK_STATUS_LABELS = { planned: 'Заплановано', in_progress: 'В процесі', done: 'Виконано', cancelled: 'Скасовано' };
function taskStatusLabel(s) { return TASK_STATUS_LABELS[s] || s; }
function taskEquipmentOptionsHtml(selected) {
  return TASK_EQUIPMENT_TYPES.map(e => `<option value="${escapeHtml(e)}" ${e === selected ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('');
}
/* Борг тепер вводиться вільним текстом (за проханням користувача — щоб можна було
   писати не лише суму, а й "1500 + доставка" тощо), а не лише числом. Якщо введене —
   чисте число, форматуємо як гроші; інакше показуємо текст як є. */
function taskMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  const n = Number(s.replace(',', '.'));
  return s !== '' && Number.isFinite(n) ? n.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) + ' грн' : s;
}
/* Найкраще наближення суми з вільного тексту (для сумарного боргу постачальникам) —
   бере число з початку рядка, якщо є, інакше 0. */
function parseMoneyLead(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

let installerTasksCache = [];
let editingTaskId = null;
let taskQuickFilter = 'all'; // 'all' | 'today' | 'week'

async function loadInstallerTasks() {
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;
  if (!session) { installerTasksCache = []; return; }
  const { data, error } = await sb.from('installer_tasks').select('*').eq('installer_id', session.user.id).order('scheduled_at');
  installerTasksCache = error ? [] : (data || []);
}

function taskPassesFilters(t, q, status, equipment, quick) {
  if (status && t.status !== status) return false;
  if (equipment && t.equipment_type !== equipment) return false;
  if (quick === 'today' || quick === 'week') {
    const d = new Date(t.scheduled_at);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfRange = new Date(startOfToday);
    endOfRange.setDate(endOfRange.getDate() + (quick === 'today' ? 1 : 7));
    if (d < startOfToday || d >= endOfRange) return false;
  }
  if (q) {
    const hay = norm((t.address || '') + ' ' + (t.client_name || '') + ' ' + (t.client_phone || ''));
    if (!hay.includes(q)) return false;
  }
  return true;
}

/* Той самий набір фільтрів (пошук/статус/обладнання/сьогодні-тиждень-усі), відсортований за
   часом — і для показу списку, і для друку/експорту в Excel (Крок 4), щоб обидва завжди
   показували ОДНЕ й те саме, без дублювання логіки фільтрації в двох місцях. */
function getFilteredInstallerTasks() {
  const searchEl = document.getElementById('task-search');
  const statusEl = document.getElementById('task-status-filter');
  const equipEl = document.getElementById('task-equipment-filter');
  const q = norm(searchEl ? searchEl.value : '');
  const status = statusEl ? statusEl.value : '';
  const equipment = equipEl ? equipEl.value : '';
  return installerTasksCache
    .filter(t => taskPassesFilters(t, q, status, equipment, taskQuickFilter))
    .slice()
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
}

function renderInstallerTaskList() {
  const listEl = document.getElementById('installer-tasks-list');
  if (!listEl) return;
  const filtered = getFilteredInstallerTasks();

  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty">Монтажів не знайдено.</div>';
    return;
  }

  let lastDateKey = null;
  listEl.innerHTML = filtered.map(t => {
    const d = new Date(t.scheduled_at);
    const dateKey = d.toDateString();
    let header = '';
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      const label = d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
      header = `<div class="segment-header">${escapeHtml(label)}</div>`;
    }
    return header + taskCardHtml(t, d);
  }).join('');
}

function taskCardHtml(t, d) {
  const timeLabel = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const clientBits = [t.client_name, t.client_phone].filter(Boolean).map(escapeHtml).join(' · ');
  const equipBits = escapeHtml(t.equipment_type || '');
  const moneyBits = t.client_debt_amount ? 'Борг клієнта: ' + taskMoney(t.client_debt_amount) : '';
  const statusOptionsHtml = Object.keys(TASK_STATUS_LABELS)
    .map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${escapeHtml(TASK_STATUS_LABELS[s])}</option>`).join('');
  return `
    <div class="user-card" data-task-card-id="${t.id}">
      <div class="user-card-top">
        <div>
          <p class="user-card-name">${escapeHtml(t.address)}</p>
          <p class="user-card-sub">${timeLabel}${clientBits ? ' · ' + clientBits : ''}</p>
        </div>
        <div class="user-card-top-right">
          <span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(taskStatusLabel(t.status))}</span>
          <button type="button" class="task-share-btn no-print" data-task-action="share" data-task-id="${t.id}" aria-label="Поділитися в месенджер">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8.8" y1="10.8" x2="15.2" y2="7"/><line x1="8.8" y1="13.2" x2="15.2" y2="17"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="5.6" r="2.8"/><circle cx="18" cy="18.4" r="2.8"/></g>
            </svg>
          </button>
          <button type="button" class="task-ics-btn no-print" data-task-action="ics" data-task-id="${t.id}" aria-label="Додати нагадування в календар">${TASK_CALENDAR_ICON}</button>
          <button type="button" class="user-card-open-btn no-print" data-task-action="toggle" data-task-id="${t.id}" aria-label="Відкрити">${USER_CARD_OPEN_ICON}</button>
        </div>
      </div>
      <div class="user-card-expand">
        <p class="user-card-sub">${equipBits}</p>
        ${moneyBits ? `<p class="user-card-sub">${moneyBits}</p>` : ''}
        ${t.comment ? `<p class="user-card-sub">${escapeHtml(t.comment)}</p>` : ''}
        <div class="user-card-row no-print">
          <select data-task-action="status" data-task-id="${t.id}">${statusOptionsHtml}</select>
          <label class="task-done-check">
            <input type="checkbox" data-task-action="done-toggle" data-task-id="${t.id}" ${t.status === 'done' ? 'checked' : ''}>
            Виконано
          </label>
        </div>
        <div class="user-card-actions no-print">
          <button type="button" data-task-action="edit" data-task-id="${t.id}">Редагувати</button>
          <button type="button" class="reject" data-task-action="delete" data-task-id="${t.id}">Видалити</button>
        </div>
      </div>
    </div>`;
}

/* Пошук за адресою/клієнтом/статусом/типом обладнання й підбір монтажу — навмисно НЕ
   пов'язано з data-action/handleAdminAction (адмінська дія над користувачем) — окремі
   атрибути data-task-action/data-task-id і окремі делеговані обробники нижче, щоб кнопки
   картки монтажу випадково не потрапили в handleAdminAction (обидва рендеряться в те саме
   #main). */
async function handleTaskAction(action, id, value) {
  if (action === 'toggle') {
    const card = document.querySelector(`[data-task-card-id="${id}"]`);
    if (card) card.classList.toggle('open');
    return;
  }
  if (action === 'edit') {
    const task = installerTasksCache.find(t => String(t.id) === String(id));
    if (task) openTaskForm(task);
    return;
  }
  if (action === 'delete') {
    if (!confirm('Видалити цей монтаж?')) return;
    const { error } = await sb.from('installer_tasks').delete().eq('id', id);
    if (!error) { await loadInstallerTasks(); renderInstallerTaskList(); }
    return;
  }
  if (action === 'status') {
    const { error } = await sb.from('installer_tasks').update({ status: value }).eq('id', id);
    if (!error) { await loadInstallerTasks(); renderInstallerTaskList(); }
    return;
  }
  if (action === 'ics') {
    const task = installerTasksCache.find(t => String(t.id) === String(id));
    if (task) downloadTaskIcs(task);
    return;
  }
  if (action === 'share') {
    const task = installerTasksCache.find(t => String(t.id) === String(id));
    if (task) shareTaskInfo(task, id);
    return;
  }
}

/* ---------- CRМонтаж: нагадування через .ics (Крок 3) ----------
   Push-сповіщення в PWA мають обмеження на iOS (HANDOFF.md), тому за ТЗ основний спосіб
   нагадування — календарна подія: монтажник тапає на іконку календаря в картці, файл
   .ics із подією + вбудованим нагадуванням (VALARM за 30 хв до початку) завантажується
   на пристрій, а далі системний застосунок календаря (Google Calendar/Apple Calendar/
   будь-який інший) сам показує нагадування — так само надійно на iOS, як і на Android,
   бо це вже не відповідальність PWA. Push-сповіщення для Android/десктопу — окремий
   можливий наступний крок (потребує нового Edge Function + pg_cron, за зразком
   send-promo-push з розділу Акції), тут навмисно не реалізовано, щоб не ускладнювати
   цей крок. */
const TASK_CALENDAR_ICON = ic('calendar', '🗓');

function escapeIcsText(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function toIcsUtc(date) {
  const pad = n => String(n).padStart(2, '0');
  return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + 'T' +
    pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
}
function buildTaskIcs(t) {
  const start = new Date(t.scheduled_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 година за замовчуванням, тривалість монтажу в базі не зберігається
  const summary = 'Монтаж: ' + (t.equipment_type || '');
  const descLines = [];
  if (t.client_name || t.client_phone) descLines.push('Клієнт: ' + [t.client_name, t.client_phone].filter(Boolean).join(', '));
  descLines.push('Вид робіт: ' + (t.equipment_type || ''));
  if (t.client_debt_amount) descLines.push('Борг клієнта: ' + taskMoney(t.client_debt_amount));
  if (t.comment) descLines.push('Коментар: ' + t.comment);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sun-ice//CRMontag//UK',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:sunice-task-' + t.id + '@sun-ice.com.ua',
    'DTSTAMP:' + toIcsUtc(new Date()),
    'DTSTART:' + toIcsUtc(start),
    'DTEND:' + toIcsUtc(end),
    'SUMMARY:' + escapeIcsText(summary),
    'DESCRIPTION:' + escapeIcsText(descLines.join('\n')),
    'LOCATION:' + escapeIcsText(t.address || ''),
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Нагадування про монтаж',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n');
}
function downloadTaskIcs(t) {
  const blob = new Blob([buildTaskIcs(t)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'montag-' + t.id + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- CRМонтаж: відправка в месенджери (ТЗ 3.4) ----------
   Той самий патерн, що й кнопка "Поділитися" в прайсі/кошику (navigator.share, з
   резервним копіюванням у буфер) — на телефоні відкриває системне вікно "Поділитися"
   зі списком месенджерів (Telegram/Viber/WhatsApp/будь-що ще встановлене), користувач
   сам обирає й підтверджує відправку в обраному месенджері. Окремий клас
   .task-share-btn (не .share-btn) навмисно — щоб не потрапити під делегований
   обробник .share-btn у прайсі (index.html:3866), розрахований на іншу структуру DOM. */
function shareTaskInfo(t, btnId) {
  const d = new Date(t.scheduled_at);
  const dateLabel = d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const lines = [
    'Монтаж: ' + t.address,
    'Дата/час: ' + dateLabel,
    (t.client_name || t.client_phone) ? 'Клієнт: ' + [t.client_name, t.client_phone].filter(Boolean).join(', ') : null,
    'Вид робіт: ' + t.equipment_type,
    t.client_debt_amount ? 'Борг клієнта: ' + taskMoney(t.client_debt_amount) : null
  ].filter(Boolean);
  const shareText = lines.join('\n');
  if (navigator.share) {
    navigator.share({ text: shareText }).catch(() => {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareText).then(() => {
      const btn = document.querySelector(`.task-share-btn[data-task-id="${btnId}"]`);
      if (btn) {
        const oldHTML = btn.innerHTML;
        btn.innerHTML = '✓';
        setTimeout(() => { btn.innerHTML = oldHTML; }, 1200);
      }
    }).catch(() => {});
  }
}

/* ---------- CRМонтаж: вивантаження списку (Крок 4) ----------
   ТЗ 3.3: експорт у PDF або Excel + можливість швидко переглянути/роздрукувати список на
   день перед виїздом. Excel — через xlsx.js, ту саму бібліотеку, що й так уже підключена
   для розбору price.xlsx (жодної нової залежності). Друк — window.print() з CSS-правилом
   .no-print (вище в <style>), що ховає все інтерактивне/навігаційне й розгортає кожну
   картку повністю — саме це і є "швидко роздрукувати список на день", якщо перед друком
   увімкнути швидкий фільтр "Сьогодні". PDF окремою бібліотекою свідомо не додавав — це
   нова залежність заради того самого результату, який print() дає безкоштовно. Обидві дії
   працюють з тим самим відфільтрованим списком, що й на екрані (getFilteredInstallerTasks),
   тобто експортується/друкується рівно те, що зараз видно. */
function exportInstallerTasksToExcel() {
  const tasks = getFilteredInstallerTasks();
  if (!tasks.length) {
    alert('Немає монтажів для експорту за поточними фільтрами.');
    return;
  }
  const rows = tasks.map(t => {
    const d = new Date(t.scheduled_at);
    return {
      'Дата': d.toLocaleDateString('uk-UA'),
      'Час': d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      'Адреса': t.address,
      "Ім'я клієнта": t.client_name || '',
      'Телефон клієнта': t.client_phone || '',
      'Вид робіт': t.equipment_type,
      'Борг клієнта': t.client_debt_amount || '',
      'Статус': taskStatusLabel(t.status),
      'Коментар': t.comment || ''
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Монтажі');
  XLSX.writeFile(wb, 'montag-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}


function toDateValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function toTimeValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
/* Ручний ввід часу цифрами замість системного бігунка-пікера: користувач набирає
   4 цифри, після другої сам вставляється ":", по blur — округлення до валідних меж
   (23 год / 59 хв), щоб не піти в БД зі сміттям на кшталт "99:99". */
function attachTimeInputFormatter(input) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
  });
  input.addEventListener('blur', () => {
    const m = input.value.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) { input.value = ''; return; }
    const hh = Math.min(23, parseInt(m[1], 10));
    const mm = Math.min(59, parseInt(m[2], 10));
    input.value = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  });
}

/* "Борг клієнта" — кнопка OK поруч з полем: суто візуальне підтвердження, що введене
   не загубиться (сама форма зберігається разом з рештою полів по кнопці "Зберегти"). */

function openTaskForm(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById('task-form-title').textContent = task ? 'Редагувати монтаж' : 'Новий монтаж';
  document.getElementById('task-field-address').value = task ? (task.address || '') : '';
  document.getElementById('task-field-date').value = task ? toDateValue(task.scheduled_at) : '';
  document.getElementById('task-field-time').value = task ? toTimeValue(task.scheduled_at) : '';
  document.getElementById('task-field-client-name').value = task ? (task.client_name || '') : '';
  document.getElementById('task-field-client-phone').value = task ? (task.client_phone || '') : '';
  document.getElementById('task-field-equipment').innerHTML = taskEquipmentOptionsHtml(task ? task.equipment_type : TASK_EQUIPMENT_TYPES[0]);
  const debtInputEl = document.getElementById('task-field-client-debt');
  debtInputEl.value = task && task.client_debt_amount ? task.client_debt_amount : '';
  debtInputEl.classList.remove('input-confirmed');
  const debtOkBtnEl = document.getElementById('task-field-client-debt-ok');
  debtOkBtnEl.textContent = 'OK';
  debtOkBtnEl.classList.remove('confirmed');
  document.getElementById('task-field-comment').value = task ? (task.comment || '') : '';
  document.getElementById('task-form-error').innerHTML = '';
  document.getElementById('task-form-overlay').classList.add('show');
}
function closeTaskForm() {
  document.getElementById('task-form-overlay').classList.remove('show');
}

async function handleTaskFormSubmit() {
  const errEl = document.getElementById('task-form-error');
  errEl.innerHTML = '';
  const address = document.getElementById('task-field-address').value.trim();
  const dateVal = document.getElementById('task-field-date').value;
  const timeVal = document.getElementById('task-field-time').value;
  const clientName = document.getElementById('task-field-client-name').value.trim();
  const clientPhone = document.getElementById('task-field-client-phone').value.trim();
  const equipment = document.getElementById('task-field-equipment').value;
  const clientDebt = document.getElementById('task-field-client-debt').value.trim();
  const comment = document.getElementById('task-field-comment').value.trim();

  if (!address || !dateVal || !/^\d{2}:\d{2}$/.test(timeVal)) {
    errEl.innerHTML = '<div class="error">Заповніть адресу, дату і час (ГГ:ХХ).</div>';
    return;
  }

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;
  if (!session) {
    errEl.innerHTML = '<div class="error">Сесія закінчилась. Вийдіть і увійдіть знову.</div>';
    return;
  }

  const btn = document.getElementById('task-form-submit-btn');
  btn.disabled = true;

  const row = {
    installer_id: session.user.id,
    address: address,
    scheduled_at: new Date(dateVal + 'T' + timeVal).toISOString(),
    client_name: clientName || null,
    client_phone: clientPhone || null,
    equipment_type: equipment,
    client_debt_amount: clientDebt || null,
    comment: comment || null
  };

  let error;
  if (editingTaskId) {
    ({ error } = await sb.from('installer_tasks').update(row).eq('id', editingTaskId));
  } else {
    ({ error } = await sb.from('installer_tasks').insert(row));
  }

  btn.disabled = false;
  if (error) {
    errEl.innerHTML = '<div class="error">Не вдалося зберегти. Спробуйте ще раз.</div>';
    return;
  }
  closeTaskForm();
  await loadInstallerTasks();
  renderInstallerTaskList();
}

/* ---------- CRМонтаж: постачальники (скільки монтажник сам винен) ----------
   Окремо від монтажів — персональний список постачальників (public.installer_suppliers,
   та сама RLS-модель installer_id = auth.uid()), проста поточна сума боргу на кожного,
   без журналу операцій (за явним проханням користувача — простіше в реалізації й
   використанні). Борг клієнта — окрема річ, лишається полем у самому монтажі
   (task-field-client-debt), сюди не потрапляє. */
let installerSuppliersCache = [];

async function loadSuppliers() {
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;
  if (!session) { installerSuppliersCache = []; return; }
  const { data, error } = await sb.from('installer_suppliers').select('*').eq('installer_id', session.user.id).order('name');
  installerSuppliersCache = error ? [] : (data || []);
}

function supplierRowHtml(s) {
  return `
    <div class="user-card" data-supplier-card-id="${s.id}">
      <div class="user-card-top">
        <div>
          <p class="user-card-name">${escapeHtml(s.name)}</p>
          ${s.note ? `<p class="user-card-sub">${escapeHtml(s.note)}</p>` : ''}
        </div>
        <div class="user-card-top-right">
          <button type="button" class="reject" data-supplier-action="delete" data-supplier-id="${s.id}">Видалити</button>
        </div>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>Борг</label>
        <input type="text" value="${escapeHtml(s.debt_amount == null ? '' : s.debt_amount)}" placeholder="напр. 1500 або текстом" data-supplier-action="amount" data-supplier-id="${s.id}">
      </div>
    </div>`;
}

function renderSuppliersList() {
  const listEl = document.getElementById('suppliers-list');
  const totalEl = document.getElementById('suppliers-total');
  if (!listEl) return;
  if (!installerSuppliersCache.length) {
    listEl.innerHTML = '<div class="empty">Постачальників ще нема.</div>';
  } else {
    listEl.innerHTML = installerSuppliersCache.map(supplierRowHtml).join('');
  }
  const total = installerSuppliersCache.reduce((sum, s) => sum + parseMoneyLead(s.debt_amount), 0);
  totalEl.textContent = 'Разом винен постачальникам: ' + (total ? taskMoney(total) : '0 грн');
}

async function openSuppliersPanel() {
  document.getElementById('suppliers-overlay').classList.add('show');
  document.getElementById('suppliers-list').innerHTML = '<div class="empty">Завантаження...</div>';
  document.getElementById('supplier-form-error').innerHTML = '';
  document.getElementById('supplier-new-name').value = '';
  document.getElementById('supplier-new-amount').value = '';
  document.getElementById('supplier-new-note').value = '';
  await loadSuppliers();
  renderSuppliersList();
}
function closeSuppliersPanel() {
  document.getElementById('suppliers-overlay').classList.remove('show');
}




/* Cross-fade вмісту екрана при перемиканні вкладок нижнього меню (див. словник
   анімацій у <style>). navFadeToken інвалідовує "застряглий" таймер попереднього
   перемикання, якщо користувач тисне вкладки швидше, ніж встигає дограти fade —
   кліки ніколи не блокуються. */
let navFadeToken = 0;

function animateTabSwitch(tab) {
  if (tab === currentTab && activeTile === null) return;

  if (prefersReducedMotionQuery.matches) {
    switchTab(tab, true);
    renderCurrentTab();
    return;
  }

  const main = document.getElementById('main');
  const myToken = ++navFadeToken;
  main.classList.add('nav-fade-out');

  setTimeout(() => {
    if (myToken !== navFadeToken) return;
    switchTab(tab, true);
    renderCurrentTab();
    main.classList.remove('nav-fade-out');
  }, 180);
}


