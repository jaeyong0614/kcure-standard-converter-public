/* 산출물 미리보기: CSV·TSV·XLSX 는 엑셀처럼 격자(열 문자·행 번호·고정 머리글·시트 탭·검색)로, 나머지는 텍스트로 보여 준다 */
window.KC = window.KC || {};

KC.sheetView = (function () {
  'use strict';
  const U = KC.util, esc = U.esc;
  const MAX_ROWS = 2000, MAX_TEXT = 150000;

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  function kindOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    const ext = m ? m[1].toLowerCase() : '';
    return ext === 'csv' ? 'csv' : ext === 'tsv' ? 'tsv' : (ext === 'xlsx' || ext === 'xlsm') ? 'xlsx' : 'text';
  }
  /** 미리보기를 엑셀 격자로 볼 수 있는 파일인가 */
  function isTable(name) { return kindOf(name) !== 'text'; }

  function asText(content) {
    if (typeof content === 'string') return content;
    return KC.readers.decodeText(content.buffer ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) : content).text;
  }

  async function sheetsOf(name, content) {
    const kind = kindOf(name);
    if (kind === 'xlsx') {
      const u8 = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      return KC.readers.readXlsx(buf);
    }
    const text = asText(content).replace(/^﻿/, '');
    return [{ name: name.split('/').pop(), rows: KC.readers.parseCsv(text, kind === 'tsv' ? '\t' : ',') }];
  }

  function isNum(v) { return /^-?\d+(\.\d+)?$/.test(String(v).trim()); }

  /** 행 배열 → 격자 HTML. 첫 행은 머리글로 굵게·고정 */
  function gridHtml(rows, q) {
    const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
    const filled = function (r) { return (r || []).filter(function (v) { return String(v == null ? '' : v).trim(); }).length; };
    // 1행이 제목 한 칸뿐이고 2행이 머리글이면(통합 엑셀 시트), 제목은 따로 보이고 2행을 머리글로 고정한다
    const titled = rows.length > 2 && filled(rows[0]) === 1 && filled(rows[1]) > 1;
    const hi = titled ? 1 : 0;
    const head = rows[hi] || [];
    // 원래 행 번호(엑셀과 같은 번호)를 유지한 채 거른다
    let body = rows.slice(hi + 1).map(function (r, i) { return { r: r, n: i + hi + 2 }; });
    const total = body.length;
    if (q) {
      const ql = q.toLowerCase();
      body = body.filter(function (x) { return x.r.some(function (v) { return String(v == null ? '' : v).toLowerCase().indexOf(ql) >= 0; }); });
    }
    const shown = body.slice(0, MAX_ROWS);
    const cell = function (v, tag) {
      const s = v == null ? '' : String(v);
      return '<' + tag + (isNum(s) && tag === 'td' ? ' class="n"' : '') + (s.length > 30 ? ' title="' + esc(s) + '"' : '') + '>' + esc(s) + '</' + tag + '>';
    };
    let h = '<table class="xl"><thead><tr class="cols"><th class="corner"></th>';
    for (let c = 0; c < width; c++) h += '<th>' + colName(c) + '</th>';
    h += '</tr><tr class="hdr"><th class="rn">' + (hi + 1) + '</th>';
    for (let c = 0; c < width; c++) h += cell(head[c], 'th');
    h += '</tr></thead><tbody>';
    shown.forEach(function (x) {
      h += '<tr><th class="rn">' + x.n + '</th>';
      for (let c = 0; c < width; c++) h += cell(x.r[c], 'td');
      h += '</tr>';
    });
    h += '</tbody></table>';
    const info = (q ? '검색 결과 ' + body.length + '행 / ' : '') + '데이터 ' + total.toLocaleString() + '행 × ' + width + '열' +
      (body.length > MAX_ROWS ? ' · 앞 ' + MAX_ROWS.toLocaleString() + '행만 표시' : '');
    return { html: h, info: info, title: titled ? String(rows[0].find(function (v) { return String(v == null ? '' : v).trim(); })) : '' };
  }

  /**
   * target(div) 에 미리보기를 그린다.
   * o = {name, content(string|Uint8Array), bytes}
   */
  async function show(target, o) {
    target.classList.remove('hidden');
    const name = o.name || '';
    const kind = kindOf(name);
    if (kind === 'text') {
      const t = asText(o.content);
      target.innerHTML = '<div class="xl-bar"><b class="mono">' + esc(name) + '</b><span class="muted small">' + U.fmtBytes(o.bytes || t.length) + '</span></div>' +
        '<pre class="view">' + esc(t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n\n… (앞 ' + MAX_TEXT.toLocaleString() + '자만 표시)' : t) + '</pre>';
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    target.innerHTML = '<div class="note small">표를 읽는 중…</div>';
    let sheets;
    try { sheets = await sheetsOf(name, o.content); } catch (e) { target.innerHTML = '<div class="note err">미리보기를 만들지 못했습니다: ' + esc(e.message) + '</div>'; return; }
    sheets = sheets.filter(function (s) { return s.rows && s.rows.length; });
    if (!sheets.length) { target.innerHTML = '<div class="note">빈 파일입니다.</div>'; return; }
    let cur = 0, q = '';
    const draw = function () {
      const g = gridHtml(sheets[cur].rows, q);
      target.querySelector('.xl-wrap').innerHTML = g.html;
      target.querySelector('.xl-info').textContent = (g.title ? g.title + ' · ' : '') + g.info;
      target.querySelectorAll('.xl-tabs button').forEach(function (b, i) { b.classList.toggle('on', i === cur); });
    };
    target.innerHTML = '<div class="xl-bar"><b class="mono">' + esc(name) + '</b><span class="muted small xl-info"></span>' +
      '<input type="search" class="xl-q" placeholder="표에서 찾기" aria-label="표에서 찾기"></div>' +
      '<div class="xl-wrap"></div>' +
      (sheets.length > 1 || kind === 'xlsx' ? '<div class="xl-tabs">' + sheets.map(function (s, i) { return '<button type="button" data-xs="' + i + '">' + esc(s.name) + '</button>'; }).join('') + '</div>' : '');
    target.querySelector('.xl-q').addEventListener('input', function (e) { q = e.target.value.trim(); draw(); });
    const tabs = target.querySelector('.xl-tabs');
    if (tabs) tabs.addEventListener('click', function (e) { const b = e.target.closest('[data-xs]'); if (b) { cur = +b.dataset.xs; draw(); } });
    draw();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { show: show, isTable: isTable, colName: colName, gridHtml: gridHtml, sheetsOf: sheetsOf };
})();
