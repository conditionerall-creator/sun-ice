# -*- coding: utf-8 -*-
"""Читання таблиць «ТЕХНІЧНІ ХАРАКТЕРИСТИКИ» НАПІВПРОМИСЛОВИХ блоків MHI (стор. 99–136).

ЧОМУ ОКРЕМО ВІД `tables.py` (побутові серії)
--------------------------------------------
`tables.py` вгадує рядки й підписи за положенням слів. На сторінках напівпрому це
дає хибні підписи: сусідні блоки різної висоти («Рівень звукового тиску» на три рядки,
під ним «Циркуляція повітря») перемішуються, і «Зовнішн.» опиняється під чужою назвою.
Цифри при цьому виходять правильні, а підпис — ні, і це гірше за помилку, бо її не видно.

Тут межі беруться НЕ з вгадування, а з самої сітки таблиці: pdftocairo віддає її лінії
(SVG), і рядок, об'єднана комірка підпису, об'єднана комірка значення — це просто
прямокутники між лініями. Слово належить комірці, у яку воно потрапило.

ЩО ТАКЕ КОЛОНКА НАПІВПРОМУ
--------------------------
Колонка — це КОМПЛЕКТ: внутрішній блок + зовнішній (рядки «Модель», «Внутрішній блок»,
«Зовнішній блок»). Є одинарні, «Подвійні» (два внутрішні на один зовнішній) і «Потрійні».
У прайсі позиція — теж пара «FDT100VH+FDC100VNX-W», тому ключ індексу — ПАРА, а не
окреме маркування: один і той самий внутрішній FDT100VH стоїть у п'яти різних колонках
(VNX, VNA, VNP, VSA, VSX), і за одним маркуванням його не відрізнити.
"""

import os
import re
import subprocess
import tempfile

import pdfgrid as G
import tables as T

# Усі координати — у пунктах сторінки (як у pdftotext -bbox): початок зліва зверху.
LINE_TOL = 0.7          # лінії, що відрізняються менше, вважаємо однією
MIN_BAND = 3.0          # рядок таблиці нижчий за це — не рядок


# --------------------------------------------------------------------------
# Сітка сторінки
# --------------------------------------------------------------------------
def page_segments(pdf_path, page, cache_dir=None):
    """Прямі відрізки сторінки: (x1, y1, x2, y2). Лише горизонтальні й вертикальні."""
    exe = G.poppler_tool('pdftocairo')
    cache_dir = cache_dir or os.path.join(tempfile.gettempdir(), 'sunice-semi-svg')
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, 'p%d.svg' % page)
    if not os.path.exists(out):
        r = subprocess.run([exe, '-svg', '-f', str(page), '-l', str(page), pdf_path, out],
                           capture_output=True, timeout=300)
        if r.returncode != 0 or not os.path.exists(out):
            raise RuntimeError('pdftocairo впав: ' + r.stderr.decode('utf-8', 'replace')[:300])
    with open(out, encoding='utf-8') as f:
        svg = f.read()

    segs = []
    num = r'([-\d.eE+]+)'
    simple = re.compile(r'M %s %s L %s %s' % (num, num, num, num))
    for tag in re.findall(r'<path\b[^>]*>', svg):
        if 'stroke=' not in tag:
            continue
        d = re.search(r'\bd="([^"]*)"', tag)
        if not d or len(d.group(1)) > 120:
            continue
        m = simple.fullmatch(d.group(1).strip())
        if not m:
            continue
        x1, y1, x2, y2 = [float(g) for g in m.groups()]
        tr = re.search(r'transform="matrix\(([^)]*)\)"', tag)
        a, b, c, dd, e, f = ([float(x) for x in tr.group(1).split(',')] if tr else (1, 0, 0, 1, 0, 0))
        X1, Y1 = a * x1 + c * y1 + e, b * x1 + dd * y1 + f
        X2, Y2 = a * x2 + c * y2 + e, b * x2 + dd * y2 + f
        if abs(Y1 - Y2) <= 0.3 or abs(X1 - X2) <= 0.3:
            segs.append((min(X1, X2), min(Y1, Y2), max(X1, X2), max(Y1, Y2)))
    return segs


def _cluster(values, tol=LINE_TOL):
    out = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


class Grid(object):
    """Лінії однієї таблиці + запити «чи є межа тут»."""

    def __init__(self, segs, y_top, y_bot):
        self.h = [s for s in segs if abs(s[1] - s[3]) <= 0.3 and y_top - 1 <= s[1] <= y_bot + 1]
        self.v = [s for s in segs if abs(s[0] - s[2]) <= 0.3 and s[3] >= y_top - 1 and s[1] <= y_bot + 1]

    def hline(self, y, x0, x1, cover=0.5):
        """Є горизонтальна лінія на висоті y, що перекриває [x0, x1] не менше ніж на cover."""
        need = (x1 - x0) * cover
        got = 0.0
        for s in self.h:
            if abs(s[1] - y) <= LINE_TOL:
                got += max(0.0, min(s[2], x1) - max(s[0], x0))
        return got >= need

    def vlines_at(self, y0, y1):
        """x вертикальних ліній, що перетинають смугу [y0, y1] (хоч наполовину)."""
        mid = (y0 + y1) / 2.0
        xs = [s[0] for s in self.v if s[1] <= mid <= s[3]]
        return _cluster(xs)


# --------------------------------------------------------------------------
# Пошук таблиць на сторінці
# --------------------------------------------------------------------------
SYSTEM_RE = re.compile(r'^(FD[A-Z]{1,3}|SRK|SKM)\d+[A-Z0-9]+$')


def find_tables(words, segs):
    """[(y_top, y_bot)] — по одній на таблицю.

    Початок — рядок із кодами комплектів (FDT100VNXWVH…): таблиць на сторінці стільки,
    скільки груп таких рядків, рознесених по вертикалі. За підписом «Модель» не можна:
    на стор. 136 у другій таблиці він притиснутий праворуч, а на стор. 120 стоїть на
    рядок нижче від кодів. Кінець — нижня лінія рядка «Номінал автоматичного вимикача»
    (в усіх таблицях він останній); таблицю не можна обривати за висотою рядка: на
    стор. 113 рядок «Магістраль» заввишки 34 пт."""
    ys = _cluster([s[1] for s in segs if abs(s[1] - s[3]) <= 0.3 and s[2] - s[0] > 20 and s[0] > 230])
    code_ys = sorted(set(round(w.y0) for w in words if SYSTEM_RE.match(w.text) and w.x0 > 150))
    starts = []
    for y in code_ys:
        if not starts or y - starts[-1][-1] > 80:
            starts.append([y])
        else:
            starts[-1].append(y)
    tops = []
    for grp in starts:
        y = grp[0]
        above = [l for l in ys if l < y - 1]
        # лінія над рядком кодів = верх смуги кодів; над нею — зелена смуга «R32 …»
        tops.append(above[-2] if len(above) >= 2 else (above[-1] if above else y - 20))
    out = []
    for i, top in enumerate(tops):
        limit = tops[i + 1] - 1 if i + 1 < len(tops) else 10 ** 6
        nom = [w for w in words if w.text == 'Номінал' and top < w.y0 < limit]
        if nom:
            last = max(nom, key=lambda w: w.y0)
            mid = (last.y0 + last.y1) / 2.0
            below = [l for l in ys if l > mid + 0.5]   # нижня лінія РЯДКА, а не нижче за текст
            bot = min(below) if below else last.y1 + 4
        else:
            bot = max([l for l in ys if top < l < limit] or [top])
        out.append((top, bot))
    return out


# --------------------------------------------------------------------------
# Розбір однієї таблиці
# --------------------------------------------------------------------------


def _inside(w, x0, x1, y0, y1):
    return x0 <= w.cx < x1 and y0 <= (w.y0 + w.y1) / 2.0 < y1


def _text(ws):
    """Слова комірки: рядки зверху вниз, у рядку зліва направо; один пробіл між словами."""
    rows = G.group_rows(sorted(ws, key=lambda w: (round(w.y0, 1), w.x0)), tol=2.5)
    return ' '.join(' '.join(w.text for w in r) for r in rows).strip()


# Підпис → що має бути у значенні. Лише те, що за змістом однозначно: за цими парами
# виявляється зсув підписів (стор. 102 і подібні) — а не «на око».
SHIFT_CHECKS = [
    (r'^Електроживлення', r'фаз'),
    (r'^Холодопродуктивність', r'~'),
    (r'^Теплопродуктивність', r'~'),
    (r'^Підключення живлення', r'(зовнішній|внутрішній) блок'),
    (r'^Кабель живлення', r'\d\s*[хxХX]\s*\d'),
    (r'^Міжблочний кабель', r'\d\s*[хxХX]\s*\d'),
    (r'^Номінал автоматичного', r'^\d+$'),
]


def _compositions(n, k):
    """Усі розбиття n колонок на k послідовних блоків (довжини ≥ 1)."""
    if k == 1:
        yield (n,)
        return
    for first in range(1, n - k + 2):
        for rest in _compositions(n - first, k - 1):
            yield (first,) + rest


def _split_by_columns(ws, cs):
    """Комірка накрила кілька колонок, але лінії між ними в цьому рядку не надруковано
    (стор. 102 «Пусковий струм», стор. 111/124 «Номінал…»). Тоді дивимось на САМ ТЕКСТ:
    рядок розпадається на k окремих груп слів (розрив між групами більший за міжслівний).
    Кожна група — це або значення однієї колонки, або об'єднаної комірки кількох сусідніх
    колонок; значення об'єднаної комірки стоїть по центру її колонок. Беремо те розбиття
    колонок на k блоків, де центри блоків найближчі до центрів груп.
    Одне значення на весь об'єднаний шматок (k = 1) груп не дає — лишається цілим."""
    n = len(cs)
    if n < 2 or not ws:
        return None
    rows = G.group_rows(sorted(ws, key=lambda w: (round(w.y0, 1), w.x0)), tol=2.5)
    step = (cs[-1] - cs[0]) / (n - 1)
    gap = max(8.0, 0.18 * step)
    per = None
    for r in rows:
        groups, cur = [], [r[0]]
        for w in r[1:]:
            if w.x0 - cur[-1].x1 > gap:
                groups.append(cur)
                cur = []
            cur.append(w)
        groups.append(cur)
        if per is None:
            per = [[] for _ in groups]
        if len(groups) != len(per):
            return None
        for k, g in enumerate(groups):
            per[k].append(g)
    k = len(per)
    if k < 2 or k > n:
        return None
    gcs = []
    for col in per:
        xs = [(g[0].x0 + g[-1].x1) / 2.0 for g in col]
        gcs.append(sum(xs) / len(xs))
    best = None
    for comp in _compositions(n, k):
        i, cost, ok = 0, 0.0, True
        for gi, size in enumerate(comp):
            mid = sum(cs[i:i + size]) / size
            dev = abs(gcs[gi] - mid)
            if dev > 0.6 * step:
                ok = False
                break
            cost += dev
            i += size
        if ok and (best is None or cost < best[0]):
            best = (cost, comp)
    if best is None:
        return None
    out, i = [], 0
    for gi, size in enumerate(best[1]):
        txt = ' '.join(' '.join(w.text for w in g) for g in per[gi])
        out.extend([txt] * size)
        i += size
    return out


def parse_table(words, segs, y_top, y_bot, page, report):
    grid = Grid(segs, y_top, y_bot)
    ys = [y for y in _cluster([s[1] for s in grid.h]) if y_top - 1 <= y <= y_bot + 1]
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1) if ys[i + 1] - ys[i] >= MIN_BAND]
    if len(bands) < 8:
        raise ValueError('стор. %d: у таблиці знайшлось лише %d рядків' % (page, len(bands)))
    tw = [w for w in words if y_top - 1 <= (w.y0 + w.y1) / 2.0 <= y_bot + 1]

    # --- межі підписових колонок: кінці горизонтальних відрізків ліворуч -----------
    ends = _cluster([x for s in grid.h if s[0] < 260 for x in (s[0], s[2]) if x < 262], tol=1.5)
    # --- рядок із кодами комплектів: перший рядок, у якому є коди систем -------------
    # (підпис «Модель» стоїть по центру об'єднаної комірки й буває на рядок нижче
    # від самих кодів, тому за підписом рядок шукати не можна — стор. 120)
    def system_words(i):
        return sorted([w for w in tw if bands[i][0] <= (w.y0 + w.y1) / 2.0 < bands[i][1]
                       and SYSTEM_RE.match(w.text)], key=lambda w: w.x0)
    code_i = next((i for i in range(len(bands)) if len(system_words(i)) >= 1), None)
    if code_i is None:
        raise ValueError('стор. %d: у таблиці немає кодів комплектів' % page)
    cb = bands[code_i]
    codes = system_words(code_i)
    # Код першої колонки може бути ширшим за свою комірку й вилазити ліворуч (стор. 107),
    # тому межу зони значень беремо за ЦЕНТРОМ коду, а не за його лівим краєм.
    value_start = max([e for e in ends if e <= codes[0].cx - 5] or [codes[0].x0 - 3])
    lab_edges = [e for e in ends if e <= value_start + 0.5]
    if len(lab_edges) < 3:
        raise ValueError('стор. %d: не знайдено колонок підписів' % page)
    lab_cells = list(zip(lab_edges[:-1], lab_edges[1:]))
    unit_cell, text_cells = lab_cells[-1], lab_cells[:-1]
    centers = [w.cx for w in codes]

    def block(i, x0, x1):
        """Об'єднана комірка підпису, що містить рядок i, і її слова."""
        a = i
        while a > 0 and not grid.hline(bands[a][0], x0, x1):
            a -= 1
        b = i
        while b < len(bands) - 1 and not grid.hline(bands[b][1], x0, x1):
            b += 1
        ws = [w for w in tw if _inside(w, x0, x1, bands[a][0], bands[b][1])]
        return (a, b), ws

    def label_of(i):
        """Підпис рядка i: комірки між вертикальними лініями ЦЬОГО рядка (назва буває
        розтягнута на кілька підколонок без ліній між ними), кожна — з урахуванням
        об'єднання по вертикалі. Остання вузька колонка — одиниця виміру."""
        xs = [e for e in grid.vlines_at(bands[i][0] + 0.5, bands[i][1] - 0.5)
              if lab_edges[0] - 1 <= e <= value_start + 1]
        xs = sorted(set([lab_edges[0]] + [e for e in xs if lab_edges[0] + 1 < e < unit_cell[0] - 1] + [unit_cell[0]]))
        parts = []
        for x0, x1 in zip(xs[:-1], xs[1:]):
            _, ws = block(i, x0, x1)
            t = _text(ws)
            if t and t not in parts:
                parts.append(t)
        _, uws = block(i, *unit_cell)
        return ' · '.join(parts), T._fix_unit(_text(uws))

    # --- початок даних: рядок одразу ПІСЛЯ останнього рядка з маркуваннями блоків ----
    # (за підписом «Електроживлення» не можна: у каталозі на деяких сторінках підписи
    # зсунуті відносно значень, і саме так вони й опинялись не там)
    def has_marks(i):
        return any(T.MODEL_RE.match(w.text) and len(w.text) > 4
                   and _inside(w, value_start, 10 ** 6, bands[i][0], bands[i][1]) for w in tw)
    last_mark = code_i
    for i in range(code_i + 1, len(bands)):
        if has_marks(i):
            last_mark = i
        elif i > last_mark + 2:
            break
    first_data = last_mark + 1

    # --- шапка: система, внутрішній/зовнішній блок, тип комплекту ------------------
    ncol = len(codes)
    cols = [{'system': c.text, 'indoor': [], 'outdoor': [], 'tag': None} for c in codes]

    def col_of(cx):
        return min(range(ncol), key=lambda k: abs(centers[k] - cx))

    for i in range(code_i + 1, first_data):
        hw = [w for w in tw if _inside(w, value_start, 10 ** 6, bands[i][0], bands[i][1])]
        hw.sort(key=lambda w: (col_of(w.cx), round(w.y0, 1), w.x0))
        k = 0
        while k < len(hw):
            w = hw[k]
            c = cols[col_of(w.cx)]
            t = w.text
            if re.match(r'^(Подвійна|Потрійна|Одинарна|Четвірна)$', t, re.I):
                c['tag'] = t
            elif T.MODEL_RE.match(t) and len(t) > 4:
                n = 1
                # «FDT50VH x 2» — три слова поспіль; множник приклеюємо до маркування
                if k + 2 < len(hw) and hw[k + 1].text in ('x', 'х', 'X', '×') \
                        and re.fullmatch(r'\d', hw[k + 2].text) and col_of(hw[k + 2].cx) == col_of(w.cx):
                    n = int(hw[k + 2].text)
                    k += 2
                (c['outdoor'] if re.match(r'^(FDC|SRC|SCM)', t, re.I) else c['indoor']).append({'m': t, 'n': n})
            k += 1

    # --- зелена смуга над «Модель»: холодоагент і технологія ------------------------
    tech = ''
    if code_i > 0:
        gw = [w for w in tw if bands[0][0] <= (w.y0 + w.y1) / 2.0 < cb[0]]
        tech = _text(gw)

    # --- рядки даних -----------------------------------------------------------------
    right = max(s[2] for s in grid.h)

    def read_values(i):
        edges = [e for e in grid.vlines_at(bands[i][0] + 0.5, bands[i][1] - 0.5) if e >= value_start - 0.5]
        if not edges or abs(edges[0] - value_start) > 1.5:
            edges = [value_start] + edges
        if abs(edges[-1] - right) > 1.5:
            edges.append(right)
        vals = [None] * ncol
        bad = False
        for (x0, x1) in zip(edges[:-1], edges[1:]):
            cov = [k for k, c in enumerate(centers) if x0 <= c < x1]
            ws = [w for w in tw if _inside(w, x0, x1, bands[i][0], bands[i][1])]
            txt = _text(ws)
            if not cov:
                bad = bad or bool(txt)
                continue
            parts = _split_by_columns(ws, [centers[k] for k in cov]) if len(cov) > 1 else None
            for n, k in enumerate(cov):
                vals[k] = (parts[n] if parts else txt) or None
        return vals, bad

    # Підписи читаємо й для рядка, що стоїть НА ОСТАННЬОМУ РЯДКУ ШАПКИ: у каталозі на
    # частині сторінок підписи зсунуті відносно значень на один рядок (див. SHIFT_CHECKS).
    printed = {i: label_of(i) for i in range(first_data - 1, len(bands))}
    values = {i: read_values(i) for i in range(first_data, len(bands))}
    for i, (_, bad) in values.items():
        if bad:
            report.append('СУМНІВНО  стор. %d, рядок %d: текст у комірці без колонки' % (page, i))

    def build(shift):
        out = []
        for i in range(first_data, len(bands)):
            name, unit = printed[i - shift]
            name = re.sub(r'вище/\s+нижче', 'вище/нижче', name)
            vals = values[i][0]
            if not name and all(v is None for v in vals):
                continue
            out.append({'name': name, 'unit': unit, 'y': bands[i][0], 'values': vals})
        return out

    def violations(rows):
        n = 0
        for r in rows:
            for lab, val in SHIFT_CHECKS:
                if re.match(lab, r['name']):
                    n += sum(1 for v in r['values'] if v and not re.search(val, v))
        return n

    r0, r1 = build(0), build(1)
    v0, v1 = violations(r0), violations(r1)
    shift = 0
    if v1 < v0:
        shift = 1
        report.append('УВАГА  стор. %d: підписи рядків у каталозі зсунуті на один рядок відносно значень '
                      '(перевірка за змістом: %d невідповідностей → %d після зсуву) — виправлено' % (page, v0, v1))
    rows = r1 if shift else r0
    left = violations(rows)
    if left:
        report.append('ПЕРЕВІРКА  стор. %d: після вирівнювання лишилось %d невідповідностей підпису й значення' % (page, left))
    return {'page': page, 'tech': tech, 'columns': cols, 'rows': rows, 'ncol': ncol, 'shift': shift}


# --------------------------------------------------------------------------
# Аксесуари напівпрому — зі СТРОК таблиці («Пульт керування», «Панель», «Опції та
# аксесуари», «Повітряний фільтр»). Окремої сторінки аксесуарів, як у побутових серій,
# у напівпромі немає, тому беремо лише те, що в цих рядках НАПИСАНО; нічого не добудовуємо.
# --------------------------------------------------------------------------
_REMOTE = re.compile(r'\bRC[HN]?-[A-Z0-9]+(?:\([A-Z]\))?(?:-[A-Z0-9]+)*')
_PANEL = re.compile(r'\bTC?-PSA[GE]*-5[A-Z]{2}-E\d?')
_SENSOR = re.compile(r'\bLB-[A-Z0-9]+(?:-[A-Z0-9]+)*')
_PAREN = re.compile(r'\s*\(([^)]*)\)')

# Друкарські вади текстового шару каталогу (звірено з зображенням сторінки): зайва «X»
# усередині слова і пропущені літери в слові «підмішування свіжого повітря».
TEXT_FIXES = [
    ('адапXтер', 'адаптер'),
    ('підмісу свижого овітря', 'підмішування свіжого повітря'),
    ('м 3 /год', 'м³/год'),
]


def clean_text(t):
    for a, b in TEXT_FIXES:
        t = t.replace(a, b)
    return re.sub(r'\s+', ' ', t).strip()


def _items(text, rx):
    """[(маркування, примітка в дужках або '')] — примітка лише якщо вона одразу за маркуванням."""
    out, pos = [], 0
    for m in rx.finditer(text):
        note = ''
        p = _PAREN.match(text, m.end())
        if p and re.search(r'[А-Яа-яІіЇїЄє]', p.group(1)):
            note = p.group(1).strip()
        out.append((m.group(0), note))
    return out


def parse_semi_accessories(rows, page):
    """rows: {'remote':…, 'panel':…, 'opts':…, 'filter':…} — тексти рядків таблиці для ОДНІЄЇ колонки."""
    out = []

    def add(kind, name, state, note=None):
        if not any(a['kind'] == kind and a['name'] == name for a in out):
            out.append({'kind': kind, 'name': name, 'state': state, 'note': note or None, 'page': page})

    rem = clean_text(rows.get('remote') or '')
    if rem:
        m = re.search(r'бездротов\w*\s*:', rem)
        wired, wireless = (rem[:m.start()], rem[m.end():]) if m else (rem, '')
        for name, note in _items(wired, _REMOTE):
            add('remote', name, 'yes' if 'в комплекті' in note else 'option',
                'Дротовий пульт керування.' + (' ' + note[0].upper() + note[1:] + '.' if note and 'в комплекті' not in note else ''))
        if re.search(r'адаптер\s+SC-[A-Z0-9-]+', wired):
            ad = re.search(r'SC-[A-Z0-9-]+', wired).group(0)
            add('adapter', ad, 'option', 'Дротові пульти підключаються через адаптер ' + ad + '.')
        for name, note in _items(wireless, _REMOTE):
            st = 'yes' if 'в комплекті' in note else 'option'
            extra = '' if note in ('', 'опція', 'в комплекті') else ' ' + note[0].upper() + note[1:] + '.'
            add('remote', name, st, 'Бездротовий пульт керування.' + extra)

    pan = clean_text(rows.get('panel') or '')
    for name, note in _items(pan, _PANEL):
        add('panel', name, 'option', (note[0].upper() + note[1:] + '.') if note else None)

    op = clean_text(rows.get('opts') or '')
    if op:
        sm = re.search(r'Датчик руху(.*?)(?=Wi-Fi|Комплект|$)', op)
        if sm:
            for name, note in _items(sm.group(1), _SENSOR):
                add('sensor', name, 'option', 'Датчик руху.' + (' ' + note[0].upper() + note[1:] + '.' if note else ''))
        wm = re.search(r'Wi-Fi-адаптер\s+([A-Z0-9/]+)', op)
        if wm:
            add('wifi', 'Wi-Fi-адаптер ' + wm.group(1), 'option', None)
        km = re.search(r'(Комплект[^:]*?)(?:\s*:\s*(.*))?$', op[op.find('Комплект'):] if 'Комплект' in op else '')
        if km and 'Комплект' in op:
            add('other', km.group(1).strip(), 'option', (km.group(2) or '').strip() or None)

    flt = clean_text(rows.get('filter') or '')
    if flt:
        if flt.startswith('Опція'):
            add('filter', flt.split(':', 1)[1].strip(), 'option', 'Опція.')
        elif 'Купується на місці' in flt:
            add('filter', 'Купується на місці', 'option', 'Фільтр у комплект не входить.')
        elif re.search(r'Антиалергенний.*Фотокаталітичний', flt):
            add('filter', 'Антиалергенний', 'yes', 'У комплекті, x 1.')
            add('filter', 'Фотокаталітичний', 'yes', 'У комплекті, x 1.')
        else:
            m = re.match(r'^(.*?)\s*[xх×]\s*(\d+)\s*(.*)$', flt)
            if m:
                tail = m.group(3).strip()
                add('filter', (m.group(1) + (' ' + tail if tail else '')).strip(), 'yes', 'У комплекті, x %s.' % m.group(2))
            else:
                add('filter', flt, 'yes', 'У комплекті.')
    return out
