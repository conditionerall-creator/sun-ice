# -*- coding: utf-8 -*-
"""Збирає data/gal-catalog.json із PDF-каталогу Galactic (cat_Galactic.pdf).

Запуск (з кореня репозиторію):
    python claude/galactic-catalog/build_galactic.py

Форма даних — та сама, що в `data/mhi-catalog.json` (`series`, `index`, `functions`, `acc_sets`), щоб панель
товару працювала з обома каталогами одним кодом. Індекс роздільний по розділах застосунку:
 • split_gal      — ключ: маркування внутрішнього АБО зовнішнього блока (GKZ09SH-W, GCZ09SH-W);
 • multisplit_gal — ключ: маркування внутрішнього (GKM09M-W) або зовнішнього (GMZ2-14M-W) блока;
 • semi_gal       — ключ: ПАРА «внутрішній+зовнішній» (GBZ18MLQ-W+GCZ18MLNQ-W): один внутрішній блок стоїть
   у кількох комплектах з різними зовнішніми (GCZ36MLNQ-W — 1ф, GCZ36MLSQ-W — 3ф).

ПРАВИЛО ПРО ЦИФРИ: значення — як надруковано; немає — немає. Функції беремо ЛИШЕ з підписів значків і пунктів,
які на сторінках серій написані словами; нічого не вигадуємо.
"""

import argparse
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import galactic_catalog as GC                                  # noqa: E402
import pdfgrid as G                                            # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
PDF = os.path.join(os.path.dirname(ROOT), 'Sun-ice — довідники', 'cat_Galactic.pdf')
OUT = os.path.join(ROOT, 'data', 'gal-catalog.json')
CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'sunice-gal-svg')


class Problem(Exception):
    pass


def norm(s):
    return G.norm_model(s)


# --------------------------------------------------------------------------
# КОНФІГ СТОРІНОК. page — таблиця характеристик, install — «Дані для монтажу», feat — звідки взяти функції.
# Позначення «feat»: (сторінка, [рамки (x0, x1, y0, y1)]).
# --------------------------------------------------------------------------
SPLIT_FEAT = lambda p: (p, [(85, 255, 95, 480), (330, 600, 200, 480)])   # ліворуч — значки, праворуч — кнопки пульта
SPLIT = [
    dict(key='GAL-INFINI', page=11, install=12, series='Infini Inverter', marking='GKZ/GCZ SH-W', feat=SPLIT_FEAT(11)),
    dict(key='GAL-PROXIMA', page=13, install=14, series='Proxima Inverter', marking='GKZ/GCZ M-W', feat=SPLIT_FEAT(13)),
    dict(key='GAL-VEGA', page=15, install=16, series='Vega Inverter', marking='GKZ/GCZ A-W', feat=SPLIT_FEAT(15)),
]
SEMI_R = (345, 600, 200, 420)
SEMI = [
    dict(key='GAL-GDZ-R32', page=29, install=30, series='Explorer · канальні інверторні R32', marking='GDZ-MLQ-W',
         block='Канальний', feat=(29, [SEMI_R])),
    # Стор. 31 — набір «Q7»; у шапці таблиці три колонки (24, 48, 60) названі без «7», а в прайсі це GDZ24/48/60MLQ7-W
    # (рішення власника 2026-10-22: зіставити за позицією) — для них додається другий ключ з «7».
    dict(key='GAL-GDZ-R32-Q7', page=31, install=32, series='Explorer · канальні інверторні R32 (Q7)', marking='GDZ-MLQ7-W',
         block='Канальний', feat=(29, [SEMI_R]), q7_alias=True),
    dict(key='GAL-GBZ-R32', page=35, install=36, series='Касетні інверторні R32', marking='GBZ-MLQ-W',
         block='Касетний', feat=(35, [SEMI_R]), remotes=True),
    dict(key='GAL-GBZ-R32-Q7', page=37, install=38, series='Касетні інверторні R32 (Q7)', marking='GBZ-MLQ7-W',
         block='Касетний', feat=(37, [SEMI_R]), remotes=True),
    dict(key='GAL-GFZ-R32', page=39, install=40, series='Підлогово-стельові інверторні R32', marking='GFZ-MLQ-W',
         block='Підлогово-стельовий', feat=(39, [SEMI_R]), remotes=True),
    dict(key='GAL-GFZ-R32-Q7', page=41, install=42, series='Підлогово-стельові інверторні R32 (Q7)', marking='GFZ-MLQ7-W',
         block='Підлогово-стельовий', feat=(41, [SEMI_R]), remotes=True),
]
MULTI = [
    # Значки внутрішніх блоків стор. 17 — малюнки з окремими текстовими підписами лише в частини значків
    # («TURBO», «FOLLOW ME», «8 °C чергове опалення», «Опція»). Беремо ТІЛЬКИ те, що написано словами;
    # значки без підпису (дисплей, авто-режим тощо) не називаємо.
    dict(key='GAL-FS-INDOOR-M', page=17, table=0, series='Free Space · внутрішні блоки настінні M', marking='GKM-M-W / WR',
         block='Настінний', kind='indoor', feat=None, stop_after='Діаметр труб',
         manual=[('3 роки повної гарантії', 'yes', None), ('TURBO', 'yes', None),
                 ('Керування через Wi-Fi', 'option', 'Доступно для моделей GKM-M-WR. Для моделей GKM-M-W підключення Wi-Fi не передбачено.',
                  r'^GKM\d+MW$')]),   # not_for: для моделей без «R» пункту немає
    dict(key='GAL-FS-INDOOR-MG', page=17, table=1, series='Free Space · внутрішні блоки настінні MG', marking='GKZ-MG-WR',
         block='Настінний', kind='indoor', feat=None, stop_after='Діаметр труб',
         manual=[('3 роки повної гарантії', 'yes', None), ('TURBO', 'yes', None), ('Follow Me', 'yes', None),
                 ('Чергове опалення 8 °C', 'yes', None), ('Керування через Wi-Fi', 'option', None)]),
    dict(key='GAL-FS-OUTDOOR-M', page=18, table=0, series='Free Space · зовнішні блоки', marking='GMZ-M-W',
         block='Зовнішній', kind='outdoor', feat=(18, [(40, 400, 118, 232), (40, 400, 380, 425)])),
]


# --------------------------------------------------------------------------
# Таблиці
# --------------------------------------------------------------------------
def read_tables(page, report):
    words, segs = GC.page_data(PDF, page, CACHE)
    tops = GC.find_table_tops(words, segs)
    ys = sorted(set(round(s[3], 1) for s in segs if abs(s[1] - s[3]) <= 0.3 and s[2] - s[0] > 20))
    out = []
    for n, top in enumerate(tops):
        nxt = tops[n + 1] - 5 if n + 1 < len(tops) else 842
        bot = max([y for y in ys if top < y < nxt] or [top])
        try:
            out.append(GC.read_table(words, segs, top - 1, bot, page, report))
        except ValueError:
            out.append(None)
    return out


def col_is_models(c):
    return bool(re.match(r'^G[A-Z]{2,3}', c))


# --------------------------------------------------------------------------
# Функції: пункти списків на сторінці серії (значки зі підписами, кнопки пульта)
# --------------------------------------------------------------------------


def parse_feature_items(page, boxes, report):
    words, _ = GC.page_data(PDF, page, CACHE)
    items = []
    for (x0, x1, y0, y1) in boxes:
        ws = [w for w in words if x0 <= w.cx < x1 and y0 <= w.y0 < y1]
        rows = G.group_rows(ws, tol=3.0)
        cur = None
        for r in rows:
            text = ' '.join(w.text for w in r).strip()
            if not text:
                continue
            # Новий пункт — відступ більший за міжрядковий (≈9 пт) АБО рядок із великої літери (у переліках
            # з маркерами рядки стоять упритул, 11 пт, і за відступом пункти не розділити: стор. 18).
            if cur is None or r[0].y0 - cur['y'] > 14.5 or text[0].isupper():
                cur = {'text': text, 'y': r[0].y0}
                items.append(cur)
            else:
                cur['text'] += ' ' + text
                cur['y'] = r[0].y0
    out = []
    for it in items:
        t = re.sub(r'\s+', ' ', it['text']).strip()
        t = re.sub(r'(?<!\w)[АA]\s*(\++)', lambda m: 'A' + m.group(1), t)      # «А +++» → «A+++»
        state = 'yes'
        m = re.search(r'\((в комплекті|опція)\)', t, re.I)
        if m:
            state = 'yes' if m.group(1).lower().startswith('в') else 'option'
            t = re.sub(r'\s*\((в комплекті|опція)\)', '', t, flags=re.I).strip()
        if t == 'роки гарантії':          # цифра «3» стоїть у самому значку
            t = '3 роки гарантії'
        if t and t not in [o['name'] for o in out]:
            out.append({'name': t[0].upper() + t[1:], 'state': state, 'page': page, 'note': None})
    if not out:
        report.append('ПЕРЕВІРКА  стор. %d: на сторінці не знайшлось жодної функції' % page)
    return out


# --------------------------------------------------------------------------
# Дані для монтажу (стор. 12, 14, 16, 30…): беремо лише те, що надійно читається
# --------------------------------------------------------------------------
INSTALL_KEYS = [
    (r'Міжлапна відстань A', 'Міжлапна відстань A', 'мм'),
    (r'Міжлапна відстань B', 'Міжлапна відстань B', 'мм'),
    (r'Мінімальна довжина магістралі', 'Мінімальна довжина магістралі', 'м'),
    (r'Маслоз.ємні петлі', 'Маслозйомні петлі: внутрішній вище/нижче', 'м'),
    (r'Автоматичний вимикач', 'Автоматичний вимикач', None),
]


def read_install(page, columns, report):
    if page is None:
        return []
    words, segs = GC.page_data(PDF, page, CACHE)
    tops = GC.find_table_tops(words, segs)
    ys = sorted(set(round(s[3], 1) for s in segs if abs(s[1] - s[3]) <= 0.3 and s[2] - s[0] > 20))
    found = {}
    for n, top in enumerate(tops):
        nxt = tops[n + 1] - 5 if n + 1 < len(tops) else 842
        bot = max([y for y in ys if top < y < nxt] or [top])
        try:
            t = GC.read_table(words, segs, top - 1, bot, page, [], min_bands=3)
        except ValueError:
            continue
        # колонки install-таблиці мають збігатися з колонками таблиці характеристик
        base = [norm(c.split()[0]) for c in t['columns']]
        for r in t['rows']:
            if all(v is None for v in r['values']):
                continue
            if len(r['values']) != len(columns):
                continue          # таблиця електрики на сторінках напівпрому групує колонки інакше — такі рядки не беремо
            for pat, name, unit in INSTALL_KEYS:
                if re.search(pat, r['name']) and name not in found:
                    found[name] = {'name': name, 'unit': unit or r['unit'], 'page': page,
                                   'values': r['values'], 'cols': base}
    return list(found.values())


# --------------------------------------------------------------------------
# Збірка серій
# --------------------------------------------------------------------------
def split_models(col):
    """«GKZ/GCZ 09SH-W», «GKZ/GCZ 07 A-W» → (внутрішній, зовнішній)."""
    m = re.match(r'^(G[A-Z]{2})/(G[A-Z]{2})\s*(\d+)\s*([A-Z0-9\-]+)$', col.strip())
    if not m:
        raise Problem('Не розібрано підпис колонки сплітa: ' + col)
    return m.group(1) + m.group(3) + m.group(4), m.group(2) + m.group(3) + m.group(4)


def build(report):
    series, index, functions, acc_sets = {}, {'split_gal': {}, 'multisplit_gal': {}, 'semi_gal': {}}, {}, []

    def reg_acc(lst):
        if lst not in acc_sets:
            acc_sets.append(lst)
        return acc_sets.index(lst)

    def add_index(sec, key, ref, src):
        d = index[sec]
        if key in d and d[key] != ref:
            # Одна й та сама пара надрукована в каталозі двічі (сторінки «звичайних» і «Q7»-версій) з трохи
            # різними цифрами. Лишаємо ПЕРШУ (стор. з меншим номером) і прямо повідомляємо — вибір за власником.
            report.append('УВАГА  пара %s є в каталозі двічі: %s і %s (цифри трохи різні) — взято перше' % (key, d[key], ref))
            return
        d[key] = ref

    def finish(cfg, t, section, indoor, outdoor, extra_specs, funcs, page_feat):
        specs = [{'name': r['name'], 'unit': r['unit'], 'page': cfg['page'], 'values': r['values']} for r in t['rows']]
        specs += extra_specs
        s = {
            'page': cfg['page'], 'series': cfg['series'], 'marking': cfg['marking'],
            'block': cfg.get('block', 'Настінний'),
            'title': cfg['series'] + ' · ' + cfg['marking'],
            'columns': t['columns'], 'indoor': indoor, 'outdoor': outdoor,
            'specs': specs, 'funcs_col': cfg['key'] if funcs else None, 'accessories': [],
            'acc_idx': None,
        }
        series[cfg['key']] = s
        if funcs:
            functions[cfg['key']] = funcs
        return s

    def wifi_acc(funcs, page):
        out = []
        for f in funcs:
            if 'wi-fi' in f['name'].lower():
                a = {'kind': 'wifi', 'name': 'Керування через Wi-Fi', 'state': f['state'], 'note': f.get('note'), 'page': page}
                if f.get('not_for'):
                    a['not_for'] = f['not_for']
                out.append(a)
        return out

    # ---------------- СПЛІТ ----------------
    for cfg in SPLIT:
        t = read_tables(cfg['page'], report)[0]
        if t is None:
            raise Problem('Стор. %d: таблицю не розібрано' % cfg['page'])
        indoor, outdoor = [], []
        for c in t['columns']:
            i, o = split_models(c)
            indoor.append([i])
            outdoor.append([o])
        extra = []
        for e in read_install(cfg['install'], t['columns'], report):
            extra.append({'name': e['name'], 'unit': e['unit'], 'page': e['page'], 'values': e['values']})
        funcs = parse_feature_items(cfg['feat'][0], cfg['feat'][1], report)
        s = finish(cfg, t, 'split_gal', indoor, outdoor, extra, funcs, cfg['feat'][0])
        accs = wifi_acc(funcs, cfg['feat'][0])
        s['acc_idx'] = [reg_acc(accs)] * len(t['columns'])
        for col, (i, o) in enumerate(zip(indoor, outdoor)):
            add_index('split_gal', norm(i[0]), cfg['key'] + '|' + str(col), cfg['key'])
            add_index('split_gal', norm(o[0]), cfg['key'] + '|' + str(col), cfg['key'])

    # ---------------- НАПІВПРОМ ----------------
    for cfg in SEMI:
        t = read_tables(cfg['page'], report)
        t = next((x for x in t if x and len(x['header']) >= 2), None)
        if t is None:
            raise Problem('Стор. %d: таблицю напівпрому не розібрано' % cfg['page'])
        indoor = [[c] for c in t['header'][0]]
        outdoor = [[c] for c in t['header'][1]]
        columns = ['%s / %s' % (a[0], b[0]) for a, b in zip(indoor, outdoor)]
        t['columns'] = columns
        extra = [{'name': e['name'], 'unit': e['unit'], 'page': e['page'], 'values': e['values']}
                 for e in read_install(cfg['install'], columns, report)]
        funcs = parse_feature_items(cfg['feat'][0], cfg['feat'][1], report)
        s = finish(cfg, t, 'semi_gal', indoor, outdoor, extra, funcs, cfg['feat'][0])
        accs = wifi_acc(funcs, cfg['feat'][0])
        if cfg.get('remotes'):
            # Стор. 35–41: під малюнками двох пультів надруковано «В комплекті» (ручний пульт) і «Опція»
            # (дротовий пульт керування, настінна панель). Моделей пультів у каталозі немає — тільки підписи.
            accs = [{'kind': 'remote', 'name': 'Бездротовий пульт ДК', 'state': 'yes', 'note': None, 'page': cfg['page']},
                    {'kind': 'remote', 'name': 'Дротовий пульт керування', 'state': 'option', 'note': None, 'page': cfg['page']}] + accs
        s['acc_idx'] = [reg_acc(accs)] * len(columns)
        for col, (i, o) in enumerate(zip(indoor, outdoor)):
            add_index('semi_gal', norm(i[0]) + '+' + norm(o[0]), cfg['key'] + '|' + str(col), cfg['key'])
            if cfg.get('q7_alias') and 'Q7' not in i[0]:
                add_index('semi_gal', norm(i[0].replace('MLQ-W', 'MLQ7-W')) + '+' + norm(o[0]), cfg['key'] + '|' + str(col), cfg['key'] + ' (Q7)')

    # ---------------- МУЛЬТИ ----------------
    for cfg in MULTI:
        tables = read_tables(cfg['page'], report)
        t = tables[cfg['table']]
        if t is None:
            raise Problem('Стор. %d: таблицю мульти не розібрано' % cfg['page'])
        if cfg.get('stop_after'):
            # Під таблицею характеристик на стор. 17 ідуть таблиці «Комбінації внутрішніх блоків» — вони в ту ж сітку
            # не входять, але лінії продовжуються; обрізаємо після останнього рядка характеристик.
            cut = next((i for i, r in enumerate(t['rows']) if r['name'].startswith(cfg['stop_after'])), None)
            if cut is not None:
                t['rows'] = t['rows'][:cut + 1]
        indoor, outdoor = [], []
        for c in t['columns']:
            models = c.split()
            if cfg['kind'] == 'indoor':
                indoor.append(models)
                outdoor.append([])
            else:
                indoor.append([])
                outdoor.append(models)
        if cfg.get('manual'):
            funcs = []
            for tup in cfg['manual']:
                f_ = {'name': tup[0], 'state': tup[1], 'page': cfg['page'], 'note': tup[2]}
                if len(tup) > 3:
                    f_['not_for'] = tup[3]      # регулярний вираз за нормалізованим маркуванням (без дефісів)
                funcs.append(f_)
        else:
            funcs = parse_feature_items(cfg['feat'][0], cfg['feat'][1], report) if cfg.get('feat') else []
        s = finish(cfg, t, 'multisplit_gal', indoor, outdoor, [], funcs, cfg['page'])
        s['acc_idx'] = [reg_acc(wifi_acc(funcs, cfg['page']))] * len(t['columns'])
        for col, models in enumerate(indoor if cfg['kind'] == 'indoor' else outdoor):
            for m in models:
                add_index('multisplit_gal', norm(m), cfg['key'] + '|' + str(col), cfg['key'])

    return series, index, functions, acc_sets


def main():
    ap = argparse.ArgumentParser()
    args = ap.parse_args()
    if not os.path.exists(PDF):
        raise SystemExit('Не знайдено каталог: ' + PDF)
    report = []
    series, index, functions, acc_sets = build(report)
    doc = {
        '_about': ('Технічні дані з каталогу Galactic (cat_Galactic.pdf). Будує claude/galactic-catalog/build_galactic.py '
                   'по лініях таблиць. У кожного значення є номер сторінки. Руками не правити: наступна збірка перезапише.'),
        'source': 'cat_Galactic.pdf',
        'built': datetime.date.today().isoformat(),
        'series': series,
        'functions': functions,
        'acc_sets': acc_sets,
        'index': index,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print('Записано %s' % os.path.relpath(OUT, ROOT))
    for k, s in series.items():
        print('  %-18s стор.%3d  колонок %2d  рядків %2d  функцій %2d' % (k, s['page'], len(s['columns']), len(s['specs']),
                                                                     len(functions.get(k, []))))
    for sec, d in index.items():
        print('  Ключів у розділі %s: %d' % (sec, len(d)))
    if report:
        print('\nРОЗБІЖНОСТІ Й СУМНІВНІ МІСЦЯ (%d):' % len(report))
        for line in report:
            print('  ' + line)
    else:
        print('Автоперевірки без зауважень.')


if __name__ == '__main__':
    main()
