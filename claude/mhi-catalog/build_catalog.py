# -*- coding: utf-8 -*-
"""Збирає data/mhi-catalog.json із PDF-каталогу MHI.

Запуск (з кореня репозиторію):
    python claude/mhi-catalog/build_catalog.py
    python claude/mhi-catalog/build_catalog.py --render   # + PNG сторінок для звірки очима

ЩО РОБИТЬ МАШИНА, А ЩО ЛЮДИНА
------------------------------
Машина читає ЗНАЧЕННЯ — по координатах слів, разом із об'єднаними комірками.
Саме тут помиляється людина, і саме тут плоский `pdftotext -layout` дає брехню
(перевірено на стор. 34: він зсуває значення на рядок).

Людина виписує НАЗВИ рядків (`ROWS` у конфігу серії) — подивившись на сторінку.
Колонка назв у цьому каталозі багаторядкова («Рівень / звукової / потужності»
трьома рядками з вертикальним центруванням), і жодна автоматика не визначить
надійно, до якого рядка значень належить який заголовок.

Щоб ця ручна частина не роз'їхалась із PDF, кожен запис має `match` — шматок
тексту, який МУСИТЬ знайтись у власній (автоматично прочитаній) підпису-колонці
того самого рядка. Не збіглось або кількість рядків інша — скрипт падає з
переліком розбіжностей і нічого не записує. Тихої підміни бути не може.

ПРАВИЛО ПРО ЦИФРИ: немає значення в каталозі → `null`. Не інтерполювати, не
брати «у сусіда так само», не рахувати за формулою, не брати з інтернету.
"""

import os
import re
import sys
import json
import argparse
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdfgrid as G                                            # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.path.join(os.path.dirname(ROOT), 'Sun-ice — довідники', 'catalog-mhi-rac-pac.pdf')
OUT = os.path.join(ROOT, 'data', 'mhi-catalog.json')
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')

# Зони сторінки по X (pt). Однакові для всіх сторінок таблиць цього каталогу.
X_LABEL_MAIN = 86.0      # головна колонка назв: x < 86
X_LABEL_SUB = 120.0      # підколонка «Внутр./Зовнішн.»: 86 ≤ x < 120
X_UNIT = 200.0           # друга підколонка назв: 120 ≤ x < 200
X_VALUES = 240.0         # колонка одиниць: 200 ≤ x < 240; значення: x ≥ 240


# --------------------------------------------------------------------------
# Серія SRK-ZSX-W Diamond, стор. 34. Пілот (рішення власника 2026-10-19).
# ROWS — (назва, що має знайтись у власному підписі рядка, [одиниця]).
# Порядок такий самий, як у надрукованій таблиці. Третій елемент потрібен там, де
# одиницю надруковано один раз на кілька рядків (об'єднана комірка) — машині вона
# дістається лише одному з них. Це транскрипція зі сторінки, не обчислення.
# --------------------------------------------------------------------------
ZSX_ROWS = [
    ('Електроживлення',                                      r'Електроживлення'),
    ('Холодопродуктивність (Min~Max)',                       r'Холодопродуктивність'),
    ('Теплопродуктивність (Min~Max)',                        r'Теплопродуктивність'),
    ('Споживана потужність, охолодження / обігрів',          r'Споживана потужність'),
    ('SEER / SCOP',                                          r'SEER', ''),
    ('Макс. пусковий струм',                                 r'пусковий струм'),
    ('Рівень звукової потужності, внутр., охолодження / обігрів',  r'Внутр', 'дБ(A)'),
    ('Рівень звукової потужності, зовнішн., охолодження / обігрів', r'Зовнішн', 'дБ(A)'),
    ('Рівень звукового тиску, внутр., охолодження (Hi/Me/Lo/Ulo)',  r'Внутр', 'дБ(A)'),
    ('Рівень звукового тиску, внутр., обігрів (Hi/Me/Lo/Ulo)',      r'Обігрів'),
    ('Рівень звукового тиску, зовнішн., охолодження / обігрів',     r'Зовнішн', 'дБ(A)'),
    ('Циркуляція повітря, внутр., охолодження (Hi/Me/Lo/Ulo)',      r'Охолодження', 'м³/хв'),
    ('Циркуляція повітря, внутр., обігрів (Hi/Me/Lo/Ulo)',          r'Обігрів', 'м³/хв'),
    ('Циркуляція повітря, зовнішн., охолодження / обігрів',         r'Зовнішн', 'м³/хв'),
    ('Розміри внутрішнього блока (Ш х В х Г)',               r'Внутр', 'мм'),
    ('Розміри зовнішнього блока (Ш х В х Г)',                r'Зовнішн', 'мм'),
    ('Міжлапна відстань опор зовнішнього блока',             r'Міжлапна'),
    ('Вага нетто, внутрішній / зовнішній',                   r'Вага нетто'),
    ('Холодоагент, тип / GWP',                               r'Тип/GWP'),
    ('Холодоагент, заводська заправка',                      r'Заводська заправка', 'кг/TCO₂Eq'),
    ('Приєднання труб, рідина / газ',                        r'Рідина'),
    ('Максимальна довжина труб [заводська заправка]',        r'Максимальна довжина труб'),
    ('Дозаправка холодоагенту',                              r'Дозаправка'),
    ('Макс. перепад висот, зовнішн. вище / нижче',           r'вище'),
    ('Робочий діапазон зовнішніх температур, охолодження',   r'Охолодження', '°C'),
    ('Робочий діапазон зовнішніх температур, обігрів',       r'Обігрів', '°C'),
    ('Повітряний фільтр',                                    r'Повітряний фільтр'),
    ('Підключення живлення',                                 r'Підключення живлення'),
    ('Кабель живлення',                                      r'Кабель живлення', 'мм²'),
    ('Міжблочний кабель',                                    r'Міжблочний кабель', 'мм²'),
    ('Номінал автоматичного вимикача',                       r'Номінал автоматичного'),
]

# Аксесуари й пульти — виписані зі сторінки серії (це підписи під малюнками, а не
# таблиця, автоматично їх не зібрати без домислювання). `verify` — текст, який
# МУСИТЬ бути на тій сторінці; немає його — збірка падає, а не мовчить.
ZSX_ACCESSORIES = [
    {'kind': 'remote', 'name': 'Бездротовий пульт ДК', 'state': 'yes',
     'note': None, 'verify': 'Бездротовий'},
    {'kind': 'remote', 'name': 'RC-ES1', 'state': 'option',
     'note': 'Дротовий пульт. Підключається через адаптер SC-BIKN2-E.', 'verify': 'RC-ES1'},
    {'kind': 'remote', 'name': 'RC-EX3A(D)', 'state': 'option',
     'note': 'Дротовий пульт. Підключається через адаптер SC-BIKN2-E.', 'verify': 'RC-EX3A(D)'},
    {'kind': 'remote', 'name': 'RC-E5', 'state': 'option',
     'note': 'Дротовий пульт. Підключається через адаптер SC-BIKN2-E.', 'verify': 'RC-E5'},
    {'kind': 'remote', 'name': 'RCH-E3', 'state': 'option',
     'note': 'Дротовий пульт. Підключається через адаптер SC-BIKN2-E.', 'verify': 'RCH-E3'},
    {'kind': 'adapter', 'name': 'SC-BIKN2-E', 'state': 'option',
     'note': ('Адаптер для дротового пульта. Для моделей SRK-ZSX-WF його можна '
              'підключити тільки після відключення Wi-Fi-модуля.'),
     'verify': 'SC-BIKN2-E'},
    {'kind': 'wifi', 'name': 'Керування через Wi-Fi', 'state': 'depends',
     'note': ('Моделі SRK-ZSX-WF мають вбудований Wi-Fi-модуль у стандартній '
              'комплектації. Для моделей SRK-ZSX-W Wi-Fi-модуль доступний як опція.'),
     'verify': 'Wi-Fi-модуль'},
    {'kind': 'filter', 'name': 'Антиалергенний фільтр', 'state': 'yes',
     'note': 'x 1, у стандартній комплектації.', 'verify': 'Антиалергенний'},
    {'kind': 'filter', 'name': 'Фотокаталітичний дезодоруючий фільтр', 'state': 'yes',
     'note': 'x 1, у стандартній комплектації. Багаторазовий, миється.',
     'verify': 'Фотокаталітичний'},
]

SERIES = [{
    'key': 'SRK-ZSX-W',
    'title': 'Серія SRK-ZSX-W, -WF. Diamond Series',
    'group': 'Побутові спліт-системи настінного типу',
    'page': 34,
    'table_below': 505.0,          # таблиця починається нижче заголовка «ТЕХНІЧНІ ХАРАКТЕРИСТИКИ»
    'rows': ZSX_ROWS,
    # Маркування внутрішніх блоків по колонках. У каталозі на одну колонку припадає
    # кілька кольорових виконань — вони там так і надруковані, це не домислювання.
    'models': [
        ['SRK20ZSX-W', 'SRK20ZSX-WB', 'SRK20ZSX-WT', 'SRK20ZSX-WF', 'SRK20ZSX-WFB', 'SRK20ZSX-WFT'],
        ['SRK25ZSX-W', 'SRK25ZSX-WB', 'SRK25ZSX-WT', 'SRK25ZSX-WF', 'SRK25ZSX-WFB', 'SRK25ZSX-WFT'],
        ['SRK35ZSX-W', 'SRK35ZSX-WB', 'SRK35ZSX-WT', 'SRK35ZSX-WF', 'SRK35ZSX-WFB', 'SRK35ZSX-WFT'],
        ['SRK50ZSX-W', 'SRK50ZSX-WB', 'SRK50ZSX-WT', 'SRK50ZSX-WF', 'SRK50ZSX-WFB', 'SRK50ZSX-WFT'],
        ['SRK60ZSX-W', 'SRK60ZSX-WB', 'SRK60ZSX-WT', 'SRK60ZSX-WF', 'SRK60ZSX-WFB', 'SRK60ZSX-WFT'],
    ],
    'outdoor': ['SRC20ZSX-W', 'SRC25ZSX-W', 'SRC35ZSX-W', 'SRC50ZSX-W3', 'SRC60ZSX-W3'],
    # Маркування, у яких Wi-Fi вбудований (решта серії — опція). Це написано на тій
    # самій сторінці каталогу, тому не домислювання: «Моделі SRK-ZSX-WF мають
    # вбудований Wi-Fi-модуль… Для моделей SRK-ZSX-W — як опція».
    'wifi_builtin': 'ZSXWF',
    'funcs_col_x': 277.0,          # колонка ZSX у матриці функцій на стор. 33
    'accessories': ZSX_ACCESSORIES,
}]


# --------------------------------------------------------------------------
# Матриця «ПЕРЕЛІК ФУНКЦІЙ», стор. 33: рядок — функція, колонка — серія.
# Беремо ЛИШЕ колонку своєї серії. «●» = є штатно, «опція» = доплатою,
# порожньо = немає. Виноски (*1…*6) переносимо текстом, бо без них можна
# продати пульт без адаптера.
# --------------------------------------------------------------------------
FUNCS_PAGE = 33
FUNCS_X_NAME = (90.0, 270.0)      # назва функції
FUNCS_X_GROUP = (30.0, 90.0)      # назва групи функцій (вертикально, по кілька слів)
FUNCS_Y_FROM, FUNCS_Y_TO = 130.0, 770.0
FUNCS_COL_TOL = 6.0


class Problem(Exception):
    pass


def parse_footnotes(words):
    """*N → текст виноски (нижній колонтитул сторінки 33)."""
    notes, cur = {}, None
    # Номер сторінки стоїть у тому ж нижньому полі — без цього він приклеюється
    # в кінець останньої виноски («…керування.. 33.»).
    foot = [w for w in words if w.y0 >= FUNCS_Y_TO
            and not (w.x0 > 520.0 and re.fullmatch(r'\d{1,3}', w.text))]
    for r in G.group_rows(foot, tol=3.0):
        buf = []
        for w in r:
            m = re.fullmatch(r'\*(\d)', w.text)
            if m:
                if cur and buf:
                    notes[cur] = ' '.join(buf).strip()
                cur, buf = m.group(1), []
            elif cur:
                buf.append(w.text)
        if cur and buf:
            notes[cur] = (notes.get(cur, '') + ' ' + ' '.join(buf)).strip()
            buf = []
    return {k: re.sub(r'\.+$', '', v).strip() + '.' for k, v in notes.items()}


def parse_functions(col_x, report):
    """Функції своєї серії зі стор. 33."""
    words = G.page_words(PDF, FUNCS_PAGE)
    notes = parse_footnotes(words)
    body = [w for w in words if FUNCS_Y_FROM <= w.y0 < FUNCS_Y_TO]

    out = []
    for r in G.group_rows(body, tol=6.0):
        name = ' '.join(w.text for w in r
                        if FUNCS_X_NAME[0] <= w.x0 < FUNCS_X_NAME[1]
                        and not re.fullmatch(r'\*\d', w.text)).strip()
        if not name:
            continue
        # Рядок без жодної позначки в УСІХ колонках — це продовження назви
        # попередньої функції («…ПОВІТРЯНИМ / ПОТОКОМ»), а не окрема функція.
        if not any(w.text in ('●', 'опція') for w in r if w.x0 >= FUNCS_X_NAME[1]):
            if out:
                out[-1]['name'] += ' ' + name
            continue
        mine = [w for w in r if abs(w.cx - col_x) <= FUNCS_COL_TOL]
        has_dot = any(w.text == '●' for w in mine)
        has_opt = any(w.text == 'опція' for w in mine)
        # Виноски беремо і біля позначки своєї колонки, і біля самої назви:
        # «*1 У разі використання з мульти спліт-системи функція недоступна»
        # стоїть саме при назві й стосується всіх серій.
        refs = []
        for w in r:
            m = re.fullmatch(r'\*(\d)', w.text)
            if not m:
                continue
            if w.x0 < FUNCS_X_NAME[1] or abs(w.x0 - col_x) <= 10.0:
                if m.group(1) not in refs:
                    refs.append(m.group(1))
        if not has_dot and not has_opt:
            state = 'no'
        elif has_opt:
            state = 'option'
        else:
            state = 'yes'
        out.append({
            'name': name,
            'state': state,
            'note': ' '.join(notes.get(n, '') for n in refs).strip() or None,
            'page': FUNCS_PAGE,
        })

    if not any(f['state'] != 'no' for f in out):
        report.append('ПЕРЕВІРКА  стор. 33: у колонці x=%.0f не знайдено жодної '
                      'позначки — схоже, колонка серії вказана неправильно' % col_x)
    return out


def zone(words, lo, hi):
    return [w for w in words if lo <= w.x0 < hi]


def text_of(words):
    return ' '.join(w.text for w in words).strip()


def parse_table(words, cfg):
    """Рядки таблиці: власний підпис (як прочитано), одиниця, значення по колонках."""
    body = [w for w in words if w.y0 > cfg['table_below']]
    rows = G.group_rows(body)

    # Колонки — з рядка маркувань зовнішніх блоків: кожне маркування окреме слово,
    # і воно відцентроване над своєю колонкою.
    want = [G.norm_model(m) for m in cfg['outdoor']]
    centers = None
    for r in rows:
        got = [w for w in r if G.norm_model(w.text) in want]
        if len(got) == len(want):
            centers = [w.cx for w in sorted(got, key=lambda w: w.x0)]
            break
    if centers is None:
        raise Problem('Не знайдено рядок маркувань зовнішніх блоків %s на стор. %d'
                      % (cfg['outdoor'], cfg['page']))
    bounds = [(centers[i] + centers[i + 1]) / 2.0 for i in range(len(centers) - 1)]

    out = []
    for r in rows:
        vals_z = [w for w in r if w.x0 >= X_VALUES]
        if not vals_z:
            continue                                   # рядок без значень — лише шматок підпису
        # Рядки-шапки з маркуваннями (внутрішні блоки йдуть двома рядками, з
        # кольоровими суфіксами через кому) значеннями не є.
        if any(re.match(r'^(SRK|SRC|SCM|FD)\d', w.text, re.I) for w in vals_z):
            continue

        # Комірки: спершу дрібним кроком, потім склеюємо сусідні, між якими немає
        # межі колонки. Інакше «38 / 31 / 24 / 19» п'яти моделей зливається в одну.
        small = G.group_cells(vals_z, gap=8.0)
        cells = [small[0]]
        for c in small[1:]:
            gap_lo, gap_hi = cells[-1][-1].x1, c[0].x0
            if any(gap_lo <= b <= gap_hi for b in bounds):
                cells.append(c)
            else:
                cells[-1] = cells[-1] + c

        spans = G.assign_spans(cells, centers)
        row = {
            'y': r[0].y0,
            'label_main': text_of(zone(r, 0, X_LABEL_MAIN)),
            'label_sub': text_of(zone(r, X_LABEL_MAIN, X_LABEL_SUB)),
            'label_sub2': text_of(zone(r, X_LABEL_SUB, X_UNIT)),
            'unit': re.sub(r'\s+', '', text_of(zone(r, X_UNIT, X_VALUES))),
            'cells': [G.cell_text(c) for c in cells],
            'spans': spans,
        }
        out.append(row)
    return out, centers


def rows_to_values(row, cfg):
    """Значення по колонках з урахуванням об'єднаних комірок."""
    ncol = len(cfg['outdoor'])
    if row['spans'] is None:
        return None
    vals, i = [], 0
    for text, span in zip(row['cells'], row['spans']):
        vals.extend([text] * span)
        i += span
    return vals if len(vals) == ncol else None


def parse_accessories(cfg, page_words_, report):
    page_text = ' '.join(w.text for w in page_words_)
    out = []
    for a in cfg['accessories']:
        if a['verify'] not in page_text:
            raise Problem('Стор. %d: не знайдено «%s» — сторінку серії перемалювали, '
                          'аксесуар «%s» треба звірити заново'
                          % (cfg['page'], a['verify'], a['name']))
        out.append({'kind': a['kind'], 'name': a['name'], 'state': a['state'],
                    'note': a['note'], 'page': cfg['page']})
    return out


def build_series(cfg, report):
    words = G.page_words(PDF, cfg['page'])
    rows, centers = parse_table(words, cfg)

    if len(rows) != len(cfg['rows']):
        raise Problem(
            'Стор. %d: у таблиці %d рядків зі значеннями, а в конфігу %d.\n'
            'Прочитані підписи:\n  %s'
            % (cfg['page'], len(rows), len(cfg['rows']),
               '\n  '.join('%2d  %-38s | %s' % (i, r['label_main'] + ' ' + r['label_sub'] +
                                                ' ' + r['label_sub2'], ' | '.join(r['cells']))
                           for i, r in enumerate(rows))))

    specs = []
    for r, row_cfg in zip(rows, cfg['rows']):
        name, match = row_cfg[0], row_cfg[1]
        unit_cfg = row_cfg[2] if len(row_cfg) > 2 else None
        own = ' '.join([r['label_main'], r['label_sub'], r['label_sub2']])
        if not re.search(match, own, re.I):
            raise Problem('Стор. %d, y=%.1f: очікували «%s» (шукали /%s/), '
                          'а в підписі рядка «%s». Конфіг розійшовся з PDF.'
                          % (cfg['page'], r['y'], name, match, own.strip()))
        vals = rows_to_values(r, cfg)
        if vals is None:
            report.append('СУМНІВНО  стор. %d, «%s»: не вдалось розкласти %d комірок '
                          'по %d колонках — %s'
                          % (cfg['page'], name, len(r['cells']), len(cfg['outdoor']),
                             ' | '.join(r['cells'])))
            continue
        values = {}
        for col, v in enumerate(vals):
            for model in cfg['models'][col]:
                values[model] = v
        unit = unit_cfg if unit_cfg is not None else (r['unit'] or None)
        specs.append({'name': name, 'unit': unit or None,
                      'page': cfg['page'], 'values': values})

    # Індекс: нормалізоване маркування з прайсу → «серія|колонка». Колонка потрібна,
    # бо значення в specs лежать під канонічним маркуванням колонки.
    index = {}
    for group in cfg['models']:
        for model in group:
            index[G.norm_model(model)] = cfg['key'] + '|' + model
    for col, model in enumerate(cfg['outdoor']):
        index.setdefault(G.norm_model(model), cfg['key'] + '|' + cfg['models'][col][0])
    return {
        'page': cfg['page'],
        'title': cfg['title'],
        'group': cfg['group'],
        'outdoor': cfg['outdoor'],
        'wifi_builtin': cfg.get('wifi_builtin'),
        'columns': [g[0] for g in cfg['models']],
        'specs': specs,
        'functions': parse_functions(cfg['funcs_col_x'], report),
        'accessories': parse_accessories(cfg, words, report),
    }, index


def check(series, report):
    """Автоперевірки «чи не з'їхала колонка» (вимога власника: мовчки не виправляти)."""
    def num(s):
        m = re.match(r'^-?\d+(?:[.,]\d+)?', (s or '').strip())
        return float(m.group(0).replace(',', '.')) if m else None

    by_name = {s['name']: s for s in series['specs']}
    cols = series['columns']

    cool, heat = by_name.get('Холодопродуктивність (Min~Max)'), by_name.get('Теплопродуктивність (Min~Max)')
    power = by_name.get('Споживана потужність, охолодження / обігрів')
    if cool and power:
        for m in cols:
            c, p = num(cool['values'].get(m)), num(power['values'].get(m))
            if c and p and p >= c:
                report.append('ПЕРЕВІРКА  %s: споживана потужність %s ≥ холодопродуктивності %s'
                              % (m, p, c))
    if cool and heat:
        for m in cols:
            c, h = num(cool['values'].get(m)), num(heat['values'].get(m))
            if c and h and not (0.5 <= c / h <= 1.6):
                report.append('ПЕРЕВІРКА  %s: холодо/тепло = %.2f — підозріле співвідношення' % (m, c / h))
    seer = by_name.get('SEER / SCOP')
    if seer:
        for m in cols:
            v = seer['values'].get(m) or ''
            parts = [num(p) for p in v.split('/')]
            for p in parts:
                if p is not None and not (2.0 <= p <= 13.0):
                    report.append('ПЕРЕВІРКА  %s: SEER/SCOP «%s» поза розумними межами' % (m, v))
                    break
    for s in series['specs']:
        vals = [s['values'].get(m) for m in cols]
        if len(set(v for v in vals if v)) == 1 and len(cols) > 1 and s['name'] in (
                'Холодопродуктивність (Min~Max)', 'Теплопродуктивність (Min~Max)',
                'Споживана потужність, охолодження / обігрів'):
            report.append('ПЕРЕВІРКА  «%s»: усі моделі мають однакове значення «%s» — '
                          'схоже на з\'їхану комірку' % (s['name'], vals[0]))
        if not any(vals):
            report.append('ПЕРЕВІРКА  «%s»: порожньо в усіх колонках' % s['name'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', action='store_true', help='зберегти PNG сторінок для звірки очима')
    args = ap.parse_args()

    if not os.path.exists(PDF):
        raise SystemExit('Не знайдено каталог: ' + PDF)

    report, out_series, index = [], {}, {}
    for cfg in SERIES:
        s, idx = build_series(cfg, report)
        check(s, report)
        out_series[cfg['key']] = s
        index.update(idx)
        if args.render:
            os.makedirs(SHOTS, exist_ok=True)
            p = G.render_page(PDF, cfg['page'], os.path.join(SHOTS, 'p%d' % cfg['page']))
            print('PNG для звірки: ' + str(p))

    doc = {
        '_about': ('Технічні дані з каталогу MHI (catalog-mhi-rac-pac.pdf). Будує '
                   'claude/mhi-catalog/build_catalog.py по координатах слів. У кожного '
                   'значення є номер сторінки. Немає в каталозі — null, в інтерфейсі «—». '
                   'Руками не правити: наступна збірка перезапише.'),
        'source': 'catalog-mhi-rac-pac.pdf',
        'built': datetime.date.today().isoformat(),
        'series': out_series,
        'index': index,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')

    n = sum(len(s['specs']) for s in out_series.values())
    nf = sum(len(s['functions']) for s in out_series.values())
    na = sum(len(s['accessories']) for s in out_series.values())
    print('Записано %s: серій %d, рядків характеристик %d, функцій %d, аксесуарів %d, маркувань %d'
          % (os.path.relpath(OUT, ROOT), len(out_series), n, nf, na, len(index)))
    if report:
        print('\nРОЗБІЖНОСТІ Й СУМНІВНІ МІСЦЯ (%d) — дивиться людина:' % len(report))
        for line in report:
            print('  ' + line)
    else:
        print('Автоперевірки без зауважень.')


if __name__ == '__main__':
    main()
