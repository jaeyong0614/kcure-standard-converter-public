/* 변환 코드 생성기: 컬럼명 목록 → 표준항목 매핑 계획 → 병원 내부에서 실행할 Python 변환 패키지
 * 이 SW는 데이터를 변환하지 않는다. 컬럼명만 받아 "어떻게 매핑해 변환할지"를 코드로 만들고, 실행은 담당자가 한다. */
window.KC = window.KC || {};

KC.convgen = (function () {
  'use strict';
  const U = KC.util;

  /** 컬럼별 변환 방식 */
  const METHODS = {
    patient_key: { label: '환자키(가명키)', desc: '솔트+SHA-256 가명키로 바꿔 모든 산출물의 환자 기준으로 사용' },
    hash: { label: '가명키', desc: '다른 식별번호 — 솔트+SHA-256 가명키' },
    date: { label: '날짜', desc: 'YYYYMMDD·YYYY-MM-DD·엑셀 일련번호 → YYYY-MM-DD(시각이 있으면 ISO 일시)' },
    year: { label: '연도만', desc: '생년월일 등 — 연도(YYYY)만 남김' },
    number: { label: '수치', desc: '쉼표 제거 후 숫자, 범위 밖 값은 로그' },
    code: { label: '코드', desc: '허용값 코드표로 코드·명칭 정규화, 목록 밖 값은 로그' },
    flag: { label: '여부(Y/N/U)', desc: '예/아니오/있음/없음/1/0 → Y·N·U' },
    text: { label: '텍스트', desc: '앞뒤 공백 제거 후 그대로' },
    drop: { label: '제외(직접식별자)', desc: '이름·연락처·주소 등 — 산출물에 넣지 않음' },
    skip: { label: '제외(미매핑)', desc: '표준항목이 없어 변환하지 않음' }
  };
  const ORDER = ['patient_key', 'hash', 'date', 'year', 'number', 'code', 'flag', 'text', 'drop', 'skip'];

  // 환자 식별번호: 명세에서 Patient.identifier 로 묶인 항목 중 코드·날짜가 아닌 것 (예: survival_status 는 명세상 같은 경로지만 코드 항목)
  function isPatientId(it) {
    return it.core.path === 'Patient.identifier' && it.role === '식별·인구학' && it.type !== 'DATE' && it.type !== 'CODE' && !(it.codes && it.codes.length);
  }
  function isBirth(it) { return it.core.path === 'Patient.birthDate' || /생년월일|dt_birth/i.test(it.name); }

  /** 표준항목 → 기본 변환 방식 */
  function autoMethod(it) {
    if (!it) return 'skip';
    if (KC.pipeline.isDirectId(it)) return 'drop';
    if (isPatientId(it)) return 'hash';
    if (isBirth(it)) return 'year';
    if (KC.values.isFlagItem(it)) return 'flag';
    if (it.type === 'DATE') return 'date';
    if (it.type === 'INTEGER' || it.type === 'NUMERIC') return 'number';
    if (it.type === 'CODE' || (it.codes && it.codes.length)) return 'code';
    if (/일자|일시|날짜|^dt_|date/i.test(it.name)) return 'date';
    return 'text';
  }

  /**
   * 컬럼명 목록 → 계획
   * @param cols [{col, item, method?, samples?}]  (KC.meta.entriesFromColumns 결과 + 샘플값)
   */
  /** 자료형이 문자열(VARCHAR)인데 샘플이 모두 숫자·날짜이면 수치·날짜로 본다 (예: 키·몸무게가 VARCHAR 로 정의된 경우) */
  function refineBySamples(method, samples) {
    if (method !== 'text' || !samples || !samples.length) return method;
    if (samples.every(function (s) { return KC.values.parseNumber(s) != null; }) && !samples.every(function (s) { return /^\d{8}$/.test(s); })) return 'number';
    if (samples.every(function (s) { return KC.values.parseDate(s) && !/^\d{1,4}$/.test(s); })) return 'date';
    return method;
  }

  function plan(cols, cancer) {
    const columns = cols.map(function (e) {
      const samples = e.samples || [];
      return { col: e.col, item: e.item || null, mappedBy: e.method || (e.item ? '자동' : '미매핑'), method: refineBySamples(autoMethod(e.item), samples), samples: samples };
    });
    // 환자키: 우선순위 이름(병원번호 등) → 첫 번째 환자 식별번호 컬럼
    const pri = ['환자등록번호', 'no_patient', '병원번호', '환자번호', '환자ID'];
    const ids = columns.filter(function (c) { return c.item && isPatientId(c.item); });
    ids.sort(function (a, b) {
      const ia = pri.indexOf(a.item.name), ib = pri.indexOf(b.item.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const p = { cancer: cancer || '', created: U.nowIso(), columns: columns, patientCol: ids.length ? ids[0].col : '' };
    if (ids.length) ids[0].method = 'patient_key';
    return p;
  }

  function setItem(p, i, item) {
    const c = p.columns[i];
    c.item = item || null;
    c.mappedBy = item ? '수동' : '미매핑';
    c.method = refineBySamples(autoMethod(item), c.samples);
    if (c.method === 'hash' && !p.patientCol) { c.method = 'patient_key'; p.patientCol = c.col; }
    if (p.patientCol === c.col && c.method !== 'patient_key') p.patientCol = '';
  }

  function setMethod(p, i, m) {
    const c = p.columns[i];
    if (m === 'patient_key') {
      p.columns.forEach(function (x) { if (x.method === 'patient_key') x.method = x.item ? 'hash' : 'skip'; });
      p.patientCol = c.col;
    } else if (p.patientCol === c.col) p.patientCol = '';
    c.method = m;
  }

  /* ---------------- 매핑 → Python 리터럴 ---------------- */
  function py(v) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'None';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(py).join(', ') + ']';
    return '{' + Object.keys(v).map(function (k) { return JSON.stringify(k) + ': ' + py(v[k]); }).join(', ') + '}';
  }
  function pyPath(p) { p = String(p); return /["\\]$/.test(p) || p.indexOf('"') >= 0 ? JSON.stringify(p) : 'r"' + p + '"'; }

  /** 계획의 컬럼 1개 → 변환 스크립트의 매핑 레코드 */
  function record(c) {
    const it = c.item;
    const r = { col: c.col, method: c.method };
    if (!it) return r;
    r.item_id = it.id;
    r.name = it.name;
    r.type = it.type;
    if (it.unit) r.unit = it.unit;
    if (it.range) r.range = it.range;
    if (it.codes && it.codes.length) {
      r.codes = {};
      it.codes.forEach(function (x) { r.codes[String(x[0])] = String(x[1]); });
    }
    if (it.cdi && it.cdi.el) r.krcdi = { cls: it.cdi.cls, el: it.cdi.el, req: it.cdi.req || '', match: KC.match.label(it.cdi.match || '대응') };
    r.fhir = { profile: it.core.profile, path: it.core.path, judge: KC.match.label(it.core.judge) };
    if (it.omop && it.omop.table) {
      r.omop = { table: it.omop.table, field: it.omop.field, concept: it.omop.concept || '', date: it.omop.date || '', source: it.omop.source || '', vocab: it.omop.vocab || '', conf: it.omop.conf || '' };
    }
    if (it.argo && it.argo.key) r.argo = it.argo.key;
    return r;
  }

  /* ---------------- Python 본문 (정적 부분) ---------------- */
  const PY_BODY = String.raw`
TRUE_SET = {"y", "yes", "1", "예", "네", "true", "t", "있음", "유", "o", "+", "양성", "positive"}
FALSE_SET = {"n", "no", "0", "아니오", "아니요", "false", "f", "없음", "무", "x", "-", "음성", "negative"}
UNK_SET = {"u", "unk", "unknown", "99", "9", "미상", "알수없음", "알 수 없음", "m", "무응답", "nodata", "no data", "na", "n/a"}
DATE_RX = re.compile(r"^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$")
YMD_RX = re.compile(r"^(\d{4})(\d{2})(\d{2})$")
YM_RX = re.compile(r"^(\d{4})[-./]?(\d{2})$")
NUM_RX = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)$")
OUTPUT_NAMES = ["01_표준화.csv", "02_KRCDI_long.csv", "03_OMOP_staging.csv", "04_FHIR_staging.csv", "변환로그.csv"]


def norm(v):
    return "" if v is None else str(v).strip()


def sha(v):
    return hashlib.sha256((SALT + "|" + v).encode("utf-8")).hexdigest()[:32]


def valid_ymd(y, m, d):
    try:
        date(y, m, d)
    except ValueError:
        return False
    return 1800 <= y <= 2100


def parse_date(s):
    """날짜 문자열 → 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM:SS' / 'YYYY-MM' / 'YYYY' 또는 None"""
    m = YMD_RX.match(s)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}" if valid_ymd(int(m[1]), int(m[2]), int(m[3])) else None
    m = DATE_RX.match(s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
        if not valid_ymd(y, mo, d):
            return None
        out = f"{y:04d}-{mo:02d}-{d:02d}"
        if m[4] is not None:
            out += f"T{int(m[4]):02d}:{m[5]}:{m[6] or '00'}"
        return out
    m = YM_RX.match(s)
    if m and 1 <= int(m[2]) <= 12:
        return f"{m[1]}-{m[2]}"
    if re.match(r"^\d{4}$", s) and 1800 <= int(s) <= 2100:
        return s
    if re.match(r"^\d{5}(\.\d+)?$", s) and 20000 < float(s) < 80000:  # 엑셀 날짜 일련번호
        return (date(1899, 12, 30) + timedelta(days=int(float(s)))).isoformat()
    return None


def parse_number(s):
    t = s.replace(",", "")
    return float(t) if NUM_RX.match(t) else None


def match_code(m, s):
    codes = m.get("codes") or {}
    k = s.lower()
    for code, label in codes.items():
        if code.lower() == k or label.lower() == k:
            return code, label
    return None


def convert(m, raw):
    """(표준값, 상태) — 상태: ok / empty / invalid / not_allowed / out_of_range
    날짜·연도·수치·여부로 해석할 수 없는 값은 표준값을 비우고(invalid) 변환로그에 건수로 남긴다."""
    s = norm(raw)
    if s == "":
        return "", "empty"
    how = m["method"]
    if how in ("patient_key", "hash"):
        return sha(s), "ok"
    if how == "date":
        d = parse_date(s)
        return (d, "ok") if d else ("", "invalid")
    if how == "year":
        d = parse_date(s)
        if d:
            return d[:4], "ok"
        y = re.match(r"^((?:18|19|20)\d{2})", s)
        return (y[1], "ok") if y else ("", "invalid")
    if how == "number":
        n = parse_number(s)
        if n is None:
            return "", "invalid"
        txt = str(int(n)) if n == int(n) and "." not in s else str(n)
        rng = m.get("range")
        return txt, ("out_of_range" if rng and not (rng[0] <= n <= rng[1]) else "ok")
    if how == "flag":
        c = match_code(m, s)
        if c:
            return c[0], "ok"
        k = s.lower()
        if k in TRUE_SET:
            return "Y", "ok"
        if k in FALSE_SET:
            return "N", "ok"
        if k in UNK_SET:
            return "U", "ok"
        return "", "invalid"
    if how == "code":
        c = match_code(m, s)
        if c:
            return c[0], "ok"
        return s, ("not_allowed" if m.get("codes") else "ok")
    return s, "ok"


def code_label(m, v):
    return (m.get("codes") or {}).get(v, "")


def detect_encoding(path):
    with open(path, "rb") as f:
        head = f.read(1 << 20)
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        if e.start < len(head) - 4:
            return "cp949"
    return "utf-8-sig"


def read_chunks(path):
    """CSV는 CHUNK_ROWS 행씩, XLSX는 한 번에 문자열로 읽는다. 원본은 읽기만 한다."""
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        yield pd.read_excel(path, dtype=str).fillna("")
        return
    sep = "\t" if path.suffix.lower() == ".tsv" else ","
    yield from pd.read_csv(path, dtype=str, encoding=detect_encoding(path), keep_default_na=False, sep=sep, chunksize=CHUNK_ROWS)


class Writer:
    """산출물 CSV: 임시 파일에 이어 쓰고 마지막에 교체(OneDrive 등 동기화 폴더 잠금 대비)."""

    def __init__(self, name, header):
        self.path = OUTDIR / name
        self.tmp = self.path.with_name(self.path.name + ".tmp")
        self.f = open(self.tmp, "w", encoding="utf-8-sig", newline="")
        self.w = csv.writer(self.f)
        self.w.writerow(header)
        self.n = 0

    def row(self, r):
        self.w.writerow(r)
        self.n += 1

    def close(self):
        self.f.close()
        os.replace(self.tmp, self.path)


def main():
    if INPUT.resolve() in [(OUTDIR / n).resolve() for n in OUTPUT_NAMES]:
        raise SystemExit("INPUT 이 산출물 파일과 같은 경로입니다 — 원본 덮어쓰기 금지. OUTDIR 을 바꾸세요.")
    if not INPUT.exists():
        raise SystemExit(f"입력 파일이 없습니다: {INPUT}")
    uses_key = any(m["method"] in ("patient_key", "hash") for m in MAPPING)
    if uses_key and not SALT:
        raise SystemExit("환경변수 KCURE_SALT 를 설정하세요 (예: set KCURE_SALT=기관비밀값) — 환자키·식별번호를 가명키로 바꿉니다.")
    OUTDIR.mkdir(parents=True, exist_ok=True)
    active = [m for m in MAPPING if m["method"] not in ("drop", "skip")]
    pk = next((m for m in MAPPING if m["method"] == "patient_key"), None)

    wide_cols = [m for m in active if m["method"] != "patient_key"]
    wide = Writer("01_표준화.csv", ["환자키", "원천행"] + [f'{m["name"]} [{m["item_id"]}]' for m in wide_cols])
    cdi = Writer("02_KRCDI_long.csv", ["환자키", "원천행", "KRCDI_분류", "KRCDI_항목", "필수여부", "매칭유형", "값", "값_명칭", "항목ID", "항목명", "원천컬럼"])
    omop = Writer("03_OMOP_staging.csv", ["환자키", "원천행", "omop_table", "omop_field", "value", "concept_field", "date_field", "source_value_field", "source_value",
                                         "vocabulary", "신뢰도", "항목ID", "원천컬럼"])
    fhir = Writer("04_FHIR_staging.csv", ["환자키", "원천행", "resource", "fhir_path", "profile", "value", "value_display", "매칭유형", "항목ID", "원천컬럼"])
    stats = {m["col"]: {"n": 0, "ok": 0, "empty": 0, "invalid": 0, "not_allowed": 0, "out_of_range": 0} for m in active}
    missing_cols, row_no, first = [], 0, True
    for src in read_chunks(INPUT):
        if first:
            missing_cols = [m["col"] for m in MAPPING if m["method"] != "skip" and m["col"] not in src.columns]
            if missing_cols:
                print("[경고] 입력에 없는 컬럼:", ", ".join(missing_cols))
            first = False
        cols = [m for m in active if m["col"] in src.columns]
        for rec in src.to_dict("records"):
            row_no += 1
            key = sha(norm(rec.get(pk["col"]))) if pk and pk["col"] in src.columns and norm(rec.get(pk["col"])) else f"ROW-{row_no}"
            vals = {}
            for m in cols:
                v, status = convert(m, rec.get(m["col"]))
                st = stats[m["col"]]
                st["n"] += 1
                st[status] += 1
                if m["method"] == "patient_key":
                    continue
                vals[m["col"]] = v
                if v == "":
                    continue
                label = code_label(m, v)
                if m.get("krcdi"):
                    k = m["krcdi"]
                    cdi.row([key, row_no, k["cls"], k["el"], k["req"], k["match"], v, label, m["item_id"], m["name"], m["col"]])
                if m.get("omop"):
                    o = m["omop"]
                    # concept_id 는 Athena 어휘·source_to_concept_map 으로 별도 매핑 (여기서는 원천값을 source_value 로 보존)
                    omop.row([key, row_no, o["table"], o["field"], v, o["concept"], o["date"], o["source"], v if m["method"] == "hash" else norm(rec.get(m["col"])), o["vocab"], o["conf"],
                              m["item_id"], m["col"]])
                if m.get("fhir") and m["fhir"]["path"] and m["method"] != "hash":
                    f = m["fhir"]
                    fhir.row([key, row_no, f["path"].split(".")[0], f["path"], f["profile"], v, label, f["judge"], m["item_id"], m["col"]])
            # 입력에 없는 컬럼은 빈칸 — 01_표준화.csv 열 순서는 항상 매핑 순서
            wide.row([key, row_no] + [vals.get(m["col"], "") for m in wide_cols])
        if row_no >= CHUNK_ROWS:
            print(f"  … {row_no:,}행 처리", flush=True)
    if first:
        raise SystemExit(f"읽을 행이 없습니다: {INPUT}")
    for w in (wide, cdi, omop, fhir):
        w.close()
    log = Writer("변환로그.csv", ["원천컬럼", "항목ID", "항목명", "변환방식", "행", "정상", "빈값", "해석불가", "허용값밖", "범위밖", "비고"])
    for m in MAPPING:
        s = stats.get(m["col"])
        note = "입력에 없음" if m["col"] in missing_cols else ("직접식별자 — 산출물 제외" if m["method"] == "drop" else ("미매핑 — 변환 제외" if m["method"] == "skip" else ""))
        log.row([m["col"], m.get("item_id", ""), m.get("name", ""), m["method"]] +
                ([s["n"], s["ok"], s["empty"], s["invalid"], s["not_allowed"], s["out_of_range"]] if s else ["", "", "", "", "", ""]) + [note])
    log.close()
    print(f"완료: {row_no:,}행 → {OUTDIR}")
    print(f"  01_표준화.csv {wide.n:,}행 · 02_KRCDI_long.csv {cdi.n:,}행 · 03_OMOP_staging.csv {omop.n:,}행 · 04_FHIR_staging.csv {fhir.n:,}행")
    print("  변환로그.csv 에서 해석불가·허용값밖 건수를 확인하세요.")


if __name__ == "__main__":
    main()
`;

  /** 계획 → convert.py */
  function python(p, opts) {
    opts = opts || {};
    const recs = p.columns.map(record);
    const n = function (m) { return p.columns.filter(function (c) { return c.method === m; }).length; };
    const L = [
      '# -*- coding: utf-8 -*-',
      '# K-CURE 표준 변환 스크립트 — K-CURE 변환코드생성기 ' + KC.APP_VERSION + ' 자동 생성 (' + p.created + ')',
      '# 원천 컬럼 ' + p.columns.length + ' · 변환 ' + (p.columns.length - n('drop') - n('skip')) + ' · 직접식별자 제외 ' + n('drop') + ' · 미매핑 제외 ' + n('skip') +
        (p.cancer ? ' · 암종 ' + p.cancer : ''),
      '# 원본은 읽기만 합니다. 산출물은 OUTDIR 에 새로 만듭니다:',
      '#   01_표준화.csv        컬럼명을 표준항목명[항목ID]으로, 값을 표준 형식(날짜·코드·여부·수치)으로',
      '#   02_KRCDI_long.csv    KR CDI V3 분류·항목별 세로형',
      '#   03_OMOP_staging.csv  OMOP CDM v5.4 테이블·필드별 적재 준비 데이터(concept_id 는 Athena 로 별도 매핑)',
      '#   04_FHIR_staging.csv  KR Core V2 FHIR 경로별 값(리소스 생성 전 단계)',
      '#   변환로그.csv          컬럼별 정상·빈값·해석불가·허용값밖 건수',
      '# 실행: set KCURE_SALT=기관비밀값  →  python convert.py   (또는 run.bat)',
      'import csv',
      'import hashlib',
      'import os',
      'import re',
      'import sys',
      'from datetime import date, timedelta',
      'from pathlib import Path',
      '',
      'import pandas as pd',
      '',
      'try:',
      '    sys.stdout.reconfigure(encoding="utf-8")  # cp949 콘솔에서도 한글 출력',
      'except (AttributeError, ValueError):',
      '    pass',
      '',
      'INPUT = Path(' + pyPath(opts.input || 'C:\\kcure\\in\\source.csv') + ')',
      'OUTDIR = Path(' + pyPath(opts.outdir || 'C:\\kcure\\out\\standard') + ')',
      'SALT = os.environ.get("KCURE_SALT", "")',
      'CHUNK_ROWS = 200000  # 큰 CSV(수 GB)는 이 행 수씩 나눠 처리',
      '',
      '# 컬럼 매핑 — 검토 후 method 나 항목을 고쳐 다시 실행할 수 있습니다.',
      '# method: ' + ORDER.map(function (k) { return k + '(' + METHODS[k].label + ')'; }).join(', '),
      'MAPPING = ['
    ];
    recs.forEach(function (r) { L.push('    ' + py(r) + ','); });
    L.push(']');
    return L.join('\n') + '\n' + PY_BODY;
  }

  function mappingRows(p) {
    const rows = [['원천 컬럼', '변환 방식', '항목ID', '표준항목명', '자료형', '단위', '허용값', 'KR CDI', 'KR Core 경로', 'KR Core 매칭', 'OMOP', 'ARGO', '매핑 근거']];
    p.columns.forEach(function (c) {
      const it = c.item;
      rows.push([c.col, METHODS[c.method].label, it ? it.id : '', it ? it.name : '', it ? it.type : '', it ? it.unit || '' : '', it ? it.allowed || '' : '',
        it && it.cdi && it.cdi.el ? it.cdi.cls + ' / ' + it.cdi.el : '', it ? it.core.path : '', it ? KC.match.label(it.core.judge) : '',
        it && it.omop && it.omop.table ? it.omop.table + '.' + it.omop.field : '', it && it.argo && it.argo.key ? it.argo.key : '',
        c.item ? c.mappedBy : '항목 미인식']);
    });
    return rows;
  }

  function runBat() {
    return ['@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"', 'rem K-CURE 표준 변환 실행 (Windows). 원본 파일은 바꾸지 않습니다.',
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
      'venv\\Scripts\\python.exe convert.py',
      'pause', ''].join('\r\n');
  }

  function readme(p, opts, hash) {
    const n = function (m) { return p.columns.filter(function (c) { return c.method === m; }).length; };
    return ['# K-CURE 표준 변환 코드 패키지', '',
      '- 생성: ' + p.created + ' · K-CURE 변환코드생성기 ' + KC.APP_VERSION + (p.cancer ? ' · 암종 ' + p.cancer : ''),
      '- 원천 컬럼 ' + p.columns.length + '개: 변환 ' + (p.columns.length - n('drop') - n('skip')) + ' · 직접식별자 제외 ' + n('drop') + ' · 미매핑 제외 ' + n('skip'),
      '- 환자키 컬럼: ' + (p.patientCol || '(없음 — 원천 행 번호로 대체)'),
      '- convert.py SHA-256: `' + hash + '`', '',
      '## 실행 방법', '',
      '1. `convert.py` 위쪽의 `INPUT`(원천 파일)과 `OUTDIR`(결과 폴더)을 확인합니다.',
      '2. 기관 비밀값을 환경변수로 설정합니다. 예: `set KCURE_SALT=기관비밀값`. 이 값은 코드나 파일에 적지 마세요.',
      '3. `run.bat`을 더블클릭합니다. 처음 실행하면 가상환경(venv)을 만들고 pandas·openpyxl을 설치합니다. 인터넷이 없는 PC에서는 `wheels` 폴더에 설치 파일을 넣어 두면 그 파일로 설치합니다.',
      '   - 직접 실행할 때는 `python convert.py`를 씁니다(Python 3.9 이상, pandas 2.x).', '',
      '## 산출물 (OUTDIR)', '',
      '| 파일 | 내용 |', '|---|---|',
      '| `01_표준화.csv` | 환자키(가명키)·원천행 + 컬럼명을 `표준항목명 [항목ID]`로 바꾸고 값을 표준 형식으로 정규화 |',
      '| `02_KRCDI_long.csv` | KR CDI V3 분류·항목별 세로형(환자키, 항목, 값, 매칭유형) |',
      '| `03_OMOP_staging.csv` | OMOP CDM v5.4 테이블·필드별 적재 준비 데이터. `concept_id`는 Athena 어휘로 따로 매핑합니다 |',
      '| `04_FHIR_staging.csv` | KR Core V2 FHIR 경로별 값. 리소스(Bundle)를 만들기 전 단계입니다 |',
      '| `변환로그.csv` | 컬럼별 정상·빈값·해석불가·허용값밖·범위밖 건수 |', '',
      '## 지키는 것', '',
      '- 원본 파일은 읽기만 합니다. 결과는 임시 파일에 쓴 뒤 교체합니다.',
      '- 이름·연락처·주소 같은 직접식별자 컬럼은 산출물에 넣지 않습니다(`method: drop`).',
      '- 환자번호 등 식별번호는 `KCURE_SALT` 기반 SHA-256 가명키로 바꿉니다. 같은 솔트로 다시 실행하면 같은 가명키가 나옵니다.',
      '- 생년월일은 연도만 남깁니다(`method: year`).',
      '- CSV는 20만 행씩 나눠 처리하므로 수 GB 파일도 메모리 부족 없이 처리합니다.', '',
      '## 매핑 고치기', '',
      '`매핑표.csv`에서 컬럼별 매핑을 검토합니다. 바꿀 때는 `convert.py`의 `MAPPING` 목록에서 해당 컬럼의 `method`를 고치거나, 변환코드생성기에서 다시 만듭니다.',
      'method 값: ' + ORDER.map(function (k) { return '`' + k + '` ' + METHODS[k].label; }).join(' · '), '',
      '> 매핑은 후보 단계입니다(항목정의서 규칙 기반 자동 매핑). 실행 전에 담당자가 매핑표를 검토하세요.', ''].join('\n');
  }

  /** 자체 검사: 원본 수정 구문이 없는지 (가명처리 규칙팩의 금지 패턴 재사용) */
  function selfCheck(code) {
    return KC.codegen ? KC.codegen.selfCheck(code, 'python') : [];
  }

  function buildPackage(p, opts) {
    const code = python(p, opts);
    const bad = selfCheck(code);
    if (bad.length) throw new Error('생성 코드에 원본 수정 구문이 있습니다: ' + bad.map(function (b) { return b.line + '행 ' + b.text; }).join(' / '));
    const hash = KC.sha256(code);
    const summary = { tool: 'K-CURE 변환코드생성기 ' + KC.APP_VERSION, created: p.created, cancer: p.cancer, patientCol: p.patientCol, options: opts || {},
      columns: p.columns.map(record), sha256: { 'convert.py': hash } };
    return {
      hash: hash,
      files: [
        { path: 'convert.py', content: code },
        { path: '매핑표.csv', content: U.toCsv(mappingRows(p)) },
        { path: '매핑.json', content: JSON.stringify(summary, null, 2) },
        { path: 'requirements.txt', content: 'pandas>=2.0\nopenpyxl>=3.1\n' },
        { path: 'run.bat', content: runBat() },
        { path: 'README_실행안내.md', content: readme(p, opts, hash) }
      ]
    };
  }

  return { METHODS: METHODS, ORDER: ORDER, autoMethod: autoMethod, plan: plan, setItem: setItem, setMethod: setMethod, python: python,
    mappingRows: mappingRows, buildPackage: buildPackage, selfCheck: selfCheck, record: record };
})();
