/* K-CURE 원천 데이터 → FHIR R4 Bundle (KR Core / KR-mCODE 후보 프로파일)
 *
 * 변환 원칙 (docs/01_개발계획서.md 4.1)
 *  - 리소스 그룹 = (리소스유형, 대분류, 중분류) × 환자 × 원천 행
 *  - Observation 은 값 항목 1개 = 리소스 1개, 일자·방법·부위·단위 항목은 같은 그룹 값 리소스에 일괄 적용
 *  - status / verificationStatus 경로 및 "여부" 항목이 코드 경로에 배정된 경우 → 별도 리소스(주 리소스 상태 오염 방지)
 *  - 자료형이 경로와 맞지 않으면 extension(item-{항목ID})으로 원문 보존 + 경고
 */
window.KC = window.KC || {};

KC.fhir = (function () {
  'use strict';
  const U = KC.util, V = KC.values;

  const SYS = {
    v2_0203: 'http://terminology.hl7.org/CodeSystem/v2-0203',
    actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    verStatus: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
    obsCat: 'http://terminology.hl7.org/CodeSystem/observation-category',
    dar: 'http://terminology.hl7.org/CodeSystem/data-absent-reason',
    roleCode: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
    loinc: 'http://loinc.org',
    ucum: 'http://unitsofmeasure.org',
    krnpi: 'http://www.hl7korea.or.kr/Identifier/hira-krnpi',
    kcd8: 'http://www.hl7korea.or.kr/CodeSystem/kostat-kcd-8',
    condCat: 'http://www.hl7korea.or.kr/fhir/krcore/CodeSystem/krcore-condition-category-types'
  };

  const CODE_SYSTEM_SLUG = {
    '성별코드': 'sex', '여부코드': 'yes-no-unknown', '암종코드': 'cancer-type', '진단경로코드': 'diagnosis-route',
    '가족관계코드': 'family-relationship', '재발부위코드': 'recurrence-site', 'ECOG코드': 'ecog', 'ASA등급코드': 'asa-class',
    '질환종류코드': 'disease-type', '치료유형코드': 'treatment-type', '부작용등급코드': 'ae-grade', '방사선치료반응코드': 'rt-response',
    '날짜형식코드': 'date-format', '기타내용코드': 'other-text'
  };

  const UCUM = {
    'cm': 'cm', 'mm': 'mm', 'm': 'm', 'kg': 'kg', 'g': 'g', 'mg': 'mg', 'ml': 'mL', 'mL': 'mL', 'L': 'L', '%': '%',
    'kg/m2': 'kg/m2', 'kg/m²': 'kg/m2', 'm2': 'm2', 'm²': 'm2', 'mg/dL': 'mg/dL', 'g/dL': 'g/dL', 'ng/mL': 'ng/mL',
    'U/L': 'U/L', 'IU/L': '[IU]/L', 'U/mL': 'U/mL', 'Gy': 'Gy', 'cGy': 'cGy', 'mmHg': 'mm[Hg]', '세': 'a', '년': 'a',
    '년(연)': 'a', '개월': 'mo', '월': 'mo', '주': 'wk', '일': 'd', '시간': 'h', '분': 'min', '초': 's', '회': '{times}',
    '개': '{count}', '명': '{count}', '회/월': '{times}/mo', '병/회': '{bottle}/{times}', '갑/일': '{pack}/d', '/mm3': '/mm3'
  };

  const VITAL = {
    'krcore-bodyweight': { code: '29463-7', display: 'Body weight', unit: 'kg' },
    'krcore-bodyheight': { code: '8302-2', display: 'Body height', unit: 'cm' }
  };

  /* ---------- 경로 분류 ---------- */
  const DATE_PATH = /(DateTime|Date|\.date|authoredOn|issued|period\.(start|end)|performedPeriod|birthDate)$/;
  const DATE_TARGET = {
    Observation: 'Observation.effectiveDateTime', DiagnosticReport: 'DiagnosticReport.effectiveDateTime',
    Procedure: 'Procedure.performedDateTime', Condition: 'Condition.recordedDate', MedicationRequest: 'MedicationRequest.authoredOn',
    AdverseEvent: 'AdverseEvent.date', Encounter: 'Encounter.period.start', FamilyMemberHistory: 'FamilyMemberHistory.date',
    Specimen: 'Specimen.collection.collectedDateTime', Immunization: 'Immunization.occurrenceDateTime'
  };
  const FLAG_CODE_PATHS = ['Condition.code', 'FamilyMemberHistory.condition.code', 'AdverseEvent.event', 'Procedure.code',
    'MedicationRequest.medicationCodeableConcept', 'Immunization.vaccineCode', 'Observation.code'];
  const OBS_MOD = ['Observation.effectiveDateTime', 'Observation.method', 'Observation.bodySite', 'Observation.note', 'Observation.valueQuantity.unit'];

  function create(opts, log) {
    const base = opts.kcureBase || KC.spec.data.meta.kcureBase;
    const ITEM_CS = base + 'CodeSystem/kcure-item';
    const STAGE_TAG = { system: base + 'CodeSystem/mapping-stage', code: 'rule-approved-candidate', display: '규칙승인(후보) — 항목별 의미검증(L3) 미실시' };
    const ctx = { patients: new Map(), orgs: new Map(), entries: [], stats: {} };

    /* ---------- 데이터형 생성기 ---------- */
    function itemCoding(it) { return { system: ITEM_CS, code: it.id, display: it.name }; }
    function codeSystemFor(it) {
      const slug = CODE_SYSTEM_SLUG[it.codeName];
      return base + 'CodeSystem/' + (slug || (it.id.toLowerCase() + '-codes'));
    }
    function ccFromNorm(n, it) {
      if (n.code) return { coding: [{ system: codeSystemFor(it), code: String(n.code.code), display: n.code.label }], text: n.code.label };
      return { text: n.str };
    }
    function itemCC(it) { return { coding: [itemCoding(it)], text: it.name }; }
    /** 리소스의 주 코드(Condition.code 등): 짧은 코드값·수치(예: G1, 2)만으로는 개념을 알 수 없으므로 항목명을 함께 표기 */
    function primaryCC(n, it) {
      const cc = ccFromNorm(n, it);
      if (!n.code && (n.str.length <= 4 || n.num != null)) cc.text = it.name + ': ' + n.str;
      return cc;
    }
    function quantity(num, unitRaw) {
      const q = { value: num };
      const u = (unitRaw || '').trim();
      if (u) {
        q.unit = u;
        if (UCUM[u]) { q.system = SYS.ucum; q.code = UCUM[u]; }
      }
      return q;
    }
    function dar(code) { return { coding: [{ system: SYS.dar, code: code || 'unknown', display: code === 'asked-unknown' ? 'Asked But Unknown' : 'Unknown' }] }; }
    function annotation(it, n) { return { text: it.name + ': ' + n.str }; }
    function dateVal(n) { return n.dateTime || n.date; }
    function extUrl(it) { return base + 'StructureDefinition/item-' + it.id; }
    function itemExtension(it, n) {
      const e = { url: extUrl(it) };
      if (n.kind === 'date') e.valueDateTime = dateVal(n);
      else if (n.kind === 'flag' && n.flag != null) e.valueBoolean = n.flag;
      else if ((n.kind === 'int') && n.num != null) e.valueInteger = n.num;
      else if (n.kind === 'num' && n.num != null) e.valueDecimal = n.num;
      else if (n.code) e.valueCodeableConcept = ccFromNorm(n, it);
      else e.valueString = n.str;
      return e;
    }
    function trace(res, it) {
      if (!opts.traceItems) return;
      res.extension = res.extension || [];
      res.extension.push({ url: base + 'StructureDefinition/source-item', valueCoding: itemCoding(it) });
    }
    function addExt(res, it, n) {
      res.extension = res.extension || [];
      res.extension.push(itemExtension(it, n));
    }

    /* ---------- 리소스 생성 ---------- */
    function newRes(type, seedParts) {
      const fullUrl = 'urn:uuid:' + U.hexToUuid(KC.sha256(seedParts.join('|')));
      const res = { resourceType: type };
      if (opts.bundleType === 'collection') res.id = fullUrl.slice(9);
      res.meta = { profile: [], tag: [STAGE_TAG] };
      return { fullUrl: fullUrl, resource: res };
    }
    function setProfile(res, urls) {
      const counts = {};
      urls.filter(Boolean).forEach(function (u) { counts[u] = (counts[u] || 0) + 1; });
      const best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      if (best && opts.metaProfile) res.meta.profile = [best];
      else delete res.meta.profile;
    }
    function push(entry) {
      ctx.entries.push(entry);
      const t = entry.resource.resourceType;
      ctx.stats[t] = (ctx.stats[t] || 0) + 1;
    }
    function ref(entry) { return { reference: entry.fullUrl }; }

    /* ---------- Patient / Organization ---------- */
    function getPatient(key, pid) {
      if (ctx.patients.has(key)) return ctx.patients.get(key);
      const e = newRes('Patient', ['Patient', key]);
      e.resource.identifier = [{
        type: { coding: [{ system: SYS.v2_0203, code: 'MR' }] },
        system: opts.pseudonymize ? base + 'Identifier/patient-pseudonym' : (opts.patientIdSystem || base + 'Identifier/patient'),
        value: pid
      }];
      e.resource.meta.profile = opts.metaProfile ? [KC.spec.data.meta.krcoreBase + 'krcore-patient'] : undefined;
      if (!e.resource.meta.profile) delete e.resource.meta.profile;
      ctx.patients.set(key, e);
      push(e);
      return e;
    }

    function applyPatient(pe, it, n, c) {
      const p = pe.resource;
      const path = c.path;
      trace(p, it);
      if (path === 'Patient.identifier') {
        const idLike = /번호|등록|식별|ID$|^id|^no_|_no$|identifier/i.test(it.name);
        if (it.role !== '식별·인구학' || !idLike || n.kind === 'date' || n.kind === 'flag') {
          addExt(p, it, n);
          log.warn('PATH_UNSUITABLE', '식별자 경로(Patient.identifier)에 식별자가 아닌 항목이 배정됨 → 확장으로 보존', c.ctx);
          return;
        }
        if (c.isKey) return; // 키 컬럼은 getPatient 에서 이미 설정
        const val = opts.pseudonymize ? KC.sha256(opts.salt + '|' + n.str).slice(0, 32) : n.str;
        if (!p.identifier.some(function (x) { return x.value === val; })) {
          p.identifier.push({ system: base + 'Identifier/' + it.id + (opts.pseudonymize ? '-pseudonym' : ''), value: val });
        }
        return;
      }
      // 가명처리 OFF(원문 반출을 담당자가 선택)일 때 직접식별자를 정규 요소로 표현
      if (path === 'Patient.name') { (p.name = p.name || []).push({ text: n.str }); return; }
      if (path === 'Patient.telecom') {
        (p.telecom = p.telecom || []).push(/@/.test(n.str) ? { system: 'email', value: n.str } : { system: 'phone', value: n.str });
        return;
      }
      if (path === 'Patient.address') { (p.address = p.address || []).push({ text: n.str }); return; }
      if (path === 'Patient.gender') {
        const k = String(n.code ? n.code.code : n.str).toUpperCase();
        const g = { M: 'male', '1': 'male', '남': 'male', '남성': 'male', MALE: 'male', F: 'female', '0': 'female', '2': 'female', '여': 'female', '여성': 'female', FEMALE: 'female', U: 'unknown', '99': 'unknown', '9': 'unknown', O: 'other' }[k];
        if (g) p.gender = g;
        else { p.gender = 'unknown'; log.warn('GENDER_MAP', '성별 코드를 FHIR AdministrativeGender로 변환할 수 없어 unknown 처리', c.ctx); }
        return;
      }
      if (path === 'Patient.birthDate') {
        if (n.kind === 'date') {
          p.birthDate = opts.pseudonymize && opts.birthYearOnly ? n.date.slice(0, 4) : n.date;
        } else {
          addExt(p, it, n);
          log.warn('TYPE_MISMATCH', 'birthDate 경로에 날짜가 아닌 값(예: 나이) → 확장으로 보존', c.ctx);
        }
        return;
      }
      if (path === 'Patient.deceasedDateTime') {
        if (n.kind === 'date') p.deceasedDateTime = dateVal(n); else addExt(p, it, n);
        return;
      }
      addExt(p, it, n);
      log.warn('PATH_UNSUPPORTED', '지원하지 않는 Patient 경로 → 확장으로 보존: ' + path, c.ctx);
    }

    function getOrg(value, c) {
      if (ctx.orgs.has(value)) return ctx.orgs.get(value);
      const e = newRes('Organization', ['Organization', value]);
      e.resource.identifier = [{ system: SYS.krnpi, value: value }];
      if (opts.metaProfile) e.resource.meta.profile = [KC.spec.data.meta.krcoreBase + 'krcore-healthcare-organization'];
      else delete e.resource.meta.profile;
      trace(e.resource, c.item);
      ctx.orgs.set(value, e);
      push(e);
      return e;
    }

    /* ---------- 공통 setter (경로 → 리소스) ---------- */
    // 반환: 'ok' | 'mismatch' | 'unsupported' | 'occupied'
    function setPath(res, path, it, n) {
      const f = path.split('.').slice(1).join('.');
      const isDate = n.kind === 'date';
      const single = function (key, val) { if (res[key] !== undefined) return 'occupied'; res[key] = val; return 'ok'; };
      const arr = function (key, val) { (res[key] = res[key] || []).push(val); return 'ok'; };
      switch (res.resourceType + '.' + f) {
        // 날짜류
        case 'Observation.effectiveDateTime': case 'DiagnosticReport.effectiveDateTime': case 'Procedure.performedDateTime':
        case 'Condition.recordedDate': case 'Condition.onsetDateTime': case 'MedicationRequest.authoredOn':
        case 'AdverseEvent.date': case 'FamilyMemberHistory.date': case 'Immunization.occurrenceDateTime': {
          if (!isDate) return 'mismatch';
          return single(f, dateVal(n));
        }
        case 'DiagnosticReport.issued': {
          // instant 형식은 시각까지 필요 → 일자만 있으면 00:00(+09:00)으로 보완
          const v = !isDate ? null : n.dateTime || (n.date.length === 10 ? n.date + 'T00:00:00+09:00' : null);
          return v ? single('issued', v) : 'mismatch';
        }
        case 'Specimen.collection.collectedDateTime':
          if (!isDate) return 'mismatch';
          res.collection = res.collection || {};
          if (res.collection.collectedDateTime) return 'occupied';
          res.collection.collectedDateTime = dateVal(n); return 'ok';
        case 'Encounter.period.start': case 'Encounter.period.end': {
          if (!isDate) return 'mismatch';
          const k = f.split('.')[1];
          res.period = res.period || {};
          if (res.period[k]) return 'occupied';
          res.period[k] = dateVal(n); return 'ok';
        }
        case 'Procedure.performedPeriod': {
          if (!isDate) return 'mismatch';
          res.performedPeriod = res.performedPeriod || {};
          const k = /종료|end|finish/i.test(it.name) ? 'end' : 'start';
          if (res.performedPeriod[k]) return 'occupied';
          res.performedPeriod[k] = dateVal(n); return 'ok';
        }
        // CodeableConcept 단일 — 리소스 주 코드
        case 'Condition.code': case 'Procedure.code': case 'DiagnosticReport.code':
        case 'MedicationRequest.medicationCodeableConcept': case 'AdverseEvent.event': case 'Immunization.vaccineCode':
          return single(f, primaryCC(n, it));
        case 'Procedure.outcome': case 'AdverseEvent.severity': case 'Specimen.type':
        case 'Observation.method': case 'Observation.bodySite':
          return single(f, ccFromNorm(n, it));
        // CodeableConcept 배열
        case 'Condition.bodySite': case 'Procedure.bodySite': case 'Procedure.complication': case 'DiagnosticReport.conclusionCode':
          return arr(f, ccFromNorm(n, it));
        case 'Condition.stage.summary':
          return arr('stage', { summary: ccFromNorm(n, it) });
        // 문자열
        case 'DiagnosticReport.conclusion':
          res.conclusion = res.conclusion ? res.conclusion + '\n' + it.name + ': ' + n.str : (it.name + ': ' + n.str);
          return 'ok';
        // 주석
        case 'Procedure.note': case 'Condition.note': case 'Observation.note': case 'FamilyMemberHistory.note':
          return arr('note', annotation(it, n));
        // 투약
        case 'MedicationRequest.dosageInstruction.text': {
          res.dosageInstruction = res.dosageInstruction || [{}];
          const d = res.dosageInstruction[0];
          d.text = d.text ? d.text + '; ' + it.name + ': ' + n.str : it.name + ': ' + n.str;
          return 'ok';
        }
        case 'MedicationRequest.dosageInstruction.route': {
          res.dosageInstruction = res.dosageInstruction || [{}];
          if (res.dosageInstruction[0].route) return 'occupied';
          res.dosageInstruction[0].route = ccFromNorm(n, it); return 'ok';
        }
        case 'MedicationRequest.dosageInstruction.doseAndRate.doseQuantity': {
          if (n.num == null) return 'mismatch';
          res.dosageInstruction = res.dosageInstruction || [{}];
          const d = res.dosageInstruction[0];
          if (d.doseAndRate) return 'occupied';
          d.doseAndRate = [{ doseQuantity: quantity(n.num, it.unit) }]; return 'ok';
        }
        case 'MedicationRequest.dosageInstruction.timing.repeat.frequency': {
          if (n.num == null || !Number.isInteger(n.num)) return 'mismatch';
          res.dosageInstruction = res.dosageInstruction || [{}];
          res.dosageInstruction[0].timing = { repeat: { frequency: n.num } }; return 'ok';
        }
        case 'MedicationRequest.dispenseRequest.expectedSupplyDuration':
          if (n.num == null) return 'mismatch';
          res.dispenseRequest = { expectedSupplyDuration: { value: n.num, unit: '일', system: SYS.ucum, code: 'd' } }; return 'ok';
        case 'MedicationRequest.dosageInstruction.doseAndRate.doseQuantity.unit':
          res._pendingUnit = n.str; return 'ok';
        case 'Medication.ingredient.itemCodeableConcept':
          return arr('ingredient', { itemCodeableConcept: ccFromNorm(n, it) });
        case 'AdverseEvent.suspectEntity.instance':
          return arr('suspectEntity', { instance: { display: it.name + ': ' + n.str } });
        case 'FamilyMemberHistory.condition.code':
          return arr('condition', { code: primaryCC(n, it) });
        case 'Encounter.class': {
          if (res.class) return 'occupied';
          const k = n.str.toLowerCase();
          const map = { '입원': 'IMP', 'inpatient': 'IMP', 'imp': 'IMP', '외래': 'AMB', 'outpatient': 'AMB', 'amb': 'AMB', '응급': 'EMER', 'emergency': 'EMER', 'emer': 'EMER' };
          const code = map[k];
          res.class = code ? { system: SYS.actCode, code: code } : { system: codeSystemFor(it), code: n.str, display: n.str };
          if (!code) res._classUnmapped = true;
          return 'ok';
        }
        case 'Encounter.status': {
          const k = n.str.toLowerCase();
          const map = { finished: 'finished', '퇴원': 'finished', '완료': 'finished', 'in-progress': 'in-progress', '재원': 'in-progress', cancelled: 'cancelled', '취소': 'cancelled', planned: 'planned', arrived: 'arrived', unknown: 'unknown' };
          if (!map[k]) return 'mismatch';
          return single('status', map[k]);
        }
        case 'Organization.identifier':
          return arr('identifier', { system: SYS.krnpi, value: n.str });
        default:
          return 'unsupported';
      }
    }

    /* ---------- 상태·여부 → 별도 리소스 ---------- */
    function flagResource(type, c, seed, patientEntry) {
      const it = c.item, n = c.norm;
      const label = it.name.replace(/\s*(여부|유무)$/, '').replace(/_yn$/i, '') || it.name;
      const e = newRes(type, seed);
      const r = e.resource;
      const f = n.flag;
      const codeCC = { coding: [itemCoding(it)], text: label };
      switch (type) {
        case 'Condition':
          r.verificationStatus = { coding: [{ system: SYS.verStatus, code: f === true ? 'confirmed' : f === false ? 'refuted' : 'unconfirmed' }] };
          r.code = codeCC; r.subject = ref(patientEntry);
          break;
        case 'Procedure':
          if (f === undefined) {
            r.status = 'unknown';
            r.note = [annotation(it, n)];
            log.warn('STATUS_FREE_TEXT', '상태(status) 경로에 여부가 아닌 값 → status=unknown, 원문은 note로 보존', c.ctx);
          } else r.status = f === true ? 'completed' : f === false ? 'not-done' : 'unknown';
          r.code = codeCC; r.subject = ref(patientEntry);
          break;
        case 'MedicationRequest':
          r.status = f === true ? 'completed' : f === false ? 'cancelled' : 'unknown';
          if (f === false) r.doNotPerform = true;
          if (f === undefined) { r.note = [annotation(it, n)]; log.warn('STATUS_FREE_TEXT', '상태 경로에 여부가 아닌 값 → status=unknown', c.ctx); }
          r.intent = 'order'; r.medicationCodeableConcept = codeCC; r.subject = ref(patientEntry);
          break;
        case 'FamilyMemberHistory':
          if (f === false) { log.info('FLAG_NO_RESOURCE', '가족력 "없음(N)" → FHIR 리소스 미생성(KR CDI·로그에는 보존)', c.ctx); return null; }
          r.status = f === true ? 'completed' : 'health-unknown';
          r.patient = ref(patientEntry);
          r.relationship = { coding: [{ system: SYS.roleCode, code: 'FAMMEMB', display: 'family member' }], text: '가족(관계 미상)' };
          if (f === true) r.condition = [{ code: codeCC }];
          break;
        case 'AdverseEvent':
          if (f !== true) { log.info('FLAG_NO_RESOURCE', '이상반응 "없음/미상" → FHIR 리소스 미생성', c.ctx); return null; }
          r.actuality = 'actual'; r.event = codeCC; r.subject = ref(patientEntry);
          break;
        case 'Immunization':
          r.status = f === false ? 'not-done' : 'completed';
          r.vaccineCode = codeCC; r.patient = ref(patientEntry);
          r.occurrenceString = '미상';
          break;
        case 'Observation':
          r.status = 'final'; r.code = itemCC(it); r.subject = ref(patientEntry);
          if (f === true || f === false) r.valueBoolean = f; else r.dataAbsentReason = dar('unknown');
          break;
        default:
          return null;
      }
      trace(r, it);
      setProfile(r, [it.core.url]);
      return e;
    }

    /* ---------- Observation 그룹 ---------- */
    function buildObservations(cells, seedBase, pe) {
      const valueObs = [];
      const mods = [];
      let bp = null;
      cells.forEach(function (c, i) {
        const it = c.item, n = c.norm, p = c.path;
        if (OBS_MOD.indexOf(p) >= 0 || it.obsMod) { mods.push(c); return; }
        if (/^Observation\.component:(systolic|diastolic)/.test(p)) {
          if (!bp) {
            bp = newRes('Observation', seedBase.concat(['bp']));
            Object.assign(bp.resource, {
              status: 'final', category: [{ coding: [{ system: SYS.obsCat, code: 'vital-signs' }] }],
              code: { coding: [{ system: SYS.loinc, code: '85354-9', display: 'Blood pressure panel' }] }, subject: ref(pe), component: []
            });
            valueObs.push({ e: bp, urls: [] });
          }
          const sys = /systolic/.test(p);
          if (n.num == null) { log.warn('TYPE_MISMATCH', '혈압 값이 수치가 아님', c.ctx); return; }
          bp.resource.component.push({ code: { coding: [{ system: SYS.loinc, code: sys ? '8480-6' : '8462-4' }] }, valueQuantity: quantity(n.num, 'mmHg') });
          trace(bp.resource, it);
          bp.urls = (bp.urls || []).concat(it.core.url);
          return;
        }
        if (n.isFlag && (p === 'Observation.code' || p === 'Observation.valueBoolean' || p === 'Observation.value[x]' || p === 'Observation.valueCodeableConcept')) {
          const fe = flagResource('Observation', c, seedBase.concat([String(i)]), pe);
          if (fe) valueObs.push({ e: fe, urls: [it.core.url] });
          if (p !== 'Observation.valueBoolean' && n.flag !== undefined) log.info('VALUE_TYPE_ADJUST', '여부 항목을 valueBoolean으로 표현', c.ctx);
          return;
        }
        const e = newRes('Observation', seedBase.concat([String(i)]));
        const r = e.resource;
        r.status = 'final';
        const vital = VITAL[(it.core.url || '').split('/').pop()];
        r.code = vital ? { coding: [{ system: SYS.loinc, code: vital.code, display: vital.display }, itemCoding(it)], text: it.name } : itemCC(it);
        if (vital) r.category = [{ coding: [{ system: SYS.obsCat, code: 'vital-signs' }] }];
        else if (/laboratory/.test(it.core.url)) r.category = [{ coding: [{ system: SYS.obsCat, code: 'laboratory' }] }];
        r.subject = ref(pe);
        let kind = p.replace('Observation.', '');
        if (kind === 'code') {
          r.code = { coding: [itemCoding(it)], text: n.str };
          kind = null;
        } else if (kind === 'value[x]') {
          kind = n.kind === 'date' ? 'valueDateTime' : n.kind === 'int' ? 'valueInteger' : n.kind === 'num' ? 'valueQuantity' : n.code ? 'valueCodeableConcept' : 'valueString';
        } else if (kind === 'valueCodeableConcept' && (n.kind === 'num' || n.kind === 'int') && opts.autoFix) {
          kind = 'valueQuantity';
          log.info('VALUE_TYPE_ADJUST', '수치 항목이 valueCodeableConcept에 배정됨 → valueQuantity로 표현', c.ctx);
        }
        if (kind === 'valueQuantity') {
          if (n.num != null) r.valueQuantity = quantity(n.num, it.unit || (vital ? vital.unit : ''));
          else { r.valueString = n.str; log.warn('TYPE_MISMATCH', 'valueQuantity 경로에 수치가 아닌 값 → valueString으로 보존', c.ctx); }
        } else if (kind === 'valueInteger') {
          if (n.num != null && Number.isInteger(n.num)) r.valueInteger = n.num;
          else { r.valueString = n.str; log.warn('TYPE_MISMATCH', 'valueInteger 경로에 정수가 아닌 값 → valueString으로 보존', c.ctx); }
        } else if (kind === 'valueBoolean') {
          r.valueString = n.str; log.warn('TYPE_MISMATCH', 'valueBoolean 경로 값이 여부로 해석되지 않음 → valueString', c.ctx);
        } else if (kind === 'valueDateTime') {
          r.valueDateTime = dateVal(n);
        } else if (kind === 'valueCodeableConcept') {
          r.valueCodeableConcept = ccFromNorm(n, it);
        } else if (kind === 'valueString') {
          r.valueString = n.str;
        } else if (kind) {
          addExt(r, it, n);
          log.warn('PATH_UNSUPPORTED', '지원하지 않는 Observation 경로 → 확장으로 보존: ' + p, c.ctx);
        }
        trace(r, it);
        valueObs.push({ e: e, urls: [it.core.url] });
      });

      // 수식 항목(일자·방법·부위·주석·단위) 적용
      mods.forEach(function (c, i) {
        const it = c.item, n = c.norm, key = it.obsMod ? 'mod:' + it.obsMod : c.path.replace('Observation.', '');
        const targets = valueObs.map(function (v) { return v.e.resource; });
        const apply = function (r) {
          // 세로형(한 행 = 검사 1건) 범용 데이터: 같은 행의 검사코드·검사명·참고치·판정을 값 Observation 에 붙인다
          if (key === 'mod:code') { r.code = { coding: [{ system: base + 'CodeSystem/local-test-code', code: n.str }], text: (r.code && r.code.text) || n.str }; return 'ok'; }
          if (key === 'mod:display') {
            r.code = r.code || { coding: [] };
            r.code.text = n.str;
            (r.code.coding || []).forEach(function (cd) { if (/local-test-code$/.test(cd.system)) cd.display = n.str; });
            return 'ok';
          }
          if (key === 'mod:referenceRange') {
            const m = /^\s*(-?\d+(?:\.\d+)?)\s*[-~]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(n.str);
            const unit = r.valueQuantity && r.valueQuantity.unit;
            r.referenceRange = [m ? { low: quantity(+m[1], unit || ''), high: quantity(+m[2], unit || ''), text: n.str } : { text: n.str }];
            return 'ok';
          }
          if (key === 'mod:interpretation') {
            const v = String(n.str).trim().toUpperCase();
            const map = { H: 'H', HIGH: 'H', '높음': 'H', L: 'L', LOW: 'L', '낮음': 'L', N: 'N', NORMAL: 'N', '정상': 'N' };
            r.interpretation = [map[v] ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: map[v] }], text: n.str } : { text: n.str }];
            return 'ok';
          }
          if (key === 'effectiveDateTime') { if (n.kind !== 'date') return 'mismatch'; if (!r.effectiveDateTime) r.effectiveDateTime = dateVal(n); return 'ok'; }
          if (key === 'method' || key === 'bodySite') { if (!r[key]) r[key] = ccFromNorm(n, it); return 'ok'; }
          if (key === 'note') { (r.note = r.note || []).push(annotation(it, n)); return 'ok'; }
          if (key === 'valueQuantity.unit') {
            if (r.valueQuantity && !r.valueQuantity.unit) { Object.assign(r.valueQuantity, quantity(r.valueQuantity.value, n.str)); }
            return 'ok';
          }
          return 'unsupported';
        };
        if (targets.length) {
          let bad = false;
          targets.forEach(function (r) { if (apply(r) === 'mismatch') bad = true; trace(r, it); });
          if (bad) log.warn('TYPE_MISMATCH', '일자 경로(effectiveDateTime)에 날짜가 아닌 값 → 무시', c.ctx);
          return;
        }
        // 값 리소스가 없으면 항목 자체를 Observation 으로 보존
        const e = newRes('Observation', seedBase.concat(['m' + i]));
        const r = e.resource;
        Object.assign(r, { status: 'final', code: itemCC(it), subject: ref(pe) });
        if (n.kind === 'date') { r.valueDateTime = dateVal(n); r.effectiveDateTime = dateVal(n); }
        else if (key === 'method' || key === 'bodySite') { r[key] = ccFromNorm(n, it); r.valueCodeableConcept = ccFromNorm(n, it); }
        else r.valueString = n.str;
        trace(r, it);
        valueObs.push({ e: e, urls: [it.core.url] });
      });

      valueObs.forEach(function (v) {
        const r = v.e.resource;
        if (v.e === bp) setProfile(r, [KC.spec.data.meta.krcoreBase + 'krcore-bloodpressure']);
        else setProfile(r, v.urls);
        push(v.e);
      });
    }

    /* ---------- 일반 그룹(Condition, Procedure, ...) ---------- */
    function buildGeneric(type, cells, seedBase, pe) {
      const instances = [];
      const newInst = function () {
        const e = newRes(type, seedBase.concat(['i' + instances.length]));
        const inst = { e: e, urls: [], items: [] };
        instances.push(inst);
        return inst;
      };
      const main = [];
      cells.forEach(function (c, i) {
        const p = c.path;
        const isStatus = /\.(status|verificationStatus)$/.test(p) && type !== 'Encounter';
        const isFlagCode = c.norm.isFlag && FLAG_CODE_PATHS.indexOf(p) >= 0;
        if (isStatus || isFlagCode) {
          const fe = flagResource(type === 'Medication' ? 'MedicationRequest' : type, c, seedBase.concat(['f' + i]), pe);
          if (fe) push(fe);
          if (isStatus && c.norm.isFlag) log.info('STATUS_SPLIT', '여부 항목이 status 경로에 배정됨 → 별도 리소스로 분리(주 리소스 상태 보호). 매핑 검토 권장', c.ctx);
          return;
        }
        main.push(c);
      });
      if (!main.length) return;
      newInst();
      // 코드 항목을 먼저 두고, 명칭 항목(ccText)은 같은 CodeableConcept 의 text 로 합친다 (예: 약품코드 + 약품명 → 처방 1건)
      main.sort(function (a, b) { return (a.item.ccText ? 1 : 0) - (b.item.ccText ? 1 : 0); });
      main.forEach(function (c) {
        const key = c.path.split('.').slice(1).join('.');
        if (type === 'Practitioner' && key === 'name') {
          const host = instances[0].e.resource;
          (host.name = host.name || []).push({ text: c.norm.str });
          instances[0].urls.push(c.item.core.url);
          trace(host, c.item);
          return;
        }
        if (c.item.ccText && key.indexOf('.') < 0) {
          const host = instances.find(function (x) { return x.e.resource[key] && typeof x.e.resource[key] === 'object'; });
          if (host) {
            host.e.resource[key].text = c.norm.str;
            host.urls.push(c.item.core.url);
            trace(host.e.resource, c.item);
            return;
          }
        }
        let placed = false;
        for (let k = 0; k < instances.length && !placed; k++) {
          const st = setPath(instances[k].e.resource, c.path, c.item, c.norm);
          if (st === 'ok') { placed = true; instances[k].urls.push(c.item.core.url); trace(instances[k].e.resource, c.item); }
          else if (st === 'mismatch' || st === 'unsupported') {
            addExt(instances[k].e.resource, c.item, c.norm);
            trace(instances[k].e.resource, c.item);
            log.warn(st === 'mismatch' ? 'TYPE_MISMATCH' : 'PATH_UNSUPPORTED',
              (st === 'mismatch' ? '값이 대상 경로의 자료형과 맞지 않음' : 'FHIR R4에 없는 경로') + ' → 확장(item-' + c.item.id + ')으로 보존: ' + c.path, c.ctx);
            placed = true;
          } else if (st === 'occupied' && DATE_PATH.test(c.path)) {
            addExt(instances[k].e.resource, c.item, c.norm);
            trace(instances[k].e.resource, c.item);
            log.info('DATE_EXTRA', '같은 리소스에 일자 항목이 2개 이상 → 추가 일자는 확장으로 보존', c.ctx);
            placed = true;
          }
        }
        if (!placed) {
          const inst = newInst();
          setPath(inst.e.resource, c.path, c.item, c.norm);
          inst.urls.push(c.item.core.url);
          trace(inst.e.resource, c.item);
        }
      });
      // 같은 그룹에서 주 코드가 겹쳐 추가된 Procedure 는 주 수술에 partOf 로 연결하고 시행일을 승계
      if (type === 'Procedure') {
        const m0 = instances[0].e.resource;
        instances.slice(1).forEach(function (inst) {
          const r = inst.e.resource;
          r.partOf = [ref(instances[0].e)];
          if (!r.performedDateTime && !r.performedPeriod) {
            if (m0.performedDateTime) r.performedDateTime = m0.performedDateTime;
            else if (m0.performedPeriod) r.performedPeriod = Object.assign({}, m0.performedPeriod);
          }
        });
      }
      instances.forEach(function (inst) {
        finalize(type, inst.e.resource, pe, cells[0]);
        setProfile(inst.e.resource, inst.urls);
        push(inst.e);
      });
    }

    /** 필수 요소 보완 (원천에 없을 때 기본값 + 로그) */
    function finalize(type, r, pe, c0) {
      const defaulted = [];
      const subj = ref(pe);
      const grp = (c0.item.cat1 + ' / ' + c0.item.cat2).replace(/\[확인 필요\]\s*/g, '');
      switch (type) {
        case 'Condition':
          r.subject = subj;
          if (!r.code) { r.code = { text: grp }; defaulted.push('code'); }
          if (/condition-encounter-diagnosis/.test((c0.item.core.url || ''))) r.category = [{ coding: [{ system: SYS.condCat, code: '진단' }] }];
          break;
        case 'Procedure':
          r.subject = subj;
          if (r.performedDateTime && r.performedPeriod) { r.performedPeriod.start = r.performedPeriod.start || r.performedDateTime; delete r.performedDateTime; }
          if (!r.status) { r.status = (r.performedDateTime || r.performedPeriod) ? 'completed' : 'unknown'; defaulted.push('status=' + r.status); }
          if (!r.code) { r.code = { text: grp }; defaulted.push('code'); }
          break;
        case 'MedicationRequest':
          r.subject = subj;
          if (!r.status) { r.status = 'unknown'; defaulted.push('status'); }
          r.intent = r.intent || 'order';
          if (!r.medicationCodeableConcept && !r.medicationReference) { r.medicationCodeableConcept = { text: grp }; defaulted.push('medication'); }
          if (r._pendingUnit && r.dosageInstruction && r.dosageInstruction[0].doseAndRate) {
            Object.assign(r.dosageInstruction[0].doseAndRate[0].doseQuantity, quantity(r.dosageInstruction[0].doseAndRate[0].doseQuantity.value, r._pendingUnit));
          }
          delete r._pendingUnit;
          break;
        case 'Medication':
          break;
        case 'DiagnosticReport':
          r.subject = subj;
          r.status = r.status || 'final';
          if (!r.code) { r.code = { text: grp }; defaulted.push('code'); }
          break;
        case 'AdverseEvent':
          r.subject = subj; r.actuality = 'actual';
          break;
        case 'FamilyMemberHistory':
          r.patient = subj; r.status = r.status || 'completed';
          if (!r.relationship) { r.relationship = { coding: [{ system: SYS.roleCode, code: 'FAMMEMB', display: 'family member' }], text: '가족(관계 미상)' }; defaulted.push('relationship'); }
          break;
        case 'Encounter':
          r.subject = subj;
          if (!r.status) { r.status = r.period && r.period.end ? 'finished' : 'unknown'; defaulted.push('status=' + r.status); }
          if (!r.class) { r.class = { system: SYS.dar, code: 'unknown', display: 'Unknown' }; defaulted.push('class'); }
          if (r._classUnmapped) { log.warn('CODE_MAP', 'Encounter.class 값을 ActCode(IMP/AMB/EMER)로 변환하지 못해 K-CURE 코드로 표기', c0.ctx); delete r._classUnmapped; }
          break;
        case 'Specimen':
          r.subject = subj;
          break;
        case 'Immunization':
          r.patient = subj; r.status = r.status || 'completed';
          if (!r.vaccineCode) { r.vaccineCode = dar('unknown'); defaulted.push('vaccineCode'); }
          if (!r.occurrenceDateTime && !r.occurrenceString) { r.occurrenceString = '미상'; defaulted.push('occurrence'); }
          break;
      }
      if (defaulted.length) {
        log.info('REQUIRED_DEFAULT', type + ' 필수요소 기본값 보완: ' + defaulted.join(', '), { row: c0.ctx.row, item: c0.item.id, target: type });
      }
    }

    /* ---------- 행 변환 ---------- */
    function convertRow(rowIdx, patientKey, patientIdValue, cells) {
      const pe = getPatient(patientKey, patientIdValue);
      const groups = new Map();
      cells.forEach(function (c) {
        let path = c.item.core.path;
        const rt0 = path.split('.')[0];
        // 날짜 항목이 날짜가 아닌 경로에 배정된 경우 자동보정
        if (opts.autoFix && c.norm.kind === 'date' && !DATE_PATH.test(path) && !/\.status$/.test(path) && rt0 !== 'Organization') {
          let np = null;
          if (rt0 === 'Patient') np = /사망|death/i.test(c.item.name) ? 'Patient.deceasedDateTime' : null;
          else np = DATE_TARGET[rt0] || null;
          if (np && np !== path) {
            log.warn('PATH_AUTOFIX', '날짜 항목이 비날짜 경로(' + path + ')에 배정됨 → ' + np + ' 로 자동보정. 매핑 검토 권장', c.ctx);
            path = np;
          }
        }
        c.path = path;
        const rt = path.split('.')[0];
        if (rt === 'Patient') { applyPatient(pe, c.item, c.norm, c); return; }
        if (rt === 'Organization') {
          const oe = getOrg(c.norm.str, c);
          if (!pe.resource.managingOrganization) pe.resource.managingOrganization = ref(oe);
          return;
        }
        const key = rt + '|' + c.item.cat1 + '|' + c.item.cat2;
        if (!groups.has(key)) groups.set(key, { type: rt, cells: [] });
        groups.get(key).cells.push(c);
      });
      groups.forEach(function (g, key) {
        const seed = [patientKey, String(rowIdx), key];
        if (g.type === 'Observation') buildObservations(g.cells, seed, pe);
        else buildGeneric(g.type, g.cells, seed, pe);
      });
    }

    function bundle() {
      const type = opts.bundleType === 'collection' ? 'collection' : 'transaction';
      return {
        resourceType: 'Bundle',
        meta: { tag: [STAGE_TAG] },
        identifier: { system: base + 'Identifier/bundle', value: KC.sha256(opts.datasetId + '|' + U.nowIso()).slice(0, 16) },
        type: type,
        timestamp: U.nowIso(),
        entry: ctx.entries.map(function (e) {
          const o = { fullUrl: e.fullUrl, resource: e.resource };
          if (type === 'transaction') o.request = { method: 'POST', url: e.resource.resourceType };
          return o;
        })
      };
    }

    return { convertRow: convertRow, bundle: bundle, ctx: ctx };
  }

  /* ---------- 구조 검증 (R4 기본 필수요소·날짜형식·참조 무결성) ---------- */
  const REQUIRED = {
    Observation: ['status', 'code'], Condition: ['subject'], Procedure: ['status', 'subject'],
    MedicationRequest: ['status', 'intent', 'subject', 'medication[x]'], DiagnosticReport: ['status', 'code'],
    AdverseEvent: ['actuality', 'subject'], FamilyMemberHistory: ['status', 'patient', 'relationship'],
    Encounter: ['status', 'class'], Immunization: ['status', 'vaccineCode', 'patient', 'occurrence[x]']
  };
  const DATE_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z))?)?)?$/;

  function validateBundle(b, log) {
    const urls = new Set(b.entry.map(function (e) { return e.fullUrl; }));
    let errors = 0;
    b.entry.forEach(function (e, idx) {
      const r = e.resource;
      (REQUIRED[r.resourceType] || []).forEach(function (k) {
        let ok;
        if (/\[x\]$/.test(k)) { const p = k.slice(0, -3); ok = Object.keys(r).some(function (x) { return x.indexOf(p) === 0; }); }
        else ok = r[k] !== undefined && r[k] !== null && r[k] !== '';
        if (!ok) { errors++; log.error('FHIR_REQUIRED', r.resourceType + '.' + k + ' 필수요소 누락', { target: 'entry[' + idx + ']' }); }
      });
      if (r.resourceType === 'Observation' && r.valueQuantity === undefined && r.valueString === undefined && r.valueBoolean === undefined &&
        r.valueInteger === undefined && r.valueCodeableConcept === undefined && r.valueDateTime === undefined && !r.component && !r.dataAbsentReason && !(r.code && r.code.text)) {
        log.warn('FHIR_OBS_NOVALUE', 'Observation에 값(value[x])·dataAbsentReason 없음', { target: 'entry[' + idx + ']' });
      }
      (function walk(o, path) {
        if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, path + '[' + i + ']'); }); return; }
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach(function (k) {
          const v = o[k];
          if (k === 'reference' && typeof v === 'string' && v.indexOf('urn:uuid:') === 0 && !urls.has(v)) {
            errors++; log.error('FHIR_REF', '해결되지 않는 참조: ' + v, { target: 'entry[' + idx + '].' + path });
          }
          if (/(DateTime|Date|^date$|authoredOn|^start$|^end$)$/.test(k) && typeof v === 'string' && !DATE_RE.test(v)) {
            errors++; log.error('FHIR_DATE', '날짜 형식 오류: ' + v, { target: 'entry[' + idx + '].' + path + '.' + k });
          }
          if (k === 'issued' && typeof v === 'string' && !/T/.test(v)) {
            errors++; log.error('FHIR_DATE', 'issued(instant)는 시각까지 필요: ' + v, { target: 'entry[' + idx + '].' + path });
          }
          walk(v, path ? path + '.' + k : k);
        });
      })(r, '');
    });
    return errors;
  }

  return { create: create, validateBundle: validateBundle, UCUM: UCUM };
})();
