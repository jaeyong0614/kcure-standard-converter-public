/* 로컬 소형 LLM 보조 (Hospital sw flow 3.1 Router/Adapter, NFR-01~03)
 * - 기본 배포본은 CSP connect-src 'none' 이라 동작하지 않는다. `python tools/build.py --llm` 빌드에서만
 *   127.0.0.1:11434(Ollama)·127.0.0.1:1234(LM Studio 등 OpenAI 호환)로 연결할 수 있다.
 * - LLM 은 '제안'만 한다. 응답은 JSON 스키마로 검증하고, 실패하면 1회 재시도한 뒤 규칙 추천을 그대로 둔다.
 * - 샘플값 전송은 기본 OFF. 켜더라도 loopback 주소로만 보낸다. */
window.KC = window.KC || {};

KC.llm = (function () {
  'use strict';
  const BATCH = 20;
  const ADAPTERS = {
    ollama: { label: 'Ollama (127.0.0.1:11434)', url: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct' },
    openai: { label: 'OpenAI 호환 · LM Studio (127.0.0.1:1234)', url: 'http://127.0.0.1:1234', model: 'local-model' }
  };
  const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;

  /* ---------- 프롬프트 (docs/04_맞춤형_프롬프트.md P1~P3, 소형 LLM용) ---------- */
  const P1_SYSTEM = [
    '당신은 한국 암 데이터(K-CURE) 표준화와 가명처리 규칙을 판정하는 데이터 엔지니어입니다.',
    '병원 원본 데이터는 절대 수정하지 않습니다. 당신은 판단만 하고, 코드는 별도 템플릿이 만듭니다.',
    'JSON만 출력하고 다른 문장은 쓰지 마세요. 모르면 null 과 confidence "낮음"을 쓰세요.'
  ].join('\n');
  const TECH = ['DELETE', 'MASK', 'HASH_SALT', 'YEAR_ONLY', 'DATE_SHIFT', 'DATE_TO_INTERVAL', 'BIN', 'TOP_BOTTOM', 'GROUP_RARE', 'REGEX_PII', 'KEEP'];

  function p1User(cancer, cols, withSamples) {
    return [
      '[입력]', '- 암종: ' + (cancer || '미지정'),
      '- 원천 컬럼' + (withSamples ? '과 샘플값(고유값 최대 3개)' : '') + ', 그리고 규칙이 고른 표준 후보:',
      cols.map(function (c) {
        return '  ' + c.col + (withSamples && c.sample.examples.length ? ' | 샘플: ' + c.sample.examples.join(', ') : '') +
          ' | 후보: ' + (c.candidates.length ? c.candidates.map(function (x) { return x.id + ' ' + x.name + '(' + x.type + ',' + x.role + ')'; }).join('; ') : '없음');
      }).join('\n'),
      '', '[작업] 각 컬럼마다 1) 후보 중 맞는 item_id 하나(없으면 null) 2) 가명처리 기법 하나 3) 근거 30자 이내',
      '기법 목록: ' + TECH.join(' | '),
      '[판정 규칙] 성명·주민번호·전화·상세주소·이메일 → DELETE / 병원 환자번호·등록번호 → HASH_SALT / 생년월일 → YEAR_ONLY /',
      '사건 일자 → DATE_SHIFT / 자유문 → REGEX_PII / 임상 측정값·코드값 → KEEP (극단값 재식별 위험이면 TOP_BOTTOM)',
      '[출력: JSON만] {"columns":[{"raw":"<원천컬럼>","item_id":"KCURE-...|null","technique":"<기법>","reason":"<30자 이내>","confidence":"높음|중간|낮음"}]}'
    ].join('\n');
  }

  const P2_TEMPLATE = '[역할] 한국어 의무기록 PII 탐지 전문가\n[입력] 문서 유형: {doc_type}\n샘플 텍스트:\n{sample_clinical_text}\n' +
    '[작업] NAME|RRN|PATIENT_NO|PHONE|DATE|ADDRESS|HOSPITAL|DOCTOR|EMAIL 유형별 Python re 정규식과 예외어를 제시\n' +
    '[출력: JSON만] {"patterns":[{"type":"PHONE","regex":"...","examples":["..."],"false_positive_risk":"낮음|중간|높음"}],"exceptions":[],"needs_review":true}';
  const P3_TEMPLATE = '[역할] DICOM PS3.15 Annex E 비식별화 전문가\n[입력] 영상 종류: {modality}\n태그 목록: {tag_list}\n연구 목적: {purpose}\n' +
    '[작업] 태그마다 REMOVE|EMPTY|REPLACE_DUMMY|HASH_UID|SHIFT_DATE|KEEP 중 하나\n' +
    '[출력: JSON만] {"tags":[{"tag":"(0010,0010)","name":"PatientName","action":"REMOVE"}],"pixel_warning":false,"needs_review":true}';

  /* ---------- 응답 검증 ---------- */
  /** 텍스트에서 첫 JSON 객체를 꺼낸다 (코드펜스·앞뒤 문장 허용) */
  function extractJson(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    if (start < 0) throw new Error('JSON 없음');
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
    throw new Error('JSON 미완결');
  }

  /** P1 응답 검증 → 컬럼명별 제안 {raw, itemId, technique, reason, confidence}. 잘못된 항목은 버린다 */
  function validateP1(obj, cols) {
    if (!obj || !Array.isArray(obj.columns)) throw new Error('columns 배열 없음');
    const byCol = {};
    cols.forEach(function (c) { byCol[c.col] = c; });
    const out = {};
    obj.columns.forEach(function (r) {
      if (!r || typeof r.raw !== 'string' || !byCol[r.raw]) return;
      if (TECH.indexOf(r.technique) < 0) return;
      const id = r.item_id && r.item_id !== 'null' ? String(r.item_id) : null;
      if (id && !KC.spec.byId[id]) return;            // 존재하지 않는 항목ID(환각) 거부
      out[r.raw] = { raw: r.raw, itemId: id, technique: r.technique, reason: String(r.reason || '').slice(0, 60),
        confidence: ['높음', '중간', '낮음'].indexOf(r.confidence) >= 0 ? r.confidence : '낮음' };
    });
    return out;
  }

  /* ---------- 전송 ---------- */
  function transportFor(cfg) {
    const url = String(cfg.url || '').replace(/\/+$/, '');
    if (!LOOPBACK.test(url + '/')) throw new Error('LLM 주소는 이 PC(127.0.0.1·localhost)만 허용합니다: ' + url);
    return async function (messages, signal) {
      if (cfg.adapter === 'openai') {
        const r = await fetch(url + '/v1/chat/completions', { method: 'POST', signal: signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0, response_format: { type: 'json_object' } }) });
        if (!r.ok) throw new Error('LLM 응답 ' + r.status);
        return (await r.json()).choices[0].message.content;
      }
      const r = await fetch(url + '/api/chat', { method: 'POST', signal: signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages: messages, stream: false, format: 'json', options: { temperature: 0 } }) });
      if (!r.ok) throw new Error('LLM 응답 ' + r.status);
      return (await r.json()).message.content;
    };
  }

  function candidatesOf(c, cancer) {
    const m = KC.mapper.matchOne(c.col, cancer || '');
    const ids = [m.itemId].concat((m.alternatives || []).map(function (a) { return a.itemId || a.id || a; })).filter(Boolean);
    if (!ids.length) {
      // 별칭 사전에 없는 컬럼: 이름이 서로 포함되는 항목을 후보로 (최대 5개)
      const k = KC.util.normKey(c.col);
      if (k.length >= 2) KC.spec.items.forEach(function (it) { const n = KC.util.normKey(it.name); if (ids.length < 5 && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0) && n.length >= 2) ids.push(it.id); });
    }
    const seen = {};
    return ids.filter(function (id) { if (seen[id] || !KC.spec.byId[id]) return false; seen[id] = 1; return true; }).slice(0, 5)
      .map(function (id) { const it = KC.spec.byId[id]; return { id: id, name: it.name, type: it.type, role: it.role }; });
  }

  /**
   * 계획(plan)의 '높음'이 아닌 컬럼에 LLM 제안을 붙인다(c.llm). 적용은 사람이 한다.
   * opts = {adapter,url,model,withSamples, transport?(테스트용), signal?, onProgress?(done,total)}
   * 반환 {asked, suggested, failedBatches, errors}
   */
  async function suggest(plan, opts) {
    const send = opts.transport || transportFor(opts);
    const targets = plan.columns.filter(function (c) { return c.confidence !== '높음' && c.confidence !== '수동'; });
    const res = { asked: targets.length, suggested: 0, failedBatches: 0, errors: [] };
    for (let i = 0; i < targets.length; i += BATCH) {
      if (opts.signal && opts.signal.aborted) { res.errors.push('취소됨'); break; }
      const batch = targets.slice(i, i + BATCH).map(function (c) { return Object.assign(c, { candidates: candidatesOf(c, plan.cancer) }); });
      const messages = [{ role: 'system', content: P1_SYSTEM }, { role: 'user', content: p1User(plan.cancer, batch, !!opts.withSamples) }];
      let got = null;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        try { got = validateP1(extractJson(await send(messages, opts.signal)), batch); }
        catch (e) { if (attempt === 1) { res.failedBatches++; res.errors.push(String(e.message || e)); } }
      }
      if (got) batch.forEach(function (c) { if (got[c.col]) { c.llm = got[c.col]; res.suggested++; } });
      if (opts.onProgress) opts.onProgress(Math.min(i + BATCH, targets.length), targets.length);
    }
    return res;
  }

  /** 사람이 'LLM 제안 적용'을 누르면 기법·항목을 바꾼다 (승인은 별도) */
  function apply(c) {
    if (!c.llm) return;
    c.technique = c.llm.technique;
    c.params = Object.assign({}, (KC.deid.techniques()[c.technique] || {}).params || {});
    if (c.llm.itemId) c.item = KC.spec.byId[c.llm.itemId];
    c.ruleId = 'LLM';
    c.reason = 'LLM 제안: ' + c.llm.reason;
    c.confidence = c.llm.confidence;
    c.status = '후보';
  }

  /** 수동 사용(ChatGPT·로컬 LLM 창)을 위한 프롬프트 묶음 — 현재 계획으로 P1을 채워 준다 */
  function exportPrompts(plan) {
    const cols = (plan ? plan.columns : []).map(function (c) { return Object.assign({}, c, { candidates: candidatesOf(c, plan.cancer) }); });
    return ['# K-CURE 맞춤형 프롬프트 (변환기에서 생성)', '', '## P1 정형 로우 항목 → 표준 매핑 + 가명처리', '', '```text', P1_SYSTEM, '', p1User(plan ? plan.cancer : '', cols, false), '```', '',
      '## P2 비정형 PII', '', '```text', P2_TEMPLATE, '```', '', '## P3 DICOM', '', '```text', P3_TEMPLATE, '```', ''].join('\n');
  }

  return {
    enabled: function () { return !!window.KC_LLM_BUILD; }, ADAPTERS: ADAPTERS, BATCH: BATCH,
    extractJson: extractJson, validateP1: validateP1, suggest: suggest, apply: apply, exportPrompts: exportPrompts,
    transportFor: transportFor, prompts: { P1_SYSTEM: P1_SYSTEM, p1User: p1User, P2: P2_TEMPLATE, P3: P3_TEMPLATE }
  };
})();
