# -*- coding: utf-8 -*-
"""Збирає data/mhi-catalog.json із PDF-каталогу MHI.

Запуск (з кореня репозиторію):
    python claude/mhi-catalog/build_catalog.py
    python claude/mhi-catalog/build_catalog.py --render   # + PNG сторінок для звірки

ЩО РОБИТЬ МАШИНА, А ЩО ЛЮДИНА
------------------------------
Машина читає таблицю по координатах слів: значення, об'єднані комірки, назви рядків,
одиниці, маркування по колонках (`tables.py`). Плоский `pdftotext -layout` для цього
каталогу непридатний — він зсуває значення на рядок.

Людина задає лише те, чого на сторінці немає: який це розділ застосунку, як серія
зветься в каталозі (шестикутник на стор. 6) і її маркування. І один раз звіряє
сторінку очима.

ДОВЕДЕННЯ ПРАВИЛЬНОСТІ: сторінка 34 звірена очима рядок за рядком, її очікуваний
результат зашитий у `tests/test_tables.py`. Будь-яка правка розбору, що зіпсує цю
сторінку, завалить тест.

ПРАВИЛО ПРО ЦИФРИ: немає значення в каталозі → `null`. Не інтерполювати, не брати
«у сусіда так само», не рахувати за формулою, не брати з інтернету.
"""

import os
import re
import sys
import json
import argparse
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdfgrid as G                                            # noqa: E402
import tables as T                                             # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.path.join(os.path.dirname(ROOT), 'Sun-ice — довідники', 'catalog-mhi-rac-pac.pdf')
OUT = os.path.join(ROOT, 'data', 'mhi-catalog.json')
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')

FUNCS_PAGE = 33
FUNCS_X_NAME = (90.0, 270.0)
FUNCS_Y_FROM, FUNCS_Y_TO = 130.0, 770.0
FUNCS_COL_TOL = 6.0

# --------------------------------------------------------------------------
# СЕРІЇ. `series`/`marking`/`block` — з таблиці «МОДЕЛЬНИЙ РЯД» на стор. 6–7
# (шестикутник із назвою серії + маркування + тип блока ліворуч). Саме ці три
# речі показує шапка групи в прайсі, тому вони тут, а не в коді застосунку.
# `funcs_col` — номер колонки серії в матриці функцій на стор. 33 (0 — перша).
# --------------------------------------------------------------------------
SERIES = [
    {'page': 34, 'key': 'SRK-ZSX-W', 'series': 'Diamond Series', 'marking': 'SRK-ZSX-W, -WF',
     'block': 'Настінний', 'funcs_col': 0, 'wifi_builtin': 'ZSXWF'},
    {'page': 36, 'key': 'SRK-ZR-W', 'series': 'Diamond Series', 'marking': 'SRK-ZR-W, -WF',
     'block': 'Настінний', 'funcs_col': 3, 'wifi_builtin': 'ZRWF'},
    {'page': 38, 'key': 'SRK-ZT-WF', 'series': 'Premium Series', 'marking': 'SRK-ZT-WF',
     'block': 'Настінний', 'funcs_col': 1},
    {'page': 40, 'key': 'SRK-ZS-W', 'series': 'Premium Series', 'marking': 'SRK-ZS-W, -WF',
     'block': 'Настінний', 'funcs_col': 2, 'wifi_builtin': 'ZSWF'},
    {'page': 42, 'key': 'SRK-ZTL-W', 'series': 'Standard Plus Series', 'marking': 'SRK-ZTL-W',
     'block': 'Настінний', 'funcs_col': 4},
    {'page': 44, 'key': 'SRK-ZSP-W1', 'series': 'Standard Series', 'marking': 'SRK-ZSP-W1',
     'block': 'Настінний', 'funcs_col': 5},
    {'page': 46, 'key': 'SRK-ZSPR-S', 'series': 'Standard Series', 'marking': 'SRK-ZSPR-S',
     'block': 'Настінний', 'funcs_col': 6},
    {'page': 48, 'key': 'SRK-ZSPR-S-63', 'series': 'Standard Series', 'marking': 'SRK-ZSPR-S (63–80)',
     'block': 'Настінний', 'funcs_col': 7},
    {'page': 50, 'key': 'SRF-ZS-ZSX', 'series': 'Підлогові', 'marking': 'SRF-ZS / ZSX',
     'block': 'Підлоговий', 'funcs_col': 8},
    {'page': 51, 'key': 'SRR-ZS', 'series': 'Канальні низького тиску', 'marking': 'SRR-ZS',
     'block': 'Канальний', 'funcs_col': 9},
    {'page': 52, 'key': 'FDTC-VH', 'series': '4-поточні касетні компактні', 'marking': 'FDTC-VH',
     'block': 'Касетний', 'funcs_col': 10},
]


# --------------------------------------------------------------------------
# КАРТКИ СЕРІЙ для шапок груп у прайсі. Виписані з таблиці «МОДЕЛЬНИЙ РЯД»
# (стор. 6 — спліт-системи, стор. 7 — мульти): назва серії з шестикутника,
# маркування та тип блока з лівої колонки.
#
# Навіщо окремо від `SERIES`: у мульти спліт-системі внутрішні блоки мають ТІ
# САМІ маркування, що й у спліті (SRK20ZSX-W), але характеристики інші — там
# інший зовнішній блок. Тому таблиці мульти ще не розібрані, а шапка групи
# показати серію вже може: назва й тип блока від пари не залежать.
# --------------------------------------------------------------------------
CARDS = [
    (r'^SRK\d+ZSX', 'Diamond Series', 'SRK-ZSX-WF, -W', 'Настінний'),
    (r'^SRK\d+ZR', 'Diamond Series', 'SRK-ZR-WF, -W', 'Настінний'),
    (r'^SRK\d+ZT-', 'Premium Series', 'SRK-ZT-WF', 'Настінний'),
    (r'^SRK\d+ZTL', 'Standard Plus Series', 'SRK-ZTL-W', 'Настінний'),
    (r'^SRK\d+ZS-', 'Premium Series', 'SRK-ZS-WF, -W', 'Настінний'),
    (r'^SRK\d+ZSPR', 'Standard Series', 'SRK-ZSPR-S', 'Настінний'),
    (r'^SRK\d+ZSP', 'Standard Series', 'SRK-ZSP-W1', 'Настінний'),
    (r'^SKM\d+ZSP', 'Standard Series', 'SKM-ZSP-W', 'Настінний'),
    (r'^SRF\d+ZS', 'Підлогові', 'SRF-ZS / ZSX', 'Підлоговий'),
    (r'^SRR\d+ZS', 'Канальні низького тиску', 'SRR-ZS', 'Канальний'),
    (r'^FDTC', '4-поточні касетні компактні 600×600', 'FDTC-VH', 'Касетний'),
    (r'^FDUM', 'Канальні середнього тиску', 'FDUM-VH', 'Канальний'),
    (r'^FDE', 'Стельові', 'FDE-VH', 'Стельовий'),
    (r'^SCM\d+ZS', 'Мульти, зовнішній блок R32', 'SCM-ZS-W', 'Зовнішній'),
    (r'^SCM\d+ZM', 'Мульти, зовнішній блок R410A', 'SCM-ZM-S', 'Зовнішній'),
]


class Problem(Exception):
    pass


# --------------------------------------------------------------------------
# Функції (матриця «ПЕРЕЛІК ФУНКЦІЙ», стор. 33)
# --------------------------------------------------------------------------
def parse_footnotes(words):
    notes, cur = {}, None
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
    return {k: re.sub(r'\.+$', '', v).strip() + '.' for k, v in notes.items()}


def funcs_columns(words):
    """Центри колонок матриці функцій — за рядком, де позначок найбільше."""
    best = []
    for r in G.group_rows([w for w in words if FUNCS_Y_FROM <= w.y0 < FUNCS_Y_TO], tol=3.0):
        dots = [w for w in r if w.text == '●']
        if len(dots) > len(best):
            best = dots
    return [w.cx for w in sorted(best, key=lambda w: w.x0)]


def parse_functions(cache, col_index, report, label):
    words = cache['words']
    notes = cache['notes']
    cols = cache['cols']
    if col_index is None or col_index >= len(cols):
        report.append('ПЕРЕВІРКА  %s: колонки %s немає в матриці функцій (усього %d)'
                      % (label, col_index, len(cols)))
        return []
    col_x = cols[col_index]

    out = []
    for r in G.group_rows([w for w in words if FUNCS_Y_FROM <= w.y0 < FUNCS_Y_TO], tol=6.0):
        name = ' '.join(w.text for w in r
                        if FUNCS_X_NAME[0] <= w.x0 < FUNCS_X_NAME[1]
                        and not re.fullmatch(r'\*\d', w.text)).strip()
        if not name:
            continue
        if not any(w.text in ('●', 'опція') for w in r if w.x0 >= FUNCS_X_NAME[1]):
            if out:
                out[-1]['name'] += ' ' + name        # продовження назви, не нова функція
            continue
        mine = [w for w in r if abs(w.cx - col_x) <= FUNCS_COL_TOL]
        refs = []
        for w in r:
            m = re.fullmatch(r'\*(\d)', w.text)
            if m and (w.x0 < FUNCS_X_NAME[1] or abs(w.x0 - col_x) <= 10.0):
                if m.group(1) not in refs:
                    refs.append(m.group(1))
        state = ('option' if any(w.text == 'опція' for w in mine)
                 else 'yes' if any(w.text == '●' for w in mine) else 'no')
        out.append({'name': name, 'state': state, 'page': FUNCS_PAGE,
                    'note': ' '.join(notes.get(n, '') for n in refs).strip() or None})

    if not any(f['state'] != 'no' for f in out):
        report.append('ПЕРЕВІРКА  %s: у колонці функцій №%d немає жодної позначки — '
                      'схоже, колонку вказано неправильно' % (label, col_index))
    return out


# --------------------------------------------------------------------------
# Аксесуари: підписи під малюнками на сторінці серії.
# Беремо лише те, що на сторінці НАПИСАНО словами; нічого не добудовуємо.
# --------------------------------------------------------------------------
REMOTE_RE = re.compile(r'^RC[H]?-[A-Z0-9()]+$')
ADAPTER_RE = re.compile(r'^SC-[A-Z0-9-]+E$')


def parse_accessories(words, page, filter_value, report, label):
    text = ' '.join(w.text for w in words)
    text = re.sub(r'\s+', ' ', text)
    out, seen = [], set()

    stars = [s.strip() for s in re.findall(r'\*\s*([^*]{10,200}?)(?=\s*\*|$)', text)]
    wired_note = next((s for s in stars if 'адаптер' in s.lower()), None)

    if 'Бездротовий' in text:
        out.append({'kind': 'remote', 'name': 'Бездротовий пульт ДК', 'state': 'yes',
                    'note': None, 'page': page})
    for w in words:
        t = w.text.strip().rstrip('.,')
        if REMOTE_RE.match(t) and t not in seen:
            seen.add(t)
            note = 'Дротовий пульт керування.'
            if wired_note:
                note += ' ' + wired_note.rstrip('.') + '.'
            out.append({'kind': 'remote', 'name': t, 'state': 'option', 'note': note, 'page': page})
        elif ADAPTER_RE.match(t) and t not in seen:
            seen.add(t)
            adp = next((s for s in stars if t in s), None)
            out.append({'kind': 'adapter', 'name': t, 'state': 'option',
                        'note': (adp.rstrip('.') + '.') if adp else 'Адаптер для дротового пульта.',
                        'page': page})

    wifi = re.search(r'(Моделі [^.]*Wi-Fi-модуль[^.]*\.(?:\s*Для моделей[^.]*\.)?)', text)
    if 'Wi-Fi' in text:
        out.append({'kind': 'wifi', 'name': 'Керування через Wi-Fi',
                    'state': 'depends' if wifi else ('yes' if 'Вбудований Wi-Fi' in text else 'option'),
                    'note': wifi.group(1).strip() if wifi else None, 'page': page})

    if filter_value:
        for part in re.split(r',', filter_value):
            part = part.strip()
            if not part:
                continue
            m = re.match(r'^(.*?)(\s*[xх]\s*\d+)$', part)
            out.append({'kind': 'filter', 'name': (m.group(1) if m else part).strip(),
                        'state': 'yes',
                        'note': ('У комплекті' + (m.group(2).strip() and ', ' + m.group(2).strip()) + '.')
                                if m else 'У комплекті.',
                        'page': page})
    if not out:
        report.append('ПЕРЕВІРКА  %s: на сторінці не знайшлось жодного аксесуара' % label)
    return out


# --------------------------------------------------------------------------
def build_series(cfg, funcs_cache, report):
    page, label = cfg['page'], cfg['key']
    words = G.page_words(PDF, page)
    rows, centers, header = T.read_table(words, page)
    if not rows:
        raise Problem('Стор. %d (%s): таблиці знайомого вигляду немає' % (page, label))

    indoor, outdoor = T.read_header(words, centers, min(w.y0 for w in header) - 20)
    if not any(indoor):
        raise Problem('Стор. %d (%s): не прочитались маркування внутрішніх блоків' % (page, label))

    ncol = len(centers)
    specs, filter_value = [], None
    for r in rows:
        vals = T.row_values(r, ncol)
        if vals is None:
            report.append('СУМНІВНО  стор. %d (%s), «%s»: %d комірок на %d колонок — %s'
                          % (page, label, r['name'], len(r['cells']), ncol, ' | '.join(r['cells'])))
            continue
        if r['name'].startswith('Повітряний фільтр'):
            filter_value = vals[0]
        # Значення — списком ПО КОЛОНКАХ, а не по кожному маркуванню: у серії до
        # шести кольорових виконань на колонку, і розкладка по маркуваннях роздувала
        # файл у п'ять разів (282 КБ проти 60 КБ). Колонку дає index.
        specs.append({'name': r['name'], 'unit': r['unit'], 'page': page, 'values': vals})

    series = {
        'page': page,
        'series': cfg['series'],
        'marking': cfg['marking'],
        'block': cfg['block'],
        'title': cfg['series'] + ' · ' + cfg['marking'],
        'columns': [(indoor[i] or outdoor[i] or [''])[0] for i in range(ncol)],
        'indoor': indoor,
        'outdoor': outdoor,
        'wifi_builtin': cfg.get('wifi_builtin'),
        'specs': specs,
        'functions': parse_functions(funcs_cache, cfg.get('funcs_col'), report, label),
        'accessories': parse_accessories(words, page, filter_value, report, label),
    }

    index = {}
    for col in range(ncol):
        for model in (indoor[col] or []) + (outdoor[col] or []):
            index.setdefault(G.norm_model(model), cfg['key'] + '|' + str(col))
    return series, index


def check(series, label, report):
    def num(s):
        m = re.match(r'^-?\d+(?:[.,]\d+)?', (s or '').strip())
        return float(m.group(0).replace(',', '.')) if m else None

    by = {}
    for s in series['specs']:
        by.setdefault(s['name'].split(' · ')[0], s)
    cols = series['columns']
    cool, heat, power = by.get('Холодопродуктивність (Min~Max)'), by.get('Теплопродуктивність (Min~Max)'), by.get('Споживана потужність')
    for m in cols:
        i = cols.index(m)
        c = num(cool['values'][i]) if cool else None
        h = num(heat['values'][i]) if heat else None
        p = num(power['values'][i]) if power else None
        if c and p and p >= c:
            report.append('ПЕРЕВІРКА  %s / %s: споживана %s ≥ холодопродуктивності %s' % (label, m, p, c))
        if c and h and not (0.5 <= c / h <= 1.6):
            report.append('ПЕРЕВІРКА  %s / %s: холодо/тепло = %.2f — підозріле співвідношення' % (label, m, c / h))
    seer = by.get('SEER / SCOP')
    if seer:
        for m in cols:
            for p in [num(x) for x in (seer['values'][cols.index(m)] or '').split('/')]:
                if p is not None and not (2.0 <= p <= 13.0):
                    report.append('ПЕРЕВІРКА  %s / %s: SEER/SCOP «%s» поза межами'
                                  % (label, m, seer['values'][cols.index(m)]))
                    break
    for s in series['specs']:
        if not any(s['values']):
            report.append('ПЕРЕВІРКА  %s: «%s» порожнє в усіх колонках' % (label, s['name']))
    if len(cols) > 1:
        for key in ('Холодопродуктивність (Min~Max)', 'Споживана потужність'):
            s = by.get(key)
            if s and len(set(s['values'])) == 1:
                report.append('ПЕРЕВІРКА  %s: «%s» однакове в усіх колонках — схоже на з\'їхану комірку'
                              % (label, key))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', action='store_true')
    ap.add_argument('--only', help='зібрати лише ці сторінки, через кому')
    args = ap.parse_args()
    if not os.path.exists(PDF):
        raise SystemExit('Не знайдено каталог: ' + PDF)

    only = set(int(x) for x in args.only.split(',')) if args.only else None
    fw = G.page_words(PDF, FUNCS_PAGE)
    funcs_cache = {'words': fw, 'notes': parse_footnotes(fw), 'cols': funcs_columns(fw)}

    report, out_series, index = [], {}, {}
    for cfg in SERIES:
        if only and cfg['page'] not in only:
            continue
        s, idx = build_series(cfg, funcs_cache, report)
        check(s, cfg['key'], report)
        out_series[cfg['key']] = s
        index.update(idx)
        if args.render:
            os.makedirs(SHOTS, exist_ok=True)
            G.render_page(PDF, cfg['page'], os.path.join(SHOTS, 'p%d' % cfg['page']))

    doc = {
        '_about': ('Технічні дані з каталогу MHI (catalog-mhi-rac-pac.pdf). Будує '
                   'claude/mhi-catalog/build_catalog.py по координатах слів. У кожного '
                   'значення є номер сторінки. Немає в каталозі — null, в інтерфейсі «—». '
                   'Руками не правити: наступна збірка перезапише.'),
        'source': 'catalog-mhi-rac-pac.pdf',
        'built': datetime.date.today().isoformat(),
        'series': out_series,
        'index': index,
        'cards': [{'re': r, 'series': se, 'marking': mk, 'block': bl} for r, se, mk, bl in CARDS],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print('Записано %s' % os.path.relpath(OUT, ROOT))
    for k, s in out_series.items():
        print('  %-14s стор.%3d  колонок %d  рядків %2d  функцій %2d  аксесуарів %2d'
              % (k, s['page'], len(s['columns']), len(s['specs']),
                 len(s['functions']), len(s['accessories'])))
    print('  Усього маркувань: %d' % len(index))
    if report:
        print('\nРОЗБІЖНОСТІ Й СУМНІВНІ МІСЦЯ (%d) — дивиться людина:' % len(report))
        for line in report:
            print('  ' + line)
    else:
        print('Автоперевірки без зауважень.')


if __name__ == '__main__':
    main()
