"""Піднімає версію застосунку РАЗОМ у всіх місцях, де вона мусить збігатися.

Навіщо: з 2026-10-08 код живе в js/*.js, які кешуються «спершу кеш». Якщо не
підняти ?v=, телефон (і браузер) візьме старий файл — а index.html буде новий.
Суміш версій ламає застосунок непередбачувано.

Міняє:
  • const APP_BUILD = '…'            у js/*.js
  • ?v=…  у всіх <script src="js/…"> у index.html
  • ?v=…  у списку APP_SHELL         у sw.js

Запуск із кореня репозиторію:
    python claude/split-index/set-build.py 2026-10-08.2
"""
import sys, os, re, glob

if len(sys.argv) != 2:
    sys.exit('вкажіть нову версію, напр.: python claude/split-index/set-build.py 2026-10-08.2')

new = sys.argv[1]
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', new):
    sys.exit('версія має бути у вигляді РРРР-ММ-ДД.N, напр. 2026-10-08.2')

root = os.getcwd()
changed = []

# 1. APP_BUILD у модулях
hits = 0
for path in glob.glob(os.path.join(root, 'js', '*.js')):
    raw = open(path, 'rb').read()
    out, n = re.subn(rb"const APP_BUILD = '[^']*'",
                     b"const APP_BUILD = '" + new.encode() + b"'", raw)
    if n:
        open(path, 'wb').write(out)
        changed.append('%s (APP_BUILD x%d)' % (os.path.basename(path), n))
        hits += n
if hits != 1:
    sys.exit('ПОМИЛКА: APP_BUILD знайдено %d разів, очікувалось рівно 1' % hits)

# 2. ?v= у тегах index.html
raw = open(os.path.join(root, 'index.html'), 'rb').read()
out, n = re.subn(rb'(<script src="js/[0-9A-Za-z._-]+\?v=)[^"]*(")',
                 lambda m: m.group(1) + new.encode() + m.group(2), raw)
if n == 0:
    sys.exit('ПОМИЛКА: у index.html не знайдено жодного <script src="js/…?v=…">')
open(os.path.join(root, 'index.html'), 'wb').write(out)
changed.append('index.html (тегів: %d)' % n)
tags = n

# 3. ?v= у APP_SHELL сервіс-воркера
sw = os.path.join(root, 'sw.js')
raw = open(sw, 'rb').read()
out, n2 = re.subn(rb"('js/[0-9A-Za-z._-]+\?v=)[^']*(')",
                  lambda m: m.group(1) + new.encode() + m.group(2), raw)
if n2:
    open(sw, 'wb').write(out)
changed.append('sw.js (записів: %d)' % n2)

# 4. список плиток у sw.js — перегенеровується з вмісту папки, щоб він не розійшовся
#    з реальними файлами, коли плитки додають або прибирають
imgs = sorted(os.path.basename(p) for p in glob.glob(os.path.join(root, 'tile-images', '*'))
              if p.lower().endswith(('.webp', '.svg', '.png', '.jpg', '.jpeg')))
raw = open(sw, 'rb').read().decode('utf-8')
block = '\n'.join("    'tile-images/%s'%s" % (n, ',' if i < len(imgs) - 1 else '')
                  for i, n in enumerate(imgs))
new_raw, n3 = re.subn(
    r'(/\* TILE-IMAGES-START \*/\r?\n).*?(\r?\n\s*/\* TILE-IMAGES-END \*/)',
    lambda m: m.group(1) + block + m.group(2),
    raw, flags=re.S)
if n3:
    eol = '\r\n' if '\r\n' in raw else '\n'
    new_raw = new_raw.replace('\r\n', '\n').replace('\n', eol)
    open(sw, 'wb').write(new_raw.encode('utf-8'))
    changed.append('sw.js (плиток у предзавантаженні: %d)' % len(imgs))
else:
    changed.append('sw.js: !! маркери TILE-IMAGES-START/END не знайдено, список НЕ оновлено')

print('версiя ->', new)
for c in changed:
    print('  ', c)
if n2 != tags:
    print('')
    print('  !! УВАГА: у index.html %d тегів, а в APP_SHELL sw.js %d записів.' % (tags, n2))
    print('     Вони мусять збігатися один в один, інакше офлайн застосунок не підніметься.')
