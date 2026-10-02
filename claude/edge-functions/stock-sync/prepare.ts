// Підготовка розібраних рядків до запису: відсів зайвих складів, нормалізація назв, виправлення
// очевидних аномалій, злиття дублікатів, хеш зрізу. Чиста логіка — тестується в Node (prepare.test.mjs).
import { normKey, type Parsed } from './parse.ts';

export type SnapRow = { w: string; k: string; n: string; p: number; a: number };
export type Prepared = {
  rows: SnapRow[];
  received: number; // розібрано рядків у файлі
  ignored: number; // склади поза списком stock_warehouses (Неліквід, офіси, «Об'єкт не знайдено»...)
  errors: number; // некоректні рядки (нечислова кількість, порожня назва)
  clamped: number; // виправлено: від'ємне → 0, вільно > всього → вільно = всього
  merged: number; // різні назви 1С, що після нормалізації стали одним ключем у межах складу (кількості сумуються)
  ignoredWarehouses: string[];
};

// Ключ назви складу: без урахування регістру й зайвих пробілів.
export const whKey = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[\s ]+/g, ' ');

export function prepareRows(parsed: Parsed, whCodeByName: Map<string, string>): Prepared {
  const out: Prepared = { rows: [], received: parsed.rows.length, ignored: 0, errors: parsed.errors.length, clamped: 0, merged: 0, ignoredWarehouses: [] };
  const seen = new Map<string, SnapRow>();
  const ignoredNames = new Set<string>();
  for (const r of parsed.rows) {
    const code = whCodeByName.get(whKey(r.warehouse));
    if (!code) { out.ignored++; ignoredNames.add(r.warehouse); continue; }
    const key = normKey(r.item);
    if (!key) { out.errors++; continue; }
    let p = r.physical, a = r.available;
    let fixed = false;
    if (p < 0) { p = 0; fixed = true; }
    if (a < 0) { a = 0; fixed = true; }
    if (a > p) { a = p; fixed = true; }
    if (fixed) out.clamped++;
    const id = code + '\u0000' + key;
    const prev = seen.get(id);
    if (prev) { prev.p += p; prev.a += a; out.merged++; continue; }
    const row: SnapRow = { w: code, k: key, n: r.item.trim(), p, a };
    seen.set(id, row);
    out.rows.push(row);
  }
  out.ignoredWarehouses = [...ignoredNames].sort();
  return out;
}

// SHA-256 від канонічного вигляду зрізу (порядок рядків у файлі не впливає, час формування — теж).
export async function hashRows(rows: SnapRow[]): Promise<string> {
  const canon = rows.map((r) => `${r.w}|${r.k}|${r.p}|${r.a}`).sort().join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
