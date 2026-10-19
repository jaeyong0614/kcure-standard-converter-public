/* S5 실모델 PoC — 더미 병원 추출 컬럼 46개로 로컬 LLM(Ollama) 제안 품질·속도를 잰다.
 * 실제 앱과 같은 코드 경로(KC.deid.plan → KC.llm.suggest, 20개 단위)를 쓰고, 전송만 계측용으로 감싼다.
 * 정답(acc)은 허용 기법 목록이다. 데이터는 모두 합성값이며 실제 환자 정보가 아니다.
 * 실행: tools/devserver.py 를 띄운 뒤 http://localhost:8765/tests/llm_poc.html?auto=1&samples=0 */
(function () {
  'use strict';
  const $ = function (s) { return document.querySelector(s); };
  const esc = KC.util.esc;

  // [컬럼명, 허용 기법, 샘플 생성기 이름]
  const COLS = [
    ['PT_NM', ['DELETE'], 'name'], ['성명', ['DELETE'], 'name'], ['환자 이름', ['DELETE'], 'name'], ['JUMIN_NO', ['DELETE'], 'rrn'],
    ['HP_NO', ['DELETE'], 'phone'], ['GUARDIAN_TEL', ['DELETE'], 'phone'], ['보호자 연락처', ['DELETE'], 'phone'], ['EMAIL_ADDR', ['DELETE'], 'email'],
    ['ADDR1', ['DELETE', 'MASK'], 'addr'], ['ZIP', ['MASK', 'DELETE'], 'zip'], ['ATTEND_DR', ['DELETE'], 'name'], ['INS_NO', ['DELETE', 'HASH_SALT'], 'ins'],
    ['PT_ID', ['HASH_SALT'], 'pid'], ['CHART_NO', ['HASH_SALT'], 'chart'], ['BIRTH_YMD', ['YEAR_ONLY'], 'birth'], ['AGE_AT_DX', ['TOP_BOTTOM', 'BIN'], 'age'],
    ['진단시 나이', ['TOP_BOTTOM', 'BIN'], 'age'], ['ADM_DT', ['DATE_SHIFT', 'DATE_TO_INTERVAL'], 'date'], ['OP_DT', ['DATE_SHIFT', 'DATE_TO_INTERVAL'], 'date'],
    ['DX_YMD', ['DATE_SHIFT', 'DATE_TO_INTERVAL'], 'date'], ['DEATH_DT', ['DATE_SHIFT', 'DATE_TO_INTERVAL'], 'date'], ['내원일', ['DATE_SHIFT', 'DATE_TO_INTERVAL'], 'date'],
    ['HOSP_CD', ['GROUP_RARE', 'KEEP', 'HASH_SALT'], 'hosp'], ['PATH_RSLT_TXT', ['REGEX_PII'], 'note'], ['PROGRESS_NOTE', ['REGEX_PII'], 'note'],
    ['RMK', ['REGEX_PII', 'DELETE'], 'note'], ['수술 소견', ['REGEX_PII'], 'note'], ['조직검사 결과 서술', ['REGEX_PII'], 'note'], ['FAMILY_HX_TXT', ['REGEX_PII'], 'note'],
    ['T_STAGE', ['KEEP'], 't'], ['N_STAGE', ['KEEP'], 'n'], ['ER_STAT', ['KEEP'], 'posneg'], ['HER2_IHC', ['KEEP'], 'her2'], ['CEA_VAL', ['KEEP', 'TOP_BOTTOM'], 'num'],
    ['HT_CM', ['KEEP', 'TOP_BOTTOM'], 'ht'], ['WT_KG', ['KEEP', 'TOP_BOTTOM'], 'wt'], ['SMK_YN', ['KEEP'], 'yn'], ['ALC_YN', ['KEEP'], 'yn'],
    ['CHEMO_REGIMEN', ['KEEP'], 'regimen'], ['RT_DOSE_GY', ['KEEP'], 'num'], ['TUMOR_SIZE_MM', ['KEEP', 'TOP_BOTTOM'], 'num'], ['RECUR_YN', ['KEEP'], 'yn'],
    ['ECOG', ['KEEP'], 'ecog'], ['SEX_CD', ['KEEP'], 'sex'], ['진료과', ['KEEP', 'GROUP_RARE'], 'dept'], ['KCD_CD', ['KEEP'], 'kcd']
  ];

  // 결정적 의사난수 (같은 시드 → 같은 더미)
  let seed = 20261019;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function d2(n) { return String(n).padStart(2, '0'); }
  const GEN = {
    name: function () { return pick(['김', '이', '박', '최', '정']) + pick(['민', '서', '지', '현', '수']) + pick(['준', '연', '호', '아', '우']); },
    rrn: function () { return '7' + Math.floor(rnd() * 9) + d2(1 + Math.floor(rnd() * 12)) + d2(1 + Math.floor(rnd() * 28)) + '-' + pick(['1', '2']) + '000000'; },
    phone: function () { return '010-0000-' + String(1000 + Math.floor(rnd() * 8999)); },
    email: function () { return 'user' + Math.floor(rnd() * 900 + 100) + '@example.com'; },
    addr: function () { return pick(['서울특별시 종로구 대학로 101', '부산광역시 서구 구덕로 179', '대구광역시 중구 동덕로 130']); },
    zip: function () { return String(10000 + Math.floor(rnd() * 89999)); },
    ins: function () { return '5' + String(Math.floor(rnd() * 1e10)).padStart(10, '0'); },
    pid: function () { return 'P' + String(Math.floor(rnd() * 1e7)).padStart(7, '0'); },
    chart: function () { return String(Math.floor(rnd() * 1e8)).padStart(8, '0'); },
    birth: function () { return String(1940 + Math.floor(rnd() * 50)) + d2(1 + Math.floor(rnd() * 12)) + d2(1 + Math.floor(rnd() * 28)); },
    age: function () { return String(35 + Math.floor(rnd() * 60)); },
    date: function () { return String(2018 + Math.floor(rnd() * 7)) + '-' + d2(1 + Math.floor(rnd() * 12)) + '-' + d2(1 + Math.floor(rnd() * 28)); },
    hosp: function () { return pick(['H001', 'H002', 'H003']); },
    note: function () { return pick(['우측 결장 선암, 림프절 2/15 전이. 담당 김민준 교수 확인', '수술 후 경과 양호, 2024.03.05 외래 예정. 보호자 연락 010-0000-1234', 'Adenocarcinoma, moderately differentiated. 절제연 음성']); },
    t: function () { return pick(['T1', 'T2', 'T3', 'T4a']); }, n: function () { return pick(['N0', 'N1', 'N2']); },
    posneg: function () { return pick(['Positive', 'Negative']); }, her2: function () { return pick(['0', '1+', '2+', '3+']); },
    num: function () { return (rnd() * 50).toFixed(1); }, ht: function () { return (150 + rnd() * 35).toFixed(1); }, wt: function () { return (45 + rnd() * 40).toFixed(1); },
    yn: function () { return pick(['Y', 'N']); }, regimen: function () { return pick(['FOLFOX', 'XELOX', 'AC-T']); }, ecog: function () { return pick(['0', '1', '2']); },
    sex: function () { return pick(['M', 'F']); }, dept: function () { return pick(['외과', '혈액종양내과', '방사선종양학과']); }, kcd: function () { return pick(['C18.7', 'C20', 'C50.9']); }
  };

  function dataset() {
    seed = 20261019;
    const headers = COLS.map(function (c) { return c[0]; });
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(COLS.map(function (c) { return GEN[c[2]](); }));
    return { headers: headers, rows: rows };
  }

  async function run(opts) {
    const ds = dataset();
    const plan = KC.deid.plan(ds.headers, ds.rows, '대장암');
    const ruleTech = {};
    plan.columns.forEach(function (c) { ruleTech[c.col] = c.technique; });
    const base = KC.llm.transportFor({ adapter: 'ollama', url: opts.url, model: opts.model });
    const calls = [];
    const transport = async function (messages, signal) {
      const t0 = performance.now();
      const rec = { promptChars: messages.map(function (m) { return m.content.length; }).reduce(function (a, b) { return a + b; }, 0) };
      try {
        const text = await base(messages, signal);
        rec.ms = Math.round(performance.now() - t0); rec.ok = true; rec.raw = text;
        try { rec.returned = (KC.llm.extractJson(text).columns || []).length; } catch (e) { rec.parseError = String(e.message); }
        calls.push(rec);
        return text;
      } catch (e) { rec.ms = Math.round(performance.now() - t0); rec.ok = false; rec.error = String(e.message || e); calls.push(rec); throw e; }
    };
    const t0 = performance.now();
    const res = await KC.llm.suggest(plan, { transport: transport, withSamples: !!opts.samples,
      onProgress: function (d, t) { $('#status').textContent = '진행 ' + d + ' / ' + t + ' 컬럼 · 경과 ' + Math.round((performance.now() - t0) / 1000) + '초'; } });
    const totalMs = Math.round(performance.now() - t0);
    const acc = {};
    COLS.forEach(function (c) { acc[c[0]] = c[1]; });
    const rows = plan.columns.map(function (c) {
      const sent = c.confidence !== '높음' && c.confidence !== '수동';
      const llm = c.llm ? c.llm.technique : '';
      return { col: c.col, accept: acc[c.col], rule: ruleTech[c.col], ruleConf: c.confidence, sent: sent, llm: llm, llmConf: c.llm ? c.llm.confidence : '', reason: c.llm ? c.llm.reason : '',
        itemId: c.llm ? c.llm.itemId : null, ruleOk: acc[c.col].indexOf(ruleTech[c.col]) >= 0, llmOk: !!llm && acc[c.col].indexOf(llm) >= 0,
        finalOk: acc[c.col].indexOf(llm || ruleTech[c.col]) >= 0,
        weakens: !!(c.llm && c.llm.weakens), category: c.llm ? c.llm.category || '' : '',
        // 안전 병합: 보호 수준을 낮추는 제안은 버리고 규칙을 유지 (앱의 '안전한 제안만 일괄 적용'과 같은 규칙)
        safeOk: acc[c.col].indexOf(llm && !(c.llm && c.llm.weakens) ? llm : ruleTech[c.col]) >= 0 };
    });
    const sent = rows.filter(function (r) { return r.sent; });
    const cnt = function (a, f) { return a.filter(f).length; };
    const summary = {
      model: opts.model, samples: !!opts.samples, batchSize: KC.llm.BATCH, columns: rows.length, sent: sent.length, batches: calls.length,
      suggested: res.suggested, failedBatches: res.failedBatches, errors: res.errors,
      jsonOk: cnt(calls, function (c) { return c.ok && !c.parseError; }), returnedTotal: calls.reduce(function (a, c) { return a + (c.returned || 0); }, 0),
      ruleAccSent: cnt(sent, function (r) { return r.ruleOk; }), llmAccSent: cnt(sent, function (r) { return r.llmOk; }), finalAccSent: cnt(sent, function (r) { return r.finalOk; }),
      ruleAccAll: cnt(rows, function (r) { return r.ruleOk; }), hybridAccAll: cnt(rows, function (r) { return r.sent ? r.finalOk : r.ruleOk; }),
      safeAccAll: cnt(rows, function (r) { return r.sent ? r.safeOk : r.ruleOk; }), weakened: cnt(rows, function (r) { return r.weakens; }),
      refilled: res.refilled || 0,
      totalSec: Math.round(totalMs / 100) / 10, batchSec: calls.map(function (c) { return Math.round(c.ms / 100) / 10; }),
      when: new Date().toISOString(), ua: navigator.userAgent
    };
    return { summary: summary, rows: rows, calls: calls };
  }

  function render(r) {
    const s = r.summary;
    $('#sum').innerHTML = '<table><tbody>' + [
      ['모델', s.model + (s.samples ? ' · 샘플값 전송' : ' · 샘플값 미전송(기본)')],
      ['LLM으로 보낸 컬럼', s.sent + ' / ' + s.columns + ' (규칙 신뢰도 높음은 제외)'],
      ['묶음(20개 단위)', s.batches + '회 · 실패 ' + s.failedBatches + ' · JSON 정상 ' + s.jsonOk + '/' + s.batches],
      ['묶음별 소요(초)', s.batchSec.join(' · ') + ' · 총 ' + s.totalSec + '초'],
      ['제안 수', s.suggested + ' / ' + s.sent + ' (모델이 돌려준 항목 ' + s.returnedTotal + ', 검증 탈락 ' + (s.returnedTotal - s.suggested) + ')'],
      ['보낸 컬럼 정확도', '규칙 ' + s.ruleAccSent + ' → LLM ' + s.llmAccSent + ' · LLM 우선(없으면 규칙) ' + s.finalAccSent + ' / ' + s.sent],
      ['전체 정확도', '규칙만 ' + s.ruleAccAll + ' → 규칙+LLM ' + s.hybridAccAll + ' · 안전 병합 ' + s.safeAccAll + ' / ' + s.columns],
      ['보호 수준을 낮추는 제안', s.weakened + '건 (안전 병합에서 제외)'], ['누락 재요청으로 채운 컬럼', s.refilled + '건']
    ].map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
    $('#rows').innerHTML = '<table><thead><tr><th>컬럼</th><th>정답(허용)</th><th>규칙</th><th>LLM</th><th>LLM 근거</th><th>안전 병합</th></tr></thead><tbody>' + r.rows.map(function (x) {
      return '<tr' + (x.sent ? '' : ' class="muted"') + '><td>' + esc(x.col) + '</td><td>' + esc(x.accept.join('/')) + '</td><td class="' + (x.ruleOk ? 'ok' : 'bad') + '">' + esc(x.rule) + ' (' + esc(x.ruleConf) + ')</td>' +
        '<td class="' + (!x.sent ? '' : x.llmOk ? 'ok' : 'bad') + '">' + esc(x.sent ? (x.llm || '제안 없음') : '보내지 않음') + '</td><td>' + esc(x.reason) + (x.weakens ? ' ⚠ 보호 수준 낮춤' : '') + '</td><td class="' + (x.safeOk ? 'ok' : 'bad') + '">' + (x.safeOk ? '정답' : '오답') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  async function go() {
    const opts = { url: $('#url').value.trim(), model: $('#model').value.trim(), samples: $('#samples').checked };
    $('#status').textContent = '시작…';
    $('#go').disabled = true;
    try {
      const r = await run(opts);
      render(r);
      window.POC_RESULT = r;
      $('#status').textContent = '완료 · ' + r.summary.totalSec + '초';
      const name = 'llm_poc_' + opts.model.replace(/[^\w.-]/g, '_') + (opts.samples ? '_samples' : '') + '.json';
      try { await fetch('/__save/' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify(r, null, 1) }); } catch (e) { /* 정적 서버 */ }
    } catch (e) {
      $('#status').textContent = '오류: ' + e.message;
      window.POC_RESULT = { error: String(e.message) };
    }
    $('#go').disabled = false;
    window.POC_DONE = true;
  }

  KC.spec.init(window.KCURE_SPEC);
  window.KC_LLM_BUILD = true;
  $('#go').addEventListener('click', go);
  const q = new URLSearchParams(location.search);
  if (q.get('model')) $('#model').value = q.get('model');
  if (q.get('samples') === '1') $('#samples').checked = true;
  $('#n').textContent = COLS.length;
  if (q.get('auto') === '1') go();
  window.POC = { COLS: COLS, dataset: dataset, run: run };
})();
