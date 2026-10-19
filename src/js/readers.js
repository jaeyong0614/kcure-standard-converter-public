/* 입력 파일 해석기 — 외부 라이브러리 없이 CSV/TSV/XLSX를 읽는다.
 * XLSX: ZIP 중앙 디렉터리 해석 + DecompressionStream('deflate-raw') + DOMParser (Edge/Chrome 103+) */
window.KC = window.KC || {};

KC.readers = (function () {
  'use strict';

  /* ---------- 텍스트 디코딩: UTF-8(BOM) → 실패 시 CP949(EUC-KR) ---------- */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8(BOM)' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('euc-kr').decode(u8), encoding: 'CP949(EUC-KR)' };
    }
  }

  /* ---------- CSV ---------- */
  function sniffDelimiter(text) {
    const line = text.split(/\r?\n/, 1)[0] || '';
    const cands = [',', '\t', ';', '|'];
    let best = ',', n = -1;
    cands.forEach(function (c) {
      const k = line.split(c).length;
      if (k > n) { n = k; best = c; }
    });
    return best;
  }

  /** RFC 4180 호환 CSV 파서 (따옴표 안 줄바꿈 지원) */
  function parseCsv(text, delim) {
    delim = delim || sniffDelimiter(text);
    const rows = [];
    let row = [], field = '', i = 0, q = false;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // 중간 빈 줄은 행 번호 유지를 위해 남기고, 파일 끝의 빈 줄만 제거
    while (rows.length && !rows[rows.length - 1].some(function (v) { return String(v).trim() !== ''; })) rows.pop();
    return rows;
  }

  /* ---------- ZIP ---------- */
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('이 브라우저는 XLSX 압축 해제를 지원하지 않습니다. Edge/Chrome 최신 버전을 사용하거나 CSV로 저장해 주세요.');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('XLSX(ZIP) 구조를 찾을 수 없습니다.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder('utf-8');
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method: method, csize: csize, lho: lho };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      read: async function (name) {
        const f = files[name];
        if (!f) return null;
        const nl = dv.getUint16(f.lho + 26, true), xl = dv.getUint16(f.lho + 28, true);
        const start = f.lho + 30 + nl + xl;
        const data = u8.subarray(start, start + f.csize);
        const raw = f.method === 0 ? data : await inflateRaw(data);
        return dec.decode(raw);
      }
    };
  }

  /* ---------- XLSX ---------- */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    let n = 0;
    for (let i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function xmlDoc(text) {
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  function textOf(el) {
    // <si> 안의 모든 <t> (서식 run 포함) 연결
    const ts = el.getElementsByTagName('t');
    let s = '';
    for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  /** XLSX ArrayBuffer → [{name, rows:[[...]]}] (maxRows: 시트별 상한, 미지정 시 전체) */
  async function readXlsx(buf, opts) {
    opts = opts || {};
    const zip = await unzip(buf);
    const wbXml = xmlDoc(await zip.read('xl/workbook.xml'));
    const relXml = xmlDoc(await zip.read('xl/_rels/workbook.xml.rels'));
    const rels = {};
    const relEls = relXml.getElementsByTagName('Relationship');
    for (let i = 0; i < relEls.length; i++) rels[relEls[i].getAttribute('Id')] = relEls[i].getAttribute('Target');

    const sst = [];
    const sstText = await zip.read('xl/sharedStrings.xml');
    if (sstText) {
      const sis = xmlDoc(sstText).getElementsByTagName('si');
      for (let i = 0; i < sis.length; i++) sst.push(textOf(sis[i]));
    }

    // 날짜 서식 스타일 판별 (엑셀 일련번호 날짜 → YYYYMMDD 변환용)
    const dateStyles = new Set();
    const stText = await zip.read('xl/styles.xml');
    if (stText) {
      const st = xmlDoc(stText);
      const customDate = new Set();
      const nf = st.getElementsByTagName('numFmt');
      for (let i = 0; i < nf.length; i++) {
        const code = (nf[i].getAttribute('formatCode') || '').toLowerCase();
        if (/[yd]/.test(code.replace(/"[^"]*"/g, '')) && !/h|s/.test(code)) customDate.add(+nf[i].getAttribute('numFmtId'));
      }
      const cellXfs = st.getElementsByTagName('cellXfs')[0];
      if (cellXfs) {
        const xfs = cellXfs.getElementsByTagName('xf');
        for (let i = 0; i < xfs.length; i++) {
          const id = +xfs[i].getAttribute('numFmtId');
          if ((id >= 14 && id <= 17) || id === 22 || customDate.has(id)) dateStyles.add(i);
        }
      }
    }

    const sheets = [];
    const sheetEls = wbXml.getElementsByTagName('sheet');
    for (let s = 0; s < sheetEls.length; s++) {
      const name = sheetEls[s].getAttribute('name');
      if (opts.only && opts.only.indexOf(name) < 0) continue;
      const rid = sheetEls[s].getAttribute('r:id') || sheetEls[s].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = rels[rid] || '';
      target = target.replace(/^\/?xl\//, '');
      const xml = await zip.read('xl/' + target);
      if (!xml) continue;
      const doc = xmlDoc(xml);
      const rowEls = doc.getElementsByTagName('row');
      const rows = [];
      const limit = opts.maxRows ? Math.min(rowEls.length, opts.maxRows) : rowEls.length;
      for (let r = 0; r < limit; r++) {
        const cells = rowEls[r].getElementsByTagName('c');
        const ri = (+rowEls[r].getAttribute('r') || (r + 1)) - 1;
        const row = [];
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          const ref = cell.getAttribute('r');
          const ci = ref ? colIndex(ref) : c;
          const t = cell.getAttribute('t');
          const vEl = cell.getElementsByTagName('v')[0];
          let v = '';
          if (t === 's') v = vEl ? (sst[+vEl.textContent] || '') : '';
          else if (t === 'inlineStr') v = textOf(cell);
          else if (t === 'b') v = vEl ? (vEl.textContent === '1' ? 'TRUE' : 'FALSE') : '';
          else if (vEl) {
            v = vEl.textContent;
            const sIdx = +cell.getAttribute('s');
            if (!t && dateStyles.has(sIdx) && /^\d+(\.\d+)?$/.test(v)) v = excelSerialToYmd(+v);
          }
          row[ci] = v;
        }
        for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
        rows[ri] = row;
      }
      // 빈 행(<row> 없음)도 자리를 유지해야 화면의 "헤더 행 번호"가 엑셀 행 번호와 일치한다
      for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
      sheets.push({ name: name, rows: rows });
    }
    return sheets;
  }

  function excelSerialToYmd(n) {
    const ms = Math.round((n - 25569) * 86400000);
    const d = new Date(ms);
    return d.getUTCFullYear() + KC.util.pad(d.getUTCMonth() + 1) + KC.util.pad(d.getUTCDate());
  }

  /**
   * File → ArrayBuffer. 브라우저가 파일을 못 읽으면(NotReadableError) 잠시 뒤 한 번 더 시도하고,
   * 그래도 안 되면 흔한 원인(다른 프로그램에서 열림 · OneDrive 온라인 전용 · 선택 후 변경)을 알려 준다.
   */
  async function readBytes(file) {
    try { return await file.arrayBuffer(); } catch (e1) {
      if (e1 && e1.name !== 'NotReadableError') throw e1;
      await new Promise(function (r) { setTimeout(r, 400); });
      try { return await file.arrayBuffer(); } catch (e2) {
        const err = new Error('브라우저가 「' + file.name + '」 파일에 접근하지 못했습니다. 다음을 확인한 뒤 파일을 다시 선택해 주세요. ' +
          '① 엑셀 등 다른 프로그램에서 열려 있으면 닫기 ' +
          '② OneDrive 폴더의 "온라인 전용"(구름 아이콘) 파일이면 탐색기에서 마우스 오른쪽 → "이 장치에 항상 유지"로 내려받거나, OneDrive 밖 로컬 폴더(예: C:\\kcure\\in)로 복사 ' +
          '③ 파일을 선택한 뒤 저장·이동했다면 다시 선택. (원인: ' + (e2.name || 'NotReadableError') + ')');
        err.name = 'FileAccessError';
        throw err;
      }
    }
  }

  // 브라우저는 약 2GB 넘는 파일을 한 번에 읽지 못한다(NotReadableError). 큰 텍스트 파일은 앞부분만 읽는다.
  const LARGE_BYTES = 200 * 1024 * 1024, HEAD_BYTES = 16 * 1024 * 1024;

  /** 큰 CSV·TSV 의 앞 HEAD_BYTES 만 읽는다. 마지막 줄바꿈에서 자르고, 잘렸을 수 있는 마지막 행은 버린다 */
  async function readHead(file, delim) {
    const blob = file.slice(0, HEAD_BYTES);
    blob.name = file.name;
    let u8 = new Uint8Array(await readBytes(blob));
    const nl = u8.lastIndexOf(0x0A);
    if (nl > 0) u8 = u8.subarray(0, nl + 1);
    const dec = decodeText(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    const rows = parseCsv(dec.text, delim);
    if (rows.length > 2) rows.pop();
    return { name: file.name, size: file.size, encoding: dec.encoding, sheets: [{ name: file.name, rows: rows }],
      truncated: true, headBytes: u8.byteLength, headRows: Math.max(0, rows.length - 1) };
  }

  /** 앞부분만 읽었을 때 화면에 보여 줄 안내 */
  function truncNote(f) {
    if (!f || !f.truncated) return '';
    return '대용량 파일(' + KC.util.fmtBytes(f.size) + ')이라 앞부분 ' + KC.util.fmtBytes(f.headBytes) + '(데이터 ' + f.headRows.toLocaleString() + '행)만 읽었습니다. ' +
      '컬럼 구조·가명처리 추천·샘플 변환에는 충분합니다. 전체 데이터 처리는 ④에서 만든 코드를 병원 내부에서 실행하세요.';
  }

  /** File 객체 → {name, sheets:[{name, rows}], encoding, truncated?} */
  async function readFile(file) {
    const lower = file.name.toLowerCase();
    if (file.size > LARGE_BYTES) {
      if (/\.(xlsx|xlsm|xls)$/.test(lower)) {
        throw new Error('엑셀 파일이 너무 큽니다(' + KC.util.fmtBytes(file.size) + '). 엑셀 파일은 통째로 읽어야 하므로, CSV(UTF-8)로 저장하거나 앞부분 일부만 담은 파일로 시도해 주세요.');
      }
      return readHead(file, /\.tsv$/.test(lower) ? '	' : null);
    }
    const buf = await readBytes(file);
    if (/\.(xlsx|xlsm)$/.test(lower)) {
      return { name: file.name, size: file.size, encoding: 'XLSX', sheets: await readXlsx(buf) };
    }
    if (/\.xls$/.test(lower)) {
      throw new Error('구형 .xls 형식은 지원하지 않습니다. 엑셀에서 .xlsx 또는 CSV(UTF-8)로 다시 저장해 주세요.');
    }
    const dec = decodeText(buf);
    const delim = /\.tsv$/.test(lower) ? '\t' : null;
    return { name: file.name, size: file.size, encoding: dec.encoding, sheets: [{ name: file.name, rows: parseCsv(dec.text, delim) }] };
  }

  return { readFile: readFile, readBytes: readBytes, truncNote: truncNote, LARGE_BYTES: LARGE_BYTES, readXlsx: readXlsx, parseCsv: parseCsv, decodeText: decodeText, unzip: unzip };
})();
