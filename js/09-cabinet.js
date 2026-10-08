/* Sun-ice — Кабінет, вхід/реєстрація, push, адмін-панель, вкладки
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Кабінет ---------- */
let cabinetMode = 'login'; // 'login' | 'register' — тільки для неавторизованого стану
let regionsCache = null;

function normalizePhoneDigits(phone) { return String(phone || '').replace(/\D/g, ''); }
function phoneToEmail(phone) { return 'p' + normalizePhoneDigits(phone) + '@sunice.local'; }

async function getRegions() {
  if (regionsCache) return regionsCache;
  const { data } = await sb.from('regions').select('*').order('sort_order');
  regionsCache = data || [];
  return regionsCache;
}

function statusLabel(status) {
  return {
    pending: 'На розгляді',
    approved: 'Підтверджено',
    rejected: 'Відхилено',
    blocked: 'Заблоковано'
  }[status] || 'На розгляді';
}
/* «Тип цін» (Стандартна / Клієнтська / VIP) прибрано з інтерфейсу 2026-09-21.
   Причина: поле зберігалось у profiles, адмін міг його перемикати, дилеру писалось
   "Тип цін: VIP" — але на ЖОДНУ ціну в застосунку воно не впливало, бо ніде, крім цього
   підпису, не використовувалось. Тобто інтерфейс обіцяв те, чого не робив (у базі всі
   16 профілів і так стояли на 'regular').
   Колонку price_type у базі НАВМИСНО лишено: даних не втрачаємо, і якщо різні рівні цін
   колись знадобляться по-справжньому, повернути вибір в адмінку — кілька хвилин.
   При реєстрації поле й далі заповнюється 'regular', бо цього вимагає RLS-політика
   "Users can insert own profile" (with check ... price_type = 'regular'). */
function roleLabel(role) {
  return { user: 'Користувач', regional_admin: 'Регіональний адмін', super_admin: 'Супер-адмін' }[role] || role;
}

async function renderCabinetTab() {
  document.getElementById('title').textContent = 'Кабінет';
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження...</div>';

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;

  if (!session) {
    renderAuthForms();
    return;
  }

  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !profile) {
    main.innerHTML =
      '<div class="error">Не вдалося завантажити профіль. Спробуйте вийти і зайти знову.</div>' +
      '<button class="logout-btn" id="cab-logout-btn">Вийти</button>';
    document.getElementById('cab-logout-btn').addEventListener('click', handleLogout);
    return;
  }

  if (profile.role === 'regional_admin' || profile.role === 'super_admin') {
    renderAdminPanel(profile);
  } else {
    renderUserStatus(profile);
  }
}

/* ---- Неавторизований стан: вхід / реєстрація ---- */
function renderAuthForms() {
  const main = document.getElementById('main');
  // Режим "reregister" (забули пароль) навмисно не має власної вкладки в перемикачі —
  // це не третій рівноправний варіант входу, а виправлення ситуації "забув пароль",
  // тому підсвічуємо вкладку Реєстрація (найближчу за змістом), а сама форма далі явно
  // пояснює, що відбувається.
  main.innerHTML = `
    <div class="auth-toggle">
      <button type="button" id="auth-tab-login" class="${cabinetMode === 'login' ? 'active' : ''}">Вхід</button>
      <button type="button" id="auth-tab-register" class="${cabinetMode !== 'login' ? 'active' : ''}">Реєстрація</button>
    </div>
    <div id="auth-form-holder"></div>
  `;
  document.getElementById('auth-tab-login').addEventListener('click', () => { cabinetMode = 'login'; renderAuthForms(); });
  document.getElementById('auth-tab-register').addEventListener('click', () => { cabinetMode = 'register'; renderAuthForms(); });
  if (cabinetMode === 'login') renderLoginForm();
  else if (cabinetMode === 'reregister') renderReregisterForm();
  else renderRegisterForm();
}

/* Прибирає з поля все, крім цифр, під час вводу (щоб залишався тільки номер після +38) */
function attachDigitsOnlyFilter(input) {
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/\D/g, '');
    if (cleaned !== input.value) input.value = cleaned;
  });
}
/* Складає повний номер у форматі +38XXXXXXXXXX з локальної частини, введеної користувачем */
function fullPhoneFromLocalInput(inputId) {
  const local = document.getElementById(inputId).value.trim();
  return '+38' + local;
}

function renderLoginForm() {
  const holder = document.getElementById('auth-form-holder');
  holder.innerHTML = `
    <div class="field">
      <label>Номер телефону</label>
      <div class="phone-input-row">
        <span class="phone-prefix">+38</span>
        <input type="tel" id="login-phone" placeholder="0501234567" maxlength="10" inputmode="numeric">
      </div>
    </div>
    <div class="field">
      <label>Пароль</label>
      <input type="password" id="login-password" placeholder="Ваш пароль">
    </div>
    <button class="primary-btn" id="login-submit-btn">Увійти</button>
    <button type="button" class="link-btn" id="forgot-password-btn">Забули пароль? Зареєструватися повторно</button>
    <button type="button" class="link-btn auth-switch-link" id="goto-register-btn">Вперше тут? Зареєструватися</button>
    <div id="login-error"></div>
  `;
  document.getElementById('goto-register-btn').addEventListener('click', () => { cabinetMode = 'register'; renderAuthForms(); });
  attachDigitsOnlyFilter(document.getElementById('login-phone'));
  document.getElementById('login-submit-btn').addEventListener('click', handleLogin);
  document.getElementById('forgot-password-btn').addEventListener('click', () => { cabinetMode = 'reregister'; renderAuthForms(); });
  holder.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  });
}

async function handleLogin() {
  const phone = fullPhoneFromLocalInput('login-phone');
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.innerHTML = '';
  if (normalizePhoneDigits(phone).length <= 2 || !password) {
    errEl.innerHTML = '<div class="error">Введіть телефон і пароль.</div>';
    return;
  }
  const btn = document.getElementById('login-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Вхід...';
  const { error } = await sb.auth.signInWithPassword({ email: phoneToEmail(phone), password: password });
  if (error) {
    errEl.innerHTML = '<div class="error">Невірний телефон або пароль.</div>';
    btn.disabled = false;
    btn.textContent = 'Увійти';
    return;
  }
  renderCabinetTab();
}

/* Ім'я та прізвище — два окремі поля (реєстрація й «Забули пароль»). Прізвище обов'язкове: раніше
   люди вводили лише ім'я, і адміністратор не міг зрозуміти, хто є хто. У БД лишається одне поле
   profiles.full_name = «Ім'я Прізвище» — схему й Edge Function reregister-user не чіпаємо. */
function nameFieldsHtml(prefix) {
  return `
    <div class="field" id="${prefix}-firstname-field">
      <label>Ім’я</label>
      <input type="text" id="${prefix}-firstname" placeholder="Введіть ім’я" autocomplete="given-name" autocapitalize="words">
      <div class="field-hint">Вкажіть ім’я.</div>
    </div>
    <div class="field" id="${prefix}-lastname-field">
      <label>Прізвище</label>
      <input type="text" id="${prefix}-lastname" placeholder="Введіть прізвище" autocomplete="family-name" autocapitalize="words">
      <div class="field-hint">Вкажіть прізвище — так адміністратор зможе вас розпізнати й швидше підтвердити доступ.</div>
    </div>`;
}
/* Перевіряє обидва поля, підсвічує порожні й повертає «Ім'я Прізвище» або '' (якщо чогось бракує). */
function readFullNameOrMark(prefix) {
  const norm = id => document.getElementById(id).value.replace(/\s+/g, ' ').trim();
  const first = norm(prefix + '-firstname'), last = norm(prefix + '-lastname');
  document.getElementById(prefix + '-firstname-field').classList.toggle('invalid', !first);
  document.getElementById(prefix + '-lastname-field').classList.toggle('invalid', !last);
  if (!first || !last) {
    const bad = document.getElementById(prefix + (!first ? '-firstname' : '-lastname'));
    if (bad) { try { bad.focus(); bad.scrollIntoView({ block: 'center' }); } catch (e) {} }
    return '';
  }
  return first + ' ' + last;
}
function wireNameFieldsClear(prefix) {
  ['firstname', 'lastname'].forEach(k => {
    const input = document.getElementById(prefix + '-' + k);
    input.addEventListener('input', () => {
      if (input.value.trim()) document.getElementById(prefix + '-' + k + '-field').classList.remove('invalid');
    });
  });
}

async function renderRegisterForm() {
  const holder = document.getElementById('auth-form-holder');
  holder.innerHTML = '<div class="empty">Завантаження...</div>';
  const regions = await getRegions();
  /* Поки вантажились регіони, людина могла піти з форми (наприклад, дотик по «Каталог» одразу
     після запуску) — тоді малювати форму нікуди, інакше нижче впаде на відсутніх елементах. */
  if (!holder.isConnected) return;
  const options = regions.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  holder.innerHTML = `
    ${JOKE_MODE ? '<div class="joke-banner">Зареєструйся і отримаєш винагороду 🎁</div>' : ''}
    ${nameFieldsHtml('reg')}
    <div class="field">
      <label>Номер телефону</label>
      <div class="phone-input-row">
        <span class="phone-prefix">+38</span>
        <input type="tel" id="reg-phone" placeholder="0501234567" maxlength="10" inputmode="numeric">
      </div>
    </div>
    <div class="field">
      <label>Пароль</label>
      <input type="password" id="reg-password" placeholder="Не менше 6 символів">
    </div>
    <div class="field">
      <label>Регіон</label>
      <select id="reg-region">${options}</select>
    </div>
    <button class="primary-btn" id="reg-submit-btn">Зареєструватися</button>
    <button type="button" class="link-btn auth-switch-link" id="goto-login-btn">Вже є акаунт? Увійти</button>
    <div id="reg-error"></div>
  `;
  wireNameFieldsClear('reg');
  document.getElementById('goto-login-btn').addEventListener('click', () => { cabinetMode = 'login'; renderAuthForms(); });
  attachDigitsOnlyFilter(document.getElementById('reg-phone'));
  document.getElementById('reg-submit-btn').addEventListener('click', handleRegister);
}

async function handleRegister() {
  const name = readFullNameOrMark('reg'); // '' — немає імені або прізвища (поле підсвічено з підказкою)
  const phone = fullPhoneFromLocalInput('reg-phone');
  const password = document.getElementById('reg-password').value;
  const regionSelect = document.getElementById('reg-region');
  const regionId = regionSelect.value;
  const errEl = document.getElementById('reg-error');
  errEl.innerHTML = '';

  if (!name) {
    errEl.innerHTML = '<div class="error">Вкажіть ім’я та прізвище.</div>';
    return;
  }
  if (normalizePhoneDigits(phone).length <= 2 || !password || !regionId) {
    errEl.innerHTML = '<div class="error">Заповніть усі поля.</div>';
    return;
  }
  if (password.length < 6) {
    errEl.innerHTML = '<div class="error">Пароль має містити щонайменше 6 символів.</div>';
    return;
  }
  if (normalizePhoneDigits(phone).length < 11) {
    errEl.innerHTML = '<div class="error">Перевірте номер телефону.</div>';
    return;
  }

  const btn = document.getElementById('reg-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Реєстрація...';

  // signUp() встановлює сесію одразу — з цього моменту й до нашого власного
  // renderCabinetTab() в кінці просимо глобальний onAuthStateChange-listener не
  // перерендерювати Кабінет самому (інакше він зробить це ДО того, як рядок profiles
  // взагалі буде записано, і покаже хибне "Не вдалося завантажити профіль").
  suppressCabinetAutoRerender = true;

  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: phoneToEmail(phone),
    password: password
  });

  if (signUpError) {
    const already = signUpError.message && /registered|exists/i.test(signUpError.message);
    errEl.innerHTML = '<div class="error">' + (already ? 'Цей номер телефону вже зареєстровано. Спробуйте увійти.' : 'Не вдалося зареєструватися. Спробуйте ще раз.') + '</div>';
    btn.disabled = false;
    btn.textContent = 'Зареєструватися';
    suppressCabinetAutoRerender = false;
    return;
  }

  const userId = signUpData && signUpData.user ? signUpData.user.id : null;
  if (!userId) {
    errEl.innerHTML = '<div class="error">Реєстрацію не завершено. Спробуйте увійти або зверніться до адміністратора.</div>';
    btn.disabled = false;
    btn.textContent = 'Зареєструватися';
    suppressCabinetAutoRerender = false;
    return;
  }

  const { error: profileError } = await sb.from('profiles').upsert({
    id: userId,
    full_name: name,
    phone: phone,
    region_id: parseInt(regionId, 10),
    status: 'pending',
    price_type: 'regular',
    role: 'user'
  }, { onConflict: 'id' });

  if (profileError) {
    errEl.innerHTML = '<div class="error">Акаунт створено, але не вдалося зберегти дані профілю. Зверніться до адміністратора.</div>';
    btn.disabled = false;
    btn.textContent = 'Зареєструватися';
    suppressCabinetAutoRerender = false;
    return;
  }

  suppressCabinetAutoRerender = false;
  renderCabinetTab();
}

/* ---- "Забули пароль" — зміна пароля наявному акаунту ----
   Виконує Edge Function reregister-user (зміна чужого пароля потребує service role, з
   анонімного ключа це неможливо); копія її коду — claude/edge-functions/reregister-user/
   index.ts.

   ДО 2026-09-19 вона ВИДАЛЯЛА старий акаунт і створювала новий. Це давало три біди:
   заблокований обходив блокування (новий рядок мав 'pending', а 'pending' бачить ціни);
   разом з профілем каскадом гинули ВСІ монтажі людини (installer_tasks → profiles →
   auth.users, обидві зв'язки ON DELETE CASCADE); і скидались role/price_type. Тепер
   функція міняє пароль наявному акаунту й нічого не видаляє.

   Заблокованим і відхиленим зміна пароля не дається взагалі (403) — інакше блокування
   не мало б сенсу. Решті пароль міняється одразу, але статус стає 'pending' +
   reregistered_at, і ціни ховаються до підтвердження адміном (див. profileAllowsPrices).

   Номер телефону, як і раніше, ніяк не підтверджується — той, хто знає чужий номер,
   може змінити на ньому пароль. Але тепер це не знищує дані й не відкриває цін: доступ
   дає лише адмін, який бачить у панелі позначку повторної заявки. */
async function renderReregisterForm() {
  const holder = document.getElementById('auth-form-holder');
  holder.innerHTML = '<div class="empty">Завантаження...</div>';
  /* Поле регіону тут свідомо відсутнє (2026-09-20). Регіон має право міняти лише
     super_admin — це стереже тригер trg_prevent_role_region_change у БД. Якби форма
     "Забули пароль" його надсилала, то (а) вибір іншого регіону валив би оновлення
     винятком, і (б) це був би обхід самого правила. Тому регіон лишається той, що був;
     змінити його може тільки адміністратор. */
  holder.innerHTML = `
    <p class="promo-doc-note" style="margin:-4px 0 4px;">Якщо ви забули пароль — введіть свій номер телефону, ім'я, прізвище та новий пароль. Обліковий запис, ваші монтажі та інші дані зберігаються — зміниться лише пароль. Доступ до цін відновиться після підтвердження адміністратором.</p>
    ${nameFieldsHtml('rereg')}
    <div class="field">
      <label>Номер телефону</label>
      <div class="phone-input-row">
        <span class="phone-prefix">+38</span>
        <input type="tel" id="rereg-phone" placeholder="0501234567" maxlength="10" inputmode="numeric">
      </div>
    </div>
    <div class="field">
      <label>Новий пароль</label>
      <input type="password" id="rereg-password" placeholder="Не менше 6 символів">
    </div>
    <button class="primary-btn" id="rereg-submit-btn">Зареєструватися повторно</button>
    <button type="button" class="link-btn" id="rereg-back-btn">Назад до входу</button>
    <div id="rereg-error"></div>
  `;
  wireNameFieldsClear('rereg');
  attachDigitsOnlyFilter(document.getElementById('rereg-phone'));
  document.getElementById('rereg-submit-btn').addEventListener('click', handleReregister);
  document.getElementById('rereg-back-btn').addEventListener('click', () => { cabinetMode = 'login'; renderAuthForms(); });
}

async function handleReregister() {
  const name = readFullNameOrMark('rereg'); // '' — немає імені або прізвища (поле підсвічено з підказкою)
  const phone = fullPhoneFromLocalInput('rereg-phone');
  const password = document.getElementById('rereg-password').value;
  const errEl = document.getElementById('rereg-error');
  errEl.innerHTML = '';

  if (!name) {
    errEl.innerHTML = '<div class="error">Вкажіть ім’я та прізвище.</div>';
    return;
  }
  if (normalizePhoneDigits(phone).length <= 2 || !password) {
    errEl.innerHTML = '<div class="error">Заповніть усі поля.</div>';
    return;
  }
  if (password.length < 6) {
    errEl.innerHTML = '<div class="error">Пароль має містити щонайменше 6 символів.</div>';
    return;
  }
  if (normalizePhoneDigits(phone).length < 11) {
    errEl.innerHTML = '<div class="error">Перевірте номер телефону.</div>';
    return;
  }

  const btn = document.getElementById('rereg-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Реєстрація...';

  const { data, error } = await sb.functions.invoke('reregister-user', {
    body: { phone: phone, full_name: name, password: password }
  });

  if (error || (data && data.error)) {
    const detail = (data && data.error) || (error && error.message) || '';
    const notFound = /not.?found/i.test(detail);
    /* 403 "account blocked" — заблокованому/відхиленому пароль не міняють. Текст
       навмисно не пояснює, що саме сталось: людина має звернутись до адміністратора,
       а не підбирати обхід. */
    const blocked = /blocked/i.test(detail);
    errEl.innerHTML = '<div class="error">' + (notFound
      ? 'Обліковий запис із цим номером не знайдено. Якщо ви ще не реєструвались — скористайтесь звичайною реєстрацією.'
      : blocked
        ? 'Змінити пароль для цього номера неможливо. Зверніться до адміністратора.'
        : 'Не вдалося змінити пароль. Спробуйте ще раз або зверніться до адміністратора.') + '</div>';
    btn.disabled = false;
    btn.textContent = 'Зареєструватися повторно';
    return;
  }

  suppressCabinetAutoRerender = true;
  const { error: signInError } = await sb.auth.signInWithPassword({ email: phoneToEmail(phone), password: password });
  suppressCabinetAutoRerender = false;
  if (signInError) {
    errEl.innerHTML = '<div class="error">Заявку створено, але не вдалося увійти автоматично. Спробуйте увійти вручну з новим паролем.</div>';
    btn.disabled = false;
    btn.textContent = 'Зареєструватися повторно';
    cabinetMode = 'login';
    return;
  }

  renderCabinetTab();
}

/* ---- Push-сповіщення (для адміністраторів) ---- */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

async function getPushSubscriptionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { supported: false, enabled: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, enabled: !!sub };
  } catch (e) {
    return { supported: true, enabled: false };
  }
}

async function enablePushNotifications(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Цей браузер не підтримує push-сповіщення.');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Дозвіл на сповіщення не надано. Увімкнути його можна в налаштуваннях браузера/застосунку.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const json = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: 'endpoint' });
    if (error) { alert('Не вдалося зберегти підписку на сповіщення.'); return; }
    renderCabinetTab();
  } catch (e) {
    alert('Не вдалося увімкнути сповіщення на цьому пристрої.');
  }
}

function notifyPushSupported() {
  return ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
}

/* Якщо дозвіл на сповіщення на цьому пристрої вже надано (наприклад, гість натиснув
   "Дозволити" в банері чи у формі після встановлення до того, як зареєструвався), але
   підписки push_subscriptions ще немає (бо тоді не було userId) — доприв'язуємо її
   мовчки одразу після входу/реєстрації, щоб не питати дозвіл вдруге. */
async function autoAttachPushIfGranted() {
  try {
    if (!notifyPushSupported() || Notification.permission !== 'granted') return;
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData ? sessionData.session : null;
    if (!session) return;
    const state = await getPushSubscriptionState();
    if (!state.enabled) await enablePushNotifications(session.user.id);
  } catch (e) {}
}

/* Коли адмін відкрив Кабінет — вважаємо, що заявки переглянуті: гасимо бейдж і закриваємо сповіщення */
function clearNotificationsAndBadge() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('clear-notifications');
  }
  if ('clearAppBadge' in navigator) {
    try { navigator.clearAppBadge(); } catch (e) {}
  }
}

/* ---- Авторизований звичайний користувач ---- */
async function renderUserStatus(profile) {
  const main = document.getElementById('main');
  // Доступ (у т.ч. до цін у прайсі) діє одразу після ЗВИЧАЙНОЇ реєстрації
  // (status='pending', reregistered_at порожній) — адмін пізніше або підтверджує, або
  // блокує/відхиляє. Виняток — зміна пароля через "Забули пароль": там ціни чекають
  // підтвердження адміністратора. Єдиний критерій — profileAllowsPrices().
  const canSeePrices = profileAllowsPrices(profile);
  const awaitingAfterReset = profile.status === 'pending' && !!profile.reregistered_at;
  const priceLine = ''; // "Тип цін" прибрано 2026-09-21 — див. коментар біля колишнього priceTypeLabel
  const resetNoteHtml = awaitingAfterReset
    ? '<div class="warn">Пароль змінено, вхід відновлено. Ціни у прайсі з\'являться, щойно адміністратор підтвердить заявку — зазвичай це швидко. Ваші монтажі та інші дані на місці.</div>'
    : '';
  // Кнопка "Увімкнути сповіщення" тут потрібна не тільки адмінам (як було раніше) — саме
  // через цю підписку звичайні користувачі й отримують push про нові акції (див.
  // send-promo-push.ts): без неї в push_subscriptions не було б жодного запису для
  // звичайного користувача, і "усім користувачам" push не дійшов би нікому, крім адмінів.
  const pushState = await getPushSubscriptionState();
  const pushHtml = pushState.supported
    ? (pushState.enabled
        ? '<div class="push-status">🔔 Сповіщення на цьому пристрої увімкнено</div>'
        : '<button type="button" class="link-btn push-enable-btn" id="enable-push-btn">🔔 Увімкнути сповіщення на цьому пристрої</button>')
    : '';
  main.innerHTML = `
    <div class="status-card">
      <div class="status-card-title">${escapeHtml(statusLabel(profile.status))}</div>
      <div class="status-card-sub">${escapeHtml(profile.full_name || '')}<br>${escapeHtml(profile.phone || '')}${priceLine}</div>
    </div>
    ${resetNoteHtml}
    ${JOKE_MODE && profile.status === 'pending' && !awaitingAfterReset ? '<div class="joke-note">Зареєструвались, не перенавантажились!? Винагорода? Дякуємо, що не насварили :-)</div>' : ''}
    ${pushHtml}
    <button class="logout-btn" id="cab-logout-btn">Вийти</button>
  `;
  document.getElementById('cab-logout-btn').addEventListener('click', handleLogout);
  const enablePushBtn = document.getElementById('enable-push-btn');
  if (enablePushBtn) enablePushBtn.addEventListener('click', () => enablePushNotifications(profile.id));
}

async function handleLogout() {
  await sb.auth.signOut();
  cabinetMode = 'login';
  renderCabinetTab();
}

/* ---- Адмін-панель (regional_admin / super_admin) ---- */
let adminUsersCache = [];

const USER_CARD_OPEN_ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---- Самодіагностика прайсу (тільки super_admin) — див. price-diagnostics-setup.sql ---- */
async function loadPriceIssues() {
  try {
    const { data, error } = await sb.from('price_issues').select('*').eq('resolved', false).order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}

/* Підпис «Область · Підрозділ» для рядка проблеми: нові записи мають DIAG_AREA у tile_label і ключ у
   brand (показуємо читабельну назву), старі (з розбору прайсу) — «розділ / БРЕНД», як і було. */
const DIAG_SUB_LABELS = {
  split_mhi: 'Спліт-системи / MHI', split_gal: 'Спліт-системи / GAL',
  multisplit_mhi: 'Мульти спліт-системи / MHI', multisplit_gal: 'Мульти спліт-системи / GAL',
  semi_mhi: 'Напівпромислові / MHI', semi_gal: 'Напівпромислові / GAL',
  systemair: 'Вентиляційне обладнання / Systemair', frico: 'Повітряні завіси / FRICO',
  table: 'файл посилань', 'app-files': 'файли застосунку', promotions: 'акції', 'series-images': 'фото серій',
  profiles: 'профілі', rates: 'курси', build: 'версія', live: 'картки на сайті'
};
function diagIssueLabel(issue) {
  const isNew = Object.values(DIAG_AREA).indexOf(issue.tile_label) !== -1 || issue.tile_label === 'Самодіагностика';
  if (isNew) return issue.tile_label + ' · ' + (DIAG_SUB_LABELS[issue.brand] || issue.brand);
  return issue.tile_label + ' / ' + String(issue.brand || '').toUpperCase();
}
/* Одна проблема на (область, підрозділ, тип): старі версії прайсу могли лишити дублікати — беремо найсвіжішу. */
function diagDedupe(issues) {
  const m = new Map();
  issues.forEach(i => {
    const k = i.tile_label + '\u0001' + i.brand + '\u0001' + i.kind;
    const prev = m.get(k);
    if (!prev || new Date(i.updated_at || i.created_at) > new Date(prev.updated_at || prev.created_at)) m.set(k, i);
  });
  const rank = { error: 0, warning: 1, info: 2 };
  return Array.from(m.values()).sort((a, b) => (rank[a.kind] ?? 1) - (rank[b.kind] ?? 1) || diagIssueLabel(a).localeCompare(diagIssueLabel(b), 'uk'));
}
function diagTargetHtml(t) {
  if (!t) return '';
  const parts = [];
  if (t.app) {
    parts.push('<div class="diag-where">Де в застосунку: <b>' + escapeHtml((DIAG_SUB_LABELS[t.app.tile + '_' + t.app.brand] || t.app.tile + ' / ' + t.app.brand) + (t.app.model ? ' · ' + t.app.model : '')) + '</b></div>');
  }
  if (t.excel) parts.push('<div class="diag-where">Де в Excel: <b>' + escapeHtml(t.excel) + '</b></div>');
  if (t.site) parts.push('<div class="diag-where">Куди веде на сайті: <b>' + escapeHtml(t.site) + '</b></div>');
  const btns = [];
  if (t.app) btns.push('<button type="button" class="diag-go-btn" data-diag-go="app">Відкрити в застосунку</button>');
  if (t.tab && !t.app) btns.push('<button type="button" class="diag-go-btn" data-diag-go="tab">Перейти в розділ</button>');
  if (t.site) btns.push('<button type="button" class="diag-go-btn" data-diag-go="site">Відкрити на сайті</button>');
  return parts.join('') + (btns.length ? '<div class="diag-go">' + btns.join('') + '</div>' : '');
}
function priceIssueRowHtml(issue) {
  const icon = issue.kind === 'warning' ? '⚠️' : issue.kind === 'info' ? 'ℹ️' : '⛔';
  const p = diagParseMessage(issue.message);
  const subLabel = DIAG_SUB_LABELS[issue.brand];
  if (subLabel && p.title.indexOf(subLabel + ': ') === 0) p.title = p.title.slice(subLabel.length + 2); // назва вже в заголовку рядка
  const lines = p.lines.map(l => '<div class="diag-line">' + escapeHtml(l) + '</div>').join('');
  return `
    <details class="diag-issue diag-${escapeHtml(issue.kind)}" data-target="${escapeHtml(JSON.stringify(p.target || null))}"
             data-tile="${escapeHtml(issue.tile_label)}" data-brand="${escapeHtml(issue.brand)}" data-kind="${escapeHtml(issue.kind)}">
      <summary><span class="diag-ico">${icon}</span><span class="diag-sum"><b>${escapeHtml(diagIssueLabel(issue))}</b><span class="diag-title">${escapeHtml(p.title)}</span></span></summary>
      <div class="diag-body">
        ${lines}
        ${diagTargetHtml(p.target)}
        <div class="diag-foot">
          <span class="price-issue-meta">версія ${escapeHtml(String(issue.version))} · ${new Date(issue.updated_at || issue.created_at).toLocaleString('uk-UA')}</span>
          ${issue.kind === 'info'
            ? '<button type="button" class="price-issue-resolve-btn" data-action="ack-note">Прийнято</button>'
            : '<button type="button" class="price-issue-resolve-btn" data-action="resolve-price-issue">Вирішено</button>'}
        </div>
      </div>
    </details>`;
}

/* «Прийняті» примітки. Примітка (info) — не проблема, а відоме затверджене правило (наприклад,
   округлення цін чи −20 % для Напівпромислових MHI). Після натискання «Прийнято» вона більше не
   світиться в картці: ховається у згорнутий блок «Прийняті примітки». Прийняття прив'язане до
   ТЕКСТУ примітки (відбиток): якщо правило чи перелік у примітці зміниться — вона з'явиться знову
   як нова. Зберігається на цьому пристрої (localStorage). Проблеми (error/warning) це не стосується —
   вони показуються щоразу, доки їх не виправлено. */
const DIAG_ACK_KEY = 'diagAckNotes';
let lastPriceIssues = []; // останній показаний список — з нього «Прийнято» бере поточний текст примітки
function diagNoteKey(i) { return i.tile_label + '\u0001' + i.brand; }
function diagNoteHash(i) {
  const s = String(i.message || '');
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0;
  return String(h);
}
function diagLoadAcks() {
  try { return JSON.parse(localStorage.getItem(DIAG_ACK_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function diagSaveAcks(acks) {
  try { localStorage.setItem(DIAG_ACK_KEY, JSON.stringify(acks)); } catch (e) { /* без localStorage примітки просто показуватимуться знову */ }
}

function priceIssuesListHtml(issues) {
  lastPriceIssues = issues || [];
  const list = diagDedupe(lastPriceIssues);
  const acks = diagLoadAcks();
  const problems = list.filter(i => i.kind !== 'info');
  const notes = list.filter(i => i.kind === 'info');
  const accepted = notes.filter(i => acks[diagNoteKey(i)] === diagNoteHash(i));
  const fresh = notes.filter(i => acks[diagNoteKey(i)] !== diagNoteHash(i));
  let html = '';
  if (!problems.length && !fresh.length) html += '<div class="price-diag-ok">Проблем не виявлено ✓</div>';
  else html += '<div class="diag-summary">Проблем: <b>' + problems.length + '</b>' + (fresh.length ? ' · нових приміток: ' + fresh.length : '') + '</div>';
  html += problems.map(priceIssueRowHtml).join('');
  if (fresh.length) {
    html += '<div class="diag-notes-title">Нові примітки (не проблеми)</div>' + fresh.map(priceIssueRowHtml).join('') +
      (fresh.length > 1 ? '<button type="button" class="link-btn diag-ack-all" data-action="ack-all-notes">Прийняти всі примітки</button>' : '');
  }
  if (accepted.length) {
    html += '<details class="diag-acked"><summary>Прийняті примітки: ' + accepted.length + '</summary>' + accepted.map(priceIssueRowHtml).join('') +
      '<button type="button" class="link-btn diag-ack-all" data-action="unack-notes">Показувати знову</button></details>';
  }
  return html;
}

/* Звіт «що саме перевірено» після ручного прогону: кожна перевірка зі своїм статусом, щоб було видно покриття. */
function diagCoverageHtml(run) {
  if (!run) return '';
  const status = c => {
    const mine = run.issues.filter(i => i.tile === c.area && i.brand === c.sub);
    if (mine.some(i => i.kind === 'error')) return '⛔';
    if (mine.some(i => i.kind === 'warning')) return '⚠️';
    return '✓';
  };
  const rows = run.checked.map(c => '<div class="diag-cov-row"><span class="diag-cov-st">' + status(c) + '</span><span><b>' + escapeHtml(c.area) + ' · ' + escapeHtml(c.label) + '</b>' +
    (c.detail ? '<span class="diag-cov-detail">' + escapeHtml(c.detail) + '</span>' : '') + '</span></div>').join('');
  return '<details class="diag-coverage"><summary>Що перевірено: ' + run.checked.length + ' пунктів · ' + new Date(run.at).toLocaleString('uk-UA') + '</summary>' + rows + '</details>';
}

/* «Куди веде»: відкриває розділ застосунку на потрібному списку й підсвічує рядок. */
function diagOpenApp(t) {
  switchTab('catalog', true);
  activeTile = t.tile;
  activeBrand = t.brand === 'gal' ? 'gal' : 'mhi';
  if (t.tile === 'ventilation') { ventilationBrand = 'systemair'; systemairSearchQuery = t.model || ''; systemairRenderCount = SYSTEMAIR_BATCH; }
  if (t.tile === 'aircurtains') { aircurtainsSearchQuery = t.model || ''; aircurtainsRenderCount = AIRCURTAINS_BATCH; }
  history.pushState({ tab: 'catalog', tile: t.tile }, '', '#' + encodeURIComponent(t.tile));
  renderCatalogView();
  if (!t.model) return;
  setTimeout(function () {
    const el = Array.from(document.querySelectorAll('#main .row-name')).find(e => e.textContent.trim() === t.model);
    if (!el) return;
    const row = el.closest('.row');
    row.scrollIntoView({ block: 'center' });
    row.classList.add('diag-flash');
    setTimeout(function () { row.classList.remove('diag-flash'); }, 3000);
  }, 300);
}

function wirePriceIssueButtons(profile) {
  const card = document.querySelector('.price-diag-card');
  if (!card || card.__diagWired) return;
  card.__diagWired = true; // делегований обробник: список перемальовується, а карта лишається
  card.addEventListener('click', async e => {
    const go = e.target.closest('[data-diag-go]');
    const issueEl = e.target.closest('.diag-issue');
    if (go && issueEl) {
      let t = null;
      try { t = JSON.parse(issueEl.getAttribute('data-target')); } catch (err) { t = null; }
      if (!t) return;
      const kind = go.getAttribute('data-diag-go');
      if (kind === 'app' && t.app) diagOpenApp(t.app);
      else if (kind === 'tab' && t.tab) { switchTab(t.tab, true); renderCurrentTab(); }
      else if (kind === 'site' && t.site) window.open(t.site.indexOf('http') === 0 ? t.site : 'https://sun-ice.com.ua/' + t.site, '_blank', 'noopener');
      return;
    }
    const ackAct = e.target.closest('[data-action="ack-note"], [data-action="ack-all-notes"], [data-action="unack-notes"]');
    if (ackAct) {
      const act = ackAct.getAttribute('data-action');
      const acks = diagLoadAcks();
      const notes = diagDedupe(lastPriceIssues).filter(i => i.kind === 'info');
      if (act === 'unack-notes') notes.forEach(i => { delete acks[diagNoteKey(i)]; });
      else notes.forEach(i => {
        // «Прийнято» — лише ця примітка (її рядок); «Прийняти всі» — усі, що зараз показані
        if (act === 'ack-note' && !(issueEl && issueEl.getAttribute('data-tile') === i.tile_label && issueEl.getAttribute('data-brand') === i.brand)) return;
        acks[diagNoteKey(i)] = diagNoteHash(i);
      });
      diagSaveAcks(acks);
      const list = document.getElementById('price-issues-list');
      if (list) list.innerHTML = priceIssuesListHtml(lastPriceIssues);
      return;
    }
    const res = e.target.closest('[data-action="resolve-price-issue"]');
    if (res && issueEl) {
      res.disabled = true;
      await sb.from('price_issues').update({ resolved: true })
        .eq('tile_label', issueEl.getAttribute('data-tile')).eq('brand', issueEl.getAttribute('data-brand'))
        .eq('kind', issueEl.getAttribute('data-kind')).eq('resolved', false);
      const list = document.getElementById('price-issues-list');
      if (list) list.innerHTML = priceIssuesListHtml(await loadPriceIssues());
    }
  });
}

// Ручна самодіагностика "на вимогу" — не чекаючи, поки хтось із клієнтів відкриє каталог. Завантажує
// свіжий price.xlsx, перераховує його й проганяє ВСІ перевірки (DIAG_CHECKS): ціни/маркування проти
// Excel, посилання на сайт, зображення й файли, ролі, курси, версію застосунку, картки на сайті.
async function runManualPriceCheck(profile) {
  const statusEl = document.getElementById('price-diag-status');
  const btn = document.getElementById('price-check-btn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Завантажую прайс...';
  try {
    const meta = await checkPriceVersion();
    const version = meta ? meta.version : priceVersion;
    const parsed = await downloadAndParsePrice(version, { skipDiag: true });
    if (meta) { priceVersion = meta.version; persistProcessedCache(priceVersion); }
    const run = await runDiagnostics({
      manual: true, wb: parsed.wb, data: parsed.data, version: version,
      onProgress: label => { if (statusEl) statusEl.textContent = 'Перевіряю: ' + label + '...'; }
    });
    const list = document.getElementById('price-issues-list');
    if (list) list.innerHTML = priceIssuesListHtml(await loadPriceIssues());
    const cov = document.getElementById('price-diag-coverage');
    if (cov) cov.innerHTML = diagCoverageHtml(lastDiagRun);
    wirePriceIssueButtons(profile);
    const problems = run.issues.filter(i => i.kind !== 'info').length;
    if (statusEl) statusEl.textContent = 'Перевірку завершено ' + new Date().toLocaleString('uk-UA') + ' · перевірено ' + run.checked.length + ' пунктів · проблем: ' + problems;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Не вдалося перевірити — немає інтернету?';
  }
  if (btn) btn.disabled = false;
}

async function renderAdminPanel(profile) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження...</div>';

  const regions = await getRegions();
  const regionName = id => { const r = regions.find(x => x.id === id); return r ? r.name : ''; };

  const { data: users, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) {
    main.innerHTML = '<div class="empty">Не вдалося завантажити користувачів.</div><button class="logout-btn" id="cab-logout-btn">Вийти</button>';
    document.getElementById('cab-logout-btn').addEventListener('click', handleLogout);
    return;
  }

  adminUsersCache = users || [];
  const isSuper = profile.role === 'super_admin';

  // Компактний рядок картки: тільки ім'я, регіон, телефон і статус (як просили) — решта
  // (тип ціни, роль, підтвердження/блокування/видалення) ховається під кнопку "відкрити"
  // і не займає місця в списку, поки адмін явно не розгорне картку.
  function userCardHtml(u, isPending) {
    const badgeClass = 'badge-' + u.status;
    const canDelete = u.id !== profile.id && (isSuper || (profile.role === 'regional_admin' && u.role !== 'super_admin'));
    const deleteBtn = canDelete ? `<button type="button" class="reject" data-action="delete" data-id="${u.id}">Видалити</button>` : '';
    let actions;
    if (isPending) {
      actions = `
        <div class="user-card-actions">
          <button type="button" class="approve" data-action="approve" data-id="${u.id}">Підтвердити</button>
          <button type="button" class="reject" data-action="reject" data-id="${u.id}">Відхилити</button>
          ${deleteBtn}
        </div>`;
    } else {
      const blockLabel = u.status === 'blocked' ? 'Розблокувати' : 'Заблокувати';
      const blockAction = u.status === 'blocked' ? 'unblock' : 'block';
      /* Вибір "Тип цін" прибрано 2026-09-21 (нічого не робив — див. коментар біля
         колишнього priceTypeLabel). Разом з ним рядок .user-card-row лишився б у
         регіонального адміна порожнім (вибір ролі бачить лише super_admin) — тому
         тепер увесь рядок малюється тільки там, де в ньому щось є. */
      const roleRowHtml = isSuper ? `
        <div class="user-card-row">
          <select data-action="role" data-id="${u.id}">
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Користувач</option>
            <option value="regional_admin" ${u.role === 'regional_admin' ? 'selected' : ''}>Регіон. адмін</option>
            <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Супер-адмін</option>
          </select>
        </div>` : '';
      actions = `
        ${roleRowHtml}
        <div class="user-card-actions">
          <button type="button" data-action="${blockAction}" data-id="${u.id}">${blockLabel}</button>
          ${deleteBtn}
        </div>`;
    }
    const reregBadge = u.reregistered_at
      ? '<div class="user-card-rereg-badge">🔁 Повторна реєстрація (забули пароль)</div>' : '';
    return `
      <div class="user-card" data-card-id="${u.id}">
        <div class="user-card-top">
          <div>
            <p class="user-card-name">${escapeHtml(u.full_name || '(без імені)')}</p>
            <p class="user-card-sub">${escapeHtml(regionName(u.region_id))} · ${escapeHtml(u.phone || '')}</p>
            ${reregBadge}
          </div>
          <div class="user-card-top-right">
            <span class="badge ${badgeClass}">${escapeHtml(statusLabel(u.status))}</span>
            <button type="button" class="user-card-open-btn" data-action="toggle-menu" data-id="${u.id}" aria-label="Відкрити">${USER_CARD_OPEN_ICON}</button>
          </div>
        </div>
        <div class="user-card-expand">
          ${actions}
        </div>
      </div>`;
  }

  // roleFilter: '' (усі), 'user', 'regional_admin', 'super_admin' — точна роль, або
  // 'admin' — збірне "будь-який адмін" (лише regional_admin/super_admin), яким
  // користується спрощений фільтр regional_admin.
  function passesFilters(u, q, regionId, roleFilter) {
    if (regionId && String(u.region_id) !== regionId) return false;
    if (roleFilter === 'admin') { if (u.role !== 'regional_admin' && u.role !== 'super_admin') return false; }
    else if (roleFilter && u.role !== roleFilter) return false;
    if (q && !((u.full_name || '').toLowerCase().includes(q) || (u.phone || '').toLowerCase().includes(q))) return false;
    return true;
  }

  function currentFilters() {
    const searchEl = document.getElementById('admin-search');
    const regionEl = document.getElementById('admin-region-filter');
    const roleEl = document.getElementById('admin-role-filter');
    return {
      q: searchEl ? searchEl.value.toLowerCase().trim() : '',
      regionId: regionEl ? regionEl.value : '',
      role: roleEl ? roleEl.value : ''
    };
  }

  function rerenderLists() {
    const { q, regionId, role } = currentFilters();
    const pending = adminUsersCache.filter(u => u.status === 'pending' && passesFilters(u, q, regionId, role));
    const others = adminUsersCache.filter(u => u.status !== 'pending' && passesFilters(u, q, regionId, role));
    document.getElementById('admin-pending-list').innerHTML =
      pending.length ? pending.map(u => userCardHtml(u, true)).join('') : '<div class="empty" style="padding:16px;">Нічого не знайдено</div>';
    document.getElementById('admin-users-list').innerHTML =
      others.length ? others.map(u => userCardHtml(u, false)).join('') : '<div class="empty" style="padding:16px;">Нічого не знайдено</div>';
  }

  const pending = adminUsersCache.filter(u => u.status === 'pending');
  const others = adminUsersCache.filter(u => u.status !== 'pending');
  const pushState = await getPushSubscriptionState();
  const priceIssues = isSuper ? await loadPriceIssues() : [];
  const regionOptionsHtml = regions.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  // super_admin бачить усіх — потрібно розрізняти три ролі окремо. regional_admin і так
  // бачить (завдяки RLS) тільки свій регіон, тож для нього достатньо простого поділу
  // "адміністратори / користувачі", без окремої категорії супер-адмінів.
  const roleOptionsHtml = isSuper
    ? `<option value="">Усі ролі</option>
       <option value="user">Користувачі</option>
       <option value="regional_admin">Регіональні адміни</option>
       <option value="super_admin">Супер-адміни</option>`
    : `<option value="">Усі ролі</option>
       <option value="admin">Адміністратори</option>
       <option value="user">Користувачі</option>`;

  let html = '';
  if (pushState.supported) {
    html += pushState.enabled
      ? '<div class="push-status">🔔 Сповіщення на цьому пристрої увімкнено</div>'
      : '<button type="button" class="link-btn push-enable-btn" id="enable-push-btn">🔔 Увімкнути сповіщення на цьому пристрої</button>';
  }
  if (isSuper) {
    html += `
      <div class="price-diag-card">
        <div class="price-diag-header">
          <span>Самодіагностика застосунку</span>
          <button type="button" class="link-btn" id="price-check-btn">🔍 Перевірити зараз</button>
        </div>
        <div class="price-diag-status-line" id="price-diag-status">Перевіряється: ціни й маркування проти Excel, посилання на сайт, картки на сайті, зображення й файли, ролі, курси, версія застосунку.</div>
        <div id="price-diag-coverage">${diagCoverageHtml(lastDiagRun)}</div>
        <div id="price-issues-list">${priceIssuesListHtml(priceIssues)}</div>
      </div>`;
  }
  html += `
    <div class="admin-filters">
      <div class="admin-search"><input type="text" id="admin-search" placeholder="Пошук за іменем або телефоном"></div>
      <div class="admin-filter-row">
        <div class="admin-role-filter"><select id="admin-role-filter">${roleOptionsHtml}</select></div>
        ${isSuper ? `<div class="admin-region-filter"><select id="admin-region-filter"><option value="">Усі регіони</option>${regionOptionsHtml}</select></div>` : ''}
      </div>
    </div>`;
  html += `<div class="admin-section-title">Заявки на розгляді (${pending.length})</div>`;
  html += '<div id="admin-pending-list">' + (pending.length ? pending.map(u => userCardHtml(u, true)).join('') : '<div class="empty" style="padding:16px;">Нових заявок немає</div>') + '</div>';
  html += `<div class="admin-section-title">Користувачі (${others.length})</div>`;
  html += '<div id="admin-users-list">' + (others.length ? others.map(u => userCardHtml(u, false)).join('') : '<div class="empty" style="padding:16px;">Користувачів немає</div>') + '</div>';
  html += '<button class="logout-btn" id="cab-logout-btn">Вийти</button>';

  main.innerHTML = html;
  clearNotificationsAndBadge();

  document.getElementById('cab-logout-btn').addEventListener('click', handleLogout);
  document.getElementById('admin-search').addEventListener('input', rerenderLists);
  document.getElementById('admin-role-filter').addEventListener('change', rerenderLists);
  const regionFilterEl = document.getElementById('admin-region-filter');
  if (regionFilterEl) regionFilterEl.addEventListener('change', rerenderLists);
  const enablePushBtn = document.getElementById('enable-push-btn');
  if (enablePushBtn) enablePushBtn.addEventListener('click', () => enablePushNotifications(profile.id));
  if (isSuper) {
    document.getElementById('price-check-btn').addEventListener('click', () => runManualPriceCheck(profile));
    wirePriceIssueButtons(profile);
  }
}

async function handleAdminAction(action, id, value) {
  if (action === 'delete') {
    if (!confirm('Видалити цього користувача назавжди? Він зможе зареєструватися заново з тим самим номером. Цю дію не можна скасувати.')) return;
    const { data, error } = await sb.functions.invoke('admin-delete-user', { body: { user_id: id } });
    if (error || (data && data.error)) {
      const detail = (data && data.error) || (error && error.message) || 'невідома помилка';
      alert('Не вдалося видалити користувача: ' + detail);
      return;
    }
    renderCabinetTab();
    return;
  }

  let update = null;
  if (action === 'approve') update = { status: 'approved' };
  else if (action === 'reject') update = { status: 'rejected' };
  else if (action === 'block') update = { status: 'blocked' };
  else if (action === 'unblock') update = { status: 'approved' };
  // 'price_type' більше не приходить — вибір прибрано з картки користувача 2026-09-21.
  else if (action === 'role') update = { role: value };
  else return;

  const { error } = await sb.from('profiles').update(update).eq('id', id);
  if (error) {
    alert('Не вдалося зберегти зміни. Спробуйте ще раз.');
    return;
  }
  renderCabinetTab();
}

/* ---------- Перемикання вкладок нижнього меню ---------- */
/* Плавно "переїжджає" індикатор активної вкладки під потрібну кнопку (translateX,
   рахується від позиції кнопки всередині .bottom-nav). Викликається з будь-якого
   місця, що змінює активну вкладку (клік по нав-бару, кнопка "назад" браузера,
   старт застосунку) — це просто візуальна синхронізація з currentTab, а не частина
   логіки навігації. */
function updateNavIndicator(activeBtn) {
  const nav = document.querySelector('.bottom-nav');
  const indicator = document.getElementById('nav-indicator');
  if (!nav || !indicator || !activeBtn) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const x = (btnRect.left - navRect.left) + (btnRect.width - indicator.offsetWidth) / 2;
  indicator.style.transform = 'translateX(' + Math.round(x) + 'px)';
  /* У головної вкладки ("Каталог") індикатора не видно — його б усе одно закрила
     плашка, що виступає вгору. Там роль індикатора грає сама плашка: коли вкладка
     активна, вона заливається суцільним акцентом. */
  indicator.style.opacity = activeBtn.classList.contains('nav-btn-primary') ? '0' : '1';
}

function switchTab(tab, pushHistory) {
  currentTab = tab;
  activeTile = null;
  infoSection = null;
  infoBrand = null;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  updateNavIndicator(document.querySelector('.nav-btn.active'));
  document.getElementById('back-btn').style.display = 'none';
  /* Логотип-заголовок лишається тільки на головній каталогу; renderCatalogView()
     увімкне його назад, якщо ми перейшли саме туди. */
  document.querySelector('header').classList.remove('home-logo');
  document.getElementById('rate-row').style.display = 'none';
  openCalcPanelEl = null;
  closeCartPanel();
  renderCartBar();
  document.getElementById('refresh-icon').style.display = tab === 'catalog' ? 'flex' : 'none';
  document.getElementById('shortcut-icon').style.display = tab === 'cabinet' ? 'flex' : 'none';
  if (tab !== 'catalog') {
    document.getElementById('th-ezy-instruction-btn').style.display = 'none';
    document.getElementById('q-ton-instruction-btn').style.display = 'none';
  }
  document.getElementById('status-row').style.display = 'none';
  document.getElementById('error-block').innerHTML = '';
  if (pushHistory) {
    history.pushState({ tab: tab }, '', '#' + tab);
  }
}

function renderCurrentTab() {
  if (currentTab === 'catalog') {
    if (!catalogInitDone) { catalogInitDone = true; initCatalog(); }
    else renderCatalogView();
    /* Тихо звіряємо доступ при кожному вході в каталог (не частіше ACCESS_RECHECK_MS).
       Якщо адмін заблокував/видалив — ensureAccessFresh сам перемалює список без цін. */
    ensureAccessFresh(false);
  } else if (currentTab === 'promotions') renderPromotionsTab();
  else if (currentTab === 'cabinet') renderCabinetTab();
  /* Старий хеш #contacts (у когось міг лишитись у історії переходів або закладці):
     вкладки більше немає, тому тихо перекидаємо в «Інфо» → «Контакти». */
  else if (currentTab === 'contacts') openContacts(false);
  else if (currentTab === 'info') renderInfoTab();
  else if (currentTab === 'installer') renderInstallerTab();
}

