# -*- coding: utf-8 -*-
"""Читання сторінки PDF як сітки слів із координатами.

Чому не `pdftotext -layout`: для каталогу MHI воно зсуває підписи й значення на
один-два рядки (перевірено на стор. 34 — «Електроживлення 2.0 (0.9-3.4)» насправді
є холодопродуктивністю). Єдиний надійний шлях — брати координати кожного слова й
збирати рядки самому.

Потрібен pdftotext З POPPLER (у xpdf-збірки немає -bbox-layout). Шлях шукаємо
самі, бо в PATH на машині власника лежить саме xpdf.
"""

import os
import re
import glob
import subprocess
import unicodedata

_POPPLER_HINTS = [
    os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-*\Library\bin'),
    r'C:\Program Files\poppler\Library\bin',
]


def poppler_tool(name):
    """Повний шлях до утиліти poppler ('pdftotext' / 'pdftoppm')."""
    for pat in _POPPLER_HINTS:
        for d in glob.glob(pat):
            exe = os.path.join(d, name + '.exe')
            if os.path.exists(exe):
                return exe
    # Остання надія: у PATH. Перевіряємо, що це саме poppler, а не xpdf.
    try:
        out = subprocess.run([name, '-v'], capture_output=True, text=True, timeout=20)
        if 'poppler' in (out.stdout + out.stderr).lower():
            return name
    except Exception:
        pass
    raise RuntimeError(
        'Не знайдено %s із poppler. Постав poppler або впиши шлях у _POPPLER_HINTS.' % name)


_WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')

_ENT = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'"}


def _unescape(s):
    for k, v in _ENT.items():
        s = s.replace(k, v)
    return s


class Word(object):
    __slots__ = ('x0', 'y0', 'x1', 'y1', 'text')

    def __init__(self, x0, y0, x1, y1, text):
        self.x0, self.y0, self.x1, self.y1, self.text = x0, y0, x1, y1, text

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2.0

    def __repr__(self):
        return 'Word(%.1f,%.1f,%r)' % (self.x0, self.y0, self.text)


def page_words(pdf_path, page):
    """Усі слова сторінки з координатами, відсортовані зверху вниз, зліва направо."""
    exe = poppler_tool('pdftotext')
    out = subprocess.run(
        [exe, '-f', str(page), '-l', str(page), '-bbox-layout', pdf_path, '-'],
        capture_output=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError('pdftotext впав: ' + out.stderr.decode('utf-8', 'replace')[:400])
    xml = out.stdout.decode('utf-8', 'replace')
    words = []
    for m in _WORD_RE.finditer(xml):
        t = _unescape(m.group(5)).strip()
        if not t:
            continue
        words.append(Word(float(m.group(1)), float(m.group(2)),
                          float(m.group(3)), float(m.group(4)), t))
    words.sort(key=lambda w: (round(w.y0, 1), w.x0))
    return words


def render_page(pdf_path, page, out_prefix, dpi=200):
    """Сторінка в PNG — для обов'язкової звірки очима."""
    exe = poppler_tool('pdftoppm')
    subprocess.run([exe, '-f', str(page), '-l', str(page), '-r', str(dpi),
                    '-png', pdf_path, out_prefix], check=True, timeout=600)
    hits = sorted(glob.glob(out_prefix + '*.png'))
    return hits[-1] if hits else None


def group_rows(words, tol=3.0):
    """Слова в рядки за спільним діапазоном Y."""
    rows, cur = [], []
    for w in sorted(words, key=lambda w: (w.y0, w.x0)):
        if cur and w.y0 - cur[-1].y0 > tol:
            rows.append(sorted(cur, key=lambda w: w.x0))
            cur = []
        cur.append(w)
    if cur:
        rows.append(sorted(cur, key=lambda w: w.x0))
    return rows


def group_cells(words, gap=20.0):
    """Слова рядка в комірки за горизонтальними проміжками.

    Усередині комірки проміжки малі («38 / 31 / 24 / 19»), між комірками —
    великі. Поріг 20 pt перевірено на стор. 34: найменший міжкомірковий
    проміжок там ≈ 36 pt, найбільший внутрішній ≈ 13 pt.
    """
    cells, cur = [], []
    for w in sorted(words, key=lambda w: w.x0):
        if cur and w.x0 - cur[-1].x1 > gap:
            cells.append(cur)
            cur = []
        cur.append(w)
    if cur:
        cells.append(cur)
    return cells


def cell_text(cell):
    return ' '.join(w.text for w in cell).strip()


def cell_center(cell):
    return (cell[0].x0 + cell[-1].x1) / 2.0


def assign_spans(cells, col_centers, tol=6.0):
    """Розкласти комірки рядка по колонках, враховуючи об'єднані комірки.

    Об'єднана комірка відцентрована над своїм проміжком колонок, тому шукаємо
    розбиття колонок на стільки суцільних відрізків, скільки комірок, при якому
    центр кожного відрізка найкраще збігається з центром комірки.

    Повертає список довжин відрізків або None, якщо впевненого розбиття немає
    (тоді рядок іде в «сумнівні» і його дивиться людина).
    """
    n, k = len(col_centers), len(cells)
    if k == 0 or k > n:
        return None
    if k == n:
        return [1] * n

    best = [None]

    def span_center(a, b):
        return (col_centers[a] + col_centers[b]) / 2.0

    def walk(ci, start, err, acc):
        if ci == k:
            if start == n and (best[0] is None or err < best[0][0]):
                best[0] = (err, list(acc))
            return
        left = k - ci - 1                      # скільки комірок ще попереду
        for end in range(start, n - left):
            e = abs(span_center(start, end) - cell_center(cells[ci]))
            if best[0] is not None and err + e >= best[0][0]:
                continue
            acc.append(end - start + 1)
            walk(ci + 1, end + 1, err + e, acc)
            acc.pop()

    walk(0, 0, 0.0, [])
    if best[0] is None:
        return None
    err, spans = best[0]
    # Середня похибка центру більша за допуск — розкладка непевна.
    if err / k > tol:
        return None
    return spans


def norm_model(s):
    """Маркування до канонічного вигляду: верхній регістр, без пробілів і дефісів."""
    s = unicodedata.normalize('NFKC', s or '')
    return re.sub(r'[\s\-_]', '', s).upper()
