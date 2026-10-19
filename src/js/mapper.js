/* 원천 컬럼 → K-CURE 표준항목 자동 매핑 */
window.KC = window.KC || {};

KC.mapper = (function () {
  'use strict';
  const U = KC.util;

  const TIER_RANK = { '전암종공통': 0, '준공통': 1, '암종특화': 2 };

  function rank(cand, cancer, header) {
    const it = KC.spec.byId[cand.id];
    let s = 0;
    // 정규화 전 원문 표기가 정확히 같으면 최우선 (예: 위암 '검사 결과'(위내시경) ≠ '검사결과'(EUS))
    if (header && cand.raws && cand.raws.indexOf(header) >= 0) s -= 1000;
    if (cancer && it.cancers.indexOf(cancer) >= 0) s -= 100;
    if (cancer && cand.cancers.indexOf(cancer) >= 0) s -= 50;
    if (cand.std) s -= 10;
    s += (TIER_RANK[it.tier] == null ? 3 : TIER_RANK[it.tier]);
    // 범용 데이터면 범용 사전 항목을, K-CURE 암종이면 K-CURE 항목을 앞에 둔다
    if (it.generic) s -= 500;
    return s;
  }

  /** 단일 컬럼명 → {itemId, method, alternatives} */
  function matchOne(header, cancer) {
    const h = String(header || '').trim();
    if (/^KCURE-[A-Z]{3}-\d{6}$/.test(h) && KC.spec.byId[h]) return { itemId: h, method: '항목ID', alternatives: [] };
    const k = U.normKey(h);
    if (!k) return { itemId: '', method: '미매핑', alternatives: [] };
    // 범용 사전은 '범용' 데이터를 고른 경우에만 쓴다(K-CURE 암종 모드의 매핑 결과는 바꾸지 않음)
    const generic = cancer === KC.spec.GENERIC;
    const cands = (KC.spec.aliasIndex.get(k) || []).filter(function (c) { return generic || !KC.spec.byId[c.id].generic; });
    if (!cands.length) {
      const g = generic ? KC.spec.matchGenericPattern(h) : '';
      return g ? { itemId: g, method: '범용 패턴', alternatives: [] } : { itemId: '', method: '미매핑', alternatives: [] };
    }
    cands.sort(function (a, b) { return rank(a, cancer, h) - rank(b, cancer, h); });
    const best = cands[0];
    const it = KC.spec.byId[best.id];
    const method = it.generic ? '범용 사전' : U.normKey(it.name) === k ? '표준명' : '원천별칭';
    return { itemId: best.id, method: method, alternatives: cands.slice(1).map(function (c) { return c.id; }) };
  }

  /** 범용 모드: 뜻이 여럿인 컬럼(예: '단위')을 바로 앞의 매핑된 컬럼으로 정한다. list = [{itemId, method}] (제자리 수정) */
  function applyContext(list, cancer) {
    if (cancer !== KC.spec.GENERIC) return list;
    const rules = KC.spec.genericContext || [];
    list.forEach(function (m, i) {
      if (!m.itemId || m.method === '설정파일' || m.method === '수동') return;
      const rule = rules.find(function (r) { return r[0] === m.itemId; });
      if (!rule) return;
      for (let j = i - 1; j >= 0; j--) {
        if (!list[j].itemId) continue;
        if (list[j].itemId === rule[1]) { m.itemId = rule[2]; m.method = '범용 문맥'; }
        break;
      }
    });
    return list;
  }

  /** 헤더 배열 → 매핑 배열. 이전 매핑 설정(saved)이 있으면 우선 적용 */
  function autoMap(headers, cancer, saved) {
    const savedMap = {};
    if (saved && saved.columns) saved.columns.forEach(function (c) { savedMap[c.col] = c.itemId; });
    const list = headers.map(function (h, idx) {
      if (Object.prototype.hasOwnProperty.call(savedMap, h)) {
        const id = savedMap[h];
        return { idx: idx, col: h, itemId: id && KC.spec.byId[id] ? id : '', method: id ? '설정파일' : '미매핑', alternatives: [] };
      }
      const m = matchOne(h, cancer);
      return { idx: idx, col: h, itemId: m.itemId, method: m.method, alternatives: m.alternatives };
    });
    return applyContext(list, cancer);
  }

  /** 환자 식별 컬럼 추정: Patient.identifier 경로이면서 식별 역할인 항목 우선 */
  function guessPatientColumn(mapping) {
    const pri = ['환자등록번호', 'no_patient', '병원번호', '환자번호'];
    const ids = mapping.filter(function (m) {
      const it = KC.spec.byId[m.itemId];
      return it && it.core.path === 'Patient.identifier' && it.role === '식별·인구학' && it.type !== 'DATE';
    });
    if (!ids.length) return mapping.length ? mapping[0].idx : -1;
    ids.sort(function (a, b) {
      const ia = pri.indexOf(KC.spec.byId[a.itemId].name), ib = pri.indexOf(KC.spec.byId[b.itemId].name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ids[0].idx;
  }

  function exportConfig(mapping, extra) {
    return Object.assign({
      tool: 'KCURE 표준변환기', version: KC.APP_VERSION, spec: KC.spec.data.meta.source, saved: U.nowIso(),
      columns: mapping.map(function (m) { return { col: m.col, itemId: m.itemId || '' }; })
    }, extra || {});
  }

  return { applyContext: applyContext, matchOne: matchOne, autoMap: autoMap, guessPatientColumn: guessPatientColumn, exportConfig: exportConfig };
})();
