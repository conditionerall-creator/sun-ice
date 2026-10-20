# -*- coding: utf-8 -*-
"""Еталон розбору НАПІВПРОМИСЛОВИХ таблиць каталогу MHI (стор. 99–136).
Запуск:  python claude/mhi-catalog/tests/test_semi.py

Сторінки 99, 102, 107, 113 і 136 звірені з надрукованим каталогом ОЧИМА (2026-10-20).
Усе, що зашито нижче, — як надруковано, а не «як вийшло в алгоритму». Тест упав —
зламався розбір (або хтось замінив PDF), а не еталон.

Пастки, на яких уже наступали:
 • стор. 102 — підписи рядків у ДРУКОВАНОМУ каталозі зсунуті на рядок відносно значень
   («Холодопродуктивність» стоїть навпроти «1 фаза, 220-240 В»); розбір сам виправляє це
   за змістом і тест це вимагає;
 • стор. 107/113/136 — об'єднані комірки, у яких не надруковано лінії між колонками;
 • стор. 136 — дві таблиці одна під одною, у другій підпис «Модель» притиснутий праворуч;
 • стор. 113 — рядок «Магістраль» заввишки 34 пт (не можна обривати таблицю за висотою).
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import pdfgrid as G                                            # noqa: E402
import semi_catalog as S                                       # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PDF = os.path.join(os.path.dirname(ROOT), 'Sun-ice — довідники', 'catalog-mhi-rac-pac.pdf')
DATA = os.path.join(ROOT, 'data', 'mhi-catalog.json')


def tables(page):
    words = G.page_words(PDF, page)
    segs = S.page_segments(PDF, page)
    out = []
    for top, bot in S.find_tables(words, segs):
        rep = []
        out.append((S.parse_table(words, segs, top, bot, page, rep), rep))
    return out


def row(t, name_start):
    return next(r for r in t['rows'] if r['name'].startswith(name_start))


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def main():
    if not os.path.exists(PDF):
        raise SystemExit('Не знайдено каталог: ' + PDF)

    # --- стор. 99: комплекти, одинарні й «Подвійна» ------------------------------------
    (t, rep), = tables(99)
    check(t['ncol'] == 5 and not rep, 'стор. 99: 5 колонок без зауважень, а є %s %s' % (t['ncol'], rep))
    check([c['system'] for c in t['columns']] ==
          ['FDT40ZSXW1VH', 'FDT50ZSXW2VH', 'FDT60ZSXW1VH', 'FDT71VNXWVH', 'FDT71VNXWPVH'], 'стор. 99: коди')
    check(t['columns'][3]['indoor'] == [{'m': 'FDT71VH', 'n': 1}] and
          t['columns'][3]['outdoor'] == [{'m': 'FDC71VNX-W', 'n': 1}], 'стор. 99: FDT71VNXWVH — пара')
    check(t['columns'][4]['indoor'] == [{'m': 'FDT40VH', 'n': 2}] and t['columns'][4]['tag'] == 'Подвійна',
          'стор. 99: подвійний комплект = два FDT40VH')
    check(row(t, 'Холодопродуктивність')['values'] ==
          ['4.0 ( 1.1 ~ 4.7 )', '5.0 ( 1.1 ~ 5.6 )', '5.6 ( 1.1 ~ 6.3 )', '7.1 ( 3.2 ~ 8.0 )', '7.1 ( 3.2 ~ 8.0 )'],
          'стор. 99: холодопродуктивність')
    # «Рівень звукового тиску · Зовнішн.» — підпис тягнуло до «звукової потужності» (tables.py)
    check(row(t, 'Рівень звукового тиску · Зовнішн.')['values'] ==
          ['52 / 50', '52 / 50', '53 / 54', '51 / 51', '51 / 51'], 'стор. 99: тиск зовнішнього блока')
    check(row(t, 'Рівень звукової потужності · Зовнішн.')['values'] ==
          ['63 / 62', '63 / 62', '65 / 65', '66 / 66', '66 / 66'], 'стор. 99: потужність зовнішнього блока')
    check(row(t, 'Розміри · Зовнішн.')['values'][:3] == ['800(+71) x 640 x 290'] * 3 and
          row(t, 'Розміри · Зовнішн.')['values'][3:] == ['880(+88) x 750 x 340'] * 2, 'стор. 99: об\'єднані комірки розмірів')

    # --- стор. 102: ДВІ таблиці, у друкованому каталозі підписи зсунуті на рядок -------------
    ts = tables(102)
    check(len(ts) == 2, 'стор. 102: дві таблиці, а є %d' % len(ts))
    for t, rep in ts:
        check(t['shift'] == 1, 'стор. 102: зсув підписів має бути виявлено')
        check(row(t, 'Електроживлення')['values'][0].startswith('1 фаза') or
              row(t, 'Електроживлення')['values'][0].startswith('3 фази'), 'стор. 102: Електроживлення — це фаза')
        check(re.search(r'~', row(t, 'Холодопродуктивність')['values'][0]) is not None, 'стор. 102: холодопродуктивність — діапазон')
    t0 = ts[0][0]
    check(row(t0, 'Холодопродуктивність')['values'][0] == '10.0 ( 4.0 ~ 11.2 )', 'стор. 102: 10.0 ( 4.0 ~ 11.2 )')
    check(row(t0, 'Теплопродуктивність')['values'][0] == '11.2 ( 4.0 ~ 12.5 )', 'стор. 102: 11.2 ( 4.0 ~ 12.5 )')
    check(row(t0, 'Споживана потужність')['values'][0] == '2.82 / 2.73', 'стор. 102: споживана 2.82 / 2.73')
    check(row(t0, 'Номінал автоматичного')['values'] == ['30'] * 4 and
          [r['name'] for r in t0['rows']].count('Номінал автоматичного вимикача') == 1,
          'стор. 102: останній рядок один, дубль підпису прибрано')
    check(t0['columns'][3]['indoor'] == [{'m': 'FDT50VH', 'n': 3}] and t0['columns'][3]['tag'] == 'Потрійна',
          'стор. 102: потрійний комплект')

    # --- стор. 107: шість колонок, об'єднані по три -----------------------------------
    (t, rep), = tables(107)
    check(t['ncol'] == 6 and not rep, 'стор. 107: 6 колонок без зауважень, а є %s %s' % (t['ncol'], rep))
    check(row(t, 'Вага нетто · Зовнішн.')['values'] == ['77', '77', '77', '78', '78', '78'], 'стор. 107: вага зовнішнього')
    check(row(t, 'Номінал автоматичного')['values'] == ['30', '30', '30', '20', '20', '20'], 'стор. 107: автомат')

    # --- стор. 113: дві таблиці, високий рядок «Магістраль», комірка на дві колонки ---------
    ts = tables(113)
    check(len(ts) == 2 and all(len(t['rows']) == 34 for t, _ in ts), 'стор. 113: дві таблиці по 34 рядки')
    t, rep = ts[0]
    check(not rep and row(t, 'Макс. струм')['values'] == ['23', '25', '25'], 'стор. 113: максимальний струм')
    mag = row(t, 'Магістраль')['values']
    check(mag[0].startswith('9.52(3/8")*') and mag[1] == mag[2] and mag[1].startswith('12.7(1/2")'),
          'стор. 113: магістраль — перша колонка окремо, друга й третя об\'єднані')

    # --- стор. 136: друга таблиця під першою, підпис «Модель» праворуч ---------------------
    ts = tables(136)
    check(len(ts) == 2 and [t['ncol'] for t, _ in ts] == [5, 3], 'стор. 136: таблиці 5 і 3 колонки')
    check(row(ts[0][0], 'Вага нетто · Зовнішн.')['values'] == ['77', '78', '144', '145', '155'], 'стор. 136: вага')

    # --- готовий файл даних -----------------------------------------------------------
    with open(DATA, encoding='utf-8') as f:
        doc = json.load(f)
    semi = {k: v for k, v in doc['series'].items() if k.startswith('SEMI-')}
    check(len(semi) == 42, 'у файлі має бути 42 таблиці напівпрому, а є %d' % len(semi))
    names = None
    for k, s in semi.items():
        for sp in s['specs']:
            check(all(v is not None for v in sp['values']), '%s: «%s» має порожнє значення' % (k, sp['name']))
            check(len(sp['values']) == len(s['columns']), '%s: «%s» — значень %d, колонок %d'
                  % (k, sp['name'], len(sp['values']), len(s['columns'])))
        check(33 <= len(s['specs']) <= 34, '%s: рядків %d' % (k, len(s['specs'])))
        check('Електроживлення' == s['specs'][0]['name'], '%s: перший рядок — Електроживлення' % k)
    idx = doc['index']['semi_mhi']
    check(len(idx) == 106, 'пар у індексі напівпрому має бути 106, а є %d' % len(idx))
    for pair, ref in idx.items():
        key, col = ref.split('|')
        s = doc['series'][key]
        ins, outs = pair.split('+')
        check(G.norm_model(s['indoor'][int(col)][0]) == ins and G.norm_model(s['outdoor'][int(col)][0]) == outs,
              'індекс %s веде в чужу колонку %s' % (pair, ref))
    # той самий внутрішній блок живе в різних колонках: ключ — лише пара
    check(len([p for p in idx if p.startswith('FDT100VH+')]) >= 5, 'FDT100VH має бути щонайменше в п\'яти парах')
    # побутовий індекс напівпромом не забруднений
    for sec in ('split_mhi', 'multisplit_mhi'):
        check(all(not v.startswith('SEMI-') for v in doc['index'][sec].values()), '%s вказує на напівпром' % sec)

    # --- функції й аксесуари напівпрому ------------------------------------------------
    sets = doc['acc_sets']
    check(len(sets) >= 20, 'довідник наборів аксесуарів порожній')
    for k, s in semi.items():
        check(len(s['acc_idx']) == len(s['columns']) and len(s['funcs_cols']) == len(s['columns']),
              '%s: acc_idx/funcs_cols не за кількістю колонок' % k)
        fam = k.split('-')[1]
        want = {'FDTC': 10, 'FDUM': 12, 'FDE': 13, 'FDT': 'FDT', 'FDU': 'FDU', 'FDF': 'FDF'}.get(fam, 'srk')
        if want != 'srk':
            check(set(s['funcs_cols']) == {want}, '%s: функції мають бути з колонки %s' % (k, want))
        for i in s['acc_idx']:
            check(0 <= i < len(sets), '%s: номер набору аксесуарів поза межами' % k)
    for c in (10, 12, 13):
        check(str(c) in doc['functions'] and len(doc['functions'][str(c)]) >= 30, 'немає функцій колонки %d' % c)
    for fam in ('FDT', 'FDU', 'FDF'):   # рядок значків на титульній сторінці родини
        check(len(doc['functions'][fam]) == 7 and any(f['state'] == 'option' for f in doc['functions'][fam]), 'значки %s' % fam)
    srk = [st for k, sr in semi.items() if k.startswith('SEMI-SRK') for st in [doc['acc_sets'][i] for i in sr['acc_idx']]]
    check(all(st[0]['name'] == 'Бездротовий пульт ДК' and st[0]['state'] == 'yes' for st in srk), 'SRK: бездротовий пульт у комплекті')
    # у кожному наборі пульти, яких немає в тексті каталогу, не з'являються
    names = {a['name'] for st in sets for a in st}
    check('RC-EX3D' in names and 'RC-ES1' in names and 'INWFIMHI001R100' not in names, 'аксесуари: склад імен')
    check(not any('адапXтер' in a['name'] or 'свижого' in (a['note'] or '') for st in sets for a in st),
          'друкарські вади тексту мають бути прибрані')

    # --- тип інвертора зовнішнього блока (стор. 86) --------------------------------------
    ot = doc['outdoor_types']
    check(sorted(k for k, v in ot.items() if v == 'hyper') ==
          sorted(G.norm_model(x) for x in ('SRC40ZSX-W1', 'SRC50ZSX-W3', 'SRC60ZSX-W3', 'FDC71VNX-W', 'FDC100VNX-W', 'FDC100VSX-W',
                                           'FDC125VNX-W', 'FDC125VSX-W', 'FDC140VNX-W', 'FDC140VSX-W')), 'Hyper Inverter зі стор. 86')
    check(sorted(k for k, v in ot.items() if v == 'micro') ==
          sorted(G.norm_model(x) for x in ('FDC100VNA-W', 'FDC100VSA-W', 'FDC125VNA-W', 'FDC125VSA-W', 'FDC140VNA-W',
                                           'FDC140VSA-W', 'FDC200VSA-W', 'FDC250VSA-W', 'FDC280VSA-W')), 'Micro Inverter зі стор. 86')
    check(sorted(k for k, v in ot.items() if v == 'standard') ==
          sorted(G.norm_model(x) for x in ('FDC71VNP-W', 'FDC90VNP-W', 'FDC100VNP-W', 'FDC125VNP-W')), 'Standard Inverter зі стор. 86')
    for s in semi.values():   # кожен зовнішній блок комплекту має тип
        for outs in s['outdoor']:
            for o in outs:
                check(G.norm_model(o.split(' x ')[0]) in ot, 'немає типу інвертора для %s' % o)

    print('test_semi: усе сходиться (42 таблиці, 106 пар).')


if __name__ == '__main__':
    main()
