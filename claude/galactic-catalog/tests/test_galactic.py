# -*- coding: utf-8 -*-
"""Еталон розбору каталогу Galactic. Запуск:  python claude/galactic-catalog/tests/test_galactic.py

Стор. 11, 15, 29 і 35 звірено з надрукованим каталогом ОЧИМА (2026-10-22). Усе, що зашито нижче, — як надруковано.
Тест упав — зламався розбір (або замінили PDF), а не еталон.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA = os.path.join(ROOT, 'data', 'gal-catalog.json')
sys.path.insert(0, os.path.join(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'mhi-catalog'))
import pdfgrid as G                                            # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def row(s, start):
    return next(r for r in s['specs'] if r['name'].startswith(start))


def main():
    d = json.load(open(DATA, encoding='utf-8'))
    S = d['series']
    check(len(S) == 12, 'серій має бути 12, а є %d' % len(S))

    # --- стор. 11, Infini: 4 колонки, WS = срібляста смуга, ті самі цифри ---------------------------
    s = S['GAL-INFINI']
    check(s['columns'] == ['GKZ/GCZ 09SH-W', 'GKZ/GCZ 09SH-WS', 'GKZ/GCZ 12SH-W', 'GKZ/GCZ 12SH-WS'], 'Infini: колонки')
    check(row(s, 'Холодопродуктивність')['values'] == ['2,64 (0,82-3,66)', '2,64 (0,82-3,66)', '3,51 (0,88-4,75)', '3,51 (0,88-4,75)'], 'Infini: холод')
    check(row(s, 'SEER')['values'] == ['4,57', '4,57', '4,00', '4,00'], 'Infini: SEER')
    check(row(s, 'Діапазон робочих температур · тепло')['values'][0] == 'від -25 до +24 °С', 'Infini: діапазон тепло (під-підпис «тепло» — частина назви)')
    check(row(s, 'Діаметр труб')['unit'] == 'мм (дюйм)', 'Infini: одиниця труб')
    check(row(s, 'Міжлапна відстань A')['values'] == ['452'] * 4 and row(s, 'Міжлапна відстань B')['values'] == ['270'] * 4,
          'Infini: міжлапна відстань зі стор. 12')
    names = [f['name'] for f in d['functions']['GAL-INFINI']]
    check('Клас енергоефективності A+++' in names and 'Режим 3D AUTO-Air' in names and len(names) == 21, 'Infini: функції %s' % names)
    check(next(f for f in d['functions']['GAL-INFINI'] if 'Wi-Fi' in f['name'])['state'] == 'yes', 'Infini: Wi-Fi в комплекті')
    check(next(f for f in d['functions']['GAL-VEGA'] if 'Wi-Fi' in f['name'])['state'] == 'option', 'Vega: Wi-Fi опція')
    check('Функція Anti-F' in [f['name'] for f in d['functions']['GAL-VEGA']], 'Vega: підпис «Anti-F» як надруковано')

    # --- стор. 15, Vega: пробіл у «07 A-W» ----------------------------------------------------------
    s = S['GAL-VEGA']
    check(s['indoor'][0] == ['GKZ07A-W'] and s['outdoor'][0] == ['GCZ07A-W'], 'Vega: пара першої колонки')
    check(row(s, 'Холодопродуктивність')['values'][0] == '2,60 (0,6-3,1)', 'Vega: холод')

    # --- стор. 29 і 35: напівпром, два рядки заголовка (внутр. і зовн.) ---------------------------------
    s = S['GAL-GDZ-R32']
    check(s['columns'][3] == 'GDZ36MLQ-W / GCZ36MLSQ-W', 'GDZ: четверта колонка — 36 із SQ (3ф)')
    check(row(s, 'Електроживлення')['values'][2].startswith('1 фаза') and row(s, 'Електроживлення')['values'][3].startswith('3 фази'),
          'GDZ: фазність 36 NQ — 1ф, 36 SQ — 3ф')
    check(row(s, 'Потужність охолодження')['values'][2] == '10,55 (2,75~11,14)', 'GDZ: холод 36')
    s = S['GAL-GBZ-R32']
    check(row(s, 'Потужність охолодження')['values'] == ['5,27 (2,90~5,59)', '7,04 (3,30~7,92)', '10,56 (2,70~11,44)', '10,56 (2,70~11,44)',
                                                       '14,08 (3,52~15,84)', '16,13 (4,11~16,7)'], 'GBZ: холод')
    check(row(s, 'Нетто маса · Зовнішній')['values'] == ['32,5', '43,9', '66,9', '75,5', '103,7', '107'], 'GBZ: вага зовнішнього')
    check(row(s, 'Рівень шуму внутрішнього')['values'][0] == '45,4/44/39', 'GBZ: шум')
    accs = d['acc_sets'][s['acc_idx'][0]]
    check([a['name'] for a in accs][:2] == ['Бездротовий пульт ДК', 'Дротовий пульт керування'] and accs[0]['state'] == 'yes' and accs[1]['state'] == 'option',
          'GBZ: пульти за підписами «В комплекті» / «Опція»')

    # --- мульти: стор. 17 (обрізка перед «Комбінаціями»), 18 -------------------------------------------
    check(len(S['GAL-FS-INDOOR-MG']['specs']) == 9, 'MG: 9 рядків, а не таблиця комбінацій')
    f = d['functions']['GAL-FS-INDOOR-M'][-1]
    check(f['not_for'] == r'^GKM\d+MW$', 'GKM-M-W: Wi-Fi лише для -WR')
    check(row(S['GAL-FS-OUTDOOR-M'], 'Холодопродуктивність')['values'][0] == '4,11 (1,82-4,81)', 'GMZ: холод')

    # --- індекс --------------------------------------------------------------------------------------
    I = d['index']
    n = G.norm_model
    check(I['split_gal'][n('GKZ09SH-WS')] == 'GAL-INFINI|1' and I['split_gal'][n('GCZ09SH-W')] == 'GAL-INFINI|0', 'індекс спліта: внутрішній і зовнішній')
    check(I['semi_gal'][n('GBZ36MLQ-W') + '+' + n('GCZ36MLSQ-W')].endswith('|3'), 'індекс напівпрому — за парою')
    check(n('GBZ36MLQ-W') + '+' + n('GCZ36MLNQ-W') in I['semi_gal'] and n('GBZ36MLQ-W') + '+' + n('GCZ36MLSQ-W') in I['semi_gal'],
          'один внутрішній — дві колонки (1ф і 3ф)')
    for s in S.values():
        for sp in s['specs']:
            check(len(sp['values']) == len(s['columns']), '%s: «%s» — кількість значень' % (s['title'], sp['name']))
    print('test_galactic: усе сходиться (12 серій).')


if __name__ == '__main__':
    main()
