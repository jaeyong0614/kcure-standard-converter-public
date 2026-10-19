/* 암종별 항목(컬럼) → 메타데이터 변환 (KR CDI · KR Core · DCAT · ICGC ARGO)
 * entry = {col: 원천 컬럼명, item: K-CURE 표준항목|null, method: 선택 방식, argoKey?: 수동 지정 'schema.field' | '' (대응 없음)} */
window.KC = window.KC || {};

KC.meta = (function () {
  'use strict';
  const U = KC.util;

  /* ---------- 항목 선택 ---------- */
  function entriesForCancer(cancer) {
    if (cancer === KC.spec.GENERIC) return KC.spec.generic.map(function (it) { return { col: it.name, item: it, method: '범용 사전' }; });
    return KC.spec.items.filter(function (it) { return !cancer || it.cancers.indexOf(cancer) >= 0; })
      .map(function (it) { return { col: it.name, item: it, method: '암종 항목' }; });
  }

  /** 컬럼명 목록(원천 데이터 헤더 등) → 표준항목 매핑 */
  function entriesFromColumns(headers, cancer) {
    const list = headers.filter(function (h) { return String(h).trim(); }).map(function (h) {
      const m = KC.mapper.matchOne(h, cancer);
      return { col: String(h).trim(), itemId: m.itemId, method: m.itemId ? m.method : '미매핑' };
    });
    KC.mapper.applyContext(list, cancer);
    return list.map(function (m) { return { col: m.col, item: m.itemId ? KC.spec.byId[m.itemId] : null, method: m.method }; });
  }

  /** 항목정의서 형식(항목ID/표준항목명 열) 시트 → 해당 항목들 */
  function entriesFromSpecSheet(rows) {
    let hi = -1;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const r = rows[i].map(function (v) { return String(v == null ? '' : v).trim(); });
      if (r.indexOf('항목ID') >= 0 || r.indexOf('표준항목명') >= 0) { hi = i; break; }
    }
    if (hi < 0) return null;
    const head = rows[hi].map(function (v) { return String(v == null ? '' : v).trim(); });
    const ci = head.indexOf('항목ID'), ni = head.indexOf('표준항목명');
    const out = [];
    rows.slice(hi + 1).forEach(function (r) {
      const id = ci >= 0 ? String(r[ci] || '').trim() : '';
      const name = ni >= 0 ? String(r[ni] || '').trim() : '';
      if (!id && !name) return;
      const it = KC.spec.byId[id] || (name ? KC.spec.byId[KC.mapper.matchOne(name, '').itemId] : null);
      out.push({ col: name || id, item: it || null, method: it ? (KC.spec.byId[id] ? '항목ID' : '표준명') : '미매핑' });
    });
    return out;
  }

  /* ---------- ARGO ---------- */
  function argoField(key) {
    const f = KC.spec.data.argo && KC.spec.data.argo.fields[key];
    return f || null;
  }
  /** entry 의 ARGO 대응 (수동 지정 우선) → 필드 정보 + 신뢰도/변환주의, 없으면 null */
  function argoOf(e) {
    if (!e || !e.item) return null;
    let key, conf, note, basis;
    if (e.argoKey !== undefined) {
      if (!e.argoKey) return null;
      key = e.argoKey; conf = '수동'; note = (e.item.argo && e.item.argo.key === key) ? e.item.argo.note : ''; basis = '사용자 지정';
    } else {
      if (!e.item.argo || !e.item.argo.key) return null;
      key = e.item.argo.key; conf = e.item.argo.conf; note = e.item.argo.note; basis = e.item.argo.basis;
    }
    const f = argoField(key);
    if (!f) return null;
    return Object.assign({}, f, { key: key, conf: conf, note: note, basis: basis });
  }

  /* ---------- OMOP CDM v5.4 ---------- */
  function omopField(key) {
    return (KC.spec.data.omop && KC.spec.data.omop.fields[key]) || null;
  }
  /** entry 의 OMOP 대응 (수동 지정 'table.field' 우선) */
  function omopOf(e) {
    if (!e || !e.item || !e.item.omop) return null;
    const auto = e.item.omop;
    if (e.omopKey !== undefined) {
      if (!e.omopKey) return null;
      const f = omopField(e.omopKey);
      if (!f) return null;
      const same = auto.table + '.' + auto.field === e.omopKey;
      const tdef = OMOP_T[f.table] || {};
      return Object.assign({}, same ? auto : { vocab: '', note: '' }, {
        table: f.table, field: f.field, key: e.omopKey, concept: tdef.concept || '', date: tdef.date || '', source: tdef.source || '',
        conf: '수동', basis: '사용자 지정', required: f.required, type: f.type
      });
    }
    const f = omopField(auto.table + '.' + auto.field);
    return Object.assign({}, auto, { key: auto.table + '.' + auto.field, required: f ? f.required : false, type: f ? f.type : '' });
  }
  const OMOP_T = {
    person: { concept: '', date: '', source: 'person_source_value' },
    measurement: { concept: 'measurement_concept_id', date: 'measurement_date', source: 'measurement_source_value' },
    observation: { concept: 'observation_concept_id', date: 'observation_date', source: 'observation_source_value' },
    condition_occurrence: { concept: 'condition_concept_id', date: 'condition_start_date', source: 'condition_source_value' },
    procedure_occurrence: { concept: 'procedure_concept_id', date: 'procedure_date', source: 'procedure_source_value' },
    drug_exposure: { concept: 'drug_concept_id', date: 'drug_exposure_start_date', source: 'drug_source_value' },
    visit_occurrence: { concept: 'visit_concept_id', date: 'visit_start_date', source: 'visit_source_value' },
    note: { concept: 'note_class_concept_id', date: 'note_date', source: 'note_source_value' },
    specimen: { concept: 'specimen_concept_id', date: 'specimen_date', source: 'specimen_source_value' },
    death: { concept: 'cause_concept_id', date: 'death_date', source: 'cause_source_value' },
    episode: { concept: 'episode_concept_id', date: 'episode_start_date', source: 'episode_source_value' },
    care_site: { concept: 'place_of_service_concept_id', date: '', source: 'care_site_source_value' },
    device_exposure: { concept: 'device_concept_id', date: 'device_exposure_start_date', source: 'device_source_value' },
    visit_detail: { concept: 'visit_detail_concept_id', date: 'visit_detail_start_date', source: 'visit_detail_source_value' }
  };

  /* ---------- mCODE STU4 ---------- */
  function mcodeOf(e) {
    if (!e || !e.item) return null;
    const m = e.item.mcode;
    if (!m || !m.profile || /미정의|해당 없음/.test(m.profile) || m.level === '미대응') return null;
    return m;
  }

  function argoValues(f) {
    if (!f.values || !f.values.length) return f.restriction || '';
    return f.values.length > 12 ? f.values.slice(0, 12).join(' | ') + ' … (' + f.values.length + '개)' : f.values.join(' | ');
  }

  /** 항목에 붙은 매핑 수정안(spec/corrections.json) 요약 */
  function reviewText(it) {
    return (it.review || []).map(function (r) { return r.code + ' ' + r.current + ' → ' + r.proposed + ' [' + r.status + ']'; }).join(' | ');
  }

  /* ---------- 표 생성 ---------- */
  function integratedRows(entries) {
    const head = ['No', '원천 컬럼', '항목ID', '표준항목명', '표준정의', '대분류', '중분류', 'mCODE 도메인', '데이터타입', '길이', '단위', '허용값', '필수여부',
      'KR CDI 분류', 'KR CDI 항목', 'KR CDI 필수', 'KR CDI 매칭유형',
      'KR Core 프로파일', 'KR Core 프로파일 URL', 'KR Core FHIR 경로', 'KR Core 판정',
      'DCAT 변수 자료형',
      'mCODE 프로파일', 'mCODE 프로파일 URL', 'mCODE FHIR 경로', 'mCODE 데이터요소', 'mCODE 매칭유형',
      'OMOP 테이블', 'OMOP 필드', 'OMOP 개념 필드', 'OMOP 일자 필드', 'OMOP 원천값 필드', 'OMOP 어휘', 'OMOP 변환·주의', 'OMOP 신뢰도',
      'ARGO 스키마', 'ARGO 필드', 'ARGO 표시명', 'ARGO Tier', 'ARGO 필수조건', 'ARGO 유형', 'ARGO 허용값', 'ARGO 변환·주의', 'ARGO 신뢰도',
      '매핑 단계', '정의결손', 'mCODE·KR Core 리소스', '기본 표현', '매핑 수정안', '검토 상태', '원래 판정'];
    const rows = [head];
    entries.forEach(function (e, i) {
      const it = e.item;
      if (!it) { rows.push([i + 1, e.col, '', '(항목 미인식)']); return; }
      const c = it.cdi || {}, a = argoOf(e), o = omopOf(e), m = it.mcode;
      rows.push([i + 1, e.col, it.id, it.name, it.def, it.cat1, it.cat2, it.domain, it.type, it.len || '', it.unit, it.allowed, it.req,
        c.cls || '', c.el || '', c.req || '', c.el ? KC.match.label(c.match || '대응') : '',
        it.core.profile, it.core.url, it.core.path, KC.match.label(it.core.judge),
        KC.dcat.xsdType(it.type),
        m.title || m.profile, m.url || '', m.path, m.element || '', KC.match.label(m.level),
        o ? o.table : '', o ? o.field : '', o ? o.concept : '', o ? o.date : '', o ? o.source : '', o ? o.vocab : '', o ? o.note : '', o ? o.conf : '',
        a ? a.schema : '', a ? a.field : '', a ? a.label : '', a ? a.tier : '', a ? a.req : '', a ? a.type : '', a ? argoValues(a) : '', a ? a.note : '', a ? a.conf : '',
        it.stage, it.gap, m.resConflict ? '상이(KR Core ' + it.core.path.split('.')[0] + ' / mCODE ' + m.resConflict + ')' : '일치',
        m.resConflict ? m.primary : '', reviewText(it), e.rv || '후보', KC.match.orig(it)]);
    });
    return rows;
  }

  /* ---------- mCODE 표 ---------- */
  function mcodeMapRows(entries) {
    const rows = [['원천 컬럼', '항목ID', '표준항목명', 'mCODE 프로파일', '프로파일 URL', 'mCODE FHIR 경로', 'mCODE 데이터요소', '데이터요소 필수', '매칭유형', 'KR Core 경로', '리소스 일치', '기본 표현', '비고', '원래 판정']];
    entries.forEach(function (e) {
      if (!e.item) return;
      const m = e.item.mcode;
      rows.push([e.col, e.item.id, e.item.name, m.title || m.profile, m.url || '', m.path, m.element || '', m.elRequired || '', KC.match.label(m.level), e.item.core.path,
        m.resConflict ? '상이' : (m.path && m.path !== '해당 없음' ? '일치' : ''), m.resConflict ? m.primary : '',
        /미정의/.test(m.profile) ? 'mCODE STU4에 매칭 프로파일 없음 — KR-mCODE 신규 후보(' + e.item.prf + ')' : (m.level === '구조참조(KR-mCODE 자체정의)' ? 'mCODE Draft 구조 참조, KR-mCODE에서 자체 정의' : ''), m.level]);
    });
    return rows;
  }

  function mcodeCoverage(entries) {
    const d = KC.spec.data.mcode || { profiles: [], elements: [] };
    const byProf = {}, byEl = {};
    entries.forEach(function (e) {
      const m = mcodeOf(e);
      if (!m || !m.title) return;
      (byProf[m.title] = byProf[m.title] || []).push(e);
      if (m.element) (byEl[m.title + '|' + m.element] = byEl[m.title + '|' + m.element] || []).push(e);
    });
    const prof = [['mCODE 프로파일', 'URL', '그룹', '데이터요소 수', '필수 데이터요소 수', '매칭 컬럼 수', '매칭 데이터요소 수', '매칭 컬럼', '상태']];
    let covered = 0;
    d.profiles.forEach(function (p) {
      const els = d.elements.filter(function (x) { return x.profile === p.title; });
      const req = els.filter(function (x) { return /^Required/.test(x.required); });
      const es = byProf[p.title] || [];
      const elHit = els.filter(function (x) { return byEl[p.title + '|' + x.name]; }).length;
      if (es.length) covered++;
      prof.push([p.title, p.url, p.group, els.length, req.length, es.length, elHit, es.slice(0, 30).map(function (e) { return e.col; }).join(' | ') + (es.length > 30 ? ' …' : ''), es.length ? '매칭' : '미매칭']);
    });
    const el = [['mCODE 프로파일', '데이터요소', '필수', '반복', '자료형', 'FHIR 요소', '매칭 K-CURE 컬럼']];
    d.elements.forEach(function (x) {
      const es = byEl[x.profile + '|' + x.name] || [];
      el.push([x.profile, x.name, x.required, x.card, x.type, x.path, es.map(function (e) { return e.col; }).join(' | ')]);
    });
    return { profiles: prof, elements: el, profilesCovered: covered, profilesTotal: d.profiles.length };
  }

  /* ---------- OMOP 표 ---------- */
  function omopMapRows(entries) {
    const rows = [['원천 컬럼', '항목ID', '표준항목명', 'K-CURE 자료형', 'OMOP 테이블', '대상 필드', '필드 자료형', '개념(concept) 필드', '일자 필드', '원천값(source_value) 필드', '권장 어휘', 'ETL 변환·주의', '신뢰도', '근거']];
    entries.forEach(function (e) {
      const o = omopOf(e);
      if (!o) return;
      rows.push([e.col, e.item.id, e.item.name, e.item.type, o.table, o.field, o.type, o.concept, o.date, o.source, o.vocab, o.note, o.conf, o.basis]);
    });
    return rows;
  }

  function omopCoverage(entries) {
    const d = KC.spec.data.omop || { tables: [], fields: {} };
    const by = {}, used = {};
    entries.forEach(function (e) { const o = omopOf(e); if (o) { (by[o.key] = by[o.key] || []).push(e.col); used[o.table] = (used[o.table] || 0) + 1; } });
    const rows = [['OMOP 테이블', '필드', '필수', '자료형', '참조 테이블', '매칭 K-CURE 컬럼', '상태']];
    let req = 0, reqOk = 0;
    d.tables.forEach(function (t) {
      if (!used[t.name]) return;
      t.fields.forEach(function (fn) {
        const f = d.fields[t.name + '.' + fn], hit = by[t.name + '.' + fn] || [];
        let state;
        if (hit.length) state = '매칭';
        else if (/_type_concept_id$/.test(fn)) state = 'ETL 상수(유형: 32817 EHR 등)';
        else if (/_id$/.test(fn) && !/_concept_id$/.test(fn)) state = 'ETL 생성(키·참조)';
        else if (/_concept_id$/.test(fn) && (by[t.name + '.' + fn.replace(/_concept_id$/, '_source_value')] || OMOP_T[t.name] && OMOP_T[t.name].concept === fn && used[t.name])) state = '어휘 매핑으로 채움';
        else state = f.required ? '미매칭 — 필수' : '미매칭';
        if (f.required) { req++; if (state !== '미매칭 — 필수') reqOk++; }
        rows.push([t.name, fn, f.required ? 'Y' : '', f.type, f.fk, hit.join(' | '), state]);
      });
    });
    return { rows: rows, tables: Object.keys(used).length, tableCounts: used, req: req, reqOk: reqOk };
  }

  /** OMOP source_to_concept_map 작성 템플릿 (허용값 코드가 있는 컬럼) */
  function omopStcm(entries) {
    const rows = [['source_code', 'source_concept_id', 'source_vocabulary_id', 'source_code_description', 'target_concept_id', 'target_vocabulary_id', 'valid_start_date', 'valid_end_date', 'invalid_reason']];
    entries.forEach(function (e) {
      const o = omopOf(e);
      if (!o || !e.item.codes) return;
      e.item.codes.forEach(function (c) {
        rows.push([(e.item.id + ':' + c[0]).slice(0, 50), 0, 'KCURE', (e.item.name + ' = ' + c[1]).slice(0, 255), '', (o.vocab || '').split(/[\s/(]/)[0], '1970-01-01', '2099-12-31', '']);
      });
    });
    return rows;
  }

  function krcdiRows(entries) {
    const byKey = {};
    entries.forEach(function (e) {
      if (e.item && e.item.cdi && e.item.cdi.el) (byKey[e.item.cdi.cls + '|' + e.item.cdi.el] = byKey[e.item.cdi.cls + '|' + e.item.cdi.el] || []).push(e);
    });
    const touched = {};
    Object.keys(byKey).forEach(function (k) { touched[k.split('|')[0]] = 1; });
    const rows = [['No', 'KR CDI 분류', 'KR CDI 항목', '영문명', '필수여부', '데이터타입', '참조 용어체계', 'KR Core 1순위 경로', '매칭 K-CURE 컬럼', '매칭 수', '상태', '수집범위 사유']];
    KC.spec.krcdi.forEach(function (k) {
      const hit = byKey[k.cls + '|' + k.el] || [];
      const state = hit.length ? '매칭' : k.scope ? '범위외 — ' + k.scope : (touched[k.cls] && k.req === 'R' ? 'R(필수) 미매칭 — 사용 분류' : '미매칭');
      rows.push([k.no, k.cls, k.el, k.elEn, k.req, k.type, k.term, k.corePath,
        hit.map(function (e) { return e.col + ' (' + e.item.id + (e.item.cdi.match ? ', ' + KC.match.both(e.item.cdi.match) : '') + ')'; }).join(' | '), hit.length, state, k.scopeNote || '']);
    });
    return rows;
  }

  function krcoreRows(entries) {
    const groups = {};
    entries.forEach(function (e) {
      if (!e.item) return;
      const k = e.item.core.profile + '\u0001' + e.item.core.path;
      (groups[k] = groups[k] || []).push(e);
    });
    const rows = [['KR Core 프로파일', '프로파일 URL', 'FHIR 리소스', 'FHIR 경로', '판정', '매칭 K-CURE 컬럼 수', '매칭 K-CURE 컬럼', '원래 판정']];
    Object.keys(groups).sort().forEach(function (k) {
      const es = groups[k], it = es[0].item;
      const judges = Object.keys(U.groupCount(es, function (e) { return e.item.core.judge; })).join('/');
      rows.push([it.core.profile, it.core.url, it.core.path.split('.')[0], it.core.path, judges.split('/').map(KC.match.label).filter(function (x, i, a) { return a.indexOf(x) === i; }).join('/'), es.length,
        es.map(function (e) { return e.col; }).join(' | '), judges]);
    });
    return rows;
  }

  function argoMapRows(entries) {
    const rows = [['원천 컬럼', '항목ID', '표준항목명', 'K-CURE 자료형', 'ARGO 스키마', 'ARGO 필드', 'ARGO 표시명', 'Tier', '필수조건', 'ARGO 유형', '단위', '허용값', '변환·주의', '신뢰도', '근거']];
    entries.forEach(function (e) {
      const a = argoOf(e);
      if (!a) return;
      rows.push([e.col, e.item.id, e.item.name, e.item.type, a.schema, a.field, a.label, a.tier, a.req, a.type, a.units, argoValues(a), a.note, a.conf, a.basis]);
    });
    return rows;
  }

  function argoCoverage(entries) {
    const by = {};
    entries.forEach(function (e) { const a = argoOf(e); if (a) (by[a.key] = by[a.key] || []).push(e.col); });
    const rows = [['ARGO 스키마', '필드', '표시명', 'Tier', '필수조건', '유형', '매칭 K-CURE 컬럼', '상태', '파생·지정 규칙']];
    const stat = { core: 0, coreHit: 0, coreDerived: 0, coreFixed: 0, req: 0, reqHit: 0, all: 0, hit: 0 };
    const derived = (KC.spec.data.argo && KC.spec.data.argo.derived) || {};
    (KC.spec.data.argo ? KC.spec.data.argo.schemas : []).forEach(function (s) {
      s.fields.forEach(function (fn) {
        const k = s.name + '.' + fn, f = KC.spec.data.argo.fields[k], hit = by[k] || [];
        const isId = f.tier === 'ID';
        let state = hit.length ? '매칭' : isId ? '식별자(제출 시 생성)' : (f.req === 'Required' ? '미매칭 — Required' : f.tier === 'Core' ? '미매칭 — Core' : '미매칭');
        // 직접 대응이 없을 때만 파생·지정값으로 본다 (직접 대응 수와 섞지 않음)
        const dv = derived[k];
        let how = '';
        if (!hit.length && dv) {
          if (dv.kind === '지정값') { state = '제출 시 지정값'; how = dv.rule; }
          else if (dv.from.some(function (x) { return by[x]; })) { state = '파생 가능'; how = dv.rule + ' (← ' + dv.from.filter(function (x) { return by[x]; }).join(', ') + ')'; }
        }
        if (!isId) {
          stat.all++; if (hit.length) stat.hit++;
          if (f.tier === 'Core') {
            stat.core++; if (hit.length) stat.coreHit++;
            if (state === '파생 가능') stat.coreDerived++; else if (state === '제출 시 지정값') stat.coreFixed++;
          }
          if (f.req === 'Required') { stat.req++; if (hit.length) stat.reqHit++; }
        }
        rows.push([s.name, fn, f.label, f.tier, f.req, f.type, hit.join(' | '), state, how]);
      });
    });
    return { rows: rows, stat: stat };
  }

  /** ARGO 제출 템플릿: 대응 필드가 있는 스키마마다 TSV(ARGO 헤더) + 컬럼 대응 안내 */
  function argoTemplates(entries) {
    const by = {};
    entries.forEach(function (e) { const a = argoOf(e); if (a) (by[a.key] = by[a.key] || []).push(e); });
    const files = [];
    const guide = [['ARGO 스키마', 'ARGO 필드', 'Tier', '필수조건', '채울 K-CURE 컬럼', '변환·주의']];
    (KC.spec.data.argo ? KC.spec.data.argo.schemas : []).forEach(function (s) {
      const hits = s.fields.filter(function (fn) { return by[s.name + '.' + fn]; });
      if (!hits.length) return;
      files.push({ name: s.name + '.tsv', content: s.fields.join('\t') + '\n' });
      s.fields.forEach(function (fn) {
        const k = s.name + '.' + fn, f = KC.spec.data.argo.fields[k], es = by[k] || [];
        guide.push([s.name, fn, f.tier, f.req, es.map(function (e) { return e.col; }).join(' | '),
          es.length ? (argoOf(es[0]).note || '') : (f.tier === 'ID' ? '제출 시 식별자 생성(가명 ID 권장)' : '')]);
      });
    });
    return { files: files, guide: guide };
  }

  function dcatRows(entries) {
    const rows = [['변수(컬럼)', '항목ID', '표준항목명', 'xsd 자료형', '단위', '허용값', 'KR CDI', 'KR Core 경로', 'mCODE', 'OMOP', 'ARGO', '정의']];
    entries.forEach(function (e) {
      const v = KC.dcat.variable(e);
      rows.push([e.col, v.itemId || '', v.name, v.datatype || '', v.unit || '', v.allowed || '', v.krcdi ? v.krcdi.class + '/' + v.krcdi.element : '',
        v.krcore ? v.krcore.path : '', v.mcode ? v.mcode.profile + ' ' + v.mcode.path : '', v.omop ? v.omop.table + '.' + v.omop.field : '',
        v.argo ? v.argo.schema + '.' + v.argo.field : '', v.definition || v.standardMapping || '']);
    });
    return rows;
  }

  /* ---------- 요약 ---------- */
  function summarize(entries) {
    const mapped = entries.filter(function (e) { return e.item; });
    const cdi = mapped.filter(function (e) { return e.item.cdi && e.item.cdi.el; });
    const cdiKeys = U.groupCount(cdi, function (e) { return e.item.cdi.cls + '|' + e.item.cdi.el; });
    const cdiEls = Object.keys(cdiKeys).length;
    const cdiOut = KC.spec.krcdi.filter(function (k) { return k.scope && !cdiKeys[k.cls + '|' + k.el]; }).length;
    const judge = U.groupCount(mapped, function (e) { return e.item.core.judge; });
    const argo = mapped.filter(function (e) { return argoOf(e); });
    const argoConf = U.groupCount(argo, function (e) { return argoOf(e).conf; });
    const cov = argoCoverage(entries).stat;
    const mc = mapped.filter(function (e) { return mcodeOf(e); });
    const mcLevel = U.groupCount(mapped, function (e) { return e.item.mcode.level; });
    const mcProfiles = Object.keys(U.groupCount(mc.filter(function (e) { return e.item.mcode.title; }), function (e) { return e.item.mcode.title; })).length;
    const om = mapped.filter(function (e) { return omopOf(e); });
    return {
      columns: entries.length, mapped: mapped.length, unmapped: entries.length - mapped.length,
      krcdi: cdi.length, krcdiElements: cdiEls, krcdiOutOfScope: cdiOut, krcdiGap: KC.spec.krcdi.length - cdiEls - cdiOut,
      mcodeConflict: mapped.filter(function (e) { return e.item.mcode.resConflict; }).length,
      review: mapped.filter(function (e) { return e.item.review && e.item.review.length; }).length,
      krcoreDirect: judge['직접재사용'] || 0, krcoreConstrained: judge['제약재사용'] || 0, krcoreExtension: judge['확장필요'] || 0,
      krcoreProfiles: Object.keys(U.groupCount(mapped, function (e) { return e.item.core.profile; })).length,
      mcode: mc.length, mcodeDirect: mcLevel['직접재사용'] || 0, mcodePartial: mcLevel['부분참조'] || 0,
      mcodeRef: (mcLevel['개념참조'] || 0) + (mcLevel['구조참조(KR-mCODE 자체정의)'] || 0), mcodeNone: mcLevel['미대응'] || 0,
      mcodeProfiles: mcProfiles, mcodeProfilesTotal: (KC.spec.data.mcode || { profiles: [] }).profiles.length,
      omop: om.length, omopConf: U.groupCount(om, function (e) { return omopOf(e).conf; }),
      omopTables: U.groupCount(om, function (e) { return omopOf(e).table; }),
      argo: argo.length, argoConf: argoConf, argoCoreHit: cov.coreHit, argoCore: cov.core, argoReqHit: cov.reqHit, argoReq: cov.req,
      argoCoreDerived: cov.coreDerived, argoCoreFixed: cov.coreFixed
    };
  }

  /* ---------- 패키지 ---------- */
  function csv(rows) { return U.toCsv(rows); }

  /** 암종 1개 메타데이터 패키지 → {files:[{path, title, std, content(string|Uint8Array), mime}], summary, dcatIssues} */
  function build(conf, cancer, entries) {
    const label = cancer || '선택항목';
    const slug = KC.dcat.slug(label);
    const items = entries.filter(function (e) { return e.item; }).map(function (e) { return e.item; });
    const sum = summarize(entries);
    const cov = argoCoverage(entries);
    const tpl = argoTemplates(entries);
    const mcov = mcodeCoverage(entries);
    const ocov = omopCoverage(entries);
    const confText = function (c) { return '높음 ' + (c['높음'] || 0) + ' · 중간 ' + (c['중간'] || 0) + ' · 낮음 ' + (c['낮음'] || 0) + (c['수동'] ? ' · 수동 ' + c['수동'] : ''); };
    const dc = KC.dcat.fromSpec(conf, [{ cancer: label, entries: entries }]);
    const lm = KC.artifacts.logicalModel(conf, label, entries);
    const files = [];
    const add = function (path, std, title, content, mime) { files.push({ path: path, std: std, title: title, content: content, mime: mime }); };

    const summaryRows = [['구분', '값', '비고'],
      ['암종', label, ''], ['원천 컬럼', sum.columns, '표준항목 연결 ' + sum.mapped + ' · 항목 미인식 ' + sum.unmapped],
      ['KR CDI 매칭 컬럼', sum.krcdi, 'KR CDI 80항목 중 ' + sum.krcdiElements + '개 항목에 매칭 · 범위외 ' + sum.krcdiOutOfScope + ' · 실제 미매칭 ' + sum.krcdiGap],
      ['KR Core 직접매칭', sum.krcoreDirect, '원래 판정: 직접재사용'], ['KR Core 조건부매칭', sum.krcoreConstrained, '추가 제약 필요 · 원래 판정: 제약재사용'], ['KR Core 확장필요', sum.krcoreExtension, '확장 설계 대상'],
      ['KR Core 프로파일 수', sum.krcoreProfiles, 'KR Core 및 KR-mCODE 후보 포함'],
      ['mCODE 매칭 컬럼', sum.mcode, '직접매칭 ' + sum.mcodeDirect + ' · 상위매칭 ' + sum.mcodePartial + ' · 참조매칭 ' + sum.mcodeRef + ' · 미매칭 ' + sum.mcodeNone],
      ['mCODE·KR Core 리소스 상이', sum.mcodeConflict, '기본 표현 규칙: KR Core 우선, KR Core 확장필요·mCODE 직접매칭이면 mCODE'],
      ['매핑 수정안 대상 컬럼', sum.review, 'spec/corrections.json (승인된 건만 명세 반영)'],
      ['mCODE 프로파일 충족', sum.mcodeProfiles + ' / ' + sum.mcodeProfilesTotal, 'mCODE STU4 데이터 사전 프로파일 기준'],
      ['OMOP CDM 매칭 컬럼', sum.omop, confText(sum.omopConf)],
      ['OMOP 사용 테이블', Object.keys(sum.omopTables).length, Object.keys(sum.omopTables).map(function (k) { return k + ' ' + sum.omopTables[k]; }).join(', ')],
      ['OMOP 필수 필드 충족', ocov.reqOk + ' / ' + ocov.req, '사용 테이블의 필수 필드(키·유형은 ETL 생성 포함)'],
      ['ICGC ARGO 매칭 컬럼', sum.argo, '높음 ' + (sum.argoConf['높음'] || 0) + ' · 중간 ' + (sum.argoConf['중간'] || 0) + ' · 낮음 ' + (sum.argoConf['낮음'] || 0) + (sum.argoConf['수동'] ? ' · 수동 ' + sum.argoConf['수동'] : '')],
      ['ARGO Core 필드 충족', sum.argoCoreHit + ' / ' + sum.argoCore, 'ID 계층 제외 · 직접 매칭만. 별도로 파생 가능 ' + sum.argoCoreDerived + ' · 제출 시 지정값 ' + sum.argoCoreFixed], ['ARGO Required 필드 충족', sum.argoReqHit + ' / ' + sum.argoReq, 'ID 계층 제외'],
      ['DCAT 필수속성 누락', dc.issues.filter(function (x) { return x.level === '오류'; }).length, 'NIA 가이드 [표 5]'],
      ['기준 명세', KC.spec.data.meta.source, KC.spec.data.meta.stageNote], ['mCODE', 'mCODE STU4', KC.spec.data.meta.mcodeNote || ''],
      ['OMOP 매핑', 'OMOP CDM v5.4', KC.spec.data.meta.omopNote || ''], ['ARGO 매핑', 'ICGC ARGO v1.34', KC.spec.data.meta.argoNote || ''],
      ['생성', U.nowIso(), 'K-CURE 표준변환기 ' + KC.APP_VERSION], ['', '', ''], ['매칭 용어', '뜻', '원래 판정']].concat(KC.match.LEGEND.map(function (x) { return x.slice(); }));

    const W = function (n) { return new Array(n).fill(18); };
    add('00_통합_메타데이터.xlsx', '통합', '통합 메타데이터 정의서 (엑셀 12개 시트)', KC.writers.xlsx([
      { name: '00_요약', title: 'K-CURE ' + label + ' 컬럼 메타데이터 변환 요약', rows: summaryRows, widths: [24, 36, 70] },
      { name: '01_항목메타데이터_통합', title: '컬럼별 KR CDI · KR Core · mCODE · OMOP · DCAT · ARGO 메타데이터', rows: integratedRows(entries), widths: [6, 22, 18, 22, 36].concat(W(44), [50]) },
      { name: '02_KR_CDI', title: 'KR CDI V3 80항목 매칭 (이 암종 컬럼 기준)', rows: krcdiRows(entries), widths: [6, 18, 18, 22, 8, 12, 20, 34, 50, 8, 26] },
      { name: '03_KR_Core', title: 'KR Core V2 프로파일·경로별 컬럼', rows: krcoreRows(entries), widths: [40, 50, 16, 40, 18, 10, 60, 24] },
      { name: '04_mCODE_매핑', title: 'mCODE STU4 매칭 (항목정의서 v2.4 기준)', rows: mcodeMapRows(entries), widths: [22, 18, 22, 32, 50, 34, 26, 14, 14, 34, 10, 20, 40, 24] },
      { name: '05_mCODE_프로파일', title: 'mCODE STU4 프로파일 충족 현황', rows: mcov.profiles, widths: [36, 60, 10, 10, 10, 10, 10, 60, 10] },
      { name: '06_mCODE_데이터요소', title: 'mCODE STU4 데이터요소 충족 현황', rows: mcov.elements, widths: [34, 30, 20, 10, 20, 36, 50] },
      { name: '07_OMOP_ETL매핑', title: 'OMOP CDM v5.4 매칭 (규칙 기반 후보 · ETL 명세)', rows: omopMapRows(entries), widths: [22, 18, 22, 10, 20, 24, 10, 24, 22, 26, 26, 50, 8, 40] },
      { name: '08_OMOP_필드커버리지', title: 'OMOP CDM 사용 테이블의 필드 충족 현황', rows: ocov.rows, widths: [22, 28, 6, 10, 18, 50, 24] },
      { name: '09_DCAT_변수', title: 'DCAT 데이터셋 변수 정의 (ndi:profile)', rows: dcatRows(entries), widths: [22, 18, 22, 12, 10, 30, 24, 34, 24, 30, 36, 40] },
      { name: '10_ARGO_매핑', title: 'ICGC ARGO v1.34 매칭 (규칙 기반 후보)', rows: argoMapRows(entries), widths: [22, 18, 22, 10, 18, 30, 26, 10, 12, 10, 8, 40, 40, 8, 40] },
      { name: '11_ARGO_커버리지', title: 'ICGC ARGO 필드별 충족 현황', rows: cov.rows, widths: [20, 34, 30, 10, 12, 10, 40, 24] }
    ]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    add('KR_CDI/KRCDI_컬럼대응.csv', 'KR CDI V3', 'KR CDI 컬럼 매칭표', csv([['원천 컬럼', '항목ID', '표준항목명', 'KR CDI 분류', 'KR CDI 항목', '필수여부', '매칭유형', '원래 판정']].concat(
      entries.filter(function (e) { return e.item && e.item.cdi && e.item.cdi.el; }).map(function (e) { const c = e.item.cdi; return [e.col, e.item.id, e.item.name, c.cls, c.el, c.req, KC.match.label(c.match || '대응'), c.match || '']; }))), 'text/csv');
    add('KR_CDI/KRCDI_80항목_커버리지.csv', 'KR CDI V3', 'KR CDI 80항목 커버리지', csv(krcdiRows(entries)), 'text/csv');
    add('KR_CDI/ConceptMap_KCURE-KRCDI.json', 'KR CDI V3', 'FHIR ConceptMap (K-CURE→KR CDI)', JSON.stringify(KC.artifacts.toKrcdi(conf, items), null, 2), 'application/fhir+json');

    add('KR_Core/LogicalModel_' + slug + '.json', 'KR Core V2 · FHIR R4', 'FHIR 논리모델 (컬럼=요소, 4개 표준 mapping)', JSON.stringify(lm, null, 2), 'application/fhir+json');
    add('KR_Core/KRCore_프로파일별_컬럼.csv', 'KR Core V2 · FHIR R4', 'KR Core 프로파일·경로별 컬럼', csv(krcoreRows(entries)), 'text/csv');
    add('KR_Core/ConceptMap_KCURE-KRCore.json', 'KR Core V2 · FHIR R4', 'FHIR ConceptMap (K-CURE→KR Core 경로)', JSON.stringify(KC.artifacts.toKrcore(conf, items), null, 2), 'application/fhir+json');

    add('mCODE/mCODE_컬럼매핑.csv', 'mCODE STU4', 'mCODE 컬럼 매핑 (프로파일·경로·데이터요소)', csv(mcodeMapRows(entries)), 'text/csv');
    add('mCODE/mCODE_프로파일커버리지.csv', 'mCODE STU4', 'mCODE 프로파일 ' + mcov.profilesTotal + '종 충족 현황', csv(mcov.profiles), 'text/csv');
    add('mCODE/mCODE_데이터요소커버리지.csv', 'mCODE STU4', 'mCODE 데이터요소 충족 현황', csv(mcov.elements), 'text/csv');
    add('mCODE/ConceptMap_KCURE-mCODE.json', 'mCODE STU4', 'FHIR ConceptMap (K-CURE→mCODE)', JSON.stringify(KC.artifacts.toMcode(conf, items), null, 2), 'application/fhir+json');

    add('OMOP/OMOP_ETL매핑.csv', 'OMOP CDM v5.4', 'OMOP ETL 매핑 명세 (컬럼→테이블.필드)', csv(omopMapRows(entries)), 'text/csv');
    add('OMOP/OMOP_필드커버리지.csv', 'OMOP CDM v5.4', 'OMOP 사용 테이블 필드 충족 현황', csv(ocov.rows), 'text/csv');
    add('OMOP/source_to_concept_map_템플릿.csv', 'OMOP CDM v5.4', 'source_to_concept_map 작성 템플릿 (코드값 → concept_id)', csv(omopStcm(entries)), 'text/csv');
    add('OMOP/ConceptMap_KCURE-OMOP.json', 'OMOP CDM v5.4', 'FHIR ConceptMap (K-CURE→OMOP 테이블.필드)', JSON.stringify(KC.artifacts.toOmop(conf, entries), null, 2), 'application/fhir+json');

    add('DCAT/catalog_' + slug + '.rdf', 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', 'DCAT 카탈로그 (RDF/XML · One-윈도우 연계)', KC.dcat.toRdfXml(dc.graph), 'application/rdf+xml');
    add('DCAT/catalog_' + slug + '.ttl', 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', 'DCAT 카탈로그 (Turtle)', KC.dcat.toTurtle(dc.graph), 'text/turtle');
    add('DCAT/catalog_' + slug + '.jsonld', 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', 'DCAT 카탈로그 (JSON-LD)', KC.dcat.toJsonLd(dc.graph), 'application/ld+json');
    add('DCAT/DCAT_검증결과.csv', 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', 'DCAT 필수·권장 속성 검증', csv([['수준', '클래스', '속성', '내용', '노드']].concat(dc.issues.map(function (x) { return [x.level, x.cls, x.prop, x.msg, x.node]; }))), 'text/csv');

    add('ARGO/ARGO_컬럼매핑.csv', 'ICGC ARGO v1.34', 'ARGO 컬럼 매핑 (후보)', csv(argoMapRows(entries)), 'text/csv');
    add('ARGO/ARGO_필드커버리지.csv', 'ICGC ARGO v1.34', 'ARGO 245필드 충족 현황', csv(cov.rows), 'text/csv');
    add('ARGO/ConceptMap_KCURE-ARGO.json', 'ICGC ARGO v1.34', 'FHIR ConceptMap (K-CURE→ARGO)', JSON.stringify(KC.artifacts.toArgo(conf, entries), null, 2), 'application/fhir+json');
    add('ARGO/submission_templates/_채우기_안내.csv', 'ICGC ARGO v1.34', 'ARGO 제출 템플릿 채우기 안내', csv(tpl.guide), 'text/csv');
    tpl.files.forEach(function (f) { add('ARGO/submission_templates/' + f.name, 'ICGC ARGO v1.34', 'ARGO 제출 템플릿 ' + f.name, f.content, 'text/tab-separated-values'); });

    add('README.txt', '안내', '패키지 안내', [
      'K-CURE ' + label + ' 컬럼 메타데이터 패키지',
      '생성: ' + U.nowIso() + ' / K-CURE 표준변환기 ' + KC.APP_VERSION,
      '기준 명세: ' + KC.spec.data.meta.source + ' (' + KC.spec.data.meta.stageNote + ')',
      'ARGO: ' + (KC.spec.data.meta.argoNote || ''),
      '',
      '00_통합_메타데이터.xlsx  컬럼별 6개 표준 대응을 한 표로 정리(요약·KR CDI·KR Core·mCODE·OMOP·DCAT·ARGO 시트)',
      'KR_CDI/    KR CDI V3 대응표, 80항목 커버리지, FHIR ConceptMap',
      'KR_Core/   FHIR 논리모델(StructureDefinition, kind=logical — 컬럼=요소, element.mapping에 KR Core/KR CDI/mCODE/OMOP/ARGO), 프로파일별 컬럼, ConceptMap',
      'mCODE/     mCODE STU4 컬럼 매핑(프로파일 URL·데이터요소), 프로파일·데이터요소 충족 현황, ConceptMap',
      'OMOP/      OMOP CDM v5.4 ETL 매핑 명세(테이블·필드·개념/일자/원천값 필드·권장 어휘), 필드 충족 현황, source_to_concept_map 템플릿, ConceptMap',
      'DCAT/      국가 데이터 카탈로그(DCAT-AP 2.1 + NIA ndi 확장) — 컬럼 정의는 ndi:profile(JSON)',
      'ARGO/      ICGC ARGO v1.34 컬럼 매핑(후보), 245필드 커버리지, ConceptMap, 제출 템플릿(TSV)과 채우기 안내',
      '',
      '매칭 용어: ' + KC.match.legendText(),
      '  표의 매칭유형은 모든 표준에 같은 척도로 표시했고, 항목정의서의 원래 판정(직접재사용·제약재사용 등)은 \'원래 판정\' 열에 남겼습니다.',
      '',
      '주의: 모든 매핑은 후보 단계입니다. KR CDI·KR Core·mCODE는 규칙승인(L3 미검증), OMOP·ARGO는 규칙 기반 자동 후보로 전문가 검토가 필요합니다.',
      'OMOP: 테이블·필드 수준 매핑입니다. 개념 ID(concept_id)는 Athena 어휘와 source_to_concept_map 템플릿으로 별도 매핑합니다.',
      'ARGO는 날짜 대신 진단일 기준 경과일(interval)을 쓰므로 일자 컬럼은 변환이 필요합니다(변환·주의 열 참고).'
    ].join('\r\n'), 'text/plain');

    files.forEach(function (f) { f.bytes = typeof f.content === 'string' ? U.byteLength(f.content) : f.content.length; });
    return { files: files, summary: sum, dcatIssues: dc.issues, cancer: label };
  }

  function toZip(pkgs) {
    const list = [];
    pkgs.forEach(function (p) {
      const root = 'KCURE_' + p.cancer + '_메타데이터/';
      p.files.forEach(function (f) { list.push({ name: (pkgs.length > 1 ? root : '') + f.path, content: f.content }); });
    });
    return KC.writers.zip(list);
  }

  return {
    entriesForCancer: entriesForCancer, entriesFromColumns: entriesFromColumns, entriesFromSpecSheet: entriesFromSpecSheet,
    argoOf: argoOf, argoField: argoField, argoValues: argoValues, omopOf: omopOf, omopField: omopField, mcodeOf: mcodeOf,
    summarize: summarize, build: build, toZip: toZip,
    integratedRows: integratedRows, argoCoverage: argoCoverage, mcodeCoverage: mcodeCoverage, omopCoverage: omopCoverage, omopStcm: omopStcm
  };
})();
