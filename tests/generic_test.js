/* 범용(비 K-CURE) 데이터 자동 변환 시험
 * samples/generic/ 의 LLM 생성 더미(A·B·C)를 '범용' 모드로 끝까지 변환한다:
 *   ① 컬럼 자동 매핑(정답 대비) ② 6개 표준 메타데이터 패키지 ③ FHIR·KR CDI 데이터 변환 ④ 가명처리 코드 ⑤ 경과기록 PII
 * 정답(TRUTH)은 컬럼 의미를 사람이 붙인 것이다. 컬럼명이 사전에 없으면 '범용 패턴'으로 대조한 결과도 함께 본다.
 * tools/devserver.py 로 띄우면 결과(generic_results.json)와 가명처리 패키지가 tests/_out 에 저장된다. */
(async function () {
  'use strict';
  const $ = function (s) { return document.querySelector(s); };
  const esc = KC.util.esc;
  const G = KC.spec.GENERIC;
  const CONF = { base: 'https://portal.example.kr/', catalogTitle: '범용 데이터 카탈로그', catalogDesc: '비 K-CURE 병원 데이터 시험', publisherName: '시험기관',
    publisherBizNo: '000-00-00000', contactName: '담당자', license: '시험용', accessRights: '제한', endpointURL: 'https://portal.example.kr/fhir',
    ndiNs: 'https://ndi.example/ns#', kcureBase: 'http://khis.kr/fhir/kcure/' };
  const OPTS = { pseudonymize: true, salt: 'generic-test-salt', birthYearOnly: true, autoFix: true, traceItems: true, metaProfile: true, bundleType: 'transaction', datasetId: 'g' };

  async function load(name) {
    const r = await fetch('../samples/generic/' + encodeURIComponent(name), { cache: 'no-store' });
    if (!r.ok) return null;
    return new File([await r.blob()], name);
  }
  async function loadText(name) {
    const r = await fetch('../samples/generic/' + encodeURIComponent(name), { cache: 'no-store' });
    return r.ok ? await r.text() : '';
  }

  async function runSet(key, truth) {
    const out = { key: key };
    const file = await load(key + '_정형.csv');
    if (!file) { out.error = '샘플 없음'; return out; }
    const f = await KC.readers.readFile(file);
    const rows = f.sheets[0].rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim(); }); });
    const table = { headers: rows[0].map(function (h) { return String(h).trim(); }), rows: rows.slice(1) };
    out.encoding = f.encoding; out.rows = table.rows.length; out.headers = table.headers;

    // ① 컬럼 자동 매핑
    const mapping = KC.mapper.autoMap(table.headers, G);
    out.mapping = mapping.map(function (m) {
      const it = KC.spec.byId[m.itemId];
      const want = truth[m.col];
      return { col: m.col, itemId: m.itemId, name: it ? it.name : '', method: m.method, want: want === undefined ? '?' : want,
        ok: want === undefined ? null : (want || '') === (m.itemId || '') };
    });
    out.mapped = mapping.filter(function (m) { return m.itemId; }).length;
    out.correct = out.mapping.filter(function (m) { return m.ok; }).length;
    out.labeled = out.mapping.filter(function (m) { return m.ok !== null; }).length;

    // ② 메타데이터 패키지 (KR CDI · KR Core · mCODE · OMOP · DCAT · ARGO)
    const entries = KC.meta.entriesFromColumns(table.headers, G).map(function (e) { e.include = true; return e; });
    const pkg = KC.meta.build(CONF, G, entries);
    const s = pkg.summary;
    out.meta = { files: pkg.files.length, dcatErrors: pkg.dcatIssues.filter(function (x) { return x.level === '오류'; }).length,
      krcdi: s.krcdi, krcdiElements: s.krcdiElements, krcore: [s.krcoreDirect, s.krcoreConstrained, s.krcoreExtension], omop: s.omop, mcode: s.mcode, argo: s.argo };

    // ③ 데이터 변환 (FHIR · KR CDI · DCAT)
    const opts = Object.assign({}, OPTS, { patientCol: KC.mapper.guessPatientColumn(mapping), cancer: G });
    const run = await KC.pipeline.run(table, mapping, opts);
    const types = {};
    run.bundle.entry.forEach(function (e) { types[e.resource.resourceType] = (types[e.resource.resourceType] || 0) + 1; });
    const obs = run.bundle.entry.map(function (e) { return e.resource; }).filter(function (r) { return r.resourceType === 'Observation'; });
    out.fhir = { patients: run.meta.patients, resources: run.bundle.entry.length, errors: run.fhirErrors, types: types,
      labCoded: obs.filter(function (r) { return r.code && (r.code.coding || []).some(function (c) { return /local-test-code$/.test(c.system); }); }).length,
      withRange: obs.filter(function (r) { return r.referenceRange; }).length, withInterp: obs.filter(function (r) { return r.interpretation; }).length,
      pidRaw: JSON.stringify(run.bundle).indexOf(String(table.rows[0][opts.patientCol] || '@@')) >= 0,
      // 직접식별자(성명·연락처 등) 원문이 FHIR·KR CDI 결과에 남았는지 (가명처리 ON)
      directLeak: (function () {
        const blob = JSON.stringify(run.bundle) + JSON.stringify(run.krcdi.records) + JSON.stringify(run.krcdi.csvRows);
        const vals = [];
        mapping.forEach(function (m) { const it = KC.spec.byId[m.itemId]; if (it && KC.pipeline.isDirectId(it)) table.rows.forEach(function (r) { const v = String(r[m.idx] || '').trim(); if (v.length >= 2) vals.push(v); }); });
        return vals.filter(function (v) { return blob.indexOf(v) >= 0; }).length;
      })(),
      warns: run.log.count('경고'), errorsLog: run.log.count('오류'),
      sample: obs[0] ? { code: obs[0].code, value: obs[0].valueQuantity || obs[0].valueString || obs[0].valueCodeableConcept, ref: obs[0].referenceRange, interp: obs[0].interpretation } : null };
    out.krcdiValues = run.krcdi.summary.values;

    // ④ 가명처리 코드
    const plan = KC.deid.plan(table.headers, table.rows, G);
    out.deid = plan.columns.map(function (c) { return { col: c.col, technique: c.technique, rule: c.ruleId, conf: c.confidence, item: c.item ? c.item.name : '' }; });
    plan.columns.forEach(function (c) { c.status = '승인'; });
    const dp = KC.codegen.buildPackage(plan, { dialect: 'postgres', table: 'src.' + key.toLowerCase(), input: 'C:\\kcure\\in\\' + key + '.csv', output: 'C:\\kcure\\out\\' + key + '_deid.csv' });
    out.deidFiles = dp.files.length;
    try { await fetch('/__save/' + encodeURIComponent('generic_pkg_' + key + '.zip'), { method: 'POST', body: KC.writers.zip(dp.files.map(function (x) { return { name: x.path, content: x.content }; })) }); } catch (e) { /* 정적 서버 */ }

    // ⑤ 경과기록 PII
    const notes = await loadText(key + '_경과기록.txt');
    if (notes) { const sc = KC.deid.scanText(notes); out.notes = { chars: notes.length, counts: sc.counts, redacted: sc.redacted.slice(0, 600), original: notes.slice(0, 600) }; }
    return out;
  }

  function render(res) {
    $('#out').innerHTML = res.map(function (r) {
      if (r.error) return '<h2>' + r.key + '</h2><p>' + esc(r.error) + '</p>';
      return '<h2>세트 ' + r.key + ' · ' + r.rows + '행 · ' + r.headers.length + '컬럼 (' + esc(r.encoding) + ')</h2>' +
        '<p>매핑 ' + r.mapped + '/' + r.headers.length + ' · 정답 ' + r.correct + '/' + r.labeled + ' · 메타 파일 ' + r.meta.files + ' · DCAT 오류 ' + r.meta.dcatErrors +
        ' · KR CDI ' + r.meta.krcdiElements + '항목 · FHIR ' + r.fhir.resources + '개(구조오류 ' + r.fhir.errors + ') · 환자 ' + r.fhir.patients + '</p>' +
        '<table><tr><th>컬럼</th><th>매핑</th><th>방식</th><th>정답</th><th>가명처리</th></tr>' + r.mapping.map(function (m, i) {
          const d = r.deid[i] || {};
          return '<tr><td>' + esc(m.col) + '</td><td>' + esc(m.itemId ? m.itemId + ' ' + m.name : '미매핑') + '</td><td>' + esc(m.method) + '</td><td class="' + (m.ok === null ? '' : m.ok ? 'ok' : 'bad') + '">' +
            esc(m.ok === null ? '—' : m.ok ? '맞음' : '틀림(' + (m.want || '미매핑') + ')') + '</td><td>' + esc(d.technique + ' (' + d.rule + ')') + '</td></tr>';
        }).join('') + '</table>' + (r.notes ? '<p>경과기록 PII: ' + esc(JSON.stringify(r.notes.counts)) + '</p><pre>' + esc(r.notes.redacted) + '</pre>' : '');
    }).join('');
  }

  KC.spec.init(window.KCURE_SPEC);
  KC.APP_VERSION = 'generic-test';
  // 정답: 컬럼 의미에 맞는 범용 사전 항목ID (사람이 지정). '' 은 대응 항목이 없어야 맞음
  const TRUTH = await (await fetch('generic_truth.json', { cache: 'no-store' })).json();
  const res = [];
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) res.push(await runSet(k, TRUTH[k] || {}));
  render(res);
  window.GENERIC_RESULT = res;
  try { await fetch('/__save/generic_results.json', { method: 'POST', body: JSON.stringify(res, null, 1) }); } catch (e) { /* 정적 서버 */ }
  $('#status').textContent = '완료';
  window.GENERIC_DONE = true;
})().catch(function (e) { document.querySelector('#status').textContent = '오류: ' + e.stack; window.GENERIC_DONE = true; });
