#!/usr/bin/env python3
"""Збирає адреси ГОЛОВНОГО фото карток sun-ice.com.ua у data/card-images.json.

Навіщо окремий файл і окремий скрипт (а не поле в specs-*.json): фото потрібне всім
шістьом розділам одразу, а перезбирати через build_specs.py означало б знову обійти всі
275 карток із таблицями. Тут один легкий прохід: беремо ПЕРШУ картинку після <h1> —
на сайті це головне фото галереї картки (перевірено на MHI і Galactic).

Сайт не віддає CORS, тому з браузера його читати не можна — файл готується офлайн,
тією ж схемою, що site-links.json і specs-*.json.

Запуск із кореня репозиторію:
    python claude/site-catalog/build_card_images.py
"""
import json, os, re, sys, time, urllib.request

BASE = 'https://sun-ice.com.ua/'
UA = 'Mozilla/5.0 (compatible; sun-ice-app-builder; +https://app.sun-ice.com.ua)'
SITE = 'claude/site-catalog/site-products.json'
LINKS = 'data/site-links.json'
OUT = 'data/card-images.json'

IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            return urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def main_image(html):
    i = html.find('<h1')
    if i < 0:
        return None
    for m in IMG_RE.finditer(html[i:i + 6000]):
        src = m.group(1)
        if '120x120' in src or 'logo' in src:
            continue
        return src.replace(BASE, '')
    return None


def main():
    slugs = []
    seen = set()
    db = json.load(open(SITE, encoding='utf-8'))
    for p in db['products']:
        s = p['slug']
        if s not in seen:
            seen.add(s); slugs.append(s)
    # у site-links.json бувають картки, яких не було в site-products.json; рядки-пошуки
    # (index.php?route=…) картки не мають — їх пропускаємо
    try:
        lk = json.load(open(LINKS, encoding='utf-8'))
        for lst in lk.get('links', {}).values():
            for slug in lst.values():
                if slug and '?' not in slug and slug not in seen:
                    seen.add(slug); slugs.append(slug)
    except Exception as e:
        print('site-links.json не прочитався:', e)

    images, fails = {}, []
    # уже зібране не перезбираємо — скрипт можна дозапускати
    if os.path.exists(OUT):
        try:
            images = json.load(open(OUT, encoding='utf-8')).get('images', {})
            print('уже у файлі:', len(images))
        except Exception:
            pass
    todo = [s for s in slugs if s not in images]
    print('карток усього:', len(slugs), '| збирати:', len(todo))
    for i, slug in enumerate(todo, 1):
        try:
            src = main_image(fetch(BASE + slug))
            if src:
                images[slug] = src
                print('%3d/%d  %-55s %s' % (i, len(todo), slug[:55], src[-45:]))
            else:
                fails.append((slug, 'фото не знайдено'))
                print('%3d/%d  %-55s БЕЗ ФОТО' % (i, len(todo), slug[:55]))
        except Exception as e:
            fails.append((slug, str(e)))
            print('%3d/%d  %-55s ПОМИЛКА: %s' % (i, len(todo), slug[:55], e))
        sys.stdout.flush()
        time.sleep(0.6)

    json.dump({
        '_about': 'Головне фото картки sun-ice.com.ua. Ключ — slug картки (той самий, що в '
                  'data/site-links.json), значення — шлях відносно base. Збирає '
                  'claude/site-catalog/build_card_images.py (сайт без CORS, тому офлайн).',
        'collected': time.strftime('%Y-%m-%d'),
        'base': BASE,
        'count': len(images),
        'images': images,
    }, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print()
    print('зібрано:', len(images), '| не вийшло:', len(fails))
    for s, e in fails[:15]:
        print('   ', s, '—', e)
    print('файл:', OUT, '%.0f КБ' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
