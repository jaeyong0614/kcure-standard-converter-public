/* 브라우저 자동 테스트 — 결과는 window.TEST_RESULTS 와 화면에 기록 */
(async function () {
  'use strict';
  const results = [];
  window.TEST_RESULTS = results;
  function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
  }
  function eq(name, a, b) { ok(name, a === b, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

  KC.spec.init(window.KCURE_SPEC);
  const OPTS = { pseudonymize: true, salt: 'test-salt-1234', birthYearOnly: true, autoFix: true, traceItems: true, metaProfile: true, bundleType: 'transaction', datasetId: 't' };
  const CONF = { base: 'https://portal.example.kr/', catalogTitle: 'T', catalogDesc: 'D', publisherName: 'P', publisherBizNo: '000-00-00000', contactName: 'C',
    license: 'L', accessRights: 'A', endpointURL: 'https://portal.example.kr/fhir', ndiNs: 'https://ndi.example/ns#', kcureBase: 'http://khis.kr/fhir/kcure/' };

  async function fileOf(path) {
    const r = await fetch(path);
    const b = await r.blob();
    return new File([b], decodeURIComponent(path.split('/').pop()));
  }
  async function convert(file, cancer) {
    const f = await KC.readers.readFile(file);
    const rows = f.sheets[0].rows;
    const table = { headers: rows[0].map(String), rows: rows.slice(1) };
    const mapping = KC.mapper.autoMap(table.headers, cancer);
    const opts = Object.assign({}, OPTS, { patientCol: KC.mapper.guessPatientColumn(mapping), cancer: cancer });
    const run = await KC.pipeline.run(table, mapping, opts);
    return { f: f, table: table, mapping: mapping, run: run };
  }

  try {
    /* 1. 기본 단위 */
    eq('SHA-256 빈 문자열', KC.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    eq('SHA-256 "abc"', KC.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // 기대값: Python hashlib 으로 계산
    eq('SHA-256 한글(UTF-8)', KC.sha256('한국 K-CURE 표준'), '85e6471fb174936dbbde411ae743b19e674a7883602795ff3defd5c4a798b29e');
    eq('SHA-256 300KB', KC.sha256('가'.repeat(100000)), '1505395253632016504f33e1bd89fe686dac4ed145a0db771c27aea1b33cea9b');
    eq('날짜 YYYYMMDD', KC.values.parseDate('20240229').date, '2024-02-29');
    eq('날짜 윤년 아님', KC.values.parseDate('20230229'), null);
    eq('날짜 13월 거부', KC.values.parseDate('20211340'), null);
    eq('날짜 점 구분', KC.values.parseDate('2020.3.5').date, '2020-03-05');
    eq('날짜 연월', KC.values.parseDate('202403').date, '2024-03');
    eq('CSV 따옴표·줄바꿈', JSON.stringify(KC.readers.parseCsv('a,b\n"x,1","y\n2"\n', ',')), JSON.stringify([['a', 'b'], ['x,1', 'y\n2']]));
    eq('명세 항목 수', KC.spec.items.length, 1255);
    eq('KR CDI 80항목', KC.spec.krcdi.length, 80);
    ok('별칭 색인', KC.spec.aliasIndex.size > 1000, KC.spec.aliasIndex.size);
    eq('별칭 매칭 no_patient', KC.mapper.matchOne('no_patient', '대장암').itemId, 'KCURE-PAT-000016');
    eq('정규화 매칭(공백·대소문자)', KC.mapper.matchOne(' K-RAS ', '대장암').itemId, KC.mapper.matchOne('K-ras', '대장암').itemId);

    /* 2. 대장암 CSV(UTF-8 BOM) */
    const crc = await convert(await fileOf('../samples/%ED%95%A9%EC%84%B1%EC%83%98%ED%94%8C_%EB%8C%80%EC%9E%A5%EC%95%94_%EC%9B%90%EC%B2%9C%EC%98%81%EB%AC%B8%EC%BB%AC%EB%9F%BC.csv'), '대장암');
    eq('CRC 인코딩', crc.f.encoding, 'UTF-8(BOM)');
    eq('CRC 매핑 39/40', crc.mapping.filter(function (m) { return m.itemId; }).length, 39);
    eq('CRC 환자 수', crc.run.meta.patients, 15);
    eq('CRC FHIR 구조오류 0', crc.run.fhirErrors, 0);
    const codes = crc.run.log.entries.map(function (e) { return e.code; });
    ok('CRC 잘못된 날짜 탐지', codes.indexOf('DATE_INVALID') >= 0);
    ok('CRC 성별 코드 오류 탐지', codes.indexOf('GENDER_MAP') >= 0);
    ok('CRC 수치 아닌 키 탐지', crc.run.log.entries.some(function (e) { return e.code === 'TYPE_MISMATCH' && e.col === 'height'; }));
    ok('CRC 사망일자 경로 자동보정', crc.run.log.entries.some(function (e) { return e.code === 'PATH_AUTOFIX' && e.col === 'dt_death'; }));
    const ents = crc.run.bundle.entry;
    const pats = ents.filter(function (e) { return e.resource.resourceType === 'Patient'; });
    eq('CRC Patient 15', pats.length, 15);
    ok('가명처리: 원 식별자 미포함', JSON.stringify(crc.run.bundle).indexOf('CRC00001') < 0);
    ok('가명처리: 식별자 해시 32자', pats.every(function (p) { return /^[0-9a-f]{32}$/.test(p.resource.identifier[0].value); }));
    ok('생년월일 연도만', pats.every(function (p) { return !p.resource.birthDate || /^\d{4}$/.test(p.resource.birthDate); }));
    ok('survival_status 식별자 미사용', pats.every(function (p) { return p.resource.identifier.length === 1; }), pats[0].resource.identifier.length);
    ok('KR Core Patient 프로파일', pats[0].resource.meta.profile[0] === 'http://www.hl7korea.or.kr/fhir/krcore/StructureDefinition/krcore-patient');
    ok('모든 리소스 후보 태그', ents.every(function (e) { return e.resource.meta.tag[0].code === 'rule-approved-candidate'; }));
    ok('transaction request', ents.every(function (e) { return e.request && e.request.method === 'POST'; }));
    const cond = ents.filter(function (e) { return e.resource.resourceType === 'Condition'; }).map(function (e) { return e.resource; });
    ok('Condition 코드 "Y" 없음(여부→verificationStatus)', cond.every(function (c) { return !c.code || c.code.text !== 'Y'; }));
    ok('여부 Condition verificationStatus', cond.some(function (c) { return c.verificationStatus; }));
    const procs = ents.filter(function (e) { return e.resource.resourceType === 'Procedure'; }).map(function (e) { return e.resource; });
    ok('부가 Procedure partOf 연결', procs.some(function (p) { return p.partOf; }));
    ok('Procedure status 유효값', procs.every(function (p) { return ['completed', 'not-done', 'unknown', 'in-progress'].indexOf(p.status) >= 0; }));
    const obs = ents.filter(function (e) { return e.resource.resourceType === 'Observation'; }).map(function (e) { return e.resource; });
    ok('키 LOINC 8302-2 + UCUM cm', obs.some(function (o) { return o.code.coding[0].code === '8302-2' && o.valueQuantity && o.valueQuantity.code === 'cm'; }));
    ok('참조 무결성(subject)', obs.every(function (o) { return ents.some(function (e) { return e.fullUrl === o.subject.reference; }); }));
    const ae = ents.filter(function (e) { return e.resource.resourceType === 'AdverseEvent'; });
    ok('AdverseEvent 개념명 보존', ae.every(function (e) { return /grade_neuropathy/.test(e.resource.event.text); }), ae.length && ae[0].resource.event.text);

    /* KR CDI */
    ok('CRC KR CDI 값 존재', crc.run.krcdi.summary.values > 0, crc.run.krcdi.summary.values);
    ok('KR CDI 환자ID 가명', crc.run.krcdi.csvRows.slice(1).every(function (r) { return r[4] !== '환자 ID' || /^[0-9a-f]{32}$/.test(r[8]); }));
    ok('KR CDI 성명 R 누락 보고', crc.run.krcdi.conformance.some(function (c) { return c.el === '성명'; }));

    /* DCAT */
    const dc = KC.dcat.fromRun(CONF, crc.run, { fileName: 'crc.csv', encoding: 'UTF-8', cancer: '대장암', pseudonymized: true },
      [{ id: 'fhir', title: 'F', fileName: 'f.json', mediaType: 'application/fhir+json', format: 'JSON', bytes: 10, sha256: KC.sha256('x'), conformsTo: 'krcore' }]);
    const errs = dc.issues.filter(function (x) { return x.level === '오류'; });
    eq('DCAT 필수속성 오류 0', errs.length, 0);
    const xml = KC.dcat.toRdfXml(dc.graph);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    ok('RDF/XML 정형(well-formed)', !doc.getElementsByTagName('parsererror').length);
    ok('RDF/XML 클래스 5종', ['dcat:Catalog', 'dcat:Dataset', 'dcat:Distribution', 'dcat:DataService', 'dcat:CatalogRecord'].every(function (t) { return xml.indexOf('<' + t + ' ') >= 0; }));
    ok('NDI 필수 확장', ['ndi:viewCnt', 'ndi:downloadCnt', 'ndi:srvcType', 'ndi:pltfrmAccessToken'].every(function (t) { return xml.indexOf('<' + t) >= 0; }));
    const jl = JSON.parse(KC.dcat.toJsonLd(dc.graph));
    ok('JSON-LD 파싱', jl['@graph'].length >= 5, jl['@graph'].length);
    const prof = JSON.parse(jl['@graph'].find(function (n) { return n['@type'] === 'dcat:Dataset'; })['ndi:profile']);
    ok('ndi:profile 변수 사전', Object.keys(prof.data.variables).length === 39, Object.keys(prof.data.variables).length);
    ok('ndi:profile 식별자 min/max 비노출', prof.data.variables.no_patient.min === null);
    ok('Turtle 접두어', /@prefix dcat: <http:\/\/www\.w3\.org\/ns\/dcat#>/.test(KC.dcat.toTurtle(dc.graph)));
    ok('DCAT IRI ASCII', dc.graph.nodes.every(function (n) { return /^[\x21-\x7e]+$/.test(n.iri); }), dc.graph.nodes.map(function (n) { return n.iri; }).join(' '));

    /* 3. 유방암 XLSX */
    const brx = await convert(await fileOf('../samples/%ED%95%A9%EC%84%B1%EC%83%98%ED%94%8C_%EC%9C%A0%EB%B0%A9%EC%95%94_%ED%95%9C%EA%B8%80%EC%BB%AC%EB%9F%BC.xlsx'), '유방암');
    eq('XLSX 인코딩 표기', brx.f.encoding, 'XLSX');
    eq('XLSX 행 수(헤더 포함)', brx.f.sheets[0].rows.length, 16);
    ok('XLSX 매핑 ≥ 38/40', brx.mapping.filter(function (m) { return m.itemId; }).length >= 38, brx.mapping.filter(function (m) { return m.itemId; }).length);
    eq('XLSX 환자 수', brx.run.meta.patients, 15);
    eq('XLSX FHIR 구조오류 0', brx.run.fhirErrors, 0);
    ok('XLSX 허용값 외 진단경로 탐지', brx.run.log.entries.some(function (e) { return e.code === 'CODE_NOT_ALLOWED' && e.col === '진단경로'; }));
    ok('XLSX 존재하지 않는 날짜 탐지', brx.run.log.entries.some(function (e) { return e.code === 'DATE_INVALID' && e.col === '수술일자'; }));
    ok('영상검사일자 → DiagnosticReport 일자 보정', brx.run.log.entries.some(function (e) { return e.code === 'PATH_AUTOFIX' && e.col === 'MMG 검사일자'; }));

    /* 4. 유방암 CP949 CSV */
    const brc = await convert(await fileOf('../samples/%ED%95%A9%EC%84%B1%EC%83%98%ED%94%8C_%EC%9C%A0%EB%B0%A9%EC%95%94_%ED%95%9C%EA%B8%80%EC%BB%AC%EB%9F%BC_CP949.csv'), '유방암');
    eq('CP949 인코딩 감지', brc.f.encoding, 'CP949(EUC-KR)');
    eq('CP949 헤더 한글', brc.table.headers[0], '병원번호');
    eq('CP949 = XLSX 결과(리소스 수)', brc.run.bundle.entry.length, brx.run.bundle.entry.length);

    /* 4-1. 항목정의서 형식 파일: 빈 행이 있어도 엑셀 행 번호 유지 */
    const specFile = await KC.readers.readFile(await fileOf('../' + encodeURIComponent('항목정의 테스트.xlsx')));
    eq('항목정의서 4행 = 헤더(빈 3행 유지)', specFile.sheets[0].rows[3][0], '항목ID');
    eq('항목정의서 5행 = 첫 항목', specFile.sheets[0].rows[4][0], 'KCURE-PAT-000001');

    /* 4-2. 입력 양식: 표준항목명 열 제목 → 자기 자신으로 매핑 */
    const selfMiss = [];
    KC.spec.data.meta.cancers.forEach(function (c) {
      KC.spec.items.filter(function (it) { return it.cancers.indexOf(c) >= 0; }).forEach(function (it) {
        if (KC.mapper.matchOne(it.name, c).itemId !== it.id) selfMiss.push(c + ':' + it.name + '→' + KC.mapper.matchOne(it.name, c).itemId);
      });
    });
    eq('표준항목명 열 제목 자기매핑 실패 0', selfMiss.length, 0);
    if (selfMiss.length) ok('자기매핑 실패 목록', false, selfMiss.slice(0, 20).join(', '));
    eq('원문 표기 우선: 위암 "검사 결과" → 위내시경', KC.mapper.matchOne('검사 결과', '위암').itemId, 'KCURE-ASM-000160');
    eq('원문 표기 우선: 위암 "검사결과" → EUS', KC.mapper.matchOne('검사결과', '위암').itemId, 'KCURE-ASM-000163');

    /* 6. 메타데이터 변환 (주 기능) */
    ok('ARGO 사전 245필드', Object.keys(KC.spec.data.argo.fields).length === 245, Object.keys(KC.spec.data.argo.fields).length);
    const crcE = KC.meta.entriesForCancer('대장암');
    eq('대장암 항목 수', crcE.length, KC.spec.items.filter(function (i) { return i.cancers.indexOf('대장암') >= 0; }).length);
    const pkg = KC.meta.build(CONF, '대장암', crcE);
    eq('패키지 DCAT 필수 오류 0', pkg.dcatIssues.filter(function (x) { return x.level === '오류'; }).length, 0);
    ok('패키지 파일 ≥ 18', pkg.files.length >= 18, pkg.files.map(function (f) { return f.path; }).join(', '));
    ['00_통합_메타데이터.xlsx', 'KR_CDI/ConceptMap_KCURE-KRCDI.json', 'KR_Core/LogicalModel_colorectal.json', 'DCAT/catalog_colorectal.rdf', 'ARGO/ARGO_컬럼매핑.csv', 'ARGO/submission_templates/donor.tsv'].forEach(function (p) {
      ok('패키지에 ' + p, pkg.files.some(function (f) { return f.path === p; }));
    });
    const lm = JSON.parse(pkg.files.find(function (f) { return /LogicalModel/.test(f.path); }).content);
    eq('논리모델 요소 = 컬럼+1', lm.differential.element.length, crcE.length + 1);
    ok('논리모델 5개 표준 mapping 선언', ['krcore', 'krcdi', 'mcode', 'omop', 'argo'].every(function (id) { return lm.mapping.some(function (m) { return m.identity === id; }); }));
    const sexEl = lm.differential.element.find(function (e) { return e.label === 'sex'; });
    ok('sex 요소 mapping(krcore·krcdi·mcode·omop·argo)', sexEl && ['krcore', 'krcdi', 'mcode', 'omop', 'argo'].every(function (id) { return sexEl.mapping.some(function (m) { return m.identity === id; }); }), JSON.stringify(sexEl && sexEl.mapping));
    ['mCODE/mCODE_컬럼매핑.csv', 'mCODE/mCODE_프로파일커버리지.csv', 'mCODE/ConceptMap_KCURE-mCODE.json', 'OMOP/OMOP_ETL매핑.csv', 'OMOP/OMOP_필드커버리지.csv',
      'OMOP/source_to_concept_map_템플릿.csv', 'OMOP/ConceptMap_KCURE-OMOP.json'].forEach(function (p) {
      ok('패키지에 ' + p, pkg.files.some(function (f) { return f.path === p; }));
    });
    // mCODE
    ok('mCODE 사전 프로파일 38', KC.spec.data.mcode.profiles.length === 38, KC.spec.data.mcode.profiles.length);
    const sexItem = KC.spec.byId['KCURE-PAT-000018'];
    eq('sex mCODE 프로파일 URL', sexItem.mcode.url, 'http://hl7.org/fhir/us/mcode/StructureDefinition/mcode-cancer-patient');
    const mcov = KC.meta.mcodeCoverage(crcE);
    eq('mCODE 프로파일 충족표 행', mcov.profiles.length, 39);
    ok('대장암 mCODE 프로파일 충족 ≥ 10', mcov.profilesCovered >= 10, mcov.profilesCovered);
    const cmM = JSON.parse(pkg.files.find(function (f) { return /ConceptMap_KCURE-mCODE/.test(f.path); }).content);
    eq('mCODE ConceptMap 요소 = 컬럼 수', cmM.group.reduce(function (s, g) { return s + g.element.length; }, 0), crcE.length);
    // OMOP
    ok('OMOP 사전 필드 ≥ 250', Object.keys(KC.spec.data.omop.fields).length >= 250, Object.keys(KC.spec.data.omop.fields).length);
    eq('OMOP 모든 항목 대응 후보', KC.spec.items.filter(function (i) { return !i.omop; }).length, 0);
    eq('sex → OMOP', KC.meta.omopOf({ item: sexItem }).key, 'person.gender_concept_id');
    eq('pT → OMOP Cancer Modifier', KC.meta.omopOf({ item: KC.spec.items.find(function (i) { return i.name === 'pT'; }) }).key, 'measurement.value_as_concept_id');
    eq('dt_op → OMOP', KC.meta.omopOf({ item: KC.spec.items.find(function (i) { return i.name === 'dt_op'; }) }).key, 'procedure_occurrence.procedure_date');
    eq('약제성분명 → OMOP', KC.meta.omopOf({ item: KC.spec.items.find(function (i) { return i.name === '약제성분명'; }) }).key, 'drug_exposure.drug_concept_id');
    ok('OMOP 필드가 모두 공식 명세에 존재', KC.spec.items.every(function (i) { return KC.spec.data.omop.fields[i.omop.table + '.' + i.omop.field]; }));
    const cmO = JSON.parse(pkg.files.find(function (f) { return /ConceptMap_KCURE-OMOP/.test(f.path); }).content);
    eq('OMOP ConceptMap 요소 = OMOP 대응 수', cmO.group.reduce(function (s, g) { return s + g.element.length; }, 0), pkg.summary.omop);
    const stcm = KC.meta.omopStcm(crcE);
    ok('STCM 9열·source_code ≤ 50자', stcm.every(function (r) { return r.length === 9; }) && stcm.slice(1).every(function (r) { return String(r[0]).length <= 50; }), stcm.length);
    const oc = KC.meta.omopCoverage(crcE);
    ok('OMOP 사용 테이블 ≥ 6', oc.tables >= 6, oc.tables);
    const eo = Object.assign({}, crcE.find(function (x) { return x.col === 'sex'; }), { omopKey: 'observation.value_as_concept_id' });
    eq('OMOP 수동 지정', KC.meta.omopOf(eo).key + '/' + KC.meta.omopOf(eo).conf, 'observation.value_as_concept_id/수동');
    eq('OMOP 수동: 대응 없음', KC.meta.omopOf(Object.assign({}, eo, { omopKey: '' })), null);
    const cmA = JSON.parse(pkg.files.find(function (f) { return /ConceptMap_KCURE-ARGO/.test(f.path); }).content);
    eq('ARGO ConceptMap 요소 = ARGO 대응 수', cmA.group.reduce(function (s, g) { return s + g.element.length; }, 0), pkg.summary.argo);
    const rdf = pkg.files.find(function (f) { return /\.rdf$/.test(f.path); }).content;
    ok('DCAT RDF/XML 정형', !new DOMParser().parseFromString(rdf, 'application/xml').getElementsByTagName('parsererror').length);
    const jl2 = JSON.parse(pkg.files.find(function (f) { return /\.jsonld$/.test(f.path); }).content);
    const vars = JSON.parse(jl2['@graph'].find(function (n) { return n['@type'] === 'dcat:Dataset'; })['ndi:profile']).data.variables;
    eq('ndi:profile 변수 = 컬럼 수', Object.keys(vars).length, crcE.length);
    ok('ndi:profile sex → KR CDI·KR Core·mCODE·OMOP·ARGO', vars.sex.krcdi && vars.sex.krcore.path === 'Patient.gender' && vars.sex.argo.field === 'gender' &&
      vars.sex.mcode.profile === 'Cancer Patient Profile' && vars.sex.omop.table === 'person', JSON.stringify(vars.sex));
    ok('DCAT conformsTo ARGO·mCODE·OMOP', ['https://docs.icgc-argo.org/dictionary', 'http://hl7.org/fhir/us/mcode/', 'https://ohdsi.github.io/CommonDataModel/cdm54.html'].every(function (u) { return rdf.indexOf(u) >= 0; }));
    // XLSX: 자체 리더로 다시 읽어 시트·값 확인
    const xs = await KC.readers.readXlsx(pkg.files[0].content.buffer.slice(0));
    eq('통합 엑셀 시트 12개', xs.length, 12);
    eq('통합 엑셀 01 시트 행 = 제목+머리+컬럼', xs[1].rows.length, crcE.length + 2);
    const hdr = xs[1].rows[1];
    const ci = function (n) { return hdr.indexOf(n); };
    ok('통합 엑셀 sex 행 ARGO·OMOP·mCODE', xs[1].rows.some(function (r) {
      return r[1] === 'sex' && r[ci('ARGO 필드')] === 'gender' && r[ci('OMOP 필드')] === 'gender_concept_id' && r[ci('mCODE 프로파일')] === 'Cancer Patient Profile';
    }), JSON.stringify(hdr));
    // ZIP: 자체 압축해제로 목록 확인
    const z = await KC.readers.unzip(KC.meta.toZip([pkg]).buffer);
    eq('ZIP 파일 수', z.names.length, pkg.files.length);
    ok('ZIP 한글 파일명', z.names.indexOf('ARGO/ARGO_컬럼매핑.csv') >= 0);
    eq('ZIP 내용 무결', await z.read('README.txt'), pkg.files.find(function (f) { return f.path === 'README.txt'; }).content);
    // ARGO 수동 수정 반영
    const e2 = crcE.map(function (x) { return Object.assign({}, x); });
    const iSex = e2.findIndex(function (x) { return x.col === 'sex'; });
    e2[iSex].argoKey = '';
    const iAge = e2.findIndex(function (x) { return x.col === 'age'; });
    e2[iAge].argoKey = 'donor.survival_time';
    eq('ARGO 수동: 대응 없음', KC.meta.argoOf(e2[iSex]), null);
    eq('ARGO 수동: 지정 필드', KC.meta.argoOf(e2[iAge]).key + '/' + KC.meta.argoOf(e2[iAge]).conf, 'donor.survival_time/수동');
    // 컬럼 목록 → 항목
    const fe = KC.meta.entriesFromColumns(['sex', 'dt_birth', '내부메모'], '대장암');
    eq('컬럼 목록 매핑', fe.map(function (x) { return x.item ? x.item.id : '-'; }).join(','), 'KCURE-PAT-000018,KCURE-PAT-000019,-');
    const pk2 = KC.meta.build(CONF, '대장암', fe);
    eq('미매핑 컬럼 포함 패키지 DCAT 오류 0', pk2.dcatIssues.filter(function (x) { return x.level === '오류'; }).length, 0);
    // 항목정의서 형식 시트 → 항목
    const se = KC.meta.entriesFromSpecSheet(specFile.sheets[0].rows);
    eq('항목정의서 → 1255 항목', se.filter(function (x) { return x.item; }).length, 1255);
    // 9개 암종 일괄
    const all9 = KC.spec.data.meta.cancers.map(function (c) { return KC.meta.build(CONF, c, KC.meta.entriesForCancer(c)); });
    eq('9개 암종 DCAT 오류 0', all9.reduce(function (s, p) { return s + p.dcatIssues.filter(function (x) { return x.level === '오류'; }).length; }, 0), 0);
    window.TEST_XLSX_SAMPLE = KC.meta.build(CONF, '대장암', fe).files[0].content;

    /* 7. 매핑 품질 보강 (v0.2 S1) */
    eq('KR CDI 수집범위외 17항목', KC.spec.krcdi.filter(function (k) { return k.scope; }).length, 17);
    const nameScope = crc.run.krcdi.conformance.find(function (c) { return c.el === '성명' && c.cls === '환자 정보'; });
    eq('KR CDI 성명 = 수집범위외 정보', nameScope && nameScope.level, '정보');
    const allE = KC.meta.entriesForCancer('');
    const sAll = KC.meta.summarize(allE);
    eq('KR CDI 대응 36 + 범위외 17 + 미대응 27 = 80', [sAll.krcdiElements, sAll.krcdiOutOfScope, sAll.krcdiGap].join('+'), '36+17+27');
    eq('mCODE·KR Core 리소스 상이 167', sAll.mcodeConflict, 167);
    ok('리소스 상이 항목은 기본 표현 지정', KC.spec.items.every(function (i) { return !i.mcode.resConflict || /^(KR Core|mCODE)$/.test(i.mcode.primary); }));
    eq('매핑 수정안 171건(168항목)', KC.spec.data.meta.corrections.total + '/' + sAll.review, '171/168');
    ok('수정안 미승인 → 경로 미변경', KC.spec.items.every(function (i) { return !i.core.pathOrig; }));
    const dDrink = KC.spec.items.find(function (i) { return i.name === '음주량'; });
    ok('음주량 수정안 D1 → valueQuantity', dDrink.review.some(function (r) { return r.code === 'D1' && r.proposed === 'Observation.valueQuantity' && r.status === '후보'; }), JSON.stringify(dDrink.review));
    const acAll = KC.meta.argoCoverage(allE).stat;
    ok('ARGO Core 직접 충족 ≥ 48', acAll.coreHit >= 48, acAll.coreHit);
    eq('ARGO Core 지정값 4', acAll.coreFixed, 4);
    ok('ARGO Core 파생 가능 ≥ 8', acAll.coreDerived >= 8, acAll.coreDerived);
    ok('ARGO 직접·파생·지정 중복 없음', acAll.coreHit + acAll.coreDerived + acAll.coreFixed <= acAll.core);
    eq('전신항암제 차수값 → ARGO line_of_treatment', KC.spec.items.find(function (i) { return i.name === '전신항암제 차수값'; }).argo.key, 'treatment.line_of_treatment');
    const cmM2 = KC.artifacts.toMcode(CONF, KC.spec.items);
    ok('mCODE ConceptMap 리소스 상이 주석', cmM2.group.some(function (g) { return g.element.some(function (e) { return /리소스 상이/.test(e.target[0].comment); }); }));

    /* 8. Level 2 가명처리 코드 추천 (v0.2 S2) */
    const dp = KC.deid.plan(crc.table.headers, crc.table.rows, '대장암');
    const dcol = function (col) { return dp.columns.find(function (c) { return c.col === col; }); };
    eq('가명처리 샘플 최대 10행', dp.sampleRows, 10);
    eq('no_patient → 가명키(DR-11)', dcol('no_patient').technique + '/' + dcol('no_patient').ruleId, 'HASH_SALT/DR-11');
    eq('환자 식별 컬럼 = no_patient', dp.patientCol, 'no_patient');
    eq('dt_birth → 연도만', dcol('dt_birth').technique, 'YEAR_ONLY');
    eq('dt_op → 날짜 이동', dcol('dt_op').technique, 'DATE_SHIFT');
    eq('dt_op 샘플 패턴 DATE', dcol('dt_op').sample.pattern, 'DATE');
    eq('sex → 유지', dcol('sex').technique, 'KEEP');
    eq('memo_internal(미매핑 자유문) → 정규식', dcol('memo_internal').technique, 'REGEX_PII');
    ok('신뢰도 높음만 자동 승인', dp.columns.every(function (c) { return (c.status === '승인') === (c.confidence === '높음'); }));
    eq('주민번호 샘플 패턴', KC.deid.detectPattern(['900101-1234567', '8501022345678']).pattern, 'RRN');
    eq('TNM 복합 컬럼 전개 제안', KC.deid.expandColumn('stage', ['pT2N1M0'])[0].kind, 'TNM');
    // 전부 승인(memo 1개만 미승인)해 코드 생성
    dp.columns.forEach(function (c) { c.status = c.col === 'memo_internal' ? '후보' : '승인'; });
    const dopts = { table: 'kcure.crc_source', input: 'C:\\kcure\\in\\crc.csv', output: 'C:\\kcure\\out\\crc_deid.csv', operator: 'test' };
    const py = KC.codegen.python(dp, dopts);
    eq('Python 자체검사 통과', KC.codegen.selfCheck(py, 'python').length, 0);
    ok('Python: 원본 읽기 전용·새 파일·솔트 환경변수', /OUTPUT\.resolve\(\) == INPUT\.resolve\(\)/.test(py) && /os\.environ\.get\("KCURE_SALT"/.test(py) && py.indexOf('test-salt') < 0);
    ok('Python: Windows raw 경로', py.indexOf('INPUT = Path(r"C:\\kcure\\in\\crc.csv")') >= 0, py.split('\n').find(function (l) { return /^INPUT/.test(l); }));
    ok('Python: 미승인 컬럼 제외', !/out\["memo_internal"\]/.test(py) && /skipped = \["memo_internal"\]/.test(py));
    ['postgres', 'mssql', 'oracle'].forEach(function (d) {
      const q = KC.codegen.sql(dp, Object.assign({}, dopts, { dialect: d }));
      eq('SQL ' + d + ' 자체검사 통과', KC.codegen.selfCheck(q, 'sql').length, 0);
      ok('SQL ' + d + ' 뷰 생성·원천 읽기', /CREATE (OR REPLACE|OR ALTER) VIEW/.test(q) && /FROM /.test(q) && !/^\s*UPDATE/m.test(q));
    });
    ok('자체검사가 UPDATE 를 잡음', KC.codegen.selfCheck('UPDATE t SET a = 1;', 'sql').length === 1);
    ok('자체검사가 주석 속 단어는 무시', KC.codegen.selfCheck('-- UPDATE 금지 안내', 'sql').length === 0);
    ok('자체검사가 원본 덮어쓰기를 잡음', KC.codegen.selfCheck('df.to_csv(INPUT)', 'python').length === 1);
    const dpkg = KC.codegen.buildPackage(dp, Object.assign({ dialect: 'postgres' }, dopts));
    eq('가명처리 패키지 파일 8개', dpkg.files.map(function (f) { return f.path; }).join(','), 'deid.py,deid_postgres.sql,regex_pii.py,requirements.txt,run.bat,README_실행안내.md,매핑_가명처리_요약.json,감사이력.jsonl');
    ok('run.bat CRLF·UTF-8 코드페이지', /\r\n/.test(dpkg.files[4].content) && /chcp 65001/.test(dpkg.files[4].content));
    eq('감사이력 = 컬럼 + 패키지 1행', dpkg.files[7].content.trim().split('\n').length, dp.columns.length + 1);
    const sc = KC.deid.scanText('환자명: 홍길동, 등록번호 0012345, 2026.03.02 내원. 연락처 010-1234-5678. Hodgkin lymphoma 의증');
    ok('PII 탐지: 이름·환자번호·날짜·전화', ['NAME', 'PATIENT_NO', 'DATE', 'PHONE'].every(function (k) { return sc.counts[k]; }), JSON.stringify(sc.counts));
    ok('PII 치환: 원문 미노출·예외어 보존', ['홍길동', '0012345', '010-1234-5678'].every(function (x) { return sc.redacted.indexOf(x) < 0; }) && sc.redacted.indexOf('Hodgkin') >= 0, sc.redacted);
    // 개발 서버(tools/devserver.py)면 패키지를 tests/_out 에 저장 → tools/verify_generated.py 로 실행 검증
    const bp = KC.deid.plan(brc.table.headers, brc.table.rows, '유방암');
    bp.columns.forEach(function (c) { c.status = '승인'; });
    const bpkg = KC.codegen.buildPackage(bp, { dialect: 'mssql', table: 'dbo.brc' });
    eq('유방암(CP949) 환자 식별 컬럼', bp.patientCol, '병원번호');
    window.TEST_DEID = { crc: dpkg, brc: bpkg };
    for (const [nm, pk] of [['deid_pkg_crc.zip', dpkg], ['deid_pkg_brc.zip', bpkg]]) {
      try {
        await fetch('/__save/' + encodeURIComponent(nm), { method: 'POST', body: KC.writers.zip(pk.files.map(function (f) { return { name: f.path, content: f.content }; })) });
      } catch (e) { /* 정적 서버에서는 저장하지 않음 */ }
    }

    /* 9. DICOM 스크립트 · 로컬 LLM 어댑터 (v0.2 S3) */
    const dcm = KC.dicomgen.python({ input: 'C:\\dicom_in', output: 'C:\\dicom_out' });
    eq('DICOM 스크립트 자체검사 통과', KC.codegen.selfCheck(dcm, 'python').length, 0);
    ok('DICOM: 입력 폴더 보호·예외처리·private 삭제', /in_root in out_root\.parents/.test(dcm) && /InvalidDicomError/.test(dcm) && /remove_private_tags/.test(dcm) && /FileNotFoundError/.test(dcm));
    const actOf = function (o, name) { return KC.dicomgen.actions(o).find(function (a) { return a.name === name; }).action; };
    eq('DICOM 기본: 성별 빈 값·StudyDate 이동·UID 재생성', [actOf({ shiftDates: true }, 'PatientSex'), actOf({ shiftDates: true }, 'StudyDate'), actOf({}, 'StudyInstanceUID')].join(','), 'Z,S,U');
    eq('DICOM 옵션: 환자 특성 유지·날짜 이동 끔', [actOf({ keepPatientChar: true }, 'PatientSex'), actOf({ shiftDates: false }, 'StudyDate')].join(','), 'K,Z');
    eq('LLM 기본 배포본에서는 꺼짐', KC.llm.enabled(), false);
    eq('LLM JSON 추출(코드펜스·앞뒤 문장)', KC.llm.extractJson('다음과 같습니다\n```json\n{"a":{"b":"}"}}\n```').a.b, '}');
    const lp = KC.deid.plan(['환자메모', 'no_patient', 'XYZ_CODE'], [['홍길동 님 내원', 'CRC1', 'A1']], '대장암');
    const vr = KC.llm.validateP1({ columns: [{ raw: 'XYZ_CODE', item_id: 'KCURE-ZZZ-999999', technique: 'KEEP' }, { raw: '환자메모', item_id: null, technique: 'REGEX_PII', reason: '자유문', confidence: '높음' },
      { raw: '없는컬럼', technique: 'KEEP' }, { raw: 'no_patient', technique: 'ENCRYPT' }] }, lp.columns);
    eq('LLM 응답 검증: 환각 ID·잘못된 기법·없는 컬럼 거부', Object.keys(vr).join(','), '환자메모');
    let calls = 0;
    const mock = async function () { calls++; return calls === 1 ? '응답 형식 오류' : JSON.stringify({ columns: [{ raw: 'XYZ_CODE', item_id: null, technique: 'GROUP_RARE', reason: '희귀 코드', confidence: '중간' }] }); };
    const sr = await KC.llm.suggest(lp, { transport: mock });
    ok('LLM 1회 재시도 후 제안', calls === 2 && sr.suggested === 1 && sr.failedBatches === 0, JSON.stringify(sr));
    const xc = lp.columns.find(function (c) { return c.col === 'XYZ_CODE'; });
    ok('LLM 제안은 자동 적용하지 않음', xc.technique !== 'GROUP_RARE' && xc.llm.technique === 'GROUP_RARE');
    KC.llm.apply(xc);
    eq('LLM 제안 적용 → 후보 상태', xc.technique + '/' + xc.status + '/' + xc.ruleId, 'GROUP_RARE/후보/LLM');
    const before = JSON.stringify(lp.columns.map(function (c) { return c.technique; }));
    const fr = await KC.llm.suggest(lp, { transport: async function () { throw new Error('연결 거부'); } });
    ok('LLM 실패 → 규칙 추천 유지', fr.failedBatches === 1 && JSON.stringify(lp.columns.map(function (c) { return c.technique; })) === before, JSON.stringify(fr));
    let rejected = false;
    try { KC.llm.transportFor({ adapter: 'ollama', url: 'https://api.example.com' }); } catch (e) { rejected = true; }
    ok('LLM 외부 주소 거부(loopback만)', rejected);
    ok('프롬프트 내보내기(P1~P3)', /## P1/.test(KC.llm.exportPrompts(lp)) && /## P3 DICOM/.test(KC.llm.exportPrompts(lp)));
    const distMain = await (await fetch('../dist/KCURE_%ED%91%9C%EC%A4%80%EB%B3%80%ED%99%98%EA%B8%B0.html', { cache: 'no-store' })).text();
    const distLlm = await (await fetch('../dist/KCURE_%ED%91%9C%EC%A4%80%EB%B3%80%ED%99%98%EA%B8%B0_LLM.html', { cache: 'no-store' })).text();
    ok('기본 배포본 CSP connect-src none', /connect-src 'none'/.test(distMain) && distMain.indexOf('KC_LLM_BUILD = true') < 0);
    ok('LLM 배포본 CSP = loopback 만', /connect-src http:\/\/127\.0\.0\.1:11434 http:\/\/localhost:11434 http:\/\/127\.0\.0\.1:1234 http:\/\/localhost:1234;/.test(distLlm) && !/connect-src[^;]*https:/.test(distLlm));
    try { await fetch('/__save/deid_dicom.py', { method: 'POST', body: dcm }); } catch (e) { /* 정적 서버 */ }

    /* 10. 승인 · 감사 이력 · 규칙팩 (v0.2 S4) */
    await KC.audit.clear();
    KC.audit.log('test.a', { col: 'x' });
    KC.audit.log('test.b', { col: 'y' });
    const evs = await KC.audit.all();
    eq('감사 이력 2건 기록', evs.length, 2);
    ok('감사 이력 체인 정상', KC.audit.verify(evs).ok && evs[1].prev === evs[0].hash);
    const forged = evs.map(function (x) { return Object.assign({}, x); });
    forged.splice(0, 0, { action: 'forged', hash: 'zzzz', prev: '' });
    ok('감사 이력 중간 삽입 탐지', !KC.audit.verify(forged).ok);
    ok('감사 이력 JSONL', (await KC.audit.toJsonl()).trim().split('\n').length === 2);
    await KC.audit.clear();
    const pack = KC.rulepack.exportPack(window.KCURE_DEID, 'tester');
    ok('규칙팩 검증 통과(SHA-256)', KC.rulepack.validate(pack).ok, KC.rulepack.validate(pack).errors.join('/'));
    const tampered = JSON.parse(JSON.stringify(pack));
    tampered.deid_rules.rules[0].technique = 'KEEP';
    ok('규칙팩 변조 탐지', !KC.rulepack.validate(tampered).ok && /SHA-256/.test(KC.rulepack.validate(tampered).errors.join()));
    const next = JSON.parse(JSON.stringify(window.KCURE_DEID));
    next.version = '0.2.1';
    next.rules.splice(next.rules.length - 1, 0, { id: 'DR-50', when: { name: '^보험번호$' }, technique: 'DELETE', reason: '보험번호', confidence: '높음' });
    next.rules = next.rules.filter(function (r) { return r.id !== 'DR-09'; });
    const np = KC.rulepack.exportPack(next, 'central');
    const df = KC.rulepack.diff(window.KCURE_DEID, next);
    eq('규칙팩 비교(추가·삭제)', df.added.join() + '|' + df.removed.join() + '|' + df.from + '→' + df.to, 'DR-50|DR-09|0.2.0→0.2.1');
    const orig = window.KCURE_DEID;
    KC.rulepack.apply(np);
    eq('규칙팩 교체 후 새 규칙 적용', KC.deid.recommend({ col: '보험번호' }, []).ruleId, 'DR-50');
    window.KCURE_DEID = orig; KC.deid.reload();
    eq('원래 규칙팩 복원', KC.deid.rules().src.version, '0.2.0');
    const badRule = JSON.parse(JSON.stringify(window.KCURE_DEID));
    badRule.rules.push({ id: 'DR-X', when: { name: 'a' }, technique: 'KEEP' });
    ok('규칙팩: 마지막 규칙이 기본 규칙이 아니면 거부', !KC.rulepack.validate(KC.rulepack.exportPack(badRule)).ok);
    const ie = KC.meta.integratedRows([Object.assign({}, crcE[0], { rv: '승인' })]);
    eq('통합 엑셀 검토 상태 열', ie[1][ie[0].indexOf('검토 상태')], '승인');

    /* 5. 항목정의 변환 */
    const all = KC.dcat.fromSpec(CONF, KC.spec.data.meta.cancers);
    eq('명세 DCAT 필수속성 오류 0', all.issues.filter(function (x) { return x.level === '오류'; }).length, 0);
    eq('명세 DCAT 데이터셋 수', all.graph.nodes.filter(function (n) { return n.types[0] === 'dcat:Dataset'; }).length, KC.spec.data.meta.cancers.length);
    const cm1 = KC.artifacts.toKrcdi(CONF, KC.spec.items);
    eq('ConceptMap KR CDI 대응 186', cm1.group[0].element.length, 186);
    const cm2 = KC.artifacts.toKrcore(CONF, KC.spec.items);
    eq('ConceptMap KR Core 1255', cm2.group.reduce(function (s, g) { return s + g.element.length; }, 0), 1255);
    ok('매핑 명세 CSV 행', KC.artifacts.specCsv(KC.spec.items).split('\r\n').length === 1256);
  } catch (e) {
    ok('예외 없이 실행', false, e.stack || e.message);
  }

  const pass = results.filter(function (r) { return r.pass; }).length;
  document.getElementById('summary').innerHTML = '<b class="' + (pass === results.length ? 'pass' : 'fail') + '">' + pass + ' / ' + results.length + ' 통과</b>';
  document.getElementById('results').innerHTML = results.map(function (r) {
    return '<li class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✔ ' : '✘ ') + r.name + (r.pass ? '' : ' — <code>' + r.detail.replace(/</g, '&lt;') + '</code>') + '</li>';
  }).join('');
  window.TEST_DONE = true;
})();
