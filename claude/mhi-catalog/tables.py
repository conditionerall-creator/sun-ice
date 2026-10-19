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


def detect_stops(rows):
    """Ліві краї підколонок НА ЦІЙ сторінці.

    Вони плавають: на стор. 34 це 86 і 121, на стор. 42/51/52 — 94 і ~130.
    Зашиті числа тут і зламали назви на стор. 51 («Внутр.» потрапляло в головний
    заголовок). Тому беремо два найчастіші краї, крім головного.
    """
    cnt = {}
    for r in rows:
        if not any(w.x0 >= X_VALS for w in r):
            continue
        for w in r:
            if w.x0 < X_UNIT:
                cnt[round(w.x0)] = cnt.get(round(w.x0), 0) + 1
    if not cnt:
        return (X_MAIN, X_SUB)
    main = min(cnt)
    peaks = sorted([(n, x) for x, n in cnt.items() if x > main + 10 and n >= 5], reverse=True)[:2]
    stops = sorted(x for _, x in peaks)
    while len(stops) < 2:
        stops.append((X_MAIN, X_SUB)[len(stops)])
    return (float(stops[0]), float(stops[1]))


def label_parts(row_words, stops=(X_MAIN, X_SUB)):
    """Назву рядка на три частини: головна · підколонка · уточнення.

    Розрив між частинами — лише там, де є відступ І наступне слово починається
    рівно на краю підколонки.
    """
    zone = sorted([w for w in row_words if w.x0 < X_UNIT], key=lambda w: w.x0)
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


def read_table(words, page):
    """Рядки таблиці сторінки: {name, unit, cells, spans, y} + центри колонок.

    Повертає (rows, col_centers, header_words) або (None, None, None), якщо на
    сторінці немає рядка з маркуваннями зовнішніх блоків (тобто це не таблиця
    знайомого вигляду — такі сторінки звітуються, а не вгадуються).
    """
    start = 0.0
    for w in words:
        if w.text.startswith('ТЕХНІЧНІ'):
            start = w.y0
            break
    body = [w for w in words if w.y0 > start]
    rows = G.group_rows(body)

    # Колонки — з рядка маркувань зовнішніх блоків: кожне маркування окремим словом.
    model_re = re.compile(r'^(SRC|SCM|FDC|SRK|SKM|FDT|FDU|FDE|FDF|SRF|SRR)[\dA-Z]', re.I)
    centers, header = None, []
    for r in rows:
        got = [w for w in r if w.x0 >= X_VALS and model_re.match(w.text)]
        if len(got) >= 2:
            centers = [w.cx for w in sorted(got, key=lambda w: w.x0)]
            header = got
            break
    if not centers:
        return None, None, None
    bounds = [(centers[i] + centers[i + 1]) / 2.0 for i in range(len(centers) - 1)]
    stops = detect_stops(rows)

    # 1) Заголовки головної колонки.
    heads, cur = [], None
    for r in rows:
        frag = label_parts(r, stops)[0]
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
            if h['y0'] - 2 <= r[0].y0 <= h['y1'] + 2 and any(w.x0 >= X_VALS for w in r):
                h['plain'] = not label_parts(r, stops)[1]
                break

    def head_for(y, has_sub=False):
        pool = [h for h in heads if not (has_sub and h['plain'])] or heads
        if not pool:
            return None
        return min(pool, key=lambda h: abs((h['y0'] + h['y1']) / 2.0 - y))

    # 2) Одиниці: теж можуть стояти раз на блок — приписуємо їх заголовку.
    for r in rows:
        u = _zone(r, X_UNIT, X_VALS)
        if not u:
            continue
        h = head_for(r[0].y0)
        if h and not h['unit']:
            h['unit'] = u

    # 3) Рядки значень.
    out = []
    page_no = str(page)
    for r in rows:
        vals = [w for w in r if w.x0 >= X_VALS]
        if not vals:
            continue
        # Номер сторінки внизу праворуч стоїть у тій самій смузі, що й значення
        # (стор. 51: «51» прочиталось як значення). Це не рядок таблиці.
        if len(vals) == 1 and vals[0].text == page_no and not label_parts(r, stops)[0]:
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

        own = label_parts(r, stops)
        h = head_for(r[0].y0, bool(own[1]))
        unit = _zone(r, X_UNIT, X_VALS) or (h['unit'] if h else '')
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
        unit = '' if any(re.search(p, r['name']) for p in NO_UNIT_IF) else r['unit_raw']
        r['unit'] = _fix_unit(unit) or None
    return out, centers, header


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


def read_header(words, centers, table_top):
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

    rows = G.group_rows([w for w in words if w.y0 > table_top])
    head_rows = []
    for r in rows:
        marks = [w for w in r if w.x0 >= X_VALS and MODEL_RE.match(w.text)]
        label = ' '.join(w.text for w in r if w.x0 < X_UNIT)
        if not marks:
            # Рядок «Внутрішній блок» сам маркувань не має — це підпис шапки, і
            # шапка на ньому не закінчується. Кінець шапки — перший рядок, де в
            # колонках стоять ЗНАЧЕННЯ, а не маркування.
            if any(w.x0 >= X_VALS for w in r):
                break
            continue
        head_rows.append((label, marks))

    indoor = [[] for _ in centers]
    outdoor = [[] for _ in centers]
    for label, marks in head_rows:
        is_out = 'Зовнішній' in label or all(re.match(r'^(SRC|SCM|FDC)', w.text, re.I) for w in marks)
        for w in marks:
            (outdoor if is_out else indoor)[col_of(w)].extend(expand_marks(w.text))
    return indoor, outdoor
