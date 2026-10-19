/* ④ 가명처리 코드 탭 — 샘플 분석 → 컬럼별 기법 추천·승인 → 코드 미리보기·패키지 내려받기 */
window.KC = window.KC || {};

KC.deidUi = (function () {
  'use strict';
  const U = KC.util, esc = U.esc;
  const $ = function (s) { return document.querySelector(s); };
  const st = { plan: null, source: '', host: null };
  const ORDER = ['DELETE', 'HASH_SALT', 'YEAR_ONLY', 'DATE_SHIFT', 'DATE_TO_INTERVAL', 'MASK', 'BIN', 'TOP_BOTTOM', 'GROUP_RARE', 'REGEX_PII', 'KEEP'];

  function note(msg, cls) { return '<div class="note ' + (cls || '') + '">' + msg + '</div>'; }
  function stat(k, v, s, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>';
  }

  function opts() {
    return {
      table: $('#dzTable').value.trim() || 'source_table', dialect: $('#dzDialect').value,
      input: $('#dzIn').value.trim(), output: $('#dzOut').value.trim(), operator: $('#dzOperator').value.trim(),
      patientCol: $('#dzPid').value
    };
  }

  /** 원천 샘플 파일 → plan (앞 10행만 사용, 파일 내용은 저장하지 않음) */
  async function fromFile(file) {
    $('#dzMsg').innerHTML = '';
    try {
      const f = await KC.readers.readFile(file);
      const sheet = f.sheets.find(function (s) { return s.rows.length > 0; });
      if (!sheet) throw new Error('읽을 수 있는 행이 없습니다.');
      const rows = sheet.rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim(); }); });
      const headers = rows[0].map(function (v) { return String(v == null ? '' : v).trim(); }).filter(Boolean);
      const cancer = st.host.cancer() || '';
      st.plan = KC.deid.plan(headers, rows.slice(1), cancer);
      st.source = '샘플 파일 「' + file.name + '」 · 컬럼 ' + headers.length + ' · 분석 ' + st.plan.sampleRows + '행 (최대 ' + KC.deid.MAX_SAMPLE_ROWS + '행, 샘플값은 화면에서만 사용)';
      $('#dzIn').value = $('#dzIn').value || 'C:\\kcure\\in\\' + file.name;
      $('#dzOut').value = $('#dzOut').value || 'C:\\kcure\\out\\' + file.name.replace(/\.[^.]+$/, '') + '_deid.csv';
      render();
    } catch (e) {
      $('#dzMsg').innerHTML = note('파일을 읽지 못했습니다: ' + esc(e.message), 'err');
    }
  }

  function fromSelection() {
    const entries = st.host.entries();
    if (!entries.length) { $('#dzMsg').innerHTML = note('① 에서 암종이나 컬럼을 먼저 선택하세요.', 'warn'); return; }
    st.plan = KC.deid.planFromEntries(entries, st.host.cancer());
    st.source = '① 선택 항목 ' + entries.length + '개 (샘플 없음 — 컬럼명·표준항목 기준 추천)';
    render();
  }

  function render() {
    const has = !!st.plan;
    $('#dzCard').classList.toggle('hidden', !has);
    if (!has) return;
    const p = st.plan, T = KC.deid.techniques();
    const by = U.groupCount(p.columns, function (c) { return c.technique; });
    const ap = p.columns.filter(function (c) { return c.status === '승인'; }).length;
    $('#dzSource').textContent = st.source;
    $('#dzStats').innerHTML = stat('컬럼', p.columns.length, '표준항목 매핑 ' + p.columns.filter(function (c) { return c.item; }).length) +
      stat('승인', ap + ' / ' + p.columns.length, '미승인 컬럼은 코드에서 제외', ap < p.columns.length ? 'warn' : 'ok') +
      stat('삭제', by.DELETE || 0, '직접식별자') + stat('가명키', by.HASH_SALT || 0, '솔트+SHA-256') +
      stat('날짜', (by.DATE_SHIFT || 0) + (by.YEAR_ONLY || 0) + (by.DATE_TO_INTERVAL || 0), '이동·연도·경과일') +
      stat('자유문 PII', by.REGEX_PII || 0, '정규식 치환') + stat('유지', by.KEEP || 0, '');
    const pidOpts = p.columns.map(function (c) { return '<option' + (c.col === (p.patientCol || '') ? ' selected' : '') + '>' + esc(c.col) + '</option>'; }).join('');
    $('#dzPid').innerHTML = '<option value="">(없음 — 날짜 이동 불가)</option>' + pidOpts;
    $('#dzTableWrap').innerHTML = '<table><thead><tr><th>승인</th><th>원천 컬럼</th><th>표준항목</th><th>샘플 패턴</th><th>가명처리 기법</th><th>파라미터</th><th>근거 (규칙)</th><th>신뢰도</th></tr></thead><tbody>' +
      p.columns.map(function (c, i) {
        const sel = '<select data-dzt="' + i + '">' + ORDER.map(function (t) { return '<option value="' + t + '"' + (t === c.technique ? ' selected' : '') + '>' + esc(T[t].label) + '</option>'; }).join('') + '</select>';
        const params = Object.keys(c.params || {}).map(function (k) {
          return '<label class="small">' + esc(k) + ' <input type="text" class="mono" style="width:70px" data-dzp="' + i + '" data-k="' + esc(k) + '" value="' + esc(c.params[k] == null ? '' : c.params[k]) + '"></label>';
        }).join(' ');
        const pc = c.confidence === '높음' ? 'ok' : c.confidence === '낮음' ? 'warn' : 'info';
        const smp = c.sample.n ? esc(c.sample.pattern) + (c.sample.dateFormats.length ? ' ' + esc(c.sample.dateFormats.join('/')) : '') + '<div class="l2">고유값 ' + c.sample.distinct + '/' + c.sample.n + '</div>' : '<span class="muted small">샘플 없음</span>';
        const exp = c.expand.length ? '<div class="l2">전개 제안: ' + esc(c.expand.map(function (x) { return x.parts.join('·') + ' (' + x.hint + ')'; }).join(' / ')) + '</div>' : '';
        return '<tr><td><input type="checkbox" data-dza="' + i + '"' + (c.status === '승인' ? ' checked' : '') + '></td>' +
          '<td><b>' + esc(c.col) + '</b>' + exp + '</td>' +
          '<td class="small">' + (c.item ? '<span class="mono">' + c.item.id + '</span><div class="l2">' + esc(c.item.name) + ' · ' + esc(c.item.role) + '</div>' : '<span class="pill warn">미매핑</span>') + '</td>' +
          '<td class="small">' + smp + '</td><td>' + sel + '</td><td>' + (params || '<span class="muted small">—</span>') + '</td>' +
          '<td class="small">' + esc(c.reason) + ' <span class="muted mono">' + c.ruleId + '</span></td><td><span class="pill ' + pc + '">' + esc(c.confidence) + '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function onChange(e) {
    const p = st.plan;
    if (!p) return;
    const t = e.target;
    if (t.dataset.dza !== undefined) { p.columns[+t.dataset.dza].status = t.checked ? '승인' : '후보'; }
    else if (t.dataset.dzt !== undefined) {
      const c = p.columns[+t.dataset.dzt];
      c.technique = t.value;
      c.params = Object.assign({}, KC.deid.techniques()[t.value].params || {});
      c.ruleId = '수동';
      c.reason = '담당자 지정';
      c.confidence = '수동';
    } else if (t.dataset.dzp !== undefined) {
      const c = p.columns[+t.dataset.dzp], v = t.value.trim();
      c.params[t.dataset.k] = v === '' ? null : (/^-?\d+(\.\d+)?$/.test(v) ? +v : v);
    } else if (t.id === 'dzPid') { p.patientCol = t.value; }
    else return;
    render();
  }

  function preview(kind) {
    if (!st.plan) return;
    const o = opts();
    let code;
    try {
      code = kind === 'py' ? KC.codegen.python(st.plan, o) : kind === 'sql' ? KC.codegen.sql(st.plan, o) : KC.codegen.regexModule();
    } catch (e) { $('#dzMsg').innerHTML = note('코드를 만들지 못했습니다: ' + esc(e.message), 'err'); return; }
    const bad = KC.codegen.selfCheck(code, kind === 'sql' ? 'sql' : 'python');
    $('#dzView').classList.remove('hidden');
    $('#dzView').textContent = code;
    $('#dzMsg').innerHTML = bad.length ? note('자체 검사 실패: ' + esc(bad.map(function (b) { return b.line + '행 ' + b.text; }).join(' / ')), 'err')
      : note('자체 검사 통과 — 원본 수정 구문(UPDATE·DELETE·DROP TABLE·덮어쓰기 등) 없음', 'ok');
  }

  function download() {
    if (!st.plan) return;
    try {
      const pkg = KC.codegen.buildPackage(st.plan, opts());
      const zip = KC.writers.zip(pkg.files.map(function (f) { return { name: f.path, content: f.content }; }));
      const name = 'KCURE_가명처리코드_' + (st.plan.cancer || '선택') + '_' + U.nowIso().replace(/[-:T]/g, '').slice(0, 12) + '.zip';
      U.download(name, new Blob([zip], { type: 'application/zip' }));
      $('#dzMsg').innerHTML = note('패키지를 만들었습니다: 파일 ' + pkg.files.length + '개 · 자체 검사 통과 · deid.py SHA-256 ' + pkg.hashes['deid.py'].slice(0, 16) + '…', 'ok');
    } catch (e) { $('#dzMsg').innerHTML = note(esc(e.message), 'err'); }
  }

  function scan() {
    const r = KC.deid.scanText($('#dzText').value);
    const kinds = Object.keys(r.counts);
    $('#dzScan').innerHTML = '<div class="stats">' + (kinds.length ? kinds.map(function (k) { return stat(k, r.counts[k]); }).join('') : stat('탐지', 0, 'PII 없음')) + '</div>' +
      '<h3>치환 결과 미리보기</h3><pre class="view">' + esc(r.redacted) + '</pre>';
  }

  function init(host) {
    st.host = host;
    $('#dzFileBtn').addEventListener('click', function () { $('#dzFile').click(); });
    $('#dzFile').addEventListener('change', function (e) { if (e.target.files[0]) fromFile(e.target.files[0]); e.target.value = ''; });
    $('#dzFromSel').addEventListener('click', fromSelection);
    $('#dzTableWrap').addEventListener('change', onChange);
    $('#dzPid').addEventListener('change', onChange);
    $('#dzAll').addEventListener('click', function () { if (st.plan) { st.plan.columns.forEach(function (c) { if (c.confidence === '높음' || c.confidence === '수동') c.status = '승인'; }); render(); } });
    $('#dzNone').addEventListener('click', function () { if (st.plan) { st.plan.columns.forEach(function (c) { c.status = '후보'; }); render(); } });
    $('#dzPy').addEventListener('click', function () { preview('py'); });
    $('#dzSql').addEventListener('click', function () { preview('sql'); });
    $('#dzRx').addEventListener('click', function () { preview('rx'); });
    $('#dzZip').addEventListener('click', download);
    $('#dzScanBtn').addEventListener('click', scan);
    $('#dzDialect').innerHTML = Object.keys(KC.codegen.DIALECTS).map(function (k) { return '<option value="' + k + '">' + esc(KC.codegen.DIALECTS[k]) + '</option>'; }).join('');
  }

  return { init: init, render: render, fromFile: fromFile, fromSelection: fromSelection, state: st };
})();
