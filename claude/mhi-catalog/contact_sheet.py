#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Контактний аркуш: усі вбудовані зображення сторінок PDF-каталогу — підписані (сторінка, xref, розмір).

Навіщо: щоб ОКОМ вибрати потрібне фото виробу, а не гадати за номером. Працює з будь-яким каталогом.
Підписи на аркуші — це ті самі page/xref, що йдуть у PHOTOS скрипта build_group_images.py.

Запуск:
  python claude/mhi-catalog/contact_sheet.py <каталог.pdf> <перша> <остання> <вихід.png> [колонок] [мін. ширина pt]
  напр.:  python claude/mhi-catalog/contact_sheet.py "D:/.../catalog-mhi-rac-pac.pdf" 34 52 sheet.png 6 60
Потрібно: pip install "pymupdf<2" pillow   (pymupdf 2.x на Python 3.14 падає в segfault — ставити 1.x).

Читання аркуша: темні плями без виробу — це ТІНІ (окремі зображення з маскою), їх не брати. Фото на тлі
інтер'єру не вирізається маскою (див. ВИРІЗКА-ФОТО-З-КАТАЛОГУ.md) — шукати чистий знімок того ж виробу.
"""
import io
import sys

import pymupdf
from PIL import Image, ImageDraw


def load(doc, xref):
    info = doc.extract_image(xref)
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    if info.get('smask'):
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, info['smask']))
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')


def sheet(doc, pages, out, cols=6, cell=200, minw=45):
    items = []
    for pn in pages:
        seen = set()
        for im in doc[pn - 1].get_image_info(xrefs=True):
            x0, y0, x1, y1 = im['bbox']
            w, h = x1 - x0, y1 - y0
            if im['xref'] in seen or not im['xref'] or w < minw or h < 25 or im['width'] < 150:
                continue
            if h > 300 and y0 < 5:                      # фон «кімната» на всю висоту
                continue
            seen.add(im['xref'])
            items.append((pn, im['xref'], w, h))
    rows = (len(items) + cols - 1) // cols
    sh = Image.new('RGB', (cols * cell, rows * (cell + 34)), (200, 205, 215))
    dr = ImageDraw.Draw(sh)
    for i, (pn, x, w, h) in enumerate(items):
        try:
            im = load(doc, x)
        except Exception:
            continue
        im.thumbnail((cell - 10, cell - 10))
        cx, cy = (i % cols) * cell, (i // cols) * (cell + 34)
        sh.paste(im, (cx + 5, cy + 5), im)
        dr.text((cx + 5, cy + cell - 2), 'p%d x%d %dx%dpt' % (pn, x, round(w), round(h)), fill=(0, 0, 0))
    sh.save(out)
    print(out, len(items), 'зображень')


if __name__ == '__main__':
    a = sys.argv
    if len(a) < 5:
        sys.exit(__doc__)
    sheet(pymupdf.open(a[1]), list(range(int(a[2]), int(a[3]) + 1)), a[4],
          cols=int(a[5]) if len(a) > 5 else 6, minw=float(a[6]) if len(a) > 6 else 45)
