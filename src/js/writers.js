/* 파일 작성기 — 외부 라이브러리 없이 ZIP(무압축 저장)과 XLSX(최소 OOXML)를 만든다. */
window.KC = window.KC || {};

KC.writers = (function () {
  'use strict';

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  function bytes(x) { return typeof x === 'string' ? enc.encode(x) : x; }

  /** files: [{name, content(string|Uint8Array)}] → Uint8Array (ZIP, STORE, UTF-8 파일명) */
  function zip(files) {
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    files.forEach(function (f) {
      const name = enc.encode(f.name);
      const data = bytes(f.content);
      const crc = crc32(data);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      locals.push(lh, data);
      centrals.push(ch);
      offset += lh.length + data.length;
    });
    const cdSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const parts = locals.concat(centrals, [end]);
    const total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    const out = new Uint8Array(total);
    let p = 0;
    parts.forEach(function (x) { out.set(x, p); p += x.length; });
    return out;
  }

  /* ---------- XLSX ---------- */
  function xesc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function colName(i) {
    let s = '';
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function sheetName(n, used) {
    let s = String(n).replace(/[\\/?*\[\]:]/g, '_').slice(0, 31) || 'Sheet';
    let k = s, i = 2;
    while (used[k]) k = s.slice(0, 28) + '_' + (i++);
    used[k] = 1;
    return k;
  }

  /**
   * sheets: [{name, rows:[[...]], widths?:[n], title?:string, header?:rowIndex}]
   * 제목행(title)이 있으면 1행에 굵게, 그다음 행이 표 머리(굵게·배경·틀 고정·자동필터)
   */
  function xlsx(sheets) {
    const used = {};
    const files = [];
    const names = sheets.map(function (s) { return sheetName(s.name, used); });
    files.push({ name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '</Types>' });
    files.push({ name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) { return '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets>' + definedNames(sheets, names) + '</workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    // 스타일: 0 기본, 1 머리(굵게+배경+테두리), 2 제목(굵게 13pt), 3 줄바꿈
    files.push({ name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="13"/><name val="맑은 고딕"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA8BD"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
      '</styleSheet>' });
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', content: sheetXml(s) }); });
    return zip(files);
  }

  function headerIndex(s) { return s.title ? 1 : 0; }

  function definedNames(sheets, names) {
    const dn = [];
    sheets.forEach(function (s, i) {
      const h = headerIndex(s);
      const rows = s.rows.length;
      const cols = Math.max.apply(null, s.rows.map(function (r) { return r.length; }).concat([1]));
      if (rows > 1) dn.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xesc(names[i]).replace(/'/g, "''") + '\'!$A$' + (h + 1) + ':$' + colName(cols - 1) + '$' + (rows + h) + '</definedName>');
    });
    return dn.length ? '<definedNames>' + dn.join('') + '</definedNames>' : '';
  }

  function sheetXml(s) {
    const h = headerIndex(s);
    const all = s.title ? [[s.title]].concat(s.rows) : s.rows;
    const cols = Math.max.apply(null, all.map(function (r) { return r.length; }).concat([1]));
    const widths = s.widths || [];
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + (h + 1) + '" topLeftCell="A' + (h + 2) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    x += '<cols>';
    for (let c = 0; c < cols; c++) x += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (widths[c] || 16) + '" customWidth="1"/>';
    x += '</cols><sheetData>';
    all.forEach(function (r, ri) {
      x += '<row r="' + (ri + 1) + '">';
      r.forEach(function (v, ci) {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci) + (ri + 1);
        const style = s.title && ri === 0 ? 2 : ri === h ? 1 : 3;
        if (typeof v === 'number' && isFinite(v)) x += '<c r="' + ref + '" s="' + style + '"><v>' + v + '</v></c>';
        else x += '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (s.rows.length > 1) x += '<autoFilter ref="A' + (h + 1) + ':' + colName(cols - 1) + (all.length) + '"/>';
    x += '</worksheet>';
    return x;
  }

  return { zip: zip, xlsx: xlsx, crc32: crc32 };
})();
