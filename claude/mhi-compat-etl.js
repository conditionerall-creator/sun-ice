/* ETL: MHI RAC compatibility xlsx -> structured JSON. Runs in-browser against the two
   workbooks already loaded as window.wb2019 / window.wb2026 (see inspect.html). */

function normText(v) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
}

/* Parses ONE raw model-code label (already split on \n if it had alternates) into a
   structured pattern. See grammar notes in mhi_rac_compatibility_TZ.md section 3.1/4. */
function parseCodePattern(raw) {
  let s = raw.trim();
  let refrigerant = null;
  const r32m = s.match(/\(R\s*32\)/i);
  if (r32m) {
    refrigerant = 'R32';
    s = (s.slice(0, r32m.index) + s.slice(r32m.index + r32m[0].length));
  }
  const deprecated = /☆/.test(s);
  const footnoteMarker = /※/.test(s);
  s = s.replace(/[※☆]/g, '').replace(/\s+/g, '').toUpperCase();
  // family: leading letters
  const famM = s.match(/^[A-Z]+/);
  if (!famM) return { raw, error: 'no-family', refrigerant };
  const family = famM[0];
  let rest = s.slice(family.length);

  let capacityKind = 'none';
  let capacityList = null;
  let capacityRange = null;

  if (/^(\.{2,}|…)\.?/.test(rest)) {
    // Source spreadsheet is inconsistent: sometimes a real ellipsis char "…", sometimes
    // 3 literal dots, sometimes 4 (typo), and at least once an ellipsis char PLUS one
    // extra trailing "." ("SRC ….ZTL-W") — match 2-or-more dots or the ellipsis char,
    // plus one optional extra dot, or a stray leftover "." corrupts the following series.
    capacityKind = 'wildcard';
    rest = rest.replace(/^(\.{2,}|…)\.?/, '');
  } else if (rest.startsWith('-') && /^[A-Z]/.test(rest.slice(1))) {
    // bare hyphen directly followed by a letter (not a digit) = wildcard capacity,
    // e.g. "SRK-ZSX-S" (confirmed by TZ section 7 fixtures)
    capacityKind = 'wildcard';
    rest = rest.slice(1);
  } else {
    // "," and "~" both used as list separators in practice, and "." shows up at least
    // once as an outright typo for "," (e.g. source has "FDEN40.50,60VD" — the other
    // two lines of that same cell correctly use commas) — accept all three leniently,
    // a false "list" reading of an intended range is harmless here since 2019-only
    // codes using "~" are lower-priority archival data anyway (TZ section 6.2).
    const numM = rest.match(/^(\d+(?:[,~.\-]\d+)*)/);
    if (numM) {
      const numStr = numM[0];
      rest = rest.slice(numStr.length);
      if (numStr.includes('-') || numStr.includes('~')) {
        const parts = numStr.split(/[-~]/).map(Number);
        capacityKind = 'range';
        capacityRange = { min: Math.min(...parts), max: Math.max(...parts) };
      } else if (numStr.includes(',') || numStr.includes('.')) {
        capacityKind = 'list';
        capacityList = numStr.split(/[,.]/).map(Number);
      } else {
        capacityKind = 'list';
        capacityList = [Number(numStr)];
      }
    }
  }

  // remainder: SERIES optionally followed by -SUFFIX(,SUFFIX...)
  const dashIdx = rest.indexOf('-');
  let series, suffixVariants;
  if (dashIdx === -1) {
    series = rest;
    suffixVariants = [];
  } else {
    series = rest.slice(0, dashIdx);
    suffixVariants = rest.slice(dashIdx + 1).split(',').map(x => x.trim()).filter(Boolean);
  }
  if (!series) return { raw, error: 'no-series', family, refrigerant, deprecated, footnoteMarker };

  return { raw, family, capacityKind, capacityList, capacityRange, series, suffixVariants, refrigerant, deprecated, footnoteMarker };
}

/* One header cell can contain several \n-separated alternative labels, all pointing at
   the SAME column/row of the matrix (TZ 3.1). Returns array of parsed patterns. */
function parseHeaderCell(cellText) {
  const norm = normText(cellText);
  if (!norm) return [];
  const rawLines = norm.split('\n').map(l => l.trim()).filter(Boolean);
  // A line that is JUST "(R32)" or "(☆)" is a word-wrapped continuation of the line
  // above it (confirmed: every such case in both files has exactly one real line
  // before it), not an independent alternate model — merge it back rather than
  // parsing alone.
  const lines = [];
  rawLines.forEach(line => {
    if (/^(\(R\s*32\)|\(☆\))$/i.test(line) && lines.length) {
      lines[lines.length - 1] = lines[lines.length - 1] + ' ' + line;
    } else {
      lines.push(line);
    }
  });
  return lines.map(parseCodePattern);
}

/* Footnote dictionary: scan a whole sheet's rows for cells matching "(*N) text..." and
   collect the fullest version of each number's text (some cells repeat just "(*N)"
   without the text - keep the longest). */
function collectFootnotes(rows) {
  const map = {};
  rows.forEach(row => (row || []).forEach(cell => {
    const t = normText(cell);
    const m = t.match(/^\(\*(\d+)\)\s*(.*)$/s);
    if (m) {
      const n = m[1];
      const text = m[2].trim();
      if (text && (!map[n] || text.length > map[n].length)) map[n] = text;
    }
  }));
  return map;
}

function footnoteNumsIn(text) {
  const nums = [];
  const re = /\(\*(\d+)\)/g;
  let m;
  while ((m = re.exec(text))) nums.push(m[1]);
  return nums;
}

function symbolToStatus(raw) {
  const t = normText(raw);
  // Empty cell and explicit "-" both mean incompatible, per TZ section 8 open
  // question #2 (they're indistinguishable via data_only xlsx reading anyway, and the
  // TZ's own default is to treat blank as "-"). Crucially this is a FOUND rule
  // (incompatible), not "no data" — "no data" only happens when the pair isn't in the
  // table at all (family/series/suffix genuinely absent from every column/row).
  if (!t || t === '-') return { statusRaw: t || '-', kind: 'incompatible' };
  if (/^N\/A$/i.test(t)) return { statusRaw: t, kind: 'na' };
  if (t.includes('◎')) return { statusRaw: t, kind: 'recommended' }; // ◎
  if (t.includes('〇')) return { statusRaw: t, kind: 'conditional' }; // 〇
  if (/^Yes\b/i.test(t)) return { statusRaw: t, kind: /\(\*\d/.test(t) ? 'conditional' : 'recommended' };
  if (/^No\b/i.test(t)) return { statusRaw: t, kind: 'incompatible' };
  if (/^OK\b/i.test(t)) return { statusRaw: t, kind: 'recommended' }; // 2019 RAC MULTI convention
  return { statusRaw: t, kind: 'other' };
}

/* Parses ONE matrix block: headerRowIdx (single row of indoor-column header cells),
   dataRowStart..dataRowEnd (outdoor rows), indoorColStart (first indoor column index),
   outdoorLabelCol (column holding the outdoor row's raw label). Emits one rule per
   (indoor variant x outdoor variant) pair per cell with a non-empty symbol. */
function parseSimpleBlock(rows, opts) {
  const { headerRowIdx, dataRowStart, dataRowEnd, indoorColStart, indoorColEnd, outdoorLabelCol, footnotes, meta } = opts;
  const headerRow = rows[headerRowIdx] || [];
  const colLimit = indoorColEnd != null ? indoorColEnd + 1 : headerRow.length;
  const indoorByCol = {};
  for (let c = indoorColStart; c < colLimit; c++) {
    const variants = parseHeaderCell(headerRow[c]);
    if (variants.length) indoorByCol[c] = variants;
  }
  const rules = [];
  const factRows = []; // for special fact blocks (plural use etc) reuse same shape
  for (let r = dataRowStart; r <= dataRowEnd; r++) {
    const row = rows[r] || [];
    const outdoorRaw = normText(row[outdoorLabelCol]);
    if (!outdoorRaw) continue;
    const outdoorVariants = parseHeaderCell(outdoorRaw);
    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const cellRaw = row[c];
      const st = symbolToStatus(cellRaw);
      if (!st) return;
      const nums = footnoteNumsIn(normText(cellRaw));
      const footnoteTexts = nums.map(n => footnotes[n]).filter(Boolean);
      outdoorVariants.forEach(outdoorPattern => {
        indoorByCol[c].forEach(indoorPattern => {
          rules.push(Object.assign({
            indoor_pattern: indoorPattern,
            outdoor_pattern: outdoorPattern,
            status_raw: st.statusRaw,
            status_kind: st.kind,
            footnotes: footnoteTexts.length ? footnoteTexts : null
          }, meta));
        });
      });
    });
  }
  return rules;
}

/* Fact rows (Plural use / V-multi / SC-BIKN-x necessity): same header row (indoor
   codes) as the main block, but the row label is NOT an outdoor model — it names the
   fact itself, and the cell value is a Yes/No/N/A fact about the INDOOR code alone
   (not an indoor x outdoor pair). Keying by indoor code only, per TZ section 3.4. */
function parseFactBlock(rows, opts) {
  const { headerRowIdx, dataRowStart, dataRowEnd, indoorColStart, rowLabelCol, footnotes, meta } = opts;
  const headerRow = rows[headerRowIdx] || [];
  const indoorByCol = {};
  for (let c = indoorColStart; c < headerRow.length; c++) {
    const variants = parseHeaderCell(headerRow[c]);
    if (variants.length) indoorByCol[c] = variants;
  }
  const facts = [];
  for (let r = dataRowStart; r <= dataRowEnd; r++) {
    const row = rows[r] || [];
    const labelRaw = normText(row[rowLabelCol]);
    if (!labelRaw) continue;
    const factType = labelRaw.split('\n')[0].trim();
    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const cellRaw = normText(row[c]);
      if (!cellRaw || cellRaw === '-') return;
      const nums = footnoteNumsIn(cellRaw);
      const footnoteTexts = nums.map(n => footnotes[n]).filter(Boolean);
      indoorByCol[c].forEach(indoorPattern => {
        facts.push(Object.assign({
          fact_type: factType,
          indoor_pattern: indoorPattern,
          value_raw: cellRaw,
          footnotes: footnoteTexts.length ? footnoteTexts : null
        }, meta));
      });
    });
  }
  return facts;
}

/* RAC MULTI block: two-row header (model name row, merged; capacity row below),
   reconstructed via sheet !merges. Outdoor rows are plain (col0=raw concrete model). */
function parseMultiBlock(sheet, rows, opts) {
  const { nameRowIdx, capRowIdx, dataRowStart, dataRowEnd, indoorColStart, outdoorLabelCol, footnotes, meta } = opts;
  const nameRow = rows[nameRowIdx] || [];
  const capRow = rows[capRowIdx] || [];
  const merges = (sheet['!merges'] || []).filter(m => m.s.r === nameRowIdx);
  // column -> full indoor label text (name forward-filled via merges, then + capacity)
  const nameForCol = {};
  for (let c = indoorColStart; c < nameRow.length; c++) nameForCol[c] = normText(nameRow[c]);
  merges.forEach(m => {
    const label = normText(nameRow[m.s.c]);
    for (let c = m.s.c; c <= m.e.c; c++) nameForCol[c] = label;
  });
  const indoorByCol = {};
  for (let c = indoorColStart; c < nameRow.length; c++) {
    const name = nameForCol[c];
    if (!name) continue;
    const capRaw = normText(capRow[c]);
    const capNumM = capRaw.match(/\d+/);
    if (!capNumM) continue;
    // Build one concrete pattern per \n-separated alternate model name. Parse the
    // alternate's OWN text first (correctly resolves its wildcard-hyphen/family/series),
    // then overwrite the capacity onto the resulting pattern — string-splicing the
    // number into the raw text first (before parsing) broke on "SRK-ZM-S"-style bare
    // wildcard hyphens (produced a stray leading "-" before the series).
    const rawLines = name.split('\n').map(x => x.trim()).filter(Boolean);
    const capNum = Number(capNumM[0]);
    const variants = [];
    let prevLine = null;
    rawLines.forEach(line => {
      // Rare 2019-file shorthand: a continuation line starting with "," means "same
      // family/wildcard-prefix as the line above, different series" (e.g. "FDEN-VD"
      // then ",-VF" meaning "FDEN-VF") — reconstruct it before parsing.
      if (line.startsWith(',') && prevLine) {
        const prefixM = prevLine.match(/^([A-Z]+-?)/i);
        if (prefixM) line = prefixM[1] + line.replace(/^,-?/, '');
      }
      prevLine = line;
      const pattern = parseCodePattern(line);
      if (!pattern.error) {
        pattern.capacityKind = 'list';
        pattern.capacityList = [capNum];
        pattern.capacityRange = null;
      }
      variants.push(pattern);
    });
    indoorByCol[c] = variants;
  }
  const rules = [];
  for (let r = dataRowStart; r <= dataRowEnd; r++) {
    const row = rows[r] || [];
    const outdoorRaw = normText(row[outdoorLabelCol]);
    if (!outdoorRaw) continue;
    const outdoorPattern = parseCodePattern(outdoorRaw); // MULTI outdoor rows are concrete, single
    Object.keys(indoorByCol).forEach(cStr => {
      const c = Number(cStr);
      const cellRaw = row[c];
      const st = symbolToStatus(cellRaw);
      if (!st) return;
      const nums = footnoteNumsIn(normText(cellRaw));
      const footnoteTexts = nums.map(n => footnotes[n]).filter(Boolean);
      indoorByCol[c].forEach(indoorPattern => {
        rules.push(Object.assign({
          indoor_pattern: indoorPattern,
          outdoor_pattern: outdoorPattern,
          status_raw: st.statusRaw,
          status_kind: st.kind,
          footnotes: footnoteTexts.length ? footnoteTexts : null
        }, meta));
      });
    });
  }
  return rules;
}

function buildAll() {
  const out = { rules: [], fact_rules: [], legacy_r22_rules: [], meta: {} };

  // ---------- 2026 file ----------
  {
    const racRows = XLSX.utils.sheet_to_json(wb2026.Sheets['RAC'], { header: 1, defval: '' });
    const fn = collectFootnotes(racRows);
    const meta = { source_file: 'Compatibility of RAC_20260409_Customers.xlsx', source_sheet: 'RAC', source_last_update: '2026-04-09' };
    out.rules.push(...parseSimpleBlock(racRows, {
      headerRowIdx: 5, dataRowStart: 6, dataRowEnd: 28, indoorColStart: 2, outdoorLabelCol: 1, footnotes: fn, meta
    }));
    out.fact_rules.push(...parseFactBlock(racRows, {
      headerRowIdx: 5, dataRowStart: 29, dataRowEnd: 34, indoorColStart: 2, rowLabelCol: 1, footnotes: fn, meta
    }));

    const multiSheet = wb2026.Sheets['RAC MULTI'];
    const multiRows = XLSX.utils.sheet_to_json(multiSheet, { header: 1, defval: '' });
    const fnM = collectFootnotes(multiRows);
    const metaM = { source_file: 'Compatibility of RAC_20260409_Customers.xlsx', source_sheet: 'RAC MULTI', source_last_update: '2026-04-09' };
    out.rules.push(...parseMultiBlock(multiSheet, multiRows, {
      nameRowIdx: 5, capRowIdx: 6, dataRowStart: 7, dataRowEnd: 30, indoorColStart: 1, outdoorLabelCol: 0, footnotes: fnM, meta: metaM
    }));
  }

  // ---------- 2019 file ----------
  {
    const racRows = XLSX.utils.sheet_to_json(wb2019.Sheets['RAC'], { header: 1, defval: '' });
    const fn = collectFootnotes(racRows);
    const meta = { source_file: 'compatibility of RAC_20190517.xlsx', source_sheet: 'RAC', source_last_update: '2019-05-17' };
    // embedded legacy SCM mini-table at top (rows 3-6)
    out.rules.push(...parseSimpleBlock(racRows, {
      headerRowIdx: 3, dataRowStart: 4, dataRowEnd: 6, indoorColStart: 2, outdoorLabelCol: 1, footnotes: fn,
      meta: Object.assign({}, meta, { legacy_2019_scm_block: true })
    }));
    // main block
    out.rules.push(...parseSimpleBlock(racRows, {
      headerRowIdx: 11, dataRowStart: 12, dataRowEnd: 31, indoorColStart: 2, outdoorLabelCol: 1, footnotes: fn, meta
    }));
    out.fact_rules.push(...parseFactBlock(racRows, {
      headerRowIdx: 11, dataRowStart: 32, dataRowEnd: 35, indoorColStart: 2, rowLabelCol: 1, footnotes: fn, meta
    }));
    // legacy R22 tiny block: header row 38 has exactly one real indoor code at col2 —
    // indoorColEnd caps the scan there, because col7 of that same row carries an
    // unrelated stray note ("R22 units and R410A units cannot mix.") that would
    // otherwise get mistaken for a second indoor column.
    out.legacy_r22_rules.push(...parseSimpleBlock(racRows, {
      headerRowIdx: 38, dataRowStart: 40, dataRowEnd: 43, indoorColStart: 2, indoorColEnd: 2, outdoorLabelCol: 1, footnotes: fn,
      meta: Object.assign({}, meta, { legacy_r22: true })
    }));

    const multiSheet = wb2019.Sheets['RAC MULTI'];
    const multiRows = XLSX.utils.sheet_to_json(multiSheet, { header: 1, defval: '' });
    const fnM = collectFootnotes(multiRows);
    const metaM = { source_file: 'compatibility of RAC_20190517.xlsx', source_sheet: 'RAC MULTI', source_last_update: '2019-05-17' };
    out.rules.push(...parseMultiBlock(multiSheet, multiRows, {
      nameRowIdx: 2, capRowIdx: 3, dataRowStart: 4, dataRowEnd: 32, indoorColStart: 1, outdoorLabelCol: 0, footnotes: fnM, meta: metaM
    }));
  }

  return out;
}
