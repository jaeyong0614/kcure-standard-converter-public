/* 공통 유틸리티 — 전역 네임스페이스 KC (file:// 실행을 위해 ES 모듈 대신 클래식 스크립트 사용) */
window.KC = window.KC || {};

KC.util = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 별칭 대조용 정규화: 소문자, 공백·기호 제거 (tools/build_spec.py norm_key 와 동일 규칙) */
  function normKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-.()\[\]/·,:;'"`]+/g, '');
  }

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function nowIso() {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return today() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** 브라우저 다운로드 (file:// 에서도 동작) */
  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /** 2차원 배열 → CSV (엑셀 호환을 위해 UTF-8 BOM 포함) */
  function toCsv(rows) {
    const body = rows.map(function (r) {
      return r.map(function (v) {
        const s = v == null ? '' : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    return '﻿' + body;
  }

  function byteLength(str) {
    return new Blob([str]).size;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /** 해시 문자열 → UUID 형식 (결정적 ID 생성용) */
  function hexToUuid(hex) {
    const h = hex.padEnd(32, '0');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-' +
      ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
  }

  function groupCount(arr, fn) {
    const m = {};
    arr.forEach(function (x) { const k = fn(x); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  /** UI 응답성을 위해 긴 루프 중간에 양보 */
  function yieldUI() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  return {
    esc: esc, normKey: normKey, isBlank: isBlank, today: today, nowIso: nowIso, pad: pad,
    download: download, toCsv: toCsv, byteLength: byteLength, fmtBytes: fmtBytes,
    hexToUuid: hexToUuid, groupCount: groupCount, yieldUI: yieldUI
  };
})();

/** 변환·검증 로그 수집기 */
KC.Log = function () {
  this.entries = [];
};
KC.Log.prototype.add = function (level, code, msg, ctx) {
  ctx = ctx || {};
  this.entries.push({
    level: level, code: code, msg: msg,
    row: ctx.row == null ? '' : ctx.row, col: ctx.col || '', item: ctx.item || '', value: ctx.value == null ? '' : String(ctx.value).slice(0, 80),
    target: ctx.target || ''
  });
};
KC.Log.prototype.error = function (c, m, x) { this.add('오류', c, m, x); };
KC.Log.prototype.warn = function (c, m, x) { this.add('경고', c, m, x); };
KC.Log.prototype.info = function (c, m, x) { this.add('정보', c, m, x); };
KC.Log.prototype.count = function (level) {
  return this.entries.filter(function (e) { return !level || e.level === level; }).length;
};
KC.Log.prototype.toCsvRows = function () {
  const rows = [['수준', '코드', '메시지', '행', '원천컬럼', '항목ID', '값', '대상']];
  this.entries.forEach(function (e) { rows.push([e.level, e.code, e.msg, e.row, e.col, e.item, e.value, e.target]); });
  return rows;
};
