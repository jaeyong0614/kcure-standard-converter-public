/* 화면 제어 */
window.KC = window.KC || {};
KC.APP_VERSION = 'v0.2.0-dev (프로토타입)';

(function () {
  'use strict';
  const U = KC.util, esc = U.esc;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ---------- 설정 ---------- */
  const CONF_FIELDS = [
    ['base', '카탈로그 기준 URL (중개포털 주소)', 'https://kcure-portal.example.kr/', '[확인 필요] 실제 중개포털 도메인. 카탈로그·데이터셋 IRI의 기준'],
    ['catalogTitle', '카탈로그 제목 (dct:title, 필수)', 'K-CURE 암 데이터 표준 카탈로그', ''],
    ['catalogDesc', '카탈로그 설명 (dct:description, 필수)', 'K-CURE 9개 암종 임상 데이터를 KR CDI V3·KR Core V2(HL7 FHIR R4) 표준으로 정비한 데이터셋 카탈로그', ''],
    ['publisherName', '제공기관명', '한국보건의료정보원', ''],
    ['publisherBizNo', '제공기관 사업자등록번호 (dct:publisher → foaf:name)', '', '[확인 필요] NIA 가이드는 사업자번호 기입을 요구'],
    ['contactName', '담당 부서/담당자 (dcat:contactPoint → vcard:fn)', '데이터활용지원사업단', ''],
    ['contactEmail', '담당자 이메일', '', ''],
    ['contactPhone', '담당자 전화번호', '', ''],
    ['license', '라이선스 (dct:license)', '[확인 필요] 이용약관', '예: 공공누리 제4유형, 기관 데이터 이용약관 URL'],
    ['accessRights', '접근권한 (dct:accessRights)', '심의 후 제한적 제공(가명정보)', ''],
    ['rights', '저작권 정보 (dct:rights)', '', ''],
    ['homepage', '카탈로그 홈페이지 (foaf:homepage)', '', ''],
    ['endpointURL', '데이터서비스 엔드포인트 (dcat:endpointURL, 필수)', 'https://kcure-portal.example.kr/fhir', '[확인 필요] FHIR 서버 base URL'],
    ['endpointDesc', '엔드포인트 설명 URL (dcat:endpointDescription)', 'https://kcure-portal.example.kr/fhir/metadata', 'FHIR CapabilityStatement 주소'],
    ['downloadBase', '배포 파일 다운로드 기준 URL (dcat:accessURL)', '', '비우면 {기준 URL}/download/'],
    ['token', 'NDI 연계기관 TOKEN (ndi:pltfrmAccessToken, 필수)', '', '[확인 필요] One-윈도우 가입 후 발급'],
    ['ndiNs', 'ndi 네임스페이스 URI', 'https://ndi.nia.or.kr/ns#', '[확인 필요] 가이드에 URI 미정의(표 11 "-")'],
    ['accrualPeriodicity', '갱신주기 (dct:accrualPeriodicity)', '', '예: 연 1회'],
    ['freeYn', '무료여부 (ndi:freeYn)', '', '공백 시 무료'],
    ['kcureBase', 'K-CURE FHIR 네임스페이스', 'http://khis.kr/fhir/kcure/', '[확인 필요] KR-mCODE 프로파일·코드시스템 canonical 기준'],
    ['patientIdSystem', '환자 식별자 system (가명처리 OFF 시)', '', '예: https://병원도메인/Identifier/patient']
  ];
  const DEFAULT_CONF = CONF_FIELDS.reduce(function (o, f) { o[f[0]] = f[2]; return o; }, {});

  function loadConf() {
    try { return Object.assign({}, DEFAULT_CONF, JSON.parse(localStorage.getItem('kcure.conf') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULT_CONF); }
  }

  const st = {
    file: null, sheetIdx: 0, headerRow: 1, table: null, cancer: '', mapping: [], patientCol: -1,
    run: null, outputs: [], conf: loadConf(), logPage: 0, specPage: 0, msel: null, mpkg: null, mmPage: 0
  };

  /* ---------- 탭 ---------- */
  function showTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'p-' + name); });
    if (name === 'mmap') renderMm();
    if (name === 'mout') renderMout();
    if (name === 'deid') KC.deidUi.render();
    window.scrollTo(0, 0);
  }
  function markDone(name) { const t = $('.tab[data-tab="' + name + '"]'); if (t) t.classList.add('done'); }

  function stat(k, v, s, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>';
  }
  function note(msg, cls) { return '<div class="note ' + (cls || '') + '">' + msg + '</div>'; }
  function pillFor(level) { return level === '오류' ? 'err' : level === '경고' ? 'warn' : 'info'; }

  /* ---------- 1. 데이터 불러오기 ---------- */
  async function handleFile(file) {
    $('#loadErr').innerHTML = '';
    try {
      const f = await KC.readers.readFile(file);
      if (!f.sheets.length || !f.sheets.some(function (s) { return s.rows.length; })) throw new Error('읽을 수 있는 행이 없습니다.');
      setFile(f);
    } catch (e) {
      $('#loadErr').innerHTML = note('파일을 읽지 못했습니다: ' + esc(e.message), 'err');
    }
  }

  function loadSample(key) {
    const s = window.KCURE_SAMPLES && window.KCURE_SAMPLES[key];
    if (!s) return;
    setFile({ name: s.name, size: U.byteLength(s.csv), encoding: 'UTF-8(내장 합성 샘플)', sheets: [{ name: s.name, rows: KC.readers.parseCsv(s.csv, ',') }] });
  }

  function setFile(f) {
    st.file = f;
    st.sheetIdx = Math.max(0, f.sheets.findIndex(function (s) { return s.rows.length > 1; }));
    st.headerRow = guessHeaderRow(f.sheets[st.sheetIdx].rows);
    $('#sheetSel').innerHTML = f.sheets.map(function (s, i) { return '<option value="' + i + '">' + esc(s.name) + ' (' + s.rows.length + '행)</option>'; }).join('');
    $('#sheetSel').value = String(st.sheetIdx);
    $('#sheetSel').disabled = f.sheets.length < 2;
    $('#headerRow').value = st.headerRow;
    buildTable();
    st.cancer = guessCancer(st.table.headers);
    $('#cancerSel').value = st.cancer;
    renderLoadInfo();
    if (isSpecWorkbook(f)) {
      $('#loadErr').innerHTML = note(
        '<b>이 파일은 환자 데이터가 아니라 항목정의서 형식입니다.</b> 이 탭(부가 기능)은 환자 데이터용이라 컬럼이 하나도 매핑되지 않습니다.<br>' +
        '· 이 파일의 항목을 KR CDI·KR Core·DCAT·ARGO 메타데이터로 변환하려면 → <button class="btn sm" data-goto="meta">메타데이터 변환으로 보내기</button><br>' +
        '· 이 파일을 변환 기준(명세)으로 쓰려면 → <button class="btn sm" data-goto="specApply">명세로 적용</button>', 'warn');
    }
    st.mapping = [];
    st.run = null;
    resetOutputs();
    $$('.tab').forEach(function (t) { t.classList.remove('done'); });
    markDone('load');
  }

  function buildTable() {
    const rows = st.file.sheets[st.sheetIdx].rows;
    const hi = Math.max(0, Math.min(rows.length - 1, st.headerRow - 1));
    const seen = {};
    const headers = (rows[hi] || []).map(function (h, i) {
      let name = String(h == null ? '' : h).trim() || ('열' + (i + 1));
      if (seen[name]) name = name + '_' + (i + 1);
      seen[name] = 1;
      return name;
    });
    const data = rows.slice(hi + 1).filter(function (r) {
      return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; });
    }).map(function (r) {
      const o = new Array(headers.length);
      for (let i = 0; i < headers.length; i++) o[i] = r[i] == null ? '' : r[i];
      return o;
    });
    st.table = { headers: headers, rows: data };
  }

  function nonEmpty(r) { return (r || []).filter(function (v) { return String(v == null ? '' : v).trim() !== ''; }).length; }

  /** 헤더 행 추정: 처음 10행 중 값이 가장 많이 찬 첫 행 (제목·안내 행이 위에 있는 엑셀 대응) */
  function guessHeaderRow(rows) {
    let best = 0, bestN = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const n = nonEmpty(rows[i]);
      if (n > bestN) { best = i; bestN = n; }
    }
    return best + 1;
  }

  /** 원천 데이터가 아니라 항목정의서(10_항목정의_최종 형식)인지 판별 */
  function isSpecWorkbook(f) {
    return f.sheets.some(function (s) {
      return s.rows.slice(0, 15).some(function (r) {
        const h = r.map(function (v) { return String(v == null ? '' : v).trim(); });
        return h.indexOf('항목ID') >= 0 && h.indexOf('표준항목명') >= 0 && h.indexOf('KR_Core_FHIR_Path') >= 0;
      });
    });
  }

  function guessCancer(headers) {
    const counts = {};
    headers.forEach(function (h) {
      const m = KC.mapper.matchOne(h, '');
      if (!m.itemId) return;
      KC.spec.byId[m.itemId].cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
      (KC.spec.aliasIndex.get(U.normKey(h)) || []).forEach(function (a) { a.cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 2; }); });
    });
    const best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    // K-CURE 항목으로 잡히는 컬럼보다 범용 사전으로 잡히는 컬럼이 많으면 범용(비 K-CURE) 데이터로 본다
    const kcure = headers.filter(function (h) { return KC.mapper.matchOne(h, '').itemId; }).length;
    const generic = headers.filter(function (h) { const id = KC.mapper.matchOne(h, KC.spec.GENERIC).itemId; return id && KC.spec.byId[id].generic; }).length;
    if (generic > kcure) return KC.spec.GENERIC;
    return best || '';
  }

  function renderLoadInfo() {
    $('#loadInfo').classList.remove('hidden');
    $('#fileTitle').textContent = st.file.name;
    const t = st.table;
    const mappedGuess = t.headers.filter(function (h) { return KC.mapper.matchOne(h, st.cancer).itemId; }).length;
    $('#fileStats').innerHTML = stat('데이터 행', t.rows.length.toLocaleString()) + stat('컬럼', t.headers.length) +
      stat('자동매핑 예상', mappedGuess + ' / ' + t.headers.length, '표준명·원천별칭 일치') +
      stat('인코딩', st.file.encoding) + stat('파일 크기', U.fmtBytes(st.file.size || 0));
    const head = '<tr>' + t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>';
    const body = t.rows.slice(0, 5).map(function (r) { return '<tr>' + r.map(function (v) { return '<td class="trunc">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    $('#preview').innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  /* ---------- 2. 매핑 ---------- */
  function ensureMapping(saved) {
    if (!st.mapping.length || saved) {
      st.mapping = KC.mapper.autoMap(st.table.headers, st.cancer, saved);
      st.patientCol = KC.mapper.guessPatientColumn(st.mapping);
      if (saved && saved.patientColumn) {
        const idx = st.table.headers.indexOf(saved.patientColumn);
        if (idx >= 0) st.patientCol = idx;
      }
    }
    renderMapping();
  }

  function itemLabel(it) { return it ? it.id + ' ' + it.name : ''; }

  function parseItemInput(v) {
    v = String(v || '').trim();
    if (!v) return '';
    const m = /KCURE-[A-Z]{3}-\d{6}/.exec(v);
    if (m && KC.spec.byId[m[0]]) return m[0];
    const hit = KC.mapper.matchOne(v, st.cancer);
    return hit.itemId || null;
  }

  function mapRowHtml(m) {
    const it = KC.spec.byId[m.itemId];
    const samples = [];
    for (let i = 0; i < st.table.rows.length && samples.length < 3; i++) {
      const v = String(st.table.rows[i][m.idx] || '').trim();
      if (v && samples.indexOf(v) < 0) samples.push(v);
    }
    const methodCls = !m.itemId ? 'warn' : m.method === '수동' ? 'info' : 'ok';
    const cdi = it && it.cdi && it.cdi.el ? esc(it.cdi.cls + ' / ' + it.cdi.el) + ' <span class="pill">' + esc(it.cdi.req) + '</span>' : '<span class="muted">—</span>';
    const core = it ? '<span class="mono">' + esc(it.core.path) + '</span> <span class="pill ' + KC.match.cls(it.core.judge) + '" title="원래 판정: ' + esc(it.core.judge) + '">' + esc(KC.match.label(it.core.judge)) + '</span>' : '';
    const alt = m.alternatives && m.alternatives.length ? '<div class="small muted">다른 후보 ' + m.alternatives.length + '개</div>' : '';
    return '<tr data-idx="' + m.idx + '"><td class="num">' + (m.idx + 1) + '</td><td><b>' + esc(m.col) + '</b>' + (m.idx === st.patientCol ? ' <span class="pill info">환자키</span>' : '') +
      '</td><td class="trunc small">' + esc(samples.join(' · ')) + '</td>' +
      '<td><input type="text" list="itemList" value="' + esc(itemLabel(it)) + '" data-idx="' + m.idx + '" placeholder="항목 미인식 — 항목ID 또는 이름 입력">' + alt +
      (it ? '<div class="small muted">' + esc(it.type + (it.unit ? ' · ' + it.unit : '') + (it.allowed ? ' · ' + it.allowed : '')) + '</div>' : '') + '</td>' +
      '<td><span class="pill ' + methodCls + '">' + esc(KC.match.label(m.method)) + '</span></td><td class="small">' + cdi + '</td><td class="small">' + core + '</td></tr>';
  }

  function renderMapping() {
    const f = $('#mapFilter').value;
    const rows = st.mapping.filter(function (m) { return f === 'all' || (f === 'mapped' ? m.itemId : !m.itemId); });
    $('#mapTable').innerHTML = '<table><thead><tr><th class="num">#</th><th>원천 컬럼</th><th>샘플값</th><th>K-CURE 표준항목</th><th>매핑방식</th><th>KR CDI</th><th>KR Core 경로 · 판정</th></tr></thead><tbody>' +
      rows.map(mapRowHtml).join('') + '</tbody></table>';
    $('#patientCol').innerHTML = st.table.headers.map(function (h, i) { return '<option value="' + i + '">' + esc(h) + '</option>'; }).join('');
    $('#patientCol').value = String(st.patientCol);
    renderMapStats();
  }

  function renderMapStats() {
    const n = st.mapping.length;
    const mapped = st.mapping.filter(function (m) { return m.itemId; });
    const by = U.groupCount(mapped, function (m) { return m.method; });
    const cdi = mapped.filter(function (m) { const it = KC.spec.byId[m.itemId]; return it.cdi && it.cdi.el; }).length;
    $('#mapStats').innerHTML = stat('매핑됨', mapped.length + ' / ' + n, '', mapped.length ? 'ok' : '') + stat('항목 미인식', n - mapped.length, '변환 제외', n - mapped.length ? 'warn' : '') +
      stat('표준명 일치', by['표준명'] || 0) + stat('원천별칭 일치', by['원천별칭'] || 0) + stat('수동·설정', (by['수동'] || 0) + (by['설정파일'] || 0)) + stat('KR CDI 매칭 컬럼', cdi);
  }

  /* ---------- 3. 변환 ---------- */
  function randomSalt() {
    const a = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function doRun() {
    if (!st.table) { $('#runMsg').textContent = '먼저 데이터를 불러오세요.'; return; }
    if (!st.mapping.length) ensureMapping();
    const opts = {
      patientCol: +$('#patientCol').value, pseudonymize: $('#optPseudo').checked, salt: $('#optSalt').value || '',
      birthYearOnly: $('#optBirthYear').checked, autoFix: $('#optAutoFix').checked, traceItems: $('#optTrace').checked,
      metaProfile: $('#optProfile').checked, bundleType: $('#optBundle').value, kcureBase: st.conf.kcureBase,
      patientIdSystem: st.conf.patientIdSystem, datasetId: st.file.name, cancer: st.cancer
    };
    if (opts.pseudonymize && opts.salt.length < 8) { $('#runMsg').textContent = '가명처리 솔트를 8자 이상 입력하세요.'; return; }
    $('#runBtn').disabled = true;
    $('#runProg').classList.remove('hidden');
    const bar = $('#runProg > div');
    const t0 = performance.now();
    try {
      st.run = await KC.pipeline.run(st.table, st.mapping, opts, function (d, n) {
        bar.style.width = (n ? Math.round(d / n * 100) : 100) + '%';
        $('#runMsg').textContent = '변환 중… ' + d + ' / ' + n + '행';
      });
      st.run.opts = opts;
      buildOutputs();
      $('#runMsg').textContent = '완료 (' + ((performance.now() - t0) / 1000).toFixed(1) + '초)';
      renderRunResult();
      renderOutputs();
      markDone('map'); markDone('run'); markDone('out');
    } catch (e) {
      console.error(e);
      $('#runMsg').innerHTML = '<span style="color:var(--err)">오류: ' + esc(e.message) + '</span>';
    } finally {
      $('#runBtn').disabled = false;
      setTimeout(function () { $('#runProg').classList.add('hidden'); bar.style.width = '0'; }, 600);
    }
  }

  function stamp() { return U.today().replace(/-/g, ''); }
  function baseName() { return 'KCURE_' + (st.cancer || '데이터') + '_' + stamp(); }

  function buildOutputs() {
    const r = st.run, bn = baseName();
    const outs = [];
    const add = function (o) { o.bytes = U.byteLength(o.content); outs.push(o); return o; };
    const bundleStr = JSON.stringify(r.bundle, null, r.bundle.entry.length > 20000 ? 0 : 2);
    const fhir = add({ id: 'fhir', std: 'KR Core V2 · FHIR R4', title: 'FHIR Bundle (' + r.bundle.type + ')', desc: '리소스 ' + r.bundle.entry.length.toLocaleString() + '개',
      fileName: bn + '_FHIR_Bundle.json', mime: 'application/fhir+json', mediaType: 'application/fhir+json', format: 'JSON', conformsTo: 'krcore', content: bundleStr });
    add({ id: 'ndjson', std: 'KR Core V2 · FHIR R4', title: 'FHIR NDJSON (Bulk Data 형식)', desc: '한 줄 = 리소스 1개', fileName: bn + '_FHIR.ndjson', mime: 'application/fhir+ndjson',
      content: r.bundle.entry.map(function (e) { return JSON.stringify(e.resource); }).join('\n') + '\n' });
    const cdiJson = add({ id: 'krcdi-json', std: 'KR CDI V3', title: 'KR CDI 교류데이터 (JSON)', desc: '환자별 14분류 구조 · 값 ' + r.krcdi.summary.values.toLocaleString() + '건',
      fileName: bn + '_KRCDI.json', mime: 'application/json', mediaType: 'application/json', format: 'JSON', conformsTo: 'krcdi',
      content: JSON.stringify({ standard: r.krcdi.standard, note: r.krcdi.note, generated: U.nowIso(), source: st.file.name, summary: r.krcdi.summary,
        coverage: r.krcdi.coverage.filter(function (c) { return c.mapped.length || c.values; }), conformance: r.krcdi.conformance, records: r.krcdi.records }, null, 2) });
    const cdiCsv = add({ id: 'krcdi-csv', std: 'KR CDI V3', title: 'KR CDI 교류데이터 (CSV, long)', desc: '환자·분류·항목·값 1행', fileName: bn + '_KRCDI.csv',
      mime: 'text/csv;charset=utf-8', mediaType: 'text/csv', format: 'CSV', conformsTo: 'krcdi', content: U.toCsv(r.krcdi.csvRows) });
    add({ id: 'krcdi-cov', std: 'KR CDI V3', title: 'KR CDI 80항목 커버리지·적합성', desc: '항목별 매핑 컬럼·값 수·R 누락', fileName: bn + '_KRCDI_커버리지.csv', mime: 'text/csv;charset=utf-8',
      content: U.toCsv([['No', '분류', '항목', '영문', '필수', 'KR Core 1순위 경로', '매핑 컬럼', '값 수', '적합성']].concat(r.krcdi.coverage.map(function (c) {
        const miss = r.krcdi.conformance.some(function (x) { return x.cls === c.cls && x.el === c.el; });
        return [c.no, c.cls, c.el, c.elEn, c.req, c.corePath, c.mapped.join(' | '), c.values, miss ? 'R 누락' : ''];
      }))) });
    // DCAT: 배포 체크섬 계산 후 생성
    [fhir, cdiJson, cdiCsv].forEach(function (o) { o.sha256 = KC.sha256(o.content); });
    const dc = KC.dcat.fromRun(st.conf, r, { fileName: st.file.name, encoding: st.file.encoding, cancer: st.cancer, pseudonymized: r.opts.pseudonymize }, [fhir, cdiJson, cdiCsv]);
    st.dcatIssues = dc.issues;
    add({ id: 'dcat-rdf', std: 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', title: 'DCAT 카탈로그 (RDF/XML)', desc: 'One-윈도우 연계 기본 형식', fileName: bn + '_DCAT.rdf', mime: 'application/rdf+xml', content: KC.dcat.toRdfXml(dc.graph) });
    add({ id: 'dcat-ttl', std: 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', title: 'DCAT 카탈로그 (Turtle)', desc: '사람이 읽기 쉬운 RDF', fileName: bn + '_DCAT.ttl', mime: 'text/turtle', content: KC.dcat.toTurtle(dc.graph) });
    add({ id: 'dcat-jsonld', std: 'DCAT 2.0 (DCAT-AP 2.1 · NIA)', title: 'DCAT 카탈로그 (JSON-LD)', desc: 'API·AI 친화 형식', fileName: bn + '_DCAT.jsonld', mime: 'application/ld+json', content: KC.dcat.toJsonLd(dc.graph) });
    add({ id: 'log', std: '검증', title: '변환·검증 로그 (CSV)', desc: '오류 ' + r.log.count('오류') + ' · 경고 ' + r.log.count('경고') + ' · 정보 ' + r.log.count('정보'),
      fileName: bn + '_변환로그.csv', mime: 'text/csv;charset=utf-8', content: U.toCsv(r.log.toCsvRows()) });
    add({ id: 'mapcfg', std: '설정', title: '컬럼 매핑 설정 (JSON)', desc: '같은 형식 파일 재변환 시 불러오기', fileName: bn + '_매핑설정.json', mime: 'application/json',
      content: JSON.stringify(KC.mapper.exportConfig(st.mapping, { patientColumn: st.table.headers[r.opts.patientCol], cancer: st.cancer }), null, 2) });
    st.outputs = outs;
  }

  function renderRunResult() {
    const r = st.run;
    $('#runResult').classList.remove('hidden');
    const total = r.bundle.entry.length;
    $('#runStats').innerHTML = stat('환자', r.meta.patients.toLocaleString(), (r.opts.pseudonymize ? '가명키' : '원 식별자') + ' 기준') +
      stat('원천 행', r.meta.rows.toLocaleString(), r.meta.skipped ? '건너뜀 ' + r.meta.skipped : '') +
      stat('매핑 컬럼', r.meta.mappedColumns + ' / ' + r.meta.totalColumns) +
      stat('FHIR 리소스', total.toLocaleString(), '구조오류 ' + r.fhirErrors, r.fhirErrors ? 'err' : 'ok') +
      stat('KR CDI 값', r.krcdi.summary.values.toLocaleString(), '80항목 중 ' + r.krcdi.summary.elementsCovered + '개 채움') +
      stat('오류', r.log.count('오류'), '', r.log.count('오류') ? 'err' : 'ok') + stat('경고', r.log.count('경고'), '', r.log.count('경고') ? 'warn' : '') + stat('정보', r.log.count('정보'));
    const stats = r.fhirStats;
    $('#resTable').innerHTML = '<table><thead><tr><th>리소스</th><th class="num">개수</th></tr></thead><tbody>' +
      Object.keys(stats).sort(function (a, b) { return stats[b] - stats[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + stats[k].toLocaleString() + '</td></tr>'; }).join('') + '</tbody></table>';
    const cov = r.krcdi.coverage.filter(function (c) { return c.mapped.length || c.values; });
    const miss = {};
    r.krcdi.conformance.forEach(function (c) { miss[c.cls + '|' + c.el] = 1; });
    $('#cdiTable').innerHTML = '<table><thead><tr><th>분류</th><th>항목</th><th>필수</th><th class="num">값</th></tr></thead><tbody>' +
      (cov.length ? cov.map(function (c) { return '<tr><td>' + esc(c.cls) + '</td><td>' + esc(c.el) + '</td><td>' + esc(c.req) + '</td><td class="num">' + c.values + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="muted">KR CDI 매칭 컬럼 없음</td></tr>') +
      r.krcdi.conformance.map(function (c) { return '<tr><td>' + esc(c.cls) + '</td><td>' + esc(c.el) + '</td><td>R</td><td class="num"><span class="pill warn">누락</span></td></tr>'; }).join('') + '</tbody></table>';
    const codes = Object.keys(U.groupCount(r.log.entries, function (e) { return e.code; })).sort();
    $('#logCode').innerHTML = '<option value="">전체 코드</option>' + codes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    st.logPage = 0;
    renderLog();
  }

  function renderLog() {
    if (!st.run) return;
    const lv = $('#logLevel').value, cd = $('#logCode').value, q = $('#logSearch').value.trim().toLowerCase();
    const rows = st.run.log.entries.filter(function (e) {
      return (!lv || e.level === lv) && (!cd || e.code === cd) &&
        (!q || (e.col + ' ' + e.item + ' ' + e.msg + ' ' + e.target).toLowerCase().indexOf(q) >= 0);
    });
    const per = 100, pages = Math.max(1, Math.ceil(rows.length / per));
    st.logPage = Math.min(st.logPage, pages - 1);
    const slice = rows.slice(st.logPage * per, st.logPage * per + per);
    $('#logTable').innerHTML = '<table><thead><tr><th>수준</th><th>코드</th><th>메시지</th><th class="num">행</th><th>컬럼</th><th>항목ID</th><th>값</th><th>대상</th></tr></thead><tbody>' +
      (slice.length ? slice.map(function (e) {
        return '<tr><td><span class="pill ' + pillFor(e.level) + '">' + e.level + '</span></td><td class="mono small">' + esc(e.code) + '</td><td>' + esc(e.msg) + '</td><td class="num">' + esc(e.row) +
          '</td><td>' + esc(e.col) + '</td><td class="mono small">' + esc(e.item) + '</td><td class="trunc">' + esc(e.value) + '</td><td class="mono small trunc">' + esc(e.target) + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">해당 로그 없음</td></tr>') + '</tbody></table>';
    $('#logPager').innerHTML = rows.length + '건 · ' + (st.logPage + 1) + ' / ' + pages + ' 쪽 <button class="btn sm" data-lp="-1"' + (st.logPage ? '' : ' disabled') + '>이전</button><button class="btn sm" data-lp="1"' + (st.logPage < pages - 1 ? '' : ' disabled') + '>다음</button>';
  }

  /* ---------- 4. 결과 ---------- */
  function resetOutputs() {
    st.outputs = [];
    $('#outs').innerHTML = '';
    $('#outEmpty').classList.remove('hidden');
    $('#outView').classList.add('hidden');
    $('#dcatIssuesCard').classList.add('hidden');
    $('#runResult').classList.add('hidden');
  }

  function outCard(o, i, prefix) {
    return '<div class="out"><div class="std">' + esc(o.std) + '</div><div class="t">' + esc(o.title) + '</div><div class="m">' + esc(o.desc || '') + '</div>' +
      '<div class="m mono">' + esc(o.fileName) + ' · ' + U.fmtBytes(o.bytes) + '</div>' +
      '<div class="act"><button class="btn sm primary" data-' + prefix + 'dl="' + i + '">내려받기</button><button class="btn sm" data-' + prefix + 'pv="' + i + '">미리보기</button></div></div>';
  }

  function renderOutputs() {
    $('#outEmpty').classList.toggle('hidden', !!st.outputs.length);
    $('#outs').innerHTML = st.outputs.map(function (o, i) { return outCard(o, i, ''); }).join('') +
      '<div class="out"><div class="std">일괄</div><div class="t">전체 산출물 내려받기</div><div class="m">위 파일을 차례로 저장합니다(브라우저가 여러 파일 다운로드 허용을 물을 수 있음).</div><div class="act"><button class="btn sm primary" id="dlAll">모두 내려받기</button></div></div>';
    $('#dcatIssuesCard').classList.remove('hidden');
    $('#dcatIssues').innerHTML = issuesTable(st.dcatIssues);
  }

  function issuesTable(issues) {
    const order = { '오류': 0, '경고': 1, '정보': 2 };
    issues = issues.slice().sort(function (a, b) { return order[a.level] - order[b.level]; });
    const err = issues.filter(function (x) { return x.level === '오류'; }).length;
    return (err ? note('필수 속성 ' + err + '건 누락 — One-윈도우 연계 전에 설정 탭에서 보완하세요.', 'err') : note('NIA 가이드 필수 속성은 모두 채워졌습니다. 경고(TOKEN 등 [확인 필요] 값)는 운영 전에 실제 값으로 바꿔야 합니다.')) +
      '<table><thead><tr><th>수준</th><th>클래스</th><th>속성</th><th>내용</th><th>노드</th></tr></thead><tbody>' +
      issues.map(function (x) { return '<tr><td><span class="pill ' + pillFor(x.level) + '">' + x.level + '</span></td><td class="mono small">' + esc(x.cls) + '</td><td class="mono small">' + esc(x.prop) + '</td><td>' + esc(x.msg) + '</td><td class="mono small trunc">' + esc(x.node) + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  /** 미리보기: CSV·TSV·XLSX 는 엑셀 같은 표로, 나머지는 텍스트로 (KC.sheetView) */
  function preview(target, o) {
    KC.sheetView.show(target, o);
  }

  /* ================= 메타데이터 변환 (주 기능) ================= */
  /* st.msel = {cancer, source, fileName, entries:[{col,item,method,include,argoKey?}]} */

  function renderSelCancers() {
    const G = KC.spec.GENERIC;
    $('#selCancers').innerHTML = KC.spec.data.meta.cancers.concat([G]).map(function (c) {
      const n = c === G ? KC.spec.generic.length : KC.spec.items.filter(function (it) { return it.cancers.indexOf(c) >= 0; }).length;
      return '<label class="chip' + (c === G ? ' generic' : '') + '" title="' + (c === G ? 'K-CURE 가 아닌 일반 병원 데이터(입원·외래·검사·처방 등) — KR CDI V3 기반 범용 사전' : '') + '"><input type="radio" name="mcancer" value="' + esc(c) + '"' +
        (st.msel && st.msel.source === 'cancer' && st.msel.cancer === c ? ' checked' : '') + '>' + esc(c === G ? '범용(비 K-CURE)' : c) + ' <small>' + n + '</small></label>';
    }).join('');
    $('#selCancerLabel').innerHTML = KC.spec.data.meta.cancers.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
      '<option value="' + G + '">범용(비 K-CURE)</option><option value="">(암종 미지정)</option>';
    $('#argoList').innerHTML = (KC.spec.data.argo ? Object.keys(KC.spec.data.argo.fields) : []).map(function (k) {
      const f = KC.spec.data.argo.fields[k];
      return '<option value="' + esc(k + ' — ' + f.label + ' [' + f.tier + ']') + '">';
    }).join('');
    $('#omopList').innerHTML = (KC.spec.data.omop ? Object.keys(KC.spec.data.omop.fields) : []).map(function (k) {
      const f = KC.spec.data.omop.fields[k];
      return '<option value="' + esc(k + ' — ' + f.type + (f.required ? ' [필수]' : '')) + '">';
    }).join('');
  }

  function selectCancer(c) {
    st.msel = { cancer: c, source: 'cancer', entries: KC.meta.entriesForCancer(c).map(function (e) { e.include = true; return e; }) };
    $$('#selCancers input').forEach(function (i) { i.checked = i.value === c; });
    afterSelection(c === KC.spec.GENERIC ? '범용 사전 전체(비 K-CURE · KR CDI V3 기반)' : '암종 「' + c + '」의 K-CURE 항목 전체');
  }

  async function selectFromFile(file) {
    $('#selMsg').innerHTML = '';
    try {
      const f = await KC.readers.readFile(file);
      const sheet = f.sheets.find(function (s) { return s.rows.some(function (r) { return nonEmpty(r); }); });
      if (!sheet) throw new Error('읽을 수 있는 행이 없습니다.');
      let entries = KC.meta.entriesFromSpecSheet(sheet.rows), how, cancer;
      if (entries) {
        // 항목정의서 형식: 행마다 항목ID/표준항목명 → 항목. 암종은 선택 항목이 가장 많이 속한 암종
        how = '항목정의서 형식 — 행(항목) ' + entries.length + '개';
        const counts = {};
        entries.forEach(function (e) { if (e.item) e.item.cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
        const best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || '';
        // 9개 암종 전 항목이면 특정 암종으로 볼 수 없음
        cancer = entries.length > 400 ? '' : best;
      } else {
        const rows = sheet.rows.filter(function (r) { return nonEmpty(r); });
        const hr = guessHeaderRow(rows);
        let cols = rows[hr - 1].map(function (v) { return String(v == null ? '' : v).trim(); }).filter(Boolean);
        // 한 열짜리 목록(컬럼명을 세로로 나열)이면 각 행을 컬럼명으로 본다
        if (cols.length === 1 && rows.length > 1 && rows.every(function (r) { return nonEmpty(r) <= 1; })) {
          cols = rows.map(function (r) { return String(r.find(function (v) { return String(v == null ? '' : v).trim(); })).trim(); });
          how = '세로 목록 — 컬럼 ' + cols.length + '개';
        } else how = hr + '행을 헤더로 사용 — 컬럼 ' + cols.length + '개';
        cancer = guessCancer(cols);
        entries = KC.meta.entriesFromColumns(cols, cancer);
      }
      entries.forEach(function (e) { e.include = true; });
      st.msel = { cancer: cancer, source: 'file', fileName: file.name, entries: entries };
      $$('#selCancers input').forEach(function (i) { i.checked = false; });
      afterSelection('파일 「' + file.name + '」 · ' + how);
    } catch (err) {
      $('#selMsg').innerHTML = note('파일을 읽지 못했습니다: ' + esc(err.message), 'err');
    }
  }

  function afterSelection(sourceText) {
    st.mpkg = null;
    st.mmPage = 0;
    $('#selSource').textContent = '현재 선택: ' + sourceText;
    $('#selCancerLabel').value = st.msel.cancer || '';
    const doms = Object.keys(U.groupCount(st.msel.entries, function (e) { return e.item ? e.item.domain : '(항목 미인식)'; })).sort();
    $('#selDomain').innerHTML = '<option value="">도메인 전체</option>' + doms.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
    $('#selCard').classList.remove('hidden');
    renderSel();
    markDone('sel');
  }

  function usedEntries() {
    return st.msel ? st.msel.entries.filter(function (e) { return e.include; }) : [];
  }

  function selFiltered() {
    const q = $('#selQ').value.trim().toLowerCase(), d = $('#selDomain').value;
    return st.msel.entries.filter(function (e) {
      if (d && (e.item ? e.item.domain : '(항목 미인식)') !== d) return false;
      if (q && (e.col + ' ' + (e.item ? e.item.id + ' ' + e.item.name : '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderSel() {
    if (!st.msel) return;
    const all = st.msel.entries, used = usedEntries();
    const s = KC.meta.summarize(used);
    $('#selTitle').textContent = '선택 항목 — ' + (st.msel.cancer || '암종 미지정');
    $('#selStats').innerHTML = stat('선택 컬럼', used.length + ' / ' + all.length) +
      stat('표준항목 연결', s.mapped, s.unmapped ? '항목 미인식 ' + s.unmapped : '', s.unmapped ? 'warn' : 'ok') +
      stat('KR CDI 매칭', s.krcdi, '80항목 중 ' + s.krcdiElements + '개 · 범위외 ' + s.krcdiOutOfScope) +
      stat('KR Core', s.krcoreDirect + ' / ' + s.krcoreConstrained + ' / ' + s.krcoreExtension, '직접매칭 / 조건부매칭 / 확장필요') +
      stat('mCODE 매칭', s.mcode, '프로파일 ' + s.mcodeProfiles + '/' + s.mcodeProfilesTotal) +
      stat('OMOP 매칭(후보)', s.omop, '테이블 ' + Object.keys(s.omopTables).length + '개') +
      stat('ARGO 매칭(후보)', s.argo, 'Core 필드 ' + s.argoCoreHit + '/' + s.argoCore + ' (+파생 ' + s.argoCoreDerived + ')');
    const rows = selFiltered();
    $('#selTable').innerHTML = '<table><thead><tr><th>포함</th><th>원천 컬럼</th><th>항목ID</th><th>표준항목명</th><th>도메인</th><th>분류</th><th>자료형</th><th>선택 방식</th></tr></thead><tbody>' +
      rows.map(function (e) {
        const i = st.msel.entries.indexOf(e), it = e.item;
        return '<tr><td><input type="checkbox" data-sel="' + i + '"' + (e.include ? ' checked' : '') + '></td><td><b>' + esc(e.col) + '</b></td>' +
          '<td class="mono small">' + (it ? it.id : '') + '</td><td>' + (it ? esc(it.name) : '<span class="pill warn">항목 미인식</span>') + '</td><td>' + (it ? esc(it.domain) : '') +
          '</td><td class="small">' + (it ? esc(it.cat1 + ' / ' + it.cat2) : '') + '</td><td class="small">' + (it ? esc(it.type + (it.unit ? ' · ' + it.unit : '')) : '') +
          '</td><td><span class="pill ' + (it ? 'ok' : 'warn') + '">' + esc(KC.match.label(e.method)) + '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- ② 메타데이터 매핑 ---------- */
  function mmFiltered() {
    const q = $('#mmQ').value.trim().toLowerCase(), v = $('#mmView').value;
    return usedEntries().filter(function (e) {
      const it = e.item, a = KC.meta.argoOf(e), o = KC.meta.omopOf(e);
      if (v === 'cdi' && !(it && it.cdi && it.cdi.el)) return false;
      if (v === 'ext' && !(it && it.core.judge === '확장필요')) return false;
      if (v === 'mcode' && !KC.meta.mcodeOf(e)) return false;
      if (v === 'nomcode' && (!it || KC.meta.mcodeOf(e))) return false;
      if (v === 'omoplow' && !(o && o.conf === '낮음')) return false;
      if (v.indexOf('omop:') === 0 && !(o && o.table === v.slice(5))) return false;
      if (v === 'argo' && !a) return false;
      if (v === 'noargo' && (a || !it)) return false;
      if (v === 'low' && !(a && (a.conf === '낮음' || a.conf === '중간'))) return false;
      if (v === 'unmapped' && it) return false;
      if (q) {
        const hay = (e.col + ' ' + (it ? it.id + ' ' + it.name + ' ' + it.core.path + ' ' + (it.cdi && it.cdi.el ? it.cdi.el : '') + ' ' + it.mcode.profile + ' ' + it.mcode.path : '') +
          ' ' + (a ? a.key : '') + ' ' + (o ? o.key : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function mmRowHtml(e) {
    const i = st.msel.entries.indexOf(e), it = e.item;
    if (!it) return '<tr><td><b>' + esc(e.col) + '</b><div class="small muted">항목 미인식 — DCAT 변수로만 기술</div></td><td colspan="6" class="muted small">K-CURE 표준항목이 없어 KR CDI·KR Core·mCODE·OMOP·ARGO 매칭을 정할 수 없습니다.</td></tr>';
    const c = it.cdi || {}, a = KC.meta.argoOf(e), o = KC.meta.omopOf(e), mc = KC.meta.mcodeOf(e);
    const jc = KC.match.cls(it.core.judge);
    const ac = !a ? '' : a.conf === '높음' || a.conf === '수동' ? 'ok' : a.conf === '낮음' ? 'warn' : 'info';
    const oc = !o ? '' : o.conf === '높음' || o.conf === '수동' ? 'ok' : o.conf === '낮음' ? 'warn' : 'info';
    const mlc = !mc ? 'warn' : KC.match.cls(mc.level);
    return '<tr data-mi="' + i + '">' +
      '<td class="std"><div class="l1">' + esc(e.col) + '</div><div class="l2">' + it.id + (e.col !== it.name ? ' · ' + esc(it.name) : '') + '</div><div class="l2">' + esc(it.type + (it.unit ? ' · ' + it.unit : '')) + '</div></td>' +
      '<td class="std">' + (c.el ? '<div class="l1">' + esc(c.el) + ' <span class="pill">' + esc(c.req) + '</span></div><div class="l2">' + esc(c.cls) + ' · ' + esc(KC.match.label(c.match || '대응')) + '</div>' : '<span class="muted small">미매칭</span>') + '</td>' +
      '<td class="std"><div class="l1 mono small">' + esc(it.core.path) + '</div><div class="l2">' + esc(it.core.profile) + '</div><span class="pill ' + jc + '" title="원래 판정: ' + esc(it.core.judge) + '">' + esc(KC.match.label(it.core.judge)) + '</span></td>' +
      '<td class="std">' + (mc ? '<div class="l1 mono small">' + esc(mc.path) + '</div><div class="l2">' + esc(mc.title || mc.profile) + (mc.element ? ' · ' + esc(mc.element) : '') + '</div>' :
        '<div class="l2">STU4 매칭 없음 → KR-mCODE 후보 ' + esc(it.prf) + '</div>') + '<span class="pill ' + mlc + '" title="원래 판정: ' + esc(it.mcode.level) + '">' + esc(KC.match.label(it.mcode.level)) + '</span></td>' +
      '<td class="std"><input type="text" class="argo" list="omopList" data-omop="' + i + '" value="' + esc(o ? o.key : '') + '" placeholder="미매칭 — table.field 입력">' +
      (o ? '<div class="l2">' + (o.concept ? '개념 ' + esc(o.concept) : 'person 필드') + (o.vocab && o.vocab !== '-' ? ' · ' + esc(o.vocab) : '') + ' <span class="pill ' + oc + '">' + esc(o.conf) + '</span></div>' +
        (o.note ? '<div class="l2">ETL: ' + esc(o.note) + '</div>' : '') : '') + '</td>' +
      '<td class="std"><div class="l1 mono small">' + KC.dcat.xsdType(it.type) + '</div><div class="l2">ndi:profile 변수</div></td>' +
      '<td class="std"><input type="text" class="argo" list="argoList" data-argo="' + i + '" value="' + esc(a ? a.key : '') + '" placeholder="미매칭 — schema.field 입력">' +
      (a ? '<div class="l2">' + esc(a.label) + ' · ' + esc(a.tier + (a.req ? '·' + a.req : '')) + ' · ' + esc(a.type) + ' <span class="pill ' + ac + '">' + esc(a.conf) + '</span></div>' +
        (a.note ? '<div class="l2">변환: ' + esc(a.note) + '</div>' : '') : '') + '</td>' +
      '<td><select data-rv="' + i + '">' + ['후보', '승인', '수정', '반려'].map(function (s) { return '<option' + (s === (e.rv || '후보') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      (it.review && it.review.length ? '<div class="l2">수정안 ' + it.review.length + '건</div>' : '') + '</td></tr>';
  }

  /** 행 전체가 '신뢰도 높음'인지: OMOP 높음, ARGO 없음·높음, 매핑 수정안 없음 */
  function rowHigh(e) {
    if (!e.item || (e.item.review && e.item.review.length)) return false;
    const a = KC.meta.argoOf(e), o = KC.meta.omopOf(e);
    return !!o && o.conf === '높음' && (!a || a.conf === '높음');
  }

  function renderMm() {
    const has = !!(st.msel && usedEntries().length);
    $('#mmEmpty').classList.toggle('hidden', has);
    if (!has) { $('#mmStats').innerHTML = ''; $('#mmTable').innerHTML = ''; $('#mmPager').innerHTML = ''; return; }
    const s = KC.meta.summarize(usedEntries());
    $('#mmStats').innerHTML = stat('컬럼', s.columns, (st.msel.cancer || '') + (s.unmapped ? ' · 항목 미인식 ' + s.unmapped : '')) +
      stat('KR CDI', s.krcdi, '80항목 중 ' + s.krcdiElements + '개 매칭 · 범위외 ' + s.krcdiOutOfScope + ' · 실제 미매칭 ' + s.krcdiGap) +
      stat('KR Core', s.krcoreDirect + ' / ' + s.krcoreConstrained + ' / ' + s.krcoreExtension, '직접매칭 / 조건부매칭 / 확장필요 · 프로파일 ' + s.krcoreProfiles) +
      stat('mCODE', s.mcode, '직접매칭 ' + s.mcodeDirect + ' · 상위매칭 ' + s.mcodePartial + ' · 참조매칭 ' + s.mcodeRef + ' · 프로파일 ' + s.mcodeProfiles + '/' + s.mcodeProfilesTotal + ' · KR Core와 리소스 상이 ' + s.mcodeConflict) +
      stat('OMOP CDM', s.omop, '높음 ' + (s.omopConf['높음'] || 0) + ' · 중간 ' + (s.omopConf['중간'] || 0) + ' · 낮음 ' + (s.omopConf['낮음'] || 0) + ' · 테이블 ' + Object.keys(s.omopTables).length) +
      stat('DCAT 변수', s.columns, '데이터셋 1개 · ndi:profile') +
      stat('ARGO 매칭', s.argo, '높음 ' + (s.argoConf['높음'] || 0) + ' · 중간 ' + (s.argoConf['중간'] || 0) + ' · 낮음 ' + (s.argoConf['낮음'] || 0) + (s.argoConf['수동'] ? ' · 수동 ' + s.argoConf['수동'] : '')) +
      stat('ARGO Core 충족', s.argoCoreHit + ' / ' + s.argoCore, '직접 매칭 · 파생 가능 ' + s.argoCoreDerived + ' · 지정값 ' + s.argoCoreFixed + ' · Required ' + s.argoReqHit + ' / ' + s.argoReq) +
      stat('매핑 수정안', s.review, '검토 대상 컬럼(spec/corrections.json)', s.review ? 'warn' : '');
    const rows = mmFiltered();
    const per = 100, pages = Math.max(1, Math.ceil(rows.length / per));
    st.mmPage = Math.min(st.mmPage || 0, pages - 1);
    const tables = Object.keys(s.omopTables).sort();
    const cur = $('#mmView').value;
    $('#mmView').innerHTML = [['all', '전체'], ['cdi', 'KR CDI 매칭만'], ['ext', 'KR Core 확장필요만'], ['mcode', 'mCODE 매칭만'], ['nomcode', 'mCODE 미매칭만'],
      ['omoplow', 'OMOP 신뢰도 낮음'], ['argo', 'ARGO 매칭만'], ['noargo', 'ARGO 미매칭만'], ['low', 'ARGO 신뢰도 낮음·중간'], ['unmapped', '항목 미인식 컬럼']]
      .concat(tables.map(function (t) { return ['omop:' + t, 'OMOP ' + t + ' (' + s.omopTables[t] + ')']; }))
      .map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('');
    $('#mmView').value = cur && $('#mmView').querySelector('option[value="' + cur + '"]') ? cur : 'all';
    $('#mmTable').innerHTML = '<table><thead><tr><th>컬럼 · K-CURE 항목</th><th>KR CDI V3</th><th>KR Core V2 (FHIR)</th><th>mCODE STU4</th><th>OMOP CDM v5.4 (수정 가능)</th><th>DCAT</th><th>ICGC ARGO v1.34 (수정 가능)</th><th>검토</th></tr></thead><tbody>' +
      rows.slice(st.mmPage * per, st.mmPage * per + per).map(mmRowHtml).join('') + '</tbody></table>';
    $('#mmPager').innerHTML = rows.length + '개 · ' + (st.mmPage + 1) + ' / ' + pages + ' 쪽 <button class="btn sm" data-mp="-1"' + (st.mmPage ? '' : ' disabled') + '>이전</button><button class="btn sm" data-mp="1"' + (st.mmPage < pages - 1 ? '' : ' disabled') + '>다음</button>';
  }

  /* ---------- ③ 메타데이터 내려받기 ---------- */
  function cancerLabel() { return st.msel ? (st.msel.cancer || '선택항목') : ''; }

  function buildMeta() {
    if (!st.msel || !usedEntries().length) return null;
    st.mpkg = KC.meta.build(st.conf, st.msel.cancer, usedEntries());
    return st.mpkg;
  }

  function renderMout() {
    const has = !!(st.msel && usedEntries().length);
    $('#moEmpty').classList.toggle('hidden', has);
    $('#moActions').classList.toggle('hidden', !has);
    if (!has) { $('#moOuts').innerHTML = ''; $('#moStats').innerHTML = ''; $('#moIssuesCard').classList.add('hidden'); return; }
    const p = st.mpkg || buildMeta();
    const s = p.summary;
    const err = p.dcatIssues.filter(function (x) { return x.level === '오류'; }).length;
    $('#moStats').innerHTML = stat('암종', cancerLabel()) + stat('컬럼', s.columns) + stat('파일', p.files.length, U.fmtBytes(p.files.reduce(function (t, f) { return t + f.bytes; }, 0))) +
      stat('KR CDI 대응', s.krcdi) + stat('mCODE 대응', s.mcode) + stat('OMOP 대응', s.omop) + stat('ARGO 대응', s.argo) + stat('DCAT 필수 누락', err, '', err ? 'err' : 'ok');
    $('#moOuts').innerHTML = p.files.map(function (f, i) {
      const pv = typeof f.content === 'string' || KC.sheetView.isTable(f.path);
      return '<div class="out"><div class="std">' + esc(f.std) + '</div><div class="t">' + esc(f.title) + '</div><div class="m mono">' + esc(f.path) + ' · ' + U.fmtBytes(f.bytes) + '</div>' +
        '<div class="act"><button class="btn sm primary" data-mdl="' + i + '">내려받기</button>' + (pv ? '<button class="btn sm" data-mpv="' + i + '">' + (KC.sheetView.isTable(f.path) ? '표로 보기' : '미리보기') + '</button>' : '') + '</div></div>';
    }).join('');
    $('#moIssuesCard').classList.remove('hidden');
    $('#moIssues').innerHTML = issuesTable(p.dcatIssues);
  }

  function metaFileName(path) {
    return 'KCURE_' + cancerLabel() + '_' + path.split('/').pop();
  }

  /* ---------- 명세 조회 ---------- */
  function renderSpecFilters() {
    const m = KC.spec.data.meta;
    $('#specBadge').textContent = '명세: ' + m.source.replace(/^중개포털_SW겸용_항목정의서_/, '').replace(/\.xlsx$/, '') + ' · ' + m.itemCount.toLocaleString() + '항목';
    $('#specDesc').innerHTML = '출처 <b>' + esc(m.source) + '</b> (보조 ' + esc(m.aux || '-') + ') · 생성 ' + esc(m.generated) + ' · ' + esc(m.stageNote);
    $('#specCancer').innerHTML = '<option value="">암종 전체</option>' + m.cancers.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    const doms = Object.keys(U.groupCount(KC.spec.items, function (i) { return i.domain; })).sort();
    $('#specDomain').innerHTML = '<option value="">도메인 전체</option>' + doms.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    $('#itemList').innerHTML = KC.spec.items.map(function (it) { return '<option value="' + esc(it.id + ' ' + it.name) + '">'; }).join('');
    $('#cancerSel').innerHTML = '<option value="">(암종 미지정)</option>' + m.cancers.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
      '<option value="' + KC.spec.GENERIC + '">범용(비 K-CURE)</option>';
    renderSelCancers();
  }

  function renderSpec() {
    const q = $('#specQ').value.trim().toLowerCase(), c = $('#specCancer').value, d = $('#specDomain').value, cd = $('#specCdi').value, j = $('#specJudge').value;
    const rows = KC.spec.items.filter(function (it) {
      if (c && it.cancers.indexOf(c) < 0) return false;
      if (d && it.domain !== d) return false;
      if (cd === 'Y' && !(it.cdi && it.cdi.el)) return false;
      if (cd === 'N' && it.cdi && it.cdi.el) return false;
      if (j && it.core.judge !== j) return false;
      if (q) {
        const hay = (it.id + ' ' + it.name + ' ' + it.core.path + ' ' + it.mcode.profile + ' ' + (it.aliases || []).map(function (a) { return a[0]; }).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    const per = 50, pages = Math.max(1, Math.ceil(rows.length / per));
    st.specPage = Math.min(st.specPage, pages - 1);
    const slice = rows.slice(st.specPage * per, st.specPage * per + per);
    $('#specTable').innerHTML = '<table><thead><tr><th>항목ID</th><th>항목명</th><th>도메인</th><th>자료형</th><th>KR CDI</th><th>KR Core 경로</th><th>판정</th><th>mCODE</th><th>등급</th><th>정의</th></tr></thead><tbody>' +
      slice.map(function (it) {
        return '<tr data-item="' + it.id + '" style="cursor:pointer"><td class="mono small">' + it.id + '</td><td><b>' + esc(it.name) + '</b></td><td>' + esc(it.domain) + '</td><td class="small">' + esc(it.type) +
          '</td><td class="small">' + (it.cdi && it.cdi.el ? esc(it.cdi.el) + ' <span class="pill">' + esc(it.cdi.req) + '</span>' : '<span class="muted">—</span>') + '</td><td class="mono small">' + esc(it.core.path) +
          '</td><td><span class="pill ' + KC.match.cls(it.core.judge) + '" title="원래 판정: ' + esc(it.core.judge) + '">' + esc(KC.match.label(it.core.judge)) + '</span></td><td class="small">' + esc(it.mcode.profile) +
          '</td><td>' + esc(it.grade) + '</td><td><span class="pill ' + (it.gap === 'G0' ? 'ok' : 'warn') + '">' + esc(it.gap) + '</span></td></tr>';
      }).join('') + '</tbody></table>';
    $('#specPager').innerHTML = rows.length.toLocaleString() + '개 항목 · ' + (st.specPage + 1) + ' / ' + pages + ' 쪽 <button class="btn sm" data-sp="-1"' + (st.specPage ? '' : ' disabled') + '>이전</button><button class="btn sm" data-sp="1"' + (st.specPage < pages - 1 ? '' : ' disabled') + '>다음</button>';
  }

  function showSpecDetail(id) {
    const it = KC.spec.byId[id];
    if (!it) return;
    const kv = [
      ['항목ID', it.id], ['표준항목명', it.name], ['표준정의', it.def], ['분류', it.cat1 + ' / ' + it.cat2], ['우선검토구분', it.tier], ['mCODE 도메인', it.domain],
      ['의미역할', it.role], ['출현암종', it.cancers.join(', ')], ['자료형', it.type + (it.len ? '(' + it.len + (it.dec ? ',' + it.dec : '') + ')' : '') + (it.unit ? ' · 단위 ' + it.unit : '')],
      ['허용값', it.allowed || '—'], ['필수여부', it.req],
      ['KR CDI', it.cdi && it.cdi.el ? it.cdi.cls + ' / ' + it.cdi.el + ' (' + it.cdi.req + ', ' + KC.match.both(it.cdi.match || '대응') + ')' : '미매칭'],
      ['KR Core', it.core.profile + ' → ' + it.core.path + ' [' + KC.match.both(it.core.judge) + ']'], ['프로파일 URL', it.core.url + ' (' + it.core.urlSrc + ')'],
      ['mCODE', it.mcode.profile + ' → ' + it.mcode.path + ' [' + KC.match.both(it.mcode.level) + ']' +
        (it.mcode.resConflict ? ' · KR Core와 리소스 상이(' + it.mcode.resConflict + ') → 기본 표현 ' + it.mcode.primary : '')],
      ['매핑 수정안', (it.review || []).map(function (r) { return r.code + ' ' + r.issue + ': ' + r.current + ' → ' + r.proposed + ' [' + r.status + ']'; }).join(' / ') || '—'], ['KR-mCODE 후보', it.prf + (KC.spec.profilesById[it.prf] ? ' ' + KC.spec.profilesById[it.prf].name : '')],
      ['심사', it.grade + '등급 · ' + it.stage], ['정의결손', it.gap], ['원천 예시', (it.examples || []).join(' · ') || '—'],
      ['원천 별칭', (it.aliases || []).map(function (a) { return a[0] + (a[1].length ? '(' + a[1].join(',') + ')' : ''); }).join(' · ')]
    ];
    const el = $('#specDetail');
    el.classList.remove('hidden');
    el.innerHTML = '<h2>' + esc(it.name) + ' <span class="muted small mono">' + it.id + '</span></h2><dl>' + kv.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function reloadSpec(file) {
    $('#specMsg').innerHTML = note('개정 항목정의서를 읽는 중…');
    try {
      const buf = await file.arrayBuffer();
      let sheets = await KC.readers.readXlsx(buf, { only: ['10_항목정의_최종'] });
      if (!sheets.length) sheets = await KC.readers.readXlsx(buf);
      const res = KC.spec.reloadFromSheets(sheets, file.name);
      renderSpecFilters();
      renderSpec();
      if (st.table) { st.mapping = []; ensureMapping(); }
      $('#specMsg').innerHTML = note('명세를 교체했습니다: 항목 ' + res.count + '개 (신규 ' + res.added + ', 경로·자료형 변경 ' + res.changed + ', 삭제 ' + res.removed + '). 원천 별칭은 기존 명세에서 승계했습니다. 이 교체는 현재 창에서만 유지됩니다.');
    } catch (e) {
      $('#specMsg').innerHTML = note('명세를 읽지 못했습니다: ' + esc(e.message), 'err');
    }
  }

  /* ---------- 설정 ---------- */
  function renderConf() {
    $('#confForm').innerHTML = CONF_FIELDS.map(function (f) {
      return '<label class="f"><span>' + esc(f[1]) + '</span><input type="text" data-conf="' + f[0] + '" value="' + esc(st.conf[f[0]] || '') + '">' +
        (f[3] ? '<span class="small muted" style="margin-top:3px">' + esc(f[3]) + '</span>' : '') + '</label>';
    }).join('');
  }
  function saveConf() {
    $$('[data-conf]').forEach(function (i) { st.conf[i.dataset.conf] = i.value.trim(); });
    try { localStorage.setItem('kcure.conf', JSON.stringify(st.conf)); $('#confMsg').textContent = '저장했습니다. 다음 변환부터 적용됩니다.'; }
    catch (e) { $('#confMsg').textContent = '이 창에만 적용했습니다(브라우저 저장소 사용 불가).'; }
    if (st.run) { buildOutputs(); renderOutputs(); }
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('#tabs').addEventListener('click', function (e) {
      const t = e.target.closest('.tab');
      if (!t) return;
      if (t.dataset.tab === 'map' && st.table) ensureMapping();
      showTab(t.dataset.tab);
    });
    const drop = $('#drop');
    drop.addEventListener('click', function () { $('#fileInput').click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    $('#fileInput').addEventListener('change', function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
    $$('[data-sample]').forEach(function (b) { b.addEventListener('click', function () { loadSample(b.dataset.sample); }); });
    $('#loadErr').addEventListener('click', function (e) {
      const b = e.target.closest('[data-goto]');
      if (!b) return;
      if (b.dataset.goto === 'meta') {
        const sheet = st.file.sheets[st.sheetIdx];
        const entries = KC.meta.entriesFromSpecSheet(sheet.rows) || [];
        entries.forEach(function (x) { x.include = true; });
        const counts = {};
        entries.forEach(function (x) { if (x.item) x.item.cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
        st.msel = { cancer: entries.length > 400 ? '' : (Object.keys(counts).sort(function (a, c) { return counts[c] - counts[a]; })[0] || ''), source: 'file', fileName: st.file.name, entries: entries };
        afterSelection('파일 「' + st.file.name + '」 · 항목정의서 형식 — 행(항목) ' + entries.length + '개');
        showTab('sel');
        return;
      }
      try {
        const res = KC.spec.reloadFromSheets(st.file.sheets, st.file.name);
        renderSpecFilters(); renderSpec();
        $('#specMsg').innerHTML = note('명세를 교체했습니다: 항목 ' + res.count + '개 (신규 ' + res.added + ', 경로·자료형 변경 ' + res.changed + ', 삭제 ' + res.removed + '). 원천 별칭은 기존 명세에서 승계했습니다. 이 교체는 현재 창에서만 유지됩니다.');
        st.file = null; st.table = null; st.mapping = [];
        $('#loadInfo').classList.add('hidden'); $('#loadErr').innerHTML = '';
        showTab('spec');
      } catch (err) { $('#loadErr').innerHTML = note('명세로 적용하지 못했습니다: ' + esc(err.message), 'err'); }
    });
    $('#sheetSel').addEventListener('change', function (e) { st.sheetIdx = +e.target.value; buildTable(); st.mapping = []; renderLoadInfo(); });
    $('#headerRow').addEventListener('change', function (e) { st.headerRow = Math.max(1, +e.target.value || 1); buildTable(); st.mapping = []; renderLoadInfo(); });
    $('#cancerSel').addEventListener('change', function (e) { st.cancer = e.target.value; st.mapping = []; renderLoadInfo(); });
    $('#toMap').addEventListener('click', function () { ensureMapping(); markDone('load'); showTab('map'); });

    $('#mapTable').addEventListener('change', function (e) {
      const inp = e.target.closest('input[data-idx]');
      if (!inp) return;
      const m = st.mapping[+inp.dataset.idx];
      const id = parseItemInput(inp.value);
      if (id === null) { inp.style.borderColor = 'var(--err)'; inp.title = '일치하는 표준항목이 없습니다'; return; }
      m.itemId = id; m.method = id ? '수동' : '미매핑'; m.alternatives = [];
      const tr = inp.closest('tr');
      tr.outerHTML = mapRowHtml(m);
      renderMapStats();
    });
    $('#mapFilter').addEventListener('change', renderMapping);
    $('#patientCol').addEventListener('change', function (e) { st.patientCol = +e.target.value; renderMapping(); });
    $('#saveMapCfg').addEventListener('click', function () {
      U.download(baseName() + '_매핑설정.json', JSON.stringify(KC.mapper.exportConfig(st.mapping, { patientColumn: st.table.headers[st.patientCol], cancer: st.cancer }), null, 2), 'application/json');
    });
    $('#loadMapCfg').addEventListener('click', function () { $('#mapCfgInput').click(); });
    $('#mapCfgInput').addEventListener('change', async function (e) {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { ensureMapping(JSON.parse(await f.text())); } catch (err) { alert('매핑 설정 파일을 읽지 못했습니다: ' + err.message); }
    });
    $('#toRun').addEventListener('click', function () { markDone('map'); showTab('run'); });

    $('#runBtn').addEventListener('click', doRun);
    $('#logLevel').addEventListener('change', function () { st.logPage = 0; renderLog(); });
    $('#logCode').addEventListener('change', function () { st.logPage = 0; renderLog(); });
    $('#logSearch').addEventListener('input', function () { st.logPage = 0; renderLog(); });
    $('#logPager').addEventListener('click', function (e) { const b = e.target.closest('[data-lp]'); if (b) { st.logPage += +b.dataset.lp; renderLog(); } });

    $('#p-out').addEventListener('click', function (e) {
      const dl = e.target.closest('[data-dl]'), pv = e.target.closest('[data-pv]');
      if (dl) { const o = st.outputs[+dl.dataset.dl]; U.download(o.fileName, o.content, o.mime); }
      if (pv) { const o = st.outputs[+pv.dataset.pv]; preview($('#outView'), { name: o.fileName, content: o.content, bytes: o.bytes }); }
      if (e.target.id === 'dlAll') st.outputs.forEach(function (o, i) { setTimeout(function () { U.download(o.fileName, o.content, o.mime); }, i * 400); });
    });
    /* 메타데이터 변환 */
    $('#selCancers').addEventListener('change', function (e) { if (e.target.name === 'mcancer') selectCancer(e.target.value); });
    $('#selFileBtn').addEventListener('click', function () { $('#selFileInput').click(); });
    $('#selFileInput').addEventListener('change', function (e) { if (e.target.files[0]) selectFromFile(e.target.files[0]); e.target.value = ''; });
    $('#selCancerLabel').addEventListener('change', function (e) {
      st.msel.cancer = e.target.value;
      // 컬럼 파일이면 암종 우선순위로 별칭을 다시 대조
      if (st.msel.source === 'file' && st.msel.entries.some(function (x) { return x.method !== '항목ID'; })) {
        const inc = {};
        st.msel.entries.forEach(function (x) { inc[x.col] = x.include; });
        st.msel.entries = st.msel.entries.map(function (x) {
          if (x.method === '항목ID') return x;
          const n = KC.meta.entriesFromColumns([x.col], st.msel.cancer)[0];
          n.include = inc[x.col];
          return n;
        });
      }
      st.mpkg = null;
      renderSel();
    });
    $('#selQ').addEventListener('input', renderSel);
    $('#selDomain').addEventListener('change', renderSel);
    $('#selAll').addEventListener('click', function () { selFiltered().forEach(function (x) { x.include = true; }); st.mpkg = null; renderSel(); });
    $('#selNone').addEventListener('click', function () { selFiltered().forEach(function (x) { x.include = false; }); st.mpkg = null; renderSel(); });
    $('#selTable').addEventListener('change', function (e) {
      const c = e.target.closest('[data-sel]');
      if (!c) return;
      st.msel.entries[+c.dataset.sel].include = c.checked;
      st.mpkg = null;
      renderSel();
    });
    $('#toMmap').addEventListener('click', function () { showTab('mmap'); });
    $('#mmQ').addEventListener('input', function () { st.mmPage = 0; renderMm(); });
    $('#mmView').addEventListener('change', function () { st.mmPage = 0; renderMm(); });
    $('#mmPager').addEventListener('click', function (e) { const b = e.target.closest('[data-mp]'); if (b) { st.mmPage += +b.dataset.mp; renderMm(); } });
    $('#mmTable').addEventListener('change', function (e) {
      const rv = e.target.closest('[data-rv]');
      if (rv) {
        const en = st.msel.entries[+rv.dataset.rv];
        KC.audit.log('map.review', { col: en.col, itemId: en.item && en.item.id, from: en.rv || '후보', to: rv.value });
        en.rv = rv.value;
        st.mpkg = null;
        return;
      }
      const oin = e.target.closest('[data-omop]');
      if (oin) {
        const en = st.msel.entries[+oin.dataset.omop];
        const v = oin.value.trim(), key = v.split(/\s/)[0];
        if (!v) en.omopKey = '';
        else if (KC.meta.omopField(key)) en.omopKey = (en.item.omop && en.item.omop.table + '.' + en.item.omop.field === key) ? undefined : key;
        else { oin.style.borderColor = 'var(--err)'; oin.title = 'OMOP 필드(table.field)를 목록에서 고르세요'; return; }
        if (en.omopKey === undefined) delete en.omopKey;
        KC.audit.log('map.omop', { col: en.col, itemId: en.item.id, to: v || '(대응 없음)' });
        if (en.omopKey !== undefined) en.rv = '수정';
        st.mpkg = null;
        renderMm();
        return;
      }
      const inp = e.target.closest('[data-argo]');
      if (!inp) return;
      const en = st.msel.entries[+inp.dataset.argo];
      const v = inp.value.trim();
      const key = v.split(/\s/)[0];
      if (!v) en.argoKey = '';
      else if (KC.meta.argoField(key)) en.argoKey = (en.item.argo && en.item.argo.key === key) ? undefined : key;
      else { inp.style.borderColor = 'var(--err)'; inp.title = 'ARGO 필드(schema.field)를 목록에서 고르세요'; return; }
      if (en.argoKey === undefined) delete en.argoKey;
      KC.audit.log('map.argo', { col: en.col, itemId: en.item.id, to: v || '(대응 없음)' });
      if (en.argoKey !== undefined) en.rv = '수정';
      st.mpkg = null;
      renderMm();
      markDone('mmap');
    });
    $('#toMout').addEventListener('click', function () { markDone('mmap'); showTab('mout'); });
    $('#mmApproveHigh').addEventListener('click', function () {
      let n = 0;
      usedEntries().forEach(function (en) { if ((en.rv || '후보') === '후보' && rowHigh(en)) { en.rv = '승인'; n++; } });
      KC.audit.log('map.approve_high', { cancer: st.msel ? st.msel.cancer : '', count: n });
      st.mpkg = null;
      renderMm();
      $('#mmPager').insertAdjacentHTML('afterbegin', '<span class="pill ok">' + n + '행 승인</span> ');
    });
    $('#p-mout').addEventListener('click', function (e) {
      const dl = e.target.closest('[data-mdl]'), pv = e.target.closest('[data-mpv]');
      if (dl) { const f = st.mpkg.files[+dl.dataset.mdl]; U.download(metaFileName(f.path), new Blob([f.content], { type: f.mime }), f.mime); }
      if (pv) { const f = st.mpkg.files[+pv.dataset.mpv]; preview($('#moView'), { name: f.path, content: f.content, bytes: f.bytes }); }
      if (e.target.id === 'moZip') {
        const p = st.mpkg || buildMeta();
        U.download('KCURE_' + cancerLabel() + '_메타데이터_' + stamp() + '.zip', new Blob([KC.meta.toZip([p])], { type: 'application/zip' }));
        KC.audit.log('meta.package', { cancer: cancerLabel(), files: p.files.length, columns: p.summary.columns,
          review: U.groupCount(usedEntries(), function (x) { return x.rv || '후보'; }) });
        markDone('mout');
      }
      if (e.target.id === 'moXlsx') {
        const p = st.mpkg || buildMeta();
        const f = p.files[0];
        U.download('KCURE_' + cancerLabel() + '_통합_메타데이터_' + stamp() + '.xlsx', new Blob([f.content], { type: f.mime }));
      }
      if (e.target.id === 'moAll') {
        $('#moMsg').textContent = '9개 암종 패키지 생성 중…';
        setTimeout(function () {
          const pkgs = KC.spec.data.meta.cancers.map(function (c) { return KC.meta.build(st.conf, c, KC.meta.entriesForCancer(c)); });
          U.download('KCURE_9개암종_메타데이터_' + stamp() + '.zip', new Blob([KC.meta.toZip(pkgs)], { type: 'application/zip' }));
          $('#moMsg').textContent = '완료 — 암종 ' + pkgs.length + '개, 파일 ' + pkgs.reduce(function (s, p) { return s + p.files.length; }, 0) + '개 (각 암종의 전체 항목 기준, ARGO 수동 수정은 현재 암종에만 반영)';
        }, 30);
      }
    });

    ['#specQ', '#specCancer', '#specDomain', '#specCdi', '#specJudge'].forEach(function (s) {
      $(s).addEventListener(s === '#specQ' ? 'input' : 'change', function () { st.specPage = 0; renderSpec(); });
    });
    $('#specPager').addEventListener('click', function (e) { const b = e.target.closest('[data-sp]'); if (b) { st.specPage += +b.dataset.sp; renderSpec(); } });
    $('#specTable').addEventListener('click', function (e) { const tr = e.target.closest('tr[data-item]'); if (tr) showSpecDetail(tr.dataset.item); });
    $('#specReload').addEventListener('click', function () { $('#specInput').click(); });
    $('#specInput').addEventListener('change', function (e) { if (e.target.files[0]) reloadSpec(e.target.files[0]); e.target.value = ''; });

    $('#confSave').addEventListener('click', saveConf);
    $('#confReset').addEventListener('click', function () { st.conf = Object.assign({}, DEFAULT_CONF); renderConf(); $('#confMsg').textContent = '기본값을 불러왔습니다. 저장을 눌러 적용하세요.'; });
  }

  /* ---------- 시작 ---------- */
  function start() {
    if (!window.KCURE_SPEC) {
      document.querySelector('main').innerHTML = note('내장 명세(kcure_spec)를 불러오지 못했습니다. 배포된 단일 HTML 파일을 사용하세요.', 'err');
      return;
    }
    KC.spec.init(window.KCURE_SPEC);
    $('#appVersion').textContent = KC.APP_VERSION;
    $('#optSalt').value = randomSalt();
    renderSpecFilters();
    renderSpec();
    renderConf();
    bind();
    KC.deidUi.init({ entries: function () { return usedEntries(); }, cancer: function () { return st.msel ? st.msel.cancer || '' : ''; } });
    if (typeof DecompressionStream === 'undefined') {
      $('#loadErr').innerHTML = note('이 브라우저는 XLSX 읽기를 지원하지 않습니다(CSV는 가능). Edge 또는 Chrome 최신 버전을 권장합니다.', 'warn');
    }
    if (location.hash === '#selftest') selfTest();
    // 바로가기: #view=mmap&cancer=대장암 (암종 선택 후 해당 화면 열기)
    const m = /view=(\w+)(?:&cancer=([^&]+))?/.exec(decodeURIComponent(location.hash));
    if (m) { if (m[2]) selectCancer(m[2]); showTab(m[1]); }
  }

  /** 자체 점검: 파일명 뒤에 #selftest 를 붙여 열면 내장 합성 샘플로 전 과정을 실행하고 결과를 표시 */
  async function selfTest() {
    const res = [];
    try {
      // 주 기능: 암종별 메타데이터 변환
      for (const c of KC.spec.data.meta.cancers) {
        selectCancer(c);
        const p = buildMeta();
        const err = p.dcatIssues.filter(function (x) { return x.level === '오류'; }).length;
        if (err) throw new Error(c + ' DCAT 필수 속성 누락 ' + err);
        res.push(c + ' 메타 ' + p.summary.columns + '컬럼·파일 ' + p.files.length + '·mCODE ' + p.summary.mcode + '·OMOP ' + p.summary.omop + '·ARGO ' + p.summary.argo);
      }
      KC.meta.toZip([st.mpkg]);
      // 부가 기능: 환자 데이터 변환
      for (const key of ['crc', 'brc']) {
        loadSample(key);
        ensureMapping();
        await doRun();
        const r = st.run;
        res.push(key + ': 환자 ' + r.meta.patients + ' · FHIR ' + r.bundle.entry.length + '개(구조오류 ' + r.fhirErrors + ') · KR CDI 값 ' + r.krcdi.summary.values +
          ' · DCAT 필수누락 ' + st.dcatIssues.filter(function (x) { return x.level === '오류'; }).length + ' · 산출물 ' + st.outputs.length + '개');
      }
      document.body.setAttribute('data-selftest', 'pass');
    } catch (e) {
      res.push('실패: ' + e.message);
      document.body.setAttribute('data-selftest', 'fail');
    }
    showTab('run');
    $('#runMsg').innerHTML = '<b>자체 점검</b> — ' + esc(res.join(' / '));
    document.body.setAttribute('data-selftest-msg', res.join(' / '));
  }

  KC.app = { state: st, start: start, loadSample: loadSample, ensureMapping: ensureMapping, doRun: doRun,
    selectCancer: selectCancer, selectFromFile: selectFromFile, buildMeta: buildMeta, showTab: showTab };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
