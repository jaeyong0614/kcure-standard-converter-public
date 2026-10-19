/* 항목정의(명세) 수준 산출물: FHIR ConceptMap 2종, 매핑 명세 CSV */
window.KC = window.KC || {};

KC.artifacts = (function () {
  'use strict';
  const U = KC.util;
  const KRCDI_URI = 'https://www.khis.or.kr/krcdi/v3';

  function header(base, id, title, desc, conf) {
    return {
      resourceType: 'ConceptMap', id: id, url: base + 'ConceptMap/' + id, version: KC.spec.data.meta.source,
      name: id.replace(/(^|-)([a-z])/g, function (m, a, b) { return b.toUpperCase(); }), title: title,
      status: 'draft', experimental: true, date: U.today(), publisher: conf.publisherName || '[확인 필요]',
      description: desc + ' ' + KC.spec.data.meta.stageNote + '.'
    };
  }

  function toKrcdi(conf, items) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const cm = header(base, 'kcure-to-krcdi', 'K-CURE 표준항목 → KR CDI V3 항목 대응',
      'K-CURE 9개 암종 표준항목과 KR CDI V3(14분류·80항목) 간 대응. 직접대응=equivalent, 부분대응(상위 항목으로만 교류)=wider.', conf);
    cm.sourceUri = base + 'CodeSystem/kcure-item';
    cm.targetUri = KRCDI_URI;
    const els = items.filter(function (it) { return it.cdi && it.cdi.el; }).map(function (it) {
      const def = KC.spec.krcdiByKey[it.cdi.cls + '|' + it.cdi.el];
      return {
        code: it.id, display: it.name,
        target: [{
          code: def ? 'KRCDI-' + String(def.no).padStart(2, '0') : it.cdi.el, display: it.cdi.cls + ' / ' + it.cdi.el,
          equivalence: it.cdi.match === '직접대응' ? 'equivalent' : it.cdi.match === '부분대응' ? 'wider' : 'relatedto',
          comment: '필수여부 ' + (it.cdi.req || '-') + ' · 대응유형 ' + (it.cdi.match || '미상') + ' · 심사등급 ' + (it.grade || '-')
        }]
      };
    });
    cm.group = [{ source: base + 'CodeSystem/kcure-item', target: KRCDI_URI, element: els }];
    return cm;
  }

  function toKrcore(conf, items) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const cm = header(base, 'kcure-to-krcore', 'K-CURE 표준항목 → KR Core V2 / FHIR R4 경로 대응',
      '항목별 KR Core 프로파일과 FHIR 경로. 직접재사용=equivalent, 제약재사용=relatedto(추가 제약 필요), 확장필요=unmatched(확장 설계 대상).', conf);
    cm.sourceUri = base + 'CodeSystem/kcure-item';
    cm.targetUri = KC.spec.data.meta.krcoreBase;
    const groups = {};
    items.forEach(function (it) {
      const tgt = it.core.url || 'http://hl7.org/fhir/StructureDefinition/' + it.core.path.split('.')[0];
      const g = groups[tgt] = groups[tgt] || { source: base + 'CodeSystem/kcure-item', target: tgt, element: [] };
      const eq = it.core.judge === '직접재사용' ? 'equivalent' : it.core.judge === '확장필요' ? 'unmatched' : 'relatedto';
      const t = { equivalence: eq, comment: it.core.profile + ' · 판정 ' + it.core.judge + ' · mCODE ' + it.mcode.profile + ' ' + it.mcode.path + ' (' + it.mcode.level + ')' };
      if (eq !== 'unmatched') { t.code = it.core.path; t.display = it.core.path; }
      else t.comment = '대상 경로 후보 ' + it.core.path + ' · ' + t.comment;
      g.element.push({ code: it.id, display: it.name, target: [t] });
    });
    cm.group = Object.keys(groups).map(function (k) { return groups[k]; });
    return cm;
  }

  /** K-CURE → ICGC ARGO ConceptMap (규칙 기반 자동 후보) */
  function toArgo(conf, entries) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const cm = header(base, 'kcure-to-argo', 'K-CURE 표준항목 → ICGC ARGO Data Dictionary v1.34',
      '항목별 ARGO 스키마.필드 후보. 신뢰도 높음=equivalent, 중간=relatedto(값 변환 필요), 낮음=inexact. 규칙 기반 자동 후보로 전문가 검토 전.', conf);
    cm.description = cm.description.replace(KC.spec.data.meta.stageNote + '.', (KC.spec.data.meta.argoNote || '') + '.');
    cm.sourceUri = base + 'CodeSystem/kcure-item';
    cm.targetUri = 'https://docs.icgc-argo.org/dictionary';
    const groups = {};
    entries.forEach(function (e) {
      const a = KC.meta.argoOf(e);
      if (!e.item || !a) return;
      const g = groups[a.schema] = groups[a.schema] || { source: base + 'CodeSystem/kcure-item', target: 'https://docs.icgc-argo.org/dictionary#' + a.schema, element: [] };
      g.element.push({ code: e.item.id, display: e.item.name, target: [{
        code: a.schema + '.' + a.field, display: a.label,
        equivalence: a.conf === '높음' ? 'equivalent' : a.conf === '낮음' ? 'inexact' : 'relatedto',
        comment: 'ARGO ' + a.tier + (a.req ? '·' + a.req : '') + ' · ' + a.type + (a.note ? ' · 변환: ' + a.note : '') + ' · 신뢰도 ' + a.conf
      }] });
    });
    cm.group = Object.keys(groups).map(function (k) { return groups[k]; });
    return cm;
  }

  /** K-CURE → mCODE STU4 ConceptMap (항목정의서 v2.4 기준) */
  function toMcode(conf, items) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const cm = header(base, 'kcure-to-mcode', 'K-CURE 표준항목 → HL7 mCODE STU4',
      '항목별 mCODE 프로파일·FHIR 경로. 직접재사용=equivalent, 부분참조=wider, 개념·구조참조=relatedto, 미대응=unmatched.', conf);
    cm.sourceUri = base + 'CodeSystem/kcure-item';
    cm.targetUri = 'http://hl7.org/fhir/us/mcode';
    const groups = {};
    items.forEach(function (it) {
      const m = it.mcode;
      const none = !m.url || m.level === '미대응';
      const tgt = none ? 'http://hl7.org/fhir/us/mcode' : m.url;
      const g = groups[tgt] = groups[tgt] || { source: base + 'CodeSystem/kcure-item', target: tgt, element: [] };
      const eq = none ? 'unmatched' : m.level === '직접재사용' ? 'equivalent' : m.level === '부분참조' ? 'wider' : 'relatedto';
      const t = { equivalence: eq, comment: (m.title || m.profile) + ' · ' + m.level + (m.element ? ' · 데이터요소 ' + m.element : '') + (none ? ' · KR-mCODE 후보 ' + it.prf : '') };
      if (!none) { t.code = m.path; t.display = (m.title || m.profile) + ' ' + m.path; }
      g.element.push({ code: it.id, display: it.name, target: [t] });
    });
    cm.group = Object.keys(groups).map(function (k) { return groups[k]; });
    return cm;
  }

  /** K-CURE → OMOP CDM v5.4 ConceptMap (테이블.필드, 규칙 기반 후보) */
  function toOmop(conf, entries) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const cm = header(base, 'kcure-to-omop', 'K-CURE 표준항목 → OMOP CDM v5.4 (테이블.필드)',
      'ETL 대상 테이블·필드. 신뢰도 높음=equivalent, 중간=relatedto, 낮음=inexact. 개념 ID는 Athena 어휘로 별도 매핑.', conf);
    cm.description = cm.description.replace(KC.spec.data.meta.stageNote + '.', (KC.spec.data.meta.omopNote || '') + '.');
    cm.sourceUri = base + 'CodeSystem/kcure-item';
    cm.targetUri = 'https://ohdsi.github.io/CommonDataModel/cdm54.html';
    const groups = {};
    entries.forEach(function (e) {
      const o = KC.meta.omopOf(e);
      if (!e.item || !o) return;
      const g = groups[o.table] = groups[o.table] || { source: base + 'CodeSystem/kcure-item', target: 'https://ohdsi.github.io/CommonDataModel/cdm54.html#' + o.table, element: [] };
      g.element.push({ code: e.item.id, display: e.item.name, target: [{
        code: o.table + '.' + o.field, display: o.table + '.' + o.field,
        equivalence: o.conf === '높음' || o.conf === '수동' ? 'equivalent' : o.conf === '낮음' ? 'inexact' : 'relatedto',
        comment: (o.concept ? '개념 필드 ' + o.concept : 'person 필드') + (o.vocab && o.vocab !== '-' ? ' · 어휘 ' + o.vocab : '') + (o.note ? ' · ' + o.note : '') + ' · 신뢰도 ' + o.conf
      }] });
    });
    cm.group = Object.keys(groups).map(function (k) { return groups[k]; });
    return cm;
  }

  /** 암종 데이터셋 = FHIR 논리모델(StructureDefinition kind=logical). 각 컬럼을 요소로, KR Core·KR CDI·mCODE·ARGO 대응을 element.mapping 으로 표현 */
  function logicalModel(conf, cancer, entries) {
    const base = conf.kcureBase || KC.spec.data.meta.kcureBase;
    const slug = KC.dcat.slug(cancer);
    const name = 'KCURE' + slug.charAt(0).toUpperCase() + slug.slice(1) + 'Dataset';
    const id = 'kcure-' + slug + '-dataset';
    const url = base + 'StructureDefinition/' + id;
    const root = name;
    const FT = { DATE: 'date', INTEGER: 'integer', NUMERIC: 'decimal', CODE: 'Coding', VARCHAR: 'string' };
    const els = [{ id: root, path: root, short: 'K-CURE ' + cancer + ' 데이터셋 (컬럼 ' + entries.length + '개)', definition: 'K-CURE ' + cancer + ' 임상 데이터 컬럼 정의. ' + KC.spec.data.meta.stageNote + '.', min: 0, max: '*' }];
    const usedNames = {};
    entries.forEach(function (e) {
      const it = e.item;
      let en = (it ? it.id : 'col_' + e.col).replace(/[^A-Za-z0-9]/g, '_');
      if (usedNames[en]) en += '_' + Object.keys(usedNames).length;
      usedNames[en] = 1;
      const el = { id: root + '.' + en, path: root + '.' + en, label: e.col, min: 0, max: '1' };
      if (!it) {
        Object.assign(el, { short: e.col, definition: '원천 컬럼(K-CURE 표준항목 미매핑)', type: [{ code: 'string' }] });
        els.push(el);
        return;
      }
      el.code = [{ system: base + 'CodeSystem/kcure-item', code: it.id, display: it.name }];
      el.short = it.name;
      el.definition = it.def || it.name;
      el.comment = [it.cat1 + '/' + it.cat2, it.unit ? '단위 ' + it.unit : '', it.allowed ? '허용값 ' + it.allowed : '', '필수여부 ' + it.req].filter(Boolean).join(' · ');
      if (it.req === '필수') el.min = 1;
      el.type = [{ code: FT[it.type] || 'string' }];
      if (it.type === 'VARCHAR' && it.len) el.maxLength = it.len;
      el.mapping = [{ identity: 'krcore', map: it.core.path, comment: it.core.profile + ' [' + it.core.judge + ']' }];
      if (it.cdi && it.cdi.el) el.mapping.push({ identity: 'krcdi', map: it.cdi.cls + '.' + it.cdi.el, comment: '필수여부 ' + it.cdi.req + (it.cdi.match ? ' · ' + it.cdi.match : '') });
      if (it.mcode.path && it.mcode.path !== '해당 없음') el.mapping.push({ identity: 'mcode', map: it.mcode.path, comment: (it.mcode.title || it.mcode.profile) + ' [' + it.mcode.level + ']' + (it.mcode.element ? ' · ' + it.mcode.element : '') });
      const o = KC.meta.omopOf(e);
      if (o) el.mapping.push({ identity: 'omop', map: o.table + '.' + o.field, comment: '개념 ' + o.concept + (o.vocab && o.vocab !== '-' ? ' · ' + o.vocab : '') + ' · 신뢰도 ' + o.conf });
      const a = KC.meta.argoOf(e);
      if (a) el.mapping.push({ identity: 'argo', map: a.schema + '.' + a.field, comment: 'ARGO ' + a.tier + ' · 신뢰도 ' + a.conf + (a.note ? ' · ' + a.note : '') });
      els.push(el);
    });
    return {
      resourceType: 'StructureDefinition', id: id, url: url, version: KC.spec.data.meta.source, name: name,
      title: 'K-CURE ' + cancer + ' 데이터셋 논리모델', status: 'draft', experimental: true, date: U.today(),
      publisher: conf.publisherName || '[확인 필요]',
      description: 'K-CURE ' + cancer + ' 컬럼을 FHIR 논리모델로 표현하고 KR Core V2·KR CDI V3·mCODE STU4·ICGC ARGO v1.34 대응을 mapping으로 기술. ' + KC.spec.data.meta.stageNote + '. ' + (KC.spec.data.meta.argoNote || ''),
      fhirVersion: '4.0.1',
      mapping: [
        { identity: 'krcore', uri: KC.spec.data.meta.krcoreBase.replace(/StructureDefinition\/$/, ''), name: 'KR Core V2.0.0 (FHIR 경로)' },
        { identity: 'krcdi', uri: 'https://www.khis.or.kr/krcdi/v3', name: 'KR CDI V3 (분류.항목)' },
        { identity: 'mcode', uri: 'http://hl7.org/fhir/us/mcode', name: 'mCODE STU4' },
        { identity: 'omop', uri: 'https://ohdsi.github.io/CommonDataModel/cdm54.html', name: 'OMOP CDM v5.4 (테이블.필드)' },
        { identity: 'argo', uri: 'https://docs.icgc-argo.org/dictionary', name: 'ICGC ARGO Data Dictionary v1.34 (스키마.필드)' }
      ],
      kind: 'logical', abstract: false, type: url,
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Base', derivation: 'specialization',
      differential: { element: els }
    };
  }

  function specCsv(items) {
    const rows = [['항목ID', '표준항목명', '표준정의', '대분류', '중분류', '우선검토구분', 'mCODE도메인', '의미역할', '출현암종',
      '데이터타입', '길이', '단위', '코드여부', '표준코드명', '허용값', '필수여부', 'KR_CDI_분류', 'KR_CDI_항목', 'KR_CDI_필수', 'KR_CDI_대응유형',
      'KR_Core_Profile', 'KR_Core_Profile_URL', 'KR_Core_FHIR_Path', 'KR_Core_판정', 'mCODE_Profile', 'mCODE_FHIR_Path', 'mCODE_참조수준',
      'KR-mCODE_프로파일ID', '심사등급', '매핑확정단계', '정의결손코드', '원천별칭']];
    items.forEach(function (it) {
      const c = it.cdi || {};
      rows.push([it.id, it.name, it.def, it.cat1, it.cat2, it.tier, it.domain, it.role, it.cancers.join(' '), it.type, it.len || '', it.unit,
        it.codeYN, it.codeName, it.allowed, it.req, c.cls || '', c.el || '', c.req || '', c.match || '', it.core.profile, it.core.url,
        it.core.path, it.core.judge, it.mcode.profile, it.mcode.path, it.mcode.level, it.prf, it.grade, it.stage, it.gap,
        (it.aliases || []).map(function (a) { return a[0]; }).join(' | ')]);
    });
    return U.toCsv(rows);
  }

  return { toKrcdi: toKrcdi, toKrcore: toKrcore, toMcode: toMcode, toOmop: toOmop, toArgo: toArgo, logicalModel: logicalModel, specCsv: specCsv };
})();
