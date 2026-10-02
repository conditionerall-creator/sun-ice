#!/usr/bin/env python3
"""Будує data/site-links.json — таблицю "маркування в застосунку -> картка на sun-ice.com.ua".

Запуск (з кореня репозиторію):
    python claude/site-catalog/build_site_links.py --app <appdump.json> \
        [--site claude/site-catalog/site-products.json] [--out data/site-links.json] [--report <файл.txt>]

Вхідні дані:
  --app   дамп списків застосунку (див. нижче, як зняти).
  --site  база карток сайту (claude/site-catalog/site-products.json). Її треба оновлювати, коли
          на сайті з'являються/зникають картки: краулінг трьох категорій (split-systemy,
          multy-split-systemy, napivpromyslovi-split-systemy) + пошук по брендах Galactic і
          Mitsubishi — у кожного запису: slug, code ("Код товару"), indoor/outdoor (з таблиці
          характеристик), listed_in (категорії, у лістингу яких картку видно).

Як зняти дамп із застосунку: відкрити застосунок (python -m http.server у корені репо), дочекатись
прайсу й у консолі сторінки виконати
    JSON.stringify(Object.fromEntries(['split_mhi','split_gal','multisplit_mhi','multisplit_gal',
      'semi_mhi','semi_gal'].map(k => [k, (sheetsData[k]||[]).map(it => ({model: it.model,
      outdoorModel: it.outdoorModel||null, group: it.groupLabel||it.groupKey||null,
      unitType: it.unitType||null, key: siteLinkKey(it)}))])))
і зберегти результат у файл. Поле key — рівно те, що рахує застосунок, ним і ключується таблиця.

Правила зіставлення:
  * Мульти спліт — лише картки з адресою multy-split-systema-* (внутрішні/зовнішні блоки окремо).
    Спліт/Напівпром — решта; серед кількох карток береться та, що ПОКАЗУЄТЬСЯ в лістингу категорії
    (старі ревізії, "Знято з виробництва", з лістингу зняті — на них не лінкуємо).
  * Маркування збігається, коли ВСІ його частини ("A + B", для напівпрому Galactic ще й зовнішній
    блок) є серед маркувань картки (код + моделі блоків). Регістр, пробіли, довгі тире та
    кирилічні двійники латинських літер не враховуються.
  * Якщо карток кілька — лишається та, у якої "Код товару" містить маркування буквально
    (без урахування двійників): так відсіюються картки з помилками в назві на самому сайті.
  * Позначка у прайсі "W2(3)" / "W1(3)" = "ревізія W2 або W3" / "W1 або W3": якщо серед таких
    карток у лістингу рівно одна — посилання на неї; якщо дві (FDE50/60, FDT50/60) — посилання
    на ПОШУК по сайту ("FDE50VH SRC50ZSX"), де видно обидві картки (рішення власника 2026-10-02).
    Значення в таблиці — або slug картки, або відносний шлях пошуку (index.php?route=...).
  * Усе, що не знайшлось однозначно, у таблицю НЕ потрапляє — застосунок такий рядок не робить
    клікабельним.
"""
import argparse
import collections
import io
import json
import re
import sys
import urllib.parse

LATIN_TWINS = {'С': 'C', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
               'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'І': 'I'}
TILE_CATEGORY = {'split': 'split', 'multisplit': 'multi', 'semi': 'semi'}
ACCESSORY = re.compile(r'^(RC-|RCH|RCN|SC-BIKN|AM-MHI|WF-RAC|WIFI|WI-FI|12B|RG10D|LB-|T-PSA|TC-PSA|'
                       r'TC-OA|UM-FL|UT-BAT|[A-Z]*-?PSA)', re.I)
REVISION_ALT = re.compile(r'^(.*?)W(\d)\((\d)\)$')  # SRC50ZSX-W2(3) -> W2 або W3


def clean_dashes(s):
    return s.upper().replace('–', '-').replace('—', '-').replace('‑', '-')


def norm(s):
    """Для зіставлення: великі літери, одне тире, кирилічні двійники -> латиниця, без пробілів."""
    s = ''.join(LATIN_TWINS.get(ch, ch) for ch in clean_dashes(s))
    return re.sub(r'\s+', '', s)


def raw_norm(s):
    """Те саме, але БЕЗ заміни кирилічних двійників — щоб відсіювати картки з помилками на сайті."""
    return re.sub(r'\s+', '', clean_dashes(s))


def split_tokens(s, fn):
    return {fn(t) for t in re.split(r'[/+,;]', s or '') if fn(t)}


def product_tokens(p):
    t = split_tokens(p.get('code'), norm)
    for m in (p.get('indoor') or []) + (p.get('outdoor') or []):
        t |= split_tokens(m, norm)
    return t


def app_parts(item):
    """Частини маркування застосунку: ['FDE50VH', 'SRC50ZSX-W2(3)'] або ['GBZ36MLQ-W', 'GCZ36MLNQ-W']."""
    first = (item['model'] or '').split('\n')[0]
    parts = [norm(x).split(',')[0] for x in re.split(r'\s\+\s', first)]
    if item.get('outdoorModel'):
        parts.append(norm(item['outdoorModel']))
    return parts


def expand_revisions(parts):
    """'X-W2(3)' -> два варіанти списку частин: з X-W2 і з X-W3."""
    for i, part in enumerate(parts):
        m = REVISION_ALT.match(part)
        if m:
            base, first, second = m.groups()
            return [parts[:i] + [f'{base}W{first}'] + parts[i + 1:],
                    parts[:i] + [f'{base}W{second}'] + parts[i + 1:]], True
    return [parts], False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True)
    ap.add_argument('--site', default='claude/site-catalog/site-products.json')
    ap.add_argument('--out', default='data/site-links.json')
    ap.add_argument('--report', default=None)
    a = ap.parse_args()

    app = json.load(io.open(a.app, encoding='utf-8'))
    site = json.load(io.open(a.site, encoding='utf-8'))
    products = site['products'] if isinstance(site, dict) else site
    for p in products:
        p['_tokens'] = product_tokens(p)
        p['_raw'] = split_tokens(p.get('code'), raw_norm)

    links, report = {}, collections.defaultdict(list)
    no_card = {}
    for list_key, items in app.items():
        tile = list_key.rsplit('_', 1)[0]
        category = TILE_CATEGORY[tile]
        if category == 'multi':
            pool = [p for p in products if p['slug'].startswith('multy-split-systema')]
        else:
            pool = [p for p in products if not p['slug'].startswith('multy-split-systema')
                    and category in (p.get('listed_in') or [])]
        links[list_key] = {}
        for item in items:
            variants, is_alt = expand_revisions(app_parts(item))
            found = {}
            for parts in variants:
                cands = [p for p in pool if set(parts) <= p['_tokens']]
                if len(cands) > 1:  # відсіяти картки з помилками в назві на сайті
                    exact = [p for p in cands if {raw_norm(x) for x in parts} <= p['_raw']]
                    cands = exact or cands
                for p in cands:
                    found[p['slug']] = p
            model = (item['model'] or '').split('\n')[0]
            if len(found) == 1:
                slug = next(iter(found))
                links[list_key][item['key']] = slug
                report['ok'].append(f'{list_key}: {model}')
            elif len(found) > 1 and is_alt:
                # Дві активні ревізії: ведемо на пошук, де видно обидві (індекс 0 — внутрішній блок,
                # назва зовнішнього без позначки ревізії: SRC50ZSX-W2(3) -> SRC50ZSX)
                outdoor_base = REVISION_ALT.match(app_parts(item)[-1]).group(1).rstrip('-')
                query = f'{app_parts(item)[0]} {outdoor_base}'
                links[list_key][item['key']] = ('index.php?route=product/search&search='
                                                + urllib.parse.quote(query))
                report['search'].append(f'{list_key}: {model} -> пошук "{query}" ({len(found)} картки)')
            elif len(found) > 1:
                report['ambiguous'].append(f'{list_key}: {model} -> {sorted(found)}')
            elif ACCESSORY.match(model):
                report['accessory'].append(f'{list_key}: {model}')
            else:
                report['missing'].append(f'{list_key}: {model}'
                                         + (f' + {item["outdoorModel"]}' if item.get('outdoorModel') else ''))
        links[list_key] = dict(sorted(links[list_key].items()))
        # Усі маркування без посилання на момент збірки (аксесуари + товари, яких нема на сайті).
        # Самодіагностика застосунку (diagCheckSiteLinks) за цим списком відрізняє ВІДОМУ відсутність
        # картки від НОВОЇ позиції в прайсі, для якої картку ще не додано/таблицю не перебудовано.
        no_card[list_key] = sorted({it['key'] for it in items if it['key'] not in links[list_key]})

    # Для серверної перевірки сайту (Edge Function check-site-links): усі відомі на момент збірки картки
    # (щоб відрізнити НОВУ картку від давньої) і картки, які живі, але не показуються в лістингу
    # категорії (6 внутрішніх блоків Galactic H-S) — щоб не лякати постійним "не в лістингу".
    by_slug = {p['slug']: p for p in products}
    used = {v for lk in links.values() for v in lk.values() if not v.startswith('index.php')}
    unlisted = sorted(s for s in used if not by_slug[s].get('listed_in'))
    out = {'base': 'https://sun-ice.com.ua/', 'built': site.get('collected') if isinstance(site, dict) else None,
           'links': links, 'noCard': no_card,
           'knownSlugs': sorted(by_slug), 'unlisted': unlisted}
    with io.open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0, separators=(',', ':'))
        f.write('\n')

    lines = []
    for k in ('ok', 'search', 'ambiguous', 'missing', 'accessory'):
        lines.append(f'{k}: {len(report[k])}')
    for k in ('search', 'ambiguous', 'missing'):
        lines.append(f'\n--- {k} ---')
        lines += report[k]
    text = '\n'.join(lines)
    if a.report:
        io.open(a.report, 'w', encoding='utf-8').write(text + '\n')
    sys.stdout.buffer.write((text.split('\n--- ')[0] + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
