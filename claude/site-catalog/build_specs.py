#!/usr/bin/env python3
"""Збирає технічні характеристики карток sun-ice.com.ua у файл для застосунку.

Навіщо окремий файл: сайт не віддає CORS, тому браузер прочитати його не може —
саме через це таблиця посилань (data/site-links.json) теж будується офлайн-скриптом.
Тут та сама схема: качаємо з сервера, кладемо поруч готовий JSON.

Запуск із кореня репозиторію:
    python claude/site-catalog/build_specs.py --group split_gal --out data/specs-split-gal.json

Структура результату — ключ це SLUG картки (той самий, що в data/site-links.json), тож
застосунок іде: маркування -> site-links.json -> slug -> specs.
Усередині дві частини в тому ж поділі, що робить сам сайт: «основні» (дані для загального
розуміння) і «додаткові» (для технічних спеціалістів), кожна — список груп із підзаголовком.
"""
import argparse, json, re, sys, time, urllib.request
from bs4 import BeautifulSoup

UA = 'Mozilla/5.0 (compatible; sun-ice-app-builder; +https://app.sun-ice.com.ua)'


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            return urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def parse_tables(html):
    """Повертає {'основні': [...], 'додаткові': [...]}.
    Група — це рядок таблиці з ОДНІЄЮ коміркою (підзаголовок на кшталт «Габарити»);
    далі йдуть рядки «назва / значення». Перший підзаголовок кожної таблиці — її назва."""
    soup = BeautifulSoup(html, 'html.parser')
    out = {}
    for table in soup.find_all('table'):
        groups, cur = [], None
        title = None
        for tr in table.find_all('tr'):
            cells = [c.get_text(' ', strip=True) for c in tr.find_all(['td', 'th'])]
            cells = [re.sub(r'\s+', ' ', c) for c in cells]
            if not any(cells):
                continue
            if len(cells) == 1:
                if title is None:
                    title = cells[0]
                    continue
                cur = {'g': cells[0], 'rows': []}
                groups.append(cur)
            elif len(cells) >= 2:
                if cur is None:
                    cur = {'g': '', 'rows': []}
                    groups.append(cur)
                cur['rows'].append([cells[0], cells[1]])
        if not title or not groups:
            continue
        key = 'основні' if 'снов' in title else ('додаткові' if 'одатков' in title else None)
        if key:
            out[key] = groups
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--group', default='split_gal', help='matched_by з site-products.json')
    ap.add_argument('--site', default='claude/site-catalog/site-products.json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--delay', type=float, default=1.0, help='пауза між картками, сек')
    a = ap.parse_args()

    db = json.load(open(a.site, encoding='utf-8'))
    cards = [p for p in db['products'] if a.group in (p.get('matched_by') or [])]
    if a.limit:
        cards = cards[:a.limit]
    print('карток до збору:', len(cards))

    specs, fails = {}, []
    for i, c in enumerate(cards, 1):
        try:
            tables = parse_tables(fetch(c['url']))
            if not tables:
                fails.append((c['slug'], 'таблиць не знайдено'))
                print('%3d/%d  %-60s БЕЗ ТАБЛИЦЬ' % (i, len(cards), c['slug'][:60]))
            else:
                specs[c['slug']] = tables
                n = sum(len(g['rows']) for part in tables.values() for g in part)
                print('%3d/%d  %-60s %d параметрів' % (i, len(cards), c['slug'][:60], n))
        except Exception as e:
            fails.append((c['slug'], str(e)))
            print('%3d/%d  %-60s ПОМИЛКА: %s' % (i, len(cards), c['slug'][:60], e))
        time.sleep(a.delay)

    result = {
        '_about': 'Технічні характеристики карток sun-ice.com.ua. Ключ — slug картки (той самий, '
                  'що в data/site-links.json). Збирає claude/site-catalog/build_specs.py. '
                  'Сайт не віддає CORS, тому читати його з браузера не можна — файл готується офлайн.',
        'collected': time.strftime('%Y-%m-%d'),
        'group': a.group,
        'count': len(specs),
        'specs': specs,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
    import os
    print()
    print('зібрано карток:', len(specs), '| не вийшло:', len(fails))
    for s, e in fails[:10]:
        print('   ', s, '—', e)
    print('файл:', a.out, '%.0f КБ' % (os.path.getsize(a.out) / 1024))


if __name__ == '__main__':
    main()
