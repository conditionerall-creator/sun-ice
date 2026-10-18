/* Sun-ice — Прайс: завантаження й публікація з кабінету (лише super_admin).

   План і рішення — claude/price-publish/00-ПЛАН-І-СТАТУС.md.

   ЩО ЦЕ. Досі прайс качав і розбирав КОЖЕН телефон (price.xlsx, 10,6 МБ). Тут
   супер-адмін завантажує Excel один раз, застосунок розбирає його ТИМ САМИМ кодом,
   що й завжди (buildSheetsData з js/02-price-parse.js), показує, що саме зміниться,
   і лише після підтвердження публікує готові дані в Supabase.

   ЧОМУ ОКРЕМИЙ ФАЙЛ, а не модуль у js/: той самий приём, що й stock.js —
   підвантажується динамічно і ТІЛЬКИ супер-адміну (їх четверо з 34). Дилерам цей
   код не потрібен, і в js/ йому робити нічого.

   ЧОГО ТУТ СВІДОМО НЕМАЄ: власного розбірника Excel. Розбір мусить лишатись байт
   у байт тим самим, інакше звірка «старе = нове» втрачає будь-який сенс
   (обґрунтування — розділ 7 плану).

   ПОРЯДОК ПУБЛІКАЦІЇ, і він важливий:
     1) файл кладеться в Storage (щоб ще не оновлені телефони отримали той самий прайс),
     2) потім створюється чернетка,
     3) потім публікація, яка одночасно перемикає покажчик і піднімає price_meta.version.
   Якщо впаде крок 1 — нічого не опубліковано, у всіх лишається стара версія.
*/
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* ЧИСТА ЛОГІКА — нижче немає жодного звернення до DOM чи мережі,    */
  /* щоб її можна було ганяти в Node:                                  */
  /*   node claude/price-publish/tests/price-admin.test.mjs            */
  /* ---------------------------------------------------------------- */

  /* Пороги попереджень. ⚠️ Числа погоджувати з власником — вони вирішують, коли
     публікація вимагає окремого підтвердження. Поки взяті з запасом:
     зміна ціни на 10 % — це вже привід подивитись очима, а зникнення десятої
     частини позицій зазвичай означає не «прибрали товар», а збій у файлі. */
  const BIG_CHANGE_PCT = 10;
  const MASS_REMOVE_PCT = 10;

  /* Ціна позиції для порівняння. Три різні стани НЕ плутаємо (вимога ТЗ):
       число   — справжня ціна,
       null    — ціни немає зовсім,
       'запит' — «за запитом» (onRequest), це НЕ нуль і не відсутність.
     Саме тому справжній 0 лишається числом і при переході 0 → 100 ми побачимо
     зміну, а не «ціна з'явилась». */
  function priceOf(it) {
    if (!it) return null;
    if (it.onRequest) return 'запит';
    const p = it.price;
    return (typeof p === 'number' && isFinite(p)) ? p : null;
  }

  function statsFromSheets(data) {
    const out = { sections: {}, total: 0 };
    Object.keys(data || {}).forEach(function (k) {
      const arr = data[k];
      if (!Array.isArray(arr)) return;
      out.sections[k] = arr.length;
      out.total += arr.length;
    });
    return out;
  }

  /* Індекс «маркування → позиція». Дублікати маркувань у межах розділу — не
     рідкість (однакова модель у двох групах), тому беремо ПЕРШУ і окремо рахуємо,
     скільки разів маркування зустрілось: це саме по собі привід показати
     попередження, якщо дублікатів раптом стало більше. */
  function indexItems(arr) {
    const m = new Map();
    const dups = [];
    (arr || []).forEach(function (it) {
      const key = String((it && it.model) || '').trim();
      if (!key) return;
      if (m.has(key)) { dups.push(key); return; }
      m.set(key, it);
    });
    return { map: m, dups: dups };
  }

  function diffSheets(prev, next) {
    const res = {
      added: 0, removed: 0, changed: 0,
      sectionsLost: [], sectionsNew: [], big: [], perSection: {}, duplicates: []
    };
    const keys = {};
    Object.keys(prev || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(next || {}).forEach(function (k) { keys[k] = true; });

    Object.keys(keys).forEach(function (k) {
      const a = Array.isArray(prev && prev[k]) ? prev[k] : null;
      const b = Array.isArray(next && next[k]) ? next[k] : null;
      const beforeN = a ? a.length : 0;
      const afterN = b ? b.length : 0;

      if (beforeN > 0 && afterN === 0) res.sectionsLost.push(k);
      if (beforeN === 0 && afterN > 0) res.sectionsNew.push(k);

      const ia = indexItems(a), ib = indexItems(b);
      /* Про дублікати маркувань попереджаємо, ЛИШЕ якщо їх побільшало.
         Інакше це постійна фальшива тривога: у «Напівпромислових MHI» в колонці
         моделі лежать описи пультів («RC-E5, дротовий пульт»), і вони законно
         повторюються — на справжньому прайсі таких «дублікатів» 25, і вони там
         були завжди. Екран показує, ЩО ЗМІНИТЬСЯ, тож і міряти треба зміну
         (знайдено на справжньому прайсі 2026-10-18). */
      if (ib.dups.length > ia.dups.length) {
        res.duplicates.push({
          section: k, count: ib.dups.length, before: ia.dups.length,
          added: ib.dups.length - ia.dups.length, sample: ib.dups.slice(0, 3)
        });
      }

      let add = 0, rem = 0, chg = 0;
      ib.map.forEach(function (item, key) {
        if (!ia.map.has(key)) { add++; return; }
        const p1 = priceOf(ia.map.get(key));
        const p2 = priceOf(item);
        if (p1 === p2) return;
        chg++;
        if (typeof p1 === 'number' && typeof p2 === 'number' && p1 > 0) {
          const pct = Math.abs(p2 - p1) / p1 * 100;
          if (pct >= BIG_CHANGE_PCT) res.big.push({ section: k, model: key, from: p1, to: p2, pct: pct });
        } else {
          /* Поява/зникнення ціни або перехід у «за запитом» — завжди помітна подія,
             відсотків тут не порахувати. */
          res.big.push({ section: k, model: key, from: p1, to: p2, pct: null });
        }
      });
      ia.map.forEach(function (item, key) { if (!ib.map.has(key)) rem++; });

      res.added += add; res.removed += rem; res.changed += chg;
      res.perSection[k] = { before: beforeN, after: afterN, added: add, removed: rem, changed: chg };
    });

    res.big.sort(function (x, y) { return (y.pct === null ? 1e9 : y.pct) - (x.pct === null ? 1e9 : x.pct); });
    return res;
  }

  /* Вердикт: чи можна публікувати. Блокери — це не «попередження суворішим
     шрифтом», а заборона: кнопка публікації просто не вмикається. */
  function verdictFor(stats, diff, problems, prevStats, labelFn) {
    const blockers = [], warnings = [];
    /* labelFn — людська назва розділу. Необов'язкова: у тестах (Node) плиток
       застосунку немає, і ключ там цілком читабельний. */
    const L = labelFn || function (k) { return k; };

    if (!stats || !stats.total) {
      blockers.push('Прайс порожній — не розпізналось жодної позиції.');
    }
    (problems || []).forEach(function (p) {
      blockers.push('Не вдалося розпізнати: ' + p);
    });
    (diff.sectionsLost || []).forEach(function (k) {
      blockers.push('Розділ «' + L(k) + '» зник цілком — раніше позиції були, тепер жодної.');
    });

    const prevTotal = (prevStats && prevStats.total) || 0;
    if (prevTotal > 0 && diff.removed > 0) {
      const pct = diff.removed / prevTotal * 100;
      if (pct >= MASS_REMOVE_PCT) {
        warnings.push('Зникло ' + diff.removed + ' позицій (' + pct.toFixed(1) + ' % від попереднього прайсу). ' +
                      'Перевірте, чи це справді прибрані товари, а не збій у файлі.');
      }
    }
    if (diff.big && diff.big.length) {
      warnings.push('Позицій із помітною зміною ціни: ' + diff.big.length +
                    ' (від ' + BIG_CHANGE_PCT + ' % і більше, або ціна з\'явилась/зникла).');
    }
    (diff.sectionsNew || []).forEach(function (k) {
      warnings.push('З\'явився новий розділ «' + L(k) + '».');
    });
    (diff.duplicates || []).forEach(function (d) {
      warnings.push('У розділі «' + L(d.section) + '» побільшало повторів маркувань: було ' +
                    d.before + ', стало ' + d.count + ' (напр. ' + d.sample.join(', ') + ').');
    });

    return { blockers: blockers, warnings: warnings, canPublish: blockers.length === 0 };
  }

  /* Версія для СТАРИХ клієнтів: ціле число-дата, як було домовлено (20260911 =
     11.09.2026). Беремо день публікації. Старі телефони звіряються саме з нею. */
  function legacyVersionFor(date) {
    const d = date || new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return Number('' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()));
  }

  const pure = {
    priceOf: priceOf,
    statsFromSheets: statsFromSheets,
    diffSheets: diffSheets,
    verdictFor: verdictFor,
    legacyVersionFor: legacyVersionFor,
    BIG_CHANGE_PCT: BIG_CHANGE_PCT,
    MASS_REMOVE_PCT: MASS_REMOVE_PCT
  };

  /* У Node далі йти нема куди — там немає ні DOM, ні Supabase. */
  if (typeof document === 'undefined') {
    root.PriceAdmin = Object.assign({}, pure);
    return;
  }

  /* ---------------------------------------------------------------- */
  /* ДАЛІ — екран кабінету                                             */
  /* ---------------------------------------------------------------- */

  const esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  const PRICE_OBJECT = 'price.xlsx';

  /* Людська назва розділу замість внутрішнього ключа. Беремо з CATALOG_TILES —
     руками дублювати не можна: перейменують плитку, а тут лишиться старе.
     Для розділів, яких у плитках немає (кастомні аркуші), лишаємо ключ як є:
     це краще, ніж вигадати назву, якої користувач ніде більше не бачить. */
  let sectionLabels = null;
  function sectionLabel(key) {
    if (!sectionLabels) {
      sectionLabels = {};
      try {
        (CATALOG_TILES || []).forEach(function (t) {
          ['mhi', 'gal'].forEach(function (brand) {
            if (t[brand] && t[brand].key) {
              sectionLabels[t[brand].key] = t.label + ' · ' + (brand === 'mhi' ? 'MHI' : 'Galactic');
            }
          });
          if (t.key) sectionLabels[t.key] = t.label;
        });
        /* Розділи з власним розбором (ККБ, VRF, вентиляція, завіси, теплові насоси,
           витратні) у плитках ключа не мають — їхні назви вже є в CUSTOM_SHEET_DIAG,
           там для кожного вказані і плитка, і бренд. Беремо звідти, щоб не тримати
           третій список тих самих назв. */
        const perTile = {};
        (CUSTOM_SHEET_DIAG || []).forEach(function (e) {
          if (e && e.tile) perTile[e.tile] = (perTile[e.tile] || 0) + 1;
        });
        (CUSTOM_SHEET_DIAG || []).forEach(function (e) {
          if (!e || !e.key) return;
          /* Бренд дописуємо, лише коли плитка ділиться на кілька аркушів (Теплові
             насоси, VRF, ККБ). Інакше вийшло б «Витратні матеріали · consumables». */
          sectionLabels[e.key] = perTile[e.tile] > 1 ? (e.tile + ' · ' + e.brand) : e.tile;
        });
      } catch (e) { /* немає плиток — обійдемось ключами */ }
    }
    return sectionLabels[key] || key;
  }
  let candidate = null;   // { data, stats, diff, verdict, file, sha, problems }
  let currentInfo = null; // { version_id, published_at, stats, ... }
  let busy = false;
  /* Повідомлення, що мусить пережити перемальовування. Без нього напис
     «Опубліковано» з'являвся і зникав тієї ж миті: після успіху ми кличемо
     loadCurrent() + render(), а вони збирають тіло листа заново разом із тим
     вузлом, у який щойно писали (знайдено перевіркою в браузері 2026-10-18). */
  let flash = '';

  /* ---- Де малюємось ----
     Рішення власника 2026-10-18: ОКРЕМОГО вікна немає. Розділ живе всередині блоку
     «Завантаження та діагностика прайсу» в Кабінеті — того самого, що розкривається
     карткою, як «Заявки». Тобто ніякого листа, ніякого pushState, ніякої своєї
     обробки «Назад»: блок згортається тією ж карткою, що й розгорнувся.
     Першу версію робив окремим листом — власник подивився й сказав зводити все
     під одну картку разом із діагностикою. */
  let mountEl = null;

  /* Викликається з renderAdminPanel() кожного разу, коли Кабінет перемальовано:
     DOM там збирається заново, тож тримати посилання між викликами не можна. */
  function mount(el) {
    mountEl = el || null;
    if (!mountEl) return;
    render();
    loadCurrent();
  }

  function body() { return mountEl; }

  function setBusy(v) {
    busy = v;
    const el = body();
    if (el) el.classList.toggle('is-busy', !!v);
  }

  /* ---- Поточна опублікована версія ---- */
  async function loadCurrent() {
    try {
      const res = await sb.rpc('price_list_versions', { p_limit: 20 });
      if (res.error) throw res.error;
      const list = res.data || [];
      currentInfo = list.find(function (v) { return v.status === 'published'; }) || null;
      /* render() ПЕРЕД renderHistory(), і це не формальність: render() наново збирає
         тіло листа разом із порожнім контейнером історії. Якщо намалювати історію
         першою, render() її тут же й затре. Саме цього спершу й не було — екран
         показував «опублікованої версії ще немає» навіть тоді, коли вона є
         (знайдено перевіркою в браузері 2026-10-18). */
      render();
      renderHistory(list);
    } catch (e) {
      const h = document.getElementById('price-admin-history');
      if (h) h.innerHTML = '<div class="warn">Не вдалося прочитати історію версій: ' + esc(e.message || e) + '</div>';
    }
  }

  /* ---- Розбір обраного файлу ---- */
  async function handleFile(file) {
    if (!file || busy) return;
    candidate = null;
    flash = '';
    setBusy(true);
    try {
      stage('Читаємо файл…');
      const buf = await file.arrayBuffer();

      stage('Рахуємо контрольну суму…');
      const sha = await sha256Hex(buf);

      stage('Готуємо розбірник…');
      await ensureXlsx();   // бібліотека вантажиться на вимогу (етап D)
      stage('Розбираємо прайс…');
      await nextFrame();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });

      /* ⚠️ ТОЙ САМИЙ розбірник, що й у звичайному завантаженні прайсу.
         Другого робити не можна — розійдуться непомітно. */
      const parsed = buildSheetsData(wb, null);

      stage('Порівнюємо з тим, що зараз у застосунку…');
      const prev = (typeof sheetsData !== 'undefined' && sheetsData) || {};
      const stats = statsFromSheets(parsed.data);
      const prevStats = statsFromSheets(prev);
      const diff = diffSheets(prev, parsed.data);
      const verdict = verdictFor(stats, diff, parsed.problems, prevStats, sectionLabel);

      candidate = {
        data: parsed.data, problems: parsed.problems || [],
        stats: stats, prevStats: prevStats, diff: diff, verdict: verdict,
        file: file, sha: sha
      };
    } catch (e) {
      candidate = null;
      stage('');
      const el = body();
      if (el) el.insertAdjacentHTML('afterbegin',
        '<div class="warn">Не вдалося розібрати файл: ' + esc(e.message || e) +
        '. Нічого не змінилось, чинний прайс на місці.</div>');
    } finally {
      setBusy(false);
      render();
    }
  }

  function stage(text) {
    const el = document.getElementById('price-admin-stage');
    if (el) el.textContent = text || '';
  }

  /* Віддати браузеру кадр, щоб він УСПІВ намалювати «Розбираємо прайс…»: XLSX.read
     на 10 МБ синхронний і тримає потік кілька секунд, а перемальовка починається
     лише після нього.
     ⚠️ Чому не просто requestAnimationFrame: у СХОВАНІЙ вкладці rAF не викликається
     взагалі, і весь розбір зависав назавжди — ні помилки, ні руху, вічне
     «Розбираємо прайс…» (наступив на це 2026-10-18 під час перевірки в браузері).
     Для адміна це реальний сценарій: поклав телефон у кишеню, поки розбирається.
     Тому кадр лише ОЧІКУЄМО, але не чекаємо на нього вічно — таймер страхує. */
  function nextFrame() {
    return new Promise(function (resolve) {
      let done = false;
      const finish = function () { if (!done) { done = true; resolve(); } };
      setTimeout(finish, 250);
      requestAnimationFrame(function () { requestAnimationFrame(finish); });
    });
  }

  async function sha256Hex(buf) {
    try {
      const d = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      return ''; // без хешу теж працюємо, просто в історії не буде контрольної суми
    }
  }

  /* ---- Фото серій: з Excel у окреме сховище (з 2026-10-19) ----
     Доти фото жили всередині price.xlsx, і будь-який дотик по ⓘ біля назви серії
     тягнув увесь 10-мегабайтний файл. Головне ж — через них НЕМОЖЛИВО було закрити
     публічний бакет: разом із прайсом зникли б і фото.
     Тепер при публікації вони вивантажуються в бакет `price-media`, а у версію
     лягає готова мапа «аркуш → серія → адреси».

     ⚠️ Прив'язку «фото ↔ серія» рахує ТОЙ САМИЙ extractSeriesImages(), що й
     застосунок. Другої реалізації тут немає свідомо: розійдуться — і дилер
     побачить біля серії чуже фото, чого ніяка перевірка не спіймає.

     Аркуші перелічені руками, бо кожен має власний спосіб визначити серію за
     рядком — рівно ті вирази, що стоять у місцях показу. */
  async function buildSeriesMedia(buf, sha, onStep) {
    const out = {};
    /* Підсовуємо щойно обраний файл як «сирий буфер» застосунку: тоді всі наявні
       помічники (rowGroupMap'и) працюють як завжди, нічого не перероблюючи. */
    const prevBuf = (typeof priceRawBuffer !== 'undefined') ? priceRawBuffer : null;
    priceRawBuffer = buf;
    seriesImageCache = {};
    try {
      const sources = [
        { sheet: 'ПОБУТОВІ', rows: function () { return getRowGroupMapForSplitTile('mhi'); } },
        { sheet: 'GALACTIC', rows: function () { return getRowGroupMapForSplitTile('gal'); } },
        { sheet: 'VRF Зовнішні блоки', rows: function () { return getVrfRowGroupMap('VRF Зовнішні блоки', function (wb) { return parseVrfTypeSheet(wb, 'VRF Зовнішні блоки'); }); } },
        { sheet: 'VRF Внутрішні R410A', rows: function () { return getVrfRowGroupMap('VRF Внутрішні R410A', function (wb) { return parseVrfTypeSheet(wb, 'VRF Внутрішні R410A'); }); } },
        { sheet: 'VRF Внутрішні KXZE1-W R32', rows: function () { return getVrfRowGroupMap('VRF Внутрішні KXZE1-W R32', function (wb) { return parseVrfTypeSheet(wb, 'VRF Внутрішні KXZE1-W R32'); }); } },
        { sheet: 'Galactic VRF', rows: function () { return getVrfRowGroupMap('galOutdoor', parseGalVrfOutdoorSheet); } },
        { sheet: 'TH MHI – EZY та Qton', rows: function () { return getThEzyRowGroupMap(); } },
        { sheet: 'Galactic ККБ', kkb: true }
      ];

      let done = 0;
      for (const src of sources) {
        onStep && onStep('Фото серій: ' + src.sheet + ' (' + (++done) + ' з ' + sources.length + ')');
        let rowToGroup;
        if (src.kkb) {
          const rawRows = await getKkbGalRawRows();
          rowToGroup = function (row) {
            const m = rawRows && rawRows[row] ? String(rawRows[row][2] || '').trim() : '';
            return m ? extractGucSeries(m) : null;
          };
        } else {
          const map = await src.rows();
          rowToGroup = function (row) { return map[row]; };
        }
        seriesImageCache = {}; // кожен аркуш рахуємо начисто
        const found = await extractSeriesImages(src.sheet, rowToGroup);
        if (!found || !found.size) continue;

        const perSheet = {};
        for (const [group, urls] of found) {
          const links = [];
          for (let i = 0; i < urls.length; i++) {
            /* extractSeriesImages віддає blob-адреси вже витягнутих картинок —
               читаємо їх назад і кладемо в сховище. Ім'я містить хеш файлу прайсу:
               та сама публікація вдруге нічого не перезаливає зайвого, а різні
               прайси не плутаються між собою. */
            const blob = await (await fetch(urls[i])).blob();
            const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const path = sha.slice(0, 8) + '/' + slug(src.sheet) + '-' + slug(group) + '-' + i + '.' + ext;
            const up = await sb.storage.from('price-media').upload(path, blob, {
              upsert: true, contentType: blob.type, cacheControl: '31536000'
            });
            if (up.error) throw new Error('фото не завантажилось (' + up.error.message + ')');
            const { data } = sb.storage.from('price-media').getPublicUrl(path);
            links.push(data.publicUrl);
          }
          if (links.length) perSheet[group] = links;
        }
        if (Object.keys(perSheet).length) out[src.sheet] = perSheet;
      }
    } finally {
      priceRawBuffer = prevBuf;
      seriesImageCache = {};
    }
    return out;
  }

  /* Ім'я файлу в сховищі має бути латиницею без пробілів: назви аркушів і серій
     українські й з розділовими знаками. Беремо хеш рядка — короткий і стабільний. */
  function slug(text) {
    let h = 0;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  /* ---- Публікація ---- */
  async function publish() {
    if (!candidate || !candidate.verdict.canPublish || busy) return;
    if (!confirm('Опублікувати цей прайс для всіх користувачів?')) return;

    /* ⚠️ КЛЮЧ ПОВТОРУ — НА СПРОБУ ПУБЛІКАЦІЇ, А НЕ НА ФАЙЛ.
       Спершу тут стояв хеш самого файлу — і це вийшло боком: власник опублікував
       той самий прайс удруге (вже з перенесенням фото), а сервер побачив знайомий
       ключ, повернув СТАРУ чернетку й мовчки викинув усе нове, разом із мапою фото.
       Фото при цьому вже лежали в сховищі — тобто робота зроблена, а результат
       загублено, і ніде жодної помилки (2026-10-19).
       Ключ потрібен лише щоб обрив мережі посеред ОДНІЄЇ спроби не створив дубль,
       тому він і живе рівно одну спробу. Від подвійної публікації захищає інше —
       звірка очікуваної поточної версії (compare-and-swap) у price_publish. */
    if (!candidate.opId) {
      const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
      candidate.opId = 'pub:' + (candidate.sha || 'nohash').slice(0, 8) + ':' + rnd;
    }

    setBusy(true);
    const note = document.getElementById('price-admin-publish-note');
    const say = function (t) { if (note) note.innerHTML = t; };

    try {
      /* 1. Файл — ПЕРШИМ. Поки частина телефонів читає price.xlsx напряму,
         без цього кроку вони лишились би зі старим прайсом, і ніхто б не помітив. */
      say('Завантажуємо файл у сховище…');
      const up = await sb.storage.from('price').upload(PRICE_OBJECT, candidate.file, {
        upsert: true, contentType: candidate.file.type ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      if (up.error) throw new Error('файл не завантажився (' + up.error.message + ')');

      /* 2. Чернетка. Ключ ідемпотентності — хеш файлу: повтор після обриву мережі
         віддасть ту саму чернетку, а не створить другу. */
      /* 2. Фото серій — ДО чернетки: якщо сховище недоступне, краще впасти тут,
         ніж опублікувати версію з мапою, що веде в нікуди. */
      say('Переносимо фото серій…');
      let media = null;
      try {
        media = await buildSeriesMedia(await candidate.file.arrayBuffer(), candidate.sha || 'nohash',
                                       function (t) { say(t); });
      } catch (e) {
        throw new Error('фото серій: ' + (e.message || e));
      }

      say('Створюємо чернетку…');
      const draft = await sb.rpc('price_create_draft', {
        p_media: media,
        p_data: candidate.data,
        /* Друга копія — БЕЗ ЦІН, для гостей (get_price_public). Рахуємо ТІЄЮ САМОЮ
           stripPricesFromSheets(), що роками готує кеш для тих, хто доступу не має:
           другої реалізації «як прибрати ціни» в застосунку бути не повинно. */
        p_data_public: stripPricesFromSheets(candidate.data),
        p_stats: candidate.stats,
        p_diff: {
          added: candidate.diff.added, removed: candidate.diff.removed,
          changed: candidate.diff.changed, perSection: candidate.diff.perSection,
          big: candidate.diff.big.slice(0, 50)
        },
        p_parser_version: (typeof PARSER_VERSION !== 'undefined') ? PARSER_VERSION : null,
        p_app_build: (typeof APP_BUILD !== 'undefined') ? APP_BUILD : null,
        p_source_name: candidate.file.name,
        p_source_sha256: candidate.sha,
        p_idempotency_key: candidate.opId
      });
      if (draft.error) throw draft.error;
      if (!draft.data || draft.data.ok !== true) throw new Error(errorText(draft.data));

      /* 3. Публікація. Називаємо версію, яку вважаємо поточною: якщо за цей час
         опублікував хтось інший — отримаємо відмову, а не тихо затремо його роботу. */
      say('Публікуємо…');
      const pub = await sb.rpc('price_publish', {
        p_version_id: draft.data.id,
        p_expected_current: currentInfo ? currentInfo.id : null,
        p_legacy_version: legacyVersionFor(new Date())
      });
      if (pub.error) throw pub.error;
      if (!pub.data || pub.data.ok !== true) throw new Error(errorText(pub.data));

      candidate = null;
      flash = '<div class="price-admin-ok">Опубліковано. Версія №' + esc(pub.data.current_version_id) +
              '. Дилери отримають її при наступному відкритті застосунку.</div>';
      await loadCurrent();   // всередині кличе render(), який і покаже flash
    } catch (e) {
      flash = '<div class="warn">Не опубліковано: ' + esc(e.message || e) +
              '. Чинний прайс не змінився.</div>';
      say(flash);
    } finally {
      setBusy(false);
    }
  }

  function errorText(d) {
    const code = d && d.error;
    if (code === 'only_super_admin') return 'прайсом керує лише супер-адмін';
    if (code === 'stale_current') return 'за цей час прайс опублікував хтось інший (зараз версія ' +
      ((d && d.actual_current_version_id) || '?') + '). Оновіть екран і подивіться, що там';
    if (code === 'no_such_version') return 'такої версії немає';
    if (code === 'bad_data') return 'дані не схожі на розібраний прайс';
    return code || 'невідома помилка';
  }

  async function rollbackTo(id) {
    if (busy) return;
    if (!confirm('Повернути прайс до версії ' + id + '? Поточна версія лишиться в історії.')) return;
    setBusy(true);
    try {
      const res = await sb.rpc('price_rollback', {
        p_version_id: id,
        p_expected_current: currentInfo ? currentInfo.id : null,
        p_reason: 'відкат з кабінету'
      });
      if (res.error) throw res.error;
      if (!res.data || res.data.ok !== true) throw new Error(errorText(res.data));
      await loadCurrent();
      render();
    } catch (e) {
      alert('Не вдалося повернути: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  /* ---- Малювання ---- */
  function render() {
    const el = body();
    if (!el) return;

    const cur = currentInfo
      ? '<div class="price-admin-current">' +
          '<div><b>Чинна версія:</b> ' + esc(cur0(currentInfo.id)) + '</div>' +
          '<div>Опубліковано: ' + esc(dateLabel(currentInfo.published_at)) + '</div>' +
          '<div>Автор: ' + esc(currentInfo.author || '—') + '</div>' +
          '<div>Позицій: ' + esc(((currentInfo.stats || {}).total) || '—') + '</div>' +
          '<div>Файл: ' + esc(currentInfo.source_name || '—') + '</div>' +
        '</div>'
      : '<div class="price-admin-current"><b>Опублікованої версії ще немає.</b> ' +
        'Застосунок працює зі старого price.xlsx.</div>';

    el.innerHTML =
      cur +
      '<div class="price-admin-pick">' +
        /* Напис із попередженням — рішення власника 2026-10-18, після того як публікація
           з Android не вдалась: телефон не витягує розбір 10 МБ (вкладку вбиває брак
           памʼяті, і людину «викидає» назад у меню без жодної помилки). Попередження
           стоїть ПРЯМО НА КНОПЦІ, а не підписом поруч: підпис не читають. */
        '<label class="primary-btn price-admin-file-btn" for="price-admin-file">' +
          'Завантажити прайс<span class="price-admin-pc-note">тільки з ПК, обовʼязково</span></label>' +
        '<input type="file" id="price-admin-file" accept=".xlsx,.xls" hidden>' +
        '<div class="muted" id="price-admin-stage"></div>' +
      '</div>' +
      candidateHtml() +
      flash +
      '<div id="price-admin-history"></div>';

    const input = document.getElementById('price-admin-file');
    if (input) input.addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      handleFile(f);
    });

    const btn = document.getElementById('price-admin-publish');
    if (btn) btn.addEventListener('click', publish);

    const cancel = document.getElementById('price-admin-cancel');
    if (cancel) cancel.addEventListener('click', function () { candidate = null; render(); });
  }

  function cur0(id) { return id == null ? '—' : ('№' + id); }

  function dateLabel(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return String(iso); }
  }

  function candidateHtml() {
    if (!candidate) return '';
    const d = candidate.diff, v = candidate.verdict;

    const rows = Object.keys(d.perSection).sort().map(function (k) {
      const s = d.perSection[k];
      if (!s.before && !s.after) return '';
      const mark = s.after === 0 && s.before > 0 ? ' class="row-bad"' : '';
      return '<tr' + mark + '><td>' + esc(sectionLabel(k)) + '</td><td>' + s.before + '</td><td>' + s.after + '</td>' +
             '<td>' + (s.added ? '+' + s.added : '') + '</td>' +
             '<td>' + (s.removed ? '−' + s.removed : '') + '</td>' +
             '<td>' + (s.changed || '') + '</td></tr>';
    }).join('');

    const big = d.big.slice(0, 20).map(function (b) {
      const from = b.from === null ? 'немає' : (b.from === 'запит' ? 'за запитом' : b.from);
      const to = b.to === null ? 'немає' : (b.to === 'запит' ? 'за запитом' : b.to);
      const pct = b.pct === null ? '' : (' (' + (b.to > b.from ? '+' : '−') + b.pct.toFixed(1) + ' %)');
      return '<li>' + esc(b.model) + ': ' + esc(from) + ' → ' + esc(to) + esc(pct) + '</li>';
    }).join('');

    return '<div class="price-admin-candidate">' +
      '<h4>Що зміниться</h4>' +
      '<div class="price-admin-sum">Позицій було <b>' + candidate.prevStats.total + '</b>, стане <b>' + candidate.stats.total + '</b>. ' +
        'Додано <b>' + d.added + '</b>, зникло <b>' + d.removed + '</b>, змінилась ціна у <b>' + d.changed + '</b>.</div>' +
      '<table class="price-admin-table"><thead><tr><th>Розділ</th><th>Було</th><th>Стане</th><th>+</th><th>−</th><th>Ціна</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      (big ? '<h4>Помітні зміни цін</h4><ul class="price-admin-big">' + big + '</ul>' +
             (d.big.length > 20 ? '<div class="muted">…і ще ' + (d.big.length - 20) + '</div>' : '') : '') +
      (v.blockers.length ? '<div class="warn"><b>Публікувати не можна:</b><ul>' +
          v.blockers.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' : '') +
      (v.warnings.length ? '<div class="price-admin-note"><b>Зверніть увагу:</b><ul>' +
          v.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="price-admin-actions">' +
        '<button type="button" id="price-admin-publish" class="primary-btn"' +
          (v.canPublish ? '' : ' disabled') + '>Опублікувати</button>' +
        '<button type="button" id="price-admin-cancel" class="price-admin-secondary">Скасувати</button>' +
      '</div>' +
      '<div id="price-admin-publish-note"></div>' +
    '</div>';
  }

  function renderHistory(list) {
    const el = document.getElementById('price-admin-history');
    if (!el) return;
    if (!list || !list.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h4>Історія версій</h4>' + list.map(function (v) {
      const isCur = v.status === 'published';
      return '<div class="price-admin-ver' + (isCur ? ' is-current' : '') + '">' +
        '<div><b>' + esc(cur0(v.id)) + '</b> · ' + esc(dateLabel(v.published_at || v.created_at)) +
        ' · ' + esc(((v.stats || {}).total) || '—') + ' поз.' +
        (isCur ? ' · <b>чинна</b>' : '') + '</div>' +
        '<div class="muted">' + esc(v.source_name || '') + ' · ' + esc(v.author || '') + '</div>' +
        (isCur ? '' : '<button type="button" class="price-admin-secondary" data-rollback="' + v.id + '">Повернути</button>') +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-rollback]').forEach(function (b) {
      b.addEventListener('click', function () { rollbackTo(Number(b.getAttribute('data-rollback'))); });
    });
  }

  root.PriceAdmin = Object.assign({ mount: mount }, pure);
})(typeof window !== 'undefined' ? window : globalThis);
