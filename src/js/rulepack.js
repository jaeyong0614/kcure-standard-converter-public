/* 중앙 규칙팩 (Hospital sw flow 6.2 Central Governance)
 * 가명처리 규칙(deid_rules)을 버전·SHA-256 과 함께 내보내고, 중앙에서 받은 규칙팩을 검증·비교한 뒤 교체한다.
 * 교체는 현재 창에서만 유지된다(배포본을 다시 빌드하면 내장 규칙으로 돌아감). */
window.KC = window.KC || {};

KC.rulepack = (function () {
  'use strict';

  /** 키 순서를 고정한 직렬화 (해시 재현용) */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function digest(rules) { return KC.sha256(canon(rules)); }

  function exportPack(rules, by) {
    rules = rules || window.KCURE_DEID;
    return { kind: 'kcure-rulepack', version: rules.version, created: KC.util.nowIso(), by: by || '', sha256: digest(rules), deid_rules: rules };
  }

  /** 규칙팩 검증 → {ok, errors[], pack} */
  function validate(pack) {
    const errors = [];
    if (!pack || pack.kind !== 'kcure-rulepack') errors.push('kind 가 kcure-rulepack 이 아닙니다');
    const r = pack && pack.deid_rules;
    if (!r || !Array.isArray(r.rules) || !r.techniques || !Array.isArray(r.pii)) errors.push('deid_rules 구조(rules·techniques·pii)가 없습니다');
    else {
      if (pack.sha256 !== digest(r)) errors.push('SHA-256 이 내용과 다릅니다(변조 또는 손상)');
      r.rules.forEach(function (x) {
        if (!x.id || !r.techniques[x.technique]) errors.push('규칙 ' + (x.id || '?') + ': 알 수 없는 기법 ' + x.technique);
        try { if (x.when && x.when.name) new RegExp(x.when.name, 'i'); } catch (e) { errors.push('규칙 ' + x.id + ': 정규식 오류'); }
      });
      r.pii.forEach(function (p) { try { new RegExp(p.regex, 'g'); } catch (e) { errors.push('PII ' + p.type + ': 정규식 오류'); } });
      if (!r.rules.length || Object.keys(r.rules[r.rules.length - 1].when || {}).length) errors.push('마지막 규칙은 조건 없는 기본 규칙이어야 합니다');
    }
    return { ok: !errors.length, errors: errors, pack: pack };
  }

  /** 현재 규칙과 비교 → {added, removed, changed, piiChanged, from, to} */
  function diff(cur, next) {
    const a = {}, b = {};
    cur.rules.forEach(function (r) { a[r.id] = canon(r); });
    next.rules.forEach(function (r) { b[r.id] = canon(r); });
    return {
      from: cur.version, to: next.version,
      added: Object.keys(b).filter(function (k) { return !(k in a); }),
      removed: Object.keys(a).filter(function (k) { return !(k in b); }),
      changed: Object.keys(b).filter(function (k) { return k in a && a[k] !== b[k]; }),
      piiChanged: canon(cur.pii) !== canon(next.pii)
    };
  }

  function apply(pack) {
    const v = validate(pack);
    if (!v.ok) throw new Error(v.errors.join(' / '));
    window.KCURE_DEID = pack.deid_rules;
    KC.deid.reload();
    return pack.deid_rules.version;
  }

  return { canon: canon, digest: digest, exportPack: exportPack, validate: validate, diff: diff, apply: apply };
})();
