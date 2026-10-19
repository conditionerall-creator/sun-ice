# -*- coding: utf-8 -*-
"""Читання таблиці «ТЕХНІЧНІ ХАРАКТЕРИСТИКИ» з будь-якої сторінки серії.

Чому не «виписати назви рядків руками для кожної серії»: таких сторінок у каталозі
близько сорока. Ручна транскрипція однієї сторінки надійна, сорока — ні: помилку
в одній з них ніхто не помітить.

Тому назви виводяться з геометрії, а правильність доводиться на ЕТАЛОНІ: сторінка 34
(серія ZSX-W) звірена очима рядок за рядком, і `tests/tables.test.py` вимагає, щоб
алгоритм відтворив її точно. Зміниш щось тут — тест упаде.

ЯК ВИЗНАЧАЄТЬСЯ НАЗВА РЯДКА
---------------------------
Колонка назв має три рівні:
  x < 86    головний заголовок, часто на кілька рядків («Рівень / звукової / потужності»)
  86…120    підзаголовок блока («Внутр.», «Зовнішн.»)
  120…200   уточнення («Охолодження / Обігрів», «(Hi/Me/Lo/Ulo)»)
Головний заголовок ВЕРТИКАЛЬНО ВІДЦЕНТРОВАНИЙ над своїми рядками, тому його шматки
можуть стояти і вище, і нижче рядка значень, до якого належать. Через це:
  1. шматки головної колонки збираються в заголовки: новий починається зі шматка,
     що з великої літери (продовження в цьому каталозі завжди з малої);
  2. кожен рядок значень дістає той заголовок, чий центр до нього найближчий.
Одиниця виміру так само буває надрукована раз на кілька рядків — її беремо з того
самого заголовка-блока.
"""

import re

import pdfgrid as G

X_MAIN, X_SUB, X_UNIT, X_VALS = 86.0, 120.0, 200.0, 240.0

# Дрібні підчистки тексту: у PDF верхні/нижні індекси — окремі слова, і при
# склеюванні виходить «кг/TCO Eq» замість «кг/TCO₂Eq».
UNIT_FIX = [
    (r'^кг/TCO\s*E?q?.*$', 'кг/TCO₂Eq'),
    (r'^м\s*3\s*/хв$', 'м³/хв'),
    (r'^мм\s*2$', 'мм²'),
    (r'^˚C$', '°C'),
]
# Рядки, у яких одиниці бути не може, хоч у блоці вона й надрукована.
NO_UNIT_IF = [r'Тип/GWP', r'Тип фреону']


def _fix_unit(u):
    u = re.sub(r'\s+', ' ', (u or '')).strip()
    for pat, rep in UNIT_FIX:
        if re.match(pat, u):
            return rep
    return u.replace(' ', '')


def _zone(words, lo, hi):
    return ' '.join(w.text for w in words if lo <= w.x0 < hi).strip()


# Канонічні ліві краї підколонок. Саме за ними відрізняємо СПРАВЖНЮ підколонку
# («Внутр.» на x=86) від простого переносу довгої назви, яка затікає в ту саму
# зону («…відстань ОПОР зовнішнього блоку» — «опор» теж стоїть за 86, але це
# продовження речення, а не окрема колонка). Поділ лише по X тут не працює:
# на цьому й поїхали назви при першій спробі.
SUB_TOL = 2.5
SEG_GAP = 4.0


UNIT_GAP = 10.0


def unit_like(text):
    """Схоже на одиницю виміру: «кВт», «дБ(A)», «м3/хв», «мм(дюйм)», «кг/TCO2Eq».

    Слово з п'яти й більше кириличних літер («Обігрів», «Охолодження») — це
    підпис, а не одиниця.
    """
    t = text.strip()
    if not t or len(t) > 12:
        return False
    if re.search(r'[А-Яа-яІЇЄҐіїєґ]{5,}', t):
        return False
    return bool(re.search(r'[A-Za-zА-Яа-яІЇЄҐіїєґ0-9]', t))


def split_unit(row_words, x_vals):
    """Відділяє одиницю виміру від назви рядка.

    Одиниця — ОСТАННЯ відокремлена група слів у зоні назв. Визначаємо її по
    рядку, а не по колонці сторінки: колонка одиниць то вирівняна по лівому
    краю (стор. 56), то по правому (стор. 51), то «як вийде» (стор. 34), і
    будь-яке правило «колонка починається на x» ламалось на іншій сторінці.
    """
    left = sorted([w for w in row_words if w.x0 < x_vals], key=lambda w: w.x0)
    if not left:
        return [], ''
    tail = [left[-1]]
    for w in reversed(left[:-1]):
        if tail[0].x0 - w.x1 <= 6:
            tail.insert(0, w)
        else:
            break
    if len(tail) == len(left):
        return left, ''
    before = left[:len(left) - len(tail)]
    text = ' '.join(w.text for w in tail)
    if tail[0].x0 - before[-1].x1 >= UNIT_GAP and unit_like(text):
        return before, text
    return left, ''


def detect_stops(rows, x_vals=X_VALS):
    """Ліві краї підколонок НА ЦІЙ сторінці.

    Вони плавають: на стор. 34 це 86 і 121, на стор. 42/51/52 — 94 і ~130.
    Зашиті числа тут і зламали назви на стор. 51 («Внутр.» потрапляло в головний
    заголовок). Тому беремо два найчастіші краї, крім головного.
    """
    cnt = {}
    for r in rows:
        if not any(w.x0 >= x_vals for w in r):
            continue
        for w in r:
            if w.x0 < min(X_UNIT, x_vals):
                cnt[round(w.x0)] = cnt.get(round(w.x0), 0) + 1
    if not cnt:
        return (X_MAIN, X_SUB)
    main = min(cnt)
    peaks = sorted([(n, x) for x, n in cnt.items() if x > main + 10 and n >= 5], reverse=True)[:2]
    stops = sorted(x for _, x in peaks)
    while len(stops) < 2:
        stops.append((X_MAIN, X_SUB)[len(stops)])
    return (float(stops[0]), float(stops[1]))


def label_parts(row_words, stops=(X_MAIN, X_SUB), x_vals=X_UNIT):
    """Назву рядка на три частини: головна · підколонка · уточнення.

    Розрив між частинами — лише там, де є відступ І наступне слово починається
    рівно на краю підколонки.
    """
    zone = sorted([w for w in row_words if w.x0 < min(X_UNIT, x_vals)], key=lambda w: w.x0)
    if not zone:
        return ['', '', '']
    segs, cur = [], [zone[0]]
    for w in zone[1:]:
        at_stop = any(abs(w.x0 - s) <= SUB_TOL for s in stops)
        if at_stop and w.x0 - cur[-1].x1 > SEG_GAP:
            segs.append(cur)
            cur = []
        cur.append(w)
    segs.append(cur)

    parts = ['', '', '']
    for seg in segs:
        x = seg[0].x0
        slot = 0 if x < stops[0] - SUB_TOL else (1 if x < stops[1] - SUB_TOL else 2)
        text = ' '.join(w.text for w in seg)
        parts[slot] = (parts[slot] + ' ' + text).strip() if parts[slot] else text
    return parts


def _is_new_heading(text):
    """Новий заголовок — з великої літери, цифри або латиниці; продовження — з малої."""
    t = text.strip()
    return bool(t) and not re.match(r'^[а-яіїєґ]', t)


def read_table(words, page, y_from=None, y_to=None):
    """Рядки таблиці сторінки: {name, unit, cells, spans, y} + центри колонок.

    Повертає (rows, col_centers, header_words) або (None, None, None), якщо на
    сторінці немає рядка з маркуваннями зовнішніх блоків (тобто це не таблиця
    знайомого вигляду — такі сторінки звітуються, а не вгадуються).
    """
    if y_from is None:
        start = 0.0
        for w in words:
            if w.text.startswith('ТЕХНІЧНІ'):
                start = w.y0
                break
    else:
        start = y_from
    body = [w for w in words if w.y0 > start and (y_to is None or w.y0 < y_to)]
    rows = G.group_rows(body)

    # Колонки — з рядка маркувань: кожне маркування окремим словом.
    # Шукаємо їх БЕЗ прив'язки до X_VALS: на сторінках мульти (56, 57) перша
    # колонка стоїть лівіше, ніж на сторінках спліта, і маркування «SRK20ZSX»
    # опинялось у зоні назв — колонка мовчки губилась.
    model_re = MODEL_RE
    centers, header = None, []
    for r in rows:
        got = [w for w in r if model_re.match(w.text) and len(w.text) > 4]
        if len(got) >= 2:
            centers = [w.cx for w in sorted(got, key=lambda w: w.x0)]
            header = got
            break
    if not centers:
        return None, None, None
    # Ліва межа зони значень — від кроку колонок, а не зашите число: інакше або
    # ріжемо першу колонку, або затягуємо в значення колонку одиниць.
    gap = (centers[-1] - centers[0]) / max(1, len(centers) - 1) if len(centers) > 1 else 60.0
    # Межа зони значень — трохи лівіше за найлівіше маркування шапки. Якщо взяти
    # «центр мінус півкроку», у значення затягує колонку одиниць, і виходить
    # «кг 20.5» одним значенням (стор. 57).
    x_vals = min(w.x0 for w in header) - 0.25 * gap
    bounds = [(centers[i] + centers[i + 1]) / 2.0 for i in range(len(centers) - 1)]
    # Назва й одиниця кожного рядка — окремо, ще до пошуку країв підколонок:
    # інакше колонка одиниць виглядає як ще одна підколонка назв.
    parts_of = {}
    for r in rows:
        lab, unit = split_unit(r, x_vals)
        parts_of[id(r)] = (lab, unit)
    label_rows = [parts_of[id(r)][0] + [w for w in r if w.x0 >= x_vals] for r in rows]
    stops = detect_stops(label_rows, x_vals)

    # 1) Заголовки головної колонки.
    heads, cur = [], None
    for r in rows:
        frag = label_parts(parts_of[id(r)][0], stops, x_vals)[0]
        if not frag:
            continue
        if re.fullmatch(r'\d{1,3}', frag):          # номер сторінки внизу
            continue
        if _is_new_heading(frag) or cur is None:
            cur = {'text': frag, 'y0': r[0].y0, 'y1': r[0].y0, 'unit': ''}
            heads.append(cur)
        else:
            cur['text'] += ' ' + frag
            cur['y1'] = r[0].y0

    # Заголовок, власний рядок якого НЕ має позначки «Внутр./Зовнішн.», —
    # одинарний: він не може забрати рядок, у якого така позначка є.
    # Без цього на стор. 51 «Циркуляція повітря · Зовнішн.» діставалась
    # сусідньому заголовку «Максимальний зовнішній статичний тиск», бо той
    # надрукований ближче. Значення при цьому були правильні, а підпис — ні.
    for h in heads:
        h['plain'] = False
        for r in rows:
            if h['y0'] - 2 <= r[0].y0 <= h['y1'] + 2 and any(w.x0 >= x_vals for w in r):
                h['plain'] = not label_parts(parts_of[id(r)][0], stops, x_vals)[1]
                break

    def head_for(y, has_sub=False):
        pool = [h for h in heads if not (has_sub and h['plain'])] or heads
        if not pool:
            return None
        return min(pool, key=lambda h: abs((h['y0'] + h['y1']) / 2.0 - y))

    # 2) Одиниці: теж можуть стояти раз на блок — приписуємо їх заголовку.
    for r in rows:
        u = parts_of[id(r)][1]
        if not u:
            continue
        h = head_for(r[0].y0)
        if h and not h['unit']:
            h['unit'] = u

    # 3) Рядки значень.
    out = []
    page_no = str(page)
    for r in rows:
        vals = [w for w in r if w.x0 >= x_vals]
        if not vals:
            continue
        # Хвостики одиниці («кг/TCO» + верхній індекс «2» + «Eq») стоять упритул
        # до неї і потрапляли в значення окремою коміркою (стор. 38, 40).
        # Усе, що приклеєне до зони одиниць і стоїть далеко лівіше за першу
        # колонку, — це одиниця, а не значення.
        edge = centers[0] - 0.35 * gap
        prev_right = max([w.x1 for w in r if w.x0 < x_vals] or [None]) if any(w.x0 < x_vals for w in r) else None
        while (vals and prev_right is not None and vals[0].x0 < edge
               and len(vals[0].text) <= 3 and vals[0].x0 - prev_right <= 8):
            prev_right = vals[0].x1
            vals.pop(0)
        if not vals:
            continue
        # Номер сторінки внизу праворуч стоїть у тій самій смузі, що й значення
        # (стор. 51: «51» прочиталось як значення). Це не рядок таблиці.
        if len(vals) == 1 and vals[0].text == page_no and not parts_of[id(r)][0]:
            continue
        if any(model_re.match(w.text) and len(w.text) > 4 for w in vals):
            continue                                  # рядок-шапка з маркуваннями

        small = G.group_cells(vals, gap=8.0)
        cells = [small[0]]
        for c in small[1:]:
            if any(cells[-1][-1].x1 <= b <= c[0].x0 for b in bounds):
                cells.append(c)
            else:
                cells[-1] = cells[-1] + c

        # Якщо значення сусідніх колонок стоять упритул, проміжку між ними
        # немає — і вони злипаються в одну комірку. Далі така комірка виглядає
        # як ОБ'ЄДНАНА й розтягується на всі колонки, тобто кожній моделі
        # дістаються чужі цифри (стор. 55: «0.52 (0.32-1.60) 0.80 (0.34-2.10)…»
        # на всі шість). Тому комірку, ширшу за колонку, ріжемо по межах.
        wide = []
        for c in cells:
            parts = None
            if c[-1].x1 - c[0].x0 > 1.3 * gap and len(c) > 1:
                parts, part = [], [c[0]]
                for w in c[1:]:
                    if any(part[-1].x1 <= b <= w.x0 for b in bounds):
                        parts.append(part)
                        part = []
                    part.append(w)
                parts.append(part)
                # Ріжемо лише тоді, коли КОЖЕН шматок схожий на самостійне
                # значення. Інакше це одне довге пояснення на всю ширину
                # («Блок: 570 x 248 x 570 Панель: 620 x 10 x 620», стор. 52),
                # і різати його по межах колонок не можна.
                texts = [' '.join(w.text for w in p) for p in parts]
                if len(parts) < 2 or not all(
                        re.search(r'\d', t) and not re.search(r'[А-Яа-яІЇЄҐіїєґ]{4,}', t)
                        for t in texts):
                    parts = None
            wide.extend(parts if parts else [c])
        cells = wide

        own = label_parts(parts_of[id(r)][0], stops, x_vals)
        h = head_for(r[0].y0, bool(own[1]))
        unit = parts_of[id(r)][1] or (h['unit'] if h else '')
        out.append({
            'y': r[0].y0,
            'head': h['text'] if h else '',
            'sub': own[1],
            'tail': own[2],
            'unit_raw': unit,
            'cells': [G.cell_text(c) for c in cells],
            'spans': G.assign_spans(cells, centers),
        })

    # «Внутр.» / «Зовнішн.» теж буває надруковано раз на дві сусідні рядки
    # (об'єднана комірка). Звичай таблиць: мітка стоїть на першому рядку —
    # тож беремо її з попереднього рядка того самого заголовка, а якщо його
    # немає (мітку надруковано нижче) — з наступного. Нічого не вигадуємо:
    # мітка з сусіднього рядка ТОГО САМОГО блока, інакше лишаємо порожньо.
    for i, r in enumerate(out):
        if r['sub'] or not r['head']:
            continue
        prev = out[i - 1] if i > 0 else None
        nxt = out[i + 1] if i + 1 < len(out) else None
        if prev and prev['head'] == r['head'] and prev['sub']:
            r['sub'] = prev['sub']
        elif nxt and nxt['head'] == r['head'] and nxt['sub']:
            r['sub'] = nxt['sub']

    for r in out:
        parts = [r['head'], r['sub'], r['tail']]
        r['name'] = ' · '.join(p for p in (re.sub(r'\s+', ' ', x).strip() for x in parts) if p)
        # Якщо одиниця надрукована впритул до назви, вона лишається і в назві,
        # і в своїй колонці («…(Hi/Me/Lo/Ulo) дБ(A)» + «дБ(A)»). Прибираємо дубль.
        u = re.sub(r'\s+', '', r['unit_raw'] or '')
        if u and re.sub(r'\s+', '', r['name']).endswith(u):
            r['name'] = re.sub(re.escape(r['unit_raw'].strip()) + r'\s*$', '', r['name']).strip(' ·')
        unit = '' if any(re.search(p, r['name']) for p in NO_UNIT_IF) else r['unit_raw']
        r['unit'] = _fix_unit(unit) or None
    return out, centers, {'words': header, 'x_vals': x_vals}


def row_values(row, ncol):
    """Значення по колонках з урахуванням об'єднаних комірок; None — не розклалось."""
    if row['spans'] is None:
        return None
    vals = []
    for text, span in zip(row['cells'], row['spans']):
        vals.extend([text] * span)
    return vals if len(vals) == ncol else None


# --------------------------------------------------------------------------
# Шапка таблиці: маркування внутрішніх і зовнішніх блоків по колонках.
# --------------------------------------------------------------------------
MODEL_RE = re.compile(r'^(SRK|SKM|SRF|SRR|FDT|FDTC|FDU|FDUM|FDE|FDF|SRC|SCM|FDC)[\dA-Z]', re.I)


def expand_marks(token):
    """«SRK20ZSX-W,-WB,-WT» → три маркування. Кольорові виконання в каталозі так і
    надруковані одним рядком через кому — це перелік, а не одна модель."""
    bits = [b.strip() for b in token.split(',') if b.strip()]
    if not bits:
        return []
    out = [bits[0]]
    stem = re.sub(r'-[A-Z0-9]+$', '', bits[0])
    for b in bits[1:]:
        out.append((stem + b) if b.startswith('-') else b)
    return out


def read_header(words, centers, table_top, x_vals=X_VALS, y_to=None, suffixes=None):
    """Для кожної колонки — маркування внутрішніх і зовнішніх блоків.

    Колонку визначає найближчий центр: у шапці маркування відцентровані так само,
    як значення. Рядок «Зовнішній блок» завжди нижчий за рядки внутрішніх.
    """
    bounds = [(centers[i] + centers[i + 1]) / 2.0 for i in range(len(centers) - 1)]

    def col_of(w):
        i = 0
        while i < len(bounds) and w.cx > bounds[i]:
            i += 1
        return i

    rows = G.group_rows([w for w in words if w.y0 > table_top and (y_to is None or w.y0 < y_to)])
    head_rows = []
    for r in rows:
        # Маркування шукаємо без прив'язки до x_vals: на сторінках мульти перша
        # колонка стоїть лівіше за межу значень.
        marks = [w for w in r if MODEL_RE.match(w.text) and len(w.text) > 4]
        label = ' '.join(w.text for w in r if w not in marks and w.x0 < x_vals)
        if not marks:
            # Рядок «Внутрішній блок» сам маркувань не має — це підпис шапки, і
            # шапка на ньому не закінчується. Кінець шапки — перший рядок, де в
            # колонках стоять ЗНАЧЕННЯ, а не маркування.
            if any(w.x0 >= x_vals for w in r):
                break
            continue
        head_rows.append((label, marks))

    indoor = [[] for _ in centers]
    outdoor = [[] for _ in centers]
    for label, marks in head_rows:
        is_out = 'Зовнішній' in label or all(re.match(r'^(SRC|SCM|FDC)', w.text, re.I) for w in marks)
        for w in marks:
            got = expand_marks(w.text)
            # Таблиці мульти друкують маркування без кольорового суфікса
            # («SRK20ZSX»), а перелік виконань — у заголовку ділянки. У прайсі
            # ж стоїть повне маркування, тому без цього жодне не знайшлося б.
            if suffixes and len(got) == 1 and '-' not in got[0]:
                got = [got[0] + sfx for sfx in suffixes]
            (outdoor if is_out else indoor)[col_of(w)].extend(got)
    return indoor, outdoor


# --------------------------------------------------------------------------
# Сторінка з кількома таблицями (мульти спліт-системи, стор. 56–57):
# «Настінний тип / SRK-ZSX / (-WF,-WFB,…)» — і своя таблиця під кожним.
# --------------------------------------------------------------------------
SKIP_HEADERS = ('Комбінаці',)


def find_sections(words):
    """Ділянки сторінки, кожна зі своєю шапкою маркувань.

    Повертає список {y_from, y_to, title, suffixes}. На звичайній сторінці серії
    ділянка одна. Рядки шапки, що стоять поруч (внутрішні + зовнішні блоки),
    вважаються однією шапкою, а не двома ділянками.
    """
    rows = G.group_rows(words)
    heads = []
    for r in rows:
        marks = [w for w in r if MODEL_RE.match(w.text) and len(w.text) > 4]
        label = ' '.join(w.text for w in r if w not in marks)
        if len(marks) < 2:
            continue
        if any(k in label for k in SKIP_HEADERS):
            # Нижче таблиці комбінацій внутрішніх блоків (стор. 55) звичайних
            # таблиць уже немає — усе, що далі, до ділянок не належить.
            heads.append({'y': r[0].y0, 'skip': True})
            break
        if heads and not heads[-1].get('skip') and r[0].y0 - heads[-1]['y'] <= 20:
            heads[-1]['y_last'] = r[0].y0            # продовження тієї самої шапки
            continue
        heads.append({'y': r[0].y0, 'y_last': r[0].y0, 'skip': False})

    def caption_top(y):
        above = [r for r in rows if y - 60 < r[0].y0 < y - 2]
        return (above[0][0].y0 - 2) if above else (y - 2)

    out = []
    for i, h in enumerate(heads):
        if h.get('skip'):
            continue
        # Ділянка закінчується ТАМ, ДЕ ПОЧИНАЮТЬСЯ ПІДПИСИ наступної, а не на її
        # шапці: інакше «Касетний тип / FDTC-VH» потрапляє в попередню таблицю
        # й виглядає як рядки з даними.
        y_to = caption_top(heads[i + 1]['y']) if i + 1 < len(heads) else None
        above = [r for r in rows if h['y'] - 60 < r[0].y0 < h['y'] - 2]
        title = ' '.join(' '.join(w.text for w in r) for r in above).strip()
        # Кольорові виконання беремо ЛИШЕ з дужок виду «(-WF,-WFB,-WFT,-W,-WB,-WT)»:
        # це єдиний надійний запис. Спроба вишукувати суфікси в будь-якому тексті
        # давала сміття («SRR-ZS-W» → -ZS, «RC-EX3A» → -EX3A).
        sfx = []
        m = re.search(r'\(((?:-[A-Z0-9]+\s*,\s*)+-[A-Z0-9]+)\)', title)
        if m:
            sfx = [x.strip() for x in m.group(1).split(',')]
        out.append({'y_from': h['y'] - 5, 'y_to': y_to, 'title': title,
                    'suffixes': [x for x in dict.fromkeys(sfx)]})
    return out
