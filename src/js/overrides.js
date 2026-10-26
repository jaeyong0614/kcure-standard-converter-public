/* 데이터사업 사전 · 컬럼별 표준 매핑 수동 수정(오버라이드)
 * - 항목정의서의 원래 매핑(base)은 그대로 두고, 담당자가 고친 표준(ov)만 덮어쓴 "적용 항목"(item)을 만든다.
 *   ③ 산출물·DCAT·ConceptMap 은 모두 entry.item 을 읽으므로 수정이 그대로 반영된다.
 * - 국가바이오빅데이터: 항목정의서가 아직 없어 사전 자리만 둔다(파일로 불러오면 채워짐). */
window.KC = window.KC || {};

/* ---------- 데이터사업 ---------- */
KC.projects = (function () {
  'use strict';
  const LIST = [
    { id: 'kcure', label: 'K-CURE', desc: 'K-CURE 9개 암종 표준항목(항목정의서 v2.4) — 암종은 하위 선택' },
    { id: 'nbb', label: '국가바이오빅데이터', desc: '국가 바이오 빅데이터 구축사업 항목 — 항목정의서를 불러오면 사전이 채워짐' },
    { id: 'generic', label: '범용(기타)', desc: 'K-CURE 가 아닌 일반 병원 데이터 — KR CDI V3 기반 범용 사전 77항목' }
  ];
  const byId = {};
  LIST.forEach(function (p) { byId[p.id] = p; });
  return { LIST: LIST, byId: byId };
})();

/* ---------- 국가바이오빅데이터 사전 (자리) ---------- */
KC.nbb = (function () {
  'use strict';
  const U = KC.util;
  const S = { items: [], byId: {}, byKey: {}, source: '', loaded: false };

  function set(items, source) {
    S.items = items;
    S.byId = {};
    S.byKey = {};
    items.forEach(function (it) {
      S.byId[it.id] = it;
      [it.id, it.name].concat(it.aliases || []).forEach(function (n) { const k = U.normKey(n); if (k && !S.byKey[k]) S.byKey[k] = it; });
    });
    S.source = source || '';
    S.loaded = items.length > 0;
  }

  /** 시트 행 → 사전. 머리글에 항목ID·항목명(표준항목명)·자료형·별칭 열이 있으면 읽는다 */
  function fromRows(rows, source) {
    let hi = -1, head = [];
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const r = rows[i].map(function (v) { return String(v == null ? '' : v).trim(); });
      if (r.some(function (v) { return /^(항목\s*ID|항목코드|ID|코드)$/i.test(v); }) && r.some(function (v) { return /(항목명|표준항목명|명칭|이름)$/.test(v); })) { hi = i; head = r; break; }
    }
    if (hi < 0) throw new Error('머리글에 항목ID와 항목명 열이 있어야 합니다.');
    const col = function (rx) { return head.findIndex(function (h) { return rx.test(h); }); };
    const ci = col(/^(항목\s*ID|항목코드|ID|코드)$/i), ni = col(/(항목명|표준항목명|명칭|이름)$/), ti = col(/(자료형|데이터\s*타입|타입|형식)/), ai = col(/(별칭|원천|컬럼명)/), di = col(/(정의|설명)/);
    const items = [];
    rows.slice(hi + 1).forEach(function (r) {
      const id = String(r[ci] == null ? '' : r[ci]).trim(), name = String(r[ni] == null ? '' : r[ni]).trim();
      if (!id && !name) return;
      items.push({ id: id || name, name: name || id, type: ti >= 0 ? String(r[ti] || '').trim() : '', def: di >= 0 ? String(r[di] || '').trim() : '',
        aliases: ai >= 0 ? String(r[ai] || '').split(/[|,;\/]/).map(function (s) { return s.trim(); }).filter(Boolean) : [] });
    });
    if (!items.length) throw new Error('항목 행이 없습니다.');
    set(items, source);
    return items.length;
  }

  /** 원천 컬럼명·K-CURE 항목명으로 국가바이오빅데이터 항목 찾기 */
  function match(col, item) {
    if (!S.loaded) return null;
    return S.byKey[U.normKey(col)] || (item ? S.byKey[U.normKey(item.name)] : null) || null;
  }

  return { state: S, set: set, fromRows: fromRows, match: match };
})();

/* ---------- 컬럼별 수동 수정 ---------- */
KC.ov = (function () {
  'use strict';
  const XSD = ['xsd:string', 'xsd:integer', 'xsd:decimal', 'xsd:date', 'xsd:dateTime', 'xsd:boolean', 'xsd:anyURI'];
  const NONE = '__none__';
  let coreCat = null, mcodeCat = null;

  /** KR Core 프로파일·경로 목록 (명세 항목에서 수집) */
  function coreCatalog() {
    if (coreCat) return coreCat;
    const seen = {};
    coreCat = [];
    KC.spec.items.concat(KC.spec.generic).forEach(function (it) {
      const c = it.core;
      if (!c || !c.path || seen[c.path + '|' + c.profile]) return;
      seen[c.path + '|' + c.profile] = 1;
      coreCat.push({ key: c.path + ' — ' + c.profile, path: c.path, profile: c.profile, url: c.url || '' });
    });
    coreCat.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return coreCat;
  }
  /** mCODE STU4 프로파일·데이터요소 목록 */
  function mcodeCatalog() {
    if (mcodeCat) return mcodeCat;
    const d = KC.spec.data.mcode || { profiles: [], elements: [] };
    const url = {};
    d.profiles.forEach(function (p) { url[p.title] = p.url; });
    mcodeCat = d.elements.map(function (x) {
      return { key: x.profile + ' · ' + x.name + ' — ' + x.path, title: x.profile, element: x.name, path: x.path, url: url[x.profile] || '', elRequired: x.required };
    });
    return mcodeCat;
  }
  function krcdiKey(k) { return k.cls + ' / ' + k.el + ' [' + k.req + ']'; }

  /** 화면 입력값 → 수정값 (목록에 없으면 null) */
  function parse(std, v) {
    v = String(v || '').trim();
    if (!v || v === '미매칭' || v === '없음') return NONE;
    if (std === 'krcdi') {
      const k = KC.spec.krcdi.find(function (x) { return krcdiKey(x) === v || x.cls + ' / ' + x.el === v || x.el === v; });
      return k ? k.cls + '|' + k.el : null;
    }
    if (std === 'krcore') {
      const c = coreCatalog().find(function (x) { return x.key === v; }) || coreCatalog().find(function (x) { return x.path === v.split(/\s/)[0]; });
      if (c) return { path: c.path, profile: c.profile, url: c.url };
      // 목록에 없는 경로도 FHIR 경로 형식이면 허용 (Resource.element)
      return /^[A-Z][A-Za-z]+(\.[A-Za-z][\w\[\]:]*)+$/.test(v.split(/\s/)[0]) ? { path: v.split(/\s/)[0], profile: '(수동 지정)', url: '' } : null;
    }
    if (std === 'mcode') {
      const m = mcodeCatalog().find(function (x) { return x.key === v; });
      return m ? { title: m.title, element: m.element, path: m.path, url: m.url, elRequired: m.elRequired } : null;
    }
    if (std === 'nbb') {
      const id = v.split(/\s/)[0];
      const it = KC.nbb.state.byId[id];
      return it ? { id: it.id, name: it.name, type: it.type } : { id: '', name: v, type: '' };   // 사전이 없을 때는 이름을 그대로 기록
    }
    if (std === 'dcat') return XSD.indexOf(v) >= 0 ? v : null;
    return null;
  }

  /** e.base(원래 항목) + e.ov(수정) → e.item(적용 항목) */
  function apply(e) {
    if (e.base === undefined) e.base = e.item || null;
    const base = e.base, ov = e.ov || {};
    const keys = Object.keys(ov);
    if (!base) { e.item = null; return e; }
    if (!keys.length) { e.item = base; return e; }
    const it = Object.assign({}, base, { _orig: KC.match.orig(base), _manual: keys.slice() });
    if (ov.krcdi !== undefined) {
      if (ov.krcdi === NONE) it.cdi = {};
      else {
        const k = KC.spec.krcdiByKey[ov.krcdi];
        it.cdi = { cls: k.cls, el: k.el, req: k.req, match: '수동', no: k.no };
      }
    }
    if (ov.krcore !== undefined) {
      it.core = ov.krcore === NONE ? Object.assign({}, base.core, { profile: '해당 없음', path: '해당 없음', url: '', judge: '미대응' })
        : Object.assign({}, base.core, { profile: ov.krcore.profile, path: ov.krcore.path, url: ov.krcore.url, judge: '수동' });
    }
    if (ov.mcode !== undefined) {
      it.mcode = ov.mcode === NONE ? { profile: '해당 없음', path: '해당 없음', level: '미대응' }
        : { profile: ov.mcode.title, title: ov.mcode.title, path: ov.mcode.path, element: ov.mcode.element, url: ov.mcode.url, elRequired: ov.mcode.elRequired, level: '수동' };
    }
    if (ov.nbb !== undefined) it.nbb = ov.nbb === NONE ? null : ov.nbb;
    if (ov.dcat !== undefined && ov.dcat !== NONE) it.xsd = ov.dcat;
    e.item = it;
    return e;
  }

  /** 한 표준의 수정값 지정 (값이 원래와 같으면 수정 해제) */
  function set(e, std, value) {
    e.ov = e.ov || {};
    if (value === undefined) delete e.ov[std];
    else e.ov[std] = value;
    return apply(e);
  }

  /** K-CURE(표준항목) 자체를 바꾼다 — 다른 표준의 수동 수정은 유지 */
  function setItem(e, item) {
    if (e.base === undefined) e.base = e.item || null;
    e.base = item || null;
    e.method = item ? '수동' : '미매핑';
    delete e.omopKey;
    delete e.argoKey;
    return apply(e);
  }

  /** 국가바이오빅데이터 기본값: 수동 수정 → 사전 자동 대조 */
  function nbbOf(e) {
    if (e.item && e.item.nbb !== undefined) return e.item.nbb;
    return KC.nbb.match(e.col, e.base || e.item);
  }

  return { XSD: XSD, NONE: NONE, coreCatalog: coreCatalog, mcodeCatalog: mcodeCatalog, krcdiKey: krcdiKey, parse: parse, apply: apply, set: set, setItem: setItem, nbbOf: nbbOf };
})();
