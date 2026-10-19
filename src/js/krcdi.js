/* K-CURE 원천 데이터 → KR CDI V3 (14분류·80항목) 교류데이터 + 적합성 리포트 */
window.KC = window.KC || {};

KC.krcdi = (function () {
  'use strict';

  function create(opts, log) {
    const patients = new Map();
    const long = [];
    const filled = {};       // 'cls|el' → 값 개수
    const touchedCls = {};   // 분류 → 값 개수

    function addRow(rowIdx, patientKey, cells) {
      if (!patients.has(patientKey)) patients.set(patientKey, { patient: patientKey, classes: {} });
      const rec = patients.get(patientKey);
      cells.forEach(function (c) {
        const it = c.item;
        if (!it.cdi || !it.cdi.el) return;
        const key = it.cdi.cls + '|' + it.cdi.el;
        const def = KC.spec.krcdiByKey[key];
        const value = c.cdiValue;
        rec.classes[it.cdi.cls] = rec.classes[it.cdi.cls] || {};
        const arr = rec.classes[it.cdi.cls][it.cdi.el] = rec.classes[it.cdi.cls][it.cdi.el] || [];
        arr.push({ value: value, source: it.id, sourceName: it.name, match: it.cdi.match || '대응(유형 미상)' });
        filled[key] = (filled[key] || 0) + 1;
        touchedCls[it.cdi.cls] = (touchedCls[it.cdi.cls] || 0) + 1;
        long.push([patientKey, rowIdx, def ? def.no : '', it.cdi.cls, it.cdi.el, def ? def.elEn : '', it.cdi.req, it.cdi.match || '', value, it.id, it.name]);
        if (!def) log.warn('KRCDI_UNKNOWN', 'KR CDI 80항목 사전에 없는 배정(' + key + ')', c.ctx);
      });
    }

    function result(mapping) {
      const mappedByKey = {};
      mapping.forEach(function (m) {
        const it = KC.spec.byId[m.itemId];
        if (it && it.cdi && it.cdi.el) {
          const k = it.cdi.cls + '|' + it.cdi.el;
          (mappedByKey[k] = mappedByKey[k] || []).push(m.col + ' → ' + it.id);
        }
      });
      const coverage = KC.spec.krcdi.map(function (k) {
        const key = k.cls + '|' + k.el;
        return { no: k.no, cls: k.cls, el: k.el, elEn: k.elEn, req: k.req, corePath: k.corePath, mapped: mappedByKey[key] || [], values: filled[key] || 0 };
      });
      // 적합성: 데이터가 존재하는 분류의 R(필수) 항목 누락
      const conformance = [];
      Object.keys(touchedCls).forEach(function (cls) {
        coverage.filter(function (c) { return c.cls === cls && c.req === 'R' && !c.values; }).forEach(function (c) {
          conformance.push({ level: '경고', cls: cls, el: c.el, msg: '사용 중인 분류의 R(필수) 항목 값 없음' });
        });
      });
      conformance.forEach(function (c) { log.warn('KRCDI_R_MISSING', 'KR CDI [' + c.cls + '] ' + c.el + ' — ' + c.msg, { target: 'KR CDI' }); });
      const header = ['환자키', '원천행', 'KRCDI_항목No', 'KRCDI_분류', 'KRCDI_항목', 'KRCDI_항목(영문)', '필수여부', '대응유형', '값', 'K-CURE_항목ID', 'K-CURE_항목명'];
      return {
        standard: 'KR CDI V3 (한국 핵심교류데이터)',
        note: KC.spec.data.meta.stageNote,
        records: Array.from(patients.values()),
        csvRows: [header].concat(long),
        coverage: coverage,
        conformance: conformance,
        summary: {
          patients: patients.size, values: long.length,
          elementsCovered: coverage.filter(function (c) { return c.values; }).length,
          elementsMapped: coverage.filter(function (c) { return c.mapped.length; }).length,
          classesTouched: Object.keys(touchedCls).length
        }
      };
    }

    return { addRow: addRow, result: result };
  }

  return { create: create };
})();
