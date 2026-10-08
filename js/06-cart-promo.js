/* Sun-ice — Панель підбірки, акції
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- "Підбірка" (кошик): плаваюча кнопка і панель ---------- */



/* Делеговані обробники дій у адмін-панелі Кабінету (кнопки й селекти з data-action) */

/* Перерендер Кабінету при зміні стану авторизації (напр., після виходу в іншій вкладці);
   а також перерахунок доступу до цін і перерендер прайсу, якщо він саме зараз відкритий —
   щоб одразу після входу/реєстрації/виходу ціни з'явились чи зникли без ручного оновлення.

   suppressCabinetAutoRerender — захист від гонки станів: sb.auth.signUp()/
   signInWithPassword() у handleRegister()/handleReregister() встановлюють сесію одразу,
   тому цей listener спрацьовує НЕГАЙНО (ще до того, як сам handleRegister() встигне
   записати рядок profiles) і намагається завантажити профіль, якого ще нема — показує
   хибне "Не вдалося завантажити профіль", перезаписуючи форму реєстрації просто в неї
   ще не встиг відпрацювати. handleRegister()/handleReregister() самі викликають
   renderCabinetTab() у потрібний момент (після того, як профіль справді збережено), тому
   на час свого виконання просять цей listener не втручатись. */
let suppressCabinetAutoRerender = false;


/* ---------- Акції ---------- */

/* "Буду мати на увазі" / кулька "Цікава новина".

   ЩО БУЛО ЗЛАМАНО (знайдено при перевірці 2026-09-21)
   Застосунок писав promo_ack_id / promo_last_nag_at прямо в profiles. Але в profiles
   немає політики, яка дозволяє людині оновити ВЛАСНИЙ рядок — лише адмінам. Перевірено
   на живій базі: такий запит оновлював 0 рядків, і помилки при цьому не було
   (supabase-js на відфільтрований RLS-ом рядок виняток не кидає, а `.catch()` тут узагалі
   нічого не ловив). Тобто галочка НЕ ЗБЕРІГАЛАСЬ НІКОЛИ. Тепер запис іде через вузьку
   функцію public.mark_promo_seen — вона міняє рівно дві колонки і рівно у власному
   рядку того, хто дзвонить (див. claude/sql/2026-09-21-promo-balloon-timer.sql).

   ДВА РІЗНІ ТАЙМЕРИ, І ЦЕ НАВМИСНО
   • promo_balloon_last_at — кулька всередині застосунку. Інтервал 5 днів. Повертається
     навіть після галочки (варіант А, обраний користувачем): галочка прибирає кульку
     зараз, але через 5 днів вона нагадає про себе знову.
   • promo_last_nag_at — системні push. Ним керує ВИКЛЮЧНО Edge Function
     send-promo-push, застосунок його більше не торкається. Там усе лишається як було:
     натиснув галочку — push про цю акцію більше не приходить.
   Чому не одне поле: раніше кулька і розсилка ділили promo_last_nag_at і збивали
   таймер одне одному. А зробити push теж «кожні 5 днів назавжди» — вірний спосіб
   змусити людей вимкнути сповіщення застосунку зовсім.

   Гість (не залогінений) — той самий стан у localStorage, суто для показу кульки на
   цьому пристрої: push гостям однаково не надсилається, бо немає push_subscriptions. */
const PROMO_BALLOON_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;
const PROMO_GUEST_KEY = 'sunice_promo_guest';

async function getPromoAckState() {
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;
  let ackId = null, balloonAt = null;
  if (session) {
    const { data: profile } = await sb.from('profiles').select('promo_ack_id, promo_balloon_last_at').eq('id', session.user.id).single();
    if (profile) { ackId = profile.promo_ack_id; balloonAt = profile.promo_balloon_last_at; }
  } else {
    try {
      const raw = localStorage.getItem(PROMO_GUEST_KEY);
      if (raw) { const s = JSON.parse(raw); ackId = s.ackId != null ? s.ackId : null; balloonAt = s.balloonAt || s.lastNagAt || null; }
    } catch (e) {}
  }
  return { session, ackId, balloonAt };
}

async function ackPromo(latestId, session) {
  if (session) {
    // Галочка: запам'ятовуємо акцію, але таймер кульки НЕ зсуваємо — його зсуває сам
    // показ кульки. Інакше галочка відкладала б наступну появу на зайві 5 днів.
    const { error } = await sb.rpc('mark_promo_seen', { p_ack_id: latestId, p_touch_balloon: false });
    if (error) return; // мовчки: це зручність, а не критична дія
  } else {
    try {
      const raw = localStorage.getItem(PROMO_GUEST_KEY);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(PROMO_GUEST_KEY, JSON.stringify({ ackId: latestId, balloonAt: prev.balloonAt || null }));
    } catch (e) {}
  }
}

/* Позначити, що кульку щойно показали — звідси й рахуються 5 днів до наступного разу. */
async function markBalloonShown(ackId, session) {
  if (session) {
    await sb.rpc('mark_promo_seen', { p_ack_id: null, p_touch_balloon: true });
  } else {
    try {
      localStorage.setItem(PROMO_GUEST_KEY, JSON.stringify({ ackId: ackId, balloonAt: new Date().toISOString() }));
    } catch (e) {}
  }
}

/* Глобальна кулька "Цікава новина" — перевіряється один раз при старті застосунку,
   з'являється поверх будь-якої вкладки (не тільки Акції).

   ПРАВИЛО ПОКАЗУ (варіант А, обраний користувачем 2026-09-21): показуємо, якщо кульку
   ще жодного разу не показували АБО від останнього показу минуло 5 днів. Галочка
   «Добре, буду мати на увазі» ховає кульку зараз і вимикає push про цю акцію, але НЕ
   робить її німою назавжди — через 5 днів вона нагадає знову.

   Відоме обмеження, свідомо прийняте: якщо нову акцію опублікують через день після
   того, як кульку показували, вона з'явиться не одразу, а коли доб'ють ці 5 днів. Про
   саму ж нову акцію людина однаково дізнається — на неї одразу йде push (mode: 'new'
   в send-promo-push). Рівно так само поводилась і попередня версія, тільки з 3 днями. */
async function checkPromoBalloon() {
  try {
    const { data: promos, error } = await sb.from('promotions').select('id').eq('is_active', true).order('id', { ascending: false }).limit(1);
    if (error || !promos || !promos.length) return;
    const latestId = promos[0].id;

    const state = await getPromoAckState();
    if (state.balloonAt && (Date.now() - new Date(state.balloonAt).getTime()) < PROMO_BALLOON_INTERVAL_MS) return;

    showPromoBalloon();
    markBalloonShown(state.ackId != null ? state.ackId : latestId, state.session);
  } catch (e) {}
}

function showPromoBalloon() {
  const el = document.getElementById('promo-balloon');
  if (!el) return;
  el.classList.remove('popping');
  el.classList.add('show');
}
function hidePromoBalloon(navigateToPromotions) {
  const el = document.getElementById('promo-balloon');
  if (!el || !el.classList.contains('show')) return;
  el.classList.add('popping');
  setTimeout(function () {
    el.classList.remove('show', 'popping');
  }, 300);
  if (navigateToPromotions) {
    switchTab('promotions', true);
    renderCurrentTab();
  }
}

async function getCurrentProfileRole() {
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData ? sessionData.session : null;
    if (!session) return null;
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single();
    return profile ? profile.role : null;
  } catch (e) {
    return null;
  }
}

