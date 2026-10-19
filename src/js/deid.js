/* Level 2 가명처리 추천 (Hospital sw flow FR-01~03)
 * 원천 컬럼 + 샘플(최대 10행) → 컬럼별 {표준항목, 탐지 패턴, 가명처리 기법, 근거, 신뢰도, 승인}
 * 원본 데이터는 바꾸지 않는다. 결과(plan)는 codegen.js 가 실행 코드로 만든다. */
window.KC = window.KC || {};

KC.deid = (function () {
  'use strict';
  const MAX_SAMPLE_ROWS = 10;
  let R = null;

  function rules() {
    if (!R) {
      const src = window.KCURE_DEID;
      if (!src) throw new Error('가명처리 규칙(deid_rules)이 없습니다.');
      R = {
        src: src,
        rules: src.rules.map(function (r) {
          return Object.assign({}, r, { nameRx: r.when.name ? new RegExp(r.when.name, 'i') : null });
        }),
        pii: src.pii.map(function (p) { return Object.assign({}, p, { rx: new RegExp(p.regex, 'g') }); }),
        exceptions: src.exceptions || []
      };
    }
    return R;
  }

  /* ---------- 샘플값 패턴 ---------- */
  const SAMPLE_RX = {
    RRN: /^\d{6}-?[1-8]\d{6}$/,
    PHONE: /^0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}$/,
    EMAIL: /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/,
    DATE: /^(19|20)\d{2}([-./]?)(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])$/,
    NUMBER: /^-?\d+(\.\d+)?$/
  };

  /** 값 목록 → 주된 패턴(값의 70% 이상이 맞는 패턴), 날짜 형식, 고유값 수 */
  function detectPattern(values) {
    const vs = values.map(function (v) { return String(v == null ? '' : v).trim(); }).filter(function (v) { return v && !/^(na|n\/a|null|-|\.)$/i.test(v); });
    const res = { n: vs.length, distinct: new Set(vs).size, pattern: '', dateFormats: [], examples: vs.slice(0, 3) };
    if (!vs.length) return res;
    const hit = function (rx) { return vs.filter(function (v) { return rx.test(v); }).length / vs.length; };
    if (hit(SAMPLE_RX.RRN) >= 0.7) res.pattern = 'RRN';
    else if (hit(SAMPLE_RX.PHONE) >= 0.7) res.pattern = 'PHONE';
    else if (hit(SAMPLE_RX.EMAIL) >= 0.7) res.pattern = 'EMAIL';
    else if (hit(SAMPLE_RX.DATE) >= 0.7) {
      res.pattern = 'DATE';
      const f = {};
      vs.forEach(function (v) { const m = SAMPLE_RX.DATE.exec(v); if (m) f[m[2] ? 'YYYY' + m[2] + 'MM' + m[2] + 'DD' : 'YYYYMMDD'] = 1; });
      res.dateFormats = Object.keys(f);
    } else if (hit(SAMPLE_RX.NUMBER) >= 0.7) res.pattern = 'NUMBER';
    else if (vs.some(function (v) { return v.length >= 40 || /\s\S+\s\S+\s/.test(v); })) res.pattern = 'FREETEXT';
    else res.pattern = 'TEXT';
    return res;
  }

  /* ---------- 로우 항목 전개 ---------- */
  /** 복합 컬럼 → 하위 항목 제안 (값을 바꾸지 않고 안내만) */
  function expandColumn(col, values) {
    const vs = values.map(String);
    const out = [];
    if (vs.some(function (v) { return /^[ycpr]{0,2}T[0-4isx][a-d]?\s*N[0-3x][a-c]?\s*M[01x]/i.test(v.replace(/\s/g, '')); })) {
      out.push({ kind: 'TNM', parts: ['T 병기', 'N 병기', 'M 병기'], hint: '예: pT2N1M0 → T=pT2, N=N1, M=M0' });
    }
    if (/er.*pr.*her|호르몬\s*수용체/i.test(col) || vs.some(function (v) { return /ER\s*[+-].*PR\s*[+-]/i.test(v); })) {
      out.push({ kind: 'RECEPTOR', parts: ['ER', 'PR', 'HER2'], hint: '예: ER+/PR-/HER2 2+ → ER=Positive, PR=Negative, HER2 IHC=2+' });
    }
    if (vs.some(function (v) { return /^\d+(\.\d+)?\s*(x|\*|×)\s*\d+(\.\d+)?/.test(v); })) {
      out.push({ kind: 'SIZE', parts: ['최대 직경', '부 직경'], hint: '예: 3.2x2.1 cm → 최대 직경 3.2' });
    }
    return out;
  }

  /* ---------- 기법 추천 ---------- */
  function matchRule(r, ctx) {
    const w = r.when;
    if (w.name && !(r.nameRx.test(ctx.col) || (ctx.item && r.nameRx.test(ctx.item.name)))) return false;
    if (w.role && !(ctx.item && w.role.indexOf(ctx.item.role) >= 0)) return false;
    if (w.type && !(ctx.item && w.type.indexOf(ctx.item.type) >= 0)) return false;
    if (w.sample && ctx.sample.pattern !== w.sample) return false;
    return true;
  }

  /** entry = {col, item} , values = 샘플값 배열 → 추천 1건 */
  function recommend(entry, values) {
    const sample = detectPattern(values || []);
    const ctx = { col: entry.col, item: entry.item, sample: sample };
    const r = rules().rules.find(function (x) { return matchRule(x, ctx); });
    const tdef = rules().src.techniques[r.technique] || {};
    let conf = r.confidence;
    // 표준항목이 없거나 샘플이 없으면 신뢰도를 한 단계 낮춘다
    if (!entry.item && !r.when.name && !r.when.sample) conf = '낮음';
    return {
      col: entry.col, item: entry.item || null, method: entry.method || '', sample: sample, expand: expandColumn(entry.col, values || []),
      ruleId: r.id, technique: r.technique, params: Object.assign({}, tdef.params || {}, r.params || {}), reason: r.reason,
      confidence: conf, needsReview: conf !== '높음', status: conf === '높음' ? '승인' : '후보'
    };
  }

  /** 환자 식별 컬럼: 환자번호 규칙(DR-11) 우선, 없으면 첫 가명키 컬럼 */
  function patientOf(cols) {
    return cols.find(function (c) { return c.ruleId === 'DR-11'; }) || cols.find(function (c) { return c.technique === 'HASH_SALT'; });
  }

  /** 원천 표(헤더 + 행) → 계획(plan). 샘플은 앞 10행만 쓴다 */
  function plan(headers, rows, cancer) {
    const sampleRows = (rows || []).slice(0, MAX_SAMPLE_ROWS);
    const entries = KC.meta.entriesFromColumns(headers, cancer || '');
    const cols = entries.map(function (e, i) {
      const ci = headers.indexOf(e.col);
      return recommend(e, sampleRows.map(function (r) { return r[ci >= 0 ? ci : i]; }));
    });
    const pid = patientOf(cols);
    return {
      version: rules().src.version, created: KC.util.nowIso(), cancer: cancer || '', sampleRows: sampleRows.length,
      patientCol: pid ? pid.col : '', columns: cols
    };
  }

  /** 메타데이터 선택 항목(샘플 없음) → 계획 */
  function planFromEntries(entries, cancer) {
    const cols = entries.map(function (e) { return recommend(e, []); });
    const pid = patientOf(cols);
    return { version: rules().src.version, created: KC.util.nowIso(), cancer: cancer || '', sampleRows: 0, patientCol: pid ? pid.col : '', columns: cols };
  }

  /* ---------- 비정형 PII ---------- */
  /** 텍스트 → {findings:[{type,label,text,start,end}], redacted, counts} (예외어와 겹치는 탐지는 제외) */
  function scanText(text) {
    const s = String(text || '');
    const found = [];
    rules().pii.forEach(function (p) {
      p.rx.lastIndex = 0;
      let m;
      while ((m = p.rx.exec(s))) {
        if (!m[0]) { p.rx.lastIndex++; continue; }
        const t = m[0];
        if (rules().exceptions.some(function (x) { return t.indexOf(x) >= 0; })) continue;
        found.push({ type: p.type, label: p.label, text: t, start: m.index, end: m.index + t.length });
      }
    });
    // 겹치면 먼저 시작하고 더 긴 것을 남긴다
    found.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
    const keep = [];
    found.forEach(function (f) { if (!keep.length || f.start >= keep[keep.length - 1].end) keep.push(f); });
    let out = '', pos = 0;
    keep.forEach(function (f) { out += s.slice(pos, f.start) + '[ANONYMIZED:' + f.type + ']'; pos = f.end; });
    out += s.slice(pos);
    const counts = {};
    keep.forEach(function (f) { counts[f.type] = (counts[f.type] || 0) + 1; });
    return { findings: keep, redacted: out, counts: counts };
  }

  return {
    MAX_SAMPLE_ROWS: MAX_SAMPLE_ROWS, rules: rules, detectPattern: detectPattern, expandColumn: expandColumn,
    recommend: recommend, plan: plan, planFromEntries: planFromEntries, scanText: scanText,
    reload: function () { R = null; return rules().src.version; },
    techniques: function () { return rules().src.techniques; }
  };
})();
