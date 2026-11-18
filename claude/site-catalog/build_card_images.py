#!/usr/bin/env python3
"""Збирає адреси ГОЛОВНОГО фото карток sun-ice.com.ua у data/card-images.json.

Навіщо окремий файл і окремий скрипт (а не поле в specs-*.json): фото потрібне всім
шістьом розділам одразу, а перезбирати через build_specs.py означало б знову обійти всі
275 карток із таблицями. Тут один легкий прохід: беремо ПЕРШУ картинку після <h1> —
на сайті це головне фото галереї картки (перевірено на MHI і Galactic).

Сайт не віддає CORS, тому з браузера його читати не можна — файл готується офлайн,
тією ж схемою, що site-links.json і specs-*.json.

Запуск із кореня репозиторію:
    python claude/site-catalog/build_card_images.py            # дозібрати нові картки + застосувати заміни
    python claude/site-catalog/build_card_images.py --apply    # лише заміни (без обходу сайту), перевирізати файли

ЗАМІНИ (рішення власника 2026-11-18). На частині карток сайту головне фото — ЗБІРНЕ: внутрішній
блок + зовнішній (+ пульт). У панелі товару показуємо один внутрішній блок, як на решті карток.
Дві таблиці нижче:
  • SITE_SWAP — збірне фото → інше фото ТОГО САМОГО внутрішнього блока з сайту;
  • CROPS     — збірне фото, іншого на сайті немає → вирізаємо внутрішній блок рамкою (білий фон
                лишається, як у решти фото карток) у tile-images/cards/*.webp. Джерело кладемо в
                claude/site-catalog/card-src/, щоб перевирізати без мережі.
Результат — поле "local" (slug → файл застосунку) і "swapped" (slug → було/стало) у card-images.json.
Нове збірне фото на сайті = новий рядок тут; самодіагностика рахує заміни в рядку «Фото карток».
"""
import json, os, re, sys, time, urllib.request

BASE = 'https://sun-ice.com.ua/'
UA = 'Mozilla/5.0 (compatible; sun-ice-app-builder; +https://app.sun-ice.com.ua)'
SITE = 'claude/site-catalog/site-products.json'
LINKS = 'data/site-links.json'
OUT = 'data/card-images.json'

IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)

SITE_SWAP = {
    # FDUM125/140: сайт ставить «FDUM-VH + FDC Hyper Inverter» навіть на Micro (VNA/VSA) і Standard (VNP) —
    # на фото чужий зовнішній блок. Внутрішній FDUM-VH той самий, що на FDUM40–100.
    'image/cache/catalog/fdum-vh_fdc100-140vnx_vsx-1080x652.png':
        'image/cache/catalog/Mitsubishi%20Heavy%20FDUM50VH-1000x1000%20(1)-1080x652.jpg',
}
CROPS = {
    # сайт-шлях: (файл застосунку, рамка (x0, y0, x1, y1) у пікселях джерела 1080×652)
    'image/cache/catalog/1003-FDF3_4_5-1080x652.jpg':
        ('tile-images/cards/mhi-fdf-71-100.webp', (240, 60, 460, 605)),      # FDF71/100: ліва колона
    'image/cache/catalog/mitsubishi-heavy-industries-air-conditioning-fdc140vsa-w-fdf140vh-floor-mounted-hyper-1-17683-p-1080x652.jpg':
        ('tile-images/cards/mhi-fdf-125-140.webp', (285, 70, 505, 615)),     # FDF125/140: ліва колона
    'image/cache/catalog/uploads/2020/07/orient-1080x652.jpg':
        ('tile-images/cards/gal-orient.webp', (205, 0, 880, 268)),           # Orient HF-S: внутрішній зверху
}
CARD_SRC = 'claude/site-catalog/card-src'


def build_crops():
    from PIL import Image
    os.makedirs(CARD_SRC, exist_ok=True)
    for src, (out, box) in CROPS.items():
        local = os.path.join(CARD_SRC, os.path.basename(src).replace('%20', '_'))
        if not os.path.exists(local):
            req = urllib.request.Request(BASE + src, headers={'User-Agent': UA})
            open(local, 'wb').write(urllib.request.urlopen(req, timeout=40).read())
        im = Image.open(local).convert('RGB').crop(box)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.save(out, 'WEBP', quality=90, method=6)
        print('вирізано %-40s %dx%d  %5d B' % (out, im.width, im.height, os.path.getsize(out)))


def apply_swaps(images):
    local, swapped = {}, {}
    for slug, p in list(images.items()):
        if p in SITE_SWAP:
            images[slug] = SITE_SWAP[p]
            swapped[slug] = {'was': p, 'now': SITE_SWAP[p]}
        elif p in CROPS:
            local[slug] = CROPS[p][0]
            swapped[slug] = {'was': p, 'now': CROPS[p][0]}
    return local, swapped


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
    if '--apply' in sys.argv:
        build_crops()
        doc = json.load(open(OUT, encoding='utf-8'))
        orig = {s: v['was'] for s, v in doc.get('swapped', {}).items()}
        images = doc['images']
        images.update({s: w for s, w in orig.items()})     # повернути вихідні, щоб заміни застосувались заново
        doc['local'], doc['swapped'] = apply_swaps(images)
        json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print('замін: %d (з них вирізок у застосунку: %d)' % (len(doc['swapped']), len(doc['local'])))
        return
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
            prev = json.load(open(OUT, encoding='utf-8'))
            images = prev.get('images', {})
            images.update({s: v['was'] for s, v in prev.get('swapped', {}).items()})
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

    build_crops()
    local, swapped = apply_swaps(images)
    json.dump({
        '_about': 'Головне фото картки sun-ice.com.ua. Ключ — slug картки (той самий, що в '
                  'data/site-links.json), значення — шлях відносно base. Збирає '
                  'claude/site-catalog/build_card_images.py (сайт без CORS, тому офлайн). '
                  'local — фото з самого застосунку (вирізки зі збірних фото), має пріоритет над images; '
                  'swapped — що на що замінено.',
        'collected': time.strftime('%Y-%m-%d'),
        'base': BASE,
        'count': len(images),
        'images': images,
        'local': local,
        'swapped': swapped,
    }, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print()
    print('зібрано:', len(images), '| не вийшло:', len(fails))
    for s, e in fails[:15]:
        print('   ', s, '—', e)
    print('файл:', OUT, '%.0f КБ' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
