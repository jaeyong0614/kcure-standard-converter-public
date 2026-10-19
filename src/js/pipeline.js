/* 변환 파이프라인: 행 순회 → 값 정규화·검증 → FHIR / KR CDI 변환 → 컬럼 프로파일(DCAT ndi:profile 용) */
window.KC = window.KC || {};

KC.pipeline = (function () {
  'use strict';
  const U = KC.util, V = KC.values;

  function isIdentifier(it) {
    return it.core.path === 'Patient.identifier' && it.role === '식별·인구학';
  }
  function isBirth(it) {
    return it.core.path === 'Patient.birthDate' || /생년월일|dt_birth/i.test(it.name);
  }

  /**
   * @param table  {headers:[], rows:[[]]}  (rows: 데이터 행만)
   * @param mapping [{idx, col, itemId}]
   * @param opts   {patientCol, pseudonymize, salt, birthYearOnly, autoFix, traceItems, metaProfile, bundleType, datasetId, cancer}
   */
  async function run(table, mapping, opts, onProgress) {
    const log = new KC.Log();
    const fhir = KC.fhir.create(opts, log);
    const cdi = KC.krcdi.create(opts, log);
    const mapped = mapping.filter(function (m) { return m.itemId && KC.spec.byId[m.itemId]; });

    mapping.filter(function (m) { return !m.itemId; }).forEach(function (m) {
      log.info('COL_UNMAPPED', '표준항목에 매핑되지 않은 컬럼 — 변환에서 제외', { col: m.col });
    });
    const seen = {};
    mapped.forEach(function (m) {
      if (seen[m.itemId]) log.warn('COL_DUPLICATE', '같은 표준항목에 여러 컬럼이 매핑됨: ' + seen[m.itemId] + ', ' + m.col, { col: m.col, item: m.itemId });
      seen[m.itemId] = m.col;
    });
    if (opts.patientCol == null || opts.patientCol < 0) throw new Error('환자 식별 컬럼을 지정해 주세요.');

    const prof = {};
    mapped.forEach(function (m) {
      prof[m.idx] = { col: m.col, itemId: m.itemId, n: 0, missing: 0, distinct: new Set(), issues: 0, min: null, max: null, kinds: {} };
    });
    let minDate = null, maxDate = null, skipped = 0;
    const patientKeys = new Set();

    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      const rowNo = i + 2; // 원본 파일 행번호(헤더=1)
      const pidRaw = String(row[opts.patientCol] == null ? '' : row[opts.patientCol]).trim();
      if (!pidRaw) { skipped++; log.error('PATIENT_ID_MISSING', '환자 식별값이 비어 있어 행을 건너뜀', { row: rowNo }); continue; }
      const patientKey = opts.pseudonymize ? KC.sha256(opts.salt + '|' + pidRaw).slice(0, 32) : pidRaw;
      patientKeys.add(patientKey);

      const cells = [];
      mapped.forEach(function (m) {
        const it = KC.spec.byId[m.itemId];
        const raw = row[m.idx];
        const n = V.normalize(raw, it);
        const p = prof[m.idx];
        p.n++;
        if (n.empty) { p.missing++; return; }
        if (p.distinct.size < 1000) p.distinct.add(n.str);
        p.kinds[n.kind] = (p.kinds[n.kind] || 0) + 1;
        const sens = isIdentifier(it) || isBirth(it);
        const ctx = { row: rowNo, col: m.col, item: it.id, value: sens ? '***' : n.str, target: it.core.path };
        if (n.issues.length) p.issues += n.issues.length;
        n.issues.forEach(function (x) { log.add(x.level, x.code, x.msg, ctx); });
        if (!sens) {
          const sortable = n.kind === 'date' ? n.date : (n.num != null ? n.num : null);
          if (sortable != null) {
            if (p.min == null || sortable < p.min) p.min = sortable;
            if (p.max == null || sortable > p.max) p.max = sortable;
          }
          if (n.kind === 'date' && n.date.length === 10) {
            if (!minDate || n.date < minDate) minDate = n.date;
            if (!maxDate || n.date > maxDate) maxDate = n.date;
          }
        }
        // KR CDI 표시값 (가명처리 규칙 동일 적용)
        let cdiValue = V.display(n);
        if (opts.pseudonymize && isIdentifier(it)) cdiValue = KC.sha256(opts.salt + '|' + n.str).slice(0, 32);
        if (opts.pseudonymize && opts.birthYearOnly && isBirth(it) && n.kind === 'date') cdiValue = n.date.slice(0, 4);
        cells.push({ item: it, norm: n, ctx: ctx, isKey: m.idx === opts.patientCol, cdiValue: cdiValue });
      });
      fhir.convertRow(rowNo, patientKey, patientKey, cells);
      cdi.addRow(rowNo, patientKey, cells);
      if (i % 50 === 49) { if (onProgress) onProgress(i + 1, table.rows.length); await U.yieldUI(); }
    }
    if (onProgress) onProgress(table.rows.length, table.rows.length);

    const bundle = fhir.bundle();
    const fhirErrors = KC.fhir.validateBundle(bundle, log);
    const krcdi = cdi.result(mapping);

    const columns = mapped.map(function (m) {
      const p = prof[m.idx], it = KC.spec.byId[m.itemId];
      return {
        col: p.col, itemId: it.id, name: it.name, type: it.type, unit: it.unit, n: p.n, missing: p.missing,
        missingRate: p.n ? +(p.missing / p.n).toFixed(4) : 0, distinct: p.distinct.size, issues: p.issues,
        min: p.min, max: p.max, cdi: it.cdi && it.cdi.el ? it.cdi.cls + '/' + it.cdi.el : '', corePath: it.core.path, judge: it.core.judge
      };
    });

    return {
      log: log, bundle: bundle, fhirStats: fhir.ctx.stats, fhirErrors: fhirErrors, krcdi: krcdi, columns: columns,
      meta: {
        rows: table.rows.length, skipped: skipped, patients: patientKeys.size, mappedColumns: mapped.length,
        totalColumns: mapping.length, minDate: minDate, maxDate: maxDate, finished: U.nowIso()
      }
    };
  }

  return { run: run };
})();
