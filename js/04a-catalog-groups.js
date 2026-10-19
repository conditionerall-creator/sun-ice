/* Sun-ice — Згортні блоки серій у прайсі кондиціонерів (2026-10-19)
   Підключається ПІСЛЯ 04-catalog.js і ДО 05-catalog-custom.js, звичайним <script src>
   (без type="module"/defer/async). Лише ОГОЛОШУЄ — виконуваного коду тут немає
   (обробники кліку живуть у 13-start.js, див. CLAUDE.md про js/).

   ЩО РОБИТЬ. Один рядок прайсу = одна позиція, як і раніше. Нове — позиції зібрано в
   «групи»: одна серія (або тип блока) = один блок із шапкою, дотик по шапці
   розкриває/згортає всі типорозміри. Групуються Спліт, Мульти спліт і Напівпром, обидва
   бренди (CG_RULES). Решта розділів малюється як і раніше.

   ДЖЕРЕЛО ГРУП. Парсер (parseSheet у 02-price-parse.js) уже дає groupKey/groupLabel,
   unitType, blockName, sectionLabel — їх і беремо. Рішення власника 2026-10-19:
   • Спліт MHI/GAL, Напівпром MHI/GAL — групи ЯК У ПРАЙСІ (названі в самому прайсі). Єдиний
     виняток — серія ZT: три сусідні сегменти («Premium Series ZT-W R32», «Внутрішні
     кольорові», «Зовнішні чорні») — одна серія, тому зливаються в один блок, а колишні
     сегменти лишаються підзаголовками всередині.
   • Мульти MHI: зовнішні блоки й аксесуари лишаються звичайними відкритими рядками;
     внутрішні — по серіях (настінні ZSP/ZS/ZSX/ZR) і по типах (касетний, канальний…).
   • Мульти GAL: у даних групи немає взагалі — серію (M-W / H-W / H-S) визначає суфікс
     маркування, див. CG_GAL_SERIES. Усередині серії — «Зовнішні блоки» і «Внутрішні блоки».

   ІНВАРІАНТ, ЯКИЙ ЗАХИЩАЄ САМОДІАГНОСТИКА (перевірка «Групи прайсу»): кожна позиція прайсу
   потрапляє в дерево РІВНО ОДИН раз і в ТОМУ САМОМУ порядку. Нічого не ховаємо й не
   переставляємо — тому до ціни це не торкається взагалі. */

const CG_STATE_KEY = 'sunice_cg_open_v1';

const CG_RULES = {
  split_mhi:      { mode: 'labels', mergeKeys: ['ZT'] },
  split_gal:      { mode: 'labels' },
  semi_mhi:       { mode: 'labels' },
  semi_gal:       { mode: 'labels' },
  multisplit_mhi: { mode: 'multi-mhi', keepSections: true },
  multisplit_gal: { mode: 'multi-gal' }
};

/* Внутрішні настінні блоки Мульти MHI: серія видно прямо в маркуванні (SKM20ZSP-W,
   SRK25ZS-WT, SRK50ZSX-W, SRK71ZR-W). Назви — ті самі, що в розділі Спліт-систем
   (там вони дослівно з прайсу). Це ЯВНА таблиця, а не здогадка: що не підійшло —
   групується за типом із прайсу й потрапляє у звіт діагностики. */
const CG_MHI_WALL_SERIES = {
  ZSP: 'Популярний інвертор R32',
  ZS:  'БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32',
  ZSX: 'ТЕПЛОВИЙ НАСОС / БІЗНЕС-КЛАС / ДИЗАЙН СЕРІЯ R32',
  ZR:  'Потужний інвертор R32'
};

/* Мульти GAL: суфікс маркування → серія й фреон (джерело — власник, 2026-10-19).
   M-W — завод Midea, R32; H-W — Hisense, R32; H-S — Hisense, R410. Заводи в
   інтерфейс не виводимо, лише серію й тип фреону. */
const CG_GAL_SERIES = {
  'm-w': { title: 'Серія M-W', freon: 'R32' },
  'h-w': { title: 'Серія H-W', freon: 'R32' },
  'h-s': { title: 'Серія H-S', freon: 'R410' }
};

/* Назви блоків у шапці — ЯВНА таблиця (рішення власника 2026-10-19): «в кожній назві
   маркування серії»; для не настінних блоків — спочатку тип блока, потім маркування, потім
   решта опису. Ключ — назва групи з прайсу (як її дає парсер), значення:
     title — що пише шапка;
     codes — що має бути в КОЖНОМУ маркуванні групи (звіряє самодіагностика: прайс змінився,
             а підпис ні — і шапка збреше про серію);
     exempt — це не серія (пульти): маркування не вимагаємо.
   Маркування серії = те, що в моделі після типорозміру: SRK25ZSP-W1 → ZSP-W1. Для не
   настінних додано сімейство блока: SRR (канальні), SRF (підлогові), FDTC (касети).
   Групи, яких тут немає, показуються за прайсом як є, а діагностика на це скаже. */
const CG_TITLES = {
  split_mhi: {
    'HE': { title: 'HE-S1', codes: ['HE-S1'] },
    'Популярний інвертор R410': { title: 'ZSPR-S · Популярний інвертор R410', codes: ['ZSPR-S'] },
    'Популярний інвертор R32': { title: 'ZSP-W1 · Популярний інвертор R32', codes: ['ZSP-W1'] },
    'Серія ZTL-W R32': { title: 'Серія ZTL-W R32', codes: ['ZTL-W'] },
    'БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32': { title: 'ZS-W · Бізнес-клас дизайн серія R32', codes: ['ZS-W'] },
    'Premium Series ZT-W R32': { title: 'Premium Series ZT-W R32', codes: ['ZT-W'] },
    'Потужний інвертор R32': { title: 'ZR-W · Потужний інвертор R32', codes: ['ZR-W'] },
    'ТЕПЛОВИЙ НАСОС / БІЗНЕС-КЛАС / ДИЗАЙН СЕРІЯ R32': { title: 'ZSX-W · Тепловий насос / бізнес-клас / дизайн серія R32', codes: ['ZSX-W'] },
    'Моделі 2-х потокові підлогового виконання': { title: 'Підлогові · SRF ZS-W / ZSX-W · 2-х потокові', codes: ['ZS-W', 'ZSX-W'] },
    'Моделі канальні R32 DC PAM Inverter': { title: 'Канальні · SRR ZS-W · R32 DC PAM Inverter', codes: ['ZS-W'] },
    'Моделі 4-х потокові компактні касети 600х600': { title: 'Касетні · FDTC VH · 4-х потокові компактні 600х600', codes: ['VH'] },
    'Пульти': { title: 'Пульти', exempt: true }
  },
  split_gal: {
    'Моделі INFINI INVERTER Фреон R32.': { title: 'SH-W · INFINI INVERTER · фреон R32', codes: ['SH-W'] },
    'Моделі VEGA INVERTER Фреон R32.': { title: 'A-W · VEGA INVERTER · фреон R32', codes: ['A-W'] },
    'Моделі Proxima INVERTER Фреон R32.': { title: 'M-W · Proxima INVERTER · фреон R32', codes: ['M-W'] },
    'Моделі Orient INVERTER Фреон R410.': { title: 'HF-S · Orient INVERTER · фреон R410', codes: ['HF-S'] }
  },
  semi_mhi: {
    'Настінні SRK': { title: 'Настінні SRK', codes: ['SRK'] },
    'Стельові FDE': { title: 'Стельові FDE', codes: ['FDE'] },
    'Касетні 4-потокові FDT': { title: 'Касетні 4-потокові FDT', codes: ['FDT'] },
    'Касетні компактні FDTC': { title: 'Касетні компактні FDTC', codes: ['FDTC'] },
    'Канальні середнього тиску FDUM': { title: 'Канальні середнього тиску FDUM', codes: ['FDUM'] },
    'Канальні високого тиску FDU': { title: 'Канальні високого тиску FDU', codes: ['FDU'] },
    'Колонні FDF': { title: 'Колонні FDF', codes: ['FDF'] }
  },
  semi_gal: {
    'Касетний': { title: 'Касетний · GBZ MLQ-W', codes: ['GBZ'] },
    'Канальний': { title: 'Канальний · GDZ MLQ-W', codes: ['GDZ'] },
    'Підлогово-стельовий': { title: 'Підлогово-стельовий · GFZ MLQ-W', codes: ['GFZ'] }
  },
  multisplit_mhi: {
    'Популярний інвертор R32': { title: 'ZSP-W · Популярний інвертор R32', codes: ['ZSP-W'] },
    'БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32': { title: 'ZS-W · Бізнес-клас дизайн серія R32', codes: ['ZS-W'] },
    'ТЕПЛОВИЙ НАСОС / БІЗНЕС-КЛАС / ДИЗАЙН СЕРІЯ R32': { title: 'ZSX-W · Тепловий насос / бізнес-клас / дизайн серія R32', codes: ['ZSX-W'] },
    'Потужний інвертор R32': { title: 'ZR-W · Потужний інвертор R32', codes: ['ZR-W'] },
    'Касетний без панелі': { title: 'Касетний без панелі · FDTC VH', codes: ['FDTC'] },
    'Підстельовий': { title: 'Підстельовий · FDE VH', codes: ['FDE'] },
    'Канальний середнього тиску': { title: 'Канальний середнього тиску · FDUM VH', codes: ['FDUM'] },
    'Канальний': { title: 'Канальний · SRR ZS-W', codes: ['SRR'] },
    'Підлоговий': { title: 'Підлоговий · SRF ZS-W / ZSX-W', codes: ['SRF'] }
  }
  /* multisplit_gal: серія й фреон уже в назві («Серія M-W» + «Фреон R32») — CG_GAL_SERIES. */
};

/* Позиції, що за рішенням власника належать до сусідньої групи, хоч у прайсі стоять окремо.
   Чіпляються ЛИШЕ коли йдуть одразу за своєю групою (порядок прайсу не міняємо); інакше
   лишаються самі, як були. parent — назва групи з прайсу; label — підзаголовок усередині. */
const CG_ATTACH = {
  split_mhi: [{
    parent: 'Моделі канальні R32 DC PAM Inverter',
    test: it => cgText(it.groupLabel || it.groupKey) === 'Комплект для забору повітря знизу (опція)',
    label: 'Комплект для забору повітря знизу (опція)'
  }],
  multisplit_mhi: [{
    parent: 'Касетний без панелі',
    test: it => cgText(it.blockName) === 'Панель для касетних блоків',
    label: 'Панель для касетних блоків'
  }]
};

/* Примітка з прайсу стоїть біля однієї групи, а стосується іншої: «Пульт для касетного блоку
   замовляється додатково як опція!» парсер вішає на «Пульти», а йдеться про касети (рішення
   власника 2026-10-19). Переносимо у верх тіла тієї групи, якої вона стосується. */
const CG_NOTE_MOVES = {
  split_mhi: [{ from: 'Пульти', to: 'Моделі 4-х потокові компактні касети 600х600' }]
};

/* ---------- Дрібні помічники (чисті) ---------- */
function cgText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function cgSlug(s) {
  return cgText(s).toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'g';
}

/* Назви в прайсі місцями написані ВЕЛИКИМИ («БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32»); у шапці
   17–19 px це кричить. Показуємо лише акуратніше, дані не міняємо: слова з цифрами (R32,
   R410, ZT-W2) лишаємо як є. Короткі коди на кшталт «HE» не чіпаємо. */
function cgPretty(label) {
  const t = cgText(label);
  if (/[a-zа-яіїєґ]/.test(t) || t.length < 8 || t.indexOf(' ') < 0) return t;
  const out = t.split(' ').map(w => /\d/.test(w) ? w : w.toLowerCase()).join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* Типорозмір = число в маркуванні після літерного префікса: SRK25ZSP-W1 → 25,
   FDTC50VH → 50, «SRK71ZR-W + FDC71VNX-W» → 71 (береться перша частина), GKM09M-W → 09,
   GMZ2-14M-W → 14 (зовнішній блок Мульти GAL). Аксесуари (RC-E5, T-PSA-5AW-E, UM-FL1EF,
   «Wi-Fi модуль…») під шаблон не підпадають — і в діапазон не входять. Повертаємо
   ТЕКСТ як у маркуванні («09», не «9»). */
function cgCapacity(model) {
  const m = String(model == null ? '' : model).trim();
  /* Справжні маркування — великі літери й цифри. Слово з малих літер («RG10D Remote
     controller, арт. …») — це опис аксесуара, навіть якщо починається «як маркування». */
  if (/[a-zа-яіїєґ]{3,}/.test(m)) return null;
  let x = /^[A-Z]{2,4}(\d{2,3})(?!\d)/.exec(m);
  if (!x) x = /^[A-Z]{2,4}\d-(\d{2,3})(?!\d)/.exec(m);
  return x ? { n: parseInt(x[1], 10), text: x[1] } : null;
}

function cgSizesRange(models) {
  let lo = null, hi = null;
  models.forEach(m => {
    const c = cgCapacity(m);
    if (!c) return;
    if (!lo || c.n < lo.n) lo = c;
    if (!hi || c.n > hi.n) hi = c;
  });
  if (!lo) return '';
  return lo.n === hi.n ? lo.text : lo.text + '–' + hi.text;
}

/* «1 позиція», «2–4 позиції», «5+ позицій», і 11–14 — теж «позицій». */
function cgCountText(n) {
  const a = n % 100, b = n % 10;
  const word = (a >= 11 && a <= 14) ? 'позицій' : b === 1 ? 'позиція' : (b >= 2 && b <= 4) ? 'позиції' : 'позицій';
  return n + ' ' + word;
}


/* ---------- Шапка групи: серія, маркування, типорозміри (2026-10-19) ----------
   Рішення власника: у шапці групи має стояти те саме, що в таблиці «МОДЕЛЬНИЙ РЯД»
   на стор. 6 каталогу — назва серії з шестикутника плюс маркування; для не
   настінних блоків замість назви серії — тип блока. Замість «7 позицій» —
   перелік типорозмірів усередині.

   Джерело — той самий data/mhi-catalog.json, що живить панель товару: інакше
   шапка й картка товару почали б розходитись. Серій, яких у каталозі ще немає
   (Galactic, напівпром), це не стосується — там лишається назва з прайсу. */
/* Файл каталогу вантажиться лише раз і лише в розділах MHI. Поки його немає,
   шапки малюються як раніше (назва з прайсу) — список не чекає мережі; коли
   приїхав, перемальовуємо один раз. */
let cgCatalogAsked = false;
function cgEnsureCatalog(cfgKey) {
  if (cgCatalogAsked || typeof loadMhiCatalog !== 'function') return;
  if (!/_mhi$/.test(cfgKey)) return;
  cgCatalogAsked = true;
  loadMhiCatalog().then(function (c) { if (c) renderCatalogList(); });
}

function cgCatalogCard(models) {
  if (typeof mhiCatalog === 'undefined' || !mhiCatalog) return null;
  /* Спершу серія з розібраної таблиці (там і сторінка, і дані), потім — картка
     з «МОДЕЛЬНОГО РЯДУ». Картки покривають і мульти спліт-системи, таблиці яких
     ще не розібрані: назва серії й тип блока від пари блоків не залежать. */
  for (let i = 0; i < models.length; i++) {
    const ref = mhiCatalog.index && mhiCatalog.index[catKey(models[i])];
    if (!ref) continue;
    const sr = mhiCatalog.series[String(ref).split('|')[0]];
    if (sr) return sr;
  }
  const cards = mhiCatalog.cards || [];
  for (let i = 0; i < models.length; i++) {
    const m = psKey(models[i]);
    for (let j = 0; j < cards.length; j++) {
      if (new RegExp(cards[j].re).test(m)) return cards[j];
    }
  }
  return null;
}

/* Типорозміри групи: «20 · 25 · 35 · 50 · 60». Беремо число з маркування тим самим
   cgCapacity(), що й діапазон, тому аксесуари (пульти, модулі) сюди не потрапляють. */
function cgTypeSizes(models) {
  const seen = [];
  models.forEach(m => {
    const c = cgCapacity(m);
    if (c && !seen.some(x => x.n === c.n)) seen.push(c);
  });
  seen.sort((a, b) => a.n - b.n);
  return seen.map(x => x.text);
}

/* ---------- Класифікація однієї позиції ----------
   Повертає опис групи або null — тоді позиція лишається звичайним відкритим рядком.
     id        — стійкий ідентифікатор групи в межах аркуша (НЕ індекс і не сам заголовок)
     title     — назва в шапці; null → взяти block першої позиції (злиті групи)
     subtitle  — рядок під назвою (до нього дописуються типорозміри)
     block     — підзаголовок усередині групи (null — без підзаголовка) */
function cgClassify(cfgKey, it) {
  const rule = CG_RULES[cfgKey];
  if (!rule) return null;
  const model = cgText(it.model);

  if (rule.mode === 'labels') {
    const eff = cgText(it.groupLabel || it.groupKey);
    if (!eff) return null;
    if (rule.mergeKeys && it.groupKey && rule.mergeKeys.indexOf(it.groupKey) >= 0) {
      return { id: 'key-' + cgSlug(it.groupKey), title: null, block: eff, merged: true };
    }
    return { id: 'g-' + cgSlug(eff), title: eff, block: null };
  }

  if (rule.mode === 'multi-mhi') {
    if (it.unitType !== 'indoor') return null;          // зовнішні блоки й аксесуари — рядками
    const m = /^(SKM|SRK)\d{2,3}(ZSP|ZSX|ZS|ZR)-/.exec(model);
    if (m && CG_MHI_WALL_SERIES[m[2]]) {
      return { id: 'wall-' + m[2].toLowerCase(), title: CG_MHI_WALL_SERIES[m[2]], block: null };
    }
    const type = cgText(it.groupKey || it.blockName);
    if (!type) return null;
    return { id: 'type-' + cgSlug(type), title: type, block: null };
  }

  if (rule.mode === 'multi-gal') {
    const m = /([MH])\d?G?-(W|S)R?$/i.exec(model);   // GMZ5-42M7-W, GKZ09MG-WR, GKM09M-WR
    const s = m ? CG_GAL_SERIES[(m[1] + '-' + m[2]).toLowerCase()] : null;
    if (!s) return null;
    const id = (m[1] + '-' + m[2]).toLowerCase();
    return { id: 'gal-' + id, title: s.title, subtitle: 'Фреон ' + s.freon,
             block: it.unitType === 'outdoor' ? 'Зовнішні блоки' : it.unitType === 'indoor' ? 'Внутрішні блоки' : null,
             perBlockSizes: true, marked: true };
  }
  return null;
}

/* ---------- Дерево: розділ → вузли ----------
   Вузол: { type:'section', label } | { type:'row', item, index } | { type:'group', … }.
   Порядок вузлів і позицій у них — рівно порядок прайсу. Якщо серія «розірвана»
   (та сама група двічі в різних місцях), друга частина отримує id з «~2» і прапорець
   split — позицію не губимо й порядок не міняємо, а діагностика про це скаже. */
function cgBuildNodes(cfgKey, items) {
  const rule = CG_RULES[cfgKey];
  if (!rule) return null;
  const nodes = [];
  const runs = {};
  let cur = null;
  (items || []).forEach((it, index) => {
    /* Позиція, що належить сусідній групі (комплект забору повітря → канальні; панель →
       касетні без панелі): додається до неї окремим підблоком, якщо йде одразу за нею. */
    const att = (CG_ATTACH[cfgKey] || []).find(a => a.test(it));
    if (att && cur && cur.rawTitle === att.parent) {
      let ab = cur.blocks[cur.blocks.length - 1];
      if (!ab || ab.label !== att.label) { ab = { label: att.label, entries: [] }; cur.blocks.push(ab); }
      const aentry = { item: it, index: index };
      ab.entries.push(aentry);
      cur.entries.push(aentry);
      return;
    }
    const d = cgClassify(cfgKey, it);
    if (!d) {
      cur = null;
      if (rule.keepSections && it.sectionLabel) nodes.push({ type: 'section', label: it.sectionLabel });
      nodes.push({ type: 'row', item: it, index: index });
      return;
    }
    if (!cur || cur.baseId !== d.id) {
      if (rule.keepSections && it.sectionLabel) nodes.push({ type: 'section', label: it.sectionLabel });
      runs[d.id] = (runs[d.id] || 0) + 1;
      cur = { type: 'group', baseId: d.id, id: runs[d.id] > 1 ? d.id + '~' + runs[d.id] : d.id,
              split: runs[d.id] > 1, d: d, blocks: [], entries: [],
              rawTitle: d.title != null ? cgText(d.title) : cgText(d.block) };
      nodes.push(cur);
    }
    const blockLabel = d.block == null ? null : d.block;
    let blk = cur.blocks[cur.blocks.length - 1];
    if (!blk || blk.label !== blockLabel) { blk = { label: blockLabel, entries: [] }; cur.blocks.push(blk); }
    const entry = { item: it, index: index };
    blk.entries.push(entry);
    cur.entries.push(entry);
  });
  nodes.forEach(n => { if (n.type === 'group') cgFinishGroup(n, rule, cfgKey); });
  (CG_NOTE_MOVES[cfgKey] || []).forEach(mv => {
    const from = nodes.find(n => n.type === 'group' && n.rawTitle === mv.from);
    const to = nodes.find(n => n.type === 'group' && n.rawTitle === mv.to);
    if (!from || !to || !from.note) return;
    to.note = to.note ? to.note + ' ' + from.note : from.note;
    from.note = '';
  });
  return nodes;
}

function cgFinishGroup(g, rule, cfgKey) {
  const first = g.entries[0].item;
  /* Назва з явної таблиці (маркування серії + тип блока); якщо групи там немає — як у
     прайсі, а діагностика скаже, що маркування серії не вказано. */
  const T = (CG_TITLES[cfgKey] || {})[g.rawTitle] || null;
  g.title = T ? T.title : cgPretty(g.rawTitle);
  g.codes = T && T.codes ? T.codes : [];
  g.marked = !!(T && !T.exempt) || !!g.d.marked;
  g.exempt = !!(T && T.exempt);
  g.count = g.entries.length;
  /* Підзаголовок блока, що збігається з назвою групи з прайсу (перший сегмент злитої серії),
     не повторюємо — це та сама назва. */
  g.blocks.forEach(b => {
    if (b.label != null && cgText(b.label) === g.rawTitle) b.label = null;
    else if (b.label != null) b.label = cgPretty(b.label);
  });
  const models = g.entries.map(e => e.item.model);
  g.sizes = g.d.perBlockSizes ? '' : cgSizesRange(models);
  g.blocks.forEach(b => { b.sizes = g.d.perBlockSizes ? cgSizesRange(b.entries.map(e => e.item.model)) : ''; });
  g.subtitle = [g.d.subtitle, g.sizes ? 'типорозміри ' + g.sizes : ''].filter(Boolean).join(' · ');
  const noted = g.entries.find(e => e.item.groupNote);
  g.note = noted ? noted.item.groupNote : '';
  /* Інформація про серію — як і раніше: лише коли повний опис із прайсу суттєво більший
     за сам заголовок (щоб вікно не повторювало той самий короткий текст). */
  g.info = null;
  for (let i = 0; i < g.entries.length; i++) {
    const it = g.entries[i].item;
    const eff = cgText(it.groupLabel || it.groupKey);
    if (it.groupFullText && String(it.groupFullText).trim().length > eff.length + 15) {
      g.info = { key: eff, text: String(it.groupFullText).trim() };
      break;
    }
  }
}

/* Плоский список індексів у порядку обходу дерева — для перевірки «нічого не втрачено». */
function cgFlatIndexes(nodes) {
  const out = [];
  (nodes || []).forEach(n => {
    if (n.type === 'row') out.push(n.index);
    else if (n.type === 'group') n.entries.forEach(e => out.push(e.index));
  });
  return out;
}

/* ---------- Стан «розгорнуто/згорнуто» ----------
   Лише в межах вкладки (sessionStorage) — рішення з завдання; на сервері нічого. Ключ =
   ключ аркуша (розділ+бренд) + стійкий id групи, НЕ індекс і не текст заголовка. Те, чого
   ще немає в стані, — згорнуте (нові групи після оновлення прайсу). */
let cgOpenState = null;
let cgUidSeq = 0;
const cgRegistry = new Map();   // uid → { cartKeys }, перезаповнюється при кожному рендері

function cgLoadState() {
  if (cgOpenState) return cgOpenState;
  let parsed = null;
  try { parsed = JSON.parse(sessionStorage.getItem(CG_STATE_KEY) || 'null'); } catch (e) { parsed = null; }
  cgOpenState = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  return cgOpenState;
}
function cgSaveState() {
  try { sessionStorage.setItem(CG_STATE_KEY, JSON.stringify(cgOpenState || {})); } catch (e) {}
}
function cgIsOpen(key) { return cgLoadState()[key] === 1; }
function cgSetOpen(key, open) {
  const s = cgLoadState();
  if (open) s[key] = 1; else delete s[key];
  cgSaveState();
}
/* Прибирає з пам'яті ключі цього аркуша, яких у прайсі вже немає (серія зникла чи
   перейменована), не чіпаючи решти. */
function cgPrune(prefix, validKeys) {
  const s = cgLoadState();
  let changed = false;
  Object.keys(s).forEach(k => {
    if (k.indexOf(prefix) === 0 && !validKeys[k]) { delete s[k]; changed = true; }
  });
  if (changed) cgSaveState();
}

/* ---------- Малювання ---------- */
function cgGroupHtml(cfg, g) {
  const uid = ++cgUidSeq;
  const key = cfg.key + '|' + g.id;
  const open = cgIsOpen(key);
  const cartKeys = Array.from(new Set(g.entries.map(e => activeTile + '|' + activeBrand + '|' + e.item.model)));
  cgRegistry.set(String(uid), { cartKeys: cartKeys });
  const selected = hasFullAccess ? cartKeys.filter(k => cartQtyFor(k) > 0).length : 0;

  let infoBtn = '';
  if (g.info) {
    const idx = seriesInfoTexts.length;
    seriesInfoTexts.push(catalogSeriesInfoEntry(g.info.key, g.info.text));
    infoBtn = '<button type="button" class="sg-info" data-info-idx="' + idx + '" aria-label="Інформація про серію: ' +
      escapeHtml(g.title) + '">ⓘ</button>';
  }
  const body = g.blocks.map(b => {
    const head = b.label
      ? '<div class="sg-subhead">' + escapeHtml(b.label) + (b.sizes ? ' · ' + escapeHtml(b.sizes) : '') + '</div>'
      : '';
    return head + b.entries.map(e => catalogRowHtml(e.item, e.index, { grouped: true })).join('');
  }).join('');
  const note = g.note ? '<div class="sg-note">' + escapeHtml(g.note) + '</div>' : '';

  /* Назва: якщо серія є в каталозі MHI — «бейдж + маркування», як на стор. 6.
     Для настінних у бейджі назва серії (Diamond Series), для решти — тип блока
     (Канальний, Касетний, Підлоговий): шестикутник із назвою серії там не
     інформативний, людині важливіше, який це блок. */
  const models = [];
  g.blocks.forEach(b => b.entries.forEach(e => models.push(e.item.model)));
  const card = cgCatalogCard(models);
  const badge = card ? (card.block === 'Настінний' ? card.series : card.block) : '';

  /* «7 позицій» → перелік типорозмірів (рішення власника 2026-10-19): дилеру
     важливо, які потужності всередині, а не скільки рядків. Стоїть ПІД
     маркуванням, а не праворуч: рядок задовгий, і в правій колонці він
     стискав маркування в три рядки. Праворуч лишається тільки «Вибрано».
     Групи без типорозмірів (пульти, аксесуари) показують кількість, як раніше. */
  const sizes = cgTypeSizes(models);
  const sizesText = sizes.length ? 'Типорозміри: ' + sizes.join(' · ') : cgCountText(g.count);

  /* Назва: якщо серія є в каталозі MHI — «бейдж + маркування», як у таблиці
     «МОДЕЛЬНИЙ РЯД» на стор. 6. Для настінних у бейджі назва серії (Diamond
     Series), для решти — тип блока (Канальний, Касетний, Підлоговий): назва
     серії там не інформативна, людині важливіше, який це блок.
     Третім рядком лишається опис із прайсу — у ньому те, чого в каталозі немає
     («тепловий насос», «бізнес-клас»). */
  const titleHtml = card
    ? '<span class="sg-title"><span class="sg-badge">' + escapeHtml(badge) + '</span>' +
        '<span class="sg-mark">' + escapeHtml(card.marking) + '</span></span>' +
      '<span class="sg-sub">' + escapeHtml(sizesText) + '</span>' +
      '<span class="sg-desc">' + escapeHtml(cgPretty(g.title)) + '</span>'
    : '<span class="sg-title">' + escapeHtml(g.title) + '</span>' +
      (g.subtitle ? '<span class="sg-sub">' + escapeHtml(g.subtitle) + '</span>' : '') +
      '<span class="sg-sub">' + escapeHtml(sizesText) + '</span>';

  return '<section class="sg' + (open ? ' open' : '') + '"' +
      ' data-sg-uid="' + uid + '" data-sg-key="' + escapeHtml(key) + '">' +
    '<div class="sg-head">' +
      '<button type="button" class="sg-toggle" id="sg-h-' + uid + '" aria-expanded="' + (open ? 'true' : 'false') +
        '" aria-controls="sg-b-' + uid + '" aria-describedby="sg-m-' + uid + '">' +
        titleHtml +
      '</button>' + infoBtn +
      '<span class="sg-meta" id="sg-m-' + uid + '">' +
        '<span class="sg-sel"' + (selected ? '' : ' hidden') + '>Вибрано: ' + selected + '</span>' +

      '</span>' +
      '<span class="sg-chev" aria-hidden="true"></span>' +
    '</div>' +
    '<div class="sg-body" id="sg-b-' + uid + '" role="region" aria-labelledby="sg-h-' + uid + '"' + (open ? '' : ' inert') + '>' +
      '<div class="sg-body-inner">' + note + body + '</div>' +
    '</div>' +
  '</section>';
}

/* Весь список розділу: HTML із групами. Викликається з renderCatalogList(). */
function cgRenderListHtml(cfg, items, animate) {
  cgEnsureCatalog(cfg && cfg.key);
  cgRegistry.clear();
  const nodes = cgBuildNodes(cfg.key, items);
  const valid = {};
  let rowNo = 0;
  const html = nodes.map(n => {
    if (n.type === 'section') return '<div class="section-label">' + escapeHtml(n.label) + '</div>';
    if (n.type === 'row') return catalogRowHtml(n.item, n.index, { animate: animate, rowNo: rowNo++ });
    valid[cfg.key + '|' + n.id] = 1;
    return cgGroupHtml(cfg, n);
  }).join('');
  cgPrune(cfg.key + '|', valid);
  return html;
}

/* Розгорнути/згорнути одну групу — без перемальовування сторінки. */
function cgToggle(sg, force) {
  const btn = sg.querySelector('.sg-toggle');
  const body = sg.querySelector('.sg-body');
  if (!btn || !body) return;
  const open = typeof force === 'boolean' ? force : !sg.classList.contains('open');
  /* Згортаємо групу, де зараз фокус, — повертаємо його на шапку, інакше він лишився б
     в «неживому» вмісті. */
  if (!open && body.contains(document.activeElement)) btn.focus({ preventScroll: true });
  sg.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) body.removeAttribute('inert'); else body.setAttribute('inert', '');
  cgSetOpen(sg.getAttribute('data-sg-key'), open);
}

/* «Вибрано: N» у шапках — після будь-якої зміни підбірки (викликається з renderCartBar). */
function cgRefreshSelected() {
  const main = document.getElementById('main');
  if (!main) return;
  main.querySelectorAll('.sg[data-sg-uid]').forEach(sg => {
    const reg = cgRegistry.get(sg.getAttribute('data-sg-uid'));
    const sel = sg.querySelector('.sg-sel');
    if (!reg || !sel) return;
    const n = hasFullAccess ? reg.cartKeys.filter(k => cartQtyFor(k) > 0).length : 0;
    sel.textContent = 'Вибрано: ' + n;
    sel.hidden = n === 0;
  });
}

/* Перехід із загального пошуку до конкретної позиції: спершу розкриваємо її групу
   (у збереженому стані — людина дивитиметься на цей розділ), потім його малює
   renderCatalogView(), а revealFoundRow() докручує до рядка. */
function cgOpenGroupForItem(cfgKey, itemIndex) {
  const items = (typeof sheetsData !== 'undefined' && sheetsData && sheetsData[cfgKey]) || [];
  const nodes = cgBuildNodes(cfgKey, items);
  if (!nodes) return;
  const g = nodes.find(n => n.type === 'group' && n.entries.some(e => e.index === itemIndex));
  if (g) cgSetOpen(cfgKey + '|' + g.id, true);
}
