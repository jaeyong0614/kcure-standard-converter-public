/* ④ 가명처리 코드 탭 — 샘플 분석 → 컬럼별 기법 추천·승인 → 코드 미리보기·패키지 내려받기 */
window.KC = window.KC || {};

KC.deidUi = (function () {
  'use strict';
  const U = KC.util, esc = U.esc;
  const $ = function (s) { return document.querySelector(s); };
  const st = { plan: null, source: '', host: null };
  const ORDER = ['DELETE', 'HASH_SALT', 'YEAR_ONLY', 'DATE_SHIFT', 'DATE_TO_INTERVAL', 'MASK', 'BIN', 'TOP_BOTTOM', 'GROUP_RARE', 'REGEX_PII', 'KEEP'];

  function by() { const el = document.querySelector('#dzOperator'); return el ? el.value.trim() : ''; }
  function planLogged(how) {
    KC.audit.log('deid.plan', { source: how, cancer: st.plan.cancer, columns: st.plan.columns.length, sampleRows: st.plan.sampleRows,
      rulepack: st.plan.version, autoApproved: st.plan.columns.filter(function (c) { return c.status === '승인'; }).length, by: by() });
  }
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
      planLogged('file');
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
    planLogged('selection');
    st.source = '① 선택 항목 ' + entries.length + '개 (샘플 없음 — 컬럼명·표준항목 기준 추천)';
    render();
  }

  function render() {
    renderGov();
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
    $('#dzTableWrap').innerHTML = '<table><thead><tr><th>승인</th><th>원천 컬럼</th><th>표준항목</th><th>샘플 패턴</th><th>가명처리 기법</th><th>파라미터</th><th>근거 (규칙)</th><th>신뢰도</th><th>LLM 제안</th></tr></thead><tbody>' +
      p.columns.map(function (c, i) {
        const sel = '<select data-dzt="' + i + '">' + ORDER.map(function (t) { return '<option value="' + t + '"' + (t === c.technique ? ' selected' : '') + '>' + esc(T[t].label) + '</option>'; }).join('') + '</select>';
        const params = Object.keys(c.params || {}).map(function (k) {
          return '<label class="small">' + esc(k) + ' <input type="text" class="mono" style="width:70px" data-dzp="' + i + '" data-k="' + esc(k) + '" value="' + esc(c.params[k] == null ? '' : c.params[k]) + '"></label>';
        }).join(' ');
        const pc = c.confidence === '높음' ? 'ok' : c.confidence === '낮음' ? 'warn' : 'info';
        const smp = c.sample.n ? esc(c.sample.pattern) + (c.sample.dateFormats.length ? ' ' + esc(c.sample.dateFormats.join('/')) : '') + '<div class="l2">고유값 ' + c.sample.distinct + '/' + c.sample.n + '</div>' : '<span class="muted small">샘플 없음</span>';
        const exp = c.expand.length ? '<div class="l2">전개 제안: ' + esc(c.expand.map(function (x) { return x.parts.join('·') + ' (' + x.hint + ')'; }).join(' / ')) + '</div>' : '';
        return '<tr class="' + (c.status === '반려' ? 'muted' : '') + '"><td><select data-dzs="' + i + '">' + ['후보', '승인', '반려'].map(function (s) {
            return '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
          '<td><b>' + esc(c.col) + '</b>' + exp + '</td>' +
          '<td class="small">' + (c.item ? '<span class="mono">' + c.item.id + '</span><div class="l2">' + esc(c.item.name) + ' · ' + esc(c.item.role) + '</div>' : '<span class="pill warn">미매핑</span>') + '</td>' +
          '<td class="small">' + smp + '</td><td>' + sel + '</td><td>' + (params || '<span class="muted small">—</span>') + '</td>' +
          '<td class="small">' + esc(c.reason) + ' <span class="muted mono">' + c.ruleId + '</span></td><td><span class="pill ' + pc + '">' + esc(c.confidence) + '</span></td>' +
          '<td class="small">' + (c.llm ? esc((KC.deid.techniques()[c.llm.technique] || {}).label || c.llm.technique) + (c.llm.itemId ? ' · ' + esc(c.llm.itemId) : '') +
            '<div class="l2">' + esc(c.llm.reason) + ' (' + esc(c.llm.confidence) + ')</div>' +
            (c.llm.weakens ? '<div class="l2"><span class="pill warn">보호 수준 낮춤 — 확인 필요</span></div>' : '') + '<button class="btn sm" data-dzl="' + i + '">적용</button>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- LLM 보조 ---------- */
  let llmCtl = null;
  async function llmRun() {
    if (!st.plan) { $('#dzLlmMsg').textContent = '먼저 추천 계획을 만드세요.'; return; }
    if (!KC.llm.enabled()) { $('#dzLlmMsg').textContent = '이 배포본에서는 LLM 연결이 차단되어 있습니다.'; return; }
    llmCtl = new AbortController();
    $('#dzLlmMsg').textContent = '요청 중…';
    try {
      const r = await KC.llm.suggest(st.plan, { adapter: $('#dzLlmAdapter').value, url: $('#dzLlmUrl').value.trim(), model: $('#dzLlmModel').value.trim(),
        withSamples: $('#dzLlmSamples').checked, signal: llmCtl.signal,
        onProgress: function (d, t) { $('#dzLlmMsg').textContent = '진행 ' + d + ' / ' + t + ' 컬럼'; } });
      $('#dzLlmMsg').textContent = '제안 ' + r.suggested + ' / 대상 ' + r.asked + (r.failedBatches ? ' · 실패 묶음 ' + r.failedBatches + '(규칙 추천 유지): ' + r.errors[0] : '');
    } catch (e) { $('#dzLlmMsg').textContent = 'LLM 오류(규칙 추천 유지): ' + e.message; }
    render();
  }
  function initLlm() {
    const on = KC.llm.enabled();
    $('#dzLlmOff').classList.toggle('hidden', on);
    ['#dzLlmForm', '#dzLlmRun', '#dzLlmStop', '#dzLlmSafe'].forEach(function (s) { $(s).classList.toggle('hidden', !on); });
    $('#dzLlmAdapter').innerHTML = Object.keys(KC.llm.ADAPTERS).map(function (k) { return '<option value="' + k + '">' + esc(KC.llm.ADAPTERS[k].label) + '</option>'; }).join('');
    const setDef = function () { const a = KC.llm.ADAPTERS[$('#dzLlmAdapter').value]; $('#dzLlmUrl').value = a.url; $('#dzLlmModel').value = a.model; };
    setDef();
    $('#dzLlmAdapter').addEventListener('change', setDef);
    $('#dzLlmRun').addEventListener('click', llmRun);
    $('#dzLlmStop').addEventListener('click', function () { if (llmCtl) llmCtl.abort(); });
    $('#dzLlmSafe').addEventListener('click', function () {
      if (!st.plan) return;
      const n = KC.llm.applySafe(st.plan);
      KC.audit.log('deid.llm_apply_safe', { count: n, by: by() });
      $('#dzLlmMsg').textContent = '보호 수준을 낮추지 않는 제안 ' + n + '건을 적용했습니다(모두 후보 상태 — 승인 필요).';
      render();
    });
    $('#dzLlmPrompts').addEventListener('click', function () { U.download('KCURE_맞춤형_프롬프트.md', KC.llm.exportPrompts(st.plan), 'text/markdown'); });
  }

  /* ---------- DICOM ---------- */
  function dicomOpts() {
    return { modality: $('#dcMod').value, range: +$('#dcRange').value || 30, input: $('#dcIn').value.trim(), output: $('#dcOut').value.trim(),
      shiftDates: $('#dcShift').checked, birthYear: $('#dcYear').checked, keepPatientChar: $('#dcChar').checked, keepDescriptions: $('#dcDesc').checked,
      removePrivate: $('#dcPriv').checked };
  }
  function dicomCode() {
    const code = KC.dicomgen.python(dicomOpts());
    const bad = KC.codegen.selfCheck(code, 'python');
    $('#dcMsg').textContent = bad.length ? '자체 검사 실패: ' + bad.map(function (b) { return b.line + '행'; }).join(', ') : '자체 검사 통과 · 태그 ' + KC.dicomgen.TAGS.length + '개';
    return bad.length ? null : code;
  }
  function initDicom() {
    $('#dcMod').innerHTML = Object.keys(KC.dicomgen.MODALITIES).map(function (k) { return '<option value="' + k + '">' + esc(KC.dicomgen.MODALITIES[k]) + '</option>'; }).join('');
    $('#dcPv').addEventListener('click', function () { const c = dicomCode(); if (c) { $('#dcView').classList.remove('hidden'); $('#dcView').textContent = c; } });
    $('#dcDl').addEventListener('click', function () {
      const c = dicomCode();
      if (c) { U.download('deid_dicom.py', c, 'text/x-python'); KC.audit.log('dicom.script', { options: dicomOpts(), sha256: KC.sha256(c), by: by() }); renderGov(); }
    });
  }

  /* ---------- 규칙팩 · 감사 이력 ---------- */
  async function renderGov() {
    const r = window.KCURE_DEID;
    $('#rpInfo').textContent = '현재 규칙팩 v' + r.version + ' · 규칙 ' + r.rules.length + ' · PII 패턴 ' + r.pii.length + ' · SHA-256 ' + KC.rulepack.digest(r).slice(0, 12) + '…';
    const ev = await KC.audit.all();
    const v = KC.audit.verify(ev);
    $('#auInfo').textContent = '감사 이력 ' + ev.length + '건' + (ev.length ? ' · 체인 ' + (v.ok ? '정상' : (v.at + '번째에서 끊김')) : '');
  }
  function initGov() {
    $('#rpExport').addEventListener('click', function () {
      const pack = KC.rulepack.exportPack(window.KCURE_DEID, by());
      U.download('rulepack_' + pack.version + '.json', JSON.stringify(pack, null, 2), 'application/json');
      KC.audit.log('rulepack.export', { version: pack.version, sha256: pack.sha256, by: by() });
      renderGov();
    });
    $('#rpImportBtn').addEventListener('click', function () { $('#rpImport').click(); });
    $('#rpImport').addEventListener('change', async function (e) {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const pack = JSON.parse(await f.text());
        const v = KC.rulepack.validate(pack);
        if (!v.ok) { $('#rpMsg').innerHTML = note('규칙팩을 적용하지 않았습니다: ' + esc(v.errors.join(' / ')), 'err'); return; }
        const d = KC.rulepack.diff(window.KCURE_DEID, pack.deid_rules);
        const msg = 'v' + d.from + ' → v' + d.to + ' · 추가 ' + d.added.length + ' · 삭제 ' + d.removed.length + ' · 변경 ' + d.changed.length + (d.piiChanged ? ' · PII 패턴 변경' : '');
        if (!window.confirm('규칙팩을 교체할까요?\n' + msg + '\n(현재 창에만 적용, 기존 추천 계획은 다시 만들어야 합니다)')) { $('#rpMsg').innerHTML = note('취소했습니다. ' + esc(msg)); return; }
        KC.rulepack.apply(pack);
        KC.audit.log('rulepack.apply', { from: d.from, to: d.to, sha256: pack.sha256, added: d.added, removed: d.removed, changed: d.changed, by: by() });
        st.plan = null;
        render();
        $('#rpMsg').innerHTML = note('규칙팩을 교체했습니다: ' + esc(msg) + '. 추천을 다시 실행하세요.', 'ok');
      } catch (err) { $('#rpMsg').innerHTML = note('규칙팩을 읽지 못했습니다: ' + esc(err.message), 'err'); }
      renderGov();
    });
    $('#auExport').addEventListener('click', async function () {
      U.download('KCURE_감사이력_' + U.nowIso().replace(/[-:T]/g, '').slice(0, 12) + '.jsonl', await KC.audit.toJsonl(), 'application/x-ndjson');
    });
    $('#auClear').addEventListener('click', async function () {
      if (!window.confirm('이 브라우저의 감사 이력을 비울까요? 먼저 내려받아 보관했는지 확인하세요.')) return;
      await KC.audit.clear();
      renderGov();
    });
    renderGov();
  }

  function onChange(e) {
    const p = st.plan;
    if (!p) return;
    const t = e.target;
    if (t.dataset.dzs !== undefined) {
      const c = p.columns[+t.dataset.dzs];
      KC.audit.log('deid.status', { col: c.col, from: c.status, to: t.value, technique: c.technique, ruleId: c.ruleId, by: by() });
      c.status = t.value;
    }
    else if (t.dataset.dzt !== undefined) {
      const c = p.columns[+t.dataset.dzt];
      KC.audit.log('deid.technique', { col: c.col, from: c.technique, to: t.value, by: by() });
      c.technique = t.value;
      c.params = Object.assign({}, KC.deid.techniques()[t.value].params || {});
      c.ruleId = '수동';
      c.reason = '담당자 지정';
      c.confidence = '수동';
    } else if (t.dataset.dzp !== undefined) {
      const c = p.columns[+t.dataset.dzp], v = t.value.trim();
      c.params[t.dataset.k] = v === '' ? null : (/^-?\d+(\.\d+)?$/.test(v) ? +v : v);
      KC.audit.log('deid.param', { col: c.col, param: t.dataset.k, value: c.params[t.dataset.k], by: by() });
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
      KC.audit.log('deid.package', { file: name, dialect: opts().dialect, approved: KC.codegen.approved(st.plan).map(function (c) { return c.col; }),
        hashes: pkg.hashes, rulepack: st.plan.version, by: by() });
      renderGov();
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
    $('#dzTableWrap').addEventListener('click', function (e) {
      const b = e.target.closest('[data-dzl]');
      if (b && st.plan) {
        const c = st.plan.columns[+b.dataset.dzl];
        KC.audit.log('deid.llm_apply', { col: c.col, from: c.technique, to: c.llm.technique, itemId: c.llm.itemId, by: by() });
        KC.llm.apply(c); render();
      }
    });
    initLlm();
    initDicom();
    initGov();
    $('#dzDialect').innerHTML = Object.keys(KC.codegen.DIALECTS).map(function (k) { return '<option value="' + k + '">' + esc(KC.codegen.DIALECTS[k]) + '</option>'; }).join('');
  }

  return { init: init, render: render, fromFile: fromFile, fromSelection: fromSelection, state: st };
})();
