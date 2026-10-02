// Розбір файлу залишків з 1С для Edge Function stock-sync.
// Чиста логіка без мережі/БД: SheetJS (XLSX) передається ззовні, тож той самий код працює і в Deno
// (index.ts), і в Node-тесті (parse.test.mjs). Лише «стираний» TypeScript (без enum/namespace).
//
// Підтримує два види файлу:
//  1) звіт 1С «Аналіз доступності товарів на складах» (ієрархія Склад → Номенклатура, рядок складу
//     має рівень 0, рядки товарів — рівень 1; колонки шукаємо ЗА ЗАГОЛОВКАМИ, не за позиціями);
//  2) плоска таблиця (xlsx/csv): в одному рядку є і «Склад», і «Номенклатура», і кількості.
// Нічого не округлюємо і не «виправляємо» мовчки: усе підозріле йде в warnings/errors.

export type Row = { warehouse: string; item: string; physical: number; available: number };
export type Totals = { physical: number; available: number };
export type Parsed = {
  format: 'report' | 'flat';
  rows: Row[];
  generatedAt: Date | null;
  headerTotals: Record<string, Totals>; // підсумки складів із самого звіту — для звірки
  mismatches: string[]; // склади, де сума рядків ≠ підсумку складу у звіті
  errors: string[]; // некоректні рядки (не число тощо) — лічильник для порогу відхилення
  warnings: string[];
};

// Кирилічні «двійники» латинських літер. У прайсі трапляється `SRС50HE-S1` з кириличною «С».
const HOMOGLYPHS: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O', 'р': 'P', 'с': 'C', 'т': 'T', 'х': 'X',
};

// Ключ порівняння назви: верхній регістр, без пробілів/nbsp, кирилічні двійники → латиниця.
// ВАЖЛИВО: ця ж функція дослівно дублюється у stock.js (клієнт) — міняти обидві разом.
export function normKey(s: unknown): string {
  return String(s ?? '')
    .replace(/[\s ]+/g, '')
    .replace(/[АВЕКМНОРСТХавекмнорстх]/g, (ch) => HOMOGLYPHS[ch] ?? ch)
    .toUpperCase();
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return 0; // порожня клітинка = 0 (звіт 1С не друкує нулі)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// «02.10.2026 13:17:27» у київському часі → момент часу (UTC). Без залежності від TZ сервера.
export function kyivToDate(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const offsetAt = (t: number) => {
    const p: Record<string, string> = {};
    for (const x of fmt.formatToParts(new Date(t))) p[x.type] = x.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  const t0 = local - offsetAt(local);
  return new Date(local - offsetAt(t0));
}

function findGeneratedAt(aoa: unknown[][]): Date | null {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    for (const cell of aoa[i] || []) {
      const m = /Період:\s*на\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(cell ?? ''));
      if (m) return kyivToDate(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0));
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWorkbook(XLSX: any, bytes: Uint8Array): Parsed {
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true, codepage: 65001, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('У файлі немає аркушів');
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true });
  const rowMeta: Array<{ level?: number } | undefined> = ws['!rows'] || [];

  const out: Parsed = { format: 'report', rows: [], generatedAt: findGeneratedAt(aoa), headerTotals: {}, mismatches: [], errors: [], warnings: [] };

  // --- шукаємо рядок заголовків за назвами колонок ---
  let hdr = -1;
  let cWh = -1, cItem = -1, cPhys = -1, cFree = -1, cDate = -1;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const cells = (aoa[i] || []).map(norm);
    const wh = cells.indexOf('склад');
    const phys = cells.findIndex((c) => c === 'залишок' || c === 'всього');
    const free = cells.findIndex((c) => c === 'вільний залишок' || c === 'вільно');
    if (wh !== -1 && phys !== -1 && free !== -1) {
      hdr = i; cWh = wh; cPhys = phys; cFree = free;
      cItem = cells.findIndex((c) => c === 'номенклатура');
      cDate = cells.findIndex((c) => c === 'дата');
      break;
    }
  }
  if (hdr === -1) throw new Error('Не знайдено рядок заголовків (потрібні колонки: Склад, Залишок/Всього, Вільний залишок/Вільно)');

  if (cItem !== -1) {
    // ---------- плоский формат ----------
    out.format = 'flat';
    for (let i = hdr + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const wh = String(r[cWh] ?? '').trim();
      const item = String(r[cItem] ?? '').trim();
      if (!wh && !item) continue;
      if (!wh || !item) { out.errors.push(`рядок ${i + 1}: немає складу або номенклатури`); continue; }
      const p = toNum(r[cPhys]); const a = toNum(r[cFree]);
      if (p === null || a === null) { out.errors.push(`рядок ${i + 1}: «${item}» — кількість не число`); continue; }
      out.rows.push({ warehouse: wh, item, physical: p, available: a });
      if (!out.generatedAt && cDate !== -1 && r[cDate]) {
        const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(r[cDate]));
        if (m) out.generatedAt = kyivToDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
      }
    }
    return out;
  }

  // ---------- звіт 1С: склад (рівень 0) → товари (рівень 1) ----------
  const hasLevels = rowMeta.some((m) => m && (m.level ?? 0) > 0);
  if (!hasLevels) out.warnings.push('У файлі немає рівнів рядків — склад визначається за порожнім рядком перед ним');
  let wh: string | null = null;
  const sums: Record<string, Totals> = {};
  for (let i = hdr + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const name = String(r[cWh] ?? '').trim();
    if (!name) continue;
    if (norm(name) === 'номенклатура') continue; // другий рядок заголовка («У од. зберігання»)
    const isTotal = norm(name) === 'підсумок';
    const level = rowMeta[i]?.level ?? 0;
    const isWarehouse = hasLevels ? level === 0 : !((aoa[i - 1] || []).some((c) => c !== undefined && c !== null && c !== ''));
    const p = toNum(r[cPhys]); const a = toNum(r[cFree]);
    if (isTotal) break;
    if (isWarehouse) {
      wh = name;
      if (p !== null && a !== null) out.headerTotals[wh] = { physical: p, available: a };
      sums[wh] = { physical: 0, available: 0 };
      continue;
    }
    if (!wh) { out.errors.push(`рядок ${i + 1}: «${name}» стоїть до першого складу`); continue; }
    if (p === null || a === null) { out.errors.push(`рядок ${i + 1}: «${name}» — кількість не число`); continue; }
    out.rows.push({ warehouse: wh, item: name, physical: p, available: a });
    sums[wh].physical += p; sums[wh].available += a;
  }
  for (const [w, t] of Object.entries(out.headerTotals)) {
    const s = sums[w];
    if (s && (Math.abs(s.physical - t.physical) > 1e-9 || Math.abs(s.available - t.available) > 1e-9)) {
      out.mismatches.push(`${w}: у звіті ${t.physical}/${t.available}, сума рядків ${s.physical}/${s.available}`);
    }
  }
  return out;
}
