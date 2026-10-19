#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Фото груп прайсу (шапки груп у Спліт / Мульти / Напівпром, MHI і Galactic) — з каталогів.

Рішення власника 2026-10-19: «на кожній групі охайно розмістити зображення товару, як вирізане,
без білої підложки; брати з PDF-каталогу; не вигадувати неіснуючих зображень». Джерела:
  • catalog-mhi-rac-pac.pdf — зображення, ВБУДОВАНІ в PDF (сторінка + xref), не рендер сторінки;
  • cat_Galactic.pdf        — те саме;
  • galactic.ua             — лише там, де в каталозі Galactic немає серії (Orient, мульти H-W / H-S);
                              власник дозволив брати з сайту. Файл кладемо в SITE_DIR, адресу пишемо
                              в _source.json.
Нічого не домальовується. Що робимо з кожним зображенням:
  1) якщо в PDF у нього є своя маска прозорості (Galactic) — беремо її як є;
  2) інакше білий фон каталогу прибираємо маскою, ВИВЕДЕНОЮ З САМОГО ЗОБРАЖЕННЯ: заливка «майже
     білого» від краю кадру, дірки всередині блока лишаються блоком, найбільший об'єкт — це сам блок;
     край на 1 px стискаємо й легко розмиваємо (без білого ореолу на кольоровому тлі);
  3) обрізаємо по контуру, зменшуємо до ширини 280 px (на картці ~120 CSS px, ×2 для Retina);
  4) зберігаємо WebP з прозорістю.
Працює лише для зображень на чисто білому фоні. Фото на тлі інтер'єру так не вирізати — для таких груп
у PHOTOS обрано інше зображення того ж виробу з каталогу.

Потрібно: pip install pymupdf pillow numpy scipy   (poppler тут НЕ потрібен — він для tables.py).
Запуск:  python claude/mhi-catalog/build_group_images.py [--only імя1,імя2]
Результат: tile-images/mhi-groups/*.webp + _source.json (звідки яке фото). Прив'язка «група прайсу →
файл» — таблиця CG_PHOTOS у js/04a-catalog-groups.js.

XREF стабільні лише для ЦИХ файлів каталогів. Новий каталог → перевірити контактним аркушем і поправити
PHOTOS. Скрипт сам зупиниться, якщо xref на сторінці не знайшовся — тихої підміни не буде.
"""
import io
import json
import os
import sys

import numpy as np
import pymupdf
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'tile-images', 'mhi-groups')
CATALOGS = {
    'mhi': r'D:\Клод\Каталоги и база знаний\catalog-mhi-rac-pac.pdf',
    'gal': r'D:\Клод\Каталоги и база знаний\cat_Galactic.pdf',
}
# Зображення з galactic.ua (скачані вручну, потім лише читаються). Перезавантажити:
#   https://galactic.ua/wp-content/uploads/2020/07/orient.jpg  та 2021/07/r32-multi.jpg, r410a-multi.jpg
SITE_DIR = os.environ.get('GAL_SITE_DIR', os.path.join(HERE, 'site-src'))
OUT_W = 280      # ширина готового файлу, px

# (ім'я файлу, джерело, сторінка|файл, xref|None, що це, [рамка обрізання для зображень із сайту])
PHOTOS = [
    # ---- MHI: спліт-системи, внутрішні блоки (стор. 34–52) ----
    ('split-zsx',   'mhi', 34, 1336, 'SRK-ZSX-W, -WF — настінний'),
    ('split-zr',    'mhi', 36, 1381, 'SRK-ZR-W, -WF — настінний'),
    ('split-zt',    'mhi', 38, 1407, 'SRK-ZT-WF — настінний (біле виконання)'),
    ('split-zs',    'mhi', 40, 1434, 'SRK-ZS-W — настінний'),
    ('split-ztl',   'mhi', 42, 1455, 'SRK-ZTL-W — настінний'),
    ('split-zsp',   'mhi', 44, 1475, 'SRK-ZSP-W1 — настінний'),
    ('split-zspr',  'mhi', 46, 1520, 'SRK-ZSPR-S — настінний'),
    ('split-srf',   'mhi', 50, 1569, 'SRF-ZS/ZSX — підлоговий (спліт і мульти)'),
    ('split-srr',   'mhi', 51, 1587, 'SRR-ZS — канальний (спліт і мульти)'),
    ('mhi-fdtc',    'mhi', 104, 2989, 'FDTC-VH — касетний компактний (спліт, мульти, напівпром — один виріб)'),
    # ---- MHI: мульти (стор. 56–57); ZSX/ZR/ZS/SRF/SRR/FDTC беруть фото зі спліта — це ті самі блоки ----
    ('multi-zsp',   'mhi', 56, 1795, 'SKM-ZSP-W — настінний (в мульти код SKM, не SRK)'),
    # ---- MHI: напівпром (стор. 94–132) ----
    ('semi-fdt',    'mhi', 94, 2733, 'FDT-VH — касетний 4-потоковий'),
    ('semi-fdu',    'mhi', 108, 3073, 'FDU — канальний високого тиску'),
    ('mhi-fdum',    'mhi', 114, 3152, 'FDUM — канальний середнього тиску (напівпром і мульти — один виріб)'),
    ('semi-srk',    'mhi', 122, 3232, 'SRK — настінний (напівпром)'),
    ('mhi-fde',     'mhi', 57, 1810, 'FDE-VH — підстельовий (напівпром і мульти). Фото на стор. 126 стоїть на сірому тлі — не вирізається'),
    ('semi-fdf',    'mhi', 132, 3350, 'FDF — колонний (x3345 на тлі магазину — не вирізається, взято чистий x3350)'),
    # ---- Galactic: каталог cat_Galactic.pdf ----
    ('gal-infini',  'gal', 11, 246, 'Infini (SH-W)'),
    ('gal-proxima', 'gal', 13, 270, 'Proxima (M-W)'),
    ('gal-vega',    'gal', 15, 296, 'Vega (A-W)'),
    ('gal-freespace', 'gal', 17, 320, 'Free Space — внутрішній блок мульти (M-W)'),
    ('gal-gdz',     'gal', 29, 643, 'GDZ — канальний'),
    ('gal-gbz',     'gal', 35, 729, 'GBZ — касетний'),
    ('gal-gfz',     'gal', 39, 780, 'GFZ — підлогово-стельовий'),
    # ---- Galactic: galactic.ua (немає в каталозі) ----
    ('gal-orient',  'site', 'orient.jpg', None, 'Orient (HF-S, R410A) — внутрішній блок зверху композиції на сайті',
     (0, 0, 1890, 790), 'https://galactic.ua/wp-content/uploads/2020/07/orient.jpg'),
    ('gal-multi',  'site', 'r32-multi.jpg', None, 'Мульти (H-W R32, H-S R410A) — верхній внутрішній блок композиції на сайті; у R32 і R410A він той самий',
     (80, 0, 300, 138), 'https://galactic.ua/wp-content/uploads/2021/07/r32-multi.jpg'),
]


def from_pdf(doc, xref):
    """Вбудоване зображення → (RGBA|RGB, є_власна_маска, info)."""
    info = doc.extract_image(xref)
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:                      # CMYK → RGB
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    sm = info.get('smask') or 0
    if sm:
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, sm))
    im = Image.open(io.BytesIO(pix.tobytes('png')))
    return (im.convert('RGBA'), True, info) if sm else (im.convert('RGB'), False, info)


def cutout(im, thr=4):
    """RGB на білому тлі → RGBA з маскою по самому зображенню."""
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    white = (255 - a.min(axis=2)) <= thr
    lab, _ = ndi.label(white)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    obj = ~np.isin(lab, edge[edge > 0])              # все, що не є тлом, зв'язаним з краєм
    obj = ndi.binary_fill_holes(obj)
    obj = ndi.binary_opening(obj, iterations=1)
    lab2, n2 = ndi.label(obj)
    if n2 > 1:                                        # лишаємо лише сам блок
        sizes = ndi.sum(obj, lab2, range(1, n2 + 1))
        obj = lab2 == (1 + int(np.argmax(sizes)))
    soft = ndi.gaussian_filter(ndi.binary_erosion(obj, iterations=1).astype(np.float32), 0.9)
    alpha = np.clip(soft * 1.15, 0, 1)
    return Image.fromarray(np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)]), 'RGBA')


def trim(im):
    box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(box) if box else im


def main():
    args = sys.argv[1:]
    only = None
    if args and args[0] == '--only':
        only = set(args[1].split(','))
    os.makedirs(OUT, exist_ok=True)
    docs = {}
    src_path = os.path.join(OUT, '_source.json')
    report = {'files': {}}
    if os.path.exists(src_path):
        with open(src_path, encoding='utf-8') as f:
            report['files'] = json.load(f).get('files', {})
    for row in PHOTOS:
        name, kind, where, xref, what = row[:5]
        if only and name not in only:
            continue
        meta = {'source': kind, 'what': what}
        if kind == 'site':
            crop, url = row[5], row[6]
            im = Image.open(os.path.join(SITE_DIR, where)).convert('RGB').crop(crop)
            own_alpha = False
            meta.update({'file': where, 'url': url, 'crop': list(crop), 'src_px': list(im.size)})
        else:
            if kind not in docs:
                docs[kind] = pymupdf.open(CATALOGS[kind])
            doc = docs[kind]
            if xref not in {i['xref'] for i in doc[where - 1].get_image_info(xrefs=True)}:
                sys.exit('СТОП: зображення xref=%d немає на стор. %d (%s) — каталог інший?' % (xref, where, name))
            im, own_alpha, info = from_pdf(doc, xref)
            meta.update({'catalog': os.path.basename(CATALOGS[kind]), 'page': where, 'xref': xref,
                         'src_px': [info['width'], info['height']]})
        out = trim(im if own_alpha else cutout(im))
        if out.width > OUT_W:
            out = out.resize((OUT_W, round(out.height * OUT_W / out.width)), Image.LANCZOS)
        path = os.path.join(OUT, name + '.webp')
        out.save(path, 'WEBP', quality=88, method=6)
        meta.update({'out_px': list(out.size), 'bytes': os.path.getsize(path),
                     'mask': 'з PDF' if own_alpha else 'з зображення'})
        report['files'][name] = meta
        print('%-14s %-4s %-9s -> %3dx%-3d %5d B  %s' % (name, kind, where, out.width, out.height,
                                                         os.path.getsize(path), what))
    with open(src_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
