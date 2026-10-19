/* K-CURE 변환코드생성기 화면: 컬럼명 파일 → 매핑 검토 → Python 변환 패키지 */
window.KC = window.KC || {};
KC.APP_VERSION = KC.APP_VERSION || 'v0.2.0-dev (프로토타입)';

KC.convUi = (function () {
  'use strict';
  const U = KC.util, esc = U.esc, CG = KC.convgen;
  const $ = function (s) { return document.querySelector(s); };
  const st = { plan: null, source: '', fileName: '', filter: 'all' };
  const DEMO_GENERIC = ['patient_id', 'patient_name', 'age', 'gender', 'arrival_time', 'admission_path', 'transport_method', 'chief_complaint', 'onset_time',
    'severity_ktas', 'systolic_bp', 'heart_rate', 'respiratory_rate', 'body_temperature', 'sp_o2', 'outcome'];

  function note(msg, cls) { return '<div class="note ' + (cls || '') + '">' + msg + '</div>'; }
  function stat(k, v, s, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>';
  }
  function nonEmpty(r) { return (r || []).filter(function (v) { return String(v == null ? '' : v).trim() !== ''; }).length; }

  /** 기준(암종·범용) 추정 — 표준변환기와 같은 규칙 */
  function guessCancer(headers) {
    const counts = {};
    headers.forEach(function (h) {
      const m = KC.mapper.matchOne(h, '');
      if (!m.itemId) return;
      KC.spec.byId[m.itemId].cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
      (KC.spec.aliasIndex.get(U.normKey(h)) || []).forEach(function (a) { a.cancers.forEach(function (c) { counts[c] = (counts[c] || 0) + 2; }); });
    });
    const kcure = headers.filter(function (h) { return KC.mapper.matchOne(h, '').itemId; }).length;
    const generic = headers.filter(function (h) { const id = KC.mapper.matchOne(h, KC.spec.GENERIC).itemId; return id && KC.spec.byId[id].generic; }).length;
    if (generic > kcure) return KC.spec.GENERIC;
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || '';
  }

  /** 시트 행 → {cols:[{col, item?, method?}], samples:{col:[..]}, how} */
  function columnsFromRows(rows) {
    rows = rows.filter(function (r) { return nonEmpty(r); });
    if (!rows.length) throw new Error('읽을 수 있는 행이 없습니다.');
    const spec = KC.meta.entriesFromSpecSheet(rows);
    if (spec && spec.length) return { entries: spec, how: '항목정의서 형식 — 항목 ' + spec.length + '개', fixed: true };
    // 세로 목록: 모든 행이 값 1개
    if (rows.every(function (r) { return nonEmpty(r) <= 1; })) {
      const cols = rows.map(function (r) { return String(r.find(function (v) { return String(v == null ? '' : v).trim(); })).trim(); });
      // 첫 행이 '컬럼명' 같은 제목이면 뺀다
      if (/^(컬럼명?|항목명?|column(_?name)?|field(_?name)?|변수명?)$/i.test(cols[0])) cols.shift();
      return { headers: cols, samples: {}, how: '세로 목록 — 컬럼 ' + cols.length + '개' };
    }
    // 원천 데이터: 처음 10행 중 가장 많이 찬 행을 헤더로
    let hi = 0, best = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) { const n = nonEmpty(rows[i]); if (n > best) { best = n; hi = i; } }
    const head = rows[hi].map(function (v) { return String(v == null ? '' : v).trim(); });
    const samples = {};
    head.forEach(function (h, j) {
      if (!h) return;
      samples[h] = rows.slice(hi + 1, hi + 11).map(function (r) { return String(r[j] == null ? '' : r[j]).trim(); }).filter(Boolean).slice(0, 3);
    });
    return { headers: head.filter(Boolean), samples: samples, how: (hi + 1) + '행을 컬럼명으로 사용 — 컬럼 ' + head.filter(Boolean).length + '개' +
      (rows.length - hi - 1 > 0 ? ' · 값 ' + Math.min(10, rows.length - hi - 1) + '행은 화면 미리보기에만 사용' : '') };
  }

  function buildPlan(src, cancer) {
    let entries;
    if (src.entries) entries = src.entries;
    else entries = KC.meta.entriesFromColumns(src.headers, cancer === KC.spec.GENERIC ? KC.spec.GENERIC : cancer);
    entries.forEach(function (e) { e.samples = (src.samples || {})[e.col] || []; });
    st.plan = CG.plan(entries, cancer);
    st.src = src;
  }

  function load(rows, name, extra) {
    $('#cgMsg').innerHTML = '';
    try {
      const src = columnsFromRows(rows);
      const cancer = src.entries ? '' : guessCancer(src.headers);
      buildPlan(src, cancer);
      st.fileName = name;
      st.source = '「' + name + '」 · ' + src.how + (extra || '');
      $('#cgCancer').value = cancer;
      if (!$('#cgIn').value) $('#cgIn').value = 'C:\\kcure\\in\\' + (/\.(csv|tsv|xlsx|xlsm)$/i.test(name) ? name : 'source.csv');
      if (!$('#cgOut').value) $('#cgOut').value = 'C:\\kcure\\out\\standard';
      render();
      $('#cgCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { $('#cgMsg').innerHTML = note('컬럼명을 찾지 못했습니다: ' + esc(e.message), 'err'); }
  }

  async function fromFile(file) {
    $('#cgMsg').innerHTML = note('읽는 중…');
    try {
      const f = await KC.readers.readFile(file);
      const sheet = f.sheets.find(function (s) { return s.rows.some(function (r) { return nonEmpty(r); }); });
      if (!sheet) throw new Error('읽을 수 있는 행이 없습니다.');
      load(sheet.rows, file.name, f.truncated ? ' · 대용량(' + U.fmtBytes(f.size) + ')이라 앞부분만 읽음' : '');
    } catch (e) { $('#cgMsg').innerHTML = note('파일을 읽지 못했습니다: ' + esc(e.message), 'err'); }
  }

  function itemLabel(it) { return it ? it.id + ' ' + it.name : ''; }
  function findItem(v) {
    v = String(v || '').trim();
    if (!v) return null;
    const id = v.split(/\s+/)[0];
    if (KC.spec.byId[id]) return KC.spec.byId[id];
    const m = KC.mapper.matchOne(v, $('#cgCancer').value);
    return m.itemId ? KC.spec.byId[m.itemId] : undefined;
  }

  function fillItems() {
    const c = $('#cgCancer').value;
    const list = c === KC.spec.GENERIC ? KC.spec.generic : KC.spec.items.filter(function (it) { return !c || it.cancers.indexOf(c) >= 0; }).concat(KC.spec.generic);
    $('#cgItems').innerHTML = list.map(function (it) { return '<option value="' + esc(itemLabel(it)) + '">' + esc(it.type + (it.unit ? ' · ' + it.unit : '')) + '</option>'; }).join('');
  }

  function visible(c) {
    const f = st.filter;
    return f === 'all' || (f === 'unmapped' && !c.item) || (f === 'drop' && c.method === 'drop') || (f === 'code' && (c.method === 'code' || c.method === 'flag'));
  }

  function render() {
    const p = st.plan;
    $('#cgCard').classList.toggle('hidden', !p);
    $('#cgOutCard').classList.toggle('hidden', !p);
    if (!p) return;
    fillItems();
    $('#cgSource').textContent = st.source;
    const by = U.groupCount(p.columns, function (c) { return c.method; });
    const mapped = p.columns.filter(function (c) { return c.item; }).length;
    const cdi = p.columns.filter(function (c) { return c.item && c.item.cdi && c.item.cdi.el && c.method !== 'drop'; }).length;
    const omop = p.columns.filter(function (c) { return c.item && c.item.omop && c.item.omop.table && c.method !== 'drop'; }).length;
    $('#cgStats').innerHTML = stat('컬럼', p.columns.length) +
      stat('표준항목 연결', mapped + ' / ' + p.columns.length, p.columns.length - mapped ? '항목 미인식 ' + (p.columns.length - mapped) : '', p.columns.length - mapped ? 'warn' : 'ok') +
      stat('환자키', p.patientCol || '없음', p.patientCol ? '가명키로 변환' : '원천 행 번호로 대체', p.patientCol ? 'ok' : 'warn') +
      stat('직접식별자 제외', by.drop || 0, '이름·연락처·주소') +
      stat('KR CDI', cdi, '세로형 산출') + stat('OMOP', omop, '적재 준비 산출') +
      stat('변환 방식', '날짜 ' + ((by.date || 0) + (by.year || 0)) + ' · 코드 ' + ((by.code || 0) + (by.flag || 0)) + ' · 수치 ' + (by.number || 0), '텍스트 ' + (by.text || 0));
    const opt = function (sel) {
      return CG.ORDER.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + ' title="' + esc(CG.METHODS[k].desc) + '">' + esc(CG.METHODS[k].label) + '</option>'; }).join('');
    };
    $('#cgTable').innerHTML = '<table><thead><tr><th>#</th><th>원천 컬럼</th><th>샘플(화면만)</th><th>표준항목</th><th>변환 방식</th><th>KR CDI</th><th>KR Core 경로</th><th>OMOP</th></tr></thead><tbody>' +
      p.columns.map(function (c, i) {
        if (!visible(c)) return '';
        const it = c.item;
        const cls = c.method === 'drop' || c.method === 'skip' ? ' class="muted"' : '';
        return '<tr' + cls + '><td class="num">' + (i + 1) + '</td><td><b>' + esc(c.col) + '</b>' + (c.col === p.patientCol ? ' <span class="pill info">환자키</span>' : '') +
          '<div class="l2">' + esc(it ? c.mappedBy : '항목 미인식') + '</div></td>' +
          '<td class="small trunc">' + esc(c.samples.join(' · ')) + '</td>' +
          '<td><input type="text" list="cgItems" data-cgi="' + i + '" value="' + esc(itemLabel(it)) + '" placeholder="항목 미인식 — 항목ID 또는 이름" style="width:230px">' +
          (it ? '<div class="l2">' + esc(it.type + (it.unit ? ' · ' + it.unit : '') + (it.allowed ? ' · ' + it.allowed : '')) + '</div>' : '') + '</td>' +
          '<td><select data-cgm="' + i + '">' + opt(c.method) + '</select></td>' +
          '<td class="small">' + (it && it.cdi && it.cdi.el ? esc(it.cdi.cls + ' / ' + it.cdi.el) + '<div class="l2">' + esc(KC.match.label(it.cdi.match || '대응')) + '</div>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="small mono">' + (it ? esc(it.core.path) + '<div class="l2">' + esc(KC.match.label(it.core.judge)) + '</div>' : '') + '</td>' +
          '<td class="small mono">' + (it && it.omop && it.omop.table ? esc(it.omop.table + '.' + it.omop.field) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function opts() { return { input: $('#cgIn').value.trim(), outdir: $('#cgOut').value.trim(), operator: $('#cgOperator').value.trim() }; }
  function stamp() { return U.nowIso().replace(/[-:T]/g, '').slice(0, 12); }

  function preview() {
    if (!st.plan) return;
    const code = CG.python(st.plan, opts());
    const bad = CG.selfCheck(code);
    $('#cgView').classList.remove('hidden');
    $('#cgView').textContent = code;
    $('#cgOutMsg').innerHTML = bad.length ? note('자체 검사 실패: ' + esc(bad.map(function (b) { return b.line + '행 ' + b.text; }).join(' / ')), 'err')
      : note('자체 검사 통과 — 원본 수정 구문 없음 · ' + code.split('\n').length + '행', 'ok');
  }

  function download() {
    if (!st.plan) return;
    try {
      const pkg = CG.buildPackage(st.plan, opts());
      const zip = KC.writers.zip(pkg.files.map(function (f) { return { name: f.path, content: f.content }; }));
      const name = 'KCURE_변환코드_' + (st.plan.cancer || '선택') + '_' + stamp() + '.zip';
      U.download(name, new Blob([zip], { type: 'application/zip' }));
      $('#cgOutMsg').innerHTML = note('패키지를 만들었습니다: ' + esc(name) + ' · 파일 ' + pkg.files.length + '개 · convert.py SHA-256 ' + pkg.hash.slice(0, 16) + '…', 'ok');
      return pkg;
    } catch (e) { $('#cgOutMsg').innerHTML = note(esc(e.message), 'err'); }
  }

  function onChange(e) {
    const p = st.plan, t = e.target;
    if (!p) return;
    if (t.dataset.cgi !== undefined) {
      const it = findItem(t.value);
      if (it === undefined) { t.classList.add('bad'); $('#cgOutMsg').innerHTML = note('「' + esc(t.value) + '」에 해당하는 표준항목이 없습니다.', 'warn'); return; }
      CG.setItem(p, +t.dataset.cgi, it);
    } else if (t.dataset.cgm !== undefined) CG.setMethod(p, +t.dataset.cgm, t.value);
    else return;
    render();
  }

  function init() {
    if (!window.KCURE_SPEC) { $('#cgMsg').innerHTML = note('내장 명세가 없습니다.', 'err'); return; }
    KC.spec.init(window.KCURE_SPEC);
    $('#appVersion').textContent = KC.APP_VERSION;
    $('#specBadge').textContent = '명세: ' + KC.spec.items.length.toLocaleString() + '항목 + 범용 ' + KC.spec.generic.length;
    $('#cgCancer').innerHTML = '<option value="">K-CURE 전체</option>' + KC.spec.data.meta.cancers.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
      '<option value="' + KC.spec.GENERIC + '">범용(비 K-CURE)</option>';
    const drop = $('#cgDrop');
    drop.addEventListener('click', function () { $('#cgFile').click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') $('#cgFile').click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) fromFile(e.dataTransfer.files[0]); });
    $('#cgFile').addEventListener('change', function (e) { if (e.target.files[0]) fromFile(e.target.files[0]); e.target.value = ''; });
    $('#cgDemoCrc').addEventListener('click', function () {
      const s = window.KCURE_SAMPLES && window.KCURE_SAMPLES.crc;
      if (s) load(KC.readers.parseCsv(s.csv.replace(/^\uFEFF/, '')), s.name);
    });
    $('#cgDemoGen').addEventListener('click', function () { load([DEMO_GENERIC], '범용예시_응급실_컬럼.csv'); });
    $('#cgCancer').addEventListener('change', function () {
      if (!st.src) return;
      buildPlan(st.src, $('#cgCancer').value);
      render();
    });
    $('#cgFilter').addEventListener('change', function (e) { st.filter = e.target.value; render(); });
    $('#cgTable').addEventListener('change', onChange);
    $('#cgPreview').addEventListener('click', preview);
    $('#cgMapCsv').addEventListener('click', function () {
      if (st.plan) U.download('KCURE_매핑표_' + (st.plan.cancer || '선택') + '_' + stamp() + '.csv', U.toCsv(CG.mappingRows(st.plan)), 'text/csv');
    });
    $('#cgZip').addEventListener('click', download);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { state: st, load: load, columnsFromRows: columnsFromRows, download: download };
})();
