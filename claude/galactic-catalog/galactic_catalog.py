# -*- coding: utf-8 -*-
"""Читання таблиць «Характеристики» з каталогу Galactic (cat_Galactic.pdf).

Той самий підхід, що й для напівпрому MHI (`claude/mhi-catalog/semi_catalog.py`): межі рядків,
об'єднаних комірок підпису й об'єднаних комірок значення беруться з САМОЇ СІТКИ таблиці (pdftocairo →
лінії SVG), а не вгадуються за положенням слів. Слово належить комірці, у яку воно потрапило.

Таблиця Galactic: ліворуч підписи (основний · підпис блока · одиниця), далі колонки моделей. Рядок
заголовка — «Модель | GKZ/GCZ 09SH-W | …» (спліт: пара внутрішній/зовнішній в одній комірці) або два
рядки «внутр.: GDZ18MLQ-W | зовн.: GCZ18MLNQ-W» (напівпром).

ПРАВИЛО ПРО ЦИФРИ (те саме, що для MHI): значення — як надруковано. Немає в каталозі — немає в даних.
Не інтерполювати, не брати «у сусідньої моделі так само», не брати з інтернету.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'mhi-catalog'))
import pdfgrid as G                                            # noqa: E402
import semi_catalog as S                                       # noqa: E402
import tables as T                                             # noqa: E402

MIN_BAND = S.MIN_BAND
MODEL_CELL = re.compile(r'^G[A-Z]{1,3}[0-9A-Z/\- ]*\d')       # «GKZ/GCZ 09SH-W», «GDZ18MLQ-W», «GMZ2-14M-W»


UNIT_FIXES = [
    (r'^мм\s*дюйм$', 'мм (дюйм)'),
    (r'^м\s*3\s*/\s*г[oо]д$', 'м³/год'),
    (r'^мм\s*2$', 'мм²'),
]


def fix_unit(u):
    u = re.sub(r'\s+', ' ', u or '').strip()
    for pat, rep in UNIT_FIXES:
        if re.match(pat, u):
            return rep
    return u


def page_data(pdf, page, cache_dir):
    return G.page_words(pdf, page), S.page_segments(pdf, page, cache_dir=cache_dir)


def find_table_tops(words, segs=None):
    """y верху кожної таблиці. Якір — підпис «Модель» у лівій колонці; він стоїть по центру
    об'єднаної комірки, тому на сторінках напівпрому (два рядки заголовка: внутр. і зовн.) він
    нижче за верхній рядок. Верх таблиці — найвища горизонтальна лінія в межах 30 пт над якорем."""
    out = []
    ys = sorted(set(round(s[1], 1) for s in segs if abs(s[1] - s[3]) <= 0.3 and s[2] - s[0] > 20)) if segs else []
    for w in words:
        if w.text == 'Модель' and w.x0 < 260:
            near = [y for y in ys if w.y0 - 30 <= y <= w.y0 + 1]
            out.append(min(near) if near else w.y0 - 4)
    return out


def read_table(words, segs, y_top, y_bot, page, report, min_bands=5):
    """Повертає {'columns': [str], 'header': [[str…]…], 'rows': [{'name','unit','values'}]}.

    y_top — трохи вище підпису «Модель»; y_bot — де закінчується сітка (нижня лінія).
    """
    grid = S.Grid(segs, y_top, y_bot)
    ys = [y for y in S._cluster([s[1] for s in grid.h if s[2] - s[0] > 20]) if y_top - 1 <= y <= y_bot + 1]
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1) if ys[i + 1] - ys[i] >= MIN_BAND]
    if len(bands) < min_bands:
        raise ValueError('стор. %d: у таблиці знайшлось лише %d рядків' % (page, len(bands)))
    tw = [w for w in words if y_top - 1 <= (w.y0 + w.y1) / 2.0 <= y_bot + 1]

    def cells_of(i, x_from=None):
        a, b = bands[i]
        xs = sorted(set(grid.vlines_at(a + 0.5, b - 0.5)))
        if x_from is not None:
            xs = [x for x in xs if x >= x_from - 1]
        return list(zip(xs[:-1], xs[1:]))

    def text_in(i, x0, x1, extend=True):
        a, b = bands[i]
        ws = [w for w in tw if x0 <= w.cx < x1 and a <= (w.y0 + w.y1) / 2.0 < b]
        return S._text(ws)

    # --- рядки заголовка: перші смуги, де в клітинках значень стоять коди моделей ------
    def header_cells(i):
        out = []
        for (x0, x1) in cells_of(i):
            t = text_in(i, x0, x1)
            if t and MODEL_CELL.match(t):
                out.append((x0, x1, t))
        return out

    hdr_idx = []
    for i in range(len(bands)):
        if header_cells(i):
            hdr_idx.append(i)
        elif hdr_idx:
            break
    if not hdr_idx:
        raise ValueError('стор. %d: не знайшлось рядка з моделями' % page)
    first = header_cells(hdr_idx[0])
    value_start = min(c[0] for c in first)
    centers = [(c[0] + c[1]) / 2.0 for c in first]
    ncol = len(first)

    # --- одиниця виміру: вузька колонка безпосередньо ліворуч від значень ---------------
    from collections import Counter
    cnt = Counter()
    for i in range(len(bands)):
        for x in grid.vlines_at(bands[i][0] + 0.5, bands[i][1] - 0.5):
            if value_start - 70 < x < value_start - 4:
                cnt[round(x)] += 1
    unit_x = None
    if cnt:
        unit_x = max(cnt.items(), key=lambda kv: (kv[1], kv[0]))[0]

    # --- підпис рядка з урахуванням вертикального об'єднання комірок --------------------
    def block_text(i, x0, x1):
        a = i
        while a > 0 and not grid.hline(bands[a][0], x0, x1):
            a -= 1
        b = i
        while b < len(bands) - 1 and not grid.hline(bands[b][1], x0, x1):
            b += 1
        ws = [w for w in tw if x0 <= w.cx < x1 and bands[a][0] <= (w.y0 + w.y1) / 2.0 < bands[b][1]]
        return S._text(ws)

    def label_of(i):
        xs = [x for x in grid.vlines_at(bands[i][0] + 0.5, bands[i][1] - 0.5) if x <= value_start + 1]
        left = min(xs) if xs else 0
        lab_edges = sorted(set(xs + [value_start]))
        parts, unit = [], ''
        for x0, x1 in zip(lab_edges[:-1], lab_edges[1:]):
            t = block_text(i, x0, x1)
            if not t:
                continue
            if unit_x is not None and abs(x0 - unit_x) <= 3 and abs(x1 - value_start) <= 3                     and not re.match(r'^(холод|тепло|охолодження|обігрів)$', t, re.I):
                unit = t
            elif t not in parts:
                parts.append(t)
        return ' · '.join(parts), T._fix_unit(unit)

    # --- значення з урахуванням об'єднаних по горизонталі комірок -------------------------
    def values_of(i):
        vals = [None] * ncol
        a, b = bands[i]
        edges = [e for e in grid.vlines_at(a + 0.5, b - 0.5) if e >= value_start - 1]
        right = max(s[2] for s in grid.h)
        if not edges or abs(edges[0] - value_start) > 2:
            edges = [value_start] + edges
        if abs(edges[-1] - right) > 2:
            edges.append(right)
        for x0, x1 in zip(edges[:-1], edges[1:]):
            cov = [k for k, c in enumerate(centers) if x0 <= c < x1]
            ws = [w for w in tw if x0 <= w.cx < x1 and a <= (w.y0 + w.y1) / 2.0 < b]
            txt = S._text(ws)
            if not cov:
                continue
            parts = S._split_by_columns(ws, [centers[k] for k in cov]) if len(cov) > 1 else None
            for n, k in enumerate(cov):
                vals[k] = (parts[n] if parts else txt) or None
        return vals

    header = [[(c[2]) for c in sorted(header_cells(i), key=lambda c: c[0])] for i in hdr_idx]
    columns = [c[2] for c in sorted(first, key=lambda c: c[0])]
    rows = []
    for i in range(hdr_idx[-1] + 1, len(bands)):
        name, unit = label_of(i)
        vals = values_of(i)
        if not name and all(v is None for v in vals):
            continue
        rows.append({'name': name, 'unit': fix_unit(unit) or None, 'y': bands[i][0], 'values': vals})
    return {'page': page, 'columns': columns, 'header': header, 'rows': rows, 'ncol': ncol}
