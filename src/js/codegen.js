/* 가명처리 실행 코드 생성 (Hospital sw flow 2.2 "원본 미수정 · 코드 추천")
 * plan(KC.deid.plan) → Python(pandas) · SQL(PostgreSQL / SQL Server / Oracle 뷰) · Regex 모듈 · 실행 패키지
 * 생성 코드는 원본을 읽기만 하고 결과를 새 파일·새 뷰로 만든다. 금지 구문은 selfCheck 가 거부한다. */
window.KC = window.KC || {};

KC.codegen = (function () {
  'use strict';
  const U = KC.util;
  const DIALECTS = { postgres: 'PostgreSQL 11+', mssql: 'SQL Server 2019+', oracle: 'Oracle 12.2+' };

  function approved(plan) { return plan.columns.filter(function (c) { return c.status === '승인'; }); }
  function pyStr(s) { return JSON.stringify(String(s)); }
  /** Windows 경로 → Python raw 문자열 (끝 역슬래시·따옴표가 있으면 일반 문자열) */
  function pyPath(p) { p = String(p); return /["\\]$/.test(p) || p.indexOf('"') >= 0 ? pyStr(p) : 'r"' + p + '"'; }
  function header(plan, opts, lang) {
    const c = lang === 'py' ? '# ' : '-- ';
    return [c + 'K-CURE 가명처리 ' + (lang === 'py' ? '스크립트' : '뷰') + ' — K-CURE 표준변환기 ' + KC.APP_VERSION + ' 자동 생성',
      c + '생성 ' + plan.created + ' · 규칙팩 deid_rules v' + plan.version + (plan.cancer ? ' · 암종 ' + plan.cancer : ''),
      c + '원본은 읽기만 합니다. 결과는 ' + (lang === 'py' ? '새 파일(OUTPUT)' : '새 뷰(deid)') + '로 만듭니다.',
      c + '승인 컬럼 ' + approved(plan).length + ' / 전체 ' + plan.columns.length + ' (미승인 컬럼은 결과에서 제외)'];
  }

  /* ---------------- Python ---------------- */
  function python(plan, opts) {
    const R = KC.deid.rules();
    const cols = approved(plan);
    const pid = opts.patientCol || plan.patientCol || '';
    const L = [];
    L.push('# -*- coding: utf-8 -*-');
    header(plan, opts, 'py').forEach(function (x) { L.push(x); });
    L.push('# 실행 전 확인: (1) INPUT·OUTPUT 경로  (2) 환경변수 KCURE_SALT(기관 비밀값 — 코드에 쓰지 않음)');
    L.push('import hashlib', 'import os', 'import re', 'import sys', 'from pathlib import Path', '', 'import pandas as pd', '');
    L.push('try:', '    sys.stdout.reconfigure(encoding="utf-8")  # cp949 콘솔에서도 한글 출력', 'except (AttributeError, ValueError):', '    pass', '');
    L.push('INPUT = Path(' + pyPath(opts.input || 'C:\\kcure\\in\\source.csv') + ')');
    L.push('OUTPUT = Path(' + pyPath(opts.output || 'C:\\kcure\\out\\source_deid.csv') + ')');
    L.push('LOG = OUTPUT.with_name(OUTPUT.stem + "_가명처리로그.csv")');
    L.push('PATIENT_COL = ' + pyStr(pid) + '  # 날짜 이동 기준(환자별 같은 이동량)');
    L.push('SALT = os.environ.get("KCURE_SALT", "")');
    L.push('EXPECTED = [' + plan.columns.map(function (c) { return pyStr(c.col); }).join(', ') + ']');
    L.push('', 'PII_PATTERNS = [');
    R.src.pii.forEach(function (p) { L.push('    (' + pyStr(p.type) + ', re.compile(' + pyStr(p.regex) + ')),  # ' + p.label); });
    L.push(']', 'PII_EXCEPTIONS = [' + R.exceptions.map(pyStr).join(', ') + ']', '');
    L.push(
      'DATE_RX = re.compile(r"^((?:19|20)\\d{2})[-./]?(\\d{1,2})[-./]?(\\d{1,2})$")',
      'NUM_RX = re.compile(r"^-?\\d+(\\.\\d+)?$")',
      '',
      '',
      'def read_table(path):',
      '    """CSV(UTF-8 → CP949 순서로 시도) 또는 XLSX를 문자열로 읽는다."""',
      '    if path.suffix.lower() in (".xlsx", ".xlsm"):',
      '        return pd.read_excel(path, dtype=str).fillna("")',
      '    for enc in ("utf-8-sig", "cp949"):',
      '        try:',
      '            return pd.read_csv(path, dtype=str, encoding=enc, keep_default_na=False)',
      '        except UnicodeDecodeError:',
      '            continue',
      '    raise SystemExit(f"인코딩을 알 수 없습니다: {path}")',
      '',
      '',
      'def norm(v):',
      '    return "" if v is None else str(v).strip()',
      '',
      '',
      'def sha(v):',
      '    return hashlib.sha256((SALT + "|" + v).encode("utf-8")).hexdigest()',
      '',
      '',
      'def hash_salt(v):',
      '    v = norm(v)',
      '    return sha(v)[:32] if v else ""',
      '',
      '',
      'def parse_date(v):',
      '    m = DATE_RX.match(norm(v))',
      '    if not m:',
      '        return None',
      '    try:',
      '        return pd.Timestamp(int(m[1]), int(m[2]), int(m[3]))',
      '    except ValueError:',
      '        return None',
      '',
      '',
      'def year_only(v):',
      '    d = parse_date(v)',
      '    if d is not None:',
      '        return str(d.year)',
      '    m = re.match(r"^((?:19|20)\\d{2})", norm(v))',
      '    return m[1] if m else ""',
      '',
      '',
      'def shift_days(pid, rng):',
      '    return int(sha(norm(pid))[:8], 16) % (2 * rng + 1) - rng',
      '',
      '',
      'def date_shift(v, pid, rng):',
      '    d = parse_date(v)',
      '    return "" if d is None else (d + pd.Timedelta(days=shift_days(pid, rng))).strftime("%Y-%m-%d")',
      '',
      '',
      'def to_interval(v, ref):',
      '    d, r = parse_date(v), parse_date(ref)',
      '    return "" if d is None or r is None else str((d - r).days)',
      '',
      '',
      'def to_num(v):',
      '    v = norm(v)',
      '    return float(v) if NUM_RX.match(v) else None',
      '',
      '',
      'def bin_value(v, width):',
      '    x = to_num(v)',
      '    if x is None:',
      '        return ""',
      '    lo = int(x // width * width)',
      '    return f"{lo}-{lo + width - 1}"',
      '',
      '',
      'def top_bottom(v, lower, upper):',
      '    x = to_num(v)',
      '    if x is None:',
      '        return norm(v)',
      '    if upper is not None and x >= upper:',
      '        return f"{upper}+"',
      '    if lower is not None and x <= lower:',
      '        return f"{lower}-"',
      '    return norm(v)',
      '',
      '',
      'def mask(v, keep):',
      '    v = norm(v)',
      '    return v[:keep] + "*" * max(len(v) - keep, 0)',
      '',
      '',
      'def group_rare(series, k):',
      '    s = series.map(norm)',
      '    counts = s.value_counts()',
      '    rare = set(counts[counts < k].index)',
      '    return s.map(lambda v: "기타" if v in rare else v)',
      '',
      '',
      'def regex_pii(v):',
      '    t = norm(v)',
      '    for typ, rx in PII_PATTERNS:',
      '        t = rx.sub(lambda m, typ=typ: m.group(0) if any(x in m.group(0) for x in PII_EXCEPTIONS) else f"[ANONYMIZED:{typ}]", t)',
      '    return t',
      '',
      '',
      'def main():',
      '    if not SALT:',
      '        raise SystemExit("환경변수 KCURE_SALT 를 설정하세요 (예: set KCURE_SALT=기관비밀값)")',
      '    if not INPUT.exists():',
      '        raise SystemExit(f"입력 파일이 없습니다: {INPUT}")',
      '    if OUTPUT.resolve() == INPUT.resolve():',
      '        raise SystemExit("OUTPUT 이 INPUT 과 같습니다 — 원본 덮어쓰기 금지")',
      '    src = read_table(INPUT)',
      '    missing = [c for c in EXPECTED if c not in src.columns]',
      '    if missing:',
      '        print("[경고] 입력에 없는 컬럼:", ", ".join(missing))',
      '    pids = src[PATIENT_COL] if PATIENT_COL in src.columns else pd.Series([""] * len(src), index=src.index)',
      '    out = pd.DataFrame(index=src.index)',
      '    log = []',
      '');
    cols.forEach(function (c) {
      const p = c.params || {}, q = pyStr(c.col);
      const t = c.technique;
      L.push('    # [' + c.ruleId + '] ' + c.col + (c.item ? ' (' + c.item.id + ' ' + c.item.name + ')' : '') + ' — ' + t + ': ' + c.reason);
      if (t === 'DELETE') { L.push('    log.append((' + q + ', "DELETE", ' + pyStr(c.ruleId) + ', 0))  # 결과에서 제외', ''); return; }
      L.push('    if ' + q + ' in src.columns:');
      const v = 'src[' + q + ']';
      let e;
      if (t === 'HASH_SALT') e = v + '.map(hash_salt)';
      else if (t === 'YEAR_ONLY') e = v + '.map(year_only)';
      else if (t === 'DATE_SHIFT') e = 'pd.Series([date_shift(a, b, ' + (+p.range || 30) + ') for a, b in zip(' + v + ', pids)], index=src.index)';
      else if (t === 'DATE_TO_INTERVAL') {
        e = p.ref ? 'pd.Series([to_interval(a, b) for a, b in zip(' + v + ', src[' + pyStr(p.ref) + '] if ' + pyStr(p.ref) + ' in src.columns else [""] * len(src))], index=src.index)'
          : 'pd.Series([date_shift(a, b, 30) for a, b in zip(' + v + ', pids)], index=src.index)  # 기준일 컬럼 미지정 → 날짜 이동으로 대체';
      } else if (t === 'BIN') e = v + '.map(lambda x: bin_value(x, ' + (+p.width || 5) + '))';
      else if (t === 'TOP_BOTTOM') e = v + '.map(lambda x: top_bottom(x, ' + (p.lower == null ? 'None' : +p.lower) + ', ' + (p.upper == null ? 'None' : +p.upper) + '))';
      else if (t === 'MASK') e = v + '.map(lambda x: mask(x, ' + (+p.keep || 1) + '))';
      else if (t === 'GROUP_RARE') e = 'group_rare(' + v + ', ' + (+p.k || 5) + ')';
      else if (t === 'REGEX_PII') e = v + '.map(regex_pii)';
      else e = v + '.map(norm)';
      L.push('        out[' + q + '] = ' + e);
      L.push('        log.append((' + q + ', ' + pyStr(t) + ', ' + pyStr(c.ruleId) + ', int((out[' + q + '] != src[' + q + '].map(norm)).sum())))', '');
    });
    const skipped = plan.columns.filter(function (c) { return c.status !== '승인'; }).map(function (c) { return c.col; });
    L.push('    skipped = [' + skipped.map(pyStr).join(', ') + ']  # 미승인 → 결과에서 제외');
    L.push(
      '    OUTPUT.parent.mkdir(parents=True, exist_ok=True)',
      '    tmp = OUTPUT.with_name(OUTPUT.name + ".tmp")  # OneDrive 등 동기화 폴더 잠금 대비: 임시 파일에 쓴 뒤 교체',
      '    out.to_csv(tmp, index=False, encoding="utf-8-sig")',
      '    os.replace(tmp, OUTPUT)',
      '    pd.DataFrame(log, columns=["컬럼", "기법", "규칙", "변경 행 수"]).to_csv(LOG, index=False, encoding="utf-8-sig")',
      '    print(f"완료: {len(out)}행 · {len(out.columns)}컬럼 → {OUTPUT}")',
      '    print(f"로그: {LOG}")',
      '    if skipped:',
      '        print("미승인으로 제외한 컬럼:", ", ".join(skipped))',
      '',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '');
    return L.join('\n');
  }

  /* ---------------- Regex 모듈 ---------------- */
  function regexModule() {
    const R = KC.deid.rules();
    return ['# -*- coding: utf-8 -*-',
      '# K-CURE 비정형 텍스트 PII 치환 모듈 — 규칙팩 deid_rules v' + R.src.version,
      '# 사용: python regex_pii.py 입력.txt 출력.txt   (UTF-8 → 실패 시 CP949로 읽고, UTF-8로 저장. 입력 파일은 바꾸지 않음)',
      'import re', 'import sys', 'from pathlib import Path', '',
      'PII_PATTERNS = ['].concat(R.src.pii.map(function (p) { return '    (' + pyStr(p.type) + ', re.compile(' + pyStr(p.regex) + ')),  # ' + p.label + ' (오탐 위험 ' + p.risk + ')'; }), [
      ']', 'PII_EXCEPTIONS = [' + R.exceptions.map(pyStr).join(', ') + ']', '', '',
      'def anonymize(text):',
      '    counts = {}',
      '    for typ, rx in PII_PATTERNS:',
      '        def rep(m, typ=typ):',
      '            if any(x in m.group(0) for x in PII_EXCEPTIONS):',
      '                return m.group(0)',
      '            counts[typ] = counts.get(typ, 0) + 1',
      '            return f"[ANONYMIZED:{typ}]"',
      '        text = rx.sub(rep, text)',
      '    return text, counts', '', '',
      'def main():',
      '    try:',
      '        sys.stdout.reconfigure(encoding="utf-8")',
      '    except (AttributeError, ValueError):',
      '        pass',
      '    if len(sys.argv) != 3:',
      '        raise SystemExit("사용법: python regex_pii.py 입력.txt 출력.txt")',
      '    src, dst = Path(sys.argv[1]), Path(sys.argv[2])',
      '    if dst.resolve() == src.resolve():',
      '        raise SystemExit("출력이 입력과 같습니다 — 원본 덮어쓰기 금지")',
      '    try:',
      '        text = src.read_text(encoding="utf-8-sig")',
      '    except UnicodeDecodeError:',
      '        text = src.read_text(encoding="cp949")',
      '    out, counts = anonymize(text)',
      '    dst.write_text(out, encoding="utf-8")',
      '    print("치환:", counts or "없음", "→", dst)', '', '',
      'if __name__ == "__main__":', '    main()', '']).join('\n');
  }

  /* ---------------- SQL ---------------- */
  function sqlDialect(d) {
    const ms = d === 'mssql', ora = d === 'oracle';
    const D = {
      q: function (c) { return ms ? '[' + String(c).replace(/]/g, ']]') + ']' : '"' + String(c).replace(/"/g, '""') + '"'; },
      lit: function (s) { return (ms ? 'N' : '') + "'" + String(s).replace(/'/g, "''") + "'"; },
      cat: function (a) { return ms ? 'CONCAT(' + a.join(', ') + ')' : a.join(' || '); },
      str: function (x) { return ms ? 'LTRIM(RTRIM(CAST(' + x + ' AS NVARCHAR(4000))))' : ora ? 'TRIM(TO_CHAR(' + x + '))' : 'TRIM(CAST(' + x + ' AS TEXT))'; },
      salt: ora ? '(SELECT salt FROM DEID_KCURE_SALT)' : '(SELECT salt FROM deid.kcure_salt)',
      view: function (t) { return ora ? D.q('DEID_' + t) : 'deid.' + D.q(t); }
    };
    D.sha = function (x) {
      if (ms) return "LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', CAST(" + x + " COLLATE Latin1_General_100_CI_AS_SC_UTF8 AS VARCHAR(8000))), 2))";
      if (ora) return "LOWER(RAWTOHEX(STANDARD_HASH(" + x + ", 'SHA256')))";
      return "ENCODE(SHA256(CONVERT_TO(" + x + ", 'UTF8')), 'hex')";
    };
    D.left = function (x, n) { return ms ? 'LEFT(' + x + ', ' + n + ')' : ora ? 'SUBSTR(' + x + ', 1, ' + n + ')' : 'SUBSTRING(' + x + ' FROM 1 FOR ' + n + ')'; };
    D.hashKey = function (col) { return D.left(D.sha(D.cat([D.salt, "'|'", D.str(D.q(col))])), 32); };
    D.date = function (col) {
      if (ms) return 'TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(' + D.str(D.q(col)) + ", '-', ''), '.', ''), '/', ''), 112)";
      if (ora) return "TO_DATE(REGEXP_REPLACE(" + D.str(D.q(col)) + ", '[^0-9]', '') DEFAULT NULL ON CONVERSION ERROR, 'YYYYMMDD')";
      return 'deid.kcure_to_date(' + D.str(D.q(col)) + ')';
    };
    D.fmt = function (x) { return ms ? 'CONVERT(VARCHAR(10), ' + x + ', 23)' : "TO_CHAR(" + x + ", 'YYYY-MM-DD')"; };
    D.offset = function (pidCol, rng) {
      const hex8 = D.left(D.sha(D.cat([D.salt, "'|'", D.str(D.q(pidCol))])), 8), m = 2 * rng + 1;
      if (ms) return '(CONVERT(BIGINT, CONVERT(VARBINARY(4), ' + hex8 + ', 2)) % ' + m + ' - ' + rng + ')';
      if (ora) return "(MOD(TO_NUMBER(" + hex8 + ", 'XXXXXXXX'), " + m + ') - ' + rng + ')';
      return "((('x' || " + hex8 + ')::BIT(32)::BIGINT % ' + m + ') - ' + rng + ')';
    };
    D.addDays = function (d, n) { return ms ? 'DATEADD(DAY, ' + n + ', ' + d + ')' : '(' + d + ' + ' + n + ')'; };
    D.diff = function (a, b) { return ms ? 'DATEDIFF(DAY, ' + b + ', ' + a + ')' : '(' + a + ' - ' + b + ')'; };
    D.num = function (col) {
      const s = D.str(D.q(col));
      if (ms) return 'TRY_CAST(' + s + ' AS FLOAT)';
      if (ora) return 'TO_NUMBER(' + s + ' DEFAULT NULL ON CONVERSION ERROR)';
      return "(CASE WHEN " + s + " ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(" + s + ' AS NUMERIC) END)';
    };
    D.toText = function (x) { return ms ? 'CAST(' + x + ' AS NVARCHAR(40))' : ora ? 'TO_CHAR(' + x + ')' : 'CAST(' + x + ' AS TEXT)'; };
    D.len = function (x) { return ms ? 'LEN(' + x + ')' : 'LENGTH(' + x + ')'; };
    return D;
  }

  function sql(plan, opts) {
    const d = opts.dialect || 'postgres';
    const D = sqlDialect(d), ms = d === 'mssql', ora = d === 'oracle';
    const table = opts.table || 'source_table';
    const pid = opts.patientCol || plan.patientCol || '';
    const L = header(plan, opts, 'sql');
    L.push('-- 방언: ' + DIALECTS[d] + ' · 원천 테이블: ' + table);
    L.push('-- 날짜 컬럼은 YYYYMMDD(구분자 - . / 허용) 문자열로 가정합니다. 변환할 수 없는 값은 NULL입니다.');
    L.push('-- 솔트는 코드에 쓰지 않습니다. 아래 솔트 테이블에 DBA가 직접 한 행을 넣으세요(Python 스크립트와 같은 값이면 가명키도 같습니다).', '');
    if (ms) {
      L.push("IF SCHEMA_ID('deid') IS NULL EXEC('CREATE SCHEMA deid');", 'GO',
        "IF OBJECT_ID('deid.kcure_salt') IS NULL CREATE TABLE deid.kcure_salt (salt NVARCHAR(200) NOT NULL);", 'GO',
        "-- INSERT INTO deid.kcure_salt VALUES (N'기관비밀값');  ← DBA가 직접 실행", '');
    } else if (ora) {
      L.push('-- 솔트 테이블 (최초 1회): CREATE TABLE DEID_KCURE_SALT (salt VARCHAR2(200) NOT NULL);',
        "-- INSERT INTO DEID_KCURE_SALT VALUES ('기관비밀값');  ← DBA가 직접 실행", '');
    } else {
      L.push('CREATE SCHEMA IF NOT EXISTS deid;', 'CREATE TABLE IF NOT EXISTS deid.kcure_salt (salt TEXT NOT NULL);',
        "-- INSERT INTO deid.kcure_salt VALUES ('기관비밀값');  ← DBA가 직접 실행", '',
        'CREATE OR REPLACE FUNCTION deid.kcure_to_date(v TEXT) RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$',
        'DECLARE s TEXT := REGEXP_REPLACE(COALESCE(v, \'\'), \'[^0-9]\', \'\', \'g\');',
        'BEGIN',
        "  IF s !~ '^[0-9]{8}$' THEN RETURN NULL; END IF;",
        "  RETURN TO_DATE(s, 'YYYYMMDD');",
        'EXCEPTION WHEN OTHERS THEN RETURN NULL;',
        'END $$;', '');
    }
    const sel = [], notes = [];
    approved(plan).forEach(function (c) {
      const p = c.params || {}, q = D.q(c.col), s = D.str(q), t = c.technique;
      let e = null;
      if (t === 'DELETE') { notes.push('-- 삭제: ' + c.col + ' [' + c.ruleId + '] ' + c.reason); return; }
      if (t === 'HASH_SALT') e = D.hashKey(c.col);
      else if (t === 'YEAR_ONLY') e = D.left(ms ? "REPLACE(REPLACE(" + s + ", '-', ''), '.', '')" : "REGEXP_REPLACE(" + s + ", '[^0-9]', ''" + (ora ? '' : ", 'g'") + ')', 4);
      else if (t === 'DATE_SHIFT' || (t === 'DATE_TO_INTERVAL' && !p.ref)) e = pid ? D.fmt(D.addDays(D.date(c.col), D.offset(pid, +p.range || 30))) : null;
      else if (t === 'DATE_TO_INTERVAL') e = D.toText(D.diff(D.date(c.col), D.date(p.ref)));
      else if (t === 'BIN') { const w = +p.width || 5, lo = 'CAST(FLOOR(' + D.num(c.col) + ' / ' + w + ') * ' + w + ' AS INT)'; e = 'CASE WHEN ' + D.num(c.col) + ' IS NULL THEN NULL ELSE ' + D.cat([D.toText(lo), "'-'", D.toText(lo + ' + ' + (w - 1))]) + ' END'; }
      else if (t === 'TOP_BOTTOM') {
        const parts = [];
        if (p.upper != null) parts.push('WHEN ' + D.num(c.col) + ' >= ' + (+p.upper) + ' THEN ' + D.lit(p.upper + '+'));
        if (p.lower != null) parts.push('WHEN ' + D.num(c.col) + ' <= ' + (+p.lower) + ' THEN ' + D.lit(p.lower + '-'));
        e = parts.length ? 'CASE ' + parts.join(' ') + ' ELSE ' + s + ' END' : s;
      } else if (t === 'MASK') {
        const k = +p.keep || 1;
        e = ms ? 'LEFT(' + s + ', ' + k + ") + REPLICATE('*', IIF(LEN(" + s + ') > ' + k + ', LEN(' + s + ') - ' + k + ', 0))' : 'RPAD(' + D.left(s, k) + ', ' + D.len(s) + ", '*')";
      } else if (t === 'GROUP_RARE') e = 'CASE WHEN COUNT(*) OVER (PARTITION BY ' + q + ') < ' + (+p.k || 5) + ' THEN ' + D.lit('기타') + ' ELSE ' + s + ' END';
      else if (t === 'REGEX_PII') {
        if (d === 'postgres') {
          e = s;
          KC.deid.rules().src.pii.forEach(function (pi) { e = 'REGEXP_REPLACE(' + e + ", '" + pi.regex.replace(/'/g, "''") + "', '[ANONYMIZED:" + pi.type + "]', 'g')"; });
        } else e = null;
      } else e = q;
      if (e === null) {
        sel.push('  NULL AS ' + q + '  -- [' + c.ruleId + '] ' + (t === 'REGEX_PII' ? '자유문: 이 방언은 정규식 치환을 지원하지 않음 → deid.py 로 처리' : '환자 식별 컬럼이 없어 날짜 이동 불가 → deid.py 로 처리'));
      } else sel.push('  ' + e + ' AS ' + q + '  -- [' + c.ruleId + '] ' + t);
    });
    plan.columns.filter(function (c) { return c.status !== '승인'; }).forEach(function (c) { notes.push('-- 미승인 제외: ' + c.col); });
    L.push.apply(L, notes);
    L.push((ms ? 'CREATE OR ALTER VIEW ' : 'CREATE OR REPLACE VIEW ') + D.view(table) + ' AS', 'SELECT');
    L.push(sel.length ? sel.map(function (x, i) {
      // 쉼표는 주석 앞에 둔다
      const j = x.indexOf('  -- ');
      return i < sel.length - 1 ? x.slice(0, j) + ',' + x.slice(j) : x;
    }).join('\n') : '  NULL AS no_columns');
    L.push('FROM ' + table.split('.').map(D.q).join('.') + ';');
    if (ms) L.push('GO');
    L.push('');
    return L.join('\n');
  }

  /* ---------------- 자체 검사 ---------------- */
  /** 주석을 뺀 코드에서 금지 구문을 찾는다 → [{lang, pattern, line}] */
  function selfCheck(code, lang) {
    const f = KC.deid.rules().src.forbidden[lang] || [];
    const lines = code.split('\n');
    const bad = [];
    lines.forEach(function (ln, i) {
      const body = lang === 'sql' ? ln.replace(/--.*$/, '') : ln.replace(/#.*$/, '');
      f.forEach(function (p) { if (new RegExp(p, 'i').test(body)) bad.push({ lang: lang, pattern: p, line: i + 1, text: ln.trim().slice(0, 120) }); });
    });
    return bad;
  }

  /* ---------------- 패키지 ---------------- */
  function runBat() {
    return ['@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"', 'rem K-CURE 가명처리 실행 (Windows). 원본 파일은 바꾸지 않습니다.',
      'if not exist venv\\Scripts\\python.exe (',
      '  echo [안내] 가상환경을 만듭니다...',
      '  py -3 -m venv venv 2>nul || python -m venv venv',
      '  if exist wheels (',
      '    venv\\Scripts\\python.exe -m pip install --no-index --find-links wheels -r requirements.txt',
      '  ) else (',
      '    venv\\Scripts\\python.exe -m pip install -r requirements.txt',
      '  )',
      ')',
      'if "%KCURE_SALT%"=="" (',
      '  echo [오류] KCURE_SALT 환경변수를 먼저 설정하세요. 예: set KCURE_SALT=기관비밀값',
      '  pause',
      '  exit /b 1',
      ')',
      'venv\\Scripts\\python.exe deid.py',
      'pause', ''].join('\r\n');
  }

  function readme(plan, opts, check) {
    const T = KC.deid.techniques();
    const rows = plan.columns.map(function (c) {
      return '| ' + [c.col, c.item ? c.item.id + ' ' + c.item.name : '(항목 미인식)', (T[c.technique] || {}).label + ' `' + c.technique + '`', c.ruleId, c.reason, c.confidence, c.status].join(' | ') + ' |';
    });
    return ['# K-CURE 가명처리 코드 패키지', '',
      '- 생성: ' + plan.created + ' · K-CURE 표준변환기 ' + KC.APP_VERSION + ' · 규칙팩 deid_rules v' + plan.version,
      '- 암종: ' + (plan.cancer || '미지정') + ' · 컬럼 ' + plan.columns.length + '개(승인 ' + approved(plan).length + ') · 분석한 샘플 ' + plan.sampleRows + '행',
      '- 자체 검사(원본 수정 구문): ' + (check.length ? '**실패 ' + check.length + '건**' : '통과'), '',
      '> 이 코드는 원본 데이터를 **읽기만** 합니다. Python은 결과를 새 파일(OUTPUT)에, SQL은 새 뷰(deid)에 만듭니다.',
      '> 실행 전 담당자가 코드와 아래 표를 검토하세요(Human-in-the-loop). 미승인 컬럼은 결과에서 빠집니다.', '',
      '## 1. Python으로 실행 (Windows)', '',
      '1. `deid.py`의 `INPUT`·`OUTPUT` 경로를 확인합니다(현재 `' + (opts.input || 'C:\\kcure\\in\\source.csv') + '` → `' + (opts.output || 'C:\\kcure\\out\\source_deid.csv') + '`).',
      '2. 명령 프롬프트에서 솔트를 설정합니다: `set KCURE_SALT=기관비밀값` (코드·파일에 쓰지 마세요)',
      '3. `run.bat`을 실행합니다. 처음 실행하면 `venv` 가상환경을 만들고 `requirements.txt`를 설치합니다.',
      '   - 인터넷이 없는 병원망: 외부 PC에서 `pip download -r requirements.txt -d wheels`로 받은 `wheels` 폴더를 함께 복사하면 그것으로 설치합니다.',
      '   - PowerShell 실행 정책 때문에 activate가 막혀도 `run.bat`은 `venv\\Scripts\\python.exe`를 직접 호출하므로 영향이 없습니다.',
      '4. 결과: `OUTPUT` 파일(UTF-8 BOM CSV)과 `_가명처리로그.csv`(컬럼별 기법·변경 행 수)', '',
      '## 2. SQL로 실행 (선택)', '',
      '- `deid_' + (opts.dialect || 'postgres') + '.sql`은 원천 테이블 `' + (opts.table || 'source_table') + '`을 읽어 `deid` 스키마에 뷰를 만듭니다.',
      '- 솔트 테이블(`deid.kcure_salt`)에 DBA가 한 행을 넣어야 합니다. Python과 같은 솔트를 쓰면 가명키·날짜 이동량이 같습니다.',
      '- 자유문 정규식 치환은 PostgreSQL에서만 SQL로 생성합니다. SQL Server·Oracle은 `deid.py`로 처리하세요.', '',
      '## 3. 비정형 텍스트', '', '- `python regex_pii.py 입력.txt 출력.txt` — 주민번호·전화·환자번호·날짜·이름·의료인·주소·기관명을 `[ANONYMIZED:유형]`으로 바꿉니다.',
      '- 이름·기관명 패턴은 오탐 위험이 높으니 결과를 반드시 검토하세요.', '',
      '## 4. 컬럼별 가명처리', '', '| 원천 컬럼 | 표준항목 | 기법 | 규칙 | 근거 | 신뢰도 | 상태 |', '|---|---|---|---|---|---|---|'].concat(rows, ['',
      '## 5. 유의사항', '',
      '- 가명처리 수준은 「가명정보 처리 가이드라인」과 기관 심의 기준에 따라 담당자가 최종 판단합니다. 이 코드는 추천입니다.',
      '- 날짜 이동량은 환자별로 같아서 같은 환자 안의 날짜 간격은 보존됩니다. 다른 기관 데이터와 결합하려면 같은 솔트를 써야 합니다.',
      '- `감사이력.jsonl`에 생성 시점·규칙·승인 상태·코드 해시가 남습니다. 실행 기록과 함께 보관하세요.', '']).join('\n');
  }

  /** plan + opts → {files:[{path, content, mime}], check:[...] } */
  function buildPackage(plan, opts) {
    opts = Object.assign({ dialect: 'postgres' }, opts || {});
    const py = python(plan, opts), sq = sql(plan, opts), rx = regexModule();
    const check = selfCheck(py, 'python').concat(selfCheck(sq, 'sql'), selfCheck(rx, 'python'));
    if (check.length) throw new Error('생성 코드에 원본 수정 구문이 있습니다: ' + check.map(function (c) { return c.lang + ' ' + c.line + '행 ' + c.text; }).join(' / '));
    const summary = {
      tool: 'K-CURE 표준변환기 ' + KC.APP_VERSION, rulepack: 'deid_rules v' + plan.version, created: plan.created, cancer: plan.cancer,
      options: { table: opts.table || 'source_table', dialect: opts.dialect, input: opts.input || '', output: opts.output || '', patientCol: opts.patientCol || plan.patientCol },
      columns: plan.columns.map(function (c) {
        return { col: c.col, itemId: c.item ? c.item.id : null, itemName: c.item ? c.item.name : null, pattern: c.sample.pattern, technique: c.technique, params: c.params,
          ruleId: c.ruleId, reason: c.reason, confidence: c.confidence, status: c.status };
      })
    };
    const hashes = { 'deid.py': KC.sha256(py), ['deid_' + opts.dialect + '.sql']: KC.sha256(sq), 'regex_pii.py': KC.sha256(rx) };
    const audit = plan.columns.map(function (c) {
      return JSON.stringify({ ts: plan.created, action: 'codegen', col: c.col, itemId: c.item ? c.item.id : null, technique: c.technique, ruleId: c.ruleId,
        status: c.status, by: opts.operator || '', rulepack: plan.version });
    }).concat([JSON.stringify({ ts: U.nowIso(), action: 'package', files: hashes, by: opts.operator || '', rulepack: plan.version })]).join('\n') + '\n';
    const files = [
      { path: 'deid.py', content: py, mime: 'text/x-python' },
      { path: 'deid_' + opts.dialect + '.sql', content: sq, mime: 'application/sql' },
      { path: 'regex_pii.py', content: rx, mime: 'text/x-python' },
      { path: 'requirements.txt', content: 'pandas>=2.0\nopenpyxl>=3.1\n', mime: 'text/plain' },
      { path: 'run.bat', content: runBat(), mime: 'text/plain' },
      { path: 'README_실행안내.md', content: readme(plan, opts, check), mime: 'text/markdown' },
      { path: '매핑_가명처리_요약.json', content: JSON.stringify(summary, null, 2), mime: 'application/json' },
      { path: '감사이력.jsonl', content: audit, mime: 'application/x-ndjson' }
    ];
    return { files: files, check: check, hashes: hashes };
  }

  return { DIALECTS: DIALECTS, python: python, sql: sql, regexModule: regexModule, selfCheck: selfCheck, buildPackage: buildPackage, approved: approved };
})();
