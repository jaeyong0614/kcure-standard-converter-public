/* 내장 명세(항목정의서 v2.4 기반) 색인 + 개정본 xlsx 재적재 */
window.KC = window.KC || {};

KC.spec = (function () {
  'use strict';
  const U = KC.util;
  const S = { data: null, items: [], byId: {}, aliasIndex: new Map(), krcdi: [], krcdiByKey: {}, profilesById: {} };

  function init(data) {
    S.data = data;
    S.items = data.items;
    S.byId = {};
    S.aliasIndex = new Map();
    S.items.forEach(function (it) {
      S.byId[it.id] = it;
      const names = [[it.name, []]].concat(it.aliases || []);
      names.forEach(function (pair) {
        const k = U.normKey(pair[0]);
        if (!k) return;
        if (!S.aliasIndex.has(k)) S.aliasIndex.set(k, []);
        const arr = S.aliasIndex.get(k);
        const raw = String(pair[0]).trim();
        const hit = arr.find(function (x) { return x.id === it.id; });
        if (hit) {
          // 같은 항목의 표기 변형: 원문 표기·암종 태그를 합친다
          if (hit.raws.indexOf(raw) < 0) hit.raws.push(raw);
          (pair[1] || []).forEach(function (c) { if (hit.cancers.indexOf(c) < 0) hit.cancers.push(c); });
          hit.std = hit.std || pair[0] === it.name;
        } else {
          arr.push({ id: it.id, cancers: (pair[1] || []).slice(), std: pair[0] === it.name, raws: [raw] });
        }
      });
    });
    S.krcdi = data.krcdi || [];
    S.krcdiByKey = {};
    S.krcdi.forEach(function (k) { S.krcdiByKey[k.cls + '|' + k.el] = k; });
    S.profilesById = {};
    (data.profiles || []).forEach(function (p) { S.profilesById[p.id] = p; });
    return S;
  }

  /* ----- 허용값 해석 (tools/build_spec.py parse_allowed 와 동일 규칙) ----- */
  function parseAllowed(raw, dtype) {
    raw = String(raw || '').trim();
    if (!raw || raw === '-') return {};
    const parts = raw.split(/\s*,\s*/).filter(Boolean);
    const re = /^\s*([^:,]+?)\s*:\s*([^,]+?)\s*$/;
    if (parts.length >= 2 && parts.every(function (p) { return re.test(p); })) {
      return { codes: parts.map(function (p) { const m = re.exec(p); return [m[1].trim(), m[2].trim()]; }) };
    }
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[~\-]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
    if (m && (dtype === 'INTEGER' || dtype === 'NUMERIC')) return { range: [+m[1], +m[2]] };
    if (parts.length >= 3 && !parts.some(function (p) { return p.indexOf(':') >= 0; }) && dtype === 'CODE') {
      return { codes: parts.map(function (p) { return [p, p]; }) };
    }
    return {};
  }

  function cl(v) {
    const s = v == null ? '' : String(v).trim();
    return (s === '-' || s === 'None') ? '' : s;
  }

  /** 개정 항목정의서(xlsx 시트 배열)에서 items 재구성. 별칭·대응유형은 기존 명세에서 승계 */
  function reloadFromSheets(sheets, fileName) {
    let sheet = sheets.find(function (s) { return s.name === '10_항목정의_최종'; });
    let hIdx = -1;
    const findHeader = function (s) {
      for (let i = 0; i < Math.min(15, s.rows.length); i++) {
        const r = s.rows[i].map(cl);
        if (r.indexOf('항목ID') >= 0 && r.indexOf('KR_Core_FHIR_Path') >= 0) return i;
      }
      return -1;
    };
    if (sheet) hIdx = findHeader(sheet);
    if (!sheet || hIdx < 0) {
      sheet = sheets.find(function (s) { return findHeader(s) >= 0; });
      if (!sheet) throw new Error('"항목ID"와 "KR_Core_FHIR_Path" 열이 있는 시트(10_항목정의_최종 형식)를 찾지 못했습니다.');
      hIdx = findHeader(sheet);
    }
    const head = sheet.rows[hIdx].map(cl);
    const col = function (name) { return head.indexOf(name); };
    const need = ['항목ID', '표준항목명', '데이터타입', 'KR_Core_Profile', 'KR_Core_FHIR_Path'];
    need.forEach(function (n) { if (col(n) < 0) throw new Error('필수 열 누락: ' + n); });
    const get = function (r, n) { const i = col(n); return i < 0 ? '' : cl(r[i]); };
    const prev = S.byId;
    const krIds = S.data.meta.krcoreIds || {};
    const out = [];
    let added = 0, changed = 0;
    sheet.rows.slice(hIdx + 1).forEach(function (r) {
      const id = get(r, '항목ID');
      if (!/^KCURE-/.test(id)) return;
      const old = prev[id];
      let dtype = get(r, '데이터타입') || 'VARCHAR';
      if (dtype[0] === '[') dtype = 'VARCHAR';
      const coreProf = get(r, 'KR_Core_Profile');
      const prf = get(r, 'KR-mCODE_프로파일ID');
      let url = '', src = '';
      if (krIds[coreProf]) { url = S.data.meta.krcoreBase + krIds[coreProf][0]; src = 'KR Core(' + krIds[coreProf][1] + ')'; }
      else if (S.profilesById[prf]) { url = S.profilesById[prf].url; src = 'KR-mCODE 후보(' + prf + ')'; }
      const cdiEl = get(r, 'KR_CDI_Element');
      const it = {
        id: id, name: get(r, '표준항목명'), def: get(r, '표준정의'), cat1: get(r, '대분류'),
        cat2: get(r, '중분류').replace(/\n/g, ' '), tier: get(r, '우선검토구분'), domain: get(r, 'mCODE Category'),
        role: get(r, '의미역할'), cancers: get(r, '출현암종').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        type: dtype, len: parseInt(get(r, '데이터길이'), 10) || null, dec: parseInt(get(r, '소수점'), 10) || null,
        storage: get(r, '저장형식'), unit: get(r, '단위')[0] === '[' ? '' : get(r, '단위'),
        codeYN: get(r, '코드여부').charAt(0) === 'Y' || get(r, '코드여부').charAt(0) === 'N' ? get(r, '코드여부').charAt(0) : '',
        codeName: get(r, '표준코드명'), allowed: get(r, '허용값'), req: get(r, '필수여부'),
        cdi: cdiEl && cdiEl !== '해당 없음' ? {
          cls: get(r, 'KR_CDI_Class'), el: cdiEl, req: get(r, 'KR_CDI_필수').slice(0, 2).trim(),
          match: old && old.cdi ? old.cdi.match || '' : '', no: old && old.cdi ? old.cdi.no || null : null
        } : {},
        core: { profile: coreProf, path: get(r, 'KR_Core_FHIR_Path'), judge: get(r, 'KR_Core_판정'), url: url, urlSrc: src },
        mcode: (function () {
          const m = { profile: get(r, 'mCODE_Profile'), path: get(r, 'mCODE_FHIR_Path'), level: get(r, 'mCODE_참조수준') };
          // 프로파일이 같으면 데이터 사전 연결 정보(URL·제목) 승계, 경로도 같으면 데이터요소 승계
          if (old && old.mcode && old.mcode.profile === m.profile) {
            m.title = old.mcode.title; m.url = old.mcode.url;
            if (old.mcode.path === m.path) { m.element = old.mcode.element; m.elRequired = old.mcode.elRequired; }
          }
          return m;
        })(),
        omop: old && old.omop ? old.omop : null,   // OMOP 후보는 기존 명세에서 승계(신규 항목은 화면에서 지정)
        prf: prf, grade: get(r, '심사등급'), stage: get(r, '매핑확정단계'), gap: get(r, '정의결손코드'),
        examples: old ? old.examples : [], aliases: old ? old.aliases : [],
        argo: old && old.argo ? old.argo : {}   // ARGO 후보는 기존 명세에서 승계(신규 항목은 화면에서 지정)
      };
      Object.assign(it, parseAllowed(it.allowed, dtype));
      if (!old) added++;
      else if (old.core.path !== it.core.path || (old.cdi && old.cdi.el) !== (it.cdi && it.cdi.el) || old.type !== it.type) changed++;
      out.push(it);
    });
    if (!out.length) throw new Error('항목(KCURE-*) 행을 찾지 못했습니다.');
    const data = Object.assign({}, S.data, {
      items: out,
      meta: Object.assign({}, S.data.meta, { source: fileName, itemCount: out.length, generated: U.today() + ' (앱에서 재적재)' })
    });
    init(data);
    return { count: out.length, added: added, changed: changed, removed: Object.keys(prev).filter(function (k) { return !S.byId[k]; }).length };
  }

  S.init = init;
  S.reloadFromSheets = reloadFromSheets;
  S.parseAllowed = parseAllowed;
  return S;
})();
