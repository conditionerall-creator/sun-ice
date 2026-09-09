/* ETL v2: MHI RAC compatibility — тільки Compatibility of RAC_20260409_Customers.xlsx,
   тільки листи RAC і RAC MULTI, за скоригованим ТЗ (grammar + матчинг). */

const KNOWN_PREFIXES = ['FDTC', 'FDUM', 'FDEN', 'FDE', 'SRK', 'SRC', 'SRF', 'SRR', 'SKM', 'SCM']
  .sort((a, b) => b.length - a.length);
const RAC_CANON_SIZES = [20, 25, 35, 50, 60, 71, 80];

function normText(v) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
}

/* Розбирає ОДНЕ маркування (без переносів рядка — ті розбиваються раніше, на етапі
   splitMarkingLines). canonSizes — список типорозмірів для резолву діапазону "20-50";
   для RAC MULTI діапазони не трапляються, можна передати порожній список. */
function parseMarking(raw, canonSizes) {
  canonSizes = canonSizes || RAC_CANON_SIZES;
  let s = raw;
  let hasR32Annotation = false;
  const r32m = s.match(/\(\s*R\s*32\s*\)/i);
  if (r32m) { hasR32Annotation = true; s = s.slice(0, r32m.index) + s.slice(r32m.index + r32m[0].length); }
  const deprecated = /☆/.test(s);
  s = s.replace(/[※☆]/g, '').replace(/\s+/g, '').toUpperCase();

  const prefix = KNOWN_PREFIXES.find(p => s.startsWith(p));
  if (!prefix) return { raw, error: 'unknown-prefix', rawPrefixGuess: (s.match(/^[A-Z]+/) || [''])[0], hasR32Annotation, deprecated };
  let rest = s.slice(prefix.length);

  let sizeKind = 'wildcard', sizeList = null;
  if (/^(\.{2,}|…)\.?/.test(rest)) {
    rest = rest.replace(/^(\.{2,}|…)\.?/, '');
  } else if (rest.startsWith('-') && /^[A-Z]/.test(rest.slice(1))) {
    rest = rest.slice(1); // "-ZT-WF" style — типорозмір відсутній = будь-який
  } else {
    const numM = rest.match(/^(\d+(?:[,~.\-]\d+)*)/);
    if (numM) {
      const numStr = numM[0];
      rest = rest.slice(numStr.length);
      if (numStr.includes('-') || numStr.includes('~')) {
        const parts = numStr.split(/[-~]/).map(Number);
        const min = Math.min(...parts), max = Math.max(...parts);
        sizeKind = 'list';
        sizeList = canonSizes.filter(n => n >= min && n <= max); // діапазон = зріз канонічного списку, НЕ суцільний інтервал
      } else if (numStr.includes(',') || numStr.includes('.')) {
        sizeKind = 'list';
        sizeList = numStr.split(/[,.]/).map(Number);
      } else {
        sizeKind = 'list';
        sizeList = [Number(numStr)];
      }
    }
    // якщо чисел немає взагалі (рідкісний випадок) — лишаємо wildcard, як і за "…"
  }

  const dashIdx = rest.indexOf('-');
  let series, suffixVariants;
  if (dashIdx === -1) { series = rest; suffixVariants = null; } // немає суфіксу фреону в маркуванні взагалі
  else { series = rest.slice(0, dashIdx); suffixVariants = rest.slice(dashIdx + 1).split(',').map(x => x.trim()).filter(Boolean); }
  if (!series) return { raw, error: 'no-series', prefix, hasR32Annotation, deprecated };

  // Похідний фреон: W-суфікс (будь-який W...) = R32, S-суфікс (будь-який S...) = R410A.
  // (R32) в дужках ІГНОРУЄТЬСЯ, якщо суфікс уже це каже (redundant, п.2.4.1); якщо
  // суфіксу немає взагалі, але є (R32) — це єдине джерело інформації про фреон,
  // трактуємо як віртуальний W-суфікс (п.2.4.2); якщо немає ні суфіксу, ні (R32) —
  // фреон для цієї лінійки в маркуванні просто не закодований (п.2.4.3).
  let suffixFamily = null;
  if (suffixVariants && suffixVariants.length) {
    suffixFamily = suffixVariants[0][0] === 'S' ? 'S' : (suffixVariants[0][0] === 'W' ? 'W' : null);
  } else if (hasR32Annotation) {
    suffixFamily = 'W';
  }

  return { raw, prefix, sizeKind, sizeList, series, suffixVariants, suffixFamily, hasR32Annotation, deprecated };
}

/* Розбиває вміст ОДНІЄЇ клітинки заголовка на альтернативні маркування (перенос
   рядка = "або"), АЛЕ відокремлює рядки-виноски (починаються з ※ і є повним
   реченням, не просто маркером) від реальних альтернативних маркувань — вони
   повертаються окремо як footnoteText, а не намагаються парситись як маркування. */
function splitMarkingLines(cellText) {
  const norm = normText(cellText);
  if (!norm) return { lines: [], footnoteText: null };
  const rawLines = norm.split('\n').map(l => l.trim()).filter(Boolean);
  const lines = [];
  let footnoteText = null;
  rawLines.forEach(line => {
    if (/^\(R\s*32\)$/i.test(line) || /^\(☆\)$/.test(line)) {
      // одинокий "(R32)"/"(☆)" — перенесений хвіст попереднього рядка (word-wrap), не окремий рядок
      if (lines.length) lines[lines.length - 1] += ' ' + line;
      return;
    }
    if (line.startsWith('※') && line.length > 3) {
      // повне речення-виноска всередині клітинки (RAC MULTI: "※15 class is WiFi mode (WF) only.")
      footnoteText = line.replace(/^※\s*/, '');
      return;
    }
    lines.push(line);
  });
  return { lines, footnoteText };
}

/* Рідкісний виняток у RAC MULTI: "FDTC-VD,VF" в ОДНОМУ рядку (без переносу, на
   відміну від того ж випадку на листі RAC, де "VD"/"VF" — окремі рядки) — кома тут
   насправді розділяє дві альтернативні серії, а не є частиною однієї серії. Якщо
   суфіксу немає взагалі (дефіса після серії не знайдено) і серія містить кому —
   розбиваємо на кілька окремих варіантів.
   КРИТИЧНО: raw для кожного варіанта треба ПЕРЕБУДУВАТИ з нуля (prefix+розмір+нова
   серія+суфікс), а НЕ дописувати "[VD]" до старого raw — компактний JSON зберігає
   тільки raw-текст, рантайм повторно розбирає САМЕ його через parseMhiMarking(), а
   квадратні дужки не частина граматики маркувань: "FDTC25VD,VF [VD]" при повторному
   розборі дає серію "VD,VF[VD]" замість "VD" — зіставлення з таким текстом ніколи
   не спрацює (знайдено живцем: FDTC25VD/SCM40ZM-S показувало "немає даних" попри
   реальний ◎ в таблиці). */
function expandMarkingAlternates(parsed) {
  if (parsed.error || parsed.suffixVariants !== null || !parsed.series.includes(',')) return [parsed];
  const sizePart = parsed.sizeKind === 'wildcard' ? '' : (parsed.sizeList || []).join(',');
  return parsed.series.split(',').map(s => {
    const series = s.trim();
    const raw = parsed.prefix + sizePart + series + (parsed.hasR32Annotation ? ' (R32)' : '');
    return Object.assign({}, parsed, { series, raw });
  });
}

function parseHeaderCell(cellText, canonSizes) {
  const { lines, footnoteText } = splitMarkingLines(cellText);
  const patterns = lines.flatMap(l => expandMarkingAlternates(parseMarking(l, canonSizes)));
  return { patterns, footnoteText };
}

/* Значення клітинки-результату: звичайний символ АБО комбінація "символ(підмодель)
   символ(підмодель)..." коли колонка об'єднує кілька альтернативних маркувань
   (наприклад "〇(VD) ◎(VF)"). Повертає або {kind:'simple', status} або
   {kind:'bysubmodel', map:{VD:'conditional', VF:'recommended'}}. */
function parseResultCell(raw) {
  const t = normText(raw);
  if (!t) return { kind: 'simple', status: 'incompatible', raw: t };
  const bracketRe = /([◎〇])\((?!\*)([^)]+)\)/g; // (?!\*) — не плутати з номером виноски "〇(*3)"
  let m, found = false;
  const map = {};
  while ((m = bracketRe.exec(t))) {
    found = true;
    const status = m[1] === '◎' ? 'recommended' : 'conditional';
    m[2].split(',').map(x => x.trim()).forEach(code => { map[code] = status; });
  }
  if (found) return { kind: 'bysubmodel', map, raw: t };
  return { kind: 'simple', status: symbolToStatus(t), raw: t };
}

function symbolToStatus(t) {
  if (!t || t === '-' || /^N\/A$/i.test(t)) return 'incompatible';
  if (t.includes('◎')) return 'recommended';
  if (t.includes('〇')) return 'conditional';
  if (/^Yes\b/i.test(t)) return 'recommended';
  if (/^No\b/i.test(t)) return 'incompatible';
  return 'other';
}

function footnoteNumsIn(text) {
  const nums = [];
  const re = /\(\*(\d+)\)/g;
  let m;
  while ((m = re.exec(text))) nums.push(m[1]);
  return nums;
}

/* Нумеровані виноски (*N) — глобальний скан аркуша (текст може зсунутись при
   оновленні файлу, координати не хардкодимо). */
function collectNumberedFootnotes(rows) {
  const map = {};
  rows.forEach(row => (row || []).forEach(cell => {
    const t = normText(cell);
    const m = t.match(/^\(\*(\d+)\)\s*(.*)$/s);
    if (m && m[2].trim()) {
      const n = m[1], text = m[2].trim();
      if (!map[n] || text.length > map[n].length) map[n] = text;
    }
  }));
  return map;
}

/* Нативні Excel-коментарі до клітинок (SheetJS читає їх сам, без спецопцій, у
   властивість .c кожної клітинки листа). Повертає мапу "A1"-адреса -> текст. */
function collectCellComments(sheet) {
  const map = {};
  for (const addr in sheet) {
    if (addr[0] === '!') continue;
    const cell = sheet[addr];
    if (cell && cell.c && cell.c.length) {
      map[addr] = cell.c.map(c => String(c.t || '').replace(/^[^:]*:\s*/, '').trim()).filter(Boolean).join(' ');
    }
  }
  return map;
}

function colToA1(col) { // 0-indexed -> "A","B",..."AA"...
  let s = '';
  col += 1;
  while (col > 0) { const r = (col - 1) % 26; s = String.fromCharCode(65 + r) + s; col = Math.floor((col - 1) / 26); }
  return s;
}

function buildRacRules(wb) {
  const sheetName = 'RAC';
  const sheetObj = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheetObj, { header: 1, defval: '' });
  const footnotes = collectNumberedFootnotes(rows);
  const comments = collectCellComments(sheetObj);

  const headerRowIdx = 5, footnoteRowAbove = 4, dataStart = 6, dataEnd = 28, indoorColStart = 2;
  const headerRow = rows[headerRowIdx] || [];
  const aboveRow = rows[footnoteRowAbove] || [];

  const indoorByCol = {};
  for (let c = indoorColStart; c < headerRow.length; c++) {
    const parsed = parseHeaderCell(headerRow[c], RAC_CANON_SIZES);
    if (!parsed.patterns.length) continue;
    // виноска може бути в самій клітинці (footnoteText) АБО текстом у рядку НАД заголовком
    // (той самий стовпець) — обидва варіанти зустрічаються в файлі (див. ТЗ 3.3).
    const aboveText = normText(aboveRow[c]);
    const aboveFootnote = aboveText.startsWith('※') ? aboveText.replace(/^※\s*/, '') : null;
    indoorByCol[c] = { patterns: parsed.patterns, footnoteText: parsed.footnoteText || aboveFootnote || null };
  }

  const rules = [];
  const facts = [];
  const unparsed = [];

  for (let r = dataStart; r <= dataEnd; r++) {
    const row = rows[r] || [];
    const outdoorRaw = normText(row[1]);
    if (!outdoorRaw) continue;
    const outdoorParsed = parseHeaderCell(outdoorRaw, RAC_CANON_SIZES);
    if (!outdoorParsed.patterns.length) continue;

    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const cellRaw = row[c];
      const resultCell = parseResultCell(cellRaw); // порожня клітинка й "-" обидві дають status:'incompatible' (реальна знайдена пара)
      const nums = footnoteNumsIn(normText(cellRaw));
      const cellFootnotes = nums.map(n => footnotes[n]).filter(Boolean);
      // +1: аркуш фактично починається зі стовпця B (!ref="B1:AL43"), sheet_to_json
      // НЕ доповнює пропущений стовпець A — індекс масиву зсунутий на 1 відносно
      // реальної адреси Excel.
      const commentAddr = colToA1(c + 1) + String(r + 1);
      if (comments[commentAddr]) cellFootnotes.push(comments[commentAddr]);

      outdoorParsed.patterns.forEach(outdoorPattern => {
        if (outdoorPattern.error) { unparsed.push({ where: 'outdoor', raw: outdoorPattern.raw, error: outdoorPattern.error }); return; }
        indoorByCol[c].patterns.forEach(indoorPattern => {
          if (indoorPattern.error) { unparsed.push({ where: 'indoor', raw: indoorPattern.raw, error: indoorPattern.error }); return; }
          let status;
          if (resultCell.kind === 'bysubmodel') {
            status = resultCell.map[indoorPattern.series] || null;
            if (!status) return; // ця конкретна підмодель не згадана в комбінованій клітинці — немає правила
          } else {
            status = resultCell.status;
          }
          const fnAll = cellFootnotes.slice();
          if (indoorByCol[c].footnoteText) fnAll.push(indoorByCol[c].footnoteText);
          rules.push({
            indoor: indoorPattern, outdoor: outdoorPattern, status, statusRaw: resultCell.raw,
            footnotes: fnAll.length ? [...new Set(fnAll)] : null
          });
        });
      });
    });
  }

  // Compatibility for PAC (рядки 30-35, ті самі колонки-заголовки, факти про indoor-код).
  // Мітка в стовпці B — часто ДВА рядки (напр. "SC-BIKN2-E necessity" + окремим рядком
  // "(For connecting with RC-E3, E4, E5, RC-EX1,...)") — раніше бралась лише перша
  // (через це дві різні "SC-BIKN2-BL necessity" з різним переліком конекторів виглядали
  // в застосунку однаково) — тепер обидва рядки об'єднуються в один текст, повний сенс
  // не губиться.
  for (let r = 29; r <= 34; r++) {
    const row = rows[r] || [];
    const label = normText(row[1]).split('\n').map(s => s.trim()).filter(Boolean).join(' ').replace(/\s+\)/g, ')');
    if (!label) continue;
    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const v = normText(row[c]);
      if (!v || v === '-') return;
      indoorByCol[c].patterns.forEach(indoorPattern => {
        if (indoorPattern.error) return;
        facts.push({ type: label, indoor: indoorPattern, value: v });
      });
    });
  }

  return { rules, facts, unparsed, sheetName };
}

function buildMultiRules(wb) {
  const sheetName = 'RAC MULTI';
  const sheetObj = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheetObj, { header: 1, defval: '' });
  const nameRowIdx = 5, capRowIdx = 6, dataStart = 7, dataEnd = 30, indoorColStart = 1;
  const nameRow = rows[nameRowIdx] || [];
  const capRow = rows[capRowIdx] || [];
  const merges = (sheetObj['!merges'] || []).filter(m => m.s.r === nameRowIdx);
  const nameForCol = {};
  for (let c = indoorColStart; c < nameRow.length; c++) nameForCol[c] = normText(nameRow[c]);
  merges.forEach(m => {
    // Зазвичай текст лежить у лівій верхній (m.s.c) клітинці об'єднання, але в цьому
    // файлі трапляється виняток (стовпці 9-12, текст фактично в 12-й, а не в 9-й) —
    // тому скануємо весь діапазон об'єднання й беремо перше НЕпорожнє значення,
    // а не сліпо довіряємо m.s.c.
    let label = '';
    for (let c = m.s.c; c <= m.e.c; c++) { const v = normText(nameRow[c]); if (v) { label = v; break; } }
    for (let c = m.s.c; c <= m.e.c; c++) nameForCol[c] = label;
  });

  const indoorByCol = {};
  const unparsed = [];
  for (let c = indoorColStart; c < nameRow.length; c++) {
    const name = nameForCol[c];
    if (!name) continue;
    const capRawFull = normText(capRow[c]);
    const capNumM = capRawFull.match(/\d+/);
    if (!capNumM) continue;
    const capNum = Number(capNumM[0]);
    const { lines, footnoteText } = splitMarkingLines(name);
    let prevLine = null;
    const patterns = [];
    lines.forEach(line => {
      if (line.startsWith(',') && prevLine) {
        const prefixM = prevLine.match(/^([A-Z]+-?)/i);
        if (prefixM) line = prefixM[1] + line.replace(/^,-?/, '');
      }
      prevLine = line;
      const p = parseMarking(line, []);
      if (p.error) { unparsed.push({ where: 'indoor(multi)', raw: line, error: p.error }); return; }
      p.sizeKind = 'list'; p.sizeList = [capNum]; // ін'єктуємо конкретний типорозмір зі строки 7
      // КРИТИЧНО: сам текст заголовка (рядок 6) типорозміру не містить — він живе
      // ОКРЕМО в рядку 7 (capRow). Якщо лишити p.raw як є ("SRK-ZM-S"), компактний
      // експорт JSON (тільки raw-текст i/o) втратить typorozmir — рантайм-парсер,
      // повторно розбираючи "SRK-ZM-S", знову дасть wildcard-розмір, і всі 4
      // колонки одного typorazmiru-ряду (20/25/35/50) стануть нерозрізненими
      // дублікатами з однаковим текстом і РІЗНИМ статусом — матчер тоді вибирає
      // довільну з них, а не ту, що відповідає введеному розміру. Тому "запікаємо"
      // типорозмір прямо в текст перед збереженням.
      p.raw = p.prefix + capNum + p.series + (p.suffixVariants && p.suffixVariants.length ? '-' + p.suffixVariants.join(',') : '') + (p.hasR32Annotation ? ' (R32)' : '');
      expandMarkingAlternates(p).forEach(pp => patterns.push(pp));
    });
    indoorByCol[c] = { patterns, footnoteText };
  }

  const rules = [];
  for (let r = dataStart; r <= dataEnd; r++) {
    const row = rows[r] || [];
    const outdoorRaw = normText(row[0]);
    if (!outdoorRaw) continue;
    const outdoorPattern = parseMarking(outdoorRaw, []);
    if (outdoorPattern.error) { unparsed.push({ where: 'outdoor(multi)', raw: outdoorRaw, error: outdoorPattern.error }); continue; }
    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const cellRaw = row[c];
      const status = symbolToStatus(normText(cellRaw)); // порожня клітинка й "-" обидві -> incompatible, як і на RAC
      indoorByCol[c].patterns.forEach(indoorPattern => {
        rules.push({
          indoor: indoorPattern, outdoor: outdoorPattern, status, statusRaw: normText(cellRaw) || '-',
          footnotes: indoorByCol[c].footnoteText ? [indoorByCol[c].footnoteText] : null
        });
      });
    });
  }
  return { rules, facts: [], unparsed, sheetName };
}

/* ---------- Matcher (працює і тут для тестів, і буде перенесений у index.html) ---------- */

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[m][n];
}

function closestPrefix(guess, candidates) {
  let best = null, bestDist = Infinity;
  candidates.forEach(p => { const d = levenshtein(guess, p); if (d < bestDist) { bestDist = d; best = p; } });
  return { prefix: best, distance: bestDist };
}

const INDOOR_PREFIXES = KNOWN_PREFIXES.filter(p => p !== 'SRC' && p !== 'SCM');
const OUTDOOR_PREFIXES = ['SRC', 'SCM'];

/* Розбирає ввід користувача, з толерантністю до одруківки в префіксі (Левенштейн,
   якщо точного префіксу серед відомих не знайдено). */
function parseUserInput(raw, role) {
  const p = parseMarking(raw, RAC_CANON_SIZES);
  if (!p.error) return { parsed: p, typo: null };
  if (p.error === 'unknown-prefix' && p.rawPrefixGuess) {
    const candidates = role === 'outdoor' ? OUTDOOR_PREFIXES : INDOOR_PREFIXES;
    const { prefix, distance } = closestPrefix(p.rawPrefixGuess, candidates);
    if (prefix && distance <= 2) {
      const corrected = prefix + raw.slice(raw.toUpperCase().indexOf(p.rawPrefixGuess) + p.rawPrefixGuess.length);
      const p2 = parseMarking(corrected, RAC_CANON_SIZES);
      if (!p2.error) return { parsed: p2, typo: { from: p.rawPrefixGuess, to: prefix } };
    }
  }
  return { parsed: p, typo: null };
}

function suffixCoreMatch(userSuffixText, templateVariants) {
  if (!templateVariants) return { matched: null, extra: userSuffixText || null, noTemplateSuffix: true };
  if (!userSuffixText) return null;
  let best = null;
  templateVariants.forEach(v => { if (userSuffixText.startsWith(v) && (!best || v.length > best.length)) best = v; });
  if (!best) return null;
  return { matched: best, extra: userSuffixText.slice(best.length) || null };
}

function templateAcceptsSize(template, size) {
  if (template.sizeKind === 'wildcard') return true;
  if (size == null) return true;
  return template.sizeList.includes(size);
}

function candidateMatches(userInput, template) {
  if (userInput.prefix !== template.prefix) return null;
  if (userInput.series !== template.series) return null;
  if (!templateAcceptsSize(template, userInput.sizeList ? userInput.sizeList[0] : null)) return null;
  const userSuffixText = userInput.suffixVariants ? userInput.suffixVariants[0] : null;
  const sc = suffixCoreMatch(userSuffixText, template.suffixVariants);
  if (!sc) return null;
  if (!sc.noTemplateSuffix && template.suffixFamily && userInput.suffixFamily && template.suffixFamily !== userInput.suffixFamily) return null;
  return sc;
}

/* Той самий збіг, що й candidateMatches, але БЕЗ перевірки типорозміру — для
   листа RAC MULTI: один зовнішній блок живить кілька внутрішніх різного розміру
   одночасно, тому типорозмір, який ввів користувач для внутрішнього блока, не
   звужує пошук — навпаки, показуємо ВСІ типорозміри цієї серії, сумісні саме з
   цим зовнішнім блоком. */
function candidateMatchesIgnoreSize(userInput, template) {
  if (userInput.prefix !== template.prefix) return null;
  if (userInput.series !== template.series) return null;
  const userSuffixText = userInput.suffixVariants ? userInput.suffixVariants[0] : null;
  const sc = suffixCoreMatch(userSuffixText, template.suffixVariants);
  if (!sc) return null;
  if (!sc.noTemplateSuffix && template.suffixFamily && userInput.suffixFamily && template.suffixFamily !== userInput.suffixFamily) return null;
  return sc;
}

function checkCompatibility(indoorRaw, outdoorRaw, data) {
  const outdoorProbe = parseMarking(outdoorRaw, RAC_CANON_SIZES);
  const indoorProbe = parseMarking(indoorRaw, RAC_CANON_SIZES);
  const sheet = (outdoorProbe.prefix === 'SCM' || indoorProbe.prefix === 'SCM') ? 'multi' : 'rac';

  const { parsed: indoorInput, typo: indoorTypo } = parseUserInput(indoorRaw, 'indoor');
  const { parsed: outdoorInput, typo: outdoorTypo } = parseUserInput(outdoorRaw, 'outdoor');

  if (indoorInput.error || outdoorInput.error) {
    return { kind: 'parse-error', badIndoor: !!indoorInput.error, badOutdoor: !!outdoorInput.error };
  }

  if (sheet === 'rac') {
    const iSize = indoorInput.sizeList ? indoorInput.sizeList[0] : null;
    const oSize = outdoorInput.sizeList ? outdoorInput.sizeList[0] : null;
    if (iSize != null && oSize != null && iSize !== oSize) {
      return { kind: 'size-mismatch', indoorSize: iSize, outdoorSize: oSize };
    }
  }

  const rules = sheet === 'multi' ? data.multi_rules : data.rac_rules;
  // На листі RAC внутрішній/зовнішній блок звіряються СУВОРО (включно з типо-
  // розміром — уже перевірено вище, що вони збігаються). На RAC MULTI типорозмір
  // внутрішнього блока навмисно ІГНОРУЄТЬСЯ: показуємо ВСІ типорозміри цієї серії,
  // сумісні саме з цим зовнішнім блоком, а не лише той один, що ввів користувач —
  // за прямою вимогою користувача: "прераховуєш маркування внутрішніх блоків
  // [цієї] серії та зовнішній блок. І все" (те, що буквально в клітинці таблиці).
  const indoorMatcher = sheet === 'multi' ? candidateMatchesIgnoreSize : candidateMatches;
  const hits = [];
  rules.forEach(rule => {
    const om = candidateMatches(outdoorInput, rule.outdoor);
    if (!om) return;
    const im = indoorMatcher(indoorInput, rule.indoor);
    if (!im) return;
    hits.push({ rule, indoorMatch: im, outdoorMatch: om });
  });

  if (!hits.length) return { kind: 'no-data', typoTried: !!(indoorTypo || outdoorTypo) };
  // Відповідь — це буквально перелік знайдених клітинок (rule.indoor/outdoor.raw),
  // згрупованих за статусом (◎/〇), без переформулювання чи вибору "найкращої" —
  // якщо та сама пара трапляється в кількох колонках з різним статусом (рідкісна
  // неоднозначність у самій таблиці MHI, напр. "FDUM-VF" 50 клас двічі в одному
  // merge), обидва записи просто потраплять кожен у свою групу.
  return { kind: 'found', hits, indoorTypo, outdoorTypo, sheet };
}

function buildAllV2() {
  const rac = buildRacRules(wb2026);
  const multi = buildMultiRules(wb2026);
  return {
    rac_rules: rac.rules, rac_facts: rac.facts, rac_unparsed: rac.unparsed,
    multi_rules: multi.rules, multi_unparsed: multi.unparsed
  };
}
