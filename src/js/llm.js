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
  // v3 (2026-10-19 실모델 PoC 반영)
  // - v1(기법 직접 판정): 임상 변수까지 삭제·마스킹하는 과잉 판정 → 보낸 40개 중 14개 정답
  // - v2(규칙 추천 제시 후 검토): 규칙 추천을 그대로 따라 하는 앵커링 → 개선 0
  // - v3: LLM 은 컬럼의 '의미 범주'만 판정하고, 범주 → 가명처리 기법은 코드(CATEGORY)가 정책대로 정한다.
  const P1_SYSTEM = [
    '당신은 한국 병원 데이터의 컬럼 의미를 분류하는 데이터 엔지니어입니다.',
    '각 컬럼이 개인을 식별하는 정보인지, 임상 변수인지를 범주 하나로 분류합니다. 가명처리 방법은 별도 규칙이 정합니다.',
    '대부분의 컬럼(병기, 검사 결과·수치, 여부, 진단·약제·코드, 키·체중, 성별, 진료과)은 CLINICAL 입니다.',
    'JSON만 출력하고 다른 문장은 쓰지 마세요.'
  ].join('\n');
  const TECH = ['DELETE', 'MASK', 'HASH_SALT', 'YEAR_ONLY', 'DATE_SHIFT', 'DATE_TO_INTERVAL', 'BIN', 'TOP_BOTTOM', 'GROUP_RARE', 'REGEX_PII', 'KEEP'];
  // 범주 → 기법 (정책). 범주 정의는 프롬프트에 그대로 들어간다.
  const CATEGORY = {
    NAME: ['DELETE', '사람 이름(환자·보호자·의료인)'],
    RRN: ['DELETE', '주민등록번호·외국인등록번호'],
    CONTACT: ['DELETE', '전화번호·휴대폰·이메일·상세주소'],
    INSURANCE_NO: ['DELETE', '건강보험증 번호 등 기관 외부 식별번호'],
    PATIENT_ID: ['HASH_SALT', '환자번호·등록번호·차트번호·병원 내 환자 ID'],
    BIRTH_DATE: ['YEAR_ONLY', '생년월일'],
    EVENT_DATE: ['DATE_SHIFT', '입원·내원·수술·진단·검사·사망 등 사건 날짜'],
    AGE: ['TOP_BOTTOM', '나이(세)'],
    POSTCODE: ['MASK', '우편번호'],
    INSTITUTION: ['GROUP_RARE', '병원·기관 코드나 이름'],
    FREE_TEXT: ['REGEX_PII', '소견·기록·메모·서술 같은 자유문'],
    CLINICAL: ['KEEP', '그 밖의 임상 변수(병기, 검사값, 여부, 코드, 약제, 키·체중, 성별, 진료과 등)']
  };
  const P1_EXAMPLE = '{"columns":[' +
    '{"raw":"PATIENT_NAME","category":"NAME","item_id":null,"reason":"환자 이름","confidence":"높음"},' +
    '{"raw":"PT_NO","category":"PATIENT_ID","item_id":null,"reason":"환자번호","confidence":"높음"},' +
    '{"raw":"M_STAGE","category":"CLINICAL","item_id":null,"reason":"M 병기","confidence":"높음"},' +
    '{"raw":"OPDATE","category":"EVENT_DATE","item_id":null,"reason":"수술일","confidence":"높음"}]}';

  function p1User(cancer, cols, withSamples) {
    return [
      '[범주 정의]', Object.keys(CATEGORY).map(function (k) { return k + ': ' + CATEGORY[k][1]; }).join('\n'), '',
      '[입력] 암종: ' + (cancer || '미지정') + ' · 컬럼 ' + cols.length + '개',
      '형식: 컬럼명' + (withSamples ? ' | 샘플값' : '') + ' | 표준항목 후보',
      cols.map(function (c) {
        return '- ' + c.col + (withSamples && c.sample.examples.length ? ' | 샘플: ' + c.sample.examples.join(', ') : '') +
          ' | 후보: ' + (c.candidates.length ? c.candidates.map(function (x) { return x.id + ' ' + x.name; }).join('; ') : '없음');
      }).join('\n'),
      '', '[작업] 위 ' + cols.length + '개 컬럼 모두에 대해 하나씩 답하세요.',
      '1) category: 범주 정의 중 하나. 컬럼명 약어(NM=이름, DT/YMD/일=날짜, NO=번호, TEL/HP=전화, DR/ATTEND/주치의=의사 이름, TXT/RMK/서술/소견/NOTE=자유문)를 해석하세요.',
      '   주의: 나이·연령·AGE 는 CLINICAL 이 아니라 AGE 입니다. 결과 서술·소견 같은 글 컬럼은 FREE_TEXT 입니다. 이름 컬럼은 반드시 NAME 입니다.',
      '2) item_id: 후보 목록에 있는 ID만 쓸 수 있습니다. 확실하지 않으면 null.',
      '3) reason: 20자 이내 한국어. 4) confidence: 높음|중간|낮음',
      '[출력 예시] ' + P1_EXAMPLE,
      '[출력: JSON만] {"columns":[{"raw":"...","category":"...","item_id":null,"reason":"...","confidence":"..."}]}'
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
      // v3: 범주가 있으면 정책표로 기법을 정한다. 범주 없이 기법만 온 응답(v1 형식)도 받는다
      const cat = r.category && CATEGORY[String(r.category).toUpperCase()] ? String(r.category).toUpperCase() : '';
      if (cat) r.technique = CATEGORY[cat][0];
      if (TECH.indexOf(r.technique) < 0) return;
      let id = r.item_id && r.item_id !== 'null' ? String(r.item_id) : null;
      if (id && !KC.spec.byId[id]) return;            // 존재하지 않는 항목ID(환각) 거부
      // 후보로 제시하지 않은 항목ID는 받지 않는다(기법 제안은 살리고 항목만 비움)
      const cands = byCol[r.raw].candidates;
      if (id && cands && !cands.some(function (x) { return x.id === id; })) id = null;
      out[r.raw] = { raw: r.raw, itemId: id, technique: r.technique, category: cat, reason: (cat ? cat + ': ' : '') + String(r.reason || '').slice(0, 60),
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
        // 20개 묶음의 프롬프트·응답이 기본 문맥 길이를 넘지 않도록 num_ctx 를 넉넉히, 모델은 10분간 메모리에 유지
        body: JSON.stringify({ model: cfg.model, messages: messages, stream: false, format: 'json', keep_alive: '10m',
          options: { temperature: 0, num_ctx: 8192 } }) });
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
      // 응답에서 빠진 컬럼만 모아 1회 다시 묻는다(소형 모델은 긴 목록에서 일부를 건너뛰는 일이 있다)
      const missing = got ? batch.filter(function (c) { return !got[c.col]; }) : [];
      if (missing.length && !(opts.signal && opts.signal.aborted)) {
        try {
          const again = validateP1(extractJson(await send([{ role: 'system', content: P1_SYSTEM }, { role: 'user', content: p1User(plan.cancer, missing, !!opts.withSamples) }], opts.signal)), missing);
          Object.keys(again).forEach(function (k) { got[k] = again[k]; });
          res.refilled = (res.refilled || 0) + Object.keys(again).length;
        } catch (e) { res.errors.push('누락 재요청 실패: ' + String(e.message || e)); }
      }
      if (got) batch.forEach(function (c) {
        if (got[c.col]) { c.llm = got[c.col]; c.llm.weakens = weakens(c.technique, c.llm.technique); res.suggested++; }
      });
      if (opts.onProgress) opts.onProgress(Math.min(i + BATCH, targets.length), targets.length);
    }
    return res;
  }

  /** LLM 제안이 규칙보다 보호 수준을 낮추는가: 규칙이 처리(삭제·가명·치환 등)하던 컬럼을 '유지'로 바꾸는 경우 */
  function weakens(ruleTech, llmTech) { return llmTech === 'KEEP' && ruleTech !== 'KEEP'; }

  /** 보호 수준을 낮추지 않는 제안만 일괄 적용 → 적용 수 */
  function applySafe(plan) {
    let n = 0;
    plan.columns.forEach(function (c) { if (c.llm && !c.llm.weakens && c.llm.technique !== c.technique) { apply(c); n++; } });
    return n;
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
    enabled: function () { return !!window.KC_LLM_BUILD; }, ADAPTERS: ADAPTERS, BATCH: BATCH, CATEGORY: CATEGORY,
    extractJson: extractJson, validateP1: validateP1, suggest: suggest, apply: apply, applySafe: applySafe, weakens: weakens, exportPrompts: exportPrompts,
    transportFor: transportFor, prompts: { P1_SYSTEM: P1_SYSTEM, p1User: p1User, P2: P2_TEMPLATE, P3: P3_TEMPLATE }
  };
})();
